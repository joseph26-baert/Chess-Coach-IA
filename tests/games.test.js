// Tests du flux de partie : création, validation des coups, fin de partie,
// Elo, cloisonnement entre comptes, pendule. Base SQLite temporaire.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-coach-test-'));
process.env.ENGINE_POOL = '1';

const { db, runMigrations } = await import('../server/db.js');
const G = await import('../server/services/games.js');
const { shutdown } = await import('../server/engine/stockfish.js');
const { STARTING_ELO } = await import('../server/services/elo.js');

function makeUser(name) {
  const info = db.prepare(`INSERT INTO users (email, username, password_hash, elo, peak_elo) VALUES (?, ?, 'x', ?, ?)`)
    .run(`${name}@test.local`, name, STARTING_ELO, STARTING_ELO);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}
const reload = (u) => db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);

before(() => runMigrations());
after(() => { shutdown(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

test('création : le joueur blanc a le trait, l IA a l Elo du joueur', async () => {
  const u = makeUser('alice');
  const g = await G.createGame(u, { color: 'white' });
  assert.equal(g.status, 'ongoing');
  assert.equal(g.ai_elo, STARTING_ELO);
  assert.equal(g.move_count, 0);
  assert.equal(G.serializeGame(g).turn, 'white');
  G.resign(g);
});

test('création : le joueur noir voit l IA jouer le premier coup', async () => {
  const u = makeUser('bob');
  const g = await G.createGame(u, { color: 'black', ai_offset: 'stronger' });
  assert.equal(g.move_count, 1);
  assert.equal(g.ai_elo, STARTING_ELO + 100);
  assert.equal(G.serializeGame(g).turn, 'black');
  G.resign(g);
});

test('une seule partie en cours à la fois', async () => {
  const u = makeUser('carol');
  const g = await G.createGame(u, { color: 'white' });
  await assert.rejects(G.createGame(u, { color: 'white' }), /déjà en cours/);
  G.resign(g);
});

test('coup illégal refusé, coup légal joué puis réponse de l IA', async () => {
  const u = makeUser('dave');
  const g = await G.createGame(u, { color: 'white' });
  await assert.rejects(G.playUserMove(g, { from: 'e2', to: 'e5' }), /illégal/);
  const g2 = await G.playUserMove(g, { from: 'e2', to: 'e4' });
  assert.equal(g2.move_count, 2);
  const moves = G.getMoves(g2.id);
  assert.equal(moves[0].san, 'e4');
  assert.equal(moves[0].by_user, 1);
  assert.equal(moves[1].by_user, 0);
  assert.ok(moves[1].ai_loss_cp !== null);
  // le joueur ne peut pas jouer à la place de l IA : c est bien son tour
  assert.equal(G.serializeGame(g2).turn, 'white');
  G.resign(g2);
});

test('cloisonnement : un joueur ne voit pas la partie d un autre', async () => {
  const a = makeUser('eve'), b = makeUser('frank');
  const g = await G.createGame(a, { color: 'white' });
  assert.equal(G.getGame(g.id, b.id), undefined);
  G.resign(g);
});

test('abandon avant 10 demi-coups : partie terminée mais non classée', async () => {
  const u = makeUser('grace');
  const g = await G.createGame(u, { color: 'white' });
  const r = G.resign(g);
  assert.equal(r.status, 'finished');
  assert.equal(r.result, '0-1');
  assert.equal(r.user_score, 0);
  assert.equal(r.rated, 0);
  assert.equal(reload(u).elo, STARTING_ELO);
});

test('mat du berger : victoire, Elo +40 (K=80), historique Elo, meilleur Elo', async () => {
  const u = makeUser('heidi');
  const g = await G.createGame(u, { color: 'white' });
  // On insère les 6 premiers demi-coups directement (l IA ne coopérerait pas)
  const seq = [['e4', 'e2e4', 1], ['e5', 'e7e5', 0], ['Qh5', 'd1h5', 1], ['Nc6', 'b8c6', 0], ['Bc4', 'f1c4', 1], ['Nf6', 'g8f6', 0]];
  const { Chess } = await import('chess.js');
  const c = new Chess();
  seq.forEach(([san, uci, byUser], i) => {
    c.move(san);
    db.prepare('INSERT INTO moves (game_id, ply, san, uci, fen_after, by_user) VALUES (?, ?, ?, ?, ?, ?)').run(g.id, i + 1, san, uci, c.fen(), byUser);
  });
  db.prepare('UPDATE games SET fen = ?, move_count = 6 WHERE id = ?').run(c.fen(), g.id);

  const done = await G.playUserMove(G.getGame(g.id, u.id), { from: 'h5', to: 'f7' });
  assert.equal(done.status, 'finished');
  assert.equal(done.termination, 'checkmate');
  assert.equal(done.result, '1-0');
  assert.equal(done.user_score, 1);
  assert.equal(done.rated, 1);
  assert.equal(done.elo_before, STARTING_ELO);
  assert.equal(done.elo_delta, 40);
  assert.equal(done.elo_after, STARTING_ELO + 40);

  const after = reload(u);
  assert.equal(after.elo, STARTING_ELO + 40);
  assert.equal(after.peak_elo, STARTING_ELO + 40);
  assert.equal(after.rated_games, 1);
  const hist = db.prepare('SELECT * FROM rating_history WHERE user_id = ? AND game_id = ?').get(u.id, g.id);
  assert.equal(hist.delta, 40);
  assert.equal(hist.provisional, 1);
  assert.equal(G.serializeGame(done).pgn.includes('Qxf7#'), true);
});

test('pendule : perte au temps constatée par le serveur', async () => {
  const u = makeUser('ivan');
  const g = await G.createGame(u, { color: 'white', time_control: '3+2' });
  assert.equal(g.user_time_ms, 180_000);
  // On simule un trait passé au joueur il y a 4 minutes
  db.prepare('UPDATE games SET user_turn_since = ? WHERE id = ?').run(new Date(Date.now() - 240_000).toISOString(), g.id);
  assert.ok(G.liveUserTime(G.getGame(g.id, u.id)) < 0);
  const flagged = G.checkFlag(G.getGame(g.id, u.id));
  assert.equal(flagged.status, 'finished');
  assert.equal(flagged.termination, 'timeout');
  assert.equal(flagged.user_score, 0);
});

test('pendule : l incrément est ajouté après un coup', async () => {
  const u = makeUser('judy');
  const g = await G.createGame(u, { color: 'white', time_control: '15+10' });
  const g2 = await G.playUserMove(g, { from: 'd2', to: 'd4' });
  // temps = 15 min − quelques ms + 10 s
  assert.ok(g2.user_time_ms > 15 * 60_000 + 9_000 && g2.user_time_ms <= 15 * 60_000 + 10_000, String(g2.user_time_ms));
  G.resign(g2);
});

test('l historique Elo n est jamais écrasé : deux parties = deux lignes', async () => {
  const u = makeUser('karl');
  for (let i = 0; i < 2; i++) {
    const g = await G.createGame(u, { color: 'white' });
    // 5 coups du joueur pour dépasser 10 demi-coups, puis abandon classé
    let cur = g;
    for (const mv of [['a2', 'a3'], ['h2', 'h3'], ['a3', 'a4'], ['h3', 'h4'], ['b2', 'b3']]) {
      if (cur.status !== 'ongoing') break;
      cur = await G.playUserMove(cur, { from: mv[0], to: mv[1] });
    }
    if (cur.status === 'ongoing') G.resign(cur);
  }
  const rows = db.prepare("SELECT * FROM rating_history WHERE user_id = ? AND reason = 'game' ORDER BY id").all(u.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].elo_before, rows[0].elo_after);
});

test('course : abandon pendant la réflexion de l IA → une seule fin de partie, Elo appliqué une fois', async () => {
  const u = makeUser('lena');
  const g = await G.createGame(u, { color: 'white' });
  db.prepare('UPDATE games SET ai_elo = 2200 WHERE id = ?').run(g.id); // réflexion plus longue
  const pending = G.playUserMove(G.getGame(g.id, u.id), { from: 'e2', to: 'e4' }); // l IA réfléchit
  await new Promise(r => setTimeout(r, 5));
  const resigned = G.resign(G.getGame(g.id, u.id));
  const afterAi = await pending;
  assert.equal(resigned.status, 'finished');
  assert.equal(afterAi.status, 'finished');
  assert.equal(afterAi.termination, 'resign', "l abandon reste la cause, même si l IA a répondu avant");
  // Si l IA avait déjà répondu avant l abandon, son coup est légitime (2 demi-coups) ; sinon rien n est écrit après la fin
  assert.ok([1, 2].includes(afterAi.move_count), String(afterAi.move_count));
  assert.equal(G.getMoves(g.id).length, afterAi.move_count);
  const hist = db.prepare('SELECT COUNT(*) AS n FROM rating_history WHERE user_id = ? AND game_id = ?').get(u.id, g.id).n;
  assert.equal(hist, 0); // abandon avant 10 demi-coups : non classé, et surtout pas deux fois
  assert.equal(reload(u).rated_games, 0);
});

test('coup illégal : ni la pendule ni la partie ne sont modifiées', async () => {
  const u = makeUser('marc');
  const g = await G.createGame(u, { color: 'white', time_control: '3+2' });
  await assert.rejects(G.playUserMove(g, { from: 'e2', to: 'e5' }), /illégal/);
  const same = G.getGame(g.id, u.id);
  assert.equal(same.user_time_ms, 180_000);
  assert.ok(same.user_turn_since, 'le décompte doit continuer');
  assert.equal(same.move_count, 0);
  G.resign(same);
});

test('reprise : si c est le trait de l IA (serveur redémarré), elle joue au chargement', async () => {
  const u = makeUser('nina');
  const g = await G.createGame(u, { color: 'white' });
  const { Chess } = await import('chess.js');
  const c = new Chess(); c.move('e4');
  db.prepare('INSERT INTO moves (game_id, ply, san, uci, fen_after, by_user) VALUES (?, 1, ?, ?, ?, 1)').run(g.id, 'e4', 'e2e4', c.fen());
  db.prepare('UPDATE games SET fen = ?, move_count = 1 WHERE id = ?').run(c.fen(), g.id);
  const resumed = await G.ensureAiMoved(G.getGame(g.id, u.id));
  assert.equal(resumed.move_count, 2);
  assert.equal(G.serializeGame(resumed).turn, 'white');
  G.resign(resumed);
});

test('perte au temps avant 10 demi-coups : non classée', async () => {
  const u = makeUser('omar');
  const g = await G.createGame(u, { color: 'white', time_control: '5+0' });
  db.prepare('UPDATE games SET user_turn_since = ? WHERE id = ?').run(new Date(Date.now() - 600_000).toISOString(), g.id);
  const flagged = G.checkFlag(G.getGame(g.id, u.id));
  assert.equal(flagged.termination, 'timeout');
  assert.equal(flagged.rated, 0);
});
