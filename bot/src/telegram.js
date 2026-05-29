const TelegramBot = require('node-telegram-bot-api');

const TOKEN   = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let bot    = null;
let active = false;

const HELP = `Comandos disponiveis:

/status   - Estado de todos os sistemas
/qr       - Obter QR Code do WhatsApp
/restart  - Reiniciar conexao WhatsApp
/pedidos  - Resumo dos pedidos de hoje
/chatid   - Ver o teu Chat ID`;

function init() {
  if (!TOKEN) {
    console.log('Telegram: TELEGRAM_TOKEN nao definido, modulo desactivado');
    return;
  }

  bot = new TelegramBot(TOKEN, { polling: true });
  active = true;

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text   = (msg.text || '').trim().split(' ')[0]; // ignorar argumentos

    if (text === '/chatid' || text === '/start') {
      bot.sendMessage(chatId,
        `O teu Chat ID e: ${chatId}\n\nAdiciona TELEGRAM_CHAT_ID=${chatId} nas variaveis de ambiente do Portainer para activar os comandos de administrador.`
      );
      return;
    }

    if (String(chatId) !== String(CHAT_ID)) {
      bot.sendMessage(chatId, 'Acesso negado. Usa /chatid para ver o teu ID.');
      return;
    }

    switch (text) {
      case '/help':
      case '/ajuda':
        bot.sendMessage(chatId, HELP);
        break;

      case '/status': {
        const whatsapp = require('./whatsapp');
        const mqttMod  = require('./mqtt');
        const fs       = require('fs');
        const s = whatsapp.getStatus();
        const lines = [
          `WhatsApp:  ${s.status}`,
          `MQTT:      ${mqttMod.isConnected() ? 'Ligado' : 'Desligado'}`,
          `Arduino:   ${fs.existsSync('/dev/ttyUSB0') ? 'Ligado' : 'Desligado'}`,
          `MongoDB:   Ligado`,
        ];
        bot.sendMessage(chatId, lines.join('\n'));
        break;
      }

      case '/qr': {
        const whatsapp = require('./whatsapp');
        const s = whatsapp.getStatus();
        if (s.qrCode) {
          await sendQR(s.qrCode);
        } else if (s.pairingCode) {
          bot.sendMessage(chatId, `Codigo de pareamento: ${s.pairingCode}`);
        } else {
          bot.sendMessage(chatId, 'Nenhum codigo disponivel. Usa /restart para gerar um novo QR.');
        }
        break;
      }

      case '/restart': {
        bot.sendMessage(chatId, 'A reiniciar WhatsApp...');
        const whatsapp = require('./whatsapp');
        whatsapp.restart().catch(() => {});
        break;
      }

      case '/pedidos': {
        const Pedido = require('./models/pedido');
        const hoje = new Date(); hoje.setHours(0,0,0,0);
        const [total, activados, pendentes, receita] = await Promise.all([
          Pedido.countDocuments({ createdAt: { $gte: hoje } }),
          Pedido.countDocuments({ createdAt: { $gte: hoje }, status: 'activado' }),
          Pedido.countDocuments({ status: 'pendente' }),
          Pedido.aggregate([
            { $match: { createdAt: { $gte: hoje }, status: 'activado' } },
            { $group: { _id: null, total: { $sum: '$valorEsperado' } } }
          ])
        ]);
        const totalReceita = receita[0]?.total || 0;
        bot.sendMessage(chatId,
          `Pedidos hoje: ${total}\n` +
          `Activados: ${activados}\n` +
          `Pendentes: ${pendentes}\n` +
          `Receita hoje: ${totalReceita} MT`
        );
        break;
      }

      default:
        bot.sendMessage(chatId, `Comando desconhecido.\n\n${HELP}`);
    }
  });

  bot.on('polling_error', (err) => {
    console.error('Telegram polling error:', err.message);
  });

  console.log('Telegram bot iniciado (@' + (process.env.TELEGRAM_BOT_USERNAME || 'Gigabotmz_bot') + ')');
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

function isActive() { return active; }

module.exports = { init, sendQR, sendMessage, isActive };
