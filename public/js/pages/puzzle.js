// Page Exercice : résolution sur l'échiquier, indice, solution, enchaînement des exercices
import { html, toast } from '../ui.js';
import { api } from '../api.js';
import { createBoard } from '../board.js';
import { replayBar } from '../replay-ui.js';

let boardApi = null;
let gen = 0;
let keyHandler = null;

export function unmount() { gen++; if (keyHandler) document.removeEventListener('keydown', keyHandler); keyHandler = null; boardApi?.destroy(); boardApi = null; }

export async function render(main) {
  const myGen = ++gen;
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const theme = params.get('theme');
  const category = params.get('category');
  const seen = [];
  let stats = { done: 0, solved: 0 };

  main.innerHTML = html`
    <div class="page-head">
      <div><h1>Exercice</h1><p id="pz-sub"></p></div>
      <div style="display:flex;gap:8px;align-items:center"><span class="setup-hint" id="pz-stats"></span><a class="btn btn-ghost" href="#/entrainement">Retour</a></div>
    </div>
    <div class="play">
      <div class="play-board-col">
        <div class="pz-turn" id="pz-turn"></div>
        <div class="board-wrap"><div id="board"></div></div>
      </div>
      <div class="play-side">
        <div class="card">
          <div class="pz-status" id="pz-status"></div>
          <div class="pz-moves" id="pz-moves"></div>
          <div id="pz-replay" hidden>${replayBar('nav')}<div class="setup-hint" style="margin:-4px 0 8px">Revoir les coups de l'exercice (lecture seule).</div></div>
          <div class="pz-actions">
            <button class="btn btn-ghost btn-sm" id="hint-btn">Indice</button>
            <button class="btn btn-ghost btn-sm" id="solution-btn">Voir la solution</button>
            <button class="btn btn-primary btn-sm" id="next-btn" hidden>Exercice suivant</button>
          </div>
        </div>
        <div class="card" style="margin-top:16px" id="pz-info"></div>
      </div>
    </div>`;

  const el = (id) => main.querySelector('#' + id);
  let p = null, index = 0, hints = 0, startedAt = 0, finished = false, playedSan = [], fens = [], viewPly = null;
  let chessMoves = null;

  async function load() {
    const q = new URLSearchParams();
    if (theme) q.set('theme', theme);
    if (category) q.set('category', category);
    if (seen.length) q.set('exclude', seen.join(','));
    q.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const { puzzle } = await api.get('/training/next?' + q.toString());
    if (myGen !== gen) return;
    if (!puzzle) {
      el('pz-status').textContent = "Plus d'exercice disponible pour ce thème pour le moment.";
      el('pz-info').innerHTML = html`<a class="btn btn-ghost" href="#/entrainement">Retour à l'entraînement</a>`;
      return;
    }
    p = puzzle; index = 0; hints = 0; finished = false; playedSan = []; fens = [puzzle.fen]; viewPly = null; startedAt = Date.now();
    el('pz-replay').hidden = true;
    seen.push(p.id);
    boardApi?.destroy();
    boardApi = createBoard(el('board'), { fen: p.fen, orientation: p.turn, onMove: onUserMove });
    el('board').dataset.puzzleId = p.id; el('board').dataset.fen = p.fen;
    chessMoves = boardApi.chess;
    boardApi.enableInput(p.turn);
    el('pz-turn').innerHTML = html`<span class="dot ${p.turn === 'white' ? 'w' : 'b'}"></span> Trait aux ${p.turn === 'white' ? 'blancs' : 'noirs'} · trouvez le meilleur coup${p.length > 1 ? ` (${p.length} coups)` : ''}`;
    el('pz-sub').textContent = p.reason === 'review' ? 'Révision (répétition espacée)' : p.reason === 'own' ? 'Tiré de votre propre partie' : theme ? `Thème : ${p.themeLabels.join(', ')}` : p.slot ? `Programme du jour — ${p.slot}` : 'Programme du jour';
    el('pz-status').textContent = 'À vous de jouer.';
    el('pz-moves').innerHTML = '';
    el('next-btn').hidden = true; el('hint-btn').disabled = false; el('solution-btn').disabled = false;
    el('pz-info').innerHTML = html`
      <div class="list-row"><span class="k">Thème</span><span>${theme ? p.themeLabels.join(', ') : 'révélé à la fin'}</span></div>
      <div class="list-row"><span class="k">Difficulté</span><span>${p.rating}</span></div>
      ${p.game_id ? html`<div class="list-row"><span class="k">Origine</span><a href="#/partie/${p.game_id}">votre partie n° ${p.game_id}, coup ${Math.ceil(p.ply / 2)}</a></div>` : ''}`;
    updateStats();
  }

  function updateStats() { el('pz-stats').textContent = stats.done ? `Session : ${stats.solved}/${stats.done} réussis` : ''; }

  async function onUserMove({ from, to, promotion }) {
    if (finished) return false;
    const uci = from + to + (promotion || '');
    boardApi.disableInput(); // pas de second coup pendant la validation
    let r;
    try { r = await api.post(`/training/puzzle/${p.id}/move`, { uci, index }); }
    catch (e) { if (myGen === gen) { toast(e.message); boardApi.enableInput(p.turn); } return false; }
    if (myGen !== gen) return false;
    if (!r.correct) {
      el('pz-status').innerHTML = html`<span class="lbl-blunder">Ce n'est pas le bon coup.</span> Réessayez, demandez un indice ou regardez la solution.`;
      boardApi.enableInput(p.turn);
      return false;
    }
    const mv = chessMoves.move({ from, to, promotion });
    playedSan.push(mv.san); fens.push(chessMoves.fen());
    boardApi.setLastMove(from, to);
    renderMoves();
    index++;
    if (r.done) return finish();
    // Réponse adverse
    setTimeout(() => {
      if (myGen !== gen) return;
      const rep = chessMoves.move({ from: r.reply.slice(0, 2), to: r.reply.slice(2, 4), promotion: r.reply[4] });
      playedSan.push(rep.san); fens.push(chessMoves.fen());
      boardApi.setPosition(chessMoves.fen(), true).then(() => { boardApi.setLastMove(r.reply.slice(0, 2), r.reply.slice(2, 4)); boardApi.enableInput(p.turn); });
      renderMoves();
      el('pz-status').textContent = 'Bien. Continuez.';
    }, 350);
    return true;
  }

  function renderMoves() {
    const startMoveNo = Number(p.fen.split(' ')[5]) || 1;
    const blackFirst = p.turn === 'black';
    const parts = [];
    playedSan.forEach((san, i) => {
      const moveNo = startMoveNo + Math.floor((i + (blackFirst ? 1 : 0)) / 2);
      const isWhite = blackFirst ? i % 2 === 1 : i % 2 === 0;
      parts.push(isWhite ? `${moveNo}. ${san}` : (i === 0 ? `${moveNo}… ${san}` : san));
    });
    el('pz-moves').textContent = parts.join('  ');
  }

  async function finish() {
    finished = true;
    boardApi.disableInput();
    el('hint-btn').disabled = true; el('solution-btn').disabled = true;
    if (fens.length > 1) { el('pz-replay').hidden = false; updateReplayButtons(); }
    try {
      // Le serveur déduit le résultat de ce qu'il a validé (coups, indices, solution vue)
      const { attempt } = await api.post(`/training/puzzle/${p.id}/attempt?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`, {});
      if (myGen !== gen) return true;
      const result = attempt.result;
      stats.done++; if (result !== 'failed') stats.solved++;
      updateStats();
      const delta = attempt.rating_after - attempt.rating_before;
      const themeText = attempt.themeLabels.join(', ') + (attempt.mate_in ? ` (mat en ${attempt.mate_in})` : '');
      el('pz-status').innerHTML = result === 'failed'
        ? html`<span class="lbl-blunder">Raté.</span> Thème : ${themeText}. Niveau ${attempt.theme} : ${attempt.rating_after} (${delta >= 0 ? '+' : ''}${delta}). Cet exercice reviendra demain.`
        : html`<span class="lbl-best">${result === 'solved' ? 'Réussi !' : 'Réussi avec indice.'}</span> Thème : ${themeText}. Niveau ${attempt.theme} : ${attempt.rating_after} (${delta >= 0 ? '+' : ''}${delta}).${attempt.retired ? ' Exercice maîtrisé.' : ''}`;
    } catch (e) {
      if (myGen === gen) el('pz-status').textContent = `Résultat non enregistré : ${e.message}`;
    } finally {
      if (myGen === gen) el('next-btn').hidden = false;
    }
    return true;
  }

  el('hint-btn').addEventListener('click', async () => {
    if (finished || !p) return;
    let from;
    try { ({ from } = await api.get(`/training/puzzle/${p.id}/hint`)); } catch (e) { toast(e.message); return; }
    if (myGen !== gen) return;
    hints++;
    boardApi.setLastMove(from, from);
    el('pz-status').textContent = `Indice : jouez la pièce en ${from}.`;
  });

  el('solution-btn').addEventListener('click', async () => {
    if (finished || !p) return;
    finished = true;
    boardApi.disableInput();
    let solution, san;
    try { ({ solution, san } = await api.get(`/training/puzzle/${p.id}/solution`)); } catch (e) { toast(e.message); finished = false; boardApi.enableInput(p.turn); return; }
    if (myGen !== gen) return;
    // Rejoue la solution depuis le début, coup par coup
    const c = boardApi.chess; c.load(p.fen); playedSan = []; fens = [p.fen];
    for (let i = 0; i < solution.length; i++) {
      if (myGen !== gen) return;
      c.move(san[i]); playedSan.push(san[i]); fens.push(c.fen());
      await boardApi.setPosition(c.fen(), true);
      boardApi.setLastMove(solution[i].slice(0, 2), solution[i].slice(2, 4));
      renderMoves();
      await new Promise(r => setTimeout(r, 650));
    }
    finished = false; // finish() repasse à true
    await finish();
  });

  function showPly(i) {
    if (!finished) return;
    i = Math.max(0, Math.min(fens.length - 1, i));
    viewPly = i === fens.length - 1 ? null : i;
    boardApi.setPosition(fens[i], true);
    updateReplayButtons();
  }
  function updateReplayButtons() {
    const cur = viewPly ?? fens.length - 1;
    main.querySelectorAll('[data-nav]').forEach(b => { const k = b.dataset.nav; b.disabled = (k === 'start' || k === 'prev') ? cur === 0 : cur === fens.length - 1; });
  }
  main.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
    const cur = viewPly ?? fens.length - 1, k = b.dataset.nav;
    showPly(k === 'start' ? 0 : k === 'end' ? fens.length - 1 : k === 'prev' ? cur - 1 : cur + 1);
  }));
  keyHandler = (e) => { if (!finished || e.target.closest('input, textarea')) return; const cur = viewPly ?? fens.length - 1; if (e.key === 'ArrowLeft') showPly(cur - 1); else if (e.key === 'ArrowRight') showPly(cur + 1); };
  document.addEventListener('keydown', keyHandler);

  el('next-btn').addEventListener('click', load);
  await load();
}
