// Page Historique : toutes les parties terminées
import { html, formatDelta, formatDate } from '../ui.js';
import { api } from '../api.js';
import { TERMINATIONS, TIME_CONTROL_LABELS, scoreLabel, formatDuration } from '../chess-labels.js';

export async function render(main) {
  const PAGE = 25;
  let offset = 0;
  main.innerHTML = html`
    <div class="page-head"><div><h1>Historique des parties</h1><p id="hist-count"></p></div>
      <a class="btn btn-primary" href="#/jouer">Jouer</a></div>
    <div class="card table-card"><div id="hist-list"></div></div>
    <div style="margin-top:12px;display:flex;gap:8px;justify-content:center" id="hist-more"></div>`;

  async function load(append = false) {
    const { games, total } = await api.get(`/games?limit=${PAGE}&offset=${offset}`);
    main.querySelector('#hist-count').textContent = total ? `${total} partie${total > 1 ? 's' : ''} terminée${total > 1 ? 's' : ''}` : '';
    const list = main.querySelector('#hist-list');
    if (!total) { list.innerHTML = html`<div class="empty">Aucune partie terminée. Jouez votre première partie pour obtenir un Elo.</div>`; return; }
    const rows = games.map(g => html`
      <a class="hist-row" href="#/partie/${g.id}">
        <span class="hist-result ${g.user_score === 1 ? 'win' : g.user_score === 0.5 ? 'draw' : 'loss'}">${scoreLabel(g.user_score)}</span>
        <span class="hist-main">
          <span>${g.user_color === 'white' ? 'Blancs' : 'Noirs'} contre l'IA ${g.ai_elo}</span>
          <span class="hist-sub">${formatDate(g.finished_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${TERMINATIONS[g.termination] || g.termination} · ${TIME_CONTROL_LABELS[g.time_control]} · ${Math.ceil(g.move_count / 2)} coups · ${formatDuration(g.duration_s)}</span>
        </span>
        <span class="hist-elo">${g.rated ? html`${g.elo_before} → <strong>${g.elo_after}</strong> <span>${formatDelta(g.elo_delta)}</span>` : html`<span class="setup-hint">non classée</span>`}</span>
      </a>`);
    if (append) list.insertAdjacentHTML('beforeend', html`${rows}`); else list.innerHTML = html`${rows}`;
    const more = main.querySelector('#hist-more');
    more.innerHTML = offset + games.length < total ? html`<button class="btn btn-ghost" id="more-btn">Afficher plus</button>` : '';
    more.querySelector('#more-btn')?.addEventListener('click', () => { offset += PAGE; load(true); });
  }
  await load();
}
