const mongoose = require('mongoose');

const pacoteSchema = new mongoose.Schema({
  nome: {
    type: String,
    required: true
  },
  tipo: {
    type: String,
    enum: ['diario', 'mensal', 'diamante'],
    required: true
  },
  mb: {
    type: Number,
    required: true
  },
  mbFormatado: String, // "650MB", "5GB", etc
  preco: {
    type: Number,
    required: true
  },
  operadora: {
    type: String,
    enum: ['vodacom', 'movitel'],
    default: 'vodacom'
  },
  codigoUSSD: String,
  validade: String,
  descricao: String,
  ativo: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Pacote', pacoteSchema);
