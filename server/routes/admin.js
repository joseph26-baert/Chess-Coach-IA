// Administration : statistiques d'usage, réservées aux comptes listés dans ADMIN_EMAILS
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware.js';

const router = Router();
router.use(requireAuth);

export const adminEmails = () => String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
export const isAdmin = (user) => adminEmails().includes(String(user.email).toLowerCase());

router.use((req, res, next) => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'Accès réservé.' })));

// Les administrateurs sont exclus des comptages
router.get('/stats', (req, res) => {
  const admins = adminEmails();
  const placeholders = admins.map(() => '?').join(',') || "''";
  const since = (days) => new Date(Date.now() - days * 86400_000).toISOString();
  const q = (sql, ...p) => db.prepare(sql).get(...p).n;
  res.json({
    users: q(`SELECT COUNT(*) AS n FROM users WHERE LOWER(email) NOT IN (${placeholders})`, ...admins),
    users_7d: q(`SELECT COUNT(*) AS n FROM users WHERE LOWER(email) NOT IN (${placeholders}) AND created_at >= ?`, ...admins, since(7)),
    active_7d: q(`SELECT COUNT(*) AS n FROM users WHERE LOWER(email) NOT IN (${placeholders}) AND last_login_at >= ?`, ...admins, since(7)),
    active_30d: q(`SELECT COUNT(*) AS n FROM users WHERE LOWER(email) NOT IN (${placeholders}) AND last_login_at >= ?`, ...admins, since(30)),
    games: q(`SELECT COUNT(*) AS n FROM games g JOIN users u ON u.id = g.user_id WHERE g.status = 'finished' AND LOWER(u.email) NOT IN (${placeholders})`, ...admins),
    games_7d: q(`SELECT COUNT(*) AS n FROM games g JOIN users u ON u.id = g.user_id WHERE g.status = 'finished' AND LOWER(u.email) NOT IN (${placeholders}) AND g.finished_at >= ?`, ...admins, since(7)),
    puzzles: q(`SELECT COUNT(*) AS n FROM puzzle_attempts a JOIN users u ON u.id = a.user_id WHERE LOWER(u.email) NOT IN (${placeholders})`, ...admins),
    analyses_pending: q(`SELECT COUNT(*) AS n FROM analyses WHERE status IN ('pending', 'running')`),
    library: q(`SELECT COUNT(*) AS n FROM puzzles WHERE source = 'library'`),
  });
});

export default router;
