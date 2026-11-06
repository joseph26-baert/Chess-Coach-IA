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
        <div class="field">
          <label for="start_elo">Votre niveau estimé <span class="hint">(facultatif)</span></label>
          <select class="input" id="start_elo" name="start_elo">
            <option value="">Je ne sais pas — commencer à 1000</option>
            <option value="400">Débutant complet : je connais à peine les règles (≈ 400)</option>
            <option value="700">Débutant : je joue de temps en temps (≈ 700)</option>
            <option value="1000">Occasionnel : je joue régulièrement en ligne (≈ 1000)</option>
            <option value="1200">Intermédiaire : ~1200 sur chess.com ou en club (≈ 1200)</option>
            <option value="1400">Confirmé : ~1400 sur chess.com (≈ 1400)</option>
            <option value="1600">Bon joueur de club : ~1600 (≈ 1600)</option>
            <option value="1800">Fort joueur de club : ~1800 (≈ 1800)</option>
            <option value="custom">Je connais mon Elo exact…</option>
          </select>
          <input class="input" id="start_elo_custom" name="start_elo_custom" type="number" min="100" max="1800" step="10" placeholder="Elo chess.com, Lichess ou FIDE (100 à 1800)" hidden>
          <span class="hint">Ce point de départ est provisoire : vos 5 premières parties l'ajustent rapidement.</span>
        </div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Créer mon compte</button>
        <p class="form-foot">Déjà inscrit ? <a href="#/connexion">Se connecter</a></p>
      </form>
    </div>`;

  const sel = main.querySelector('#start_elo'), custom = main.querySelector('#start_elo_custom');
  sel.addEventListener('change', () => { custom.hidden = sel.value !== 'custom'; if (!custom.hidden) custom.focus(); });

  bindForm(main.querySelector('#register-form'), async (data) => {
    const start_elo = data.start_elo === 'custom' ? Number(data.start_elo_custom) : (data.start_elo ? Number(data.start_elo) : undefined);
    if (data.start_elo === 'custom' && !(start_elo >= 100 && start_elo <= 1800)) throw new Error('Indiquez un Elo entre 100 et 1800.');
    const { user } = await api.post('/auth/register', { username: data.username, email: data.email, password: data.password, start_elo });
    setUser(user);
    navigate('/tableau-de-bord');
  });
}
