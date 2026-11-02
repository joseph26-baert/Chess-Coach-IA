// Authentification : inscription, connexion, déconnexion, session, réinitialisation.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { publicUser, requireAuth } from '../middleware.js';
import { STARTING_ELO } from '../services/elo.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_\-]{3,20}$/;

// Protection minimale contre la force brute : compteur en mémoire par IP+email
const attempts = new Map();
function tooManyAttempts(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > 15 * 60_000) { attempts.delete(key); return false; }
  return a.count >= 10;
}
function recordAttempt(key) {
  const a = attempts.get(key) || { first: Date.now(), count: 0 };
  a.count++;
  attempts.set(key, a);
}

// Révoque toutes les sessions d'un utilisateur (après changement de mot de passe),
// sauf éventuellement la session courante.
function revokeSessions(userId, keepSid = null) {
  const rows = db.prepare("SELECT sid FROM sessions WHERE json_extract(sess, '$.userId') = ?").all(userId);
  const del = db.prepare('DELETE FROM sessions WHERE sid = ?');
  for (const r of rows) if (r.sid !== keepSid) del.run(r.sid);
}

// --- Inscription --------------------------------------------------------
router.post('/register', async (req, res) => {
  const ipKey = `register|${req.ip}`;
  if (tooManyAttempts(ipKey)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
  recordAttempt(ipKey);
  const email = String(req.body.email || '').trim();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "Nom d'utilisateur : 3 à 20 caractères (lettres, chiffres, _ ou -)." });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });

  const exists = db.prepare('SELECT id, email, username FROM users WHERE email = ? OR username = ?').get(email, username);
  if (exists) {
    const msg = exists.email.toLowerCase() === email.toLowerCase()
      ? 'Cette adresse e-mail est déjà utilisée.' : "Ce nom d'utilisateur est déjà pris.";
    return res.status(409).json({ error: msg });
  }

  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare('INSERT INTO users (email, username, password_hash, last_login_at, elo, peak_elo) VALUES (?, ?, ?, ?, ?, ?)')
    .run(email, username, hash, new Date().toISOString(), STARTING_ELO, STARTING_ELO);

  // Ligne d'initialisation de l'historique Elo (classement provisoire)
  db.prepare(`INSERT INTO rating_history (user_id, elo_before, elo_after, delta, provisional, reason)
              VALUES (?, ?, ?, 0, 1, 'init')`).run(info.lastInsertRowid, STARTING_ELO, STARTING_ELO);

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Erreur de session.' });
    req.session.userId = info.lastInsertRowid;
    res.status(201).json({ user: publicUser(info.lastInsertRowid) });
  });
});

// --- Connexion ----------------------------------------------------------
router.post('/login', async (req, res) => {
  const login = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  const key = `${req.ip}|${login.toLowerCase()}`;
  if (tooManyAttempts(key)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(login, login);
  const ok = user && await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    recordAttempt(key);
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  attempts.delete(key);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Erreur de session.' });
    req.session.userId = user.id;
    res.json({ user: publicUser(user.id) });
  });
});

// --- Déconnexion --------------------------------------------------------
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('chesscoach.sid');
    res.json({ ok: true });
  });
});

// --- Session courante ---------------------------------------------------
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = publicUser(req.session.userId);
  if (!user) { req.session.destroy(() => {}); return res.json({ user: null }); }
  res.json({ user });
});

// --- Changement de mot de passe (connecté) ------------------------------
router.post('/change-password', requireAuth, async (req, res) => {
  const { current, next } = req.body;
  if (String(next || '').length < 8) return res.status(400).json({ error: 'Nouveau mot de passe : 8 caractères minimum.' });
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(String(current || ''), user.password_hash))) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(next, 12), req.user.id);
  revokeSessions(req.user.id, req.session.id);
  res.json({ ok: true });
});

// --- Réinitialisation : demande ----------------------------------------
// Sans serveur SMTP configuré, le lien est journalisé côté serveur (et renvoyé
// en mode développement) ; avec SMTP_URL défini, il sera envoyé par e-mail.
router.post('/forgot', (req, res) => {
  const ipKey = `forgot|${req.ip}`;
  if (tooManyAttempts(ipKey)) return res.status(429).json({ error: 'Trop de demandes. Réessaie dans 15 minutes.' });
  recordAttempt(ipKey);
  db.prepare("DELETE FROM password_resets WHERE expires_at < ?").run(new Date().toISOString());
  const email = String(req.body.email || '').trim();
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  // Réponse identique que l'adresse existe ou non (pas de fuite d'information)
  const reply = { ok: true, message: 'Si un compte existe pour cette adresse, un lien de réinitialisation a été généré.' };
  if (!user) return res.json(reply);

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 60 * 60_000).toISOString(); // 1 h
  db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(user.id, tokenHash, expires);

  // BASE_URL de configuration : on ne fait jamais confiance à l'en-tête Host pour un lien envoyé par e-mail
  const base = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  const link = `${base}/#/reset/${token}`;
  console.log(`[auth] lien de réinitialisation pour ${user.email} : ${link}`);
  if (process.env.NODE_ENV !== 'production') reply.devLink = link;
  res.json(reply);
});

// --- Réinitialisation : validation du jeton ----------------------------
router.post('/reset', async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(tokenHash);
  if (!row || row.used_at || row.expires_at < new Date().toISOString()) {
    return res.status(400).json({ error: 'Lien invalide ou expiré.' });
  }
  const hash = await bcrypt.hash(password, 12);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.user_id);
    db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    revokeSessions(row.user_id);
  })();
  res.json({ ok: true });
});

export default router;
