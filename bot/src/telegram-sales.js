const TelegramBot = require('node-telegram-bot-api');
const Pedido      = require('./models/pedido');
const PACOTES     = require('./pacotes-vodacom');

const SALES_TOKEN  = process.env.TELEGRAM_SALES_TOKEN;
const NUMERO_MPESA = process.env.NUMERO_MPESA || 'CONFIGURAR_NUMERO_MPESA';
const NUMERO_EMOLA = process.env.NUMERO_EMOLA || 'CONFIGURAR_NUMERO_EMOLA';

const HTML = { parse_mode: 'HTML' };

let bot    = null;
let active = false;

const state = new Map();
function getState(id) { return state.get(String(id)) || { step: 'inicio', data: {} }; }
function setState(id, s) { state.set(String(id), s); }

// ── INIT ──────────────────────────────────────────────

function initSales() {
  if (!SALES_TOKEN) {
    console.log('Telegram Sales: TELEGRAM_SALES_TOKEN nao definido');
    return;
  }
  bot = new TelegramBot(SALES_TOKEN, { polling: true });
  active = true;
  bot.on('message',        handleMessage);
  bot.on('callback_query', handleCallback);
  bot.on('polling_error',  e => console.error('Sales polling error:', e.message));
  console.log('Telegram Sales Bot iniciado');
}

// ── MENSAGENS ─────────────────────────────────────────

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text   = (msg.text || '').trim();
  const s      = getState(chatId);
  const nome   = msg.from?.first_name || 'Cliente';

  if (text === '/chatid') return bot.sendMessage(chatId, `O teu Chat ID: <code>${chatId}</code>`, HTML);
  if (text === '/start')  return boasVindas(chatId, nome);
  if (text === '/menu')   return mostrarMenu(chatId, nome);
  if (text === '/pedidos')return mostrarMeusPedidos(chatId);
  if (text === '/cancelar') {
    setState(chatId, { step: 'menu', data: {} });
    await bot.sendMessage(chatId, 'Pedido cancelado.', HTML);
    return mostrarMenu(chatId, nome);
  }
  if (s.step === 'aguardando_referencia') return processarReferencia(chatId, text, s, nome);
  return mostrarMenu(chatId, nome);
}

// ── CALLBACKS ─────────────────────────────────────────

async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data   = query.data;
  const s      = getState(chatId);
  const nome   = query.from?.first_name || 'Cliente';
  bot.answerCallbackQuery(query.id).catch(() => {});

  if (data === 'aceitar_termos')  { setState(chatId, { step: 'menu', data: {} }); return mostrarMenu(chatId, nome); }
  if (data === 'rejeitar_termos') return bot.sendMessage(chatId, 'Tudo bem! Quando quiseres comprar envia /start.', HTML);
  if (data === 'menu')            { setState(chatId, { step: 'menu', data: {} }); return mostrarMenu(chatId, nome); }
  if (data === 'meus_pedidos')    return mostrarMeusPedidos(chatId);
  if (data.startsWith('cat_'))    return mostrarPacotes(chatId, data.slice(4));
  if (data.startsWith('pkg_'))    { const [,cat,idx] = data.split('_'); return seleccionarPacote(chatId, cat, parseInt(idx)); }
  if (data.startsWith('pay_'))    return processarMetodo(chatId, data.slice(4), s);
}

// ── FLUXO ─────────────────────────────────────────────

function boasVindas(chatId, nome) {
  setState(chatId, { step: 'termos', data: {} });
  return bot.sendMessage(chatId,
`<b>Bem-vindo, ${nome}!</b> 👋

<b>GigaBot MZ</b> — Compra de pacotes MB Vodacom de forma rapida e automatica.

<b>Termos e Condicoes:</b>
  ▸ Activacao automatica apos pagamento confirmado
  ▸ Paga o valor <u>exacto</u> indicado
  ▸ Activacao em ate 5 minutos
  ▸ Sem reembolso apos activacao
  ▸ Metodos aceites: M-Pesa e e-Mola

Aceitas os termos para continuar?`,
    { ...HTML, reply_markup: { inline_keyboard: [[
      { text: 'Aceito os termos', callback_data: 'aceitar_termos' },
      { text: 'Nao aceito',       callback_data: 'rejeitar_termos' }
    ]] } }
  );
}

function mostrarMenu(chatId, nome) {
  const primeiroNome = (nome || 'Cliente').split(' ')[0];
  return bot.sendMessage(chatId,
`Ola, <b>${primeiroNome}</b>! O que pretendes comprar hoje?`,
    { ...HTML, reply_markup: { inline_keyboard: [
      [{ text: '📦  Pacotes Diarios',                  callback_data: 'cat_diarios'  }],
      [{ text: '📅  Pacotes Mensais',                  callback_data: 'cat_mensais'  }],
      [{ text: '💎  Diamante — Chamadas + MB',         callback_data: 'cat_diamante' }],
      [{ text: '🧾  Os meus pedidos',                  callback_data: 'meus_pedidos' }],
    ]}}
  );
}

function mostrarPacotes(chatId, categoria) {
  const pacotes = PACOTES[categoria];
  if (!pacotes?.length) return bot.sendMessage(chatId, 'Categoria nao encontrada.', HTML);

  setState(chatId, { step: 'escolhendo_pacote', data: { categoria } });

  const titulos = { diarios: 'Pacotes Diarios', mensais: 'Pacotes Mensais', diamante: 'Pacotes Diamante' };
  const keyboard = pacotes.map((p, i) => [{
    text: `${p.mbFormatado}  —  ${p.preco} MT`,
    callback_data: `pkg_${categoria}_${i}`
  }]);
  keyboard.push([{ text: '← Voltar ao menu', callback_data: 'menu' }]);

  return bot.sendMessage(chatId,
    `<b>${titulos[categoria] || 'Pacotes'}</b>\n\nEscolhe o pacote:`,
    { ...HTML, reply_markup: { inline_keyboard: keyboard } }
  );
}

function seleccionarPacote(chatId, categoria, idx) {
  const pacotes = PACOTES[categoria];
  if (!pacotes || idx >= pacotes.length) return;
  const pacote = pacotes[idx];
  setState(chatId, { step: 'escolhendo_pagamento', data: { categoria, pacote } });

  return bot.sendMessage(chatId,
`<b>Pacote seleccionado:</b>

  📦 <b>${pacote.mbFormatado}</b>
  💰 <b>${pacote.preco} MT</b>
  🕐 Validade: ${pacote.tipo === 'diario' ? '1 dia' : pacote.tipo === 'mensal' ? '30 dias' : 'Mensal'}

Escolhe o metodo de pagamento:`,
    { ...HTML, reply_markup: { inline_keyboard: [
      [{ text: '📲  M-Pesa',  callback_data: 'pay_mpesa' }],
      [{ text: '📲  e-Mola',  callback_data: 'pay_emola' }],
      [{ text: '← Voltar',    callback_data: `cat_${categoria}` }],
    ]}}
  );
}

async function processarMetodo(chatId, method, currentState) {
  const { pacote } = currentState.data;
  if (!pacote) return mostrarMenu(chatId, '');

  const isMpesa    = method === 'mpesa';
  const numero     = isMpesa ? NUMERO_MPESA : NUMERO_EMOLA;
  const nomeMetodo = isMpesa ? 'M-Pesa' : 'e-Mola';

  const pedido = new Pedido({
    cliente:         { whatsapp: `tg_${chatId}`, nome: `Telegram ${chatId}` },
    pacote:          { nome: pacote.mbFormatado, mb: pacote.mb, mbFormatado: pacote.mbFormatado, tipo: pacote.tipo, preco: pacote.preco },
    valorEsperado:   pacote.preco,
    metodoPagamento: isMpesa ? 'm-pesa' : 'e-mola',
    status:          'pendente',
    expiracao:       new Date(Date.now() + 15 * 60 * 1000)
  });
  await pedido.save();

  setState(chatId, { step: 'aguardando_referencia', data: { pacote, method, pedidoId: pedido._id } });

  return bot.sendMessage(chatId,
`<b>Instrucoes de Pagamento</b>

  💳 Metodo: <b>${nomeMetodo}</b>
  💰 Valor: <b>${pacote.preco} MT</b>
  📱 Numero: <code>${numero}</code>

<b>Como pagar:</b>
  1. Abre o ${nomeMetodo} no teu telemovel
  2. Envia exactamente <b>${pacote.preco} MT</b> para <code>${numero}</code>
  3. Copia a referencia de confirmacao
  4. Envia aqui a referencia

⏳ Tens <b>15 minutos</b> para efectuar o pagamento.
Envia /cancelar para cancelar.`,
    HTML
  );
}

async function processarReferencia(chatId, referencia, s, nome) {
  const { pedidoId, pacote } = s.data;
  if (!pedidoId) return mostrarMenu(chatId, nome);

  const pedido = await Pedido.findById(pedidoId);
  if (!pedido || new Date() > pedido.expiracao) {
    setState(chatId, { step: 'menu', data: {} });
    await bot.sendMessage(chatId,
      '⏱ Tempo esgotado. O pedido foi cancelado.\n\nUsa /menu para fazer um novo pedido.',
      HTML
    );
    return mostrarMenu(chatId, nome);
  }

  pedido.referencia    = referencia;
  pedido.status        = 'pago';
  pedido.dataPagamento = new Date();
  await pedido.save();
  setState(chatId, { step: 'menu', data: {} });

  await bot.sendMessage(chatId,
    `Referencia <code>${referencia}</code> recebida.\n\n⏳ A processar o teu pacote...`,
    HTML
  );

  setTimeout(async () => {
    try {
      pedido.status        = 'activado';
      pedido.dataActivacao = new Date();
      await pedido.save();

      // Notificar cliente
      bot.sendMessage(chatId,
`<b>Pacote activado com sucesso!</b> ✅

  📦 Pacote: <b>${pacote.mbFormatado}</b>
  💰 Valor pago: <b>${pacote.preco} MT</b>

Obrigado pela preferencia! Usa /menu para comprar mais.`,
        HTML
      );

      // Notificar administrador
      const admin = require('./telegram');
      const metodo = s.data.method === 'mpesa' ? 'M-Pesa' : 'e-Mola';
      admin.sendMessage(
        `Nova venda — Telegram\n\nCliente: ${chatId}\nPacote: ${pacote.mbFormatado}\nValor: ${pacote.preco} MT\nMetodo: ${metodo}\nReferencia: ${referencia}`
      );
    } catch (_) {}
  }, 3000);
}

async function mostrarMeusPedidos(chatId) {
  const pedidos = await Pedido.find({ 'cliente.whatsapp': `tg_${chatId}` })
    .sort({ createdAt: -1 }).limit(10);

  if (!pedidos.length) {
    return bot.sendMessage(chatId,
      'Ainda nao tens pedidos.\n\nUsa /menu para comprar o teu primeiro pacote.',
      { ...HTML, reply_markup: { inline_keyboard: [[{ text: 'Ir ao menu', callback_data: 'menu' }]] } }
    );
  }

  const iconStatus = { activado: '✅', pago: '⏳', pendente: '🕐', erro: '❌', expirado: '⛔', cancelado: '⛔' };
  const linhas = pedidos.map((p, i) => {
    const ic = iconStatus[p.status] || '•';
    const dt = new Date(p.createdAt).toLocaleDateString('pt');
    return `${i + 1}. ${ic} <b>${p.pacote?.mbFormatado || '--'}</b>  ${p.valorEsperado} MT  <i>${dt}</i>`;
  });

  return bot.sendMessage(chatId,
    `<b>Os teus pedidos:</b>\n\n${linhas.join('\n')}`,
    { ...HTML, reply_markup: { inline_keyboard: [[{ text: 'Novo pedido', callback_data: 'menu' }]] } }
  );
}

function isActive() { return active; }
module.exports = { initSales, isActive };
