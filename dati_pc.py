#!/usr/bin/env python3

# dati_pc.py - IDROMETRIA (e affini) delle reti di PROTEZIONE CIVILE, come "regioni" a se':
#   PC_FVG (Protezione Civile FVG)  e  PC_TN (Ufficio Dighe - Provincia di Trento, floods.it).
# Scrive nello STESSO schema degli altri script: PC_<REG>/data-parsed/<VAR>/<VAR>-YYYYMMDD.json +
# stazioni.json. Ogni stazione ha SEMPRE lat/lon. Timestamp memorizzati in ORA SOLARE (CET, UTC+1).
#
#   PC_FVG: monitor.protezionecivile.fvg.it/api  -> measures/latest (snapshot con lat/lon per misura).
#           La serie si costruisce ACCUMULANDO ad ogni run. Mappa sensor_id->codice in cache.
#   PC_TN : floods.it/api/v1/monitoring -> index.json (catalogo con coord + URL serie); ogni serie
#           <id>.json ha timestamp epoch UTC + valori (storico ~7 giorni) -> serie immediata.
#   PIE   : ARPA Piemonte (meteo + livelli, regione PIE) e i suoi idrometri anche come PC_PIE (gruppo Po):
#           un solo scarico, vedi fetch_pie.
#
# Uso:  python3 dati_pc.py -r all | -r FVG | -r TN | -r PO | -r PIE

import os, sys, json, ssl, uuid, argparse, datetime
import urllib.request, urllib.parse

_BASE_DIR = os.path.dirname(os.path.realpath(__file__))

SOLAR = datetime.timezone(datetime.timedelta(hours=1))
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) meteo-pc/1.0'}

# DST italiano a mano (zoneinfo assente su Python < 3.9, es. il Raspberry con 3.7)
def _ita_is_dst(dt):
    y = dt.year
    ls = lambda mo: 31 - ((datetime.date(y, mo, 31).weekday() + 1) % 7)
    return datetime.datetime(y, 3, ls(3), 2) <= dt < datetime.datetime(y, 10, ls(10), 3)

#-----------------------------------------------------------------------------------------------------------
def http_json(url, params=None, timeout=90):
    if params:
        url = url + ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)
                      .read().decode('utf-8', 'replace'))

def jload(fn):
    # un file vuoto/troncato/corrotto (write interrotto, disco pieno) NON deve bloccare lo script:
    # lo si tratta come vuoto (si riparte) con un avviso nel log, invece di sollevare e morire.
    try:
        with open(fn) as fp: text = fp.read()
        if not text.strip():
            print('WARN: file JSON vuoto, ignorato: ' + fn); return {}
        return json.loads(text)
    except (ValueError, OSError) as e:
        print('WARN: file JSON illeggibile (' + str(e) + '), ignorato: ' + fn); return {}

def jsave(obj, fn):
    # scrittura ATOMICA: scrivi su .tmp, fsync, poi rename. Un riavvio/kill a meta' scrittura
    # non lascia mai un file .json monco (che poi bloccherebbe raccolta ed export).
    os.makedirs(os.path.dirname(fn), exist_ok=True)
    tmp = fn + '.tmp'
    with open(tmp, 'w') as fp:
        json.dump(obj, fp, ensure_ascii=False, separators=(',',':'))
        fp.flush(); os.fsync(fp.fileno())
    os.replace(tmp, fn)

def to_float(v):
    try: return float(v)
    except (TypeError, ValueError): return None

def now_solar():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=1)

def civil_to_solar(dt_naive):
    if _ita_is_dst(dt_naive):
        dt_naive = dt_naive - datetime.timedelta(hours=1)
    return dt_naive.strftime('%Y%m%d%H%M')

def utc_epoch_to_solar(epoch):
    return (datetime.datetime.utcfromtimestamp(epoch) + datetime.timedelta(hours=1)).strftime('%Y%m%d%H%M')

#-----------------------------------------------------------------------------------------------------------
# SCRITTORE COMUNE (merge ordinato + dedup per istante) - identico per struttura a dati_aria.py
def write_parsed(region_code, stations, readings, units, days=8):
    parse_dir = os.path.join(_BASE_DIR, region_code, 'data-parsed')
    stazioni_path = os.path.join(parse_dir, 'stazioni.json')
    station_list = jload(stazioni_path) if os.path.exists(stazioni_path) else {}
    for sc, meta in stations.items():
        station_list[sc] = {'SCODE': sc, 'NOME': meta.get('NOME'),
                            'LAT': meta.get('LAT'), 'LON': meta.get('LON')}
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
                    rec = {'STAZIONE': station_list.get(sc, {'SCODE': sc}),
                           'UM': units.get(var), 'MISURE': {'ISTANTE': [], 'VALORE': []}}
                    bin_day[sc] = rec
                m = rec['MISURE']
                merged = dict(zip(m['ISTANTE'], m['VALORE']))
                before = len(merged)
                for ist, val in pts:
                    if ist not in merged:
                        merged[ist] = val
                keys = sorted(merged.keys())
                m['ISTANTE'] = keys
                m['VALORE'] = [merged[k] for k in keys]
                added += len(merged) - before
            jsave(bin_day, fn)
    jsave(station_list, stazioni_path)
    print(f'[{region_code}] stazioni: {len(stations)} | nuove letture inserite: {added}')
    return added

#===========================================================================================================
# PC FVG - Protezione Civile Friuli Venezia Giulia
#===========================================================================================================
FVG_MAP = {'IDRO': 'LIVIDRO', 'NIVO': 'LIVNEVE', 'T': 'TEMP', 'U': 'UMID', 'Vv': 'VVENTO',
           'VvMax': 'VVENTOMAX', 'Dv': 'DVENTO', 'B': 'PRESS', 'RG': 'RADSOL', 'P_1h': 'PREC'}
FVG_UM  = {'LIVIDRO': 'm', 'LIVLAGO': 'm', 'LIVNEVE': 'cm', 'TEMP': '°C', 'UMID': '%', 'VVENTO': 'm/s',
           'VVENTOMAX': 'm/s', 'DVENTO': '°N', 'PRESS': 'hPa', 'RADSOL': 'W/m²', 'PREC': 'mm'}

def _fvg_sensor_map(debug=False):
    ''' sensor_id -> codice. Costruita iterando i sensori delle stazioni e messa in cache su file. '''
    API = 'https://monitor.protezionecivile.fvg.it/api'
    cache = os.path.join(_BASE_DIR, 'PC_FVG', 'sensors_map.json')
    smap = jload(cache) if os.path.exists(cache) else {}
    if smap:
        return {int(k): v for k, v in smap.items()}
    smap = {}
    for st in http_json(API + '/stations').get('stations', []):
        try:
            for se in http_json(API + '/stations/%s/sensors' % st['id']).get('sensors', []):
                smap[se['id']] = se.get('code')
        except Exception:
            continue
    jsave({str(k): v for k, v in smap.items()}, cache)
    if debug: print('  PC_FVG mappa sensori costruita: %d' % len(smap))
    return smap

def fetch_fvg(debug=False):
    API = 'https://monitor.protezionecivile.fvg.it/api'
    smap = _fvg_sensor_map(debug)
    stations, readings, units = {}, {}, {}
    for m in http_json(API + '/measures/latest').get('measures', []):
        var = FVG_MAP.get(smap.get(m.get('sensor_id')))
        if var is None:
            continue
        # gli "invasi" artificiali (Barcis, Ravedis, Ca' Zul, Ca' Selva, Tramonti) riportano la QUOTA
        # assoluta dell'invaso in m s.l.m., non un livello idrometrico: classificati livello lago
        if var == 'LIVIDRO' and 'invaso' in str(m.get('station_name') or '').lower():
            var = 'LIVLAGO'
        lat, lon = to_float(m.get('lat')), to_float(m.get('lon'))
        val = to_float(m.get('value'))
        if lat is None or lon is None or (abs(lat) < 0.001 and abs(lon) < 0.001) or val is None:
            continue
        sc = 'FVG' + str(m.get('station_id'))
        try:
            dt = datetime.datetime.strptime(m.get('dt'), '%Y-%m-%d %H:%M:%S')
        except (ValueError, TypeError):
            continue
        stations[sc] = {'NOME': m.get('station_name') or sc, 'LAT': lat, 'LON': lon}
        readings.setdefault(var, {}).setdefault(sc, []).append((civil_to_solar(dt), val))
        units[var] = FVG_UM.get(var)
    return stations, readings, units

#===========================================================================================================
# PC TN - Ufficio Dighe Provincia di Trento (floods.it)
#===========================================================================================================
TN_MAP = {'gage height': 'LIVIDRO', 'discharge': 'PORTATA'}
TN_UM  = {'LIVIDRO': 'm', 'PORTATA': 'm³/s'}

def fetch_tn(debug=False):
    BASE = 'https://www.floods.it/api/v1/monitoring/'
    catalog = http_json(BASE + 'index.json')
    stations, readings, units = {}, {}, {}
    feats = catalog.get('features', [])
    for i, f in enumerate(feats):
        md = (f.get('properties') or {}).get('metadata', {})
        var = TN_MAP.get(md.get('quantity'))
        if var is None:
            continue
        coords = (f.get('geometry') or {}).get('coordinates') or [0, 0]
        lon, lat = to_float(coords[0]), to_float(coords[1])
        if lat is None or lon is None or (abs(lat) < 0.001 and abs(lon) < 0.001):
            continue
        sid = str(md.get('series id') or i)
        try:
            ser = http_json(BASE + sid + '.json')
        except Exception:
            continue
        data = (((ser.get('features') or [{}])[0].get('properties') or {}).get('data') or {})
        ts = data.get('timestamp') or []
        vals = None
        for k, v in data.items():                                   # array valori = la chiave != timestamp
            if k != 'timestamp' and isinstance(v, list):
                vals = v; break
        if not ts or vals is None:
            continue
        sc = 'TN' + sid
        stations[sc] = {'NOME': md.get('site') or sc, 'LAT': lat, 'LON': lon}
        pts = []
        for t, val in zip(ts, vals):
            fv = to_float(val)
            if fv is not None:
                pts.append((utc_epoch_to_solar(int(t)), fv))
        if pts:
            readings.setdefault(var, {}).setdefault(sc, []).extend(pts)
            units[var] = md.get('uom') or TN_UM.get(var)
        if debug and i % 40 == 0:
            print('  PC_TN %d/%d serie...' % (i, len(feats)))
    return stations, readings, units

#===========================================================================================================
# PC PO - AIPO (Agenzia Interregionale per il fiume Po), API AEGIS/datascapeA
#===========================================================================================================
# Feed idrometrico del bacino del Po. Aggrega reti regionali (ARPA Lombardia, Regione ER, ...) PIU' le
# stazioni proprie AIPO. Scarica TUTTO (archivio); i doppioni con ER/LOM vengono tolti al PUBBLICA da
# export_web (dedup per prossimita'). Auth anonima pubblica; certificato SSL incompleto -> verify=False,
# limitato a questo host. Coordinate incluse in /v3/locations (x=lon, y=lat).
def fetch_po(debug=False, days=7):
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    BASE = 'https://idrometri.agenziapo.it/datascapeA'
    body = urllib.parse.urlencode({'grant_type': 'password', 'username': 'anonymous', 'password': 'anonymous',
                                   'client_id': 'Aegis', 'client_instance': str(uuid.uuid4())}).encode()
    treq = urllib.request.Request(BASE + '/connect/token', data=body,
             headers={'Content-Type': 'application/x-www-form-urlencoded', **UA})
    tok = json.loads(urllib.request.urlopen(treq, timeout=60, context=ctx).read())['access_token']
    H = {'Authorization': 'Bearer ' + tok, **UA}
    def aget(path):
        return json.loads(urllib.request.urlopen(urllib.request.Request(BASE + path, headers=H),
                                                 timeout=60, context=ctx).read())
    cache = os.path.join(_BASE_DIR, 'PC_PO', 'elements_map.json')     # staz -> elementId (Water Level)
    emap = jload(cache) if os.path.exists(cache) else {}
    locs = aget('/v3/locations?category=All')
    d_from = (now_solar() - datetime.timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%S')
    d_to   = now_solar().strftime('%Y-%m-%dT%H:%M:%S')
    stations, readings, units = {}, {}, {}
    for L in locs:
        sid = str(L.get('i')); lon = to_float(L.get('x')); lat = to_float(L.get('y'))
        if lat is None or lon is None or (abs(lat) < 0.001 and abs(lon) < 0.001):
            continue
        eid = emap.get(sid)
        if eid is None:
            try:
                els = aget('/v3/elements?station_id=' + sid)
            except Exception:
                continue
            wl = [e for e in els if e.get('measUnit') == 'm' and 'evel' in (e.get('elementName') or '')]
            if not wl:
                continue
            eid = wl[0]['elementId']; emap[sid] = eid
        try:
            data = aget('/v3/data/%s?from=%s&to=%s' % (eid, d_from, d_to))
        except Exception:
            continue
        pts = []
        for row in data:
            if not (isinstance(row, list) and len(row) >= 2):
                continue
            v = to_float(row[1])
            if v is None:
                continue
            try:
                dt = datetime.datetime.fromisoformat(row[0])            # es. '...+01:00' (solare)
            except (ValueError, TypeError):
                continue
            pts.append((dt.astimezone(SOLAR).strftime('%Y%m%d%H%M'), v))
        if pts:
            sc = 'PO' + sid
            stations[sc] = {'NOME': L.get('n') or sc, 'LAT': lat, 'LON': lon}
            readings.setdefault('LIVIDRO', {})[sc] = pts
            units['LIVIDRO'] = 'm'
        if debug and len(stations) % 30 == 0:
            print('  PC_PO %d stazioni...' % len(stations))
    jsave({str(k): v for k, v in emap.items()}, cache)
    return stations, readings, units

#-----------------------------------------------------------------------------------------------------------
# ARPA PIEMONTE - Rete Meteoidrografica: UN solo scarico orario, DUE regioni-archivio:
#   PIE    = TUTTE le ~374 stazioni, meteo e livelli insieme (voce "Piemonte" del sito);
#   PC_PIE = i soli ~107 idrometri del bacino del Po a monte (Po + Tanaro/Ticino/Dora/Sesia/Scrivia...),
#            invariato, per la voce "Po (AIPO + Piemonte)".
#   API FastAPI anonima documentata (OpenAPI): utility.arpa.piemonte.it/api_realtime/
#     /pie_anag  -> anagrafica (lat/lng, river_name, basin, hydrometric_zero in m s.m.m.)
#     /data_pie  -> misure ORARIE degli ultimi 3 giorni; SENZA station_code = BULK paginato (page/page_size).
#   Campi verificati il 2026-11-02 contro ItaliaMeteo (stesse stazioni, ora UTC): air_temperature °C, humidity %,
#   cum_rain_1h mm = pioggia dell'ora che FINISCE all'istante, wind e gust_of_wind in KM/H (-> m/s, rapporto 3.57),
#   wind_direction/gust_direction gradi, snow_height cm, hydrometric_level m. Le cumulate 3-24 h della fonte non
#   servono (derive.py calcola le nostre). Timestamp con offset esplicito ('+01:00' / '+02:00') -> ora solare.
#   Finestra: le ultime 7 ore (scarico leggero); nel giro delle 03 i 3 giorni interi, cosi' un buco (Pi spento,
#   fonte ferma) si richiude entro la notte successiva. Salva PIE/ e PC_PIE/zero_idrometrici.json: il front-end
#   mostra il LIVIDRO in quota assoluta (come per il Veneto).
def _isnum(x):
    try: float(x); return True
    except (TypeError, ValueError): return False

PIE_FULL = False                                                      # --full: forza i 3 giorni

# campo dell'API -> (sigla, unita', fattore sul valore)
PIE_FIELDS = [('air_temperature',   'TEMP',      '°C',    1.0),
              ('humidity',          'UMID',      '%',     1.0),
              ('cum_rain_1h',       'PREC',      'mm',    1.0),
              ('wind',              'VVENTO',    'm/s',   1 / 3.6),
              ('wind_direction',    'DVENTO',    'gradi', 1.0),
              ('gust_of_wind',      'VVENTOMAX', 'm/s',   1 / 3.6),
              ('gust_direction',    'DVENTOMAX', 'gradi', 1.0),
              ('snow_height',       'LIVNEVE',   'cm',    1.0),
              ('hydrometric_level', 'LIVIDRO',   'm',     1.0)]

def fetch_pie(debug=False):
    BASE = 'https://utility.arpa.piemonte.it/api_realtime'
    anag = http_json(BASE + '/pie_anag', {'page_size': 2000})
    rows = anag if isinstance(anag, list) else anag.get('data', [])
    meta, hydro, zeri = {}, set(), {}
    for r in rows:
        code = str(r.get('station_code'))
        lat, lon = to_float(r.get('lat')), to_float(r.get('lng'))
        if lat is None or lon is None:
            continue
        sc = 'PIE' + code
        nome = (r.get('name') or sc).title()                         # 'COLLE LOMBARDA' -> 'Colle Lombarda'
        # idrometri veri: river_name valorizzato e zero idrometrico numerico -> nome "Fiume a Comune"
        if r.get('river_name') not in ('-', '', None) and _isnum(r.get('hydrometric_zero')):
            river = (r.get('river_name') or '').title()
            muni = (r.get('municipality') or r.get('name') or '').title()
            if river and muni:
                nome = river + ' a ' + muni
            hydro.add(code)
            zeri[sc] = {'zero': round(float(r.get('hydrometric_zero')), 3)}
        meta[code] = {'sc': sc, 'NOME': nome, 'LAT': lat, 'LON': lon}
    full = PIE_FULL or datetime.datetime.now().hour == 3              # ora locale del Pi (cron alle hh:22)
    d_from = (now_solar() - (datetime.timedelta(days=3) if full else datetime.timedelta(hours=7))).strftime('%Y-%m-%dT%H:%M')
    st_all, rd_all = {}, {}
    st_pc, rd_pc = {}, {'LIVIDRO': {}}
    page = 1
    while True:
        d = http_json(BASE + '/data_pie', {'date_from': d_from, 'page': page, 'page_size': 5000})
        recs = d if isinstance(d, list) else d.get('data', [])
        if not recs:
            break
        for rec in recs:
            code = str(rec.get('station_code'))
            m = meta.get(code)
            if m is None:
                continue
            try:
                dt = datetime.datetime.fromisoformat(rec['date'])       # es. '...+01:00' (ora civile con offset)
            except (ValueError, TypeError, KeyError):
                continue
            ist = dt.astimezone(SOLAR).strftime('%Y%m%d%H%M')
            sc = m['sc']
            for field, var, um, k in PIE_FIELDS:
                v = to_float(rec.get(field))
                if v is None:
                    continue
                v = round(v * k, 2)
                st_all[sc] = {'NOME': m['NOME'], 'LAT': m['LAT'], 'LON': m['LON']}
                rd_all.setdefault(var, {}).setdefault(sc, []).append((ist, v))
                if var == 'LIVIDRO' and code in hydro:
                    st_pc[sc] = st_all[sc]
                    rd_pc['LIVIDRO'].setdefault(sc, []).append((ist, v))
        total_pages = (d.get('total_pages') if isinstance(d, dict) else 1) or 1
        if page >= total_pages:
            break
        page += 1
    # zeri idrometrici delle stazioni effettivamente presenti (per la quota assoluta), in entrambe le regioni
    for reg, sts in (('PIE', st_all), ('PC_PIE', st_pc)):
        if sts:
            jsave({sc: zeri[sc] for sc in sts if sc in zeri}, os.path.join(_BASE_DIR, reg, 'zero_idrometrici.json'))
    units = {var: um for _, var, um, _ in PIE_FIELDS}
    if debug:
        print('  finestra da %s%s | stazioni PIE %d (idrometri PC_PIE %d) | variabili: %s' % (
              d_from, ' (3 giorni)' if full else '', len(st_all), len(st_pc),
              ', '.join('%s %d' % (v, len(rd_all.get(v, {}))) for _, v, _, _ in PIE_FIELDS)))
    return {'PIE': (st_all, rd_all, units), 'PC_PIE': (st_pc, rd_pc, {'LIVIDRO': 'm'})}

#===========================================================================================================
FETCHERS = {'FVG': ('PC_FVG', fetch_fvg), 'TN': ('PC_TN', fetch_tn), 'PO': ('PC_PO', fetch_po),
            'PIE': ('PC_PIE', fetch_pie)}

def main():
    ap = argparse.ArgumentParser(description='Idrometria Protezione Civile (stazioni con coordinate).')
    ap.add_argument('-r', '--region', default='all', help='FVG/TN/all')
    ap.add_argument('-c', '--cleanup', default='yes', help='(compat)')
    ap.add_argument('--debug', action='store_true')
    ap.add_argument('--full', action='store_true', help='PIE: scarica i 3 giorni interi (di norma solo nel giro delle 03)')
    args = ap.parse_args()
    global PIE_FULL
    PIE_FULL = args.full
    regions = list(FETCHERS) if args.region.lower() == 'all' else [args.region.upper()]
    for reg in regions:
        if reg not in FETCHERS:
            print('Rete PC non disponibile: ' + reg); continue
        code, fetcher = FETCHERS[reg]
        print('\n=== IDROMETRIA PC ' + reg + ' ===')
        try:
            res = fetcher(debug=args.debug)
            # un fetcher puo' alimentare piu' regioni-archivio con un solo scarico (Piemonte: PIE + PC_PIE)
            for c, (stations, readings, units) in (res.items() if isinstance(res, dict) else [(code, res)]):
                write_parsed(c, stations, readings, units)
        except Exception as e:
            print(f'[{reg}] ERRORE: {e}')

if __name__ == '__main__':
    main()
