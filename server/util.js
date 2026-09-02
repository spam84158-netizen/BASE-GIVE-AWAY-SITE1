const crypto = require('crypto');

// ---------- IDs & codes ----------

function newId() {
  return crypto.randomUUID();
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Code de parrainage : court, lisible, sans caractères ambigus (0/O, 1/I).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newShortCode(length = 6) {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function newRecoveryCode() {
  return `${newShortCode(4)}-${newShortCode(4)}`;
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeNumber(num) {
  return String(num || '').trim().replace(/\s+/g, '');
}

// ---------- Cookies (pas de dépendance cookie-parser) ----------

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAgeSeconds) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  parts.push('SameSite=Lax');
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (process.env.COOKIE_SECURE === 'true') parts.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const cookieStr = parts.join('; ');
  if (existing) {
    res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, cookieStr] : [existing, cookieStr]);
  } else {
    res.setHeader('Set-Cookie', cookieStr);
  }
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAgeSeconds: 0 });
}

// ---------- Rate limiting (fenêtre glissante en mémoire) ----------

const rateBuckets = new Map();

function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const key = (keyFn ? keyFn(req) : req.ip) + '|' + req.baseUrl + req.path;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket) {
      bucket = [];
      rateBuckets.set(key, bucket);
    }
    while (bucket.length && now - bucket[0] > windowMs) bucket.shift();
    if (bucket.length >= max) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans un instant.' });
    }
    bucket.push(now);
    next();
  };
}

// ---------- Sessions admin compatibles serverless ----------
// Une Map en mémoire ne fonctionne pas correctement sur Vercel : après le
// login, la requête suivante peut arriver sur une autre instance.
// Le jeton est donc auto-signé avec COOKIE_SECRET et contient son expiration.

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function getCookieSecret() {
  // Ne remplace jamais une valeur fournie par l'utilisateur.
  return String(process.env.COOKIE_SECRET || 'outlaw-mordrex-cookie-secret-change-me');
}

function signAdminPayload(payload) {
  return crypto.createHmac('sha256', getCookieSecret()).update(payload).digest('hex');
}

function createAdminSession() {
  const payload = `${Date.now()}.${crypto.randomBytes(24).toString('hex')}`;
  return `${payload}.${signAdminPayload(payload)}`;
}

function isAdminSessionValid(token) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;

  const timestamp = Number(parts[0]);
  const payload = `${parts[0]}.${parts[1]}`;
  const signature = parts[2];

  if (!Number.isFinite(timestamp)) return false;
  if (Date.now() - timestamp < 0 || Date.now() - timestamp > ADMIN_SESSION_TTL_MS) return false;

  const expected = signAdminPayload(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

function destroyAdminSession(_token) {
  // Les sessions sont stateless. La déconnexion invalide le cookie côté client.
}

module.exports = {
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
  createAdminSession,
  isAdminSessionValid,
  destroyAdminSession,
};
