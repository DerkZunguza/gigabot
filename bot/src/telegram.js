const TelegramBot = require('node-telegram-bot-api');

const TOKEN     = process.env.TELEGRAM_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

let bot = null;

function init() {
  if (!TOKEN) {
    console.log('Telegram: TELEGRAM_TOKEN nao definido, modulo desactivado');
    return;
  }

  bot = new TelegramBot(TOKEN, { polling: true });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text   = (msg.text || '').trim();

    // Qualquer pessoa pode ver o chat ID para configuracao inicial
    if (text === '/chatid' || text === '/start') {
      bot.sendMessage(chatId, `O teu Chat ID e: ${chatId}\nAdiciona TELEGRAM_CHAT_ID=${chatId} nas variaveis de ambiente do Portainer.`);
      return;
    }

    // Comandos restritos ao administrador
    if (String(chatId) !== String(CHAT_ID)) {
      bot.sendMessage(chatId, 'Acesso negado.');
      return;
    }

    if (text === '/status') {
      const whatsapp = require('./whatsapp');
      const mqttMod  = require('./mqtt');
      const s = whatsapp.getStatus();
      bot.sendMessage(chatId,
        `WhatsApp: ${s.status}\nMQTT: ${mqttMod.isConnected() ? 'Ligado' : 'Desligado'}`
      );
      return;
    }

    if (text === '/qr') {
      const whatsapp = require('./whatsapp');
      const s = whatsapp.getStatus();
      if (s.qrCode) {
        await sendQR(s.qrCode);
      } else {
        bot.sendMessage(chatId, 'QR Code nao disponivel. Usa /restart para gerar um novo.');
      }
      return;
    }

    if (text === '/restart') {
      bot.sendMessage(chatId, 'A reiniciar WhatsApp...');
      const whatsapp = require('./whatsapp');
      whatsapp.restart().catch(() => {});
      return;
    }

    bot.sendMessage(chatId, 'Comandos: /status /qr /restart /chatid');
  });

  bot.on('polling_error', (err) => {
    console.error('Telegram polling error:', err.message);
  });

  console.log('Telegram bot iniciado');
}

async function sendQR(qrCodeDataUrl) {
  if (!bot || !CHAT_ID) return;
  try {
    const base64 = qrCodeDataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    await bot.sendPhoto(CHAT_ID, buffer, {
      caption: 'Escaneia no WhatsApp: Configuracoes > Aparelhos conectados > Conectar um aparelho'
    });
  } catch (err) {
    console.error('Telegram sendQR error:', err.message);
  }
}

async function sendMessage(text) {
  if (!bot || !CHAT_ID) return;
  bot.sendMessage(CHAT_ID, text).catch(() => {});
}

module.exports = { init, sendQR, sendMessage };
