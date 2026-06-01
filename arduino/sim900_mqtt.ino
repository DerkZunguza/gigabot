/*
 * GigaBot MZ — Arduino Uno
 *
 * Pinos:
 *   SIM900:  SoftwareSerial RX=7, TX=8
 *   ESP32:   Hardware Serial pinos 0(RX) e 1(TX) — desligar USB ao programar
 *   Buzzer:  Pino 9
 *   LCD I2C: SDA=A4, SCL=A5, VCC=5V, GND
 *
 * Bibliotecas necessarias:
 *   - LiquidCrystal_I2C (Frank de Brabander)
 */

#include <SoftwareSerial.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

SoftwareSerial sim900(7, 8);

// LCD 16x2 I2C — endereco tipico 0x27 ou 0x3F
LiquidCrystal_I2C lcd(0x27, 16, 2);

#define BUZZER_PIN 13

// Retorna bytes livres na SRAM do Arduino Uno (total=2048 bytes)
int freeRam() {
  extern int __heap_start, *__brkval;
  int v;
  return (int)&v - (__brkval == 0 ? (int)&__heap_start : (int)__brkval);
}

String cmdBuffer = "";
unsigned long ultimaVerificacaoSMS = 0;
const unsigned long INTERVALO_SMS  = 10000;

int    contadorSMS  = 0;
int    sinalAtual   = 0;
String ultimoEvento = "A iniciar...";

// ── BUZZER ────────────────────────────────────────────

void beepCurto()  { tone(BUZZER_PIN, 1000, 100); delay(150); }
void beepLongo()  { tone(BUZZER_PIN, 800,  500); delay(600); }
void beepErro()   { tone(BUZZER_PIN, 400, 200); delay(250); tone(BUZZER_PIN, 400, 200); delay(250); }
void beepPagamento() {
  tone(BUZZER_PIN, 1000, 100); delay(150);
  tone(BUZZER_PIN, 1200, 100); delay(150);
  tone(BUZZER_PIN, 1500, 300); delay(400);
}
void beepActivacao() {
  tone(BUZZER_PIN, 800,  100); delay(120);
  tone(BUZZER_PIN, 1000, 100); delay(120);
  tone(BUZZER_PIN, 1200, 100); delay(120);
  tone(BUZZER_PIN, 1500, 400); delay(500);
}

// ── LCD ───────────────────────────────────────────────

void lcdMostrar(String linha1, String linha2 = "") {
  lcd.clear();
  lcd.setCursor(0, 0);
  // Truncar a 16 caracteres
  lcd.print(linha1.substring(0, 16));
  if (linha2.length() > 0) {
    lcd.setCursor(0, 1);
    lcd.print(linha2.substring(0, 16));
  }
}

void lcdStatus() {
  String l1 = "Sig:" + String(sinalAtual) + "/31 SMS:" + String(contadorSMS);
  String l2 = ultimoEvento.substring(0, 16);
  lcdMostrar(l1, l2);
}

// ── SETUP ─────────────────────────────────────────────

void setup() {
  Serial.begin(9600);   // Comunicacao com ESP32 (pinos 0,1)
  sim900.begin(9600);
  pinMode(BUZZER_PIN, OUTPUT);

  lcd.init();
  lcd.backlight();
  lcdMostrar("GigaBot MZ", "A iniciar...");
  delay(2000);

  Serial.println("STATUS|INICIANDO");

  enviarAT("ATE0");
  enviarAT("AT+CMGF=1");
  enviarAT("AT+CNMI=2,2,0,0,0");
  enviarAT("AT+CSCS=\"GSM\"");

  sinalAtual = verificarSinal();
  Serial.println("STATUS|OK|signal=" + String(sinalAtual) + "|ram=" + String(freeRam()) + "|ramtotal=2048");

  lcdMostrar("Sinal:" + String(sinalAtual) + "/31", "Sistema pronto");
  beepCurto();
}

// ── LOOP ──────────────────────────────────────────────

void loop() {
  if (sim900.available()) {
    processarRespostaSIM900(lerLinha());
  }

  if (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      cmdBuffer.trim();
      if (cmdBuffer.length() > 0) processarComando(cmdBuffer);
      cmdBuffer = "";
    } else if (c != '\r') {
      cmdBuffer += c;
    }
  }

  if (millis() - ultimaVerificacaoSMS > INTERVALO_SMS) {
    verificarSMSNovos();
    ultimaVerificacaoSMS = millis();
  }
}

// ── COMANDOS DO ESP32 ─────────────────────────────────

void processarComando(String cmd) {
  if (cmd.startsWith("USSD:")) {
    String codigo = cmd.substring(5);
    codigo.trim();
    lcdMostrar("USSD", codigo.substring(0, 16));
    String resp = executarUSSD(codigo);
    Serial.println("USSD_RESP|" + resp);
    lcdStatus();

  } else if (cmd == "STATUS") {
    sinalAtual = verificarSinal();
    int ram = freeRam();
    // Formato: STATUS|OK|signal=25|ram=512|ramtotal=2048
    Serial.println("STATUS|OK|signal=" + String(sinalAtual) + "|ram=" + String(ram) + "|ramtotal=2048");
    lcdMostrar("Sig:" + String(sinalAtual) + " RAM:" + String(ram), "Bytes livres");
    delay(1500);
    lcdStatus();

  } else if (cmd == "USSD_CLOSE") {
    sim900.println("AT+CUSD=2");
    delay(300);
    while (sim900.available()) sim900.read();
    Serial.println("USSD_CLOSED|OK");

  } else if (cmd == "SMS_CHECK") {
    verificarSMSNovos();

  } else if (cmd.startsWith("AT_CMD:")) {
    String atCmd = cmd.substring(7);
    atCmd.trim();
    lcdMostrar("AT CMD", atCmd.substring(0, 16));
    String resposta = enviarATComResposta(atCmd);
    Serial.println("AT_RESP|" + resposta);
    lcdStatus();

  } else if (cmd == "BUZZER:PAGAMENTO") {
    beepPagamento();

  } else if (cmd == "BUZZER:ACTIVACAO") {
    beepActivacao();

  } else if (cmd == "BUZZER:ERRO") {
    beepErro();

  } else if (cmd.startsWith("LCD:")) {
    // Mostrar mensagem no LCD: LCD:linha1|linha2
    String conteudo = cmd.substring(4);
    int sep = conteudo.indexOf('|');
    if (sep >= 0) lcdMostrar(conteudo.substring(0, sep), conteudo.substring(sep + 1));
    else          lcdMostrar(conteudo);

  } else {
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

  int pos = 0;
  while (true) {
    int hdr = resp.indexOf("+CMGL:", pos);
    if (hdr < 0) break;
    int q1 = resp.indexOf(",\"", hdr) + 2;
    int q2 = resp.indexOf("\"", q1);
    int q3 = resp.indexOf(",\"", q2) + 2;
    int q4 = resp.indexOf("\"", q3);
    String remetente = resp.substring(q3, q4);
    int nl  = resp.indexOf('\n', q4) + 1;
    int nl2 = resp.indexOf('\n', nl);
    if (nl2 < 0) nl2 = resp.length();
    String corpo = resp.substring(nl, nl2);
    corpo.trim();
    if (corpo.length() > 0 && remetente.length() > 0) {
      corpo.replace("|", " ");
      remetente.replace("|", " ");
      contadorSMS++;
      Serial.println("SMS|" + remetente + "|" + corpo);

      // Buzzer e LCD ao receber SMS
      beepCurto();
      ultimoEvento = "SMS:" + remetente.substring(0, 10);
      lcdMostrar("SMS recebido", remetente.substring(0, 16));
      delay(2000);
      lcdStatus();
    }
    pos = nl2;
  }
  sim900.println("AT+CMGDA=\"DEL READ\"");
  delay(300);
  while (sim900.available()) sim900.read();
}

void processarRespostaSIM900(String linha) {
  if (linha.startsWith("+CMT:")) {
    int q1 = linha.indexOf("\"") + 1;
    int q2 = linha.indexOf("\"", q1);
    String remetente = linha.substring(q1, q2);
    delay(100);
    String corpo = "";
    unsigned long t = millis();
    while (millis() - t < 500) {
      while (sim900.available()) corpo += (char)sim900.read();
    }
    corpo.trim();
    corpo.replace("|", " ");
    if (corpo.length() > 0) {
      contadorSMS++;
      Serial.println("SMS|" + remetente + "|" + corpo);
      beepCurto();
      ultimoEvento = "SMS:" + remetente.substring(0, 10);
      lcdMostrar("SMS recebido", remetente.substring(0, 16));
      delay(2000);
      lcdStatus();
    }
  }
}

// ── USSD ──────────────────────────────────────────────

String executarUSSD(String codigo) {
  while (sim900.available()) sim900.read();
  sim900.println("AT+CUSD=1,\"" + codigo + "\",15");

  String resp   = "";
  bool recebido = false;
  unsigned long t = millis();

  while (millis() - t < 20000) {
    while (sim900.available()) resp += (char)sim900.read();
    if (!recebido && resp.indexOf("+CUSD:") >= 0) {
      recebido = true;
      unsigned long t2 = millis();
      while (millis() - t2 < 3000) {
        while (sim900.available()) resp += (char)sim900.read();
      }
      break;
    }
    delay(200);
  }

  if (!recebido) return "SEM_RESPOSTA";

  String statusCode = "0";
  int statusPos = resp.indexOf("+CUSD:");
  if (statusPos >= 0) {
    int ac = statusPos + 6;
    while (ac < resp.length() && resp[ac] == ' ') ac++;
    statusCode = String(resp[ac]);
  }

  int cusdPos = resp.indexOf("+CUSD:");
  int q1 = resp.indexOf("\"", cusdPos) + 1;
  int q2 = resp.lastIndexOf("\",");

  String texto = resp;
  if (q1 > 0 && q2 > q1) {
    texto = resp.substring(q1, q2);
    texto.trim();
    texto.replace("\r", "");
    texto.replace("\n", "\\n");
  }

  if (statusCode != "1") {
    delay(200);
    sim900.println("AT+CUSD=2");
    delay(300);
    while (sim900.available()) sim900.read();
  }

  beepCurto();
  ultimoEvento = "USSD OK";
  lcdMostrar("USSD concluido", "Status:" + statusCode);

  return statusCode + "|" + texto;
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
  int idx = resp.indexOf("+CSQ:");
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
