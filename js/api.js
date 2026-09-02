// api.js — utilitaires partagés par toutes les pages

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      headers: options.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
  } catch (networkError) {
    const err = new Error('Impossible de contacter le serveur. Vérifie ta connexion puis réessaie.');
    err.cause = networkError;
    err.status = 0;
    throw err;
  }

  let data = null;
  try { data = await res.json(); } catch (e) { /* réponse non JSON */ }

  if (!res.ok) {
    const fallback = res.status >= 500
      ? 'Le serveur a rencontré une erreur. Réessaie dans un instant.'
      : 'Une erreur est survenue.';
    const err = new Error((data && (data.message || data.error)) || fallback);
    err.data = data;
    err.status = res.status;
    throw err;
  }

  return data;
}

function ensureToastHolder() {
  let holder = document.getElementById('toast-holder');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'toast-holder';
    document.body.appendChild(holder);
  }
  return holder;
}

function toast(message, type = 'info') {
  const holder = ensureToastHolder();
  const el = document.createElement('div');
  el.className = 'toast' + (type !== 'info' ? ' ' + type : '');
  el.textContent = message;
  holder.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function initials(name) {
  return String(name || '?').trim().charAt(0).toUpperCase();
}

function avatarHtml(imageUrl, name, size) {
  const style = size ? ` style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.34)}px"` : '';
  if (imageUrl) {
    return `<img class="avatar" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}"${style}>`;
  }
  return `<div class="avatar"${style}>${escapeHtml(initials(name))}</div>`;
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
