# Prove del registratore (tests/registratore.py): un server locale risponde mentre si registra, poi si spegne e le
# risposte si ripetono senza rete, con l'orologio fermo all'ora della registrazione. Solo sul Mac.
# La registrazione dorme davvero i 30 s dello script di prova: queste prove durano mezzo minuto.
#   /usr/bin/python3 -m unittest tests.test_registratore -v
import contextlib, http.server, io, json, os, shutil, subprocess, sys, tempfile, threading, unittest, urllib.request
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests import registratore

PAGES = {'/a.json': (200, 'application/json', b'{"x": 1}'),
         '/b.txt': (200, 'text/plain; charset=utf-8', 'àè'.encode('utf-8')),
         '/err': (500, 'text/plain', b'errore')}

# legge tre pagine (requests, urllib, requests), dorme 30 s e scrive tutto in out.json
SCRIPT = '''
import datetime, json, sys, time, urllib.request
import requests

base = sys.argv[1]
out = {'a': requests.get(base + '/a.json').json(),
       'b': urllib.request.urlopen(base + '/b.txt').read().decode('utf-8'),
       'err': requests.get(base + '/err').status_code}
time.sleep(30)
out['t'] = time.time()
out['now'] = datetime.datetime.now().isoformat()
with open('out.json', 'w', encoding='utf-8') as fp:
    json.dump(out, fp, ensure_ascii=False)
'''

# chiede una pagina mai registrata e, come gli script veri, stampa l'errore e va avanti
NEW_PAGE_SCRIPT = '''
import sys
import requests

try:
    requests.get(sys.argv[1] + '/nuovo')
except Exception as error:
    print('ERRORE: ' + str(error))
'''

# lascia una cartella con un file, una vuota dentro la stessa cartella e una vuota da sola, poi esce con il codice 2
FOLDERS_SCRIPT = '''
import os, sys

for folder in ('dati/a', 'dati/b', 'vuota'):
    os.makedirs(folder, exist_ok=True)
with open('dati/a/x.txt', 'w', encoding='utf-8') as fp:
    fp.write('x')
sys.exit(2)
'''


class Pages(http.server.BaseHTTPRequestHandler):

    def do_GET(self):
        status, content_type, body = PAGES[self.path]
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):      # niente righe del server nell'uscita delle prove
        pass


def rome_isoformat(epoch):
    """datetime.datetime.fromtimestamp(epoch).isoformat() con il fuso dei giri (Europe/Rome)."""
    code = 'import datetime, sys; print(datetime.datetime.fromtimestamp(float(sys.argv[1])).isoformat())'
    return subprocess.check_output([sys.executable, '-c', code, repr(epoch)],
                                   env=dict(os.environ, TZ='Europe/Rome'), universal_newlines=True).strip()


class TestRegistratore(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.run_dir = os.path.join(cls.tmp, 'giro')
        cls.project = os.path.join(cls.tmp, 'progetto')
        os.makedirs(cls.project)
        for name, text in (('prova.py', SCRIPT), ('nuovo.py', NEW_PAGE_SCRIPT)):
            with open(os.path.join(cls.project, name), 'w', encoding='utf-8') as fp:
                fp.write(text)
        server = http.server.HTTPServer(('127.0.0.1', 0), Pages)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        cls.base = 'http://127.0.0.1:%d' % server.server_address[1]
        try:
            proc = registratore.record(cls.run_dir, 'prova.py', [cls.base], cls.project)
        finally:
            server.shutdown()
            server.server_close()
        if proc.returncode != 0:
            raise RuntimeError('registrazione fallita, codice di uscita %d' % proc.returncode)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def replay_out(self):
        """Un giro in riproduzione dello script di prova: il suo out.json."""
        proc = registratore.replay(self.run_dir, 'prova.py', [self.base], self.project)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(registratore.tree(self.project)['out.json'])

    def test_ripete_senza_rete(self):
        with self.assertRaises(OSError):                   # il server è spento
            urllib.request.urlopen(self.base + '/a.json', timeout=5)
        out1, out2 = self.replay_out(), self.replay_out()
        self.assertEqual(out1, out2)
        self.assertEqual(out1['a'], {'x': 1})
        self.assertEqual(out1['b'], 'àè')
        self.assertEqual(out1['err'], 500)

    def test_orologio_fermo(self):
        with open(os.path.join(self.run_dir, 'ora.json'), encoding='utf-8') as fp:
            ora = json.load(fp)['epoch']
        out1 = self.replay_out()
        self.assertEqual(out1['t'], ora + 30)
        self.assertEqual(out1['now'], rome_isoformat(ora + 30))

    def test_richiesta_non_registrata(self):
        proc = registratore.replay(self.run_dir, 'nuovo.py', [self.base], self.project)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('risposta non registrata: GET http://127.0.0.1', proc.stderr)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fp:
        fp.write(text)


def read_json(path):
    with open(path, encoding='utf-8') as fp:
        return json.load(fp)


def listing(folder):
    """Tutto quello che c'è in folder: cartelle e file, percorsi relativi."""
    found = []
    for root, dirs, names in os.walk(folder):
        found += [os.path.relpath(os.path.join(root, name), folder) for name in dirs + names]
    return sorted(found)


class TestAttesi(unittest.TestCase):
    """Il comando attesi, su un progetto di prova (cartelle.py e la configurazione conf/x.json) senza rete."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.source = os.path.join(self.tmp, 'progetto')
        write(os.path.join(self.source, 'cartelle.py'), FOLDERS_SCRIPT)
        write(os.path.join(self.source, 'conf', 'x.json'), '{}')
        self.run_dir = os.path.join(self.tmp, 'giro')
        write(os.path.join(self.run_dir, 'ora.json'), json.dumps({'epoch': 1793000000.0}))
        os.makedirs(os.path.join(self.run_dir, 'risposte'))

    def attesi(self):
        argv = ['registratore.py', 'attesi', self.run_dir, '--', 'cartelle.py']
        with mock.patch.object(registratore, 'PROJECT', self.source), \
                mock.patch.object(registratore, 'PROJECT_FILES', ['cartelle.py', 'conf/x.json']), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            registratore.main(argv)

    def test_salva_codici_e_cartelle(self):
        self.attesi()
        self.assertEqual(read_json(os.path.join(self.run_dir, 'codici.json')), [2, 2])
        # conf/ ha solo il file copiato dal progetto: non è una cartella lasciata dai giri
        self.assertEqual(read_json(os.path.join(self.run_dir, 'cartelle.json')), ['dati', 'dati/a', 'dati/b', 'vuota'])
        self.assertEqual(registratore.tree(os.path.join(self.run_dir, 'attesi')), {'dati/a/x.txt': b'x'})

    def test_rifiuta_un_giro_incompleto(self):
        write(os.path.join(self.run_dir, 'attesi', 'vecchio.txt'), 'attesi di prima')
        for name in ('ora.json', 'risposte'):
            with self.subTest(manca=name):
                path, aside = os.path.join(self.run_dir, name), os.path.join(self.tmp, name)
                os.rename(path, aside)
                try:
                    before = listing(self.run_dir)
                    with self.assertRaises(SystemExit) as stop:
                        self.attesi()
                    self.assertIn('ora.json', str(stop.exception.code))      # esce con un messaggio, codice 1
                    self.assertEqual(listing(self.run_dir), before)
                finally:
                    os.rename(aside, path)


if __name__ == '__main__':
    unittest.main()
