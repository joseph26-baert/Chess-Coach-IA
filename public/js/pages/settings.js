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
      <div class="settings-row">
        <div><div>Session</div><div class="desc">Connecté en tant que ${u.email}.</div></div>
        <button class="btn btn-ghost" id="settings-logout" type="button">Se déconnecter</button>
      </div>
    </div>`;

  main.querySelector('#settings-logout').addEventListener('click', logout);

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
