// Sistema de eventos SSE (Server-Sent Events)
// Permite push de notificacoes em tempo real para o browser

const clientes = new Set();

function enviar(tipo, dados) {
  const evento = JSON.stringify({ tipo, dados, ts: new Date().toISOString() });
  clientes.forEach(res => {
    try { res.write(`data: ${evento}\n\n`); } catch (_) { clientes.delete(res); }
  });
}

function registar(res) {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  res.write(': keepalive\n\n');
  clientes.add(res);
  res.on('close', () => clientes.delete(res));
}

// Tipos de notificacao pre-definidos
const notif = {
  sistema:   (msg, estado) => enviar('sistema',   { msg, estado }),
  whatsapp:  (estado)       => enviar('whatsapp',  { estado }),
  arduino:   (estado, sinal)=> enviar('arduino',   { estado, sinal }),
  mqtt:      (estado)       => enviar('mqtt',      { estado }),
  venda:     (canal, pacote, valor) => enviar('venda', { canal, pacote, valor }),
  pagamento: (numero, valor, metodo) => enviar('pagamento', { numero, valor, metodo }),
  alerta:    (msg)          => enviar('alerta',    { msg }),
  sms:       (remetente, preview) => enviar('sms', { remetente, preview }),
};

module.exports = { registar, enviar, notif };
