const API = '/api';

// ── AUTH ──────────────────────────────────────────────

function getToken() { return localStorage.getItem('mb_token'); }
function setToken(t) { localStorage.setItem('mb_token', t); }
function clearToken() { localStorage.removeItem('mb_token'); }

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  return res.json().catch(() => null);
}

// ── LOGIN ─────────────────────────────────────────────

const loginScreen = document.getElementById('login-screen');
const dashboard   = document.getElementById('dashboard');
const loginForm   = document.getElementById('login-form');
const loginError  = document.getElementById('login-error');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('login-password').value;
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (res.ok) {
    const { token } = await res.json();
    setToken(token);
    showDashboard();
  } else {
    loginError.classList.remove('hidden');
    setTimeout(() => loginError.classList.add('hidden'), 3000);
  }
});

function logout() {
  clearToken();
  dashboard.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  document.getElementById('login-password').value = '';
}

document.getElementById('logout-btn').addEventListener('click', logout);

function showDashboard() {
  loginScreen.classList.add('hidden');
  dashboard.classList.remove('hidden');
  startPolling();
  loadPedidos();
  loadStats();
}

// ── STATUS / QR ───────────────────────────────────────

const navBadge  = document.getElementById('nav-status');
const statusBar = document.getElementById('status-bar');
const statusTxt = document.getElementById('status-text');
const qrSection = document.getElementById('qr-section');
const qrImage   = document.getElementById('qr-image');

async function checkStatus() {
  const data = await api('/status');
  if (!data) return;

  const s = data.status;
  navBadge.className  = `nav-badge ${s}`;
  statusBar.className = `status-bar ${s}`;

  const labels = { connected: '✅ WhatsApp conectado', disconnected: '❌ Desconectado', qr: '📱 Aguardando leitura do QR Code' };
  statusTxt.textContent = labels[s] || s;
  navBadge.textContent  = labels[s] || s;

  if (s === 'qr' && data.qrCode) {
    qrImage.src = data.qrCode;
    qrSection.classList.remove('hidden');
  } else {
    qrSection.classList.add('hidden');
  }
}

document.getElementById('restart-btn').addEventListener('click', async () => {
  await api('/restart', { method: 'POST' });
  statusTxt.textContent = 'A reiniciar...';
});

// ── PEDIDOS ───────────────────────────────────────────

async function loadPedidos() {
  const tbody = document.getElementById('pedidos-body');
  // Busca os últimos clientes e os seus pedidos
  const data = await api('/pedidos/recentes');
  if (!data || !data.data) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Sem pedidos</td></tr>';
    return;
  }
  if (data.data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Sem pedidos ainda</td></tr>';
    return;
  }
  tbody.innerHTML = data.data.map(p => `
    <tr>
      <td>${p.cliente?.whatsapp?.replace('@s.whatsapp.net','') || '—'}</td>
      <td>${p.pacote?.mbFormatado || p.pacote?.nome || '—'}</td>
      <td>${p.valorEsperado || '—'}MT</td>
      <td>${p.metodoPagamento === 'm-pesa' ? 'M-Pesa' : p.metodoPagamento === 'e-mola' ? 'e-Mola' : '—'}</td>
      <td>${badgeStatus(p.status)}</td>
      <td>${p.createdAt ? new Date(p.createdAt).toLocaleString('pt') : '—'}</td>
    </tr>
  `).join('');
}

function badgeStatus(s) {
  const map = {
    activado: ['badge-green','Activado'],
    pago:     ['badge-yellow','Pago'],
    pendente: ['badge-yellow','Pendente'],
    erro:     ['badge-red','Erro'],
    expirado: ['badge-gray','Expirado'],
    cancelado:['badge-gray','Cancelado'],
  };
  const [cls, label] = map[s] || ['badge-gray', s];
  return `<span class="badge ${cls}">${label}</span>`;
}

document.getElementById('refresh-btn').addEventListener('click', () => {
  loadPedidos();
  loadStats();
});

// ── STATS ─────────────────────────────────────────────

async function loadStats() {
  const data = await api('/pedidos/stats');
  if (!data) return;
  document.getElementById('stat-hoje').textContent    = data.hoje    ?? '—';
  document.getElementById('stat-total').textContent   = data.total   ?? '—';
  document.getElementById('stat-pendentes').textContent = data.pendentes ?? '—';
  document.getElementById('stat-clientes').textContent  = data.clientes  ?? '—';
}

// ── POLLING ───────────────────────────────────────────

let polling = null;
function startPolling() {
  checkStatus();
  if (polling) clearInterval(polling);
  polling = setInterval(checkStatus, 4000);
}

// ── INIT ──────────────────────────────────────────────

// Autenticação desactivada temporariamente — vai directo ao dashboard
showDashboard();
