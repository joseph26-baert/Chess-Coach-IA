// Page Jouer : réglages d'une nouvelle partie, puis partie contre l'IA
import { html, raw, toast, formatDelta } from '../ui.js';
import { api } from '../api.js';
import { state, setUser, navigate } from '../app.js';
import { createBoard } from '../board.js';
import { TERMINATIONS, TIME_CONTROL_LABELS, resultLabel } from '../chess-labels.js';

let boardApi = null;
let clockTimer = null;
let game = null;
let session = 0; // jeton de rendu : les réponses d'une page quittée sont ignorées

export function unmount() {
  session++;
  clearInterval(clockTimer);
  boardApi?.destroy();
  boardApi = null;
  game = null;
}

export async function render(main) {
  const { game: current } = await api.get('/games/current');
  if (current) return renderGame(main, current);
  renderSetup(main);
}

// --- Réglages ------------------------------------------------------------
function renderSetup(main) {
  const u = state.user;
  const color = u.preferred_color;
  main.innerHTML = html`
    <div class="page-head"><div><h1>Jouer contre l'IA</h1><p>Choisissez vos réglages. L'IA jouera au niveau indiqué, sans tricher sur le résultat.</p></div></div>
    <div class="setup card">
      <div class="setup-row">
        <div class="setup-label">Ma couleur</div>
        <div class="switch" data-name="color">
          <button type="button" data-value="white" class="${color === 'white' ? 'on' : ''}">Blancs</button>
          <button type="button" data-value="random" class="${color === 'random' ? 'on' : ''}">Aléatoire</button>
          <button type="button" data-value="black" class="${color === 'black' ? 'on' : ''}">Noirs</button>
        </div>
      </div>
      <div class="setup-row">
        <div class="setup-label">Force de l'IA <span class="setup-hint">par rapport à votre Elo (${u.elo})</span></div>
        <div class="switch" data-name="ai_offset">
          <button type="button" data-value="weaker" class="${u.ai_offset === 'weaker' ? 'on' : ''}">Un peu plus faible</button>
          <button type="button" data-value="equal" class="${u.ai_offset === 'equal' ? 'on' : ''}">Mon niveau</button>
          <button type="button" data-value="stronger" class="${u.ai_offset === 'stronger' ? 'on' : ''}">Un peu plus forte</button>
        </div>
      </div>
      <div class="setup-row">
        <div class="setup-label">Pendule</div>
        <div class="switch" data-name="time_control">
          ${Object.entries(TIME_CONTROL_LABELS).map(([v, l]) => html`<button type="button" data-value="${v}" class="${v === 'none' ? 'on' : ''}">${l}</button>`)}
        </div>
      </div>
      <div class="setup-actions">
        <button class="btn btn-primary btn-lg" id="start-btn">Commencer la partie</button>
        ${u.provisional ? html`<span class="setup-hint">Classement provisoire : vos ${5 - u.rated_games} prochaines parties affinent votre Elo.</span>` : ''}
      </div>
    </div>`;

  main.querySelectorAll('.switch').forEach(sw => sw.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    sw.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  }));
  const pick = (name) => main.querySelector(`.switch[data-name=${name}] button.on`).dataset.value;

  main.querySelector('#start-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const { game: g } = await api.post('/games', { color: pick('color'), ai_offset: pick('ai_offset'), time_control: pick('time_control') });
      renderGame(main, g);
    } catch (err) { toast(err.message); e.target.disabled = false; }
  });
}

// --- Partie --------------------------------------------------------------
function renderGame(main, g) {
  const token = ++session;
  game = g;
  const myColor = g.user_color;
  main.innerHTML = html`
    <div class="play">
      <div class="play-board-col">
        <div class="player-bar">
          <span class="avatar small">IA</span>
          <span class="player-name">IA · ${g.ai_elo} Elo <span class="setup-hint">· ${g.ai_persona}</span></span>
          <span class="player-clock" id="clock-ai">${g.time_control === 'none' ? '' : '∞'}</span>
        </div>
        <div class="board-wrap"><div id="board"></div></div>
        <div class="player-bar">
          <span class="avatar small">${state.user.username.slice(0, 2).toUpperCase()}</span>
          <span class="player-name">${state.user.username} · ${state.user.elo} Elo</span>
          <span class="player-clock" id="clock-user"></span>
        </div>
      </div>
      <div class="play-side">
        <div class="card">
          <div class="status" id="status"></div>
          <div class="moves" id="moves"></div>
          <div class="play-actions">
            <button class="btn btn-danger btn-sm" id="resign-btn">Abandonner</button>
            <label class="check"><input type="checkbox" id="threats-toggle" ${state.user.show_threats ? 'checked' : ''}> Cases menacées</label>
          </div>
        </div>
      </div>
    </div>
    <div class="modal" id="end-modal" hidden></div>`;

  boardApi = createBoard(main.querySelector('#board'), { fen: g.fen, orientation: myColor, onMove: submitMove });
  boardApi.setThreats(!!state.user.show_threats);
  main.querySelector('#threats-toggle').addEventListener('change', e => boardApi.setThreats(e.target.checked));
  main.querySelector('#resign-btn').addEventListener('click', resign);

  updateView();
  startClock();
}

async function submitMove({ from, to, promotion }) {
  const token = session;
  boardApi.disableInput();
  document.getElementById('status').textContent = "L'IA réfléchit…";
  try {
    const { game: g, user } = await api.post(`/games/${game.id}/move`, { from, to, promotion });
    if (token !== session) return true;
    applyServerState(g, user);
    return true;
  } catch (err) {
    if (token !== session) return true;
    toast(err.message);
    if (err.status === 400 || err.status === 409) { updateView(); return false; }
    // Erreur serveur : on se resynchronise sur l'état réel de la partie
    try { const { game: g } = await api.get('/games/current'); if (g && token === session) applyServerState(g); } catch { /* réseau */ }
    return true;
  }
}

async function resign() {
  if (!confirm('Abandonner cette partie ?')) return;
  try {
    const { game: g, user } = await api.post(`/games/${game.id}/resign`);
    applyServerState(g, user);
  } catch (err) { toast(err.message); }
}

function applyServerState(g, user) {
  game = g;
  if (user) setUser(user);
  boardApi.setPosition(g.fen, true);
  updateView();
}

function updateView() {
  const g = game;
  const last = g.moves[g.moves.length - 1];
  boardApi.setLastMove(last?.uci.slice(0, 2), last?.uci.slice(2, 4));

  const myTurn = g.status === 'ongoing' && g.turn === g.user_color;
  if (myTurn) boardApi.enableInput(g.user_color); else boardApi.disableInput();

  const status = document.getElementById('status');
  if (g.status === 'ongoing') {
    status.textContent = myTurn ? (g.in_check ? 'Échec ! À vous de jouer.' : 'À vous de jouer.') : "L'IA réfléchit…";
  } else {
    status.textContent = 'Partie terminée.';
  }

  // Liste des coups
  const rows = [];
  for (let i = 0; i < g.moves.length; i += 2) {
    rows.push(html`<div class="move-row"><span class="n">${i / 2 + 1}.</span><span>${g.moves[i].san}</span><span>${g.moves[i + 1]?.san ?? ''}</span></div>`);
  }
  const movesEl = document.getElementById('moves');
  movesEl.innerHTML = rows.length ? html`${rows}` : html`<span class="setup-hint">Aucun coup joué.</span>`;
  movesEl.scrollTop = movesEl.scrollHeight;

  updateClockDisplay();
  if (g.status === 'finished') { clearInterval(clockTimer); showEnd(); }
}

// --- Pendule -------------------------------------------------------------
function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
let clockBase = null, clockAt = null, flagging = false, nextFlagAt = 0;
function updateClockDisplay() {
  const el = document.getElementById('clock-user');
  if (!el) return;
  if (game.user_time_ms === null || game.user_time_ms === undefined) { el.textContent = ''; return; }
  clockBase = game.user_time_ms; clockAt = Date.now();
  el.textContent = fmt(clockBase);
  el.classList.toggle('running', game.status === 'ongoing' && game.turn === game.user_color);
}
function startClock() {
  clearInterval(clockTimer);
  clockTimer = setInterval(async () => {
    if (!game || game.status !== 'ongoing' || clockBase === null) return;
    const el = document.getElementById('clock-user');
    if (!el) return;
    const running = game.turn === game.user_color;
    const remaining = running ? clockBase - (Date.now() - clockAt) : clockBase;
    el.textContent = fmt(remaining);
    el.classList.toggle('low', remaining < 20_000);
    if (running && remaining <= 0 && !flagging && Date.now() >= nextFlagAt) {
      flagging = true;
      try { const { game: g, user } = await api.post(`/games/${game.id}/flag`); applyServerState(g, user); }
      catch { /* réseau : on réessaiera */ }
      finally { flagging = false; nextFlagAt = Date.now() + 1500; }
    }
  }, 250);
}

// --- Fin de partie -------------------------------------------------------
function showEnd() {
  const g = game;
  const modal = document.getElementById('end-modal');
  const won = g.user_score === 1, draw = g.user_score === 0.5;
  modal.hidden = false;
  modal.innerHTML = html`
    <div class="modal-card">
      <div class="end-title ${won ? 'win' : draw ? 'draw' : 'loss'}">${won ? 'Victoire' : draw ? 'Partie nulle' : 'Défaite'}</div>
      <div class="end-sub">${TERMINATIONS[g.termination] || g.termination} · ${resultLabel(g.result)}</div>
      ${g.rated ? html`
        <div class="elo-change">
          <div><span class="k">Elo avant</span><span>${g.elo_before}</span></div>
          <div><span class="k">Variation</span><span>${formatDelta(g.elo_delta)}</span></div>
          <div><span class="k">Elo après</span><span class="elo">${g.elo_after}</span></div>
        </div>
        ${state.user.provisional ? html`<div class="setup-hint">Classement provisoire (${state.user.rated_games}/5 parties).</div>` : ''}`
      : html`<div class="setup-hint">Partie non classée : abandon avant le 10ᵉ demi-coup.</div>`}
      ${g.move_count >= 4 ? html`<div class="setup-hint" style="margin-top:6px">L'analyse de la partie est lancée automatiquement.</div>` : ''}
      <div class="end-actions">
        <button class="btn btn-primary" id="again-btn">Rejouer</button>
        <a class="btn btn-ghost" href="#/partie/${g.id}">Analyse et replay</a>
        <a class="btn btn-ghost" href="#/tableau-de-bord">Tableau de bord</a>
      </div>
    </div>`;
  modal.querySelector('#again-btn').addEventListener('click', async () => {
    try {
      const { game: ng } = await api.post('/games', { color: g.user_color, ai_offset: g.ai_offset, time_control: g.time_control });
      modal.hidden = true;
      boardApi.destroy();
      renderGame(document.getElementById('main'), ng);
    } catch (err) { toast(err.message); }
  });
}
