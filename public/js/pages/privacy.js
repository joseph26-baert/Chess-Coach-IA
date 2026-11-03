// Politique de confidentialité et mentions (page publique)
import { html } from '../ui.js';

export async function render(main) {
  main.innerHTML = html`
    <div class="legal">
      <div class="page-head"><div><h1>Confidentialité</h1><p>Ce que Chess Coach IA conserve, pourquoi, et vos droits.</p></div></div>

      <h2>Données enregistrées</h2>
      <ul>
        <li><strong>Compte</strong> : adresse e-mail, nom d'utilisateur, mot de passe (stocké chiffré de façon irréversible), dates de création et de dernière connexion, préférences d'affichage.</li>
        <li><strong>Jeu</strong> : vos parties (coups, résultats, durée), votre historique Elo, les analyses de vos parties, vos exercices et vos résultats d'entraînement.</li>
        <li><strong>Technique</strong> : un cookie de session, indispensable pour rester connecté. Aucun cookie publicitaire, aucun traceur, aucune revente de données.</li>
      </ul>

      <h2>Utilisation</h2>
      <p>Ces données servent uniquement à faire fonctionner le site : adapter l'IA à votre niveau, calculer votre Elo, analyser vos parties et vous proposer un entraînement personnalisé. L'adresse e-mail n'est utilisée que pour la connexion et la réinitialisation du mot de passe.</p>

      <h2>Conservation</h2>
      <p>Votre historique de jeu est conservé sans limite de durée, pour que vous puissiez suivre votre progression sur le long terme. Les liens de réinitialisation de mot de passe expirent après une heure.</p>

      <h2>Vos droits</h2>
      <p>Vous pouvez à tout moment consulter et modifier vos informations dans <a href="#/parametres">Paramètres</a>, et supprimer votre compte depuis cette même page : votre identité (e-mail, nom d'utilisateur, mot de passe) est alors effacée définitivement. Les parties restent dans les statistiques globales du site, sans aucun lien avec vous.</p>

      <h2>Hébergement et sécurité</h2>
      <p>Le site est hébergé en Europe. Les connexions sont chiffrées (HTTPS), les mots de passe ne sont jamais stockés en clair, et une sauvegarde continue de la base de données protège vos données contre la perte.</p>

      <div class="site-foot"><a href="#/">Accueil</a><a href="#/inscription">Créer un compte</a></div>
    </div>`;
}
