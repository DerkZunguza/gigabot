import paho.mqtt.client as mqtt
import json
import os
import time
import threading
from dotenv import load_dotenv

load_dotenv()

class MQTTHandler:
    def __init__(self):
        self.client     = None
        self.broker     = os.getenv('MQTT_BROKER', 'mosquitto')
        self.port       = int(os.getenv('MQTT_PORT', 1883))
        self._ussd      = None
        self._connected = False

    def set_ussd_handler(self, ussd_handler):
        self._ussd = ussd_handler

    def connect(self):
        self.client = mqtt.Client(client_id='worker', clean_session=True)
        self.client.on_connect    = self._on_connect
        self.client.on_message    = self._on_message
        self.client.on_disconnect = self._on_disconnect

        while True:
            try:
                self.client.connect(self.broker, self.port, keepalive=60)
                self.client.loop_start()
                print('Worker MQTT conectado')
                break
            except Exception as e:
                print(f'Erro MQTT: {e}. Tentando em 5s...')
                time.sleep(5)

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self._connected = True
            client.subscribe('mb/activar')
            self._publicar_status_arduino()
            t = threading.Thread(target=self._status_loop, daemon=True)
            t.start()
        else:
            print(f'Falha MQTT rc={rc}')

    def _on_disconnect(self, client, userdata, rc):
        self._connected = False

    def _on_message(self, client, userdata, msg):
        try:
            data = json.loads(msg.payload.decode())
            if msg.topic == 'mb/activar':
                self._handle_activacao(data)
        except Exception as e:
            print(f'Erro ao processar mensagem MQTT: {e}')

    def _handle_activacao(self, data):
        if not self._ussd:
            return
        pedido_id   = data.get('pedidoId')
        codigo_ussd = data.get('codigoUSSD')
        print(f'Activando pedido {pedido_id} com USSD {codigo_ussd}')
        resultado = self._ussd.send_ussd(codigo_ussd)
        self.client.publish('mb/confirmacao', json.dumps({
            'pedidoId': pedido_id,
            'sucesso':  resultado.get('sucesso', False),
            'mensagem': resultado.get('mensagem', '')
        }))

    def _publicar_status_arduino(self):
        if not self._ussd:
            return
        status = self._ussd.get_status()
        self.client.publish('status/arduino', json.dumps({
            'connected': status.get('connected', False),
            'signal':    status.get('signal', 0),
            'ts':        int(time.time() * 1000)
        }), retain=True)

    def _status_loop(self):
        while True:
            time.sleep(60)
            try:
                self._publicar_status_arduino()
            except Exception:
                pass

    def publish_sms(self, sms_data):
        if self.client and self._connected:
            self.client.publish('sms/entrada', json.dumps(sms_data))

    def is_connected(self):
        return self._connected
