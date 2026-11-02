// Vérification manuelle de l'analyseur : joue une partie IA contre IA, l'enregistre dans
// une base temporaire, l'analyse et affiche le rapport.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-coach-analysis-'));
const { db, runMigrations } = await import('../server/db.js');
runMigrations();
const { Chess } = await import('chess.js');
const { chooseMove, newPersona } = await import('../server/engine/ai.js');
const { runAnalysis, MOTIFS } = await import('../server/services/analysis.js');
const { shutdown } = await import('../server/engine/stockfish.js');

const elo = Number(process.argv[2] || 800);
db.prepare(`INSERT INTO users (id, email, username, password_hash) VALUES (1, 'a@b.c', 'test', 'x')`).run();
const chess = new Chess();
const history = [];
const personas = { w: newPersona(), b: newPersona() };
let ply = 0;
while (!chess.isGameOver() && ply < 90) {
  const r = await chooseMove(chess.fen(), elo, { persona: personas[chess.turn()], ply, history });
  chess.move({ from: r.move.slice(0, 2), to: r.move.slice(2, 4), promotion: r.move[4] });
  history.push(r.move); ply++;
}
const g = db.prepare(`INSERT INTO games (user_id, user_color, ai_elo, status, result, user_score, elo_before, fen, pgn, move_count, finished_at)
                      VALUES (1, 'white', ?, 'finished', '*', 0.5, 1000, ?, ?, ?, datetime('now'))`).run(elo, chess.fen(), chess.pgn(), ply);
const hist = chess.history({ verbose: true });
hist.forEach((m, i) => db.prepare('INSERT INTO moves (game_id, ply, san, uci, fen_after, by_user) VALUES (?, ?, ?, ?, ?, ?)')
  .run(g.lastInsertRowid, i + 1, m.san, m.from + m.to + (m.promotion || ''), m.after, i % 2 === 0 ? 1 : 0));
const a = db.prepare('INSERT INTO analyses (game_id, user_id) VALUES (?, 1)').run(g.lastInsertRowid);

const t0 = Date.now();
const summary = await runAnalysis(a.lastInsertRowid, { onProgress: (i, n) => { if (i % 20 === 0) process.stdout.write(`${i}/${n} `); } });
console.log(`\n${ply} demi-coups analysés en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log('précision', summary.accuracy, 'acpl', summary.acpl, 'compteurs', JSON.stringify(summary.counts.user));
console.log('moments décisifs', summary.decisive.map(d => `${d.ply}.${d.san} (${(d.swing * 100).toFixed(0)}%)`).join(', '));
console.log('erreurs clés :'); for (const e of summary.keyErrors) console.log(`  ${e.ply}. ${e.san} [${e.label}, -${e.loss}] ${e.motifs.join(',')} → ${e.explanation}`);
console.log('meilleurs coups :', summary.bestMoves.map(b => `${b.ply}.${b.san}`).join(', '));
console.log('faiblesses', JSON.stringify(summary.weaknesses), 'forces', JSON.stringify(summary.strengths));
console.log('recommandations', summary.recommendations.map(r => r.category).join(', '));
console.log('\nPGN :', chess.pgn());
shutdown();
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
