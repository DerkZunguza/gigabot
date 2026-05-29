require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const whatsapp = require('./whatsapp');
const mqtt = require('./mqtt');
const Cliente = require('./models/cliente');
const Pedido = require('./models/pedido');
const Pacote = require('./models/pacote');

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

// ==================== DASHBOARD ENDPOINTS ====================

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

// ==================== INICIAR SERVIÇOS ====================

async function start() {
  await whatsapp.startWhatsApp();
  mqtt.connectMQTT();

  // Limpar pedidos expirados a cada 5 minutos
  const { limparPedidosExpirados } = require('./menu');
  setInterval(limparPedidosExpirados, 5 * 60 * 1000);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📡 API disponível em http://localhost:${PORT}`);
  });
}

start();
