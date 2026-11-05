# Export del sito (export_web.py).
# Ora legale: l'archivio e' in ORA SOLARE (UTC+1 fisso) e l'export lo converte nell'ora civile italiana (l'orologio
# da muro). Valori attesi presi dall'orologio reale dei cambi d'ora del 2026:
#   29/03 alle 01:00 UTC = 02:00 solari: le 02:00 CET diventano 03:00 CEST
#   25/10 alle 01:00 UTC = 02:00 solari: le 03:00 CEST tornano 02:00 CET (l'ora 02:00-03:00 si ripete)
# Le prove con export_one_station lanciano l'export vero su un archivio di una stazione, con l'orologio fermo di
# tests/rete.py.
#   /usr/bin/python3 -m unittest tests.test_export -v
import calendar, datetime, json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import export_web as ew
from tests import rete


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fp:
        json.dump(data, fp)


def export_one_station(folder, station, readings, epoch=rete.EPOCH):
    """L'export della sola regione LAGHI in folder, con l'orologio fermo a epoch, su un archivio con la sola stazione
    S1: station e' il suo record in stazioni.json, readings le sue letture {variabile: [(istante, valore)]}, ognuna
    nel file del giorno della prima lettura. Ritorna la cartella della regione nel sito."""
    rete.copy_programs(folder)
    parsed = os.path.join(folder, 'LAGHI', 'data-parsed')
    write_json(os.path.join(parsed, 'stazioni.json'), {'S1': station})
    for var, points in readings.items():
        record = {'STAZIONE': station,
                  'MISURE': {'ISTANTE': [moment for moment, _ in points], 'VALORE': [value for _, value in points]}}
        write_json(os.path.join(parsed, var, '%s-%s.json' % (var, points[0][0][:8])), {'S1': record})
    rete.check(rete.run([sys.executable, 'export_web.py', '-r', 'LAGHI', '--site-dir', 'site'], folder, epoch=epoch))
    return os.path.join(folder, 'site', 'LAGHI')


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
            site = export_one_station(folder, {'SCODE': 'S1', 'NOME': 'Uno', 'LAT': 45.6, 'LON': 10.6},
                                      {'TEMP': [('202610250400', 10.0)]}, epoch=calendar.timegm((2026, 10, 25, 3, 30, 0)))
            with open(os.path.join(site, 'snap', 'TEMP.json'), encoding='utf-8') as fp:
                frames = json.load(fp)['t']
        self.assertEqual(len(frames), 168)
        self.assertEqual([datetime.datetime.utcfromtimestamp(t).strftime('%d %H:%M') for t in frames[-5:]],
                         ['25 01:00', '25 02:00', '25 02:00', '25 03:00', '25 04:00'])


class TestMappa(unittest.TestCase):

    def test_coordinata_nan_fuori_dalla_mappa(self):
        # json.dump scrive NaN, che non e' JSON: il sito non leggerebbe la mappa della regione
        with tempfile.TemporaryDirectory() as folder:
            site = export_one_station(folder, {'SCODE': 'S1', 'NOME': 'Uno', 'LAT': 'nan', 'LON': '10.5'},
                                      {'LIVLAGO': [('202611051200', 65.2)]})
            with open(os.path.join(site, 'stations.geojson'), encoding='utf-8') as fp:
                text = fp.read()
            self.assertNotIn('NaN', text)
            self.assertNotIn('S1', [feature['properties']['scode'] for feature in json.loads(text)['features']])
            self.assertTrue(os.path.exists(os.path.join(site, 'series', 'S1.csv')))   # esportata, fuori dalla mappa


if __name__ == '__main__':
    unittest.main()
