import { html, formatDelta, formatDate, initials } from '../ui.js';
import { api } from '../api.js';

export async function render(main) {
  const [{ user, stats, elo }, overview] = await Promise.all([api.get('/profile'), api.get('/training/overview')]);
  const known = overview.weaknesses.filter(w => w.score !== null);
  const strengths = known.filter(w => w.score > 70).sort((a, b) => b.score - a.score);
  const weaknesses = known.filter(w => w.score < 40).sort((a, b) => a.score - b.score);

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
        <div style="margin-top:10px"><a href="#/progression">Voir la courbe et les graphiques</a> · <a href="#/statistiques">Statistiques</a></div>
      </div>
      <div class="card">
        <h3>Points forts et faiblesses</h3>
        ${known.length ? html`
          ${strengths.length ? html`<div class="tag-row">${strengths.map(w => html`<span class="tag tag-good">${w.label} ${w.score}</span>`)}</div>` : ''}
          ${weaknesses.length ? html`<div class="tag-row">${weaknesses.map(w => html`<span class="tag tag-bad">${w.label} ${w.score}</span>`)}</div>` : ''}
          ${!strengths.length && !weaknesses.length ? html`<p class="setup-hint">Profil équilibré : aucune catégorie sous 40 ni au-dessus de 70.</p>` : ''}
          <div class="list-row"><span class="k">Exercices réalisés</span><span>${overview.totals.attempts} (${overview.totals.attempts ? Math.round(100 * overview.totals.solved / overview.totals.attempts) : 0} % réussis)</span></div>
          <a href="#/entrainement">Voir le détail et s'entraîner</a>`
        : html`<div class="empty">Ils apparaîtront après l'analyse de vos premières parties.</div>`}
      </div>
    </div>`;
}
