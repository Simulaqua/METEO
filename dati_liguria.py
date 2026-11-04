#!/usr/bin/env python3

# dati_liguria.py - LIGURIA (ARPAL, portale OMIRL) come regione LIG.
#
#   Endpoint REST anonimi del portale OMIRL (https://omirl.regione.liguria.it/Omirl/rest/):
#     stations/<Classe>             -> ultimo valore di ogni stazione della classe, con coordinate (istantanea)
#     charts/csv/<Codice>/<Classe>  -> serie della stazione, CSV 'gg/mm/aaaa hh:mm;valore;...;'
#                                      (pioggia oraria ~2,5 giorni; vento 10 min ~7 giorni = velocita' + raffica;
#                                      le altre classi 30 min ~15 giorni)
#     charts/<Codice>/Vento         -> grafico XML: l'unica fonte della DIREZIONE del vento (oraria, ~640 KB)
#   ORA: tutti i tempi OMIRL sono UTC (verificato il 2026-11-02 contro ItaliaMeteo, stesse stazioni: temperatura
#   949/951 valori uguali, pioggia oraria 17/17) -> ora solare = UTC + 1 h. Fino al 2026-11-02 lo script li leggeva
#   come ora italiana: l'archivio e' stato corretto in quella data (+2 h prima del 25/10, +1 h dopo).
#   Classi -> sigle: Termo TEMP °C, Igro UMID %, Idro LIVIDRO m, Vento VVENTO e VVENTOMAX (raffica) km/h -> m/s,
#   Radio RADSOL W/m², Neve LIVNEVE cm, Press PRESS hPa, Foglie BAGNATURA %, Elio SOLEGG min, Boa ONDE m (boa di
#   Capo Mele), Pluvio PREC mm = pioggia dell'ora che FINISCE all'istante. La pioggia viene SOLO dalla serie
#   oraria: il 'value' dell'istantanea e' una cumulata mobile di un'ora e campionarla non da' ore sommabili.
#   Ogni giro (cron :14 e :44): istantanee di tutte le classi + serie oraria della pioggia (~200 CSV da 1,6 KB).
#   Ogni 3 ore: serie del vento (raffiche). Nel giro delle 03: serie complete di tutte le classi + direzione del
#   vento -> chiude i buchi (Pi spento, fonte ferma) e porta la risoluzione piena (vento 10 min, livelli 15 min).
#
# Uso:  python3 dati_liguria.py [--full] [--debug]

import os, sys, json, argparse, datetime
import urllib.request
import xml.etree.ElementTree as ET

_BASE_DIR = os.path.dirname(os.path.realpath(__file__))

def now_solar():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=1)

def utc_to_solar(dt_utc):
    return (dt_utc + datetime.timedelta(hours=1)).strftime('%Y%m%d%H%M')

UA = {'User-Agent': 'Mozilla/5.0 (meteo-liguria/1.1)'}

def http_text(url, timeout=60):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read().decode('utf-8', 'replace')

def http_json(url, timeout=60):
    return json.loads(http_text(url, timeout))

def jload(fn):
    try:
        with open(fn) as fp: text = fp.read()
        if not text.strip():
            print('WARN: file JSON vuoto, ignorato: ' + fn); return {}
        return json.loads(text)
    except (ValueError, OSError) as e:
        print('WARN: file JSON illeggibile (' + str(e) + '), ignorato: ' + fn); return {}

def jsave(obj, fn):
    os.makedirs(os.path.dirname(fn), exist_ok=True)
    tmp = fn + '.tmp'
    with open(tmp, 'w') as fp:
        json.dump(obj, fp, ensure_ascii=False, separators=(',',':'))
        fp.flush(); os.fsync(fp.fileno())
    os.replace(tmp, fn)

def to_float(v):
    try:
        f = float(v)
        return None if f != f else f
    except (TypeError, ValueError):
        return None

#-----------------------------------------------------------------------------------------------------------
BASE = 'https://omirl.regione.liguria.it/Omirl/rest/'
# classe OMIRL -> (sigla, unita', fattore sul valore). Pluvio a parte (solo serie oraria).
CLASSES = [('Termo',  'TEMP',      '°C',   1.0),
           ('Igro',   'UMID',      '%',    1.0),
           ('Idro',   'LIVIDRO',   'm',    1.0),
           ('Vento',  'VVENTO',    'm/s',  1 / 3.6),    # OMIRL pubblica km/h (rapporto con ItaliaMeteo 3,60)
           ('Radio',  'RADSOL',    'W/m²', 1.0),
           ('Neve',   'LIVNEVE',   'cm',   1.0),
           ('Press',  'PRESS',     'hPa',  1.0),
           ('Foglie', 'BAGNATURA', '%',    1.0),
           ('Elio',   'SOLEGG',    'min',  1.0),
           ('Boa',    'ONDE',      'm',    1.0)]
UNITS = dict((var, um) for _, var, um, _ in CLASSES)
UNITS.update({'PREC': 'mm', 'VVENTOMAX': 'm/s', 'DVENTO': 'gradi'})

def add(readings, var, sc, ist, val):
    readings.setdefault(var, {}).setdefault(sc, []).append((ist, round(val, 2)))

def snapshot(cls):
    ''' istantanea di una classe: [(sc, nome, lat, lon, istante solare, valore)] '''
    out = []
    for s in http_json(BASE + 'stations/' + cls):
        lat, lon, val = to_float(s.get('lat')), to_float(s.get('lon')), to_float(s.get('value'))
        code = s.get('shortCode')
        if lat is None or lon is None or not code:
            continue
        try:
            dt = datetime.datetime.strptime(str(s.get('refDate'))[:16], '%Y-%m-%dT%H:%M')     # UTC
        except (ValueError, TypeError):
            dt = None
        out.append(('LIG' + str(code), str(code), s.get('name') or code, lat, lon,
                    utc_to_solar(dt) if dt else None, val))
    return out

def series_csv(code, cls):
    ''' serie di una stazione: [(istante solare, [valori...])], tempi UTC nel CSV '''
    pts = []
    for line in http_text(BASE + 'charts/csv/%s/%s' % (code, cls)).splitlines():
        p = line.strip().split(';')
        try:
            dt = datetime.datetime.strptime(p[0], '%d/%m/%Y %H:%M')
        except (ValueError, IndexError):
            continue
        pts.append((utc_to_solar(dt), [to_float(x) for x in p[1:]]))
    return pts

def wind_direction_xml(code):
    ''' direzione del vento (gradi) dal grafico XML: [(istante solare, gradi)], tempi epoch-ms UTC '''
    root = ET.fromstring(http_text(BASE + 'charts/%s/Vento' % code, timeout=120))
    out = []
    for ds in root.findall('dataSeries'):
        if (ds.findtext('name') or '').lower() != 'wind direction':
            continue
        for d in ds.findall('data'):
            it = d.findall('item')
            if len(it) < 2:
                continue
            v = to_float(it[1].text)
            if v is None:
                continue
            dt = datetime.datetime.utcfromtimestamp(int(it[0].text) / 1000)
            out.append((utc_to_solar(dt), v))
    return out

def fetch_liguria(full=False, wind=False, debug=False):
    stations, readings = {}, {}
    per_class = {}
    # 1) istantanee di tutte le classi (anche Pluvio: solo per l'elenco delle stazioni con coordinate)
    for cls, var, um, k in CLASSES + [('Pluvio', None, None, None)]:
        try:
            snap = snapshot(cls)
        except Exception as e:
            print('WARN: classe %s non letta: %s' % (cls, e)); continue
        per_class[cls] = snap
        n = 0
        for sc, code, nome, lat, lon, ist, val in snap:
            stations.setdefault(sc, {'NOME': nome, 'LAT': lat, 'LON': lon})
            if var and ist and val is not None:
                add(readings, var, sc, ist, val * k); n += 1
        if debug and var:
            print('  %-6s -> %-9s istantanea: %d valori' % (cls, var, n))
    # 2) pioggia oraria: serie di ogni pluviometro (l'unica fonte di ore sommabili)
    def run_series(cls, handle):
        ok = err = 0
        for sc, code, *_ in per_class.get(cls, []):
            try:
                handle(sc, code); ok += 1
            except Exception:
                err += 1
        if debug:
            print('  %-6s serie: %d stazioni lette, %d errori' % (cls, ok, err))
    def rain(sc, code):
        for ist, vals in series_csv(code, 'Pluvio'):
            if vals and vals[0] is not None:
                add(readings, 'PREC', sc, ist, vals[0])
    run_series('Pluvio', rain)
    # 3) vento: velocita' + raffica dalla serie (ogni 3 ore e di notte); direzione solo di notte (XML pesante)
    if wind or full:
        def wind_s(sc, code):
            for ist, vals in series_csv(code, 'Vento'):
                if len(vals) > 0 and vals[0] is not None: add(readings, 'VVENTO', sc, ist, vals[0] / 3.6)
                if len(vals) > 1 and vals[1] is not None: add(readings, 'VVENTOMAX', sc, ist, vals[1] / 3.6)
        run_series('Vento', wind_s)
    if full:
        def wind_d(sc, code):
            for ist, v in wind_direction_xml(code):
                add(readings, 'DVENTO', sc, ist, v)
        run_series('Vento', wind_d)
        # 4) serie complete delle altre classi (risoluzione piena, chiude i buchi)
        for cls, var, um, k in CLASSES:
            if cls == 'Vento':
                continue
            def other(sc, code, cls=cls, var=var, k=k):
                for ist, vals in series_csv(code, cls):
                    if vals and vals[0] is not None:
                        add(readings, var, sc, ist, vals[0] * k)
            run_series(cls, other)
    return stations, readings, UNITS

#-----------------------------------------------------------------------------------------------------------
def write_parsed(region_code, stations, readings, units, days=8):
    parse_dir = os.path.join(_BASE_DIR, region_code, 'data-parsed')
    stazioni_path = os.path.join(parse_dir, 'stazioni.json')
    station_list = jload(stazioni_path) if os.path.exists(stazioni_path) else {}
    for sc, meta in stations.items():
        station_list[sc] = {'SCODE': sc, 'NOME': meta.get('NOME'), 'LAT': meta.get('LAT'), 'LON': meta.get('LON')}
    floor = (now_solar() - datetime.timedelta(days=days)).strftime('%Y%m%d%H%M')
    added = 0
    for var, per_scode in readings.items():
        by_day = {}
        for sc, pts in per_scode.items():
            for ist, val in pts:
                if val is None or ist < floor:
                    continue
                by_day.setdefault(ist[:8], {}).setdefault(sc, []).append((ist, val))
        for day, per in by_day.items():
            fn = os.path.join(parse_dir, var, var + '-' + day + '.json')
            bin_day = jload(fn) if os.path.exists(fn) else {}
            for sc, pts in per.items():
                rec = bin_day.get(sc)
                if rec is None:
                    rec = {'STAZIONE': station_list.get(sc, {'SCODE': sc}), 'UM': units.get(var),
                           'MISURE': {'ISTANTE': [], 'VALORE': []}}
                    bin_day[sc] = rec
                m = rec['MISURE']; merged = dict(zip(m['ISTANTE'], m['VALORE'])); before = len(merged)
                for ist, val in pts:
                    if ist not in merged:
                        merged[ist] = val
                keys = sorted(merged.keys())
                m['ISTANTE'] = keys; m['VALORE'] = [merged[k] for k in keys]
                added += len(merged) - before
            jsave(bin_day, fn)
    jsave(station_list, stazioni_path)
    print('[%s] stazioni: %d | nuove letture inserite: %d' % (region_code, len(stations), added))
    return added

def main():
    ap = argparse.ArgumentParser(description='Liguria (ARPAL OMIRL): idro + meteo, REST anonimo.')
    ap.add_argument('--full', action='store_true', help='serie complete di tutte le classi (di norma nel giro delle 03)')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    now = datetime.datetime.now()                         # ora locale del Pi (cron alle :14 e :44)
    full = args.full or (now.hour == 3 and now.minute < 30)
    wind = full or (now.hour % 3 == 0 and now.minute < 30)
    print('\n=== LIGURIA (OMIRL)%s ===' % (' - serie complete' if full else (' + vento' if wind else '')))
    try:
        stations, readings, units = fetch_liguria(full=full, wind=wind, debug=args.debug)
        write_parsed('LIG', stations, readings, units)
    except Exception as e:
        print('[LIG] ERRORE: %s' % e)

if __name__ == '__main__':
    main()
