const API = '/api';

async function api(path, options = {}) {
  try {
    const res = await fetch(API + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    return res.json().catch(() => null);
  } catch {
    return null;
  }
}

// ── WHATSAPP STATUS ───────────────────────────────────

const statusBar  = document.getElementById('status-bar');
const statusTxt  = document.getElementById('status-text');
const qrSection  = document.getElementById('qr-section');
const qrImage    = document.getElementById('qr-image');
const connInfo   = document.getElementById('connected-info');
const navWa      = document.getElementById('nav-wa');

const WA_LABELS = {
  connected:    'Conectado',
  disconnected: 'Desconectado',
  qr:           'Aguardando leitura do QR Code',
};

async function checkStatus() {
  const data = await api('/status');
  if (!data) return;

  const s = data.status;
  statusBar.className  = `status-bar ${s}`;
  statusTxt.textContent = WA_LABELS[s] || s;
  navWa.textContent     = 'WhatsApp: ' + (WA_LABELS[s] || s);
  navWa.className       = 'badge ' + (s === 'connected' ? 'badge-green' : s === 'qr' ? 'badge-yellow' : 'badge-red');

  if (s === 'qr' && data.qrCode) {
    qrImage.src = data.qrCode;
    qrSection.classList.remove('hidden');
    connInfo.classList.add('hidden');
  } else if (s === 'connected') {
    qrSection.classList.add('hidden');
    connInfo.classList.remove('hidden');
  } else {
    qrSection.classList.add('hidden');
    connInfo.classList.add('hidden');
  }
}

document.getElementById('connect-btn').addEventListener('click', async () => {
  const btn = document.getElementById('connect-btn');
  btn.disabled = true;
  btn.textContent = 'A reiniciar...';
  await api('/restart', { method: 'POST' });
  statusTxt.textContent = 'A gerar QR Code...';
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Conectar / Novo QR';
    checkStatus();
  }, 4000);
});

// ── HARDWARE STATUS ───────────────────────────────────

const navMqtt = document.getElementById('nav-mqtt');

function setHwStatus(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const map = {
    connected: ['ok',   'Ligado'],
    ok:        ['ok',   'Ligado'],
    disconnected: ['fail', 'Desligado'],
    fail:      ['fail', 'Desligado'],
    qr:        ['warn', 'A aguardar QR'],
  };
  const [cls, label] = map[value] || ['warn', value];
  el.className = `hw-status ${cls}`;
  el.textContent = label;
}

async function checkHardware() {
  const data = await api('/hardware');
  if (!data) return;

  setHwStatus('hw-mqtt',     data.mqtt);
  setHwStatus('hw-arduino',  data.arduino);
  setHwStatus('hw-whatsapp', data.whatsapp);

  navMqtt.textContent = 'MQTT: ' + (data.mqtt === 'connected' ? 'Ligado' : 'Desligado');
  navMqtt.className   = 'badge ' + (data.mqtt === 'connected' ? 'badge-green' : 'badge-red');
}

document.getElementById('hw-refresh').addEventListener('click', checkHardware);

// ── STATS ─────────────────────────────────────────────

async function loadStats() {
  const data = await api('/pedidos/stats');
  if (!data) return;
  document.getElementById('stat-hoje').textContent      = data.hoje      ?? '--';
  document.getElementById('stat-total').textContent     = data.total     ?? '--';
  document.getElementById('stat-pendentes').textContent = data.pendentes ?? '--';
  document.getElementById('stat-clientes').textContent  = data.clientes  ?? '--';
}

// ── PEDIDOS ───────────────────────────────────────────

async function loadPedidos() {
  const tbody = document.getElementById('pedidos-body');
  const data  = await api('/pedidos/recentes');

  if (!data || !data.data || data.data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Sem pedidos</td></tr>';
    return;
  }

  tbody.innerHTML = data.data.map(p => {
    const num    = (p.cliente?.whatsapp || '').replace('@s.whatsapp.net', '') || '--';
    const pacote = p.pacote?.mbFormatado || p.pacote?.nome || '--';
    const valor  = p.valorEsperado ? p.valorEsperado + ' MT' : '--';
    const metodo = p.metodoPagamento === 'm-pesa' ? 'M-Pesa' : p.metodoPagamento === 'e-mola' ? 'e-Mola' : '--';
    const data2  = p.createdAt ? new Date(p.createdAt).toLocaleString('pt') : '--';
    return `<tr>
      <td>${num}</td>
      <td>${pacote}</td>
      <td>${valor}</td>
      <td>${metodo}</td>
      <td>${badgeStatus(p.status)}</td>
      <td>${data2}</td>
    </tr>`;
  }).join('');
}

function badgeStatus(s) {
  const map = {
    activado:  ['badge-green',  'Activado'],
    pago:      ['badge-yellow', 'Pago'],
    pendente:  ['badge-yellow', 'Pendente'],
    erro:      ['badge-red',    'Erro'],
    expirado:  ['badge-gray',   'Expirado'],
    cancelado: ['badge-gray',   'Cancelado'],
  };
  const [cls, label] = map[s] || ['badge-gray', s];
  return `<span class="badge ${cls}">${label}</span>`;
}

document.getElementById('refresh-btn').addEventListener('click', () => {
  loadPedidos();
  loadStats();
});

// ── INIT ──────────────────────────────────────────────

checkStatus();
checkHardware();
loadStats();
loadPedidos();

setInterval(checkStatus,   4000);
setInterval(checkHardware, 10000);
