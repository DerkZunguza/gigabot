require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const whatsapp = require('./whatsapp');
const mqtt = require('./mqtt');

const app = express();
app.use(cors());
app.use(express.json());

// Conectar ao MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/mb_bot', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Conectado ao MongoDB');
}).catch((error) => {
  console.error('❌ Erro ao conectar ao MongoDB:', error);
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json(whatsapp.getStatus());
});

app.post('/api/restart', async (req, res) => {
  try {
    await whatsapp.restart();
    res.json({ success: true, message: 'Reiniciando conexão...' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/qr-callback', (req, res) => {
  const { callbackUrl } = req.body;
  if (callbackUrl) {
    whatsapp.setQRCallback((qrCode) => {
      // Enviar QR code para callback
      fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrCode })
      }).catch(console.error);
    });
  }
  res.json({ success: true });
});

// Iniciar serviços
async function start() {
  // Iniciar WhatsApp
  await whatsapp.startWhatsApp();
  
  // Iniciar MQTT
  mqtt.connectMQTT();
  
  // Iniciar servidor Express
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📡 API disponível em http://localhost:${PORT}`);
  });
}

start();
