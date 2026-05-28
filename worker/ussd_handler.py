import serial
import time
import os
from dotenv import load_dotenv

load_dotenv()

class USSDHandler:
    def __init__(self):
        self.serial_port = os.getenv('ARDUINO_SERIAL_PORT', '/dev/ttyUSB0')
        self.baud_rate = int(os.getenv('ARDUINO_BAUD_RATE', 9600))
        self.serial_conn = None
    
    def connect_serial(self):
        try:
            self.serial_conn = serial.Serial(
                self.serial_port,
                self.baud_rate,
                timeout=5
            )
            print(f'✅ Conectado ao Arduino: {self.serial_port}')
            time.sleep(2)  # Esperar conexão estabilizar
            return True
        except Exception as e:
            print(f'❌ Erro ao conectar ao Arduino: {e}')
            return False
    
    def disconnect_serial(self):
        if self.serial_conn and self.serial_conn.is_open:
            self.serial_conn.close()
            print('🔌 Desconectado do Arduino')
    
    def send_command(self, command):
        try:
            if not self.serial_conn or not self.serial_conn.is_open:
                if not self.connect_serial():
                    return {'sucesso': False, 'mensagem': 'Falha ao conectar ao Arduino'}
            
            self.serial_conn.write((command + '\n').encode())
            time.sleep(1)
            
            response = self.serial_conn.readline().decode().strip()
            print(f'📡 Resposta Arduino: {response}')
            
            return {'sucesso': True, 'resposta': response}
        except Exception as e:
            print(f'❌ Erro ao enviar comando: {e}')
            return {'sucesso': False, 'mensagem': str(e)}
    
    def send_ussd(self, telefone, codigo_ussd):
        """
        Envia comando USSD via Arduino SIM900
        """
        try:
            # Formatar comando para Arduino
            comando = f"USSD:{telefone}:{codigo_ussd}"
            
            resultado = self.send_command(comando)
            
            if resultado['sucesso']:
                resposta = resultado.get('resposta', '')
                
                # Verificar se foi bem-sucedido
                if 'OK' in resposta or 'SUCCESS' in resposta:
                    return {
                        'sucesso': True,
                        'mensagem': 'Pacote activado com sucesso',
                        'resposta': resposta
                    }
                else:
                    return {
                        'sucesso': False,
                        'mensagem': 'Falha na activação',
                        'resposta': resposta
                    }
            else:
                return resultado
                
        except Exception as e:
            return {'sucesso': False, 'mensagem': str(e)}
    
    def check_signal(self):
        """Verifica sinal do SIM900"""
        resultado = self.send_command('SIGNAL')
        return resultado
    
    def check_balance(self):
        """Verifica saldo do SIM900"""
        resultado = self.send_command('BALANCE')
        return resultado
