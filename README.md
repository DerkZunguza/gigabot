# 🤖 Bot MB Venda - Sistema de Venda Automática de Pacotes MB

Sistema completo de venda automática de pacotes de internet móvel (MB) via WhatsApp para Moçambique, com integração M-Pesa (Vodacom) e e-Mola (Movitel).

## 📁 Estrutura do Projeto

```
bot_megabytes/
├── bot/                      # Node.js - Bot WhatsApp
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js
│       ├── whatsapp.js
│       ├── menu.js
│       ├── mqtt.js
│       └── models/
│           ├── pedido.js
│           ├── cliente.js
│           └── pacote.js
├── worker/                   # Python Flask - Automações
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app.py
│   ├── mqtt_handler.py
│   └── ussd_handler.py
├── arduino/                  # Arduino + SIM900
│   └── sim900_mqtt.ino
├── mosquitto/                # MQTT Broker
│   ├── mosquitto.conf
│   ├── acl
│   └── passwords
├── frontend/                 # Interface Web
│   ├── Dockerfile
│   └── src/
│       ├── index.html
│       ├── style.css
│       └── script.js
├── docker-compose.yml        # Produção (Portainer + Traefik)
├── docker-compose.dev.yml    # Desenvolvimento local
├── .env.example
└── README.md
```

## 🏗️ Arquitetura

```
Arduino + SIM900 → MQTT → Worker Python → USSD → Activar Pacote
                        ↓
                    Bot Node.js ← MongoDB
                        ↓
                    WhatsApp (Baileys)
                        ↓
                    Cliente
```

## 📋 Funcionalidades

### Bot WhatsApp
- ✅ Menu interativo de pacotes
- ✅ Detecção automática de operadora (Vodacom/Movitel)
- ✅ Sistema de pagamento via M-Pesa e e-Mola
- ✅ Verificação automática de SMS de confirmação
- ✅ Activação automática de pacotes via USSD
- ✅ Estado por cliente (menu, aguardando pagamento, etc.)
- ✅ Timeout de 15 minutos para pagamento
- ✅ Histórico de transacções

### Interface Web
- ✅ Visualização de QR Code para conexão
- ✅ Status da conexão em tempo real
- ✅ Envio manual de mensagens
- ✅ Gerenciamento de contatos
- ✅ Visualização de histórico

### Integrações
- ✅ MQTT para comunicação com Arduino
- ✅ MongoDB para persistência de dados
- ✅ SIM900 para recepção de SMS e envio USSD

## 🚀 Como Usar

### Pré-requisitos
- Docker e Docker Compose
- Arduino Uno + SIM900 GPRS Shield
- Portainer + Traefik (para produção)

### Desenvolvimento Local

```bash
# 1. Clone o repositório
git clone <repo-url>
cd bot_megabytes

# 2. Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com suas configurações

# 3. Suba os containers
docker compose -f docker-compose.dev.yml up -d --build

# 4. Acesse a interface
http://localhost

# 5. Escaneie o QR Code no WhatsApp para conectar
```

### Produção (Portainer + Traefik)

```bash
# 1. Crie a network do Traefik (uma vez só)
docker network create traefik-public

# 2. Configure o domínio no docker-compose.yml
# Altere "seudominio.duckdns.org" para seu domínio real

# 3. No Portainer:
# - Stacks > Add Stack
# - Name: mb-bot
# - Build method: Repository
# - Repository URL: <seu-repo>
# - Repository reference: refs/heads/main
# - Compose path: docker-compose.yml
# - Environment variables: (adicionar do .env)
# - Deploy!

# 4. Acesse
https://seudominio.duckdns.org
```

## 🔧 Configuração Arduino

1. Instale as bibliotecas no Arduino IDE:
   - TinyGSM
   - PubSubClient

2. Configure o arquivo `arduino/sim900_mqtt.ino`:
   ```cpp
   #define MQTT_BROKER "seu-mqtt-broker.com"
   #define MQTT_USERNAME "mqtt_user"
   #define MQTT_PASSWORD "mqtt_password"
   ```

3. Faça upload no Arduino Uno

4. Conecte o SIM900:
   - RX → Pin 7
   - TX → Pin 8

## 📝 Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| NODE_ENV | Ambiente | development |
| PORT | Porta do bot | 3000 |
| MONGODB_URI | URI MongoDB | mongodb://mongo:27017/mb_bot |
| MQTT_BROKER | Broker MQTT | mosquitto |
| MQTT_PORT | Porta MQTT | 1883 |
| MQTT_USERNAME | Usuário MQTT | mqtt_user |
| MQTT_PASSWORD | Senha MQTT | mqtt_password_change_this |
| ARDUINO_SERIAL_PORT | Porta Arduino | /dev/ttyUSB0 |
| ARDUINO_BAUD_RATE | Baud rate Arduino | 9600 |
| MONGO_USER | Usuário Mongo Express | admin |
| MONGO_PASSWORD | Senha Mongo Express | admin_change_this |

## � MongoDB - Colecções

### clientes
- `whatsapp` - Número WhatsApp
- `nome` - Nome do cliente
- `estado` - Estado actual (menu, aguardando_pagamento, etc.)
- `pedidoAtual` - ID do pedido actual
- `historico` - Array de transacções

### pacotes
- `nome` - Nome do pacote
- `preco` - Preço em MT
- `codigoUSSD` - Código USSD para activação
- `operadora` - vodacom ou movitel
- `mb` - Quantidade de MB
- `validade` - Validade do pacote

### pedidos
- `cliente` - Dados do cliente
- `pacote` - Dados do pacote
- `valorEsperado` - Valor esperado
- `valorPago` - Valor pago
- `referencia` - Referência do pagamento
- `status` - pendente, pago, activado, erro, expirado
- `metodoPagamento` - m-pesa ou e-mola
- `timestamp` - Data do pedido
- `expiracao` - Data de expiração

## 📡 MQTT - Tópicos

- `sms/entrada` - Arduino publica SMS recebidos
- `mb/activar` - Worker publica ordem de activação
- `mb/confirmacao` - Worker publica resultado da activação

## 🐛 Troubleshooting

### QR Code não aparece
- Verifique se o container bot está rodando: `docker logs mb-bot-dev`
- Reinicie a conexão clicando no botão "Reiniciar Conexão"

### Arduino não conecta
- Verifique a porta serial: `ls /dev/ttyUSB*`
- Confirme o baud rate (9600)
- Verifique as conexões RX/TX

### SMS não são processados
- Verifique logs do MQTT: `docker logs mb-mosquitto-dev`
- Confirme se o Arduino está publicando no tópico correcto
- Verifique formato do SMS (M-Pesa ou e-Mola)

### Pacote não é activado
- Verifique logs do worker: `docker logs mb-worker-dev`
- Confirme se o Arduino está conectado via serial
- Verifique o código USSD do pacote

### MongoDB não conecta
- Verifique se o container mongo está rodando
- Confirme a URI do MongoDB no .env
- Acesse o Mongo Express: http://localhost:8081

## 🔒 Segurança

- Altere todas as senhas padrão no .env
- Use senhas diferentes em dev e produção
- MQTT com autenticação activada
- Variáveis sensíveis não devem ser commitadas
- Configure correctamente o domínio no Traefik

## 📄 Licença

Este projeto é fornecido como está para fins educacionais.

## 🇲🇿 Operadoras Suportadas

- **Vodacom Moçambique** - M-Pesa (prefixos 84, 85)
- **Movitel** - e-Mola (prefixos 86, 87)

## 💡 Notas

- Sistema desenhado especificamente para Moçambique
- Formatos de SMS baseados nos padrões reais M-Pesa e e-Mola
- Pacotes configuráveis via MongoDB
- Timeout de pagamento: 15 minutos
- Requer Arduino conectado ao servidor para funcionamento completo
