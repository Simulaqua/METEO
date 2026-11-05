import ast
import glob
import http.server
import os
import shutil
import tempfile
import threading
import time
import unittest
from datetime import datetime
from unittest import mock

import requests

import comune
from comune import (USER_AGENT, civil_to_solar, delete_downloaded, get, get_json, get_text, is_dst_civil,
                    latest_stamp, load_json, save_json, to_float, write_parsed)

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class ServerLocale:
    """Server HTTP locale: opzionalmente la prima connessione cade, le altre rispondono."""

    def __init__(self, cadi_la_prima=False, status=200, corpo=b'{"x": 1}', muto=False):
        self.user_agents = []
        self.fine = threading.Event()
        self.connessioni = 0
        padre = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                padre.connessioni += 1
                if muto:  # accetta e non risponde mai
                    padre.fine.wait(10)
                    return
                if cadi_la_prima and padre.connessioni == 1:
                    self.connection.close()
                    return
                padre.user_agents.append(self.headers.get('User-Agent'))
                self.send_response(status)
                self.send_header('Content-Length', str(len(corpo)))
                self.end_headers()
                self.wfile.write(corpo)

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.url = 'http://127.0.0.1:%d/' % self.server.server_port
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.fine.set()
        self.server.shutdown()
        self.server.server_close()


class TestOraLegale(unittest.TestCase):
    def test_ora_legale_marzo(self):  # 2026: ultima domenica di marzo = 29
        self.assertEqual([is_dst_civil(datetime(2026, 3, 29, h)) for h in (1, 2, 3)], [False, True, True])

    def test_ora_legale_ottobre(self):  # 2026: ultima domenica di ottobre = 25
        self.assertEqual([is_dst_civil(datetime(2026, 10, 25, h)) for h in (1, 2, 3)], [True, True, False])

    def test_da_civile_a_solare(self):
        self.assertEqual(civil_to_solar(datetime(2026, 7, 1, 12, 30)), '202607011130')
        self.assertEqual(civil_to_solar(datetime(2026, 12, 1, 12, 30)), '202612011230')


class TestPiccoli(unittest.TestCase):
    def test_to_float(self):
        self.assertEqual([to_float(x) for x in ('1.5', 2, '', None, 'n.d.', 'nan')],
                         [1.5, 2.0, None, None, None, None])

    def test_region_dir(self):
        self.assertEqual(comune.region_dir('VEN'), os.path.join(comune.BASE, 'VEN'))


class TestJson(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)

    def test_salva_e_rilegge(self):
        p = os.path.join(self.dir, 'sotto', 'f.json')
        save_json({'b': 'àè', 'a': 1}, p, sort_keys=True)
        with open(p, 'rb') as fp:
            self.assertEqual(fp.read(), '{"a":1,"b":"àè"}'.encode('utf-8'))
        self.assertEqual(load_json(p), {'a': 1, 'b': 'àè'})
        self.assertEqual(os.listdir(os.path.dirname(p)), ['f.json'])

    def test_chiavi_non_ordinate_di_default(self):
        p = os.path.join(self.dir, 'f.json')
        save_json({'b': 1, 'a': 2}, p)
        with open(p, 'rb') as fp:
            self.assertEqual(fp.read(), b'{"b":1,"a":2}')

    def test_carica_mancante_vuoto_rotto(self):
        vuoto = os.path.join(self.dir, 'vuoto.json')
        rotto = os.path.join(self.dir, 'rotto.json')
        with open(vuoto, 'w') as fp:
            fp.write('  \n')
        with open(rotto, 'w') as fp:
            fp.write('{"a": [1,')
        mancante = os.path.join(self.dir, 'mancante.json')
        self.assertEqual([load_json(mancante), load_json(vuoto), load_json(rotto)], [{}, {}, {}])


class TestRete(unittest.TestCase):
    def test_get_manda_lo_user_agent_e_riprova(self):
        s = ServerLocale(cadi_la_prima=True)
        self.addCleanup(s.close)
        with mock.patch('comune.time.sleep') as dorme:
            self.assertEqual(get_json(s.url), {'x': 1})
        dorme.assert_called_once_with(5)
        self.assertEqual(s.user_agents, [USER_AGENT])

    def test_get_non_solleva_per_lo_stato(self):
        s = ServerLocale(status=404, corpo=b'no')
        self.addCleanup(s.close)
        self.assertEqual(get(s.url).status_code, 404)

    def test_get_json_errore_http(self):
        s = ServerLocale(status=500, corpo=b'{}')
        self.addCleanup(s.close)
        with self.assertRaises(requests.HTTPError):
            get_json(s.url)

    def test_get_text_decodifica_utf8(self):
        s = ServerLocale(corpo='àè'.encode('utf-8'))
        self.addCleanup(s.close)
        self.assertEqual(get_text(s.url), 'àè')

    def test_get_non_riprova_dopo_un_timeout(self):
        s = ServerLocale(muto=True)
        self.addCleanup(s.close)
        with mock.patch('comune.time.sleep') as dorme:
            with self.assertRaises(requests.Timeout):
                get(s.url, timeout=0.5)
        self.assertEqual(s.connessioni, 1)
        dorme.assert_not_called()

    def test_get_solleva_dopo_due_tentativi(self):
        with mock.patch('comune.time.sleep'), \
                mock.patch('comune.requests.get', side_effect=requests.ConnectionError) as g:
            with self.assertRaises(requests.ConnectionError):
                get('http://x.invalid/')
        self.assertEqual(g.call_count, 2)


class TestWriteParsed(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        for patcher in (mock.patch('comune.BASE', self.dir),
                        mock.patch('comune.now_solar', return_value=datetime(2026, 1, 10, 12, 0))):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.stations = {'S1': {'NOME': 'Uno', 'LAT': 45.0, 'LON': 11.0}}

    def giorno(self, var, day):
        return load_json(os.path.join(self.dir, 'XX', 'data-parsed', var, var + '-' + day + '.json'))

    def test_fonde_e_scarta(self):
        vecchia = '202601010000'  # più di 8 giorni prima dell'orologio fermo
        primo = {'TEMP': {'S1': [('202601100000', 1.0), ('202601100100', 2.0), (vecchia, 9.0),
                                 ('202601100200', None)]}}
        self.assertEqual(write_parsed('XX', self.stations, primo, {'TEMP': '°C'}), 2)
        secondo = {'TEMP': {'S1': [('202601100100', 5.0), ('202601100050', 1.5)]}}
        self.assertEqual(write_parsed('XX', self.stations, secondo, {'TEMP': '°C'}), 1)
        rec = self.giorno('TEMP', '20260110')['S1']
        self.assertEqual(rec['MISURE']['ISTANTE'], ['202601100000', '202601100050', '202601100100'])
        self.assertEqual(rec['MISURE']['VALORE'], [1.0, 1.5, 2.0])
        self.assertEqual(rec['UM'], '°C')
        self.assertEqual(rec['STAZIONE'], {'SCODE': 'S1', 'NOME': 'Uno', 'LAT': 45.0, 'LON': 11.0})
        vecchio_file = os.path.join(self.dir, 'XX', 'data-parsed', 'TEMP', 'TEMP-20260101.json')
        self.assertFalse(os.path.exists(vecchio_file))

    def test_days_none_tiene_le_vecchie(self):
        write_parsed('XX', self.stations, {'TEMP': {'S1': [('202601010000', 9.0)]}}, {'TEMP': '°C'}, days=None)
        self.assertEqual(self.giorno('TEMP', '20260101')['S1']['MISURE']['VALORE'], [9.0])


class TestCartelleGrezze(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        os.makedirs(os.path.join(self.dir, 'a'))
        os.makedirs(os.path.join(self.dir, 'b'))

    def tocca(self, sub, name, eta_min=0):
        p = os.path.join(self.dir, sub, name)
        with open(p, 'w') as fp:
            fp.write('x')
        t = time.time() - eta_min * 60
        os.utime(p, (t, t))
        return p

    def test_latest_stamp(self):
        self.assertIsNone(latest_stamp(self.dir, ['a', 'b', 'manca']))
        self.tocca('a', '20260101-100000-x.xml')
        self.tocca('b', '20260102-090000-y.xml')
        self.tocca('b', 'senzatrattino')
        self.assertEqual(latest_stamp(self.dir, ['a', 'b', 'manca']), '20260102-090000')

    def test_delete_solo_il_lotto(self):
        mio = self.tocca('a', '20260102-090000-x.xml')
        altro = self.tocca('a', '20260101-090000-x.xml', eta_min=1000)
        self.assertEqual(delete_downloaded(self.dir, ['a', 'manca'], '20260102-090000'), 1)
        self.assertFalse(os.path.exists(mio))
        self.assertTrue(os.path.exists(altro))

    def test_delete_con_stale_min_spazza_gli_orfani(self):
        mio = self.tocca('a', '20260102-090000-x.xml')
        orfano = self.tocca('b', '20260101-090000-x.xml', eta_min=200)
        fresco = self.tocca('b', '20260101-100000-x.xml', eta_min=5)
        self.assertEqual(delete_downloaded(self.dir, ['a', 'b'], '20260102-090000', stale_min=90), 2)
        self.assertFalse(os.path.exists(mio))
        self.assertFalse(os.path.exists(orfano))
        self.assertTrue(os.path.exists(fresco))


def script_python():
    return [os.path.join(RADICE, 'comune.py')] + sorted(glob.glob(os.path.join(RADICE, 'dati_*.py')))


class TestPython37(unittest.TestCase):
    def test_python37(self):
        vietate = [('math', 'prod'), ('math', 'dist'), ('functools', 'cache')]
        for f in script_python():
            with open(f, encoding='utf-8') as fp:
                tree = ast.parse(fp.read(), feature_version=(3, 7))
            for nodo in ast.walk(tree):
                dove = '%s:%s' % (os.path.basename(f), getattr(nodo, 'lineno', '?'))
                if isinstance(nodo, ast.Import):
                    for a in nodo.names:
                        self.assertNotEqual(a.name.split('.')[0], 'zoneinfo', dove)
                elif isinstance(nodo, ast.ImportFrom):
                    self.assertNotEqual((nodo.module or '').split('.')[0], 'zoneinfo', dove)
                elif isinstance(nodo, ast.Attribute):
                    self.assertNotIn(nodo.attr, ('removeprefix', 'removesuffix'), dove)
                    if isinstance(nodo.value, ast.Name):
                        self.assertNotIn((nodo.value.id, nodo.attr), vietate, dove)


if __name__ == '__main__':
    unittest.main()
