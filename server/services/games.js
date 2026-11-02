// Logique métier des parties : création, coups, fin de partie, Elo, pendule.
// Le serveur est la seule source de vérité : chaque coup est validé ici.
import { Chess } from 'chess.js';
import { db } from '../db.js';
import { chooseMove, newPersona, validPersona, AI_MIN_ELO, AI_MAX_ELO } from '../engine/ai.js';
import { computeNewElo, isRatable, isProvisional } from './elo.js';

export const TIME_CONTROLS = {
  'none':  null,
  '3+2':   { base: 3 * 60_000,  inc: 2_000 },
  '5+0':   { base: 5 * 60_000,  inc: 0 },
  '10+0':  { base: 10 * 60_000, inc: 0 },
  '15+10': { base: 15 * 60_000, inc: 10_000 },
  '30+0':  { base: 30 * 60_000, inc: 0 },
};
const OFFSETS = { weaker: -100, equal: 0, stronger: 100 };

// --- Lecture ------------------------------------------------------------
export function getGame(id, userId) {
  return db.prepare('SELECT * FROM games WHERE id = ? AND user_id = ?').get(id, userId);
}
export function getMoves(gameId) {
  return db.prepare('SELECT ply, san, uci, fen_after, by_user, time_ms, ai_loss_cp FROM moves WHERE game_id = ? ORDER BY ply').all(gameId);
}
export function getOngoing(userId) {
  return db.prepare("SELECT * FROM games WHERE user_id = ? AND status = 'ongoing' ORDER BY id DESC LIMIT 1").get(userId);
}

// Temps restant "en direct" du joueur (décompte depuis que le trait lui est passé)
export function liveUserTime(game) {
  if (game.user_time_ms === null || game.user_time_ms === undefined) return null;
  if (game.status !== 'ongoing' || !game.user_turn_since) return game.user_time_ms;
  return game.user_time_ms - (Date.now() - new Date(game.user_turn_since).getTime());
}

export function serializeGame(game, moves = getMoves(game.id)) {
  const chess = new Chess(game.fen);
  return {
    id: game.id,
    status: game.status,
    result: game.result,
    termination: game.termination,
    user_color: game.user_color,
    user_score: game.user_score,
    ai_elo: game.ai_elo,
    ai_offset: game.ai_offset,
    ai_persona: personaLabel(personaOf(game)),
    time_control: game.time_control,
    user_time_ms: liveUserTime(game),
    fen: game.fen,
    pgn: game.pgn,
    turn: chess.turn() === 'w' ? 'white' : 'black',
    in_check: chess.isCheck(),
    move_count: game.move_count,
    moves,
    rated: !!game.rated,
    elo_before: game.elo_before,
    elo_after: game.elo_after,
    elo_delta: game.elo_delta,
    started_at: game.started_at,
    finished_at: game.finished_at,
    duration_s: game.duration_s,
  };
}

// --- Création -----------------------------------------------------------
// Force de l'IA : Elo du joueur + réglage, ajusté de ±50 selon la forme récente
export function aiEloFor(user, offset) {
  const recent = db.prepare(`SELECT user_score FROM games WHERE user_id = ? AND status = 'finished' AND rated = 1
                             ORDER BY finished_at DESC LIMIT 5`).all(user.id);
  const form = recent.reduce((s, g) => s + (g.user_score === 1 ? 1 : g.user_score === 0 ? -1 : 0), 0);
  let elo = user.elo + (OFFSETS[offset] ?? 0);
  if (recent.length === 5 && form >= 3) elo += 50;
  if (recent.length === 5 && form <= -3) elo -= 50;
  return Math.max(AI_MIN_ELO, Math.min(AI_MAX_ELO, elo));
}

export async function createGame(user, { color, ai_offset = 'equal', time_control = 'none' }) {
  if (!['white', 'black', 'random'].includes(color)) throw httpError(400, 'Couleur invalide.');
  if (!(ai_offset in OFFSETS)) throw httpError(400, 'Réglage IA invalide.');
  if (!(time_control in TIME_CONTROLS)) throw httpError(400, 'Cadence invalide.');
  if (getOngoing(user.id)) throw httpError(409, 'Une partie est déjà en cours.');

  const userColor = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
  const aiElo = aiEloFor(user, ai_offset);
  const tc = TIME_CONTROLS[time_control];
  const chess = new Chess();
  const now = new Date().toISOString();

  const persona = JSON.stringify(newPersona());
  const info = db.prepare(`INSERT INTO games (user_id, user_color, ai_elo, ai_offset, ai_profile, time_control, user_time_ms, user_turn_since,
                                              elo_before, fen, pgn, started_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`)
    .run(user.id, userColor, aiElo, ai_offset, persona, time_control, tc ? tc.base : null,
         userColor === 'white' ? now : null, user.elo, chess.fen(), now);
  let game = getGame(info.lastInsertRowid, user.id);

  if (userColor === 'black') game = await playAiMove(game, chess);
  return game;
}

// --- Coups --------------------------------------------------------------
function rebuild(game) {
  const chess = new Chess();
  for (const m of getMoves(game.id)) chess.move(m.san);
  return chess;
}

// Enregistre un coup (+ éventuellement la pendule) dans une seule transaction.
const storeMove = db.transaction((game, chess, move, byUser, timeMs = null, aiLoss = null, clock = null) => {
  const ply = chess.history().length;
  const uci = move.from + move.to + (move.promotion || '');
  db.prepare(`INSERT INTO moves (game_id, ply, san, uci, fen_after, by_user, time_ms, ai_loss_cp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(game.id, ply, move.san, uci, chess.fen(), byUser ? 1 : 0, timeMs, aiLoss);
  db.prepare('UPDATE games SET fen = ?, pgn = ?, move_count = ? WHERE id = ?').run(chess.fen(), chess.pgn(), ply, game.id);
  if (clock) db.prepare('UPDATE games SET user_time_ms = ?, user_turn_since = ? WHERE id = ?').run(clock.user_time_ms, clock.user_turn_since, game.id);
});

function terminationOf(chess) {
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isThreefoldRepetition()) return 'repetition';
  if (chess.isInsufficientMaterial()) return 'insufficient';
  if (chess.isDrawByFiftyMoves()) return 'fifty';
  return null;
}

// Libellé lisible de la personnalité de l'IA pour cette partie
export function personaLabel(p) {
  const traits = [];
  if (p.aggression >= 1.12) traits.push('offensive'); else if (p.aggression <= 0.88) traits.push('prudente');
  if (p.blunderMul >= 1.25) traits.push('étourdie'); else if (p.blunderMul <= 0.75) traits.push('solide');
  if (p.temperatureMul >= 1.2) traits.push('imprévisible'); else if (p.temperatureMul <= 0.8) traits.push('posée');
  return traits.length ? traits.join(', ') : 'équilibrée';
}

// Personnalité de la partie ; une valeur absente ou invalide (anciennes parties) est
// tirée une fois puis persistée, pour rester stable sur toute la partie.
function personaOf(game) {
  let p = null;
  try { p = validPersona(JSON.parse(game.ai_profile)); } catch { /* 'human' ou JSON invalide */ }
  if (p) return p;
  p = newPersona();
  db.prepare('UPDATE games SET ai_profile = ? WHERE id = ?').run(JSON.stringify(p), game.id);
  game.ai_profile = JSON.stringify(p);
  return p;
}

// Fait jouer l'IA. Pendant sa réflexion, la partie a pu être terminée (abandon,
// perte au temps) : on relit la partie au retour et on n'écrit rien si elle est close.
async function playAiMove(game, chess) {
  const t0 = Date.now();
  const expectedPly = chess.history().length;
  const history = getMoves(game.id).map(m => m.uci);
  const choice = await chooseMove(chess.fen(), game.ai_elo, { persona: personaOf(game), ply: expectedPly, history });
  if (!choice) throw new Error("L'IA n'a trouvé aucun coup.");

  const fresh = getGame(game.id, game.user_id);
  if (!fresh || fresh.status !== 'ongoing' || fresh.move_count !== expectedPly) return fresh;

  const move = chess.move({ from: choice.move.slice(0, 2), to: choice.move.slice(2, 4), promotion: choice.move[4] });
  // Le trait repasse au joueur : on relance son décompte dans la même transaction
  const clock = fresh.user_time_ms !== null ? { user_time_ms: fresh.user_time_ms, user_turn_since: new Date().toISOString() } : null;
  storeMove(fresh, chess, move, false, Date.now() - t0, choice.loss, clock);

  const term = terminationOf(chess);
  if (term) return finishGame(getGame(game.id, game.user_id), chess, term);
  return getGame(game.id, game.user_id);
}

// Si c'est le trait de l'IA sur une partie en cours (ex. redémarrage du serveur
// pendant sa réflexion), on la fait jouer avant de rendre la partie.
export async function ensureAiMoved(game) {
  if (!game || game.status !== 'ongoing') return game;
  const chess = rebuild(game);
  const aiTurn = (chess.turn() === 'w') !== (game.user_color === 'white');
  return aiTurn ? playAiMove(game, chess) : game;
}

export async function playUserMove(game, { from, to, promotion }) {
  if (game.status !== 'ongoing') throw httpError(409, 'Cette partie est terminée.');
  const chess = rebuild(game);
  const userTurn = (chess.turn() === 'w') === (game.user_color === 'white');
  if (!userTurn) throw httpError(409, "Ce n'est pas votre tour.");

  // Pendule : on constate d'abord une éventuelle perte au temps
  let timeMs = null, clock = null;
  if (game.user_time_ms !== null) {
    const remaining = liveUserTime(game);
    if (remaining <= 0) return flagUser(game, chess);
    timeMs = Date.now() - new Date(game.user_turn_since).getTime();
    const inc = TIME_CONTROLS[game.time_control]?.inc ?? 0;
    clock = { user_time_ms: remaining + inc, user_turn_since: null };
  }

  // Validation du coup AVANT toute écriture (un coup illégal ne touche ni la pendule ni la partie)
  let move;
  try { move = chess.move({ from, to, promotion }); }
  catch { throw httpError(400, 'Coup illégal.'); }
  storeMove(game, chess, move, true, timeMs, null, clock);

  const term = terminationOf(chess);
  if (term) return finishGame(getGame(game.id, game.user_id), chess, term);
  return playAiMove(getGame(game.id, game.user_id), chess);
}

// --- Fin de partie ------------------------------------------------------
export function resign(game) {
  if (game.status !== 'ongoing') throw httpError(409, 'Cette partie est terminée.');
  return finishGame(game, rebuild(game), 'resign');
}

// Le joueur demande la vérification de sa pendule (ou le serveur la constate)
export function checkFlag(game) {
  if (game.status !== 'ongoing' || game.user_time_ms === null) return game;
  if (liveUserTime(game) > 0) return game;
  return flagUser(game, rebuild(game));
}

function flagUser(game, chess) {
  // Perte au temps, sauf si l'IA ne peut plus mater (nulle)
  const aiCanMate = hasMatingMaterial(chess, game.user_color === 'white' ? 'b' : 'w');
  return finishGame(game, chess, aiCanMate ? 'timeout' : 'timeout-draw');
}

function hasMatingMaterial(chess, color) {
  const pieces = chess.board().flat().filter(p => p && p.color === color && p.type !== 'k').map(p => p.type);
  if (pieces.some(t => t === 'q' || t === 'r' || t === 'p')) return true;
  if (pieces.filter(t => t === 'b').length >= 2) return true;
  if (pieces.includes('b') && pieces.includes('n')) return true;
  if (pieces.filter(t => t === 'n').length >= 2) return true;
  return false;
}

function finishGame(game, chess, termination) {
  const userIsWhite = game.user_color === 'white';
  const sideToMove = chess.turn(); // camp qui subit le mat / qui abandonne
  let result, userScore;

  if (termination === 'checkmate') {
    result = sideToMove === 'w' ? '0-1' : '1-0';
  } else if (termination === 'resign' || termination === 'timeout') {
    result = userIsWhite ? '0-1' : '1-0';
  } else {
    result = '1/2-1/2';
  }
  userScore = result === '1/2-1/2' ? 0.5 : (result === '1-0') === userIsWhite ? 1 : 0;

  const plies = chess.history().length;
  const rated = isRatable({ termination, plies });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(game.user_id);
  const now = new Date().toISOString();
  const duration = Math.round((Date.now() - new Date(game.started_at).getTime()) / 1000);

  let finished = game;
  db.transaction(() => {
    // Idempotence : si la partie a déjà été close entre-temps, on ne touche à rien
    const closed = db.prepare("UPDATE games SET status = 'finished', user_turn_since = NULL WHERE id = ? AND status = 'ongoing'").run(game.id);
    if (closed.changes !== 1) { finished = getGame(game.id, game.user_id); return; }
    let eloAfter = null, delta = null;
    if (rated) {
      const r = computeNewElo(user.elo, game.ai_elo, userScore, user.rated_games);
      eloAfter = r.after; delta = r.delta;
      const ratedGames = user.rated_games + 1;
      db.prepare('UPDATE users SET elo = ?, peak_elo = MAX(peak_elo, ?), rated_games = ? WHERE id = ?')
        .run(eloAfter, eloAfter, ratedGames, user.id);
      db.prepare(`INSERT INTO rating_history (user_id, game_id, elo_before, elo_after, delta, provisional, reason)
                  VALUES (?, ?, ?, ?, ?, ?, 'game')`)
        .run(user.id, game.id, user.elo, eloAfter, delta, isProvisional(ratedGames) ? 1 : 0);
    }
    db.prepare(`UPDATE games SET status = 'finished', result = ?, termination = ?, user_score = ?, rated = ?,
                                 elo_after = ?, elo_delta = ?, finished_at = ?, duration_s = ?, user_turn_since = NULL
                WHERE id = ?`)
      .run(result, termination, userScore, rated ? 1 : 0, eloAfter, delta, now, duration, game.id);
    finished = getGame(game.id, game.user_id);
  })();

  return finished;
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
