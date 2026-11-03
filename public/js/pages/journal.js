// Journal d'entraînement : activités hors site (cours, livres, vidéos, tournois…) et relevés d'Elo externes.
// Les entrées apparaissent sur les courbes de la page Progression.
import { html, toast, bindForm, formatDate } from '../ui.js';
import { api } from '../api.js';

let kinds = null, platforms = null;
const today = () => new Date().toISOString().slice(0, 10);
const fmtMin = (m) => (m === null || m === undefined ? '' : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}` : `${m} min`);

export async function render(main) {
  if (!kinds) ({ kinds, platforms } = await api.get('/journal/kinds'));
  const { entries, totals } = await api.get('/journal');
  const totalMinutes = totals.reduce((s, t) => s + t.minutes, 0);
  const activities = entries.filter(e => e.kind !== 'rating');

  main.innerHTML = html`
    <div class="page-head">
      <div><h1>Journal d'entraînement</h1><p>Notez ce que vous faites en dehors du site : cours, livres, vidéos, tournois, parties ailleurs. Tout apparaît sur vos courbes de progression.</p></div>
      <a class="btn" href="#/progression">Voir la progression</a>
    </div>

    <div class="grid grid-2">
      <form id="journal-form" class="card" novalidate>
        <h3>Ajouter une activité</h3>
        <div class="form-row">
          <label>Type<select class="input" name="kind" id="kind-select">${Object.entries(kinds).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
          <label>Date<input class="input" type="date" name="happened_on" value="${today()}" max="${today()}" required></label>
        </div>
        <label>Titre<input class="input" name="title" placeholder="Ex. : Cours avec M. Dupont, chapitre 3 de « Les finales »…" maxlength="120" required></label>
        <div class="form-row" id="activity-fields">
          <label>Durée (minutes)<input class="input" type="number" name="minutes" min="0" max="1440" step="5" placeholder="60"></label>
        </div>
        <div class="form-row" id="rating-fields" hidden>
          <label>Elo relevé<input class="input" type="number" name="rating" min="100" max="3500" placeholder="1200"></label>
          <label>Plateforme<select class="input" name="platform">${platforms.map(p => html`<option value="${p}">${p}</option>`)}</select></label>
        </div>
        <label>Note (facultatif)<textarea class="input" name="note" rows="2" maxlength="2000" placeholder="Ce que vous avez travaillé, ce que vous retenez…"></textarea></label>
        <button class="btn btn-primary" type="submit">Ajouter au journal</button>
      </form>

      <div class="card">
        <h3>Bilan</h3>
        <div class="list-row"><span class="k">Temps d'entraînement hors site</span><span>${fmtMin(totalMinutes) || '0 min'}</span></div>
        ${totals.filter(t => t.kind !== 'rating').sort((a, b) => b.minutes - a.minutes).map(t => html`<div class="list-row"><span class="k">${kinds[t.kind] || t.kind}</span><span>${t.n} · ${fmtMin(t.minutes) || '—'}</span></div>`)}
        ${entries.some(e => e.kind === 'rating') ? html`<h4>Derniers Elo externes</h4>${entries.filter(e => e.kind === 'rating').slice(0, 5).map(e => html`<div class="list-row"><span class="k">${e.platform} · ${formatDate(e.happened_on)}</span><span>${e.rating}</span></div>`)}` : ''}
        <p class="setup-hint" style="margin-top:10px">Pour votre travail, exportez toutes vos données depuis <a href="#/parametres">Paramètres → Export</a>.</p>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Entrées</h3>
      ${entries.length ? html`<div id="journal-list">${entries.map(row)}</div>` : html`<div class="empty">Aucune entrée pour le moment. Ajoutez votre première activité ci-dessus.</div>`}
    </div>`;

  const kindSelect = main.querySelector('#kind-select');
  const toggle = () => { const r = kindSelect.value === 'rating'; main.querySelector('#rating-fields').hidden = !r; main.querySelector('#activity-fields').hidden = r; };
  kindSelect.addEventListener('change', toggle); toggle();

  bindForm(main.querySelector('#journal-form'), async (data) => {
    await api.post('/journal', data);
    toast('Ajouté au journal');
    render(main);
  });

  main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    const id = b.dataset.del;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmer la suppression'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Supprimer'; }, 3000); return; }
    try { await api.del(`/journal/${id}`); toast('Entrée supprimée'); render(main); } catch (err) { toast(err.message); }
  });

  function row(e) {
    return html`<div class="journal-row">
      <span class="journal-date">${formatDate(e.happened_on)}</span>
      <span class="tag">${kinds[e.kind] || e.kind}</span>
      <span class="journal-title">${e.title}${e.note ? html`<div class="setup-hint">${e.note}</div>` : ''}</span>
      <span class="journal-val">${e.kind === 'rating' ? `${e.rating} (${e.platform})` : fmtMin(e.minutes)}</span>
      <button class="btn btn-ghost btn-sm" data-del="${e.id}" type="button">Supprimer</button>
    </div>`;
  }
}
