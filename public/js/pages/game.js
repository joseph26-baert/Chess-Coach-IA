// Page Partie : fiche de la partie, rapport d'analyse et replay annoté coup par coup
import { html, raw, formatDelta, formatDate, toast } from '../ui.js';
import { api } from '../api.js';
import { createBoard, FEN } from '../board.js';
import { replayBar } from '../replay-ui.js';
import { TERMINATIONS, TIME_CONTROL_LABELS, scoreLabel, formatDuration, LABELS, LABEL_SYMBOLS, CATEGORIES } from '../chess-labels.js';

let boardApi = null;
let keyHandler = null;
let pollTimer = null;
let chart = null;
let mountGen = 0; // jeton : les réponses asynchrones d'une page quittée sont ignorées

export function unmount() {
  mountGen++;
  boardApi?.destroy(); boardApi = null;
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  clearTimeout(pollTimer);
  chart?.destroy(); chart = null;
}

export async function render(main, [id]) {
  const gen = ++mountGen;
  const alive = () => gen === mountGen;
  const [{ game: g }, { analysis: a0 }] = await Promise.all([api.get(`/games/${id}`), api.get(`/games/${id}/analysis`)]);
  if (!alive()) return;
  const fens = [FEN.start, ...g.moves.map(m => m.fen_after)];
  let ply = fens.length - 1;
  let analysis = a0;

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
        <div class="card eval-card" id="eval-card" hidden>
          <div class="eval-head"><span id="eval-value"></span><span class="setup-hint" id="eval-depth"></span></div>
          <div class="eval-chart"><canvas id="eval-chart" height="110"></canvas></div>
        </div>
        <div class="card" id="comment-card" hidden>
          <div class="comment-label" id="comment-label"></div>
          <div id="comment-text"></div>
        </div>
      </div>
      <div class="play-side">
        ${g.rated ? html`
        <div class="card elo-change" style="margin-bottom:16px">
          <div><span class="k">Elo avant</span><span>${g.elo_before}</span></div>
          <div><span class="k">Variation</span><span>${formatDelta(g.elo_delta)}</span></div>
          <div><span class="k">Elo après</span><span class="elo">${g.elo_after}</span></div>
        </div>` : g.status === 'finished' ? html`<div class="card" style="margin-bottom:16px"><span class="setup-hint">Partie non classée.</span></div>` : ''}
        <div class="card" id="analysis-card"></div>
        <div class="card" style="margin-top:16px">
          <div class="moves moves-tall" id="moves"></div>
          <div class="setup-hint" style="margin-top:10px">${g.move_count} demi-coups · ${formatDuration(g.duration_s)}</div>
        </div>
      </div>
    </div>
    <div id="report"></div>`;

  boardApi = createBoard(main.querySelector('#board'), { fen: fens[ply], orientation: g.user_color });
  const movesEl = main.querySelector('#moves');

  // ---- Liste des coups (annotée si l'analyse est disponible) ----
  function renderMoves() {
    const ev = analysis?.status === 'done' ? analysis.moves : null;
    const rows = [];
    for (let i = 0; i < g.moves.length; i += 2) {
      const cell = (j) => {
        const m = g.moves[j]; if (!m) return '';
        const e = ev?.[j];
        const cls = e ? ` lbl-${e.label}` : '';
        return html`<button class="move-btn${cls}" data-ply="${j + 1}">${m.san}${e && LABEL_SYMBOLS[e.label] ? html`<sup>${LABEL_SYMBOLS[e.label]}</sup>` : ''}</button>`;
      };
      rows.push(html`<div class="move-row"><span class="n">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}</div>`);
    }
    movesEl.innerHTML = rows.length ? html`${rows}` : html`<span class="setup-hint">Aucun coup.</span>`;
  }

  // ---- Navigation ----
  function show(p, animated = true) {
    ply = Math.max(0, Math.min(fens.length - 1, p));
    boardApi.setPosition(fens[ply], animated);
    const m = g.moves[ply - 1];
    boardApi.setLastMove(m?.uci.slice(0, 2), m?.uci.slice(2, 4));
    main.querySelector('#replay-pos').textContent = ply === 0 ? 'Position initiale' : `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'} ${m.san}`;
    movesEl.querySelectorAll('.move-btn').forEach(b => b.classList.toggle('on', Number(b.dataset.ply) === ply));
    movesEl.querySelector('.move-btn.on')?.scrollIntoView({ block: 'nearest' });
    updateAnnotation();
  }

  function updateAnnotation() {
    const ev = analysis?.status === 'done' ? analysis : null;
    const commentCard = main.querySelector('#comment-card');
    if (!ev) { commentCard.hidden = true; boardApi.clearArrows(); return; }
    const e = ply > 0 ? ev.moves[ply - 1] : null;
    // Évaluation de la position affichée
    const pt = ev.summary.curve[ply];
    main.querySelector('#eval-value').textContent = pt ? evalText(pt) : '';
    if (chart) { chart.setActiveElements([{ datasetIndex: 0, index: ply }]); chart.update('none'); }
    if (e) {
      commentCard.hidden = false;
      main.querySelector('#comment-label').innerHTML = html`<span class="lbl-${e.label}">${LABEL_SYMBOLS[e.label] || ''} ${LABELS[e.label]}</span>${e.by_user ? '' : html` <span class="setup-hint">(IA)</span>`}${e.motifs.length ? html` <span class="badge">${e.motifs.map(m => CATEGORIES[m] || m).join(' · ')}</span>` : ''}`;
      const showBest = e.best_uci && e.label !== 'best' && e.label !== 'good';
      const text = (e.label === 'best' || e.label === 'good') && !e.explanation.startsWith('Seul') ? '' : e.explanation;
      main.querySelector('#comment-text').innerHTML = html`${text}${showBest ? html` <button class="btn btn-sm btn-ghost" id="show-best">Voir le meilleur coup</button>` : ''}`;
      boardApi.clearArrows();
      main.querySelector('#show-best')?.addEventListener('click', () => {
        // Position avant le coup : flèche rouge = coup joué, flèche verte = meilleur coup
        const played = g.moves[ply - 1].uci;
        const at = ply;
        boardApi.setPosition(fens[ply - 1], true).then(() => {
          if (!alive() || ply !== at) return; // l'utilisateur a navigué entre-temps
          boardApi.setLastMove(null, null);
          boardApi.setArrows([{ from: played.slice(0, 2), to: played.slice(2, 4), type: 'played' }, { from: e.best_uci.slice(0, 2), to: e.best_uci.slice(2, 4), type: 'best' }]);
        });
        main.querySelector('#comment-text').innerHTML = html`${e.explanation} <span class="setup-hint">Rouge : ${e.by_user ? 'votre coup' : "le coup de l'IA"}. Vert : ${e.best_san}.</span> <button class="btn btn-sm btn-ghost" id="back-after">Revenir</button>`;
        main.querySelector('#back-after').addEventListener('click', () => show(ply, true));
      });
    } else { commentCard.hidden = true; boardApi.clearArrows(); }
  }

  // ---- Carte d'analyse (état + résumé) et rapport ----
  function renderAnalysis() {
    const card = main.querySelector('#analysis-card');
    const report = main.querySelector('#report');
    if (g.status !== 'finished') { card.innerHTML = html`<h3>Analyse</h3><p class="setup-hint">Disponible à la fin de la partie.</p>`; return; }
    if (!analysis || analysis.status === 'error') {
      card.innerHTML = html`<h3>Analyse</h3><p class="setup-hint">${analysis?.error ? "L'analyse a échoué." : g.move_count < 4 ? 'Partie trop courte pour être analysée.' : "Pas encore d'analyse."}</p>
        ${g.move_count >= 4 ? html`<button class="btn btn-sm" id="analyse-btn">Lancer l'analyse</button>` : ''}`;
      card.querySelector('#analyse-btn')?.addEventListener('click', async () => {
        try { const r = await api.post(`/games/${g.id}/analyse`); analysis = r.analysis; renderAnalysis(); poll(); } catch (err) { toast(err.message); }
      });
      return;
    }
    if (analysis.status !== 'done') {
      const pct = Math.round(100 * analysis.progress / (g.move_count + 1));
      card.innerHTML = html`<h3>Analyse en cours</h3><div class="progress"><div style="width:${pct}%"></div></div><p class="setup-hint">Stockfish évalue chaque position (${pct} %). Le rapport s'affichera automatiquement.</p>`;
      report.innerHTML = '';
      return;
    }
    const s = analysis.summary, c = s.counts.user;
    card.innerHTML = html`
      <h3>Analyse</h3>
      <div class="acc-row"><div class="stat"><span class="label">Votre précision</span><span class="value">${s.accuracy.user} %</span></div>
        <div class="stat"><span class="label">Précision de l'IA</span><span class="value" style="color:var(--text-2)">${s.accuracy.ai} %</span></div></div>
      <div class="label-counts">
        <span class="lbl-inaccuracy">${c.inaccuracy} imprécision${c.inaccuracy > 1 ? 's' : ''}</span>
        <span class="lbl-mistake">${c.mistake} erreur${c.mistake > 1 ? 's' : ''}</span>
        <span class="lbl-blunder">${c.blunder} gaffe${c.blunder > 1 ? 's' : ''}</span>
      </div>
      <a href="#report" class="setup-hint">Voir le rapport complet ↓</a>`;

    const errorRow = (e) => html`<button class="err-row" data-ply="${e.ply}">
        <span class="err-move lbl-${e.label}">${Math.ceil(e.ply / 2)}${e.ply % 2 ? '.' : '…'} ${e.san}${LABEL_SYMBOLS[e.label]}</span>
        <span class="err-text">${e.explanation}</span></button>`;
    report.innerHTML = html`
      <h2 style="margin-top:32px">Rapport de partie</h2>
      <div class="grid report-grid">
        <div class="card">
          <h3>Moments décisifs</h3>
          ${s.decisive.length ? s.decisive.map(d => html`<button class="err-row" data-ply="${d.ply}"><span class="err-move lbl-${d.label}">${Math.ceil(d.ply / 2)}${d.ply % 2 ? '.' : '…'} ${d.san}</span><span class="err-text">${d.by_user ? 'Vous' : "L'IA"} : ${d.explanation} (bascule de ${Math.round(d.swing * 100)} %)</span></button>`) : html`<p class="setup-hint">Pas de bascule nette : partie équilibrée du début à la fin.</p>`}
        </div>
        <div class="card">
          <h3>Vos principales erreurs</h3>
          ${s.keyErrors.length ? s.keyErrors.map(errorRow) : html`<p class="setup-hint">Aucune erreur notable. Bravo.</p>`}
        </div>
        <div class="card">
          <h3>Vos meilleurs coups</h3>
          ${s.bestMoves.length ? s.bestMoves.map(b => html`<button class="err-row" data-ply="${b.ply}"><span class="err-move lbl-best">${Math.ceil(b.ply / 2)}${b.ply % 2 ? '.' : '…'} ${b.san}!</span><span class="err-text">${b.explanation}</span></button>`) : html`<p class="setup-hint">Pas de « seul coup » difficile dans cette partie.</p>`}
        </div>
        <div class="card">
          <h3>Points forts et points faibles</h3>
          ${s.strengths.length ? html`<div class="tag-row">${s.strengths.map(x => html`<span class="tag tag-good">${x.label}</span>`)}</div>` : ''}
          ${s.weaknesses.length ? html`<div class="tag-row">${s.weaknesses.map(x => html`<span class="tag tag-bad">${x.label}</span>`)}</div>` : html`<p class="setup-hint">Aucune faiblesse marquée dans cette partie.</p>`}
          ${s.recommendations.length ? html`<h3 style="margin-top:16px">Recommandations d'entraînement</h3><ul class="reco">${s.recommendations.map(r => html`<li>${r.text}</li>`)}</ul>` : ''}
        </div>
      </div>`;
    report.querySelectorAll('.err-row').forEach(b => b.addEventListener('click', () => { show(Number(b.dataset.ply)); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    renderChart();
  }

  async function renderChart() {
    const s = analysis.summary;
    const card = main.querySelector('#eval-card');
    card.hidden = false;
    main.querySelector('#eval-depth').textContent = `profondeur ${s.depth}`;
    const Chart = await loadChartJs();
    if (!alive()) return;
    const css = getComputedStyle(document.documentElement);
    const data = s.curve.map(p => Math.max(-10, Math.min(10, p.cp / 100)));
    chart?.destroy();
    chart = new Chart(main.querySelector('#eval-chart'), {
      type: 'line',
      data: { labels: s.curve.map((_, i) => i), datasets: [{ data, borderColor: css.getPropertyValue('--amber').trim(), borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, fill: { target: 'origin', above: 'rgba(213,211,220,.45)', below: 'rgba(119,116,155,.35)' }, tension: 0.2 }] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        scales: { x: { display: false }, y: { min: -10, max: 10, ticks: { display: false }, grid: { color: 'rgba(128,128,128,.15)' } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => items[0].dataIndex === 0 ? 'Position initiale' : `Après ${Math.ceil(items[0].dataIndex / 2)}${items[0].dataIndex % 2 ? '.' : '…'} ${g.moves[items[0].dataIndex - 1].san}`, label: (it) => evalText(s.curve[it.dataIndex]) } } },
        onClick: (_, els) => { if (els.length) show(els[0].index); },
      },
    });
    updateAnnotation();
  }

  function evalText(pt) {
    if (pt.mate !== null && pt.mate !== undefined) {
      const side = (pt.mate !== 0 ? pt.mate : pt.cp) > 0 ? 'blancs' : 'noirs';
      return pt.mate === 0 ? `Mat, victoire des ${side}` : `Mat en ${Math.abs(pt.mate)} pour les ${side}`;
    }
    const v = pt.cp / 100;
    return (v > 0 ? '+' : '') + v.toFixed(1);
  }

  const pollStart = Date.now();
  function poll() {
    clearTimeout(pollTimer);
    if (!alive() || !analysis || !['pending', 'running'].includes(analysis.status)) return;
    if (Date.now() - pollStart > 10 * 60_000) { analysis = { status: 'error', error: 'délai dépassé' }; renderAnalysis(); return; }
    pollTimer = setTimeout(async () => {
      try { const r = await api.get(`/games/${g.id}/analysis`); if (alive()) analysis = r.analysis; } catch { /* réseau */ }
      if (!alive()) return;
      renderAnalysis(); renderMoves(); show(ply, false); poll();
    }, 2500);
  }

  renderMoves();
  renderAnalysis();
  show(ply, false);
  poll();

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

// Chart.js (version autonome, chargée une seule fois)
let chartJsPromise = null;
export function loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!chartJsPromise) chartJsPromise = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = '/vendor/chart.js/chart.umd.js';
    sc.onload = () => resolve(window.Chart);
    sc.onerror = () => reject(new Error('Chart.js introuvable'));
    document.head.appendChild(sc);
  });
  return chartJsPromise;
}
