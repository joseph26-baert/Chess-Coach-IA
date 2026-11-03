// Éléments communs aux pages Progression et Statistiques : onglets, sélecteur de période, tuiles
import { html, formatDelta } from '../ui.js';

export const PERIODS = [['7', '7 jours'], ['30', '30 jours'], ['90', '3 mois'], ['365', '1 an'], ['all', 'Tout']];

export function currentPeriod() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const p = q.get('periode');
  return PERIODS.some(([k]) => k === p) ? p : '30';
}

export function periodLabel(p) {
  return { 7: 'les 7 derniers jours', 30: 'les 30 derniers jours', 90: 'les 3 derniers mois', 365: 'les 12 derniers mois', all: 'toute la période' }[p];
}

export function header({ title, subtitle, active, period }) {
  return html`
    <div class="page-head">
      <div><h1>${title}</h1><p>${subtitle}</p></div>
      <div class="stats-controls">
        <div class="segmented" role="tablist" aria-label="Page">
          <a href="#/progression?periode=${period}" class="${active === 'progression' ? 'on' : ''}" role="tab">Progression</a>
          <a href="#/statistiques?periode=${period}" class="${active === 'statistiques' ? 'on' : ''}" role="tab">Statistiques</a>
        </div>
        <div class="segmented" role="group" aria-label="Période">
          ${PERIODS.map(([k, l]) => html`<a href="#/${active}?periode=${k}" class="${k === period ? 'on' : ''}">${l}</a>`)}
        </div>
      </div>
    </div>`;
}

export function tile(label, value, sub, cls = '') {
  return html`<div class="card stat"><span class="label">${label}</span><span class="value ${cls}">${value}</span>${sub ? html`<span class="sub">${sub}</span>` : ''}</div>`;
}

export const n = (v, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`);
export const delta = (v) => (v === null || v === undefined ? '—' : formatDelta(v));
export const emptyCard = (title, text) => html`<div class="card"><h3>${title}</h3><div class="empty">${text}</div></div>`;
