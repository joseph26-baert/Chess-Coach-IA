import { db } from './db.js';

// Données utilisateur exposées au client (jamais le hash du mot de passe)
export function publicUser(id) {
  const u = db.prepare(`SELECT id, email, username, created_at, last_login_at, elo, peak_elo, rated_games,
                               preferred_color, ai_offset, show_threats, theme
                        FROM users WHERE id = ?`).get(id);
  if (!u) return null;
  return { ...u, provisional: u.rated_games < 5, show_threats: !!u.show_threats };
}

// Exige une session authentifiée et attache req.user
export function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Connexion requise.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Session invalide.' });
  req.user = user;
  next();
}
