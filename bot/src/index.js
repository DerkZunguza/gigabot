require('dotenv').config();
// Polyfill WebCrypto para Node.js 18 (necessario para Baileys pairing code)
if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto;
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const whatsapp = require('./whatsapp');
const mqtt     = require('./mqtt');
const telegram      = require('./telegram');
const telegramSales = require('./telegram-sales');
const logger        = require('./logger');
const monitor       = require('./monitor');
const Cliente = require('./models/cliente');
const Pedido  = require('./models/pedido');
const Pacote  = require('./models/pacote');
const SMS     = require('./models/sms');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'changeme_secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Middleware JWT
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token necessário' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// Login
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Password incorrecta' });
  }
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

// Conectar ao MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/mb_bot').then(() => {
  console.log('✅ Conectado ao MongoDB');
}).catch((error) => {
  console.error('❌ Erro ao conectar ao MongoDB:', error);
});

// ==================== API ROUTES ====================

// Status
app.get('/api/status', (req, res) => {
  res.json(whatsapp.getStatus());
});

// Restart
app.post('/api/restart', async (req, res) => {
  try {
    await whatsapp.restart();
    res.json({ success: true, message: 'Reiniciando conexão...' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// QR Callback
app.post('/api/qr-callback', (req, res) => {
  const { callbackUrl } = req.body;
  if (callbackUrl) {
    whatsapp.setQRCallback((qrCode) => {
      fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrCode })
      }).catch(console.error);
    });
  }
  res.json({ success: true });
});

// ==================== CLIENTES ====================

// Listar todos os clientes
app.get('/api/clientes', async (req, res) => {
  try {
    const clientes = await Cliente.find().select('-historico');
    res.json({ success: true, data: clientes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obter cliente por WhatsApp
app.get('/api/clientes/:whatsapp', async (req, res) => {
  try {
    const cliente = await Cliente.findOne({ whatsapp: req.params.whatsapp });
    if (!cliente) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }
    res.json({ success: true, data: cliente });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Criar novo cliente
app.post('/api/clientes', async (req, res) => {
  try {
    const { whatsapp, nome } = req.body;
    let cliente = await Cliente.findOne({ whatsapp });
    
    if (cliente) {
      return res.status(409).json({ success: false, error: 'Cliente já existe' });
    }

    cliente = new Cliente({ whatsapp, nome, estadoAtual: 'aguardando_boas_vindas' });
    await cliente.save();
    res.json({ success: true, data: cliente });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== PACOTES ====================

// Listar pacotes por categoria
app.get('/api/pacotes/:categoria', async (req, res) => {
  try {
    const { categoria } = req.params;
    const pacotes = await Pacote.find({ tipo: categoria, ativo: true });
    res.json({ success: true, data: pacotes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== PEDIDOS ====================

// Listar pedidos de um cliente
app.get('/api/clientes/:clienteId/pedidos', async (req, res) => {
  try {
    const pedidos = await Pedido.find({ clienteId: req.params.clienteId })
      .sort({ createdAt: -1 });
    res.json({ success: true, data: pedidos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rotas estaticas TEM de vir antes de /:pedidoId para nao serem capturadas pelo parametro dinamico
app.get('/api/pedidos/recentes', async (req, res) => {
  try {
    const pedidos = await Pedido.find().sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, data: pedidos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/pedidos/stats', async (req, res) => {
  try {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const [total, pendentes, hojeCount, clientes] = await Promise.all([
      Pedido.countDocuments(),
      Pedido.countDocuments({ status: 'pendente' }),
      Pedido.countDocuments({ createdAt: { $gte: hoje }, status: { $in: ['activado','pago'] } }),
      Cliente.countDocuments()
    ]);
    res.json({ total, pendentes, hoje: hojeCount, clientes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obter pedido por ID
app.get('/api/pedidos/:pedidoId', async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.pedidoId);
    if (!pedido) {
      return res.status(404).json({ success: false, error: 'Pedido não encontrado' });
    }
    res.json({ success: true, data: pedido });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Criar novo pedido
app.post('/api/pedidos', async (req, res) => {
  try {
    const { clienteId, pacote, metodoPagamento } = req.body;
    
    const pedido = new Pedido({
      clienteId,
      cliente: { whatsapp: req.body.whatsapp, nome: req.body.nome },
      pacote,
      valorEsperado: pacote.preco,
      metodoPagamento,
      status: 'pendente',
      expiracao: new Date(Date.now() + 15 * 60 * 1000)
    });
    
    await pedido.save();
    res.json({ success: true, data: pedido });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atualizar status de pedido
app.patch('/api/pedidos/:pedidoId', async (req, res) => {
  try {
    const { status, referencia, dataPagamento, dataActivacao } = req.body;
    
    const pedido = await Pedido.findByIdAndUpdate(
      req.params.pedidoId,
      { status, referencia, dataPagamento, dataActivacao, updatedAt: new Date() },
      { new: true }
    );
    
    res.json({ success: true, data: pedido });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Conectar WhatsApp com numero de telefone (pairing code)
app.post('/api/pair', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Numero de telefone obrigatorio' });
  try {
    await whatsapp.restart(phone);
    res.json({ success: true, message: 'A gerar codigo de pareamento...' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== HARDWARE STATUS ====================

app.get('/api/hardware', (req, res) => {
  const arduino = mqtt.getArduinoStatus();
  // Status considerado fresco se recebido nos ultimos 3 minutos
  const fresh   = arduino.ts && (Date.now() - arduino.ts) < 3 * 60 * 1000;
  res.json({
    whatsapp:      whatsapp.getStatus().status,
    mqtt:          mqtt.isConnected()         ? 'connected' : 'disconnected',
    arduino:       (fresh && arduino.connected) ? 'connected' : 'disconnected',
    arduinoSignal: arduino.signal || 0,
    telegram:      telegram.isActive()         ? 'connected' : 'disconnected',
    telegramSales: telegramSales.isActive()    ? 'connected' : 'disconnected'
  });
});

// ==================== SMS ====================

app.get('/api/sms', async (req, res) => {
  try {
    const { tipo, limit = 100 } = req.query;
    const filtro = tipo ? { tipo } : {};
    const sms = await SMS.find(filtro).sort({ timestamp: -1 }).limit(Number(limit));
    res.json({ success: true, data: sms });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/sms', async (req, res) => {
  try {
    await SMS.deleteMany({});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== ENVIAR MSG WHATSAPP ====================

app.post('/api/whatsapp/send', async (req, res) => {
  const { numero, mensagem } = req.body;
  if (!numero || !mensagem) return res.status(400).json({ error: 'Numero e mensagem obrigatorios' });
  try {
    const jid = numero.replace(/\D/g, '') + '@s.whatsapp.net';
    await whatsapp.sendMessage(jid, mensagem);
    logger.info(`Mensagem enviada para ${numero}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== AT COMMAND ====================

app.post('/api/at', async (req, res) => {
  const { comando } = req.body;
  if (!comando) return res.status(400).json({ error: 'Comando AT obrigatorio' });
  if (!mqtt.isConnected()) return res.status(503).json({ error: 'MQTT nao conectado' });
  try {
    const resposta = await mqtt.executarAT(comando);
    logger.info(`AT ${comando} => ${resposta}`);
    res.json({ success: true, comando, resposta });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== USSD MANUAL ====================

app.post('/api/ussd', async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ error: 'Codigo USSD obrigatorio' });
  if (!mqtt.isConnected()) return res.status(503).json({ error: 'MQTT nao conectado' });
  if (!mqtt.getArduinoStatus().connected) return res.status(503).json({ error: 'Arduino nao conectado' });
  try {
    logger.info(`USSD manual: ${codigo}`);
    const resposta = await mqtt.executarUSSD(codigo);
    logger.info(`USSD resposta: ${resposta}`);
    res.json({ success: true, codigo, resposta });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== LOGS ====================

app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({ logs: logger.getLogs(limit) });
});

// ==================== CONFIG ====================

app.get('/api/config', (req, res) => {
  res.json({
    numeroMpesa:        process.env.NUMERO_MPESA || '',
    numeroEmola:        process.env.NUMERO_EMOLA || '',
    telegramAdmin:      !!process.env.TELEGRAM_TOKEN,
    telegramSales:      !!process.env.TELEGRAM_SALES_TOKEN,
    telegramChatId:     process.env.TELEGRAM_CHAT_ID ? '****' + process.env.TELEGRAM_CHAT_ID.slice(-3) : '',
    mqttBroker:         process.env.MQTT_BROKER || 'mosquitto',
    nodeEnv:            process.env.NODE_ENV || 'production',
  });
});

// ==================== INICIAR SERVIÇOS ====================

async function start() {
  logger.info('A iniciar servicos...');

  await whatsapp.startWhatsApp();
  logger.success('WhatsApp iniciado');

  mqtt.connectMQTT();
  logger.success('MQTT conectado');

  telegram.init();
  telegramSales.initSales();
  logger.success('Bots Telegram iniciados');

  monitor.start();

  const { limparPedidosExpirados } = require('./menu');
  setInterval(limparPedidosExpirados, 5 * 60 * 1000);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.success(`Servidor a correr na porta ${PORT}`);
  });
}

start();
