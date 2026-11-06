// Calcul Elo (méthode documentée dans le cahier des charges, section 6)
//
//  - Score attendu  E = 1 / (1 + 10^((eloAdversaire - eloJoueur) / 400))
//  - Nouvel Elo     = Elo + K × (score − E)
//  - K = 80 pour les 5 premières parties classées, 40 jusqu'à 20, 24 ensuite
//  - Classement "provisoire" tant que moins de 5 parties classées
//  - Plancher 100, pas de plafond
//  - Une partie abandonnée ou perdue au temps avant le 10e demi-coup n'est pas classée

export const STARTING_ELO = 1000;    // valeur par défaut si le joueur ne choisit pas
export const MIN_START_ELO = 100;    // Elo de départ choisi à l'inscription
export const MAX_START_ELO = 1800;
export const PROVISIONAL_GAMES = 5;
export const MIN_PLIES_FOR_RATING = 10;
export const ELO_FLOOR = 100;

export function kFactor(ratedGames) {
  if (ratedGames < PROVISIONAL_GAMES) return 80;
  if (ratedGames < 20) return 40;
  return 24;
}

export function expectedScore(playerElo, opponentElo) {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

// score : 1 (victoire), 0.5 (nulle), 0 (défaite)
export function computeNewElo(playerElo, opponentElo, score, ratedGames) {
  const k = kFactor(ratedGames);
  const e = expectedScore(playerElo, opponentElo);
  const delta = Math.round(k * (score - e));
  const after = Math.max(ELO_FLOOR, playerElo + delta);
  return { before: playerElo, after, delta: after - playerElo, k, expected: e };
}

export function isProvisional(ratedGames) { return ratedGames < PROVISIONAL_GAMES; }

export function isRatable({ termination, plies }) {
  if (['resign', 'timeout', 'timeout-draw'].includes(termination) && plies < MIN_PLIES_FOR_RATING) return false;
  return true;
}
