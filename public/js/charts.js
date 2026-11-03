// Graphiques : chargement de Chart.js, réglages communs (couleurs du thème, grille discrète,
// infobulles), et constructeurs pour les formes utilisées par les pages Progression et Statistiques.

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

export function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return { amber: v('--amber'), green: v('--green'), chart2: v('--chart-2') || v('--green'), win: v('--win'), loss: v('--loss'), draw: v('--draw'),
           text: v('--text-2'), muted: v('--text-3'), line: v('--line'), surface: v('--surface'), font: v('--font-ui') };
}

export function withAlpha(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const shortDate = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const longDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function baseOptions(c, { yMin, yMax, yTicks, xTicks, suggestedMax, stacked, legend } = {}) {
  return {
    animation: false, responsive: true, maintainAspectRatio: false, locale: 'fr-FR',
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 6, right: 8 } },
    font: { family: c.font },
    scales: {
      x: { stacked: !!stacked, grid: { display: false }, border: { color: c.line }, ticks: { color: c.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 7, font: { family: c.font, size: 11 }, ...xTicks } },
      y: { stacked: !!stacked, min: yMin, max: yMax, suggestedMax, grace: yMin === undefined && yMax === undefined ? '12%' : 0, grid: { color: withAlpha(c.line, .6), drawTicks: false }, border: { display: false },
           ticks: { color: c.muted, padding: 8, font: { family: c.font, size: 11 }, ...yTicks } },
    },
    plugins: {
      legend: { display: !!legend, position: 'top', align: 'end', labels: { color: c.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle', font: { family: c.font, size: 12 } } },
      tooltip: { backgroundColor: c.surface, titleColor: c.text, bodyColor: c.text, borderColor: c.line, borderWidth: 1, padding: 10, displayColors: true,
                 boxWidth: 8, boxHeight: 8, usePointStyle: true, titleFont: { family: c.font, weight: '600' }, bodyFont: { family: c.font } },
    },
  };
}

// Courbe (Elo, précision…) : ligne 2 px, points visibles seulement au survol, aire légère
export async function lineChart(canvas, { labels, series, yMin, yMax, suggestedMax, yTicks, legend, tooltipTitle, tooltipLabel, fill = true, onClick }) {
  const Chart = await loadChartJs();
  const c = themeColors();
  const opts = baseOptions(c, { yMin, yMax, suggestedMax, yTicks, legend });
  if (tooltipTitle || tooltipLabel) opts.plugins.tooltip.callbacks = { ...(tooltipTitle && { title: tooltipTitle }), ...(tooltipLabel && { label: tooltipLabel }) };
  if (onClick) opts.onClick = (_, els) => { if (els.length) onClick(els[0].index); };
  return new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: series.map(s => ({ label: s.label, data: s.data, borderColor: s.color, backgroundColor: fill && series.length === 1 ? withAlpha(s.color, .12) : s.color,
      fill: fill && series.length === 1 ? 'origin' : false, borderWidth: 2, pointRadius: s.points ?? (s.data.length > 60 ? 0 : 2.5), pointHoverRadius: 5, pointBackgroundColor: s.color,
      pointBorderColor: c.surface, pointBorderWidth: 1.5, tension: 0.25, spanGaps: true, stepped: s.stepped || false })) },
    options: opts,
  });
}

// Barres verticales (activité par semaine, erreurs par partie) : fines, bouts arrondis, écart entre séries
export async function barChart(canvas, { labels, series, stacked, legend, yTicks, suggestedMax, tooltipTitle, tooltipLabel, horizontal }) {
  const Chart = await loadChartJs();
  const c = themeColors();
  const opts = baseOptions(c, { stacked, legend, yTicks, suggestedMax, yMin: 0 });
  if (horizontal) { opts.indexAxis = 'y'; const { x, y } = opts.scales; opts.scales = { x: { ...y, min: 0 }, y: { ...x, ticks: { ...x.ticks, autoSkip: false, maxTicksLimit: 20, callback: function (v) { const l = this.getLabelForValue(v); const max = canvas.clientWidth < 420 ? 16 : 28; return l.length > max ? l.slice(0, max - 1) + '…' : l; } } } }; }
  if (tooltipTitle || tooltipLabel) opts.plugins.tooltip.callbacks = { ...(tooltipTitle && { title: tooltipTitle }), ...(tooltipLabel && { label: tooltipLabel }) };
  return new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: series.map((s, i) => ({ label: s.label, data: s.data, backgroundColor: Array.isArray(s.color) ? s.color : s.color, borderColor: c.surface, borderWidth: stacked ? 1 : 0,
      borderRadius: stacked ? (i === series.length - 1 ? 4 : 0) : 4, borderSkipped: stacked ? false : 'start', maxBarThickness: 28, categoryPercentage: 0.6, barPercentage: stacked ? 1 : 0.85 })) },
    options: opts,
  });
}
