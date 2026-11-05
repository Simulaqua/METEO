# Ogni Python lanciato con PYTHONPATH=<progetto>/tests/orologio passa di qui prima del programma (tests/rete.py lo
# fa per le reti di sicurezza, anche per i Python lanciati dai bash).
#   OROLOGIO_FERMO=<epoch>   l'orologio parte da epoch e avanza solo con time.sleep, che non aspetta
#   RETE_VIETATA=1           ogni connessione fallisce con OSError
import importlib.util
import os
import socket
import sys
import warnings

# l'avviso di urllib3 per il Python del Mac sporcherebbe l'uscita di ogni programma che importa requests
warnings.filterwarnings('ignore', message='urllib3 v2 only supports OpenSSL')

if os.environ.get('OROLOGIO_FERMO'):
    # datetime in C legge l'ora di sistema da sé; senza il modulo C si usa la versione in Python della libreria
    # standard, che la chiede a time.time(), cioè all'orologio fermo. Va fatto prima di ogni import di datetime.
    sys.modules['_datetime'] = None
    # dal suo percorso, senza toccare sys.path: i programmi devono trovare i moduli come sul Pi
    path =os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'registratore.py')
    spec = importlib.util.spec_from_file_location('registratore', path)
    registratore = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(registratore)
    registratore.freeze_clock(float(os.environ['OROLOGIO_FERMO']), really_sleep=False)

if os.environ.get('RETE_VIETATA'):
    def refuse(*args, **kwargs):
        raise OSError('rete vietata nelle prove')

    socket.getaddrinfo = refuse
    socket.socket.connect = refuse
