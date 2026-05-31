const logger   = require('./logger');
const telegram = require('./telegram');
const events   = require('./events');

// Estado anterior para detectar mudancas
const prev = {};

const NOMES = {
  whatsapp: 'WhatsApp',
  mqtt:     'Broker MQTT',
  arduino:  'Arduino / SIM900'
};

async function verificar() {
  const whatsapp = require('./whatsapp');
  const mqttMod  = require('./mqtt');
  const fs       = require('fs');

  const atual = {
    whatsapp: whatsapp.getStatus().status,
    mqtt:     mqttMod.isConnected() ? 'ok' : 'fail',
    arduino:  fs.existsSync('/dev/ttyUSB0') ? 'ok' : 'fail'
  };

  for (const [chave, estado] of Object.entries(atual)) {
    const anterior = prev[chave];
    if (anterior === estado) continue;

    const nome    = NOMES[chave] || chave;
    const estaOk  = estado === 'ok' || estado === 'connected';
    const eraOk   = anterior === 'ok' || anterior === 'connected';

    if (!estaOk) {
      const msg = `ALERTA: ${nome} ficou offline (${estado})`;
      logger.warn(msg);
      telegram.sendMessage(`⚠️ ${msg}`);
      if (chave === 'whatsapp') events.notif.whatsapp('offline');
      else if (chave === 'mqtt') events.notif.mqtt('offline');
      else if (chave === 'arduino') events.notif.arduino('offline', 0);
      else events.notif.alerta(msg);
    } else if (!eraOk && anterior !== undefined) {
      const msg = `${nome} voltou online`;
      logger.success(msg);
      telegram.sendMessage(`✅ ${msg}`);
      if (chave === 'whatsapp') events.notif.whatsapp('online');
      else if (chave === 'mqtt') events.notif.mqtt('online');
      else if (chave === 'arduino') events.notif.arduino('online', 0);
    }

    prev[chave] = estado;
  }
}

function start() {
  // Primeira verificacao apos 30s para deixar os servicos estabilizarem
  setTimeout(() => {
    verificar();
    setInterval(verificar, 60 * 1000);
  }, 30000);

  logger.info('Monitor de saude iniciado');
}

module.exports = { start };
