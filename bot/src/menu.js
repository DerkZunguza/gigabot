const Cliente = require('./models/cliente');
const Pedido = require('./models/pedido');
const Pacote = require('./models/pacote');
const PACOTES_VODACOM = require('./pacotes-vodacom');

const NUMERO_MPESA = process.env.NUMERO_MPESA || '';
const NUMERO_EMOLA = process.env.NUMERO_EMOLA || '';

// ==================== BOAS-VINDAS ====================

async function showWelcome(sock, jid, cliente) {
  if (cliente.primeiroAcesso) {
    cliente.estadoAtual = 'aguardando_confirmacao_termos';
    await cliente.save();

    const mensagem = `Olá! 👋 Bem-vindo(a) ao nosso serviço de compra automática de pacotes MB.

Antes de continuar, leia os nossos termos básicos:

📋 *Termos e Condições (resumo):*
• Os pacotes são activados automaticamente após confirmação do pagamento
• O pagamento deve ser feito exactamente no valor indicado
• Após o pagamento, a activação demora até 5 minutos
• Não fazemos reembolsos após a activação do pacote
• Em caso de falha técnica, o pacote será activado ou o valor devolvido em 24h
• Apenas aceitamos M-Pesa e e-Mola

📄 Para ler os termos completos acesse: www.vodacom.co.mz/termos

Ao continuar, confirma que leu e aceita os nossos termos.

Digite *SIM* para continuar ou *NÃO* para sair.`;

    await sock.sendMessage(jid, { text: mensagem });
  } else {
    // Cliente já aceitou termos, ir direto para menu
    await showMainMenu(sock, jid, cliente);
  }
}

async function handleWelcomeResponse(sock, jid, message, cliente) {
  const resposta = message.trim().toUpperCase();

  if (resposta === 'SIM') {
    cliente.primeiroAcesso = false;
    cliente.aceitouTermos = true;
    cliente.dataAceite = new Date();
    cliente.estadoAtual = 'menu';
    await cliente.save();

    const msg = `✅ Obrigado por aceitar os termos! Agora vamos começar.\n\n`;
    await sock.sendMessage(jid, { text: msg });

    // Mostrar menu principal
    await showMainMenu(sock, jid, cliente);
  } else if (resposta === 'NÃO') {
    await sock.sendMessage(jid, { text: `Tudo bem! Se mudar de ideia é só falar. Até logo 👋` });
  } else {
    await sock.sendMessage(jid, { text: `Não entendi. Digite *SIM* para continuar ou *NÃO* para sair.` });
  }
}

// ==================== MENU PRINCIPAL ====================

async function showMainMenu(sock, jid, cliente) {
  cliente.estadoAtual = 'menu';
  await cliente.save();

  const primeiroNome = cliente.nome ? cliente.nome.split(' ')[0] : 'Cliente';
  
  const menu = `Olá ${primeiroNome}! 😊 O que deseja hoje?

1️⃣ Pacotes Diários
2️⃣ Pacotes Mensais
3️⃣ Pacotes Diamante (chamadas + SMS + MB)
4️⃣ Meus pedidos anteriores
5️⃣ Suporte

Digite o número da opção desejada.`;

  await sock.sendMessage(jid, { text: menu });
}

async function handleMainMenuInput(sock, jid, message, cliente) {
  const opcao = message.trim();

  switch (opcao) {
    case '1':
      await showPackageCategory(sock, jid, cliente, 'diarios');
      break;
    case '2':
      await showPackageCategory(sock, jid, cliente, 'mensais');
      break;
    case '3':
      await showPackageCategory(sock, jid, cliente, 'diamante');
      break;
    case '4':
      await showPreviousOrders(sock, jid, cliente);
      break;
    case '5':
      await showSupport(sock, jid, cliente);
      break;
    default:
      await sock.sendMessage(jid, { text: `Não entendi. Digite *MENU* para ver as opções ou *AJUDA* para falar com suporte.` });
  }
}

// ==================== CATEGORIAS DE PACOTES ====================

async function showPackageCategory(sock, jid, cliente, categoria) {
  cliente.estadoAtual = 'visualizando_pacotes';
  await cliente.save();

  const pacotes = PACOTES_VODACOM[categoria];
  let titulo = '';
  
  if (categoria === 'diarios') titulo = '📦 *PACOTES DIÁRIOS*';
  else if (categoria === 'mensais') titulo = '📦 *PACOTES MENSAIS*';
  else if (categoria === 'diamante') titulo = '💎 *PACOTES DIAMANTE* (Chamadas + SMS ilimitadas)';

  let mensagem = titulo + '\n\n';
  
  pacotes.forEach((pacote, index) => {
    mensagem += `${index + 1}. ${pacote.mbFormatado} - *${pacote.preco}MT*\n`;
  });

  mensagem += `\n0. Voltar ao menu\n\n💡 Digite o número do pacote desejado:`;

  cliente.categoriaAtual = categoria;
  await cliente.save();

  await sock.sendMessage(jid, { text: mensagem });
}

async function handlePackageSelection(sock, jid, message, cliente) {
  const escolha = message.trim();
  const pacotes = PACOTES_VODACOM[cliente.categoriaAtual] || [];

  if (escolha === '0') {
    await showMainMenu(sock, jid, cliente);
    return;
  }

  const index = parseInt(escolha) - 1;
  if (isNaN(index) || index < 0 || index >= pacotes.length) {
    await sock.sendMessage(jid, { text: `Opção inválida. Digite o número do pacote ou 0 para voltar.` });
    return;
  }

  const pacoteEscolhido = pacotes[index];

  // Criar pedido pendente
  const pedido = new Pedido({
    clienteId: cliente._id,
    cliente: {
      whatsapp: cliente.whatsapp,
      nome: cliente.nome
    },
    pacote: {
      nome: pacoteEscolhido.mbFormatado,
      mb: pacoteEscolhido.mb,
      mbFormatado: pacoteEscolhido.mbFormatado,
      tipo: pacoteEscolhido.tipo,
      preco: pacoteEscolhido.preco
    },
    valorEsperado: pacoteEscolhido.preco,
    status: 'pendente',
    expiracao: new Date(Date.now() + 15 * 60 * 1000) // 15 minutos
  });

  await pedido.save();

  cliente.pedidoAtual = pedido._id;
  cliente.estadoAtual = 'aguardando_pagamento';
  cliente.timeoutPagamento = pedido.expiracao;
  await cliente.save();

  // Perguntar método de pagamento
  const mensagem = `✅ Você escolheu: *${pacoteEscolhido.mbFormatado}* - *${pacoteEscolhido.preco}MT*

Qual é o seu método de pagamento?

1️⃣ M-Pesa
2️⃣ e-Mola

Digite 1 ou 2:`;

  await sock.sendMessage(jid, { text: mensagem });
}

// ==================== PAGAMENTO ====================

async function handlePaymentMethod(sock, jid, message, cliente) {
  const opcao = message.trim();
  let metodoPagamento = '';

  if (opcao === '1') {
    metodoPagamento = 'm-pesa';
  } else if (opcao === '2') {
    metodoPagamento = 'e-mola';
  } else {
    await sock.sendMessage(jid, { text: `Opção inválida. Digite *1* para M-Pesa ou *2* para e-Mola.` });
    return;
  }

  // Atualizar pedido com método de pagamento
  const pedido = await Pedido.findById(cliente.pedidoAtual);
  if (!pedido) {
    await sock.sendMessage(jid, { text: `Erro ao processar pedido. Digite *MENU* para recomeçar.` });
    return;
  }

  pedido.metodoPagamento = metodoPagamento;
  await pedido.save();

  const valor = pedido.valorEsperado;
  const nomeMetodo = metodoPagamento === 'm-pesa' ? 'M-Pesa' : 'e-Mola';
  const numeroPagamento = metodoPagamento === 'm-pesa' ? NUMERO_MPESA : NUMERO_EMOLA;

  const mensagem = `✅ Método de pagamento: *${nomeMetodo}*

💰 Valor a pagar: *${valor}MT*
📱 Envie para o número: *${numeroPagamento}*

⚠️ *IMPORTANTE:*
1. Dirija-se ao seu telemóvel
2. Abra ${nomeMetodo}
3. Envie exactamente *${valor}MT* para *${numeroPagamento}*
4. Copie a referência de pagamento
5. Volte aqui e envie a referência

⏱️ Tem *15 minutos* para efectuar o pagamento.

Envie a referência (ex: 123456789) quando tiver feito o pagamento:`;

  await sock.sendMessage(jid, { text: mensagem });
}

// ==================== VERIFICAÇÃO DE PAGAMENTO ====================

async function handlePaymentReference(sock, jid, message, cliente) {
  const referencia = message.trim();

  const pedido = await Pedido.findById(cliente.pedidoAtual);
  if (!pedido) {
    await sock.sendMessage(jid, { text: `Erro ao processar pedido. Digite *MENU* para recomeçar.` });
    return;
  }

  // Validar se já expirou
  if (new Date() > pedido.expiracao) {
    pedido.status = 'expirado';
    await pedido.save();

    cliente.estadoAtual = 'menu';
    await cliente.save();

    await sock.sendMessage(jid, { text: `⏱️ Tempo esgotado! O pedido foi cancelado.\n\nDigite *MENU* para ver as opções.` });
    return;
  }

  pedido.referencia = referencia;
  pedido.status = 'pago';
  pedido.dataPagamento = new Date();
  await pedido.save();

  // Simular ativação
  setTimeout(async () => {
    const pedidoAtualizado = await Pedido.findById(pedido._id);
    if (pedidoAtualizado) {
      pedidoAtualizado.status = 'activado';
      pedidoAtualizado.dataActivacao = new Date();
      await pedidoAtualizado.save();

      // Notificar cliente
      const notificacao = `✅ *Pacote Activado com Sucesso!*

📦 Pacote: ${pedidoAtualizado.pacote.mbFormatado}
💰 Valor pago: ${pedidoAtualizado.valorEsperado}MT
📅 Data: ${new Date().toLocaleString('pt-PT')}

Pode começar a usar o seu pacote agora!

Digite *MENU* para voltar ao menu principal.`;

      await sock.sendMessage(jid, { text: notificacao });
    }
  }, 3000); // Simular 3 segundos de processamento

  // Resposta imediata
  const confirmacao = `⏳ Recebemos a referência *${referencia}*

Estamos processando o seu pagamento...
Pode demorar até 5 minutos. Aguarde.`;

  await sock.sendMessage(jid, { text: confirmacao });

  cliente.estadoAtual = 'processando';
  await cliente.save();
}

// ==================== HISTÓRICO DE PEDIDOS ====================

async function showPreviousOrders(sock, jid, cliente) {
  const pedidos = await Pedido.find({ clienteId: cliente._id })
    .sort({ createdAt: -1 })
    .limit(10);

  if (pedidos.length === 0) {
    await sock.sendMessage(jid, { text: `📭 Você ainda não tem pedidos registrados.\n\nDigite *MENU* para voltar.` });
    return;
  }

  let mensagem = `📜 *SEUS PEDIDOS ANTERIORES*\n\n`;

  pedidos.forEach((pedido, index) => {
    const data = new Date(pedido.createdAt).toLocaleDateString('pt-PT');
    const status = pedido.status === 'activado' ? '✅' : pedido.status === 'pago' ? '⏳' : '❌';
    mensagem += `${index + 1}. ${status} ${pedido.pacote.mbFormatado} - ${pedido.valorEsperado}MT (${data})\n`;
  });

  mensagem += `\nDigite *MENU* para voltar.`;

  await sock.sendMessage(jid, { text: mensagem });
}

// ==================== SUPORTE ====================

async function showSupport(sock, jid, cliente) {
  const mensagem = `💬 *SUPORTE*

Para falar com suporte, digite *AJUDA* e um agente entrará em contacto em breve.

Perguntas Frequentes:
❓ Quanto tempo demora para activar? Até 5 minutos após pagamento
❓ Como cancelo um pedido? Digite *CANCELAR*
❓ Qual é o horário de suporte? 08:00 - 18:00 (Segunda a Sexta)

Digite *MENU* para voltar ao menu principal.`;

  await sock.sendMessage(jid, { text: mensagem });
}

// ==================== PALAVRAS-CHAVE GLOBAIS ====================

async function handleGlobalKeywords(sock, jid, message, cliente) {
  const cmd = message.trim().toUpperCase();

  if (cmd === 'MENU') {
    await showMainMenu(sock, jid, cliente);
    return true;
  }

  if (cmd === 'AJUDA') {
    await sock.sendMessage(jid, { text: `📞 Conectando com suporte...\n\nUm agente entrará em contacto em breve.` });
    return true;
  }

  if (cmd === 'CANCELAR') {
    const pedido = await Pedido.findById(cliente.pedidoAtual);
    if (pedido && pedido.status === 'pendente') {
      pedido.status = 'cancelado';
      await pedido.save();
      cliente.estadoAtual = 'menu';
      await cliente.save();
      await sock.sendMessage(jid, { text: `✅ Pedido cancelado.\n\nDigite *MENU* para ver as opções.` });
    } else {
      await sock.sendMessage(jid, { text: `Não há pedido ativo para cancelar.` });
    }
    return true;
  }

  return false;
}

// ==================== ROUTER PRINCIPAL ====================

async function handleUserMessage(sock, jid, message, cliente) {
  // Verificar palavras-chave globais primeiro
  const ehGlobal = await handleGlobalKeywords(sock, jid, message, cliente);
  if (ehGlobal) return;

  // Processar baseado no estado
  switch (cliente.estadoAtual) {
    case 'aguardando_boas_vindas':
      await showWelcome(sock, jid, cliente);
      break;

    case 'aguardando_confirmacao_termos':
      await handleWelcomeResponse(sock, jid, message, cliente);
      break;

    case 'menu':
      await handleMainMenuInput(sock, jid, message, cliente);
      break;

    case 'visualizando_pacotes':
      await handlePackageSelection(sock, jid, message, cliente);
      break;

    case 'aguardando_pagamento':
      // Verificar se está escolhendo método ou enviando referência
      if (['1', '2'].includes(message.trim())) {
        await handlePaymentMethod(sock, jid, message, cliente);
      } else {
        await handlePaymentReference(sock, jid, message, cliente);
      }
      break;

    case 'processando':
      await sock.sendMessage(jid, { text: `⏳ Ainda estamos processando seu pagamento. Aguarde...` });
      break;

    default:
      await sock.sendMessage(jid, { text: `Não entendi. Digite *MENU* para ver as opções ou *AJUDA* para falar com suporte.` });
  }
}

async function confirmPayment(pedido) {
  const cliente = await Cliente.findOne({ whatsapp: pedido.cliente.whatsapp });
  const whatsapp = require('./whatsapp');
  
  try {
    cliente.estadoAtual = 'processando';
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

    cliente.estadoAtual = 'menu';
    cliente.pedidoAtual = null;
    
    // Adicionar ao histórico
    cliente.historico.push({
      pacote: pedido.pacote.nome,
      valor: pedido.valorEsperado,
      data: new Date(),
      status: 'activado',
      metodoPagamento: pedido.metodoPagamento
    });
    
    await cliente.save();

    await whatsapp.sendMessage(pedido.cliente.whatsapp,
      `🎉 *PACOTE ACTIVADO COM SUCESSO!*\n\n` +
      `📦 Pacote: ${pedido.pacote.mbFormatado}\n` +
      `💰 Valor pago: ${pedido.valorEsperado}MT\n\n` +
      `✅ Obrigado pela preferência!`);
  } else {
    pedido.status = 'erro';
    await pedido.save();

    cliente.estadoAtual = 'menu';
    cliente.pedidoAtual = null;
    await cliente.save();

    await whatsapp.sendMessage(pedido.cliente.whatsapp,
      `❌ *Erro ao activar o pacote*\n\n` +
      `Ocorreu um erro durante a activação.\n` +
      `Por favor, contacte o suporte.\n\n` +
      `Seu pagamento foi confirmado, entraremos em contacto.`);
  }
}

async function limparPedidosExpirados() {
  const result = await Pedido.updateMany(
    { status: 'pendente', expiracao: { $lt: new Date() } },
    { status: 'expirado' }
  );
  if (result.modifiedCount > 0) {
    console.log(`🧹 ${result.modifiedCount} pedido(s) expirado(s) limpo(s)`);
  }
}

module.exports = {
  handleUserMessage,
  showWelcome,
  showMainMenu,
  showPreviousOrders,
  showSupport,
  confirmPayment,
  notifyActivation,
  limparPedidosExpirados
};
