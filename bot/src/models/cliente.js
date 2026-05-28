const mongoose = require('mongoose');

const clienteSchema = new mongoose.Schema({
  whatsapp: {
    type: String,
    required: true,
    unique: true
  },
  nome: String,
  primeiroAcesso: {
    type: Boolean,
    default: true
  },
  aceitouTermos: {
    type: Boolean,
    default: false
  },
  dataAceite: Date,
  estadoAtual: {
    type: String,
    enum: ['aguardando_boas_vindas', 'aguardando_confirmacao_termos', 'menu', 'visualizando_pacotes', 'aguardando_pagamento', 'processando'],
    default: 'aguardando_boas_vindas'
  },
  pedidoAtual: mongoose.Schema.Types.ObjectId,
  categoriaAtual: String,
  timeoutPagamento: Date,
  historico: [{
    pacote: String,
    valor: Number,
    data: Date,
    status: String,
    metodoPagamento: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

clienteSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Cliente', clienteSchema);
