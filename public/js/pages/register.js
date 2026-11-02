import { html, bindForm } from '../ui.js';
import { api } from '../api.js';
import { setUser, navigate } from '../app.js';

export async function render(main) {
  main.innerHTML = html`
    <div class="auth-layout">
      <h1>Créer un compte</h1>
      <p class="lead">Votre Elo, vos parties et vos progrès resteront enregistrés, même après des mois d'absence.</p>
      <form id="register-form" class="card" novalidate>
        <div class="field">
          <label for="username">Nom d'utilisateur</label>
          <input class="input" id="username" name="username" autocomplete="username" required minlength="3" maxlength="20" pattern="[a-zA-Z0-9_\\-]+">
          <span class="hint">3 à 20 caractères : lettres, chiffres, _ ou -</span>
        </div>
        <div class="field">
          <label for="email">Adresse e-mail</label>
          <input class="input" id="email" name="email" type="email" autocomplete="email" required>
        </div>
        <div class="field">
          <label for="password">Mot de passe</label>
          <input class="input" id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
          <span class="hint">8 caractères minimum</span>
        </div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Créer mon compte</button>
        <p class="form-foot">Déjà inscrit ? <a href="#/connexion">Se connecter</a></p>
      </form>
    </div>`;

  bindForm(main.querySelector('#register-form'), async (data) => {
    const { user } = await api.post('/auth/register', data);
    setUser(user);
    navigate('/tableau-de-bord');
  });
}
