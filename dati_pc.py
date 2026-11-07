#!/usr/bin/env python3
# dati_pc.py - idrometria (e affini) delle reti di Protezione Civile e vicine, ogni rete come una regione a sé:
#   FVG  PC_FVG       Protezione Civile del Friuli Venezia Giulia (monitor.protezionecivile.fvg.it/api):
#                     measures/latest è un'istantanea con lat/lon per misura, la serie si costruisce accumulando a
#                     ogni giro; la mappa sensore -> codice si costruisce una volta e resta in PC_FVG/sensors_map.json
#   TN   PC_TN        Ufficio Dighe della Provincia di Trento (floods.it): index.json è il catalogo con le
#                     coordinate, ogni serie <id>.json porta ~7 giorni (istanti epoch UTC + valori)
#   PO   PC_PO        AIPO, bacino del Po (API AEGIS/datascapeA)
#   PIE  PIE, PC_PIE  ARPA Piemonte: un solo scarico per due regioni
# Stesso schema degli altri script: <REGIONE>/data-parsed/<VAR>/<VAR>-AAAAMMGG.json + stazioni.json. Ogni stazione
# ha lat/lon. Gli istanti sono in ora solare (UTC+1).
# Uso: python3 dati_pc.py [-r all | -r FVG | -r TN | -r PO | -r PIE] [--full] [--debug]
import argparse
import datetime
import json
import os
import uuid
import warnings

import requests

import comune


# codice della fonte -> sigla. FVG_MAP e TN_MAP sono a livello di modulo perché check_updates.py li legge per
# segnalare le grandezze nuove non ancora mappate.
FVG_API = 'https://monitor.protezionecivile.fvg.it/api'
FVG_MAP = {'IDRO': 'LIVIDRO', 'NIVO': 'LIVNEVE', 'T': 'TEMP', 'U': 'UMID', 'Vv': 'VVENTO',
           'VvMax': 'VVENTOMAX', 'Dv': 'DVENTO', 'B': 'PRESS', 'RG': 'RADSOL', 'P_1h': 'PREC'}
FVG_UNITS = {'LIVIDRO': 'm', 'LIVLAGO': 'm', 'LIVNEVE': 'cm', 'TEMP': '°C', 'UMID': '%', 'VVENTO': 'm/s',
             'VVENTOMAX': 'm/s', 'DVENTO': '°N', 'PRESS': 'hPa', 'RADSOL': 'W/m²', 'PREC': 'mm'}

TN_BASE = 'https://www.floods.it/api/v1/monitoring/'
TN_MAP = {'gage height': 'LIVIDRO', 'discharge': 'PORTATA'}
TN_UNITS = {'LIVIDRO': 'm', 'PORTATA': 'm³/s'}

# PO: feed idrometrico del bacino del Po. Aggrega reti regionali (ARPA Lombardia, Regione ER, ...) più le stazioni
# proprie di AIPO e si scarica tutto: i doppioni con ER/LOM restano (sulla mappa sono puntini vicini).
# Accesso anonimo pubblico; il certificato SSL del sito è incompleto, quindi verify=False, solo per questo
# host. Le coordinate sono in /v3/locations (x = lon, y = lat). PC_PO/elements_map.json tiene in cache
# stazione -> elementId del livello.
PO_BASE = 'https://idrometri.agenziapo.it/datascapeA'

# PIE: ARPA Piemonte, rete meteoidrografica. Un solo scarico orario per due regioni:
#   PIE    = tutte le ~374 stazioni, meteo e livelli insieme (voce "Piemonte" del sito);
#   PC_PIE = i soli ~107 idrometri del bacino del Po a monte (Po + Tanaro/Ticino/Dora/Sesia/Scrivia...),
#            per la voce "Po (AIPO + Piemonte)".
# API FastAPI anonima documentata (OpenAPI):
#   /pie_anag  anagrafica (lat/lng, river_name, basin, hydrometric_zero in m s.m.m.)
#   /data_pie  misure orarie degli ultimi 3 giorni; senza station_code è uno scarico unico paginato (page/page_size)
# Campi verificati il 2026-11-02 contro ItaliaMeteo (stesse stazioni, ora UTC): cum_rain_1h è la pioggia dell'ora
# che finisce all'istante; wind e gust_of_wind sono in km/h (rapporto 3.57). Le cumulate 3-24 h della fonte non
# servono (derive.py calcola le nostre). Gli istanti hanno l'offset esplicito ('+01:00' / '+02:00').
# Finestra: le ultime 7 ore (scarico leggero); nel giro delle 03 i 3 giorni interi, così un buco (Pi spento, fonte
# ferma) si richiude entro la notte successiva. Si salvano PIE/ e PC_PIE/zero_idrometrici.json: il sito mostra il
# LIVIDRO in quota assoluta (come per il Veneto).
PIE_BASE = 'https://utility.arpa.piemonte.it/api_realtime'
# campo dell'API -> (sigla, unità, fattore sul valore)
PIE_FIELDS = [('air_temperature',   'TEMP',      '°C',    1.0),
              ('humidity',          'UMID',      '%',     1.0),
              ('cum_rain_1h',       'PREC',      'mm',    1.0),
              ('wind',              'VVENTO',    'm/s',   1 / 3.6),
              ('wind_direction',    'DVENTO',    'gradi', 1.0),
              ('gust_of_wind',      'VVENTOMAX', 'm/s',   1 / 3.6),
              ('gust_direction',    'DVENTOMAX', 'gradi', 1.0),
              ('snow_height',       'LIVNEVE',   'cm',    1.0),
              ('hydrometric_level', 'LIVIDRO',   'm',     1.0)]
PIE_UNITS = {var: unit for _, var, unit, _ in PIE_FIELDS}


def is_number(x):
    try:
        float(x)
        return True
    except (TypeError, ValueError):
        return False


def fvg_sensor_codes(debug=False):
    """sensor_id -> codice del sensore: si costruisce scorrendo i sensori di ogni stazione e resta in cache."""
    cache = os.path.join(comune.region_dir('PC_FVG'), 'sensors_map.json')
    cached = comune.load_json(cache)
    if cached:
        return {int(k): v for k, v in cached.items()}
    codes = {}
    for station in comune.get_json(FVG_API + '/stations', timeout=90).get('stations', []):
        try:
            sensors = comune.get_json(FVG_API + '/stations/%s/sensors' % station['id'], timeout=90)
            for sensor in sensors.get('sensors', []):
                codes[sensor['id']] = sensor.get('code')
        except Exception:
            continue
    comune.save_json({str(k): v for k, v in codes.items()}, cache)
    if debug:
        print('  PC_FVG mappa sensori costruita: %d' % len(codes))
    return codes


def download_fvg(debug=False):
    codes = fvg_sensor_codes(debug)
    stations, readings = {}, {}
    for m in comune.get_json(FVG_API + '/measures/latest', timeout=90).get('measures', []):
        var = FVG_MAP.get(codes.get(m.get('sensor_id')))
        if var is None:
            continue
        # gli invasi artificiali (Barcis, Ravedis, Ca' Zul, Ca' Selva, Tramonti) riportano la quota assoluta
        # dell'invaso in m s.l.m., non un livello idrometrico: si classificano livello di lago
        if var == 'LIVIDRO' and 'invaso' in str(m.get('station_name') or '').lower():
            var = 'LIVLAGO'
        lat, lon = comune.to_float(m.get('lat')), comune.to_float(m.get('lon'))
        value = comune.to_float(m.get('value'))
        if lat is None or lon is None or (abs(lat) < 0.001 and abs(lon) < 0.001) or value is None:
            continue
        sc = 'FVG' + str(m.get('station_id'))
        try:
            dt = datetime.datetime.strptime(m.get('dt'), '%Y-%m-%d %H:%M:%S')
        except (ValueError, TypeError):
            continue
        stations[sc] = {'NOME': m.get('station_name') or sc, 'LAT': lat, 'LON': lon}
        readings.setdefault(var, {}).setdefault(sc, []).append((comune.civil_to_solar(dt), value))
    return {'PC_FVG': (stations, readings, FVG_UNITS)}


def download_tn(debug=False):
    features = comune.get_json(TN_BASE + 'index.json', timeout=90).get('features', [])
    stations, readings, units = {}, {}, {}
    for i, f in enumerate(features):
        md = (f.get('properties') or {}).get('metadata', {})
        var = TN_MAP.get(md.get('quantity'))
        if var is None:
            continue
        coords = (f.get('geometry') or {}).get('coordinates') or [0, 0]
        lon, lat = comune.to_float(coords[0]), comune.to_float(coords[1])
        if lat is None or lon is None or (abs(lat) < 0.001 and abs(lon) < 0.001):
            continue
        sid = str(md.get('series id') or i)
        try:
            series = comune.get_json(TN_BASE + sid + '.json', timeout=90)
        except Exception:
            continue
        data = (((series.get('features') or [{}])[0].get('properties') or {}).get('data') or {})
        times = data.get('timestamp') or []
        # i valori sono la prima lista di data che non è 'timestamp'
        values = None
        for key, v in data.items():
            if key != 'timestamp' and isinstance(v, list):
                values = v
                break
        if not times or values is None:
            continue
        sc = 'TN' + sid
        stations[sc] = {'NOME': md.get('site') or sc, 'LAT': lat, 'LON': lon}
        points = []
        for t, v in zip(times, values):
            value = comune.to_float(v)
            if value is not None:
                points.append((comune.utc_to_solar(datetime.datetime.utcfromtimestamp(int(t))), value))
        if points:
            readings.setdefault(var, {}).setdefault(sc, []).extend(points)
            units[var] = md.get('uom') or TN_UNITS.get(var)
        if debug and i % 40 == 0:
            print('  PC_TN %d/%d serie...' % (i, len(features)))
    return {'PC_TN': (stations, readings, units)}


def download_po(debug=False, days=7):
    # senza verifica del certificato (vedi PO_BASE) ogni richiesta stamperebbe l'avviso «Unverified HTTPS request»
    warnings.filterwarnings('ignore', message='Unverified HTTPS request')
    answer = requests.post(PO_BASE + '/connect/token', timeout=60, verify=False,
                           headers={'User-Agent': comune.USER_AGENT},
                           data={'grant_type': 'password', 'username': 'anonymous', 'password': 'anonymous',
                                 'client_id': 'Aegis', 'client_instance': str(uuid.uuid4())})
    answer.raise_for_status()
    token = json.loads(answer.content.decode('utf-8', 'replace'))['access_token']
    headers = {'Authorization': 'Bearer ' + token, 'User-Agent': comune.USER_AGENT}
    cache = os.path.join(comune.region_dir('PC_PO'), 'elements_map.json')
    element_ids = comune.load_json(cache)
    locations = comune.get_json(PO_BASE + '/v3/locations?category=All', headers=headers, verify=False)
    since = (comune.now_solar() - datetime.timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%S')
    until = comune.now_solar().strftime('%Y-%m-%dT%H:%M:%S')
    stations, readings = {}, {}
    for loc in locations:
        sid = str(loc.get('i'))
        lon, lat = comune.to_float(loc.get('x')), comune.to_float(loc.get('y'))
        if lat is None or lon is None or (abs(lat) < 0.001 and abs(lon) < 0.001):
            continue
        element_id = element_ids.get(sid)
        if element_id is None:
            try:
                elements = comune.get_json(PO_BASE + '/v3/elements?station_id=' + sid, headers=headers, verify=False)
            except Exception:
                continue
            levels = [e for e in elements if e.get('measUnit') == 'm' and 'evel' in (e.get('elementName') or '')]
            if not levels:
                continue
            element_id = levels[0]['elementId']
            element_ids[sid] = element_id
        try:
            rows = comune.get_json(PO_BASE + '/v3/data/%s?from=%s&to=%s' % (element_id, since, until),
                                   headers=headers, verify=False)
        except Exception:
            continue
        points = []
        for row in rows:
            if not (isinstance(row, list) and len(row) >= 2):
                continue
            value = comune.to_float(row[1])
            if value is None:
                continue
            try:
                dt = datetime.datetime.fromisoformat(row[0])
            except (ValueError, TypeError):
                continue
            points.append((comune.aware_to_solar(dt), value))
        if points:
            sc = 'PO' + sid
            stations[sc] = {'NOME': loc.get('n') or sc, 'LAT': lat, 'LON': lon}
            readings.setdefault('LIVIDRO', {})[sc] = points
        if debug and len(stations) % 30 == 0:
            print('  PC_PO %d stazioni...' % len(stations))
    comune.save_json(element_ids, cache)
    return {'PC_PO': (stations, readings, {'LIVIDRO': 'm'})}


def download_pie(full=False, debug=False):
    registry = comune.get_json(PIE_BASE + '/pie_anag', {'page_size': 2000}, timeout=90)
    rows = registry if isinstance(registry, list) else registry.get('data', [])
    meta, hydrometers, zeros = {}, set(), {}
    for r in rows:
        code = str(r.get('station_code'))
        lat, lon = comune.to_float(r.get('lat')), comune.to_float(r.get('lng'))
        if lat is None or lon is None:
            continue
        sc = 'PIE' + code
        name = (r.get('name') or sc).title()                           # 'COLLE LOMBARDA' -> 'Colle Lombarda'
        # idrometri veri: river_name valorizzato e zero idrometrico numerico -> nome "Fiume a Comune"
        if r.get('river_name') not in ('-', '', None) and is_number(r.get('hydrometric_zero')):
            river = (r.get('river_name') or '').title()
            town = (r.get('municipality') or r.get('name') or '').title()
            if river and town:
                name = river + ' a ' + town
            hydrometers.add(code)
            zeros[sc] = {'zero': round(float(r.get('hydrometric_zero')), 3)}
        meta[code] = {'sc': sc, 'NOME': name, 'LAT': lat, 'LON': lon}
    full = full or datetime.datetime.now().hour == 3                  # ora locale del Pi (cron alle hh:22)
    window = datetime.timedelta(days=3) if full else datetime.timedelta(hours=7)
    since = (comune.now_solar() - window).strftime('%Y-%m-%dT%H:%M')
    stations, readings = {}, {}
    po_stations, po_readings = {}, {'LIVIDRO': {}}
    page = 1
    while True:
        answer = comune.get_json(PIE_BASE + '/data_pie', {'date_from': since, 'page': page, 'page_size': 5000},
                                 timeout=90)
        records = answer if isinstance(answer, list) else answer.get('data', [])
        if not records:
            break
        for rec in records:
            code = str(rec.get('station_code'))
            station = meta.get(code)
            if station is None:
                continue
            try:
                dt = datetime.datetime.fromisoformat(rec['date'])
            except (ValueError, TypeError, KeyError):
                continue
            moment = comune.aware_to_solar(dt)
            sc = station['sc']
            for field, var, _, factor in PIE_FIELDS:
                value = comune.to_float(rec.get(field))
                if value is None:
                    continue
                value = round(value * factor, 2)
                stations[sc] = {'NOME': station['NOME'], 'LAT': station['LAT'], 'LON': station['LON']}
                readings.setdefault(var, {}).setdefault(sc, []).append((moment, value))
                if var == 'LIVIDRO' and code in hydrometers:
                    po_stations[sc] = stations[sc]
                    po_readings['LIVIDRO'].setdefault(sc, []).append((moment, value))
        total_pages = (answer.get('total_pages') if isinstance(answer, dict) else 1) or 1
        if page >= total_pages:
            break
        page += 1
    # zeri idrometrici delle stazioni presenti, in entrambe le regioni: il sito mostra il livello in quota assoluta
    for region, present in (('PIE', stations), ('PC_PIE', po_stations)):
        if present:
            comune.save_json({sc: zeros[sc] for sc in present if sc in zeros},
                             os.path.join(comune.region_dir(region), 'zero_idrometrici.json'))
    if debug:
        print('  finestra da %s%s | stazioni PIE %d (idrometri PC_PIE %d) | variabili: %s' % (
              since, ' (3 giorni)' if full else '', len(stations), len(po_stations),
              ', '.join('%s %d' % (var, len(readings.get(var, {}))) for _, var, _, _ in PIE_FIELDS)))
    return {'PIE': (stations, readings, PIE_UNITS), 'PC_PIE': (po_stations, po_readings, {'LIVIDRO': 'm'})}


# ogni rete restituisce {codice della regione: (stazioni, letture, unità)}
NETWORKS = {'FVG': download_fvg, 'TN': download_tn, 'PO': download_po, 'PIE': download_pie}


def main():
    ap = argparse.ArgumentParser(description='Idrometria Protezione Civile (stazioni con coordinate).')
    ap.add_argument('-r', '--region', default='all', help='FVG/TN/PO/PIE/all')
    ap.add_argument('--full', action='store_true', help='PIE: scarica i 3 giorni interi (di norma solo nel giro delle 03)')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    names = list(NETWORKS) if args.region.lower() == 'all' else [args.region.upper()]
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print('\n=== IDROMETRIA PC (%s) %s ===' % (', '.join(names), now))
    for name in names:
        if name not in NETWORKS:
            print('Rete PC non disponibile: ' + name)
            continue
        try:
            if name == 'PIE':                                          # --full vale solo per il Piemonte
                regions = download_pie(full=args.full, debug=args.debug)
            else:
                regions = NETWORKS[name](debug=args.debug)
            for code, (stations, readings, units) in regions.items():
                comune.write_parsed(code, stations, readings, units)
        except Exception as e:
            print('[%s] ERRORE: %s' % (name, e))


if __name__ == '__main__':
    main()
