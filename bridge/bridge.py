"""
GigaBot MZ — Bridge Local Arduino <-> MQTT Remoto

Uso:
    python3 -m venv venv
    venv/bin/pip install -r requirements.txt
    venv/bin/python bridge.py

Comandos interactivos (digita e prime Enter):
    STATUS           — estado completo do Arduino
    DIAGNOSE         — diagnostico completo do SIM900
    AT+CSQ           — sinal
    USSD:*111#       — executa USSD
    SMS_CHECK        — verifica SMS
    (qualquer AT)    — passa directamente ao SIM900
"""

import serial
import paho.mqtt.client as mqtt
import json, time, threading, os, sys, glob, uuid
from datetime import datetime

# ── CONFIG ────────────────────────────────────────────────────

SERIAL_PORT = os.getenv('SERIAL_PORT', 'auto')
SERIAL_BAUD = int(os.getenv('SERIAL_BAUD', '9600'))
MQTT_HOST   = os.getenv('MQTT_HOST',   'acsqsrelatoriosapi.eurekaplatformapi.xyz')
MQTT_PORT   = int(os.getenv('MQTT_PORT', '1883'))
# ID unico por instancia para evitar reconexao em loop
MQTT_CLIENT_ID = f'arduino-bridge-{uuid.uuid4().hex[:8]}'

# ── UTILITARIOS ───────────────────────────────────────────────

def ts():
    return datetime.now().strftime('%H:%M:%S')

def log(prefixo, msg):
    print(f'[{ts()}] [{prefixo}] {msg}')

# ── ESTADO ────────────────────────────────────────────────────

ser              = None
mqttc            = None
ser_lock         = threading.Lock()
diag_lock        = threading.Lock()   # impede diagnosticos concorrentes
ussd_resp_buffer = []
at_resp_buffer   = []

# ── SERIAL ────────────────────────────────────────────────────

def detectar_porta():
    candidatos = sorted(glob.glob('/dev/ttyUSB*') + glob.glob('/dev/ttyACM*'))
    if not candidatos:
        return None
    if len(candidatos) == 1:
        return candidatos[0]
    for porta in candidatos:
        try:
            s = serial.Serial(porta, SERIAL_BAUD, timeout=2)
            time.sleep(1)
            s.write(b'STATUS\n')
            time.sleep(1)
            resp = s.read(s.in_waiting).decode('utf-8', errors='ignore')
            s.close()
            if any(k in resp for k in ('STATUS', 'INICIANDO', 'OK')):
                log('Serial', f'Arduino detectado em {porta}')
                return porta
        except Exception:
            pass
    return candidatos[0]

def conectar_serial():
    global ser
    while True:
        try:
            porta = SERIAL_PORT if SERIAL_PORT != 'auto' else detectar_porta()
            if not porta:
                log('Serial', 'Nenhum dispositivo USB encontrado — tentando em 5s...')
                time.sleep(5)
                continue
            ser = serial.Serial(porta, SERIAL_BAUD, timeout=1)
            time.sleep(2)
            log('Serial', f'Conectado em {porta}')
            return
        except Exception as e:
            log('Serial', f'{e} — tentando em 5s...')
            time.sleep(5)

def enviar_serial(cmd):
    with ser_lock:
        try:
            if ser and ser.is_open:
                ser.write((cmd.strip() + '\n').encode())
                ser.flush()
        except Exception as e:
            log('Serial', f'Erro write: {e}')

# ── DIAGNOSTICO ───────────────────────────────────────────────

def executar_diagnostico():
    """Verifica estado completo do SIM900 e publica no MQTT."""
    if not diag_lock.acquire(blocking=False):
        log('Diagnose', 'Ja a correr — ignorando pedido duplicado')
        return
    try:
        _executar_diagnostico()
    finally:
        diag_lock.release()

def _executar_diagnostico():
    log('Diagnose', 'A executar diagnostico completo...')

    resultado = {
        'ts':         datetime.now().isoformat(),
        'ping':       None,
        'sim_card':   None,
        'signal':     None,
        'signal_raw': None,
        'rede':       None,
        'operadora':  None,
        'problemas':  []
    }

    def cmd_at(comando, espera=4):
        """Envia AT command e aguarda resposta com timeout."""
        at_resp_buffer.clear()
        enviar_serial(f'AT_CMD:{comando}')
        t = time.time()
        while time.time() - t < espera:
            if at_resp_buffer:
                return at_resp_buffer.pop(0)
            time.sleep(0.2)
        return ''

    # AT ping
    resp_ping = cmd_at('AT')
    resultado['ping'] = 'OK' if 'OK' in resp_ping else 'FALHOU'

    # SIM card
    resp_cpin = cmd_at('AT+CPIN?')
    if 'READY' in resp_cpin:
        resultado['sim_card'] = 'OK'
    elif 'not inserted' in resp_cpin.lower() or '+CPIN' not in resp_cpin:
        resultado['sim_card'] = 'NAO_INSERIDO'
        resultado['problemas'].append('SIM card nao inserido ou nao reconhecido')
    else:
        resultado['sim_card'] = resp_cpin.strip()

    # Sinal
    resp_csq = cmd_at('AT+CSQ')
    resultado['signal_raw'] = resp_csq
    try:
        # +CSQ: 28,0
        val = int(resp_csq.split('+CSQ:')[-1].split(',')[0].strip())
        resultado['signal'] = val
        if val == 0:
            resultado['problemas'].append('Sinal=0: antena desconectada ou fora de cobertura')
        elif val == 99:
            resultado['problemas'].append('Sinal=99: SIM900 nao inicializado')
        elif val < 10:
            resultado['problemas'].append(f'Sinal fraco ({val}/31)')
    except Exception:
        resultado['problemas'].append(f'Nao foi possivel ler sinal: {resp_csq}')

    # Registo na rede
    resp_creg = cmd_at('AT+CREG?')
    resultado['rede'] = resp_creg
    if ',1' in resp_creg or ',5' in resp_creg:
        resultado['rede'] = 'REGISTADO'
    elif ',2' in resp_creg:
        resultado['rede'] = 'A_PROCURAR'
        resultado['problemas'].append('A procurar rede — aguarda ou verifica cobertura')
    elif ',0' in resp_creg:
        resultado['rede'] = 'NAO_REGISTADO'
        resultado['problemas'].append('Nao registado na rede — verifica SIM e antena')

    # Operadora
    resp_cops = cmd_at('AT+COPS?', espera=6)
    import re as _re
    m = _re.search(r'"([^"]+)"', resp_cops)
    resultado['operadora'] = m.group(1) if m else (resp_cops.strip() or 'Desconhecida')

    # Publicar no MQTT
    publicar('diagnostico/arduino', resultado)

    # Resumo no terminal
    log('Diagnose', f"Ping: {resultado['ping']} | SIM: {resultado['sim_card']} | "
        f"Sinal: {resultado['signal']}/31 | Rede: {resultado['rede']} | "
        f"Operadora: {resultado['operadora']}")

    if resultado['problemas']:
        for p in resultado['problemas']:
            log('Diagnose', f'PROBLEMA: {p}')
    else:
        log('Diagnose', 'Tudo OK')

    return resultado

# ── MQTT ──────────────────────────────────────────────────────

def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        log('MQTT', f'Conectado a {MQTT_HOST} (id={MQTT_CLIENT_ID})')
        client.subscribe('mb/activar')
        client.subscribe('ussd/executar')
        client.subscribe('at/executar')
        client.subscribe('diagnostico/solicitar')
    else:
        log('MQTT', f'Falhou reason={reason_code}')

def on_disconnect(_client, _userdata, _flags, reason_code, _properties):
    log('MQTT', f'Desconectado reason={reason_code}')

def on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode())

        if msg.topic == 'mb/activar':
            codigo = data.get('codigoUSSD', '')
            if codigo:
                log('MQTT', f'USSD activacao: {codigo}')
                enviar_serial(f'USSD:{codigo}')

        elif msg.topic == 'ussd/executar':
            codigo     = data.get('codigo', '')
            request_id = data.get('requestId', '')
            if codigo:
                log('MQTT', f'USSD manual: {codigo}')
                enviar_serial(f'USSD:{codigo}')
                threading.Thread(target=aguardar_e_publicar_ussd, args=(request_id,), daemon=True).start()

        elif msg.topic == 'at/executar':
            comando    = data.get('comando', '')
            request_id = data.get('requestId', '')
            if comando:
                log('MQTT', f'AT: {comando}')
                enviar_serial(f'AT_CMD:{comando}')
                threading.Thread(target=aguardar_e_publicar_at, args=(request_id,), daemon=True).start()

        elif msg.topic == 'diagnostico/solicitar':
            threading.Thread(target=executar_diagnostico, daemon=True).start()

    except Exception as e:
        log('MQTT', f'Erro msg: {e}')

def aguardar_e_publicar_at(request_id, timeout=5):
    t = time.time()
    while time.time() - t < timeout:
        if at_resp_buffer:
            resp = at_resp_buffer.pop(0)
            publicar('at/resultado', {'requestId': request_id, 'resposta': resp, 'ts': ts()})
            return
        time.sleep(0.2)
    publicar('at/resultado', {'requestId': request_id, 'resposta': 'TIMEOUT', 'ts': ts()})

def aguardar_e_publicar_ussd(request_id, timeout=25):
    t = time.time()
    while time.time() - t < timeout:
        if ussd_resp_buffer:
            resp = ussd_resp_buffer.pop(0)
            publicar('ussd/resultado', {'requestId': request_id, 'resposta': resp, 'ts': ts()})
            log('MQTT', f'USSD resultado: {resp[:60]}')
            return
        time.sleep(0.5)
    publicar('ussd/resultado', {'requestId': request_id, 'resposta': 'TIMEOUT', 'ts': ts()})

def conectar_mqtt():
    global mqttc
    mqttc = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=MQTT_CLIENT_ID, clean_session=True)
    mqttc.on_connect    = on_connect
    mqttc.on_message    = on_message
    mqttc.on_disconnect = on_disconnect
    while True:
        try:
            mqttc.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            mqttc.loop_start()
            return
        except Exception as e:
            log('MQTT', f'{e} — tentando em 5s...')
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

                log('Arduino', linha)

                if linha.startswith('SMS|'):
                    partes = linha.split('|', 2)
                    if len(partes) == 3:
                        publicar('sms/entrada', {
                            'remetente': partes[1],
                            'mensagem':  partes[2],
                            'timestamp': int(time.time() * 1000),
                            'ts':        ts()
                        })
                        log('SMS', f'De {partes[1]}: {partes[2][:50]}')

                elif linha.startswith('AT_RESP|'):
                    resp = linha.split('|', 1)[1] if '|' in linha else ''
                    at_resp_buffer.append(resp)

                elif linha.startswith('USSD_RESP|'):
                    resp = linha.split('|', 1)[1] if '|' in linha else ''
                    resp = resp.replace('\\n', '\n')  # descodificar newlines
                    ussd_resp_buffer.append(resp)
                    log('USSD', f'Resposta ({len(resp)} chars): {resp[:60].replace(chr(10)," | ")}')

                elif linha.startswith('STATUS|OK'):
                    sinal = 0
                    for p in linha.split('|'):
                        if p.startswith('signal='):
                            try: sinal = int(p.split('=')[1])
                            except: pass
                    publicar('status/arduino', {
                        'connected': True,
                        'signal':    sinal,
                        'ts':        datetime.now().isoformat()
                    })

        except serial.SerialException:
            log('Serial', 'Desconectado. A detectar nova porta...')
            time.sleep(3)
            conectar_serial()
        except Exception as e:
            log('Serial', f'Erro: {e}')
            time.sleep(1)

# ── CONSOLA INTERACTIVA ───────────────────────────────────────

def loop_console():
    print(f'\n[{ts()}] [Console] Pronto. Digita comandos e prime Enter.')
    print(f'[{ts()}] [Console] DIAGNOSE para diagnostico completo | STATUS | AT+CSQ | USSD:*111#\n')
    while True:
        try:
            cmd = input()
            cmd = cmd.strip()
            if not cmd:
                continue
            if cmd.upper() == 'DIAGNOSE':
                threading.Thread(target=executar_diagnostico, daemon=True).start()
            else:
                enviar_serial(cmd)
        except (EOFError, KeyboardInterrupt):
            log('Bridge', 'A terminar...')
            break

# ── STATUS PERIODICO ──────────────────────────────────────────

def loop_status():
    time.sleep(15)
    while True:
        enviar_serial('STATUS')
        time.sleep(60)

def loop_diagnostico_periodico():
    """Diagnostico completo a cada 10 minutos, primeiro apos 2 minutos."""
    time.sleep(120)
    while True:
        executar_diagnostico()
        time.sleep(600)

# ── MAIN ──────────────────────────────────────────────────────

if __name__ == '__main__':
    log('Bridge', f'Serial: {SERIAL_PORT} | MQTT: {MQTT_HOST}:{MQTT_PORT} | ID: {MQTT_CLIENT_ID}')
    conectar_serial()
    conectar_mqtt()
    threading.Thread(target=loop_status, daemon=True).start()
    threading.Thread(target=loop_serial, daemon=True).start()
    threading.Thread(target=loop_diagnostico_periodico, daemon=True).start()
    loop_console()
