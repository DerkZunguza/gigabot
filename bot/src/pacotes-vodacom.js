// Catálogo de Pacotes Vodacom Moçambique

const PACOTES_VODACOM = {
  diarios: [
    { mb: 650, mbFormatado: '650MB', preco: 18, tipo: 'diario' },
    { mb: 1024, mbFormatado: '1024MB', preco: 28, tipo: 'diario' },
    { mb: 1462, mbFormatado: '1462MB', preco: 40, tipo: 'diario' },
    { mb: 1828, mbFormatado: '1828MB', preco: 50, tipo: 'diario' },
    { mb: 2048, mbFormatado: '2048MB', preco: 56, tipo: 'diario' },
    { mb: 3072, mbFormatado: '3072MB', preco: 84, tipo: 'diario' },
    { mb: 3657, mbFormatado: '3657MB', preco: 100, tipo: 'diario' },
    { mb: 4096, mbFormatado: '4096MB', preco: 112, tipo: 'diario' },
    { mb: 5120, mbFormatado: '5120MB', preco: 140, tipo: 'diario' },
    { mb: 10240, mbFormatado: '10240MB', preco: 280, tipo: 'diario' }
  ],
  mensais: [
    { mb: 5120, mbFormatado: '5GB', preco: 170, tipo: 'mensal' },
    { mb: 10240, mbFormatado: '10GB', preco: 330, tipo: 'mensal' },
    { mb: 15360, mbFormatado: '15GB', preco: 440, tipo: 'mensal' },
    { mb: 20480, mbFormatado: '20GB', preco: 600, tipo: 'mensal' },
    { mb: 25600, mbFormatado: '25GB', preco: 745, tipo: 'mensal' },
    { mb: 30720, mbFormatado: '30GB', preco: 885, tipo: 'mensal' }
  ],
  diamante: [
    { mb: 10240, mbFormatado: '10GB', preco: 450, tipo: 'diamante', descricao: 'Chamadas + SMS ilimitadas' },
    { mb: 12288, mbFormatado: '12GB', preco: 500, tipo: 'diamante', descricao: 'Chamadas + SMS ilimitadas' },
    { mb: 15360, mbFormatado: '15GB', preco: 600, tipo: 'diamante', descricao: 'Chamadas + SMS ilimitadas' },
    { mb: 21504, mbFormatado: '21GB', preco: 750, tipo: 'diamante', descricao: 'Chamadas + SMS ilimitadas' },
    { mb: 25600, mbFormatado: '25GB', preco: 850, tipo: 'diamante', descricao: 'Chamadas + SMS ilimitadas' }
  ]
};

module.exports = PACOTES_VODACOM;
