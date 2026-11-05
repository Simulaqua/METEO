# Rete di sicurezza della pulizia, parte 3 (1/3): export, climatologia e Storico, lanciati da tests/rete.py sul
# campione dell'archivio con l'orologio fermo, devono produrre gli stessi file di tests/fixtures/rete/impronte.txt.
# Per vedere che cosa è cambiato: tests/rete.py uscita (con --da per il commit di partenza) in due cartelle e diff -r.
# Per una differenza voluta: tests/rete.py attesi export, e il diff di impronte.txt si guarda riga per riga.
# Solo sul Mac.
#   /usr/bin/python3 -m unittest tests.test_rete -v
import os, re, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests import rete

SHOWN = 20          # file nominati al più in un errore


def read_fingerprints(path):
    """{percorso: sha1} da un file nel formato di sha1sum."""
    with open(path, encoding='utf-8') as fp:
        return {name: sha1 for sha1, name in (line.rstrip('\n').split('  ', 1) for line in fp)}


def is_climate(path):
    return re.fullmatch(r'site/[^/]+/climate\.json', path) is not None


class TestExport(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as folder:
            cls.produced = rete.export_outputs(folder)
        cls.expected = read_fingerprints(rete.FINGERPRINTS)

    def compare(self, part):
        """I file di una parte dell'uscita (part dice se un percorso ne fa parte) contro le impronte attese."""
        expected = {path: sha1 for path, sha1 in self.expected.items() if part(path)}
        produced = {path: sha1 for path, sha1 in self.produced.items() if part(path)}
        self.assertTrue(expected, 'nessuna impronta attesa per questa parte')
        wrong = []
        for path in sorted(set(expected) | set(produced)):
            if path not in produced:
                wrong.append('mancante  ' + path)
            elif path not in expected:
                wrong.append('in più    ' + path)
            elif produced[path] != expected[path]:
                wrong.append('diverso   ' + path)
        if wrong:
            self.fail('%d file non come in impronte.txt:\n%s' % (len(wrong), '\n'.join(wrong[:SHOWN])))

    def test_sito(self):
        self.compare(lambda path: path.startswith('site/') and not is_climate(path))

    def test_climatologia(self):
        self.compare(is_climate)

    def test_storico(self):
        self.compare(lambda path: path.startswith(('history_out/', 'history_cache/')))


if __name__ == '__main__':
    unittest.main()
