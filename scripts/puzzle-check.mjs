import { verifyPuzzle } from '../server/services/puzzles.js';
import { shutdown } from '../server/engine/stockfish.js';
const tests = [
  ['Mat en 1 (Dxf7#)', 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'],
  ['Fourchette Cc7+ (roi + tour)', 'r3k2r/8/8/3N4/8/8/8/R3K2R w KQkq - 0 1'],
  ['Cavalier gratuit en d4', 'r1bqkbnr/pppppppp/8/8/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'],
  ['Position initiale (rien)', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  ['Mat en 2 (Dame sacrifiée)', '2r3k1/5ppp/8/8/8/8/5PPP/3QR1K1 w - - 0 1'],
];
for (const [label, fen] of tests) {
  const t = Date.now();
  const r = await verifyPuzzle(fen);
  console.log(label, '→', r ? `${r.solution.join(' ')} | ${r.themes.join(',')} | ${r.rating} | mat ${r.mate} gain ${r.gain}` : 'rejeté', `(${Date.now() - t} ms)`);
}
shutdown();
