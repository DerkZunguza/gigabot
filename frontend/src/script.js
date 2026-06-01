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

document.getElementById('at-fontsize').addEventListener('change', (e) => {
  document.getElementById('at-terminal').style.fontSize = e.target.value + 'px';
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

const ussdSessionBar = () => document.getElementById('ussd-session-bar');

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
    ussdSessionBar().classList.add('hidden');
    return;
  }
  if (!data.success) {
    res.className   = 'ussd-result error';
    res.textContent = data.error || 'Erro desconhecido';
    ussdSessionBar().classList.add('hidden');
    return;
  }

  const resposta = (data.resposta || '').trim();
  res.className   = 'ussd-result';
  res.textContent = `> ${codigo}\n\n${resposta || '(sem resposta — carrega o novo firmware no Arduino)'}`;

  // Mostrar/esconder barra de sessao
  if (data.sessaoActiva) {
    document.getElementById('ussd-session-label').textContent = 'Sessao activa — selecciona uma opcao ou fecha';
    ussdSessionBar().classList.remove('hidden');
  } else {
    ussdSessionBar().classList.add('hidden');
  }

  // Botoes de menu interactivo
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

// Fechar sessao USSD manualmente
document.getElementById('ussd-close-btn').addEventListener('click', async () => {
  await api('/ussd/fechar', { method: 'POST' });
  ussdSessionBar().classList.add('hidden');
  document.getElementById('ussd-menu').classList.add('hidden');
  document.getElementById('ussd-menu').innerHTML = '';
  const res = document.getElementById('ussd-result');
  res.classList.remove('hidden');
  res.className = 'ussd-result';
  res.textContent += '\n\n[Sessao fechada]';
});

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

// ── ADMIN / SESSOES SSH ───────────────────────────────────────

async function loadSessions() {
  const data = await api('/sessions');
  const tbody = document.getElementById('sessions-body');
  const count = document.getElementById('sessions-count');

  if (!data) { count.textContent = 'Erro ao carregar'; return; }

  const total = data.total || 0;
  count.textContent = total === 0 ? 'Sem sessoes SSH activas' : `${total} sessao(oes) activa(s)`;

  if (!data.sessions?.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">Sem sessoes activas</td></tr>';
    return;
  }
  tbody.innerHTML = data.sessions.map((s, i) => `<tr>
    <td>${i + 1}</td>
    <td><strong>${s.ip}</strong></td>
    <td>${s.port}</td>
  </tr>`).join('');
}

document.getElementById('sessions-refresh').addEventListener('click', loadSessions);

// SMS via Arduino AT+CMGS
document.getElementById('at-sms-send').addEventListener('click', async () => {
  const numero   = document.getElementById('at-sms-numero').value.trim();
  const mensagem = document.getElementById('at-sms-msg').value.trim();
  const statusEl = document.getElementById('at-sms-status');
  const btn      = document.getElementById('at-sms-send');

  if (!numero || !mensagem) {
    statusEl.className = 'alert alert-yellow';
    statusEl.textContent = 'Preenche o numero e a mensagem.';
    statusEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'A enviar via Arduino...';

  const data = await api('/sms/enviar', {
    method: 'POST',
    body: JSON.stringify({ numero, mensagem })
  });

  btn.disabled = false;
  btn.textContent = 'Enviar SMS';
  statusEl.classList.remove('hidden');

  if (data?.sucesso) {
    statusEl.className = 'alert alert-green';
    statusEl.textContent = `SMS enviado para ${numero}`;
    document.getElementById('at-sms-msg').value = '';
  } else {
    statusEl.className = 'alert alert-yellow';
    statusEl.textContent = data?.erro || data?.error || 'Erro ao enviar';
  }
});

const TITLES = {
  taskmanager: 'Task Manager',
  admin:     'Admin — Sessoes e SMS',
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
    if (sec === 'admin')       loadSessions();
    if (sec === 'taskmanager') { loadTaskManager(); loadDevices(); }
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

// ── NOTIFICACOES SSE ──────────────────────────────────────────

let notifCount = 0;
const notifHistory = [];

const CFG = {
  venda:    { icon: '💰', title: 'Nova venda',        cls: 'venda',    dot: 'nd-venda'    },
  whatsapp: { icon: '📱', title: 'WhatsApp',          cls: 'whatsapp', dot: 'nd-whatsapp' },
  arduino:  { icon: '🔌', title: 'Arduino / SIM900',  cls: 'arduino',  dot: 'nd-arduino'  },
  mqtt:     { icon: '📡', title: 'Broker MQTT',       cls: 'sistema',  dot: 'nd-mqtt'     },
  sms:      { icon: '✉',  title: 'SMS recebido',      cls: 'sms',      dot: 'nd-sms'      },
  alerta:   { icon: '⚠',  title: 'Alerta',            cls: 'alerta',   dot: 'nd-alerta'   },
  sistema:  { icon: 'ℹ',  title: 'Sistema',           cls: 'sistema',  dot: 'nd-sistema'  },
  pagamento:{ icon: '💳', title: 'Pagamento',         cls: 'venda',    dot: 'nd-venda'    },
};

function formatarEvento(tipo, dados) {
  const c = CFG[tipo] || CFG.sistema;
  let desc = '';
  if (tipo === 'venda')     desc = `${dados.canal} — ${dados.pacote} — ${dados.valor} MT`;
  else if (tipo === 'whatsapp') desc = dados.estado === 'online' ? 'Conectado' : 'Desconectado';
  else if (tipo === 'arduino')  desc = dados.estado === 'online' ? `Ligado (sinal ${dados.sinal}/31)` : 'Desligado';
  else if (tipo === 'mqtt')     desc = dados.estado === 'online' ? 'Broker ligado' : 'Broker desligado';
  else if (tipo === 'sms')      desc = `De ${dados.remetente}: ${dados.preview}`;
  else if (tipo === 'alerta')   desc = dados.msg;
  else if (tipo === 'pagamento') desc = `${dados.numero} — ${dados.valor} MT via ${dados.metodo}`;
  else                          desc = JSON.stringify(dados);
  return { ...c, desc };
}

function mostrarToast(tipo, dados) {
  const { icon, title, desc, cls } = formatarEvento(tipo, dados);
  const toast = document.createElement('div');
  toast.className = `toast toast-${cls}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${desc}</div>
    </div>`;
  document.getElementById('toast-container').appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 220);
  }, 4000);
}

function adicionarNotif(tipo, dados, ts) {
  const { icon, title, desc, dot } = formatarEvento(tipo, dados);
  const hora = new Date(ts).toLocaleTimeString('pt');
  notifHistory.unshift({ tipo, dados, ts, icon, title, desc, dot, hora });
  if (notifHistory.length > 50) notifHistory.pop();

  notifCount++;
  const badge = document.getElementById('notif-badge');
  badge.textContent = notifCount > 99 ? '99+' : notifCount;
  badge.classList.remove('hidden');

  renderNotifList();
}

function renderNotifList() {
  const list = document.getElementById('notif-list');
  if (!notifHistory.length) {
    list.innerHTML = '<div class="empty" style="padding:24px">Sem notificacoes</div>';
    return;
  }
  list.innerHTML = notifHistory.map(n => `
    <div class="notif-item">
      <span class="notif-dot ${n.dot}"></span>
      <div class="notif-body">
        <div class="notif-title">${n.icon} ${n.title}</div>
        <div class="notif-desc">${n.desc}</div>
      </div>
      <span class="notif-time">${n.hora}</span>
    </div>`).join('');
}

// Bell toggle
document.getElementById('notif-bell').addEventListener('click', () => {
  const panel = document.getElementById('notif-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    notifCount = 0;
    document.getElementById('notif-badge').classList.add('hidden');
  }
});
document.getElementById('notif-close').addEventListener('click', () => {
  document.getElementById('notif-panel').classList.add('hidden');
});
document.getElementById('notif-clear').addEventListener('click', () => {
  notifHistory.length = 0;
  renderNotifList();
});

// SSE connection
function conectarSSE() {
  const sse = new EventSource('/api/events');
  sse.onmessage = (e) => {
    try {
      const { tipo, dados, ts } = JSON.parse(e.data);
      mostrarToast(tipo, dados);
      adicionarNotif(tipo, dados, ts);
      // Actualizar UI relevante
      if (tipo === 'whatsapp') checkStatus();
      if (tipo === 'arduino' || tipo === 'mqtt') checkHardware();
      if (tipo === 'venda') { loadStats(); loadPedidos(); }
    } catch (_) {}
  };
  sse.onerror = () => setTimeout(conectarSSE, 5000);
}

// ── TASK MANAGER SECTION ──────────────────────────────────────────

function tmBar(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.width = pct + '%';
  el.className = 'tm-bar ' + (pct > 85 ? 'danger' : pct > 60 ? 'warn' : 'ok');
}

async function loadTaskManager() {
  const [sis, dev] = await Promise.all([api('/sistema'), api('/devices')]);

  if (sis) {
    // CPU
    tmBar('tm-cpu-bar', sis.cpu);
    document.getElementById('tm-cpu-val').textContent = sis.cpu + '%';

    // RAM
    tmBar('tm-ram-bar', sis.ram.pct);
    document.getElementById('tm-ram-val').textContent = `${sis.ram.usado}/${sis.ram.total} MB`;

    // Disco
    tmBar('tm-disk-bar', sis.disco.pct || 0);
    document.getElementById('tm-disk-val').textContent = `${sis.disco.usado}/${sis.disco.total}`;

    document.getElementById('tm-server-details').innerHTML = `
      <div class="tm-detail-item"><div class="tm-detail-key">RAM livre</div><div class="tm-detail-val">${sis.ram.livre} MB</div></div>
      <div class="tm-detail-item"><div class="tm-detail-key">Disco livre</div><div class="tm-detail-val">${sis.disco.livre}</div></div>
      <div class="tm-detail-item"><div class="tm-detail-key">Uptime srv</div><div class="tm-detail-val">${sis.uptime.servidor}h</div></div>
      <div class="tm-detail-item"><div class="tm-detail-key">Uptime proc</div><div class="tm-detail-val">${sis.uptime.processo}h</div></div>`;

    // Node.js
    const heapPct = Math.round(sis.processo.heap / sis.processo.heapTotal * 100);
    tmBar('tm-heap-bar', heapPct);
    document.getElementById('tm-heap-val').textContent = `${sis.processo.heap}/${sis.processo.heapTotal} MB`;
    document.getElementById('tm-node-details').innerHTML = `
      <div class="tm-detail-item"><div class="tm-detail-key">RSS total</div><div class="tm-detail-val">${sis.processo.rss} MB</div></div>
      <div class="tm-detail-item"><div class="tm-detail-key">Heap usado</div><div class="tm-detail-val">${sis.processo.heap} MB</div></div>`;

    // Erros
    const l = sis.logs;
    document.getElementById('tm-erros').innerHTML = `
      <div class="tm-erro-item ${l.erros > 0 ? 'error' : 'ok'}">
        <span class="tm-erro-num" style="color:${l.erros > 0 ? 'var(--red)' : 'var(--green)'}">${l.erros}</span>
        <div class="tm-erro-info">
          <div class="tm-erro-label">Erros</div>
          <div class="tm-erro-desc">${l.ultimoErro || 'Nenhum erro registado'}</div>
        </div>
      </div>
      <div class="tm-erro-item ${l.avisos > 0 ? 'warn' : 'ok'}">
        <span class="tm-erro-num" style="color:${l.avisos > 0 ? 'var(--yellow)' : 'var(--green)'}">${l.avisos}</span>
        <div class="tm-erro-info">
          <div class="tm-erro-label">Avisos</div>
          <div class="tm-erro-desc">${l.ultimoErroTs ? new Date(l.ultimoErroTs).toLocaleTimeString('pt') : 'Sem avisos recentes'}</div>
        </div>
      </div>`;
  }

  if (dev?.devices) {
    // Dispositivos
    const DOT_COLOR = { online: 'var(--green)', offline: 'var(--red)', qr: 'var(--yellow)' };
    document.getElementById('tm-devices-list').innerHTML = dev.devices.map(d => `
      <div class="tm-dev-row">
        <span class="tm-dev-dot" style="background:${DOT_COLOR[d.estado] || 'var(--muted)'}"></span>
        <span class="tm-dev-name">${d.nome}</span>
        <span class="tm-dev-status ${d.estado}">${ESTADO_LABEL[d.estado] || d.estado}</span>
      </div>`).join('');

    // SIM900
    if (dev.sim900) {
      const s = dev.sim900;
      const REDE_CLS = { REGISTADO: 'online', A_PROCURAR: 'qr', NAO_REGISTADO: 'offline', DESCONHECIDO: 'offline' };
      const cls = REDE_CLS[s.rede] || 'offline';
      document.getElementById('tm-sim900-content').innerHTML = `
        <div class="tm-devices">
          <div class="tm-dev-row">
            <span class="tm-dev-dot" style="background:${s.simCard === 'OK' ? 'var(--green)' : 'var(--red)'}"></span>
            <span class="tm-dev-name">SIM Card</span>
            <span class="tm-dev-status ${s.simCard === 'OK' ? 'online' : 'offline'}">${s.simCard === 'OK' ? 'Inserido' : 'Ausente'}</span>
          </div>
          <div class="tm-dev-row">
            <span class="tm-dev-dot" style="background:${cls === 'online' ? 'var(--green)' : 'var(--yellow)'}"></span>
            <span class="tm-dev-name">Rede</span>
            <span class="tm-dev-status ${cls}">${s.rede}</span>
          </div>
          <div class="tm-dev-row">
            <span class="tm-dev-dot" style="background:var(--accent)"></span>
            <span class="tm-dev-name">Operadora</span>
            <span class="tm-dev-status" style="color:var(--text)">${s.operadora}</span>
          </div>
          <div class="tm-dev-row">
            <span class="tm-dev-dot" style="background:${s.sinal > 15 ? 'var(--green)' : s.sinal > 5 ? 'var(--yellow)' : 'var(--red)'}"></span>
            <span class="tm-dev-name">Sinal GSM</span>
            <span class="tm-dev-status" style="color:var(--text)">${s.sinal}/31</span>
          </div>
        </div>
        <div class="muted-text" style="margin-top:8px;font-size:.72rem">Actualizado: ${s.idadeMin === 0 ? 'agora' : s.idadeMin + ' min atras'}</div>`;
    }

    // ESP32
    const esp = dev.devices.find(d => d.id === 'esp32');
    if (esp?.heapLivre != null) {
      const heapPct = Math.round((1 - esp.heapLivre / esp.heapTotal) * 100);
      tmBar('tm-esp-bar', heapPct);
      document.getElementById('tm-esp-val').textContent =
        `${Math.round(esp.heapLivre/1024)}/${Math.round(esp.heapTotal/1024)} KB`;
      const rssiPct = esp.wifiRSSI ? Math.max(0, Math.min(100, (esp.wifiRSSI + 100) * 2)) : 0;
      const rssiLabel = esp.wifiRSSI > -50 ? 'Excelente' : esp.wifiRSSI > -70 ? 'Bom' : 'Fraco';
      document.getElementById('tm-esp-details').innerHTML = `
        <div class="tm-detail-item"><div class="tm-detail-key">WiFi SSID</div><div class="tm-detail-val">${esp.wifiSSID || '--'}</div></div>
        <div class="tm-detail-item"><div class="tm-detail-key">WiFi RSSI</div><div class="tm-detail-val">${esp.wifiRSSI || '--'} dBm (${rssiLabel})</div></div>
        <div class="tm-detail-item"><div class="tm-detail-key">Heap livre</div><div class="tm-detail-val">${Math.round(esp.heapLivre/1024)} KB</div></div>
        <div class="tm-detail-item"><div class="tm-detail-key">Uptime</div><div class="tm-detail-val">${esp.uptime ? Math.round(esp.uptime/60) + 'min' : '--'}</div></div>`;
    } else {
      document.getElementById('tm-esp-details').innerHTML =
        '<div class="muted-text">ESP32 nao conectado ou firmware desactualizado</div>';
    }

    // Arduino
    const ard = dev.devices.find(d => d.id === 'arduino');
    if (ard?.ramLivre != null) {
      tmBar('tm-ard-bar', ard.ramPct);
      document.getElementById('tm-ard-val').textContent = `${ard.ramLivre}/${ard.ramTotal} B`;
      document.getElementById('tm-arduino-details').innerHTML = `
        <div class="tm-detail-item"><div class="tm-detail-key">Sinal GSM</div><div class="tm-detail-val">${ard.sinal}/31</div></div>
        <div class="tm-detail-item"><div class="tm-detail-key">SRAM livre</div><div class="tm-detail-val">${ard.ramLivre} B</div></div>
        <div class="tm-detail-item"><div class="tm-detail-key">SRAM usada</div><div class="tm-detail-val">${ard.ramTotal - ard.ramLivre} B</div></div>
        <div class="tm-detail-item"><div class="tm-detail-key">Total SRAM</div><div class="tm-detail-val">${ard.ramTotal} B</div></div>`;
    } else {
      document.getElementById('tm-arduino-details').innerHTML =
        '<div class="muted-text">Arduino nao conectado ou firmware desactualizado</div>';
    }
  }
}

document.getElementById('tm-refresh').addEventListener('click', loadTaskManager);
document.getElementById('tm-diagnose-btn').addEventListener('click', async () => {
  const btn = document.getElementById('tm-diagnose-btn');
  btn.disabled = true;
  btn.textContent = 'A executar...';
  await api('/ussd/fechar', { method: 'POST' }); // fechar sessao aberta se houver
  mqtt && await api('/at', { method: 'POST', body: JSON.stringify({ comando: 'AT+CSQ' }) });
  // Pedir diagnostico via MQTT
  await fetch('/api/events'); // trigger noop
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Diagnostico';
    loadTaskManager();
  }, 12000);
});

// ── TASK MANAGER ──────────────────────────────────────────────

const ESTADO_DOT = { online: 'td-online', offline: 'td-offline', qr: 'td-qr', warn: 'td-warn' };
const ESTADO_LABEL = { online: 'Online', offline: 'Offline', qr: 'QR Code', warn: 'Aviso' };

async function loadDevices() {
  const data = await api('/devices');
  if (!data?.devices) return;

  const list    = document.getElementById('taskman-list');
  const badge   = document.getElementById('taskman-offline-count');
  const offline = data.devices.filter(d => d.estado === 'offline').length;

  badge.textContent = offline;
  offline > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');

  const r = data.recursos;
  const recursos = r ? `
    <div class="taskman-recursos">
      <div class="tr-item">
        <span>CPU</span>
        <div class="tr-bar"><div class="tr-fill ${r.cpu > 80 ? 'tr-red' : r.cpu > 50 ? 'tr-yellow' : 'tr-green'}" style="width:${r.cpu}%"></div></div>
        <span>${r.cpu}%</span>
      </div>
      <div class="tr-item">
        <span>RAM</span>
        <div class="tr-bar"><div class="tr-fill ${r.ramPct > 80 ? 'tr-red' : r.ramPct > 60 ? 'tr-yellow' : 'tr-green'}" style="width:${r.ramPct}%"></div></div>
        <span>${r.ramUsado}/${r.ramTotal}MB</span>
      </div>
      <div class="tr-item"><span>Node.js</span><span>${r.processo}MB</span></div>
      <div class="tr-item"><span>Uptime</span><span>${r.uptime}h</span></div>
    </div>` : '';

  // RAM do Arduino (se disponivel)
  const arduino = data.devices.find(d => d.id === 'arduino');
  const ramArduino = arduino?.ramLivre != null ? `
    <div class="taskman-recursos" style="border-top:1px solid var(--border);margin-top:0;border-bottom:none;padding-top:6px">
      <div style="font-size:.7rem;color:var(--muted);margin-bottom:4px;font-weight:600">ARDUINO UNO</div>
      <div class="tr-item">
        <span>SRAM</span>
        <div class="tr-bar"><div class="tr-fill ${arduino.ramPct > 80 ? 'tr-red' : arduino.ramPct > 60 ? 'tr-yellow' : 'tr-green'}" style="width:${arduino.ramPct}%"></div></div>
        <span>${arduino.ramLivre}/${arduino.ramTotal}B</span>
      </div>
      <div class="tr-item"><span>Sinal</span><span>${arduino.sinal}/31</span></div>
    </div>` : '';

  list.innerHTML = recursos + ramArduino + data.devices.map(d => {
    const dot   = ESTADO_DOT[d.estado]   || 'td-offline';
    const label = ESTADO_LABEL[d.estado] || d.estado;
    let info = d.ts ? `${Math.min(d.tempoAtras, 999)}s` : '-';
    if (d.estado === 'online' && d.sinal != null) info = `Sig ${d.sinal}/31`;
    if (d.id === 'arduino' && d.ramLivre != null) {
      info = `Sig ${d.sinal}/31 · RAM ${d.ramLivre}B`;
    }
    return `<div class="taskman-row">
      <span class="taskman-dot ${dot}"></span>
      <span class="taskman-name">${d.nome}</span>
      <span class="taskman-info">${label} · ${info}</span>
    </div>`;
  }).join('');
}

document.getElementById('taskman-toggle').addEventListener('click', () => {
  document.getElementById('taskman').classList.toggle('hidden');
});
document.getElementById('taskman-close').addEventListener('click', () => {
  document.getElementById('taskman').classList.add('hidden');
});

// ── INIT ──────────────────────────────────────────────

checkStatus();
checkHardware();
loadStats();
loadPedidos();
conectarSSE();

loadDevices();
setInterval(loadDevices,   5000);
setInterval(checkStatus,   4000);
setInterval(checkHardware, 10000);
setInterval(loadStats,     30000);
