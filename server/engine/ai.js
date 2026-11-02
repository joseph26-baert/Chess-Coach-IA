// IA adverse : choisit un coup correspondant à un niveau Elo cible.
//
// Version phase 1b (sera raffinée en phase 2 avec les erreurs "humaines") :
//  1. Stockfish évalue les N meilleurs coups à une profondeur limitée selon l'Elo
//     (une IA faible "ne voit pas loin").
//  2. Chaque coup reçoit une probabilité décroissante avec son écart au meilleur
//     coup (softmax), avec une "température" d'autant plus haute que l'Elo est bas.
//
// Les paramètres sont volontairement regroupés ici pour la calibration.

import { analyse, score } from './stockfish.js';

export const AI_MIN_ELO = 400;
export const AI_MAX_ELO = 2200;

function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

// Paramètres de l'IA pour un Elo donné
export function paramsForElo(elo) {
  const t = (elo - AI_MIN_ELO) / (AI_MAX_ELO - AI_MIN_ELO);
  return {
    depth: Math.round(lerp(2, 14, t)),           // profondeur de calcul (demi-coups)
    multipv: 8,                                  // candidats examinés
    temperature: Math.round(lerp(260, 25, t)),   // centipions : + haut = + aléatoire
    maxLoss: Math.round(lerp(900, 150, t)),      // au-delà de cette perte, le coup n'est jamais choisi
  };
}

// Convertit une ligne (cp ou mate) en centipions bornés, pour la pondération
function cpOf(line) {
  const s = score(line);
  return Math.max(-1500, Math.min(1500, s > 50_000 ? 1500 : s < -50_000 ? -1500 : s));
}

export function pickMove(lines, params, rng = Math.random) {
  if (!lines.length) return null;
  const best = cpOf(lines[0]);
  const candidates = lines
    .map(l => ({ line: l, loss: best - cpOf(l) }))
    .filter(c => c.loss <= params.maxLoss);
  const weights = candidates.map(c => Math.exp(-c.loss / params.temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// Choisit le coup de l'IA pour la position `fen` au niveau `elo`.
export async function chooseMove(fen, elo) {
  const params = paramsForElo(Math.max(AI_MIN_ELO, Math.min(AI_MAX_ELO, elo)));
  let result;
  try { result = await analyse(fen, { depth: params.depth, multipv: params.multipv }); }
  catch { result = await analyse(fen, { depth: params.depth, multipv: params.multipv }); } // un moteur neuf est recréé
  const { lines, bestMove } = result;
  if (!lines.length) return bestMove ? { move: bestMove, loss: 0 } : null;
  const pick = pickMove(lines, params);
  return { move: pick.line.move, loss: pick.loss, bestMove: lines[0].move, depth: params.depth };
}
