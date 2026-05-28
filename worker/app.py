from flask import Flask, request, jsonify
from mqtt_handler import MQTTHandler
from ussd_handler import USSDHandler
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# Inicializar handlers
mqtt_handler = MQTTHandler()
ussd_handler = USSDHandler()

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy'})

@app.route('/api/ussd/send', methods=['POST'])
def send_ussd():
    data = request.json
    telefone = data.get('telefone')
    codigo = data.get('codigo')
    
    if not telefone or not codigo:
        return jsonify({'error': 'Telefone e código são obrigatórios'}), 400
    
    try:
        resultado = ussd_handler.send_ussd(telefone, codigo)
        return jsonify({'success': True, 'resultado': resultado})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/arduino/sms', methods=['POST'])
def receive_sms():
    data = request.json
    mqtt_handler.publish_sms(data)
    return jsonify({'success': True})

if __name__ == '__main__':
    mqtt_handler.connect()
    app.run(host='0.0.0.0', port=5000)
