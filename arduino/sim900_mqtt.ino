#define TINY_GSM_MODEM_SIM900
#include <SoftwareSerial.h>
#include <TinyGsmClient.h>
#include <PubSubClient.h>

// Pinos iguais ao teu sketch que funciona: SoftwareSerial(RX, TX)
#define SIM900_RX 8
#define SIM900_TX 7
#define SIM900_BAUD 9600

// Configuração MQTT
#define MQTT_BROKER "acsqsrelatoriosapi.eurekaplatformapi.xyz"
#define MQTT_PORT 1883
#define MQTT_USERNAME "bot"
#define MQTT_PASSWORD "eurekav1gigabot123"
#define MQTT_TOPIC_SMS "sms/entrada"

// APN da Vodacom Moçambique
#define GPRS_APN "internet"

SoftwareSerial sim900(SIM900_RX, SIM900_TX);
TinyGsm modem(sim900);
TinyGsmClient gsmClient(modem);
PubSubClient mqtt(gsmClient); 

unsigned long lastSMSCheck = 0;
const unsigned long SMS_CHECK_INTERVAL = 5000;

void setup() {
  Serial.begin(9600);
  sim900.begin(SIM900_BAUD);
  delay(2000); // esperar modem estabilizar (já está ligado)

  Serial.println("SIM900 pronto. A configurar GPRS...");

  // Modem já está ligado — não precisamos de init()
  // Apenas conectar GPRS
  modem.gprsConnect(GPRS_APN, "", "");

  Serial.print("IP: ");
  Serial.println(modem.getLocalIP());

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);

  connectMQTT();

  Serial.println("Sistema pronto!");
}

void loop() {
  if (!mqtt.connected()) {
    connectMQTT();
  }
  
  mqtt.loop();
  
  // Verificar SMS periodicamente
  if (millis() - lastSMSCheck > SMS_CHECK_INTERVAL) {
    checkSMS();
    lastSMSCheck = millis();
  }
  
  // Processar comandos da serial
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    processCommand(command);
  }
}

void connectMQTT() {
  Serial.print("Conectando ao MQTT...");
  
  while (!mqtt.connected()) {
    if (mqtt.connect("SIM900_Client", MQTT_USERNAME, MQTT_PASSWORD)) {
      Serial.println("conectado!");
      mqtt.subscribe("mb/activar");
    } else {
      Serial.print("Falha, rc=");
      Serial.print(mqtt.state());
      Serial.println(" tentando novamente em 5 segundos...");
      delay(5000);
    }
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Mensagem recebida [");
  Serial.print(topic);
  Serial.print("]: ");
  
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.println(message);
  
  // Processar comando de activação
  if (String(topic) == "mb/activar") {
    processActivation(message);
  }
}

void processActivation(String message) {
  // Extrair dados do JSON
  // Formato esperado: {"pedidoId":"xxx","telefone":"xxx","codigoUSSD":"xxx","operadora":"xxx"}
  
  int pedidoIdStart = message.indexOf("\"pedidoId\":\"") + 12;
  int pedidoIdEnd = message.indexOf("\"", pedidoIdStart);
  String pedidoId = message.substring(pedidoIdStart, pedidoIdEnd);
  
  int telefoneStart = message.indexOf("\"telefone\":\"") + 12;
  int telefoneEnd = message.indexOf("\"", telefoneStart);
  String telefone = message.substring(telefoneStart, telefoneEnd);
  
  int codigoStart = message.indexOf("\"codigoUSSD\":\"") + 14;
  int codigoEnd = message.indexOf("\"", codigoStart);
  String codigoUSSD = message.substring(codigoStart, codigoEnd);
  
  Serial.println("Activando pacote:");
  Serial.println("Pedido ID: " + pedidoId);
  Serial.println("Telefone: " + telefone);
  Serial.println("Código USSD: " + codigoUSSD);
  
  // Enviar comando USSD
  String resultado = sendUSSD(codigoUSSD);
  
  // Publicar confirmação
  String confirmation = "{\"pedidoId\":\"" + pedidoId + "\",\"sucesso\":true,\"mensagem\":\"" + resultado + "\"}";
  mqtt.publish("mb/confirmacao", confirmation.c_str());
  
  Serial.println("Confirmação enviada");
}

// TinyGSM não expõe getSMSQuantity/readSMS/deleteSMS no SIM800.
// Usamos AT commands directamente via SoftwareSerial.

String sendATCmd(String cmd, unsigned long wait = 500) {
  while (sim900.available()) sim900.read();
  sim900.println(cmd);
  String resp = "";
  unsigned long start = millis();
  while (millis() - start < wait) {
    while (sim900.available()) resp += (char)sim900.read();
  }
  return resp;
}

void checkSMS() {
  sendATCmd("AT+CMGF=1", 200);
  String resp = sendATCmd("AT+CMGL=\"REC UNREAD\"", 2000);

  if (resp.indexOf("+CMGL:") < 0) return;

  int pos = 0;
  while (true) {
    int hdr = resp.indexOf("+CMGL:", pos);
    if (hdr < 0) break;

    // Cabeçalho: +CMGL: idx,"REC UNREAD","remetente",,"data"
    // Procurar o 3.º campo entre aspas (remetente)
    int q1 = resp.indexOf(",\"", hdr) + 2;
    int q2 = resp.indexOf("\"", q1);
    int q3 = resp.indexOf(",\"", q2) + 2;
    int q4 = resp.indexOf("\"", q3);
    String sender = resp.substring(q3, q4);

    // Corpo do SMS está na linha seguinte
    int nl  = resp.indexOf('\n', q4) + 1;
    int nl2 = resp.indexOf('\n', nl);
    if (nl2 < 0) nl2 = resp.length();
    String body = resp.substring(nl, nl2);
    body.trim();

    if (body.length() > 0) {
      Serial.println("SMS de " + sender + ": " + body);
      String payload = "{\"remetente\":\"" + sender + "\",\"mensagem\":\"" + body + "\",\"timestamp\":" + String(millis()) + "}";
      mqtt.publish(MQTT_TOPIC_SMS, payload.c_str());
    }

    pos = nl2;
  }

  sendATCmd("AT+CMGDA=\"DEL READ\"", 500);
}

String sendUSSD(String ussdCode) {
  Serial.println("Enviando USSD: " + ussdCode);
  
  String response = modem.sendUSSD(ussdCode);
  
  Serial.println("Resposta USSD: " + response);
  
  // Cancelar USSD session
  modem.sendUSSD("");
  
  return response;
}

void processCommand(String command) {
  Serial.println("Comando recebido: " + command);
  
  if (command.startsWith("USSD:")) {
    // Formato: USSD:telefone:codigo
    int firstColon = command.indexOf(':');
    int secondColon = command.indexOf(':', firstColon + 1);
    
    String telefone = command.substring(firstColon + 1, secondColon);
    String codigo = command.substring(secondColon + 1);
    
    String resultado = sendUSSD(codigo);
    Serial.println("OK:" + resultado);
  }
  else if (command == "SIGNAL") {
    int signal = modem.getSignalQuality();
    Serial.println("OK:Signal=" + String(signal));
  }
  else if (command == "BALANCE") {
    String balance = modem.sendUSSD("*#100#");
    modem.sendUSSD("");
    Serial.println("OK:Balance=" + balance);
  }
  else {
    Serial.println("OK:Comando desconhecido");
  }
}
