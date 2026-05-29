const API = '/api';

async function api(path, options = {}) {
  try {
    const res = await fetch(API + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    return res.json().catch(() => null);
  } catch { return null; }
}

// ── NAVEGACAO ─────────────────────────────────────────

const sections  = document.querySelectorAll('.section');
const navLinks  = document.querySelectorAll('.nav-link');
const pageTitle = document.getElementById('page-title');

// ── AT CONSOLE ───────────────────────────────────────────

function atAppend(text, cls) {
  const term = document.getElementById('at-terminal');
  const line = document.createElement('div');
  line.className = `at-line ${cls}`;
  line.textContent = text;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

async function enviarAT(cmd) {
  atAppend(`> ${cmd}`, 'cmd');
  const data = await api('/at', { method: 'POST', body: JSON.stringify({ comando: cmd }) });
  if (!data) { atAppend('Erro de ligacao', 'err'); return; }
  if (!data.success) { atAppend(data.error || 'Erro', 'err'); return; }
  const resp = (data.resposta || '').trim();
  if (resp) atAppend(resp, 'resp');
  else      atAppend('(sem resposta)', 'info');
}

document.getElementById('at-send').addEventListener('click', () => {
  const inp = document.getElementById('at-input');
  const cmd = inp.value.trim();
  if (!cmd) return;
  enviarAT(cmd);
  inp.value = '';
  inp.focus();
});

document.getElementById('at-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('at-send').click();
});

document.getElementById('at-clear').addEventListener('click', () => {
  document.getElementById('at-terminal').innerHTML = '';
});

document.querySelectorAll('.at-quick').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('at-input').value = btn.dataset.cmd;
    document.getElementById('at-send').click();
  });
});

// ── ENVIAR MSG WHATSAPP ───────────────────────────────────

document.getElementById('send-wa-btn').addEventListener('click', async () => {
  const numero   = document.getElementById('send-numero').value.trim();
  const mensagem = document.getElementById('send-msg').value.trim();
  const statusEl = document.getElementById('send-wa-status');
  const btn      = document.getElementById('send-wa-btn');

  if (!numero || !mensagem) {
    statusEl.className = 'alert alert-yellow';
    statusEl.textContent = 'Preenche o numero e a mensagem.';
    statusEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'A enviar...';

  const data = await api('/whatsapp/send', {
    method: 'POST',
    body: JSON.stringify({ numero, mensagem })
  });

  btn.disabled = false;
  btn.textContent = 'Enviar Mensagem';
  statusEl.classList.remove('hidden');

  if (data?.success) {
    statusEl.className = 'alert alert-green';
    statusEl.textContent = `Mensagem enviada para ${numero}`;
    document.getElementById('send-msg').value = '';
  } else {
    statusEl.className = 'alert alert-yellow';
    statusEl.textContent = data?.error || 'Erro ao enviar. WhatsApp esta conectado?';
  }
});

// ── SMS ───────────────────────────────────────────────

async function loadSMS() {
  const filtro = document.getElementById('sms-filter').value;
  const url    = filtro ? `/sms?tipo=${filtro}` : '/sms';
  const data   = await api(url);
  const tbody  = document.getElementById('sms-body');

  if (!data?.data?.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Sem SMS</td></tr>';
    return;
  }

  const tipos = { mpesa: 'badge-green', emola: 'badge-blue', outro: 'badge-gray' };
  tbody.innerHTML = data.data.map(s => {
    const dt  = new Date(s.timestamp).toLocaleString('pt');
    const cls = tipos[s.tipo] || 'badge-gray';
    return `<tr>
      <td style="white-space:nowrap">${dt}</td>
      <td>${s.remetente}</td>
      <td style="max-width:400px;word-break:break-word">${escHtml(s.mensagem)}</td>
      <td><span class="badge ${cls}">${s.tipo}</span></td>
    </tr>`;
  }).join('');
}

document.getElementById('sms-refresh').addEventListener('click', loadSMS);
document.getElementById('sms-filter').addEventListener('change', loadSMS);
document.getElementById('sms-clear').addEventListener('click', async () => {
  if (!confirm('Apagar todos os SMS da base de dados?')) return;
  await api('/sms', { method: 'DELETE' });
  loadSMS();
});

// ── USSD CONSOLA ──────────────────────────────────────

// Detecta opcoes numeradas numa resposta USSD
// Ex: "1. SoPraTi\n2. Chamadas e SMS\n3. Super Jackpot"
function parseOpcoes(texto) {
  return texto.split('\n')
    .map(l => l.trim())
    .filter(l => /^\d+[.)]\s+/.test(l))
    .map(l => {
      const m = l.match(/^(\d+)[.)]\s+(.+)/);
      return m ? { num: m[1], texto: m[2] } : null;
    })
    .filter(Boolean);
}

async function executarUSSD(codigo) {
  const res      = document.getElementById('ussd-result');
  const menuEl   = document.getElementById('ussd-menu');
  const btn      = document.getElementById('ussd-run');
  btn.disabled   = true;
  btn.textContent = 'A executar...';
  res.className   = 'ussd-result';
  res.textContent = `> ${codigo}\nA aguardar resposta...`;
  res.classList.remove('hidden');
  menuEl.classList.add('hidden');
  menuEl.innerHTML = '';

  const data = await api('/ussd', {
    method: 'POST',
    body: JSON.stringify({ codigo })
  });

  btn.disabled    = false;
  btn.textContent = 'Executar';

  if (!data) {
    res.className   = 'ussd-result error';
    res.textContent = 'Erro de ligacao ao servidor.';
    return;
  }
  if (!data.success) {
    res.className   = 'ussd-result error';
    res.textContent = data.error || 'Erro desconhecido';
    return;
  }

  const resposta = (data.resposta || '').trim();
  res.className   = 'ussd-result';
  res.textContent = `> ${codigo}\n\n${resposta || '(sem resposta — actualiza o firmware do Arduino)'}`;

  // Detectar menu interactivo e mostrar botoes
  const opcoes = parseOpcoes(resposta);
  if (opcoes.length > 0) {
    menuEl.classList.remove('hidden');
    opcoes.forEach(op => {
      const btn2 = document.createElement('button');
      btn2.className = 'ussd-menu-btn';
      btn2.innerHTML = `<span class="opt-num">${op.num}.</span>${op.texto}`;
      btn2.addEventListener('click', () => {
        document.getElementById('ussd-input').value = op.num;
        executarUSSD(op.num);
      });
      menuEl.appendChild(btn2);
    });
  }
}

document.getElementById('ussd-run').addEventListener('click', () => {
  const codigo = document.getElementById('ussd-input').value.trim();
  if (!codigo) return;
  executarUSSD(codigo);
});

document.getElementById('ussd-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('ussd-run').click();
});

document.querySelectorAll('.ussd-quick').forEach(el => {
  el.addEventListener('click', () => {
    const codigo = el.dataset.code;
    document.getElementById('ussd-input').value = codigo;
    executarUSSD(codigo);
  });
});

const TITLES = {
  at:        'Console AT — SIM900',
  send:      'Enviar Mensagem WhatsApp',
  dashboard: 'Visao Geral',
  whatsapp:  'WhatsApp',
  telegram:  'Telegram',
  hardware:  'Hardware',
  pedidos:   'Pedidos',
  sms:       'SMS Recebidos',
  ussd:      'Consola USSD',
  logs:      'Registos do Sistema',
  settings:  'Definicoes',
};

navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const sec = link.dataset.section;
    navLinks.forEach(l => l.classList.remove('active'));
    sections.forEach(s => s.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`sec-${sec}`).classList.add('active');
    pageTitle.textContent = TITLES[sec] || sec;
    document.querySelector('.sidebar').classList.remove('open');
    if (sec === 'pedidos')  loadAllPedidos();
    if (sec === 'sms')      loadSMS();
    if (sec === 'at') {
      atAppend('Console AT pronto. Arduino: ' + (document.getElementById('hw-arduino')?.textContent || '--'), 'info');
    }
    if (sec === 'logs')     loadLogs();
    if (sec === 'settings') loadConfig();
  });
});

document.getElementById('menu-toggle').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('open');
});

// ── WHATSAPP STATUS ───────────────────────────────────

const waBar     = document.getElementById('wa-status-bar');
const waTxt     = document.getElementById('wa-status-text');
const waQr      = document.getElementById('wa-qr');
const qrImg     = document.getElementById('qr-image');
const waPairing = document.getElementById('wa-pairing');
const pairTxt   = document.getElementById('pairing-code');
const waConn    = document.getElementById('wa-connected');
const topPill   = document.getElementById('top-status');
const sideWa    = document.getElementById('side-wa');

const WA_LABELS = {
  connected:    'Conectado',
  disconnected: 'Desconectado',
  qr:           'Aguardando leitura do QR Code',
  pairing:      'Aguardando codigo de pareamento',
};

async function checkStatus() {
  const data = await api('/status');
  if (!data) return;

  const s = data.status;
  const label = WA_LABELS[s] || s;

  waBar.className = `status-banner ${s === 'pairing' ? 'qr' : s}`;
  waTxt.textContent  = label;
  topPill.textContent = label;
  topPill.className   = `status-pill ${s}`;

  sideWa.className = 'dot ' + (s === 'connected' ? 'dot-green' : s === 'disconnected' ? 'dot-red' : 'dot-yellow');

  waQr.classList.toggle('hidden',     !(s === 'qr' && data.qrCode));
  waPairing.classList.toggle('hidden', !(s === 'pairing' && data.pairingCode));
  waConn.classList.toggle('hidden',     s !== 'connected');

  if (s === 'qr' && data.qrCode) qrImg.src = data.qrCode;
  if (s === 'pairing' && data.pairingCode) pairTxt.textContent = data.pairingCode;
}

// Ligar com numero
document.getElementById('pair-btn').addEventListener('click', async () => {
  const phone = document.getElementById('phone-input').value.trim();
  if (!phone) { alert('Introduz o numero com codigo do pais. Ex: 258841234567'); return; }
  const btn = document.getElementById('pair-btn');
  btn.disabled = true;
  btn.textContent = 'A gerar...';
  await api('/pair', { method: 'POST', body: JSON.stringify({ phone }) });
  btn.disabled = false;
  btn.textContent = 'Obter Codigo';
});

// Gerar QR
document.getElementById('qr-btn').addEventListener('click', async () => {
  const btn = document.getElementById('qr-btn');
  btn.disabled = true;
  btn.textContent = 'A reiniciar...';
  await api('/restart', { method: 'POST' });
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Gerar QR Code';
    checkStatus();
  }, 5000);
});

// ── HARDWARE ─────────────────────────────────────────

const sideMqtt = document.getElementById('side-mqtt');
const sideTg   = document.getElementById('side-tg');
const sideTgs  = document.getElementById('side-tgs');

function setHw(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const map = {
    connected:    ['ok',   'Ligado'],
    disconnected: ['fail', 'Desligado'],
    qr:           ['warn', 'Aguardando QR'],
    pairing:      ['warn', 'A parear'],
  };
  const [cls, lbl] = map[value] || ['', value];
  el.className  = `hw-badge ${cls}`;
  el.textContent = lbl;
}

async function checkHardware() {
  const data = await api('/hardware');
  if (!data) return;

  setHw('hw-mqtt',          data.mqtt);
  setHw('hw-arduino',       data.arduino);
  setHw('hw-whatsapp',      data.whatsapp);
  const sigEl = document.getElementById('hw-arduino-signal');
  if (sigEl) sigEl.textContent = data.arduinoSignal || '--';
  setHw('hw-telegram',      data.telegram);
  setHw('hw-telegram-sales',data.telegramSales);

  sideMqtt.className = 'dot ' + (data.mqtt      === 'connected' ? 'dot-green' : 'dot-red');
  sideTg.className   = 'dot ' + (data.telegram  === 'connected' ? 'dot-green' : 'dot-red');
  sideTgs.className  = 'dot ' + (data.telegramSales === 'connected' ? 'dot-green' : 'dot-red');

  const tgAdminBadge = document.getElementById('tg-admin-status');
  const tgSalesBadge = document.getElementById('tg-sales-status');
  if (tgAdminBadge) {
    tgAdminBadge.textContent = data.telegram === 'connected' ? 'Activo' : 'Inactivo';
    tgAdminBadge.className   = 'badge ' + (data.telegram === 'connected' ? 'badge-green' : 'badge-red');
  }
  if (tgSalesBadge) {
    tgSalesBadge.textContent = data.telegramSales === 'connected' ? 'Activo' : 'Inactivo';
    tgSalesBadge.className   = 'badge ' + (data.telegramSales === 'connected' ? 'badge-green' : 'badge-red');
  }
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

// ── PEDIDOS (dashboard) ───────────────────────────────

function canal(whatsapp) {
  if (!whatsapp) return '--';
  if (whatsapp.startsWith('tg_')) return 'Telegram ' + whatsapp.replace('tg_', '');
  return whatsapp.replace('@s.whatsapp.net', '');
}

function rowPedido(p) {
  const valor  = p.valorEsperado ? p.valorEsperado + ' MT' : '--';
  const metodo = p.metodoPagamento === 'm-pesa' ? 'M-Pesa' : p.metodoPagamento === 'e-mola' ? 'e-Mola' : '--';
  const dt     = p.createdAt ? new Date(p.createdAt).toLocaleString('pt') : '--';
  return `<tr>
    <td>${canal(p.cliente?.whatsapp)}</td>
    <td>${p.pacote?.mbFormatado || p.pacote?.nome || '--'}</td>
    <td>${valor}</td>
    <td>${metodo}</td>
    <td>${badgeStatus(p.status)}</td>
    <td>${dt}</td>
  </tr>`;
}

async function loadPedidos() {
  const tbody = document.getElementById('pedidos-body');
  const data  = await api('/pedidos/recentes');
  tbody.innerHTML = (!data?.data?.length)
    ? '<tr><td colspan="6" class="empty">Sem pedidos</td></tr>'
    : data.data.slice(0, 10).map(rowPedido).join('');
}

async function loadAllPedidos() {
  const tbody = document.getElementById('all-pedidos-body');
  const data  = await api('/pedidos/recentes');
  tbody.innerHTML = (!data?.data?.length)
    ? '<tr><td colspan="6" class="empty">Sem pedidos</td></tr>'
    : data.data.map(rowPedido).join('');
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
  const [cls, lbl] = map[s] || ['badge-gray', s];
  return `<span class="badge ${cls}">${lbl}</span>`;
}

document.getElementById('refresh-btn').addEventListener('click', () => {
  loadPedidos(); loadStats();
});
document.getElementById('pedidos-refresh').addEventListener('click', loadAllPedidos);

// ── LOGS ──────────────────────────────────────────────

let allLogs = [];

const LEVEL_COLORS = { INFO: 'INFO', SUCCESS: 'SUCCESS', WARN: 'WARN', ERROR: 'ERROR' };

function renderLogs(logs) {
  const container = document.getElementById('logs-container');
  const filter    = document.getElementById('log-filter').value;
  const filtered  = filter ? logs.filter(l => l.level === filter) : logs;

  if (!filtered.length) {
    container.innerHTML = '<div class="empty">Sem registos</div>';
    return;
  }

  container.innerHTML = filtered.map(l => {
    const ts  = new Date(l.ts).toLocaleString('pt');
    const cls = LEVEL_COLORS[l.level] || 'INFO';
    return `<div class="log-entry">
      <span class="log-ts">${ts}</span>
      <span class="log-level ${cls}">${l.level}</span>
      <span class="log-msg">${escHtml(l.message)}</span>
    </div>`;
  }).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function loadLogs() {
  const data = await api('/logs?limit=200');
  if (!data) return;
  allLogs = data.logs || [];
  renderLogs(allLogs);
}

document.getElementById('log-filter').addEventListener('change', () => renderLogs(allLogs));
document.getElementById('logs-refresh').addEventListener('click', loadLogs);
document.getElementById('logs-clear-view').addEventListener('click', () => {
  allLogs = [];
  document.getElementById('logs-container').innerHTML = '<div class="empty">Vista limpa</div>';
});

// Actualizar logs automaticamente quando a seccao esta activa
setInterval(() => {
  if (document.getElementById('sec-logs').classList.contains('active')) loadLogs();
}, 8000);

// ── SETTINGS ──────────────────────────────────────────

async function loadConfig() {
  const data = await api('/config');
  if (!data) return;

  const list = document.getElementById('cfg-list');
  const rows = [
    ['Numero M-Pesa',       data.numeroMpesa],
    ['Numero e-Mola',       data.numeroEmola],
    ['Telegram Admin',      data.telegramAdmin  ? 'Configurado' : 'Nao configurado'],
    ['Telegram Vendas',     data.telegramSales  ? 'Configurado' : 'Nao configurado'],
    ['Telegram Chat ID',    data.telegramChatId || 'Nao configurado'],
    ['MQTT Broker',         data.mqttBroker],
    ['Ambiente',            data.nodeEnv],
  ];

  list.innerHTML = rows.map(([k, v]) => {
    const isEmpty = !v || v === 'Nao configurado';
    return `<div class="cfg-row">
      <span class="cfg-key">${k}</span>
      <span class="cfg-val ${isEmpty ? 'cfg-empty' : ''}">${v || 'Nao definido'}</span>
    </div>`;
  }).join('');
}

// ── INIT ──────────────────────────────────────────────

checkStatus();
checkHardware();
loadStats();
loadPedidos();

setInterval(checkStatus,   4000);
setInterval(checkHardware, 10000);
setInterval(loadStats,     30000);
