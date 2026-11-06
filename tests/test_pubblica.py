# Pubblicazione (publish.sh): lo stato del sito che scrive status.py, letto dal banner della pagina e dagli avvisi
# GitHub. Il resto di publish.sh lo provano gli scenari di tests/test_rete.py (TestBash).
# Le prove di main() lanciano una copia di status.py in una cartella temporanea: main() lavora nella cartella del suo
# file, e quella dell'originale è il progetto vero.
#   /usr/bin/python3 -m unittest tests.test_pubblica -v
import importlib.util, json, os, shutil, sys, tempfile, unittest
from unittest import mock

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT)
import status


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fp:
        fp.write(text)


def stations(*times):
    """Il testo di uno stations.geojson con una stazione per ogni ora dell'ultimo dato in times."""
    return json.dumps({'type': 'FeatureCollection',
                       'features': [{'type': 'Feature', 'properties': {'scode': 'S%d' % n, 'latest_time': moment}}
                                    for n, moment in enumerate(times)]})


def listing(folder):
    """I nomi in folder, in ordine; [] se la cartella non c'è."""
    return sorted(os.listdir(folder)) if os.path.isdir(folder) else []


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
            out = status.build_status(site, logs, backup)
        self.assertEqual(out['latest'], '2026-11-05T12:00')
        self.assertEqual(out['regions'], {'LAGHI': {'latest': '2026-11-05T12:00', 'n': 2, 'old': 1},
                                          'MAR_ER': {'latest': '2026-11-05T11:30', 'n': 2, 'old': 0}})
        self.assertEqual(out['backup'], {'last': '2026-11-05', 'warn': ['a', 'c'], 'info': 'fatto in 12s'})

    def test_main_scrive_status_json(self):
        folder, copy = self.copy_of_status()
        write(os.path.join(folder, 'site', 'LAGHI', 'stations.geojson'),
              stations('2026-11-05T12:00', '2026-11-05T08:50'))
        write(os.path.join(folder, 'logs', 'backup-20261105-044000.log'),
              'ATTENZIONE: rotazione ferma -- archivio sceso\nfatto in 12s, è tutto\n')
        os.makedirs(os.path.join(folder, 'usb', '2026-11-05'))
        copy.BACKUP_ROOT = os.path.join(folder, 'usb')
        # lanciato da un'altra cartella: lavora comunque nella sua
        elsewhere = os.path.join(folder, 'altrove')
        os.makedirs(elsewhere)
        os.chdir(elsewhere)
        copy.main()
        self.assertEqual(listing(os.path.join(folder, 'site', 'STATUS')), ['status.json'])
        # i byte di json.dump predefinito (", " e ": ", escape ASCII): quelli pubblicati da sempre
        expected = {'latest': '2026-11-05T12:00',
                    'regions': {'LAGHI': {'latest': '2026-11-05T12:00', 'n': 2, 'old': 1}},
                    'backup': {'last': '2026-11-05', 'warn': ['rotazione ferma'], 'info': 'fatto in 12s, è tutto'}}
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


if __name__ == '__main__':
    unittest.main()
