// Analyse automatique des parties (cahier des charges, section 7).
//
//  - Chaque position de la partie est évaluée par Stockfish à profondeur fixe.
//  - Chaque coup reçoit une perte (centipions, point de vue du camp qui joue) et
//    une étiquette : meilleur, bon, imprécision, erreur, gaffe.
//  - Les erreurs du joueur sont rattachées à des motifs (pièce en prise, mat manqué,
//    fourchette, menace ignorée…) et à une catégorie de faiblesse (Phase 4).
//  - Un rapport de partie (précision, moments décisifs, meilleurs coups, forces,
//    faiblesses, recommandations) est produit et stocké en JSON.
//
// Les fonctions pures (évaluation, étiquetage, motifs) sont exportées pour les tests ;
// `runAnalysis` orchestre le tout, et une file d'attente en arrière-plan sert les parties.

import { Chess } from 'chess.js';
import { db } from '../db.js';
import { analyse, waitingRequests } from '../engine/stockfish.js';

export const ANALYSIS_DEPTH = Number(process.env.ANALYSIS_DEPTH || 14);
const MOVETIME_MS = Number(process.env.ANALYSIS_MOVETIME_MS || 1500);
const MATE_BASE = 10_000;
const PIECE_VALUE = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
const PIECE_FR = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };

// ---------------------------------------------------------------------------
// Évaluations
// ---------------------------------------------------------------------------
// Ligne UCI (point de vue du camp au trait) → score point de vue des blancs.
// Mats : ±(10000 − N) pour rester ordonnés et distincts des centipions.
export function toWhiteCp(line, turn) {
  let v;
  if (line.mate !== null && line.mate !== undefined && line.mate !== 0) v = line.mate > 0 ? MATE_BASE - line.mate : -MATE_BASE - line.mate;
  else v = line.cp ?? 0;
  return turn === 'w' ? v : -v;
}
export const isMateScore = (cp) => Math.abs(cp) > MATE_BASE - 100;
export const mateIn = (cp) => (isMateScore(cp) ? (cp > 0 ? MATE_BASE - cp : -(MATE_BASE + cp)) : null); // signé : + les blancs matent (0 = mat délivré, signe perdu)
// Camp qui mate (+1 blancs, −1 noirs, 0 aucun) : fiable même pour un mat déjà délivré
export const mateSide = (cp) => (isMateScore(cp) ? Math.sign(cp) : 0);

// Perte d'un coup pour le camp qui le joue, bornée à 1000 cp (les mats comptent 1000)
export function lossFor(evalBefore, evalAfter, mover) {
  const sign = mover === 'w' ? 1 : -1;
  const clamp = (v) => Math.max(-1000, Math.min(1000, isMateScore(v) ? Math.sign(v) * 1000 : v));
  return Math.max(0, clamp(evalBefore * sign) - clamp(evalAfter * sign));
}

// Étiquette d'un coup à partir de la chute de probabilité de gain (0-1, seuils Lichess)
// — une perte de 2 pions dans une position déjà gagnée (+25) n'est pas une gaffe.
export function labelFor(drop, { playedIsBest = false, missedMate = false, allowedMate = false } = {}) {
  let label;
  if (playedIsBest || drop <= 0.005) label = 'best';
  else if (drop < 0.10) label = 'good';
  else if (drop < 0.20) label = 'inaccuracy';
  else if (drop < 0.30) label = 'mistake';
  else label = 'blunder';
  const rank = { best: 0, good: 1, inaccuracy: 2, mistake: 3, blunder: 4 };
  if (missedMate && rank[label] < rank.mistake) label = 'mistake';   // mat raté mais position encore gagnante
  if (allowedMate && rank[label] < rank.mistake) label = 'mistake';
  return label;
}

// Chute de probabilité de gain pour le camp qui joue (0-1)
export function winDrop(evalBefore, evalAfter, mover) {
  const sign = mover === 'w' ? 1 : -1;
  return Math.max(0, (winProb(evalBefore) - winProb(evalAfter)) * sign);
}

// Probabilité de gain (0-1, point de vue des blancs), formule Lichess
export function winProb(cpWhite) {
  const v = isMateScore(cpWhite) ? Math.sign(cpWhite) * 1500 : Math.max(-1500, Math.min(1500, cpWhite));
  return 0.5 + 0.5 * (2 / (1 + Math.exp(-0.00368208 * v)) - 1);
}

// Précision d'un coup (0-100) à partir de la baisse de probabilité de gain en points, formule Lichess
export function moveAccuracy(winBefore, winAfter, mover) {
  const sign = mover === 'w' ? 1 : -1;
  const drop = Math.max(0, (winBefore - winAfter) * sign * 100);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));
}

// ---------------------------------------------------------------------------
// Motifs d'erreur
// ---------------------------------------------------------------------------
export const MOTIFS = {
  'hanging-piece':   { category: 'material',    fr: 'pièce laissée en prise' },
  'missed-capture':  { category: 'tactics',     fr: 'prise gratuite manquée' },
  'missed-mate':     { category: 'calculation', fr: 'mat manqué' },
  'allowed-mate':    { category: 'defense',     fr: 'mat encaissé' },
  'allowed-fork':    { category: 'threats',     fr: 'fourchette subie' },
  'missed-fork':     { category: 'tactics',     fr: 'fourchette manquée' },
  'ignored-threat':  { category: 'threats',     fr: 'menace ignorée' },
  'bad-exchange':    { category: 'material',    fr: 'mauvais échange' },
  'slow-development':{ category: 'openings',    fr: 'développement négligé' },
  'king-safety':     { category: 'defense',     fr: 'sécurité du roi' },
  'endgame-technique':{ category: 'endgames',   fr: 'technique de finale' },
  'calculation':     { category: 'calculation', fr: 'erreur de calcul' },
  'positional':      { category: 'strategy',    fr: 'erreur stratégique' },
  'development':     { category: 'openings',    fr: 'ouverture' },
};
export const CATEGORIES_FR = {
  tactics: 'Tactique', calculation: 'Calcul', strategy: 'Stratégie', openings: 'Ouvertures',
  endgames: 'Finales', defense: 'Défense', material: 'Gestion du matériel', threats: 'Reconnaissance des menaces',
};

const other = (c) => (c === 'w' ? 'b' : 'w');
const pieceCount = (chess) => chess.board().flat().filter(Boolean).length;

// Attaquant le moins cher d'une case pour une couleur ; le roi ne compte que si la case n'est pas défendue
function cheapestAttacker(chess, square, color, defended = false) {
  const vals = chess.attackers(square, color)
    .map(s => chess.get(s)?.type || 'k')
    .filter(t => !(t === 'k' && defended))
    .map(t => (t === 'k' ? 10_000 : PIECE_VALUE[t]));
  return vals.length ? Math.min(...vals) : null;
}

// Une pièce de `color` sur `square` est-elle « en prise » (attaquée et non défendue, ou attaquée par moins cher) ?
export function isHanging(chess, square, color) {
  const piece = chess.get(square);
  if (!piece || piece.color !== color || piece.type === 'k') return false;
  const defended = chess.attackers(square, color).length > 0;
  const att = cheapestAttacker(chess, square, other(color), defended);
  if (att === null) return false;
  return !defended || att < PIECE_VALUE[piece.type];
}

// Cases des pièces de `color` (hors roi) attaquées par la pièce de `from`
function targetsOf(chess, from, color) {
  const out = [];
  for (const row of chess.board()) for (const p of row) {
    if (p && p.color === color && p.square !== from && chess.attackers(p.square, other(color)).includes(from)) out.push(p);
  }
  return out;
}

// Le coup `uci` (joué par le camp au trait de `chess`) crée-t-il une fourchette ?
export function isFork(chess, uci) {
  const c = new Chess(chess.fen());
  let m;
  try { m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return false; }
  if (!m) return false;
  // La pièce fourchante doit survivre, et les victimes valoir la peine (pas de simples pions)
  if (isHanging(c, m.to, m.color)) return false;
  const victims = targetsOf(c, m.to, other(m.color))
    .filter(p => p.type !== 'p')
    .filter(p => p.type === 'k' || PIECE_VALUE[p.type] > PIECE_VALUE[m.piece] || isHanging(c, p.square, p.color));
  return victims.length >= 2;
}

// Position identique avec le trait à l'adversaire (pour savoir ce qu'il menaçait)
function withTurn(chess, color) {
  const parts = chess.fen().split(' ');
  parts[1] = color; parts[3] = '-';
  try { return new Chess(parts.join(' ')); } catch { return null; }
}

// Valeur nette d'un échange sur la case de `move` (approximation : prise − reprise la moins chère)
function exchangeBalance(chessBefore, move) {
  if (!move.captured) return 0;
  const after = new Chess(chessBefore.fen()); after.move(move.san);
  const recapture = cheapestAttacker(after, move.to, other(move.color));
  const gained = PIECE_VALUE[move.captured];
  return recapture === null ? gained : gained - PIECE_VALUE[move.piece];
}

/**
 * detectMotifs : motifs d'une erreur du joueur (loss ≥ 30 en général).
 *  chessBefore : position avant le coup ; move : coup joué (verbose chess.js)
 *  bestUci : meilleur coup de la position ; replyUci : meilleure réponse adverse après le coup
 *  evalBefore / evalAfter : point de vue des blancs ; ply : numéro du demi-coup (1 = premier coup blanc)
 */
export function detectMotifs({ chessBefore, move, bestUci, replyUci, evalBefore, evalAfter, loss, ply }) {
  const motifs = [];
  const me = move.color;
  const sign = me === 'w' ? 1 : -1;
  const after = new Chess(chessBefore.fen()); after.move(move.san);

  // Mat manqué / mat encaissé
  const mAfter = mateIn(evalAfter);
  const sideBefore = mateSide(evalBefore), sideAfter = mateSide(evalAfter);
  if (sideBefore === sign && sideAfter !== sign) motifs.push('missed-mate');
  if (sideAfter === -sign && Math.abs(mAfter) <= 5 && sideBefore !== -sign && winProb(evalBefore) * sign + (sign < 0 ? 1 : 0) >= 0.1) motifs.push('allowed-mate');
  if (motifs.length) return motifs;
  if (loss < 30) return motifs;

  // Réponse adverse : prise d'une pièce en prise / fourchette
  const reply = replyUci ? after.moves({ verbose: true }).find(m => m.from + m.to + (m.promotion || '') === replyUci) : null;
  if (reply?.captured && loss >= 90) {
    const victimSquare = reply.to;
    if (isHanging(after, victimSquare, me)) {
      // Menace préexistante ignorée, ou pièce fraîchement déposée en prise ?
      const beforeFlipped = withTurn(chessBefore, other(me));
      const threatened = beforeFlipped && victimSquare !== move.to && chessBefore.get(victimSquare)?.color === me
        && isHanging(chessBefore, victimSquare, me)
        && beforeFlipped.moves({ verbose: true }).some(m => m.to === victimSquare && m.captured);
      motifs.push(threatened ? 'ignored-threat' : 'hanging-piece');
    }
  }
  if (replyUci && loss >= 90 && isFork(after, replyUci) && !motifs.includes('hanging-piece')) motifs.push('allowed-fork');

  // Meilleur coup manqué : prise gratuite, fourchette
  if (bestUci && loss >= 90) {
    const best = chessBefore.moves({ verbose: true }).find(m => m.from + m.to + (m.promotion || '') === bestUci);
    if (best?.captured && isHanging(chessBefore, best.to, other(me))) motifs.push('missed-capture');
    else if (isFork(chessBefore, bestUci)) motifs.push('missed-fork');
  }

  // Mauvais échange
  if (move.captured && loss >= 60 && exchangeBalance(chessBefore, move) < -100) motifs.push('bad-exchange');

  if (motifs.length) return motifs;

  // Suite tactique manquée (le meilleur coup était une prise ou un échec nettement supérieur)
  if (bestUci && loss >= 150) {
    const best = chessBefore.moves({ verbose: true }).find(m => m.from + m.to + (m.promotion || '') === bestUci);
    if (best && (best.captured || best.san.includes('+'))) { motifs.push('calculation'); return motifs; }
  }

  // Phases de jeu
  const pieces = pieceCount(after);
  if (pieces <= 10 && loss >= 60) motifs.push('endgame-technique');
  else if (ply <= 20) {
    const developing = ['n', 'b'].includes(move.piece) || move.san.startsWith('O-O') || (move.piece === 'p' && 'cde'.includes(move.from[0]));
    motifs.push(developing || loss < 60 ? 'development' : 'slow-development');
  } else if (loss >= 90 && move.piece === 'k' && !move.san.startsWith('O-O')) motifs.push('king-safety');
  else if (loss >= 90 && move.piece === 'p' && nearKing(chessBefore, move)) motifs.push('king-safety');
  else if (loss >= 150) motifs.push('calculation');
  else motifs.push('positional');
  return motifs;
}

function nearKing(chess, move) {
  const k = chess.board().flat().find(p => p && p.type === 'k' && p.color === move.color);
  if (!k) return false;
  return Math.abs(k.square.charCodeAt(0) - move.from.charCodeAt(0)) <= 1 && Math.abs(Number(k.square[1]) - Number(move.from[1])) <= 2;
}

// Explication en français
export function explain({ motifs, move, bestSan, loss, label, replySan, mateBefore, mateAfter }) {
  const m = motifs[0];
  const piece = PIECE_FR[move.piece];
  const best = bestSan ? ` Le meilleur coup était ${bestSan}.` : '';
  switch (m) {
    case 'missed-mate': return `Un mat en ${Math.abs(mateBefore)} était disponible.${best}`;
    case 'allowed-mate': return `Ce coup permet un mat en ${Math.abs(mateAfter)}.${best}`;
    case 'hanging-piece': return `${cap(piece)} laissé${move.piece === 'q' || move.piece === 'r' ? 'e' : ''} en prise${replySan ? ` (${replySan})` : ''}.${best}`;
    case 'ignored-threat': return `La menace adverse${replySan ? ` ${replySan}` : ''} n'a pas été parée.${best}`;
    case 'allowed-fork': return `Ce coup permet une fourchette${replySan ? ` (${replySan})` : ''}.${best}`;
    case 'missed-capture': return `Une pièce pouvait être prise gratuitement : ${bestSan}.`;
    case 'missed-fork': return `Une fourchette était possible avec ${bestSan}.`;
    case 'bad-exchange': return `Cet échange perd du matériel.${best}`;
    case 'endgame-technique': return `Imprécision de finale : ${bestSan} conservait l'avantage ou la nulle.`;
    case 'slow-development': return `En ouverture, mieux vaut développer ses pièces et sécuriser le roi.${best}`;
    case 'development': return `Coup d'ouverture imprécis.${best}`;
    case 'king-safety': return `Ce coup affaiblit la sécurité du roi.${best}`;
    case 'calculation': return bestSan ? `Une suite plus forte était disponible : ${bestSan} (${(loss / 100).toFixed(1)} pion${loss >= 200 ? 's' : ''} d'écart).` : `Erreur de calcul (${(loss / 100).toFixed(1)} pions).`;
    case 'positional': return `Coup imprécis sur le plan stratégique.${best}`;
    default: return label === 'best' ? 'Meilleur coup.' : `Perte de ${(loss / 100).toFixed(1)} pion${loss >= 200 ? 's' : ''}.${best}`;
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Analyse complète d'une partie
// ---------------------------------------------------------------------------
export async function evaluatePosition(fen) {
  const { lines, bestMove } = await analyse(fen, { depth: ANALYSIS_DEPTH, multipv: 2, movetime: MOVETIME_MS });
  const chess = new Chess(fen);
  const turn = chess.turn();
  if (!lines.length) {
    // Partie terminée : mat ou pat
    const cp = chess.isCheckmate() ? (turn === 'w' ? -MATE_BASE : MATE_BASE) : 0;
    return { cp, best: null, second: null };
  }
  const main = lines.find(l => l.move === bestMove) || lines[0];
  const alt = lines.find(l => l !== main);
  return {
    cp: toWhiteCp(main, turn),
    best: main.move,
    second: alt ? toWhiteCp(alt, turn) : null,
    legalMoves: chess.moves().length,
  };
}

export async function runAnalysis(analysisId, { onProgress } = {}) {
  const a = db.prepare('SELECT * FROM analyses WHERE id = ?').get(analysisId);
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(a.game_id);
  const moves = db.prepare('SELECT ply, san, uci, by_user FROM moves WHERE game_id = ? ORDER BY ply').all(game.id);
  db.prepare("UPDATE analyses SET status = 'running', progress = 0, engine_depth = ? WHERE id = ?").run(ANALYSIS_DEPTH, analysisId);

  const chess = new Chess();
  const positions = [{ fen: chess.fen() }];
  for (const m of moves) { chess.move(m.san); positions.push({ fen: chess.fen() }); }

  // Évaluation de chaque position
  const evals = [];
  for (let i = 0; i < positions.length; i++) {
    // Les parties en cours ont priorité sur le moteur : on leur laisse la place
    while (waitingRequests() > 0) await new Promise(r => setTimeout(r, 100));
    evals.push(await evaluatePosition(positions[i].fen));
    db.prepare('UPDATE analyses SET progress = ? WHERE id = ?').run(i, analysisId);
    onProgress?.(i, positions.length);
  }

  // Étiquetage de chaque coup
  const userColor = game.user_color === 'white' ? 'w' : 'b';
  const rows = [];
  const insert = db.prepare(`INSERT OR REPLACE INTO move_evals (analysis_id, game_id, ply, by_user, eval_before, eval_after, best_uci, best_san, played_san, loss_cp, label, motifs, explanation)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertErr = db.prepare(`INSERT INTO error_events (user_id, game_id, analysis_id, ply, category, motif, severity, loss_cp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  db.prepare('DELETE FROM error_events WHERE game_id = ?').run(game.id); // une ré-analyse remplace les événements précédents

  const replay = new Chess();
  const tx = db.transaction(() => {
    for (let i = 0; i < moves.length; i++) {
      const before = new Chess(replay.fen());
      const move = replay.move(moves[i].san);
      const mover = move.color;
      const evalBefore = evals[i].cp, evalAfter = evals[i + 1].cp;
      const bestUci = evals[i].best;
      const playedIsBest = bestUci === moves[i].uci;
      const loss = playedIsBest ? 0 : lossFor(evalBefore, evalAfter, mover);
      const mBefore = mateIn(evalBefore), mAfter = mateIn(evalAfter);
      const sign = mover === 'w' ? 1 : -1;
      const sideBefore = mateSide(evalBefore), sideAfter = mateSide(evalAfter);
      const missedMate = sideBefore === sign && sideAfter !== sign && !playedIsBest;
      const allowedMate = sideAfter === -sign && Math.abs(mAfter) <= 5 && sideBefore !== -sign && !playedIsBest
        && (mover === 'w' ? winProb(evalBefore) : 1 - winProb(evalBefore)) >= 0.1;
      const drop = playedIsBest ? 0 : winDrop(evalBefore, evalAfter, mover);
      const label = labelFor(drop, { playedIsBest, missedMate, allowedMate });
      const bestSan = bestUci ? sanOf(before, bestUci) : null;
      const replyUci = evals[i + 1].best;
      const replySan = replyUci ? sanOf(replay, replyUci) : null;
      // Motifs : dès que le coup est imprécis OU qu'il coûte du matériel net, même dans une
      // position déjà décidée (une pièce laissée en prise reste une faiblesse à travailler)
      let motifs = [];
      const material = loss >= 100 && !playedIsBest;
      if ((label !== 'best' && label !== 'good') || material) {
        motifs = detectMotifs({ chessBefore: before, move, bestUci, replyUci, evalBefore, evalAfter, loss, ply: i + 1 });
      }
      // « Seul coup » : le second choix fait chuter nettement les chances, dans une position encore disputée
      const onlyMove = label === 'best' && evals[i].legalMoves > 1 && evals[i].second !== null
        && winDrop(evalBefore, evals[i].second, mover) >= 0.2 && Math.abs(evalBefore) < 500;
      const explanation = label === 'best' ? (onlyMove ? 'Seul bon coup, bien trouvé.' : 'Meilleur coup.')
        : label === 'good' && !motifs.length ? 'Bon coup.'
        : explain({ motifs, move, bestSan, loss, label, replySan, mateBefore: mBefore, mateAfter: mAfter });
      const accuracy = playedIsBest ? 100 : moveAccuracy(winProb(evalBefore), winProb(evalAfter), mover);
      const row = { ply: i + 1, by_user: mover === userColor ? 1 : 0, evalBefore, evalAfter, bestUci, bestSan, playedSan: moves[i].san, loss, label, motifs, explanation, accuracy, onlyMove, mover };
      rows.push(row);
      insert.run(analysisId, game.id, row.ply, row.by_user, evalBefore, evalAfter, bestUci, bestSan, moves[i].san, loss, label, JSON.stringify(motifs), explanation);
      if (row.by_user && motifs.length && (['inaccuracy', 'mistake', 'blunder'].includes(label) || material)) {
        const severity = ['inaccuracy', 'mistake', 'blunder'].includes(label) ? label : loss >= 300 ? 'mistake' : 'inaccuracy';
        for (const motif of motifs) {
          insertErr.run(game.user_id, game.id, analysisId, row.ply, MOTIFS[motif]?.category || 'strategy', motif, severity, loss);
        }
      }
    }
  });
  tx();

  const summary = buildSummary(rows, evals, game);
  db.prepare(`UPDATE analyses SET status = 'done', progress = ?, accuracy_user = ?, accuracy_ai = ?, inaccuracies = ?, mistakes = ?, blunders = ?, acpl_user = ?, summary = ?, finished_at = ? WHERE id = ?`)
    .run(positions.length, summary.accuracy.user, summary.accuracy.ai, summary.counts.user.inaccuracy, summary.counts.user.mistake, summary.counts.user.blunder,
         summary.acpl.user, JSON.stringify(summary), new Date().toISOString(), analysisId);
  return summary;
}

function sanOf(chess, uci) {
  const c = new Chess(chess.fen());
  try { return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })?.san || null; } catch { return null; }
}

// Précision d'une partie pour chaque camp, méthode Lichess : moyenne pondérée par la volatilité
// de la position (les coups dans les positions tendues pèsent plus) combinée à la moyenne harmonique
// (une seule gaffe pèse lourd). Donne des valeurs comparables à celles de Lichess / chess.com,
// contrairement à une simple moyenne qui surestime la précision.
export function gameAccuracy(rows, evals) {
  const wins = evals.map(e => winProb(e.cp) * 100);
  const windowSize = Math.max(2, Math.min(8, Math.floor(wins.length / 10)));
  const std = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
  const windows = [];
  for (let i = 0; i < Math.min(windowSize, wins.length) - 2; i++) windows.push(wins.slice(0, windowSize));
  for (let i = 0; i + windowSize <= wins.length; i++) windows.push(wins.slice(i, i + windowSize));
  const weightAt = (i) => Math.max(0.5, Math.min(12, std(windows[Math.min(i, windows.length - 1)] || wins.slice(0, 2))));
  const out = {};
  for (const k of ['user', 'ai']) {
    const list = rows.map((r, i) => ({ r, i })).filter(({ r }) => (k === 'user') === !!r.by_user);
    if (!list.length) { out[k] = null; continue; }
    const ws = list.map(({ i }) => weightAt(i));
    const weighted = list.reduce((s, { r }, j) => s + r.accuracy * ws[j], 0) / ws.reduce((a, b) => a + b, 0);
    const harmonic = list.length / list.reduce((s, { r }) => s + 1 / Math.max(1, r.accuracy), 0);
    out[k] = Math.round((weighted + harmonic) / 2 * 10) / 10;
  }
  return out;
}

export function buildSummary(rows, evals, game) {
  const sides = { user: rows.filter(r => r.by_user), ai: rows.filter(r => !r.by_user) };
  const acpl = {}, counts = {};
  const accuracy = gameAccuracy(rows, evals);
  for (const [k, list] of Object.entries(sides)) {
    const n = list.length || 1;
    acpl[k] = Math.round(list.reduce((s, r) => s + Math.min(r.loss, 1000), 0) / n);
    if (accuracy[k] === null) accuracy[k] = 0;
    counts[k] = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    for (const r of list) counts[k][r.label]++;
  }

  // Courbe d'évaluation (probabilité de gain blanche par position) et moments décisifs
  const curve = evals.map(e => ({ cp: isMateScore(e.cp) ? Math.sign(e.cp) * 1500 : Math.max(-1500, Math.min(1500, e.cp)), mate: mateIn(e.cp) }));
  const swings = rows.map((r, i) => ({ ply: r.ply, swing: winDrop(evals[i].cp, evals[i + 1].cp, r.mover), by_user: r.by_user, label: r.label, san: r.playedSan, explanation: r.explanation }))
    .filter(s => s.swing >= 0.15).sort((a, b) => b.swing - a.swing).slice(0, 3).sort((a, b) => a.ply - b.ply);

  const userErrors = sides.user.filter(r => ['inaccuracy', 'mistake', 'blunder'].includes(r.label) || (r.motifs.length && r.loss >= 100))
    .sort((a, b) => b.loss - a.loss).slice(0, 5)
    .map(r => ({ ply: r.ply, san: r.playedSan, label: r.label, loss: r.loss, bestSan: r.bestSan, motifs: r.motifs, explanation: r.explanation }));
  const bestMoves = sides.user.filter(r => r.onlyMove).slice(0, 5).map(r => ({ ply: r.ply, san: r.playedSan, explanation: r.explanation }));

  // Forces et faiblesses de la partie par catégorie
  const byCat = {};
  for (const r of sides.user) for (const m of r.motifs) {
    const c = MOTIFS[m]?.category; if (!c) continue;
    byCat[c] = (byCat[c] || 0) + (r.label === 'blunder' ? 3 : r.label === 'mistake' ? 2 : 1);
  }
  const weaknesses = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, score]) => ({ category: c, label: CATEGORIES_FR[c], score }));
  const strengths = [];
  const opening = sides.user.filter(r => r.ply <= 20);
  if (opening.length >= 5 && opening.every(r => r.label === 'best' || r.label === 'good')) strengths.push({ category: 'openings', label: 'Ouverture propre' });
  if (!byCat.material && sides.user.length >= 10) strengths.push({ category: 'material', label: 'Aucune pièce laissée en prise' });
  if (!byCat.threats && sides.user.length >= 10) strengths.push({ category: 'threats', label: 'Menaces adverses bien repérées' });
  if (bestMoves.length >= 2) strengths.push({ category: 'calculation', label: `${bestMoves.length} seuls coups trouvés` });
  if (accuracy.user >= 85) strengths.push({ category: 'tactics', label: 'Grande précision' });

  const recommendations = weaknesses.slice(0, 3).map(w => ({ category: w.category, text: RECO[w.category] }));
  return { accuracy, acpl, counts, curve, decisive: swings, keyErrors: userErrors, bestMoves, strengths, weaknesses, recommendations, depth: ANALYSIS_DEPTH };
}

const RECO = {
  material: 'Avant chaque coup, vérifiez quelles pièces sont attaquées : exercices « pièces non protégées ».',
  threats: 'Demandez-vous ce que l\'adversaire menace : exercices « défense contre les menaces » et « fourchettes ».',
  tactics: 'Travaillez les motifs tactiques : fourchettes, clouages, enfilades.',
  calculation: 'Calculez les suites forcées jusqu\'au bout : exercices de mats en 2 et 3 coups.',
  defense: 'Soignez la sécurité du roi et la défense : exercices « défense » et « mats encaissés ».',
  openings: 'Suivez les principes d\'ouverture : développement, centre, roque avant le 10e coup.',
  endgames: 'Révisez les finales de base : exercices roi et pion, tour, dame contre pion.',
  strategy: 'Choisissez un plan : exercices stratégiques (meilleur plan, cases faibles).',
};

// ---------------------------------------------------------------------------
// File d'attente en arrière-plan
// ---------------------------------------------------------------------------
let running = false;
export function enqueueAnalysis(gameId, userId) {
  if (process.env.ANALYSIS_AUTO === '0') return null; // tests : pas d'analyse en arrière-plan
  const existing = db.prepare("SELECT id, status FROM analyses WHERE game_id = ? ORDER BY id DESC LIMIT 1").get(gameId);
  if (existing && ['pending', 'running'].includes(existing.status)) return existing.id;
  const info = db.prepare('INSERT INTO analyses (game_id, user_id) VALUES (?, ?)').run(gameId, userId);
  setImmediate(() => processQueue().catch(err => console.error('[analysis] file', err)));
  return info.lastInsertRowid;
}

export async function processQueue() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = db.prepare("SELECT id FROM analyses WHERE status = 'pending' ORDER BY id LIMIT 1").get();
      if (!next) break;
      try {
        await runAnalysis(next.id);
        try {
          const { createPuzzlesFromGame, computeWeaknesses } = await import('./training.js');
          const a = db.prepare('SELECT game_id, user_id FROM analyses WHERE id = ?').get(next.id);
          await createPuzzlesFromGame(a.game_id);
          computeWeaknesses(a.user_id);
        } catch (e2) { console.error('[training] exercices personnels', e2); }
      } catch (err) {
        console.error('[analysis] échec', next.id, err);
        try { db.prepare("UPDATE analyses SET status = 'error', error_message = ?, finished_at = ? WHERE id = ?").run(String(err.message || err), new Date().toISOString(), next.id); }
        catch (e2) { console.error('[analysis] impossible de marquer l erreur', e2); break; }
      }
    }
  } finally {
    running = false;
  }
}

// Au démarrage : les analyses interrompues repartent de zéro
export function recoverQueue() {
  db.prepare("UPDATE analyses SET status = 'pending', progress = 0 WHERE status = 'running'").run();
  setImmediate(() => processQueue().catch(err => console.error('[analysis] file', err)));
}

export function getAnalysis(gameId) {
  const a = db.prepare('SELECT * FROM analyses WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(gameId);
  if (!a) return null;
  const out = { id: a.id, status: a.status, progress: a.progress, depth: a.engine_depth, created_at: a.created_at, finished_at: a.finished_at, error: a.error_message };
  if (a.status === 'done') {
    out.summary = JSON.parse(a.summary);
    out.moves = db.prepare('SELECT ply, by_user, eval_before, eval_after, best_uci, best_san, played_san, loss_cp, label, motifs, explanation FROM move_evals WHERE analysis_id = ? ORDER BY ply').all(a.id)
      .map(m => ({ ...m, motifs: JSON.parse(m.motifs || '[]') }));
  }
  return out;
}
