// Génération et vérification d'exercices tactiques (cahier des charges, section 8).
//
// Un exercice = une position + une solution (suite de coups UCI, le joueur joue les
// coups impairs, l'adversaire répond automatiquement) + des thèmes + une difficulté.
//
// Deux sources :
//  - la bibliothèque, générée hors ligne à partir de parties IA contre IA (scripts/build-library.mjs) ;
//  - les parties du joueur : chaque occasion manquée repérée par l'analyse devient un exercice personnel.
//
// Dans les deux cas, Stockfish vérifie à profondeur élevée que la solution est unique
// (le second coup est nettement moins bon) et gagne clairement (mat ou gain net de matériel).

import { Chess } from 'chess.js';
import { analyse } from '../engine/stockfish.js';
import { toWhiteCp, isMateScore, mateIn, winProb, isHanging, isFork } from './analysis.js';

export const VERIFY_DEPTH = Number(process.env.PUZZLE_DEPTH || 16);
const MAX_SOLUTION_PLIES = 9;
const UNIQUENESS_GAP = 120;     // centipions : le second meilleur coup doit être au moins aussi inférieur
const MIN_GAIN = 180;           // centipions : gain minimal de la solution (hors mat)

export const THEMES = {
  'mate-1':            { fr: 'Mat en 1',               category: 'calculation' },
  'mate-2':            { fr: 'Mat en 2',               category: 'calculation' },
  'mate-3':            { fr: 'Mat en 3 et plus',       category: 'calculation' },
  'fork':              { fr: 'Fourchette',             category: 'tactics' },
  'pin':               { fr: 'Clouage',                category: 'tactics' },
  'skewer':            { fr: 'Enfilade',               category: 'tactics' },
  'discovered-attack': { fr: 'Attaque à la découverte',category: 'tactics' },
  'double-attack':     { fr: 'Attaque double',         category: 'tactics' },
  'hanging-piece':     { fr: 'Pièce non protégée',     category: 'material' },
  'material':          { fr: 'Gain de matériel',       category: 'material' },
  'defense':           { fr: 'Défense contre une menace', category: 'defense' },
  'threat':            { fr: 'Reconnaissance des menaces', category: 'threats' },
  'endgame':           { fr: 'Finale',                 category: 'endgames' },
  'promotion':         { fr: 'Promotion',              category: 'endgames' },
  'calculation':       { fr: 'Calcul de variantes',    category: 'calculation' },
  'strategy':          { fr: 'Choix stratégique',      category: 'strategy' },
};

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const other = (c) => (c === 'w' ? 'b' : 'w');
const sqToXY = (s) => [s.charCodeAt(0) - 97, Number(s[1]) - 1];
const xyToSq = (x, y) => String.fromCharCode(97 + x) + (y + 1);
const DIRS = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
DIRS.q = [...DIRS.b, ...DIRS.r];

// Pièces rencontrées le long d'un rayon (au plus deux)
function ray(chess, from, [dx, dy]) {
  let [x, y] = sqToXY(from);
  const out = [];
  for (;;) {
    x += dx; y += dy;
    if (x < 0 || x > 7 || y < 0 || y > 7) break;
    const p = chess.get(xyToSq(x, y));
    if (p) { out.push({ ...p, square: xyToSq(x, y) }); if (out.length === 2) break; }
  }
  return out;
}

// Clouage / enfilade créé par la pièce à `square`
export function pinOrSkewer(chess, square) {
  const p = chess.get(square);
  if (!p || !DIRS[p.type]) return null;
  for (const d of DIRS[p.type]) {
    const [a, b] = ray(chess, square, d);
    if (!a || !b || a.color !== other(p.color) || b.color !== other(p.color)) continue;
    const va = PIECE_VALUE[a.type], vb = PIECE_VALUE[b.type];
    if (b.type === 'p') continue;                        // un pion derrière n'est pas une cible
    if (b.type === 'k' || vb > va) return 'pin';
    if (va > vb && a.type !== 'p') return 'skewer';
  }
  return null;
}

// Pièces ennemies de valeur attaquées par `color`, hors cases données
function attackedValuables(chess, color, excludeSquares = []) {
  const out = [];
  for (const row of chess.board()) for (const q of row) {
    if (!q || q.color === color || q.type === 'p' || excludeSquares.includes(q.square)) continue;
    if (chess.attackers(q.square, color).length) out.push(q.square);
  }
  return out;
}

// Matériel (point de vue des blancs, en pions)
export function material(chess) {
  let m = 0;
  for (const row of chess.board()) for (const q of row) if (q && q.type !== 'k') m += (q.color === 'w' ? 1 : -1) * PIECE_VALUE[q.type];
  return m;
}

/**
 * Thèmes d'une solution : `fen` position de départ, `solution` coups UCI (le joueur joue les coups 0, 2, 4…).
 * Les motifs sont cherchés sur chacun des coups du joueur (la pointe peut venir au 2e ou 3e coup).
 */
export function detectThemes(fen, solution, { mate = null } = {}) {
  const themes = new Set();
  const start = new Chess(fen);
  const me = start.turn();
  const threatenedAtStart = start.board().flat().filter(q => q && q.color === me && q.type !== 'k' && isHanging(start, q.square, me)).map(q => q.square);
  const first = solution[0];
  const firstMove = new Chess(fen).move({ from: first.slice(0, 2), to: first.slice(2, 4), promotion: first[4] });

  if (mate !== null) themes.add(mate === 1 ? 'mate-1' : mate === 2 ? 'mate-2' : 'mate-3');

  const pos = new Chess(fen);
  for (let i = 0; i < solution.length; i++) {
    const uci = solution[i];
    const before = new Chess(pos.fen());
    const mv = pos.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (i % 2 === 1) continue; // coup adverse
    if (mv.promotion) themes.add('promotion');
    if (mate === 1 && i === 0) continue;
    if (isFork(before, uci)) themes.add('fork');
    const ps = pinOrSkewer(pos, mv.to);
    if (ps && !isHanging(pos, mv.to, me)) themes.add(ps);
    // Attaque à la découverte : une autre pièce du joueur attaque une pièce de valeur qu'elle n'attaquait pas avant (hors roque)
    if (!mv.san.startsWith('O-O')) {
      const was = attackedValuables(before, me);
      const now = attackedValuables(pos, me, [mv.to]).filter(sq => !was.includes(sq));
      if (now.some(sq => pos.attackers(sq, me).some(a => a !== mv.to))) themes.add('discovered-attack');
    }
    if (mv.captured && mv.captured !== 'p' && isHanging(before, mv.to, other(me))) themes.add('hanging-piece');
    if (!mv.captured && !mv.san.includes('+') && attackedValuables(pos, me, []).filter(sq => isHanging(pos, sq, other(me))).length >= 2) themes.add('double-attack');
  }

  // Défense : une pièce menacée au départ est sauvée par la solution (déplacée ou plus en prise)
  if (threatenedAtStart.length && !mate) {
    const saved = threatenedAtStart.every(sq => { const q = pos.get(sq); return !q || q.color !== me || !isHanging(pos, sq, me); });
    if (saved && !firstMove.captured) { themes.add('defense'); themes.add('threat'); }
  }
  const pieces = start.board().flat().filter(Boolean).length;
  if (pieces <= 8) themes.add('endgame');
  if (!themes.size || (themes.size === 1 && themes.has('endgame'))) themes.add(solution.length >= 5 ? 'calculation' : 'material');
  return [...themes];
}

// Difficulté estimée (Elo d'exercice 400-2200)
export function estimateRating({ solution, mate, gain, pieces, themes }) {
  let r = 700;
  r += 180 * Math.max(0, (solution.length - 1) / 2);            // longueur de la solution
  if (mate !== null) r += mate === 1 ? -150 : mate === 2 ? 100 : 250;
  if (themes.includes('hanging-piece')) r -= 200;
  if (themes.includes('discovered-attack') || themes.includes('skewer')) r += 120;
  if (gain !== null && gain < 300) r += 80;                        // petit gain = plus subtil
  r += Math.max(0, pieces - 16) * 12;                              // position chargée
  return Math.max(400, Math.min(2200, Math.round(r / 10) * 10));
}

// ---------------------------------------------------------------------------
// Vérification d'une position candidate
// ---------------------------------------------------------------------------
async function evalLines(fen, multipv) {
  const chess = new Chess(fen);
  const { lines, bestMove } = await analyse(fen, { depth: VERIFY_DEPTH, multipv, movetime: 4000 });
  const turn = chess.turn();
  const scored = lines.map(l => ({ move: l.move, cp: toWhiteCp(l, turn) * (turn === 'w' ? 1 : -1) })); // point de vue du camp au trait
  const main = scored.find(l => l.move === bestMove) || scored[0];
  const alt = scored.find(l => l !== main);
  return { main, alt, chess };
}

/**
 * verifyPuzzle(fen) → { fen, solution, themes, rating, mate, gain } ou null si la position
 * ne fait pas un bon exercice (solution non unique, gain insuffisant, position déjà décidée).
 */
export async function verifyPuzzle(fen) {
  let chess;
  try { chess = new Chess(fen); } catch { return null; }
  if (chess.isGameOver()) return null;
  const me = chess.turn();
  const startMaterial = material(chess) * (me === 'w' ? 1 : -1);
  const startPieces = chess.board().flat().filter(Boolean).length;

  const first = await evalLines(fen, 3);
  if (!first.main) return null;
  const mateStart = isMateScore(first.main.cp) ? Math.abs(mateIn(first.main.cp * (me === 'w' ? 1 : -1))) : null;
  const winning = first.main.cp > 0 && (isMateScore(first.main.cp) || first.main.cp >= MIN_GAIN);
  if (!winning) return null;
  // Position déjà largement gagnée quoi qu'on joue : pas d'intérêt pédagogique
  if (first.alt && first.alt.cp >= 400 && !isMateScore(first.main.cp)) return null;
  if (!first.alt || first.main.cp - first.alt.cp < UNIQUENESS_GAP) return null;
  if (first.alt && isMateScore(first.alt.cp) && first.alt.cp > 0) return null; // deux mats : pas unique

  const solution = [first.main.move];
  let cur = new Chess(fen);
  cur.move({ from: first.main.move.slice(0, 2), to: first.main.move.slice(2, 4), promotion: first.main.move[4] });
  let lastEval = first.main.cp;
  const mating = isMateScore(first.main.cp);

  while (solution.length < MAX_SOLUTION_PLIES && !cur.isGameOver()) {
    // Réponse adverse (meilleure défense)
    const reply = await evalLines(cur.fen(), 1);
    if (!reply.main) break;
    const replyMove = reply.main.move;
    const next = new Chess(cur.fen());
    next.move({ from: replyMove.slice(0, 2), to: replyMove.slice(2, 4), promotion: replyMove[4] });
    if (next.isGameOver()) return null; // pat ou nulle après la réponse adverse : pas un bon exercice

    // Le gain est-il encaissé ? Mesuré APRÈS la meilleure réponse adverse (une reprise annulerait un gain apparent)
    const gainedNow = material(next) * (me === 'w' ? 1 : -1) - startMaterial;
    if (!mating && gainedNow >= 2 && gainedNow * 100 >= Math.min(lastEval, 300) - 50) break;

    const ours = await evalLines(next.fen(), 3);
    if (!ours.main) break;
    let forced;
    if (isMateScore(ours.main.cp)) {
      // Mat : la suite est forcée si l'autre coup ne mate pas, ou mate nettement plus lentement
      const altMate = ours.alt && isMateScore(ours.alt.cp) && ours.alt.cp > 0;
      forced = !altMate || (mateIn(ours.alt.cp * (me === 'w' ? 1 : -1)) - mateIn(ours.main.cp * (me === 'w' ? 1 : -1)) >= 2);
    } else {
      forced = ours.alt ? ours.main.cp - ours.alt.cp >= 100 : true;
    }
    if (!forced) break; // plusieurs bons coups : l'exercice s'arrête ici
    solution.push(replyMove, ours.main.move);
    cur = next;
    cur.move({ from: ours.main.move.slice(0, 2), to: ours.main.move.slice(2, 4), promotion: ours.main.move[4] });
    lastEval = ours.main.cp;
  }
  if (solution.length % 2 === 0) solution.pop(); // termine toujours sur un coup du joueur

  const endMaterial = material(cur) * (me === 'w' ? 1 : -1);
  const completedMate = cur.isCheckmate();
  // « Mat en N » seulement si le mat est délivré dans la solution ; sinon c'est une position gagnante à trouver
  const mate = completedMate ? Math.ceil(solution.length / 2) : null;
  if (mating && !completedMate && mateStart <= 4) return null; // mat court mais non forcé jusqu'au bout : ambigu
  const gain = mating ? null : Math.round((endMaterial - startMaterial) * 100);
  if (!mating && gain < 150 && lastEval < MIN_GAIN + 100) return null; // gain non encaissé : trop long pour un exercice
  const themes = detectThemes(fen, solution, { mate });
  const rating = estimateRating({ solution, mate, gain, pieces: startPieces, themes });
  return { fen, solution, themes, rating, mate, gain, turn: me };
}

// Clé de déduplication (position sans compteurs)
export const puzzleKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
