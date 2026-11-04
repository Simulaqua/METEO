#!/usr/bin/env python3

# dati_aria.py - QUALITA' DELL'ARIA per tutte le regioni/province del progetto.
# Ogni rete regionale e' trattata come una "regione" a se' con codice AQ_<REG> (AQ_VEN, AQ_TN, AQ_BZ,
# AQ_FVG, AQ_LOM, AQ_ER): scrive nello STESSO schema degli altri script
#   AQ_<REG>/data-parsed/<VAR>/<VAR>-YYYYMMDD.json   +   AQ_<REG>/data-parsed/stazioni.json
# cosi' export_web.py la esporta senza modifiche (basta aggiungerla a REGION_CFG) e la mappa la mostra.
#
# Sigle comuni degli inquinanti: PM10, PM25, NO2, O3, SO2, CO, C6H6 (benzene).
# Ogni STAZIONE ha SEMPRE lat/lon (le stazioni senza coordinate valide vengono scartate).
# I timestamp si memorizzano in ORA SOLARE (CET, UTC+1 fisso), come tutto il resto dell'archivio.
#
# Uso:  python3 dati_aria.py -r VEN            (una rete)
#       python3 dati_aria.py -r all            (tutte le reti disponibili)
#       python3 dati_aria.py -r VEN -c no      (non cancella i grezzi - qui non ci sono grezzi su file)

import os, sys, json, csv, io, argparse, datetime
import urllib.request, urllib.parse

_BASE_DIR = os.path.dirname(os.path.realpath(__file__))

SOLAR = datetime.timezone(datetime.timedelta(hours=1))     # ora solare CET (UTC+1 fisso)

# DST italiano calcolato a mano (zoneinfo non c'e' su Python < 3.9, es. il Raspberry con 3.7):
# ora legale (CEST) dall'ultima domenica di marzo all'ultima di ottobre.
def _ita_is_dst(dt):
    y = dt.year
    ls = lambda mo: 31 - ((datetime.date(y, mo, 31).weekday() + 1) % 7)
    return datetime.datetime(y, 3, ls(3), 2) <= dt < datetime.datetime(y, 10, ls(10), 3)

# sigle comuni + unita' "canonica" (per uniformare la legenda del sito)
POLLUTANTS = {
    'PM10': 'µg/m³', 'PM25': 'µg/m³', 'NO2': 'µg/m³', 'O3': 'µg/m³',
    'SO2': 'µg/m³', 'CO': 'mg/m³', 'C6H6': 'µg/m³',
    'GAMMA': 'µSv/h',                    # radioattivita' - dose gamma (BZ)
}

# mappe "identificativo-nella-fonte -> sigla comune", a livello di modulo cosi' check_updates.py
# puo' riusarle per segnalare inquinanti nuovi non ancora mappati.
VEN_POLLMAP = {'pm10': 'PM10', 'ozono': 'O3', 'biossido_azoto': 'NO2',
               'biossido_zolfo': 'SO2', 'monossido_carbonio': 'CO', 'benzene': 'C6H6', 'pm25': 'PM25'}
LOM_TYPEMAP = {'Biossido di Azoto': 'NO2', 'Biossido di Zolfo': 'SO2', 'Monossido di Carbonio': 'CO',
               'Ozono': 'O3', 'PM10 (SM2005)': 'PM10', 'Particelle sospese PM2.5': 'PM25', 'Benzene': 'C6H6'}
BZ_MCODEMAP = {'NO2': 'NO2', 'O3': 'O3', 'SO2': 'SO2', 'CO': 'CO', 'PM10': 'PM10', 'PM2.5': 'PM25',
               'GAMMA': 'GAMMA'}    # radioattivita' (dose gamma), stesso feed airquality
TN_POLLMAP  = {'pm10': 'PM10', 'pm25': 'PM25', 'no2': 'NO2', 'o3': 'O3', 'so2': 'SO2', 'co': 'CO'}

#-----------------------------------------------------------------------------------------------------------
# HELPER GENERICI
#-----------------------------------------------------------------------------------------------------------
def http_get(url, params=None, timeout=60):
    if params:
        url = url + ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (meteo-aria/1.0)'})
    return urllib.request.urlopen(req, timeout=timeout).read().decode('utf-8', 'replace')

def http_json(url, params=None, timeout=60):
    return json.loads(http_get(url, params, timeout))

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

def civil_to_solar(dt_naive):
    ''' datetime naive in ora civile italiana -> istante solare 'YYYYMMDDHHMM' (-1h in estate). '''
    if _ita_is_dst(dt_naive):
        dt_naive = dt_naive - datetime.timedelta(hours=1)
    return dt_naive.strftime('%Y%m%d%H%M')

def aware_to_solar(dt_aware):
    ''' datetime con tzinfo (es. +01:00/+02:00) -> istante solare 'YYYYMMDDHHMM'. '''
    return dt_aware.astimezone(SOLAR).strftime('%Y%m%d%H%M')

def now_solar():
    ''' Ora solare corrente (CET, UTC+1 fisso). '''
    return datetime.datetime.utcnow() + datetime.timedelta(hours=1)

#-----------------------------------------------------------------------------------------------------------
# SCRITTORE COMUNE: fonde le letture nell'archivio (merge ordinato + dedup per istante)
#   stations : {scode: {'NOME':..., 'LAT':float, 'LON':float}}          (solo con lat/lon valide)
#   readings : {VAR: {scode: [(istante, value), ...]}}
#   units    : {VAR: 'unita'}
#-----------------------------------------------------------------------------------------------------------
def write_parsed(region_code, stations, readings, units, debug=False):
    parse_dir = os.path.join(_BASE_DIR, region_code, 'data-parsed')
    stazioni_path = os.path.join(parse_dir, 'stazioni.json')
    station_list = jload(stazioni_path) if os.path.exists(stazioni_path) else {}
    for sc, meta in stations.items():
        station_list[sc] = {'SCODE': sc, 'NOME': meta.get('NOME'),
                            'LAT': meta.get('LAT'), 'LON': meta.get('LON')}
    added = 0
    for var, per_scode in readings.items():
        by_day = {}
        for sc, pts in per_scode.items():
            for ist, val in pts:
                if val is None:
                    continue
                by_day.setdefault(ist[:8], {}).setdefault(sc, []).append((ist, val))
        for day, per in by_day.items():
            fn = os.path.join(parse_dir, var, var + '-' + day + '.json')
            bin_day = jload(fn) if os.path.exists(fn) else {}
            for sc, pts in per.items():
                rec = bin_day.get(sc)
                if rec is None:
                    rec = {'STAZIONE': station_list.get(sc, {'SCODE': sc}),
                           'UM': units.get(var, POLLUTANTS.get(var)),
                           'MISURE': {'ISTANTE': [], 'VALORE': []}}
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
# ADATTATORI PER RETE
#===========================================================================================================

#-----------------------------------------------------------------------------------------------------------
def fetch_ven(debug=False):
    ''' ARPAV Veneto - aria. data.json (misure) + coords.json (lat/lon) + stats.json (nomi).
        Timestamp in ora CIVILE italiana -> convertito a solare. Inquinanti nel feed: pm10, ozono. '''
    BASE = 'https://www2.arpa.veneto.it/aria-json/exported/aria/'
    POLLMAP = VEN_POLLMAP
    coords = {c['codseqst']: (to_float(c['lat']), to_float(c['lon']))
              for c in http_json(BASE + 'coords.json')['coordinate']}
    names = {s['codseqst']: s.get('nome') for s in http_json(BASE + 'stats.json')['stazioni']}
    data = http_json(BASE + 'data.json')

    stations, readings = {}, {}
    for s in data['stazioni']:
        sc = s['codseqst']
        latlon = coords.get(sc)
        if not latlon or latlon[0] is None or latlon[1] is None:
            continue                                                 # niente coordinate -> scarto
        stations[sc] = {'NOME': names.get(sc) or sc, 'LAT': latlon[0], 'LON': latlon[1]}
        for blk in s.get('misurazioni', []):
            for poll_key, arr in blk.items():
                var = POLLMAP.get(poll_key)
                if var is None:
                    continue
                for e in arr:
                    val = to_float(e.get('mis'))
                    try:
                        dt = datetime.datetime.strptime(e['data'], '%Y-%m-%d %H:%M:%S')
                    except (KeyError, ValueError):
                        continue
                    ist = civil_to_solar(dt)
                    readings.setdefault(var, {}).setdefault(sc, []).append((ist, val))
    return stations, readings, {}

#-----------------------------------------------------------------------------------------------------------
def fetch_lom(debug=False, days=3):
    ''' ARPA Lombardia - aria (Socrata). Anagrafica ib47-atvt (coord lat/lng) + dati nicp-bhqi (orari,
        anno in corso). Join per idsensore, operatore '1' (media oraria). Timestamp ora solare, come il
        meteo LOM (memorizzato invariato). Finestra: ultimi `days` giorni, una query per giorno. '''
    ANAG = 'https://www.dati.lombardia.it/resource/ib47-atvt.json'
    DATI = 'https://www.dati.lombardia.it/resource/nicp-bhqi.json'
    TYPEMAP = LOM_TYPEMAP
    sens = {}
    for a in http_json(ANAG, {'$limit': '20000'}):
        var = TYPEMAP.get(a.get('nometiposensore'))
        if not var:
            continue
        lat, lon = to_float(a.get('lat')), to_float(a.get('lng'))
        if lat is None or lon is None or (abs(lat) < 0.001 and abs(lon) < 0.001):
            continue
        sens[a.get('idsensore')] = {'var': var, 'sc': a.get('idstazione'), 'nome': a.get('nomestazione'),
                                    'lat': lat, 'lon': lon, 'um': a.get('unitamisura')}
    latest = http_json(DATI, {'$select': 'data', '$order': 'data DESC', '$limit': '1'})
    end = (datetime.datetime.strptime(latest[0]['data'][:19], '%Y-%m-%dT%H:%M:%S')
           if latest else datetime.datetime.now())
    stations, readings, units = {}, {}, {}
    for k in range(days + 1):
        day = (end - datetime.timedelta(days=k)).strftime('%Y-%m-%d')
        where = "data >= '%sT00:00:00' AND data <= '%sT23:59:59' AND idoperatore='1'" % (day, day)
        for r in http_json(DATI, {'$where': where, '$limit': '50000'}):
            s = sens.get(r.get('idsensore'))
            if not s or r.get('stato') == 'NA':
                continue
            val = to_float(r.get('valore'))
            if val is None or val == -9999:
                continue
            sc = s['sc']
            if sc is None:
                continue
            stations[sc] = {'NOME': s['nome'], 'LAT': s['lat'], 'LON': s['lon']}
            d = r['data']
            ist = d[0:4] + d[5:7] + d[8:10] + d[11:13] + d[14:16]         # ora solare, invariata
            readings.setdefault(s['var'], {}).setdefault(sc, []).append((ist, val))
            units[s['var']] = s['um'] or POLLUTANTS.get(s['var'])
    return stations, readings, units

#-----------------------------------------------------------------------------------------------------------
def _slug(s):
    return ''.join(c if c.isalnum() else '_' for c in (s or '')).strip('_') or 'staz'

def fetch_fvg(debug=False, days=7):
    ''' ARPA FVG - aria (Socrata, un dataset per inquinante). Valori GIORNALIERI con coordinate incluse.
        Codice stazione = slug dell'ubicazione (i dataset non hanno un id stazione). '''
    # (resource_id, sigla, campo-valore preferito)
    DS = [('qp5k-6pvm', 'PM10', 'media_giornaliera'), ('d63p-pqpr', 'PM25', 'media_giornaliera'),
          ('ke9b-p6z2', 'NO2', 'media_oraria_max'), ('7vnx-28uy', 'O3', 'media_oraria_max'),
          ('2zdv-x7g2', 'SO2', 'media_oraria_max'), ('t274-vki6', 'CO', 'media_oraria_max')]
    VALUE_FIELDS = ['media_giornaliera', 'media_oraria_max', 'media_giornaliera_max',
                    'media_max_giornaliera_8h', 'valore']
    cutoff = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime('%Y-%m-%dT00:00:00')
    stations, readings, units = {}, {}, {}
    for rid, var, prefer in DS:
        url = 'https://www.dati.friuliveneziagiulia.it/resource/' + rid + '.json'
        try:
            rows = http_json(url, {'$where': "data_misura >= '" + cutoff + "'",
                                   '$order': 'data_misura DESC', '$limit': '5000'})
        except Exception as e:
            if debug: print('  FVG ' + var + ' skip: ' + str(e)); continue
        for r in rows:
            lat, lon = to_float(r.get('latitudine')), to_float(r.get('longitudine'))
            if lat is None or lon is None:
                continue
            name = r.get('ubicazione') or _slug(str(lat) + '_' + str(lon))
            sc = _slug(name)
            val = None
            for f in [prefer] + VALUE_FIELDS:
                if r.get(f) not in (None, ''):
                    val = to_float(r.get(f)); break
            if val is None:
                continue
            d = r.get('data_misura', '')
            ist = d[0:4] + d[5:7] + d[8:10] + '0000'           # giornaliero -> 00:00
            if len(ist) < 12:
                continue
            stations[sc] = {'NOME': name, 'LAT': lat, 'LON': lon}
            readings.setdefault(var, {}).setdefault(sc, []).append((ist, val))
            units[var] = r.get('unita_misura') or POLLUTANTS.get(var)
    return stations, readings, units

#-----------------------------------------------------------------------------------------------------------
def fetch_bz(debug=False, days=7):
    ''' APPA Bolzano - aria. Valori da dati.retecivica.bz.it/services/airquality/timeseries (una chiamata
        per stazione, torna tutti gli MCODE). COORDINATE da Open Data Hub Sudtirol (EnvironmentStation,
        sorigin=APPABZ): l'endpoint airquality/stations restituisce 0,0, quindi le prendo dall'ODH per
        scode. DATE con offset (+01:00/+02:00) -> ora solare. '''
    ODH = 'https://mobility.api.opendatahub.com/v2/flat/EnvironmentStation'
    AQ  = 'https://dati.retecivica.bz.it/services/airquality'
    MCODEMAP = BZ_MCODEMAP
    # coordinate dall'Open Data Hub (x=lon, y=lat, srid 4326); scarto le 0,0
    coords = {}
    for s in http_json(ODH, {'where': 'sorigin.eq.APPABZ', 'limit': '500'}).get('data', []):
        c = s.get('scoordinate') or {}
        x, y = to_float(c.get('x')), to_float(c.get('y'))
        if x and y and abs(x) > 0.001 and abs(y) > 0.001:
            coords[s.get('scode')] = {'lat': y, 'lon': x, 'nome': s.get('sname')}
    # stazioni che hanno sensori d'aria (dal feed sensori)
    air_scodes = sorted({r.get('SCODE') for r in http_json(AQ + '/sensors')
                         if r.get('MCODE') in MCODEMAP and r.get('SCODE')})
    d_from = (now_solar() - datetime.timedelta(days=days)).strftime('%Y%m%d')
    d_to   = now_solar().strftime('%Y%m%d')
    stations, readings, units = {}, {}, {}
    for sc in air_scodes:
        co = coords.get(sc)
        if not co:
            continue                                                 # niente coordinate -> scarto
        try:
            data = http_json(AQ + '/timeseries', {'station_code': sc, 'date_from': d_from, 'date_to': d_to})
        except Exception as e:
            if debug: print('  BZ ' + sc + ' skip: ' + str(e)); continue
        got = False
        for e in data:
            var = MCODEMAP.get(e.get('MCODE'))
            if not var:
                continue
            val = to_float(e.get('VALUE'))
            if val is None or val < 0:                               # -1 = mancante
                continue
            try:
                dt = datetime.datetime.fromisoformat(e['DATE'])
            except (KeyError, ValueError):
                continue
            readings.setdefault(var, {}).setdefault(sc, []).append((aware_to_solar(dt), val))
            units[var] = POLLUTANTS.get(var)
            got = True
        if got:
            stations[sc] = {'NOME': co['nome'] or sc, 'LAT': co['lat'], 'LON': co['lon']}
    return stations, readings, units

#-----------------------------------------------------------------------------------------------------------
def _poll_sigla(nome):
    ''' Nome parametro ARPAE/APPA -> sigla comune, o None se non e' un inquinante che teniamo. '''
    n = (nome or '').upper()
    if 'PM10' in n: return 'PM10'
    if 'PM2.5' in n or 'PM25' in n: return 'PM25'
    if 'OZONO' in n or n.startswith('O3'): return 'O3'
    if 'BIOSSIDO DI AZOTO' in n or n.startswith('NO2'): return 'NO2'
    if 'BIOSSIDO DI ZOLFO' in n or n.startswith('SO2'): return 'SO2'
    if 'MONOSSIDO DI CARBONIO' in n or n.startswith('CO ') or n == 'CO': return 'CO'
    if 'BENZENE' in n or 'C6H6' in n: return 'C6H6'
    return None

def fetch_er(debug=False, days=5):
    ''' ARPAE Emilia-Romagna - aria. Dati recenti dal datastore CKAN (sort _id desc), anagrafiche stazioni
        e parametri (CSV) per COORDINATE (LAT_GEO/LON_GEO) e sigle. Join: station_id == Cod_staz senza
        punti; variable_id == IdParametro. reftime 'MM/DD/YYYY HH:MM' (ora locale) -> solare. '''
    DATA = 'https://dati.arpae.it/api/3/action/datastore_search'
    RID  = '4dc855a1-6298-4b71-a1ae-d80693d43dcb'
    STA_CSV = 'https://docs.google.com/spreadsheets/d/1-4wgZ8JeLeg0bODTSFUrshPY-_y9mERUu0FJtSFr78s/export?format=csv'
    PAR_CSV = 'https://docs.google.com/spreadsheets/d/1K6vRcShjje2CDnvnk39o3jkU4ihgpA7rfsdAV1S-yXU/export?format=csv'
    # anagrafe stazioni: Cod_staz senza punti -> (nome, lat, lon)
    sta = {}
    for r in csv.DictReader(io.StringIO(http_get(STA_CSV))):
        code = (r.get('Cod_staz') or '').replace('.', '')
        lat, lon = to_float(r.get('LAT_GEO')), to_float(r.get('LON_GEO'))
        if code and lat is not None and lon is not None:
            sta[code] = {'nome': r.get('Stazione'), 'lat': lat, 'lon': lon}
    # anagrafe parametri: IdParametro -> sigla
    par = {}
    for r in csv.DictReader(io.StringIO(http_get(PAR_CSV))):
        sig = _poll_sigla(r.get('PARAMETRO'))
        if sig:
            par[str(r.get('IdParametro'))] = sig
    cutoff = now_solar() - datetime.timedelta(days=days)
    stations, readings, units = {}, {}, {}
    offset, PAGE, stop = 0, 32000, False
    while not stop and offset < 32000 * 6:
        res = http_json(DATA, {'resource_id': RID, 'limit': str(PAGE), 'offset': str(offset),
                               'sort': '_id desc'})['result']['records']
        if not res:
            break
        oldest_in_batch = None
        for r in res:
            var = par.get(str(r.get('variable_id')))
            st  = sta.get(str(r.get('station_id')))
            if var is None or st is None:
                continue
            try:
                dt = datetime.datetime.strptime(r.get('reftime'), '%m/%d/%Y %H:%M')
            except (ValueError, TypeError):
                continue
            if oldest_in_batch is None or dt < oldest_in_batch:
                oldest_in_batch = dt
            if dt < cutoff:
                continue
            val = to_float(r.get('value'))
            if val is None or val < 0:
                continue
            ist = civil_to_solar(dt)                                  # reftime locale -> solare
            sc = str(r.get('station_id'))
            stations[sc] = {'NOME': st['nome'], 'LAT': st['lat'], 'LON': st['lon']}
            readings.setdefault(var, {}).setdefault(sc, []).append((ist, val))
            units.setdefault(var, POLLUTANTS.get(var))
        if oldest_in_batch is not None and oldest_in_batch < cutoff:
            stop = True                                              # ho superato la finestra: basta
        offset += PAGE
    return stations, readings, units

#-----------------------------------------------------------------------------------------------------------
# APPA Trento - aria: il feed NON espone coordinate; le 8 stazioni sono fisse -> tabella curata
# (geocodifica OSM degli indirizzi ufficiali; correggibile). Codice stazione = slug del nome.
TN_COORDS = {
    'Parco S. Chiara':  (46.0633, 11.1262), 'Via Bolzano':     (46.0957, 11.1130),
    'Rovereto':         (45.8905, 11.0398), 'Borgo Valsugana': (46.0518, 11.4555),
    'Riva del Garda':   (45.9043, 10.8421), 'Monte Gaza':      (46.1161, 11.0026),
    'Piana Rotaliana':  (46.1929, 11.1336), 'A22 (Avio)':      (45.7264, 10.9043),
}

def fetch_tn(debug=False, days=None):
    ''' APPA Trento - aria. Bollettino JSON (dati orari per stazione, nidificati per giorno/ora). Coordinate
        dalla tabella curata TN_COORDS (il feed non le espone). Ore 1..24 (fine rilevazione), locale->solare. '''
    IDS = '2,4,6,8,9,15,22,23'
    POLLMAP = TN_POLLMAP
    d = http_json('https://bollettino.appa.tn.it/aria/opendata/json/last/' + IDS)
    stations, readings, units = {}, {}, {}
    for s in d.get('stazione', []):
        nome = s.get('nome')
        co = TN_COORDS.get(nome)
        if not co:
            if debug: print('  TN senza coordinate: ' + str(nome)); continue
        sc = _slug(nome)
        stations[sc] = {'NOME': nome, 'LAT': co[0], 'LON': co[1]}
        for day, hours in (s.get('dati') or {}).items():
            for hour, vals in hours.items():
                try:
                    # ore 1..24 = FINE dell'ora: la 24 e' la mezzanotte di fine giornata (00:00 del giorno DOPO).
                    # Con `% 24` finiva alle 00:00 dello stesso giorno, cioe' 24 h troppo presto.
                    dt = datetime.datetime.strptime(day, '%Y-%m-%d') + datetime.timedelta(hours=int(hour))
                except (ValueError, TypeError):
                    continue
                ist = civil_to_solar(dt)                              # ora locale -> solare
                for pk, var in POLLMAP.items():
                    v = to_float(vals.get(pk))
                    if v is None:
                        continue
                    readings.setdefault(var, {}).setdefault(sc, []).append((ist, v))
                    units.setdefault(var, POLLUTANTS.get(var))
    return stations, readings, units

#===========================================================================================================
FETCHERS = {'VEN': fetch_ven, 'LOM': fetch_lom, 'BZ': fetch_bz, 'ER': fetch_er, 'TN': fetch_tn}
# codice regione-archivio per rete aria
def region_code(reg): return 'AQ_' + reg

#-----------------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description='Qualita\' dell\'aria regionale (stazioni con coordinate).')
    ap.add_argument('-r', '--region', default='all', help='VEN/TN/BZ/FVG/LOM/ER/all')
    ap.add_argument('-c', '--cleanup', default='yes', help='(compat: qui non ci sono grezzi su file)')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()

    regions = list(FETCHERS) if args.region.lower() == 'all' else [args.region.upper()]
    for reg in regions:
        if reg not in FETCHERS:
            print('Rete aria non ancora disponibile: ' + reg); continue
        print('\n=== ARIA ' + reg + ' ===')
        try:
            stations, readings, units = FETCHERS[reg](debug=args.debug)
            write_parsed(region_code(reg), stations, readings, units, debug=args.debug)
        except Exception as e:
            print(f'[{reg}] ERRORE: {e}')

if __name__ == '__main__':
    main()
