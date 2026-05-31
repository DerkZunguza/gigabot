/*
 * GigaBot MZ — ESP32 Bridge WiFi <-> SIM900
 *
 * Substitui o PC + Python bridge completamente.
 * O ESP32 conecta ao WiFi e ao broker MQTT,
 * e comunica com o Arduino/SIM900 via Serial2.
 *
 * Ligacoes:
 *   SIM900 TX → ESP32 GPIO 16 (RX2)
 *   SIM900 RX → ESP32 GPIO 17 (TX2)
 *   GND comum
 *
 * Bibliotecas necessarias (Arduino IDE → Gerir Bibliotecas):
 *   - PubSubClient by Nick O'Leary
 *   - ArduinoJson by Benoit Blanchon
 *
 * Configuracao: edita as defines abaixo
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── CONFIGURACAO ──────────────────────────────────────────────

#define WIFI_SSID     "O_TEU_WIFI"
#define WIFI_PASSWORD "A_TUA_PASSWORD_WIFI"

#define MQTT_HOST     "acsqsrelatoriosapi.eurekaplatformapi.xyz"
#define MQTT_PORT     1883

#define SIM900_RX   16
#define SIM900_TX   17
#define SIM900_BAUD 9600

// ── VARIAVEIS ─────────────────────────────────────────────────

WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);

HardwareSerial sim900(2); // Serial2

String cmdBuffer = "";
String ussdRespBuffer = "";
String atRespBuffer   = "";
bool   esperandoUssd  = false;
bool   esperandoAt    = false;
String ussdRequestId  = "";
String atRequestId    = "";

unsigned long ultimoStatus = 0;
unsigned long ultimoPing   = 0;

// ── WIFI ──────────────────────────────────────────────────────

void conectarWifi() {
  Serial.print("[WiFi] A conectar a ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 30) {
    delay(500);
    Serial.print(".");
    tentativas++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\n[WiFi] Conectado! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Falhou. A reiniciar em 10s...");
    delay(10000);
    ESP.restart();
  }
}

// ── MQTT ──────────────────────────────────────────────────────

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, msg)) return;

  String topicStr = String(topic);

  if (topicStr == "mb/activar") {
    String codigo = doc["codigoUSSD"] | "";
    if (codigo.length() > 0) {
      Serial.print("[MQTT] USSD activacao: ");
      Serial.println(codigo);
      enviarParaArduino("USSD:" + codigo);
    }
  }

  else if (topicStr == "ussd/executar") {
    String codigo = doc["codigo"] | "";
    ussdRequestId = doc["requestId"] | "";
    if (codigo.length() > 0) {
      Serial.print("[MQTT] USSD manual: ");
      Serial.println(codigo);
      ussdRespBuffer   = "";
      esperandoUssd    = true;
      enviarParaArduino("USSD:" + codigo);
    }
  }

  else if (topicStr == "at/executar") {
    String comando = doc["comando"] | "";
    atRequestId    = doc["requestId"] | "";
    if (comando.length() > 0) {
      Serial.print("[MQTT] AT: ");
      Serial.println(comando);
      atRespBuffer  = "";
      esperandoAt   = true;
      enviarParaArduino("AT_CMD:" + comando);
    }
  }

  else if (topicStr == "diagnostico/solicitar") {
    executarDiagnostico();
  }
}

void conectarMQTT() {
  String clientId = "esp32-bridge-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  while (!mqtt.connected()) {
    Serial.print("[MQTT] A conectar...");
    if (mqtt.connect(clientId.c_str())) {
      Serial.println(" OK");
      mqtt.subscribe("mb/activar");
      mqtt.subscribe("ussd/executar");
      mqtt.subscribe("at/executar");
      mqtt.subscribe("diagnostico/solicitar");
    } else {
      Serial.print(" Falhou rc=");
      Serial.print(mqtt.state());
      Serial.println(" tentando em 5s...");
      delay(5000);
    }
  }
}

void publicar(const char* topic, JsonDocument& doc) {
  String payload;
  serializeJson(doc, payload);
  mqtt.publish(topic, payload.c_str());
}

// ── SERIAL DO ARDUINO/SIM900 ──────────────────────────────────

void enviarParaArduino(String cmd) {
  sim900.println(cmd);
}

void processarLinhaArduino(String linha) {
  linha.trim();
  if (linha.length() == 0) return;

  Serial.print("[Arduino] ");
  Serial.println(linha);

  if (linha.startsWith("SMS|")) {
    // SMS|remetente|mensagem
    int p1 = linha.indexOf('|') + 1;
    int p2 = linha.indexOf('|', p1);
    if (p1 > 0 && p2 > p1) {
      String remetente = linha.substring(p1, p2);
      String mensagem  = linha.substring(p2 + 1);
      StaticJsonDocument<512> doc;
      doc["remetente"]  = remetente;
      doc["mensagem"]   = mensagem;
      doc["timestamp"]  = millis();
      publicar("sms/entrada", doc);
      Serial.print("[SMS] De ");
      Serial.println(remetente);
    }
  }

  else if (linha.startsWith("AT_RESP|")) {
    atRespBuffer = linha.substring(8);
    esperandoAt  = false;
    if (atRequestId.length() > 0) {
      StaticJsonDocument<256> doc;
      doc["requestId"] = atRequestId;
      doc["resposta"]  = atRespBuffer;
      publicar("at/resultado", doc);
      atRequestId = "";
    }
  }

  else if (linha.startsWith("USSD_RESP|")) {
    String resp = linha.substring(10);
    resp.replace("\\n", "\n");
    ussdRespBuffer = resp;
    esperandoUssd  = false;
    if (ussdRequestId.length() > 0) {
      StaticJsonDocument<512> doc;
      doc["requestId"] = ussdRequestId;
      doc["resposta"]  = ussdRespBuffer;
      publicar("ussd/resultado", doc);
      ussdRequestId = "";
    }
  }

  else if (linha.startsWith("STATUS|OK")) {
    int sinal = 0;
    int idx = linha.indexOf("signal=");
    if (idx >= 0) sinal = linha.substring(idx + 7).toInt();
    StaticJsonDocument<128> doc;
    doc["connected"] = true;
    doc["signal"]    = sinal;
    publicar("status/arduino", doc);
  }
}

// ── DIAGNOSTICO ───────────────────────────────────────────────

String cmdAtSync(String cmd, int espera = 4000) {
  atRespBuffer = "";
  esperandoAt  = true;
  atRequestId  = "";
  enviarParaArduino("AT_CMD:" + cmd);
  unsigned long t = millis();
  while (millis() - t < (unsigned long)espera) {
    if (sim900.available()) {
      String linha = sim900.readStringUntil('\n');
      processarLinhaArduino(linha);
    }
    if (!esperandoAt) break;
    delay(50);
  }
  return atRespBuffer;
}

void executarDiagnostico() {
  Serial.println("[Diagnose] A executar...");
  StaticJsonDocument<512> doc;
  doc["ts"] = millis();

  String ping  = cmdAtSync("AT");
  doc["ping"]  = (ping.indexOf("OK") >= 0) ? "OK" : "FALHOU";

  String cpin  = cmdAtSync("AT+CPIN?");
  doc["sim"]   = (cpin.indexOf("READY") >= 0) ? "OK" : "NAO_INSERIDO";

  String csq   = cmdAtSync("AT+CSQ");
  int sinal = 0;
  int idx = csq.indexOf("+CSQ:");
  if (idx >= 0) sinal = csq.substring(idx + 5).toInt();
  doc["signal"]  = sinal;

  String creg  = cmdAtSync("AT+CREG?");
  String redeStatus = "DESCONHECIDO";
  if (creg.indexOf(",1") >= 0 || creg.indexOf(",5") >= 0) redeStatus = "REGISTADO";
  else if (creg.indexOf(",2") >= 0) redeStatus = "A_PROCURAR";
  else if (creg.indexOf(",0") >= 0) redeStatus = "NAO_REGISTADO";
  doc["rede"] = redeStatus;

  String cops  = cmdAtSync("AT+COPS?", 6000);
  String op = "Desconhecida";
  int q1 = cops.indexOf('"');
  if (q1 >= 0) { int q2 = cops.indexOf('"', q1 + 1); if (q2 > q1) op = cops.substring(q1 + 1, q2); }
  doc["operadora"] = op;

  publicar("diagnostico/arduino", doc);

  Serial.print("[Diagnose] Ping:");
  Serial.print(doc["ping"].as<String>());
  Serial.print(" SIM:");
  Serial.print(doc["sim"].as<String>());
  Serial.print(" Sinal:");
  Serial.print(sinal);
  Serial.print("/31 Rede:");
  Serial.print(redeStatus);
  Serial.print(" Op:");
  Serial.println(op);
}

// ── SETUP + LOOP ──────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  sim900.begin(SIM900_BAUD, SERIAL_8N1, SIM900_RX, SIM900_TX);
  delay(1000);

  Serial.println("[Bridge] ESP32 GigaBot MZ a iniciar...");

  conectarWifi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(1024);
  conectarMQTT();

  Serial.println("[Bridge] Pronto!");
}

void loop() {
  // Manter ligacoes
  if (WiFi.status() != WL_CONNECTED) conectarWifi();
  if (!mqtt.connected())              conectarMQTT();
  mqtt.loop();

  // Ler Serial do Arduino/SIM900
  if (sim900.available()) {
    char c = sim900.read();
    if (c == '\n') {
      processarLinhaArduino(cmdBuffer);
      cmdBuffer = "";
    } else if (c != '\r') {
      cmdBuffer += c;
    }
  }

  // Status periodico (cada 60s)
  if (millis() - ultimoStatus > 60000) {
    enviarParaArduino("STATUS");
    ultimoStatus = millis();
  }

  // Diagnostico periodico (cada 10 minutos)
  if (millis() - ultimoPing > 600000) {
    executarDiagnostico();
    ultimoPing = millis();
  }
}
