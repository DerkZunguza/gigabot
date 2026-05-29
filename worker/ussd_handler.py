import serial
import time
import threading
import os
from dotenv import load_dotenv

load_dotenv()

class USSDHandler:
    def __init__(self, mqtt_handler=None):
        self.serial_port  = os.getenv('ARDUINO_SERIAL_PORT', '/dev/ttyUSB0')
        self.baud_rate    = int(os.getenv('ARDUINO_BAUD_RATE', 9600))
        self.serial_conn  = None
        self.mqtt_handler = mqtt_handler
        self.connected    = False
        self.last_signal  = 0
        self._lock        = threading.Lock()

    # ── CONEXAO SERIAL ───────────────────────────────────────

    def connect_serial(self):
        try:
            self.serial_conn = serial.Serial(
                self.serial_port, self.baud_rate, timeout=3
            )
            time.sleep(2)
            self.connected = True
            print(f'Arduino conectado: {self.serial_port}')
            return True
        except Exception as e:
            print(f'Erro ao conectar ao Arduino: {e}')
            self.connected = False
            return False

    def ensure_connected(self):
        if not self.serial_conn or not self.serial_conn.is_open:
            return self.connect_serial()
        return True

    def disconnect(self):
        if self.serial_conn and self.serial_conn.is_open:
            self.serial_conn.close()
        self.connected = False

    # ── ENVIO DE COMANDOS ────────────────────────────────────

    def send_command(self, command, timeout=10):
        with self._lock:
            try:
                if not self.ensure_connected():
                    return None
                self.serial_conn.write((command + '\n').encode())
                self.serial_conn.flush()
                resp = ''
                t = time.time()
                while time.time() - t < timeout:
                    if self.serial_conn.in_waiting:
                        line = self.serial_conn.readline().decode('utf-8', errors='ignore').strip()
                        if line:
                            resp += line + '\n'
                            # Para comandos rapidos, uma linha basta
                            if command in ('STATUS', 'SMS_CHECK'):
                                break
                return resp.strip()
            except Exception as e:
                print(f'Erro ao enviar comando serial: {e}')
                self.connected = False
                return None

    # ── USSD ─────────────────────────────────────────────────

    def send_ussd(self, codigo_ussd):
        """Envia codigo USSD ao Arduino. Formato: USSD:*123*1*2#"""
        resultado = self.send_command(f'USSD:{codigo_ussd}', timeout=15)
        if resultado and resultado.startswith('USSD_RESP|'):
            resposta = resultado.split('|', 1)[1] if '|' in resultado else resultado
            sucesso  = 'activado' in resposta.lower() or 'sucesso' in resposta.lower() or len(resposta) > 5
            return {'sucesso': sucesso, 'mensagem': resposta}
        return {'sucesso': False, 'mensagem': resultado or 'Sem resposta'}

    # ── STATUS / SINAL ────────────────────────────────────────

    def get_status(self):
        resp = self.send_command('STATUS', timeout=5)
        if resp and resp.startswith('STATUS|OK'):
            self.connected = True
            # Extrair sinal: STATUS|OK|signal=15
            parts = resp.split('|')
            for p in parts:
                if p.startswith('signal='):
                    try: self.last_signal = int(p.split('=')[1])
                    except: pass
            return {'connected': True, 'signal': self.last_signal}
        self.connected = resp is not None
        return {'connected': self.connected, 'signal': 0}

    # ── MONITORAMENTO DE SMS ──────────────────────────────────

    def start_sms_monitor(self):
        """Thread que le o Serial continuamente e processa SMS."""
        t = threading.Thread(target=self._sms_loop, daemon=True)
        t.start()
        print('Monitor de SMS iniciado')

    def _sms_loop(self):
        while True:
            try:
                if not self.ensure_connected():
                    time.sleep(10)
                    continue

                # Ler linha disponivel no Serial
                if self.serial_conn.in_waiting:
                    raw = self.serial_conn.readline().decode('utf-8', errors='ignore').strip()
                    if raw.startswith('SMS|'):
                        self._processar_sms(raw)
                    elif raw.startswith('STATUS|'):
                        pass  # ignorar respostas de status aqui
                else:
                    time.sleep(0.1)

            except Exception as e:
                print(f'Erro no monitor SMS: {e}')
                self.connected = False
                time.sleep(5)

    def _processar_sms(self, linha):
        """Parseia 'SMS|remetente|mensagem' e publica no MQTT."""
        partes = linha.split('|', 2)
        if len(partes) < 3:
            return
        _, remetente, mensagem = partes
        print(f'SMS recebido de {remetente}: {mensagem}')
        if self.mqtt_handler:
            self.mqtt_handler.publish_sms({
                'remetente':  remetente,
                'mensagem':   mensagem,
                'timestamp':  int(time.time() * 1000)
            })
