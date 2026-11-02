// Page Exercice : résolution sur l'échiquier, indice, solution, enchaînement des exercices
import { html, toast } from '../ui.js';
import { api } from '../api.js';
import { createBoard } from '../board.js';

let boardApi = null;
let gen = 0;

export function unmount() { gen++; boardApi?.destroy(); boardApi = null; }

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
  let p = null, index = 0, hints = 0, startedAt = 0, finished = false, playedSan = [];
  let chessMoves = null;

  async function load() {
    const q = new URLSearchParams();
    if (theme) q.set('theme', theme);
    if (category) q.set('category', category);
    if (seen.length) q.set('exclude', seen.join(','));
    const { puzzle } = await api.get('/training/next?' + q.toString());
    if (myGen !== gen) return;
    if (!puzzle) {
      el('pz-status').textContent = "Plus d'exercice disponible pour ce thème pour le moment.";
      el('pz-info').innerHTML = html`<a class="btn btn-ghost" href="#/entrainement">Retour à l'entraînement</a>`;
      return;
    }
    p = puzzle; index = 0; hints = 0; finished = false; playedSan = []; startedAt = Date.now();
    window.__puzzleId = p.id; window.__fen = p.fen; // utiles aux tests automatisés
    seen.push(p.id);
    boardApi?.destroy();
    boardApi = createBoard(el('board'), { fen: p.fen, orientation: p.turn, onMove: onUserMove });
    chessMoves = boardApi.chess;
    boardApi.enableInput(p.turn);
    el('pz-turn').innerHTML = html`<span class="dot ${p.turn === 'white' ? 'w' : 'b'}"></span> Trait aux ${p.turn === 'white' ? 'blancs' : 'noirs'} · trouvez le meilleur coup${p.length > 1 ? ` (${p.length} coups)` : ''}`;
    el('pz-sub').textContent = p.reason === 'review' ? 'Révision (répétition espacée)' : p.reason === 'own' ? 'Tiré de votre propre partie' : theme ? `Thème : ${p.themeLabels.join(', ')}` : 'Programme du jour';
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
    const r = await api.post(`/training/puzzle/${p.id}/move`, { uci, index });
    if (myGen !== gen) return false;
    if (!r.correct) {
      el('pz-status').innerHTML = html`<span class="lbl-blunder">Ce n'est pas le bon coup.</span> Réessayez, demandez un indice ou regardez la solution.`;
      return false;
    }
    const mv = chessMoves.move({ from, to, promotion });
    playedSan.push(mv.san);
    boardApi.setLastMove(from, to);
    renderMoves();
    index++;
    if (r.done) return finish(hints ? 'solved-hint' : 'solved');
    // Réponse adverse
    setTimeout(() => {
      if (myGen !== gen) return;
      const rep = chessMoves.move({ from: r.reply.slice(0, 2), to: r.reply.slice(2, 4), promotion: r.reply[4] });
      playedSan.push(rep.san);
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

  async function finish(result) {
    finished = true;
    boardApi.disableInput();
    el('hint-btn').disabled = true; el('solution-btn').disabled = true;
    const { attempt } = await api.post(`/training/puzzle/${p.id}/attempt`, { result, hints, time_ms: Date.now() - startedAt });
    if (myGen !== gen) return true;
    stats.done++; if (result !== 'failed') stats.solved++;
    updateStats();
    const delta = attempt.rating_after - attempt.rating_before;
    el('pz-status').innerHTML = result === 'failed'
      ? html`<span class="lbl-blunder">Solution affichée.</span> Thème : ${p.themeLabels.join(', ')}. Niveau ${attempt.theme} : ${attempt.rating_after} (${delta >= 0 ? '+' : ''}${delta}). Cet exercice reviendra demain.`
      : html`<span class="lbl-best">${result === 'solved' ? 'Réussi !' : 'Réussi avec indice.'}</span> Thème : ${p.themeLabels.join(', ')}. Niveau ${attempt.theme} : ${attempt.rating_after} (${delta >= 0 ? '+' : ''}${delta}).${attempt.retired ? ' Exercice maîtrisé.' : ''}`;
    el('next-btn').hidden = false;
    return true;
  }

  el('hint-btn').addEventListener('click', async () => {
    if (finished) return;
    const { from } = await api.get(`/training/puzzle/${p.id}/hint?index=${index}`);
    hints++;
    boardApi.setLastMove(from, from);
    el('pz-status').textContent = `Indice : jouez la pièce en ${from}.`;
  });

  el('solution-btn').addEventListener('click', async () => {
    if (finished) return;
    finished = true;
    boardApi.disableInput();
    const { solution, san } = await api.get(`/training/puzzle/${p.id}/solution`);
    // Rejoue la solution depuis le début, coup par coup
    const c = boardApi.chess; c.load(p.fen); playedSan = [];
    for (let i = 0; i < solution.length; i++) {
      if (myGen !== gen) return;
      c.move(san[i]); playedSan.push(san[i]);
      await boardApi.setPosition(c.fen(), true);
      boardApi.setLastMove(solution[i].slice(0, 2), solution[i].slice(2, 4));
      renderMoves();
      await new Promise(r => setTimeout(r, 650));
    }
    finished = false; // finish() repasse à true
    await finish('failed');
  });

  el('next-btn').addEventListener('click', load);
  await load();
}
