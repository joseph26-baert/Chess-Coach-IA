// Page Progression : courbe Elo, précision et erreurs par partie, évolution des faiblesses,
// niveau par thème tactique, activité hebdomadaire. Période sélectionnable.
import { html } from '../ui.js';
import { api } from '../api.js';
import { lineChart, barChart, themeColors, withAlpha, shortDate, longDate } from '../charts.js';
import { header, tile, currentPeriod, periodLabel, n, delta, emptyCard } from './stats-common.js';

let charts = [];
let mountGen = 0;
const fmtH = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}` : `${m} min`);
export function unmount() { mountGen++; for (const c of charts) c.destroy(); charts = []; }

export async function render(main) {
  const gen = ++mountGen;
  const period = currentPeriod();
  const p = await api.get(`/stats/progression?period=${period}`);
  if (gen !== mountGen) return; // l'utilisateur a changé de page ou de période pendant le chargement
  const c = themeColors();
  // Conserve un graphique si la page est toujours affichée, sinon le détruit (navigation pendant le chargement)
  const keep = (ch) => { if (gen !== mountGen) { ch.destroy(); return false; } charts.push(ch); return true; };

  const elo = p.elo;
  const avgAcc = p.summary.accuracy;
  const solved = p.summary.puzzles.solved, attempts = p.summary.puzzles.attempts;
  const known = p.themes.filter(t => t.attempts >= 1).sort((a, b) => b.rating - a.rating);

  // Faiblesses : valeur actuelle et évolution sur la période (première valeur connue → dernière)
  const weak = p.weaknesses.series.map(s => {
    const vals = s.values.filter(v => v !== null);
    return { ...s, now: vals.length ? vals[vals.length - 1] : null, first: vals.length ? vals[0] : null };
  }).filter(w => w.now !== null).sort((a, b) => a.now - b.now);

  main.innerHTML = html`
    <div id="prog-root">
    ${header({ title: 'Progression', subtitle: `Votre évolution sur ${periodLabel(period)}.`, active: 'progression', period })}

    <div class="grid grid-4">
      ${tile('Elo', elo.end === null ? '—' : elo.end, elo.points.length > 1 ? html`${delta(elo.delta)} sur la période · pic ${elo.peak}` : 'Aucune partie classée sur la période', 'elo')}
      ${tile('Précision moyenne', n(avgAcc, ' %'), p.games.length ? `${p.games.length} partie${p.games.length > 1 ? 's' : ''} analysée${p.games.length > 1 ? 's' : ''}` : 'Aucune partie analysée')}
      ${tile('Exercices réussis', attempts ? `${Math.round(100 * solved / attempts)} %` : '—', attempts ? `${solved} / ${attempts} exercices` : 'Aucun exercice sur la période')}
      ${tile('Parties jouées', p.summary.games, `${p.summary.wins} victoire${p.summary.wins > 1 ? 's' : ''}`)}
    </div>

    <div class="card chart-card" style="margin-top:16px">
      <div class="chart-head"><h3>Courbe Elo</h3><span class="setup-hint">Un point par partie classée · cliquez pour ouvrir la partie</span></div>
      ${elo.points.length > 1 ? html`<div class="chart chart-tall"><canvas id="elo-chart"></canvas></div>` : html`<div class="empty">Jouez une partie classée : la courbe apparaîtra ici.</div>`}
      ${p.journal.activities.length || p.journal.ratings.length ? html`
        <div class="legend-row journal-legend">
          ${p.journal.activities.length ? html`<span><i class="sw" style="background:var(--chart-2)"></i>${p.journal.activities.length} jour${p.journal.activities.length > 1 ? 's' : ''} d'entraînement hors site (${fmtH(p.journal.totalMinutes)})</span>` : ''}
          ${p.journal.ratings.length ? html`<span><i class="sw" style="background:var(--surface);box-shadow:inset 0 0 0 2px var(--loss)"></i>Elo externe relevé (${[...new Set(p.journal.ratings.map(r => r.platform))].join(', ')})</span>` : ''}
          <a href="#/journal">Journal</a>
        </div>` : html`<p class="setup-hint" style="margin:8px 0 0">Cours, livres, tournois… notez-les dans le <a href="#/journal">journal d'entraînement</a> : ils apparaîtront sur cette courbe.</p>`}
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card chart-card">
        <div class="chart-head"><h3>Précision par partie</h3><span class="setup-hint">% de coups proches du meilleur</span></div>
        ${p.games.length ? html`<div class="chart"><canvas id="acc-chart"></canvas></div>` : html`<div class="empty">Les parties analysées apparaîtront ici.</div>`}
      </div>
      <div class="card chart-card">
        <div class="chart-head"><h3>Erreurs graves par partie</h3><span class="setup-hint">gaffes et erreurs, selon l'analyse</span></div>
        ${p.games.length ? html`<div class="chart"><canvas id="err-chart"></canvas></div>` : html`<div class="empty">Les parties analysées apparaîtront ici.</div>`}
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Faiblesses et points forts</h3>
        ${weak.length ? html`
          ${weak.map(w => html`
            <div class="score-row score-row-wide">
              <span class="score-label">${w.label}</span>
              <div class="score-bar ${w.now < 40 ? 'weak' : w.now > 70 ? 'strong' : ''}"><div style="width:${w.now}%"></div></div>
              <span class="score-num">${w.now}</span>
              <span class="score-delta">${w.first === w.now ? html`<span class="delta-zero">=</span>` : delta(w.now - w.first)}</span>
            </div>`)}
          <p class="setup-hint" style="margin-top:8px">Score de 0 à 100 et variation sur la période. Sous 40 : à travailler ; au-dessus de 70 : point fort.</p>`
        : html`<div class="empty">Le profil se construit à partir de vos parties analysées et de vos exercices.</div>`}
      </div>
      <div class="card chart-card">
        <div class="chart-head"><h3>Niveau par thème tactique</h3><span class="setup-hint">Elo d'exercice, par thème</span></div>
        ${known.length ? html`<div class="chart" style="height:${Math.max(160, 30 * known.length + 40)}px"><canvas id="theme-chart"></canvas></div>` : html`<div class="empty">Faites quelques exercices pour voir votre niveau par thème.</div>`}
      </div>
    </div>

    <div class="card chart-card" style="margin-top:16px">
      <div class="chart-head"><h3>Activité par semaine</h3><span class="setup-hint">parties jouées et exercices faits</span></div>
      <div class="chart"><canvas id="act-chart"></canvas></div>
    </div>
    </div>`;

  // --- Courbe Elo
  if (elo.points.length > 1) {
    const pts = elo.points;
    // Position horizontale (fractionnaire, entre deux points) d'une date du journal, par interpolation temporelle
    const times = pts.map(x => Date.parse(x.t));
    const xOf = (day) => {
      const t = Date.parse(day + 'T12:00:00Z');
      if (t <= times[0]) return 0;
      if (t >= times[times.length - 1]) return times.length - 1;
      let i = 1; while (times[i] < t) i++;
      return i - 1 + (t - times[i - 1]) / Math.max(1, times[i] - times[i - 1]);
    };
    const journalPlugin = {
      id: 'journal',
      afterDatasetsDraw(chart) {
        const { ctx, scales: { x, y }, chartArea } = chart;
        ctx.save();
        for (const a of p.journal.activities) {
          const px = x.getPixelForValue(xOf(a.day));
          ctx.strokeStyle = withAlpha(c.chart2, .55); ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, chartArea.top); ctx.lineTo(px, chartArea.bottom); ctx.stroke();
          ctx.setLineDash([]); ctx.fillStyle = c.chart2;
          ctx.beginPath(); ctx.arc(px, chartArea.top + 5, 3.5, 0, Math.PI * 2); ctx.fill();
        }
        for (const r of p.journal.ratings) {
          if (r.rating < y.min || r.rating > y.max) continue;
          const px = x.getPixelForValue(xOf(r.day)), py = y.getPixelForValue(r.rating);
          ctx.fillStyle = c.surface; ctx.strokeStyle = c.loss; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      },
    };
    const ratingsIn = p.journal.ratings.map(r => r.rating);
    if (!keep(await lineChart(main.querySelector('#elo-chart'), {
      labels: pts.map(x => shortDate(x.t)),
      series: [{ label: 'Elo', data: pts.map(x => x.elo), color: c.amber, points: pts.length > 80 ? 0 : 3 }],
      yMin: ratingsIn.length ? Math.floor((Math.min(elo.low, ...ratingsIn) - 20) / 50) * 50 : undefined, yMax: ratingsIn.length ? Math.ceil((Math.max(elo.peak, ...ratingsIn) + 20) / 50) * 50 : undefined,
      tooltipTitle: (items) => longDate(pts[items[0].dataIndex].t),
      tooltipLabel: (it) => { const x = pts[it.dataIndex]; return x.game_id ? ` ${x.elo} Elo (${x.delta > 0 ? '+' : ''}${x.delta})${x.provisional ? ' · provisoire' : ''}` : ` ${x.elo} Elo au début de la période`; },
      onClick: (i) => { if (pts[i].game_id) location.hash = `#/partie/${pts[i].game_id}`; },
      plugins: [journalPlugin],
    }))) return;
  }

  // --- Précision et erreurs : par partie, ou par semaine (moyennes) quand il y a beaucoup de parties
  if (p.games.length) {
    const g = p.games;
    if (g.length <= 25) {
      const labels = g.map(x => shortDate(x.t));
      const title = (items) => `${longDate(g[items[0].dataIndex].t)} · contre IA ${g[items[0].dataIndex].ai_elo}`;
      if (!keep(await lineChart(main.querySelector('#acc-chart'), {
        labels, yMin: 0, yMax: 100, yTicks: { stepSize: 25, callback: v => v + ' %' },
        series: [{ label: 'Précision', data: g.map(x => x.accuracy), color: c.chart2, points: 3 }],
        tooltipTitle: title, tooltipLabel: (it) => ` Précision ${g[it.dataIndex].accuracy} %`,
        onClick: (i) => { location.hash = `#/partie/${g[i].id}`; },
      }))) return;
      if (!keep(await barChart(main.querySelector('#err-chart'), {
        labels, stacked: true, legend: true, yTicks: { precision: 0 },
        series: [{ label: 'Gaffes', data: g.map(x => x.blunders), color: c.loss }, { label: 'Erreurs', data: g.map(x => x.mistakes), color: withAlpha(c.loss, .45) }],
        tooltipTitle: title,
      }))) return;
    } else {
      const weeks = p.activity.filter(w => w.accuracy !== null);
      const labels = weeks.map(w => shortDate(w.week));
      const title = (items) => `Semaine du ${longDate(weeks[items[0].dataIndex].week)}`;
      main.querySelector('#acc-chart').closest('.chart-card').querySelector('.setup-hint').textContent = 'moyenne par semaine';
      main.querySelector('#err-chart').closest('.chart-card').querySelector('.setup-hint').textContent = 'gaffes + erreurs, moyenne par partie et par semaine';
      if (!keep(await lineChart(main.querySelector('#acc-chart'), {
        labels, yMin: 0, yMax: 100, yTicks: { stepSize: 25, callback: v => v + ' %' },
        series: [{ label: 'Précision', data: weeks.map(w => w.accuracy), color: c.chart2, points: 3 }],
        tooltipTitle: title, tooltipLabel: (it) => ` Précision moyenne ${weeks[it.dataIndex].accuracy} %`,
      }))) return;
      if (!keep(await barChart(main.querySelector('#err-chart'), {
        labels, yTicks: { precision: 1 },
        series: [{ label: 'Erreurs graves par partie', data: weeks.map(w => w.errorsPerGame), color: c.loss }],
        tooltipTitle: title, tooltipLabel: (it) => ` ${weeks[it.dataIndex].errorsPerGame} erreur(s) grave(s) par partie`,
      }))) return;
    }
  }

  // --- Niveau par thème (barres horizontales, une seule teinte)
  if (known.length) {
    if (!keep(await barChart(main.querySelector('#theme-chart'), {
      horizontal: true, labels: known.map(t => t.label), yTicks: { precision: 0 },
      series: [{ label: 'Niveau', data: known.map(t => t.rating), color: c.chart2 }],
      tooltipLabel: (it) => { const t = known[it.dataIndex]; return ` ${t.rating} · ${t.solved}/${t.attempts} réussis (${t.rate ?? 0} %)`; },
    }))) return;
  }

  // --- Activité
  const act = p.activity;
  if (!keep(await barChart(main.querySelector('#act-chart'), {
    labels: act.map(w => shortDate(w.week)), legend: true, yTicks: { precision: 0 },
    series: [{ label: 'Parties', data: act.map(w => w.games), color: c.chart2 }, { label: 'Exercices', data: act.map(w => w.puzzles), color: c.amber }],
    tooltipTitle: (items) => `Semaine du ${longDate(act[items[0].dataIndex].week)}`,
    tooltipLabel: (it) => { const w = act[it.dataIndex]; return it.datasetIndex === 0 ? ` ${w.games} partie${w.games > 1 ? 's' : ''}, ${w.wins} victoire${w.wins > 1 ? 's' : ''}` : ` ${w.puzzles} exercice${w.puzzles > 1 ? 's' : ''}, ${w.solved} réussi${w.solved > 1 ? 's' : ''}`; },
  }))) return;
}
