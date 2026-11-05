import contextlib
import datetime
import gzip
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

import history


def ts_list(day, hours, minutes=(0,)):
    return [day + '%02d%02d' % (h, m) for h in hours for m in minutes]


def write_day(parse_dir, var, day, stations, vkey, gz=False):
    """stations = {scode: (istanti, valori)}; stesso formato dell'archivio."""
    d = os.path.join(parse_dir, var)
    os.makedirs(d, exist_ok=True)
    data = {s: {'MISURE': {'ISTANTE': i, vkey: v}} for s, (i, v) in stations.items()}
    p = os.path.join(d, '%s-%s.json' % (var, day))
    if gz:
        with gzip.open(p + '.gz', 'wt', encoding='utf-8') as f:
            json.dump(data, f)
    else:
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(data, f)


class HistoryBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.base = os.path.join(self.tmp, 'base')
        self.old = os.path.join(self.tmp, 'old_ven')
        self.out = os.path.join(self.tmp, 'out')
        self.cache = os.path.join(self.tmp, 'cache')
        os.makedirs(self.base)
        os.makedirs(self.old)
        for p in (mock.patch.object(history, 'BASE', self.base), mock.patch.object(history, 'OLD_VEN', self.old)):
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def parse(self, region):
        return os.path.join(self.base, region, 'data-parsed')

    def run_region(self, region, full=False):
        days, n = history.process_region(region, self.out, self.cache, full=full)
        history.write_region(region, days, self.out)
        return days, n

    def station(self, region, scode):
        with open(os.path.join(self.out, region, scode + '.json'), encoding='utf-8') as f:
            return json.load(f)


class AggregatesTest(HistoryBase):
    def test_prec_sum_and_hours(self):
        # 3 ore con dato, 2 istanti nell'ora 02: la somma e' su tutti, le ore sono distinte
        ist = ['202001010000', '202001010100', '202001010210', '202001010250']
        write_day(self.parse('LOM'), 'PREC', '20200101', {'A': (ist, [0.2, 1.0, 0.4, 0.4])}, 'VALORE')
        days, _ = self.run_region('LOM')
        self.assertEqual(days['20200101']['A'][:2], [2.0, 3])
        s = self.station('LOM', 'A')
        self.assertEqual((s['v'], s['d0'], s['p'], s['hp']), (1, '20200101', [2.0], [3]))
        self.assertNotIn('tn', s)

    def test_temp_min_max_mean_of_hourly_means(self):
        # ora 00: due letture (10, 20) -> media oraria 15; ora 01: 5. Media del giorno = 10, non (10+20+5)/3
        ist = ['202001010010', '202001010040', '202001010100']
        write_day(self.parse('LOM'), 'TEMP', '20200101', {'A': (ist, [10.0, 20.0, 5.0])}, 'VALORE')
        days, _ = self.run_region('LOM')
        self.assertEqual(days['20200101']['A'][2:], [5.0, 20.0, 10.0, 2])

    def test_quality_rejects(self):
        p = self.parse('LOM')
        ist = ts_list('20200101', [0, 1, 2, 3])
        write_day(p, 'PREC', '20200101', {'A': (ist, [-999, 1.0, 2000.0, 0.5])}, 'VALORE')
        write_day(p, 'TEMP', '20200101', {'A': (ist, [-999, 12.0, 80.0, 'x'])}, 'VALORE')
        days, _ = self.run_region('LOM')
        r = days['20200101']['A']
        self.assertEqual(r[:2], [1.5, 2])
        self.assertEqual(r[2:], [12.0, 12.0, 12.0, 1])

    def test_prec_day_over_limit_is_dropped(self):
        # 3 x 600 mm: ogni valore e' plausibile ma la somma giornaliera no
        write_day(self.parse('LOM'), 'PREC', '20200101',
                  {'A': (ts_list('20200101', [0, 1, 2]), [600.0, 600.0, 600.0])}, 'VALORE')
        self.assertEqual(history.aggregate_file('LOM', 'PREC', os.path.join(self.parse('LOM'), 'PREC', 'PREC-20200101.json')), {})

    def test_zero_glitch_temp_and_umid(self):
        p = self.parse('LOM')
        ist = ts_list('20200101', [0, 1])
        write_day(p, 'TEMP', '20200101', {'A': (ist, [0.0, 0.0])}, 'VALORE')
        write_day(p, 'UMID', '20200101', {'A': (ist, [0.0, 55.0])}, 'VALORE')
        days, _ = self.run_region('LOM')
        # alle 00 TEMP=0 & UMID=0: guasto; alle 01 TEMP=0 con UMID reale: dato vero
        r = days['20200101']['A']
        self.assertEqual((r[2], r[3], r[4], r[5]), (0.0, 0.0, 0.0, 1))

    def test_station_day_without_data_is_null(self):
        p = self.parse('LOM')
        write_day(p, 'PREC', '20200101', {'A': (ts_list('20200101', [0]), [1.0])}, 'VALORE')
        write_day(p, 'PREC', '20200102', {'B': (ts_list('20200102', [0]), [0.0])}, 'VALORE')
        write_day(p, 'PREC', '20200103', {'A': (ts_list('20200103', [0]), [-999])}, 'VALORE')
        write_day(p, 'PREC', '20200104', {'A': (ts_list('20200104', [0]), [2.0])}, 'VALORE')
        self.run_region('LOM')
        a = self.station('LOM', 'A')
        self.assertEqual(a['p'], [1.0, None, None, 2.0])        # non 0: null
        self.assertEqual(a['hp'], [1, None, None, 1])
        b = self.station('LOM', 'B')
        self.assertEqual((b['d0'], b['p']), ('20200102', [0.0, None, None]))   # pioggia 0 e' un dato

    def test_file_with_instants_of_other_days(self):
        # il giorno e' quello dell'ISTANTE, non quello del nome del file
        write_day(self.parse('LOM'), 'PREC', '20200101',
                  {'A': (['202001010000', '202001020000'], [1.0, 3.0])}, 'VALORE')
        agg = history.aggregate_file('LOM', 'PREC', os.path.join(self.parse('LOM'), 'PREC', 'PREC-20200101.json'))
        self.assertEqual(agg['A'], {'20200101': [1.0, 1], '20200102': [3.0, 1]})

    def test_solar_day_bounds_dst_days(self):
        # 26/10/2025 (fine ora legale) e 30/03/2025: l'archivio e' in ora solare, 24 ore per giorno
        p = self.parse('LOM')
        for day in ('20251026', '20250330'):
            write_day(p, 'PREC', day, {'A': (ts_list(day, range(24)), [0.1] * 24)}, 'VALORE')
        days, _ = self.run_region('LOM')
        for day in ('20251026', '20250330'):
            self.assertEqual(days[day]['A'][:2], [2.4, 24])

    def test_gz_and_json_both_read_json_preferred(self):
        p = self.parse('LOM')
        write_day(p, 'PREC', '20200101', {'A': (ts_list('20200101', [0]), [9.0])}, 'VALORE', gz=True)
        self.assertTrue(history.list_days(p, 'PREC')['20200101'].endswith('.json.gz'))
        write_day(p, 'PREC', '20200101', {'A': (ts_list('20200101', [0]), [1.0])}, 'VALORE')
        self.assertTrue(history.list_days(p, 'PREC')['20200101'].endswith('.json'))
        days, _ = self.run_region('LOM')
        self.assertEqual(days['20200101']['A'][0], 1.0)

    def test_corrupt_file_is_skipped(self):
        p = self.parse('LOM')
        write_day(p, 'PREC', '20200101', {'A': (ts_list('20200101', [0]), [1.0])}, 'VALORE')
        with open(os.path.join(p, 'PREC', 'PREC-20200102.json'), 'w') as f:
            f.write('{rotto')
        days, _ = self.run_region('LOM')
        self.assertEqual(list(days), ['20200101'])


class VenetoOverlapTest(HistoryBase):
    def test_more_hours_wins_never_a_mix(self):
        # vecchio: 5 ore (somma 5.0); nuovo: 3 ore (somma 9.0) -> vince il vecchio per intero
        write_day(self.old, 'PREC', '20200101', {'A': (ts_list('20200101', range(5)), [1.0] * 5)}, 'VM')
        write_day(self.parse('VEN'), 'PREC', '20200101', {'A': (ts_list('20200101', range(3)), [3.0] * 3)}, 'VM')
        # 20200102: il nuovo ha piu' ore
        write_day(self.old, 'PREC', '20200102', {'A': (ts_list('20200102', range(2)), [1.0] * 2)}, 'VM')
        write_day(self.parse('VEN'), 'PREC', '20200102', {'A': (ts_list('20200102', range(4)), [2.0] * 4)}, 'VM')
        days, _ = self.run_region('VEN')
        self.assertEqual(days['20200101']['A'][:2], [5.0, 5])
        self.assertEqual(days['20200102']['A'][:2], [8.0, 4])

    def test_tie_goes_to_newer_source(self):
        write_day(self.old, 'PREC', '20200101', {'A': (ts_list('20200101', range(2)), [1.0] * 2)}, 'VM')
        write_day(self.parse('VEN'), 'PREC', '20200101', {'A': (ts_list('20200101', range(2)), [2.0] * 2)}, 'VM')
        days, _ = self.run_region('VEN')
        self.assertEqual(days['20200101']['A'][:2], [4.0, 2])

    def test_temp_tie_goes_to_newer_source(self):
        write_day(self.old, 'TEMP', '20200101', {'A': (ts_list('20200101', range(3)), [10.0] * 3)}, 'VM')
        write_day(self.parse('VEN'), 'TEMP', '20200101', {'A': (ts_list('20200101', range(3)), [20.0] * 3)}, 'VM')
        days, _ = self.run_region('VEN')
        self.assertEqual(days['20200101']['A'][2:], [20.0, 20.0, 20.0, 3])

    def test_temp_overlap_is_per_variable(self):
        write_day(self.old, 'TEMP', '20200101', {'A': (ts_list('20200101', range(6)), [10.0] * 6)}, 'VM')
        write_day(self.parse('VEN'), 'TEMP', '20200101', {'A': (ts_list('20200101', range(2)), [20.0] * 2)}, 'VM')
        write_day(self.parse('VEN'), 'PREC', '20200101', {'A': (ts_list('20200101', range(2)), [1.0] * 2)}, 'VM')
        days, _ = self.run_region('VEN')
        self.assertEqual(days['20200101']['A'], [2.0, 2, 10.0, 10.0, 10.0, 6])

    def test_old_only_and_new_only_days_join(self):
        write_day(self.old, 'PREC', '20200101', {'A': (ts_list('20200101', [0]), [1.0])}, 'VM')
        write_day(self.parse('VEN'), 'PREC', '20200102', {'A': (ts_list('20200102', [0]), [2.0])}, 'VM')
        self.run_region('VEN')
        self.assertEqual(self.station('VEN', 'A')['p'], [1.0, 2.0])

    def test_value_key_per_region(self):
        self.assertEqual(history.value_key('VEN'), 'VM')
        self.assertEqual(history.value_key('LOM'), 'VALORE')


class DiscoverTest(HistoryBase):
    def test_discover_skips_lowercase_and_empty(self):
        write_day(self.parse('LOM'), 'PREC', '20200101', {'A': (ts_list('20200101', [0]), [1.0])}, 'VALORE')
        write_day(os.path.join(self.base, 'old', 'data-parsed'), 'PREC', '20200101',
                  {'A': (ts_list('20200101', [0]), [1.0])}, 'VALORE')
        os.makedirs(os.path.join(self.base, 'PIE', 'data-parsed', 'UMID'))     # solo UMID: non interessa
        os.makedirs(os.path.join(self.base, 'tests'))
        self.assertEqual(history.discover_regions(), ['LOM'])

    def test_ven_found_through_old_archive_only(self):
        os.makedirs(os.path.join(self.base, 'VEN'))             # la regione si cerca tra le cartelle di BASE
        write_day(self.old, 'TEMP', '20200101', {'A': (ts_list('20200101', [0]), [1.0])}, 'VM')
        self.assertEqual(history.discover_regions(), ['VEN'])


class CacheAndOutputTest(HistoryBase):
    def tree(self):
        out = {}
        for root, _, files in os.walk(self.out):
            for fn in files:
                with open(os.path.join(root, fn), encoding='utf-8') as f:
                    out[os.path.relpath(os.path.join(root, fn), self.out)] = f.read()
        return out

    def test_cache_run_equals_full_run(self):
        p = self.parse('LOM')
        for d in ('20200101', '20200102'):
            write_day(p, 'PREC', d, {'A': (ts_list(d, [0, 1]), [1.0, 2.0])}, 'VALORE')
            write_day(p, 'TEMP', d, {'A': (ts_list(d, [0, 1]), [4.0, 8.0])}, 'VALORE')
        self.run_region('LOM')
        write_day(p, 'PREC', '20200103', {'A': (ts_list('20200103', [5]), [1.0])}, 'VALORE')
        _, n = self.run_region('LOM')
        self.assertEqual(n, 1)                                  # solo il giorno nuovo
        cached = self.tree()
        shutil.rmtree(self.out)
        self.run_region('LOM', full=True)
        self.assertEqual(cached, self.tree())

    def test_old_day_not_recomputed_but_recent_is(self):
        p = self.parse('LOM')
        today = (datetime.datetime.utcnow() + datetime.timedelta(hours=1)).strftime('%Y%m%d')
        write_day(p, 'PREC', '20200101', {'A': (ts_list('20200101', [0]), [1.0])}, 'VALORE')
        write_day(p, 'PREC', today, {'A': (ts_list(today, [0]), [1.0])}, 'VALORE')
        self.run_region('LOM')
        write_day(p, 'PREC', '20200101', {'A': (ts_list('20200101', [0]), [7.0])}, 'VALORE')
        write_day(p, 'PREC', today, {'A': (ts_list(today, [0]), [7.0])}, 'VALORE')
        days, n = self.run_region('LOM')
        self.assertEqual(n, 1)
        self.assertEqual(days['20200101']['A'][0], 1.0)         # vecchio: dalla cache
        self.assertEqual(days[today]['A'][0], 7.0)              # recente: rielaborato

    def test_recent_window_is_three_days(self):
        p = self.parse('LOM')
        now = datetime.datetime.utcnow() + datetime.timedelta(hours=1)
        d2 = (now - datetime.timedelta(days=2)).strftime('%Y%m%d')
        d5 = (now - datetime.timedelta(days=5)).strftime('%Y%m%d')
        for d in (d2, d5):
            write_day(p, 'PREC', d, {'A': (ts_list(d, [0]), [1.0])}, 'VALORE')
        self.run_region('LOM')
        for d in (d2, d5):
            write_day(p, 'PREC', d, {'A': (ts_list(d, [0]), [7.0])}, 'VALORE')
        days, n = self.run_region('LOM')
        self.assertEqual(n, 1)
        self.assertEqual(days[d2]['A'][0], 7.0)                 # dentro i 3 giorni: rielaborato
        self.assertEqual(days[d5]['A'][0], 1.0)                 # fuori: dalla cache

    def test_bad_cache_version_is_ignored(self):
        write_day(self.parse('LOM'), 'PREC', '20200101', {'A': (ts_list('20200101', [0]), [1.0])}, 'VALORE')
        os.makedirs(self.cache)
        with open(os.path.join(self.cache, 'LOM.json'), 'w') as f:
            json.dump({'v': 99, 'days': {'20190101': {'Z': [1, 1, None, None, None, 0]}}}, f)
        days, _ = self.run_region('LOM')
        self.assertEqual(list(days), ['20200101'])

    def test_vanished_station_file_removed(self):
        write_day(self.parse('LOM'), 'PREC', '20200101', {'A': (ts_list('20200101', [0]), [1.0])}, 'VALORE')
        os.makedirs(os.path.join(self.out, 'LOM'))
        for fn in ('Z.json', 'x.json.tmp'):
            open(os.path.join(self.out, 'LOM', fn), 'w').close()
        self.run_region('LOM')
        self.assertEqual(sorted(os.listdir(os.path.join(self.out, 'LOM'))), ['A.json'])

    def test_main_writes_index(self):
        write_day(self.parse('LOM'), 'PREC', '20200101', {'A': (ts_list('20200101', [0]), [1.0])}, 'VALORE')
        write_day(self.parse('LOM'), 'PREC', '20200103', {'B': (ts_list('20200103', [0]), [1.0])}, 'VALORE')
        write_day(self.parse('PIE'), 'TEMP', '20200102', {'C': (ts_list('20200102', [0]), [3.0])}, 'VALORE')
        argv = ['history.py', '--out', self.out, '--cache', self.cache]
        with mock.patch.object(sys, 'argv', argv), contextlib.redirect_stdout(io.StringIO()):
            history.main()
        with open(os.path.join(self.out, 'index.json'), encoding='utf-8') as f:
            idx = json.load(f)
        self.assertEqual(set(idx), {'v', 'updated', 'regions'})
        self.assertEqual(idx['v'], 1)
        self.assertRegex(idx['updated'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d$')
        self.assertEqual(idx['regions'], {'LOM': {'stations': 2, 'from': '20200101', 'to': '20200103'},
                                          'PIE': {'stations': 1, 'from': '20200102', 'to': '20200102'}})
        c = self.station('PIE', 'C')
        self.assertEqual(c, {'v': 1, 'd0': '20200102', 'tn': [3.0], 'tx': [3.0], 'tm': [3.0], 'ht': [1]})


if __name__ == '__main__':
    unittest.main()
