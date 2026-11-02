import { html, bindForm, toast } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../app.js';

export async function render(main, [token]) {
  main.innerHTML = html`
    <div class="auth-layout">
      <h1>Nouveau mot de passe</h1>
      <p class="lead">Choisissez un nouveau mot de passe pour votre compte.</p>
      <form id="reset-form" class="card" novalidate>
        <div class="field">
          <label for="password">Nouveau mot de passe</label>
          <input class="input" id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
          <span class="hint">8 caractères minimum</span>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Enregistrer le mot de passe</button>
      </form>
    </div>`;

  bindForm(main.querySelector('#reset-form'), async (data) => {
    await api.post('/auth/reset', { token, password: data.password });
    toast('Mot de passe enregistré. Vous pouvez vous connecter.');
    navigate('/connexion');
  });
}
