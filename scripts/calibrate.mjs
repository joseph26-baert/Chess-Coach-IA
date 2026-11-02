// Calibration de l'IA : parties IA contre IA entre deux niveaux.
// Usage : node scripts/calibrate.mjs <eloA> <eloB> [parties=10] [maxPlies=200]
// Sortie : score de A, et par niveau : perte moyenne par coup, gaffes (≥200 cp) pour 100 coups.
import { Chess } from 'chess.js';
import { chooseMove, newPersona } from '../server/engine/ai.js';
import { shutdown, analyse, score } from '../server/engine/stockfish.js';

const [eloA, eloB] = [Number(process.argv[2]), Number(process.argv[3])];
const N = Number(process.argv[4] || 10);
const MAX_PLIES = Number(process.argv[5] || 200);
const CONC = Number(process.env.ENGINE_POOL || 2);

// Statistiques par camp (A / B) : perte « annoncée » = mesurée à la profondeur du niveau,
// donc sous-estimée aux bas niveaux ; sert à comparer des réglages, pas comme vérité absolue.
const stats = { A: { elo: eloA, moves: 0, loss: 0, blunders: 0, reasons: {} }, B: { elo: eloB, moves: 0, loss: 0, blunders: 0, reasons: {} } };

async function playGame(i) {
  const chess = new Chess();
  const whiteSide = i % 2 === 0 ? 'A' : 'B';
  const sideOf = () => (chess.turn() === 'w') === (whiteSide === 'A') ? 'A' : 'B';
  const white = stats[whiteSide].elo, black = stats[whiteSide === 'A' ? 'B' : 'A'].elo;
  const personas = { A: newPersona(), B: newPersona() };
  const history = [];
  let ply = 0;
  while (!chess.isGameOver() && ply < MAX_PLIES) {
    const side = sideOf();
    const elo = stats[side].elo;
    const r = await chooseMove(chess.fen(), elo, { persona: personas[side], ply, history });
    chess.move({ from: r.move.slice(0, 2), to: r.move.slice(2, 4), promotion: r.move[4] });
    history.push(r.move);
    const st = stats[side];
    st.moves++; st.loss += r.loss; if (r.loss >= 200) st.blunders++;
    st.reasons[r.reason] = (st.reasons[r.reason] || 0) + 1;
    ply++;
  }
  let scoreA, res;
  if (chess.isCheckmate()) { scoreA = sideOf() === 'B' ? 1 : 0; res = chess.turn() === 'w' ? '0-1' : '1-0'; }
  else if (chess.isGameOver()) { scoreA = 0.5; res = '½'; }
  else {
    // Partie trop longue : adjudication par évaluation profonde
    const { lines } = await analyse(chess.fen(), { depth: 14 });
    const cp = lines.length ? score(lines[0]) * (chess.turn() === 'w' ? 1 : -1) : 0; // point de vue des blancs
    if (cp > 250) { scoreA = whiteSide === 'A' ? 1 : 0; res = '1-0 (adj.)'; }
    else if (cp < -250) { scoreA = whiteSide === 'B' ? 1 : 0; res = '0-1 (adj.)'; }
    else { scoreA = 0.5; res = '½ (adj.)'; }
  }
  console.log(`partie ${i + 1}: ${white} (B) vs ${black} (N) → ${res} en ${ply} demi-coups`);
  return scoreA;
}

let scoreA = 0;
const queue = [...Array(N).keys()];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) scoreA += await playGame(queue.shift());
}));
console.log(`\nScore de ${eloA} contre ${eloB} : ${scoreA}/${N} = ${(100 * scoreA / N).toFixed(0)} %`);
for (const [side, st] of Object.entries(stats)) {
  console.log(`${side}=${st.elo} : perte moyenne ${(st.loss / st.moves).toFixed(0)} cp/coup, gaffes ${(100 * st.blunders / st.moves).toFixed(1)}/100 coups, raisons ${JSON.stringify(st.reasons)}`);
}
shutdown();
