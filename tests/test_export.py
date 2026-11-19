# Export del sito (export_web.py).
# Ora legale: l'archivio e' in ORA SOLARE (UTC+1 fisso) e l'export lo converte nell'ora civile italiana (l'orologio
# da muro). Valori attesi presi dall'orologio reale dei cambi d'ora del 2026:
#   29/03 alle 01:00 UTC = 02:00 solari: le 02:00 CET diventano 03:00 CEST
#   25/10 alle 01:00 UTC = 02:00 solari: le 03:00 CEST tornano 02:00 CET (l'ora 02:00-03:00 si ripete)
# Le altre prove lanciano l'export vero (export) su un archivio scritto apposta, con l'orologio fermo di tests/rete.py.
#   /usr/bin/python3 -m unittest tests.test_export -v
import calendar, datetime, gzip, json, math, os, sys, tempfile, unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import comune
import derive
import export_web as ew
from tests import rete

LAKE_LEVEL = {'LIVLAGO': [('202611051200', 65.2)]}          # una lettura dentro la finestra di rete.EPOCH


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fp:
        json.dump(data, fp)


def station(lat, lon):
    """Il record di una stazione in stazioni.json."""
    return {'NOME': 'Prova', 'LAT': lat, 'LON': lon}


def export(folder, archive, epoch=rete.EPOCH, args=()):
    """L'export di tutte le regioni in folder, con l'orologio fermo a epoch, sull'archivio
    {regione: {scode: (record di stazioni.json, {variabile: [(istante, valore)]})}}; le letture di una variabile vanno
    nel file del loro giorno. args = opzioni in piu' di export_web.py. Ritorna il processo."""
    rete.copy_programs(folder)
    for region, stations in archive.items():
        parsed = os.path.join(folder, region, 'data-parsed')
        write_json(os.path.join(parsed, 'stazioni.json'), {scode: meta for scode, (meta, _) in stations.items()})
        day_files = {}
        for scode, (meta, readings) in stations.items():
            for var, points in readings.items():
                for day in sorted({moment[:8] for moment, _ in points}):
                    day_points = [(moment, value) for moment, value in points if moment[:8] == day]
                    path = os.path.join(parsed, var, '%s-%s.json' % (var, day))
                    day_files.setdefault(path, {})[scode] = {
                        'STAZIONE': meta,
                        'MISURE': {'ISTANTE': [moment for moment, _ in day_points],
                                   comune.value_key(region): [value for _, value in day_points]}}
        for path, records in day_files.items():
            write_json(path, records)
    return rete.run([sys.executable, 'export_web.py', '-r', 'all', '--site-dir', 'site'] + list(args), folder,
                    epoch=epoch)


def stations_on_map(folder, region):
    """{scode: proprietà} delle stazioni in stations.geojson della regione, nell'ordine del file."""
    with open(os.path.join(folder, 'site', region, 'stations.geojson'), encoding='utf-8') as fp:
        return {feature['properties']['scode']: feature['properties'] for feature in json.load(fp)['features']}


class TestOraLegaleExport(unittest.TestCase):

    def test_ottobre(self):
        self.assertEqual(ew.iso_datetime('202610250059'), '2026-10-25T01:59')   # 23:59 UTC: CEST
        self.assertEqual(ew.iso_datetime('202610250159'), '2026-10-25T02:59')   # 00:59 UTC: ancora CEST
        self.assertEqual(ew.iso_datetime('202610250200'), '2026-10-25T02:00')   # 01:00 UTC: gia' CET
        self.assertEqual(ew.iso_datetime('202610250230'), '2026-10-25T02:30')   # 01:30 UTC: CET (seconda volta delle 02:30)
        self.assertEqual(ew.iso_datetime('202610250300'), '2026-10-25T03:00')   # 02:00 UTC: CET

    def test_marzo(self):
        self.assertEqual(ew.iso_datetime('202603290159'), '2026-03-29T01:59')   # 00:59 UTC: CET
        self.assertEqual(ew.iso_datetime('202603290200'), '2026-03-29T03:00')   # 01:00 UTC: CEST

    def test_fotogrammi_del_cursore(self):
        # i fotogrammi del cursore sono le ore tonde solari, con l'epoch dell'ora civile "naive come UTC": il 25/10
        # alle 03:30 UTC gli ultimi cinque sono le 00:00-04:00 solari, cioe' 01:00 e 02:00 CEST e poi 02:00 (di nuovo),
        # 03:00 e 04:00 CET
        with tempfile.TemporaryDirectory() as folder:
            rete.check(export(folder, {'LAGHI': {'S1': (station(45.6, 10.6), {'TEMP': [('202610250400', 10.0)]})}},
                              epoch=calendar.timegm((2026, 10, 25, 3, 30, 0))))
            with open(os.path.join(folder, 'site', 'LAGHI', 'snap', 'TEMP.json'), encoding='utf-8') as fp:
                frames = json.load(fp)['t']
        self.assertEqual(len(frames), 168)
        self.assertEqual([datetime.datetime.utcfromtimestamp(t).strftime('%d %H:%M') for t in frames[-5:]],
                         ['25 01:00', '25 02:00', '25 02:00', '25 03:00', '25 04:00'])


class TestSerie30(unittest.TestCase):

    def test_et0_senza_le_altre_derivate(self):
        # il bilancio idrico della scheda vuole l'evapotraspirazione anche sui 30 giorni: la serie la porta, una al
        # giorno, senza le altre derivate (rugiada, gradi-giorno, cumulate della pioggia)
        temp = [(day + '%02d00' % h, 10.0 + h / 2.0) for day in ('20261103', '20261104') for h in range(24)]
        rain = [(moment, 0.2) for moment, _ in temp]
        with tempfile.TemporaryDirectory() as folder:
            rete.check(export(folder, {'LIG': {'A': (station(44.4, 8.9), {'TEMP': temp, 'PREC': rain,
                                                                            'UMID': [(m, 70) for m, _ in temp]})}},
                              args=['--days', '30', '--series-dir', 'series30', '--series-only']))
            with open(os.path.join(folder, 'site', 'LIG', 'series30', 'A.csv'), encoding='utf-8') as fp:
                rows = [r.split(',') for r in fp.read().splitlines()]
        self.assertEqual(sorted(rows[0][1:]), ['ET0', 'PREC', 'TEMP', 'UMID'])
        k = rows[0].index('ET0')
        days = [r[0] for r in rows[1:] if r[k]]
        self.assertEqual(days, ['2026-11-03T12:00', '2026-11-04T12:00'])
        self.assertTrue(all(float(r[k]) > 0 for r in rows[1:] if r[k]))


class TestPm10Anno(unittest.TestCase):

    def test_medie_giornaliere(self):
        # una media del PM10 per stazione e giorno dal 1 gennaio, come la da' ogni fonte: ER il giorno prima
        # alle 00:00, LOM il giorno stesso, VEN aggiornata piu' volte (vale l'ultima), TN e BZ le orarie
        hours = lambda day, vals: [(day + '%02d00' % h, v) for h, v in enumerate(vals)]
        archive = {
            'AQ_ER': {'E1': (station(44.5, 11.3), {'PM10': [('202611030000', 60.0), ('202611040000', 50.4)]}),
                      # il vecchio portale (fino a settembre) segnava la fine giornata alle 23:00
                      'E2': (station(44.6, 11.4), {'PM10': [('202607082300', 55.0)]})},
            'AQ_LOM': {'L1': (station(45.5, 9.2), {'PM10': [('202611030000', 50.6)]})},
            'AQ_VEN': {'V1': (station(45.4, 11.9), {'PM10': [('202611030155', 40.0), ('202611032355', 52.0)]})},
            'AQ_TN': {'T1': (station(46.1, 11.1), {'PM10': hours('20261103', [55.0] * 24)
                                                            + hours('20261104', [80.0] * 10)}),
                      # una sola oraria nel giorno (l'ora 24 del giorno prima, d'inverno): non e' una media
                      'T2': (station(46.2, 11.2), {'PM10': [('202611050000', 70.0)]})},
        }
        with tempfile.TemporaryDirectory() as folder:
            rete.check(export(folder, archive))
            got = dict((r, comune.load_json(os.path.join(folder, 'site', r, 'pm10_anno.json'))) for r in archive)
        day = lambda d: datetime.date(2026, 11, d).timetuple().tm_yday - 1
        self.assertEqual([got['AQ_ER'][k] for k in ('anno', 'soglia', 'ammessi')], [2026, 50, 35])
        er = got['AQ_ER']['s']['E1']
        self.assertEqual(len(er), day(5) + 1)                                # fino a oggi
        self.assertEqual((er[day(2)], er[day(3)]), (60, 50))                 # il giorno prima; 50.4 -> 50
        self.assertEqual(got['AQ_LOM']['s']['L1'][day(3)], 51)               # 50.6 -> 51
        self.assertEqual(got['AQ_VEN']['s']['V1'][day(3)], 52)               # l'ultima del giorno
        tn = got['AQ_TN']['s']['T1']
        self.assertEqual((tn[day(3)], tn[day(4)]), (55, None))               # 10 orarie non bastano
        self.assertEqual(er[:day(2)], [None] * day(2))
        jul8 = datetime.date(2026, 7, 8).timetuple().tm_yday - 1
        self.assertEqual(got['AQ_ER']['s']['E2'][jul8], 55)                  # il giorno della fine giornata
        self.assertNotIn('T2', got['AQ_TN']['s'])

    def test_json_prima_del_gz(self):
        # lo stesso giorno compresso e non compresso: vale il .json, come nella lettura dell'archivio
        with tempfile.TemporaryDirectory() as folder:
            parsed = os.path.join(folder, 'data-parsed')
            rec = lambda v: {'L1': {'STAZIONE': {}, 'MISURE': {'ISTANTE': ['202611030000'], 'VALORE': [v]}}}
            write_json(os.path.join(parsed, 'PM10', 'PM10-20261103.json'), rec(60.0))
            gz = os.path.join(parsed, 'PM10', 'PM10-20261103.json.gz')
            with gzip.open(gz, 'wt', encoding='utf-8') as fp:
                json.dump(rec(40.0), fp)
            row = ew.pm10_year(parsed, 'AQ_LOM', datetime.date(2026, 11, 5))['L1']
        self.assertEqual(row[datetime.date(2026, 11, 3).timetuple().tm_yday - 1], 60)


class TestMappa(unittest.TestCase):

    def test_coordinata_nan_fuori_dalla_mappa(self):
        # json.dump scrive NaN e Infinity, che non sono JSON: il sito non leggerebbe la mappa della regione
        lakes = {'S1': (station('nan', '10.5'), LAKE_LEVEL), 'S2': (station('inf', '10.5'), LAKE_LEVEL),
                 'S3': (station('45.6', '-inf'), LAKE_LEVEL), 'S4': (station('45.6', '10.6'), LAKE_LEVEL)}
        with tempfile.TemporaryDirectory() as folder:
            rete.check(export(folder, {'LAGHI': lakes}))
            with open(os.path.join(folder, 'site', 'LAGHI', 'stations.geojson'), encoding='utf-8') as fp:
                text = fp.read()
            series = sorted(os.listdir(os.path.join(folder, 'site', 'LAGHI', 'series')))
        self.assertNotIn('NaN', text)
        self.assertNotIn('Infinity', text)
        self.assertEqual([feature['properties']['scode'] for feature in json.loads(text)['features']], ['S4'])
        self.assertEqual(series, ['S1.csv', 'S2.csv', 'S3.csv', 'S4.csv'])     # tutte esportate, in mappa solo S4

    def test_umidita_sempre_a_zero(self):
        # drop_zero_glitches toglie le letture UMID=0, impossibili all'aperto: alla stazione con l'umidita' sempre a
        # zero restava una serie vuota, max() cadeva e l'export si fermava senza le regioni dopo (LAGHI viene dopo LIG)
        temp = [('202611051100', 12.0), ('202611051200', 12.5)]
        ligurian = {'A': (station(44.4, 8.9), {'TEMP': temp, 'UMID': [(moment, 0) for moment, _ in temp]}),
                    'B': (station(44.5, 9.0), {'TEMP': temp, 'UMID': [(moment, 80) for moment, _ in temp]})}
        with tempfile.TemporaryDirectory() as folder:
            proc = export(folder, {'LIG': ligurian, 'LAGHI': {'S1': (station(45.6, 10.6), LAKE_LEVEL)}})
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            first = stations_on_map(folder, 'LIG')
            second = stations_on_map(folder, 'LAGHI')
        self.assertEqual(list(second), ['S1'])
        self.assertEqual(list(first), ['A', 'B'])
        self.assertEqual(first['A']['latest'], {'TEMP': 12.5})               # senza l'umidita', con la temperatura
        self.assertEqual(first['B']['latest']['UMID'], 80)

    def test_finestra_in_ora_solare_d_estate(self):
        # l'archivio e' in ora solare: d'estate now() (civile) sposterebbe la finestra di un'ora. Alle 10:00 UTC del
        # 10/07 sono le 11:00 solari: la finestra di 7 giorni parte dal 03/07 alle 11:00 solari = 12:00 civili
        hours = []
        moment = datetime.datetime(2026, 7, 1)
        while moment <= datetime.datetime(2026, 7, 10, 11):
            hours.append((moment.strftime('%Y%m%d%H%M'), 20.0))
            moment += datetime.timedelta(hours=1)
        with tempfile.TemporaryDirectory() as folder:
            rete.check(export(folder, {'LAGHI': {'S1': (station(45.6, 10.6), {'TEMP': hours})}}, epoch=1783677600))
            with open(os.path.join(folder, 'site', 'LAGHI', 'series', 'S1.csv'), encoding='utf-8') as fp:
                rows = fp.read().splitlines()
        self.assertEqual(rows[1].split(',')[0], '2026-07-03T12:00')

    def test_quota_e_luogo_in_mappa(self):
        # la "i" della scheda: quota, comune e provincia dove stazioni.json li ha (campi diversi per rete)
        temp = {'TEMP': [('202611051200', 9.5)]}
        archive = {
            'VEN': {'170': ({'NOME': 'Teolo', 'X': '11.677', 'Y': '45.343', 'QUOTA': '155', 'COMUNE': 'TEOLO',
                             'PROVINCIA': 'PD'}, temp),
                    '9': ({'NOME': 'Porto Tolle', 'X': '12.4', 'Y': '44.9', 'QUOTA': '-3', 'COMUNE': ' ',
                           'PROVINCIA': ''}, temp)},
            'LOM': {'A': ({'NOME': 'Milano', 'LAT': 45.47, 'LON': 9.19, 'QUOTA': '120',
                           'PROVINCIA': 'MI'}, temp)},
            'BZ': {'B': ({'NAME_I': 'Vetta', 'LAT': 46.7, 'LONG': 11.3, 'ALT': 1448.7}, temp)},
            'LIG': {'C': (station(44.4, 8.9), temp)},
            'TN': {'D': ({'nome': 'Passo', 'latitudine': 46.1, 'longitudine': 11.1, 'quota': '-'}, temp)}}
        with tempfile.TemporaryDirectory() as folder:
            rete.check(export(folder, archive))
            got = {region: stations_on_map(folder, region) for region in archive}
        place = lambda p: {k: p[k] for k in ('quota', 'comune', 'prov') if k in p}
        self.assertEqual(place(got['VEN']['170']), {'quota': 155, 'comune': 'TEOLO', 'prov': 'PD'})
        self.assertEqual(place(got['VEN']['9']), {'quota': -3})             # comune e provincia vuoti
        self.assertEqual(place(got['LOM']['A']), {'quota': 120, 'prov': 'MI'})
        self.assertEqual(place(got['BZ']['B']), {'quota': 1449})
        self.assertEqual(place(got['LIG']['C']), {})                       # la Liguria non ha la quota
        self.assertEqual(place(got['TN']['D']), {})                        # quota illeggibile: niente

    def test_stazioni_senza_coordinate_nel_log(self):
        lakes = {'S1': (station(45.6, 10.6), LAKE_LEVEL), 'S2': (station('', ''), LAKE_LEVEL)}
        with tempfile.TemporaryDirectory() as folder:
            proc = export(folder, {'LAGHI': lakes})
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            files = os.listdir(os.path.join(folder, 'site', 'LAGHI'))
            clean = export(folder, {'LAGHI': {'S1': (station(45.6, 10.6), LAKE_LEVEL)}})
        self.assertNotIn('stations_nocoord.csv', files)
        self.assertIn('Stazioni senza coordinate, non in mappa: 1 (S2)', proc.stdout)
        self.assertNotIn('Stazioni senza coordinate', clean.stdout)


MORNING = 1795071600            # 2026-11-19 07:00 UTC = 08:00 solari
NIGHT = 1795044600              # 2026-11-18 23:30 UTC = 19/11 00:30 solari
SUMMER = 1783666800             # 2026-07-10 07:00 UTC = 08:00 solari = 09:00 civili


def every(start, end, minutes, value=1.0):
    """[(istante, valore)] da start a end compresi, ogni minutes minuti; value e' un numero o una funzione
    dell'indice della lettura."""
    moment = datetime.datetime.strptime(start, '%Y%m%d%H%M')
    stop = datetime.datetime.strptime(end, '%Y%m%d%H%M')
    points = []
    while moment <= stop:
        points.append((moment.strftime('%Y%m%d%H%M'), value(len(points)) if callable(value) else value))
        moment += datetime.timedelta(minutes=minutes)
    return points


def map_properties(archive, epoch, region='LIG'):
    """Le proprietà in mappa delle stazioni di region dopo l'export di archive con l'orologio a epoch."""
    with tempfile.TemporaryDirectory() as folder:
        rete.check(export(folder, archive, epoch=epoch))
        return stations_on_map(folder, region)


class TestRiferimenti(unittest.TestCase):
    """I valori che colorano la mappa quando non sono l'ultimo letto (rif) e il ritardo di ogni variabile
    (lag)."""

    def test_pioggia_da_mezzanotte(self):
        # la lettura delle 00:00 chiude il giorno prima
        rain = [(m, 5.0 if m == '202611190000' else 1.0)
                for m, _ in every('202611182200', '202611190800', 60)]
        props = map_properties({'LIG': {'A': (station(44.4, 8.9), {'PREC': rain})}}, MORNING)
        self.assertEqual(props['A']['rif']['PREC'], 8.0)

    def test_pioggia_mezzanotte_d_estate(self):
        # mezzanotte civile = 23:00 solari del giorno prima: contano le letture dalle 00:00 alle 08:00 solari
        rain = every('202607092000', '202607100800', 60)
        props = map_properties({'LIG': {'A': (station(44.4, 8.9), {'PREC': rain})}}, SUMMER)
        self.assertEqual(props['A']['rif']['PREC'], 9.0)

    def test_pioggia_senza_letture_oggi(self):
        # alle 00:30 la stazione oraria non ha letture di oggi ma e' viva; quella ferma da due giorni no
        archive = {'LIG': {
            'A': (station(44.4, 8.9), {'PREC': every('202611180000', '202611182300', 60, 0.2)}),
            'B': (station(44.5, 9.0), {'PREC': every('202611170000', '202611171200', 60, 0.2),
                                       'TEMP': every('202611180000', '202611190000', 60, 10.0)})}}
        props = map_properties(archive, NIGHT)
        self.assertEqual(props['A']['rif']['PREC'], 0.0)
        self.assertNotIn('PREC', props['B'].get('rif', {}))

    def test_pioggia_con_buchi(self):
        # cadenza di 10 minuti, ma da mezzanotte alle 08:00 A ha solo 13 letture: troppo poche per una somma
        night = every('202611181200', '202611190100', 10, 0.1)
        holed = night + every('202611190700', '202611190800', 10, 0.1)
        full = every('202611181200', '202611190800', 10, 0.1)
        props = map_properties({'LIG': {'A': (station(44.4, 8.9), {'PREC': holed}),
                                        'B': (station(44.5, 9.0), {'PREC': full})}}, MORNING)
        self.assertNotIn('PREC', props['A'].get('rif', {}))
        self.assertEqual(props['B']['rif']['PREC'], 4.8)

    def test_raffica_massima_di_oggi(self):
        gusts = [(m, 30.0 if m == '202611182350' else 12.5 if m == '202611190300' else 5.0)
                 for m, _ in every('202611182350', '202611190800', 10)]
        props = map_properties({'LIG': {'A': (station(44.4, 8.9), {'VVENTOMAX': gusts})}}, MORNING)
        self.assertEqual(props['A']['rif']['VVENTOMAX'], 12.5)

    def test_livello_in_tre_ore(self):
        level = every('202611190400', '202611190800', 15, lambda i: round(1.0 + 0.01 * i, 2))
        holed = [(m, v) for m, v in level if not '202611190415' < m < '202611190545']
        props = map_properties({'LIG': {'A': (station(44.4, 8.9), {'LIVIDRO': level}),
                                        'B': (station(44.5, 9.0), {'LIVIDRO': holed})}}, MORNING)
        self.assertEqual(props['A']['rif']['LIVIDRO'], 0.12)
        self.assertNotIn('LIVIDRO', props['B'].get('rif', {}))

    def test_ritardo_di_ogni_variabile(self):
        readings = {'TEMP': every('202611180000', '202611190800', 60, 10.0),
                    'UMID': every('202611180000', '202611190500', 60, 80.0),
                    'PREC': every('202611180000', '202611190700', 60, 0.0)}
        lag = map_properties({'LIG': {'A': (station(44.4, 8.9), readings)}}, MORNING)['A']['lag']
        self.assertEqual(lag['UMID'], 180)
        self.assertEqual(lag['PREC'], 60)
        self.assertEqual(lag['PREC1'], 60)
        self.assertNotIn('TEMP', lag)
        self.assertNotIn('HDD', lag)                   # giornaliera, segnata alle 12:00: mai in ritardo

    # Qualità dell'aria: i valori di ieri (18/11), il giorno che tutte le fonti hanno pubblicato
    def test_pm10_ieri_orarie(self):
        hours = every('202611180000', '202611182300', 60, lambda i: 10.0 + i)          # media 21.5
        archive = {'AQ_BZ': {'A': (station(46.5, 11.3), {'PM10': hours}),
                             'B': (station(46.6, 11.4), {'PM10': hours[:17]})}}
        props = map_properties(archive, MORNING, 'AQ_BZ')
        self.assertEqual(props['A']['rif']['PM10'], 22)
        self.assertNotIn('PM10', props['B'].get('rif', {}))

    def test_pm10_ieri_er(self):
        # ARPAE segna la media del giorno alle 00:00 del giorno dopo
        archive = {'AQ_ER': {'A': (station(44.5, 11.3), {'PM10': [('202611190000', 41.0)]}),
                             'B': (station(44.6, 11.4), {'PM10': [('202611180000', 39.0)]})}}
        props = map_properties(archive, MORNING, 'AQ_ER')
        self.assertEqual(props['A']['rif']['PM10'], 41)
        self.assertNotIn('PM10', props['B'].get('rif', {}))

    def test_pm10_ieri_ven_ultimo(self):
        # ARPAV aggiorna la media del giorno piu' volte: vale l'ultima
        pm10 = [('202611181000', 30.0), ('202611182000', 35.0)]
        props = map_properties({'AQ_VEN': {'A': (station(45.4, 11.9), {'PM10': pm10})}}, MORNING, 'AQ_VEN')
        self.assertEqual(props['A']['rif']['PM10'], 35)

    def test_ozono_massimo_di_ieri(self):
        hours = [(m, 88.4 if m == '202611181400' else 40.0)
                 for m, _ in every('202611180000', '202611182300', 60)]
        archive = {'AQ_LOM': {'A': (station(45.5, 9.2), {'O3': hours}),
                              'B': (station(45.6, 9.3), {'O3': hours[:17]})}}
        props = map_properties(archive, MORNING, 'AQ_LOM')
        self.assertEqual(props['A']['rif']['O3'], 88)
        self.assertNotIn('O3', props['B'].get('rif', {}))

    def test_ozono_conta_le_ore_non_le_letture(self):
        # ARPAV segna ogni valore orario quattro volte (:10 :40 :55 :59): 5 ore sono 20 letture, non un giorno
        o3 = [('20261118' + h + m, 60.0)
              for h in ('10', '11', '12', '13', '14') for m in ('10', '40', '55', '59')]
        props = map_properties({'AQ_VEN': {'A': (station(45.4, 11.9), {'O3': o3})}}, MORNING, 'AQ_VEN')
        self.assertNotIn('O3', props['A'].get('rif', {}))

    def test_pm25_come_pm10(self):
        props = map_properties({'AQ_LOM': {'A': (station(45.5, 9.2), {'PM25': [('202611180000', 37.0)]})}},
                               MORNING, 'AQ_LOM')
        self.assertEqual(props['A']['rif']['PM25'], 37)

    def test_pioggia_di_oggi_con_cadenza_cambiata(self):
        # i giorni passati riscritti di notte a 5 minuti, oggi il dato in diretta ogni 10 (Alto Adige): la
        # copertura si misura sulla cadenza di oggi
        rain = every('202611120000', '202611182355', 5, 0.0) + every('202611190010', '202611190800', 10, 0.1)
        props = map_properties({'LIG': {'A': (station(44.4, 8.9), {'PREC': rain})}}, MORNING)
        self.assertEqual(props['A']['rif']['PREC'], 4.8)

    def test_letture_senza_rileggere_la_finestra(self):
        # sette giorni ogni 10 minuti: per ritardi e riferimenti non si legge ogni istante (l'export a ogni
        # pubblicazione deve restare nei suoi tempi)
        per_var = {'PREC': dict(every('202611120000', '202611190800', 10, 0.1)),
                   'TEMP': dict(every('202611120000', '202611190800', 10, 8.0)),
                   'LIVIDRO': dict(every('202611120000', '202611190800', 15, 1.0))}
        now = datetime.datetime(2026, 11, 19, 8, 0)
        with mock.patch.object(ew, 'moment_of', wraps=ew.moment_of) as parsed:
            ew.var_lags(per_var, '202611190800')
            lags = parsed.call_count
            ew.map_refs('LIG', per_var, now)
        self.assertLessEqual(lags, 4)
        self.assertLessEqual(parsed.call_count - lags, 48 + 15 + 5)     # oggi e le ultime 3 h e mezza

    def test_istanti_illeggibili(self):
        # un istante storto non deve fermare l'export di tutte le regioni
        per_var = {'TEMP': {'202611190800': 8.0, 'ERRORE000000': 9.0},
                   'PREC': {'XX': 1.0, '202611190700': 0.2}}
        self.assertEqual(ew.var_lags(per_var, 'ERRORE000000'), {})
        self.assertEqual(ew.var_lags(per_var, '202611190800'), {'PREC': 60})
        self.assertEqual(ew.map_refs('LIG', per_var, datetime.datetime(2026, 11, 19, 8, 0)), {'PREC': 0.2})

    def test_ora_dell_export_nella_mappa(self):
        # la pagina riconosce una copia vecchia (riserva di jsDelivr): "ieri" di un altro giorno non vale
        with tempfile.TemporaryDirectory() as folder:
            rete.check(export(folder, {'LIG': {'A': (station(44.4, 8.9), {'TEMP': [('202611190700', 8.0)]})}},
                              epoch=MORNING))
            with open(os.path.join(folder, 'site', 'LIG', 'stations.geojson'), encoding='utf-8') as fp:
                geo = json.load(fp)
        self.assertEqual(geo['creato'], '2026-11-19T08:00')

    def test_raffica_massima_dell_ora(self):
        # il fotogramma del Cursore e' la massima dell'ora, non l'ultima lettura: le reti a 10 minuti prese
        # all'ora tonda perdevano i picchi, e la massima di oggi del Cursore non tornava con la mappa
        gusts = [(m, 14.0 if m == '202611190620' else 5.0)
                 for m, _ in every('202611190610', '202611190700', 10)]
        archive = {'LIG': {'A': (station(44.4, 8.9), {'VVENTOMAX': gusts})}}
        with tempfile.TemporaryDirectory() as folder:
            rete.check(export(folder, archive, epoch=MORNING))
            with open(os.path.join(folder, 'site', 'LIG', 'snap', 'VVENTOMAX.json'), encoding='utf-8') as fp:
                frames = json.load(fp)
        seven = calendar.timegm((2026, 11, 19, 7, 0, 0))
        self.assertEqual(frames['s']['A'][frames['t'].index(seven)], 14.0)


class TestDerivate(unittest.TestCase):
    """Le derivate di derive.py che dipendono dalla fonte: pressione gia' ridotta, radiazione in kJ/m²,
    cadenza."""

    @staticmethod
    def day(values, start='202611180000'):
        """Letture orarie dei valori dati, da start."""
        first = datetime.datetime.strptime(start, '%Y%m%d%H%M')
        return {(first + datetime.timedelta(hours=h)).strftime('%Y%m%d%H%M'): x for h, x in enumerate(values)}

    def test_pressione_gia_al_livello_mare(self):
        # Veneto e Alto Adige danno la pressione gia' ridotta: ridurla ancora dava 1196 hPa a 1470 m
        per_var = {'PRESS': {'202611190800': '1000.0'}, 'TEMP': {'202611190800': '2.0'}}
        sea = derive.derive_station(per_var, {'ALT': 1470}, 'BZ', {})
        station = derive.derive_station(per_var, {'ALT': 1470}, 'TN', {})
        self.assertEqual(sea['PSLM'], {'202611190800': 1000.0})
        self.assertGreater(station['PSLM']['202611190800'], 1150)       # alla stazione: si riduce

    def test_et0_radiazione_in_kj_all_ora(self):
        # OSMER (FVG) da' l'energia dell'ora in kJ/m²: la stessa radiazione in W/m² deve dare la stessa ET0
        hours = 24
        temp = [8 + 6 * math.sin(math.pi * h / hours) for h in range(hours)]
        sun = [max(0.0, 400 * math.sin(math.pi * (h - 6) / 12)) for h in range(hours)]          # W/m²
        base = {'TEMP': self.day(temp), 'UMID': self.day([70.0] * hours), 'VVENTO': self.day([2.0] * hours)}
        watt = dict(base, RADSOL=self.day(sun))
        kilo = dict(base, RADSOL=self.day([x * 3.6 for x in sun]))
        meta = {'LAT': 46.0, 'QUOTA': 100}
        et_w = derive.daily_et0(watt, meta, 'PC_FVG', {'RADSOL': 'W/m²'})['ET0']['202611181200']
        et_k = derive.daily_et0(kilo, meta, 'FVG', {'RADSOL': 'KJ/m^2'})['ET0']['202611181200']
        self.assertAlmostEqual(et_k, et_w, places=2)

    def test_et0_pressione_gia_al_livello_mare(self):
        # a 1470 m la pressione alla stazione e' ~850 hPa: quella ridotta (1000) non va nella costante
        # psicrometrica
        hours = 24
        base = {'TEMP': self.day([2 + 4 * math.sin(math.pi * h / hours) for h in range(hours)]),
                'UMID': self.day([60.0] * hours), 'VVENTO': self.day([3.0] * hours),
                'RADSOL': self.day([max(0.0, 300 * math.sin(math.pi * (h - 6) / 12)) for h in range(hours)])}
        meta = {'LAT': 46.6, 'ALT': 1470}
        with_press = derive.daily_et0(dict(base, PRESS=self.day([1000.0] * hours)), meta, 'BZ', {})
        without = derive.daily_et0(base, meta, 'BZ', {})
        self.assertEqual(with_press['ET0'], without['ET0'])

    def test_piogge_brevi_con_cadenza_cambiata(self):
        # giorni passati riscritti a 5 minuti, oggi in diretta ogni 10 (Alto Adige): ci sono le finestre
        past = every('202611120000', '202611182355', 5, 0.0)
        today = every('202611190010', '202611190800', 10, 0.1)
        out = derive.derive_station({'PREC': dict(past + today)}, {}, 'BZ', {})
        for name in ('PREC1', 'PREC3', 'PREC6', 'PREC12', 'PREC24'):
            self.assertIn('202611190800', out.get(name, {}), name)
        # al contrario: orarie nei giorni passati, ogni 10 minuti oggi: la 24 h di oggi c'e' ancora
        hourly = every('202611120000', '202611182300', 60, 0.0)
        out = derive.derive_station({'PREC': dict(hourly + today)}, {}, 'VEN', {})
        self.assertIn('202611190800', out.get('PREC24', {}))


if __name__ == '__main__':
    unittest.main()
