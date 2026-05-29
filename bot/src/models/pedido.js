const mongoose = require('mongoose');

const pedidoSchema = new mongoose.Schema({
  clienteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cliente'
  },
  cliente: {
    whatsapp: String,
    nome: String
  },
  pacote: {
    nome: String,
    preco: Number,
    mb: Number,
    mbFormatado: String,
    tipo: String,
    codigoUSSD: String,
    operadora: String
  },
  valorEsperado: Number,
  valorPago: Number,
  referencia: String,
  status: {
    type: String,
    enum: ['pendente', 'pago', 'activado', 'erro', 'expirado', 'cancelado'],
    default: 'pendente'
  },
  metodoPagamento: {
    type: String,
    enum: ['m-pesa', 'e-mola']
  },
  dataPagamento: Date,
  dataActivacao: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiracao: Date
});

// Índice para timeout
pedidoSchema.index({ expiracao: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Pedido', pedidoSchema);
