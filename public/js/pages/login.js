import { html, bindForm } from '../ui.js';
import { api } from '../api.js';
import { setUser, navigate } from '../app.js';

export async function render(main) {
  main.innerHTML = html`
    <div class="auth-layout">
      <h1>Connexion</h1>
      <p class="lead">Reprenez là où vous en étiez.</p>
      <form id="login-form" class="card" novalidate>
        <div class="field">
          <label for="email">E-mail ou nom d'utilisateur</label>
          <input class="input" id="email" name="email" autocomplete="username" required>
        </div>
        <div class="field">
          <label for="password">Mot de passe</label>
          <input class="input" id="password" name="password" type="password" autocomplete="current-password" required>
        </div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Se connecter</button>
        <p class="form-foot"><a href="#/mot-de-passe">Mot de passe oublié ?</a> · <a href="#/inscription">Créer un compte</a></p>
      </form>
    </div>`;

  bindForm(main.querySelector('#login-form'), async (data) => {
    const { user } = await api.post('/auth/login', data);
    setUser(user);
    navigate('/tableau-de-bord');
  });
}
