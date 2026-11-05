#!/usr/bin/env python3

# dati_radar.py - RADAR METEO NAZIONALE della Protezione Civile (piattaforma Radar-DPC) per la mappa del sito.
#   Prodotto SRI (Surface Rainfall Intensity, mm/h): mosaico radar corretto coi pluviometri, ogni 5 minuti,
#   griglia 1 km su tutta Italia. Licenza CC BY-SA 4.0 (citare "Radar-DPC").
#
#   Accesso (API REST documentata, https://dpc-radar.readthedocs.io/it/latest/api.html), anonimo:
#     GET  https://radar-api.protezionecivile.it/findLastProductByType?type=SRI -> ultimo istante (ms UTC)
#     POST https://radar-api.protezionecivile.it/downloadProduct {"productType","productDate"} -> URL S3 firmato
#          (scade dopo 300 s) del GeoTIFF Float32 1200x1400.
#   Il GeoTIFF e' in una Transverse Mercator "custom" (lat0 42, lon0 12.5, k 1, WGS84), origine
#   (-600000, 650000), pixel 1000 m; -9999 = fuori copertura (senza tag NoData).
#
# Cosa fa ogni giro (cron ogni 5 min): tiene le ULTIME 6 ORE (72 fotogrammi), riproiettate su una griglia
# Web Mercator fissa del Nord Italia e salvate come PNG a palette con le classi della pioggia oraria del sito,
# piu' un indice index.json; poi pubblica tutto sul branch GitHub 'radar' (letto da site/radar.js).
#
# Uso:  python3 dati_radar.py [--out radar_out] [--no-push] [--remote URL]

import argparse, glob, hashlib, io, json, math, os, re, shutil, subprocess, sys, tempfile, time

import numpy as np
import requests
from PIL import Image

import comune

_BASE_DIR = os.path.dirname(os.path.realpath(__file__))

PRODUCT = 'SRI'
STEP_S = 300                                         # un fotogramma ogni 5 minuti
WINDOW_N = 72                                        # = ultime 6 ore
SOURCE = 'Radar-DPC – Dipartimento della Protezione Civile'
LICENSE = 'CC BY-SA 4.0'
API = 'https://radar-api.protezionecivile.it'
ORIGIN = 'https://radar.protezionecivile.it'          # la documentazione chiede l'header origin
USER_AGENT = 'meteo.simulaqua.it radar (+https://meteo.simulaqua.it)'
REMOTE = 'git@github.com:Simulaqua/METEO.git'         # stesso repo e deploy key di publish.sh
BRANCH = 'radar'
LICENSE_TXT = ('Fotogrammi derivati da Radar-DPC - Dipartimento della Protezione Civile (prodotto SRI, mm/h),\n'
               'licenza CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/deed.it\n'
               'Elaborazione (riproiezione Web Mercator, classi di colore): meteo.simulaqua.it\n')

# --- geometria -------------------------------------------------------------------------------------------
R_MERC = 6378137.0                                   # sfera di Web Mercator
RES = 2 * math.pi * R_MERC / 256 / 128               # m/pixel di Leaflet a zoom 7 (~0.87 km a 45N)
GRID = dict(lon0=6.0, lon1=14.5, lat0=43.3, lat1=47.3)   # Nord Italia, con margine attorno alle regioni del sito

TM_LON0, TM_LAT0 = 12.5, 42.0                        # proiezione del GeoTIFF DPC
WGS84_A, WGS84_F = 6378137.0, 1 / 298.257223563

# --- classi e colori: GLI STESSI della pioggia oraria in site/index.html (RAIN_STEPS.PREC1, RAIN_COLORS) ------
# cosi' radar e puntini delle stazioni hanno la stessa scala. Classe 0 (sotto 0.1 mm/h) = trasparente.
PREC1_STEPS = [0.1, 0.5, 1, 2, 5, 10, 20, 30, 50]
RAIN_COLORS = ['#e3e9f0', '#a9d6f2', '#6db3e6', '#3a8fd9', '#2a62c4', '#4b3fb8', '#8a2fb0', '#d0238c', '#e5412d', '#8e0b0b']
RAIN_STEPS = {'PREC1': PREC1_STEPS, 'PREC3': [0.1, 1, 2, 5, 10, 20, 40, 60, 80], 'PREC6': [0.2, 1, 3, 6, 12, 25, 50, 75, 100],
              'PREC12': [0.2, 2, 5, 10, 20, 40, 70, 100, 150], 'PREC24': [0.2, 2, 5, 10, 25, 50, 100, 150, 200],
              'PREC48': [0.2, 5, 10, 25, 50, 100, 150, 200, 300]}

# --- palette degli altri prodotti: classe i = n. di soglie <= valore; colors ha una voce in piu' delle soglie,
# '' = trasparente. Sulla mappa la classe 0 della pioggia e' trasparente (sui puntini e' il grigio chiaro).
RAIN_MAP = [''] + RAIN_COLORS[1:]
DBZ = ([10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
       ['', '#04e9e7', '#019ff4', '#0300f4', '#02fd02', '#01c501', '#008e00', '#fdf802', '#e5bc00', '#fd9500', '#fd0000', '#bc0000'])
VIL = ([0.5, 1, 2, 5, 10, 20, 30, 45, 60],
       ['', '#c6e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#fed976', '#fd8d3c', '#e31a1c', '#800026'])
ETM = ([2, 3, 4, 5, 6, 8, 10, 12], ['', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#fdae6b', '#e6550d', '#a63603'])
POH = ([10, 30, 50, 70, 90], ['', '#fee391', '#fec44f', '#fe9929', '#d95f0e', '#993404'])
IR108 = ([-60, -50, -40, -30, -20, -10, 0],            # cime fredde colorate, nuvole in grigio, sopra 0 gradi trasparente
         ['#c51b8a', '#e31a1c', '#fd8d3c', '#ffffff', '#e0e0e0', '#bdbdbd', '#969696', ''])
TEMP = (list(range(-10, 37, 2)),                       # tutte opache: anche il freddo e' un'informazione
        ['#313695', '#3a4fa3', '#4467b1', '#4f80bf', '#5b98cb', '#6fb0d8', '#87c4e2', '#a1d6ec', '#bce5f1', '#d6eff5',
         '#ecf7ee', '#f6f8d9', '#fff2b8', '#fee59a', '#fed27c', '#fdbd63', '#fca54f', '#f88b42', '#f27038', '#e7562f',
         '#d93d29', '#c72825', '#b11a22', '#981222', '#7f0d22'])

# --- griglie sorgente del DPC (georeferenziazione attesa, controllata a ogni file) -------------------------------
GRIDS = {'tm':   dict(kind='tm', w=1200, h=1400, x0=-600000.0, y0=650000.0, px=1000.0),       # radar e satellite, 1 km
         'll01': dict(kind='ll', w=1341, h=1233, x0=5.6, y0=47.58, px=0.01),                   # cumulate (EPSG:4326)
         'temp': dict(kind='ll', w=631, h=576, x0=6.0, y0=47.50026321411133, px=0.019983009747110096)}   # temperatura


def _prod(key, api, step, pal, unit, group, label, grid='tm', dots=None, scale=1, vmin=None, vmax=None, combine=None):
    return dict(key=key, api=api, step=step, steps=list(pal[0]), colors=list(pal[1]), unit=unit, group=group,
                label=label, grid=grid, dots=dots, scale=scale, vmin=vmin, vmax=vmax, combine=combine)


# I 23 prodotti, nell'ordine del menu del sito. step = passo dei fotogrammi (quote e nuvole campionate a 10 e 15 min sui
# 5 nativi); dots = variabile delle stazioni con la stessa scala; vmin/vmax = valori fisicamente impossibili -> nessun
# dato (nel DPC si vedono pixel spuri, es. 857 mm in 3 h); combine = secondi da sommare (48 h = 24 h + 24 h prima).
PRODUCTS = ([_prod('SRI', 'SRI', 300, (PREC1_STEPS, RAIN_MAP), 'mm/h', 'Pioggia', 'Adesso', dots='PREC1', vmax=300),
             _prod('SRT1', 'SRT1', 300, (PREC1_STEPS, RAIN_MAP), 'mm', 'Pioggia', '1 h', dots='PREC1', vmax=300)]
            + [_prod('CUM%d' % h, 'CUM%d' % h, 1800, (RAIN_STEPS['PREC%d' % h], RAIN_MAP), 'mm', 'Pioggia', '%d h' % h,
                     grid='ll01', dots='PREC%d' % h, vmax=vm) for h, vm in ((3, 400), (6, 500), (12, 700), (24, 1000))]
            + [_prod('CUM48', 'CUM24', 1800, (RAIN_STEPS['PREC48'], RAIN_MAP), 'mm', 'Pioggia', '48 h', grid='ll01',
                     dots='PREC48', vmax=1500, combine=86400),
               _prod('VMI', 'VMI', 300, DBZ, 'dBZ', 'Radar', 'Riflettività', vmax=80)]
            + [_prod('CAPPI%d' % i, 'CAPPI_%d' % i, 600, DBZ, 'dBZ', 'Radar', 'Riflettività a %d km' % i, vmax=80)
               for i in range(1, 11)]
            + [_prod('VIL', 'VIL', 300, VIL, 'kg/m²', 'Radar', 'Acqua in colonna', vmax=150),
               _prod('ETM', 'ETM', 300, ETM, 'km', 'Radar', 'Altezza temporali', scale=0.001, vmax=20),
               _prod('POH', 'POH', 300, POH, '%', 'Radar', 'Grandine', scale=100, vmax=100),
               _prod('IR108', 'IR_108', 900, IR108, '°C', 'Altro', 'Nuvole', vmin=-100, vmax=60),
               _prod('TEMP', 'TEMP', 3600, TEMP, '°C', 'Altro', 'Temperatura', grid='temp', dots='TEMP', vmin=-40, vmax=50)])
_BY_KEY = dict((p['key'], p) for p in PRODUCTS)


def product(key):
    return _BY_KEY[key]


def tm_forward(lon, lat):
    ''' lon/lat (gradi, scalari o array) -> x/y in metri della Transverse Mercator del DPC (formule di Snyder). '''
    a, f = WGS84_A, WGS84_F
    e2 = 2 * f - f * f; ep2 = e2 / (1 - e2); e4, e6 = e2 * e2, e2 ** 3

    def meridian(p):
        return a * ((1 - e2/4 - 3*e4/64 - 5*e6/256) * p - (3*e2/8 + 3*e4/32 + 45*e6/1024) * np.sin(2*p)
                    + (15*e4/256 + 45*e6/1024) * np.sin(4*p) - (35*e6/3072) * np.sin(6*p))

    p = np.radians(np.asarray(lat, dtype=np.float64))
    l = np.radians(np.asarray(lon, dtype=np.float64) - TM_LON0)
    n = a / np.sqrt(1 - e2 * np.sin(p) ** 2)
    t = np.tan(p) ** 2; c = ep2 * np.cos(p) ** 2; aa = l * np.cos(p)
    x = n * (aa + (1 - t + c) * aa**3 / 6 + (5 - 18*t + t*t + 72*c - 58*ep2) * aa**5 / 120)
    y = meridian(p) - meridian(math.radians(TM_LAT0)) + n * np.tan(p) * (
        aa*aa/2 + (5 - t + 9*c + 4*c*c) * aa**4 / 24 + (61 - 58*t + t*t + 600*c - 330*ep2) * aa**6 / 720)
    return x, y


def _merc_y(lat):
    return R_MERC * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def merc_grid(lon0=GRID['lon0'], lon1=GRID['lon1'], lat0=GRID['lat0'], lat1=GRID['lat1'], res=RES):
    ''' Griglia Web Mercator con angolo in alto a sinistra in (lon0, lat1): lon/lat dei CENTRI dei pixel (2D),
        dimensioni e bordi esterni ESATTI [[sud, ovest], [nord, est]] per L.imageOverlay. '''
    x0, x1 = R_MERC * math.radians(lon0), R_MERC * math.radians(lon1)
    y0, y1 = _merc_y(lat0), _merc_y(lat1)
    w, h = int((x1 - x0) / res), int((y1 - y0) / res)
    xs = x0 + (np.arange(w) + 0.5) * res
    ys = y1 - (np.arange(h) + 0.5) * res
    gx, gy = np.meshgrid(xs, ys)
    east = math.degrees((x0 + w * res) / R_MERC)
    south = math.degrees(2 * math.atan(math.exp((y1 - h * res) / R_MERC)) - math.pi / 2)
    return {'lon': np.degrees(gx / R_MERC), 'lat': np.degrees(2 * np.arctan(np.exp(gy / R_MERC)) - math.pi / 2),
            'width': w, 'height': h, 'bounds': [[south, lon0], [lat1, east]],
            'x0': x0, 'y1': y1, 'res': res, 'key': (lon0, lon1, lat0, lat1, res)}


def grid_pixel(grid, lon, lat):
    ''' (riga, colonna) del pixel della griglia che contiene il punto lon/lat. '''
    col = int((R_MERC * math.radians(lon) - grid['x0']) / grid['res'])
    row = int((grid['y1'] - _merc_y(lat)) / grid['res'])
    return row, col


def build_lut(grid, src='tm'):
    ''' Per ogni pixel della griglia (in ordine riga per riga) l'indice piatto del pixel del GeoTIFF sorgente
        (griglia GRIDS[src]) che lo contiene (vicino piu' prossimo), -1 se cade fuori dal GeoTIFF. '''
    s = GRIDS[src]
    if s['kind'] == 'tm':
        x, y = tm_forward(grid['lon'], grid['lat'])
    else:                                                # EPSG:4326: gradi
        x, y = grid['lon'], grid['lat']
    col = np.floor((x - s['x0']) / s['px'])
    row = np.floor((s['y0'] - y) / s['px'])
    ok = (col >= 0) & (col < s['w']) & (row >= 0) & (row < s['h'])
    lut = np.where(ok, row * s['w'] + col, -1).astype(np.int32)
    return lut.ravel()


def load_or_build_lut(cache_dir, grid, src='tm'):
    ''' Come build_lut, ma messa in cache su disco (~1.3 s sul Pi): .lut-<chiave di griglia e sorgente>.npy. '''
    key = hashlib.md5(repr((grid['key'], sorted(GRIDS[src].items()), TM_LON0, TM_LAT0)).encode()).hexdigest()[:12]
    path = os.path.join(cache_dir, '.lut-%s.npy' % key)
    if os.path.exists(path):
        return np.load(path)
    lut = build_lut(grid, src)
    os.makedirs(cache_dir, exist_ok=True)
    tmp = path + '.tmp.npy'
    np.save(tmp, lut)
    os.replace(tmp, path)
    return lut


# --- un fotogramma: GeoTIFF DPC -> PNG a palette sulla griglia della mappa ------------------------------
class GeorefError(Exception):
    ''' Il file scaricato non e' il GeoTIFF atteso (altra griglia, altro formato, pagina d'errore). '''


def check_georef(scale, tie, src='tm'):
    ''' Tag GeoTIFF 33550 (ModelPixelScale) e 33922 (ModelTiepoint) uguali a quelli della griglia GRIDS[src],
        altrimenti GeorefError: meglio nessun fotogramma che uno spostato. '''
    s = GRIDS[src]
    near = lambda a, b: abs(a - b) <= 1e-6 * max(1.0, abs(b))
    ok = (scale is not None and tie is not None and len(scale) >= 2 and len(tie) >= 5
          and near(scale[0], s['px']) and near(scale[1], s['px']) and near(tie[3], s['x0']) and near(tie[4], s['y0']))
    if not ok:
        raise GeorefError('georeferenziazione inattesa per %s: scala %r, punto di aggancio %r' % (src, scale, tie))


def read_grid(tif_bytes, src):
    ''' GeoTIFF del DPC sulla griglia GRIDS[src] -> array float32 (righe, colonne); le sentinelle restano. '''
    im = Image.open(io.BytesIO(tif_bytes))
    tags = getattr(im, 'tag_v2', None)
    if tags is None:
        raise GeorefError('non e\' un TIFF (%s)' % im.format)
    check_georef(tags.get(33550), tags.get(33922), src)
    a = np.array(im, dtype=np.float32)
    if a.shape != (GRIDS[src]['h'], GRIDS[src]['w']):
        raise GeorefError('dimensioni inattese %r per %s' % (a.shape, src))
    return a


def read_sri(tif_bytes):
    ''' GeoTIFF SRI -> array float32 (1400, 1200) in mm/h; -9999 = fuori copertura. '''
    return read_grid(tif_bytes, 'tm')


def classify(values):
    ''' mm/h -> classe 0..9 con la semantica di rainClass del sito (n. di soglie <= valore). NaN e
        sentinelle negative -> 0. (np.where e non nan_to_num(nan=...), che numpy 1.16 non ha.) '''
    v = np.asarray(values, dtype=np.float32)
    v = np.where(np.isfinite(v), v, -1.0)
    return np.digitize(v, PREC1_STEPS).astype(np.uint8)


def encode_png(indices2d, colors=None):
    ''' Indici 2D -> PNG a palette: indice i = colors[i] ('' = trasparente). Se la classe 0 e' colorata, l'indice
        len(colors) e' il "nessun dato" trasparente. Default = pioggia: indice 0 trasparente (layout del rilascio 1). '''
    colors = RAIN_MAP if colors is None else colors
    pal, alpha = [], []
    for hx in colors:
        pal += [int(hx[1:3], 16), int(hx[3:5], 16), int(hx[5:7], 16)] if hx else [0, 0, 0]
        alpha.append(0 if not hx else 255)
    if colors[0]:
        pal += [0, 0, 0]; alpha.append(0)
    im = Image.fromarray(np.ascontiguousarray(indices2d, dtype=np.uint8))   # modo L...
    im.putpalette(pal + [0] * (768 - len(pal)))                             # ...diventa P, stessi indici
    trans = 0 if alpha.count(0) == 1 and alpha[0] == 0 else bytes(bytearray(alpha))
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True, transparency=trans)
    return buf.getvalue()


def apply_bounds(v, prod):
    ''' Valori fisicamente impossibili per il prodotto -> NaN (nessun dato). '''
    with np.errstate(invalid='ignore'):
        if prod.get('vmin') is not None:
            v = np.where(v >= prod['vmin'], v, np.nan)
        if prod.get('vmax') is not None:
            v = np.where(v <= prod['vmax'], v, np.nan)
    return v


def prepare(raw, prod):
    ''' Valori grezzi del DPC -> valori del prodotto: sentinelle (<= -9000) e non finiti -> NaN, poi unita' del sito
        (ETM m -> km, POH 0-1 -> %) e limiti fisici. '''
    v = np.asarray(raw, dtype=np.float32)
    with np.errstate(invalid='ignore'):
        v = np.where(np.isfinite(v) & (v > -9000), v * np.float32(prod.get('scale', 1)), np.nan)
    return apply_bounds(v, prod)


def combine_sum(a, b):
    ''' Somma di due campi (es. 24 h + 24 h prima): nessun dato se manca in uno dei due. '''
    return np.where(np.isfinite(a) & np.isfinite(b), a + b, np.nan)


def render_values(vals2d, prod):
    ''' Valori del prodotto (NaN = nessun dato) -> PNG con la sua palette. '''
    v = np.asarray(vals2d, dtype=np.float32)
    ok = np.isfinite(v)
    cls = np.digitize(np.where(ok, v, prod['steps'][0]), prod['steps']).astype(np.uint8)
    nodata = 0 if not prod['colors'][0] else len(prod['colors'])
    return encode_png(np.where(ok, cls, nodata), prod['colors'])


def frame_values(tif_bytes, lut, grid, prod):
    ''' GeoTIFF -> valori del prodotto sulla griglia della mappa (vicino piu' prossimo via tabella di indici). '''
    src = read_grid(tif_bytes, prod['grid']).ravel()
    vals = np.where(lut >= 0, src[np.maximum(lut, 0)], np.nan)
    return prepare(vals, prod).reshape(grid['height'], grid['width'])


def render_frame(tif_bytes, lut, grid, prod=None):
    ''' GeoTIFF -> PNG della griglia (default: SRI, come nel rilascio 1). '''
    prod = prod or product('SRI')
    return render_values(frame_values(tif_bytes, lut, grid, prod), prod)


# --- finestra delle ultime 6 ore, buchi, potatura, indice ----------------------------------------------
# Tutto parte dall'ultimo istante dichiarato dall'API, MAI dall'orologio del Pi (senza RTC: dopo un riavvio
# puo' segnare il 1970 finche' l'NTP non si sincronizza).
def frame_times(last_ms, n=WINDOW_N, step_s=STEP_S):
    ''' Gli n istanti (epoch s UTC, crescenti) che finiscono nell'ultimo, allineato al passo. '''
    last = int(last_ms // 1000) // step_s * step_s
    return [last - i * step_s for i in range(n - 1, -1, -1)]


def window(prod, last_ms):
    ''' Istanti delle ultime 6 ore del prodotto, allineati al suo passo (quote e nuvole: 10 e 15 min). '''
    return frame_times(last_ms, 6 * 3600 // prod['step'], prod['step'])


def frame_name(t, key=PRODUCT):
    ''' Percorso relativo del fotogramma: <PRODOTTO>/AAAAMMGGhhmm.png in UTC (nome immutabile). '''
    return time.strftime(key + '/%Y%m%d%H%M.png', time.gmtime(t))


def missing_frames(out_dir, times, key=PRODUCT):
    ''' Istanti della finestra senza PNG, dal piu' recente (se il tempo finisce, manca il piu' vecchio). '''
    return [t for t in reversed(times) if not os.path.exists(os.path.join(out_dir, frame_name(t, key)))]


def prune(out_dir, keep, key=PRODUCT):
    ''' Cancella i PNG del prodotto fuori finestra; restituisce i nomi relativi cancellati. '''
    keepset = set(frame_name(t, key) for t in keep)
    removed = []
    for fn in sorted(glob.glob(os.path.join(out_dir, key, '*.png'))):
        rel = key + '/' + os.path.basename(fn)
        if rel not in keepset:
            os.remove(fn)
            removed.append(rel)
    return removed


def write_manifest(out_dir, windows, grid, updated):
    ''' index.json letto dal sito: per ogni prodotto (nell'ordine del menu) metadati, palette e fotogrammi presenti.
        windows = {chiave: istanti della finestra}. products.SRI conserva i campi del rilascio 1. '''
    size = [grid['width'], grid['height']]
    bounds = [[round(v, 6) for v in corner] for corner in grid['bounds']]
    order = [p['key'] for p in PRODUCTS if p['key'] in windows]
    prods = {}
    for k in order:
        p = product(k)
        prods[k] = {'group': p['group'], 'label': p['label'], 'unit': p['unit'], 'step': p['step'], 'size': size,
                    'bounds': bounds, 'steps': p['steps'], 'colors': p['colors'], 'dots': p['dots'],
                    'frames': [t for t in windows[k] if os.path.exists(os.path.join(out_dir, frame_name(t, k)))]}
    m = {'v': 2, 'updated': int(updated), 'source': SOURCE, 'license': LICENSE, 'order': order, 'products': prods}
    comune.save_json(m, os.path.join(out_dir, 'index.json'))
    return m


# --- rete -------------------------------------------------------------------------------------------------
def post_json(url, body):
    ''' POST JSON verso l'API DPC -> JSON. '''
    headers = {'origin': ORIGIN, 'User-Agent': USER_AGENT}
    r = requests.post(url, json=body, headers=headers, timeout=30)
    r.raise_for_status()
    return json.loads(r.content.decode('utf-8', 'replace'))


def http_json(url, body=None):
    ''' GET (o POST JSON se body) verso l'API DPC -> JSON. '''
    if body is not None:
        return post_json(url, body)
    r = comune.get(url, headers={'origin': ORIGIN, 'User-Agent': USER_AGENT}, timeout=30)
    r.raise_for_status()
    return json.loads(r.content.decode('utf-8', 'replace'))


def http_bytes(url):
    r = comune.get(url, headers={'User-Agent': USER_AGENT}, timeout=60)
    r.raise_for_status()
    return r.content


# --- un giro ------------------------------------------------------------------------------------------------
def run_once(out_dir, fetch_json, fetch_bytes, clock=time.time, budget_s=240, products=None):
    ''' Aggiorna out_dir alle ultime 6 ore di ogni prodotto. A turno fra i prodotti, prima il fotogramma mancante piu'
        recente di ciascuno; il primo si prova sempre, gli altri finche' resta budget (la cadenza e' 5 min). Un
        fotogramma (o un prodotto) che fallisce resta mancante e si riprova al giro dopo; gli altri vanno avanti. '''
    start = clock()
    prods = PRODUCTS if products is None else products
    grid = merc_grid()
    lasts, windows, todo, errors = {}, {}, {}, []
    for p in prods:
        try:
            if p['api'] not in lasts:                 # CUM48 usa l'ultimo istante di CUM24
                lasts[p['api']] = fetch_json(API + '/findLastProductByType?type=' + p['api'])['lastProducts'][0]['time']
        except Exception as e:
            errors.append('%s: ultimo istante non disponibile (%s)' % (p['key'], e))
            continue
        windows[p['key']] = window(p, lasts[p['api']])
        os.makedirs(os.path.join(out_dir, p['key']), exist_ok=True)
        todo[p['key']] = missing_frames(out_dir, windows[p['key']], p['key'])
    if not windows:
        raise RuntimeError('nessun prodotto disponibile: ' + '; '.join(errors[:3]))
    reuse = set(p['api'] for p in prods if p.get('combine'))   # in memoria solo cio' che serve due volte (CUM24)
    cache, luts, got = {}, {}, [0]

    def tif(api, t):
        if (api, t) in cache:
            return cache[(api, t)]
        r = fetch_json(API + '/downloadProduct', {'productType': api, 'productDate': t * 1000})
        data = fetch_bytes(r['url'])
        got[0] += len(data)
        if api in reuse:
            cache[(api, t)] = data
        return data

    queue = [(p, t) for rank in range(max([len(v) for v in todo.values()] or [0]))
             for p in prods if p['key'] in todo and rank < len(todo[p['key']]) for t in [todo[p['key']][rank]]]
    new = 0
    for i, (p, t) in enumerate(queue):
        if i and clock() - start >= budget_s:
            break
        try:
            if p['grid'] not in luts:
                luts[p['grid']] = load_or_build_lut(out_dir, grid, p['grid'])
            vals = frame_values(tif(p['api'], t), luts[p['grid']], grid, p)
            if p.get('combine'):                      # 48 h = 24 h fino a t + 24 h fino a t-24 h
                vals = apply_bounds(combine_sum(vals, frame_values(tif(p['api'], t - p['combine']), luts[p['grid']], grid, p)), p)
            png = render_values(vals, p)
        except Exception as e:                        # rete, 404, GeoTIFF inatteso: si riprova al prossimo giro
            errors.append('%s: %s' % (frame_name(t, p['key']), e))
            continue
        fn = os.path.join(out_dir, frame_name(t, p['key']))
        with open(fn + '.tmp', 'wb') as fp:
            fp.write(png)
        os.replace(fn + '.tmp', fn)
        new += 1
    step = dict((p['key'], p['step']) for p in prods)
    for k in windows:                                 # un fotogramma in piu' prima della finestra: l'indice puo' restare
        prune(out_dir, [windows[k][0] - step[k]] + windows[k], k)       # in cache su raw fino a 5 min e citarlo ancora
    lic = os.path.join(out_dir, 'LICENSE.txt')
    if not os.path.exists(lic):
        with open(lic, 'w', encoding='utf-8') as fp:
            fp.write(LICENSE_TXT)
    write_manifest(out_dir, windows, grid, updated=clock())
    missing = dict((k, len(missing_frames(out_dir, windows[k], k))) for k in windows)
    main_key = PRODUCT if PRODUCT in windows else list(windows)[0]
    return {'last': windows[main_key][-1], 'new': new, 'missing': sum(missing.values()),
            'incomplete': [k for k in windows if missing[k]], 'failed': len(errors), 'errors': errors,
            'mb': got[0] / 1048576.0, 'seconds': clock() - start}


# --- pubblicazione sul branch 'radar' ---------------------------------------------------------------------
IGNORED = '.gitignore\n.lut-*\n.state.json\n*.tmp\n'   # sul branch solo indice, licenza e fotogrammi


def _git(work, *args):
    return subprocess.run(['git', '-C', work] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def publish(out_dir, remote, branch=BRANCH, squash=False):
    ''' Pubblica out_dir sul branch con un repo git PERSISTENTE in out_dir: un commit per giro con genitore il
        precedente, cosi' il push manda solo i fotogrammi nuovi (un commit orfano li rimanderebbe tutti, vedi il push
        incrementale del branch data). squash=True: repo rifatto da zero, un solo commit (compattazione).
        -> quanto e' stato inviato (es. '12.3 KiB') se il push e' riuscito, False altrimenti. '''
    gitdir = os.path.join(out_dir, '.git')
    if squash and os.path.isdir(gitdir):
        shutil.rmtree(gitdir)
        print('compattazione del branch %s: storia ripartita da un solo commit' % branch)
    with open(os.path.join(out_dir, '.gitignore'), 'w') as fp:
        fp.write(IGNORED)
    steps = []
    if not os.path.isdir(gitdir):
        steps += [('init', '-q'), ('checkout', '-q', '-b', branch)]
    steps += [('add', '-A')]
    for cmd in steps:
        r = _git(out_dir, *cmd)
        if r.returncode != 0:
            print('ERRORE git %s: %s' % (cmd[0], r.stderr.decode('utf-8', 'replace').strip()[:300]))
            return False
    if _git(out_dir, 'diff', '--cached', '--quiet').returncode != 0 or _git(out_dir, 'rev-parse', '-q', '--verify', 'HEAD').returncode != 0:
        r = _git(out_dir, '-c', 'user.email=cron@localhost', '-c', 'user.name=radar', 'commit', '-qm',
                 'radar ' + time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
        if r.returncode != 0:
            print('ERRORE git commit: %s' % r.stderr.decode('utf-8', 'replace').strip()[:300])
            return False
    r = _git(out_dir, 'push', '--progress', '-f', remote, 'HEAD:refs/heads/' + branch)
    err = r.stderr.decode('utf-8', 'replace')
    if r.returncode != 0:
        print('ERRORE git push: %s' % err.strip()[-300:])
        return False
    m = re.findall(r'Writing objects: 100% \(\d+/\d+\), ([\d.]+ (?:bytes|KiB|MiB|GiB))', err)
    return m[-1] if m else '0 bytes'                  # quanto e' viaggiato davvero (niente oggetti nuovi: 0)


def publish_if_changed(out_dir, remote, branch=BRANCH):
    ''' Pubblica se i fotogrammi sono cambiati dall'ultimo push RIUSCITO (.state.json). Compatta (squash) alla prima
        pubblicazione del giorno UTC e dopo 3 push falliti di fila; un push fallito si ripete al giro dopo.
        -> 'si' | 'no' | 'errore' '''
    with open(os.path.join(out_dir, 'index.json'), encoding='utf-8') as fp:
        prods = json.load(fp)['products']
    digest = hashlib.sha1(json.dumps([[k, prods[k]['frames']] for k in sorted(prods)]).encode()).hexdigest()
    state_fn = os.path.join(out_dir, '.state.json')
    state = {}
    if os.path.exists(state_fn):
        with open(state_fn, encoding='utf-8') as fp:
            state = json.load(fp)
    today = time.strftime('%Y-%m-%d', time.gmtime())
    squash = state.get('squashed') != today or state.get('fails', 0) >= 3
    if not squash and state.get('pushed') == digest:
        return 'no'
    sent = publish(out_dir, remote, branch, squash=squash)
    if not sent:
        state['fails'] = state.get('fails', 0) + 1
        comune.save_json(state, state_fn)
        return 'errore'
    state.update(pushed=digest, fails=0, sent=sent)
    if squash:
        state['squashed'] = today
    comune.save_json(state, state_fn)
    return 'si'


def main(argv=None, fetch_json=http_json, fetch_bytes=http_bytes, products=None):
    ap = argparse.ArgumentParser(description='Radar DPC: ultime 6 ore dei prodotti in PNG + pubblicazione sul branch radar')
    ap.add_argument('--out', default=os.path.join(_BASE_DIR, 'radar_out'), help='cartella di lavoro')
    ap.add_argument('--no-push', action='store_true', help='non pubblicare su GitHub (prove)')
    ap.add_argument('--remote', default=REMOTE, help='repo git di destinazione')
    a = ap.parse_args(argv)
    stamp = time.strftime('%Y-%m-%d %H:%MZ', time.gmtime())
    try:
        s = run_once(a.out, fetch_json, fetch_bytes, products=products)
    except Exception as e:
        print('%s ERRORE giro radar: %s' % (stamp, e))
        return 1
    push = 'no' if a.no_push else publish_if_changed(a.out, a.remote)
    if push == 'si':                                  # KPI: quanto e' viaggiato verso GitHub
        try:
            with open(os.path.join(a.out, '.state.json'), encoding='utf-8') as fp:
                push += ' (%s)' % json.load(fp).get('sent', '?')
        except (OSError, ValueError):
            pass
    inc = ' (incompleti: %s)' % ', '.join(s['incomplete'][:6]) if s['incomplete'] and len(s['incomplete']) < len(PRODUCTS) else ''
    print('%s %s ultimo %s · nuovi %d · mancanti %d%s · errori %d · scaricati %.1f MB · push %s · %.1f s' % (
        stamp, PRODUCT, time.strftime('%H:%M', time.gmtime(s['last'])), s['new'], s['missing'], inc, s['failed'],
        s['mb'], push, s['seconds']))
    for err in s['errors'][:5]:
        print('   ' + err)
    return 0


if __name__ == '__main__':
    sys.exit(main())
