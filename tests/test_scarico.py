# Prove degli script di scarico: ogni fonte gira due volte di fila sulle risposte registrate, senza rete e con
# l'orologio fermo, e deve finire con gli stessi codici di uscita e lasciare gli stessi file e le stesse cartelle dello
# script di prima (tests/fixtures/scarico/<fonte>/<giro>/: codici.json, attesi/, cartelle.json). Solo sul Mac.
# Una fonte nuova: tests/registratore.py registra, poi attesi, con lo script di prima; poi la sua prova qui.
#   /usr/bin/python3 -m unittest tests.test_scarico -v
import importlib.util, json, os, re, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests import registratore

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'scarico')
# i nomi che recover.py e check_updates.py leggono negli script regionali, per regione; di FVG e TN recover.py ha solo
# il percorso (le fonti non hanno storico da recuperare): la prova controlla che lo script si carichi da lì.
# recover.py legge solar_moment di BZ ed ER, OPERATORS, SKIP_VALUES e SKIP_DIR_VALUES di LOM e VALUE_CONV di ER con
# getattr, con dei valori di riserva suoi: se un nome sparisse, userebbe quelli senza dirlo (il suo SKIP_VALUES non
# scarta -999, senza VALUE_CONV salverebbe kelvin e pascal)
READ_BY_RECOVER = {'VEN': ['PARSE_DIR', 'VARIABLES'], 'FVG': [], 'TN': [],
                   'BZ': ['PARSE_DIR', 'SENSORS_URL', 'VARIABLES', 'solar_moment'],
                   'LOM': ['DATA_URL', 'OPERATORS', 'PARSE_DIR', 'REGISTRY_URL', 'SKIP_DIR_VALUES', 'SKIP_VALUES',
                           'VARIABLES'],
                   'ER': ['API_URL', 'PARSE_DIR', 'VALUE_CONV', 'VARIABLES', 'solar_moment']}
READ_BY_CHECK_UPDATES = {'VEN': ['BASE_URL', 'STATION_LISTS', 'VARIABLES'],
                         'FVG': ['EXTRA', 'HOME_URL', 'META_TAGS', 'STATION_URL', 'VARIABLES'],
                         'TN': ['EXTRA', 'LIST_URL', 'NS', 'STATION_URL', 'VARIABLES'],
                         'BZ': ['SENSORS_URL', 'STATIONS_URL', 'VARIABLES'],
                         'LOM': ['REGISTRY_URL', 'VARIABLES'],
                         'ER': ['API_URL', 'VARIABLES']}


def load_file(path):
    spec = importlib.util.spec_from_file_location(os.path.splitext(os.path.basename(path))[0], path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path):
    with open(path, encoding='utf-8') as fp:
        return json.load(fp)


def same(name, content, expected, json_equal):
    if json_equal and name.endswith('.json'):
        # il JSON prodotto si riscrive come lo scriveva lo script di prima (accenti in sequenze di escape, separatori
        # compatti, chiavi nel suo ordine) e poi si confronta byte per byte: si perdona solo la codifica degli accenti,
        # non l'ordine delle stazioni (export_web ne dipende) né i tipi dei valori (1, 1.0 e true)
        content = json.dumps(json.loads(content.decode('utf-8')), separators=(',', ':')).encode('ascii')
    return content == expected


class TestScarico(unittest.TestCase):

    def check_source(self, fonte, giro, script, args, json_equal=False):
        """Due giri di script sulle risposte di fonte/giro: stessi codici di uscita, stessi file (byte per byte; con
        json_equal i .json prodotti dopo averli riscritti con il codificatore di prima) e stesse cartelle degli
        attesi. Restituisce i due giri."""
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
        return runs

    def test_invasi(self):
        self.check_source('invasi', 'normale', 'dati_invasi.py', ['-r', 'all'])

    def test_aria(self):
        self.check_source('aria', 'normale', 'dati_aria.py', ['-r', 'all'])

    def test_aria_bz_errore(self):
        # come normale, ma la serie della stazione BZ4 risponde 500: BZ4 salta (niente valori di BZ, la stazione
        # prima), le altre stazioni e le altre reti restano uguali
        self.check_source('aria', 'bz_errore', 'dati_aria.py', ['-r', 'all'])

    def test_aria_tn_senza_coordinate(self):
        # come normale, ma il bollettino TN ha una stazione senza coordinate in testa: salta, il resto di TN si scrive
        self.check_source('aria', 'tn_senza_coordinate', 'dati_aria.py', ['-r', 'all'])

    def test_laghi(self):
        self.check_source('laghi', 'normale', 'dati_laghi.py', [])

    def test_mare_reti(self):
        self.check_source('mare', 'reti', 'dati_mare.py', ['-r', 'VEN,ER,FVG'])

    def test_mare_ven_file_mancanti(self):
        # derivata da mare/reti: le risposte dei file CPSM 'livello' e 'temparia' sono sostituite dalla pagina di blocco
        # Incapsula registrata il 2026-11-04, perché CPSM a volte blocca i client automatici. Prova che la rete VEN
        # salta i file mancanti e scrive il resto (senza le loro variabili e le stazioni che avevano solo loro), e che
        # ER e FVG restano uguali
        self.check_source('mare', 'ven_file_mancanti', 'dati_mare.py', ['-r', 'VEN,ER,FVG'])

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
    # byte diversi: con json_equal i JSON prodotti si riscrivono come li scriveva lui, poi si confrontano byte per byte
    def test_veneto_oggi(self):
        self.check_source('veneto', 'oggi', 'dati_veneto.py', ['-date', 't'], json_equal=True)

    def test_veneto_ieri(self):
        self.check_source('veneto', 'ieri', 'dati_veneto.py', ['-date', 'y'], json_equal=True)

    def test_fvg(self):
        self.check_source('fvg', 'normale', 'dati_fvg.py', [])

    def test_trentino(self):
        self.check_source('trentino', 'normale', 'dati_trentino.py', [])

    def test_altoadige(self):
        self.check_source('altoadige', 'normale', 'dati_altoadige.py', [])

    def test_lombardia(self):
        self.check_source('lombardia', 'normale', 'dati_lombardia.py', [])

    def test_lombardia_429(self):
        # come normale, ma la prima chiamata ai dati risponde sempre 429 (il portale limita le chiamate anonime): dopo
        # i tentativi lo script esce con l'errore, senza file scaricati né dati scritti
        runs = self.check_source('lombardia', '429', 'dati_lombardia.py', [])
        # file e codici di uscita non dicono quanti tentativi fa né se esce con il messaggio o con un crash: in ogni
        # giro quattro chiamate, con le pause di 5, 15 e 30 secondi, poi il messaggio dell'errore
        for proc in runs:
            self.assertEqual(re.findall(r'riprovo fra (\d+) s', proc.stdout), ['5', '15', '30'])
            self.assertEqual(proc.stderr.strip().splitlines()[-1],
                             'Error downloading https://www.dati.lombardia.it/resource/647i-nhxk.json: HTTP 429')

    def test_emilia_romagna(self):
        self.check_source('emilia_romagna', 'normale', 'dati_emilia_romagna.py', [])

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
