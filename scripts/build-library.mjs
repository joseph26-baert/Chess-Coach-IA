// Construit la bibliothèque d'exercices : parties IA contre IA à niveaux variés, détection
// des positions où le camp au trait dispose d'une tactique nette, vérification à profondeur
// élevée (solution unique et gagnante), dédoublonnage, écriture incrémentale.
// Usage : node scripts/build-library.mjs [cible=500] [fichier=server/puzzles/library.json]
import fs from 'node:fs';
import path from 'node:path';
import { Chess } from 'chess.js';
import { chooseMove, newPersona } from '../server/engine/ai.js';
import { analyse, shutdown } from '../server/engine/stockfish.js';
import { verifyPuzzle, puzzleKey } from '../server/services/puzzles.js';
import { toWhiteCp } from '../server/services/analysis.js';

const TARGET = Number(process.argv[2] || 500);
const FILE = process.argv[3] || path.join('server', 'puzzles', 'library.json');
fs.mkdirSync(path.dirname(FILE), { recursive: true });
const library = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [];
const keys = new Set(library.map(p => puzzleKey(p.fen)));
console.log(`${library.length} exercices existants, cible ${TARGET}`);

// Re-vérification des exercices existants avec les règles actuelles (solution, thèmes, difficulté) ;
// ceux qui ne passent plus sont retirés. Lancer avec REVERIFY=1.
if (process.env.REVERIFY) {
  const kept = [];
  for (const p of library) {
    const v = await verifyPuzzle(p.fen);
    if (v) kept.push({ ...p, solution: v.solution, themes: v.themes, rating: v.rating, mate: v.mate, gain: v.gain });
  }
  console.log(`re-vérification : ${kept.length}/${library.length} conservés`);
  library.length = 0; library.push(...kept);
  keys.clear(); for (const p of library) keys.add(puzzleKey(p.fen));
  fs.writeFileSync(FILE, JSON.stringify(library));
}

const themeCount = () => library.reduce((m, p) => { for (const t of p.themes) m[t] = (m[t] || 0) + 1; return m; }, {});
let games = 0;
while (library.length < TARGET) {
  const elo = 500 + Math.floor(Math.random() * 1200);
  const chess = new Chess();
  const personas = { w: newPersona(), b: newPersona() };
  const history = [];
  let ply = 0;
  const positions = [], allFens = [];
  while (!chess.isGameOver() && ply < 110) {
    const r = await chooseMove(chess.fen(), elo + (chess.turn() === 'w' ? 0 : 100), { persona: personas[chess.turn()], ply, history });
    chess.move({ from: r.move.slice(0, 2), to: r.move.slice(2, 4), promotion: r.move[4] });
    history.push(r.move); ply++;
    // Candidats : la position qui suit une erreur de l'IA (l'adversaire a maintenant une tactique),
    // toutes les positions de finale (≤ 8 pièces), et les dernières positions avant un mat (mats en 1 et 2)
    const pieces = chess.board().flat().filter(Boolean).length;
    if (ply >= 6 && !chess.isGameOver() && (r.loss >= 120 || r.reason !== 'normal' || (pieces <= 8 && ply % 3 === 0))) positions.push(chess.fen());
    allFens.push(chess.fen());
  }
  if (chess.isCheckmate()) for (const k of [2, 4]) if (allFens[allFens.length - k]) positions.push(allFens[allFens.length - k]);
  games++;
  let found = 0;
  for (const fen of positions) {
    if (keys.has(puzzleKey(fen))) continue;
    const c = new Chess(fen);
    const { lines, bestMove } = await analyse(fen, { depth: 10, multipv: 2, movetime: 800 });
    if (lines.length < 2) continue;
    const sign = c.turn() === 'w' ? 1 : -1;
    const main = lines.find(l => l.move === bestMove) || lines[0];
    const alt = lines.find(l => l !== main);
    const cpMain = toWhiteCp(main, c.turn()) * sign, cpAlt = toWhiteCp(alt, c.turn()) * sign;
    if (cpMain < 180 || cpMain - cpAlt < 120 || cpAlt >= 400) continue;
    const puzzle = await verifyPuzzle(fen);
    if (!puzzle) continue;
    keys.add(puzzleKey(fen));
    library.push({ fen: puzzle.fen, solution: puzzle.solution, themes: puzzle.themes, rating: puzzle.rating, mate: puzzle.mate, gain: puzzle.gain, origin: { elo } });
    found++;
    if (library.length >= TARGET) break;
  }
  fs.writeFileSync(FILE, JSON.stringify(library));
  console.log(`partie ${games} (${elo}) : ${found} exercice(s) → total ${library.length} | ${JSON.stringify(themeCount())}`);
}
shutdown();
