#!/usr/bin/env python3

# dati_invasi.py - INVASI ARTIFICIALI (dighe) con API pubblica anonima, come "regione" a se'
# (codice INV_<sigla>).
#
#   INV_ER = Romagna Acque - Societa' delle Fonti (Forli'-Cesena / Rimini). Endpoint JSON anonimo del
#     widget "acqua in diretta":  GET https://www.romagnacque.it/datidiretta/index2.php
#     -> livelloInvaso/volumeInvaso/apporto/deflusso/temperaturaAcqua (diga di RIDRACOLI, timestamp
#        esplicito direttaDt+direttaOra in ora civile IT, aggiornamento ~30-60 min) + concaDati
#        (traversa del CONCA: livello/volume/apporto/portataus, senza timestamp proprio -> usa quello
#        generale). Trovato ispezionando il widget WordPress della pagina /acqua-in-diretta/ (2026-08).
#   Livelli in m (Ridracoli = quota assoluta s.l.m.), volumi convertiti in Mm3 (milioni di m3).
#   Coordinate fisse (ancoraggio alle dighe). Una lettura per run; il merge per ISTANTE evita doppioni.
#
# Uso:  python3 dati_invasi.py [-r ER|all]

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
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (meteo-invasi/1.0)'})
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
def fetch_romagna_acque(debug=False):
    d = http_json('https://www.romagnacque.it/datidiretta/index2.php')
    try:
        dt = datetime.datetime.strptime(str(d.get('direttaDt')) + ' ' + str(d.get('direttaOra')),
                                        '%d/%m/%Y %H:%M')
    except (ValueError, TypeError):
        raise RuntimeError('timestamp direttaDt/direttaOra assente o illeggibile')
    ist = civil_to_solar(dt)
    stations, readings, units = {}, {}, {}
    def put(sc, var, um, val):
        v = to_float(val)
        if v is None:
            return
        readings.setdefault(var, {}).setdefault(sc, []).append((ist, round(v, 3)))
        units[var] = um
    # Diga di Ridracoli (Bagno di Romagna, FC) - livello = quota assoluta s.l.m.
    stations['RIDRACOLI'] = {'NOME': 'Diga di Ridracoli', 'LAT': 43.9711, 'LON': 11.8261}
    put('RIDRACOLI', 'LIVLAGO',   'm',    d.get('livelloInvaso'))
    vol = to_float(d.get('volumeInvaso'))
    put('RIDRACOLI', 'VOLINVASO', 'Mm³',  vol / 1e6 if vol is not None else None)
    put('RIDRACOLI', 'AFFLUSSO',  'm³/s', d.get('apporto'))
    put('RIDRACOLI', 'DEFLUSSO',  'm³/s', d.get('deflusso'))
    put('RIDRACOLI', 'TEMPACQUA', '°C',   d.get('temperaturaAcqua'))
    # Traversa del Conca (San Giovanni in Marignano / Misano, RN) - coordinate approssimative
    c = d.get('concaDati') or {}
    if c:
        stations['CONCA'] = {'NOME': 'Invaso del Conca', 'LAT': 43.9400, 'LON': 12.6720}
        put('CONCA', 'LIVLAGO',   'm',    c.get('livello'))
        vc = to_float(c.get('volume'))
        put('CONCA', 'VOLINVASO', 'Mm³',  vc / 1e6 if vc is not None else None)
        put('CONCA', 'AFFLUSSO',  'm³/s', c.get('apporto'))
        put('CONCA', 'DEFLUSSO',  'm³/s', c.get('portataus'))
    have = {sc for per in readings.values() for sc in per}
    stations = {sc: m for sc, m in stations.items() if sc in have}
    if debug:
        for var, per in sorted(readings.items()):
            for sc, pts in per.items():
                print('  %-10s %-9s %s' % (sc, var, pts[-1]))
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

FETCHERS = {'ER': ('INV_ER', fetch_romagna_acque)}

def main():
    ap = argparse.ArgumentParser(description='Invasi artificiali (dighe) con API pubblica anonima.')
    ap.add_argument('-r', '--region', default='all', help='ER/all')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    regions = list(FETCHERS) if args.region.lower() == 'all' else [args.region.upper()]
    for reg in regions:
        if reg not in FETCHERS:
            print('Gestore invasi non disponibile: ' + reg); continue
        code, fetcher = FETCHERS[reg]
        print('\n=== INVASI ' + reg + ' ===')
        try:
            stations, readings, units = fetcher(debug=args.debug)
            write_parsed(code, stations, readings, units)
        except Exception as e:
            print('[%s] ERRORE: %s' % (reg, e))

if __name__ == '__main__':
    main()
