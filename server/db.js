// db.js — Petite base de données persistante basée sur un fichier JSON.
// Choix volontaire : pas de module natif (better-sqlite3, etc.) qui nécessite
// une compilation — ça casse trop souvent sur Termux/Android. Un fichier JSON
// suffit largement pour l'échelle d'un giveaway (quelques milliers de lignes).

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'outlaw-mordrex-data') : path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

function defaultRewards() {
  const names = [
    'BUG BOT NEW VERSION — PERSONNALISER',
    'BOT MD — PERSONNALISER',
    'BOT XD — PERSONNALISER',
    'CRÉATION DE CHEK BAN SITE — PERSONNALISER',
    'TG PREMIUM — 6 MOIS',
    'GROUP — 700 MEMBRES',
    '+509 — VIRTUEL',
    '+33 — VIRTUEL',
    'CANAL TG — 500 ABONNÉS',
    '5000 START TG',
    'NUMÉRO NGA NUDEUSE',
    'FORMATION DEV — CRÉATION DE BOT, BUG, KALI, HACKING'
  ];
  return names.map((name, i) => ({
    id: `reward-${i+1}`, name,
    description: 'Récompense OUTLAW MORDREX.', image: null,
    requiredCoins: 20 + i * 5, winnersCount: 1, conditions: '', status: 'active', order: i,
    createdAt: new Date().toISOString()
  }));
}

function defaultData() {
  return {
    settings: {
      giveawayTitle: 'OUTLAW MORDREX',
      giveawayTagline: "Rejoins la traque. Récolte des coins. Décroche ta récompense.",
      giveawayStatus: 'active', // active | paused | ended
      giveawayEndsAt: null, // ISO string ou null
      whatsappChannelUrl: '',
      welcomeBonusEnabled: true,
      welcomeBonusAmount: 5,
      referralBonusAmount: 8,
    },
    rewards: defaultRewards(),
    participants: [],
    referrals: [],
    coinTransactions: [],
    winners: [],
    auditLog: [],
    counters: {
      participantNumber: 0,
    },
  };
}

let cache = null;

function ensureLoaded() {
  if (cache) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    cache = defaultData();
    persist();
    return;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = Object.assign(defaultData(), parsed);
    if (!Array.isArray(cache.rewards)) cache.rewards = [];
    if (cache.rewards.length === 0) cache.rewards = defaultRewards();
    if (!Array.isArray(cache.participants)) cache.participants = [];
    if (!Array.isArray(cache.referrals)) cache.referrals = [];
    if (!Array.isArray(cache.coinTransactions)) cache.coinTransactions = [];
    if (!Array.isArray(cache.winners)) cache.winners = [];
    if (!Array.isArray(cache.auditLog)) cache.auditLog = [];
    if (!cache.counters) cache.counters = { participantNumber: 0 };
  } catch (err) {
    console.error('[db] Fichier de données illisible, création d\'une base vide :', err.message);
    cache = defaultData();
    persist();
  }
}

function persist() {
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmpFile, DATA_FILE); // écriture atomique
}

// Toute mutation passe par cette fonction : on lit, on modifie, on sauvegarde.
function mutate(fn) {
  ensureLoaded();
  const result = fn(cache);
  persist();
  return result;
}

function read(fn) {
  ensureLoaded();
  return fn(cache);
}

module.exports = { mutate, read };
