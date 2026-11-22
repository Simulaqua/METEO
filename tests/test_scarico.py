# Prove degli script di scarico: ogni fonte gira due volte di fila sulle risposte registrate, senza rete e con
# l'orologio fermo, e deve finire con gli stessi codici di uscita e lasciare gli stessi file e le stesse cartelle dello
# script di prima (tests/fixtures/scarico/<fonte>/<giro>/: codici.json, attesi/, cartelle.json). Solo sul Mac.
# Una fonte nuova: tests/registratore.py registra, poi attesi, con lo script di prima; poi la sua prova qui.
#   /usr/bin/python3 -m unittest tests.test_scarico -v
import base64, contextlib, glob, gzip, importlib.util, io, json, os, re, sys, tempfile, unittest, urllib.parse
from unittest import mock

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests import registratore

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'scarico')
# i nomi che recover.py e check_updates.py leggono negli script regionali, per regione (per i livelli AQ_* e PC_* di
# check_updates.py in dati_aria.py e dati_pc.py); di FVG e TN recover.py ha solo il nome del modulo (le fonti non hanno
# storico da recuperare): la prova controlla che si importi.
# recover.py li legge direttamente: un nome sparito ferma la sua regione con ERRORE
READ_BY_RECOVER = {'VEN': ['PARSE_DIR', 'VARIABLES'], 'FVG': [], 'TN': [],
                   'BZ': ['PARSE_DIR', 'SENSORS_URL', 'VARIABLES', 'solar_moment'],
                   'LOM': ['DATA_URL', 'OPERATORS', 'PARSE_DIR', 'REGISTRY_URL', 'SKIP_DIR_VALUES', 'SKIP_VALUES',
                           'VARIABLES', 'compact_moment', 'coordinate'],
                   'ER': ['API_URL', 'PARSE_DIR', 'VALUE_CONV', 'VARIABLES', 'solar_moment']}
READ_BY_CHECK_UPDATES = {'VEN': ['BASE_URL', 'STATION_LISTS', 'VARIABLES'],
                         'FVG': ['EXTRA', 'HOME_URL', 'META_TAGS', 'STATION_URL', 'VARIABLES'],
                         'TN': ['EXTRA', 'LIST_URL', 'NS', 'STATION_URL', 'VARIABLES'],
                         'BZ': ['SENSORS_URL', 'STATIONS_URL', 'VARIABLES'],
                         'LOM': ['REGISTRY_URL', 'VARIABLES'],
                         'ER': ['API_URL', 'VARIABLES'],
                         'AQ_VEN': ['VEN_BASE', 'VEN_POLLMAP'], 'AQ_LOM': ['LOM_ANAGRAFICA', 'LOM_TYPEMAP'],
                         'AQ_BZ': ['BZ_AIRQUALITY', 'BZ_MCODEMAP'], 'AQ_TN': ['TN_POLLMAP', 'TN_URL'],
                         'AQ_ER': ['ER_STATIONS_CSV'], 'PC_FVG': ['FVG_API', 'FVG_MAP'],
                         'PC_TN': ['TN_BASE', 'TN_MAP']}


def load_file(path):
    spec = importlib.util.spec_from_file_location(os.path.splitext(os.path.basename(path))[0], path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path):
    with open(path, encoding='utf-8') as fp:
        return json.load(fp)


def decode(content):
    return json.loads(content.decode('utf-8'))


def same_as_seed(run_dir, name, content):
    """True se il giro ha un file di partenza name (in iniziali/) con lo stesso contenuto JSON di content."""
    seed = os.path.join(run_dir, 'iniziali', name)
    if not os.path.isfile(seed):
        return False
    with open(seed, 'rb') as fp:
        return decode(fp.read()) == decode(content)


def same(name, content, expected, json_equal, decoded):
    if name.startswith(decoded):
        return decode(content) == decode(expected)
    if json_equal and name.endswith('.json'):
        # il JSON prodotto si riscrive come lo scriveva lo script di prima (accenti in sequenze di escape, separatori
        # compatti, chiavi nel suo ordine) e poi si confronta byte per byte: si perdona solo la codifica degli accenti,
        # non l'ordine delle stazioni (export_web ne dipende) né i tipi dei valori (1, 1.0 e true)
        content = json.dumps(json.loads(content.decode('utf-8')), separators=(',', ':')).encode('ascii')
    return content == expected


ER_REF = 1793869200000                  # 2026-11-05 09:00 UTC
ER_QUARTER = 15 * 60 * 1000


class Answer:
    """Risposta finta di dati_emilia_romagna.call: il corpo JSON di data."""

    def __init__(self, data):
        self.content = json.dumps(data).encode('utf-8')


class TestScarico(unittest.TestCase):

    def check_source(self, fonte, giro, script, args, json_equal=False, decoded=()):
        """Due giri di script sulle risposte di fonte/giro, con i suoi file di partenza: stessi codici di uscita, stessi
        file (byte per byte; con json_equal i .json prodotti dopo averli riscritti con il codificatore di prima) e
        stesse cartelle degli attesi. I file che cominciano con un prefisso di decoded si confrontano dopo json.loads e
        sono prodotti solo se il loro contenuto è cambiato rispetto al file di partenza, o se questo manca: un cambio
        di formato non fa comparire tra i prodotti quelli rimasti uguali. Restituisce i due giri."""
        run_dir = os.path.join(FIXTURES, fonte, giro)
        files, runs, folders = registratore.replay_twice(run_dir, script, args)
        files = {name: content for name, content in files.items()
                 if not (name.startswith(decoded) and same_as_seed(run_dir, name, content))}
        output = ''.join(proc.stdout + proc.stderr for proc in runs)
        self.assertEqual([proc.returncode for proc in runs], read_json(os.path.join(run_dir, 'codici.json')),
                         'codici di uscita diversi; uscita dei due giri:\n' + output[-3000:])
        expected = {name: content for name, content in registratore.tree(os.path.join(run_dir, 'attesi')).items()
                    if os.path.basename(name) != '.DS_Store'}          # lasciato dal Finder, non dallo script
        self.assertEqual(sorted(files), sorted(expected), 'file prodotti diversi dagli attesi')
        different = [name for name in sorted(files)
                     if not same(name, files[name], expected[name], json_equal, decoded)]
        self.assertEqual(different, [], 'file con un contenuto diverso dagli attesi')
        self.assertEqual(folders, read_json(os.path.join(run_dir, 'cartelle.json')), 'cartelle diverse dalle attese')
        return runs

    def assert_warnings(self, runs, patterns):
        """In ogni giro una riga WARN per ogni espressione regolare di patterns, nello stesso ordine, e nessun'altra:
        un elemento saltato deve lasciare traccia nel log anche senza --debug."""
        for proc in runs:
            lines = [line for line in proc.stdout.splitlines() if line.startswith('WARN:')]
            self.assertEqual(len(lines), len(patterns), 'righe WARN del giro:\n' + '\n'.join(lines))
            for line, pattern in zip(lines, patterns):
                self.assertRegex(line, pattern)

    def check_er_instants(self, giro):
        """Gli attesi di emilia_romagna/giro (uguali ai file prodotti, li confronta check_source): ogni variabile ha i
        valori all'istante dell'intestazione {'time': ...} della sua risposta registrata, e solo delle stazioni che
        hanno misurato a quell'istante, non delle voci 'precedente' S (un valore di prima ripetuto)."""
        er = load_file(os.path.join(registratore.PROJECT, 'dati_emilia_romagna.py'))
        variables = {descriptor: var for var, (descriptor, _) in er.VARIABLES.items()}
        run_dir = os.path.join(FIXTURES, 'emilia_romagna', giro)
        checked = set()
        for path in glob.glob(os.path.join(run_dir, 'risposte', '*.json.gz')):
            with gzip.open(path, 'rt', encoding='utf-8') as fp:
                response = json.load(fp)
            query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(response['url']).query))
            if 'time' not in query:
                continue                    # la serie di REF_STATION
            var = variables[query['variabile']]
            answer = json.loads(base64.b64decode(response['body']).decode('utf-8'))
            moment = er.solar_moment(int(answer[0]['time']))
            measured = {item['idstazione'] for item in answer[1:]
                        if item['value'] is not None and item['precedente'] != 'S'}
            day = read_json(os.path.join(run_dir, 'attesi', 'ER', 'data-parsed', var, var + '-' + moment[:8] + '.json'))
            self.assertEqual(set(day), measured, var)
            for code, record in day.items():
                self.assertEqual(record['MISURE']['ISTANTE'], [moment], var + ' ' + code)
            checked.add(var)
        self.assertEqual(checked, set(er.VARIABLES))

    def test_invasi(self):
        self.check_source('invasi', 'normale', 'dati_invasi.py', ['-r', 'all'])

    def test_aria(self):
        self.check_source('aria', 'normale', 'dati_aria.py', ['-r', 'all'])

    def test_aria_bz_errore(self):
        # come normale, ma la serie della stazione BZ4 risponde 500: BZ4 salta (niente valori di BZ, la stazione
        # prima), con un avviso nel log; le altre stazioni e le altre reti restano uguali
        runs = self.check_source('aria', 'bz_errore', 'dati_aria.py', ['-r', 'all'])
        self.assert_warnings(runs, [r'^WARN: \[BZ\] stazione BZ4 saltata \(.+\)$'])

    def test_aria_tn_senza_coordinate(self):
        # come normale, ma il bollettino TN ha una stazione senza coordinate in testa: salta, con un avviso nel log, e
        # il resto di TN si scrive
        runs = self.check_source('aria', 'tn_senza_coordinate', 'dati_aria.py', ['-r', 'all'])
        self.assert_warnings(runs, [r'^WARN: \[TN\] stazione senza coordinate: Stazione Inventata$'])

    def test_laghi(self):
        self.check_source('laghi', 'normale', 'dati_laghi.py', [])

    def test_mare_reti(self):
        self.check_source('mare', 'reti', 'dati_mare.py', ['-r', 'VEN,ER,FVG'])

    def test_mare_ven_file_mancanti(self):
        # derivata da mare/reti: le risposte dei file CPSM 'livello' e 'temparia' sono sostituite dalla pagina di blocco
        # Incapsula registrata il 2026-11-04, perché CPSM a volte blocca i client automatici. Prova che la rete VEN
        # salta i file mancanti, con un avviso nel log per ognuno, e scrive il resto (senza le loro variabili e le
        # stazioni che avevano solo loro), e che ER e FVG restano uguali
        runs = self.check_source('mare', 'ven_file_mancanti', 'dati_mare.py', ['-r', 'VEN,ER,FVG'])
        self.assert_warnings(runs, [r'^WARN: \[VEN\] file livello saltato \(.+\)$',
                                    r'^WARN: \[VEN\] file temparia saltato \(.+\)$'])

    def test_mare_acqven(self):
        self.check_source('mare', 'acqven', 'dati_mare.py', ['-r', 'ACQVEN'])

    def test_mare_terra_er(self):
        # le risposte di mare/reti con l'anagrafica dell'allerta in iniziali/: le sue stazioni prendono dal file
        # di ARPAE solo le grandezze che l'API non dà, le altre entrano tutte con la sigla A_
        self.check_source('mare', 'terra_er', 'dati_mare.py', ['-r', 'ER'])

    def test_liguria(self):
        self.check_source('liguria', 'normale', 'dati_liguria.py', [])

    def test_liguria_full(self):
        self.check_source('liguria', 'full', 'dati_liguria.py', ['--full'])

    def test_liguria_pioggia_ora_in_corso(self):
        # la serie oraria di OMIRL ha anche l'ora in corso, segnata con la sua fine e ancora parziale: il giro
        # la salta, e un'ora già salvata prende il valore della serie, che intanto si è completato
        lig = load_file(os.path.join(registratore.PROJECT, 'dati_liguria.py'))
        pluvio = [('LIG1', '1', 'Uno', 44.4, 8.9, None, None)]
        snapshot = lambda cls: pluvio if cls == 'Pluvio' else []
        csv = '19/11/2026 11:00;17.5;\n19/11/2026 12:00;0.4;\n19/11/2026 13:00;0.2;\n'      # UTC
        now = lig.datetime.datetime(2026, 11, 19, 13, 50)                                    # solare
        with tempfile.TemporaryDirectory() as folder, \
                mock.patch.object(lig, 'snapshot', side_effect=snapshot), \
                mock.patch.object(lig.comune, 'get_text', return_value=csv), \
                mock.patch.object(lig.comune, 'now_solar', return_value=now), \
                mock.patch.object(lig.comune, 'BASE', folder), \
                mock.patch.object(sys, 'argv', ['dati_liguria.py']), \
                contextlib.redirect_stdout(io.StringIO()):
            day = os.path.join(folder, 'LIG', 'data-parsed', 'PREC', 'PREC-20261119.json')
            os.makedirs(os.path.dirname(day))
            with open(day, 'w', encoding='utf-8') as fp:
                json.dump({'LIG1': {'STAZIONE': {'SCODE': 'LIG1'}, 'UM': 'mm',
                                    'MISURE': {'ISTANTE': ['202611191200'], 'VALORE': [5.2]}}}, fp)
            lig.main()
            measures = read_json(day)['LIG1']['MISURE']
        self.assertEqual(measures, {'ISTANTE': ['202611191200', '202611191300'], 'VALORE': [17.5, 0.4]})

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

    def test_veneto_valore_arrivato_dopo(self):
        # ARPAV a volte pubblica '>>' al posto di un valore e lo mette poco dopo: il giro con un aggiornamento
        # della stazione scrive il valore al posto di '>>' e le misure che mancano, anche prima dell'ultima
        # salvata; un numero già salvato resta
        ven = load_file(os.path.join(registratore.PROJECT, 'dati_veneto.py'))
        station = ''.join('<%s>%s</%s>' % (field, value, field) for field, value in [
            ('IDSTAZ', '610'), ('NOME', 'Fener'), ('X', '11.9'), ('Y', '45.9'), ('QUOTA', '175'),
            ('TIPOSTAZ', 'METEO'), ('COMUNE', 'SETTEVILLE'), ('PROVINCIA', 'BL'),
            ('ATTIVAZIONE', '09/01/2021')])
        rows = [('2030', '0.0'), ('2100', '0.0'), ('2130', '0.2'), ('2200', '0.4'), ('2230', '0.0')]
        data = ''.join('<DATI ISTANTE="20261117%s"><VM>%s</VM></DATI>' % row for row in rows)
        with tempfile.TemporaryDirectory() as folder:
            ven.DOWNLOAD_DIR = os.path.join(folder, 'data-downloaded')
            ven.PARSE_DIR = os.path.join(folder, 'data-parsed')
            ven.STATIONS_JSON = os.path.join(ven.PARSE_DIR, 'stazioni.json')
            day = os.path.join(ven.PARSE_DIR, 'PREC', 'PREC-20261117.json')
            os.makedirs(os.path.dirname(day))
            os.makedirs(os.path.join(ven.DOWNLOAD_DIR, 'meteo'))
            with open(ven.STATIONS_JSON, 'w', encoding='utf-8') as fp:
                json.dump({'610': {'IDSTAZ': '610', 'LINKSTAZ': '0610.xml'}}, fp)
            with open(day, 'w', encoding='utf-8') as fp:
                json.dump({'610': {'ISTANTERUN': '202611172215', 'ORALEGALE': 0, 'STAZIONE': {},
                                   'SENSORE': {},
                                   'MISURE': {'ISTANTE': ['202611172030', '202611172130', '202611172200'],
                                              'ORALEGALE': [7, 7, 7], 'VM': ['0.0', '>>', '0.1']}}}, fp)
            with open(os.path.join(ven.DOWNLOAD_DIR, 'meteo', '20261118-084800-0610.xml'), 'w') as fp:
                fp.write('<CONTENITORE><ISTANTERUN>202611180847</ISTANTERUN><STAZIONE>%s<SENSORE>'
                         '<TYPE>PREC</TYPE>%s</SENSORE></STAZIONE></CONTENITORE>' % (station, data))
            with contextlib.redirect_stdout(io.StringIO()):
                ven.parse('20261118-084800', ['2026', '11', '17'])
            measures = read_json(day)['610']['MISURE']
        dst = int(ven.comune.is_dst_civil(ven.datetime.datetime.now()))
        self.assertEqual(measures['ISTANTE'], ['20261117' + moment for moment, _ in rows])
        self.assertEqual(measures['VM'], ['0.0', '0.0', '0.2', '0.1', '0.0'])
        self.assertEqual(measures['ORALEGALE'], [7, dst, dst, 7, dst])

    def test_fvg(self):
        self.check_source('fvg', 'normale', 'dati_fvg.py', [])

    def fvg_home(self, answers):
        """dati_fvg.home_page con comune.get che dà, una chiamata dopo l'altra, answers (un'eccezione si
        solleva): il contenuto salvato (None se il giro si ferma), le attese e l'uscita."""
        fvg = load_file(os.path.join(registratore.PROJECT, 'dati_fvg.py'))
        waits = []
        fvg.time = mock.Mock(sleep=waits.append)
        with tempfile.TemporaryDirectory() as folder, \
                mock.patch.object(fvg.comune, 'get', side_effect=answers), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            path = os.path.join(folder, 'home.html')
            try:
                fvg.home_page(path)
            except SystemExit as stop:
                return None, waits, str(stop)
            with open(path, 'rb') as fp:
                return fp.read(), waits, output.getvalue()

    def test_fvg_rete_assente(self):
        # di notte la rete del Pi manca per una decina di minuti e la fonte ha solo l'ultima ora: senza la
        # pagina principale il giro riprova dopo 5 minuti, fino a 3 tentativi, poi si ferma con l'errore
        down = requests.ConnectionError('rete assente')
        page = mock.Mock(content=b'<a href="stazioni/101.xml">')
        content, waits, output = self.fvg_home([down, page])
        self.assertEqual((content, waits), (b'<a href="stazioni/101.xml">', [300]))
        self.assertIn('riprovo fra 300 s', output)
        content, waits, error = self.fvg_home([down, down, down])
        self.assertEqual((content, waits), (None, [300, 300]))
        self.assertEqual(error, 'Error downloading https://dev.meteo.fvg.it: rete assente')

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
        self.check_er_instants('normale')

    def test_emilia_romagna_quarto_dispari(self):
        # registrato dal vivo a un quarto :15/:45: la pioggia (totali di 30 minuti, alle :00 e alle :30) non ha valori a
        # quell'istante, solo qualche valore di prima ripetuto ('precedente' S), che non si scrive: derive.py lo
        # conterebbe due volte nelle PREC1..48
        self.check_source('emilia_romagna', 'quarto_dispari', 'dati_emilia_romagna.py', [])
        self.check_er_instants('quarto_dispari')

    def test_emilia_romagna_risposta_senza_istante(self):
        # una risposta senza l'intestazione {'time': ...} non dice a che istante sono i valori: la variabile salta, con
        # un avviso nel log, le altre si scrivono
        er = load_file(os.path.join(registratore.PROJECT, 'dati_emilia_romagna.py'))
        station = {'idstazione': '7', 'nomestaz': 'S. Pietro Capofiume', 'lat': '4465378', 'lon': '1162264',
                   'precedente': 'N'}
        answers = {'TEMP': [{'time': '1793863800000'}, dict(station, value=281.55)],     # 07:30 UTC
                   'UMID': [dict(station, value=77)]}
        with tempfile.TemporaryDirectory() as folder:
            er.DOWNLOAD_DIR = os.path.join(folder, 'data-downloaded')
            er.PARSE_DIR = os.path.join(folder, 'data-parsed')
            er.STATIONS_JSON = os.path.join(er.PARSE_DIR, 'stazioni.json')
            for var, answer in answers.items():
                path = os.path.join(er.DOWNLOAD_DIR, er.RAW_SUBDIR, '20261105-083900-' + var + '.json')
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, 'w', encoding='utf-8') as fp:
                    json.dump(answer, fp)
            with contextlib.redirect_stdout(io.StringIO()) as output:
                er.parse('20261105-083900')
            self.assertIn('WARN: [ER] variabile UMID saltata (risposta senza istante)\n', output.getvalue())
            self.assertEqual(os.listdir(os.path.join(er.PARSE_DIR, 'UMID')), [])
            temp = read_json(os.path.join(er.PARSE_DIR, 'TEMP', 'TEMP-20261105.json'))
            self.assertEqual(temp['7']['MISURE'], {'ISTANTE': ['202611050830'], 'VALORE': [8.4]})

    def test_emilia_romagna_quarto_d_ora(self):
        # l'istante del giro è il campione di riferimento arrotondato per difetto al quarto d'ora: quasi tutte le
        # stazioni misurano ogni 15 minuti e a un istante di 5 minuti ne rispondono pochissime
        er = load_file(os.path.join(registratore.PROJECT, 'dati_emilia_romagna.py'))
        base = 1762335000000          # 2025-11-05 09:30:00 UTC, su un quarto d'ora
        minute = 60 * 1000
        for offset, expected in [(0, 0), (5 * minute, 0), (14 * minute + 59999, 0), (15 * minute, 15 * minute),
                                 (35 * minute, 30 * minute)]:
            self.assertEqual(er.quarter_hour(base + offset), base + expected, offset)

    def er_run(self, saved, backfill_error=False):
        """Un giro di dati_emilia_romagna (download e parse) in una cartella temporanea, con la stazione 7
        nell'archivio di TEMP agli istanti saved (ora solare, valore 0.0). L'API finta ha il campione di
        riferimento alle 09:00 UTC del 2026-11-05 e a ogni time risponde con i valori di un'ora prima
        (283.15 K, cioè 10.0 °C); con backfill_error le richieste prima del time del giro sono un errore di
        rete. Restituisce i time chiesti, l'uscita del giro e le MISURE di TEMP della stazione 7."""
        er = load_file(os.path.join(registratore.PROJECT, 'dati_emilia_romagna.py'))
        station = {'idstazione': '7', 'nomestaz': 'S. Pietro Capofiume', 'lat': '4465378', 'lon': '1162264',
                   'precedente': 'N'}
        asked = []

        def call(endpoint, params, timeout, debug=False):
            if endpoint == 'get-time-series':
                return Answer([{'t': ER_REF + 7 * 60 * 1000, 'v': 0.5}])
            asked.append(int(params['time']))
            if backfill_error and asked[-1] < ER_REF:
                raise requests.ConnectionError('rete assente')
            return Answer([{'time': str(asked[-1] - 3600 * 1000)}, dict(station, value=283.15)])

        with tempfile.TemporaryDirectory() as folder:
            er.call = call
            er.DOWNLOAD_DIR = os.path.join(folder, 'data-downloaded')
            er.PARSE_DIR = os.path.join(folder, 'data-parsed')
            er.STATIONS_JSON = os.path.join(er.PARSE_DIR, 'stazioni.json')
            day = os.path.join(er.PARSE_DIR, 'TEMP', 'TEMP-20261105.json')
            os.makedirs(os.path.dirname(day))
            with open(day, 'w', encoding='utf-8') as fp:
                json.dump({'7': {'STAZIONE': {'SCODE': '7'}, 'UM': '°C',
                                 'MISURE': {'ISTANTE': saved, 'VALORE': [0.0] * len(saved)}}}, fp)
            with contextlib.redirect_stdout(io.StringIO()) as output:
                er.parse(er.download())
            return asked, output.getvalue(), read_json(day)['7']['MISURE']

    def test_emilia_romagna_quarti_mancanti(self):
        # il campione di riferimento a volte salta un quarto d'ora e un giro fallito ne perde uno: ogni giro
        # chiede anche i quarti delle 2 ore prima che mancano nell'archivio, dopo il primo che c'è (con
        # l'archivio vuoto o dopo un buco più lungo niente, ci pensa recover.py), e li inserisce in ordine
        asked, _, measures = self.er_run(['202611050745', '202611050800', '202611050815', '202611050845'])
        self.assertEqual(sorted(set(asked)), [ER_REF - 2 * ER_QUARTER, ER_REF])
        self.assertEqual(len(asked), 12)                # le 6 variabili a ogni time
        self.assertEqual(measures['ISTANTE'], ['202611050745', '202611050800', '202611050815',
                                               '202611050830', '202611050845', '202611050900'])
        self.assertEqual(measures['VALORE'], [0.0, 0.0, 0.0, 10.0, 0.0, 10.0])

    def test_emilia_romagna_quarti_mancanti_errore(self):
        # un errore di rete ferma il recupero, così un server lento non accumula attese: resta il quarto del
        # giro, gli altri li chiede il giro dopo
        asked, output, measures = self.er_run(['202611050745', '202611050800'], backfill_error=True)
        self.assertEqual(len(asked), 7)                 # le 6 variabili del giro, poi il primo errore
        self.assertIn('SKIP', output)
        self.assertEqual(measures['ISTANTE'], ['202611050745', '202611050800', '202611050900'])

    def test_recover_er(self):
        # registrato dal vivo; file di partenza: ER/data-parsed/stazioni.json con le prime 3 stazioni di
        # emilia_romagna/normale (la fonte storica di ER non ha un elenco: recover.py chiede le stazioni dell'archivio)
        self.check_source('recover', 'er', 'recover.py', ['-r', 'ER', '--force', '--days', '1'])

    def test_recover_bz(self):
        # registrato dal vivo, poi ridotto: nella risposta dei sensori restano i primi 10 SCODE (nell'ordine della
        # risposta), le risposte /timeseries delle altre stazioni sono tolte e quelle della prima coppia rimasta
        # (66500MS/SD, chiesta due volte: il sensore compare due volte nella risposta) rispondono 500 con il loro
        # corpo: la coppia salta (niente SOLEGG di 66500MS), le altre si scrivono
        self.check_source('recover', 'bz', 'recover.py', ['-r', 'BZ', '--force', '--days', '1'])

    def test_recover_lom(self):
        # registrato dal vivo, poi ridotto: nell'anagrafica le righe dei primi 5 idstazione (nell'ordine delle righe),
        # nelle 6 risposte con $where le righe dei loro sensori; l'ultimo istante del dataset ($limit=1) com'era
        self.check_source('recover', 'lom', 'recover.py', ['-r', 'LOM', '--force', '--days', '1'])

    def test_recover_tutte(self):
        # senza rete, con l'orologio fermo al 2026-11-05 13:00 UTC (14:00 solari), su un archivio di partenza scritto
        # una volta da uno script (iniziali/): una stazione S1, un file del giorno <VAR>-AAAAMMGG.json per ogni giorno
        # della serie con MISURE.ISTANTE (ora solare) e VALORE (sempre 1.0):
        #   BZ e LOM  TEMP  ogni 10 minuti dal 2026-10-29 00:00 al 2026-11-05 13:50
        #   ER        TEMP  ogni 15 minuti dal 2026-11-02 00:00 al 2026-11-05 13:45
        #   VEN       TEMP  ogni 30 minuti dal 2026-10-29 00:00 al 2026-11-05 13:30, senza il 2026-11-02 dalle 10:00
        #                   alle 12:30
        #   AQ_VEN    PM10  ogni ora dal 2026-10-29 00:00 al 2026-11-05 13:00
        #   AQ_LOM    PM10  ogni ora dal 2026-10-29 00:00 al 2026-11-05 03:00
        # Scattano solo VEN (buco interno) e AQ_LOM (buco in coda): i loro recuperi sono sottoprocessi, annotati in
        # sottoprocessi.txt (l'unico file prodotto) e mai lanciati; le altre regioni saltano
        runs = self.check_source('recover', 'tutte', 'recover.py', ['-r', 'all'])
        for proc in runs:
            lines = proc.stdout.splitlines()
            for line in ['[VEN] gate: buco massimo 210 min (> 90)', '[BZ] gate (7gg): continuo (buco max 10 min)',
                         '[ER] gate (3gg): continuo (buco max 15 min)', '[LOM] gate (7gg): continuo (buco max 10 min)',
                         '[AQ_VEN] gate: continuo (buco max 60 min)',
                         '[AQ_LOM] gate: buco in coda 660 min (ultimo campione vecchio)',
                         '[PC_TN] nessun archivio: salto.']:
                self.assertIn(line, lines)

    def test_check_updates(self):
        # registrato dal vivo. Stato di partenza (iniziali/.tracking/): gli stati di un primo giro sulle stesse
        # risposte, senza gli ultimi 2 codici di VEN, BZ e LOM e senza quello di PC_TN; poi la risposta di AQ_TN è
        # diventata 404 (con il suo corpo). Nel primo giro 6 stazioni nuove e lo stato di PC_TN fatto da capo, nel
        # secondo nessuna novità. Lo stato si confronta decodificato: conta il contenuto, non il formato
        runs = self.check_source('check_updates', 'campione', 'check_updates.py', ['-r', 'all', '--sample', '3'],
                                 decoded=('.tracking/',))
        self.assertEqual([proc.stdout.count('NUOVA STAZIONE') for proc in runs], [6, 0])
        # la 404 non cambia i file (lo stato di AQ_TN resta quello di partenza, anche leggendo il corpo): si vede qui
        for proc in runs:
            self.assertIn('=== AQ_TN ===\n  stazioni: 0 nel feed | nuove: 0\n', proc.stdout)

    def test_moduli_letti_da_recover_e_check_updates(self):
        # i due programmi leggono le impostazioni degli script regionali (recover.py li importa come moduli,
        # check_updates.py pure); recover.py si muove solo dopo un buco nei dati, quindi un nome
        # sparito non si vedrebbe subito
        recover = load_file(os.path.join(registratore.PROJECT, 'recover.py'))
        check_updates = load_file(os.path.join(registratore.PROJECT, 'check_updates.py'))
        loaded = [(importlib.import_module(recover.REGION_MODULE[region]), names)
                  for region, names in READ_BY_RECOVER.items()]
        loaded += [(importlib.import_module(check_updates.REGIONS[region]), names)
                   for region, names in READ_BY_CHECK_UPDATES.items()]
        for module, names in loaded:
            for name in names:
                self.assertTrue(hasattr(module, name), '%s non ha %s' % (module.__file__, name))


if __name__ == '__main__':
    unittest.main()
