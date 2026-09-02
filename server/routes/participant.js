const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const {
  newId,
  newToken,
  newShortCode,
  newRecoveryCode,
  normalizeName,
  normalizeNumber,
  parseCookies,
  setCookie,
  clearCookie,
  rateLimit,
} = require('../util');

const router = express.Router();

const UPLOAD_DIR = process.env.VERCEL ? path.join('/tmp', 'outlaw-mordrex-uploads') : path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_MIME.has(file.mimetype)
        ? '.' + file.mimetype.split('/')[1].replace('jpeg', 'jpg')
        : '';
      cb(null, `${newId()}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 Mo
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Format d\'image non supporté (jpg, png ou webp uniquement).'));
    }
    cb(null, true);
  },
});

function findParticipantByToken(token) {
  if (!token) return null;
  return db.read((d) => d.participants.find((p) => p.sessionToken === token)) || null;
}

function serializeMe(p, data) {
  const reward = data.rewards.find((r) => r.id === p.rewardId) || null;
  const history = data.coinTransactions
    .filter((t) => t.participantId === p.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const referralsCount = data.referrals.filter(
    (r) => r.referrerId === p.id && r.status === 'validated'
  ).length;
  const progress = reward ? Math.min(100, Math.round((p.coins / reward.requiredCoins) * 100)) : 0;
  return {
    number: p.participantNumber,
    name: p.name,
    profileImage: p.profileImage || null,
    description: p.description || '',
    coins: p.coins,
    referralCode: p.referralCode,
    recoveryCode: p.recoveryCode,
    referralsCount,
    reward: reward
      ? {
          id: reward.id,
          name: reward.name,
          requiredCoins: reward.requiredCoins,
          progress,
          objectiveReached: p.coins >= reward.requiredCoins,
        }
      : null,
    history: history.map((h) => ({ amount: h.amount, reason: h.reason, createdAt: h.createdAt })),
  };
}

// GET /api/me — espace personnel du participant courant (via cookie)
router.get('/me', (req, res) => {
  const cookies = parseCookies(req);
  const participant = findParticipantByToken(cookies.mx_token);
  if (!participant) return res.status(401).json({ error: 'Aucune session active.' });
  const data = db.read((d) => d);
  res.json(serializeMe(participant, data));
});

// POST /api/participants/register
router.post(
  '/register',
  rateLimit({ windowMs: 60_000, max: 8, keyFn: (r) => r.ip }),
  upload.single('photo'),
  (req, res) => {
    const cookies = parseCookies(req);

    // Si déjà une session valide, ne pas recréer de participant.
    const existingByToken = findParticipantByToken(cookies.mx_token);
    if (existingByToken) {
      return res.status(200).json({ alreadyRegistered: true, number: existingByToken.participantNumber });
    }

    const name = String(req.body.name || '').trim();
    const phoneRaw = String(req.body.phoneNumber || '').trim();
    const rewardId = String(req.body.rewardId || req.body.reward || req.body.id || '').trim();
    const description = String(req.body.description || '').trim().slice(0, 500);

    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Le nom du participant est obligatoire.' });
    }
    if (!phoneRaw) {
      return res.status(400).json({ error: 'Le numéro du participant est obligatoire.' });
    }
    if (!rewardId) {
      return res.status(400).json({ error: 'Choisis d\'abord une récompense.' });
    }

    const normalizedName = normalizeName(name);
    const normalizedNumber = normalizeNumber(phoneRaw);

    const result = db.mutate((data) => {
      const reward = data.rewards.find((r) => String(r.id) === String(rewardId) && r.status !== 'disabled');
      if (!reward) return { error: 'Cette récompense n\'existe pas ou n\'est plus disponible.', status: 400 };

      const dupName = data.participants.find((p) => normalizeName(p.name) === normalizedName);
      if (dupName) {
        return {
          error: 'PARTICIPATION EXISTANTE',
          message: 'Ce nom est déjà inscrit comme participant.',
          existingNumber: dupName.participantNumber,
          status: 409,
        };
      }
      const dupNumber = data.participants.find((p) => normalizeNumber(p.phoneNumber) === normalizedNumber);
      if (dupNumber) {
        return {
          error: 'NUMÉRO DÉJÀ UTILISÉ',
          message: 'Ce numéro appartient déjà à un participant.',
          status: 409,
        };
      }

      data.counters.participantNumber += 1;
      const participantNumber = data.counters.participantNumber;
      const rewardPosition = data.participants.filter((p) => String(p.rewardId) === String(reward.id) && p.status !== 'blocked').length + 1;
      const id = newId();
      const referralCode = newShortCode(6);
      const sessionToken = newToken();
      const recoveryCode = newRecoveryCode();

      const participant = {
        id,
        participantNumber,
        rewardPosition,
        name,
        phoneNumber: phoneRaw,
        profileImage: req.file ? `/uploads/${req.file.filename}` : null,
        description,
        rewardId,
        coins: 0,
        referralCode,
        sessionToken,
        recoveryCode,
        referredBy: null,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      data.participants.push(participant);

      // Bonus de bienvenue
      if (data.settings.welcomeBonusEnabled && data.settings.welcomeBonusAmount > 0) {
        participant.coins += data.settings.welcomeBonusAmount;
        data.coinTransactions.push({
          id: newId(),
          participantId: id,
          amount: data.settings.welcomeBonusAmount,
          reason: 'Bonus de bienvenue',
          createdAt: new Date().toISOString(),
        });
      }

      // Parrainage : cookie mx_ref posé lors du clic sur /ref/:code
      const refCode = cookies.mx_ref ? String(cookies.mx_ref).toUpperCase() : null;
      if (refCode) {
        const referrer = data.participants.find(
          (p) => p.referralCode === refCode && p.id !== id && p.status !== 'blocked'
        );
        // Un participant ne peut être compté comme "parrainé" qu'une seule fois :
        // comme referredParticipantId vient d'être créé à l'instant, il ne peut
        // pas déjà exister ailleurs — la duplication de nom/numéro empêche
        // qu'une même personne déclenche deux fois ce bloc.
        if (referrer) {
          const bonus = data.settings.referralBonusAmount || 0;
          data.referrals.push({
            id: newId(),
            referrerId: referrer.id,
            referredParticipantId: id,
            status: 'validated',
            coinsAwarded: bonus,
            createdAt: new Date().toISOString(),
          });
          referrer.coins += bonus;
          data.coinTransactions.push({
            id: newId(),
            participantId: referrer.id,
            amount: bonus,
            reason: 'Nouveau parrainage',
            createdAt: new Date().toISOString(),
          });
          participant.referredBy = referrer.id;
        }
      }

      return { ok: true, participant };
    });

    if (result.error && result.status) {
      return res.status(result.status).json(result);
    }

    clearCookie(res, 'mx_ref');
    setCookie(res, 'mx_token', result.participant.sessionToken, { maxAgeSeconds: 60 * 60 * 24 * 365 });
    res.status(201).json({ ok: true, number: result.participant.participantNumber });
  }
);

// GET /api/participants/by-reward/:rewardId — liste publique des joueurs d'une récompense
router.get('/by-reward/:rewardId', (req, res) => {
  const data = db.read((d) => d);
  const reward = data.rewards.find((r) => r.id === req.params.rewardId && r.status !== 'disabled');
  if (!reward) return res.status(404).json({ error: 'Récompense introuvable.' });
  const participants = data.participants
    .filter((p) => String(p.rewardId) === String(reward.id) && p.status !== 'blocked')
    .sort((a, b) => (a.rewardPosition || a.participantNumber) - (b.rewardPosition || b.participantNumber))
    .map((p) => ({ position: p.rewardPosition || 0, number: p.participantNumber, name: p.name, profileImage: p.profileImage || null, coins: p.coins }));
  res.json({ reward: { id: reward.id, name: reward.name }, total: participants.length, participants });
});

// POST /api/recover — retrouver son espace avec numéro + code de récupération
router.post(
  '/recover',
  rateLimit({ windowMs: 60_000, max: 10, keyFn: (r) => r.ip }),
  (req, res) => {
    const numberRaw = normalizeNumber(req.body.participantNumber);
    const code = String(req.body.recoveryCode || '').trim().toUpperCase();
    if (!numberRaw || !code) {
      return res.status(400).json({ error: 'Numéro et code de récupération requis.' });
    }
    const result = db.mutate((data) => {
      const participant = data.participants.find(
        (p) => normalizeNumber(p.participantNumber) === numberRaw && p.recoveryCode.toUpperCase() === code
      );
      if (!participant) return null;
      // On fait tourner le token à chaque récupération (un ancien appareil perd l'accès).
      participant.sessionToken = newToken();
      return participant;
    });
    if (!result) {
      return res.status(404).json({ error: 'Numéro ou code de récupération incorrect.' });
    }
    setCookie(res, 'mx_token', result.sessionToken, { maxAgeSeconds: 60 * 60 * 24 * 365 });
    res.json({ ok: true, number: result.participantNumber });
  }
);

// GET /api/check-duplicate?name=&phone= — aide de validation côté client
router.get('/check-duplicate', (req, res) => {
  const data = db.read((d) => d);
  const name = normalizeName(req.query.name || '');
  const phone = normalizeNumber(req.query.phone || '');
  const nameTaken = name ? data.participants.some((p) => normalizeName(p.name) === name) : false;
  const phoneTaken = phone ? data.participants.some((p) => normalizeNumber(p.phoneNumber) === phone) : false;
  res.json({ nameTaken, phoneTaken });
});

module.exports = router;
