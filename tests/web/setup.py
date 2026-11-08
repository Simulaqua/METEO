#!/usr/bin/env python3
# Prepara (o toglie con --clean) le prove nel browser del radar in site/_radar_test/ (NON pubblicata: deploy.sh
# esclude site/*/ e publish.sh copia solo index.html e i file che carica):
#   test.html       prove di site/radar.js con dati locali (73 fotogrammi finti dal GeoTIFF di tests/fixtures)
#   it_local.html   la pagina vera con i dati locali di site/<REG>/   (?suite=cursor|hash)
#   it_live.html    la pagina vera con i dati e il radar veri da GitHub (?suite=radar|layout[&dark=1][&noradar=1])
#   it_noradar.html la pagina senza radar.js                           (?suite=resilience)
#   it_prod.html    la pagina vera con radar locale a piu' prodotti   (?suite=prodotti)
#   w.html          contenitore largo come un telefono (?w=375&h=812&src=<pagina codificata>)
# Uso: python3 tests/web/setup.py; servire site/ sulla 8772 (launch.json "site"); tests/web/run.sh <pagina>;
#      alla fine python3 tests/web/setup.py --clean
import os, re, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DST = os.path.join(ROOT, 'site', '_radar_test')
if '--clean' in sys.argv:
    shutil.rmtree(DST, ignore_errors=True); print('tolto', DST); sys.exit(0)
shutil.rmtree(os.path.join(DST, '_HIST'), ignore_errors=True)
os.makedirs(os.path.join(DST, 'data', 'SRI'), exist_ok=True)
for f in ('test.html', 'it_tests.js', 'w.html'):
    shutil.copy(os.path.join(ROOT, 'tests', 'web', f), DST)
sys.path.insert(0, ROOT)
import dati_radar as dr
g = dr.merc_grid()
png = dr.render_frame(open(os.path.join(ROOT, 'tests', 'fixtures', 'SRI_202610220820.tif'), 'rb').read(), dr.build_lut(g), g)
T = 1792658700                                        # 2026-10-22 08:45 UTC: 72 fotogrammi + uno piu' recente
for t in [T - i * 300 for i in range(71, -2, -1)]:
    open(os.path.join(DST, 'data', dr.frame_name(t)), 'wb').write(png)
# rilascio 2: riflettivita' (stessi istanti) e temperatura (oraria, 03:00-08:00 UTC) dai GeoTIFF veri dei fixture
for key, fx, src, times in (('VMI', 'VMI_202610221240.tif', 'tm', [T - i * 300 for i in range(71, -1, -1)]),
                            ('TEMP', 'TEMP_202610221200.tif', 'temp', [T - 2700 - i * 3600 for i in range(5, -1, -1)])):
    os.makedirs(os.path.join(DST, 'data', key), exist_ok=True)
    pr = dr.product(key)
    one = dr.render_frame(open(os.path.join(ROOT, 'tests', 'fixtures', fx), 'rb').read(), dr.build_lut(g, src), g, pr)
    for t in times:
        open(os.path.join(DST, 'data', dr.frame_name(t, key)), 'wb').write(one)
# manifest vero (v2) dei dati locali, per la pagina it_prod.html (radar locale a piu' prodotti)
dr.write_manifest(os.path.join(DST, 'data'), {'SRI': [T - i * 300 for i in range(71, -1, -1)],
                                              'VMI': [T - i * 300 for i in range(71, -1, -1)],
                                              'TEMP': [T - 2700 - i * 3600 for i in range(5, -1, -1)]}, g, updated=T)
# Storico: campione vero di history.py (tests/web/storico/) in _radar_test/_HIST; le pagine locali lo leggono da li'
# (HIST_BASE riscritto), cosi' non serve site/_HIST e non si tocca quello vero
shutil.copytree(os.path.join(ROOT, 'tests', 'web', 'storico'), os.path.join(DST, '_HIST'))
src = open(os.path.join(ROOT, 'site', 'index.html'), encoding='utf-8').read()
head = ('<head>\n<base href="../">\n<script>window.__errs=[];addEventListener("error",e=>__errs.push(String(e.message)));'
        'addEventListener("unhandledrejection",e=>__errs.push("promise: "+String(e.reason)));</script>')
for name, base in (('it_local', None), ('it_live', 'https://raw.githubusercontent.com/Simulaqua/METEO/data'),
                   ('it_noradar', None), ('it_prod', None)):
    s = src.replace('<head>', head, 1)
    if base:
        s, n = re.subn(r"const DATA_BASE = .*?;", "const DATA_BASE = '%s';" % base, s, count=1)
        assert n == 1, 'DATA_BASE non trovato'
    if not base:
        s, n = re.subn(r"const HIST_BASE = DATA_BASE\.startsWith\('http'\) \? (.*?) : '\./_HIST';",
                       r"const HIST_BASE = DATA_BASE.startsWith('http') ? \1 : './_radar_test/_HIST';", s, count=1)
        assert n == 1, 'HIST_BASE non trovato'
    if name == 'it_prod':                         # radar locale (data/index.json con SRI, VMI, TEMP)
        s = s.replace('<script src="radar.js">', '<script>window.RADAR_BASE_OVERRIDE="/_radar_test/data";'
                      'window.RADAR_FALLBACK_OVERRIDE="/_radar_test/data_fb";</script>\n<script src="radar.js">', 1)
    if name == 'it_noradar':
        s = s.replace('<script src="radar.js"></script>', '', 1)
    s = s.replace('</body>', '<pre id="out" style="position:fixed;left:0;bottom:0;z-index:9999;background:#fff;font:11px monospace;'
                  'max-height:40vh;overflow:auto"></pre>\n<script src="/_radar_test/it_tests.js"></script>\n</body>', 1)
    open(os.path.join(DST, name + '.html'), 'w', encoding='utf-8').write(s)
print('pronto', DST)
