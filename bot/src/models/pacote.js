const mongoose = require('mongoose');

const pacoteSchema = new mongoose.Schema({
  nome: {
    type: String,
    required: true
  },
  preco: {
    type: Number,
    required: true
  },
  codigoUSSD: {
    type: String,
    required: true
  },
  operadora: {
    type: String,
    enum: ['vodacom', 'movitel'],
    required: true
  },
  mb: String,
  validade: String,
  ativo: {
    type: Boolean,
    default: true
  }
});

module.exports = mongoose.model('Pacote', pacoteSchema);
