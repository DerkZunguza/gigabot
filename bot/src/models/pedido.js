const mongoose = require('mongoose');

const pedidoSchema = new mongoose.Schema({
  cliente: {
    whatsapp: String,
    nome: String
  },
  pacote: {
    nome: String,
    preco: Number,
    codigoUSSD: String,
    operadora: String
  },
  valorEsperado: Number,
  valorPago: Number,
  referencia: String,
  status: {
    type: String,
    enum: ['pendente', 'pago', 'activado', 'erro', 'expirado'],
    default: 'pendente'
  },
  metodoPagamento: {
    type: String,
    enum: ['m-pesa', 'e-mola']
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  expiracao: Date
});

module.exports = mongoose.model('Pedido', pedidoSchema);
