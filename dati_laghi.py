#!/usr/bin/env python3

# dati_laghi.py - LIVELLI DEI GRANDI LAGHI REGOLATI, come "regione" a se' (codice LAGHI).
#   Fonte: laghi.net (piattaforma degli Enti Regolatori dei Grandi Laghi, Hortus Srl) che aggrega
#   i consorzi di regolazione: Maggiore (Cons. Ticino), Como (Cons. Adda), Iseo (Cons. Oglio),
#   Idro, Garda (Cons. Mincio/AIPo). Tutti fisicamente dentro Lombardia/Veneto (+ Piemonte per il
#   Maggiore). Un solo endpoint per la mappa, poi la serie 3 giorni per sensore.
#
#   Accesso: e' un CMS a widget in ASP.NET -> serve prima una GET alla home per i cookie di sessione,
#   poi:
#     POST /MappaConSegnaposti/BootWidgetData  body: config=370
#       -> config.segnaposti[i] = marker (lat/lng)  +  data[i].tooltip_config = {titolo, series[]}
#          dove series[] = Livello/Afflusso/Deflusso/... con id_sensore + id_funzione.
#     POST /GraficoMultiserie/GetSerieData  body: idSensore, idFunzione, from, to
#       -> return_data[0] = lista di punti [ 'YYYY-MM-DD HH:MM'(CET), 'valore', flag, ... ]
#          (timestamp gia' in ORA SOLARE UTC+1, valore 'NaN' = dato assente).
#
# Sigle: LIVLAGO (livello lago), AFFLUSSO, DEFLUSSO. Livello normalizzato in METRI (i laghi in cm
# relativi allo zero -> /100; Idro e' gia' in m s.m.m. assoluti). Schema comune, timestamp ora solare.
#
# Uso:  python3 dati_laghi.py

import os, sys, json, argparse, datetime
import urllib.request, urllib.parse, http.cookiejar

_BASE_DIR = os.path.dirname(os.path.realpath(__file__))
BASE_URL  = 'https://laghi.net'
MAP_CONFIG = '370'

def now_solar():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=1)

# --- I/O robusto + atomico (come gli altri script) ---------------------------------------------------
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

def _slug(s):
    return ''.join(c if c.isalnum() else '_' for c in (s or '')).strip('_') or 'lago'

def to_float(v):
    try:
        f = float(v)
        return None if f != f else f          # scarta NaN
    except (TypeError, ValueError):
        return None

UM = {'LIVLAGO': 'm', 'AFFLUSSO': 'm³/s', 'DEFLUSSO': 'm³/s'}
# quali serie prendere (nome laghi.net -> sigla) e come scalare il valore
SERIE_MAP = {'Livello': 'LIVLAGO', 'Afflusso': 'AFFLUSSO', 'Deflusso': 'DEFLUSSO'}
# il livello di questi laghi e' in cm relativi allo zero -> lo porto in metri (/100).
# 'Lago d'Idro' pubblica gia' la quota in m s.m.m. -> nessuna scala.
LIVELLO_CM = {'Lago Maggiore', 'Lago di Como', "Lago d'Iseo", 'Lago di Garda'}

# i marker di laghi.net stanno sul punto di regolazione/incile (finiscono sulla terraferma) ->
# per la mappa uso il CENTRO GEOGRAFICO dello specchio d'acqua.
LAKE_CENTER = {
    'Lago Maggiore': (45.9300, 8.6000),
    'Lago di Como':  (46.0000, 9.2600),   # tratto centrale (Menaggio-Varenna), non il promontorio di Bellagio
    "Lago d'Iseo":   (45.7100, 10.0500),  # acqua a ovest di Monte Isola
    "Lago d'Idro":   (45.7900, 10.5100),
    'Lago di Garda': (45.6000, 10.6300),
}

#-----------------------------------------------------------------------------------------------------------
def _opener():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.addheaders = [('User-Agent', 'Mozilla/5.0 (meteo-laghi/1.0)')]
    return op

def _post(op, path, data, timeout=60):
    req = urllib.request.Request(BASE_URL + path, data=urllib.parse.urlencode(data).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest'})
    return json.loads(op.open(req, timeout=timeout).read().decode('utf-8', 'replace'))

def fetch_laghi(debug=False):
    op = _opener()
    op.open(BASE_URL + '/', timeout=60).read()                     # 1) cookie di sessione
    boot = _post(op, '/MappaConSegnaposti/BootWidgetData', {'config': MAP_CONFIG})   # 2) mappa
    segs = boot['config']['segnaposti']
    laghi = boot['data']
    fr = (now_solar() - datetime.timedelta(days=3)).strftime('%Y-%m-%d %H:%M')
    to = (now_solar() + datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M')

    stations = {}
    readings = {}      # sigla -> { scode -> [(istante, valore), ...] }
    for i, lk in enumerate(laghi):
        tc = lk.get('tooltip_config') or {}
        nome = tc.get('titolo')
        if not nome:
            continue
        seg = segs[i] if i < len(segs) else {}
        sc = _slug(nome)
        center = LAKE_CENTER.get(nome)          # centro del lago (i marker sorgente sono sul regolatore)
        lat = center[0] if center else seg.get('lat')
        lon = center[1] if center else seg.get('lng')
        stations[sc] = {'NOME': nome, 'LAT': lat, 'LON': lon}
        cm = nome in LIVELLO_CM
        for s in tc.get('series', []):
            sigla = SERIE_MAP.get(s.get('nome'))
            if not sigla:
                continue
            try:
                res = _post(op, '/GraficoMultiserie/GetSerieData',
                            {'idSensore': s['id_sensore'], 'idFunzione': s['id_funzione'], 'from': fr, 'to': to})
            except Exception as e:
                print('WARN: serie non letta (%s/%s): %s' % (nome, s.get('nome'), e)); continue
            if not res.get('success'):
                continue
            rd = res.get('return_data') or []
            # return_data[0][0] = lista dei punti [ts, valore, flag, ...]
            pts = (rd[0][0] if (rd and rd[0] and isinstance(rd[0][0], list)) else (rd[0] if rd else []))
            out = []
            for p in pts:
                if not isinstance(p, list) or len(p) < 2:
                    continue
                val = to_float(p[1])
                if val is None:
                    continue
                if sigla == 'LIVLAGO' and cm:
                    val = round(val / 100.0, 3)                     # cm -> m
                ist = str(p[0]).replace('-', '').replace(':', '').replace(' ', '')[:12]   # 'YYYYMMDDHHMM' (CET=solare)
                if len(ist) == 12 and ist.isdigit():
                    out.append((ist, val))
            if out:
                readings.setdefault(sigla, {})[sc] = out
                if debug:
                    print('  %-16s %-10s punti=%d ultimo=%s' % (nome, sigla, len(out), out[-1]))
    return stations, readings, UM

#-----------------------------------------------------------------------------------------------------------
# SCRITTORE COMUNE (merge ordinato + dedup per istante) - identico agli altri script
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
    print('[%s] laghi: %d | nuove letture inserite: %d' % (region_code, len(stations), added))
    return added

def main():
    ap = argparse.ArgumentParser(description='Livelli dei grandi laghi regolati (laghi.net).')
    ap.add_argument('-r', '--region', default='LAGHI', help='(compat)')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== LAGHI (laghi.net) ===')
    try:
        stations, readings, units = fetch_laghi(debug=args.debug)
        write_parsed('LAGHI', stations, readings, units)
    except Exception as e:
        print('[LAGHI] ERRORE: ' + str(e))

if __name__ == '__main__':
    main()
