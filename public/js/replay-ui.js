// Boutons de relecture (début, précédent, suivant, fin) : icônes SVG dans le style du site.
// `attr` = nom de l'attribut data-* lu par la page (ex. 'go' → data-go="prev").
import { html, raw } from './ui.js';

const ICON = {
  start: '<svg viewBox="0 0 24 24"><path d="M6 5v14M18 6l-8 6 8 6z"/></svg>',
  prev:  '<svg viewBox="0 0 24 24"><path d="M15 6l-7 6 7 6z"/></svg>',
  next:  '<svg viewBox="0 0 24 24"><path d="M9 6l7 6-7 6z"/></svg>',
  end:   '<svg viewBox="0 0 24 24"><path d="M18 5v14M6 6l8 6-8 6z"/></svg>',
};
const TITLE = { start: 'Position de départ', prev: 'Coup précédent', next: 'Coup suivant', end: 'Position actuelle' };

export function replayButton(kind, attr = 'go') {
  return raw(`<button class="replay-btn" type="button" data-${attr}="${kind}" title="${TITLE[kind]}" aria-label="${TITLE[kind]}">${ICON[kind]}</button>`);
}

// Barre complète ; `middle` est inséré entre « précédent » et « suivant » (position, compteur…)
export function replayBar(attr = 'go', middle = '') {
  return html`<div class="replay-bar">${replayButton('start', attr)}${replayButton('prev', attr)}${middle}${replayButton('next', attr)}${replayButton('end', attr)}</div>`;
}
