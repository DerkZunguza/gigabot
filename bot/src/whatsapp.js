const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const Cliente = require('./models/cliente');
const Pedido = require('./models/pedido');
const { handleUserMessage, showWelcome } = require('./menu');

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

  try {
    // Buscar ou criar cliente
    let cliente = await Cliente.findOne({ whatsapp: remoteJid });
    if (!cliente) {
      cliente = new Cliente({
        whatsapp: remoteJid,
        nome: remoteJid.split('@')[0],
        estadoAtual: 'aguardando_boas_vindas'
      });
      await cliente.save();
      console.log(`✅ Novo cliente registrado: ${remoteJid}`);
    }

    // Processar mensagem com novo handler
    await handleUserMessage(sock, remoteJid, messageContent, cliente);
  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
    await sock.sendMessage(remoteJid, { 
      text: `❌ Erro ao processar sua mensagem. Digite *MENU* para tentar novamente.` 
    });
  }
}

async function sendMessage(jid, text) {
  if (!sock) {
    throw new Error('WhatsApp não está conectado');
  }
  return await sock.sendMessage(jid, { text });
}

function getStatus() {
  return {
    status: connectionStatus,
    qrCode: qrCode,
    socket: sock ? 'ready' : 'not_ready'
  };
}

function setQRCallback(callback) {
  qrCallback = callback;
}

async function restart() {
  if (sock) {
    await sock.logout();
  }
  startWhatsApp();
}

module.exports = {
  startWhatsApp,
  getStatus,
  sendMessage,
  setQRCallback,
  restart
};
