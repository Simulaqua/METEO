#!/usr/bin/env python3

# recover.py - RIEMPIMENTO BUCHI (blackout / mancanza corrente) per tutte le regioni che espongono
# uno storico. Da lanciare @reboot (quando torna la corrente il Pi riparte) e poche volte al giorno.
#
# Come funziona:
#   1) per ogni regione, con un controllo LEGGERO sull'archivio locale (data-parsed) cerca BUCHI INTERNI
#      nella finestra recente (--days, default 7). Dopo un blackout lo snapshot riprende, quindi l'ultimo
#      dato e' recente e il buco e' "in mezzo": per questo NON si guarda l'ultimo timestamp ma la
#      continuita' della serie.
#   2) SOLO se trova un buco, scarica dalla FONTE lo storico della finestra e lo fonde nell'archivio
#      (merge ordinato con dedup: inserisce i punti mancanti anche se piu' vecchi dell'ultimo salvato).
#
# Capacita' per regione (verificata sulle fonti reali):
#   VEN  - dump giornaliero completo: si richiama lo script con -date <giorno> per ogni giorno bucato.
#   BZ   - endpoint /timeseries (serie a 10 min): una chiamata per coppia stazione-sensore.
#   ER   - endpoint get-time-series (serie ~ ultimi 2-3 giorni): una chiamata per stazione-variabile.
#   LOM  - Socrata storico: query a chunk temporali (<50000 righe/richiesta).
#   TN   - la fonte espone solo il giorno corrente: si auto-ricuce nel giorno, niente recupero multi-giorno.
#   FVG  - la fonte espone solo l'ultima osservazione oraria: NESSUNO storico, buchi non recuperabili.
#
# Uso:  python3 recover.py -r all                (tutte; salta dove non c'e' buco)
#       python3 recover.py -r LOM --days 2        (una regione, finestra 2 giorni)
#       python3 recover.py -r all --force         (ignora il gate: scarica comunque lo storico)

import os, sys, json, re, argparse, datetime, subprocess, importlib.util
import urllib.request, urllib.parse

_BASE_DIR = os.path.dirname(os.path.realpath(__file__))

# cadenza nominale (minuti) di ogni fonte: serve al gate per capire cos'e' un "buco"
CADENCE = {'VEN': 30, 'TN': 15, 'BZ': 10, 'FVG': 60, 'LOM': 10, 'ER': 15}

# quanto storico riesce davvero a servire ogni fonte (giorni): oltre, un buco e' irrecuperabile e
# NON deve triggerare fetch inutili. ER (get-time-series) tiene solo ~2-3 giorni; le altre di piu'.
SOURCE_MAX_DAYS = {'ER': 3}

REGION_FILE = {
    'VEN': 'dati_veneto.py',          'TN' : 'TN/dati_trentino.py',
    'BZ' : 'BZ/dati_altoadige.py',    'FVG': 'FVG/dati_fvg.py',
    'LOM': 'LOM/dati_lombardia.py',   'ER' : 'ER/dati_emilia_romagna.py',
}

#-----------------------------------------------------------------------------------------------------------
def load_module(region):
    ''' Importa lo script di una regione per riusarne costanti/variabili/helper (senza eseguirne il main). '''
    path = os.path.join(_BASE_DIR, REGION_FILE[region])
    spec = importlib.util.spec_from_file_location('reg_' + region, path)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def http_json(url, params=None, timeout=90):
    if params:
        url = url + ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': 'meteo-recover/1.0'})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode())

def jload(fn):
    with open(fn) as fp: return json.load(fp)

def jsave(obj, fn):
    with open(fn, 'w') as fp: json.dump(obj, fp, sort_keys=False, separators=(',',':'), ensure_ascii=False)

def now_solar():
    ''' Ora solare (CET, UTC+1 fisso), come i timestamp d'archivio. '''
    return datetime.datetime.utcnow() + datetime.timedelta(hours=1)

def var_list(mod):
    return [v for v in dir(mod.variables) if not v.startswith('__')]

#-----------------------------------------------------------------------------------------------------------
# GATE: cerca un buco interno nell'archivio recente (leggendo solo i file gia' presenti, niente rete)
#-----------------------------------------------------------------------------------------------------------
def collect_archive_istanti(parse_dir, variables, days):
    ''' Unione di tutti gli ISTANTE (YYYYMMDDHHMM) presenti nell'archivio nella finestra [ora-days, ora]. '''
    floor = (now_solar() - datetime.timedelta(days=days)).strftime('%Y%m%d%H%M')
    seen = set()
    for var in variables:
        vdir = os.path.join(parse_dir, var)
        if not os.path.isdir(vdir):
            continue
        for name in os.listdir(vdir):
            if not (name.startswith(var + '-') and name.endswith('.json')):
                continue
            day = name[len(var) + 1:-5]
            if day < floor[:8]:
                continue
            try:
                bin_day = jload(os.path.join(vdir, name))
            except Exception:
                continue
            for rec in bin_day.values():
                for ist in rec.get('MISURE', {}).get('ISTANTE', []):
                    if ist >= floor:
                        seen.add(ist)
    return sorted(seen)

def biggest_gap_minutes(istanti):
    ''' Massimo intervallo (minuti) tra istanti consecutivi dell'unione. '''
    if len(istanti) < 2:
        return None
    def to_dt(s):
        return datetime.datetime.strptime(s, '%Y%m%d%H%M')
    mx = 0
    for i in range(1, len(istanti)):
        d = (to_dt(istanti[i]) - to_dt(istanti[i - 1])).total_seconds() / 60.0
        mx = max(mx, d)
    return mx

def has_hole(parse_dir, variables, days, cadence_min):
    ''' True se l'unione degli istanti d'archivio ha un buco > 3x cadenza (indice di blackout).
        Conta anche il buco IN CODA (ultimo campione -> adesso): se il Pi resta spento e la raccolta
        non riparte, la serie finisce di colpo senza buchi interni e prima sfuggiva al controllo.
        Soglia coda piu' larga (>= 6 h) per non scattare sui ritardi fisiologici delle fonti. '''
    ist = collect_archive_istanti(parse_dir, variables, days)
    if not ist:
        return True, 'archivio vuoto nella finestra'
    gap = biggest_gap_minutes(ist)
    if gap is None:
        gap = 0.0
    tail = (now_solar() - datetime.datetime.strptime(max(ist), '%Y%m%d%H%M')).total_seconds() / 60.0
    if tail > max(6 * cadence_min, 360):
        return True, f'buco in coda {tail:.0f} min (ultimo campione vecchio)'
    if gap > 3 * cadence_min:
        return True, f'buco massimo {gap:.0f} min (> {3*cadence_min})'
    return False, f'continuo (buco max {gap:.0f} min)'

#-----------------------------------------------------------------------------------------------------------
# MERGE: fonde punti {var: {scode: [(istante, value)]}} nei file giornalieri, ordinato e dedup
#-----------------------------------------------------------------------------------------------------------
def flush_points(parse_dir, points, station_records, um_map, stazioni_path):
    ''' points[var][scode] = list[(istante, value)]. Inserisce i mancanti (merge sort+dedup). '''
    added = 0
    station_list = jload(stazioni_path) if os.path.exists(stazioni_path) else {}
    station_list.update({k: v for k, v in station_records.items() if k not in station_list})
    for var, per_scode in points.items():
        # raggruppa per giorno
        by_day = {}
        for scode, pts in per_scode.items():
            for ist, val in pts:
                if val is None:
                    continue
                by_day.setdefault(ist[:8], {}).setdefault(scode, []).append((ist, val))
        for day, per in by_day.items():
            fn = os.path.join(parse_dir, var, var + '-' + day + '.json')
            os.makedirs(os.path.dirname(fn), exist_ok=True)
            bin_day = jload(fn) if os.path.exists(fn) else {}
            for scode, pts in per.items():
                rec = bin_day.get(scode)
                if rec is None:
                    rec = {'STAZIONE': station_list.get(scode, {'SCODE': scode}),
                           'UM': um_map.get((var, scode)) or um_map.get(('*', scode)),
                           'MISURE': {'ISTANTE': [], 'VALORE': []}}
                    bin_day[scode] = rec
                m = rec['MISURE']
                merged = dict(zip(m['ISTANTE'], m['VALORE']))
                before = len(merged)
                for ist, val in pts:
                    if ist not in merged:
                        merged[ist] = val
                keys = sorted(merged.keys())
                m['ISTANTE'] = keys
                m['VALORE']  = [merged[k] for k in keys]
                added += len(merged) - before
            jsave(bin_day, fn)
    jsave(station_list, stazioni_path)
    return added

#-----------------------------------------------------------------------------------------------------------
# FONTI STORICHE PER REGIONE  ->  points, station_records, um_map
#-----------------------------------------------------------------------------------------------------------
def _bz_istante(date_string):
    ''' Bolzano '2026-07-11T00:00:00CEST' -> '202607110000' in ora solare (CEST->CET). Autonomo. '''
    try:
        s  = date_string.strip()
        tz = re.search(r'[A-Za-z]+$', s)
        clean = re.sub(r'[A-Za-z]+$', '', s)
        dt = datetime.datetime.strptime(clean, '%Y-%m-%dT%H:%M:%S')
        if tz and tz.group(0).upper() == 'CEST':
            dt -= datetime.timedelta(hours=1)
        return dt.strftime('%Y%m%d%H%M')
    except (ValueError, TypeError, AttributeError):
        return None

def _er_solar(ref_ms):
    ''' epoch ms UTC -> ora solare (UTC+1), arrotondato a 15 min, 'YYYYMMDDHHMM'. Autonomo. '''
    dt = datetime.datetime.utcfromtimestamp(ref_ms / 1000)
    dt = dt.replace(minute=(dt.minute // 15) * 15, second=0, microsecond=0) + datetime.timedelta(hours=1)
    return dt.strftime('%Y%m%d%H%M')

def fetch_bz(mod, days, debug=False):
    ''' Bolzano: /timeseries per ogni coppia (stazione, sensore) attiva. DATE (CET/CEST) -> istante solare. '''
    TS = 'https://geoservices.buergernetz.bz.it/services/meteo/v1/timeseries'
    normalize = getattr(mod, 'normalize_istante', _bz_istante)   # fallback autonomo
    d_to   = now_solar().strftime('%Y%m%d')
    d_from = (now_solar() - datetime.timedelta(days=days)).strftime('%Y%m%d')
    type2var = {getattr(mod.variables, v).type: v for v in var_list(mod)}
    sensors = http_json(mod.url_sensors)
    pairs, um_map = [], {}
    for r in sensors:
        sc, ty = r.get('SCODE'), r.get('TYPE')
        var = type2var.get(ty)
        if var and sc:
            pairs.append((sc, ty, var))
            um_map[(var, sc)] = r.get('UNIT')
    points = {}
    for i, (sc, ty, var) in enumerate(pairs):
        try:
            data = http_json(TS, {'station_code': sc, 'sensor_code': ty,
                                  'output_format': 'JSON', 'date_from': d_from, 'date_to': d_to}, timeout=60)
        except Exception as e:
            if debug: print(f'  BZ {sc}/{ty} skip: {e}')
            continue
        pts = []
        for e in data:
            ist = normalize(e.get('DATE'))
            if ist is not None:
                pts.append((ist, e.get('VALUE')))
        if pts:
            points.setdefault(var, {})[sc] = pts
        if debug and i % 100 == 0:
            print(f'  BZ {i}/{len(pairs)} coppie...')
    return points, {}, um_map

def fetch_er(mod, days, debug=False):
    ''' Emilia-Romagna: get-time-series per ogni stazione (dal registro) x variabile. t(ms UTC)->istante solare. '''
    solar = getattr(mod, 'solar_istante', _er_solar)             # fallback autonomo
    value_conv = getattr(mod, 'VALUE_CONV', {})
    stazioni_path = os.path.join(mod.directory.parse, 'stazioni.json')
    reg = jload(stazioni_path) if os.path.exists(stazioni_path) else {}
    floor = (now_solar() - datetime.timedelta(days=days)).strftime('%Y%m%d%H%M')
    points, um_map = {}, {}
    scodes = list(reg.keys())
    for i, sc in enumerate(scodes):
        for var in var_list(mod):
            desc = getattr(mod.variables, var).desc
            conv = value_conv.get(var)
            um_map[(var, sc)] = getattr(mod.variables, var).unit
            try:
                ts = http_json(mod.API + 'get-time-series',
                               {'stazione': sc, 'variabile': desc}, timeout=45)
            except Exception:
                continue
            pts = []
            for e in ts:
                if not (isinstance(e, dict) and 't' in e and e.get('v') is not None):
                    continue
                ist = solar(int(e['t']))
                if ist < floor:
                    continue
                val = e['v']
                if conv is not None:
                    try: val = conv(float(val))
                    except (TypeError, ValueError): continue
                pts.append((ist, val))
            if pts:
                points.setdefault(var, {})[sc] = pts
        if debug and i % 100 == 0:
            print(f'  ER {i}/{len(scodes)} stazioni...')
    return points, {}, um_map

def _coord_deg(value):
    ''' Coordinata WGS84 in gradi (float) oppure None se mancante o 0,0 (sentinella). Autonomo. '''
    try:
        v = float(value)
        return v if abs(v) > 0.001 else None
    except (TypeError, ValueError):
        return None

def _iso_to_istante(iso_string):
    ''' '2026-07-06T12:10:00.000' -> '202607061210'. Autonomo. None su errore. '''
    try:
        s = iso_string
        return s[0:4] + s[5:7] + s[8:10] + s[11:13] + s[14:16]
    except (TypeError, IndexError):
        return None

def fetch_lom(mod, days, debug=False):
    ''' Lombardia: Socrata storico a chunk di 4h (<50000 righe/richiesta). data e' gia' ora solare.
        Autonomo: non usa gli helper privati dello script (robusto anche con versioni piu' vecchie). '''
    pref_operator   = getattr(mod, 'pref_operator', {'PREC': '4'})
    SKIP_VALUES     = getattr(mod, 'SKIP_VALUES', {'-9999', '-9999.0'})
    SKIP_DIR_VALUES = getattr(mod, 'SKIP_DIR_VALUES', {'777', '7777', '888', '8888'})
    # anagrafica: idsensore -> (tipo, stazione, nome, coord, unit)
    anag = http_json(mod.url_anagrafica, {'$limit': '10000'})
    type2var = {getattr(mod.variables, v).tipo: v for v in var_list(mod)}
    sens = {}
    station_records = {}
    for a in anag:
        sens[a.get('idsensore')] = a
    # ANCORA la finestra all'ultimo timestamp del dataset (non all'orologio): il portale pubblica con
    # ritardo, quindi usare l'ora di sistema perderebbe i dati piu' recenti.
    latest = http_json(mod.url_dati, {'$select': 'data', '$order': 'data DESC', '$limit': '1'})
    if latest:
        now = datetime.datetime.strptime(latest[0]['data'][:19], '%Y-%m-%dT%H:%M:%S')
    else:
        now = now_solar().replace(microsecond=0)
    start = now - datetime.timedelta(days=days)
    points, um_map = {}, {}
    chunk = datetime.timedelta(hours=4)
    t0 = start
    n_chunk = 0
    while t0 < now:
        t1 = min(t0 + chunk, now)
        where = "data > '%s' AND data <= '%s'" % (t0.strftime('%Y-%m-%dT%H:%M:%S'),
                                                  t1.strftime('%Y-%m-%dT%H:%M:%S'))
        try:
            rows = http_json(mod.url_dati, {'$where': where, '$order': 'data', '$limit': '50000'})
        except Exception as e:
            if debug: print(f'  LOM chunk {where} skip: {e}')
            t0 = t1; continue
        for r in rows:
            a = sens.get(r.get('idsensore'))
            if not a: continue
            var = type2var.get(a.get('tipologia'))
            if var is None: continue
            if r.get('idoperatore') != pref_operator.get(var, '1'): continue
            val = r.get('valore')
            if val is None or val in SKIP_VALUES: continue
            if var == 'DVENTO' and val in SKIP_DIR_VALUES: continue
            ist = _iso_to_istante(r.get('data'))
            if ist is None: continue
            sc = a.get('idstazione')
            if sc is None: continue
            if sc not in station_records:
                station_records[sc] = {'SCODE': sc, 'NOME': a.get('nomestazione'),
                                       'LAT': _coord_deg(a.get('lat')), 'LON': _coord_deg(a.get('lng')),
                                       'QUOTA': a.get('quota'), 'PROVINCIA': a.get('provincia')}
            um_map[(var, sc)] = a.get('unit_dimisura')
            points.setdefault(var, {}).setdefault(sc, []).append((ist, val))
        n_chunk += 1
        if debug: print(f'  LOM chunk {t0:%m-%d %H:%M}->{t1:%H:%M}: {len(rows)} righe')
        t0 = t1
    return points, station_records, um_map

#-----------------------------------------------------------------------------------------------------------
def recover_snapshot_region(region, mod, fetcher, days, force, debug):
    ''' Regioni a snapshot (BZ/ER/LOM): gate sul buco, poi fetch storico + merge. '''
    variables = var_list(mod)
    parse_dir = mod.directory.parse
    eff_days = min(days, SOURCE_MAX_DAYS.get(region, days))   # limita alla profondita' servibile dalla fonte
    hole, why = has_hole(parse_dir, variables, eff_days, CADENCE[region])
    print(f'[{region}] gate ({eff_days}gg): {why}')
    if not hole and not force:
        print(f'[{region}] nessun buco: salto (usa --force per scaricare comunque).')
        return
    print(f'[{region}] scarico lo storico ({eff_days} giorni) dalla fonte...')
    points, station_records, um_map = fetcher(mod, eff_days, debug=debug)
    n_pts = sum(len(v) for per in points.values() for v in per.values())
    stazioni_path = os.path.join(parse_dir, 'stazioni.json')
    added = flush_points(parse_dir, points, station_records, um_map, stazioni_path)
    print(f'[{region}] punti recuperati e inseriti: {added}  (scaricati {n_pts})')

def recover_ven(region, days, force, debug):
    ''' Veneto: dump giornaliero completo -> richiama lo script con -date per ogni giorno della finestra. '''
    mod = load_module('VEN')
    variables = list(mod.VARIABLES)
    hole, why = has_hole(mod.PARSE_DIR, variables, days, CADENCE['VEN'])
    print(f'[VEN] gate: {why}')
    if not hole and not force:
        print('[VEN] nessun buco: salto.')
        return
    script = os.path.join(_BASE_DIR, REGION_FILE['VEN'])
    today = now_solar().date()
    for k in range(1, days + 1):                       # da ieri all'indietro (oggi lo fa il run normale)
        d = today - datetime.timedelta(days=k)
        print(f'[VEN] recupero giorno {d} ...')
        subprocess.run([sys.executable, script, '-date', str(d.year), str(d.month), str(d.day),
                        '-c', 'no'], check=False)

#-----------------------------------------------------------------------------------------------------------
# LAYER AGGIUNTIVI (aria AQ_*, idrometria PC_*): i loro fetcher scaricano gia' una finestra multi-giorno,
# quindi per ricucire un buco basta RI-ESEGUIRE il fetcher. code -> (script, argomento -r, cadenza min).
# (PC_FVG e' a snapshot: ri-eseguirlo non fa vero backfill, ma riprende subito la serie.)
EXTRA = {
    'AQ_VEN': ('dati_aria.py', 'VEN', 60), 'AQ_LOM': ('dati_aria.py', 'LOM', 60),
    'AQ_BZ':  ('dati_aria.py', 'BZ', 60),  'AQ_TN':  ('dati_aria.py', 'TN', 60),
    'AQ_ER':  ('dati_aria.py', 'ER', 60),
    'PC_TN':  ('dati_pc.py', 'TN', 60),     'PC_FVG': ('dati_pc.py', 'FVG', 30),
}

def recover_windowed(code, script, regarg, cadence, days, force, debug):
    ''' Aria/PC: gate sul buco interno; se c'e', ri-esegue il fetcher a finestra (che ricuce da solo). '''
    parse_dir = os.path.join(_BASE_DIR, code, 'data-parsed')
    if not os.path.isdir(parse_dir):
        print(f'[{code}] nessun archivio: salto.')
        return
    variables = [d for d in os.listdir(parse_dir) if os.path.isdir(os.path.join(parse_dir, d))]
    hole, why = has_hole(parse_dir, variables, days, cadence)
    print(f'[{code}] gate: {why}')
    if not hole and not force:
        print(f'[{code}] nessun buco: salto.')
        return
    print(f'[{code}] ri-eseguo {script} -r {regarg} per ricucire...')
    subprocess.run([sys.executable, os.path.join(_BASE_DIR, script), '-r', regarg], check=False)

#-----------------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description='Riempimento buchi (blackout) dallo storico delle fonti.')
    ap.add_argument('-r', '--region', default='all', help='all/VEN/BZ/ER/LOM/AQ_*/PC_*')
    ap.add_argument('--days', type=int, default=7, help='profondita\' massima del recupero (giorni)')
    ap.add_argument('--force', action='store_true', help='ignora il gate e scarica comunque')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()

    SNAP = {'BZ': fetch_bz, 'ER': fetch_er, 'LOM': fetch_lom}
    if args.region.lower() == 'all':
        order = ['VEN', 'BZ', 'ER', 'LOM'] + list(EXTRA)
    else:
        order = [args.region.upper() if not args.region.startswith(('AQ_', 'PC_')) else args.region]

    for region in order:
        print('\n' + '=' * 70 + f'\n{region}\n' + '=' * 70)
        try:
            if region in EXTRA:
                script, regarg, cadence = EXTRA[region]
                recover_windowed(region, script, regarg, cadence, args.days, args.force, args.debug)
            elif region == 'VEN':
                recover_ven(region, args.days, args.force, args.debug)
            elif region in SNAP:
                recover_snapshot_region(region, load_module(region), SNAP[region],
                                        args.days, args.force, args.debug)
            elif region in ('TN', 'FVG'):
                print(f'[{region}] la fonte non espone storico multi-giorno: nessun recupero possibile.')
            else:
                print('Regione sconosciuta: ' + region)
        except Exception as e:
            print(f'[{region}] ERRORE: {e}')

if __name__ == '__main__':
    main()
