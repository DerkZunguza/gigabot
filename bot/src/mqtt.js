const mqtt   = require('mqtt');
const Pedido = require('./models/pedido');
const SMS    = require('./models/sms');
const menu   = require('./menu');
const events = require('./events');

let client = null;
let arduinoStatus = { connected: false, signal: 0, ts: null };

function buildBrokerUrl() {
  const broker = process.env.MQTT_BROKER || 'mosquitto';
  const port = process.env.MQTT_PORT || '1883';
  if (broker.startsWith('mqtt://') || broker.startsWith('mqtts://')) return broker;
  return `mqtt://${broker}:${port}`;
}

function connectMQTT() {
  const brokerUrl = buildBrokerUrl();
  client = mqtt.connect(brokerUrl, {
    reconnectPeriod: 5000
  });

  client.on('connect', () => {
    console.log('✅ Conectado ao broker MQTT');
    
    // Inscrever nos tópicos
    client.subscribe('sms/entrada');
    client.subscribe('mb/confirmacao');
    client.subscribe('status/arduino');
    client.subscribe('ussd/resultado');
    client.subscribe('at/resultado');
    client.subscribe('sms/resultado');
  });

  client.on('message', async (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      switch (topic) {
        case 'sms/entrada':
          await handleIncomingSMS(data);
          break;
        case 'mb/confirmacao':
          await handleActivationConfirmation(data);
          break;
        case 'status/arduino': {
          const anterior = arduinoStatus.connected;
          arduinoStatus = { ...data, ts: Date.now(), ramLivre: data.ramLivre, ramTotal: data.ramTotal, ramPct: data.ramPct };
          if (data.connected !== anterior) {
            events.notif.arduino(data.connected ? 'online' : 'offline', data.signal || 0);
          }
          break;
        }
        case 'sms/resultado': {
          const resolve = ussdPending.get(data.requestId);
          if (resolve) { resolve(data); ussdPending.delete(data.requestId); }
          break;
        }
        case 'at/resultado': {
          const resolve = ussdPending.get(data.requestId);
          if (resolve) { resolve(data.resposta); ussdPending.delete(data.requestId); }
          break;
        }
        case 'ussd/resultado': {
          const resolve = ussdPending.get(data.requestId);
          if (resolve) {
            resolve(data.resposta);
            ussdPending.delete(data.requestId);
          }
          break;
        }
      }
    } catch (error) {
      console.error(`Erro ao processar mensagem MQTT (${topic}):`, error);
    }
  });

  client.on('error', (error) => {
    console.error('Erro MQTT:', error);
  });
}

// Pendentes para USSD manual
const ussdPending = new Map();

function registerUssdRequest(requestId, resolve) {
  ussdPending.set(requestId, resolve);
}

async function handleIncomingSMS(data) {
  console.log('SMS recebido:', data);

  const { remetente, mensagem } = data;

  // Guardar no banco de dados
  try {
    const tipo = SMS.schema.statics.detectarTipo
      ? SMS.detectarTipo(mensagem)
      : (mensagem.toLowerCase().includes('confirmacao') ? 'mpesa' : mensagem.toLowerCase().includes('transferencia') ? 'emola' : 'outro');
    await SMS.create({ remetente, mensagem, tipo });
    events.notif.sms(remetente, mensagem.substring(0, 60));
  } catch (e) { console.error('Erro ao guardar SMS:', e.message); }

  // Verificar se é confirmação M-Pesa
  const mPesaMatch = mensagem.match(/Confirmacao: Recebeu ([\d.]+)MT de (\+\d+)/);
  if (mPesaMatch) {
    const valor = parseFloat(mPesaMatch[1]);
    const telefone = mPesaMatch[2];
    const refMatch = mensagem.match(/Ref: (\d+)/);
    const referencia = refMatch ? refMatch[1] : null;
    
    await verificarPagamento(telefone, valor, referencia, 'm-pesa');
    return;
  }

  // Verificar se é confirmação e-Mola
  const eMolaMatch = mensagem.match(/Transferencia recebida: ([\d.]+) MZN de (\+\d+)/);
  if (eMolaMatch) {
    const valor = parseFloat(eMolaMatch[1]);
    const telefone = eMolaMatch[2];
    
    await verificarPagamento(telefone, valor, null, 'e-mola');
    return;
  }
}

async function verificarPagamento(telefone, valor, referencia, metodo) {
  // +258841234567 → 258841234567@s.whatsapp.net
  const numeroLimpo = telefone.replace('+', '');
  const whatsappJid = numeroLimpo.includes('@') ? numeroLimpo : `${numeroLimpo}@s.whatsapp.net`;
  
  // Buscar pedido pendente para este cliente
  const pedido = await Pedido.findOne({
    'cliente.whatsapp': whatsappJid,
    status: 'pendente',
    metodoPagamento: metodo,
    expiracao: { $gt: new Date() }
  }).sort({ timestamp: -1 });

  if (!pedido) {
    console.log(`⚠️ Nenhum pedido pendente encontrado para ${telefone}`);
    return;
  }

  // Verificar se o valor corresponde
  if (Math.abs(valor - pedido.valorEsperado) < 0.01) {
    console.log(`✅ Pagamento confirmado: ${telefone} - ${valor}MT`);
    
    pedido.valorPago = valor;
    pedido.referencia = referencia;
    pedido.status = 'pago';
    await pedido.save();

    // Notificar o bot para activar o pacote
    await menu.confirmPayment(pedido);
  } else {
    console.log(`⚠️ Valor incorreto: esperado ${pedido.valorEsperado}MT, recebido ${valor}MT`);
  }
}

async function handleActivationConfirmation(data) {
  const { pedidoId, sucesso, mensagem } = data;
  
  await menu.notifyActivation(pedidoId, sucesso);
}

function publish(topic, message) {
  if (client && client.connected) {
    client.publish(topic, JSON.stringify(message));
  } else {
    console.error('Cliente MQTT não conectado');
  }
}

function isConnected() {
  return !!(client && client.connected);
}

function executarAT(comando, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const requestId = `at_${Date.now()}`;
    const timer = setTimeout(() => { ussdPending.delete(requestId); resolve('TIMEOUT'); }, timeoutMs);
    ussdPending.set(requestId, (resp) => { clearTimeout(timer); resolve(resp); });
    publish('at/executar', { comando, requestId });
  });
}

function executarUSSD(codigo, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const requestId = `ussd_${Date.now()}`;
    const timer = setTimeout(() => {
      ussdPending.delete(requestId);
      resolve('TIMEOUT — sem resposta do Arduino');
    }, timeoutMs);

    ussdPending.set(requestId, (resp) => {
      clearTimeout(timer);
      resolve(resp);
    });

    publish('ussd/executar', { codigo, requestId });
  });
}

function getArduinoStatus() {
  return arduinoStatus;
}

module.exports = {
  connectMQTT,
  publish,
  isConnected,
  getArduinoStatus,
  executarUSSD,
  executarAT,
  registerUssdRequest
};
