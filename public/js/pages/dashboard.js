import { html, formatDelta } from '../ui.js';
import { api } from '../api.js';

export async function render(main) {
  const { user, stats, elo } = await api.get('/profile');
  const pct = (n) => stats.games ? Math.round(100 * n / stats.games) + ' %' : '—';

  main.innerHTML = html`
    <div class="page-head">
      <div>
        <h1>Bonjour ${user.username}</h1>
        <p>${stats.games === 0
          ? "Votre niveau est encore inconnu : vos 5 premières parties serviront à l'estimer."
          : `${stats.games} partie${stats.games > 1 ? 's' : ''} jouée${stats.games > 1 ? 's' : ''}.`}</p>
      </div>
    </div>

    <div class="grid grid-4">
      <div class="card stat">
        <span class="label">Elo actuel ${elo.provisional ? html`<span class="badge badge-amber">provisoire</span>` : html`<span class="badge">confirmé</span>`}</span>
        <span class="value elo">${elo.current}</span>
        <span class="sub">7 jours : ${formatDelta(elo.delta7d)} · 30 jours : ${formatDelta(elo.delta30d)}</span>
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
        <h3>Jouer</h3>
        <p style="color:var(--text-2)">Le mode de jeu contre l'IA arrive à l'étape suivante du développement.</p>
      </div>
      <div class="card">
        <h3>Dernières parties</h3>
        <div class="empty">Aucune partie pour le moment.</div>
      </div>
    </div>`;
}
