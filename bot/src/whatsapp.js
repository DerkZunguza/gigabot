const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const Cliente = require('./models/cliente');
const { handleUserMessage } = require('./menu');

let sock = null;
let qrCode = null;
let pairingCode = null;
let connectionStatus = 'disconnected';
let qrCallback = null;

const AUTH_PATH = path.join(process.cwd(), 'auth_info_baileys');

async function startWhatsApp(phoneNumber = null) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Gigabot', 'Chrome', '120.0.0']
  });

  // Pairing code (alternativa ao QR)
  if (phoneNumber && !state.creds.registered) {
    try {
      await new Promise(r => setTimeout(r, 2000));
      const code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ''));
      pairingCode = code;
      connectionStatus = 'pairing';
      console.log('Codigo de pareamento:', code);
      const telegram = require('./telegram');
      telegram.sendMessage(`Codigo de pareamento WhatsApp: ${code}\nIntroduze este codigo em: Configuracoes > Aparelhos conectados > Ligar com numero de telefone`);
    } catch (err) {
      console.error('Erro ao gerar codigo de pareamento:', err.message);
    }
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionStatus = 'qr';
      pairingCode = null;
      try {
        qrCode = await QRCode.toDataURL(qr);
        if (qrCallback) qrCallback(qrCode);
        const telegram = require('./telegram');
        telegram.sendQR(qrCode);
        console.log('QR Code gerado');
      } catch (err) {
        console.error('Erro ao gerar QR Code:', err.message);
        qrCode = null;
      }
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error)?.output?.statusCode;
      connectionStatus = 'disconnected';
      qrCode = null;
      pairingCode = null;
      if (reason !== DisconnectReason.loggedOut) {
        setTimeout(() => startWhatsApp(), 5000);
      }
    } else if (connection === 'open') {
      connectionStatus = 'connected';
      qrCode = null;
      pairingCode = null;
      console.log('WhatsApp conectado');
      const telegram = require('./telegram');
      telegram.sendMessage('WhatsApp conectado com sucesso.');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages: newMessages }) => {
    for (const msg of newMessages) {
      if (msg.message && msg.key.remoteJid && !msg.key.fromMe) {
        await handleMessage(msg);
      }
    }
  });
}

async function handleMessage(msg) {
  const remoteJid = msg.key.remoteJid;
  const messageContent = msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text || '';

  console.log(`Mensagem de ${remoteJid}: ${messageContent}`);

  try {
    let cliente = await Cliente.findOne({ whatsapp: remoteJid });
    if (!cliente) {
      cliente = new Cliente({
        whatsapp: remoteJid,
        nome: remoteJid.split('@')[0],
        estadoAtual: 'aguardando_boas_vindas'
      });
      await cliente.save();
    }
    await handleUserMessage(sock, remoteJid, messageContent, cliente);
  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
    try {
      await sock.sendMessage(remoteJid, { text: 'Erro interno. Digite MENU para tentar novamente.' });
    } catch (_) {}
  }
}

async function sendMessage(jid, text) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp nao esta conectado');
  }
  return sock.sendMessage(jid, { text });
}

function getStatus() {
  return {
    status: connectionStatus,
    qrCode,
    pairingCode,
    socket: sock ? 'ready' : 'not_ready'
  };
}

function setQRCallback(cb) { qrCallback = cb; }

async function restart(phoneNumber = null) {
  if (sock) {
    try { await sock.logout(); } catch (_) {}
    sock = null;
  }
  if (fs.existsSync(AUTH_PATH)) {
    fs.rmSync(AUTH_PATH, { recursive: true, force: true });
  }
  connectionStatus = 'disconnected';
  qrCode = null;
  pairingCode = null;
  await startWhatsApp(phoneNumber);
}

module.exports = { startWhatsApp, getStatus, sendMessage, setQRCallback, restart };
