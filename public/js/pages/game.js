// Page Partie : fiche de la partie et replay coup par coup
import { html, formatDelta, formatDate, toast } from '../ui.js';
import { api } from '../api.js';
import { createBoard, FEN } from '../board.js';
import { TERMINATIONS, TIME_CONTROL_LABELS, scoreLabel, formatDuration } from '../chess-labels.js';

let boardApi = null;
let keyHandler = null;

export function unmount() {
  boardApi?.destroy(); boardApi = null;
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
}

export async function render(main, [id]) {
  const { game: g } = await api.get(`/games/${id}`);
  const fens = [FEN.start, ...g.moves.map(m => m.fen_after)];
  let ply = fens.length - 1;

  main.innerHTML = html`
    <div class="page-head">
      <div>
        <h1>${g.status === 'finished' ? scoreLabel(g.user_score) : 'Partie en cours'} <span class="badge">${g.user_color === 'white' ? 'Blancs' : 'Noirs'}</span></h1>
        <p>${formatDate(g.started_at, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · contre l'IA ${g.ai_elo} Elo (${g.ai_persona}) · ${TIME_CONTROL_LABELS[g.time_control]}${g.termination ? ` · ${TERMINATIONS[g.termination]}` : ''}</p>
      </div>
      <div style="display:flex;gap:8px">
        ${g.status === 'ongoing' ? html`<a class="btn btn-primary" href="#/jouer">Reprendre</a>` : ''}
        <button class="btn btn-ghost" id="pgn-btn">Copier le PGN</button>
      </div>
    </div>

    <div class="play">
      <div class="play-board-col">
        <div class="board-wrap"><div id="board"></div></div>
        <div class="replay-controls">
          <button class="btn btn-sm" data-go="start" title="Début">⏮</button>
          <button class="btn btn-sm" data-go="prev" title="Coup précédent">◀</button>
          <span class="replay-pos" id="replay-pos"></span>
          <button class="btn btn-sm" data-go="next" title="Coup suivant">▶</button>
          <button class="btn btn-sm" data-go="end" title="Fin">⏭</button>
        </div>
      </div>
      <div class="play-side">
        ${g.rated ? html`
        <div class="card elo-change" style="margin-bottom:16px">
          <div><span class="k">Elo avant</span><span>${g.elo_before}</span></div>
          <div><span class="k">Variation</span><span>${formatDelta(g.elo_delta)}</span></div>
          <div><span class="k">Elo après</span><span class="elo">${g.elo_after}</span></div>
        </div>` : g.status === 'finished' ? html`<div class="card" style="margin-bottom:16px"><span class="setup-hint">Partie non classée.</span></div>` : ''}
        <div class="card">
          <div class="moves moves-tall" id="moves"></div>
          <div class="setup-hint" style="margin-top:10px">${g.move_count} demi-coups · ${formatDuration(g.duration_s)}</div>
        </div>
        <div class="card" style="margin-top:16px">
          <h3>Analyse</h3>
          <p class="setup-hint">L'analyse automatique des coups arrive à la phase 3.</p>
        </div>
      </div>
    </div>`;

  boardApi = createBoard(main.querySelector('#board'), { fen: fens[ply], orientation: g.user_color });

  const movesEl = main.querySelector('#moves');
  const rows = [];
  for (let i = 0; i < g.moves.length; i += 2) {
    rows.push(html`<div class="move-row"><span class="n">${i / 2 + 1}.</span>
      <button class="move-btn" data-ply="${i + 1}">${g.moves[i].san}</button>
      ${g.moves[i + 1] ? html`<button class="move-btn" data-ply="${i + 2}">${g.moves[i + 1].san}</button>` : ''}</div>`);
  }
  movesEl.innerHTML = rows.length ? html`${rows}` : html`<span class="setup-hint">Aucun coup.</span>`;

  function show(p, animated = true) {
    ply = Math.max(0, Math.min(fens.length - 1, p));
    boardApi.setPosition(fens[ply], animated);
    const m = g.moves[ply - 1];
    boardApi.setLastMove(m?.uci.slice(0, 2), m?.uci.slice(2, 4));
    main.querySelector('#replay-pos').textContent = ply === 0 ? 'Position initiale' : `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'} ${m.san}`;
    movesEl.querySelectorAll('.move-btn').forEach(b => b.classList.toggle('on', Number(b.dataset.ply) === ply));
    const on = movesEl.querySelector('.move-btn.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  show(ply, false);

  main.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
    const go = b.dataset.go;
    show(go === 'start' ? 0 : go === 'end' ? fens.length - 1 : go === 'prev' ? ply - 1 : ply + 1);
  }));
  movesEl.addEventListener('click', e => { const b = e.target.closest('.move-btn'); if (b) show(Number(b.dataset.ply)); });
  keyHandler = (e) => {
    if (e.key === 'ArrowLeft') show(ply - 1);
    else if (e.key === 'ArrowRight') show(ply + 1);
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(fens.length - 1);
  };
  document.addEventListener('keydown', keyHandler);

  main.querySelector('#pgn-btn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(g.pgn); toast('PGN copié'); }
    catch { toast('Copie impossible dans ce navigateur'); }
  });
}
