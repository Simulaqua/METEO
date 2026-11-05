# Prove degli script di scarico: ogni fonte gira due volte di fila sulle risposte registrate, senza rete e con
# l'orologio fermo, e deve finire con gli stessi codici di uscita e lasciare gli stessi file e le stesse cartelle dello
# script di prima (tests/fixtures/scarico/<fonte>/<giro>/: codici.json, attesi/, cartelle.json). Solo sul Mac.
# Una fonte nuova: tests/registratore.py registra, poi attesi, con lo script di prima; poi la sua prova qui.
#   /usr/bin/python3 -m unittest tests.test_scarico -v
import importlib.util, json, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests import registratore

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'scarico')
# i nomi che recover.py e check_updates.py leggono negli script regionali, per regione
READ_BY_RECOVER = {'VEN': ['PARSE_DIR', 'VARIABLES']}
READ_BY_CHECK_UPDATES = {'VEN': ['BASE_URL', 'STATION_LISTS', 'VARIABLES']}


def load_file(path):
    spec = importlib.util.spec_from_file_location(os.path.splitext(os.path.basename(path))[0], path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path):
    with open(path, encoding='utf-8') as fp:
        return json.load(fp)


def canonical_json(content):
    """Un JSON riscritto in un modo solo. Non si confrontano gli oggetti decodificati: per Python 1, 1.0 e true
    sono uguali."""
    return json.dumps(json.loads(content.decode('utf-8')), sort_keys=True, ensure_ascii=False)


def same(name, content, expected, json_equal):
    if json_equal and name.endswith('.json'):
        return canonical_json(content) == canonical_json(expected)
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

    def test_pc_tutte(self):
        self.check_source('pc', 'tutte', 'dati_pc.py', ['-r', 'all'])

    def test_pc_tutte_500(self):
        # come tutte, ma measures/latest della rete FVG risponde 500 con un corpo JSON (senza il controllo dello
        # stato si leggerebbe come zero misure): FVG salta, le altre reti si scrivono, stesso codice di uscita
        self.check_source('pc', 'tutte_500', 'dati_pc.py', ['-r', 'all'])

    def test_pc_pie_full(self):
        self.check_source('pc', 'pie_full', 'dati_pc.py', ['-r', 'PIE', '--full'])

    # lo script di prima scriveva gli accenti come \u00e0, comune.save_json li scrive in UTF-8: stesso contenuto,
    # byte diversi, quindi i JSON del Veneto si confrontano decodificati
    def test_veneto_oggi(self):
        self.check_source('veneto', 'oggi', 'dati_veneto.py', ['-date', 't'], json_equal=True)

    def test_veneto_ieri(self):
        self.check_source('veneto', 'ieri', 'dati_veneto.py', ['-date', 'y'], json_equal=True)

    def test_moduli_letti_da_recover_e_check_updates(self):
        # i due programmi caricano gli script regionali dai loro percorsi e ne leggono le impostazioni; recover.py si
        # muove solo dopo un buco nei dati, quindi un nome sparito non si vedrebbe subito
        recover = load_file(os.path.join(registratore.PROJECT, 'recover.py'))
        check_updates = load_file(os.path.join(registratore.PROJECT, 'check_updates.py'))
        loaded = [(recover.load_module(region), names) for region, names in READ_BY_RECOVER.items()]
        loaded += [(check_updates.load_module(check_updates.REGIONS[region]), names)
                   for region, names in READ_BY_CHECK_UPDATES.items()]
        for module, names in loaded:
            for name in names:
                self.assertTrue(hasattr(module, name), '%s non ha %s' % (module.__file__, name))


if __name__ == '__main__':
    unittest.main()
