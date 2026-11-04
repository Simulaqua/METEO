#!/usr/bin/env python3

# dati_consorzi.py - IDROMETRIA dei CONSORZI DI BONIFICA (portali telemetria pubblici), come "regione"
# a se' (codice CB_<sigla>). Ogni consorzio con API anonima pulita e stazioni geolocalizzate.
#
#   CB_AE = Consorzio di Bonifica Adige Euganeo (Padova). Backend Evomatic rest_v1 ANONIMO (no login):
#     GET https://info.adigeuganeo.com/rest_v1/idro-stazioni       -> [{id,name,lat,lng,lastValue,lastUpdate}]
#     GET https://info.adigeuganeo.com/rest_v1/idro-stazioni/<id>  -> {values:[{valueDate,value}, ...]} (10 min)
#   Livello idrometrico (m). Timestamp civili (ora locale IT) -> convertiti in ora solare.
#   NB: l'endpoint /pluviometri NON e' pioggia (idrovore/sostegni) -> escluso.
#   Alcuni idrometri (Adige/Bacchiglione) coincidono con ARPAV: doppioni accettati (come per AIPo).
#
# RITIRATO il 2026-10-23 (niente cron, niente export). Verifiche di quel giorno:
#   - tutte le 13 stazioni AE sono copie esatte di idrometri ARPAV gia' in VEN (stessi nomi,
#     coordinate e valori al millimetro);
#   - gli orari dell'API sono in ORA SOLARE come ARPAV, non civili: in estate civil_to_solar li
#     anticipava di un'ora (l'archivio CB_AE/ sul Pi ha quello spostamento);
#   - il 22/10 info.adigeuganeo.com e' passato a un altro server: l'API ora risponde su
#     https://piogge.adigeuganeo.it/rest_v1 (anche /pluviometri: 22 idrovore/sostegni, non valutati).
#
# Uso:  python3 dati_consorzi.py [-r AE|all]

import os, sys, json, argparse, datetime
import urllib.request

_BASE_DIR = os.path.dirname(os.path.realpath(__file__))

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

def http_json(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (meteo-consorzi/1.0)'})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode('utf-8', 'replace'))

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
def fetch_adige_euganeo(debug=False):
    BASE = 'https://info.adigeuganeo.com/rest_v1'
    stz = http_json(BASE + '/idro-stazioni')
    stations, readings, units = {}, {'LIVIDRO': {}}, {'LIVIDRO': 'm'}
    for s in stz:
        lat = to_float(s.get('lat')); lon = to_float(s.get('lng'))
        if lat is None or lon is None:
            continue
        sc = 'AE' + str(s.get('id'))
        try:
            det = http_json(BASE + '/idro-stazioni/' + str(s.get('id')))
        except Exception as e:
            print('WARN: dettaglio non letto (%s): %s' % (s.get('name'), e)); continue
        pts = []
        for v in (det.get('values') or []):
            val = to_float(v.get('value'))
            if val is None:
                continue
            try:
                dt = datetime.datetime.strptime(v.get('valueDate')[:16], '%Y-%m-%dT%H:%M')
            except (ValueError, TypeError):
                continue
            pts.append((civil_to_solar(dt), val))
        if pts:
            stations[sc] = {'NOME': s.get('name'), 'LAT': lat, 'LON': lon}
            readings['LIVIDRO'][sc] = pts
            if debug:
                print('  %-28s punti=%d ultimo=%s' % (s.get('name'), len(pts), pts[-1]))
    return stations, readings, units

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

FETCHERS = {'AE': ('CB_AE', fetch_adige_euganeo)}

def main():
    ap = argparse.ArgumentParser(description='Idrometria consorzi di bonifica (portali telemetria pubblici).')
    ap.add_argument('-r', '--region', default='all', help='AE/all')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    regions = list(FETCHERS) if args.region.lower() == 'all' else [args.region.upper()]
    for reg in regions:
        if reg not in FETCHERS:
            print('Consorzio non disponibile: ' + reg); continue
        code, fetcher = FETCHERS[reg]
        print('\n=== CONSORZIO ' + reg + ' ===')
        try:
            stations, readings, units = fetcher(debug=args.debug)
            write_parsed(code, stations, readings, units)
        except Exception as e:
            print('[%s] ERRORE: %s' % (reg, e))

if __name__ == '__main__':
    main()
