const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const {
  newId,
  parseCookies,
  setCookie,
  clearCookie,
  rateLimit,
  createAdminSession,
  isAdminSessionValid,
  destroyAdminSession,
} = require('../util');

const router = express.Router();

const UPLOAD_DIR = process.env.VERCEL ? path.join('/tmp', 'outlaw-mordrex-uploads') : path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_MIME.has(file.mimetype) ? '.' + file.mimetype.split('/')[1].replace('jpeg', 'jpg') : '';
      cb(null, `${newId()}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('Format d\'image non supporté.'));
    cb(null, true);
  },
});

function addAudit(data, actor, action, details) {
  data.auditLog.unshift({
    id: newId(),
    actor,
    action,
    details: details || '',
    createdAt: new Date().toISOString(),
  });
  if (data.auditLog.length > 500) data.auditLog.length = 500;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  if (!isAdminSessionValid(cookies.mx_admin)) {
    return res.status(401).json({ error: 'Session admin invalide ou expirée.' });
  }
  next();
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------- Auth ----------

router.post(
  '/login',
  rateLimit({ windowMs: 5 * 60_000, max: 10, keyFn: (r) => r.ip }),
  (req, res) => {
    const { username, password } = req.body || {};
    const validUser = String(process.env.ADMIN_USERNAME || 'admin').trim();
    const validPass = String(process.env.ADMIN_PASSWORD || '1221');
    if (
      !validPass ||
      !timingSafeEqual(username || '', validUser) ||
      !timingSafeEqual(password || '', validPass)
    ) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }
    const token = createAdminSession();
    setCookie(res, 'mx_admin', token, { maxAgeSeconds: 60 * 60 * 12 });
    res.json({ ok: true });
  }
);

router.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  destroyAdminSession(cookies.mx_admin);
  clearCookie(res, 'mx_admin');
  res.json({ ok: true });
});

router.get('/session', (req, res) => {
  const cookies = parseCookies(req);
  res.json({ authenticated: isAdminSessionValid(cookies.mx_admin) });
});

router.use(requireAdmin);

// ---------- Statistiques ----------

router.get('/stats', (req, res) => {
  const data = db.read((d) => d);
  const coinsDistributed = data.coinTransactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const recent = data.participants
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10)
    .map((p) => ({ number: p.participantNumber, name: p.name, createdAt: p.createdAt }));
  res.json({
    participants: data.participants.length,
    activeParticipants: data.participants.filter((p) => p.status === 'active').length,
    blockedParticipants: data.participants.filter((p) => p.status === 'blocked').length,
    rewards: data.rewards.length,
    coinsDistributed,
    referrals: data.referrals.filter((r) => r.status === 'validated').length,
    recentSignups: recent,
  });
});

// ---------- Paramètres ----------

router.get('/settings', (req, res) => {
  res.json(db.read((d) => d.settings));
});

router.put('/settings', (req, res) => {
  const allowedKeys = [
    'giveawayTitle',
    'giveawayTagline',
    'giveawayStatus',
    'giveawayEndsAt',
    'whatsappChannelUrl',
    'welcomeBonusEnabled',
    'welcomeBonusAmount',
    'referralBonusAmount',
  ];
  const updated = db.mutate((data) => {
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) data.settings[key] = req.body[key];
    }
    addAudit(data, 'admin', 'settings.update', JSON.stringify(req.body));
    return data.settings;
  });
  res.json(updated);
});

// ---------- Récompenses ----------

router.get('/rewards', (req, res) => {
  const data = db.read((d) => d);
  res.json(
    data.rewards
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((r) => ({
        ...r,
        participantsCount: data.participants.filter((p) => p.rewardId === r.id).length,
      }))
  );
});

router.post('/rewards', upload.single('image'), (req, res) => {
  const { name, description, requiredCoins, winnersCount, conditions, status } = req.body;
  if (!name || !requiredCoins) {
    return res.status(400).json({ error: 'Nom et objectif en coins sont requis.' });
  }
  const created = db.mutate((data) => {
    if (data.rewards.length >= 20) {
      return { error: 'Limite de 20 récompenses atteinte.' };
    }
    const reward = {
      id: newId(),
      name: String(name).trim(),
      description: String(description || '').trim(),
      image: req.file ? `/uploads/${req.file.filename}` : null,
      requiredCoins: Math.max(1, parseInt(requiredCoins, 10) || 1),
      winnersCount: Math.max(1, parseInt(winnersCount, 10) || 1),
      conditions: String(conditions || '').trim(),
      status: status || 'active',
      order: data.rewards.length,
      createdAt: new Date().toISOString(),
    };
    data.rewards.push(reward);
    addAudit(data, 'admin', 'reward.create', reward.name);
    return { reward };
  });
  if (created.error) return res.status(409).json(created);
  res.status(201).json(created.reward);
});

router.put('/rewards/:id', upload.single('image'), (req, res) => {
  const result = db.mutate((data) => {
    const reward = data.rewards.find((r) => r.id === req.params.id);
    if (!reward) return { error: 'Récompense introuvable.', status: 404 };
    const fields = ['name', 'description', 'requiredCoins', 'winnersCount', 'conditions', 'status', 'order'];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        reward[f] = ['requiredCoins', 'winnersCount', 'order'].includes(f)
          ? parseInt(req.body[f], 10)
          : req.body[f];
      }
    }
    if (req.file) reward.image = `/uploads/${req.file.filename}`;
    addAudit(data, 'admin', 'reward.update', reward.name);
    return { reward };
  });
  if (result.error) return res.status(result.status).json(result);
  res.json(result.reward);
});

router.delete('/rewards/:id', (req, res) => {
  const result = db.mutate((data) => {
    const idx = data.rewards.findIndex((r) => r.id === req.params.id);
    if (idx === -1) return { error: 'Récompense introuvable.', status: 404 };
    const inUse = data.participants.some((p) => p.rewardId === req.params.id);
    if (inUse) {
      return { error: 'Impossible de supprimer : des participants ont choisi cette récompense. Désactive-la plutôt.', status: 409 };
    }
    const [removed] = data.rewards.splice(idx, 1);
    addAudit(data, 'admin', 'reward.delete', removed.name);
    return { ok: true };
  });
  if (result.error) return res.status(result.status).json(result);
  res.json(result);
});

// ---------- Participants ----------

router.get('/participants', (req, res) => {
  const data = db.read((d) => d);
  const search = String(req.query.search || '').trim().toLowerCase();
  let list = data.participants;
  if (search) {
    list = list.filter(
      (p) => p.name.toLowerCase().includes(search) || String(p.participantNumber).includes(search)
    );
  }
  res.json(
    list
      .slice()
      .sort((a, b) => a.participantNumber - b.participantNumber)
      .map((p) => ({
        id: p.id,
        number: p.participantNumber,
        name: p.name,
        phoneNumber: p.phoneNumber,
        profileImage: p.profileImage,
        rewardId: p.rewardId,
        coins: p.coins,
        status: p.status,
        referralsCount: data.referrals.filter((r) => r.referrerId === p.id && r.status === 'validated').length,
        createdAt: p.createdAt,
      }))
  );
});

router.get('/participants/:id', (req, res) => {
  const data = db.read((d) => d);
  const p = data.participants.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Participant introuvable.' });
  const history = data.coinTransactions
    .filter((t) => t.participantId === p.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ ...p, history });
});

router.put('/participants/:id', (req, res) => {
  const result = db.mutate((data) => {
    const p = data.participants.find((x) => x.id === req.params.id);
    if (!p) return { error: 'Participant introuvable.', status: 404 };
    if (req.body.status && ['active', 'blocked'].includes(req.body.status)) {
      p.status = req.body.status;
      addAudit(data, 'admin', 'participant.status', `${p.name} -> ${p.status}`);
    }
    if (req.body.description !== undefined) p.description = String(req.body.description).slice(0, 500);
    return { p };
  });
  if (result.error) return res.status(result.status).json(result);
  res.json(result.p);
});

router.delete('/participants/:id', (req, res) => {
  const result = db.mutate((data) => {
    const idx = data.participants.findIndex((x) => x.id === req.params.id);
    if (idx === -1) return { error: 'Participant introuvable.', status: 404 };
    const [removed] = data.participants.splice(idx, 1);
    // On nettoie les traces liées (parrainages où il était le filleul, transactions).
    data.referrals = data.referrals.filter((r) => r.referredParticipantId !== removed.id);
    addAudit(data, 'admin', 'participant.delete', `${removed.name} (#${removed.participantNumber})`);
    return { ok: true };
  });
  if (result.error) return res.status(result.status).json(result);
  res.json(result);
});

router.post('/participants/:id/adjust-coins', (req, res) => {
  const amount = parseInt(req.body.amount, 10);
  const reason = String(req.body.reason || '').trim();
  if (!amount || !reason) {
    return res.status(400).json({ error: 'Montant et motif sont requis pour une correction manuelle.' });
  }
  const result = db.mutate((data) => {
    const p = data.participants.find((x) => x.id === req.params.id);
    if (!p) return { error: 'Participant introuvable.', status: 404 };
    p.coins = Math.max(0, p.coins + amount);
    data.coinTransactions.push({
      id: newId(),
      participantId: p.id,
      amount,
      reason: `[Correction admin] ${reason}`,
      createdAt: new Date().toISOString(),
    });
    addAudit(data, 'admin', 'coins.adjust', `${p.name}: ${amount > 0 ? '+' : ''}${amount} (${reason})`);
    return { p };
  });
  if (result.error) return res.status(result.status).json(result);
  res.json(result.p);
});

// ---------- Transactions & parrainages ----------

router.get('/coin-transactions', (req, res) => {
  const data = db.read((d) => d);
  const withNames = data.coinTransactions
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 300)
    .map((t) => {
      const p = data.participants.find((x) => x.id === t.participantId);
      return { ...t, participantName: p ? p.name : '(supprimé)', participantNumber: p ? p.participantNumber : null };
    });
  res.json(withNames);
});

router.get('/referrals', (req, res) => {
  const data = db.read((d) => d);
  const list = data.referrals
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((r) => {
      const referrer = data.participants.find((p) => p.id === r.referrerId);
      const referred = data.participants.find((p) => p.id === r.referredParticipantId);
      return {
        ...r,
        referrerName: referrer ? referrer.name : '(supprimé)',
        referredName: referred ? referred.name : '(supprimé)',
      };
    });
  res.json(list);
});

// ---------- Tirage au sort ----------

router.post('/draw/:rewardId', (req, res) => {
  const result = db.mutate((data) => {
    const reward = data.rewards.find((r) => r.id === req.params.rewardId);
    if (!reward) return { error: 'Récompense introuvable.', status: 404 };

    const alreadyWon = new Set(data.winners.filter((w) => w.rewardId === reward.id).map((w) => w.participantId));
    const eligible = data.participants.filter(
      (p) =>
        p.rewardId === reward.id &&
        p.status === 'active' &&
        p.coins >= reward.requiredCoins &&
        !alreadyWon.has(p.id)
    );

    if (eligible.length === 0) {
      return { error: 'Aucun participant éligible pour cette récompense (objectif non atteint ou déjà gagnant).', status: 409 };
    }

    const slotsLeft = Math.max(0, reward.winnersCount - alreadyWon.size);
    if (slotsLeft === 0) {
      return { error: 'Tous les gagnants pour cette récompense ont déjà été tirés.', status: 409 };
    }

    // Tirage cryptographiquement aléatoire, exécuté côté serveur uniquement.
    const pool = eligible.slice();
    const picked = [];
    const drawCount = Math.min(slotsLeft, pool.length);
    for (let i = 0; i < drawCount; i++) {
      const idx = crypto.randomInt(0, pool.length);
      const [chosen] = pool.splice(idx, 1);
      picked.push(chosen);
      const winner = {
        id: newId(),
        participantId: chosen.id,
        rewardId: reward.id,
        createdAt: new Date().toISOString(),
      };
      data.winners.push(winner);
    }

    if (alreadyWon.size + picked.length >= reward.winnersCount) {
      reward.status = 'completed';
    }

    addAudit(data, 'admin', 'draw', `${reward.name}: ${picked.map((p) => p.name).join(', ')}`);

    return {
      winners: picked.map((p) => ({
        number: p.participantNumber,
        name: p.name,
        profileImage: p.profileImage,
      })),
      reward: { id: reward.id, name: reward.name },
    };
  });
  if (result.error) return res.status(result.status).json(result);
  res.json(result);
});

router.get('/winners', (req, res) => {
  const data = db.read((d) => d);
  const list = data.winners
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((w) => {
      const p = data.participants.find((x) => x.id === w.participantId);
      const r = data.rewards.find((x) => x.id === w.rewardId);
      return {
        ...w,
        participantName: p ? p.name : '(supprimé)',
        participantNumber: p ? p.participantNumber : null,
        rewardName: r ? r.name : '(supprimée)',
      };
    });
  res.json(list);
});

// ---------- Journal d'audit ----------

router.get('/audit-log', (req, res) => {
  const data = db.read((d) => d);
  res.json(data.auditLog.slice(0, 200));
});

module.exports = router;
