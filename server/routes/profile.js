// Profil et paramètres utilisateur
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { publicUser, requireAuth } from '../middleware.js';

const router = Router();
router.use(requireAuth);

// Profil complet : compte + statistiques de base + progression Elo
router.get('/', (req, res) => {
  const uid = req.user.id;
  const user = publicUser(uid);

  const stats = db.prepare(`
    SELECT COUNT(*) AS games,
           SUM(CASE WHEN user_score = 1 THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN user_score = 0 THEN 1 ELSE 0 END) AS losses,
           SUM(CASE WHEN user_score = 0.5 THEN 1 ELSE 0 END) AS draws
    FROM games WHERE user_id = ? AND status = 'finished'`).get(uid);

  const eloAt = (daysAgo) => {
    const since = new Date(Date.now() - daysAgo * 86400_000).toISOString();
    const row = db.prepare(`SELECT elo_after FROM rating_history WHERE user_id = ? AND created_at <= ?
                            ORDER BY created_at DESC, id DESC LIMIT 1`).get(uid, since);
    // Si aucune ligne avant la date, on prend la toute première (création du compte)
    return row ? row.elo_after : db.prepare(`SELECT elo_before FROM rating_history WHERE user_id = ? ORDER BY id LIMIT 1`).get(uid)?.elo_before ?? user.elo;
  };
  const first = db.prepare('SELECT elo_before FROM rating_history WHERE user_id = ? ORDER BY id LIMIT 1').get(uid);

  res.json({
    user,
    stats: { games: stats.games || 0, wins: stats.wins || 0, losses: stats.losses || 0, draws: stats.draws || 0 },
    elo: {
      current: user.elo,
      peak: user.peak_elo,
      provisional: user.provisional,
      delta7d: user.elo - eloAt(7),
      delta30d: user.elo - eloAt(30),
      deltaAllTime: user.elo - (first?.elo_before ?? user.elo),
    },
  });
});

// Mise à jour des préférences
router.patch('/settings', (req, res) => {
  const { preferred_color, ai_offset, show_threats, theme, username } = req.body;
  const updates = [];
  const params = [];

  if (preferred_color !== undefined) {
    if (!['white', 'black', 'random'].includes(preferred_color)) return res.status(400).json({ error: 'Couleur invalide.' });
    updates.push('preferred_color = ?'); params.push(preferred_color);
  }
  if (ai_offset !== undefined) {
    if (!['weaker', 'equal', 'stronger'].includes(ai_offset)) return res.status(400).json({ error: 'Réglage IA invalide.' });
    updates.push('ai_offset = ?'); params.push(ai_offset);
  }
  if (show_threats !== undefined) { updates.push('show_threats = ?'); params.push(show_threats ? 1 : 0); }
  if (theme !== undefined) {
    if (!['dark', 'light'].includes(theme)) return res.status(400).json({ error: 'Thème invalide.' });
    updates.push('theme = ?'); params.push(theme);
  }
  if (username !== undefined) {
    const u = String(username).trim();
    if (!/^[a-zA-Z0-9_\-]{3,20}$/.test(u)) return res.status(400).json({ error: "Nom d'utilisateur invalide." });
    const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(u, req.user.id);
    if (taken) return res.status(409).json({ error: "Ce nom d'utilisateur est déjà pris." });
    updates.push('username = ?'); params.push(u);
  }
  if (!updates.length) return res.status(400).json({ error: 'Rien à mettre à jour.' });

  params.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ user: publicUser(req.user.id) });
});

// Suppression du compte (RGPD) : anonymisation irréversible. L'historique de parties est conservé sans identité.
router.post('/delete', async (req, res) => {
  const password = String(req.body.password || '');
  if (!(await bcrypt.compare(password, req.user.password_hash))) return res.status(400).json({ error: 'Mot de passe incorrect.' });
  const id = req.user.id;
  db.transaction(() => {
    db.prepare(`UPDATE users SET email = ?, username = ?, password_hash = ?, deleted_at = ? WHERE id = ?`)
      .run(`supprime-${id}@invalide.local`, `supprime-${id}`, crypto.randomBytes(32).toString('hex'), new Date().toISOString(), id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(id);
    db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(id);
  })();
  req.session.destroy(() => res.json({ ok: true }));
});

export default router;
