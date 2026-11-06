// Entraînement : bibliothèque, sélection des exercices, répétition espacée, niveaux par thème,
// profil de faiblesses (cahier des charges, sections 8 et 9).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { db } from '../db.js';
import { THEMES, puzzleKey, verifyPuzzle } from './puzzles.js';
import { CATEGORIES_FR } from './analysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY_FILE = process.env.PUZZLE_LIBRARY || path.join(__dirname, '..', 'puzzles', 'library.json');

export const CATEGORIES = Object.keys(CATEGORIES_FR);
export const WEAK_THRESHOLD = 40;
export const STRONG_THRESHOLD = 70;
const SRS_INTERVALS = [1, 3, 7, 21]; // jours ; au-delà, l'exercice est maîtrisé

// ---------------------------------------------------------------------------
// Bibliothèque
// ---------------------------------------------------------------------------
export function loadLibrary(file = LIBRARY_FILE) {
  if (!fs.existsSync(file)) return 0;
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const insert = db.prepare(`INSERT OR IGNORE INTO puzzles (source, fen, fen_key, solution, themes, rating, rating_initial, mate_in, gain_cp)
                             VALUES ('library', ?, ?, ?, ?, ?, ?, ?, ?)`);
  // Mise à jour des thèmes et de l'estimation d'origine ; la difficulté apprise (rating) n'est
  // réinitialisée que si l'exercice n'a encore jamais été tenté
  const retag = db.prepare(`UPDATE puzzles SET themes = ?, rating_initial = ?, rating = CASE WHEN attempts = 0 THEN ? ELSE rating END
                            WHERE source = 'library' AND fen_key = ? AND user_id IS NULL AND (themes != ? OR rating_initial IS NOT ?)`);
  let added = 0;
  db.transaction(() => {
    for (const p of list) {
      const key = puzzleKey(p.fen), themes = JSON.stringify(p.themes);
      const r = insert.run(p.fen, key, JSON.stringify(p.solution), themes, p.rating, p.rating, p.mate ?? null, p.gain ?? null);
      added += r.changes;
      if (!r.changes) retag.run(themes, p.rating, p.rating, key, themes, p.rating);
    }
  })();
  if (added) console.log(`[training] bibliothèque : ${added} exercice(s) ajouté(s)`);
  return added;
}

export const themeCategory = (theme) => THEMES[theme]?.category || 'tactics';
const mainTheme = (themes) => themes.find(t => t !== 'endgame') || themes[0];

// ---------------------------------------------------------------------------
// Exercices tirés des parties du joueur
// ---------------------------------------------------------------------------
const PUZZLE_MOTIFS = new Set(['missed-capture', 'missed-mate', 'missed-fork', 'hanging-piece', 'ignored-threat', 'calculation', 'allowed-fork']);

export async function createPuzzlesFromGame(gameId, { max = 3 } = {}) {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  if (!game) return [];
  const analysis = db.prepare('SELECT id FROM analyses WHERE game_id = ? AND status = ? ORDER BY id DESC LIMIT 1').get(gameId, 'done');
  if (!analysis) return [];
  const rows = db.prepare('SELECT ply, loss_cp, label, motifs FROM move_evals WHERE analysis_id = ? AND by_user = 1 AND loss_cp >= 150 ORDER BY loss_cp DESC LIMIT 8').all(analysis.id);
  const moves = db.prepare('SELECT ply, fen_after FROM moves WHERE game_id = ? ORDER BY ply').all(gameId);
  const fenBefore = (ply) => (ply === 1 ? new Chess().fen() : moves[ply - 2].fen_after);
  const created = [];
  for (const r of rows) {
    if (created.length >= max) break;
    const motifs = JSON.parse(r.motifs || '[]');
    if (!motifs.some(m => PUZZLE_MOTIFS.has(m)) && r.label !== 'blunder') continue;
    const fen = fenBefore(r.ply);
    const key = puzzleKey(fen);
    if (db.prepare('SELECT id FROM puzzles WHERE fen_key = ? AND user_id = ?').get(key, game.user_id)) continue;
    const puzzle = await verifyPuzzle(fen);
    if (!puzzle) continue;
    const info = db.prepare(`INSERT INTO puzzles (source, user_id, game_id, ply, fen, fen_key, solution, themes, rating, rating_initial, mate_in, gain_cp)
                             VALUES ('game', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(game.user_id, gameId, r.ply, fen, key, JSON.stringify(puzzle.solution), JSON.stringify(puzzle.themes), puzzle.rating, puzzle.rating, puzzle.mate, puzzle.gain);
    created.push(info.lastInsertRowid);
  }
  return created;
}

// ---------------------------------------------------------------------------
// Niveaux par thème (Elo d'exercice)
// ---------------------------------------------------------------------------
export function themeRating(userId, theme) {
  const row = db.prepare('SELECT * FROM theme_ratings WHERE user_id = ? AND theme = ?').get(userId, theme);
  if (row) return row;
  const user = db.prepare('SELECT elo FROM users WHERE id = ?').get(userId);
  return { user_id: userId, theme, rating: user?.elo ?? 1000, attempts: 0, solved: 0 };
}

export function updateThemeRating(userId, theme, puzzleRating, score) {
  const cur = themeRating(userId, theme);
  const k = cur.attempts < 10 ? 48 : 24;
  const expected = 1 / (1 + Math.pow(10, (puzzleRating - cur.rating) / 400));
  const after = Math.max(300, Math.round(cur.rating + k * (score - expected)));
  db.prepare(`INSERT INTO theme_ratings (user_id, theme, rating, attempts, solved, updated_at) VALUES (?, ?, ?, 1, ?, ?)
              ON CONFLICT(user_id, theme) DO UPDATE SET rating = excluded.rating, attempts = attempts + 1, solved = solved + excluded.solved, updated_at = excluded.updated_at`)
    .run(userId, theme, after, score >= 0.5 ? 1 : 0, new Date().toISOString());
  return { before: cur.rating, after };
}

// Elo de l'exercice : K décroissant avec le nombre de tentatives (32 → 8), bornes 400–2500
export function updatePuzzleRating(p, playerRating, score) {
  const k = Math.max(8, 32 / (1 + (p.attempts || 0) / 10));
  const expected = 1 / (1 + Math.pow(10, (playerRating - p.rating) / 400)); // chance que l'exercice « gagne » (soit raté)
  const after = Math.max(400, Math.min(2500, Math.round(p.rating + k * ((1 - score) - expected))));
  db.prepare('UPDATE puzzles SET rating = ?, attempts = attempts + 1, solved = solved + ? WHERE id = ?').run(after, score >= 0.5 ? 1 : 0, p.id);
  return after;
}

// ---------------------------------------------------------------------------
// Profil de faiblesses (scores 0-100 par catégorie)
// ---------------------------------------------------------------------------
export function computeWeaknesses(userId, { persist = true } = {}) {
  // Erreurs des 20 dernières parties analysées, pondérées par récence et gravité
  const games = db.prepare(`SELECT g.id FROM games g JOIN analyses a ON a.game_id = g.id AND a.status = 'done'
                            WHERE g.user_id = ? ORDER BY g.finished_at DESC LIMIT 20`).all(userId).map(r => r.id);
  const weightOf = (i) => 1 - 0.6 * (i / Math.max(1, games.length - 1)); // 1 (récente) → 0.4 (ancienne)
  const errors = {}; let gameWeight = 0;
  games.forEach((gid, i) => {
    const w = weightOf(i); gameWeight += w;
    const rows = db.prepare('SELECT category, severity FROM error_events WHERE game_id = ? AND user_id = ?').all(gid, userId);
    for (const r of rows) errors[r.category] = (errors[r.category] || 0) + w * (r.severity === 'blunder' ? 3 : r.severity === 'mistake' ? 2 : 1);
  });
  // Réussite récente aux exercices par catégorie (30 dernières tentatives)
  const attempts = db.prepare(`SELECT a.result, p.themes FROM puzzle_attempts a JOIN puzzles p ON p.id = a.puzzle_id
                               WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 30`).all(userId);
  const puzzle = {};
  for (const a of attempts) {
    const cat = themeCategory(mainTheme(JSON.parse(a.themes)));
    puzzle[cat] ??= { n: 0, ok: 0 };
    puzzle[cat].n++; if (a.result !== 'failed') puzzle[cat].ok += a.result === 'solved' ? 1 : 0.5;
  }

  const out = {};
  const insert = db.prepare('INSERT INTO weakness_scores (user_id, category, score, errors_20g, puzzle_rate) VALUES (?, ?, ?, ?, ?)');
  for (const cat of CATEGORIES) {
    const perGame = gameWeight ? (errors[cat] || 0) / gameWeight : null;
    const gameScore = perGame === null ? null : 100 * Math.exp(-0.55 * perGame);
    const pz = puzzle[cat] && puzzle[cat].n >= 3 ? puzzle[cat].ok / puzzle[cat].n : null;
    let score = null;
    if (gameScore !== null && pz !== null) score = 0.65 * gameScore + 0.35 * 100 * pz;
    else if (gameScore !== null) score = gameScore;
    else if (pz !== null) score = 100 * pz;
    const s = score === null ? null : Math.round(Math.max(0, Math.min(100, score)));
    out[cat] = { category: cat, label: CATEGORIES_FR[cat], score: s, errorsPerGame: perGame === null ? null : Math.round(perGame * 10) / 10, puzzleRate: pz === null ? null : Math.round(pz * 100) };
    if (persist && s !== null) {
      const last = db.prepare('SELECT score, computed_at FROM weakness_scores WHERE user_id = ? AND category = ? ORDER BY id DESC LIMIT 1').get(userId, cat);
      const stale = !last || last.score !== s || last.computed_at < new Date(Date.now() - 86400_000).toISOString();
      if (stale) insert.run(userId, cat, s, Math.round((errors[cat] || 0) * 10), pz);
    }
  }
  return out;
}

export function latestWeaknesses(userId) {
  const rows = db.prepare(`SELECT category, score, computed_at FROM weakness_scores WHERE user_id = ? AND id IN
                           (SELECT MAX(id) FROM weakness_scores WHERE user_id = ? GROUP BY category)`).all(userId, userId);
  const map = Object.fromEntries(rows.map(r => [r.category, r]));
  return CATEGORIES.map(c => ({ category: c, label: CATEGORIES_FR[c], score: map[c]?.score ?? null, computed_at: map[c]?.computed_at ?? null }));
}

// ---------------------------------------------------------------------------
// Sélection des exercices
// ---------------------------------------------------------------------------
const themesOfCategory = (cat) => Object.entries(THEMES).filter(([, v]) => v.category === cat).map(([k]) => k);

export function dueReviews(userId, limit = 10) {
  return db.prepare(`SELECT s.puzzle_id FROM puzzle_schedule s WHERE s.user_id = ? AND s.retired = 0 AND s.due_at <= ?
                     ORDER BY s.due_at LIMIT ?`).all(userId, new Date().toISOString(), limit).map(r => r.puzzle_id);
}

function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Catégorie à travailler : tirage pondéré par la faiblesse (score bas = poids fort)
export function pickCategory(weaknesses, rng = Math.random) {
  const items = CATEGORIES.map(c => ({ c, w: weaknesses[c]?.score === null || weaknesses[c]?.score === undefined ? 1 : 0.3 + (100 - weaknesses[c].score) / 40 }));
  const total = items.reduce((s, i) => s + i.w, 0);
  let r = rng() * total;
  for (const i of items) { r -= i.w; if (r <= 0) return i.c; }
  return items[items.length - 1].c;
}

/**
 * pickPuzzle(userId, { theme, category, excludeIds })
 *  Priorité : révisions dues → exercices personnels non tentés → bibliothèque au bon niveau.
 */
export function pickPuzzle(userId, { theme = null, category = null, excludeIds = [], includeDue = true } = {}) {
  const ex = new Set(excludeIds);
  if (includeDue && !theme && !category) {
    for (const id of dueReviews(userId, 20)) if (!ex.has(id)) return { puzzle: getPuzzle(id), reason: 'review' };
  }
  const weaknesses = latestWeaknesses(userId).reduce((m, w) => { m[w.category] = w; return m; }, {});
  const cat = category || (theme ? themeCategory(theme) : pickCategory(weaknesses));
  const themes = theme ? [theme] : themesOfCategory(cat);
  if (!themes.length) return fallbackPuzzle(userId, ex, cat); // catégorie sans thème d'exercice (ex. ouvertures)
  const level = Math.round(themes.reduce((s, t) => s + themeRating(userId, t).rating, 0) / themes.length);
  // Exclus : tentés dans les 7 jours, et tous ceux déjà planifiés (ils reviendront par la révision)
  const recent = new Set([
    ...db.prepare("SELECT puzzle_id FROM puzzle_attempts WHERE user_id = ? AND created_at >= datetime('now', '-7 days')").all(userId).map(r => r.puzzle_id),
    ...db.prepare('SELECT puzzle_id FROM puzzle_schedule WHERE user_id = ?').all(userId).map(r => r.puzzle_id),
  ]);
  const themeClause = themes.map(() => "themes LIKE ?").join(' OR ');
  const params = themes.map(t => `%"${t}"%`);
  // Exercices personnels d'abord
  const own = db.prepare(`SELECT p.id FROM puzzles p LEFT JOIN puzzle_attempts a ON a.puzzle_id = p.id AND a.user_id = p.user_id
                          WHERE p.user_id = ? AND (${themeClause}) AND a.id IS NULL ORDER BY p.created_at DESC LIMIT 50`).all(userId, ...params)
    .filter(p => !ex.has(p.id) && !recent.has(p.id));
  if (own.length) return { puzzle: getPuzzle(randomPick(own).id), reason: 'own', category: cat };
  for (const spread of [150, 300, 600, 2000]) {
    const rows = db.prepare(`SELECT id FROM puzzles WHERE source = 'library' AND (${themeClause}) AND rating BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 40`)
      .all(...params, level - spread, level + spread).filter(p => !ex.has(p.id) && !recent.has(p.id));
    if (rows.length) return { puzzle: getPuzzle(randomPick(rows).id), reason: 'level', category: cat };
  }
  return fallbackPuzzle(userId, new Set([...ex, ...recent]), cat);
}

// N'importe quel exercice de la bibliothèque proche du niveau général du joueur
function fallbackPuzzle(userId, excluded, cat) {
  const user = db.prepare('SELECT elo FROM users WHERE id = ?').get(userId);
  const any = db.prepare(`SELECT id FROM puzzles WHERE source = 'library' ORDER BY ABS(rating - ?) LIMIT 60`).all(user?.elo ?? 1000).filter(p => !excluded.has(p.id));
  return any.length ? { puzzle: getPuzzle(randomPick(any).id), reason: 'fallback', category: cat } : null;
}

// Prochain exercice du programme du jour : suit les créneaux dans l'ordre
export function pickProgramPuzzle(userId, excludeIds = [], tz = null) {
  const program = dailyProgram(userId, tz);
  const slot = program.slots[program.done] || program.slots[program.slots.length - 1];
  if (!slot) return pickPuzzle(userId, { excludeIds });
  if (slot.label === 'Révision') {
    const ex = new Set(excludeIds);
    for (const id of dueReviews(userId, 20)) if (!ex.has(id)) return { puzzle: getPuzzle(id), reason: 'review', slot };
  }
  const picked = pickPuzzle(userId, { category: slot.category, excludeIds, includeDue: false });
  return picked ? { ...picked, slot } : null;
}

export function getPuzzle(id) {
  const p = db.prepare('SELECT * FROM puzzles WHERE id = ?').get(id);
  if (!p) return null;
  return { ...p, solution: JSON.parse(p.solution), themes: JSON.parse(p.themes) };
}

// Vue client : sans la solution
export function publicPuzzle(p, extra = {}) {
  const chess = new Chess(p.fen);
  return {
    id: p.id, fen: p.fen, turn: chess.turn() === 'w' ? 'white' : 'black', themes: p.themes,
    themeLabels: p.themes.map(t => THEMES[t]?.fr || t), rating: p.rating, source: p.source, game_id: p.game_id, ply: p.ply,
    length: Math.ceil(p.solution.length / 2), ...extra,
  };
}

// ---------------------------------------------------------------------------
// Tentatives et répétition espacée
// ---------------------------------------------------------------------------
export function recordAttempt(userId, puzzleId, { result, hints = 0, time_ms = null }) {
  const p = getPuzzle(puzzleId);
  if (!p) throw new Error('Exercice introuvable.');
  if (!['solved', 'solved-hint', 'failed'].includes(result)) throw new Error('Résultat invalide.');
  const theme = mainTheme(p.themes);
  const score = result === 'solved' ? 1 : result === 'solved-hint' ? 0.5 : 0;
  const firstTry = !db.prepare('SELECT 1 FROM puzzle_attempts WHERE user_id = ? AND puzzle_id = ? LIMIT 1').get(userId, puzzleId);
  const { before, after } = updateThemeRating(userId, theme, p.rating, score);
  db.prepare(`INSERT INTO puzzle_attempts (user_id, puzzle_id, result, hints, time_ms, rating_before, rating_after, theme) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, puzzleId, result, hints, time_ms, before, after, theme);
  // La difficulté de l'exercice apprend des premières tentatives (comme un Elo d'exercice) :
  // un exercice que des joueurs faibles réussissent baisse, un exercice que des joueurs forts ratent monte.
  if (firstTry) updatePuzzleRating(p, before, score);

  // Répétition espacée (SM-2 simplifié)
  // Répétition espacée (SM-2 simplifié) : un exercice réussi du premier coup est maîtrisé et ne revient pas ;
  // un échec le fait revenir le lendemain, puis 3, 7 et 21 jours après chaque réussite ; un indice ne fait pas progresser.
  const cur = db.prepare('SELECT * FROM puzzle_schedule WHERE user_id = ? AND puzzle_id = ?').get(userId, puzzleId);
  let reps = cur?.reps ?? 0, lapses = cur?.lapses ?? 0, interval, retired = 0;
  if (result === 'failed') { reps = 0; lapses++; interval = 1; }
  else if (result === 'solved-hint') { interval = 1; }
  else if (!cur) { retired = 1; interval = 365; }
  else { reps++; if (reps > SRS_INTERVALS.length) { retired = 1; interval = 365; } else interval = SRS_INTERVALS[reps - 1]; }
  // Échéance au début de journée (UTC) : un échec le soir est bien dû le lendemain matin
  const due = new Date(Date.now() + interval * 86400_000); due.setUTCHours(0, 0, 0, 0);
  const dueIso = due.toISOString();
  db.prepare(`INSERT INTO puzzle_schedule (user_id, puzzle_id, due_at, interval_days, reps, lapses, retired, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, puzzle_id) DO UPDATE SET due_at = excluded.due_at, interval_days = excluded.interval_days, reps = excluded.reps,
              lapses = excluded.lapses, retired = excluded.retired, updated_at = excluded.updated_at`)
    .run(userId, puzzleId, dueIso, interval, reps, lapses, retired, new Date().toISOString());
  db.prepare('DELETE FROM puzzle_sessions WHERE user_id = ? AND puzzle_id = ?').run(userId, puzzleId);

  computeWeaknesses(userId);
  return { theme, rating_before: before, rating_after: after, next_due: dueIso, retired: !!retired };
}

// ---------------------------------------------------------------------------
// Programme du jour et vue d'ensemble
// ---------------------------------------------------------------------------
// Début du jour courant dans le fuseau de l'utilisateur (ISO UTC) ; fuseau inconnu → UTC
export function startOfToday(tz) {
  let zone = 'UTC';
  try { if (tz) { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); zone = tz; } } catch { /* fuseau invalide */ }
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); // YYYY-MM-DD
  // Décalage du fuseau à cet instant : différence entre l'heure locale « lue comme UTC » et l'heure UTC réelle
  const local = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now).replace(', ', 'T').replace(' ', 'T') + 'Z');
  const offsetMs = local.getTime() - now.getTime() + (now.getMilliseconds());
  return { date: day, since: new Date(Date.parse(day + 'T00:00:00Z') - Math.round(offsetMs / 60000) * 60000).toISOString() };
}

export function dailyProgram(userId, tz = null) {
  const weaknesses = latestWeaknesses(userId);
  const known = weaknesses.filter(w => w.score !== null).sort((a, b) => a.score - b.score);
  const due = dueReviews(userId, 10).length;
  const slots = [];
  const weakest = known.slice(0, 2);
  for (const w of weakest) for (let i = 0; i < 3; i++) slots.push({ category: w.category, label: w.label, reason: `Faiblesse : ${w.label} (${w.score}/100)` });
  for (let i = 0; i < Math.min(3, due); i++) slots.push({ category: null, label: 'Révision', reason: 'Exercice à revoir (répétition espacée)' });
  slots.push({ category: 'endgames', label: CATEGORIES_FR.endgames, reason: 'Entretien des finales' });
  slots.push({ category: 'calculation', label: CATEGORIES_FR.calculation, reason: 'Entretien du calcul' });
  while (slots.length < 12) slots.push({ category: null, label: 'Mixte', reason: 'Exercice au niveau, thème varié' });
  const { date, since } = startOfToday(tz);
  const done = db.prepare("SELECT COUNT(*) AS n FROM puzzle_attempts WHERE user_id = ? AND created_at >= ?").get(userId, since).n;
  return { date, total: slots.length, done: Math.min(done, slots.length), due, slots, weakest: weakest.map(w => w.category) };
}

export function overview(userId, tz = null) {
  let weaknesses = latestWeaknesses(userId);
  if (weaknesses.every(w => w.score === null)) { computeWeaknesses(userId); weaknesses = latestWeaknesses(userId); }
  const themes = Object.entries(THEMES).map(([k, v]) => {
    const r = themeRating(userId, k);
    const available = db.prepare(`SELECT COUNT(*) AS n FROM puzzles WHERE (source = 'library' OR user_id = ?) AND themes LIKE ?`).get(userId, `%"${k}"%`).n;
    return { theme: k, label: v.fr, category: v.category, rating: r.rating, attempts: r.attempts, solved: r.solved, available };
  });
  const totals = db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN result != 'failed' THEN 1 ELSE 0 END) AS ok FROM puzzle_attempts WHERE user_id = ?`).get(userId);
  const own = db.prepare("SELECT COUNT(*) AS n FROM puzzles WHERE user_id = ?").get(userId).n;
  return { weaknesses, themes, program: dailyProgram(userId, tz), totals: { attempts: totals.n || 0, solved: totals.ok || 0 }, ownPuzzles: own, due: dueReviews(userId, 50).length };
}

// ---------------------------------------------------------------------------
// Session de résolution : l'état d'une tentative vit côté serveur
// ---------------------------------------------------------------------------
export function openSession(userId, puzzleId) {
  db.prepare(`INSERT INTO puzzle_sessions (user_id, puzzle_id, progress, hints, solution_seen, started_at) VALUES (?, ?, 0, 0, 0, ?)
              ON CONFLICT(user_id, puzzle_id) DO UPDATE SET progress = 0, hints = 0, solution_seen = 0, started_at = excluded.started_at`)
    .run(userId, puzzleId, new Date().toISOString());
}
export function getSession(userId, puzzleId) {
  return db.prepare('SELECT * FROM puzzle_sessions WHERE user_id = ? AND puzzle_id = ?').get(userId, puzzleId) || null;
}
export function sessionProgress(userId, puzzleId, progress) {
  db.prepare('UPDATE puzzle_sessions SET progress = MAX(progress, ?) WHERE user_id = ? AND puzzle_id = ?').run(progress, userId, puzzleId);
}
export function sessionHint(userId, puzzleId) {
  db.prepare('UPDATE puzzle_sessions SET hints = hints + 1 WHERE user_id = ? AND puzzle_id = ?').run(userId, puzzleId);
}
export function sessionSolution(userId, puzzleId) {
  db.prepare('UPDATE puzzle_sessions SET solution_seen = 1 WHERE user_id = ? AND puzzle_id = ?').run(userId, puzzleId);
}
// Résultat déduit de la session (jamais du client)
export function sessionResult(userId, puzzle) {
  const sess = getSession(userId, puzzle.id);
  if (!sess) return null;
  const needed = Math.ceil(puzzle.solution.length / 2);
  if (sess.solution_seen || sess.progress < needed) return { result: 'failed', hints: sess.hints, time_ms: Date.now() - new Date(sess.started_at).getTime() };
  return { result: sess.hints > 0 ? 'solved-hint' : 'solved', hints: sess.hints, time_ms: Date.now() - new Date(sess.started_at).getTime() };
}
