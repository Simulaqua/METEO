#!/usr/bin/env python3

# dati_mare.py - DATI METEO-MARINI / MAREE, come "regione" a se' (codice MAR_<REG>).
#   MAR_VEN: CPSM - Centro Previsioni e Segnalazioni Maree, Comune di Venezia (dati.venezia.it).
#            Un file JSON per grandezza (livello marea, onde, vento, temp acqua/aria, umidita',
#            pressione, radiazione); dato ogni ~5 min; coordinate per stazione (join per ID dove
#            il file non le ripete). I 'valore' sono stringhe con unita' -> parsati.
# Scrive nello schema comune: MAR_<REG>/data-parsed/<VAR>/<VAR>-YYYYMMDD.json + stazioni.json.
# Ogni stazione ha lat/lon. Timestamp in ORA SOLARE (CET, UTC+1).
#
# Uso:  python3 dati_mare.py -r all | -r VEN

import os, sys, json, re, argparse, datetime
import urllib.request, urllib.parse

_BASE_DIR = os.path.dirname(os.path.realpath(__file__))
SOLAR = datetime.timezone(datetime.timedelta(hours=1))

# DST italiano a mano (zoneinfo assente su Python < 3.9, es. il Raspberry con 3.7)
def _ita_is_dst(dt):
    y = dt.year
    ls = lambda mo: 31 - ((datetime.date(y, mo, 31).weekday() + 1) % 7)
    return datetime.datetime(y, 3, ls(3), 2) <= dt < datetime.datetime(y, 10, ls(10), 3)

def civil_to_solar(dt_naive):
    if _ita_is_dst(dt_naive):
        dt_naive = dt_naive - datetime.timedelta(hours=1)
    return dt_naive.strftime('%Y%m%d%H%M')

def now_solar():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=1)

#-----------------------------------------------------------------------------------------------------------
def http_get(url, timeout=90):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (meteo-mare/1.0)'})
    return urllib.request.urlopen(req, timeout=timeout).read().decode('utf-8', 'replace')

def http_json(url, timeout=60):
    return json.loads(http_get(url, timeout))

def utc_to_solar(dt_utc):
    ''' datetime naive UTC -> istante solare (UTC+1) 'YYYYMMDDHHMM'. '''
    return (dt_utc + datetime.timedelta(hours=1)).strftime('%Y%m%d%H%M')

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

def _slug(s):
    return ''.join(c if c.isalnum() else '_' for c in (s or '')).strip('_') or 'staz'

def _nums(s):
    ''' Estrae tutti i numeri (float) da una stringa tipo "209 gradi, 1.4 m/s, 2.2 m/s". '''
    return [float(x) for x in re.findall(r'-?\d+\.?\d*', s or '')]

def _first(s):
    n = _nums(s); return n[0] if n else None

# unita' canonica per sigla (per la legenda)
UM = {'MAREA': 'm', 'ONDE': 'm', 'TEMP': '°C', 'TEMPACQUA': '°C', 'UMID': '%',
      'PRESS': 'hPa', 'RADSOL': 'W/m²', 'DVENTO': '°N', 'VVENTO': 'm/s', 'VVENTOMAX': 'm/s',
      'PORTATA': 'm³/s'}

#-----------------------------------------------------------------------------------------------------------
# SCRITTORE COMUNE (merge ordinato + dedup per istante)
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
    print(f'[{region_code}] stazioni: {len(stations)} | nuove letture inserite: {added}')
    return added

#===========================================================================================================
# MAR_VEN - CPSM Comune di Venezia
#===========================================================================================================
CPSM_BASE = 'http://dati.venezia.it/sites/default/files/dataset/opendata/'
# file -> (sigla, funzione-valore). Il vento e' gestito a parte (3 numeri: dir, vel, raffica).
CPSM_SCALAR = [('livello', 'MAREA'), ('onde_mare', 'ONDE'), ('onde_laguna', 'ONDE'),
               ('tempacqua', 'TEMPACQUA'), ('temparia', 'TEMP'), ('umidita', 'UMID'),
               ('pressione', 'PRESS'), ('radiazione', 'RADSOL')]

def fetch_ven(debug=False):
    # 1) raccogli coordinate/nome per stazione da tutti i file che le espongono
    coords, names = {}, {}
    files = {}
    for fn, _ in CPSM_SCALAR + [('vento', None)]:
        try:
            files[fn] = http_json(CPSM_BASE + fn + '.json')
        except Exception as e:
            if debug: print('  CPSM ' + fn + ' skip: ' + str(e)); files[fn] = []
        for r in files[fn]:
            sid = r.get('ID_stazione')
            lat, lon = r.get('latDDN'), r.get('lonDDE')
            if sid and lat and lon and sid not in coords:
                try:
                    coords[sid] = (float(lat), float(lon)); names[sid] = r.get('stazione') or sid
                except (TypeError, ValueError):
                    pass

    stations, readings, units = {}, {}, {}
    def add(sid, var, dt_str, value):
        if value is None or sid not in coords:
            return
        try:
            dt = datetime.datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
        except (TypeError, ValueError):
            return
        stations[sid] = {'NOME': names.get(sid, sid), 'LAT': coords[sid][0], 'LON': coords[sid][1]}
        readings.setdefault(var, {}).setdefault(sid, []).append((civil_to_solar(dt), value))
        units[var] = UM.get(var)

    # 2) grandezze scalari (primo numero della stringa)
    for fn, var in CPSM_SCALAR:
        for r in files.get(fn, []):
            add(r.get('ID_stazione'), var, r.get('data'), _first(r.get('valore')))

    # 3) vento: "dir gradi, vel m/s, raffica m/s"
    for r in files.get('vento', []):
        n = _nums(r.get('valore'))
        sid, dt = r.get('ID_stazione'), r.get('data')
        if len(n) >= 1: add(sid, 'DVENTO', dt, n[0])
        if len(n) >= 2: add(sid, 'VVENTO', dt, n[1])
        if len(n) >= 3: add(sid, 'VVENTOMAX', dt, n[2])

    return stations, readings, units

#===========================================================================================================
# MAR_ER - ARPAE-SIMC dati meteo-marini (boe Nausicaa/Calipso + mareografi), da realtime.jsonl (BUFR-style)
#===========================================================================================================
# codice B -> (sigla, kelvin?). MAREA=livello mare, ONDE=altezza onda sign., TEMPACQUA=temp mare (K),
# TEMP=temp aria (K), UMID, VVENTO. Coord nei campi B05001(lat)/B06001(lon). date top-level in UTC.
ER_MARINE_CODES = {'B22037': ('MAREA', False), 'B22070': ('ONDE', False), 'B22043': ('TEMPACQUA', True),
                   'B12101': ('TEMP', True), 'B13003': ('UMID', False), 'B11002': ('VVENTO', False)}
ER_UM = {'MAREA': 'm', 'ONDE': 'm', 'TEMPACQUA': '°C', 'TEMP': '°C', 'UMID': '%', 'VVENTO': 'm/s'}

def fetch_er(debug=False):
    raw = http_get('https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl')
    stations, readings, units = {}, {}, {}
    for line in raw.split('\n'):
        if not line.strip():
            continue
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if o.get('network') not in ('boa', 'marefe'):          # solo boe e mareografi (marino)
            continue
        name, lat, lon, vals = None, None, None, {}
        for blk in o.get('data', []):
            vs = blk.get('vars', {})
            if 'B01019' in vs: name = vs['B01019']['v']
            if 'B05001' in vs: lat = to_float(vs['B05001']['v'])
            if 'B06001' in vs: lon = to_float(vs['B06001']['v'])
            for code, (var, kelvin) in ER_MARINE_CODES.items():
                if code in vs:
                    v = to_float(vs[code]['v'])
                    if v is None:
                        continue
                    vals[var] = round(v - 273.15, 1) if kelvin else v
        if not name or lat is None or lon is None or not vals:
            continue
        try:
            dt = datetime.datetime.strptime(o['date'], '%Y-%m-%dT%H:%M:%SZ')
        except (KeyError, ValueError):
            continue
        sc = _slug(name); ist = utc_to_solar(dt)
        stations[sc] = {'NOME': name, 'LAT': lat, 'LON': lon}
        for var, v in vals.items():
            readings.setdefault(var, {}).setdefault(sc, []).append((ist, v))
            units[var] = ER_UM.get(var)
    return stations, readings, units

#===========================================================================================================
# ACQ_VEN - ARPAV qualita' delle acque, boe automatiche (Delta Po / lagune). REST JSON.
#===========================================================================================================
ARPAV_ACQUA_MAP = {'Temperatura acqua': 'TEMPACQUA', 'Salinità': 'SALINITA', 'Ossigeno disciolto': 'OSSIGENO',
                   'pH misurato a campo': 'PH', 'Clorofilla a': 'CLOROFILLA',
                   'Conducibilità elettrica': 'CONDUCIBILITA', 'Ossigeno disciolto al prel.': 'OSSIGENO_SAT'}

def fetch_acque_ven(debug=False):
    B = 'https://api.arpa.veneto.it/REST/v1'
    coords = {}
    for s in http_json(B + '/acqua_boe_stazioni_point').get('data', []):
        try:
            g = json.loads(s['geometria']); lon, lat = g['coordinates'][0], g['coordinates'][1]
            coords[s['codseqst']] = {'lat': lat, 'lon': lon, 'nome': s.get('nome')}
        except (KeyError, ValueError, TypeError):
            continue
    stations, readings, units = {}, {}, {}
    for r in http_json(B + '/acqua_boe_dati').get('data', []):
        var = ARPAV_ACQUA_MAP.get(r.get('PARAMETRO'))
        co = coords.get(r.get('CODSEQST'))
        if not var or not co:
            continue
        val = to_float(r.get('MEDIA'))
        if val is None:
            continue
        try:
            dt = datetime.datetime.strptime(r['DATA'][:19], '%Y-%m-%dT%H:%M:%S')   # ora locale
        except (KeyError, ValueError):
            continue
        sc = str(r.get('CODSEQST'))
        stations[sc] = {'NOME': co['nome'], 'LAT': co['lat'], 'LON': co['lon']}
        readings.setdefault(var, {}).setdefault(sc, []).append((civil_to_solar(dt), val))
        units[var] = (r.get('UDM') or '').replace('gradi C.', '°C')
    return stations, readings, units

#===========================================================================================================
# MAR_FVG - OGS Trieste (ERDDAP), boe/sensori NRT del Golfo di Trieste e costa FVG
#===========================================================================================================
# ERDDAP tabledap, un dataset '<ID>_TS' per piattaforma. Il time e' UTC con suffisso 'Z' (fromisoformat
# non lo digerisce su Python 3.7 -> troncato e parsato a mano, poi utc_to_solar). Coordinate fisse
# (ancoraggi/pozzetti, confermate dall'actual_range del .das) -> hardcoded invece di una query per riga.
# QC = SeaDataNet L20 (0 non controllato, 1 buono, 2 probabilmente buono; 3-9 scartati). Il dataset di
# MAMBO1 accorpa piu' strumenti sullo stesso istante (righe duplicate quasi tutte nulle): innocuo, i
# valori nulli vengono scartati per colonna. RVFL (portata) alla foce dell'Isonzo puo' essere negativa
# (risalita di marea): valore reale, non un errore, lasciato passare com'e'.
OGS_BASE = 'https://nodc.ogs.it/erddap/tabledap/'
OGS_STATIONS = [
    # dataset ERDDAP, sigla stazione, nome, lat, lon, [(variabile OGS, sigla comune), ...]
    ('MAMBO1_TS',  'MAMBO1',  'Boa MAMBO1 (Golfo di Trieste)',      45.6976667, 13.7083333,
     [('WSPD', 'VVENTO'), ('WDIR', 'DVENTO'), ('DRYT', 'TEMP'), ('ATMS', 'PRESS'), ('RELH', 'UMID')]),
    ('DWRG1_TS',   'DWRG1',   'Ondametro DWRG1 (Golfo di Trieste)', 45.5655,    13.248,
     [('VAVH', 'ONDE')]),
    ('DWRG2_TS',   'DWRG2',   'Ondametro DWRG2 (Golfo di Trieste)', 45.6995,    13.209,
     [('VAVH', 'ONDE')]),
    ('DWRG3_TS',   'DWRG3',   'Ondametro DWRG3 (Golfo di Trieste)', 45.688266,  13.521316,
     [('VAVH', 'ONDE')]),
    ('CURRISO_TS', 'CURRISO', 'CURRISO - Foce Isonzo',              45.7616667, 13.4963333,
     [('RVFL', 'PORTATA'), ('TEMP', 'TEMPACQUA')]),
    ('PIEZTAG_TS', 'PIEZTAG', 'PIEZTAG - Foce Tagliamento',         45.6714885, 13.0685195,
     [('ASLV', 'MAREA'), ('TEMP', 'TEMPACQUA')]),
]
OGS_QC_OK = (0, 1, 2)   # no_qc_performed, good_data, probably_good_data

def fetch_fvg(debug=False):
    # finestra piccola (2 gg): recupera un'eventuale interruzione del Pi senza mai riscaricare la
    # storia intera (write_parsed deduplica per istante, quindi le righe gia' note sono a costo zero)
    since = (datetime.datetime.utcnow() - datetime.timedelta(days=2)).strftime('%Y-%m-%dT%H:%M:%SZ')
    stations, readings, units = {}, {}, {}
    for dataset_id, sc, nome, lat, lon, colmap in OGS_STATIONS:
        cols = ['time'] + [v for v, _ in colmap] + [v + '_QC' for v, _ in colmap]
        url = OGS_BASE + dataset_id + '.json?' + ','.join(cols) + '&time>=' + since
        try:
            rows = http_json(url)['table']['rows']
        except Exception as e:
            if debug: print('  OGS ' + dataset_id + ' skip: ' + str(e))
            continue
        got = False
        for row in rows:
            try:
                dt = datetime.datetime.strptime(row[0][:19], '%Y-%m-%dT%H:%M:%S')
            except (TypeError, ValueError):
                continue
            ist = utc_to_solar(dt)
            for i, (_, sigla) in enumerate(colmap):
                v = to_float(row[1 + i])
                qc = row[1 + len(colmap) + i]
                if v is None or qc not in OGS_QC_OK:
                    continue
                readings.setdefault(sigla, {}).setdefault(sc, []).append((ist, v))
                units[sigla] = UM.get(sigla)
                got = True
        if got:
            stations[sc] = {'NOME': nome, 'LAT': lat, 'LON': lon}
    return stations, readings, units

#===========================================================================================================
FETCHERS = {'VEN': ('MAR_VEN', fetch_ven), 'ER': ('MAR_ER', fetch_er), 'ACQVEN': ('ACQ_VEN', fetch_acque_ven),
            'FVG': ('MAR_FVG', fetch_fvg)}

def main():
    ap = argparse.ArgumentParser(description='Dati meteo-marini / maree (stazioni con coordinate).')
    ap.add_argument('-r', '--region', default='all', help="all | una o piu' reti separate da virgola, es. VEN,ER")
    ap.add_argument('-c', '--cleanup', default='yes', help='(compat)')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    regions = list(FETCHERS) if args.region.lower() == 'all' else [r.strip().upper() for r in args.region.split(',') if r.strip()]
    for reg in regions:
        if reg not in FETCHERS:
            print('Rete maree non disponibile: ' + reg); continue
        code, fetcher = FETCHERS[reg]
        print('\n=== MAREE ' + reg + ' ===')
        try:
            stations, readings, units = fetcher(debug=args.debug)
            write_parsed(code, stations, readings, units)
        except Exception as e:
            print(f'[{reg}] ERRORE: {e}')

if __name__ == '__main__':
    main()
