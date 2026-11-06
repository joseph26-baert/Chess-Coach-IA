// Tests de l'entraînement : bibliothèque, niveaux par thème, répétition espacée, faiblesses, sélection
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-coach-training-'));
process.env.ANALYSIS_AUTO = '0';
const libFile = path.join(process.env.DATA_DIR, 'lib.json');
fs.writeFileSync(libFile, JSON.stringify([
  { fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', solution: ['h5f7'], themes: ['mate-1'], rating: 700, mate: 1, gain: null },
  { fen: 'r1bqkbnr/pppppppp/8/8/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', solution: ['f3d4'], themes: ['hanging-piece'], rating: 690, mate: null, gain: 300 },
  { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', solution: ['a1a8', 'e8d7', 'h1h7'], themes: ['fork', 'endgame'], rating: 1500, mate: null, gain: 1000 },
]));
process.env.PUZZLE_LIBRARY = libFile;

const { db, runMigrations } = await import('../server/db.js');
const T = await import('../server/services/training.js');
const { detectThemes, estimateRating, pinOrSkewer, puzzleKey, THEMES } = await import('../server/services/puzzles.js');
const { Chess } = await import('chess.js');

function makeUser(name, elo = 1000) {
  const info = db.prepare(`INSERT INTO users (email, username, password_hash, elo, peak_elo) VALUES (?, ?, 'x', ?, ?)`).run(`${name}@t.l`, name, elo, elo);
  return info.lastInsertRowid;
}

before(() => { runMigrations(); });
after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

test('bibliothèque chargée une seule fois (idempotent)', () => {
  assert.equal(T.loadLibrary(libFile), 3);
  assert.equal(T.loadLibrary(libFile), 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM puzzles WHERE source = 'library'").get().n, 3);
});

test('exercice public : jamais la solution', () => {
  const p = T.getPuzzle(1);
  const pub = T.publicPuzzle(p);
  assert.equal(pub.solution, undefined);
  assert.equal(pub.turn, 'white');
  assert.deepEqual(pub.themeLabels, ['Mat en 1']);
});

test('niveau par thème : part de l Elo du joueur, monte sur réussite, descend sur échec', () => {
  const uid = makeUser('alice', 1100);
  assert.equal(T.themeRating(uid, 'fork').rating, 1100);
  const up = T.updateThemeRating(uid, 'fork', 1100, 1);
  assert.ok(up.after > 1100);
  const down = T.updateThemeRating(uid, 'fork', 1100, 0);
  assert.ok(down.after < up.after);
  assert.equal(T.themeRating(uid, 'fork').attempts, 2);
});

test('répétition espacée : réussite directe = maîtrisé ; après un échec → 1, 3, 7, 21 jours puis maîtrisé', () => {
  const uid = makeUser('bob');
  const sched = (pid = 1) => db.prepare('SELECT * FROM puzzle_schedule WHERE user_id = ? AND puzzle_id = ?').get(uid, pid);
  T.recordAttempt(uid, 3, { result: 'solved' });
  assert.equal(sched(3).retired, 1, 'réussi du premier coup : ne revient pas');
  T.recordAttempt(uid, 1, { result: 'failed' });
  assert.equal(sched().interval_days, 1); assert.equal(sched().lapses, 1);
  assert.ok(sched().due_at.endsWith('T00:00:00.000Z'), 'échéance au début de journée');
  for (const days of [1, 3, 7, 21]) {
    T.recordAttempt(uid, 1, { result: 'solved' });
    assert.equal(sched().interval_days, days);
    assert.equal(sched().retired, 0);
  }
  T.recordAttempt(uid, 1, { result: 'solved' });
  assert.equal(sched().retired, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM puzzle_attempts WHERE user_id = ?').get(uid).n, 7, 'chaque tentative est conservée');
});

test('réussite avec indice : revient demain sans progresser dans les paliers', () => {
  const uid = makeUser('carol');
  T.recordAttempt(uid, 2, { result: 'failed' });
  T.recordAttempt(uid, 2, { result: 'solved' });
  T.recordAttempt(uid, 2, { result: 'solved-hint', hints: 1 });
  const s = db.prepare('SELECT * FROM puzzle_schedule WHERE user_id = ? AND puzzle_id = 2').get(uid);
  assert.equal(s.interval_days, 1); assert.equal(s.reps, 1);
});

test('session de résolution : le résultat vient du serveur, pas du client', () => {
  const uid = makeUser('zed');
  const p = T.getPuzzle(3); // solution en 2 coups du joueur
  assert.equal(T.sessionResult(uid, p), null, 'pas de session → pas de résultat');
  T.openSession(uid, 3);
  assert.equal(T.sessionResult(uid, p).result, 'failed', 'rien joué → échec');
  T.sessionProgress(uid, 3, 1);
  assert.equal(T.sessionResult(uid, p).result, 'failed', 'incomplet → échec');
  T.sessionProgress(uid, 3, 2);
  assert.equal(T.sessionResult(uid, p).result, 'solved');
  T.sessionHint(uid, 3);
  assert.equal(T.sessionResult(uid, p).result, 'solved-hint');
  T.sessionSolution(uid, 3);
  assert.equal(T.sessionResult(uid, p).result, 'failed', 'solution vue → échec');
  T.recordAttempt(uid, 3, T.sessionResult(uid, p));
  assert.equal(T.getSession(uid, 3), null, 'session fermée après enregistrement');
});

test('catégorie sans thème d exercice (ouvertures) : repli sur un exercice au niveau, jamais d erreur', () => {
  const uid = makeUser('yann');
  for (let i = 0; i < 20; i++) {
    const r = T.pickPuzzle(uid, { category: 'openings' });
    assert.ok(r && r.puzzle, 'un exercice est toujours proposé');
  }
  const prog = T.pickProgramPuzzle(uid);
  assert.ok(prog && prog.puzzle);
});

test('révision due : proposée en priorité', () => {
  const uid = makeUser('dave');
  T.recordAttempt(uid, 2, { result: 'failed' });
  db.prepare("UPDATE puzzle_schedule SET due_at = '2000-01-01T00:00:00Z' WHERE user_id = ?").run(uid);
  const picked = T.pickPuzzle(uid, {});
  assert.equal(picked.reason, 'review');
  assert.equal(picked.puzzle.id, 2);
});

test('sélection par thème et exclusions', () => {
  const uid = makeUser('eve');
  const p = T.pickPuzzle(uid, { theme: 'mate-1' });
  assert.equal(p.puzzle.id, 1);
  const p2 = T.pickPuzzle(uid, { theme: 'mate-1', excludeIds: [1] });
  assert.ok(!p2 || p2.puzzle.id !== 1);
});

test('faiblesses : calculées à partir des erreurs de parties et des exercices, historisées', () => {
  const uid = makeUser('frank');
  // Une partie analysée avec 3 gaffes « matériel » et 1 imprécision « ouvertures »
  const g = db.prepare(`INSERT INTO games (user_id, user_color, ai_elo, status, result, user_score, elo_before, fen, finished_at) VALUES (?, 'white', 1000, 'finished', '0-1', 0, 1000, 'x', datetime('now'))`).run(uid);
  const a = db.prepare(`INSERT INTO analyses (game_id, user_id, status) VALUES (?, ?, 'done')`).run(g.lastInsertRowid, uid);
  const ins = db.prepare(`INSERT INTO error_events (user_id, game_id, analysis_id, ply, category, motif, severity, loss_cp) VALUES (?, ?, ?, ?, ?, ?, ?, 300)`);
  for (let i = 0; i < 3; i++) ins.run(uid, g.lastInsertRowid, a.lastInsertRowid, 10 + i, 'material', 'hanging-piece', 'blunder');
  ins.run(uid, g.lastInsertRowid, a.lastInsertRowid, 5, 'openings', 'development', 'inaccuracy');
  const w = T.computeWeaknesses(uid);
  assert.ok(w.material.score < 40, `matériel ${w.material.score}`);
  assert.ok(w.openings.score > w.material.score);
  assert.equal(w.tactics.score, 100, 'aucune erreur → 100');
  assert.equal(w.endgames.score, 100);
  // Historisé
  const rows = db.prepare('SELECT COUNT(*) AS n FROM weakness_scores WHERE user_id = ?').get(uid).n;
  assert.equal(rows, 8);
  const latest = T.latestWeaknesses(uid).find(x => x.category === 'material');
  assert.equal(latest.score, w.material.score);
  // Le programme cible la faiblesse
  const prog = T.dailyProgram(uid);
  assert.equal(prog.weakest[0], 'material');
  assert.ok(prog.slots.filter(s => s.category === 'material').length >= 3);
});

test('tirage de catégorie : les faiblesses sortent plus souvent', () => {
  const weaknesses = { material: { score: 10 }, tactics: { score: 95 } };
  let mat = 0;
  for (let i = 0; i < 2000; i++) if (T.pickCategory(weaknesses) === 'material') mat++;
  let tac = 0;
  for (let i = 0; i < 2000; i++) if (T.pickCategory(weaknesses) === 'tactics') tac++;
  assert.ok(mat > tac * 2, `${mat} vs ${tac}`);
});

test('thèmes : mat en 1, pièce en prise, clouage, enfilade, promotion', () => {
  assert.deepEqual(detectThemes('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', ['h5f7'], { mate: 1 }), ['mate-1']);
  assert.ok(detectThemes('r1bqkbnr/pppppppp/8/8/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', ['f3d4']).includes('hanging-piece'));
  // Clouage : Fb5 cloue le cavalier c6 sur le roi e8 (sans pion d7)
  const pin = new Chess('r1bqkbnr/ppp2ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4');
  assert.equal(pinOrSkewer(pin, 'b5'), 'pin');
  // Avec le pion d7 devant le roi, pas de clouage
  assert.equal(pinOrSkewer(new Chess('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'), 'b5'), null);
  // Enfilade : la dame devant le roi sur la colonne a
  assert.equal(pinOrSkewer(new Chess('4k3/q7/8/8/8/8/8/R3K3 w - - 0 1'), 'a1'), null);
  assert.equal(pinOrSkewer(new Chess('k7/q7/8/8/8/8/8/R3K3 w - - 0 1'), 'a1'), 'pin');
  assert.equal(pinOrSkewer(new Chess('r6k/q7/8/8/8/8/8/R3K3 w - - 0 1'), 'a1'), 'skewer');
  // Enfilade : Tour a1 attaque la dame a8 derrière laquelle se trouve le roi ? → Ta1 contre Da5 puis Ra8… on teste la géométrie : dame devant roi sur la colonne
  const sk = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  assert.equal(pinOrSkewer(sk, 'a1'), null);
  const sk2 = new Chess('q3k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  assert.equal(pinOrSkewer(sk2, 'a1'), null); // dame devant rien : pas d'enfilade
  const sk3 = new Chess('k7/8/8/8/8/8/8/R3K3 w - - 0 1');
  assert.equal(pinOrSkewer(sk3, 'a1'), null);
  const prom = detectThemes('8/P6k/8/8/8/8/8/4K3 w - - 0 1', ['a7a8q']);
  assert.ok(prom.includes('promotion'));
});

test('difficulté : mat en 1 plus facile qu une combinaison longue', () => {
  const easy = estimateRating({ solution: ['a'], mate: 1, gain: null, pieces: 10, themes: ['mate-1'] });
  const hard = estimateRating({ solution: ['a', 'b', 'c', 'd', 'e'], mate: null, gain: 300, pieces: 28, themes: ['discovered-attack'] });
  assert.ok(easy < hard);
  assert.ok(easy >= 400 && hard <= 2200);
});

test('chaque thème a une catégorie de faiblesse', () => {
  for (const [k, v] of Object.entries(THEMES)) assert.ok(T.CATEGORIES.includes(v.category), k);
  assert.equal(puzzleKey('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 5 9'), 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
});

test('programme du jour : compté dans le fuseau du joueur', async () => {
  const uid = makeUser('fuseau');
  // Tentative à 23:30 UTC hier : « aujourd'hui » à Zurich (UTC+1, donc 00:30 local), pas en Amérique
  const { startOfToday } = T;
  const zurich = startOfToday('Europe/Zurich'), ny = startOfToday('America/New_York');
  assert.ok(zurich.since <= new Date().toISOString() && ny.since <= new Date().toISOString());
  assert.equal(startOfToday('fuseau/bidon').since, startOfToday('UTC').since);
  db.prepare("INSERT INTO puzzle_attempts (user_id, puzzle_id, result, created_at) VALUES (?, 1, 'solved', ?)").run(uid, zurich.since);
  assert.equal(T.dailyProgram(uid, 'Europe/Zurich').done, 1);
  if (ny.since > zurich.since) assert.equal(T.dailyProgram(uid, 'America/New_York').done, 0);
});

test("difficulté d'un exercice affinée par les résultats (première tentative seulement)", () => {
  const strong = makeUser('fort', 1800), weak = makeUser('faible', 600);
  const before = T.getPuzzle(2).rating, attemptsBefore = T.getPuzzle(2).attempts;
  T.recordAttempt(weak, 2, { result: 'solved' });            // un faible réussit → l'exercice baisse
  const afterWeak = T.getPuzzle(2).rating;
  assert.ok(afterWeak < before, `${afterWeak} < ${before}`);
  T.recordAttempt(weak, 2, { result: 'failed' });            // révision : pas de changement
  assert.equal(T.getPuzzle(2).rating, afterWeak);
  T.recordAttempt(strong, 2, { result: 'failed' });          // un fort rate → l'exercice monte
  assert.ok(T.getPuzzle(2).rating > afterWeak);
  assert.equal(T.getPuzzle(2).attempts, attemptsBefore + 2);
  assert.equal(T.getPuzzle(2).rating_initial, 690);
});
