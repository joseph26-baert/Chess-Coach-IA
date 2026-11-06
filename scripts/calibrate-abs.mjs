// Calibration absolue : l'IA à un niveau donné joue contre elle-même (personnalités différentes),
// puis chaque coup est évalué comme dans l'analyse du site. On mesure la précision moyenne
// (formule Lichess), la perte moyenne par coup et les erreurs par partie, à comparer aux
// références publiées par niveau chess.com (Kaufman 2023, parties 10+0) :
//   400 → 68,8 %   1000 → 75,7 %   1600 → 80,6 %   1800 → 81,9 %   2000 → 83,9 %   (≈ Elo/100 + 64)
// Usage : node scripts/calibrate-abs.mjs <elo> [parties=8] [maxPlies=160]
import { Chess } from 'chess.js';
import { chooseMove, newPersona } from '../server/engine/ai.js';
import { shutdown } from '../server/engine/stockfish.js';
import { evaluatePosition, lossFor, labelFor, winDrop, winProb, moveAccuracy, mateSide, mateIn, gameAccuracy } from '../server/services/analysis.js';

const ELO = Number(process.argv[2]);
const N = Number(process.argv[3] || 8);
const MAX_PLIES = Number(process.argv[4] || 160);
const CONC = Number(process.env.ENGINE_POOL || 2);
const target = (elo) => elo / 100 + 64;

const tot = { moves: 0, acc: 0, loss: 0, inaccuracy: 0, mistake: 0, blunder: 0, games: 0, plies: 0, gameAcc: 0 };
const perGame = [];

async function playAndMeasure(i) {
  const chess = new Chess();
  const personas = { w: newPersona(), b: newPersona() };
  const history = [];
  let ply = 0;
  const sans = [], fens = [chess.fen()];
  while (!chess.isGameOver() && ply < MAX_PLIES) {
    const r = await chooseMove(chess.fen(), ELO, { persona: personas[chess.turn()], ply, history });
    const mv = chess.move({ from: r.move.slice(0, 2), to: r.move.slice(2, 4), promotion: r.move[4] });
    sans.push(mv.san); fens.push(chess.fen()); history.push(r.move); ply++;
  }
  const evals = [];
  for (const fen of fens) evals.push(await evaluatePosition(fen));
  const g = { moves: 0, acc: 0, loss: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  const rows = [];
  const replay = new Chess();
  for (let k = 0; k < sans.length; k++) {
    const mover = replay.turn();
    const uci = (() => { const m = replay.move(sans[k]); return m.from + m.to + (m.promotion || ''); })();
    const eb = evals[k].cp, ea = evals[k + 1].cp;
    const playedIsBest = evals[k].best === uci;
    const loss = playedIsBest ? 0 : lossFor(eb, ea, mover);
    const sign = mover === 'w' ? 1 : -1;
    const missedMate = mateSide(eb) === sign && mateSide(ea) !== sign && !playedIsBest;
    const allowedMate = mateSide(ea) === -sign && Math.abs(mateIn(ea)) <= 5 && mateSide(eb) !== -sign && !playedIsBest && (mover === 'w' ? winProb(eb) : 1 - winProb(eb)) >= 0.1;
    const label = labelFor(playedIsBest ? 0 : winDrop(eb, ea, mover), { playedIsBest, missedMate, allowedMate });
    const acc = playedIsBest ? 100 : moveAccuracy(winProb(eb), winProb(ea), mover);
    g.moves++; g.acc += acc; g.loss += loss;
    if (label in g) g[label]++;
    rows.push({ accuracy: acc, by_user: mover === 'w' ? 1 : 0 });
  }
  const ga = gameAccuracy(rows, evals); g.gameAcc = (ga.user + ga.ai) / 2;
  perGame.push(g);
  for (const k of Object.keys(g)) tot[k] += g[k];
  tot.games++; tot.plies += ply;
  // par partie et par camp : 2 camps → erreurs « par partie et par joueur » = total / 2
  console.log(`partie ${i + 1} (${ply} demi-coups) : précision ${g.gameAcc.toFixed(1)} % (moy. simple ${(g.acc / g.moves).toFixed(1)}), ${(g.loss / g.moves).toFixed(0)} cp/coup, ?! ${g.inaccuracy} ? ${g.mistake} ?? ${g.blunder}`);
}

const queue = [...Array(N).keys()];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await playAndMeasure(queue.shift()); }));
const acc = tot.gameAcc / tot.games, acpl = tot.loss / tot.moves;
const per = (x) => (x / (2 * tot.games)).toFixed(1);
console.log(`\nELO ${ELO} : précision ${acc.toFixed(1)} % (cible ≈ ${target(ELO).toFixed(1)} %), perte ${acpl.toFixed(0)} cp/coup, par joueur et par partie : ?! ${per(tot.inaccuracy)} ? ${per(tot.mistake)} ?? ${per(tot.blunder)} ; ${(tot.plies / tot.games).toFixed(0)} demi-coups/partie`);
console.log(`RESULT ${JSON.stringify({ elo: ELO, games: tot.games, accuracy: +acc.toFixed(2), target: +target(ELO).toFixed(1), acpl: +acpl.toFixed(1), inaccuracy: +per(tot.inaccuracy), mistake: +per(tot.mistake), blunder: +per(tot.blunder) })}`);
shutdown();
