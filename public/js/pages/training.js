// Page Entraînement : programme du jour, profil de faiblesses, exercices par thème
import { html } from '../ui.js';
import { api } from '../api.js';

const CATEGORY_ORDER = ['tactics', 'calculation', 'threats', 'material', 'defense', 'openings', 'strategy', 'endgames'];

export async function render(main) {
  const o = await api.get('/training/overview');
  const byCat = Object.fromEntries(o.weaknesses.map(w => [w.category, w]));
  const themesByCat = {};
  for (const t of o.themes) (themesByCat[t.category] ??= []).push(t);

  const scoreBar = (w) => w.score === null
    ? html`<span class="setup-hint">pas encore de données</span>`
    : html`<div class="score-bar ${w.score < 40 ? 'weak' : w.score > 70 ? 'strong' : ''}"><div style="width:${w.score}%"></div></div><span class="score-num">${w.score}</span>`;

  main.innerHTML = html`
    <div class="page-head">
      <div><h1>Entraînement</h1><p>${o.totals.attempts ? `${o.totals.attempts} exercice${o.totals.attempts > 1 ? 's' : ''} fait${o.totals.attempts > 1 ? 's' : ''}, ${Math.round(100 * o.totals.solved / o.totals.attempts)} % réussis.` : 'Des exercices choisis selon vos faiblesses et votre niveau.'}</p></div>
      <a class="btn btn-primary btn-lg" href="#/exercice">Commencer</a>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h3>Programme du jour</h3>
        <div class="program-progress"><div class="progress"><div style="width:${Math.round(100 * o.program.done / o.program.total)}%"></div></div><span>${o.program.done} / ${o.program.total}</span></div>
        <ul class="program-list">
          ${summarizeSlots(o.program.slots).map(s => html`<li><strong>${s.count} ×</strong> ${s.label} <span class="setup-hint">— ${s.reason}</span></li>`)}
        </ul>
        ${o.due ? html`<p class="setup-hint">${o.due} exercice${o.due > 1 ? 's' : ''} à revoir aujourd'hui (répétition espacée).</p>` : ''}
        ${o.ownPuzzles ? html`<p class="setup-hint">${o.ownPuzzles} exercice${o.ownPuzzles > 1 ? 's' : ''} tiré${o.ownPuzzles > 1 ? 's' : ''} de vos propres parties.</p>` : html`<p class="setup-hint">Vos propres erreurs de partie deviendront des exercices dès que vos parties seront analysées.</p>`}
        <a class="btn btn-primary" href="#/exercice">Lancer la session</a>
      </div>

      <div class="card">
        <h3>Vos forces et faiblesses</h3>
        ${o.weaknesses.every(w => w.score === null) ? html`<div class="empty">Jouez et analysez quelques parties : votre profil se construira à partir de vos erreurs réelles.</div>` :
          CATEGORY_ORDER.map(c => byCat[c]).filter(Boolean).sort((a, b) => (a.score ?? 101) - (b.score ?? 101)).map(w => html`
            <div class="score-row"><span class="score-label">${w.label}</span>${scoreBar(w)}</div>`)}
        <p class="setup-hint" style="margin-top:8px">Score de 0 à 100 : sous 40 = faiblesse, au-dessus de 70 = point fort. Calculé sur vos 20 dernières parties analysées et vos exercices récents.</p>
      </div>
    </div>

    <h2 style="margin-top:28px">Exercices par thème</h2>
    <div class="grid grid-3">
      ${CATEGORY_ORDER.filter(c => themesByCat[c]).map(c => html`
        <div class="card">
          <h3>${byCat[c]?.label || c}</h3>
          ${themesByCat[c].map(t => html`
            <a class="theme-row" href="#/exercice?theme=${t.theme}">
              <span>${t.label}</span>
              <span class="setup-hint">${t.attempts ? `niveau ${t.rating} · ${t.solved}/${t.attempts}` : t.available ? `${t.available} dispo.` : 'bientôt'}</span>
            </a>`)}
        </div>`)}
    </div>`;
}

function summarizeSlots(slots) {
  const map = new Map();
  for (const s of slots) {
    const key = s.label + '|' + s.reason;
    const cur = map.get(key) || { count: 0, label: s.label, reason: s.reason };
    cur.count++; map.set(key, cur);
  }
  return [...map.values()];
}
