#include <SoftwareSerial.h>
#include <TinyGsmClient.h>
#include <PubSubClient.h>

// Configuração SIM900
#define SIM900_RX 7
#define SIM900_TX 8
#define SIM900_BAUD 9600

// Configuração MQTT
#define MQTT_BROKER "seu-mqtt-broker.com"
#define MQTT_PORT 1883
#define MQTT_USERNAME "mqtt_user"
#define MQTT_PASSWORD "mqtt_password"
#define MQTT_TOPIC_SMS "sms/entrada"

SoftwareSerial sim900(SIM900_RX, SIM900_TX);
TinyGsm modem(sim900);
TinyGsmClient gsmClient(modem);
PubSubClient mqtt(gsmClient);

unsigned long lastSMSCheck = 0;
const unsigned long SMS_CHECK_INTERVAL = 5000; // 5 segundos

void setup() {
  Serial.begin(9600);
  sim900.begin(SIM900_BAUD);
  
  Serial.println("Iniciando SIM900...");
  
  // Inicializar modem
  if (!modem.init()) {
    Serial.println("Falha ao inicializar modem");
    while (true);
  }
  
  Serial.println("Modem inicializado com sucesso");
  
  // Configurar GPRS
  Serial.println("Configurando GPRS...");
  if (!modem.gprsConnect("internet", "", "")) {
    Serial.println("Falha ao conectar GPRS");
    while (true);
  }
  
  Serial.println("GPRS conectado");
  Serial.print("IP: ");
  Serial.println(modem.getLocalIP());
  
  // Configurar MQTT
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

void checkSMS() {
  int smsNum = modem.getSMSQuantity();
  
  if (smsNum > 0) {
    Serial.print("SMS recebidos: ");
    Serial.println(smsNum);
    
    for (int i = 1; i <= smsNum; i++) {
      String smsText = "";
      String sender = "";
      
      if (modem.readSMS(i, smsText, 64, sender, 20)) {
        Serial.println("SMS de " + sender + ": " + smsText);
        
        // Publicar no MQTT
        String payload = "{\"remetente\":\"" + sender + "\",\"mensagem\":\"" + smsText + "\",\"timestamp\":" + String(millis()) + "}";
        mqtt.publish(MQTT_TOPIC_SMS, payload.c_str());
        
        // Deletar SMS após processar
        modem.deleteSMS(i);
        i--; // Ajustar índice após deletar
      }
    }
  }
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
