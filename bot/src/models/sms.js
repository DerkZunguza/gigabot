const mongoose = require('mongoose');

const smsSchema = new mongoose.Schema({
  remetente:  { type: String, required: true },
  mensagem:   { type: String, required: true },
  tipo: {
    type: String,
    enum: ['mpesa', 'emola', 'outro'],
    default: 'outro'
  },
  processado: { type: Boolean, default: false },
  timestamp:  { type: Date, default: Date.now }
});

function detectarTipo(mensagem) {
  const m = (mensagem || '').toLowerCase();
  if (m.includes('confirmacao') && m.includes('mt')) return 'mpesa';
  if (m.includes('transferencia') && m.includes('mzn')) return 'emola';
  return 'outro';
}

smsSchema.statics.detectarTipo = detectarTipo;

module.exports = mongoose.model('SMS', smsSchema);
