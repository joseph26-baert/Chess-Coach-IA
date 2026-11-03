// Complète la bibliothèque avec des finales : positions aléatoires à peu de pièces
// (roi + pions, tour contre pion, dame contre pion, courses à la promotion), vérifiées
// par le même vérificateur (coup unique, gain net ou mat). Les finales avec plusieurs
// coups gagnants sont rejetées : ne restent que celles où il faut trouver LE bon coup
// (opposition, case clé, coup d'attente…).
// Usage : node scripts/build-endgames.mjs [cible=120] [fichier=server/puzzles/library.json]
import fs from 'node:fs';
import path from 'node:path';
import { Chess } from 'chess.js';
import { shutdown } from '../server/engine/stockfish.js';
import { verifyPuzzle, puzzleKey } from '../server/services/puzzles.js';

const TARGET = Number(process.argv[2] || 120);
const FILE = process.argv[3] || path.join('server', 'puzzles', 'library.json');
const library = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [];
const keys = new Set(library.map(p => puzzleKey(p.fen)));
const countEnd = () => library.filter(p => p.themes.includes('endgame') || p.themes.includes('promotion')).length;
console.log(`${library.length} exercices, dont ${countEnd()} finales ; cible ${TARGET} finales`);

const SETS = [
  ['K', 'P', 'k'], ['K', 'P', 'P', 'k', 'p'], ['K', 'P', 'P', 'k', 'p', 'p'], ['K', 'R', 'k', 'p'], ['K', 'R', 'P', 'k', 'r'],
  ['K', 'Q', 'k', 'p'], ['K', 'N', 'P', 'k'], ['K', 'B', 'P', 'k'], ['K', 'P', 'k', 'n'], ['K', 'R', 'k', 'n'],
];
const files = 'abcdefgh';
function randomSquare() { return files[Math.floor(Math.random() * 8)] + (1 + Math.floor(Math.random() * 8)); }

function randomPosition() {
  const set = SETS[Math.floor(Math.random() * SETS.length)];
  const board = {};
  for (const piece of set) {
    let sq;
    for (let tries = 0; tries < 50; tries++) {
      sq = randomSquare();
      if (board[sq]) continue;
      if (piece.toLowerCase() === 'p' && (sq[1] === '1' || sq[1] === '8')) continue;
      break;
    }
    if (board[sq]) return null;
    board[sq] = piece;
  }
  // FEN
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let row = '', empty = 0;
    for (const f of files) {
      const p = board[f + r];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; } else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const turn = Math.random() < 0.5 ? 'w' : 'b';
  const fen = `${rows.join('/')} ${turn} - - 0 1`;
  try {
    const c = new Chess(fen);
    if (c.isCheck()) return null; // pas d'échec initial pour une finale « calme »
    // Le camp au trait doit être celui qui a le matériel (sinon on inverse)
    return fen;
  } catch { return null; }
}

let tried = 0;
while (countEnd() < TARGET) {
  const fen = randomPosition();
  if (!fen || keys.has(puzzleKey(fen))) continue;
  tried++;
  const p = await verifyPuzzle(fen);
  if (!p) continue;
  if (!p.themes.includes('endgame') && !p.themes.includes('promotion')) continue;
  keys.add(puzzleKey(fen));
  library.push({ fen: p.fen, solution: p.solution, themes: p.themes, rating: p.rating, mate: p.mate, gain: p.gain, origin: { kind: 'endgame' } });
  fs.writeFileSync(FILE, JSON.stringify(library));
  console.log(`+ ${p.solution.join(' ')} [${p.themes.join(',')}] ${p.rating} → ${countEnd()} finales (${tried} essais)`);
}
shutdown();
