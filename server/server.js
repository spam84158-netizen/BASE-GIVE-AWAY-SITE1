require('./dotenv-lite-load')(); // charge le fichier .env sans dépendance externe

const express = require('express');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const { setCookie, rateLimit } = require('./util');
const publicRoutes = require('./routes/public');
const participantRoutes = require('./routes/participant');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Defaults for the first deployment. Override with .env / Vercel Environment Variables.
if (!process.env.ADMIN_USERNAME) process.env.ADMIN_USERNAME = 'admin';
if (!process.env.ADMIN_PASSWORD) process.env.ADMIN_PASSWORD = '1221';
if (!process.env.ADMIN_ACCESS_CODE) process.env.ADMIN_ACCESS_CODE = '1221';
if (!process.env.COOKIE_SECRET) process.env.COOKIE_SECRET = 'outlaw-mordrex-cookie-secret-change-me';

if (!process.env.ADMIN_PASSWORD) {
  console.warn(
    '\n[ATTENTION] Aucun ADMIN_PASSWORD défini dans .env — le panneau admin refusera toute connexion tant que tu n\'en configures pas un.\n'
  );
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dossiers statiques
app.use(express.static(path.join(__dirname, '..', 'public')));
const UPLOAD_DIR = process.env.VERCEL ? path.join('/tmp', 'outlaw-mordrex-uploads') : path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// API
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'OUTLAW MORDREX GIVEAWAY' }));
app.use('/api', publicRoutes);
app.use('/api/participants', participantRoutes);
app.use('/api/admin', adminRoutes);

// Redirection de parrainage courte : /ref/:code
app.get(
  '/ref/:code',
  rateLimit({ windowMs: 60_000, max: 30, keyFn: (r) => r.ip }),
  (req, res) => {
    const code = String(req.params.code || '').toUpperCase();
    const data = db.read((d) => d);
    const referrer = data.participants.find((p) => p.referralCode === code && p.status !== 'blocked');
    if (referrer) {
      setCookie(res, 'mx_ref', code, { maxAgeSeconds: 60 * 60 * 24 * 30, httpOnly: false });
    }
    // Le parrain est mémorisé dans le cookie avant l'inscription.
    // On envoie ensuite directement vers le parcours public des récompenses.
    // L'URL WhatsApp reste configurable dans l'Admin et peut être utilisée
    // ailleurs dans l'interface, mais ne doit pas interrompre l'inscription.
    return res.redirect('/rewards.html?ref=' + encodeURIComponent(code));
  }
);

// Gestion d'erreurs (dont les erreurs multer : image trop lourde / mauvais format)
app.use((err, req, res, next) => {
  if (err) {
    console.error('[erreur]', err.message);
    return res.status(400).json({ error: err.message || 'Une erreur est survenue.' });
  }
  next();
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  OUTLAW MORDREX — serveur lancé sur http://localhost:${PORT}\n`);
  });
}

module.exports = app;
