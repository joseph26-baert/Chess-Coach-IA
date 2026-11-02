import { Chess } from 'chess.js';
import { chooseMove, newPersona } from '../server/engine/ai.js';
import { analyse, shutdown } from '../server/engine/stockfish.js';
// L'IA (blancs, Elo donné) doit mater ; les noirs (roi seul) se défendent au mieux (Stockfish profondeur 12)
async function run(fen, elo, label) {
  const chess = new Chess(fen); const persona = newPersona(); const history = [];
  let ply = 0;
  while (!chess.isGameOver() && ply < 120) {
    let uci;
    if (chess.turn() === 'w') uci = (await chooseMove(chess.fen(), elo, { persona, ply, history, startFen: fen })).move;
    else uci = (await analyse(chess.fen(), { depth: 12 })).bestMove;
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); history.push(uci); ply++;
  }
  console.log(label, elo, chess.isCheckmate() ? `MAT en ${Math.ceil(ply / 2)} coups` : chess.isThreefoldRepetition() ? 'nulle répétition' : chess.isDrawByFiftyMoves() ? 'nulle 50 coups' : chess.isStalemate() ? 'PAT' : `non terminé (${ply})`);
}
for (const elo of [400, 1200]) await run('4k3/8/8/8/8/8/8/3QK3 w - - 0 1', elo, 'D+R vs R');
for (const elo of [1200, 1600]) await run('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', elo, 'T+R vs R');
shutdown();
