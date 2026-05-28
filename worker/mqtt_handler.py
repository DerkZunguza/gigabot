import paho.mqtt.client as mqtt
import json
import os
from dotenv import load_dotenv

load_dotenv()

class MQTTHandler:
    def __init__(self):
        self.client = None
        self.broker = os.getenv('MQTT_BROKER', 'mosquitto')
        self.port = int(os.getenv('MQTT_PORT', 1883))
        self.username = os.getenv('MQTT_USERNAME', 'mqtt_user')
        self.password = os.getenv('MQTT_PASSWORD', 'mqtt_password')
    
    def connect(self):
        self.client = mqtt.Client()
        self.client.username_pw_set(self.username, self.password)
        
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect
        
        try:
            self.client.connect(self.broker, self.port, 60)
            self.client.loop_start()
            print('✅ Conectado ao broker MQTT')
        except Exception as e:
            print(f'❌ Erro ao conectar ao MQTT: {e}')
    
    def on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            print('✅ MQTT conectado com sucesso')
            client.subscribe('mb/activar')
        else:
            print(f'❌ Falha na conexão MQTT: {rc}')
    
    def on_message(self, client, userdata, msg):
        try:
            data = json.loads(msg.payload.decode())
            print(f'📩 Mensagem MQTT recebida: {msg.topic} - {data}')
            
            if msg.topic == 'mb/activar':
                self.handle_activation(data)
        except Exception as e:
            print(f'❌ Erro ao processar mensagem MQTT: {e}')
    
    def on_disconnect(self, client, userdata, rc):
        print(f'🔌 MQTT desconectado: {rc}')
    
    def handle_activation(self, data):
        from ussd_handler import USSDHandler
        ussd_handler = USSDHandler()
        
        pedido_id = data.get('pedidoId')
        telefone = data.get('telefone')
        codigo_ussd = data.get('codigoUSSD')
        
        try:
            resultado = ussd_handler.send_ussd(telefone, codigo_ussd)
            
            # Publicar confirmação
            confirmation = {
                'pedidoId': pedido_id,
                'sucesso': resultado.get('sucesso', False),
                'mensagem': resultado.get('mensagem', '')
            }
            
            self.client.publish('mb/confirmacao', json.dumps(confirmation))
            print(f'✅ Confirmação publicada: {confirmation}')
        except Exception as e:
            print(f'❌ Erro ao activar pacote: {e}')
            
            confirmation = {
                'pedidoId': pedido_id,
                'sucesso': False,
                'mensagem': str(e)
            }
            self.client.publish('mb/confirmacao', json.dumps(confirmation))
    
    def publish_sms(self, sms_data):
        if self.client and self.client.is_connected():
            self.client.publish('sms/entrada', json.dumps(sms_data))
            print(f'📤 SMS publicado no MQTT: {sms_data}')
        else:
            print('❌ Cliente MQTT não conectado')
