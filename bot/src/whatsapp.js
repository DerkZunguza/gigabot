const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const Cliente = require('./models/cliente');
const Pedido = require('./models/pedido');
const Pacote = require('./models/pacote');
const menu = require('./menu');
const mqttClient = require('./mqtt');

let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';
let qrCallback = null;

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    browser: ['MB Venda Bot', 'Chrome', '1.0.0']
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      QRCode.toDataURL(qr, (err, url) => {
        if (!err) {
          qrCode = url;
          connectionStatus = 'qr';
          if (qrCallback) qrCallback(url);
        }
      });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      connectionStatus = 'disconnected';
      qrCode = null;
      
      if (shouldReconnect) {
        startWhatsApp();
      }
    } else if (connection === 'open') {
      connectionStatus = 'connected';
      qrCode = null;
      console.log('✅ WhatsApp conectado!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Escutar mensagens
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
  const messageContent = msg.message.conversation || 
                          msg.message.extendedTextMessage?.text || '';

  console.log(`📩 Mensagem de ${remoteJid}: ${messageContent}`);

  // Buscar ou criar cliente
  let cliente = await Cliente.findOne({ whatsapp: remoteJid });
  if (!cliente) {
    cliente = new Cliente({
      whatsapp: remoteJid,
      nome: remoteJid.split('@')[0]
    });
    await cliente.save();
  }

  // Processar mensagem baseado no estado
  switch (cliente.estado) {
    case 'menu':
      await menu.handleMenuInput(sock, remoteJid, messageContent, cliente);
      break;
    case 'aguardando_pagamento':
      await menu.handlePaymentWaiting(sock, remoteJid, messageContent, cliente);
      break;
    case 'aguardando_confirmacao':
      await menu.handleConfirmation(sock, remoteJid, messageContent, cliente);
      break;
    default:
      await menu.showMainMenu(sock, remoteJid, cliente);
  }
}

async function sendMessage(jid, text) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp não conectado');
  }
  await sock.sendMessage(jid, { text });
}

async function sendMenu(jid, text) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp não conectado');
  }
  await sock.sendMessage(jid, { text });
}

function getStatus() {
  return {
    status: connectionStatus,
    qrCode: qrCode
  };
}

function setQRCallback(callback) {
  qrCallback = callback;
}

async function restart() {
  const authPath = path.join(__dirname, 'auth_info_baileys');
  if (fs.existsSync(authPath)) {
    fs.rmSync(authPath, { recursive: true, force: true });
  }
  
  connectionStatus = 'disconnected';
  qrCode = null;
  
  await startWhatsApp();
}

module.exports = {
  startWhatsApp,
  sendMessage,
  getStatus,
  setQRCallback,
  restart,
  getConnectionStatus: () => connectionStatus
};
