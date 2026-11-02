// Routes des parties contre l'IA
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, publicUser } from '../middleware.js';
import * as G from '../services/games.js';

const router = Router();
router.use(requireAuth);

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(err => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  next(err);
});

// Partie en cours (reprise automatique)
router.get('/current', wrap(async (req, res) => {
  let game = G.getOngoing(req.user.id);
  if (game) game = await G.ensureAiMoved(G.checkFlag(game));
  res.json({ game: game ? G.serializeGame(game) : null });
}));

// Nouvelle partie
router.post('/', wrap(async (req, res) => {
  const game = await G.createGame(req.user, req.body ?? {});
  res.status(201).json({ game: G.serializeGame(game) });
}));

// Historique (parties terminées, les plus récentes d'abord)
router.get('/', wrap((req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const offset = Number(req.query.offset) || 0;
  const rows = db.prepare(`SELECT id, user_color, ai_elo, ai_offset, time_control, result, termination, user_score, rated,
                                  elo_before, elo_after, elo_delta, move_count, started_at, finished_at, duration_s
                           FROM games WHERE user_id = ? AND status = 'finished'
                           ORDER BY finished_at DESC LIMIT ? OFFSET ?`).all(req.user.id, limit, offset);
  const total = db.prepare("SELECT COUNT(*) AS n FROM games WHERE user_id = ? AND status = 'finished'").get(req.user.id).n;
  res.json({ games: rows, total });
}));

router.get('/:id', wrap((req, res) => {
  const game = G.getGame(req.params.id, req.user.id);
  if (!game) throw G.httpError(404, 'Partie introuvable.');
  res.json({ game: G.serializeGame(game) });
}));

router.post('/:id/move', wrap(async (req, res) => {
  const game = G.getGame(req.params.id, req.user.id);
  if (!game) throw G.httpError(404, 'Partie introuvable.');
  const { from, to, promotion } = req.body ?? {};
  if (!/^[a-h][1-8]$/.test(from || '') || !/^[a-h][1-8]$/.test(to || '')) throw G.httpError(400, 'Coup invalide.');
  if (promotion && !/^[qrbn]$/.test(promotion)) throw G.httpError(400, 'Promotion invalide.');
  const updated = await G.playUserMove(game, { from, to, promotion });
  res.json({ game: G.serializeGame(updated), user: publicUser(req.user.id) });
}));

router.post('/:id/resign', wrap((req, res) => {
  const game = G.getGame(req.params.id, req.user.id);
  if (!game) throw G.httpError(404, 'Partie introuvable.');
  const updated = G.resign(game);
  res.json({ game: G.serializeGame(updated), user: publicUser(req.user.id) });
}));

// Vérification de la pendule (appelée par le client quand son décompte atteint zéro)
router.post('/:id/flag', wrap((req, res) => {
  const game = G.getGame(req.params.id, req.user.id);
  if (!game) throw G.httpError(404, 'Partie introuvable.');
  const updated = G.checkFlag(game);
  res.json({ game: G.serializeGame(updated), user: publicUser(req.user.id) });
}));

export default router;
