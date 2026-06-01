/*
 * GigaBot MZ — ESP32-S3 Bridge WiFi <-> SIM900
 *
 * Este ficheiro e para o ESP32-S3.
 * O sim900_mqtt.ino e para o Arduino Uno/Nano — sao ficheiros diferentes!
 *
 * Arduino IDE → Ferramentas → Placa → ESP32 Arduino → ESP32S3 Dev Module
 * Arduino IDE → Ferramentas → USB CDC On Boot → Enabled  (para ver Serial Monitor)
 *
 * Ligacoes ESP32-S3 <-> SIM900:
 *   SIM900 TX → ESP32-S3 GPIO 16 (RX2)
 *   SIM900 RX → ESP32-S3 GPIO 17 (TX2)
 *   GND comum entre ESP32-S3 e SIM900
 *
 * Bibliotecas necessarias (Ferramentas → Gerir Bibliotecas):
 *   - PubSubClient  (Nick O'Leary)
 *   - ArduinoJson   (Benoit Blanchon)
 *
 * Edita a seccao CONFIGURACAO abaixo antes de fazer Upload.
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── CONFIGURACAO ──────────────────────────────────────────────
#define WIFI_SSID     "derk"
#define WIFI_PASSWORD ""  // Deixar vazio para rede aberta (sem senha)


#define MQTT_HOST  "acsqsrelatoriosapi.eurekaplatformapi.xyz"
#define MQTT_PORT  1883

#define SIM900_RX   16
#define SIM900_TX   17
#define SIM900_BAUD 9600

// ── VARIAVEIS ─────────────────────────────────────────────────

WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

HardwareSerial sim900(2); // UART2

String serialBuf     = "";
String ussdRespBuf   = "";
String atRespBuf     = "";
bool   esperandoUssd = false;
bool   esperandoAt   = false;
String ussdRequestId = "";
String atRequestId   = "";

unsigned long ultimoStatus = 0;
unsigned long ultimoPing   = 0;

// ── WIFI ──────────────────────────────────────────────────────

void conectarWifi() {
  Serial.printf("[WiFi] A conectar a %s", WIFI_SSID);
  if (strlen(WIFI_PASSWORD) > 0)
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  else
    WiFi.begin(WIFI_SSID);
  int t = 0;
  while (WiFi.status() != WL_CONNECTED && t < 60) {
    delay(500); Serial.print("."); t++;
    if (t % 20 == 0) Serial.printf("\n[WiFi] Ainda a tentar... (%ds)\n", t/2);
  }
  if (WiFi.isConnected()) {
    Serial.printf("\n[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Falhou. A reiniciar...");
    delay(5000);
    ESP.restart();
  }
}

// ── MQTT ──────────────────────────────────────────────────────

void publicarJson(const char* topic, JsonDocument& doc) {
  char buf[1024];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqttClient.publish(topic, buf, n);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, msg)) return;

  String t = String(topic);

  if (t == "mb/activar") {
    String codigo = doc["codigoUSSD"] | "";
    if (codigo.length()) { Serial.printf("[MQTT] Activar: %s\n", codigo.c_str()); enviarSerial("USSD:" + codigo); }
  }
  else if (t == "ussd/executar") {
    String codigo = doc["codigo"] | "";
    ussdRequestId = doc["requestId"] | "";
    if (codigo.length()) {
      Serial.printf("[MQTT] USSD: %s\n", codigo.c_str());
      ussdRespBuf = ""; esperandoUssd = true;
      enviarSerial("USSD:" + codigo);
    }
  }
  else if (t == "ussd/fechar") {
    Serial.println("[MQTT] Fechar sessao USSD");
    enviarSerial("USSD_CLOSE");
  }
  else if (t == "at/executar") {
    String cmd = doc["comando"] | "";
    atRequestId = doc["requestId"] | "";
    if (cmd.length()) {
      Serial.printf("[MQTT] AT: %s\n", cmd.c_str());
      atRespBuf = ""; esperandoAt = true;
      enviarSerial("AT_CMD:" + cmd);
    }
  }
  else if (t == "sms/enviar") {
    String numero   = doc["numero"]   | "";
    String mensagem = doc["mensagem"] | "";
    String reqId    = doc["requestId"]| "";
    if (numero.length() && mensagem.length()) {
      enviarSmsAt(numero, mensagem, reqId);
    }
  }
  else if (t == "diagnostico/solicitar") {
    executarDiagnostico();
  }
}

void conectarMQTT() {
  String clientId = "esp32s3-" + String((uint32_t)(ESP.getEfuseMac() >> 16), HEX);
  while (!mqttClient.connected()) {
    Serial.print("[MQTT] A conectar...");
    if (mqttClient.connect(clientId.c_str())) {
      Serial.println(" OK");
      mqttClient.subscribe("mb/activar");
      mqttClient.subscribe("ussd/executar");
      mqttClient.subscribe("ussd/fechar");
      mqttClient.subscribe("at/executar");
      mqttClient.subscribe("sms/enviar");
      mqttClient.subscribe("diagnostico/solicitar");
    } else {
      Serial.printf(" rc=%d tentando em 5s...\n", mqttClient.state());
      delay(5000);
    }
  }
}

// ── SERIAL SIM900 ─────────────────────────────────────────────

void enviarSerial(String cmd) {
  sim900.println(cmd);
}

void processarLinha(String linha) {
  linha.trim();
  if (!linha.length()) return;
  Serial.printf("[S900] %s\n", linha.c_str());

  if (linha.startsWith("SMS|")) {
    int p1 = linha.indexOf('|') + 1;
    int p2 = linha.indexOf('|', p1);
    if (p1 > 0 && p2 > p1) {
      StaticJsonDocument<512> doc;
      doc["remetente"] = linha.substring(p1, p2);
      doc["mensagem"]  = linha.substring(p2 + 1);
      doc["timestamp"] = (unsigned long)millis();
      publicarJson("sms/entrada", doc);
    }
  }
  else if (linha.startsWith("AT_RESP|")) {
    atRespBuf  = linha.substring(8);
    esperandoAt = false;
    if (atRequestId.length()) {
      StaticJsonDocument<256> doc;
      doc["requestId"] = atRequestId;
      doc["resposta"]  = atRespBuf;
      publicarJson("at/resultado", doc);
      atRequestId = "";
    }
  }
  else if (linha.startsWith("USSD_RESP|")) {
    // Formato: USSD_RESP|STATUS|texto (ou USSD_RESP|texto legado)
    String resto = linha.substring(10);
    String statusCode = "0";
    String texto = resto;
    int pipe = resto.indexOf('|');
    if (pipe >= 0 && pipe <= 1) {
      statusCode = resto.substring(0, pipe);
      texto      = resto.substring(pipe + 1);
    }
    texto.replace("\\n", "\n");
    ussdRespBuf  = texto;
    esperandoUssd = false;
    if (ussdRequestId.length()) {
      StaticJsonDocument<512> doc;
      doc["requestId"]   = ussdRequestId;
      doc["resposta"]    = texto;
      doc["sessaoActiva"]= (statusCode == "1");
      publicarJson("ussd/resultado", doc);
      ussdRequestId = "";
    }
  }
  else if (linha.startsWith("STATUS|OK")) {
    int idxSig = linha.indexOf("signal=");
    int idxRam = linha.indexOf("ram=");
    int idxRamT= linha.indexOf("ramtotal=");
    int sinal  = idxSig  >= 0 ? linha.substring(idxSig  + 7).toInt() : 0;
    int ram    = idxRam  >= 0 ? linha.substring(idxRam  + 4).toInt() : 0;
    int ramT   = idxRamT >= 0 ? linha.substring(idxRamT + 9).toInt() : 2048;
    StaticJsonDocument<256> doc;
    doc["connected"]  = true;
    doc["signal"]     = sinal;
    doc["ramLivre"]   = ram;
    doc["ramTotal"]   = ramT;
    doc["ramPct"]     = ramT > 0 ? (int)((float)(ramT - ram) / ramT * 100) : 0;
    // Dados do proprio ESP32
    doc["espHeapLivre"] = (int)ESP.getFreeHeap();
    doc["espHeapTotal"] = (int)ESP.getHeapSize();
    doc["espWifiRSSI"]  = WiFi.RSSI();
    doc["espWifiSSID"]  = WiFi.SSID();
    doc["espUptime"]    = (unsigned long)(millis() / 1000);
    publicarJson("status/arduino", doc);
  }
  else if (linha.startsWith("USSD_CLOSED|")) {
    Serial.println("[USSD] Sessao fechada");
  }
}

// ── ENVIO SMS (AT+CMGS multi-step) ───────────────────────────

void enviarSmsAt(String numero, String mensagem, String reqId) {
  // Modo texto
  sim900.println("AT+CMGF=1");
  delay(500);
  while (sim900.available()) sim900.read();

  // Iniciar envio
  sim900.printf("AT+CMGS=\"%s\"\r\n", numero.c_str());

  // Aguardar prompt '>'
  String resp = "";
  unsigned long t = millis();
  while (millis() - t < 5000) {
    if (sim900.available()) resp += (char)sim900.read();
    if (resp.indexOf('>') >= 0) break;
    delay(50);
  }

  if (resp.indexOf('>') < 0) {
    if (reqId.length()) {
      StaticJsonDocument<128> doc;
      doc["requestId"] = reqId;
      doc["sucesso"]   = false;
      doc["erro"]      = "Sem prompt >";
      publicarJson("sms/resultado", doc);
    }
    return;
  }

  // Enviar mensagem + Ctrl+Z
  sim900.print(mensagem);
  sim900.write(0x1A);

  // Aguardar confirmacao
  String resp2 = "";
  unsigned long t2 = millis();
  while (millis() - t2 < 30000) {
    if (sim900.available()) resp2 += (char)sim900.read();
    if (resp2.indexOf("+CMGS:") >= 0 || resp2.indexOf("ERROR") >= 0) break;
    delay(100);
  }

  bool ok = resp2.indexOf("+CMGS:") >= 0;
  Serial.printf("[SMS] Envio para %s: %s\n", numero.c_str(), ok ? "OK" : "ERRO");

  if (reqId.length()) {
    StaticJsonDocument<256> doc;
    doc["requestId"] = reqId;
    doc["sucesso"]   = ok;
    doc["resposta"]  = resp2;
    publicarJson("sms/resultado", doc);
  }
}

// ── DIAGNOSTICO ───────────────────────────────────────────────

String cmdAtSync(String cmd, int espera = 4000) {
  atRespBuf = ""; esperandoAt = true; atRequestId = "";
  enviarSerial("AT_CMD:" + cmd);
  unsigned long t = millis();
  while (millis() - t < (unsigned long)espera) {
    while (sim900.available()) {
      char c = sim900.read();
      if (c == '\n') { processarLinha(serialBuf); serialBuf = ""; }
      else if (c != '\r') serialBuf += c;
    }
    if (!esperandoAt) break;
    delay(50);
  }
  return atRespBuf;
}

void executarDiagnostico() {
  Serial.println("[Diagnose] A executar...");
  StaticJsonDocument<512> doc;

  String ping = cmdAtSync("AT");
  doc["ping"] = ping.indexOf("OK") >= 0 ? "OK" : "FALHOU";

  String cpin = cmdAtSync("AT+CPIN?");
  doc["sim"]  = cpin.indexOf("READY") >= 0 ? "OK" : "NAO_INSERIDO";

  String csq  = cmdAtSync("AT+CSQ");
  int idx = csq.indexOf("+CSQ:");
  int sinal = idx >= 0 ? csq.substring(idx + 5).toInt() : 0;
  doc["signal"] = sinal;

  String creg = cmdAtSync("AT+CREG?");
  String rede = "DESCONHECIDO";
  if (creg.indexOf(",1") >= 0 || creg.indexOf(",5") >= 0) rede = "REGISTADO";
  else if (creg.indexOf(",2") >= 0) rede = "A_PROCURAR";
  doc["rede"] = rede;

  String cops = cmdAtSync("AT+COPS?", 6000);
  String op = "Desconhecida";
  int q1 = cops.indexOf('"');
  if (q1 >= 0) { int q2 = cops.indexOf('"', q1 + 1); if (q2 > q1) op = cops.substring(q1 + 1, q2); }
  doc["operadora"] = op;

  publicarJson("diagnostico/arduino", doc);
  Serial.printf("[Diagnose] Ping:%s SIM:%s Sinal:%d/31 Rede:%s Op:%s\n",
    doc["ping"].as<const char*>(), doc["sim"].as<const char*>(),
    sinal, rede.c_str(), op.c_str());
}

// ── SETUP + LOOP ──────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n[ESP32-S3] GigaBot MZ a iniciar...");

  sim900.begin(SIM900_BAUD, SERIAL_8N1, SIM900_RX, SIM900_TX);
  delay(500);

  conectarWifi();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);
  mqttClient.setKeepAlive(120);
  mqttClient.setSocketTimeout(30);
  conectarMQTT();

  Serial.println("[ESP32-S3] Pronto!");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) conectarWifi();
  if (!mqttClient.connected())       conectarMQTT();
  mqttClient.loop();

  // Ler Serial do SIM900
  while (sim900.available()) {
    char c = sim900.read();
    if (c == '\n') { processarLinha(serialBuf); serialBuf = ""; }
    else if (c != '\r') serialBuf += c;
  }

  // Status a cada 30s para evitar timeout no dashboard
  if (millis() - ultimoStatus > 30000) {
    enviarSerial("STATUS");
    ultimoStatus = millis();
  }

  // Diagnostico periodico
  if (millis() - ultimoPing > 600000) {
    executarDiagnostico();
    ultimoPing = millis();
  }
}
