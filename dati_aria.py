#!/usr/bin/env python3
# dati_aria.py - qualità dell'aria, ogni rete regionale come regione a sé (AQ_VEN, AQ_TN, AQ_BZ, AQ_LOM,
# AQ_ER), con lo stesso schema degli altri script:
# AQ_<RETE>/data-parsed/<VAR>/<VAR>-AAAAMMGG.json + stazioni.json.
# Sigle comuni degli inquinanti: PM10, PM25, NO2, O3, SO2, CO, C6H6 (benzene).
# Una stazione senza coordinate valide si scarta. Gli istanti sono in ora solare (UTC+1).
# Uso: python3 dati_aria.py [-r all | -r VEN|TN|BZ|LOM|ER] [--debug]   (una rete per volta)
import argparse
import csv
import datetime
import io
import unicodedata

import comune


# sigle comuni + unità per la legenda del sito
POLLUTANTS = {
    'PM10': 'µg/m³', 'PM25': 'µg/m³', 'NO2': 'µg/m³', 'O3': 'µg/m³',
    'SO2': 'µg/m³', 'CO': 'mg/m³', 'C6H6': 'µg/m³',
    'GAMMA': 'µSv/h',                    # radioattività, dose gamma (BZ)
}

# identificativo nella fonte -> sigla comune. Letti da check_updates.py per segnalare gli inquinanti nuovi.
VEN_POLLMAP = {'pm10': 'PM10', 'ozono': 'O3', 'biossido_azoto': 'NO2',
               'biossido_zolfo': 'SO2', 'monossido_carbonio': 'CO', 'benzene': 'C6H6', 'pm25': 'PM25'}
LOM_TYPEMAP = {'Biossido di Azoto': 'NO2', 'Biossido di Zolfo': 'SO2', 'Monossido di Carbonio': 'CO',
               'Ozono': 'O3', 'PM10 (SM2005)': 'PM10', 'Particelle sospese PM2.5': 'PM25', 'Benzene': 'C6H6'}
BZ_MCODEMAP = {'NO2': 'NO2', 'O3': 'O3', 'SO2': 'SO2', 'CO': 'CO', 'PM10': 'PM10', 'PM2.5': 'PM25',
               'GAMMA': 'GAMMA'}
TN_POLLMAP = {'pm10': 'PM10', 'pm25': 'PM25', 'no2': 'NO2', 'o3': 'O3', 'so2': 'SO2', 'co': 'CO'}

# VEN: coords.json (lat/lon), stats.json (nomi), data.json (misure). Istanti in ora civile.
VEN_BASE = 'https://www2.arpa.veneto.it/aria-json/exported/aria/'

# LOM (Socrata): anagrafica dei sensori e dati orari, uniti per idsensore
LOM_ANAGRAFICA = 'https://www.dati.lombardia.it/resource/ib47-atvt.json'
LOM_DATI = 'https://www.dati.lombardia.it/resource/nicp-bhqi.json'

# BZ: i valori vengono da dati.retecivica.bz.it, ma l'endpoint delle stazioni dà coordinate 0,0: si prendono
# dall'Open Data Hub Sudtirol (sorigin APPABZ), unendo per scode.
BZ_ODH = 'https://mobility.api.opendatahub.com/v2/flat/EnvironmentStation'
BZ_AIRQUALITY = 'https://dati.retecivica.bz.it/services/airquality'

# ER (ARPAE, portale Opendatasoft): ultimi 50 giorni di dati orari e giornalieri, aggiornati una volta
# al giorno; reftime e' in UTC. Codice e coordinate delle stazioni vengono dal foglio di anagrafica, unito
# per nome (maiuscole, accenti e punteggiatura non contano): le stazioni tengono i codici di prima.
ER_DATA = ('https://dati.arpae.it/api/explore/v2.1/catalog/datasets/dati_qualita_aria_er_giornaliero/'
           'exports/json')
ER_STATIONS_CSV = 'https://docs.google.com/spreadsheets/d/1-4wgZ8JeLeg0bODTSFUrshPY-_y9mERUu0FJtSFr78s/export?format=csv'

# TN: il feed non dà le coordinate e le 8 stazioni sono fisse: tabella (geocodifica OSM degli indirizzi
# ufficiali). Il codice stazione è lo slug del nome.
TN_URL = 'https://bollettino.appa.tn.it/aria/opendata/json/last/2,4,6,8,9,15,22,23'
TN_COORDS = {
    'Parco S. Chiara':  (46.0633, 11.1262), 'Via Bolzano':     (46.0957, 11.1130),
    'Rovereto':         (45.8905, 11.0398), 'Borgo Valsugana': (46.0518, 11.4555),
    'Riva del Garda':   (45.9043, 10.8421), 'Monte Gaza':      (46.1161, 11.0026),
    'Piana Rotaliana':  (46.1929, 11.1336), 'A22 (Avio)':      (45.7264, 10.9043),
}


def pollutant_symbol(name):
    """Nome del parametro ARPAE -> sigla comune, None se non è un inquinante che teniamo."""
    n = (name or '').upper()
    if 'PM10' in n: return 'PM10'
    if 'PM2.5' in n or 'PM25' in n: return 'PM25'
    if 'OZONO' in n or n.startswith('O3'): return 'O3'
    if 'BIOSSIDO DI AZOTO' in n or n.startswith('NO2'): return 'NO2'
    if 'BIOSSIDO DI ZOLFO' in n or n.startswith('SO2'): return 'SO2'
    if 'MONOSSIDO DI CARBONIO' in n or n.startswith('CO ') or n == 'CO': return 'CO'
    if 'BENZENE' in n or 'C6H6' in n: return 'C6H6'
    return None


def download_ven(debug=False):
    coords = {c['codseqst']: (comune.to_float(c['lat']), comune.to_float(c['lon']))
              for c in comune.get_json(VEN_BASE + 'coords.json')['coordinate']}
    names = {s['codseqst']: s.get('nome') for s in comune.get_json(VEN_BASE + 'stats.json')['stazioni']}
    data = comune.get_json(VEN_BASE + 'data.json')

    stations, readings = {}, {}
    for s in data['stazioni']:
        sc = s['codseqst']
        latlon = coords.get(sc)
        if not latlon or latlon[0] is None or latlon[1] is None:
            continue
        stations[sc] = {'NOME': names.get(sc) or sc, 'LAT': latlon[0], 'LON': latlon[1]}
        for blk in s.get('misurazioni', []):
            for poll_key, arr in blk.items():
                var = VEN_POLLMAP.get(poll_key)
                if var is None:
                    continue
                for e in arr:
                    val = comune.to_float(e.get('mis'))
                    try:
                        dt = datetime.datetime.strptime(e['data'], '%Y-%m-%d %H:%M:%S')
                    except (KeyError, ValueError):
                        continue
                    readings.setdefault(var, {}).setdefault(sc, []).append((comune.civil_to_solar(dt), val))
    return stations, readings, {}


def download_lom(debug=False, days=3):
    # istanti già in ora solare, memorizzati invariati; una query per giorno degli ultimi `days`
    sensors = {}
    for a in comune.get_json(LOM_ANAGRAFICA, {'$limit': '20000'}):
        var = LOM_TYPEMAP.get(a.get('nometiposensore'))
        if not var:
            continue
        lat, lon = comune.to_float(a.get('lat')), comune.to_float(a.get('lng'))
        if lat is None or lon is None or (abs(lat) < 0.001 and abs(lon) < 0.001):
            continue
        sensors[a.get('idsensore')] = {'var': var, 'sc': a.get('idstazione'), 'nome': a.get('nomestazione'),
                                       'lat': lat, 'lon': lon, 'um': a.get('unitamisura')}
    latest = comune.get_json(LOM_DATI, {'$select': 'data', '$order': 'data DESC', '$limit': '1'})
    end = (datetime.datetime.strptime(latest[0]['data'][:19], '%Y-%m-%dT%H:%M:%S')
           if latest else datetime.datetime.now())
    stations, readings, units = {}, {}, {}
    for k in range(days + 1):
        day = (end - datetime.timedelta(days=k)).strftime('%Y-%m-%d')
        where = "data >= '%sT00:00:00' AND data <= '%sT23:59:59' AND idoperatore='1'" % (day, day)
        for r in comune.get_json(LOM_DATI, {'$where': where, '$limit': '50000'}):
            s = sensors.get(r.get('idsensore'))
            if not s or r.get('stato') == 'NA':
                continue
            val = comune.to_float(r.get('valore'))
            if val is None or val == -9999:
                continue
            sc = s['sc']
            if sc is None:
                continue
            stations[sc] = {'NOME': s['nome'], 'LAT': s['lat'], 'LON': s['lon']}
            d = r['data']
            moment = d[0:4] + d[5:7] + d[8:10] + d[11:13] + d[14:16]
            readings.setdefault(s['var'], {}).setdefault(sc, []).append((moment, val))
            units[s['var']] = s['um'] or POLLUTANTS.get(s['var'])
    return stations, readings, units


def download_bz(debug=False, days=7):
    coords = {}
    for s in comune.get_json(BZ_ODH, {'where': 'sorigin.eq.APPABZ', 'limit': '500'}).get('data', []):
        c = s.get('scoordinate') or {}
        x, y = comune.to_float(c.get('x')), comune.to_float(c.get('y'))       # x = lon, y = lat
        if x and y and abs(x) > 0.001 and abs(y) > 0.001:
            coords[s.get('scode')] = {'lat': y, 'lon': x, 'nome': s.get('sname')}
    # le stazioni con sensori d'aria
    air_scodes = sorted({r.get('SCODE') for r in comune.get_json(BZ_AIRQUALITY + '/sensors')
                         if r.get('MCODE') in BZ_MCODEMAP and r.get('SCODE')})
    date_from = (comune.now_solar() - datetime.timedelta(days=days)).strftime('%Y%m%d')
    date_to = comune.now_solar().strftime('%Y%m%d')
    stations, readings, units = {}, {}, {}
    for sc in air_scodes:
        co = coords.get(sc)
        if not co:
            continue
        try:
            data = comune.get_json(BZ_AIRQUALITY + '/timeseries',
                                   {'station_code': sc, 'date_from': date_from, 'date_to': date_to})
        except Exception as e:
            print('WARN: [BZ] stazione %s saltata (%s)' % (sc, e))
            continue
        got = False
        for e in data:
            var = BZ_MCODEMAP.get(e.get('MCODE'))
            if not var:
                continue
            val = comune.to_float(e.get('VALUE'))
            if val is None or val < 0:                               # -1 = mancante
                continue
            try:
                dt = datetime.datetime.fromisoformat(e['DATE'])
            except (KeyError, ValueError):
                continue
            readings.setdefault(var, {}).setdefault(sc, []).append((comune.aware_to_solar(dt), val))
            units[var] = POLLUTANTS.get(var)
            got = True
        if got:
            stations[sc] = {'NOME': co['nome'] or sc, 'LAT': co['lat'], 'LON': co['lon']}
    return stations, readings, units


def _er_name(name):
    return ''.join(c for c in unicodedata.normalize('NFD', (name or '').upper()) if c.isalnum())


def download_er(debug=False, days=5):
    sta = {}
    for r in csv.DictReader(io.StringIO(comune.get_text(ER_STATIONS_CSV))):
        code = (r.get('Cod_staz') or '').replace('.', '')
        lat, lon = comune.to_float(r.get('LAT_GEO')), comune.to_float(r.get('LON_GEO'))
        if code and lat is not None and lon is not None:
            sta[_er_name(r.get('Stazione'))] = {'sc': code, 'nome': r.get('Stazione'), 'lat': lat, 'lon': lon}
    since = (comune.now_solar() - datetime.timedelta(days=days)).strftime('%Y-%m-%d')
    records = comune.get_json(ER_DATA, {
        'where': "reftime >= date'%s'" % since,
        'select': 'nome_stazione,nome_parametro,reftime,value'})
    stations, readings, units, missing = {}, {}, {}, set()
    for r in records:
        var = pollutant_symbol(r.get('nome_parametro'))
        val = comune.to_float(r.get('value'))
        if var is None or val is None or val < 0:
            continue
        st = sta.get(_er_name(r.get('nome_stazione')))
        if st is None:
            missing.add(r.get('nome_stazione'))
            continue
        try:
            utc = datetime.datetime.strptime((r.get('reftime') or '')[:19], '%Y-%m-%dT%H:%M:%S')
        except ValueError:
            continue
        stations[st['sc']] = {'NOME': st['nome'], 'LAT': st['lat'], 'LON': st['lon']}
        readings.setdefault(var, {}).setdefault(st['sc'], []).append((comune.utc_to_solar(utc), val))
        units.setdefault(var, POLLUTANTS.get(var))
    for name in sorted(n for n in missing if n):
        print('WARN: [ER] stazione non in anagrafica: %s' % name)
    return stations, readings, units


def download_tn(debug=False):
    d = comune.get_json(TN_URL)
    stations, readings, units = {}, {}, {}
    for s in d.get('stazione', []):
        name = s.get('nome')
        co = TN_COORDS.get(name)
        if not co:
            print('WARN: [TN] stazione senza coordinate: %s' % name)
            continue
        sc = comune.slug(name)
        stations[sc] = {'NOME': name, 'LAT': co[0], 'LON': co[1]}
        for day, hours in (s.get('dati') or {}).items():
            for hour, vals in hours.items():
                try:
                    # le ore 1..24 sono la fine dell'ora: la 24 è la mezzanotte del giorno dopo
                    dt = datetime.datetime.strptime(day, '%Y-%m-%d') + datetime.timedelta(hours=int(hour))
                except (ValueError, TypeError):
                    continue
                moment = comune.civil_to_solar(dt)
                for key, var in TN_POLLMAP.items():
                    v = comune.to_float(vals.get(key))
                    if v is None:
                        continue
                    readings.setdefault(var, {}).setdefault(sc, []).append((moment, v))
                    units.setdefault(var, POLLUTANTS.get(var))
    return stations, readings, units


NETWORKS = {'VEN': download_ven, 'LOM': download_lom, 'BZ': download_bz, 'ER': download_er, 'TN': download_tn}


def main():
    ap = argparse.ArgumentParser(description="Qualità dell'aria regionale (stazioni con coordinate).")
    ap.add_argument('-r', '--region', default='all', help='VEN/TN/BZ/LOM/ER/all')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print("\n=== ARIA (qualita' dell'aria) %s ===" % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    names = list(NETWORKS) if args.region.lower() == 'all' else [args.region.upper()]
    for name in names:
        if name not in NETWORKS:
            print('Rete aria non ancora disponibile: ' + name)
            continue
        print('\n=== ARIA ' + name + ' ===')
        try:
            stations, readings, units = NETWORKS[name](debug=args.debug)
            # l'unità di un inquinante senza unità dalla fonte è quella della tabella
            units = dict(POLLUTANTS, **units)
            comune.write_parsed('AQ_' + name, stations, readings, units, days=None)
        except Exception as e:
            print('[%s] ERRORE: %s' % (name, e))


if __name__ == '__main__':
    main()
