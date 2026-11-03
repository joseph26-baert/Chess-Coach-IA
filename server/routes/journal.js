// Journal d'entraînement : activités hors site et relevés d'Elo externes
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware.js';

const router = Router();
router.use(requireAuth);

export const KINDS = {
  lesson: 'Cours', book: 'Livre', video: 'Vidéo', tournament: 'Tournoi', games: 'Parties ailleurs', puzzles: 'Tactique ailleurs', other: 'Autre', rating: 'Elo externe',
};
export const PLATFORMS = ['chess.com', 'lichess', 'fide', 'fse', 'club', 'autre'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(body) {
  const kind = String(body.kind || '');
  if (!KINDS[kind]) return { error: "Type d'activité inconnu." };
  const title = String(body.title || '').trim().slice(0, 120);
  if (!title) return { error: 'Un titre est requis.' };
  const happened_on = String(body.happened_on || '');
  if (!DATE_RE.test(happened_on) || Number.isNaN(Date.parse(happened_on))) return { error: 'Date invalide.' };
  if (happened_on > new Date().toISOString().slice(0, 10)) return { error: 'La date est dans le futur.' };
  const note = String(body.note || '').trim().slice(0, 2000) || null;
  let minutes = null, rating = null, platform = null;
  if (kind === 'rating') {
    rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 100 || rating > 3500) return { error: 'Elo invalide (100 à 3500).' };
    platform = String(body.platform || 'autre');
    if (!PLATFORMS.includes(platform)) return { error: 'Plateforme inconnue.' };
  } else {
    minutes = body.minutes === undefined || body.minutes === null || body.minutes === '' ? null : Number(body.minutes);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60)) return { error: 'Durée invalide (en minutes).' };
  }
  return { kind, title, happened_on, note, minutes, rating, platform };
}

router.get('/kinds', (req, res) => res.json({ kinds: KINDS, platforms: PLATFORMS }));

router.get('/', (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const rows = db.prepare(`SELECT id, kind, title, minutes, rating, platform, note, happened_on, created_at FROM training_log
                           WHERE user_id = ? AND deleted_at IS NULL ORDER BY happened_on DESC, id DESC LIMIT ?`).all(req.user.id, limit);
  const totals = db.prepare(`SELECT kind, COUNT(*) AS n, COALESCE(SUM(minutes), 0) AS minutes FROM training_log
                             WHERE user_id = ? AND deleted_at IS NULL GROUP BY kind`).all(req.user.id);
  res.json({ entries: rows, totals });
});

router.post('/', (req, res) => {
  const v = clean(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const info = db.prepare(`INSERT INTO training_log (user_id, kind, title, minutes, rating, platform, note, happened_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, v.kind, v.title, v.minutes, v.rating, v.platform, v.note, v.happened_on);
  res.status(201).json({ entry: db.prepare('SELECT id, kind, title, minutes, rating, platform, note, happened_on, created_at FROM training_log WHERE id = ?').get(info.lastInsertRowid) });
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM training_log WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Entrée introuvable.' });
  const v = clean({ ...row, ...req.body });
  if (v.error) return res.status(400).json({ error: v.error });
  db.prepare(`UPDATE training_log SET kind = ?, title = ?, minutes = ?, rating = ?, platform = ?, note = ?, happened_on = ? WHERE id = ?`)
    .run(v.kind, v.title, v.minutes, v.rating, v.platform, v.note, v.happened_on, row.id);
  res.json({ entry: db.prepare('SELECT id, kind, title, minutes, rating, platform, note, happened_on, created_at FROM training_log WHERE id = ?').get(row.id) });
});

// Suppression logique : l'historique n'est jamais effacé
router.delete('/:id', (req, res) => {
  const r = db.prepare('UPDATE training_log SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL').run(new Date().toISOString(), req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Entrée introuvable.' });
  res.json({ ok: true });
});

export default router;
