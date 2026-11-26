import gzip
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

import comune
import dati_mare
import er_storico
import history

UNITS = {'ER': dati_mare.ER_LAND_UNITS, 'MAR_ER': dati_mare.UNITS}


def record(net, utc, name, lon, lat, blocks):
    """Una riga dell'archivio ARPAE: anagrafica della stazione e misure (timerange, vars)."""
    head = {'vars': {'B01019': {'v': name}, 'B05001': {'v': lat / 1e5}, 'B06001': {'v': lon / 1e5}}}
    data = [head] + [{'timerange': tr, 'level': [1, None, None, None], 'vars': {code: {'v': v}}}
                     for tr, code, v in blocks]
    return {'network': net, 'lon': lon, 'lat': lat, 'date': utc, 'data': data}


class ErStoricoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def month_file(self, name, rows):
        p = os.path.join(self.tmp, name)
        with gzip.open(p, 'wt', encoding='utf-8') as f:
            for r in rows:
                f.write(json.dumps(r) + '\n')
        return p

    def test_shortest_step_and_kelvin_and_regions(self):
        rows = [
            record('agrmet', '2020-01-01T00:15:00Z', 'Carpi', 1088000, 4478000,
                   [([1, 0, 900], 'B13011', 1.0), ([254, 0, 0], 'B12101', 274.15)]),
            record('agrmet', '2020-01-01T01:00:00Z', 'Carpi', 1088000, 4478000,
                   [([1, 0, 900], 'B13011', 0.5), ([1, 0, 3600], 'B13011', 9.0),
                    ([254, 0, 0], 'B12101', 276.15), ([0, 0, 3600], 'B12101', 300.0)]),
            record('simnbo', '2020-01-01T00:00:00Z', 'Senza Codice', 1, 2, [([254, 0, 0], 'B13003', 80.0)]),
            record('rmap', '2020-01-01T00:00:00Z', 'Volontario', 3, 4, [([254, 0, 0], 'B13003', 50.0)]),
            record('boa', '2020-01-01T00:30:00Z', 'Boa Cesenatico', 5, 6, [([254, 0, 0], 'B22070', 1.2)])]
        acc = {}
        er_storico.read_month(self.month_file('m.json.gz', rows), {(1088000, 4478000): '123'}, acc)
        out = er_storico.flush(acc, '2020-01', UNITS)
        self.assertEqual(out[('ER', 'PREC')]['123'],
                         {'k': 'sum', 'u': 'mm', 'giorni': {'20200101': [1.5, 2]}})
        self.assertEqual(out[('ER', 'TEMP')]['123']['giorni'], {'20200101': [1.0, 3.0, 2.0, 2]})
        self.assertEqual(list(out[('ER', 'UMID')]), ['A_Senza_Codice'])
        self.assertEqual(out[('MAR_ER', 'ONDE')]['Boa_Cesenatico']['giorni'],
                         {'20200101': [1.2, 1.2, 1.2, 1]})
        self.assertEqual(acc, {})

    def test_first_hour_of_a_month_comes_from_the_month_before(self):
        dec = [record('agrmet', '2019-12-31T23:30:00Z', 'Carpi', 1, 2, [([1, 0, 900], 'B13011', 4.0)]),
               record('agrmet', '2019-12-31T12:00:00Z', 'Carpi', 1, 2, [([1, 0, 900], 'B13011', 1.0)])]
        jan = [record('agrmet', '2020-01-01T05:00:00Z', 'Carpi', 1, 2, [([1, 0, 900], 'B13011', 2.0)])]
        acc = {}
        er_storico.read_month(self.month_file('d.json.gz', dec), {(1, 2): '9'}, acc)
        out = er_storico.flush(acc, '2019-12', UNITS)
        self.assertEqual(out[('ER', 'PREC')]['9']['giorni'], {'20191231': [1.0, 1]})
        er_storico.read_month(self.month_file('j.json.gz', jan), {(1, 2): '9'}, acc)
        out = er_storico.flush(acc, '2020-01', UNITS)
        self.assertEqual(out[('ER', 'PREC')]['9']['giorni'], {'20200101': [6.0, 2]})   # 00:30 solari + 06:00

    def test_daily_series_merge_into_history(self):
        er = os.path.join(self.tmp, 'er_storico')
        with mock.patch.object(er_storico, 'OUT', er):
            er_storico.write_month({('ER', 'TEMP'): {'123': {'k': 'band', 'u': '°C',
                                                               'giorni': {'20191230': [1.0, 3.0, 2.0, 24]}}}},
                                   '2019-12')
        base = os.path.join(self.tmp, 'base')
        parse = os.path.join(base, 'ER', 'data-parsed', 'TEMP')
        os.makedirs(parse)
        with open(os.path.join(parse, 'TEMP-20200101.json'), 'w') as f:
            json.dump({'123': {'UM': '°C', 'MISURE': {'ISTANTE': ['202001010000'], 'VALORE': [5.0]}}}, f)
        out, cache = os.path.join(self.tmp, 'out'), os.path.join(self.tmp, 'cache')
        with mock.patch.object(history, 'BASE', base), mock.patch.object(history, 'ER_DIR', er), \
                mock.patch.object(history, 'OLD_VEN', os.path.join(self.tmp, 'nessuno')):
            days, _, meta = history.process_region('ER', cache)
            history.write_region('ER', days, out, history.daily_series('ER', cache), meta)
        with open(os.path.join(out, 'ER', '123', 'TEMP.json'), encoding='utf-8') as f:
            t = json.load(f)
        self.assertEqual((t['d0'], t['m'], t['h']), ('20191230', [2.0, None, 5.0], [24, None, 1]))


if __name__ == '__main__':
    unittest.main()
