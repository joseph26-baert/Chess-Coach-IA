import { html, bindForm } from '../ui.js';
import { api } from '../api.js';

export async function render(main) {
  main.innerHTML = html`
    <div class="auth-layout">
      <h1>Mot de passe oublié</h1>
      <p class="lead">Indiquez votre adresse e-mail : un lien de réinitialisation valable une heure sera généré.</p>
      <form id="forgot-form" class="card" novalidate>
        <div class="field">
          <label for="email">Adresse e-mail</label>
          <input class="input" id="email" name="email" type="email" autocomplete="email" required>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Générer le lien</button>
        <p class="form-foot"><a href="#/connexion">Retour à la connexion</a></p>
      </form>
    </div>`;

  bindForm(main.querySelector('#forgot-form'), async (data, form) => {
    const res = await api.post('/auth/forgot', data);
    const box = document.createElement('div');
    box.className = 'form-success';
    box.innerHTML = html`${res.message}${res.devLink ? html`<br><small>Mode développement — lien : <a href="${res.devLink}">${res.devLink}</a></small>` : ''}`;
    form.prepend(box);
  });
}
