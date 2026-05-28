const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const logger = pino({ level: 'silent' });
let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';

// Armazenamento em memória (pode ser substituído por banco de dados)
let contacts = [];
let messages = [];
let messageHistory = [];

// Função para iniciar conexão WhatsApp
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger,
    browser: ['Bot Megabytes', 'Chrome', '1.0.0']
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      QRCode.toDataURL(qr, (err, url) => {
        if (!err) {
          qrCode = url;
          connectionStatus = 'qr';
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
    }
  });

  sock.ev.on('creds.update', saveCreds);
  
  // Escutar mensagens recebidas
  sock.ev.on('messages.upsert', async ({ messages: newMessages }) => {
    for (const msg of newMessages) {
      if (msg.message) {
        const messageContent = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const sender = msg.key.remoteJid;
        
        messageHistory.push({
          id: Date.now(),
          from: sender,
          message: messageContent,
          timestamp: new Date().toISOString()
        });
      }
    }
  });
}

// ==================== STATUS ENDPOINTS ====================

app.get('/api/status', (req, res) => {
  res.json({
    status: connectionStatus,
    qrCode: qrCode
  });
});

app.post('/api/restart', async (req, res) => {
  try {
    const authPath = path.join(__dirname, 'auth_info_baileys');
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
    
    connectionStatus = 'disconnected';
    qrCode = null;
    
    await startWhatsApp();
    res.json({ success: true, message: 'Restarting connection...' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== CONTACTS ENDPOINTS (CRUD) ====================

// GET - Listar todos os contatos
app.get('/api/contacts', (req, res) => {
  res.json(contacts);
});

// GET - Buscar contato por ID
app.get('/api/contacts/:id', (req, res) => {
  const contact = contacts.find(c => c.id === parseInt(req.params.id));
  if (!contact) {
    return res.status(404).json({ error: 'Contact not found' });
  }
  res.json(contact);
});

// POST - Criar novo contato
app.post('/api/contacts', (req, res) => {
  const { name, phone } = req.body;
  
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }
  
  const newContact = {
    id: Date.now(),
    name,
    phone,
    createdAt: new Date().toISOString()
  };
  
  contacts.push(newContact);
  res.status(201).json(newContact);
});

// PUT - Atualizar contato
app.put('/api/contacts/:id', (req, res) => {
  const { name, phone } = req.body;
  const index = contacts.findIndex(c => c.id === parseInt(req.params.id));
  
  if (index === -1) {
    return res.status(404).json({ error: 'Contact not found' });
  }
  
  contacts[index] = {
    ...contacts[index],
    name: name || contacts[index].name,
    phone: phone || contacts[index].phone,
    updatedAt: new Date().toISOString()
  };
  
  res.json(contacts[index]);
});

// DELETE - Remover contato
app.delete('/api/contacts/:id', (req, res) => {
  const index = contacts.findIndex(c => c.id === parseInt(req.params.id));
  
  if (index === -1) {
    return res.status(404).json({ error: 'Contact not found' });
  }
  
  contacts.splice(index, 1);
  res.json({ message: 'Contact deleted successfully' });
});

// ==================== MESSAGES ENDPOINTS (CRUD) ====================

// GET - Listar todas as mensagens agendadas
app.get('/api/messages', (req, res) => {
  res.json(messages);
});

// GET - Buscar mensagem por ID
app.get('/api/messages/:id', (req, res) => {
  const message = messages.find(m => m.id === parseInt(req.params.id));
  if (!message) {
    return res.status(404).json({ error: 'Message not found' });
  }
  res.json(message);
});

// POST - Criar nova mensagem agendada
app.post('/api/messages', (req, res) => {
  const { phone, message, scheduledFor } = req.body;
  
  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone and message are required' });
  }
  
  const newMessage = {
    id: Date.now(),
    phone,
    message,
    scheduledFor: scheduledFor || null,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  
  messages.push(newMessage);
  res.status(201).json(newMessage);
});

// PUT - Atualizar mensagem
app.put('/api/messages/:id', (req, res) => {
  const { phone, message, scheduledFor, status } = req.body;
  const index = messages.findIndex(m => m.id === parseInt(req.params.id));
  
  if (index === -1) {
    return res.status(404).json({ error: 'Message not found' });
  }
  
  messages[index] = {
    ...messages[index],
    phone: phone || messages[index].phone,
    message: message || messages[index].message,
    scheduledFor: scheduledFor !== undefined ? scheduledFor : messages[index].scheduledFor,
    status: status || messages[index].status,
    updatedAt: new Date().toISOString()
  };
  
  res.json(messages[index]);
});

// DELETE - Remover mensagem
app.delete('/api/messages/:id', (req, res) => {
  const index = messages.findIndex(m => m.id === parseInt(req.params.id));
  
  if (index === -1) {
    return res.status(404).json({ error: 'Message not found' });
  }
  
  messages.splice(index, 1);
  res.json({ message: 'Message deleted successfully' });
});

// ==================== SEND MESSAGE ENDPOINT ====================

app.post('/api/send-message', async (req, res) => {
  const { phone, message } = req.body;
  
  if (!sock || connectionStatus !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp not connected' });
  }

  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone and message are required' });
  }

  try {
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    
    // Salvar no histórico
    messageHistory.push({
      id: Date.now(),
      to: jid,
      message,
      timestamp: new Date().toISOString(),
      status: 'sent'
    });
    
    res.json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== MESSAGE HISTORY ENDPOINT ====================

// GET - Listar histórico de mensagens
app.get('/api/history', (req, res) => {
  res.json(messageHistory);
});

// DELETE - Limpar histórico
app.delete('/api/history', (req, res) => {
  messageHistory = [];
  res.json({ message: 'History cleared successfully' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}`);
  startWhatsApp();
});
