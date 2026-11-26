#!/usr/bin/env python3

# history.py - storico lungo: aggregati giornalieri di tutte le grandezze dell'archivio, per stazione.
# Occupano poco e si pubblicano una volta al giorno sul ramo 'history'.
#
# Aggregati per giorno solare (l'archivio e' in ora solare, UTC+1 fisso), secondo il tipo (kind_of):
#   'sum'  totale del giorno e ore con dato: pioggia (mm); soleggiamento e bagnatura in ore, dai secondi o
#          minuti delle fonti; radiazione come energia del giorno in MJ/m2 (da W/m2: media x 0.0864; da
#          kJ/m2: somma / 1000)
#   'dir'  direzione prevalente (il centro del piu' frequente degli 8 settori) e ore con dato
#   'band' minima, massima, media (delle medie orarie, robusta a cadenze diverse) e ore con dato: tutte le
#          altre. Livelli e portate restano come nell'archivio (relativi allo zero idrometrico): la quota
#          assoluta la mette il sito, come nei grafici.
# "Ore con dato" misura la completezza a prescindere dalla cadenza; il sito marca i giorni e i mesi con
# poche ore. Tutto passa da quality.py. Restano fuori i codici (PREC_TYPE): un codice non si media.
#
# Sorgenti: <regione>/data-parsed/ e, per il Veneto, anche l'archivio ARPAV di sola lettura (stesso
# formato, dal 2022). Dove si sovrappongono vince il giorno con piu' ore di dato.
# Per il Veneto ci sono anche i giornalieri ufficiali ARPAV dal 2010 (arpav_storico/, di arpav_storico.py),
# per l'Emilia-Romagna e il suo mare quelli dell'archivio ARPAE dal 2006 (er_storico/, di er_storico.py):
# dove ci sono valgono loro; il mese in corso viene sempre dall'archivio.
#
# Una cache per regione tiene gli aggregati gia' calcolati: ogni notte si rielaborano i giorni nuovi
# e gli ultimi 8 (possono ricevere dati in ritardo). Il primo giro rilegge tutto l'archivio.
#
# Uscita: <out>/<REGIONE>/<STAZIONE>/<VAR>.json = {"v":2, "d0":"AAAAMMGG", "k":tipo, "u":unita',
#         "n","x","m","h" (band) | "s","h" (sum) | "d","h" (dir)}: un elemento per giorno da d0, null = nessun
#         dato; <out>/<REGIONE>/vars.json = {stazione: [variabili]}; <out>/index.json.
#         Finche' la pagina legge anche la versione 1: <out>/<REGIONE>/<STAZIONE>.json con le chiavi di
#         OUT_KEYS (pioggia, temperatura, livelli, portate).
#
# Uso:   python3 history.py [--out DIR] [--cache DIR] [--regions VEN,LOM] [--full]

import argparse
import datetime
import glob
import os
import re
import shutil
import sys
import time

import comune
import quality

BASE = os.path.dirname(os.path.realpath(__file__))
OLD_VEN = '/home/manuel/dati/arpav/live/data-parsed'          # archivio ARPAV (sola lettura)
ARPAV_DIR = os.path.join(BASE, 'arpav_storico')               # giornalieri ARPAV dal 2010
ER_DIR = os.path.join(BASE, 'er_storico')                     # giornalieri dall'archivio ARPAE dal 2006
# versione 1: variabile -> chiavi nel file della stazione (somma e ore per la pioggia; minima, massima,
# media e ore per le altre)
OUT_KEYS = {'PREC': ('p', 'hp'), 'TEMP': ('tn', 'tx', 'tm', 'ht'), 'LIVIDRO': ('ln', 'lx', 'lm', 'hl'),
            'LIVLAGO': ('gn', 'gx', 'gm', 'hg'), 'PORTATA': ('qn', 'qx', 'qm', 'hq')}
V2_KEYS = {'band': ('n', 'x', 'm', 'h'), 'sum': ('s', 'h'), 'dir': ('d', 'h')}
DIR_VARS = frozenset(('DVENTO', 'DVENTOMAX', 'DVENTO2', 'DVENTOMAX2', 'DVENTOMAX1S', 'DVENTOVETT',
                      'DVENTOVETT2', 'ONDEDIR', 'CORRENTEDIR'))
SKIP_VARS = frozenset(('PREC_TYPE',))
DECIMALS = {'PREC': 1, 'TEMP': 1, 'PORTATA': 3, 'PRESS': 1, 'UMID': 1}
UNIT_NAMES = {'mc/s': 'm³/s', 'm3/s': 'm³/s', 'm^3/s': 'm³/s', 'W/m2': 'W/m²', 'W/mq': 'W/m²',
              'KJ/m^2': 'kJ/m²', 'kJ/m2': 'kJ/m²', 'MJ/m2': 'MJ/m²', 'gradi': '°', 'mq': 'm²'}
DURATIONS = {'s': 1 / 3600, 'min': 1 / 60, 'h': 1}
ENERGIES = {'J/m²': 1e-6, 'kJ/m²': 1e-3, 'MJ/m²': 1}
# Giorni sempre rielaborati: recover.py (18:40) ricuce fino a 7 giorni prima di quando gira, dopo lo
# Storico delle 07:20; fra due Storici il giorno piu' vecchio che puo' cambiare e' G-8.
RECENT_DAYS = 8
PREC_DAY_MAX = 1500.0                                          # oltre e' un guasto
CACHE_V = 3
VAR_RE = re.compile(r'^[A-Z][A-Z0-9_]*$')

def norm_unit(unit):
    u = str(unit or '').strip()
    return UNIT_NAMES.get(u, u)

def kind_of(var, unit):
    ''' (tipo, unita' dello storico, fattore, come): come = 'sum' somma, 'mean' media, 'dir', 'band'. '''
    u = norm_unit(unit)
    if var in DIR_VARS:
        return 'dir', '°', 1, 'dir'
    if var == 'PREC':
        return 'sum', 'mm', 1, 'sum'
    if var in ('RADSOL', 'RADRIFL') and u in ENERGIES:
        return 'sum', 'MJ/m²', ENERGIES[u], 'sum'
    if var in ('RADSOL', 'RADRIFL') and u == 'W/m²':
        return 'sum', 'MJ/m²', 0.0864, 'mean'
    if var in ('SOLEGG', 'BAGNATURA') and u in DURATIONS:
        return 'sum', 'h', DURATIONS[u], 'sum'
    return 'band', u, 1, 'band'

def record_unit(rec):
    ''' Unita' di una stazione in un file dell'archivio (il Veneto la tiene nel blocco SENSORE). '''
    u = rec.get('UM')
    if u is None:
        s = rec.get('SENSORE') or {}
        u = s.get('UNITNM') or s.get('UNITCODE')
    return u

def sources_of(region):
    ''' Elenco (etichetta, cartella data-parsed) della regione, dal piu' vecchio al piu' recente. '''
    out = []
    if region == 'VEN' and os.path.isdir(OLD_VEN):
        out.append(('old', OLD_VEN))
    d = os.path.join(BASE, region, 'data-parsed')
    if os.path.isdir(d):
        out.append(('new', d))
    return out

def source_vars(path):
    return sorted(v for v in os.listdir(path)
                  if VAR_RE.match(v) and v not in SKIP_VARS and os.path.isdir(os.path.join(path, v)))

def discover_regions():
    ''' Regioni-archivio con almeno una variabile in una delle fonti. '''
    return [name for name in sorted(os.listdir(BASE))
            if re.match(r'^[A-Z][A-Z_]*$', name) and any(source_vars(p) for _, p in sources_of(name))]

def prevailing(xs):
    ''' Centro del settore (8, da N) con piu' letture. '''
    counts = [0] * 8
    for x in xs:
        counts[int(((x % 360) + 22.5) // 45) % 8] += 1
    return counts.index(max(counts)) * 45

def aggregate_file(region, var, path, umid_path=None):
    ''' Aggrega un file giornaliero: ({scode: {giorno: aggregato}}, {scode: [tipo, unita']}); l'aggregato
        e' [totale, ore], [direzione, ore] o [minima, massima, media, ore]. Un file puo' avere istanti di
        piu' giorni: si raggruppa per l'istante. '''
    data = comune.load_json(path)
    if not isinstance(data, dict):
        return {}, {}
    vkey = comune.value_key(region)
    out, meta = {}, {}
    zero_ts = {}                                                 # TEMP == 0.0 esatto: guasto sospetto
    per = {}                                                     # scode -> giorno -> dati grezzi
    how = {}
    for scode, rec in data.items():
        rec = rec or {}
        kind, unit, factor, mode = kind_of(var, record_unit(rec))
        how[scode] = (factor, mode)
        meta[scode] = [kind, unit]
        misure = rec.get('MISURE') or {}
        for ts, v in zip(misure.get('ISTANTE') or [], misure.get(vkey) or []):
            if not ts or len(ts) < 10:
                continue
            x = comune.to_float(v)
            if not quality.valid(var, x):
                continue
            per.setdefault(scode, {}).setdefault(ts[:8], {})[ts] = (ts[8:10], x)
            if var == 'TEMP' and x == 0.0:
                zero_ts.setdefault(scode, set()).add(ts)
    if zero_ts and umid_path:                                    # TEMP=0 e UMID=0: logger azzerato
        um = comune.load_json(umid_path)
        if isinstance(um, dict):
            for scode, tss in zero_ts.items():
                mis = ((um.get(scode) or {}).get('MISURE')) or {}
                zeros = set(ts for ts, v in zip(mis.get('ISTANTE') or [], mis.get(vkey) or [])
                            if comune.to_float(v) == 0.0)
                for ts in tss & zeros:
                    for st in per.get(scode, {}).values():
                        st.pop(ts, None)
    for scode, days in per.items():
        factor, mode = how[scode]
        for day, st in days.items():
            agg = day_aggregate(var, mode, factor, st)
            if agg:
                out.setdefault(scode, {})[day] = agg
    return out, {s: meta[s] for s in out}

def day_aggregate(var, mode, factor, st):
    ''' Aggregato di un giorno; st = {istante: (ora, valore)}, mode e factor da kind_of. None se vuoto o
        con una pioggia impossibile. '''
    if not st:
        return None
    dec = DECIMALS.get(var, 2)
    hours = len(set(h for h, _ in st.values()))
    xs = [x for _, x in st.values()]
    if mode == 'sum':
        tot = sum(xs)
        if var == 'PREC' and tot > PREC_DAY_MAX:
            return None
        return [round(tot * factor, dec), hours]
    if mode == 'dir':
        return [prevailing(xs), hours]
    byh = {}
    for h, x in st.values():
        byh.setdefault(h, []).append(x)
    mean = sum(sum(v) / len(v) for v in byh.values()) / len(byh)
    if mode == 'mean':
        return [round(mean * factor, dec), hours]
    return [round(min(xs), dec), round(max(xs), dec), round(mean, dec), hours]

def aggregate_or_skip(region, var, path, umid_path=None):
    ''' aggregate_file di un file solo: se ha la forma sbagliata lo salta e lo dice. '''
    try:
        return aggregate_file(region, var, path, umid_path)
    except (TypeError, ValueError, KeyError, AttributeError) as e:
        print('WARN: file saltato (%s): %s' % (e, path), file=sys.stderr)
        return {}, {}

def day_record(region, files, day, meta):
    ''' Aggregati di un giorno da tutte le fonti: {scode: {variabile: aggregato}}; per ogni variabile e
        stazione vince la fonte con piu' ore di dato (a parita', la piu' recente); le ore sono l'ultimo
        campo dell'aggregato. files = [{var: {giorno: percorso}}, ...]; meta (tipo e unita' per stazione e
        variabile) si aggiorna. '''
    res = {}
    for fm in files:
        for var, by_day in fm.items():
            if day not in by_day:
                continue
            umid = fm.get('UMID', {}).get(day) if var == 'TEMP' else None
            aggs, units = aggregate_or_skip(region, var, by_day[day], umid)
            for scode, dd in aggs.items():
                v = dd.get(day)
                if not v:
                    continue
                rec = res.setdefault(scode, {})
                if var not in rec or v[-1] >= rec[var][-1]:
                    rec[var] = v
                    meta.setdefault(scode, {})[var] = units[scode]
    return res

def load_cache(path):
    d = comune.load_json(path)
    if isinstance(d, dict) and d.get('v') == CACHE_V and isinstance(d.get('days'), dict):
        d.setdefault('meta', {})
        return d
    return {'v': CACHE_V, 'days': {}, 'meta': {}}

def day_span(d0, d1):
    return ordinal(d1) - ordinal(d0) + 1

def ordinal(day):
    return datetime.date(int(day[:4]), int(day[4:6]), int(day[6:8])).toordinal()

def safe_name(scode):
    return re.sub(r'[^A-Za-z0-9_.-]', '_', scode)

def process_region(region, cache_dir, full=False, verbose=False, today=None):
    ''' Ritorna (giorni, quanti rielaborati, meta) o None; today = giorno solare corrente AAAAMMGG. '''
    srcs = sources_of(region)
    files = [{v: comune.day_files(os.path.join(p, v), v) for v in source_vars(p)} for _, p in srcs]
    all_days = set()
    for fm in files:
        for by_day in fm.values():
            all_days.update(by_day)
    if not all_days:
        return None
    cpath = os.path.join(cache_dir, region + '.json')
    cache = {'v': CACHE_V, 'days': {}, 'meta': {}} if full else load_cache(cpath)
    days, meta = cache['days'], cache['meta']
    if today is None:
        today = comune.now_solar().strftime('%Y%m%d')
    recent_from = (datetime.datetime.strptime(today, '%Y%m%d')
                   - datetime.timedelta(days=RECENT_DAYS)).strftime('%Y%m%d')
    todo = sorted(d for d in all_days if d not in days or d >= recent_from)
    t0 = time.time()
    for i, day in enumerate(todo):
        rec = day_record(region, files, day, meta)
        if rec:
            days[day] = rec
        else:
            days.pop(day, None)
        if verbose and (i + 1) % 100 == 0:
            print('  %s: %d/%d giorni (%.0fs)' % (region, i + 1, len(todo), time.time() - t0))
    if todo:
        comune.save_json(cache, cpath)
    return days, len(todo), meta

# ---- giornalieri ARPAV del Veneto dal 2010 ----
# cartella di arpav_storico.py -> (variabile dell'archivio, tipo, unita')
ARPAV_VARS = {'PREC': ('PREC', 'sum', 'mm'), 'TEMP': ('TEMP', 'band', '°C'), 'UMID': ('UMID', 'band', '%'),
              'RADSOL': ('RADSOL', 'sum', 'MJ/m²'), 'VVENTO': ('VVENTO', 'band', 'm/s'),
              'DVENTO': ('DVENTO', 'dir', '°'), 'RAFF': ('VVENTOMAX', 'band', 'm/s'),
              'PRESS': ('PRESS', 'band', 'hPa'), 'LIVIDRO': ('LIVIDRO', 'band', 'm'),
              'PORTATA': ('PORTATA', 'band', 'm³/s')}

def arpav_agg(var, kind, val):
    ''' Valore ARPAV di un giorno (var = variabile dell'archivio) -> aggregato come quelli dell'archivio,
        giorno completo (24 ore). Ce ne sono con un solo valore (velocita' media, raffica massima,
        umidita' minima e massima): gli altri campi restano vuoti. '''
    dec = DECIMALS.get(var, 2)
    if kind == 'dir':
        x = comune.to_float(val.get('GRADI') if isinstance(val, dict) else val)
        return [prevailing([x]), 24] if quality.valid(var, x) else None
    if not isinstance(val, dict):
        x = comune.to_float(val)
        if not quality.valid(var, x) or (var == 'PREC' and x > PREC_DAY_MAX):
            return None
        return [round(x, dec), 24] if kind == 'sum' else [None, None, round(x, dec), 24]
    xs = [comune.to_float(val.get(k)) for k in ('MINIMO', 'MASSIMO', 'MEDIO')]
    if all(x is None for x in xs) or any(x is not None and not quality.valid(var, x) for x in xs):
        return None
    return [None if x is None else round(x, dec) for x in xs] + [24]

def arpav_series(cache_dir, full=False):
    ''' Giornalieri ARPAV del Veneto per stazione: <cache>/VEN_arpav/<VAR>/<codice>.json =
        {"d0": "AAAAMMGG", "k": tipo, "u": unita', "a": [aggregato o null, un elemento per giorno]}, rifatti
        quando cambiano i file di arpav_storico/. Piu' sensori della stessa stazione in un anno: vale quello
        con piu' giorni. Ritorna la cartella, None se non ci sono dati ARPAV. '''
    files = {d: sorted(glob.glob(os.path.join(ARPAV_DIR, d, d + '-*.json.gz'))) for d in ARPAV_VARS}
    sig = {os.path.relpath(p, ARPAV_DIR): [int(os.path.getmtime(p)), os.path.getsize(p)]
           for paths in files.values() for p in paths}
    if not sig:
        return None
    out = os.path.join(cache_dir, 'VEN_arpav')
    mpath = os.path.join(out, 'manifest.json')
    if not full and comune.load_json(mpath) == sig:
        return out
    shutil.rmtree(out, ignore_errors=True)
    for src, paths in files.items():
        var, kind, unit = ARPAV_VARS[src]
        per = {}
        for path in paths:
            best = {}
            for s in (comune.load_json(path).get('stazioni') or {}).values():
                code, g = str(s.get('codice')), s.get('giorni') or {}
                if len(g) > len(best.get(code, {})):
                    best[code] = g
            for code, g in best.items():
                dd = per.setdefault(code, {})
                for day, val in g.items():
                    agg = arpav_agg(var, kind, val)
                    if agg:
                        dd[day.replace('-', '')] = agg
        vdir = os.path.join(out, var)
        os.makedirs(vdir, exist_ok=True)
        for code, dd in per.items():
            if not dd:
                continue
            d0 = min(dd)
            o0 = ordinal(d0)
            arr = [None] * (ordinal(max(dd)) - o0 + 1)
            for day, agg in dd.items():
                arr[ordinal(day) - o0] = agg
            comune.save_json({'d0': d0, 'k': kind, 'u': unit, 'a': arr},
                             os.path.join(vdir, safe_name(code) + '.json'))
    comune.save_json(sig, mpath)
    return out

def er_series(region, cache_dir, full=False):
    ''' Giornalieri dall'archivio ARPAE per stazione (ER e MAR_ER), nella forma di arpav_series:
        <cache>/<REGIONE>_er/<VAR>/<stazione>.json, rifatti quando cambiano i file di er_storico/. '''
    src = os.path.join(ER_DIR, region)
    files = sorted(glob.glob(os.path.join(src, '*', '*.json.gz')))
    sig = {os.path.relpath(p, src): [int(os.path.getmtime(p)), os.path.getsize(p)] for p in files}
    if not sig:
        return None
    out = os.path.join(cache_dir, region + '_er')
    mpath = os.path.join(out, 'manifest.json')
    if not full and comune.load_json(mpath) == sig:
        return out
    shutil.rmtree(out, ignore_errors=True)
    for var in sorted(os.listdir(src)):
        per = {}
        for path in sorted(glob.glob(os.path.join(src, var, var + '-*.json.gz'))):
            for sc, st in comune.load_json(path).items():
                e = per.setdefault(sc, [st['k'], st['u'], {}])
                if e[0] == st['k']:
                    e[2].update(st['giorni'])
        vdir = os.path.join(out, var)
        os.makedirs(vdir, exist_ok=True)
        for sc, (kind, unit, dd) in per.items():
            if not dd:
                continue
            d0 = min(dd)
            o0 = ordinal(d0)
            arr = [None] * (ordinal(max(dd)) - o0 + 1)
            for day, agg in dd.items():
                arr[ordinal(day) - o0] = agg
            comune.save_json({'d0': d0, 'k': kind, 'u': unit, 'a': arr},
                             os.path.join(vdir, safe_name(sc) + '.json'))
    comune.save_json(sig, mpath)
    return out

def daily_series(region, cache_dir, full=False):
    ''' Cartella dei giornalieri ufficiali per stazione della regione, None se non ne ha. '''
    if region == 'VEN':
        return arpav_series(cache_dir, full)
    if region in ('ER', 'MAR_ER'):
        return er_series(region, cache_dir, full)
    return None

# ---- uscita ----
def station_series(scode, dl, days, meta, daily):
    ''' {variabile: (d0, tipo, unita', {giorno: aggregato})} di una stazione: l'archivio, poi i giornalieri
        ufficiali (daily, da daily_series) dove ci sono. '''
    ser = {}
    for day in dl:
        for var, agg in days[day][scode].items():
            kind, unit = (meta.get(scode, {}).get(var) or kind_of(var, '')[:2])
            if len(agg) != len(V2_KEYS[kind]):                # tipo cambiato (unita' nuova): vale l'ultimo
                continue
            s = ser.setdefault(var, [kind, unit, {}])
            s[2][day] = agg
    if daily:
        fn = safe_name(scode) + '.json'
        for var in os.listdir(daily):
            path = os.path.join(daily, var, fn)
            e = comune.load_json(path) if os.path.isdir(os.path.join(daily, var)) else {}
            if not e.get('a'):
                continue
            s = ser.get(var)
            if s and s[0] != e['k']:
                continue
            s = ser.setdefault(var, [e['k'], e['u'], {}])
            o0 = ordinal(e['d0'])
            for i, agg in enumerate(e['a']):
                if agg:
                    s[2][datetime.date.fromordinal(o0 + i).strftime('%Y%m%d')] = agg
    return ser

def columns(d0, d_last, by_day, width):
    n = day_span(d0, d_last)
    cols = [[None] * n for _ in range(width)]
    o0 = ordinal(d0)
    for day, agg in by_day.items():
        k = ordinal(day) - o0
        if 0 <= k < n:
            for j, value in enumerate(agg):
                cols[j][k] = value
    return cols

def write_region(region, days, out_dir, daily=None, meta=None):
    ''' Scrive un file per stazione e variabile, vars.json e i file della versione 1; daily = cartella di
        daily_series: dove ci sono, valgono i giornalieri ufficiali. Ritorna (n_stazioni, primo_giorno,
        ultimo_giorno). '''
    meta = meta or {}
    rdir = os.path.join(out_dir, region)
    if not days:
        return 0, None, None
    d_last = max(days)
    st_days = {}
    for day, recs in days.items():
        for scode in recs:
            st_days.setdefault(scode, []).append(day)
    os.makedirs(rdir, exist_ok=True)
    index, firsts, keep = {}, [], {'vars.json'}
    for scode, dl in st_days.items():
        ser = {var: s for var, s in station_series(scode, dl, days, meta, daily).items() if s[2]}
        if not ser:
            continue
        name = safe_name(scode)
        sdir = os.path.join(rdir, name)
        os.makedirs(sdir, exist_ok=True)
        v1 = {}
        for var, (kind, unit, by_day) in sorted(ser.items()):
            d0 = min(by_day)
            cols = columns(d0, d_last, by_day, len(V2_KEYS[kind]))
            obj = {'v': 2, 'd0': d0, 'k': kind, 'u': unit}
            obj.update(zip(V2_KEYS[kind], cols))
            comune.save_json(obj, os.path.join(sdir, var + '.json'))
            firsts.append(d0)
            if var in OUT_KEYS and len(OUT_KEYS[var]) == len(cols):
                v1[var] = (d0, by_day)
        for fn in os.listdir(sdir):                            # via le variabili sparite
            if fn.endswith('.tmp') or (fn.endswith('.json') and fn[:-5] not in ser):
                os.remove(os.path.join(sdir, fn))
        index[name] = sorted(ser)
        if v1:
            d0 = min(d for d, _ in v1.values())
            obj = {'v': 1, 'd0': d0}
            for var, (_, by_day) in v1.items():
                obj.update(zip(OUT_KEYS[var], columns(d0, d_last, by_day, len(OUT_KEYS[var]))))
            comune.save_json(obj, os.path.join(rdir, name + '.json'))
            keep.add(name + '.json')
    for fn in os.listdir(rdir):                                # via le stazioni sparite
        p = os.path.join(rdir, fn)
        if os.path.isdir(p):
            if fn not in index:
                shutil.rmtree(p)
        elif fn not in keep:
            os.remove(p)
    comune.save_json(index, os.path.join(rdir, 'vars.json'), sort_keys=True)
    return len(index), min(firsts) if firsts else None, d_last

def main():
    ap = argparse.ArgumentParser(
        description='Aggregati giornalieri di tutte le grandezze per lo storico lungo.')
    ap.add_argument('--out', default=os.path.join(BASE, 'history_out'),
                    help='cartella di uscita (ramo history)')
    ap.add_argument('--cache', default=os.path.join(BASE, 'history_cache'), help='cartella della cache')
    ap.add_argument('--regions', default='', help='elenco separato da virgole (default: tutte)')
    ap.add_argument('--full', action='store_true', help='ignora la cache e rielabora tutto')
    ap.add_argument('-v', '--verbose', action='store_true')
    a = ap.parse_args()

    regions = [r for r in a.regions.split(',') if r] or discover_regions()
    os.makedirs(a.out, exist_ok=True)
    now = comune.now_solar()                                   # una volta: stesso giorno per tutte le regioni
    index = {'v': 1, 'updated': now.strftime('%Y-%m-%dT%H:%M'), 'regions': {}}
    t0 = time.time()
    for region in regions:
        res = process_region(region, a.cache, a.full, a.verbose, now.strftime('%Y%m%d'))
        if res is None:
            print('%-8s nessun dato' % region)
            continue
        days, n_new, meta = res
        daily = daily_series(region, a.cache, a.full)
        ns, d_first, d_last = write_region(region, days, a.out, daily, meta)
        print('%-8s %4d stazioni, giorni %s..%s (%d elaborati ora)' % (region, ns, d_first, d_last, n_new))
        if ns:
            index['regions'][region] = {'stations': ns, 'from': d_first, 'to': d_last}
    comune.save_json(index, os.path.join(a.out, 'index.json'))
    print('Fatto in %.0fs -> %s' % (time.time() - t0, a.out))

if __name__ == '__main__':
    main()
