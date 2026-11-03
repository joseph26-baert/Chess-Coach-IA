// Export des données personnelles (CSV, séparateur point-virgule : s'ouvre directement dans Excel en français)
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware.js';
import { THEMES } from '../services/puzzles.js';
import { KINDS } from './journal.js';

const router = Router();
router.use(requireAuth);

function csv(rows, columns) {
  const esc = (v) => { if (v === null || v === undefined) return ''; const s = String(v); return /[;"\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  const lines = [columns.map(c => esc(c.label)).join(';')];
  for (const r of rows) lines.push(columns.map(c => esc(typeof c.get === 'function' ? c.get(r) : r[c.get])).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
function send(res, name, body) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="chess-coach-${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(body);
}
const SCORE = { 1: 'victoire', 0.5: 'nulle', 0: 'défaite' };

const EXPORTS = {
  parties: (uid) => csv(db.prepare(`SELECT g.*, a.accuracy_user, a.acpl_user, a.inaccuracies, a.mistakes, a.blunders FROM games g
      LEFT JOIN analyses a ON a.id = (SELECT MAX(id) FROM analyses WHERE game_id = g.id AND status = 'done')
      WHERE g.user_id = ? AND g.status = 'finished' ORDER BY g.finished_at`).all(uid), [
    { label: 'id', get: 'id' }, { label: 'date', get: r => r.finished_at?.slice(0, 10) }, { label: 'heure', get: r => r.finished_at?.slice(11, 16) },
    { label: 'couleur', get: r => r.user_color === 'white' ? 'blancs' : 'noirs' }, { label: 'cadence', get: 'time_control' }, { label: 'elo_ia', get: 'ai_elo' },
    { label: 'resultat', get: r => SCORE[r.user_score] }, { label: 'fin', get: 'termination' }, { label: 'classee', get: r => r.rated ? 'oui' : 'non' },
    { label: 'elo_avant', get: 'elo_before' }, { label: 'elo_apres', get: 'elo_after' }, { label: 'variation', get: 'elo_delta' },
    { label: 'coups', get: r => Math.ceil(r.move_count / 2) }, { label: 'duree_s', get: 'duration_s' },
    { label: 'precision', get: 'accuracy_user' }, { label: 'perte_moyenne_cp', get: 'acpl_user' }, { label: 'imprecisions', get: 'inaccuracies' }, { label: 'erreurs', get: 'mistakes' }, { label: 'gaffes', get: 'blunders' },
    { label: 'pgn', get: 'pgn' },
  ]),
  erreurs: (uid) => csv(db.prepare(`SELECT e.*, g.finished_at FROM error_events e JOIN games g ON g.id = e.game_id WHERE e.user_id = ?
      AND e.analysis_id = (SELECT MAX(id) FROM analyses WHERE game_id = g.id AND status = 'done') ORDER BY g.finished_at, e.ply`).all(uid), [
    { label: 'partie', get: 'game_id' }, { label: 'date', get: r => r.finished_at?.slice(0, 10) }, { label: 'coup', get: r => Math.ceil(r.ply / 2) },
    { label: 'categorie', get: 'category' }, { label: 'motif', get: 'motif' }, { label: 'gravite', get: 'severity' }, { label: 'perte_cp', get: 'loss_cp' },
  ]),
  elo: (uid) => csv(db.prepare('SELECT * FROM rating_history WHERE user_id = ? ORDER BY created_at, id').all(uid), [
    { label: 'date', get: r => r.created_at.slice(0, 10) }, { label: 'heure', get: r => r.created_at.slice(11, 16) }, { label: 'partie', get: 'game_id' },
    { label: 'elo_avant', get: 'elo_before' }, { label: 'elo_apres', get: 'elo_after' }, { label: 'variation', get: 'delta' }, { label: 'provisoire', get: r => r.provisional ? 'oui' : 'non' },
  ]),
  exercices: (uid) => csv(db.prepare(`SELECT a.*, p.rating AS puzzle_rating, p.source, p.themes FROM puzzle_attempts a JOIN puzzles p ON p.id = a.puzzle_id
      WHERE a.user_id = ? ORDER BY a.created_at`).all(uid), [
    { label: 'date', get: r => r.created_at.slice(0, 10) }, { label: 'heure', get: r => r.created_at.slice(11, 16) }, { label: 'exercice', get: 'puzzle_id' },
    { label: 'origine', get: r => r.source === 'game' ? 'ma partie' : 'bibliothèque' }, { label: 'themes', get: r => JSON.parse(r.themes || '[]').map(t => THEMES[t]?.fr || t).join(', ') },
    { label: 'difficulte', get: 'puzzle_rating' }, { label: 'resultat', get: r => ({ solved: 'réussi', 'solved-hint': 'réussi avec indice', failed: 'raté' })[r.result] },
    { label: 'indices', get: 'hints' }, { label: 'temps_s', get: r => r.time_ms ? Math.round(r.time_ms / 1000) : '' },
    { label: 'theme_credite', get: r => THEMES[r.theme]?.fr || r.theme }, { label: 'niveau_avant', get: 'rating_before' }, { label: 'niveau_apres', get: 'rating_after' },
  ]),
  faiblesses: (uid) => csv(db.prepare('SELECT * FROM weakness_scores WHERE user_id = ? ORDER BY computed_at, id').all(uid), [
    { label: 'date', get: r => r.computed_at.slice(0, 10) }, { label: 'categorie', get: 'category' }, { label: 'score', get: 'score' },
    { label: 'erreurs_20_parties', get: 'errors_20g' }, { label: 'reussite_exercices', get: 'puzzle_rate' },
  ]),
  journal: (uid) => csv(db.prepare('SELECT * FROM training_log WHERE user_id = ? AND deleted_at IS NULL ORDER BY happened_on, id').all(uid), [
    { label: 'date', get: 'happened_on' }, { label: 'type', get: r => KINDS[r.kind] || r.kind }, { label: 'titre', get: 'title' }, { label: 'minutes', get: 'minutes' },
    { label: 'elo_externe', get: 'rating' }, { label: 'plateforme', get: 'platform' }, { label: 'note', get: 'note' },
  ]),
};

router.get('/', (req, res) => res.json({ exports: Object.keys(EXPORTS) }));
router.get('/:name', (req, res) => {
  const fn = EXPORTS[req.params.name];
  if (!fn) return res.status(404).json({ error: 'Export inconnu.' });
  send(res, req.params.name, fn(req.user.id));
});

export default router;
