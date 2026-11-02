// Application monopage : état d'authentification, routeur, navigation
import { api } from './api.js';
import { html, raw, initials } from './ui.js';

// ----- État global -------------------------------------------------------
export const state = { user: null };

export async function refreshUser() {
  const { user } = await api.get('/auth/me');
  state.user = user;
  document.documentElement.dataset.theme = user?.theme || localStorage.getItem('theme') || 'dark';
  renderNav();
  return user;
}

export function setUser(user) {
  state.user = user;
  if (user) document.documentElement.dataset.theme = user.theme;
  renderNav();
}

// ----- Routes ------------------------------------------------------------
// Chaque page exporte render(container, params) et éventuellement unmount().
const routes = [
  { path: /^\/?$/,              page: 'home',      auth: false },
  { path: /^\/inscription$/,    page: 'register',  auth: false, guestOnly: true },
  { path: /^\/connexion$/,      page: 'login',     auth: false, guestOnly: true },
  { path: /^\/mot-de-passe$/,   page: 'forgot',    auth: false },
  { path: /^\/reset\/(\w+)$/,   page: 'reset',     auth: false },
  { path: /^\/tableau-de-bord$/,page: 'dashboard', auth: true },
  { path: /^\/jouer$/,          page: 'play',      auth: true },
  { path: /^\/partie\/(\d+)$/,  page: 'game',      auth: true },
  { path: /^\/historique$/,     page: 'history',   auth: true },
  { path: /^\/entrainement$/,   page: 'training',  auth: true },
  { path: /^\/exercice$/,       page: 'puzzle',    auth: true },
  { path: /^\/profil$/,         page: 'profile',   auth: true },
  { path: /^\/parametres$/,     page: 'settings',  auth: true },
];

const NAV = [
  { href: '#/tableau-de-bord', label: 'Tableau de bord', short: 'Accueil', icon: 'grid' },
  { href: '#/jouer',           label: 'Jouer',           icon: 'knight' },
  { href: '#/entrainement',    label: 'Entraînement',    short: 'Entraîner', icon: 'target' },
  { href: '#/historique',      label: 'Historique',      icon: 'list' },
  { href: '#/profil',          label: 'Profil',          icon: 'user' },
  { href: '#/parametres',      label: 'Paramètres',      icon: 'cog' },
];

const ICONS = {
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  knight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 21h12M8 21v-2c0-2 1-3 2-4l-3-1c-1-.5-1.5-2-1-3l3-3c1-1 2-3 2-5l2 1c2 1 4 2 4 6 0 3-1 5-2 7v4"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 17l5-5-5-5M15 12H3M21 3v18"/></svg>',
};

function currentPath() {
  const h = location.hash.replace(/^#/, '') || '/';
  return h.split('?')[0];
}

export function navigate(path) { location.hash = path.startsWith('#') ? path : '#' + path; }

// ----- Navigation (barre latérale + barre d'onglets mobile) --------------
function renderNav() {
  const sidebar = document.getElementById('sidebar');
  const tabbar = document.getElementById('tabbar');
  const path = currentPath();
  const u = state.user;

  const links = (items, short = false) => items.map(i => html`<a href="${i.href}" class="${'#' + path === i.href ? 'active' : ''}">${raw(ICONS[i.icon])}<span>${short ? (i.short || i.label) : i.label}</span></a>`);

  if (!u) {
    sidebar.innerHTML = html`
      <a class="brand" href="#/"><span class="brand-mark">♞</span>Chess Coach IA</a>
      <div class="nav">
        <a href="#/connexion" class="${path === '/connexion' ? 'active' : ''}">${raw(ICONS.user)}<span>Connexion</span></a>
        <a href="#/inscription" class="${path === '/inscription' ? 'active' : ''}">${raw(ICONS.knight)}<span>Créer un compte</span></a>
      </div>`;
    tabbar.innerHTML = html`
      <a href="#/" class="${path === '/' ? 'active' : ''}">${raw(ICONS.knight)}Accueil</a>
      <a href="#/connexion" class="${path === '/connexion' ? 'active' : ''}">${raw(ICONS.user)}Connexion</a>
      <a href="#/inscription" class="${path === '/inscription' ? 'active' : ''}">${raw(ICONS.grid)}Inscription</a>`;
    return;
  }

  sidebar.innerHTML = html`
    <a class="brand" href="#/tableau-de-bord"><span class="brand-mark">♞</span>Chess Coach IA</a>
    <div class="nav">${links(NAV)}</div>
    <div class="sidebar-foot">
      <a class="user-chip" href="#/profil">
        <span class="avatar">${initials(u.username)}</span>
        <span><div class="name">${u.username}</div><div class="elo">${u.elo} Elo${u.provisional ? ' · provisoire' : ''}</div></span>
      </a>
      <button class="btn btn-ghost btn-sm btn-block" id="logout-btn" style="margin-top:10px">${raw(ICONS.logout)} Se déconnecter</button>
    </div>`;
  tabbar.innerHTML = html`${links(NAV, true)}`;
  document.getElementById('logout-btn').addEventListener('click', logout);
}

export async function logout() {
  await api.post('/auth/logout');
  state.user = null;
  renderNav();
  navigate('/');
}

// ----- Routeur -----------------------------------------------------------
let currentPage = null;

async function route() {
  const path = currentPath();
  const main = document.getElementById('main');

  for (const r of routes) {
    const m = path.match(r.path);
    if (!m) continue;
    if (r.auth && !state.user) { navigate('/connexion'); return; }
    if (r.guestOnly && state.user) { navigate('/tableau-de-bord'); return; }

    if (currentPage?.unmount) currentPage.unmount();
    main.innerHTML = '<div class="loading">Chargement…</div>';
    const mod = await import(`./pages/${r.page}.js`);
    currentPage = mod;
    window.scrollTo(0, 0);
    try {
      await mod.render(main, m.slice(1));
    } catch (err) {
      console.error(err);
      main.innerHTML = html`<div class="empty">Cette page n'a pas pu se charger. ${err.message}</div>`;
    }
    renderNav();
    return;
  }
  main.innerHTML = html`<div class="auth-layout"><h1>Page introuvable</h1><p><a href="#/">Retour à l'accueil</a></p></div>`;
}

window.addEventListener('hashchange', route);
refreshUser().then(route);
