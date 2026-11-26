import contextlib
import datetime
import gzip
import json
import os
import shutil
import tempfile
import types
import unittest
from unittest import mock

import comune
import recover


class LongBackfillTest(unittest.TestCase):
    """recover.py --da: blocchi in ordine di tempo, scritti e compressi; si riparte dal file di
    avanzamento."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.parse = os.path.join(self.tmp, 'data-parsed')
        os.makedirs(self.parse)
        self.state_path = os.path.join(self.tmp, 'stato.json')
        for p in (mock.patch.object(recover, 'STATE_PATH', self.state_path),
                  mock.patch.object(recover, 'PAUSE', 0),
                  mock.patch.object(recover, 'region_lock', lambda region: contextlib.nullcontext())):
            p.start()
            self.addCleanup(p.stop)

    def day_file(self, var, day):
        p = os.path.join(self.parse, var, '%s-%s.json' % (var, day))
        if os.path.exists(p):
            return 'json', comune.load_json(p)
        return ('gz', comune.load_json(p + '.gz')) if os.path.exists(p + '.gz') else (None, None)

    def test_quarters_cover_the_range(self):
        q = list(recover.quarters(datetime.date(2022, 11, 15), datetime.date(2023, 5, 3)))
        self.assertEqual(q, [(datetime.date(2022, 11, 15), datetime.date(2023, 1, 31)),
                             (datetime.date(2023, 2, 1), datetime.date(2023, 4, 30)),
                             (datetime.date(2023, 5, 1), datetime.date(2023, 5, 3))])

    def lom_module(self):
        return types.SimpleNamespace(
            PARSE_DIR=self.parse, VARIABLES={'TEMP': 'Temperatura'}, OPERATORS={},
            SKIP_VALUES={'-9999'}, SKIP_DIR_VALUES=set(), coordinate=float,
            compact_moment=lambda t: t[:4] + t[5:7] + t[8:10] + t[11:13] + t[14:16])

    def test_lom_days_written_compressed_and_resumed(self):
        mod = self.lom_module()
        registry = {'1': {'idsensore': '1', 'tipologia': 'Temperatura', 'idstazione': 'S1',
                          'nomestazione': 'Uno', 'lat': '45.1', 'lng': '9.1', 'unit_dimisura': '°C'}}
        calls = []

        def rows(mod, t0, t1):
            calls.append(t0)
            if t0.hour:
                return []
            row = lambda hm, v: {'idsensore': '1', 'data': t0.strftime('%Y-%m-%dT') + hm, 'valore': v,
                                 'idoperatore': '1'}
            return [row('00:10:00', '3.5'), row('00:20:00', '-9999')]
        with mock.patch.object(recover, 'lom_registry', lambda mod: (registry, {'Temperatura': 'TEMP'})), \
                mock.patch.object(recover, 'lom_rows', rows):
            recover.backfill_lom(mod, datetime.date(2023, 6, 1), datetime.date(2023, 6, 2), {})
            self.assertEqual(len(calls), 12)                          # sei blocchi di 4 ore al giorno
            kind, data = self.day_file('TEMP', '20230601')
            self.assertEqual((kind, data['S1']['MISURE']),
                             ('gz', {'ISTANTE': ['202306010010'], 'VALORE': ['3.5']}))
            state = comune.load_json(self.state_path)
            self.assertEqual(state, {'LOM 20230601': 1, 'LOM 20230602': 1})
            recover.backfill_lom(mod, datetime.date(2023, 6, 1), datetime.date(2023, 6, 3), state)
            self.assertEqual(len(calls), 18)                          # solo il giorno nuovo
        self.assertIn('S1', comune.load_json(os.path.join(self.parse, 'stazioni.json')))

    def test_bz_quarter_per_variable_and_failed_sensor_skipped(self):
        mod = types.SimpleNamespace(PARSE_DIR=self.parse)

        def series(mod, sc, ty, d_from, d_to, timeout):
            if sc == 'X':
                raise IOError('rete')
            return [(d_from + '1200', 1.0), (d_to + '1200', 2.0)]
        pairs = [('A', 'LT', 'TEMP'), ('X', 'LT', 'TEMP'), ('A', 'N', 'PREC')]
        with mock.patch.object(recover, 'bz_pairs', lambda mod: (pairs, {('TEMP', 'A'): '°C'})), \
                mock.patch.object(recover, 'bz_series', series), \
                mock.patch.object(recover, 'patient', lambda fn, *a: fn(*a)):
            recover.backfill_bz(mod, datetime.date(2022, 1, 1), datetime.date(2022, 4, 10), {})
        state = comune.load_json(self.state_path)
        self.assertEqual(state, {'BZ 20220101': 4, 'BZ 20220401': 4})
        self.assertEqual(self.day_file('TEMP', '20220331')[0], 'gz')
        self.assertEqual(self.day_file('PREC', '20220410')[1]['A']['MISURE']['VALORE'], [2.0])
        self.assertEqual(self.day_file('TEMP', '20220101')[1]['A']['UM'], '°C')

    def test_compress_keeps_recent_days_open_and_replaces_old_gz(self):
        d = os.path.join(self.parse, 'TEMP')
        os.makedirs(d)
        today = comune.now_solar().strftime('%Y%m%d')
        for day in ('20200101', today):
            with open(os.path.join(d, 'TEMP-%s.json' % day), 'w') as f:
                json.dump({'A': {'MISURE': {'ISTANTE': [day + '0000'], 'VALORE': [1]}}}, f)
        with gzip.open(os.path.join(d, 'TEMP-20200101.json.gz'), 'wt') as f:
            json.dump({'vecchio': 1}, f)
        recover.compress_days(self.parse, ['TEMP'], ['20200101', today])
        self.assertEqual(sorted(os.listdir(d)), ['TEMP-20200101.json.gz', 'TEMP-%s.json' % today])
        self.assertIn('A', comune.load_json(os.path.join(d, 'TEMP-20200101.json.gz')))


if __name__ == '__main__':
    unittest.main()
