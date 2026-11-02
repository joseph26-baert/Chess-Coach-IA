// Tests du calcul Elo (cas chiffrés vérifiables à la main)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNewElo, expectedScore, kFactor, isRatable, isProvisional } from '../server/services/elo.js';

test('score attendu : égalité de niveau = 50 %', () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
});

test('score attendu : +400 Elo ≈ 91 %', () => {
  assert.ok(Math.abs(expectedScore(1400, 1000) - 0.909) < 0.001);
});

test('K : 80 pendant 5 parties, 40 jusqu à 20, 24 ensuite', () => {
  assert.equal(kFactor(0), 80);
  assert.equal(kFactor(4), 80);
  assert.equal(kFactor(5), 40);
  assert.equal(kFactor(19), 40);
  assert.equal(kFactor(20), 24);
});

test('victoire contre même niveau, joueur confirmé : +12', () => {
  const r = computeNewElo(1000, 1000, 1, 25);
  assert.equal(r.delta, 12);
  assert.equal(r.after, 1012);
});

test('défaite contre même niveau, première partie : -40', () => {
  const r = computeNewElo(1000, 1000, 0, 0);
  assert.equal(r.delta, -40);
});

test('nulle contre plus fort : gain', () => {
  const r = computeNewElo(1000, 1200, 0.5, 25);
  assert.ok(r.delta > 0 && r.delta <= 12, `delta ${r.delta}`);
});

test('plancher à 100', () => {
  const r = computeNewElo(110, 110, 0, 0); // −40 attendu, borné à 100
  assert.equal(r.after, 100);
  assert.equal(r.delta, -10);
});

test('provisoire tant que moins de 5 parties', () => {
  assert.equal(isProvisional(4), true);
  assert.equal(isProvisional(5), false);
});

test('abandon avant le 10e demi-coup : non classée', () => {
  assert.equal(isRatable({ termination: 'resign', plies: 6 }), false);
  assert.equal(isRatable({ termination: 'resign', plies: 10 }), true);
  assert.equal(isRatable({ termination: 'checkmate', plies: 4 }), true);
});
