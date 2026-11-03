import { html, raw } from '../ui.js';
import { state } from '../app.js';

// Position illustrative : milieu de partie, un cavalier blanc vient de sauter en f5
const POSITION = [
  'r.bq.rk.',
  'pp..bppp',
  '..np.n..',
  '..p..N..',
  '..P.P...',
  '..N...P.',
  'PP...PBP',
  'R..Q.RK.',
];
// Mêmes pièces que sur l'échiquier de jeu (sprite SVG /pieces/coach.svg)
function board() {
  let cells = '';
  POSITION.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      const light = (r + c) % 2 === 0;
      const hl = (r === 3 && c === 5) ? ' hl' : '';
      const piece = ch === '.' ? '' : `<svg viewBox="0 0 40 40" aria-hidden="true"><use href="/pieces/coach.svg#${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toLowerCase()}"/></svg>`;
      cells += `<div class="${light ? 'l' : 'd'}${hl}">${piece}</div>`;
    });
  });
  return raw(cells);
}

export async function render(main) {
  const cta = state.user
    ? html`<a class="btn btn-primary btn-lg" href="#/tableau-de-bord">Ouvrir mon tableau de bord</a>`
    : html`<a class="btn btn-primary btn-lg" href="#/inscription">Créer mon compte</a>
           <a class="btn btn-ghost btn-lg" href="#/connexion">J'ai déjà un compte</a>`;

  main.innerHTML = html`
    <section class="hero">
      <div>
        <h1>Un adversaire qui joue comme vous, et un coach qui vous connaît.</h1>
        <p class="lead">Jouez contre une IA qui se trompe comme un humain, à votre niveau exact. Chaque partie fait évoluer votre Elo, est analysée, et nourrit un entraînement ciblé sur vos vraies faiblesses.</p>
        <div class="hero-actions">${cta}</div>
      </div>
      <div class="hero-board" aria-hidden="true">${board()}</div>
    </section>

    <section class="features grid grid-3">
      <div class="card">
        <h3>Une IA crédible, pas un moteur bridé</h3>
        <p>À 800 Elo elle laisse des pièces en prise ; à 1800 elle rate seulement les calculs profonds. Elle s'ajuste à vos résultats, sans jamais truquer l'issue.</p>
      </div>
      <div class="card">
        <h3>Un Elo qui vous suit dans le temps</h3>
        <p>Classement provisoire après vos premières parties, puis stabilisé. Chaque variation est conservée : revoyez votre niveau à n'importe quelle date.</p>
      </div>
      <div class="card">
        <h3>Des exercices tirés de vos erreurs</h3>
        <p>Fourchettes manquées, mats ratés, finales mal jouées : l'analyse de vos parties décide de ce que vous travaillez ensuite.</p>
      </div>
    </section>

    <section class="features grid grid-3" style="margin-top:16px">
      <div class="card"><h3>Analyse après chaque partie</h3><p>Précision, moments décisifs, gaffes et erreurs expliquées en français, avec le replay annoté coup par coup.</p></div>
      <div class="card"><h3>Entraînement sur mesure</h3><p>Plus de 500 exercices tactiques vérifiés, des exercices tirés de vos propres parties, et une révision espacée de ce que vous avez raté.</p></div>
      <div class="card"><h3>Progression visible</h3><p>Courbe Elo, précision, erreurs par catégorie, points forts et faiblesses : vos statistiques, sur 7 jours ou sur un an.</p></div>
    </section>
    <div class="site-foot"><span>Chess Coach IA — gratuit, sans publicité.</span><a href="#/confidentialite">Confidentialité</a></div>`;
}
