const mongoose = require('mongoose');

const clienteSchema = new mongoose.Schema({
  whatsapp: {
    type: String,
    required: true,
    unique: true
  },
  nome: String,
  estado: {
    type: String,
    enum: ['menu', 'aguardando_pagamento', 'aguardando_confirmacao'],
    default: 'menu'
  },
  pedidoAtual: mongoose.Schema.Types.ObjectId,
  historico: [{
    pacote: String,
    valor: Number,
    data: Date,
    status: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Cliente', clienteSchema);
