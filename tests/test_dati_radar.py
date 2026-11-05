# Test di dati_radar.py (radar SRI della Protezione Civile -> fotogrammi PNG per la mappa).
# Solo libreria standard + numpy/Pillow: gira sul Mac e sul Pi (Python 3.7, numpy 1.16, Pillow 5.4).
#   python3 -m unittest tests.test_dati_radar -v
import contextlib, glob, io, json, os, re, shutil, subprocess, sys, tempfile, unittest, urllib.error
from unittest import mock

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import comune
import dati_radar as dr

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'SRI_202610220820.tif')
with open(FIXTURE, 'rb') as _fp:
    FIXTURE_BYTES = _fp.read()
# valori grezzi letti SENZA il codice in prova (per ricavare a mano i risultati attesi)
RAW = np.array(Image.open(io.BytesIO(FIXTURE_BYTES)), dtype=np.float32)
PREC1_STEPS = (0.1, 0.5, 1, 2, 5, 10, 20, 30, 50)            # RAIN_STEPS.PREC1 di site/index.html
PALETTE_HEX = ['#a9d6f2', '#6db3e6', '#3a8fd9', '#2a62c4', '#4b3fb8', '#8a2fb0', '#d0238c', '#e5412d', '#8e0b0b']


class TestGeometria(unittest.TestCase):

    def test_tm_corner(self):
        # angolo in alto a sinistra documentato dal DPC (gdalinfo): 4d31'24.21"E 47d34'15.10"N = (-600000, 650000)
        x, y = dr.tm_forward(4 + 31/60 + 24.21/3600, 47 + 34/60 + 15.10/3600)
        self.assertAlmostEqual(float(x), -600000.0, delta=2.0)
        self.assertAlmostEqual(float(y), 650000.0, delta=2.0)

    def test_tm_origin(self):
        x, y = dr.tm_forward(12.5, 42.0)
        self.assertAlmostEqual(float(x), 0.0, delta=1e-6)
        self.assertAlmostEqual(float(y), 0.0, delta=1e-6)

    def test_grid(self):
        g = dr.merc_grid()
        self.assertEqual((g['width'], g['height']), (773, 517))
        self.assertEqual(g['lon'].shape, (517, 773))
        (s, w), (n, e) = g['bounds']
        for got, want in ((s, 43.307491), (w, 6.0), (n, 47.3), (e, 14.492432)):
            self.assertAlmostEqual(got, want, delta=1e-5)

    def test_lut_udine(self):
        g = dr.merc_grid()
        lut = dr.build_lut(g)
        r, c = dr.grid_pixel(g, 13.23, 46.06)
        src = int(lut[r * 773 + c])
        self.assertGreaterEqual(src, 0)
        self.assertLessEqual(abs(src // 1200 - 198), 1)     # riga del GeoTIFF SRI a Udine
        self.assertLessEqual(abs(src % 1200 - 656), 1)      # colonna

    def test_lut_outside_is_minus_one(self):
        # griglia che sborda oltre il bordo est del GeoTIFF (20.4E a 47N): i pixel fuori valgono -1
        g = dr.merc_grid(lon0=19.0, lon1=23.0, lat0=46.0, lat1=47.0)
        lut = dr.build_lut(g)
        self.assertEqual(int(lut.reshape(g['height'], g['width'])[0, -1]), -1)
        self.assertGreaterEqual(int(lut.reshape(g['height'], g['width'])[0, 0]), 0)


class TestCacheLut(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_lut_cache_is_reused(self):
        g = dr.merc_grid()
        first = dr.load_or_build_lut(self.tmp, g)
        files = glob.glob(os.path.join(self.tmp, '.lut-*.npy'))
        self.assertEqual(len(files), 1)
        # se la seconda chiamata ricostruisse invece di leggere la cache, non vedrebbe il segnaposto
        np.save(files[0], np.full(first.shape, 7, np.int32))
        second = dr.load_or_build_lut(self.tmp, g)
        self.assertTrue((second == 7).all())

    def test_lut_cache_key_follows_grid(self):
        dr.load_or_build_lut(self.tmp, dr.merc_grid())
        dr.load_or_build_lut(self.tmp, dr.merc_grid(lon0=7.0))
        self.assertEqual(len(glob.glob(os.path.join(self.tmp, '.lut-*.npy'))), 2)


class TestFotogramma(unittest.TestCase):

    def test_read_fixture(self):
        a = dr.read_sri(FIXTURE_BYTES)
        self.assertEqual(a.shape, (1400, 1200))
        self.assertEqual(a.dtype, np.float32)
        self.assertAlmostEqual(float(a.max()), 50.02, delta=0.01)
        self.assertTrue((a == -9999).any())

    def test_read_garbage_raises(self):
        # il DPC puo' rispondere con una pagina d'errore al posto del GeoTIFF
        with self.assertRaises((OSError, dr.GeorefError)):
            dr.read_sri(b'<html>errore</html>')

    def test_georef_reject(self):
        dr.check_georef((1000.0, 1000.0, 0.0), (0.0, 0.0, 0.0, -600000.0, 650000.0, 0.0))
        with self.assertRaises(dr.GeorefError):
            dr.check_georef((2000.0, 2000.0, 0.0), (0.0, 0.0, 0.0, -600000.0, 650000.0, 0.0))
        with self.assertRaises(dr.GeorefError):
            dr.check_georef((1000.0, 1000.0, 0.0), (0.0, 0.0, 0.0, -500000.0, 650000.0, 0.0))
        with self.assertRaises(dr.GeorefError):
            dr.check_georef(None, None)                       # tag assenti

    def test_classify_edges(self):
        v = np.array([0.0999, 0.1, 0.4999, 0.5, 49.99, 50, 120, -9999, np.nan], dtype=np.float32)
        self.assertEqual(dr.classify(v).tolist(), [0, 1, 1, 2, 8, 9, 9, 0, 0])
        self.assertEqual(dr.classify(v).dtype, np.uint8)

    def test_png_palette(self):
        cls = np.zeros((517, 773), np.uint8)
        cls[0, 0] = 5
        cls[10, 20] = 9
        im = Image.open(io.BytesIO(dr.encode_png(cls)))
        self.assertEqual(im.mode, 'P')
        self.assertEqual(im.size, (773, 517))
        self.assertEqual(im.info.get('transparency'), 0)
        pal = im.getpalette()
        for i, hx in enumerate(PALETTE_HEX, start=1):
            self.assertEqual(pal[3*i:3*i+3], [int(hx[1:3], 16), int(hx[3:5], 16), int(hx[5:7], 16)])
        self.assertEqual(im.getpixel((0, 0)), 5)
        self.assertEqual(im.getpixel((20, 10)), 9)
        self.assertEqual(im.getpixel((1, 0)), 0)

    def test_render_fixture(self):
        g = dr.merc_grid()
        lut = dr.build_lut(g)
        png = dr.render_frame(FIXTURE_BYTES, lut, g)
        self.assertLess(len(png), 30 * 1024)
        im = Image.open(io.BytesIO(png))
        self.assertEqual(im.size, (773, 517))
        cls = np.array(im)
        # Udine alle 08:20 UTC: pioggia debole (0.16-1.13 mm/h attorno)
        r, c = dr.grid_pixel(g, 13.23, 46.06)
        src = int(lut[r * 773 + c])
        raw = float(RAW[src // 1200, src % 1200])
        expected = sum(1 for s in PREC1_STEPS if raw >= s)
        self.assertIn(expected, (1, 2, 3))
        self.assertEqual(int(cls[r, c]), expected)
        # dove il GeoTIFF vale -9999 (fuori copertura) il fotogramma e' trasparente
        fuori = RAW.ravel()[lut] == -9999
        self.assertTrue(fuori.any())
        self.assertTrue((cls.ravel()[fuori] == 0).all())


T_LAST = 1792658700                                           # 2026-10-22 08:45 UTC


def touch(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').close()


class TestFinestra(unittest.TestCase):

    def setUp(self):
        self.out = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.out, ignore_errors=True)

    def test_frame_times(self):
        ts = dr.frame_times(T_LAST * 1000)
        self.assertEqual(len(ts), 72)
        self.assertEqual(ts[-1], T_LAST)
        self.assertEqual(ts[0], T_LAST - 21300)
        self.assertEqual(sorted(set(b - a for a, b in zip(ts, ts[1:]))), [300])

    def test_frame_times_floors_to_step(self):
        # un istante non allineato non deve produrre nomi di file che al DPC non esistono
        self.assertEqual(dr.frame_times(T_LAST * 1000 + 61234)[-1], T_LAST)

    def test_frame_name(self):
        self.assertEqual(dr.frame_name(T_LAST), 'SRI/202610220845.png')

    def test_missing_order(self):
        ts = dr.frame_times(T_LAST * 1000)
        for t in ts:
            if t not in (ts[10], ts[50]):
                touch(os.path.join(self.out, dr.frame_name(t)))
        self.assertEqual(dr.missing_frames(self.out, ts), [ts[50], ts[10]])   # prima il piu' recente

    def test_prune(self):
        ts = dr.frame_times(T_LAST * 1000)
        for name in ('SRI/202610220225.png', 'SRI/202610220845.png', 'index.json', 'LICENSE.txt', '.lut-abc.npy'):
            touch(os.path.join(self.out, name))
        self.assertEqual(dr.prune(self.out, ts), ['SRI/202610220225.png'])  # 02:25 < 02:50 = inizio finestra
        for name in ('SRI/202610220845.png', 'index.json', 'LICENSE.txt', '.lut-abc.npy'):
            self.assertTrue(os.path.exists(os.path.join(self.out, name)), name)

    def test_manifest(self):
        ts = dr.frame_times(T_LAST * 1000)
        present = [t for t in ts if t not in (ts[0], ts[30])]
        for t in present:
            touch(os.path.join(self.out, dr.frame_name(t)))
        g = dr.merc_grid()
        dr.write_manifest(self.out, {'SRI': ts}, g, updated=1792659000)
        with open(os.path.join(self.out, 'index.json'), encoding='utf-8') as fp:
            m = json.load(fp)
        self.assertEqual(m['v'], 2)                     # rilascio 2: piu' prodotti, campi del rilascio 1 invariati
        self.assertEqual(m['updated'], 1792659000)
        self.assertIn('Radar-DPC', m['source'])
        self.assertEqual(m['license'], 'CC BY-SA 4.0')
        p = m['products']['SRI']
        self.assertEqual((p['unit'], p['step'], p['size']), ('mm/h', 300, [773, 517]))
        self.assertEqual(p['steps'], [0.1, 0.5, 1, 2, 5, 10, 20, 30, 50])
        (s, w), (n, e) = p['bounds']
        for got, want in ((s, 43.307491), (w, 6.0), (n, 47.3), (e, 14.492432)):
            self.assertAlmostEqual(got, want, delta=1e-6)
        self.assertEqual(p['frames'], present)                  # crescenti, solo i file che esistono

    def test_window_ignores_clock(self):
        # Pi senza RTC: dopo un riavvio l'orologio puo' segnare il 1970. La finestra dipende solo dall'API.
        ts = dr.frame_times(T_LAST * 1000)
        touch(os.path.join(self.out, dr.frame_name(ts[-1])))
        for fake_now in (0, 1900000000):
            with mock.patch('time.time', return_value=fake_now):
                self.assertEqual(dr.frame_times(T_LAST * 1000), ts)
                self.assertEqual(dr.prune(self.out, ts), [])
                self.assertEqual(len(dr.missing_frames(self.out, ts)), 71)


SRI_ONLY = [dr.product('SRI')]


class FakeDPC(object):
    ''' API DPC finta con la stessa struttura delle risposte vere; ogni GeoTIFF e' il fixture. '''

    def __init__(self, last=T_LAST, fail=(), clock_step=0.0):
        self.last, self.fail, self.clock_step, self.now = last, set(fail), clock_step, 1000.0
        self.downloads = []

    def clock(self):
        return self.now

    def fetch_json(self, url, body=None):
        if 'findLastProductByType' in url:
            return {'total': 1, 'lastProducts': [{'productType': 'SRI', 'time': self.last * 1000, 'period': 'PT5M'}]}
        t = body['productDate'] // 1000
        if t in self.fail:
            raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
        key = 'SRI/' + dr.time.strftime('%d-%m-%Y-%H-%M', dr.time.gmtime(t)) + '.tif'
        return {'bucket': 'dpc-radar', 'key': key, 'url': 'https://example.invalid/' + key, 'expiresSeconds': 300}

    def fetch_bytes(self, url):
        self.downloads.append(url)
        self.now += self.clock_step
        return FIXTURE_BYTES


def pngs(out):
    return sorted(os.path.relpath(p, out) for p in glob.glob(os.path.join(out, 'SRI', '*.png')))


class TestGiro(unittest.TestCase):

    def setUp(self):
        self.out = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.out, ignore_errors=True)

    def run_once(self, dpc, **kw):
        return dr.run_once(self.out, dpc.fetch_json, dpc.fetch_bytes, clock=dpc.clock, products=SRI_ONLY, **kw)

    def test_run_fills_window(self):
        s = self.run_once(FakeDPC())
        self.assertEqual((s['new'], s['missing'], s['failed']), (72, 0, 0))
        self.assertEqual(len(pngs(self.out)), 72)
        self.assertTrue(os.path.exists(os.path.join(self.out, 'LICENSE.txt')))
        with open(os.path.join(self.out, 'index.json'), encoding='utf-8') as fp:
            self.assertEqual(len(json.load(fp)['products']['SRI']['frames']), 72)
        again = FakeDPC()
        self.assertEqual(self.run_once(again)['new'], 0)
        self.assertEqual(again.downloads, [])                    # niente riscaricato
        # 5 minuti dopo: entra un fotogramma nuovo, esce il piu' vecchio
        later = self.run_once(FakeDPC(last=T_LAST + 300))
        self.assertEqual(later['new'], 1)
        # il vecchio primo (02:50) resta un giro in piu' (un indice in cache su raw lo cita ancora), ma fuori dall'indice
        self.assertEqual(pngs(self.out)[:2], ['SRI/202610220250.png', 'SRI/202610220255.png'])
        self.assertEqual(pngs(self.out)[-1], 'SRI/202610220850.png')
        frames = json.load(open(os.path.join(self.out, 'index.json'), encoding='utf-8'))['products']['SRI']['frames']
        self.assertEqual(frames[0], T_LAST + 300 - 21300)                       # 02:55
        self.run_once(FakeDPC(last=T_LAST + 600))
        self.assertEqual(pngs(self.out)[0], 'SRI/202610220255.png')            # 02:50 ora va via

    def test_download_404(self):
        ts = dr.frame_times(T_LAST * 1000)
        s = self.run_once(FakeDPC(fail=[ts[40]]))
        self.assertEqual((s['new'], s['failed'], s['missing']), (71, 1, 1))
        self.assertNotIn(dr.frame_name(ts[40]), pngs(self.out))
        retry = self.run_once(FakeDPC())
        self.assertEqual((retry['new'], retry['missing']), (1, 0))

    def test_budget(self):
        s = self.run_once(FakeDPC(clock_step=10.0), budget_s=30)
        self.assertLessEqual(s['new'], 3)
        self.assertGreaterEqual(s['new'], 1)
        self.assertIn('SRI/202610220845.png', pngs(self.out))  # il piu' recente c'e' sempre
        self.assertEqual(s['missing'], 72 - s['new'])


class TestPubblicazione(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.out = os.path.join(self.tmp, 'radar_out')
        dr.run_once(self.out, FakeDPC().fetch_json, FakeDPC().fetch_bytes, budget_s=0, products=SRI_ONLY)   # un fotogramma
        touch(os.path.join(self.out, '.lut-abc.npy'))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def bare(self, name):
        path = os.path.join(self.tmp, name)
        subprocess.check_call(['git', 'init', '-q', '--bare', path])
        return path

    def published(self, remote):
        out = subprocess.check_output(['git', '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'radar'])
        return out.decode().split()

    def test_publish_bare_repo(self):
        remote = self.bare('remote.git')
        self.assertTrue(dr.publish(self.out, remote))
        files = self.published(remote)
        self.assertIn('index.json', files)
        self.assertIn('LICENSE.txt', files)
        self.assertIn('SRI/202610220845.png', files)
        self.assertFalse([f for f in files if f.startswith('.')])   # niente .state.json / .lut-*.npy

    def test_push_failure_retry(self):
        remote = os.path.join(self.tmp, 'manca.git')
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(dr.publish_if_changed(self.out, remote), 'errore')
        self.assertIn('ERRORE git push', buf.getvalue())                        # finisce nel log
        st = json.load(open(os.path.join(self.out, '.state.json')))
        self.assertNotIn('pushed', st)                                          # non risulta pubblicato...
        self.assertEqual(st['fails'], 1)                                        # ...e il fallimento e' contato
        self.bare('manca.git')
        with contextlib.redirect_stdout(io.StringIO()):                         # (compatta: riparte da zero)
            self.assertEqual(dr.publish_if_changed(self.out, remote), 'si')
        self.assertEqual(dr.publish_if_changed(self.out, remote), 'no')        # nulla di nuovo
        self.assertIn('SRI/202610220845.png', self.published(remote))


class TestRigaDiComando(unittest.TestCase):

    def setUp(self):
        self.out = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.out, ignore_errors=True)

    def main(self, dpc, *args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = dr.main(['--out', self.out] + list(args), fetch_json=dpc.fetch_json, fetch_bytes=dpc.fetch_bytes,
                         products=SRI_ONLY)
        return rc, buf.getvalue()

    def test_log_line(self):
        rc, out = self.main(FakeDPC(), '--no-push')
        self.assertEqual(rc, 0)
        self.assertRegex(out.strip(), r'^\d{4}-\d\d-\d\d \d\d:\d\dZ SRI ultimo 08:45 · nuovi 72 · mancanti 0 · '
                                      r'errori 0 · scaricati \d+\.\d MB · push no · \d+\.\d s$')

    def test_api_down(self):
        class Down(FakeDPC):
            def fetch_json(self, url, body=None):
                raise urllib.error.URLError('rete irraggiungibile')
        rc, out = self.main(Down(), '--no-push')
        self.assertEqual(rc, 1)
        self.assertIn('ERRORE', out)
        self.assertIn('rete irraggiungibile', out)

    def test_frame_errors_are_logged(self):
        ts = dr.frame_times(T_LAST * 1000)
        rc, out = self.main(FakeDPC(fail=[ts[-1]]), '--no-push')
        self.assertEqual(rc, 0)
        self.assertIn('errori 1', out)
        self.assertIn('SRI/202610220845.png', out)                # quale fotogramma e perche'


if __name__ == '__main__':
    unittest.main()


# ================================================================================================
# RILASCIO 2: tutti i prodotti della piattaforma Radar-DPC
# ================================================================================================
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
def fixture(name):
    with open(os.path.join(FIX, name), 'rb') as fp:
        return fp.read()
VMI_TIF, CUM3_TIF, TEMP_TIF = (fixture('VMI_202610221240.tif'), fixture('CUM3_202610221230.tif'),
                               fixture('TEMP_202610221200.tif'))


def classes_of(png):
    return np.array(Image.open(io.BytesIO(png)))


class TestProdotti(unittest.TestCase):

    def test_elenco(self):
        keys = [p['key'] for p in dr.PRODUCTS]
        self.assertEqual(len(keys), 23)
        self.assertEqual(keys[:7], ['SRI', 'SRT1', 'CUM3', 'CUM6', 'CUM12', 'CUM24', 'CUM48'])
        self.assertIn('CAPPI10', keys)
        steps = {p['key']: p['step'] for p in dr.PRODUCTS}
        self.assertEqual((steps['SRI'], steps['CAPPI1'], steps['IR108'], steps['CUM3'], steps['TEMP']), (300, 600, 900, 1800, 3600))

    def test_palette_coerenti(self):
        for p in dr.PRODUCTS:
            self.assertEqual(len(p['colors']), len(p['steps']) + 1, p['key'])
            self.assertEqual(sorted(p['steps']), list(p['steps']), p['key'])

    def test_pioggia_come_le_stazioni(self):
        self.assertEqual(dr.product('CUM24')['steps'], [0.2, 2, 5, 10, 25, 50, 100, 150, 200])   # RAIN_STEPS.PREC24
        self.assertEqual(dr.product('CUM48')['dots'], 'PREC48')
        self.assertEqual(dr.product('TEMP')['dots'], 'TEMP')
        self.assertIsNone(dr.product('VMI')['dots'])


class TestGriglie(unittest.TestCase):

    def test_read_grid(self):
        self.assertEqual(dr.read_grid(VMI_TIF, 'tm').shape, (1400, 1200))
        self.assertEqual(dr.read_grid(CUM3_TIF, 'll01').shape, (1233, 1341))
        self.assertEqual(dr.read_grid(TEMP_TIF, 'temp').shape, (576, 631))
        with self.assertRaises(dr.GeorefError):
            dr.read_grid(CUM3_TIF, 'tm')                     # griglia diversa da quella attesa
        with self.assertRaises(dr.GeorefError):
            dr.read_grid(VMI_TIF, 'temp')

    def test_lut_lonlat(self):
        g = dr.merc_grid()
        r, c = dr.grid_pixel(g, 13.23, 46.06)                 # Udine
        src = int(dr.build_lut(g, 'll01')[r * 773 + c])
        self.assertLessEqual(abs(src // 1341 - 152), 1)      # (47.58-46.06)/0.01
        self.assertLessEqual(abs(src % 1341 - 763), 1)       # (13.23-5.6)/0.01
        src = int(dr.build_lut(g, 'temp')[r * 773 + c])
        self.assertLessEqual(abs(src // 631 - 72), 1)        # (47.50026-46.06)/0.019983
        self.assertLessEqual(abs(src % 631 - 361), 1)        # (13.23-6.0)/0.019983

    def test_lut_cache_per_sorgente(self):
        tmp = tempfile.mkdtemp()
        try:
            g = dr.merc_grid()
            dr.load_or_build_lut(tmp, g)
            dr.load_or_build_lut(tmp, g, 'll01')
            self.assertEqual(len(glob.glob(os.path.join(tmp, '.lut-*.npy'))), 2)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class TestValori(unittest.TestCase):

    def png_classes(self, key, vals):
        p = dr.product(key)
        return classes_of(dr.render_values(dr.prepare(np.array([vals], np.float32), p), p))[0].tolist()

    def test_dbz(self):                                     # -9998 nessuna eco, -5 debole, 12 e 37 dBZ
        self.assertEqual(self.png_classes('VMI', [-9998, -5, 12, 37]), [0, 0, 1, 6])

    def test_temperatura_tutta_opaca(self):                 # nessun dato -> indice dopo le 25 classi
        self.assertEqual(self.png_classes('TEMP', [-99999, -11, 0, 37]), [25, 0, 6, 24])

    def test_nuvole(self):                                  # 5 gradi = sereno (trasparente), -55 = cima fredda
        im = Image.open(io.BytesIO(dr.render_values(dr.prepare(np.array([[5, -55]], np.float32), dr.product('IR108')),
                                                    dr.product('IR108'))))
        rgba = im.convert('RGBA')
        self.assertEqual(rgba.getpixel((0, 0))[3], 0)
        self.assertEqual(rgba.getpixel((1, 0))[3], 255)

    def test_conversioni(self):                             # ETM metri -> km, POH frazione -> %
        self.assertEqual(self.png_classes('ETM', [3500]), [2])        # 3-4 km
        self.assertEqual(self.png_classes('POH', [0.75]), [4])        # 70-90 %

    def test_valori_impossibili(self):                      # 857 mm in 3 h (pixel spurio visto nel DPC) = nessun dato
        self.assertEqual(self.png_classes('CUM3', [856.8, 12.0]), [0, 5])

    def test_pioggia_identica_al_rilascio1(self):
        g = dr.merc_grid()
        lut = dr.build_lut(g)
        self.assertEqual(dr.render_frame(FIXTURE_BYTES, lut, g), dr.render_frame(FIXTURE_BYTES, lut, g, dr.product('SRI')))
        self.assertEqual(Image.open(io.BytesIO(dr.render_frame(FIXTURE_BYTES, lut, g))).info.get('transparency'), 0)

    def test_frame_cum_e_temp(self):
        g = dr.merc_grid()
        for key, tif, src in (('CUM3', CUM3_TIF, 'll01'), ('TEMP', TEMP_TIF, 'temp')):
            png = dr.render_frame(tif, dr.build_lut(g, src), g, dr.product(key))
            self.assertEqual(Image.open(io.BytesIO(png)).size, (773, 517), key)
            self.assertLess(len(png), 60 * 1024, key)


class TestFinestreProdotti(unittest.TestCase):

    def setUp(self):
        self.out = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.out, ignore_errors=True)

    def test_finestre(self):
        w = lambda k: dr.window(dr.product(k), T_LAST * 1000)            # ultimo istante 08:45 UTC
        self.assertEqual((len(w('SRI')), len(w('CAPPI1')), len(w('IR108')), len(w('CUM3')), len(w('TEMP'))), (72, 36, 24, 12, 6))
        self.assertEqual(w('CAPPI1')[-1], T_LAST - 300)                   # 08:40, passo 10 min
        self.assertEqual(w('IR108')[-1], T_LAST)                          # 08:45, passo 15 min
        self.assertEqual(w('CUM3')[-1], T_LAST - 900)                     # 08:30
        self.assertEqual(w('TEMP')[-1], T_LAST - 2700)                    # 08:00
        self.assertTrue(all(t % 600 == 0 for t in w('CAPPI1')) and all(t % 900 == 0 for t in w('IR108')))

    def test_nomi_per_prodotto(self):
        self.assertEqual(dr.frame_name(T_LAST, 'VMI'), 'VMI/202610220845.png')
        touch(os.path.join(self.out, 'VMI/202610220845.png'))
        self.assertEqual(dr.missing_frames(self.out, [T_LAST - 300, T_LAST], 'VMI'), [T_LAST - 300])
        touch(os.path.join(self.out, 'VMI/202610220100.png'))
        touch(os.path.join(self.out, 'SRI/202610220100.png'))
        self.assertEqual(dr.prune(self.out, [T_LAST], 'VMI'), ['VMI/202610220100.png'])   # tocca solo VMI
        self.assertTrue(os.path.exists(os.path.join(self.out, 'SRI/202610220100.png')))

    def test_somma_48h(self):
        got = dr.combine_sum(np.array([1, np.nan, 3], np.float32), np.array([2, 5, np.nan], np.float32))
        self.assertEqual(got[0], 3)
        self.assertTrue(np.isnan(got[1]) and np.isnan(got[2]))

    def test_manifest_multi(self):
        g = dr.merc_grid()
        windows = {'SRI': [T_LAST - 300, T_LAST], 'VMI': [T_LAST], 'TEMP': [T_LAST - 2700]}
        for k, ts in windows.items():
            for t in ts:
                touch(os.path.join(self.out, dr.frame_name(t, k)))
        m = dr.write_manifest(self.out, windows, g, updated=1792659000)
        self.assertEqual(m['order'], ['SRI', 'VMI', 'TEMP'])                 # ordine del menu
        p = m['products']['VMI']
        self.assertEqual((p['group'], p['label'], p['unit'], p['step'], p['dots']), ('Radar', 'Riflettività', 'dBZ', 300, None))
        self.assertEqual(len(p['colors']), len(p['steps']) + 1)
        self.assertEqual(m['products']['TEMP']['dots'], 'TEMP')
        s = m['products']['SRI']                                             # campi del rilascio 1 invariati
        self.assertEqual((s['unit'], s['step'], s['size'], s['steps'], s['frames']),
                         ('mm/h', 300, [773, 517], [0.1, 0.5, 1, 2, 5, 10, 20, 30, 50], [T_LAST - 300, T_LAST]))


class FakeDPC2(object):
    ''' Come FakeDPC ma per piu' prodotti: il GeoTIFF giusto per griglia (TM, cumulate, temperatura). '''
    TIF = {'ll01': CUM3_TIF, 'temp': TEMP_TIF}

    def __init__(self, fail_last=(), fail=(), clock_step=0.0):
        self.fail_last, self.fail, self.clock_step, self.now, self.downloads = set(fail_last), set(fail), clock_step, 1000.0, []

    def clock(self):
        return self.now

    def fetch_json(self, url, body=None):
        if 'findLastProductByType' in url:
            api = url.split('type=')[1]
            if api in self.fail_last:
                raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
            return {'total': 1, 'lastProducts': [{'productType': api, 'time': T_LAST * 1000, 'period': 'PT5M'}]}
        api, t = body['productType'], body['productDate'] // 1000
        if (api, t) in self.fail:
            raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
        return {'bucket': 'dpc-radar', 'key': '%s/%d.tif' % (api, t), 'url': 'https://example.invalid/%s/%d' % (api, t),
                'expiresSeconds': 300}

    def fetch_bytes(self, url):
        api = url.split('/')[3]
        self.downloads.append((api, int(url.split('/')[4])))
        self.now += self.clock_step
        grid = 'll01' if api.startswith('CUM') else 'temp' if api == 'TEMP' else 'tm'
        return self.TIF.get(grid, VMI_TIF)


class TestGiroProdotti(unittest.TestCase):

    def setUp(self):
        self.out = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.out, ignore_errors=True)

    def run_once(self, dpc, keys, **kw):
        return dr.run_once(self.out, dpc.fetch_json, dpc.fetch_bytes, clock=dpc.clock,
                           products=[dr.product(k) for k in keys], **kw)

    def test_a_turno(self):                         # col budget per 3 fotogrammi: il piu' recente di ciascun prodotto
        dpc = FakeDPC2(clock_step=10.0)
        s = self.run_once(dpc, ['SRI', 'VMI', 'TEMP'], budget_s=25)
        self.assertEqual(s['new'], 3)
        self.assertEqual(sorted(os.listdir(os.path.join(self.out, 'SRI'))), ['202610220845.png'])
        self.assertEqual(sorted(os.listdir(os.path.join(self.out, 'VMI'))), ['202610220845.png'])
        self.assertEqual(sorted(os.listdir(os.path.join(self.out, 'TEMP'))), ['202610220800.png'])
        self.assertEqual(s['incomplete'], ['SRI', 'VMI', 'TEMP'])

    def test_48h_riusa_la_24h(self):                 # 12 fotogrammi ciascuno: 12 CUM24(t) + 12 CUM24(t-24 h), non 36
        dpc = FakeDPC2()
        s = self.run_once(dpc, ['CUM24', 'CUM48'])
        self.assertEqual((s['new'], s['missing']), (24, 0))
        self.assertEqual(len(dpc.downloads), 24)
        self.assertEqual(len(set(dpc.downloads)), 24)
        m = json.load(open(os.path.join(self.out, 'index.json'), encoding='utf-8'))
        self.assertEqual(len(m['products']['CUM48']['frames']), 12)

    def test_48h_senza_il_giorno_prima(self):       # CUM24 di 24 h prima non c'e' (404): manca solo quel CUM48
        t = T_LAST - 900                             # ultimo CUM24: 08:30
        s = self.run_once(FakeDPC2(fail=[('CUM24', t - 86400)]), ['CUM24', 'CUM48'])
        self.assertEqual((s['new'], s['failed']), (23, 1))
        self.assertNotIn('202610220830.png', os.listdir(os.path.join(self.out, 'CUM48')))
        self.assertIn('202610220830.png', os.listdir(os.path.join(self.out, 'CUM24')))

    def test_prodotto_sparito(self):                 # findLast 404 per un prodotto: gli altri vanno avanti
        s = self.run_once(FakeDPC2(fail_last=['VMI']), ['SRI', 'VMI'], budget_s=0)
        self.assertEqual(s['new'], 1)
        self.assertTrue(any(e.startswith('VMI') for e in s['errors']))
        m = json.load(open(os.path.join(self.out, 'index.json'), encoding='utf-8'))
        self.assertEqual(m['order'], ['SRI'])

    def test_mb_contati(self):
        s = self.run_once(FakeDPC2(), ['TEMP'])
        self.assertAlmostEqual(s['mb'], 6 * len(TEMP_TIF) / 1048576.0, places=3)


class TestPushIncrementale(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.out = os.path.join(self.tmp, 'radar_out')
        self.remote = os.path.join(self.tmp, 'remote.git')
        subprocess.check_call(['git', 'init', '-q', '--bare', self.remote])
        dr.run_once(self.out, FakeDPC().fetch_json, FakeDPC().fetch_bytes, budget_s=0, products=SRI_ONLY)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def git(self, *args):
        return subprocess.check_output(['git', '--git-dir', self.remote] + list(args)).decode().split()

    def nuovo_fotogramma(self):                      # 5 minuti dopo: un PNG in piu' e l'indice aggiornato
        dpc = FakeDPC(last=T_LAST + 300)
        dr.run_once(self.out, dpc.fetch_json, dpc.fetch_bytes, budget_s=0, products=SRI_ONLY)

    def test_secondo_push_ha_genitore(self):
        self.assertEqual(dr.publish_if_changed(self.out, self.remote), 'si')
        first = self.git('rev-parse', 'radar')[0]
        self.nuovo_fotogramma()
        self.assertEqual(dr.publish_if_changed(self.out, self.remote), 'si')
        self.assertEqual(self.git('rev-list', '--count', 'radar'), ['2'])
        self.assertEqual(self.git('rev-list', '--parents', '-n', '1', 'radar')[1], first)     # concatenato: viaggia solo il nuovo
        changed = self.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'radar')
        self.assertEqual(sorted(changed), ['SRI/202610220850.png', 'index.json'])

    def test_compattazione_giornaliera(self):
        dr.publish_if_changed(self.out, self.remote)
        self.nuovo_fotogramma()
        dr.publish_if_changed(self.out, self.remote)
        st = json.load(open(os.path.join(self.out, '.state.json')))
        st['squashed'] = '2000-01-01'                  # ultima compattazione "ieri"
        comune.save_json(st,os.path.join(self.out, '.state.json'))
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(dr.publish_if_changed(self.out, self.remote), 'si')
        self.assertIn('compattazione del branch radar', buf.getvalue())                          # finisce nel log
        self.assertEqual(self.git('rev-list', '--count', 'radar'), ['1'])                       # storia azzerata
        self.assertIn('SRI/202610220850.png', self.git('ls-tree', '-r', '--name-only', 'radar'))

    def test_tre_errori_poi_compatta(self):
        bad = os.path.join(self.tmp, 'manca.git')
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            dr.publish_if_changed(self.out, self.remote)
            self.nuovo_fotogramma()
            for _ in range(3):
                self.assertEqual(dr.publish_if_changed(self.out, bad), 'errore')
        self.assertEqual(json.load(open(os.path.join(self.out, '.state.json')))['fails'], 3)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(dr.publish_if_changed(self.out, self.remote), 'si')
        self.assertEqual(self.git('rev-list', '--count', 'radar'), ['1'])                       # ripartito da zero
        self.assertEqual(json.load(open(os.path.join(self.out, '.state.json')))['fails'], 0)


class TestInviati(unittest.TestCase):

    def test_push_registra_i_byte_inviati(self):     # KPI R4: quanto viaggia davvero a ogni push
        tmp = tempfile.mkdtemp()
        try:
            out, remote = os.path.join(tmp, 'radar_out'), os.path.join(tmp, 'remote.git')
            subprocess.check_call(['git', 'init', '-q', '--bare', remote])
            dr.run_once(out, FakeDPC().fetch_json, FakeDPC().fetch_bytes, budget_s=0, products=SRI_ONLY)
            self.assertEqual(dr.publish_if_changed(out, remote), 'si')
            sent = json.load(open(os.path.join(out, '.state.json')))['sent']
            self.assertRegex(sent, r'^[\d.]+ (bytes|KiB|MiB|GiB)$')
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class TestChiamateRete(unittest.TestCase):
    ''' Le chiamate verso il DPC: header (origin e User-Agent del progetto), corpo JSON, timeout, errori di stato. '''

    @staticmethod
    def risposta(status, content=b'{"url":"https://example.invalid/x"}'):
        r = mock.Mock()
        r.status_code, r.content = status, content
        r.raise_for_status.side_effect = None if status < 400 else dr.requests.HTTPError('stato %d' % status)
        return r

    def test_post_manda_origin_user_agent_e_corpo_json(self):
        with mock.patch('requests.post', return_value=self.risposta(200)) as post:
            out = dr.post_json(dr.API + '/downloadProduct', {'productType': 'SRI', 'productDate': 1000})
        self.assertEqual(out, {'url': 'https://example.invalid/x'})
        args, kw = post.call_args
        self.assertEqual(args[0], dr.API + '/downloadProduct')
        self.assertEqual(kw['json'], {'productType': 'SRI', 'productDate': 1000})
        self.assertEqual(kw['headers'], {'origin': dr.ORIGIN, 'User-Agent': dr.USER_AGENT})
        self.assertEqual(kw['timeout'], 30)

    def test_post_con_errore_di_stato_solleva(self):
        with mock.patch('requests.post', return_value=self.risposta(404)):
            with self.assertRaises(dr.requests.RequestException):
                dr.post_json(dr.API + '/downloadProduct', {})

    def test_get_json_e_bytes_usano_comune_get_con_i_loro_header(self):
        with mock.patch('requests.get', return_value=self.risposta(200, b'{"lastProducts":[]}')) as get:
            self.assertEqual(dr.dpc_json(dr.API + '/findLastProductByType?type=SRI'), {'lastProducts': []})
        self.assertEqual(get.call_args[1]['headers'], {'origin': dr.ORIGIN, 'User-Agent': dr.USER_AGENT})
        self.assertEqual(get.call_args[1]['timeout'], 30)
        with mock.patch('requests.get', return_value=self.risposta(200, b'II*\x00')) as get:
            self.assertEqual(dr.http_bytes('https://example.invalid/f.tif'), b'II*\x00')
        self.assertEqual(get.call_args[1]['headers'], {'User-Agent': dr.USER_AGENT})
        self.assertEqual(get.call_args[1]['timeout'], 60)

    def test_get_con_errore_di_stato_solleva(self):
        with mock.patch('requests.get', return_value=self.risposta(404)):
            with self.assertRaises(dr.requests.RequestException):
                dr.http_bytes('https://example.invalid/f.tif')
