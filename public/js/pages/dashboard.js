import { html, formatDelta, formatDate } from '../ui.js';
import { api } from '../api.js';
import { scoreLabel, TERMINATIONS } from '../chess-labels.js';

export async function render(main) {
  const [{ user, stats, elo }, { game: current }, { games: recent }, training] = await Promise.all([
    api.get('/profile'), api.get('/games/current'), api.get('/games?limit=5'), api.get('/training/overview?tz=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')),
  ]);
  const weak = training.weaknesses.filter(w => w.score !== null && w.score < 40).sort((a, b) => a.score - b.score).slice(0, 2);
  const strong = training.weaknesses.filter(w => w.score !== null && w.score > 70).sort((a, b) => b.score - a.score).slice(0, 2);
  const pct = (n) => stats.games ? Math.round(100 * n / stats.games) + ' %' : '—';

  main.innerHTML = html`
    <div class="page-head">
      <div>
        <h1>Bonjour ${user.username}</h1>
        <p>${stats.games === 0
          ? "Votre niveau est encore inconnu : vos 5 premières parties serviront à l'estimer."
          : `${stats.games} partie${stats.games > 1 ? 's' : ''} jouée${stats.games > 1 ? 's' : ''}.`}</p>
      </div>
      <a class="btn btn-primary btn-lg" href="#/jouer">${current ? 'Reprendre la partie en cours' : 'Jouer'}</a>
    </div>

    <div class="grid grid-4">
      <div class="card stat">
        <span class="label">Elo actuel ${elo.provisional ? html`<span class="badge badge-amber">provisoire</span>` : html`<span class="badge">confirmé</span>`}</span>
        <span class="value elo">${elo.current}</span>
        <span class="sub">7 jours : ${formatDelta(elo.delta7d)} · 30 jours : ${formatDelta(elo.delta30d)} · <a href="#/progression">courbe</a></span>
      </div>
      <div class="card stat">
        <span class="label">Meilleur Elo</span>
        <span class="value">${elo.peak}</span>
        <span class="sub">Depuis la création : ${formatDelta(elo.deltaAllTime)}</span>
      </div>
      <div class="card stat">
        <span class="label">Parties</span>
        <span class="value">${stats.games}</span>
        <span class="sub">${stats.wins} V · ${stats.draws} N · ${stats.losses} D</span>
      </div>
      <div class="card stat">
        <span class="label">Victoires</span>
        <span class="value">${pct(stats.wins)}</span>
        <span class="sub">Nulles ${pct(stats.draws)} · Défaites ${pct(stats.losses)}</span>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Dernières parties</h3>
        ${recent.length ? recent.map(g => html`
          <a class="list-row link-row" href="#/partie/${g.id}">
            <span><span class="dot ${g.user_score === 1 ? 'win' : g.user_score === 0.5 ? 'draw' : 'loss'}"></span>${scoreLabel(g.user_score)} · ${g.user_color === 'white' ? 'Blancs' : 'Noirs'} contre IA ${g.ai_elo}
              <div class="hist-sub">${formatDate(g.finished_at)} · ${TERMINATIONS[g.termination] || ''}</div></span>
            <span>${g.rated ? formatDelta(g.elo_delta) : html`<span class="setup-hint">—</span>`}</span>
          </a>`) : html`<div class="empty">Aucune partie pour le moment.</div>`}
        ${recent.length ? html`<div style="margin-top:10px"><a href="#/historique">Tout l'historique</a></div>` : ''}
      </div>
      <div class="card">
        <h3>Entraînement du jour</h3>
        <div class="program-progress"><div class="progress"><div style="width:${Math.round(100 * training.program.done / training.program.total)}%"></div></div><span>${training.program.done} / ${training.program.total}</span></div>
        ${weak.length ? html`<div class="tag-row">${weak.map(w => html`<span class="tag tag-bad">À travailler : ${w.label}</span>`)}</div>` : ''}
        ${strong.length ? html`<div class="tag-row">${strong.map(w => html`<span class="tag tag-good">Point fort : ${w.label}</span>`)}</div>` : ''}
        ${!weak.length && !strong.length ? html`<p class="setup-hint">${stats.games ? 'Votre profil se précise au fil des parties analysées.' : 'Jouez une première partie : son analyse nourrira votre programme.'}</p>` : ''}
        <div style="margin-top:10px"><a class="btn btn-sm" href="#/exercice">${training.program.done ? 'Continuer les exercices' : 'Commencer les exercices'}</a> <a href="#/entrainement" style="margin-left:10px">Tout l'entraînement</a></div>
      </div>
    </div>`;
}
