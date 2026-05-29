"""
GigaBot MZ — Bridge Local Arduino <-> MQTT Remoto

Uso:
    python3 -m venv venv
    venv/bin/pip install -r requirements.txt
    venv/bin/python bridge.py

Comandos interactivos (digita e prime Enter):
    STATUS           — pede estado ao Arduino
    AT+CSQ           — verifica sinal
    USSD:*111#       — executa codigo USSD
    SMS_CHECK        — verifica SMS manualmente
    (qualquer AT)    — passa directamente ao SIM900
"""

import serial
import paho.mqtt.client as mqtt
import json, time, threading, os, sys

# ── CONFIG ────────────────────────────────────────────────────

SERIAL_PORT = os.getenv('SERIAL_PORT', '/dev/ttyUSB0')
SERIAL_BAUD = int(os.getenv('SERIAL_BAUD', '9600'))
MQTT_HOST   = os.getenv('MQTT_HOST',   'acsqsrelatoriosapi.eurekaplatformapi.xyz')
MQTT_PORT   = int(os.getenv('MQTT_PORT', '1883'))

# ── ESTADO ────────────────────────────────────────────────────

ser      = None
mqttc    = None
ser_lock = threading.Lock()
ussd_resp_buffer = []

# ── SERIAL ────────────────────────────────────────────────────

def conectar_serial():
    global ser
    while True:
        try:
            ser = serial.Serial(SERIAL_PORT, SERIAL_BAUD, timeout=1)
            time.sleep(2)
            print(f'[Serial] Conectado em {SERIAL_PORT}')
            return
        except Exception as e:
            print(f'[Serial] {e} — tentando em 5s...')
            time.sleep(5)

def enviar_serial(cmd):
    with ser_lock:
        try:
            if ser and ser.is_open:
                ser.write((cmd.strip() + '\n').encode())
                ser.flush()
        except Exception as e:
            print(f'[Serial] Erro write: {e}')

# ── MQTT ──────────────────────────────────────────────────────

def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        print(f'[MQTT] Conectado a {MQTT_HOST}')
        client.subscribe('mb/activar')
        client.subscribe('ussd/executar')
        client.subscribe('at/executar')
    else:
        print(f'[MQTT] Falhou reason={reason_code}')

def on_message(client, userdata, msg):
    try:
        payload = msg.payload.decode()
        data    = json.loads(payload)

        if msg.topic == 'mb/activar':
            codigo = data.get('codigoUSSD', '')
            if codigo:
                print(f'[MQTT] USSD activacao: {codigo}')
                enviar_serial(f'USSD:{codigo}')

        elif msg.topic == 'ussd/executar':
            codigo     = data.get('codigo', '')
            request_id = data.get('requestId', '')
            if codigo:
                print(f'[MQTT] USSD manual: {codigo}')
                enviar_serial(f'USSD:{codigo}')
                threading.Thread(
                    target=aguardar_e_publicar_ussd,
                    args=(request_id,),
                    daemon=True
                ).start()

        elif msg.topic == 'at/executar':
            comando    = data.get('comando', '')
            request_id = data.get('requestId', '')
            if comando:
                print(f'[MQTT] AT manual: {comando}')
                enviar_serial(f'AT_CMD:{comando}')
                threading.Thread(
                    target=aguardar_e_publicar_at,
                    args=(request_id,),
                    daemon=True
                ).start()

    except Exception as e:
        print(f'[MQTT] Erro msg: {e}')

at_resp_buffer = []

def aguardar_e_publicar_at(request_id, timeout=5):
    t = time.time()
    while time.time() - t < timeout:
        if at_resp_buffer:
            resp = at_resp_buffer.pop(0)
            publicar('at/resultado', {'requestId': request_id, 'resposta': resp})
            print(f'[AT] Resultado publicado: {resp[:80]}')
            return
        time.sleep(0.2)
    publicar('at/resultado', {'requestId': request_id, 'resposta': 'TIMEOUT'})

def aguardar_e_publicar_ussd(request_id, timeout=25):
    t = time.time()
    while time.time() - t < timeout:
        if ussd_resp_buffer:
            resp = ussd_resp_buffer.pop(0)
            publicar('ussd/resultado', {'requestId': request_id, 'resposta': resp})
            print(f'[MQTT] USSD resultado publicado: {resp[:60]}')
            return
        time.sleep(0.5)
    publicar('ussd/resultado', {'requestId': request_id, 'resposta': 'TIMEOUT'})

def conectar_mqtt():
    global mqttc
    mqttc = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='arduino-bridge', clean_session=True)
    mqttc.on_connect = on_connect
    mqttc.on_message = on_message
    while True:
        try:
            mqttc.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            mqttc.loop_start()
            return
        except Exception as e:
            print(f'[MQTT] {e} — tentando em 5s...')
            time.sleep(5)

def publicar(topic, payload):
    if mqttc:
        mqttc.publish(topic, json.dumps(payload))

# ── LOOP SERIAL ───────────────────────────────────────────────

def loop_serial():
    buf = ''
    while True:
        try:
            if not ser or not ser.is_open:
                time.sleep(2)
                continue

            raw = ser.read(ser.in_waiting or 1).decode('utf-8', errors='ignore')
            buf += raw

            while '\n' in buf:
                linha, buf = buf.split('\n', 1)
                linha = linha.strip()
                if not linha:
                    continue

                print(f'[Arduino] {linha}')

                if linha.startswith('SMS|'):
                    partes = linha.split('|', 2)
                    if len(partes) == 3:
                        publicar('sms/entrada', {
                            'remetente': partes[1],
                            'mensagem':  partes[2],
                            'timestamp': int(time.time() * 1000)
                        })
                        print(f'[SMS] De {partes[1]}: {partes[2][:50]}')

                elif linha.startswith('AT_RESP|'):
                    resp = linha.split('|', 1)[1] if '|' in linha else ''
                    at_resp_buffer.append(resp)

                elif linha.startswith('USSD_RESP|'):
                    resp = linha.split('|', 1)[1] if '|' in linha else linha
                    ussd_resp_buffer.append(resp)
                    print(f'[USSD] Resposta: {resp[:80]}')

                elif linha.startswith('STATUS|OK'):
                    sinal = 0
                    for p in linha.split('|'):
                        if p.startswith('signal='):
                            try: sinal = int(p.split('=')[1])
                            except: pass
                    publicar('status/arduino', {
                        'connected': True,
                        'signal':    sinal,
                        'ts':        int(time.time() * 1000)
                    })

        except serial.SerialException:
            print('[Serial] Desconectado. A reconectar...')
            time.sleep(3)
            conectar_serial()
        except Exception as e:
            print(f'[Serial] Loop erro: {e}')
            time.sleep(1)

# ── CONSOLA INTERACTIVA ───────────────────────────────────────

def loop_console():
    """Permite digitar comandos AT ou USSD directamente."""
    print('\n[Console] Pronto. Digita comandos e prime Enter.')
    print('[Console] Exemplos: STATUS | AT+CSQ | USSD:*111# | SMS_CHECK\n')
    while True:
        try:
            cmd = input()
            if cmd.strip():
                enviar_serial(cmd.strip())
        except (EOFError, KeyboardInterrupt):
            break

# ── STATUS PERIODICO ──────────────────────────────────────────

def loop_status():
    time.sleep(15)
    while True:
        enviar_serial('STATUS')
        time.sleep(60)

# ── MAIN ──────────────────────────────────────────────────────

if __name__ == '__main__':
    print(f'Serial: {SERIAL_PORT} | MQTT: {MQTT_HOST}:{MQTT_PORT}')
    conectar_serial()
    conectar_mqtt()
    threading.Thread(target=loop_status, daemon=True).start()
    threading.Thread(target=loop_serial, daemon=True).start()
    loop_console()  # bloqueia aqui, lendo stdin
