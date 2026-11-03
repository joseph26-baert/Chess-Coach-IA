// Tests des statistiques et de la progression : bornes de période, courbe Elo, résultats,
// précision, exercices, comparaison avec la période précédente, cloisonnement entre comptes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-coach-stats-'));
process.env.ANALYSIS_AUTO = '0';
const { db, runMigrations } = await import('../server/db.js');
const S = await import('../server/services/stats.js');

const NOW = Date.parse('2026-11-03T12:00:00Z');
const DAY = 86400_000;
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

let uid, other;
function user(name) {
  return db.prepare(`INSERT INTO users (email, username, password_hash, elo, peak_elo) VALUES (?, ?, 'x', 1000, 1000)`).run(`${name}@t.l`, name).lastInsertRowid;
}
function game(u, { daysAgo, score, color = 'white', tc = 'none', rated = 1, delta = 0, acc = null, blunders = 0, mistakes = 0, termination = 'checkmate' }) {
  const id = db.prepare(`INSERT INTO games (user_id, user_color, ai_elo, status, result, termination, user_score, elo_before, elo_after, elo_delta, fen, move_count, time_control, rated, finished_at, started_at, duration_s)
                         VALUES (?, ?, 1000, 'finished', ?, ?, ?, 1000, ?, ?, 'x', 40, ?, ?, ?, ?, 600)`)
    .run(u, color, score === 1 ? '1-0' : score === 0 ? '0-1' : '1/2-1/2', termination, score, 1000 + delta, delta, tc, rated, at(daysAgo), at(daysAgo)).lastInsertRowid;
  if (acc !== null) {
    const aid = db.prepare(`INSERT INTO analyses (game_id, user_id, status, accuracy_user, acpl_user, inaccuracies, mistakes, blunders, finished_at) VALUES (?, ?, 'done', ?, 30, 1, ?, ?, ?)`)
      .run(id, u, acc, mistakes, blunders, at(daysAgo)).lastInsertRowid;
    for (let i = 0; i < blunders; i++) db.prepare(`INSERT INTO error_events (user_id, game_id, analysis_id, ply, category, motif, severity, loss_cp, created_at) VALUES (?, ?, ?, ?, 'tactics', 'hanging-piece', 'blunder', 300, ?)`).run(u, id, aid, 10 + i, at(daysAgo));
  }
  return id;
}
function rating(u, daysAgo, before, after, gameId = null, reason = 'game') {
  db.prepare(`INSERT INTO rating_history (user_id, game_id, elo_before, elo_after, delta, provisional, reason, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(u, gameId, before, after, after - before, reason, at(daysAgo));
}
function attempt(u, daysAgo, result, theme = 'fork') {
  db.prepare(`INSERT INTO puzzle_attempts (user_id, puzzle_id, result, theme, time_ms, created_at) VALUES (?, 1, ?, ?, 20000, ?)`).run(u, result, theme, at(daysAgo));
}

before(() => {
  runMigrations();
  uid = user('stat'); other = user('autre');
  db.prepare(`INSERT INTO puzzles (source, fen, fen_key, solution, themes, rating) VALUES ('library', 'x', 'x', '[]', '["fork"]', 1000)`).run();
  rating(uid, 100, 1000, 1000, null, 'init');
  // Période précédente (30–60 jours) : 2 parties, 1 victoire, Elo 1000 → 1010 → 990
  game(uid, { daysAgo: 50, score: 1, delta: 10, acc: 70, blunders: 2 }); rating(uid, 50, 1000, 1010, 1);
  game(uid, { daysAgo: 40, score: 0, delta: -20, acc: 60, blunders: 3 }); rating(uid, 40, 1010, 990, 2);
  attempt(uid, 45, 'failed'); attempt(uid, 44, 'solved');
  // Période courante (0–30 jours) : 4 parties, 3 victoires, 1 nulle ; Elo 990 → 1050
  game(uid, { daysAgo: 20, score: 1, delta: 20, acc: 80, blunders: 1, color: 'black', tc: '5+0' }); rating(uid, 20, 990, 1010, 3);
  game(uid, { daysAgo: 10, score: 1, delta: 20, acc: 90, blunders: 0, tc: '5+0' }); rating(uid, 10, 1010, 1030, 4);
  game(uid, { daysAgo: 5, score: 0.5, delta: 0, acc: null, termination: 'stalemate' }); rating(uid, 5, 1030, 1030, 5);
  game(uid, { daysAgo: 1, score: 1, delta: 20, acc: 85, blunders: 1, rated: 1 }); rating(uid, 1, 1030, 1050, 6);
  attempt(uid, 3, 'solved'); attempt(uid, 2, 'solved'); attempt(uid, 2, 'solved-hint', 'endgame'); attempt(uid, 1, 'failed');
  // Un autre compte, pour vérifier le cloisonnement
  game(other, { daysAgo: 2, score: 0, delta: -30, acc: 40, blunders: 5 }); rating(other, 2, 1000, 970, 7);
});
after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

test('période : valeurs acceptées', () => {
  assert.equal(S.periodDays('7'), 7);
  assert.equal(S.periodDays(undefined), 30);
  assert.equal(S.periodDays('all'), null);
  assert.equal(S.periodDays('12'), undefined);
});

test('statistiques sur 30 jours : résultats, Elo, précision, exercices', () => {
  const s = S.statistics(uid, 30, NOW);
  assert.deepEqual([s.results.games, s.results.wins, s.results.draws, s.results.losses], [4, 3, 1, 0]);
  assert.equal(s.results.winRate, 75);
  assert.equal(s.results.score, 87.5);
  assert.equal(s.results.byColor.black.wins, 1);
  assert.equal(s.results.byTimeControl['5+0'].games, 2);
  assert.equal(s.results.byTermination.stalemate.draws, 1);
  assert.equal(s.results.streaks.bestWin, 2);
  assert.equal(s.results.streaks.current, 1);
  assert.equal(s.elo.start, 990);
  assert.equal(s.elo.end, 1050);
  assert.equal(s.elo.delta, 60);
  assert.equal(s.elo.peak, 1050);
  assert.equal(s.accuracy.analysed, 3);
  assert.equal(s.accuracy.accuracy, 85);
  assert.equal(s.accuracy.perGame.blunders, 0.7);
  assert.equal(s.errors.find(e => e.category === 'tactics').blunder, 2);
  assert.equal(s.puzzles.attempts, 4);
  assert.equal(s.puzzles.solved, 2);
  assert.equal(s.puzzles.withHint, 1);
  assert.equal(s.puzzles.rate, 50);
  assert.equal(s.puzzles.byCategory.find(c => c.category === 'endgames').attempts, 1);
});

test('comparaison avec la période précédente', () => {
  const s = S.statistics(uid, 30, NOW);
  assert.deepEqual(s.comparison.games, { now: 4, before: 2 });
  assert.deepEqual(s.comparison.winRate, { now: 75, before: 50 });
  assert.deepEqual(s.comparison.eloDelta, { now: 60, before: -10 });
  assert.deepEqual(s.comparison.accuracy, { now: 85, before: 65 });
  assert.deepEqual(s.comparison.puzzleRate, { now: 50, before: 50 });
  assert.equal(S.statistics(uid, null, NOW).comparison, null);
});

test('toute la période : point de départ = initialisation', () => {
  const s = S.statistics(uid, null, NOW);
  assert.equal(s.results.games, 6);
  assert.equal(s.elo.start, 1000);
  assert.equal(s.elo.low, 990);
  const p = S.progression(uid, null, NOW);
  assert.equal(p.elo.points.length, 7); // init + 6 parties
  assert.equal(p.elo.points[0].elo, 1000);
});

test('progression sur 7 jours : courbe qui part de la dernière valeur connue', () => {
  const p = S.progression(uid, 7, NOW);
  assert.equal(p.elo.points[0].elo, 1030);
  assert.equal(p.elo.points.length, 3); // départ + 2 parties (5 j et 1 j)
  assert.equal(p.games.length, 1);      // seule la partie d'il y a 1 jour est analysée
  assert.equal(p.games[0].accuracy, 85);
  assert.ok(p.activity.length >= 1 && p.activity.length <= 2);
  assert.equal(p.activity.reduce((s, w) => s + w.games, 0), 2);
  assert.equal(p.activity.reduce((s, w) => s + w.puzzles, 0), 4);
});

test("semaines d'activité : 12 au plus, ordre chronologique, totaux cohérents", () => {
  const s = S.statistics(uid, null, NOW);
  assert.equal(s.activity.length, 12);
  for (let i = 1; i < s.activity.length; i++) assert.ok(s.activity[i].week > s.activity[i - 1].week);
  assert.equal(s.activity.reduce((n, w) => n + w.games, 0), 6);
});

test("cloisonnement : les données d'un autre compte n'apparaissent pas", () => {
  const s = S.statistics(other, 30, NOW);
  assert.equal(s.results.games, 1);
  assert.equal(s.results.losses, 1);
  assert.equal(s.errors.find(e => e.category === 'tactics').blunder, 5);
  assert.equal(S.statistics(uid, 30, NOW).errors.find(e => e.category === 'tactics').blunder, 2);
});

test('compte vide : aucune erreur, valeurs nulles', () => {
  const empty = user('vide');
  const s = S.statistics(empty, 30, NOW);
  assert.equal(s.results.games, 0);
  assert.equal(s.results.winRate, null);
  assert.equal(s.elo.start, null);
  assert.equal(s.accuracy.accuracy, null);
  const p = S.progression(empty, 30, NOW);
  assert.deepEqual(p.elo.points, []);
  assert.deepEqual(p.weaknesses.days, []);
});
