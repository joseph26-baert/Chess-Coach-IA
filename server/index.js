// Point d'entrée du serveur Chess Coach
import express from 'express';
import session from 'express-session';
import SqliteStoreFactory from 'better-sqlite3-session-store';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { db, runMigrations } from './db.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import gamesRoutes from './routes/games.js';
import { shutdown as shutdownEngines } from './engine/stockfish.js';
import { recoverQueue } from './services/analysis.js';
import trainingRoutes from './routes/training.js';
import adminRoutes from './routes/admin.js';
import statsRoutes from './routes/stats.js';
import journalRoutes from './routes/journal.js';
import exportRoutes from './routes/export.js';
import { loadLibrary } from './services/training.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

runMigrations();
loadLibrary();
recoverQueue();

// Secret de session : variable d'environnement, sinon généré et conservé dans data/
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(ROOT, 'data', 'session-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', 1); // derrière un reverse proxy (hébergeur)
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => { req.body ??= {}; next(); });

// Sessions persistées en base (survivent aux redémarrages du serveur)
const SqliteStore = SqliteStoreFactory(session);
app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60_000 } }),
  name: 'chesscoach.sid',
  secret: sessionSecret(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 30 * 24 * 3600_000, // 30 jours
  },
}));

// En-têtes de sécurité de base
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// --- API ---------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/export', exportRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));

// --- Fichiers statiques (frontend + bibliothèques) ----------------------
app.use('/vendor/cm-chessboard', express.static(path.join(ROOT, 'node_modules', 'cm-chessboard')));
app.use('/vendor/chart.js', express.static(path.join(ROOT, 'node_modules', 'chart.js', 'dist')));
app.use('/vendor/chess.js', express.static(path.join(ROOT, 'node_modules', 'chess.js', 'dist', 'esm')));
app.use('/vendor/fonts/montserrat', express.static(path.join(ROOT, 'node_modules', '@fontsource', 'montserrat'), { maxAge: '30d' }));
app.use('/vendor/fonts/inter', express.static(path.join(ROOT, 'node_modules', '@fontsource', 'inter'), { maxAge: '30d' }));
app.use(express.static(path.join(ROOT, 'public'), { index: false }));

// Surveillance (hébergeur) et référencement
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${BASE_URL}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const pages = ['/', '/#/inscription', '/#/connexion', '/#/confidentialite'];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(p => `  <url><loc>${BASE_URL}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
});

// Application monopage : toute route non-API renvoie index.html (adresse publique injectée pour les balises canonical / Open Graph)
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
app.get('/{*splat}', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route inconnue.' });
  res.type('html').send(indexHtml.replaceAll('__BASE_URL__', BASE_URL));
});

// Gestion d'erreurs
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

const server = app.listen(PORT, () => console.log(`Chess Coach IA démarré sur http://localhost:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { shutdownEngines(); server.close(() => process.exit(0)); });
export default app;
