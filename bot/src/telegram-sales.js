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
  if (text === '/ajuda')  return mostrarAjuda(chatId);
  if (text === '/cancelar') {
    setState(chatId, { step: 'menu', data: {} });
    await bot.sendMessage(chatId,
      '<b>Pedido cancelado.</b>\n\nPodes fazer um novo pedido a qualquer momento.', HTML);
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
  if (data === 'ajuda')           return mostrarAjuda(chatId);
  if (data.startsWith('cat_'))    return mostrarPacotes(chatId, data.slice(4));
  if (data.startsWith('pkg_'))    { const [,cat,idx] = data.split('_'); return seleccionarPacote(chatId, cat, parseInt(idx)); }
  if (data.startsWith('pay_'))    return processarMetodo(chatId, data.slice(4), s);
}

// ── BOAS VINDAS ───────────────────────────────────────

function boasVindas(chatId, nome) {
  setState(chatId, { step: 'termos', data: {} });
  return bot.sendMessage(chatId,
`┌─────────────────────────┐
│   <b>GigaBot MZ</b>
│   Pacotes MB Vodacom
└─────────────────────────┘

Ola <b>${nome}</b>!

Compra pacotes de internet de forma rapida e automatica.

<b>Como funciona:</b>
<code>1.</code> Escolhes o pacote
<code>2.</code> Pagas pelo M-Pesa ou e-Mola
<code>3.</code> O pacote activa automaticamente

<b>Termos e Condicoes:</b>
• Activacao automatica apos pagamento confirmado
• Paga o valor <u>exacto</u> indicado
• Activacao em ate 5 minutos
• Sem reembolso apos activacao

Aceitas os termos para continuar?`,
    { ...HTML, reply_markup: { inline_keyboard: [[
      { text: '✅  Aceito os termos', callback_data: 'aceitar_termos' },
      { text: '❌  Nao aceito',       callback_data: 'rejeitar_termos' }
    ]] } }
  );
}

function mostrarMenu(chatId, nome) {
  const primeiro = (nome || 'Cliente').split(' ')[0];
  return bot.sendMessage(chatId,
`<b>Menu Principal</b>

Ola, <b>${primeiro}</b>! O que pretendes?`,
    { ...HTML, reply_markup: { inline_keyboard: [
      [{ text: '📦  Pacotes Diarios',               callback_data: 'cat_diarios'  }],
      [{ text: '📅  Pacotes Mensais',               callback_data: 'cat_mensais'  }],
      [{ text: '💎  Diamante — Chamadas + MB',      callback_data: 'cat_diamante' }],
      [{ text: '🧾  Os meus pedidos',               callback_data: 'meus_pedidos' }],
      [{ text: '❓  Ajuda',                          callback_data: 'ajuda'        }],
    ]}}
  );
}

function mostrarAjuda(chatId) {
  return bot.sendMessage(chatId,
`<b>Ajuda — GigaBot MZ</b>

<b>Comandos disponiveis:</b>
/start — Iniciar / Boas-vindas
/menu — Menu principal
/pedidos — Os meus pedidos
/cancelar — Cancelar pedido actual
/ajuda — Esta mensagem
/chatid — Ver o teu ID

<b>Suporte:</b>
Problemas com pagamentos? Contacta o administrador.

<b>Horario:</b>
O sistema funciona 24 horas por dia.`, HTML);
}

// ── PACOTES ───────────────────────────────────────────

function mostrarPacotes(chatId, categoria) {
  const pacotes = PACOTES[categoria];
  if (!pacotes?.length) return bot.sendMessage(chatId, 'Categoria nao encontrada.', HTML);

  setState(chatId, { step: 'escolhendo_pacote', data: { categoria } });

  const titulos = {
    diarios:  '📦 <b>Pacotes Diarios</b>',
    mensais:  '📅 <b>Pacotes Mensais</b>',
    diamante: '💎 <b>Pacotes Diamante</b>'
  };

  const descricoes = {
    diarios:  'Pacotes de uso diario, ideais para navegacao rapida',
    mensais:  'Pacotes mensais para uso continuo',
    diamante: 'Pacotes premium com chamadas e SMS ilimitadas'
  };

  const keyboard = pacotes.map((p, i) => [{
    text: `${p.mbFormatado}  —  ${p.preco} MT`,
    callback_data: `pkg_${categoria}_${i}`
  }]);
  keyboard.push([{ text: '← Voltar ao menu', callback_data: 'menu' }]);

  return bot.sendMessage(chatId,
    `${titulos[categoria] || '<b>Pacotes</b>'}\n<i>${descricoes[categoria] || ''}</i>\n\nEscolhe o pacote:`,
    { ...HTML, reply_markup: { inline_keyboard: keyboard } }
  );
}

function seleccionarPacote(chatId, categoria, idx) {
  const pacotes = PACOTES[categoria];
  if (!pacotes || idx >= pacotes.length) return;
  const pacote = pacotes[idx];
  setState(chatId, { step: 'escolhendo_pagamento', data: { categoria, pacote } });

  const tipo = pacote.tipo === 'diario' ? '1 dia' : pacote.tipo === 'mensal' ? '30 dias' : 'Mensal';

  return bot.sendMessage(chatId,
`<b>Pacote Seleccionado</b>

┌──────────────────────┐
│  <b>${pacote.mbFormatado.padEnd(12)}</b>
│  <b>${pacote.preco} MT</b>
│  Validade: ${tipo}
└──────────────────────┘

Escolhe o metodo de pagamento:`,
    { ...HTML, reply_markup: { inline_keyboard: [
      [{ text: '📱  M-Pesa',  callback_data: 'pay_mpesa' }],
      [{ text: '📱  e-Mola',  callback_data: 'pay_emola' }],
      [{ text: '← Voltar',    callback_data: `cat_${categoria}` }],
    ]}}
  );
}

// ── PAGAMENTO ─────────────────────────────────────────

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

<b>Pacote:</b> ${pacote.mbFormatado}
<b>Valor:</b> <code>${pacote.preco} MT</code>
<b>Metodo:</b> ${nomeMetodo}

<b>Numero para enviar:</b>
<code>${numero}</code>

<b>Passos:</b>
<code>1.</code> Abre o ${nomeMetodo} no teu telemovel
<code>2.</code> Envia exactamente <b>${pacote.preco} MT</b>
<code>3.</code> Copia a referencia de confirmacao
<code>4.</code> Envia a referencia aqui

<i>Tens 15 minutos para efectuar o pagamento.</i>
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
      '<b>Tempo esgotado.</b>\n\nO pedido foi cancelado automaticamente.\n\nUsa /menu para fazer um novo pedido.', HTML);
    return mostrarMenu(chatId, nome);
  }

  pedido.referencia    = referencia;
  pedido.status        = 'pago';
  pedido.dataPagamento = new Date();
  await pedido.save();
  setState(chatId, { step: 'menu', data: {} });

  await bot.sendMessage(chatId,
    `<b>Referencia recebida!</b>\n\nCodigo: <code>${referencia}</code>\n\n<i>A processar o teu pacote...</i>`, HTML);

  setTimeout(async () => {
    try {
      pedido.status        = 'activado';
      pedido.dataActivacao = new Date();
      await pedido.save();

      bot.sendMessage(chatId,
`<b>Pacote Activado com Sucesso!</b>

<b>Pacote:</b> ${pacote.mbFormatado}
<b>Valor pago:</b> ${pacote.preco} MT
<b>Data:</b> ${new Date().toLocaleString('pt')}

Obrigado pela preferencia!
Usa /menu para comprar mais.`, HTML);

      const admin = require('./telegram');
      admin.sendMessage(`Nova venda — Telegram\nCliente: ${chatId}\nPacote: ${pacote.mbFormatado}\nValor: ${pacote.preco} MT`);
    } catch (_) {}
  }, 3000);
}

// ── HISTORICO ─────────────────────────────────────────

async function mostrarMeusPedidos(chatId) {
  const pedidos = await Pedido.find({ 'cliente.whatsapp': `tg_${chatId}` })
    .sort({ createdAt: -1 }).limit(10);

  if (!pedidos.length) {
    return bot.sendMessage(chatId,
      '<b>Sem pedidos</b>\n\nAinda nao tens pedidos.\n\nUsa /menu para comprar o teu primeiro pacote.',
      { ...HTML, reply_markup: { inline_keyboard: [[{ text: 'Ir ao menu', callback_data: 'menu' }]] } }
    );
  }

  const icones = { activado: '✅', pago: '⏳', pendente: '🕐', erro: '❌', expirado: '⛔', cancelado: '⛔' };
  const linhas = pedidos.map((p, i) => {
    const ic = icones[p.status] || '•';
    const dt = new Date(p.createdAt).toLocaleDateString('pt');
    return `<code>${String(i+1).padStart(2)}.</code> ${ic} <b>${p.pacote?.mbFormatado || '--'}</b>  ${p.valorEsperado} MT  <i>${dt}</i>`;
  });

  const total = pedidos.filter(p => p.status === 'activado').reduce((s, p) => s + (p.valorEsperado || 0), 0);

  return bot.sendMessage(chatId,
`<b>Os teus Pedidos</b>

${linhas.join('\n')}

<b>Total gasto (activados):</b> ${total} MT`,
    { ...HTML, reply_markup: { inline_keyboard: [[{ text: 'Novo pedido', callback_data: 'menu' }]] } }
  );
}

function isActive() { return active; }
module.exports = { initSales, isActive };
