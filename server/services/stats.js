// Statistiques et progression : agrégations en lecture seule sur l'historique
// (parties, Elo, analyses, exercices). Tout est calculé à la demande ; aucune
// donnée n'est modifiée ici.
import { db } from '../db.js';
import { CATEGORIES_FR, winProb, moveAccuracy } from './analysis.js';
import { THEMES } from './puzzles.js';
import { CATEGORIES } from './training.js';

export const PERIODS = { '7': 7, '30': 30, '90': 90, '365': 365, all: null };

export function periodDays(raw) {
  const key = String(raw ?? '30');
  if (!Object.hasOwn(PERIODS, key)) return undefined;
  return PERIODS[key];
}

const DAY = 86400_000;
const iso = (ms) => new Date(ms).toISOString();
const day = (ts) => String(ts).slice(0, 10);
const pct = (num, den) => (den ? Math.round(1000 * num / den) / 10 : null);
const avg = (xs) => (xs.length ? Math.round(10 * xs.reduce((s, x) => s + x, 0) / xs.length) / 10 : null);

// Bornes [from, to) d'une période et de la période précédente de même longueur
function bounds(days, now = Date.now()) {
  if (days === null) return { from: null, to: iso(now), prevFrom: null, prevTo: null };
  const from = now - days * DAY;
  return { from: iso(from), to: iso(now), prevFrom: iso(from - days * DAY), prevTo: iso(from) };
}

// ---------------------------------------------------------------------------
// Parties

function finishedGames(userId, from, to) {
  return db.prepare(`SELECT g.id, g.user_color, g.ai_elo, g.ai_offset, g.time_control, g.termination, g.user_score, g.rated,
                            g.elo_delta, g.move_count, g.duration_s, g.finished_at,
                            a.accuracy_user, a.acpl_user, a.inaccuracies, a.mistakes, a.blunders
                     FROM games g
                     LEFT JOIN analyses a ON a.id = (SELECT MAX(id) FROM analyses WHERE game_id = g.id AND status = 'done')
                     WHERE g.user_id = ? AND g.status = 'finished'
                       AND (? IS NULL OR g.finished_at >= ?) AND g.finished_at < ?
                     ORDER BY g.finished_at ASC, g.id ASC`).all(userId, from, from, to);
}

function tally(games) {
  const t = { games: games.length, wins: 0, draws: 0, losses: 0 };
  for (const g of games) { if (g.user_score === 1) t.wins++; else if (g.user_score === 0.5) t.draws++; else t.losses++; }
  t.winRate = pct(t.wins, t.games);
  t.score = t.games ? Math.round(1000 * (t.wins + t.draws / 2) / t.games) / 10 : null; // points marqués en %
  return t;
}

function groupTally(games, key) {
  const groups = {};
  for (const g of games) (groups[g[key] ?? 'none'] ||= []).push(g);
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, tally(v)]));
}

function accuracy(games) {
  const analysed = games.filter(g => g.accuracy_user !== null && g.accuracy_user !== undefined);
  return {
    analysed: analysed.length,
    accuracy: avg(analysed.map(g => g.accuracy_user)),
    acpl: avg(analysed.filter(g => g.acpl_user !== null && g.acpl_user !== undefined).map(g => g.acpl_user)),
    perGame: {
      inaccuracies: avg(analysed.map(g => g.inaccuracies || 0)),
      mistakes: avg(analysed.map(g => g.mistakes || 0)),
      blunders: avg(analysed.map(g => g.blunders || 0)),
    },
  };
}

function streaks(games) {
  let best = 0, cur = 0, current = 0, worst = 0, curLoss = 0;
  for (const g of games) {
    if (g.user_score === 1) { cur++; curLoss = 0; } else if (g.user_score === 0) { curLoss++; cur = 0; } else { cur = 0; curLoss = 0; }
    best = Math.max(best, cur); worst = Math.max(worst, curLoss);
  }
  // série en cours (depuis la fin)
  for (let i = games.length - 1; i >= 0; i--) {
    if (games[i].user_score === 1 && (current >= 0)) { current++; } else if (games[i].user_score === 0 && current <= 0) { current--; } else break;
  }
  return { bestWin: best, worstLoss: worst, current };
}

// ---------------------------------------------------------------------------
// Elo

function eloCurve(userId, from, to) {
  const inPeriod = db.prepare(`SELECT game_id, elo_before, elo_after, delta, provisional, reason, created_at FROM rating_history
                               WHERE user_id = ? AND (? IS NULL OR created_at >= ?) AND created_at < ? ORDER BY created_at ASC, id ASC`).all(userId, from, from, to);
  // Point de départ : dernière valeur connue avant la période, sinon l'initialisation du compte
  const before = from ? db.prepare(`SELECT elo_after, provisional FROM rating_history WHERE user_id = ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT 1`).get(userId, from) : null;
  if (!inPeriod.length && !before) return { points: [], start: null, end: null, delta: 0, peak: null, low: null };
  const startElo = before ? before.elo_after : inPeriod[0].elo_before;
  const startAt = from ?? inPeriod[0].created_at;
  const points = [];
  // Point de départ synthétique, sauf si la période commence par la ligne d'initialisation du compte
  if (!(inPeriod[0]?.reason === 'init' && !before)) points.push({ t: startAt, elo: startElo, game_id: null, provisional: before ? before.provisional : 1 });
  for (const r of inPeriod) points.push({ t: r.created_at, elo: r.elo_after, delta: r.delta, game_id: r.game_id, provisional: r.provisional });
  const elos = points.map(p => p.elo);
  return { points, start: startElo, end: elos[elos.length - 1], delta: elos[elos.length - 1] - startElo, peak: Math.max(...elos), low: Math.min(...elos) };
}

// ---------------------------------------------------------------------------
// Exercices

function puzzleStats(userId, from, to) {
  const rows = db.prepare(`SELECT a.result, a.theme, a.time_ms, a.created_at FROM puzzle_attempts a
                           WHERE a.user_id = ? AND (? IS NULL OR a.created_at >= ?) AND a.created_at < ? ORDER BY a.created_at`).all(userId, from, from, to);
  const solved = rows.filter(r => r.result === 'solved').length;
  const withHint = rows.filter(r => r.result === 'solved-hint').length;
  const byCategory = {};
  for (const r of rows) {
    const cat = THEMES[r.theme]?.category || 'tactics';
    const c = (byCategory[cat] ||= { category: cat, label: CATEGORIES_FR[cat], attempts: 0, solved: 0 });
    c.attempts++; if (r.result === 'solved') c.solved++;
  }
  for (const c of Object.values(byCategory)) c.rate = pct(c.solved, c.attempts);
  const times = rows.filter(r => r.time_ms).map(r => r.time_ms / 1000);
  return { attempts: rows.length, solved, withHint, failed: rows.length - solved - withHint, rate: pct(solved, rows.length),
           avgTimeS: avg(times), byCategory: Object.values(byCategory).sort((a, b) => b.attempts - a.attempts) };
}

function themeRatings(userId) {
  const rows = db.prepare('SELECT theme, rating, attempts, solved, updated_at FROM theme_ratings WHERE user_id = ?').all(userId);
  return rows.filter(r => THEMES[r.theme]).map(r => ({ ...r, label: THEMES[r.theme].fr, category: THEMES[r.theme].category, rate: pct(r.solved, r.attempts) }))
             .sort((a, b) => b.attempts - a.attempts);
}

// ---------------------------------------------------------------------------
// Séries temporelles (par semaine ISO-like : lundi → dimanche, en UTC)

function weekStart(ts) {
  const d = new Date(ts);
  const dow = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - dow); d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function weeklyBuckets(from, to, weeks = 12) {
  const end = weekStart(to);
  const keys = [];
  let d = new Date(end + 'T00:00:00Z');
  const first = from ? weekStart(from) : null;
  for (let i = 0; i < 160; i++) {
    const k = d.toISOString().slice(0, 10);
    if (first && k < first) break;
    keys.unshift(k);
    if (!first && keys.length >= weeks) break;
    d = new Date(d.getTime() - 7 * DAY);
  }
  return keys;
}

// Période « tout » : de la première partie (ou tentative) à aujourd'hui, 12 semaines au minimum, 3 ans au plus
function activity(userId, games, from, to) {
  let start = from;
  if (!from) {
    const firstGame = games[0]?.finished_at;
    const firstAttempt = db.prepare('SELECT MIN(created_at) AS t FROM puzzle_attempts WHERE user_id = ?').get(userId).t;
    const earliest = [firstGame, firstAttempt].filter(Boolean).sort()[0];
    const twelve = new Date(Date.parse(to) - 11 * 7 * DAY).toISOString();
    start = earliest && earliest < twelve ? earliest : twelve;
  }
  const keys = weeklyBuckets(start, to);
  const set = new Set(keys);
  const g = Object.fromEntries(keys.map(k => [k, { week: k, games: 0, wins: 0, puzzles: 0, solved: 0, accuracy: [], blunders: [] }]));
  for (const x of games) { const k = weekStart(x.finished_at); if (!set.has(k)) continue; g[k].games++; if (x.user_score === 1) g[k].wins++; if (x.accuracy_user !== null && x.accuracy_user !== undefined) { g[k].accuracy.push(x.accuracy_user); g[k].blunders.push((x.blunders || 0) + (x.mistakes || 0)); } }
  const attempts = db.prepare(`SELECT result, created_at FROM puzzle_attempts WHERE user_id = ? AND created_at >= ? AND created_at < ?`)
    .all(userId, keys[0] + 'T00:00:00.000Z', to);
  for (const a of attempts) { const k = weekStart(a.created_at); if (!set.has(k)) continue; g[k].puzzles++; if (a.result === 'solved') g[k].solved++; }
  return keys.map(k => ({ week: k, games: g[k].games, wins: g[k].wins, puzzles: g[k].puzzles, solved: g[k].solved,
                          accuracy: avg(g[k].accuracy), errorsPerGame: avg(g[k].blunders) }));
}

// Historique des faiblesses (une valeur par jour et par catégorie, dernière du jour)
function weaknessHistory(userId, from, to) {
  const rows = db.prepare(`SELECT category, score, computed_at FROM weakness_scores WHERE user_id = ? AND (? IS NULL OR computed_at >= ?) AND computed_at < ?
                           ORDER BY computed_at ASC, id ASC`).all(userId, from, from, to);
  // Valeur connue juste avant la période, comme point de départ (sinon une période calme efface le profil)
  if (from) {
    const prev = db.prepare(`SELECT category, score FROM weakness_scores WHERE user_id = ? AND computed_at < ? AND id IN
                             (SELECT MAX(id) FROM weakness_scores WHERE user_id = ? AND computed_at < ? GROUP BY category)`).all(userId, from, userId, from);
    for (const r of prev) rows.unshift({ category: r.category, score: r.score, computed_at: from });
  }
  const series = Object.fromEntries(CATEGORIES.map(c => [c, {}]));
  for (const r of rows) if (series[r.category]) series[r.category][day(r.computed_at)] = r.score;
  const days = [...new Set(rows.map(r => day(r.computed_at)))].sort();
  return { days, series: CATEGORIES.map(c => ({ category: c, label: CATEGORIES_FR[c], values: days.map(d => series[c][d] ?? null) })) };
}

// Erreurs par catégorie dans la période (événements d'erreur des analyses)
function errorsByCategory(userId, from, to) {
  // Datées par la fin de la partie (et non par l'analyse, qui peut être relancée plus tard) ; seule la dernière analyse compte
  const rows = db.prepare(`SELECT e.category, e.severity, COUNT(*) AS n FROM error_events e
                           JOIN games g ON g.id = e.game_id AND g.user_id = e.user_id
                           WHERE e.user_id = ? AND g.status = 'finished' AND (? IS NULL OR g.finished_at >= ?) AND g.finished_at < ?
                             AND e.analysis_id = (SELECT MAX(id) FROM analyses WHERE game_id = g.id AND status = 'done')
                           GROUP BY e.category, e.severity`).all(userId, from, from, to);
  const out = Object.fromEntries(CATEGORIES.map(c => [c, { category: c, label: CATEGORIES_FR[c], inaccuracy: 0, mistake: 0, blunder: 0, total: 0 }]));
  for (const r of rows) if (out[r.category]) { out[r.category][r.severity] = r.n; out[r.category].total += r.n; }
  return Object.values(out).sort((a, b) => b.total - a.total);
}

// Journal d'entraînement : activités (regroupées par jour) et relevés d'Elo externes dans la période
function journalEvents(userId, from, to) {
  const rows = db.prepare(`SELECT id, kind, title, minutes, rating, platform, happened_on FROM training_log
                           WHERE user_id = ? AND deleted_at IS NULL AND (? IS NULL OR happened_on >= substr(?, 1, 10)) AND happened_on <= substr(?, 1, 10)
                           ORDER BY happened_on, id`).all(userId, from, from, to);
  const byDay = {};
  for (const r of rows) if (r.kind !== 'rating') (byDay[r.happened_on] ||= []).push(r);
  return {
    activities: Object.entries(byDay).map(([day, items]) => ({ day, minutes: items.reduce((s, i) => s + (i.minutes || 0), 0), items: items.map(i => ({ id: i.id, kind: i.kind, title: i.title, minutes: i.minutes })) })),
    ratings: rows.filter(r => r.kind === 'rating').map(r => ({ day: r.happened_on, rating: r.rating, platform: r.platform })),
    totalMinutes: rows.reduce((s, r) => s + (r.minutes || 0), 0),
  };
}

// Précision par phase de jeu (coups du joueur, dernière analyse de chaque partie de la période)
// Ouverture : coups 1–10 ; milieu : 11–30 ; finale : au-delà (approximation par le numéro de coup)
function phaseStats(userId, from, to) {
  const rows = db.prepare(`SELECT e.ply, e.eval_before, e.eval_after, e.loss_cp, e.label, g.user_color FROM move_evals e
                           JOIN games g ON g.id = e.game_id
                           WHERE g.user_id = ? AND e.by_user = 1 AND g.status = 'finished' AND (? IS NULL OR g.finished_at >= ?) AND g.finished_at < ?
                             AND e.analysis_id = (SELECT MAX(id) FROM analyses WHERE game_id = g.id AND status = 'done')`).all(userId, from, from, to);
  const phases = { opening: { label: 'Ouverture (coups 1–10)', moves: 0, acc: 0, loss: 0, blunders: 0, mistakes: 0 },
                   middlegame: { label: 'Milieu de partie (11–30)', moves: 0, acc: 0, loss: 0, blunders: 0, mistakes: 0 },
                   endgame: { label: 'Finale (31 et plus)', moves: 0, acc: 0, loss: 0, blunders: 0, mistakes: 0 } };
  for (const r of rows) {
    const moveNo = Math.ceil(r.ply / 2);
    const ph = phases[moveNo <= 10 ? 'opening' : moveNo <= 30 ? 'middlegame' : 'endgame'];
    const mover = r.user_color === 'white' ? 'w' : 'b';
    ph.moves++; ph.loss += Math.min(r.loss_cp, 1000);
    ph.acc += r.label === 'best' ? 100 : moveAccuracy(winProb(r.eval_before), winProb(r.eval_after), mover);
    if (r.label === 'blunder') ph.blunders++; else if (r.label === 'mistake') ph.mistakes++;
  }
  return Object.entries(phases).map(([k, p]) => ({ phase: k, label: p.label, moves: p.moves,
    accuracy: p.moves ? Math.round(10 * p.acc / p.moves) / 10 : null, acpl: p.moves ? Math.round(p.loss / p.moves) : null,
    errorRate: p.moves ? Math.round(1000 * (p.blunders + p.mistakes) / p.moves) / 10 : null }));
}

// ---------------------------------------------------------------------------
// Points d'entrée

export function statistics(userId, days = 30, now = Date.now()) {
  const b = bounds(days, now);
  const games = finishedGames(userId, b.from, b.to);
  const prevGames = days === null ? [] : finishedGames(userId, b.prevFrom, b.prevTo);
  const elo = eloCurve(userId, b.from, b.to);
  const prevElo = days === null ? null : eloCurve(userId, b.prevFrom, b.prevTo);
  const puzzles = puzzleStats(userId, b.from, b.to);
  const prevPuzzles = days === null ? null : puzzleStats(userId, b.prevFrom, b.prevTo);
  const acc = accuracy(games), prevAcc = accuracy(prevGames);
  const rated = games.filter(g => g.rated);
  return {
    period: { days, from: b.from, to: b.to },
    results: { ...tally(games), rated: rated.length, unrated: games.length - rated.length, streaks: streaks(games),
               byColor: groupTally(games, 'user_color'), byTimeControl: groupTally(games, 'time_control'),
               byOpponent: groupTally(games, 'ai_offset'), byTermination: groupTally(games, 'termination'),
               avgMoves: avg(games.map(g => Math.ceil(g.move_count / 2))), avgDurationS: avg(games.filter(g => g.duration_s).map(g => g.duration_s)) },
    accuracy: acc,
    errors: errorsByCategory(userId, b.from, b.to),
    phases: phaseStats(userId, b.from, b.to),
    puzzles,
    elo: { start: elo.start, end: elo.end, delta: elo.delta, peak: elo.peak, low: elo.low },
    comparison: days === null ? null : {
      previous: { from: b.prevFrom, to: b.prevTo },
      games: { now: games.length, before: prevGames.length },
      winRate: { now: tally(games).winRate, before: tally(prevGames).winRate },
      score: { now: tally(games).score, before: tally(prevGames).score },
      accuracy: { now: acc.accuracy, before: prevAcc.accuracy },
      blundersPerGame: { now: acc.perGame.blunders, before: prevAcc.perGame.blunders },
      eloDelta: { now: elo.delta, before: prevElo.delta },
      puzzleRate: { now: puzzles.rate, before: prevPuzzles.rate },
      puzzlesSolved: { now: puzzles.solved, before: prevPuzzles.solved },
    },
  };
}

export function progression(userId, days = 30, now = Date.now()) {
  const b = bounds(days, now);
  const games = finishedGames(userId, b.from, b.to);
  const analysed = games.filter(g => g.accuracy_user !== null && g.accuracy_user !== undefined);
  return {
    period: { days, from: b.from, to: b.to },
    elo: eloCurve(userId, b.from, b.to),
    games: analysed.map(g => ({ id: g.id, t: g.finished_at, accuracy: g.accuracy_user, acpl: g.acpl_user, inaccuracies: g.inaccuracies || 0,
                                mistakes: g.mistakes || 0, blunders: g.blunders || 0, score: g.user_score, ai_elo: g.ai_elo })),
    summary: { ...tally(games), analysed: analysed.length, accuracy: avg(analysed.map(g => g.accuracy_user)), puzzles: puzzleStats(userId, b.from, b.to) },
    weaknesses: weaknessHistory(userId, b.from, b.to),
    journal: journalEvents(userId, b.from, b.to),
    themes: themeRatings(userId),
    activity: activity(userId, games, b.from, b.to),
  };
}
