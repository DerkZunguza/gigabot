const Cliente = require('./models/cliente');
const Pedido = require('./models/pedido');
const Pacote = require('./models/pacote');
const mqttClient = require('./mqtt');

const PACOTES_VODACOM = [
  { nome: '50MB', preco: 10, codigoUSSD: '*123*1*1#', mb: '50MB', validade: '1 dia' },
  { nome: '100MB', preco: 20, codigoUSSD: '*123*1*2#', mb: '100MB', validade: '1 dia' },
  { nome: '200MB', preco: 35, codigoUSSD: '*123*1*3#', mb: '200MB', validade: '1 dia' },
  { nome: '500MB', preco: 50, codigoUSSD: '*123*1*4#', mb: '500MB', validade: '7 dias' },
  { nome: '1GB', preco: 100, codigoUSSD: '*123*1*5#', mb: '1GB', validade: '7 dias' },
  { nome: '2GB', preco: 200, codigoUSSD: '*123*1*6#', mb: '2GB', validade: '30 dias' }
];

const PACOTES_MOVITEL = [
  { nome: '50MB', preco: 10, codigoUSSD: '*100*1*1#', mb: '50MB', validade: '1 dia' },
  { nome: '100MB', preco: 20, codigoUSSD: '*100*1*2#', mb: '100MB', validade: '1 dia' },
  { nome: '200MB', preco: 35, codigoUSSD: '*100*1*3#', mb: '200MB', validade: '1 dia' },
  { nome: '500MB', preco: 50, codigoUSSD: '*100*1*4#', mb: '500MB', validade: '7 dias' },
  { nome: '1GB', preco: 100, codigoUSSD: '*100*1*5#', mb: '1GB', validade: '7 dias' },
  { nome: '2GB', preco: 200, codigoUSSD: '*100*1*6#', mb: '2GB', validade: '30 dias' }
};

async function showMainMenu(sock, jid, cliente) {
  cliente.estado = 'menu';
  await cliente.save();

  const prefixo = jid.split('@')[0].substring(0, 3);
  const operadora = prefixo.startsWith('84') || prefixo.startsWith('85') ? 'vodacom' : 'movitel';
  const pacotes = operadora === 'vodacom' ? PACOTES_VODACOM : PACOTES_MOVITEL;
  const nomeOperadora = operadora === 'vodacom' ? 'Vodacom (M-Pesa)' : 'Movitel (e-Mola)';

  let menu = `🤖 *BOT DE VENDA DE MB*\n\n`;
  menu += `📱 Operadora detectada: ${nomeOperadora}\n\n`;
  menu += `📦 *PACOTES DISPONÍVEIS:*\n\n`;
  
  pacotes.forEach((pacote, index) => {
    menu += `${index + 1}. ${pacote.nome} - ${pacote.preco}MT (${pacote.validade})\n`;
  });
  
  menu += `\n0. Sair\n\n`;
  menu += `💡 Digite o número do pacote desejado:`;

  await sock.sendMessage(jid, { text: menu });
}

async function handleMenuInput(sock, jid, message, cliente) {
  const opcao = message.trim();
  
  if (opcao === '0') {
    await sock.sendMessage(jid, { text: '👋 Obrigado por usar nosso serviço!' });
    cliente.estado = 'menu';
    await cliente.save();
    return;
  }

  const prefixo = jid.split('@')[0].substring(0, 3);
  const operadora = prefixo.startsWith('84') || prefixo.startsWith('85') ? 'vodacom' : 'movitel';
  const pacotes = operadora === 'vodacom' ? PACOTES_VODACOM : PACOTES_MOVITEL;
  
  const index = parseInt(opcao) - 1;
  
  if (index >= 0 && index < pacotes.length) {
    const pacote = pacotes[index];
    
    // Criar pedido
    const pedido = new Pedido({
      cliente: {
        whatsapp: jid,
        nome: cliente.nome
      },
      pacote: pacote,
      valorEsperado: pacote.preco,
      status: 'pendente',
      metodoPagamento: operadora === 'vodacom' ? 'm-pesa' : 'e-mola',
      expiracao: new Date(Date.now() + 15 * 60 * 1000) // 15 minutos
    });
    
    await pedido.save();
    
    cliente.estado = 'aguardando_pagamento';
    cliente.pedidoAtual = pedido._id;
    await cliente.save();

    const numeroPagamento = operadora === 'vodacom' ? '841234567' : '861234567';
    const nomePagamento = operadora === 'vodacom' ? 'M-Pesa' : 'e-Mola';

    let resposta = `✅ *PACOTE SELECIONADO: ${pacote.nome}*\n\n`;
    resposta += `💰 *Valor a pagar: ${pacote.preco}MT*\n\n`;
    resposta += `📱 *Faça a transferência ${nomePagamento}:*\n`;
    resposta += `Número: ${numeroPagamento}\n`;
    resposta += `Valor exacto: ${pacote.preco}MT\n\n`;
    resposta += `⏱️ Você tem 15 minutos para efectuar o pagamento\n`;
    resposta += `📲 Após pagar, aguarde a confirmação automática\n\n`;
    resposta += `Digite "cancelar" para cancelar este pedido.`;

    await sock.sendMessage(jid, { text: resposta });
  } else {
    await sock.sendMessage(jid, { text: '❌ Opção inválida. Por favor, escolha um número da lista.' });
    await showMainMenu(sock, jid, cliente);
  }
}

async function handlePaymentWaiting(sock, jid, message, cliente) {
  if (message.toLowerCase() === 'cancelar') {
    await Pedido.findByIdAndUpdate(cliente.pedidoAtual, { status: 'expirado' });
    cliente.estado = 'menu';
    cliente.pedidoAtual = null;
    await cliente.save();
    await showMainMenu(sock, jid, cliente);
    return;
  }

  await sock.sendMessage(jid, { 
    text: '⏳ Aguardando confirmação do pagamento...\n\nO sistema irá verificar automaticamente e activar o seu pacote.\n\nPor favor, aguarde.' 
  });
}

async function handleConfirmation(sock, jid, message, cliente) {
  // Este estado é usado quando o pagamento foi confirmado mas ainda está activando
  await sock.sendMessage(jid, { 
    text: '⏳ A activar o seu pacote...\nPor favor, aguarde mais alguns segundos.' 
  });
}

async function confirmPayment(pedido) {
  const cliente = await Cliente.findOne({ whatsapp: pedido.cliente.whatsapp });
  const whatsapp = require('./whatsapp');
  
  try {
    // Publicar ordem de activação no MQTT
    mqttClient.publish('mb/activar', JSON.stringify({
      pedidoId: pedido._id,
      telefone: pedido.cliente.whatsapp.split('@')[0],
      codigoUSSD: pedido.pacote.codigoUSSD,
      operadora: pedido.pacote.operadora
    }));

    cliente.estado = 'aguardando_confirmacao';
    await cliente.save();

    await whatsapp.sendMessage(pedido.cliente.whatsapp, 
      '✅ *Pagamento confirmado!*\n\nA activar o seu pacote...\nPor favor, aguarde.');
  } catch (error) {
    console.error('Erro ao confirmar pagamento:', error);
  }
}

async function notifyActivation(pedidoId, sucesso) {
  const pedido = await Pedido.findById(pedidoId);
  if (!pedido) return;

  const cliente = await Cliente.findOne({ whatsapp: pedido.cliente.whatsapp });
  const whatsapp = require('./whatsapp');

  if (sucesso) {
    pedido.status = 'activado';
    await pedido.save();

    cliente.estado = 'menu';
    cliente.pedidoAtual = null;
    
    // Adicionar ao histórico
    cliente.historico.push({
      pacote: pedido.pacote.nome,
      valor: pedido.valorEsperado,
      data: new Date(),
      status: 'activado'
    });
    
    await cliente.save();

    await whatsapp.sendMessage(pedido.cliente.whatsapp,
      `🎉 *PACOTE ACTIVADO COM SUCESSO!*\n\n` +
      `📦 Pacote: ${pedido.pacote.nome}\n` +
      `💰 Valor pago: ${pedido.valorPago}MT\n` +
      `⏰ Validade: ${pedido.pacote.validade}\n\n` +
      `✅ Obrigado pela preferência!`);
  } else {
    pedido.status = 'erro';
    await pedido.save();

    cliente.estado = 'menu';
    cliente.pedidoAtual = null;
    await cliente.save();

    await whatsapp.sendMessage(pedido.cliente.whatsapp,
      `❌ *Erro ao activar o pacote*\n\n` +
      `Ocorreu um erro durante a activação.\n` +
      `Por favor, contacte o suporte.\n\n` +
      `Seu pagamento foi confirmado, entraremos em contacto.`);
  }
}

module.exports = {
  showMainMenu,
  handleMenuInput,
  handlePaymentWaiting,
  handleConfirmation,
  confirmPayment,
  notifyActivation
};
