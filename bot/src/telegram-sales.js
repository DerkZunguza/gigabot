const TelegramBot = require('node-telegram-bot-api');
const Pedido      = require('./models/pedido');
const PACOTES     = require('./pacotes-vodacom');

const SALES_TOKEN  = process.env.TELEGRAM_SALES_TOKEN;
const NUMERO_MPESA = process.env.NUMERO_MPESA || 'CONFIGURAR_NUMERO_MPESA';
const NUMERO_EMOLA = process.env.NUMERO_EMOLA || 'CONFIGURAR_NUMERO_EMOLA';

let bot    = null;
let active = false;

// Estado em memoria por utilizador
const state = new Map();

function getState(chatId) {
  return state.get(String(chatId)) || { step: 'inicio', data: {} };
}
function setState(chatId, s) {
  state.set(String(chatId), s);
}

// ── INICIALIZAR ───────────────────────────────────────

function initSales() {
  if (!SALES_TOKEN) {
    console.log('Telegram Sales: TELEGRAM_SALES_TOKEN nao definido, desactivado');
    return;
  }

  bot = new TelegramBot(SALES_TOKEN, { polling: true });
  active = true;

  bot.on('message',        handleMessage);
  bot.on('callback_query', handleCallback);
  bot.on('polling_error',  (e) => console.error('Telegram Sales polling error:', e.message));

  console.log('Telegram Sales Bot iniciado');
}

// ── MENSAGENS ─────────────────────────────────────────

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text   = (msg.text || '').trim();
  const s      = getState(chatId);

  if (text === '/start' || text === '/inicio') {
    return enviarBoasVindas(chatId);
  }

  if (text === '/menu') {
    return mostrarMenu(chatId);
  }

  if (text === '/meus_pedidos' || text === '/pedidos') {
    return mostrarMeusPedidos(chatId);
  }

  if (text === '/cancelar') {
    setState(chatId, { step: 'menu', data: {} });
    bot.sendMessage(chatId, 'Pedido cancelado.');
    return mostrarMenu(chatId);
  }

  // Referencia de pagamento
  if (s.step === 'aguardando_referencia') {
    return processarReferencia(chatId, text, s);
  }

  // Qualquer outra mensagem → mostrar menu
  return mostrarMenu(chatId);
}

// ── CALLBACKS (botoes inline) ─────────────────────────

async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data   = query.data;
  const s      = getState(chatId);

  bot.answerCallbackQuery(query.id).catch(() => {});

  if (data === 'aceitar_termos') {
    setState(chatId, { step: 'menu', data: {} });
    return mostrarMenu(chatId);
  }

  if (data === 'rejeitar_termos') {
    return bot.sendMessage(chatId, 'Tudo bem! Quando mudares de ideiao envia /start.');
  }

  if (data === 'menu') {
    setState(chatId, { step: 'menu', data: {} });
    return mostrarMenu(chatId);
  }

  if (data.startsWith('cat_')) {
    const cat = data.slice(4);
    return mostrarPacotes(chatId, cat);
  }

  if (data.startsWith('pkg_')) {
    const parts = data.split('_');
    const cat   = parts[1];
    const idx   = parseInt(parts[2]);
    return seleccionarPacote(chatId, cat, idx);
  }

  if (data.startsWith('pay_')) {
    const method = data.slice(4);
    return processarMetodoPagamento(chatId, method, s);
  }

  if (data === 'meus_pedidos') {
    return mostrarMeusPedidos(chatId);
  }
}

// ── FLUXO ─────────────────────────────────────────────

function enviarBoasVindas(chatId) {
  setState(chatId, { step: 'termos', data: {} });
  return bot.sendMessage(chatId,
    `Bem-vindo ao *GigaBot MZ*\n\n` +
    `Venda automatica de pacotes MB Vodacom Mocambique.\n\n` +
    `*Termos e Condicoes:*\n` +
    `- Os pacotes sao activados automaticamente apos pagamento confirmado\n` +
    `- Pague o valor exacto indicado\n` +
    `- Activacao em ate 5 minutos apos pagamento\n` +
    `- Nao e feito reembolso apos activacao\n` +
    `- Aceitamos M-Pesa e e-Mola\n\n` +
    `Aceitas os termos?`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[
        { text: 'Aceito os termos', callback_data: 'aceitar_termos' },
        { text: 'Nao aceito',       callback_data: 'rejeitar_termos' }
      ]]}
    }
  );
}

function mostrarMenu(chatId) {
  return bot.sendMessage(chatId, 'O que pretendes comprar?', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Pacotes Diarios',                   callback_data: 'cat_diarios'  }],
        [{ text: 'Pacotes Mensais',                   callback_data: 'cat_mensais'  }],
        [{ text: 'Pacotes Diamante (chamadas + MB)',   callback_data: 'cat_diamante' }],
        [{ text: 'Os meus pedidos',                   callback_data: 'meus_pedidos' }],
      ]
    }
  });
}

function mostrarPacotes(chatId, categoria) {
  const pacotes = PACOTES[categoria];
  if (!pacotes || pacotes.length === 0) {
    return bot.sendMessage(chatId, 'Categoria nao encontrada.');
  }

  setState(chatId, { step: 'escolhendo_pacote', data: { categoria } });

  const titulos = {
    diarios:  'Pacotes Diarios',
    mensais:  'Pacotes Mensais',
    diamante: 'Pacotes Diamante'
  };

  const keyboard = pacotes.map((p, i) => [{
    text: `${p.mbFormatado}  —  ${p.preco} MT`,
    callback_data: `pkg_${categoria}_${i}`
  }]);
  keyboard.push([{ text: 'Voltar ao menu', callback_data: 'menu' }]);

  return bot.sendMessage(chatId, titulos[categoria] || 'Pacotes:', {
    reply_markup: { inline_keyboard: keyboard }
  });
}

function seleccionarPacote(chatId, categoria, idx) {
  const pacotes = PACOTES[categoria];
  if (!pacotes || idx >= pacotes.length) return;

  const pacote = pacotes[idx];
  setState(chatId, { step: 'escolhendo_pagamento', data: { categoria, pacote } });

  return bot.sendMessage(chatId,
    `*${pacote.mbFormatado}*  —  ${pacote.preco} MT\n\nEscolhe o metodo de pagamento:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'M-Pesa',  callback_data: 'pay_mpesa'  }],
          [{ text: 'e-Mola',  callback_data: 'pay_emola'  }],
          [{ text: 'Voltar',  callback_data: `cat_${categoria}` }],
        ]
      }
    }
  );
}

async function processarMetodoPagamento(chatId, method, currentState) {
  const { pacote } = currentState.data;
  if (!pacote) return mostrarMenu(chatId);

  const isMpesa    = method === 'mpesa';
  const numero     = isMpesa ? NUMERO_MPESA : NUMERO_EMOLA;
  const nomeMetodo = isMpesa ? 'M-Pesa' : 'e-Mola';

  const pedido = new Pedido({
    cliente:          { whatsapp: `tg_${chatId}`, nome: `Telegram ${chatId}` },
    pacote:           { nome: pacote.mbFormatado, mb: pacote.mb, mbFormatado: pacote.mbFormatado, tipo: pacote.tipo, preco: pacote.preco },
    valorEsperado:    pacote.preco,
    metodoPagamento:  isMpesa ? 'm-pesa' : 'e-mola',
    status:           'pendente',
    expiracao:        new Date(Date.now() + 15 * 60 * 1000)
  });
  await pedido.save();

  setState(chatId, { step: 'aguardando_referencia', data: { pacote, method, pedidoId: pedido._id } });

  return bot.sendMessage(chatId,
    `*Instrucoes de pagamento*\n\n` +
    `Metodo: ${nomeMetodo}\n` +
    `Envia exactamente *${pacote.preco} MT* para:\n` +
    `Numero: *${numero}*\n\n` +
    `Apos o pagamento, envia aqui a referencia de confirmacao.\n\n` +
    `Tens *15 minutos*. Envia /cancelar para cancelar.`,
    { parse_mode: 'Markdown' }
  );
}

async function processarReferencia(chatId, referencia, s) {
  const { pedidoId, pacote } = s.data;
  if (!pedidoId) return mostrarMenu(chatId);

  const pedido = await Pedido.findById(pedidoId);
  if (!pedido || new Date() > pedido.expiracao) {
    setState(chatId, { step: 'menu', data: {} });
    bot.sendMessage(chatId, 'Tempo esgotado. O pedido foi cancelado. Usa /menu para fazer um novo pedido.');
    return mostrarMenu(chatId);
  }

  pedido.referencia   = referencia;
  pedido.status       = 'pago';
  pedido.dataPagamento = new Date();
  await pedido.save();

  setState(chatId, { step: 'menu', data: {} });

  bot.sendMessage(chatId, `Referencia *${referencia}* recebida.\n\nA processar o teu pacote...`, { parse_mode: 'Markdown' });

  // Activacao simulada (3 segundos) — substituir por MQTT quando Arduino estiver ligado
  setTimeout(async () => {
    try {
      pedido.status        = 'activado';
      pedido.dataActivacao = new Date();
      await pedido.save();
      bot.sendMessage(chatId,
        `*Pacote activado com sucesso!*\n\n` +
        `Pacote: ${pacote.mbFormatado}\n` +
        `Valor: ${pacote.preco} MT\n\n` +
        `Obrigado pela preferencia! Usa /menu para comprar mais.`,
        { parse_mode: 'Markdown' }
      );
    } catch (_) {}
  }, 3000);
}

async function mostrarMeusPedidos(chatId) {
  const pedidos = await Pedido.find({
    'cliente.whatsapp': `tg_${chatId}`
  }).sort({ createdAt: -1 }).limit(10);

  if (pedidos.length === 0) {
    return bot.sendMessage(chatId, 'Ainda nao tens pedidos.\n\nUsa /menu para comprar o teu primeiro pacote.');
  }

  const statusLabels = {
    activado:  'Activado',
    pago:      'Pago',
    pendente:  'Pendente',
    erro:      'Erro',
    expirado:  'Expirado',
    cancelado: 'Cancelado'
  };

  const linhas = pedidos.map((p, i) => {
    const data = new Date(p.createdAt).toLocaleDateString('pt');
    const st   = statusLabels[p.status] || p.status;
    return `${i + 1}. ${p.pacote?.mbFormatado || '--'}  ${p.valorEsperado} MT  [${st}]  ${data}`;
  });

  bot.sendMessage(chatId, `Os teus ultimos pedidos:\n\n${linhas.join('\n')}`, {
    reply_markup: { inline_keyboard: [[{ text: 'Novo pedido', callback_data: 'menu' }]] }
  });
}

function isActive() { return active; }

module.exports = { initSales, isActive };
