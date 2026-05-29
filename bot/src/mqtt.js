const mqtt = require('mqtt');
const Pedido = require('./models/pedido');
const menu = require('./menu');

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
        case 'status/arduino':
          arduinoStatus = { ...data, ts: Date.now() };
          break;
      }
    } catch (error) {
      console.error(`Erro ao processar mensagem MQTT (${topic}):`, error);
    }
  });

  client.on('error', (error) => {
    console.error('Erro MQTT:', error);
  });
}

async function handleIncomingSMS(data) {
  console.log('📩 SMS recebido:', data);
  
  const { remetente, mensagem, timestamp } = data;
  
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

function getArduinoStatus() {
  return arduinoStatus;
}

module.exports = {
  connectMQTT,
  publish,
  isConnected,
  getArduinoStatus
};
