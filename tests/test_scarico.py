# Prove degli script di scarico: ogni fonte gira due volte di fila sulle risposte registrate, senza rete e con
# l'orologio fermo, e deve finire con gli stessi codici di uscita e lasciare gli stessi file e le stesse cartelle dello
# script di prima (tests/fixtures/scarico/<fonte>/<giro>/: codici.json, attesi/, cartelle.json). Solo sul Mac.
# Una fonte nuova: tests/registratore.py registra, poi attesi, con lo script di prima; poi la sua prova qui.
#   /usr/bin/python3 -m unittest tests.test_scarico -v
import json, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests import registratore

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'scarico')


def read_json(path):
    with open(path, encoding='utf-8') as fp:
        return json.load(fp)


def same(name, content, expected, json_equal):
    if json_equal and name.endswith('.json'):
        return json.loads(content.decode('utf-8')) == json.loads(expected.decode('utf-8'))
    return content == expected


class TestScarico(unittest.TestCase):

    def check_source(self, fonte, giro, script, args, json_equal=False):
        """Due giri di script sulle risposte di fonte/giro: stessi codici di uscita, stessi file (byte per byte; con
        json_equal i .json decodificati) e stesse cartelle degli attesi."""
        run_dir = os.path.join(FIXTURES, fonte, giro)
        files, runs, folders = registratore.replay_twice(run_dir, script, args)
        output = ''.join(proc.stdout + proc.stderr for proc in runs)
        self.assertEqual([proc.returncode for proc in runs], read_json(os.path.join(run_dir, 'codici.json')),
                         'codici di uscita diversi; uscita dei due giri:\n' + output[-3000:])
        expected = {name: content for name, content in registratore.tree(os.path.join(run_dir, 'attesi')).items()
                    if os.path.basename(name) != '.DS_Store'}          # lasciato dal Finder, non dallo script
        self.assertEqual(sorted(files), sorted(expected), 'file prodotti diversi dagli attesi')
        different = [name for name in sorted(files) if not same(name, files[name], expected[name], json_equal)]
        self.assertEqual(different, [], 'file con un contenuto diverso dagli attesi')
        self.assertEqual(folders, read_json(os.path.join(run_dir, 'cartelle.json')), 'cartelle diverse dalle attese')

    def test_invasi(self):
        self.check_source('invasi', 'normale', 'dati_invasi.py', ['-r', 'all'])

    def test_aria(self):
        self.check_source('aria', 'normale', 'dati_aria.py', ['-r', 'all'])

    def test_laghi(self):
        self.check_source('laghi', 'normale', 'dati_laghi.py', [])

    def test_mare_reti(self):
        self.check_source('mare', 'reti', 'dati_mare.py', ['-r', 'VEN,ER,FVG'])

    def test_mare_acqven(self):
        self.check_source('mare', 'acqven', 'dati_mare.py', ['-r', 'ACQVEN'])

    def test_liguria(self):
        self.check_source('liguria', 'normale', 'dati_liguria.py', [])

    def test_liguria_full(self):
        self.check_source('liguria', 'full', 'dati_liguria.py', ['--full'])


if __name__ == '__main__':
    unittest.main()
