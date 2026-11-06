# Un file d'archivio che si legge ma ha la forma sbagliata (un record che e' una lista, ISTANTE un numero, MISURE una
# stringa) non ferma export, climatologia e Storico: il file e' saltato con una riga WARN e il resto esce come prima.
#   /usr/bin/python3 -m unittest tests.test_archivio -v
import csv, json, os, shutil, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests import rete

GOOD_DAY = '20261104'
WRONG = {'20261101': ['non', 'un', 'record'],                                   # il record della stazione e' una lista
         '20261102': {'MISURE': {'ISTANTE': 202611020000, 'VALORE': [1.0]}},    # ISTANTE e' un numero
         '20261103': {'MISURE': 'stringa'}}                                     # MISURE e' una stringa


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fp:
        json.dump(data, fp)


def moments(day):
    return [day + '%02d00' % hour for hour in range(8)]


class TestArchivio(unittest.TestCase):

    def setUp(self):
        self.folder = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder, True)
        rete.copy_programs(self.folder)
        parsed = os.path.join(self.folder, 'LOM', 'data-parsed')
        write_json(os.path.join(parsed, 'stazioni.json'), {'A': {'NOME': 'Prova', 'LAT': 45.5, 'LON': 9.5}})
        self.paths = []
        for var, values in (('PREC', [0.2] * 8), ('TEMP', [10.0 + n for n in range(8)])):
            write_json(os.path.join(parsed, var, '%s-%s.json' % (var, GOOD_DAY)),
                       {'A': {'MISURE': {'ISTANTE': moments(GOOD_DAY), 'VALORE': values}}})
            for day, record in WRONG.items():
                path = os.path.join(parsed, var, '%s-%s.json' % (var, day))
                write_json(path, {'A': record})
                self.paths.append(path)

    def run_program(self, *args):
        done = rete.run([sys.executable] + list(args), self.folder)
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout + done.stderr

    def assert_warns(self, text):
        lines = [line for line in text.splitlines() if line.startswith('WARN: file saltato (')]
        for path in self.paths:
            self.assertEqual(len([line for line in lines if line.endswith(': ' + path)]), 1, path + '\n' + text)

    def test_export(self):
        text = self.run_program('export_web.py', '-r', 'LOM', '--site-dir', 'site')
        self.assert_warns(text)
        with open(os.path.join(self.folder, 'site', 'LOM', 'series', 'A.csv'), encoding='utf-8') as fp:
            rows = list(csv.DictReader(fp))
        self.assertEqual([row['PREC'] for row in rows if row['PREC']], ['0.2'] * 8)      # le otto letture del giorno buono

    def test_climatologia(self):
        text = self.run_program('climatology.py', '-r', 'LOM', '--site-dir', 'site')
        self.assert_warns(text)
        with open(os.path.join(self.folder, 'site', 'LOM', 'climate.json'), encoding='utf-8') as fp:
            entry = json.load(fp)['A']
        self.assertEqual(entry['period']['from'], GOOD_DAY)
        self.assertEqual(entry['records']['prec_day']['val'], 1.6)

    def test_storico(self):
        text = self.run_program('history.py', '--out', 'history_out', '--cache', 'history_cache')
        self.assert_warns(text)
        with open(os.path.join(self.folder, 'history_out', 'LOM', 'A.json'), encoding='utf-8') as fp:
            station = json.load(fp)
        self.assertEqual(station['d0'], GOOD_DAY)
        self.assertEqual(station['p'], [1.6])


if __name__ == '__main__':
    unittest.main()
