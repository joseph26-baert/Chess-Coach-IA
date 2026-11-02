// Tests de l'analyseur (fonctions pures, sans moteur)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { toWhiteCp, mateIn, mateSide, lossFor, labelFor, winDrop, moveAccuracy, winProb, isHanging, isFork, detectMotifs, explain, MOTIFS, CATEGORIES_FR } from '../server/services/analysis.js';

test('conversion des évaluations au point de vue des blancs', () => {
  assert.equal(toWhiteCp({ cp: 50, mate: null }, 'w'), 50);
  assert.equal(toWhiteCp({ cp: 50, mate: null }, 'b'), -50);
  assert.equal(mateIn(toWhiteCp({ cp: null, mate: 3 }, 'w')), 3);     // les blancs matent en 3
  assert.equal(mateIn(toWhiteCp({ cp: null, mate: 3 }, 'b')), -3);    // les noirs matent en 3
  assert.equal(mateIn(toWhiteCp({ cp: null, mate: -2 }, 'w')), -2);   // les blancs se font mater en 2
  assert.equal(mateIn(120), null);
});

test('perte d un coup selon le camp', () => {
  assert.equal(lossFor(100, 20, 'w'), 80);
  assert.equal(lossFor(100, 20, 'b'), 0);      // pour les noirs c est un gain
  assert.equal(lossFor(-100, -400, 'b'), 0);   // −100 → −400 est bon pour les noirs
  assert.equal(lossFor(-100, 200, 'b'), 300);
  assert.equal(lossFor(9999, 0, 'w'), 1000);   // mat perdu : plafonné à 1000
});

test('étiquettes par chute de probabilité de gain', () => {
  assert.equal(labelFor(0), 'best');
  assert.equal(labelFor(0.05), 'good');
  assert.equal(labelFor(0.15), 'inaccuracy');
  assert.equal(labelFor(0.25), 'mistake');
  assert.equal(labelFor(0.4), 'blunder');
  assert.equal(labelFor(0.4, { playedIsBest: true }), 'best');
  assert.equal(labelFor(0.05, { missedMate: true }), 'mistake');   // mat raté mais toujours gagnant : au moins « erreur »
  assert.equal(labelFor(0.5, { missedMate: true }), 'blunder');
  // 2 pions perdus dans une position déjà gagnée ≠ gaffe
  assert.equal(labelFor(winDrop(2500, 800, 'w')), 'good');
  assert.equal(labelFor(winDrop(0, -200, 'w')), 'inaccuracy');
  assert.equal(labelFor(winDrop(0, -400, 'b')), 'best');            // 0 → −400 est bon pour les noirs
});

test('mat délivré : camp identifié, jamais un « mat manqué »', () => {
  assert.equal(mateSide(10000), 1);
  assert.equal(mateSide(-10000), -1);
  assert.equal(mateIn(10000), 0);
  const before = new Chess('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  const move = before.moves({ verbose: true }).find(m => m.san === 'Ra8#');
  assert.deepEqual(detectMotifs({ chessBefore: before, move, bestUci: 'a1a8', replyUci: null, evalBefore: 9999, evalAfter: 10000, loss: 0, ply: 50 }), []);
});

test('précision : meilleur coup = 100, grosse chute = faible', () => {
  assert.ok(moveAccuracy(0.5, 0.5, 'w') > 99);
  assert.ok(moveAccuracy(0.9, 0.3, 'w') < 20);
  assert.ok(moveAccuracy(0.3, 0.9, 'b') < 20);   // chute pour les noirs
  assert.ok(moveAccuracy(0.3, 0.9, 'w') > 99);   // gain pour les blancs
  assert.ok(Math.abs(winProb(0) - 0.5) < 1e-9 && winProb(300) > 0.7 && winProb(-300) < 0.3);
});

test('pièce en prise : attaquée et non défendue, ou par moins cher', () => {
  // Cavalier noir en d4 attaqué par Cf3, non défendu
  const c = new Chess('r1bqkbnr/pppppppp/8/8/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
  assert.equal(isHanging(c, 'd4', 'b'), true);
  assert.equal(isHanging(c, 'f7', 'b'), false);  // f7 attaqué par Fc4 mais défendu par le roi, attaquant de même valeur ou plus
  // Dame attaquée par un pion : en prise même si défendue
  const d = new Chess('rnb1kbnr/pppp1ppp/8/4p3/3qP3/2P5/PP1P1PPP/RNBQKBNR w KQkq - 0 3');
  assert.equal(isHanging(d, 'd4', 'b'), true);
  // Pion défendu, « attaqué » seulement par le roi adverse : pas en prise (prise illégale)
  const e = new Chess('8/8/8/8/8/3k4/3P4/2BK4 w - - 0 1');
  assert.equal(isHanging(e, 'd2', 'w'), false);
});

test('fourchette : cavalier qui attaque roi et dame', () => {
  // Blancs : Cc7+ fourchette roi e8 et tour a8 (tour > cavalier)
  const c = new Chess('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1');
  assert.equal(isFork(c, 'd5c7'), true);
  assert.equal(isFork(c, 'd5e3'), false);
  // Cavalier fourchant immédiatement pris : pas une fourchette
  const d = new Chess('r2bk3/8/8/3N4/8/8/8/4K3 w - - 0 1');
  assert.equal(isFork(d, 'd5c7'), false);
});

test('motif : pièce laissée en prise', () => {
  // Cc6-d4?? sans pion e5 pour le défendre, 4.Cxd4
  const before = new Chess('r1bqkbnr/pppppppp/2n5/8/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');
  const move = before.moves({ verbose: true }).find(m => m.san === 'Nd4');
  const motifs = detectMotifs({ chessBefore: before, move, bestUci: 'g8f6', replyUci: 'f3d4', evalBefore: 30, evalAfter: 330, loss: 300, ply: 6 });
  assert.deepEqual(motifs, ['hanging-piece']);
  assert.match(explain({ motifs, move, bestSan: 'Nf6', loss: 300, label: 'blunder', replySan: 'Nxd4' }), /Cavalier laissé en prise \(Nxd4\)/);
});

test('motif : menace ignorée (pièce déjà attaquée, coup ailleurs)', () => {
  // 1.e4 e5 2.Cf3 a6?? 3.Cxe5
  const before = new Chess('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2');
  const move = before.moves({ verbose: true }).find(m => m.san === 'a6');
  const motifs = detectMotifs({ chessBefore: before, move, bestUci: 'b8c6', replyUci: 'f3e5', evalBefore: 30, evalAfter: 150, loss: 120, ply: 4 });
  assert.equal(motifs[0], 'ignored-threat');
});

test('motif : mat manqué et mat encaissé', () => {
  const before = new Chess('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'); // Ta8# disponible
  const move = before.moves({ verbose: true }).find(m => m.san === 'Kf1');
  assert.deepEqual(detectMotifs({ chessBefore: before, move, bestUci: 'a1a8', replyUci: 'g8h8', evalBefore: 9999, evalAfter: 500, loss: 500, ply: 50 }), ['missed-mate']);
  const b2 = new Chess('6k1/5ppp/8/8/8/8/r4PPP/6K1 w - - 0 1'); // on simule une évaluation « mat en 2 pour les noirs » après h3
  const m2 = b2.moves({ verbose: true }).find(m => m.san === 'h3');
  assert.deepEqual(detectMotifs({ chessBefore: b2, move: m2, bestUci: 'g1h1', replyUci: 'a1a2', evalBefore: -300, evalAfter: -9998, loss: 700, ply: 50 }), ['allowed-mate']);
});

test('motif : prise gratuite manquée', () => {
  // Blancs : Cxd4 gagne un cavalier non défendu ; ils jouent autre chose
  const before = new Chess('r1bqkbnr/pppppppp/8/8/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
  const move = before.moves({ verbose: true }).find(m => m.san === 'd3');
  const motifs = detectMotifs({ chessBefore: before, move, bestUci: 'f3d4', replyUci: 'd4f3', evalBefore: 330, evalAfter: 30, loss: 300, ply: 7 });
  assert.ok(motifs.includes('missed-capture'), motifs.join(','));
});

test('motif : phase de jeu (ouverture, finale)', () => {
  const opening = new Chess('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  const m1 = opening.moves({ verbose: true }).find(m => m.san === 'h4');
  assert.deepEqual(detectMotifs({ chessBefore: opening, move: m1, bestUci: 'g1f3', replyUci: 'b8c6', evalBefore: 30, evalAfter: -50, loss: 80, ply: 3 }), ['slow-development']);
  const endgame = new Chess('8/8/4k3/8/8/3K4/4P3/8 w - - 0 1');
  const m2 = endgame.moves({ verbose: true }).find(m => m.san === 'e4');
  assert.deepEqual(detectMotifs({ chessBefore: endgame, move: m2, bestUci: 'd3d4', replyUci: 'e6e5', evalBefore: 200, evalAfter: 0, loss: 200, ply: 80 }), ['endgame-technique']);
});

test('chaque motif a une catégorie connue et un libellé', () => {
  for (const [k, v] of Object.entries(MOTIFS)) {
    assert.ok(CATEGORIES_FR[v.category], `${k} → ${v.category}`);
    assert.ok(v.fr.length > 3);
  }
});
