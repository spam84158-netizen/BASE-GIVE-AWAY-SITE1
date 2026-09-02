const express = require('express');
const db = require('../db');

const router = express.Router();
router.post('/access', (req, res) => {
  const code = String(req.body?.code || '').trim();
  const adminCode = String(process.env.ADMIN_ACCESS_CODE || '1221');
  res.json({ ok: true, isAdmin: code === adminCode });
});


function publicReward(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    image: r.image || null,
    requiredCoins: r.requiredCoins,
    winnersCount: r.winnersCount,
    status: r.status,
    conditions: r.conditions || '',
    referralBonusHint: null, // rempli par l'appelant si besoin
  };
}

function publicParticipant(p) {
  return {
    number: p.participantNumber,
    name: p.name,
    profileImage: p.profileImage || null,
    description: p.description || '',
    coins: p.coins,
    referralsCount: undefined, // calculé à l'appel
  };
}

router.get('/stats', (req, res) => {
  const data = db.read((d) => d);
  const validReferrals = data.referrals.filter((r) => r.status === 'validated');
  const coinsDistributed = data.coinTransactions
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
  res.json({
    title: data.settings.giveawayTitle,
    tagline: data.settings.giveawayTagline,
    status: data.settings.giveawayStatus,
    endsAt: data.settings.giveawayEndsAt,
    totalParticipants: data.participants.filter((p) => p.status !== 'blocked').length,
    totalRewards: data.rewards.filter((r) => r.status !== 'disabled').length,
    totalReferrals: validReferrals.length,
    coinsDistributed,
  });
});

router.get('/rewards', (req, res) => {
  const data = db.read((d) => d);
  const rewards = data.rewards
    .filter((r) => r.status !== 'disabled')
    .sort((a, b) => a.order - b.order)
    .map((r) => ({
      ...publicReward(r),
      referralBonus: data.settings.referralBonusAmount,
      participantsCount: data.participants.filter((p) => String(p.rewardId) === String(r.id) && p.status !== 'blocked').length,
    }));
  res.json(rewards);
});

router.get('/rewards/:id', (req, res) => {
  const data = db.read((d) => d);
  const reward = data.rewards.find((r) => String(r.id) === String(req.params.id) && r.status !== 'disabled');
  if (!reward) return res.status(404).json({ error: 'Récompense introuvable.' });
  res.json({
    ...publicReward(reward),
    referralBonus: data.settings.referralBonusAmount,
    participantsCount: data.participants.filter((p) => String(p.rewardId) === String(reward.id) && p.status !== 'blocked').length,
  });
});

router.get('/participants', (req, res) => {
  const data = db.read((d) => d);
  const search = String(req.query.search || '').trim().toLowerCase();
  let list = data.participants.filter((p) => p.status !== 'blocked');
  if (search) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(search) ||
        String(p.participantNumber).includes(search)
    );
  }
  list = list.sort((a, b) => a.participantNumber - b.participantNumber);
  const total = list.length;
  const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
  list = list.slice(0, limit).map((p) => {
    const referralsCount = data.referrals.filter(
      (r) => r.referrerId === p.id && r.status === 'validated'
    ).length;
    return { ...publicParticipant(p), referralsCount };
  });
  res.json({ total, participants: list });
});

router.get('/leaderboard', (req, res) => {
  const data = db.read((d) => d);
  const list = data.participants
    .filter((p) => p.status !== 'blocked')
    .slice()
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 50)
    .map((p) => ({
      number: p.participantNumber,
      name: p.name,
      profileImage: p.profileImage || null,
      coins: p.coins,
    }));
  res.json(list);
});

module.exports = router;
