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
const MAX_SOLUTION_PLIES = 7;
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
 * Thèmes d'une solution : `fen` position de départ, `solution` coups UCI (le joueur joue les coups 0, 2, 4…)
 */
export function detectThemes(fen, solution, { mate = null } = {}) {
  const themes = new Set();
  const start = new Chess(fen);
  const me = start.turn();
  const first = solution[0];
  const after = new Chess(fen);
  const mv = after.move({ from: first.slice(0, 2), to: first.slice(2, 4), promotion: first[4] });

  if (mate !== null) themes.add(mate === 1 ? 'mate-1' : mate === 2 ? 'mate-2' : 'mate-3');
  if (mv.promotion) themes.add('promotion');
  if (!mate || mate > 1) {
    if (isFork(start, first)) themes.add('fork');
    const ps = pinOrSkewer(after, mv.to);
    if (ps) themes.add(ps);
    // Attaque à la découverte : une autre pièce du joueur attaque une pièce de valeur qu'elle n'attaquait pas avant
    const before = attackedValuables(start, me);
    const now = attackedValuables(after, me, [mv.to]).filter(s => !before.includes(s));
    const byOthers = now.filter(s => after.attackers(s, me).some(a => a !== mv.to));
    if (byOthers.length) themes.add('discovered-attack');
    if (mv.captured && isHanging(start, mv.to, other(me))) themes.add('hanging-piece');
    if (!themes.size && now.length >= 2) themes.add('double-attack');
  }
  // Défense : au départ, une de nos pièces est en prise ou un mat nous menace, et la solution sauve la situation
  const threatened = [...start.board().flat()].filter(q => q && q.color === me && q.type !== 'k' && isHanging(start, q.square, me));
  if (threatened.length && !mv.captured && !mate) { themes.add('defense'); themes.add('threat'); }
  const pieces = start.board().flat().filter(Boolean).length;
  if (pieces <= 8) themes.add('endgame');
  const quiet = !mv.captured && !mv.san.includes('+') && !mv.san.includes('#') && !mv.promotion;
  if (!themes.size) themes.add(quiet && solution.length <= 3 ? 'strategy' : solution.length >= 5 ? 'calculation' : 'material');
  if (themes.size === 1 && themes.has('endgame')) themes.add(quiet ? 'strategy' : 'calculation');
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

  while (solution.length < MAX_SOLUTION_PLIES && !cur.isGameOver()) {
    // Réponse adverse (meilleure défense)
    const reply = await evalLines(cur.fen(), 1);
    if (!reply.main) break;
    const replyMove = reply.main.move;
    const next = new Chess(cur.fen());
    next.move({ from: replyMove.slice(0, 2), to: replyMove.slice(2, 4), promotion: replyMove[4] });
    if (next.isGameOver()) { solution.push(replyMove); cur = next; break; }

    // Le gain est-il déjà encaissé ? (matériel ou mat délivré) → on s'arrête avant la réponse adverse
    const gainedNow = material(cur) * (me === 'w' ? 1 : -1) - startMaterial;
    if (!isMateScore(lastEval) && gainedNow * 100 >= Math.min(lastEval, 300) - 50 && gainedNow >= 2) break;

    const ours = await evalLines(next.fen(), 3);
    if (!ours.main) break;
    const forced = ours.alt ? ours.main.cp - ours.alt.cp >= 100 : true;
    if (!forced) break; // plusieurs bons coups : l'exercice s'arrête ici
    solution.push(replyMove, ours.main.move);
    cur = next;
    cur.move({ from: ours.main.move.slice(0, 2), to: ours.main.move.slice(2, 4), promotion: ours.main.move[4] });
    lastEval = ours.main.cp;
  }
  if (solution.length % 2 === 0 && !cur.isGameOver()) solution.pop(); // termine toujours sur un coup du joueur

  const endMaterial = material(cur) * (me === 'w' ? 1 : -1);
  const gain = isMateScore(first.main.cp) ? null : Math.round((endMaterial - startMaterial) * 100);
  const mate = mateStart;
  if (mate === null && gain !== null && gain < 150 && !cur.isCheckmate()) {
    // Le gain n'est pas encaissé dans la longueur autorisée : trop long pour un exercice
    if (lastEval < MIN_GAIN + 100) return null;
  }
  const themes = detectThemes(fen, solution, { mate });
  const rating = estimateRating({ solution, mate, gain, pieces: startPieces, themes });
  return { fen, solution, themes, rating, mate, gain, turn: me };
}

// Clé de déduplication (position sans compteurs)
export const puzzleKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
