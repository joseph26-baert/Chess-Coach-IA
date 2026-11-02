import { html, formatDelta, formatDate, initials } from '../ui.js';
import { api } from '../api.js';

export async function render(main) {
  const { user, stats, elo } = await api.get('/profile');

  main.innerHTML = html`
    <div class="profile-head">
      <span class="avatar">${initials(user.username)}</span>
      <div>
        <h1 style="margin:0">${user.username}</h1>
        <div class="meta">Membre depuis le ${formatDate(user.created_at)} · ${user.email}</div>
      </div>
    </div>

    <div class="grid grid-3">
      <div class="card stat">
        <span class="label">Elo actuel ${elo.provisional ? html`<span class="badge badge-amber">provisoire</span>` : html`<span class="badge">confirmé</span>`}</span>
        <span class="value elo">${elo.current}</span>
        <span class="sub">${elo.provisional ? `${5 - user.rated_games} partie${5 - user.rated_games > 1 ? 's' : ''} avant confirmation` : `${user.rated_games} parties classées`}</span>
      </div>
      <div class="card stat">
        <span class="label">Meilleur Elo</span>
        <span class="value">${elo.peak}</span>
      </div>
      <div class="card stat">
        <span class="label">Parties jouées</span>
        <span class="value">${stats.games}</span>
        <span class="sub">${stats.wins} victoires · ${stats.draws} nulles · ${stats.losses} défaites</span>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Progression Elo</h3>
        <div class="list-row"><span class="k">Sur 7 jours</span><span>${formatDelta(elo.delta7d)}</span></div>
        <div class="list-row"><span class="k">Sur 30 jours</span><span>${formatDelta(elo.delta30d)}</span></div>
        <div class="list-row"><span class="k">Depuis la création du compte</span><span>${formatDelta(elo.deltaAllTime)}</span></div>
      </div>
      <div class="card">
        <h3>Points forts et faiblesses</h3>
        <div class="empty">Ils apparaîtront après l'analyse de vos premières parties.</div>
      </div>
    </div>`;
}
