import { html, raw, bindForm, toast } from '../ui.js';
import { api } from '../api.js';
import { state, setUser, logout } from '../app.js';

function switchHtml(name, options, current) {
  return raw(`<div class="switch" data-name="${name}">` +
    options.map(([v, label]) => `<button type="button" data-value="${v}" class="${v === current ? 'on' : ''}">${label}</button>`).join('') +
    '</div>');
}

export async function render(main) {
  const u = state.user;
  main.innerHTML = html`
    <div class="page-head"><div><h1>Paramètres</h1><p>Vos préférences sont enregistrées sur votre compte.</p></div></div>

    <div class="card settings-section">
      <h3>Jeu</h3>
      <div class="settings-row">
        <div><div>Couleur préférée</div><div class="desc">Couleur proposée par défaut au lancement d'une partie.</div></div>
        ${switchHtml('preferred_color', [['white', 'Blancs'], ['black', 'Noirs'], ['random', 'Aléatoire']], u.preferred_color)}
      </div>
      <div class="settings-row">
        <div><div>Force de l'IA</div><div class="desc">Par rapport à votre niveau estimé.</div></div>
        ${switchHtml('ai_offset', [['weaker', 'Un peu plus faible'], ['equal', 'Mon niveau'], ['stronger', 'Un peu plus forte']], u.ai_offset)}
      </div>
      <div class="settings-row">
        <div><div>Afficher les cases menacées</div><div class="desc">Surligne les pièces attaquées pendant la partie.</div></div>
        ${switchHtml('show_threats', [['0', 'Non'], ['1', 'Oui']], u.show_threats ? '1' : '0')}
      </div>
      <div class="settings-row">
        <div><div>Thème</div><div class="desc">Apparence de l'interface.</div></div>
        ${switchHtml('theme', [['dark', 'Sombre'], ['light', 'Clair']], u.theme)}
      </div>
    </div>

    <div class="grid grid-2">
      <form id="username-form" class="card" novalidate>
        <h3>Nom d'utilisateur</h3>
        <div class="field">
          <label for="username">Nom affiché</label>
          <input class="input" id="username" name="username" value="${u.username}" required minlength="3" maxlength="20">
        </div>
        <button class="btn" type="submit">Enregistrer le nom</button>
      </form>

      <form id="password-form" class="card" novalidate>
        <h3>Mot de passe</h3>
        <div class="field">
          <label for="current">Mot de passe actuel</label>
          <input class="input" id="current" name="current" type="password" autocomplete="current-password" required>
        </div>
        <div class="field">
          <label for="next">Nouveau mot de passe</label>
          <input class="input" id="next" name="next" type="password" autocomplete="new-password" required minlength="8">
        </div>
        <button class="btn" type="submit">Changer le mot de passe</button>
      </form>
    </div>

    <div class="card settings-section" style="margin-top:16px">
      <h3>Exporter mes données</h3>
      <p class="setup-hint">Fichiers CSV (s'ouvrent dans Excel ou Numbers) : utiles pour un travail ou une analyse personnelle.</p>
      <div class="export-list">
        <a class="btn btn-sm" href="/api/export/parties" download>Parties</a>
        <a class="btn btn-sm" href="/api/export/elo" download>Historique Elo</a>
        <a class="btn btn-sm" href="/api/export/erreurs" download>Erreurs</a>
        <a class="btn btn-sm" href="/api/export/exercices" download>Exercices</a>
        <a class="btn btn-sm" href="/api/export/faiblesses" download>Faiblesses</a>
        <a class="btn btn-sm" href="/api/export/journal" download>Journal</a>
      </div>
    </div>

    <div class="card settings-section" style="margin-top:16px">
      <div class="settings-row">
        <div><div>Session</div><div class="desc">Connecté en tant que ${u.email}.</div></div>
        <button class="btn btn-ghost" id="settings-logout" type="button">Se déconnecter</button>
      </div>
      <div class="settings-row" style="margin-top:12px">
        <div><div>Supprimer mon compte</div><div class="desc">Irréversible : votre identité est effacée (e-mail, nom, mot de passe). Vos parties restent dans les statistiques anonymes du site. <a href="#/confidentialite">Politique de confidentialité</a>.</div></div>
        <button class="btn btn-ghost" id="settings-delete" type="button">Supprimer…</button>
      </div>
      <form id="delete-form" class="delete-form" hidden novalidate>
        <label>Pour confirmer, saisissez votre mot de passe<input class="input" type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn btn-danger" type="submit">Supprimer définitivement mon compte</button>
      </form>
    </div>`;

  main.querySelector('#settings-logout').addEventListener('click', logout);
  main.querySelector('#settings-delete').addEventListener('click', () => { const f = main.querySelector('#delete-form'); f.hidden = !f.hidden; if (!f.hidden) f.password.focus(); });
  bindForm(main.querySelector('#delete-form'), async (data) => {
    await api.post('/profile/delete', { password: data.password });
    setUser(null);
    toast('Compte supprimé. Merci d\'avoir joué avec nous.');
    location.hash = '#/';
  });

  if (u.is_admin) {
    const card = document.createElement('div');
    card.className = 'card settings-section';
    card.style.marginTop = '16px';
    card.innerHTML = html`<h3>Administration</h3><p class="setup-hint">Chiffres d'usage, votre compte exclu.</p><div id="admin-stats" class="grid grid-4"></div>`;
    main.appendChild(card);
    api.get('/admin/stats').then(s => {
      const stat = (label, value, sub = '') => html`<div class="stat"><span class="label">${label}</span><span class="value">${value}</span>${sub ? html`<span class="sub">${sub}</span>` : ''}</div>`;
      card.querySelector('#admin-stats').innerHTML = html`
        ${stat('Utilisateurs', s.users, `${s.users_7d} nouveaux sur 7 j`)}
        ${stat('Actifs', s.active_7d, `${s.active_30d} sur 30 jours`)}
        ${stat('Parties jouées', s.games, `${s.games_7d} sur 7 jours`)}
        ${stat('Exercices faits', s.puzzles, `${s.library} dans la bibliothèque`)}`;
    }).catch(err => toast(err.message));
  }

  // Interrupteurs : enregistrement immédiat
  main.querySelectorAll('.switch').forEach(sw => {
    sw.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const name = sw.dataset.name;
      let value = btn.dataset.value;
      if (name === 'show_threats') value = value === '1';
      try {
        const { user } = await api.patch('/profile/settings', { [name]: value });
        setUser(user);
        sw.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
        if (name === 'theme') localStorage.setItem('theme', value);
        toast('Préférence enregistrée');
      } catch (err) { toast(err.message); }
    });
  });

  bindForm(main.querySelector('#username-form'), async (data) => {
    const { user } = await api.patch('/profile/settings', { username: data.username });
    setUser(user);
    toast('Nom enregistré');
  });

  bindForm(main.querySelector('#password-form'), async (data, form) => {
    await api.post('/auth/change-password', data);
    form.reset();
    toast('Mot de passe changé');
  });
}
