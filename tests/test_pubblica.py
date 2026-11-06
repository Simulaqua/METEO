# Pubblicazione (publish.sh): lo stato del sito che scrive status.py, letto dal banner della pagina e dagli avvisi
# GitHub, e l'avviso dello Storico (watchdog_storico.yml). Il resto di publish.sh lo provano gli scenari di
# tests/test_rete.py (TestBash).
# Le prove di main() lanciano una copia di status.py in una cartella temporanea: main() lavora nella cartella del suo
# file, e quella dell'originale è il progetto vero. L'avviso gira con urlopen sostituito e la rete vietata.
#   /usr/bin/python3 -m unittest tests.test_pubblica -v
import datetime, importlib.util, json, os, shutil, subprocess, sys, tempfile, textwrap, unittest, zoneinfo
from unittest import mock

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT)
import status

CLOCK = os.path.join(PROJECT, 'tests', 'orologio')
# lancia il Python di un avviso (sys.argv[1]) con urlopen che risponde il testo di sys.argv[2]
LAUNCHER = ('import io, sys, urllib.request\n'
            'urllib.request.urlopen = lambda url, timeout: io.BytesIO(sys.argv[2].encode("utf-8"))\n'
            'exec(compile(sys.argv[1], "avviso", "exec"), {"__name__": "__main__"})\n')


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fp:
        fp.write(text)


def set_mtime(path, moment):
    """L'ora di modifica di path = moment, un datetime senza fuso nell'ora locale."""
    seconds = moment.timestamp()
    os.utime(path, (seconds, seconds))


def stations(*times):
    """Il testo di uno stations.geojson con una stazione per ogni ora dell'ultimo dato in times."""
    return json.dumps({'type': 'FeatureCollection',
                       'features': [{'type': 'Feature', 'properties': {'scode': 'S%d' % n, 'latest_time': moment}}
                                    for n, moment in enumerate(times)]})


def listing(folder):
    """I nomi in folder, in ordine; [] se la cartella non c'è."""
    return sorted(os.listdir(folder)) if os.path.isdir(folder) else []


def watchdog_python(name):
    """Il Python dell'avviso name (il testo fra python3 - <<'PY' e PY), senza il rientro dello YAML: quello che
    gira su GitHub."""
    with open(os.path.join(PROJECT, name), encoding='utf-8') as fp:
        lines = fp.read().split('\n')
    stripped = [line.strip() for line in lines]
    start = stripped.index("python3 - <<'PY'") + 1
    return textwrap.dedent('\n'.join(lines[start:stripped.index('PY', start)]))


def common_part(code):
    """La parte 'comune' del Python di un avviso: dal suo segno a quello della parte specifica."""
    return code[code.index('# --- comune'):code.index('# --- specifico')]


def skeleton(name):
    """Lo YAML dell'avviso name dalla prova a mano (workflow_dispatch, con 'prova') all'inizio del Python."""
    with open(os.path.join(PROJECT, name), encoding='utf-8') as fp:
        text = fp.read()
    return text[text.index('  workflow_dispatch:'):text.index("python3 - <<'PY'")]


class TestStato(unittest.TestCase):

    def copy_of_status(self):
        """Una cartella temporanea con una copia di status.py e il modulo caricato dalla copia; alla fine la prova
        torna nella sua cartella di lavoro e la cartella temporanea sparisce."""
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder)
        self.addCleanup(os.chdir, os.getcwd())
        shutil.copy(os.path.join(PROJECT, 'status.py'), folder)
        spec = importlib.util.spec_from_file_location('status_copia', os.path.join(folder, 'status.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return folder, module

    def test_stato_regioni_e_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            site, logs, backup = (os.path.join(folder, name) for name in ('site', 'logs', 'backup'))
            # in LAGHI la seconda stazione è indietro: più di 3 ore prima della più recente
            write(os.path.join(site, 'LAGHI', 'stations.geojson'), stations('2026-11-05T12:00', '2026-11-05T08:50'))
            write(os.path.join(site, 'MAR_ER', 'stations.geojson'), stations('2026-11-05T11:30', '2026-11-05T09:00'))
            write(os.path.join(site, 'INV_ER', 'stations.geojson'), '{rotto')
            write(os.path.join(logs, 'backup-20261104-044000.log'), 'ERRORE: vecchio -- log di ieri\n')
            write(os.path.join(logs, 'backup-20261105-044000.log'),
                  'ERRORE: a -- b\nATTENZIONE: c\nERRORE: a -- d\nfatto in 12s\n')
            for day in ('2026-11-04', '2026-11-05'):
                os.makedirs(os.path.join(backup, day))
            out = status.build_status(site, logs, backup, os.path.join(folder, '.tracking', 'last_history_hash'))
        self.assertEqual(out['latest'], '2026-11-05T12:00')
        self.assertEqual(out['regions'], {'LAGHI': {'latest': '2026-11-05T12:00', 'n': 2, 'old': 1},
                                          'MAR_ER': {'latest': '2026-11-05T11:30', 'n': 2, 'old': 0}})
        self.assertEqual(out['backup'], {'last': '2026-11-05', 'warn': ['a', 'c'], 'info': 'fatto in 12s'})

    def test_stato_dello_storico(self):
        with tempfile.TemporaryDirectory() as folder:
            site, logs, backup = (os.path.join(folder, name) for name in ('site', 'logs', 'backup'))
            saved = os.path.join(folder, '.tracking', 'last_history_hash')
            # senza l'impronta dello Storico: nessun giro riuscito
            self.assertEqual(status.build_status(site, logs, backup, saved)['history'], {'last': ''})
            # l'ultimo giro riuscito è l'ora di modifica dell'impronta (al minuto), non il suo contenuto né adesso
            write(saved, 'da39a3ee5e6b4b0d3255bfef95601890afd80709\n')
            set_mtime(saved, datetime.datetime(2026, 11, 5, 7, 22, 41))
            self.assertEqual(status.build_status(site, logs, backup, saved)['history'], {'last': '2026-11-05T07:22'})

    def test_main_scrive_status_json(self):
        folder, copy = self.copy_of_status()
        write(os.path.join(folder, 'site', 'LAGHI', 'stations.geojson'),
              stations('2026-11-05T12:00', '2026-11-05T08:50'))
        write(os.path.join(folder, 'logs', 'backup-20261105-044000.log'),
              'ATTENZIONE: rotazione ferma -- archivio sceso\nfatto in 12s, è tutto\n')
        os.makedirs(os.path.join(folder, 'usb', '2026-11-05'))
        copy.BACKUP_ROOT = os.path.join(folder, 'usb')
        write(os.path.join(folder, '.tracking', 'last_history_hash'), 'abc\n')
        set_mtime(os.path.join(folder, '.tracking', 'last_history_hash'), datetime.datetime(2026, 11, 5, 7, 22))
        # lanciato da un'altra cartella: lavora comunque nella sua
        elsewhere = os.path.join(folder, 'altrove')
        os.makedirs(elsewhere)
        os.chdir(elsewhere)
        copy.main()
        self.assertEqual(listing(os.path.join(folder, 'site', 'STATUS')), ['status.json'])
        # i byte di json.dump predefinito (", " e ": ", escape ASCII): quelli pubblicati da sempre
        expected = {'latest': '2026-11-05T12:00',
                    'regions': {'LAGHI': {'latest': '2026-11-05T12:00', 'n': 2, 'old': 1}},
                    'backup': {'last': '2026-11-05', 'warn': ['rotazione ferma'], 'info': 'fatto in 12s, è tutto'},
                    'history': {'last': '2026-11-05T07:22'}}
        with open(os.path.join(folder, 'site', 'STATUS', 'status.json'), 'rb') as fp:
            self.assertEqual(fp.read(), json.dumps(expected).encode('ascii'))
        # nessuna stazione con l'ultimo dato: nessun file
        empty, copy = self.copy_of_status()
        write(os.path.join(empty, 'site', 'LAGHI', 'stations.geojson'),
              json.dumps({'features': [{'properties': {'scode': 'S0'}}]}))
        copy.main()
        self.assertEqual(listing(os.path.join(empty, 'site')), ['LAGHI'])

    def test_main_scrittura_fallita_senza_temporanei(self):
        folder, copy = self.copy_of_status()
        write(os.path.join(folder, 'site', 'LAGHI', 'stations.geojson'), stations('2026-11-05T12:00'))
        os.chdir(folder)
        names = []

        def disk_full(data, fp):
            names.append(os.path.basename(fp.name))
            fp.write('{"latest": ')
            raise OSError(28, 'No space left on device')

        with mock.patch.object(copy.json, 'dump', disk_full):
            with self.assertRaises(OSError):
                copy.main()
        # un temporaneo per processo (due publish sovrapposti non scrivono nello stesso file), tolto se la scrittura
        # fallisce
        self.assertEqual(names, ['status.json.%d.tmp' % os.getpid()])
        self.assertEqual(listing(os.path.join(folder, 'site', 'STATUS')), [])


class TestAvviso(unittest.TestCase):

    def test_avviso_storico(self):
        code = watchdog_python('watchdog_storico.yml')
        # lo schema è copiato tal quale negli altri avvisi (la parte comune del Python, la prova a mano dello YAML):
        # ognuno deve bastare a sé su gh-pages
        for other in ('watchdog.yml', 'watchdog_backup.yml'):
            self.assertEqual(common_part(watchdog_python(other)), common_part(code), other)
            self.assertEqual(skeleton(other), skeleton('watchdog_storico.yml'), other)
        # senza PROVA (che fallisce apposta); con la rete vietata un urlopen vero fallirebbe
        env = {key: value for key, value in os.environ.items() if key not in ('PROVA', 'OROLOGIO_FERMO')}
        env.update(PYTHONPATH=CLOCK, RETE_VIETATA='1')
        rome = zoneinfo.ZoneInfo('Europe/Rome')             # il fuso dell'avviso

        def watch(days):
            """Codice e uscita dell'avviso con l'ultimo giro days giorni fa, sulla data vera (None: uno stato senza lo
            Storico, di un status.py di prima). Di nuovo se intanto è passata la mezzanotte, che cambia i giorni."""
            while True:
                now = datetime.datetime.now(rome)
                state = {'latest': now.strftime('%Y-%m-%dT%H:%M')}
                if days is not None:
                    state['history'] = {'last': (now - datetime.timedelta(days=days)).strftime('%Y-%m-%dT%H:%M')}
                proc = subprocess.run([sys.executable, '-c', LAUNCHER, code, json.dumps(state)], env=env,
                                      capture_output=True, encoding='utf-8')
                if datetime.datetime.now(rome).date() == now.date():
                    return proc.returncode, proc.stdout + proc.stderr

        # una notte saltata (ieri) non basta per la mail, due giorni sì
        for days, exit_code, title in ((0, 0, '::notice title=storico ok::'), (1, 0, '::notice title=storico ok::'),
                                       (2, 1, '::error title=storico off::'), (3, 1, '::error title=storico off::'),
                                       (None, 1, '::error title=storico off::')):
            with self.subTest(giorni=days):
                returncode, printed = watch(days)
                self.assertEqual(returncode, exit_code, printed)
                self.assertTrue(printed.startswith(title), printed)


if __name__ == '__main__':
    unittest.main()
