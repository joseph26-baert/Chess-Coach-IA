// Libellés français partagés par les pages de jeu
export const TERMINATIONS = {
  checkmate: 'Échec et mat',
  resign: 'Abandon',
  stalemate: 'Pat',
  repetition: 'Nulle par répétition',
  fifty: 'Règle des 50 coups',
  insufficient: 'Matériel insuffisant',
  timeout: 'Perte au temps',
  'timeout-draw': 'Temps écoulé, nulle (matériel insuffisant)',
};

export const TIME_CONTROL_LABELS = {
  none: 'Sans pendule',
  '3+2': '3 + 2',
  '5+0': '5 min',
  '10+0': '10 min',
  '15+10': '15 + 10',
  '30+0': '30 min',
};

export const OFFSET_LABELS = { weaker: 'un peu plus faible', equal: 'de votre niveau', stronger: 'un peu plus forte' };

export function resultLabel(result) {
  return result === '1-0' ? 'Les blancs gagnent' : result === '0-1' ? 'Les noirs gagnent' : 'Nulle';
}

export function scoreLabel(score) {
  return score === 1 ? 'Victoire' : score === 0.5 ? 'Nulle' : 'Défaite';
}

export function formatDuration(s) {
  if (s === null || s === undefined) return '—';
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m > 0 ? `${m} min` : `${s} s`;
}

export const LABELS = { best: 'Meilleur coup', good: 'Bon coup', inaccuracy: 'Imprécision', mistake: 'Erreur', blunder: 'Gaffe' };
export const LABEL_SYMBOLS = { best: '', good: '', inaccuracy: '?!', mistake: '?', blunder: '??' };
export const CATEGORIES = {
  'hanging-piece': 'pièce en prise', 'missed-capture': 'prise manquée', 'missed-mate': 'mat manqué', 'allowed-mate': 'mat encaissé',
  'allowed-fork': 'fourchette subie', 'missed-fork': 'fourchette manquée', 'ignored-threat': 'menace ignorée', 'bad-exchange': 'mauvais échange',
  'slow-development': 'développement', 'development': 'ouverture', 'king-safety': 'sécurité du roi', 'endgame-technique': 'finale',
  'calculation': 'calcul', 'positional': 'stratégie',
};
