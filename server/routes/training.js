// Routes d'entraînement : vue d'ensemble, exercice suivant, validation des coups, indice, solution, résultat.
// L'état d'une résolution (coups validés, indices, solution vue) vit côté serveur : le résultat
// enregistré n'est jamais celui que le client prétend.
import { Router } from 'express';
import { Chess } from 'chess.js';
import { requireAuth } from '../middleware.js';
import * as T from '../services/training.js';
import { THEMES } from '../services/puzzles.js';

const router = Router();
router.use(requireAuth);
const err = (status, message) => Object.assign(new Error(message), { status });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(e => (e.status ? res.status(e.status).json({ error: e.message }) : next(e)));

function ownPuzzle(req) {
  const p = T.getPuzzle(req.params.id);
  if (!p || (p.user_id && p.user_id !== req.user.id)) throw err(404, 'Exercice introuvable.');
  return p;
}
function playerIndex(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 20) throw err(400, 'Index invalide.');
  return n;
}

const tzOf = (req) => (typeof req.query.tz === 'string' && req.query.tz.length <= 64 ? req.query.tz : null);

router.get('/overview', wrap((req, res) => res.json(T.overview(req.user.id, tzOf(req)))));

router.get('/themes', wrap((req, res) => res.json({ themes: Object.entries(THEMES).map(([k, v]) => ({ theme: k, ...v })) })));

// Exercice suivant : programme du jour (par défaut), thème ou catégorie
router.get('/next', wrap((req, res) => {
  const { theme, category, exclude } = req.query;
  if (theme && !THEMES[theme]) throw err(400, 'Thème inconnu.');
  if (category && !T.CATEGORIES.includes(category)) throw err(400, 'Catégorie inconnue.');
  const excludeIds = String(exclude || '').split(',').filter(Boolean).slice(0, 100).map(Number).filter(Number.isInteger);
  const picked = theme || category
    ? T.pickPuzzle(req.user.id, { theme: theme || null, category: category || null, excludeIds })
    : T.pickProgramPuzzle(req.user.id, excludeIds, tzOf(req));
  if (!picked) return res.json({ puzzle: null });
  T.openSession(req.user.id, picked.puzzle.id);
  res.json({ puzzle: T.publicPuzzle(picked.puzzle, { reason: picked.reason, category: picked.category, slot: picked.slot?.reason || null }) });
}));

router.get('/puzzle/:id', wrap((req, res) => {
  const p = ownPuzzle(req);
  T.openSession(req.user.id, p.id);
  res.json({ puzzle: T.publicPuzzle(p) });
}));

// Validation d'un coup : index = numéro du coup du joueur (0, 1, 2…) → réponse adverse si correct
router.post('/puzzle/:id/move', wrap((req, res) => {
  const p = ownPuzzle(req);
  const sess = T.getSession(req.user.id, p.id);
  if (!sess) throw err(409, "Aucune résolution en cours pour cet exercice.");
  const n = playerIndex(req.body.index);
  const i = n * 2;
  if (i >= p.solution.length) throw err(400, 'Index invalide.');
  if (n !== sess.progress) throw err(409, 'Coup hors séquence.');
  const uci = String(req.body.uci || '');
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw err(400, 'Coup invalide.');
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
  T.sessionProgress(req.user.id, p.id, n + 1);
  res.json({ correct: true, reply, done: done || !reply });
}));

// Indice : la case de la pièce à jouer
router.get('/puzzle/:id/hint', wrap((req, res) => {
  const p = ownPuzzle(req);
  const sess = T.getSession(req.user.id, p.id);
  if (!sess) throw err(409, "Aucune résolution en cours pour cet exercice.");
  const i = sess.progress * 2;
  if (!p.solution[i]) throw err(400, 'Exercice déjà terminé.');
  T.sessionHint(req.user.id, p.id);
  res.json({ from: p.solution[i].slice(0, 2) });
}));

// Solution complète : la tentative sera comptée comme échouée
router.get('/puzzle/:id/solution', wrap((req, res) => {
  const p = ownPuzzle(req);
  if (!T.getSession(req.user.id, p.id)) throw err(409, "Aucune résolution en cours pour cet exercice.");
  T.sessionSolution(req.user.id, p.id);
  const c = new Chess(p.fen);
  const san = p.solution.map(u => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
  res.json({ solution: p.solution, san });
}));

// Clôture d'une tentative : le résultat est déduit de la session serveur
router.post('/puzzle/:id/attempt', wrap((req, res) => {
  const p = ownPuzzle(req);
  const outcome = T.sessionResult(req.user.id, p);
  if (!outcome) throw err(409, "Aucune résolution en cours pour cet exercice.");
  const out = T.recordAttempt(req.user.id, p.id, outcome);
  res.json({ attempt: { ...out, result: outcome.result, themeLabels: p.themes.map(t => THEMES[t]?.fr || t), mate_in: p.mate_in }, program: T.dailyProgram(req.user.id, tzOf(req)) });
}));

export default router;
