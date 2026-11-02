// IA adverse simulant un joueur humain d'un niveau Elo donné.
//
// Principe (cahier des charges, section 5) :
//  1. Stockfish évalue les N meilleurs coups à une profondeur limitée par l'Elo :
//     une IA faible « ne voit pas loin ».
//  2. Chaque coup reçoit une probabilité décroissante avec son écart au meilleur
//     coup (softmax), pondérée par son « naturel » pour un humain (prise, échec,
//     développement…). La température est d'autant plus haute que l'Elo est bas.
//  3. Des erreurs humaines sont injectées à une fréquence liée au niveau :
//     gaffe plausible (coup naturel qui perd du matériel), mat en 1 manqué,
//     prise gratuite non vue. Jamais de coup absurde : la perte est bornée.
//  4. Cohérence : chaque partie tire une « personnalité » (plus ou moins
//     aventureuse) qui module ces paramètres pour toute la partie.
//  5. Ouverture : les premiers coups favorisent le développement de principe.
//
// Tous les paramètres sont regroupés dans `paramsForElo` pour la calibration
// (scripts/calibrate.mjs).

import { Chess } from 'chess.js';
import { analyse, score } from './stockfish.js';

export const AI_MIN_ELO = 400;
export const AI_MAX_ELO = 2200;
const OPENING_PLIES = 16;      // 8 coups de chaque camp
const NO_BLUNDER_PLIES = 4;    // pas de gaffe injectée dans les tout premiers coups
const ENDGAME_PIECES = 7;      // à partir de ce nombre de pièces (rois compris), on est en finale technique
const ENDGAME_MIN_DEPTH = 12;  // profondeur minimale en finale : savoir mater avec une dame ou une tour
const BARE_ENDGAME_DEPTH = 16; // ≤ 4 pièces (ex. T+R contre R) : la technique de mat demande plus de calcul

const clamp01 = t => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * clamp01(t);
// Interpolation sur des points (elo, valeur) triés
function curve(points, elo) {
  if (elo <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (elo <= points[i][0]) {
      const [e0, v0] = points[i - 1], [e1, v1] = points[i];
      return lerp(v0, v1, (elo - e0) / (e1 - e0));
    }
  }
  return points[points.length - 1][1];
}

// ---------------------------------------------------------------------------
// Paramètres par niveau
// ---------------------------------------------------------------------------
export function paramsForElo(eloIn) {
  const elo = Math.max(AI_MIN_ELO, Math.min(AI_MAX_ELO, eloIn));
  return {
    elo,
    // Profondeur fractionnaire : 3,4 = profondeur 3 (60 %) ou 4 (40 %), tirée à chaque coup,
    // pour une force qui varie en continu avec l'Elo (pas de marche d'escalier).
    depth: curve([[400, 3], [600, 3], [800, 3], [1000, 3.2], [1200, 3.4], [1400, 3.7], [1600, 4.1], [1800, 4.7], [2000, 5.2], [2200, 6.2]], elo),
    multipv: 10,
    // Température du softmax (centipions) : plus haute = choix plus aléatoire
    temperature: curve([[400, 240], [600, 215], [800, 195], [1000, 175], [1200, 158], [1400, 142], [1600, 125], [1800, 105], [2000, 92], [2200, 60]], elo),
    // Perte maximale acceptée pour un coup « normal » (hors gaffe injectée)
    maxLoss: curve([[400, 550], [600, 500], [800, 455], [1000, 415], [1200, 380], [1400, 345], [1600, 310], [1800, 270], [2000, 230], [2200, 160]], elo),
    // Probabilité par coup d'une gaffe plausible (pièce en prise, échange perdant…)
    blunderRate: curve([[400, 0.17], [600, 0.145], [800, 0.125], [1000, 0.107], [1200, 0.092], [1400, 0.078], [1600, 0.065], [1800, 0.052], [2000, 0.042], [2200, 0.025]], elo),
    // Perte minimale / maximale d'une gaffe injectée (centipions)
    blunderMinLoss: 120,
    blunderMaxLoss: curve([[400, 900], [800, 700], [1200, 450], [1600, 320], [2000, 220], [2200, 180]], elo),
    // Probabilité de rater un mat en 1
    mateMissRate: curve([[400, 0.35], [600, 0.3], [800, 0.26], [1000, 0.22], [1200, 0.18], [1400, 0.14], [1600, 0.1], [1800, 0.06], [2000, 0.035], [2200, 0.015]], elo),
    // Probabilité de ne pas voir une prise gratuite (meilleur coup = prise nettement gagnante)
    freeCaptureMissRate: curve([[400, 0.3], [600, 0.26], [800, 0.22], [1000, 0.18], [1200, 0.14], [1400, 0.1], [1600, 0.07], [1800, 0.04], [2000, 0.025], [2200, 0.01]], elo),
  };
}

// Personnalité d'une partie : modulations stables tirées à la création
const DEFAULT_PERSONA = { temperatureMul: 1, blunderMul: 1, aggression: 1 };
const PERSONA_BOUNDS = { temperatureMul: [0.7, 1.4], blunderMul: [0.6, 1.6], aggression: [0.7, 1.3] };

// Valide une personnalité lue en base ; renvoie null si elle est inexploitable
export function validPersona(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(PERSONA_BOUNDS)) {
    const v = Number(p[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) return null;
    out[k] = v;
  }
  return out;
}

export function newPersona(rng = Math.random) {
  const gauss = () => (rng() + rng() + rng() + rng() - 2) / 2 * 0.9; // ≈ N(0, 0.3) borné
  return {
    temperatureMul: Math.max(0.7, Math.min(1.4, 1 + gauss() * 0.5)),   // 0.7 (posé) … 1.4 (brouillon)
    blunderMul: Math.max(0.6, Math.min(1.6, 1 + gauss() * 0.7)),       // 0.6 (solide) … 1.6 (étourdi)
    aggression: Math.max(0.7, Math.min(1.3, 1 + gauss() * 0.5)),       // goût pour prises / échecs
  };
}

// ---------------------------------------------------------------------------
// Naturel d'un coup pour un humain (facteur multiplicatif ≈ 0.5 … 2)
// ---------------------------------------------------------------------------
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function naturalness(chess, move, ply, persona) {
  let s = 0;
  const opening = ply < OPENING_PLIES;
  const homeRank = chess.turn() === 'w' ? '1' : '8';

  if (move.captured) s += 0.35 * persona.aggression + 0.08 * PIECE_VALUE[move.captured];
  if (move.san.includes('+') || move.san.includes('#')) s += 0.2 * persona.aggression;
  if (move.promotion) s += 0.3;
  if (move.flags.includes('k') || move.flags.includes('q')) s += opening ? 0.5 : 0.3; // roque

  if (opening) {
    if ((move.piece === 'n' || move.piece === 'b') && move.from[1] === homeRank) s += 0.35;   // développement
    if (move.piece === 'p' && 'de'.includes(move.from[0])) s += 0.25;                         // pion central
    if (move.piece === 'p' && 'ah'.includes(move.from[0])) s -= 0.35;                         // pion de bord
    if (move.piece === 'q' && ply < 10) s -= 0.3;                                             // sortie de dame précoce
    if (move.piece === 'r' && !move.captured) s -= 0.3;
    if (move.piece === 'k' && !move.flags.includes('k') && !move.flags.includes('q')) s -= 0.5;
    if (move.piece === 'n' && 'ah'.includes(move.to[0])) s -= 0.3;                            // cavalier au bord
  } else {
    if ((move.piece === 'n' || move.piece === 'b') && move.to[1] === homeRank && !move.captured) s -= 0.15; // retour passif
  }
  return Math.exp(Math.max(-1.2, Math.min(1.2, s)));
}

// ---------------------------------------------------------------------------
// Sélection du coup
// ---------------------------------------------------------------------------
// Score comparable en centipions : les mats sont ordonnés (M1 > M2 > … > +1500 > … > −1500 > … > M−2 > M−1)
export function cpOf(line) {
  if (line.mate !== null && line.mate !== undefined && line.mate !== 0) {
    return line.mate > 0 ? 2000 - 20 * Math.min(line.mate, 20) : -2000 + 20 * Math.min(-line.mate, 20);
  }
  return Math.max(-1500, Math.min(1500, line.cp ?? 0));
}

function weightedPick(items, weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return items[0];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

export const pieceCount = (chess) => chess.board().flat().filter(Boolean).length;
export const isEndgame = (chess) => pieceCount(chess) <= ENDGAME_PIECES;

// Clé de position pour la répétition (sans compteurs de coups)
export const positionKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

// Le coup dépose-t-il une dame ou une tour en prise d'une pièce de moindre valeur ?
function hangsMajorPiece(chess, move) {
  if (move.piece !== 'q' && move.piece !== 'r') return false;
  const after = new Chess(chess.fen());
  after.move(move.san);
  const attackers = after.moves({ verbose: true }).filter(m => m.to === move.to);
  if (!attackers.length) return false;
  const cheapest = Math.min(...attackers.map(m => PIECE_VALUE[m.piece] || 0));
  return cheapest < PIECE_VALUE[move.piece];
}

// La pièce capturée était-elle « gratuite » (non défendue) ?
function captureIsFree(chess, move) {
  const after = new Chess(chess.fen());
  after.move(move.san);
  return !after.moves({ verbose: true }).some(m => m.to === move.to);
}

/**
 * pickMove(fen, lines, params, persona, ply, rng, ctx)
 *  lines : candidats évalués par Stockfish (triés du meilleur au pire)
 *  ctx   : { lastMoveTo, seen } — case du dernier coup adverse (reprises) et
 *          positions déjà vues (Map clé → nombre d'occurrences) pour la répétition
 *  Renvoie { move, loss, reason } où reason ∈ 'normal' | 'blunder' | 'missed-mate' | 'missed-capture' | 'mating'
 */
export function pickMove(fen, lines, params, persona, ply, rng = Math.random, ctx = {}) {
  if (!lines.length) return null;
  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true });
  const legal = new Map(legalMoves.map(m => [m.from + m.to + (m.promotion || ''), m]));
  const best = cpOf(lines[0]);
  const endgame = isEndgame(chess);
  let cands = lines
    .filter(l => legal.has(l.move))
    .map(l => ({ line: l, move: l.move, loss: best - cpOf(l), nat: naturalness(chess, legal.get(l.move), ply, persona) }));
  if (!cands.length) {
    const m = legalMoves[0];
    return { move: m.from + m.to + (m.promotion || ''), loss: 0, reason: 'normal' };
  }

  let reason = 'normal';
  const top = cands[0];
  const topMove = legal.get(top.move);

  // 0. Mat forcé en 2 à 8 coups : un humain qui l'a vu le joue. Probabilité de le voir
  //    décroissante avec la longueur et le niveau (jamais de mat en 1 ici, traité en 1.).
  const mateIn = lines[0].mate;
  if (mateIn >= 2 && mateIn <= 8 && rng() >= Math.min(0.9, params.mateMissRate * mateIn)) {
    return { move: top.move, loss: 0, reason: 'mating' };
  }

  // 1. Mat en 1 manqué
  if (mateIn === 1 && cands.length > 1 && rng() < params.mateMissRate) {
    const without = cands.filter(c => c.line.mate !== 1);
    if (without.length) { cands = without; reason = 'missed-mate'; }
  }

  // 2. Prise gratuite non vue : le meilleur coup capture une pièce NON défendue (une reprise
  //    après une prise adverse n'est jamais « oubliée ») et domine nettement le second ;
  //    le coup de repli reste dans la fourchette des pertes plausibles.
  if (reason === 'normal' && topMove?.captured && cands.length > 1 && cands[1].loss >= 150
      && topMove.to !== ctx.lastMoveTo && captureIsFree(chess, topMove)
      && rng() < params.freeCaptureMissRate) {
    const alt = cands.slice(1).filter(c => c.loss <= params.blunderMaxLoss);
    if (alt.length) { cands = alt; reason = 'missed-capture'; }
  }

  // 3. Gaffe plausible : un coup naturel qui perd du matériel, dans une fourchette bornée.
  //    Exclus : coups de roi hors roque, coups qui déposent dame/tour en prise d'une pièce
  //    moins chère (don « absurde »). Les petites pertes sont plus probables que les grosses.
  //    Une reprise évidente (dernier coup adverse = prise, reprendre domine nettement) n'est
  //    presque jamais oubliée, même par un débutant.
  const forcedRecapture = topMove?.captured && topMove.to === ctx.lastMoveTo && cands.length > 1 && cands[1].loss >= 150;
  const blunderP = params.blunderRate * persona.blunderMul * (forcedRecapture ? 0.15 : 1);
  if (reason === 'normal' && !endgame && ply >= NO_BLUNDER_PLIES && rng() < blunderP) {
    const pool = cands.filter(c => {
      if (c.loss < params.blunderMinLoss || c.loss > params.blunderMaxLoss) return false;
      const m = legal.get(c.move);
      if (m.piece === 'k' && !m.flags.includes('k') && !m.flags.includes('q')) return false;
      if (hangsMajorPiece(chess, m)) return false;
      return c.nat >= 0.9;
    });
    if (pool.length) {
      const pick = weightedPick(pool, pool.map(c => c.nat * Math.exp(-(c.loss - params.blunderMinLoss) / 250)), rng);
      return { move: pick.move, loss: pick.loss, reason: 'blunder' };
    }
  }

  // 4. Choix « normal » : softmax sur l'écart au meilleur coup, pondéré par le naturel.
  //    En finale technique, moins d'errance (on joue « à plan »).
  //    Finale clairement gagnée : on convertit avec méthode (peu d'aléa, pertes faibles).
  const winningEndgame = endgame && best > 500;
  const T = params.temperature * persona.temperatureMul * (winningEndgame ? 0.25 : endgame ? 0.5 : 1);
  const maxLoss = forcedRecapture ? Math.min(params.maxLoss, 100) : winningEndgame ? Math.min(params.maxLoss, 80) : params.maxLoss;
  const pool = cands.filter(c => c.loss <= maxLoss);
  const list = pool.length ? pool : [cands[0]];
  const weights = list.map(c => {
    let w = Math.exp(-c.loss / T) * c.nat;
    // Répétition : on l'évite en position gagnante, on la cherche en position perdante
    if (ctx.seen?.size) {
      const after = new Chess(fen); after.move(legal.get(c.move).san);
      const times = ctx.seen.get(positionKey(after.fen())) || 0;
      if (times >= 1) {
        if (best > 150) w *= times >= 2 ? 0.02 : 0.25;
        else if (best < -150) w *= 3;
      }
    }
    return w;
  });
  const pick = weightedPick(list, weights, rng);
  return { move: pick.move, loss: pick.loss, reason };
}

export function rollDepth(depth, rng = Math.random) {
  const lo = Math.floor(depth);
  return rng() < depth - lo ? lo + 1 : lo;
}

// Positions déjà vues à partir de l'historique des coups UCI (pour la répétition)
export function seenPositions(history, startFen = null) {
  const chess = startFen && startFen !== 'startpos' ? new Chess(startFen) : new Chess();
  const seen = new Map();
  const bump = () => { const k = positionKey(chess.fen()); seen.set(k, (seen.get(k) || 0) + 1); };
  bump();
  for (const uci of history) {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    bump();
  }
  return seen;
}

/**
 * Choisit le coup de l'IA pour la position `fen` au niveau `elo`.
 *  history : coups UCI depuis le début de la partie (permet au moteur de voir les
 *            répétitions et à l'IA de les éviter ou de les chercher)
 *  startFen : position de départ de `history` ('startpos' par défaut)
 */
export async function chooseMove(fen, elo, { persona = newPersona(), ply = 0, rng = Math.random, history = null, startFen = 'startpos' } = {}) {
  const params = paramsForElo(elo);
  const chess = new Chess(fen);
  let depth = rollDepth(params.depth, rng);
  if (isEndgame(chess)) depth = Math.max(depth, pieceCount(chess) <= 4 ? BARE_ENDGAME_DEPTH : ENDGAME_MIN_DEPTH);
  const opts = { depth, multipv: params.multipv, movetime: 4000 };
  const pos = history ? { fen: startFen, moves: history } : { fen };
  let result;
  try { result = await analyse(pos.fen, { ...opts, moves: pos.moves }); }
  catch { result = await analyse(pos.fen, { ...opts, moves: pos.moves }); } // un moteur neuf est recréé
  const { lines, bestMove } = result;
  if (!lines.length) return bestMove ? { move: bestMove, loss: 0, reason: 'normal' } : null;
  const ctx = {
    lastMoveTo: history?.length ? history[history.length - 1].slice(2, 4) : undefined,
    seen: history ? seenPositions(history, startFen) : undefined,
  };
  const pick = pickMove(fen, lines, params, persona, ply, rng, ctx);
  return { ...pick, bestMove: lines[0].move, depth };
}
