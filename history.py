#!/usr/bin/env python3

# history.py - STORICO LUNGO: aggregati GIORNALIERI di pioggia (PREC) e temperatura (TEMP) da tutto l'archivio.
#
# Perche': il sito mostra solo gli ultimi 7 giorni (finestra mobile). Qui si riassume ogni giorno dell'archivio
# in pochi numeri per stazione, cosi' lo storico occupa pochissimo (~20 MB/anno per tutta l'Italia del nord) e si
# pubblica una volta al giorno su un ramo GitHub a parte ('history'), senza toccare i 10 minuti del ramo 'data'.
#
# Aggregati per stazione e GIORNO SOLARE (l'archivio e' sempre in ora solare, UTC+1 fisso):
#   PREC: somma del giorno (mm), ore con dato (0-24)
#   TEMP: minima, massima, media (media delle medie orarie, robusta a cadenze diverse), ore con dato (0-24)
# "Ore con dato" e' l'indice di completezza (indipendente dalla cadenza 5/10/30/60 min): il sito marca come
# incompleti i giorni/mesi con poche ore. Tutto passa da quality.py (sentinelle, valori impossibili, zero-guasto).
#
# Sorgenti: l'archivio METEO di ogni regione (<regione>/data-parsed/, da luglio 2026) e, per il Veneto, anche il
# vecchio archivio ARPAV (sola lettura, dal 2022-05-06, stesso formato). Dove i due si sovrappongono vince il
# giorno con piu' ore di dato.
#
# Usa una CACHE (un file per regione con gli aggregati gia' calcolati): ogni notte si rielaborano solo i giorni
# nuovi + gli ultimi 3 (potrebbero ricevere dati in ritardo). Il primo giro (backfill) rilegge tutto l'archivio.
#
# Uscita: <out>/<REGIONE>/<STAZIONE>.json   {"v":1,"d0":"YYYYMMDD","p":[...],"hp":[...],"tn":[...],"tx":[...],
#         "tm":[...],"ht":[...]}  (un elemento per giorno da d0; null = nessun dato) + <out>/index.json.
#
# Uso:   python3 history.py [--out DIR] [--cache DIR] [--regions VEN,LOM] [--full] [--from YYYYMMDD]

import argparse
import datetime
import gzip
import json
import os
import re
import sys
import time

import quality

BASE = os.path.dirname(os.path.realpath(__file__))
OLD_VEN = '/home/manuel/dati/arpav/live/data-parsed'          # vecchio sistema ARPAV (sola lettura)
VARS = ('PREC', 'TEMP')
RECENT_DAYS = 3                                                # sempre rielaborati (arrivi in ritardo)
PREC_DAY_MAX = 1500.0                                          # oltre, la somma giornaliera e' un guasto
CACHE_V = 1

# chiave dei valori nel JSON dell'archivio ('VM' per il Veneto, 'VALORE' per le altre fonti)
def value_key(region):
    return 'VM' if region == 'VEN' else 'VALORE'

def sources_of(region):
    ''' Elenco (etichetta, cartella data-parsed) della regione, dal piu' vecchio al piu' recente. '''
    out = []
    if region == 'VEN' and os.path.isdir(OLD_VEN):
        out.append(('old', OLD_VEN))
    d = os.path.join(BASE, region, 'data-parsed')
    if os.path.isdir(d):
        out.append(('new', d))
    return out

def discover_regions():
    ''' Regioni-archivio con almeno una fonte che ha PREC o TEMP. '''
    regs = []
    for name in sorted(os.listdir(BASE)):
        if not re.match(r'^[A-Z][A-Z_]*$', name):
            continue
        if any(os.path.isdir(os.path.join(p, v)) for _, p in sources_of(name) for v in VARS):
            regs.append(name)
    return regs

#-----------------------------------------------------------------------------------------------------------
def list_days(parse_dir, var):
    ''' {YYYYMMDD: percorso} dei file giornalieri di una variabile (.json oppure .json.gz). '''
    d = os.path.join(parse_dir, var)
    out = {}
    if not os.path.isdir(d):
        return out
    for fn in os.listdir(d):
        m = re.match(r'^' + var + r'-(\d{8})\.json(\.gz)?$', fn)
        if m:
            day = m.group(1)
            if day not in out or not m.group(2):                # preferisci il .json (piu' recente) al .gz
                out[day] = os.path.join(d, fn)
    return out

def load_json(path):
    try:
        if path.endswith('.gz'):
            with gzip.open(path, 'rt', encoding='utf-8') as f:
                return json.load(f)
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError, EOFError):
        return None

#-----------------------------------------------------------------------------------------------------------
def aggregate_file(region, var, path, umid_path=None):
    ''' Aggrega un file giornaliero: {scode: {giorno: [somma|None, ore, tmin, tmax, tmedia]}} (per PREC solo i
        primi due campi). Un file puo' contenere istanti di piu' giorni: si raggruppa per data dell'ISTANTE. '''
    data = load_json(path)
    if not isinstance(data, dict):
        return {}
    vkey = value_key(region)
    out = {}
    zero_ts = {}                                                 # TEMP == 0.0 esatto: candidati a "zero-guasto"
    per = {}                                                     # scode -> giorno -> dati grezzi
    for scode, rec in data.items():
        misure = (rec or {}).get('MISURE') or {}
        ist = misure.get('ISTANTE') or []
        val = misure.get(vkey) or []
        for ts, v in zip(ist, val):
            if not ts or len(ts) < 10:
                continue
            x = quality.to_float(v)
            if not quality.valid(var, x):
                continue
            day, hour = ts[:8], ts[8:10]
            st = per.setdefault(scode, {}).setdefault(day, {})
            st[ts] = (hour, x)
            if var == 'TEMP' and x == 0.0:
                zero_ts.setdefault(scode, set()).add(ts)
    if zero_ts and umid_path:                                    # TEMP=0 con UMID=0 allo stesso istante = datalogger azzerato
        um = load_json(umid_path)
        if isinstance(um, dict):
            for scode, tss in zero_ts.items():
                mis = ((um.get(scode) or {}).get('MISURE')) or {}
                zeros = set(ts for ts, v in zip(mis.get('ISTANTE') or [], mis.get(vkey) or []) if quality.to_float(v) == 0.0)
                for ts in tss & zeros:
                    for day, st in per.get(scode, {}).items():
                        st.pop(ts, None)
    for scode, days in per.items():
        for day, st in days.items():
            if not st:
                continue
            hours = set(h for h, _ in st.values())
            if var == 'PREC':
                tot = sum(x for _, x in st.values())
                if tot > PREC_DAY_MAX:
                    continue
                out.setdefault(scode, {})[day] = [round(tot, 1), len(hours)]
            else:
                xs = [x for _, x in st.values()]
                byh = {}
                for h, x in st.values():
                    byh.setdefault(h, []).append(x)
                tm = sum(sum(v) / len(v) for v in byh.values()) / len(byh)
                out.setdefault(scode, {})[day] = [None, len(hours), round(min(xs), 1), round(max(xs), 1), round(tm, 1)]
    return out

def day_record(region, files, day):
    ''' Aggregati di un giorno da tutte le fonti: {scode: [psum, hp, tn, tx, tm, ht]}; per ogni variabile e stazione
        vince la fonte con piu' ore di dato (a parita', la piu' recente). files = [{var: {giorno: percorso}}, ...]. '''
    res = {}
    for fm in files:
        if day in fm['PREC']:
            for scode, dd in aggregate_file(region, 'PREC', fm['PREC'][day]).items():
                v = dd.get(day)
                if v:
                    r = res.setdefault(scode, [None, 0, None, None, None, 0])
                    if v[1] >= r[1]:
                        r[0], r[1] = v[0], v[1]
        if day in fm['TEMP']:
            for scode, dd in aggregate_file(region, 'TEMP', fm['TEMP'][day], fm['UMID'].get(day)).items():
                v = dd.get(day)
                if v:
                    r = res.setdefault(scode, [None, 0, None, None, None, 0])
                    if v[1] >= r[5]:
                        r[2], r[3], r[4], r[5] = v[2], v[3], v[4], v[1]
    return res

#-----------------------------------------------------------------------------------------------------------
def load_cache(path):
    d = load_json(path) if os.path.exists(path) else None
    if isinstance(d, dict) and d.get('v') == CACHE_V and isinstance(d.get('days'), dict):
        return d
    return {'v': CACHE_V, 'days': {}}

def save_atomic(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, separators=(',', ':'))
    os.replace(tmp, path)

def day_add(day, n):
    return (datetime.datetime.strptime(day, '%Y%m%d') + datetime.timedelta(days=n)).strftime('%Y%m%d')

def day_span(d0, d1):
    return (datetime.datetime.strptime(d1, '%Y%m%d') - datetime.datetime.strptime(d0, '%Y%m%d')).days + 1

#-----------------------------------------------------------------------------------------------------------
def process_region(region, out_dir, cache_dir, full=False, from_day=None, verbose=False):
    srcs = sources_of(region)
    files = [{v: list_days(p, v) for v in ('PREC', 'TEMP', 'UMID')} for _, p in srcs]     # elenco file, una volta sola
    all_days = set()
    for fm in files:
        for v in VARS:
            all_days.update(fm[v])
    if from_day:
        all_days = set(d for d in all_days if d >= from_day)
    if not all_days:
        return None
    cpath = os.path.join(cache_dir, region + '.json')
    cache = {'v': CACHE_V, 'days': {}} if full else load_cache(cpath)
    days = cache['days']
    today = datetime.datetime.utcnow() + datetime.timedelta(hours=1)           # giorno solare corrente
    recent_from = (today - datetime.timedelta(days=RECENT_DAYS)).strftime('%Y%m%d')
    todo = sorted(d for d in all_days if d not in days or d >= recent_from)
    t0 = time.time()
    for i, day in enumerate(todo):
        rec = day_record(region, files, day)
        if rec:
            days[day] = rec
        else:
            days.pop(day, None)
        if verbose and (i + 1) % 100 == 0:
            print('  %s: %d/%d giorni (%.0fs)' % (region, i + 1, len(todo), time.time() - t0))
    if todo:
        os.makedirs(cache_dir, exist_ok=True)
        save_atomic(cpath, cache)
    return days, len(todo)

def write_region(region, days, out_dir):
    ''' Scrive un file per stazione. Ritorna (n_stazioni, primo_giorno, ultimo_giorno). '''
    if not days:
        return 0, None, None
    d_first = min(days)
    d_last = max(days)
    # per stazione: giorni in cui compare
    st_days = {}
    for day, recs in days.items():
        for scode in recs:
            st_days.setdefault(scode, []).append(day)
    rdir = os.path.join(out_dir, region)
    os.makedirs(rdir, exist_ok=True)
    keep = set()
    for scode, dl in st_days.items():
        d0 = min(dl)
        n = day_span(d0, d_last)
        cols = {'p': [None] * n, 'hp': [None] * n, 'tn': [None] * n, 'tx': [None] * n, 'tm': [None] * n, 'ht': [None] * n}
        for day in dl:
            r = days[day][scode]
            k = day_span(d0, day) - 1
            if r[1]:
                cols['p'][k], cols['hp'][k] = r[0], r[1]
            if r[5]:
                cols['tn'][k], cols['tx'][k], cols['tm'][k], cols['ht'][k] = r[2], r[3], r[4], r[5]
        obj = {'v': 1, 'd0': d0}
        for key in ('p', 'hp', 'tn', 'tx', 'tm', 'ht'):
            if any(x is not None for x in cols[key]):
                obj[key] = cols[key]
        if len(obj) <= 2:
            continue
        fn = re.sub(r'[^A-Za-z0-9_.-]', '_', scode) + '.json'
        keep.add(fn)
        save_atomic(os.path.join(rdir, fn), obj)
    for fn in os.listdir(rdir):                                # via le stazioni sparite
        if fn.endswith('.json') and fn not in keep:
            os.remove(os.path.join(rdir, fn))
        elif fn.endswith('.tmp'):
            os.remove(os.path.join(rdir, fn))
    return len(keep), d_first, d_last

#-----------------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description='Aggregati giornalieri (pioggia, temperatura) per lo storico lungo.')
    ap.add_argument('--out', default=os.path.join(BASE, 'history_out'), help='cartella di uscita (ramo history)')
    ap.add_argument('--cache', default=os.path.join(BASE, 'history_cache'), help='cartella della cache')
    ap.add_argument('--regions', default='', help='elenco separato da virgole (default: tutte)')
    ap.add_argument('--full', action='store_true', help='ignora la cache e rielabora tutto')
    ap.add_argument('--from', dest='from_day', default=None, help='solo i giorni >= YYYYMMDD (prove)')
    ap.add_argument('-v', '--verbose', action='store_true')
    a = ap.parse_args()

    regions = [r for r in a.regions.split(',') if r] or discover_regions()
    os.makedirs(a.out, exist_ok=True)
    index = {'v': 1, 'updated': (datetime.datetime.utcnow() + datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M'), 'regions': {}}
    t0 = time.time()
    for region in regions:
        res = process_region(region, a.out, a.cache, a.full, a.from_day, a.verbose)
        if res is None:
            print('%-8s nessun dato PREC/TEMP' % region)
            continue
        days, n_new = res
        ns, d_first, d_last = write_region(region, days, a.out)
        print('%-8s %4d stazioni, giorni %s..%s (%d elaborati ora)' % (region, ns, d_first, d_last, n_new))
        if ns:
            index['regions'][region] = {'stations': ns, 'from': d_first, 'to': d_last}
    save_atomic(os.path.join(a.out, 'index.json'), index)
    print('Fatto in %.0fs -> %s' % (time.time() - t0, a.out))

if __name__ == '__main__':
    main()
