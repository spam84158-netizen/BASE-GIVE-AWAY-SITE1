// admin.js — logique complète du panneau MORDREX CONTROL PANEL

const loginScreen = document.getElementById('login-screen');
const dashboard = document.getElementById('dashboard');
const tabContent = document.getElementById('tab-content');
const modalHolder = document.getElementById('modal-holder');

let currentTab = 'stats';
let cachedRewards = [];

function openModal(html) {
  modalHolder.innerHTML = `<div class="modal-overlay" id="overlay"><div class="modal">${html}</div></div>`;
  document.getElementById('overlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlay') closeModal();
  });
}
function closeModal() { modalHolder.innerHTML = ''; }

// ---------- Auth ----------

async function checkSession() {
  try {
    const s = await api('/api/admin/session');
    if (s.authenticated) { showDashboard(); return; }
  } catch (e) {}
  showLogin();
}

function showLogin() { loginScreen.style.display = 'flex'; dashboard.style.display = 'none'; }
function showDashboard() { loginScreen.style.display = 'none'; dashboard.style.display = 'block'; renderTab('stats'); }

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'CONNEXION…';
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: document.getElementById('l-user').value, password: document.getElementById('l-pass').value }),
    });
    showDashboard();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'SE CONNECTER';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch (err) {
    // Même si le serveur répond mal, on masque immédiatement le tableau de bord.
  }
  showLogin();
});

document.querySelectorAll('.admin-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => renderTab(btn.dataset.tab));
});

function setActiveTab(tab) {
  document.querySelectorAll('.admin-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}

async function renderTab(tab) {
  currentTab = tab;
  setActiveTab(tab);
  tabContent.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    if (tab === 'stats') await renderStats();
    else if (tab === 'rewards') await renderRewards();
    else if (tab === 'participants') await renderParticipants();
    else if (tab === 'coins') await renderCoins();
    else if (tab === 'referrals') await renderReferrals();
    else if (tab === 'draw') await renderDraw();
    else if (tab === 'settings') await renderSettings();
    else if (tab === 'audit') await renderAudit();
  } catch (err) {
    tabContent.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

// ---------- Statistiques ----------

async function renderStats() {
  const s = await api('/api/admin/stats');
  tabContent.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${s.participants}</div><div class="lbl">Participants</div></div>
      <div class="stat-card"><div class="num">${s.rewards}</div><div class="lbl">Récompenses</div></div>
      <div class="stat-card"><div class="num">${s.coinsDistributed}</div><div class="lbl">Coins distribués</div></div>
      <div class="stat-card"><div class="num">${s.referrals}</div><div class="lbl">Parrainages</div></div>
      <div class="stat-card"><div class="num">${s.activeParticipants}</div><div class="lbl">Actifs</div></div>
      <div class="stat-card"><div class="num">${s.blockedParticipants}</div><div class="lbl">Bloqués</div></div>
    </div>
    <h3 class="section-title" style="font-size:16px;">Inscriptions récentes</h3>
    <div class="panel" style="padding:6px 14px;">
      ${s.recentSignups.length === 0 ? '<p class="muted" style="padding:14px 0;">Aucune inscription pour le moment.</p>' :
        s.recentSignups.map((p) => `
          <div class="data-row"><div class="main"><strong>${escapeHtml(p.name)}</strong><span>#${String(p.number).padStart(3,'0')} · ${timeAgo(p.createdAt)}</span></div></div>
        `).join('')}
    </div>
  `;
}

// ---------- Récompenses ----------

async function renderRewards() {
  cachedRewards = await api('/api/admin/rewards');
  tabContent.innerHTML = `
    <button class="btn btn-gold" id="add-reward-btn">+ NOUVELLE RÉCOMPENSE (${cachedRewards.length}/20)</button>
    <div class="panel" style="padding:6px 14px;margin-top:10px;">
      ${cachedRewards.length === 0 ? '<p class="muted" style="padding:14px 0;">Aucune récompense créée.</p>' :
        cachedRewards.map((r) => `
          <div class="data-row">
            <div class="main">
              <strong>${escapeHtml(r.name)}</strong>
              <span>${r.requiredCoins} coins · ${r.winnersCount} gagnant(s) · ${r.participantsCount} participant(s) · <span class="badge ${r.status}">${r.status}</span></span>
            </div>
            <div class="row-actions">
              <button data-edit="${r.id}">Modifier</button>
              <button data-delete="${r.id}">Suppr.</button>
            </div>
          </div>
        `).join('')}
    </div>
  `;
  document.getElementById('add-reward-btn').addEventListener('click', () => openRewardModal(null));
  tabContent.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openRewardModal(cachedRewards.find((r) => r.id === b.dataset.edit))));
  tabContent.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => deleteReward(b.dataset.delete)));
}

function openRewardModal(reward) {
  openModal(`
    <h3>${reward ? 'Modifier' : 'Nouvelle'} récompense</h3>
    <form id="reward-form">
      <div class="field"><label>Nom</label><input type="text" id="r-name" required value="${reward ? escapeHtml(reward.name) : ''}"></div>
      <div class="field"><label>Description</label><textarea id="r-desc">${reward ? escapeHtml(reward.description || '') : ''}</textarea></div>
      <div class="field"><label>Coins nécessaires</label><input type="number" id="r-coins" min="1" required value="${reward ? reward.requiredCoins : ''}"></div>
      <div class="field"><label>Nombre de gagnants</label><input type="number" id="r-winners" min="1" required value="${reward ? reward.winnersCount : 1}"></div>
      <div class="field"><label>Conditions (facultatif)</label><input type="text" id="r-conditions" value="${reward ? escapeHtml(reward.conditions || '') : ''}"></div>
      <div class="field"><label>Statut</label>
        <select id="r-status" style="width:100%;padding:12px;background:rgba(255,255,255,0.04);border:1px solid var(--panel-border);border-radius:10px;color:var(--bone);">
          <option value="active" ${reward && reward.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="disabled" ${reward && reward.status === 'disabled' ? 'selected' : ''}>Désactivée</option>
          <option value="completed" ${reward && reward.status === 'completed' ? 'selected' : ''}>Terminée</option>
        </select>
      </div>
      <div class="field"><label>Image (facultatif)</label><input type="file" id="r-image" accept="image/png, image/jpeg, image/webp"></div>
      <button class="btn btn-primary" type="submit">ENREGISTRER</button>
      <button class="btn btn-outline" type="button" id="cancel-btn">ANNULER</button>
    </form>
  `);
  document.getElementById('cancel-btn').addEventListener('click', closeModal);
  document.getElementById('reward-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('name', document.getElementById('r-name').value.trim());
    fd.append('description', document.getElementById('r-desc').value.trim());
    fd.append('requiredCoins', document.getElementById('r-coins').value);
    fd.append('winnersCount', document.getElementById('r-winners').value);
    fd.append('conditions', document.getElementById('r-conditions').value.trim());
    fd.append('status', document.getElementById('r-status').value);
    const imgFile = document.getElementById('r-image').files[0];
    if (imgFile) fd.append('image', imgFile);
    try {
      if (reward) await api('/api/admin/rewards/' + reward.id, { method: 'PUT', body: fd });
      else await api('/api/admin/rewards', { method: 'POST', body: fd });
      toast('Récompense enregistrée.', 'success');
      closeModal();
      renderRewards();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function deleteReward(id) {
  if (!confirm('Supprimer définitivement cette récompense ?')) return;
  try {
    await api('/api/admin/rewards/' + id, { method: 'DELETE' });
    toast('Récompense supprimée.', 'success');
    renderRewards();
  } catch (err) { toast(err.message, 'error'); }
}

// ---------- Participants ----------

async function renderParticipants(search) {
  const list = await api('/api/admin/participants?search=' + encodeURIComponent(search || ''));
  tabContent.innerHTML = `
    <div class="search-box"><input type="text" id="p-search" placeholder="Rechercher un nom ou un numéro…" value="${escapeHtml(search || '')}"></div>
    <div class="panel" style="padding:6px 14px;">
      ${list.length === 0 ? '<p class="muted" style="padding:14px 0;">Aucun participant.</p>' :
        list.map((p) => `
          <div class="data-row">
            <div class="main">
              <strong>${escapeHtml(p.name)} ${p.status === 'blocked' ? '<span class="badge" style="color:var(--danger);border-color:var(--danger);">bloqué</span>' : ''}</strong>
              <span>#${String(p.number).padStart(3,'0')} · ${escapeHtml(p.phoneNumber || '')} · ${p.coins} coins · ${p.referralsCount} parrainage(s)</span>
            </div>
            <div class="row-actions">
              <button data-adjust="${p.id}">Coins</button>
              <button data-toggle="${p.id}" data-status="${p.status}">${p.status === 'blocked' ? 'Débloquer' : 'Bloquer'}</button>
              <button data-remove="${p.id}">Suppr.</button>
            </div>
          </div>
        `).join('')}
    </div>
  `;
  document.getElementById('p-search').addEventListener('input', (e) => {
    clearTimeout(window.__pSearchTimer);
    window.__pSearchTimer = setTimeout(() => renderParticipants(e.target.value), 350);
  });
  tabContent.querySelectorAll('[data-adjust]').forEach((b) => b.addEventListener('click', () => openAdjustModal(b.dataset.adjust)));
  tabContent.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleBlock(b.dataset.toggle, b.dataset.status)));
  tabContent.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => removeParticipant(b.dataset.remove, search)));
}

function openAdjustModal(id) {
  openModal(`
    <h3>Corriger les coins</h3>
    <form id="adjust-form">
      <div class="field"><label>Montant (positif ou négatif)</label><input type="number" id="a-amount" required placeholder="Ex. 10 ou -5"></div>
      <div class="field"><label>Motif (obligatoire, journalisé)</label><input type="text" id="a-reason" required placeholder="Ex. Bonus événement spécial"></div>
      <button class="btn btn-primary" type="submit">APPLIQUER</button>
      <button class="btn btn-outline" type="button" id="cancel-btn">ANNULER</button>
    </form>
  `);
  document.getElementById('cancel-btn').addEventListener('click', closeModal);
  document.getElementById('adjust-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/admin/participants/${id}/adjust-coins`, {
        method: 'POST',
        body: JSON.stringify({ amount: parseInt(document.getElementById('a-amount').value, 10), reason: document.getElementById('a-reason').value.trim() }),
      });
      toast('Coins mis à jour.', 'success');
      closeModal();
      renderParticipants();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function toggleBlock(id, currentStatus) {
  const next = currentStatus === 'blocked' ? 'active' : 'blocked';
  try {
    await api('/api/admin/participants/' + id, { method: 'PUT', body: JSON.stringify({ status: next }) });
    toast(next === 'blocked' ? 'Participant bloqué.' : 'Participant débloqué.', 'success');
    renderParticipants();
  } catch (err) { toast(err.message, 'error'); }
}

async function removeParticipant(id, search) {
  if (!confirm('Supprimer définitivement cette participation ? (utile en cas de fraude)')) return;
  try {
    await api('/api/admin/participants/' + id, { method: 'DELETE' });
    toast('Participation supprimée.', 'success');
    renderParticipants(search);
  } catch (err) { toast(err.message, 'error'); }
}

// ---------- Transactions de coins ----------

async function renderCoins() {
  const list = await api('/api/admin/coin-transactions');
  tabContent.innerHTML = `
    <div class="panel" style="padding:6px 14px;">
      ${list.length === 0 ? '<p class="muted" style="padding:14px 0;">Aucune transaction.</p>' :
        list.map((t) => `
          <div class="history-item">
            <div><div><strong>${escapeHtml(t.participantName)}</strong> ${t.participantNumber ? '#' + String(t.participantNumber).padStart(3,'0') : ''} — ${escapeHtml(t.reason)}</div><div class="when">${formatDateTime(t.createdAt)}</div></div>
            <div class="amt ${t.amount >= 0 ? 'pos' : 'neg'}">${t.amount >= 0 ? '+' : ''}${t.amount}</div>
          </div>
        `).join('')}
    </div>
  `;
}

// ---------- Parrainages ----------

async function renderReferrals() {
  const list = await api('/api/admin/referrals');
  tabContent.innerHTML = `
    <div class="panel" style="padding:6px 14px;">
      ${list.length === 0 ? '<p class="muted" style="padding:14px 0;">Aucun parrainage validé.</p>' :
        list.map((r) => `
          <div class="data-row">
            <div class="main"><strong>${escapeHtml(r.referrerName)}</strong><span>a parrainé ${escapeHtml(r.referredName)} · +${r.coinsAwarded} coins · ${timeAgo(r.createdAt)}</span></div>
          </div>
        `).join('')}
    </div>
  `;
}

// ---------- Tirage ----------

async function renderDraw() {
  const rewards = await api('/api/admin/rewards');
  const winners = await api('/api/admin/winners');
  tabContent.innerHTML = `
    <div class="panel" style="padding:6px 14px;">
      ${rewards.length === 0 ? '<p class="muted" style="padding:14px 0;">Crée d\'abord une récompense.</p>' :
        rewards.map((r) => `
          <div class="data-row">
            <div class="main"><strong>${escapeHtml(r.name)}</strong><span>${r.requiredCoins} coins requis · ${r.winnersCount} gagnant(s) · <span class="badge ${r.status}">${r.status}</span></span></div>
            <div class="row-actions"><button data-draw="${r.id}" ${r.status === 'completed' ? 'disabled' : ''}>Lancer le tirage</button></div>
          </div>
        `).join('')}
    </div>
    <h3 class="section-title" style="font-size:16px;">Gagnants</h3>
    <div class="panel" style="padding:6px 14px;">
      ${winners.length === 0 ? '<p class="muted" style="padding:14px 0;">Aucun tirage effectué.</p>' :
        winners.map((w) => `
          <div class="data-row"><div class="main"><strong>🥀 ${escapeHtml(w.participantName)}</strong><span>#${String(w.participantNumber).padStart(3,'0')} · ${escapeHtml(w.rewardName)} · ${formatDateTime(w.createdAt)}</span></div></div>
        `).join('')}
    </div>
  `;
  tabContent.querySelectorAll('[data-draw]').forEach((b) => b.addEventListener('click', () => runDraw(b.dataset.draw)));
}

async function runDraw(rewardId) {
  if (!confirm('Lancer le tirage au sort pour cette récompense ? Cette action est définitive.')) return;
  openModal(`<h3>SELECTING WINNER…</h3><p class="muted center">Tirage en cours côté serveur…</p>`);
  try {
    const result = await api('/api/admin/draw/' + rewardId, { method: 'POST' });
    openModal(`
      <h3 class="center">🥀 WINNER</h3>
      ${result.winners.map((w) => `
        <div class="center" style="margin:16px 0;">
          ${avatarHtml(w.profileImage, w.name, 64)}
          <p style="font-family:'Rye',serif;font-size:20px;margin:10px 0 2px;">${escapeHtml(w.name)}</p>
          <p class="muted">#${String(w.number).padStart(3,'0')} — ${escapeHtml(result.reward.name)}</p>
        </div>
      `).join('')}
      <button class="btn btn-primary" id="close-draw">FERMER</button>
    `);
    document.getElementById('close-draw').addEventListener('click', () => { closeModal(); renderDraw(); });
  } catch (err) {
    closeModal();
    toast(err.message, 'error');
  }
}

// ---------- Paramètres ----------

async function renderSettings() {
  const s = await api('/api/admin/settings');
  tabContent.innerHTML = `
    <form id="settings-form" class="panel">
      <div class="field"><label>Titre du giveaway</label><input type="text" id="s-title" value="${escapeHtml(s.giveawayTitle)}"></div>
      <div class="field"><label>Accroche</label><textarea id="s-tagline">${escapeHtml(s.giveawayTagline)}</textarea></div>
      <div class="field"><label>Statut</label>
        <select id="s-status" style="width:100%;padding:12px;background:rgba(255,255,255,0.04);border:1px solid var(--panel-border);border-radius:10px;color:var(--bone);">
          <option value="active" ${s.giveawayStatus === 'active' ? 'selected' : ''}>Actif</option>
          <option value="paused" ${s.giveawayStatus === 'paused' ? 'selected' : ''}>En pause</option>
          <option value="ended" ${s.giveawayStatus === 'ended' ? 'selected' : ''}>Terminé</option>
        </select>
      </div>
      <div class="field"><label>Date de fin (facultatif)</label><input type="datetime-local" id="s-ends" value="${s.giveawayEndsAt ? s.giveawayEndsAt.slice(0,16) : ''}"></div>
      <div class="field"><label>URL de la chaîne WhatsApp</label><input type="text" id="s-whatsapp" value="${escapeHtml(s.whatsappChannelUrl || '')}" placeholder="https://whatsapp.com/channel/..."></div>
      <div class="field"><label>Bonus de bienvenue activé</label>
        <select id="s-welcome-enabled" style="width:100%;padding:12px;background:rgba(255,255,255,0.04);border:1px solid var(--panel-border);border-radius:10px;color:var(--bone);">
          <option value="true" ${s.welcomeBonusEnabled ? 'selected' : ''}>Oui</option>
          <option value="false" ${!s.welcomeBonusEnabled ? 'selected' : ''}>Non</option>
        </select>
      </div>
      <div class="field"><label>Montant du bonus de bienvenue</label><input type="number" id="s-welcome-amount" value="${s.welcomeBonusAmount}"></div>
      <div class="field"><label>Coins par parrainage validé</label><input type="number" id="s-referral-amount" value="${s.referralBonusAmount}"></div>
      <button class="btn btn-primary" type="submit">ENREGISTRER LES PARAMÈTRES</button>
    </form>
  `;
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const endsVal = document.getElementById('s-ends').value;
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          giveawayTitle: document.getElementById('s-title').value.trim(),
          giveawayTagline: document.getElementById('s-tagline').value.trim(),
          giveawayStatus: document.getElementById('s-status').value,
          giveawayEndsAt: endsVal ? new Date(endsVal).toISOString() : null,
          whatsappChannelUrl: document.getElementById('s-whatsapp').value.trim(),
          welcomeBonusEnabled: document.getElementById('s-welcome-enabled').value === 'true',
          welcomeBonusAmount: parseInt(document.getElementById('s-welcome-amount').value, 10) || 0,
          referralBonusAmount: parseInt(document.getElementById('s-referral-amount').value, 10) || 0,
        }),
      });
      toast('Paramètres enregistrés.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------- Journal d'audit ----------

async function renderAudit() {
  const list = await api('/api/admin/audit-log');
  tabContent.innerHTML = `
    <div class="panel" style="padding:6px 14px;">
      ${list.length === 0 ? '<p class="muted" style="padding:14px 0;">Aucune action journalisée.</p>' :
        list.map((a) => `
          <div class="data-row"><div class="main"><strong>${escapeHtml(a.action)}</strong><span>${escapeHtml(a.details)} · ${formatDateTime(a.createdAt)}</span></div></div>
        `).join('')}
    </div>
  `;
}

checkSession();
