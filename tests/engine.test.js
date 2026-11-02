// Robustesse du moteur : un processus tué est remplacé, les requêtes suivantes aboutissent
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.ENGINE_POOL = '1';
const { analyse, withEngine, shutdown } = await import('../server/engine/stockfish.js');
after(() => shutdown());

test('analyse simple renvoie un meilleur coup', async () => {
  const r = await analyse('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { depth: 6, multipv: 3 });
  assert.ok(r.bestMove);
  assert.equal(r.lines.length, 3);
});

test('moteur tué pendant une recherche : la requête échoue vite, la suivante repart sur un moteur neuf', async () => {
  const t0 = Date.now();
  await assert.rejects(withEngine(async (engine) => {
    const p = engine.send('go depth 20', l => l.startsWith('bestmove'));
    engine.kill();
    return p;
  }), /Moteur arrêté/);
  assert.ok(Date.now() - t0 < 5000, 'pas d attente du timeout');
  const r = await analyse('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', { depth: 6 });
  assert.ok(r.bestMove);
});
