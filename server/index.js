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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

runMigrations();

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
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));

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

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));

// --- Fichiers statiques (frontend + bibliothèques) ----------------------
app.use('/vendor/cm-chessboard', express.static(path.join(ROOT, 'node_modules', 'cm-chessboard')));
app.use('/vendor/chart.js', express.static(path.join(ROOT, 'node_modules', 'chart.js', 'dist')));
app.use('/vendor/chess.js', express.static(path.join(ROOT, 'node_modules', 'chess.js', 'dist', 'esm')));
app.use(express.static(path.join(ROOT, 'public')));

// Application monopage : toute route non-API renvoie index.html
app.get('/{*splat}', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

// Gestion d'erreurs
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

app.listen(PORT, () => console.log(`Chess Coach démarré sur http://localhost:${PORT}`));
