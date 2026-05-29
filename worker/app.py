from flask import Flask, jsonify
from mqtt_handler import MQTTHandler
from ussd_handler import USSDHandler
import threading

app = Flask(__name__)

mqtt_handler = MQTTHandler()
ussd_handler = USSDHandler(mqtt_handler=mqtt_handler)
mqtt_handler.set_ussd_handler(ussd_handler)

@app.route('/health', methods=['GET'])
def health():
    status = ussd_handler.get_status()
    return jsonify({
        'worker':  'ok',
        'arduino': 'connected' if status.get('connected') else 'disconnected',
        'signal':  status.get('signal', 0),
        'mqtt':    'connected' if mqtt_handler.is_connected() else 'disconnected'
    })

if __name__ == '__main__':
    # Conectar MQTT numa thread separada
    threading.Thread(target=mqtt_handler.connect, daemon=True).start()

    # Iniciar monitor de SMS do Arduino
    ussd_handler.start_sms_monitor()

    app.run(host='0.0.0.0', port=5000)
