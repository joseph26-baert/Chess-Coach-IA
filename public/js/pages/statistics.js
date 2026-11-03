// Page Statistiques : résultats (par couleur, cadence, adversaire, fin de partie), précision,
// erreurs par catégorie, exercices, et comparaison avec la période précédente.
import { html } from '../ui.js';
import { api } from '../api.js';
import { barChart, themeColors, withAlpha } from '../charts.js';
import { TIME_CONTROL_LABELS, OFFSET_LABELS, TERMINATIONS } from '../chess-labels.js';
import { header, tile, currentPeriod, periodLabel, n, delta, PERIODS } from './stats-common.js';

let charts = [];
let mountGen = 0;
export function unmount() { mountGen++; for (const c of charts) c.destroy(); charts = []; }

export async function render(main) {
  const gen = ++mountGen;
  const period = currentPeriod();
  const s = await api.get(`/stats?period=${period}`);
  if (gen !== mountGen) return;
  const c = themeColors();
  const r = s.results;
  // Conserve un graphique si la page est toujours affichée, sinon le détruit (navigation pendant le chargement)
  const keep = (ch) => { if (gen !== mountGen) { ch.destroy(); return false; } charts.push(ch); return true; };

  const segment = (t) => t.games ? html`
    <div class="result-bar" role="img" aria-label="${t.wins} victoires, ${t.draws} nulles, ${t.losses} défaites">
      ${t.wins ? html`<div class="seg win" style="flex:${t.wins}">${t.wins}</div>` : ''}
      ${t.draws ? html`<div class="seg draw" style="flex:${t.draws}">${t.draws}</div>` : ''}
      ${t.losses ? html`<div class="seg loss" style="flex:${t.losses}">${t.losses}</div>` : ''}
    </div>` : '';
  const breakdown = (title, groups, labels, order) => {
    const keys = (order || Object.keys(groups)).filter(k => groups[k]);
    if (!keys.length) return '';
    return html`<h4>${title}</h4>${keys.map(k => html`
      <div class="breakdown-row"><span class="k">${labels[k] || k}</span>${segment(groups[k])}<span class="v">${n(groups[k].score, ' %')}</span></div>`)}`;
  };

  const cmp = s.comparison;
  const signed = (v, suffix) => (v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v + suffix);
  const cmpRow = (label, v, suffix = '', higherIsBetter = true, signedValues = false) => {
    if (!v) return '';
    const d = v.now === null || v.before === null ? null : Math.round(10 * (v.now - v.before)) / 10;
    const cls = d === null || d === 0 ? 'delta-zero' : (d > 0) === higherIsBetter ? 'delta-pos' : 'delta-neg';
    const fmt = signedValues ? (x) => signed(x, suffix) : (x) => n(x, suffix);
    return html`<div class="cmp-row"><span class="k">${label}</span><span>${fmt(v.before)}</span><span class="now">${fmt(v.now)}</span><span class="${cls}">${signed(d, suffix)}</span></div>`;
  };
  const prevLabel = { 7: '7 jours précédents', 30: '30 jours précédents', 90: '3 mois précédents', 365: '12 mois précédents' }[period];

  main.innerHTML = html`
    <div id="stats-root">
    ${header({ title: 'Statistiques', subtitle: `Vos chiffres sur ${periodLabel(period)}.`, active: 'statistiques', period })}

    <div class="grid grid-4">
      ${tile('Parties', r.games, r.games ? `${r.wins} V · ${r.draws} N · ${r.losses} D` : 'Aucune partie sur la période')}
      ${tile('Score', n(r.score, ' %'), r.games ? `${n(r.winRate)} % de victoires` : '')}
      ${tile('Précision', n(s.accuracy.accuracy, ' %'), s.accuracy.analysed ? `${s.accuracy.perGame.blunders} gaffe${s.accuracy.perGame.blunders > 1 ? 's' : ''} par partie en moyenne` : 'Aucune partie analysée')}
      ${tile('Exercices', n(s.puzzles.rate, ' %'), s.puzzles.attempts ? `${s.puzzles.solved} réussis sur ${s.puzzles.attempts}` : 'Aucun exercice sur la période')}
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Résultats</h3>
        ${r.games ? html`
          ${segment(r)}
          <div class="legend-row"><span><i class="sw win"></i>Victoires</span><span><i class="sw draw"></i>Nulles</span><span><i class="sw loss"></i>Défaites</span></div>
          ${breakdown('Par couleur', r.byColor, { white: 'Avec les blancs', black: 'Avec les noirs' }, ['white', 'black'])}
          ${breakdown('Par cadence', r.byTimeControl, TIME_CONTROL_LABELS, Object.keys(TIME_CONTROL_LABELS))}
          ${breakdown("Selon la force de l'IA", r.byOpponent, { weaker: 'IA plus faible', equal: 'IA de votre niveau', stronger: 'IA plus forte' }, ['weaker', 'equal', 'stronger'])}
          <p class="setup-hint">Score = points marqués (victoire 1, nulle ½) en pourcentage.</p>`
        : html`<div class="empty">Aucune partie terminée sur cette période.</div>`}
      </div>

      <div class="card">
        <h3>${cmp ? `Par rapport aux ${prevLabel}` : 'Vue d\'ensemble'}</h3>
        ${cmp ? html`
          <div class="cmp-row cmp-head"><span></span><span>Avant</span><span class="now">Maintenant</span><span>Évolution</span></div>
          ${cmpRow('Parties jouées', cmp.games)}
          ${cmpRow('Score', cmp.score, ' %')}
          ${cmpRow('Victoires', cmp.winRate, ' %')}
          ${cmpRow('Variation Elo', cmp.eloDelta, '', true, true)}
          ${cmpRow('Précision', cmp.accuracy, ' %')}
          ${cmpRow('Gaffes par partie', cmp.blundersPerGame, '', false)}
          ${cmpRow('Exercices réussis', cmp.puzzleRate, ' %')}
          ${cmpRow('Exercices résolus', cmp.puzzlesSolved)}
          <p class="setup-hint" style="margin-top:8px">Vert : amélioration. Rouge : recul. Les deux périodes ont la même durée.</p>`
        : html`
          <div class="list-row"><span class="k">Elo de départ → actuel</span><span>${n(s.elo.start)} → ${n(s.elo.end)} (${delta(s.elo.delta)})</span></div>
          <div class="list-row"><span class="k">Meilleur · plus bas</span><span>${n(s.elo.peak)} · ${n(s.elo.low)}</span></div>
          <div class="list-row"><span class="k">Parties classées</span><span>${r.rated} sur ${r.games}</span></div>
          <p class="setup-hint" style="margin-top:8px">Choisissez une période (7 jours, 30 jours…) pour comparer avec la période précédente.</p>`}
        <h4>Séries et durées</h4>
        <div class="list-row"><span class="k">Meilleure série de victoires</span><span>${r.streaks.bestWin}</span></div>
        <div class="list-row"><span class="k">Série en cours</span><span>${r.streaks.current > 0 ? `${r.streaks.current} victoire${r.streaks.current > 1 ? 's' : ''}` : r.streaks.current < 0 ? `${-r.streaks.current} défaite${r.streaks.current < -1 ? 's' : ''}` : '—'}</span></div>
        <div class="list-row"><span class="k">Longueur moyenne</span><span>${n(r.avgMoves, ' coups')}</span></div>
        <div class="list-row"><span class="k">Durée moyenne</span><span>${r.avgDurationS ? `${Math.round(r.avgDurationS / 60)} min` : '—'}</span></div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card chart-card">
        <div class="chart-head"><h3>Erreurs par catégorie</h3><span class="setup-hint">d'après l'analyse de vos parties</span></div>
        ${s.errors.some(e => e.total) ? html`<div class="chart" style="height:${Math.max(180, 30 * s.errors.filter(e => e.total).length + 50)}px"><canvas id="err-cat"></canvas></div>` : html`<div class="empty">Aucune erreur relevée : jouez et laissez l'analyse travailler.</div>`}
      </div>
      <div class="card">
        <h3>Exercices par catégorie</h3>
        ${s.puzzles.byCategory.length ? html`
          ${s.puzzles.byCategory.map(k => html`
            <div class="score-row"><span class="score-label">${k.label}</span>
              <div class="score-bar ${k.rate < 40 ? 'weak' : k.rate > 70 ? 'strong' : ''}"><div style="width:${k.rate}%"></div></div>
              <span class="score-num">${k.rate} %</span></div>
            <div class="setup-hint" style="margin:-4px 0 6px">${k.solved} réussis sur ${k.attempts}</div>`)}
          <div class="list-row" style="margin-top:8px"><span class="k">Avec indice</span><span>${s.puzzles.withHint}</span></div>
          <div class="list-row"><span class="k">Temps moyen par exercice</span><span>${s.puzzles.avgTimeS ? `${Math.round(s.puzzles.avgTimeS)} s` : '—'}</span></div>`
        : html`<div class="empty">Aucun exercice sur cette période.</div>`}
      </div>
    </div>

    ${Object.keys(r.byTermination).length ? html`
    <div class="card" style="margin-top:16px">
      <h3>Comment vos parties se terminent</h3>
      <div class="grid grid-3">
        ${Object.entries(r.byTermination).sort((a, b) => b[1].games - a[1].games).map(([k, t]) => html`
          <div class="term-row"><div><strong>${TERMINATIONS[k] || k}</strong><div class="setup-hint">${t.games} partie${t.games > 1 ? 's' : ''}</div></div>${segment(t)}</div>`)}
      </div>
    </div>` : ''}
    </div>`;

  if (s.errors.some(e => e.total)) {
    const rows = s.errors.filter(e => e.total);
    if (!keep(await barChart(main.querySelector('#err-cat'), {
      horizontal: true, stacked: true, legend: true, labels: rows.map(e => e.label), yTicks: { precision: 0 },
      series: [
        { label: 'Gaffes', data: rows.map(e => e.blunder), color: c.loss },
        { label: 'Erreurs', data: rows.map(e => e.mistake), color: withAlpha(c.loss, .5) },
        { label: 'Imprécisions', data: rows.map(e => e.inaccuracy), color: withAlpha(c.loss, .22) },
      ],
    }))) return;
  }
}
