// Routes d'entraînement : vue d'ensemble, exercice suivant, validation des coups, indice, solution, résultat
import { Router } from 'express';
import { Chess } from 'chess.js';
import { requireAuth } from '../middleware.js';
import * as T from '../services/training.js';
import { THEMES } from '../services/puzzles.js';

const router = Router();
router.use(requireAuth);
const err = (status, message) => Object.assign(new Error(message), { status });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(e => (e.status ? res.status(e.status).json({ error: e.message }) : next(e)));

router.get('/overview', wrap((req, res) => res.json(T.overview(req.user.id))));

router.get('/themes', wrap((req, res) => res.json({ themes: Object.entries(THEMES).map(([k, v]) => ({ theme: k, ...v })) })));

// Exercice suivant (programme, thème ou catégorie)
router.get('/next', wrap((req, res) => {
  const { theme, category, exclude } = req.query;
  if (theme && !THEMES[theme]) throw err(400, 'Thème inconnu.');
  const excludeIds = String(exclude || '').split(',').filter(Boolean).map(Number);
  const picked = T.pickPuzzle(req.user.id, { theme: theme || null, category: category || null, excludeIds });
  if (!picked) return res.json({ puzzle: null });
  res.json({ puzzle: T.publicPuzzle(picked.puzzle, { reason: picked.reason, category: picked.category }) });
}));

router.get('/puzzle/:id', wrap((req, res) => {
  const p = T.getPuzzle(req.params.id);
  if (!p || (p.user_id && p.user_id !== req.user.id)) throw err(404, 'Exercice introuvable.');
  res.json({ puzzle: T.publicPuzzle(p) });
}));

// Validation d'un coup : index = numéro du coup du joueur (0, 1, 2…) → réponse adverse si correct
router.post('/puzzle/:id/move', wrap((req, res) => {
  const p = T.getPuzzle(req.params.id);
  if (!p || (p.user_id && p.user_id !== req.user.id)) throw err(404, 'Exercice introuvable.');
  const { uci, index } = req.body;
  const i = Number(index) * 2;
  if (!Number.isInteger(i) || i < 0 || i >= p.solution.length) throw err(400, 'Index invalide.');
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(String(uci || ''))) throw err(400, 'Coup invalide.');
  const expected = p.solution[i];
  // Tolérance : un autre coup qui mate immédiatement est accepté comme correct
  let correct = uci === expected;
  if (!correct) {
    const c = new Chess(p.fen);
    for (let k = 0; k < i; k++) c.move({ from: p.solution[k].slice(0, 2), to: p.solution[k].slice(2, 4), promotion: p.solution[k][4] });
    try { c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); correct = c.isCheckmate(); } catch { correct = false; }
  }
  if (!correct) return res.json({ correct: false });
  const reply = p.solution[i + 1] || null;
  const done = i + 2 >= p.solution.length;
  res.json({ correct: true, reply, done: done || !reply });
}));

// Indice : la case de la pièce à jouer
router.get('/puzzle/:id/hint', wrap((req, res) => {
  const p = T.getPuzzle(req.params.id);
  if (!p || (p.user_id && p.user_id !== req.user.id)) throw err(404, 'Exercice introuvable.');
  const i = Number(req.query.index || 0) * 2;
  if (!p.solution[i]) throw err(400, 'Index invalide.');
  res.json({ from: p.solution[i].slice(0, 2) });
}));

// Solution complète (la tentative sera enregistrée comme échouée côté client)
router.get('/puzzle/:id/solution', wrap((req, res) => {
  const p = T.getPuzzle(req.params.id);
  if (!p || (p.user_id && p.user_id !== req.user.id)) throw err(404, 'Exercice introuvable.');
  const c = new Chess(p.fen);
  const san = p.solution.map(u => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
  res.json({ solution: p.solution, san });
}));

// Résultat d'une tentative
router.post('/puzzle/:id/attempt', wrap((req, res) => {
  const p = T.getPuzzle(req.params.id);
  if (!p || (p.user_id && p.user_id !== req.user.id)) throw err(404, 'Exercice introuvable.');
  const { result, hints, time_ms } = req.body;
  if (!['solved', 'solved-hint', 'failed'].includes(result)) throw err(400, 'Résultat invalide.');
  const out = T.recordAttempt(req.user.id, p.id, { result, hints: Math.max(0, Number(hints) || 0), time_ms: Number(time_ms) || null });
  res.json({ attempt: out, program: T.dailyProgram(req.user.id) });
}));

export default router;
