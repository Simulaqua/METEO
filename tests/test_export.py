# Export del sito (export_web.py).
# Ora legale: l'archivio e' in ORA SOLARE (UTC+1 fisso) e l'export lo converte nell'ora civile italiana (l'orologio
# da muro). Valori attesi presi dall'orologio reale dei cambi d'ora del 2026:
#   29/03 alle 01:00 UTC = 02:00 solari: le 02:00 CET diventano 03:00 CEST
#   25/10 alle 01:00 UTC = 02:00 solari: le 03:00 CEST tornano 02:00 CET (l'ora 02:00-03:00 si ripete)
# Le altre prove lanciano l'export vero (export) su un archivio scritto apposta, con l'orologio fermo di tests/rete.py.
#   /usr/bin/python3 -m unittest tests.test_export -v
import calendar, datetime, json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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


def export(folder, archive, epoch=rete.EPOCH):
    """L'export di tutte le regioni in folder, con l'orologio fermo a epoch, sull'archivio
    {regione: {scode: (record di stazioni.json, {variabile: [(istante, valore)]})}}; le letture di una variabile vanno
    nel file del loro giorno. Ritorna il processo."""
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
                                   'VALORE': [value for _, value in day_points]}}
        for path, records in day_files.items():
            write_json(path, records)
    return rete.run([sys.executable, 'export_web.py', '-r', 'all', '--site-dir', 'site'], folder, epoch=epoch)


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


if __name__ == '__main__':
    unittest.main()
