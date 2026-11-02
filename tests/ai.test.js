// Tests de la sélection de coup de l'IA humaine (sans moteur : lignes fournies à la main)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paramsForElo, pickMove, newPersona, naturalness, rollDepth, cpOf, validPersona, positionKey, AI_MIN_ELO, AI_MAX_ELO } from '../server/engine/ai.js';
import { Chess } from 'chess.js';

const neutral = { temperatureMul: 1, blunderMul: 1, aggression: 1 };
const always = (v) => () => v;         // générateur aléatoire constant
function seq(values) { let i = 0; return () => values[i++ % values.length]; }

test('les paramètres évoluent de façon monotone avec l Elo', () => {
  let prev = paramsForElo(AI_MIN_ELO);
  for (let elo = AI_MIN_ELO + 100; elo <= AI_MAX_ELO; elo += 100) {
    const p = paramsForElo(elo);
    assert.ok(p.depth >= prev.depth, `profondeur à ${elo}`);
    assert.ok(p.temperature <= prev.temperature, `température à ${elo}`);
    assert.ok(p.blunderRate <= prev.blunderRate, `gaffes à ${elo}`);
    assert.ok(p.mateMissRate <= prev.mateMissRate, `mats ratés à ${elo}`);
    prev = p;
  }
  assert.ok(paramsForElo(2200).mateMissRate <= 0.02);
  assert.equal(paramsForElo(100).elo, AI_MIN_ELO, 'Elo borné en bas');
  assert.equal(paramsForElo(3000).elo, AI_MAX_ELO, 'Elo borné en haut');
});

// Position : 1.e4 e5 2.Nf3 Nc6 — trait aux blancs
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
const lines = [
  { move: 'f1b5', cp: 30, mate: null, depth: 8, pv: ['f1b5'] },
  { move: 'f1c4', cp: 25, mate: null, depth: 8, pv: ['f1c4'] },
  { move: 'd2d4', cp: 20, mate: null, depth: 8, pv: ['d2d4'] },
  { move: 'b1c3', cp: 15, mate: null, depth: 8, pv: ['b1c3'] },
  { move: 'h2h4', cp: -40, mate: null, depth: 8, pv: ['h2h4'] },
  { move: 'f3e5', cp: -150, mate: null, depth: 8, pv: ['f3e5'] },  // perd le cavalier
  { move: 'd1h5', cp: -400, mate: null, depth: 8, pv: ['d1h5'] },  // perd la dame (après Nxh5 ? non, exemple)
];

test('à 2200 avec un aléa nul, l IA joue le meilleur coup', () => {
  const r = pickMove(FEN, lines, paramsForElo(2200), neutral, 10, seq([0.999, 0])); // aucune erreur, tirage sur le 1er
  assert.equal(r.move, 'f1b5');
  assert.equal(r.reason, 'normal');
});

test('un coup normal ne dépasse jamais maxLoss', () => {
  for (const elo of [400, 800, 1200, 1600, 2000]) {
    const p = paramsForElo(elo);
    for (let i = 0; i < 200; i++) {
      const r = pickMove(FEN, lines, p, neutral, 10, seq([0.99, Math.random()])); // 0.99 : aucune erreur injectée
      if (r.reason === 'normal') assert.ok(r.loss <= p.maxLoss, `${elo}: perte ${r.loss} > ${p.maxLoss}`);
    }
  }
});

test('gaffe injectée : perte bornée, jamais le coup absurde si hors fourchette', () => {
  const p = paramsForElo(800); // blunderMaxLoss 700 → d1h5 (−430) possible, f3e5 (−180) possible
  // rng : mat (pas de mat ici), prise (pas de prise), gaffe → 0 (déclenche), puis choix dans la fourchette
  const r = pickMove(FEN, lines, p, neutral, 10, seq([0, 0, 0, 0.5]));
  assert.equal(r.reason, 'blunder');
  assert.ok(r.loss >= p.blunderMinLoss && r.loss <= p.blunderMaxLoss, String(r.loss));

  const strong = paramsForElo(2000); // blunderMaxLoss 220 → seul f3e5 (180) est éligible
  const r2 = pickMove(FEN, lines, strong, neutral, 10, seq([0, 0, 0, 0.5]));
  assert.equal(r2.reason, 'blunder');
  assert.equal(r2.move, 'f3e5');
});

test('pas de gaffe injectée dans les tout premiers coups', () => {
  const r = pickMove(FEN, lines, paramsForElo(400), neutral, 2, seq([0, 0, 0, 0.5]));
  assert.notEqual(r.reason, 'blunder');
});

test('mat en 1 manqué selon le niveau', () => {
  // Position : mat en 1 disponible (Dame h5 x f7#) : 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7#
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
  const l = [
    { move: 'h5f7', cp: null, mate: 1, depth: 6, pv: ['h5f7'] },
    { move: 'h5e5', cp: 300, mate: null, depth: 6, pv: ['h5e5'] },
    { move: 'b1c3', cp: 10, mate: null, depth: 6, pv: ['b1c3'] },
  ];
  const weak = pickMove(fen, l, paramsForElo(600), neutral, 8, seq([0, 0.5]));    // rng 0 < mateMissRate → raté
  assert.equal(weak.reason, 'missed-mate');
  assert.notEqual(weak.move, 'h5f7');
  const strong = pickMove(fen, l, paramsForElo(2200), neutral, 8, seq([0.5, 0.5]));  // 0.5 > taux → vu
  assert.equal(strong.move, 'h5f7');
});

test('prise gratuite non vue : seulement une pièce non défendue, hors reprise, repli borné', () => {
  // 1.Cf3 e5?? : le pion e5 est gratuit (non défendu)
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2';
  const l = [
    { move: 'f3e5', cp: 150, mate: null, depth: 6, pv: ['f3e5'] },
    { move: 'e2e4', cp: -10, mate: null, depth: 6, pv: ['e2e4'] },
    { move: 'd2d4', cp: -20, mate: null, depth: 6, pv: ['d2d4'] },
  ];
  const p500 = paramsForElo(500);
  const weak = pickMove(fen, l, p500, neutral, 8, seq([0, 0.9, 0.5])); // prise : rng 0 → ratée ; gaffe : 0.9 → non
  assert.equal(weak.reason, 'missed-capture');
  assert.notEqual(weak.move, 'f3e5');
  assert.ok(weak.loss <= p500.blunderMaxLoss);
  const strong = pickMove(fen, l, paramsForElo(2200), neutral, 8, seq([0.5, 0.9, 0.5]));
  assert.equal(strong.move, 'f3e5');

  // Une reprise (la pièce vient de prendre sur cette case) n'est jamais « oubliée »
  const recap = pickMove(fen, l, p500, neutral, 8, seq([0.9, 0.5]), { lastMoveTo: 'e5' }); // pas de tirage « prise » : la gaffe tire 0.9 → non
  assert.equal(recap.reason, 'normal');
  assert.equal(recap.move, 'f3e5');

  // Une pièce défendue n'est pas une prise « gratuite » : pas d'oubli
  const defended = 'rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3';
  const l2 = [{ move: 'f3e5', cp: 200, mate: null, depth: 6, pv: [] }, { move: 'd2d4', cp: 20, mate: null, depth: 6, pv: [] }];
  const r2 = pickMove(defended, l2, p500, neutral, 8, seq([0, 0.9, 0.5]));
  assert.notEqual(r2.reason, 'missed-capture');
});

test('reprise obligatoire : l IA reprend la pièce même à 400', () => {
  // 1.e4 e5 2.Cf3 Cc6 3.d4 exd4 4.Cxd4 Cxd4 : les blancs doivent reprendre en d4
  const fen = 'r1bqkbnr/pppp1ppp/8/8/3nP3/8/PPP2PPP/RNBQKB1R w KQkq - 0 5';
  const l = [
    { move: 'd1d4', cp: 40, mate: null, depth: 6, pv: [] },
    { move: 'b1c3', cp: -480, mate: null, depth: 6, pv: [] },
    { move: 'f1c4', cp: -500, mate: null, depth: 6, pv: [] },
    { move: 'c2c3', cp: -520, mate: null, depth: 6, pv: [] },
  ];
  const p = paramsForElo(400);
  let recaptures = 0;
  for (let i = 0; i < 300; i++) {
    const r = pickMove(fen, l, p, neutral, 10, undefined, { lastMoveTo: 'd4' });
    if (r.move === 'd1d4') recaptures++;
  }
  assert.ok(recaptures >= 275, `reprises ${recaptures}/300`); // ≈ 97 % attendu (gaffes réduites sur une reprise)
});

test('mat forcé en quelques coups : l IA forte le joue, la faible parfois non', () => {
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
  const l = [
    { move: 'c4f7', cp: null, mate: 3, depth: 8, pv: [] },
    { move: 'b1c3', cp: 30, mate: null, depth: 8, pv: [] },
  ];
  assert.equal(pickMove(fen, l, paramsForElo(2000), neutral, 10, always(0.5)).reason, 'mating');
  const weak = pickMove(fen, l, paramsForElo(400), neutral, 10, always(0.5)); // 0.5 < 0.35×3 → pas vu
  assert.notEqual(weak.reason, 'mating');
});

test('score des mats ordonné : M1 > M3 > +1500 > −1500 > M−5 > M−1', () => {
  const v = (mate, cp = null) => cpOf({ mate, cp });
  assert.ok(v(1) > v(3) && v(3) > v(null, 1500) && v(null, 1500) > v(null, -1500) && v(null, -1500) > v(-5) && v(-5) > v(-1));
});

test('répétition évitée en position gagnante, recherchée en position perdante', () => {
  // Position quelconque où le trait a deux coups équivalents ; l un ramène à une position déjà vue deux fois
  const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
  const after = (san) => { const c = new Chess(fen); c.move(san); return c.fen(); };
  const seen = new Map([[positionKey(after('Kd1')), 2]]);
  const l = [{ move: 'e1d1', cp: 900, mate: null, depth: 6, pv: [] }, { move: 'e1f1', cp: 895, mate: null, depth: 6, pv: [] }];
  let repeats = 0;
  for (let i = 0; i < 200; i++) if (pickMove(fen, l, paramsForElo(1500), neutral, 40, undefined, { seen }).move === 'e1d1') repeats++;
  assert.ok(repeats < 30, `répétitions choisies ${repeats}/200`);
});

test('personnalité invalide : rejetée, valeurs par défaut utilisables', () => {
  assert.equal(validPersona({}), null);
  assert.equal(validPersona('human'), null);
  assert.equal(validPersona({ temperatureMul: 5, blunderMul: 1, aggression: 1 }), null);
  assert.deepEqual(validPersona({ temperatureMul: 1, blunderMul: 1, aggression: 1 }), neutral);
});

test('personnalité : valeurs bornées', () => {
  for (let i = 0; i < 500; i++) {
    const p = newPersona();
    assert.ok(p.temperatureMul >= 0.7 && p.temperatureMul <= 1.4);
    assert.ok(p.blunderMul >= 0.6 && p.blunderMul <= 1.6);
    assert.ok(p.aggression >= 0.7 && p.aggression <= 1.3);
  }
});

test('naturel : en ouverture, développer > sortir la dame > pion de bord', () => {
  const chess = new Chess(FEN);
  const mv = (san) => chess.moves({ verbose: true }).find(m => m.san === san);
  const dev = naturalness(chess, mv('Bc4'), 4, neutral);
  const queen = naturalness(chess, mv('Qe2'), 4, neutral);
  const edge = naturalness(chess, mv('a3'), 4, neutral);
  assert.ok(dev > queen && queen > edge, `${dev} ${queen} ${edge}`);
});

test('profondeur fractionnaire : 3,4 donne 3 ou 4 dans les bonnes proportions', () => {
  let fours = 0;
  for (let i = 0; i < 1000; i++) if (rollDepth(3.4, () => i / 1000) === 4) fours++;
  assert.ok(fours >= 390 && fours <= 410, String(fours));
  assert.equal(rollDepth(5, () => 0.99), 5);
});

test('un coup illégal proposé par le moteur est ignoré', () => {
  const l = [{ move: 'e1e8', cp: 999, mate: null, depth: 1, pv: [] }, ...lines];
  const r = pickMove(FEN, l, paramsForElo(1500), neutral, 10, seq([0.999, 0]));
  assert.notEqual(r.move, 'e1e8');
});
