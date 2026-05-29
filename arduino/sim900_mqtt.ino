/*
 * GigaBot MZ — Arduino SIM900
 *
 * Responsabilidades:
 *   - Monitorizar SMS recebidos e enviar ao Worker Python via Serial
 *   - Executar codigos USSD recebidos pelo Serial e devolver a resposta
 *
 * Comunicacao com o Worker Python via Serial (9600 baud):
 *
 *   Arduino → Python (SMS recebido):
 *     SMS|+258841234567|Confirmacao: Recebeu 100MT...
 *
 *   Python → Arduino (executar USSD):
 *     USSD:*123*1*2#
 *   Arduino → Python (resposta USSD):
 *     USSD_RESP|Pacote de 100MB activado com sucesso
 *
 *   Python → Arduino (verificar estado):
 *     STATUS
 *   Arduino → Python:
 *     STATUS|OK|signal=15
 *
 * Pinos: SIM900 TX → Arduino pino 7, SIM900 RX → Arduino pino 8
 */

#include <SoftwareSerial.h>

SoftwareSerial sim900(7, 8); // RX=7, TX=8

String cmdBuffer = "";
unsigned long ultimaVerificacaoSMS = 0;
const unsigned long INTERVALO_SMS   = 10000; // verificar SMS a cada 10s

// ── SETUP ─────────────────────────────────────────────

void setup() {
  Serial.begin(9600);
  sim900.begin(9600);
  delay(3000);

  Serial.println("STATUS|INICIANDO");

  // Configurar SMS em modo texto
  enviarAT("ATE0");          // desligar echo
  enviarAT("AT+CMGF=1");    // modo texto SMS
  enviarAT("AT+CNMI=2,2,0,0,0"); // notificacao imediata de SMS recebido
  enviarAT("AT+CSCS=\"GSM\""); // charset GSM

  Serial.println("STATUS|OK|signal=" + String(verificarSinal()));
}

// ── LOOP ──────────────────────────────────────────────

void loop() {
  // Dados do SIM900 → processar
  if (sim900.available()) {
    processarRespostaSIM900(lerLinha());
  }

  // Comandos do Worker Python → executar
  if (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      cmdBuffer.trim();
      if (cmdBuffer.length() > 0) {
        processarComando(cmdBuffer);
      }
      cmdBuffer = "";
    } else if (c != '\r') {
      cmdBuffer += c;
    }
  }

  // Verificar SMS periodicamente
  if (millis() - ultimaVerificacaoSMS > INTERVALO_SMS) {
    verificarSMSNovos();
    ultimaVerificacaoSMS = millis();
  }
}

// ── COMANDOS DO PYTHON ────────────────────────────────

void processarComando(String cmd) {
  if (cmd.startsWith("USSD:")) {
    String codigo = cmd.substring(5);
    codigo.trim();
    String resp = executarUSSD(codigo);
    Serial.println("USSD_RESP|" + resp);

  } else if (cmd == "STATUS") {
    Serial.println("STATUS|OK|signal=" + String(verificarSinal()));

  } else if (cmd == "SMS_CHECK") {
    verificarSMSNovos();

  } else if (cmd.startsWith("AT_CMD:")) {
    // AT command com resposta devolvida ao Python
    String atCmd = cmd.substring(7);
    atCmd.trim();
    String resposta = enviarATComResposta(atCmd);
    Serial.println("AT_RESP|" + resposta);

  } else {
    // Passagem directa (sem resposta formatada)
    sim900.println(cmd);
  }
}

// ── SMS ───────────────────────────────────────────────

void verificarSMSNovos() {
  sim900.println("AT+CMGL=\"REC UNREAD\"");
  delay(1500);

  String resp = "";
  unsigned long t = millis();
  while (millis() - t < 1500) {
    while (sim900.available()) resp += (char)sim900.read();
  }

  if (resp.indexOf("+CMGL:") < 0) return;

  // Parsear cada SMS na resposta
  int pos = 0;
  while (true) {
    int hdr = resp.indexOf("+CMGL:", pos);
    if (hdr < 0) break;

    // Extrair remetente do cabecalho: +CMGL: idx,"REC UNREAD","remetente",,"data"
    int q1 = resp.indexOf(",\"", hdr) + 2;
    int q2 = resp.indexOf("\"", q1);           // fim status
    int q3 = resp.indexOf(",\"", q2) + 2;
    int q4 = resp.indexOf("\"", q3);           // fim remetente
    String remetente = resp.substring(q3, q4);

    // Corpo na linha seguinte
    int nl  = resp.indexOf('\n', q4) + 1;
    int nl2 = resp.indexOf('\n', nl);
    if (nl2 < 0) nl2 = resp.length();
    String corpo = resp.substring(nl, nl2);
    corpo.trim();

    if (corpo.length() > 0 && remetente.length() > 0) {
      // Sanitizar — remover pipes que possam partir o formato
      corpo.replace("|", " ");
      remetente.replace("|", " ");
      Serial.println("SMS|" + remetente + "|" + corpo);
    }

    pos = nl2;
  }

  // Apagar SMS lidos
  sim900.println("AT+CMGDA=\"DEL READ\"");
  delay(300);
  while (sim900.available()) sim900.read();
}

void processarRespostaSIM900(String linha) {
  // SMS recebido em tempo real (+CMT)
  // Formato: +CMT: "remetente","","data"
  if (linha.startsWith("+CMT:")) {
    int q1 = linha.indexOf("\"") + 1;
    int q2 = linha.indexOf("\"", q1);
    String remetente = linha.substring(q1, q2);

    // Corpo e a proxima linha — ler com pequeno delay
    delay(100);
    String corpo = "";
    unsigned long t = millis();
    while (millis() - t < 500) {
      while (sim900.available()) corpo += (char)sim900.read();
    }
    corpo.trim();
    corpo.replace("|", " ");

    if (corpo.length() > 0) {
      Serial.println("SMS|" + remetente + "|" + corpo);
    }
  }
}

// ── USSD ──────────────────────────────────────────────

String executarUSSD(String codigo) {
  while (sim900.available()) sim900.read();

  sim900.println("AT+CUSD=1,\"" + codigo + "\",15");

  // Aguardar +CUSD: (ate 20 segundos)
  String resp    = "";
  bool recebido  = false;
  unsigned long t = millis();

  while (millis() - t < 20000) {
    while (sim900.available()) resp += (char)sim900.read();

    if (!recebido && resp.indexOf("+CUSD:") >= 0) {
      recebido = true;
      // Aguardar 3 segundos para a resposta multi-linha terminar
      unsigned long t2 = millis();
      while (millis() - t2 < 3000) {
        while (sim900.available()) resp += (char)sim900.read();
      }
      break;
    }
    delay(200);
  }

  if (!recebido) return "SEM_RESPOSTA";

  // Extrair texto: +CUSD: n,"conteudo multi-linha",n
  // Usa lastIndexOf para encontrar o fecho correcto
  int cusdPos = resp.indexOf("+CUSD:");
  if (cusdPos < 0) return resp;

  int q1 = resp.indexOf("\"", cusdPos) + 1;
  int q2 = resp.lastIndexOf("\","); // ultimo ", que fecha o conteudo

  if (q1 > 0 && q2 > q1) {
    String texto = resp.substring(q1, q2);
    texto.trim();
    texto.replace("\r", "");
    return texto;
  }

  return resp;
}

// ── UTILIDADES ────────────────────────────────────────

String enviarAT(String cmd) {
  while (sim900.available()) sim900.read();
  sim900.println(cmd);
  delay(300);
  String resp = "";
  unsigned long t = millis();
  while (millis() - t < 300) {
    while (sim900.available()) resp += (char)sim900.read();
  }
  return resp;
}

String enviarATComResposta(String cmd) {
  while (sim900.available()) sim900.read();
  sim900.println(cmd);
  delay(500);
  String resp = "";
  unsigned long t = millis();
  while (millis() - t < 2000) {
    while (sim900.available()) resp += (char)sim900.read();
    if (resp.indexOf("OK") >= 0 || resp.indexOf("ERROR") >= 0) {
      delay(100);
      while (sim900.available()) resp += (char)sim900.read();
      break;
    }
    delay(50);
  }
  resp.trim();
  resp.replace("\r\n", " | ");
  resp.replace("\r", "");
  resp.replace("\n", " | ");
  if (resp.length() == 0) resp = "SEM_RESPOSTA";
  return resp;
}

int verificarSinal() {
  String resp = enviarAT("AT+CSQ");
  int idx = resp.indexOf("+CSQ: ");
  if (idx < 0) idx = resp.indexOf("+CSQ:");
  if (idx >= 0) {
    int start = idx + 5;
    while (start < resp.length() && resp[start] == ' ') start++;
    int end = resp.indexOf(",", start);
    if (end > start) return resp.substring(start, end).toInt();
  }
  return 0;
}

String lerLinha() {
  String linha = "";
  unsigned long t = millis();
  while (millis() - t < 200) {
    while (sim900.available()) {
      char c = sim900.read();
      if (c == '\n') return linha;
      if (c != '\r') linha += c;
    }
  }
  return linha;
}
