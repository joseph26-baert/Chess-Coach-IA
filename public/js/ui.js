// Utilitaires d'interface : rendu HTML sûr, toasts, formats
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Gabarit HTML : html`...${valeur}...` échappe les valeurs ; raw() pour insérer du HTML déjà sûr
class SafeHtml {
  constructor(s) { this.__raw = s; }
  toString() { return this.__raw; }
}
export function raw(s) { return new SafeHtml(String(s)); }
function renderValue(v) {
  if (v === undefined || v === null || v === false) return '';
  if (v instanceof SafeHtml) return v.__raw;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  return escapeHtml(v);
}
// Le résultat est lui-même un fragment sûr : les gabarits peuvent s'imbriquer.
export function html(strings, ...values) {
  return new SafeHtml(strings.reduce((out, str, i) => out + renderValue(values[i - 1]) + str));
}

let toastTimer;
export function toast(message, ms = 2800) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function formatDelta(n) {
  if (n > 0) return raw(`<span class="delta-pos">+${n}</span>`);
  if (n < 0) return raw(`<span class="delta-neg">${n}</span>`);
  return raw(`<span class="delta-zero">±0</span>`);
}

export function formatDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Date(iso).toLocaleDateString('fr-FR', opts);
}

export function initials(name) { return (name || '?').slice(0, 2).toUpperCase(); }

// Lie un <form> : empêche le rechargement, sérialise les champs, affiche les erreurs
export function bindForm(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = form.querySelector('.form-error');
    if (errBox) errBox.remove();
    const btn = form.querySelector('button[type=submit]');
    const data = Object.fromEntries(new FormData(form).entries());
    btn.disabled = true;
    try {
      await handler(data, form);
    } catch (err) {
      const box = document.createElement('div');
      box.className = 'form-error';
      box.textContent = err.message || 'Une erreur est survenue.';
      form.prepend(box);
    } finally {
      btn.disabled = false;
    }
  });
}
