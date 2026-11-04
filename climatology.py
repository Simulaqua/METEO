#!/usr/bin/env python3

# climatology.py - STATISTICHE E INDICI CLIMATICI dall'ARCHIVIO COMPLETO (data-parsed, tenuto per
# sempre). NON archivia nuove serie: produce un RIASSUNTO COMPATTO per stazione ->
# site/<REGIONE>/climate.json. Pesante in CPU (legge tutto l'archivio, anche .gz) ma output minuscolo:
# va lanciato una volta al giorno, non a ogni run. Disk-safe (dimensione ~costante).
#
# Per ogni stazione (dove c'e' TEMP e/o PREC): periodo di record, climatologia mensile (Tmin/Tmax/
# Tmedia medie pluriennali + pioggia mensile media), record assoluti (Tmax/Tmin/pioggia giornaliera),
# e conteggi medi annui di indici ETCCDI (giorni di gelo, estivi, notti tropicali, giorni caldi,
# giorni di ghiaccio, giorni piovosi).
#
# Uso:  python3 climatology.py -r all | -r VEN   [--site-dir site]

import os, sys, json, glob, gzip, argparse, datetime
import quality                      # sentinelle (-999...) e valori impossibili: scartati in lettura

_BASE_DIR = os.path.dirname(os.path.realpath(__file__))

def _f(v):
    try:
        x = float(v); return None if x != x else x
    except (TypeError, ValueError):
        return None

def jload(fn):
    try:
        op = gzip.open if fn.endswith('.gz') else open
        with op(fn, 'rt', encoding='utf-8') as fp:
            text = fp.read()
        return json.loads(text) if text.strip() else {}
    except (ValueError, OSError):
        return {}

# ---- accumulo STREAMING per stazione/giorno (mai tutti i valori in RAM: solo min/max/somma/conteggio) ----
def _scan_temp(parse_dir):
    ''' {scode: {'YYYYMMDD': [tmin, tmax, tsum, tcnt]}} leggendo TEMP file per file. '''
    vdir = os.path.join(parse_dir, 'TEMP'); agg = {}
    if not os.path.isdir(vdir):
        return agg
    for fn in sorted(glob.glob(os.path.join(vdir, 'TEMP-*.json')) +
                     glob.glob(os.path.join(vdir, 'TEMP-*.json.gz'))):
        content = jload(fn)
        for sc, rec in content.items():
            m = rec.get('MISURE', {})
            per = agg.setdefault(sc, {})
            for ist, v in zip(m.get('ISTANTE', []), m.get('VALORE', m.get('VM', []))):
                fv = _f(v)
                if fv is None or not quality.valid('TEMP', fv):
                    continue
                day = str(ist)[:8]; a = per.get(day)
                if a is None:
                    per[day] = [fv, fv, fv, 1]
                else:
                    if fv < a[0]: a[0] = fv
                    if fv > a[1]: a[1] = fv
                    a[2] += fv; a[3] += 1
    return agg

def _scan_prec(parse_dir):
    ''' {scode: {'YYYYMMDD': somma pioggia}} leggendo PREC file per file. '''
    vdir = os.path.join(parse_dir, 'PREC'); agg = {}
    if not os.path.isdir(vdir):
        return agg
    for fn in sorted(glob.glob(os.path.join(vdir, 'PREC-*.json')) +
                     glob.glob(os.path.join(vdir, 'PREC-*.json.gz'))):
        content = jload(fn)
        for sc, rec in content.items():
            m = rec.get('MISURE', {})
            per = agg.setdefault(sc, {})
            for ist, v in zip(m.get('ISTANTE', []), m.get('VALORE', m.get('VM', []))):
                fv = _f(v)
                if fv is not None and quality.valid('PREC', fv):
                    day = str(ist)[:8]; per[day] = per.get(day, 0.0) + fv
    return agg

def _month_mean(d):
    return round(sum(d) / len(d), 2) if d else None

def climate_region(region, parse_dir, out_dir):
    tday = _scan_temp(parse_dir)                  # {scode: {day: [tmin,tmax,tsum,tcnt]}}
    pday = _scan_prec(parse_dir)                  # {scode: {day: somma pioggia}}
    staz = jload(os.path.join(parse_dir, 'stazioni.json'))
    scodes = set(tday) | set(pday)
    result = {}
    for sc in scodes:
        meta = stax = staz.get(sc, {})
        tdays = tday.get(sc, {})                  # day -> [tmin,tmax,tsum,tcnt]
        pdays = pday.get(sc, {})                  # day -> somma
        # aggregati giornalieri
        dstats = {}                               # day -> (tmin,tmax,tmean)
        for day, a in tdays.items():
            if a[3] >= 6:                         # servono abbastanza letture per un giorno valido
                dstats[day] = (a[0], a[1], a[2] / a[3])
        drain = {day: round(s, 1) for day, s in pdays.items()}          # pioggia giornaliera (mm)
        if not dstats and not drain:
            continue
        alldays = sorted(set(dstats) | set(drain))
        entry = {'nome': stax.get('NOME'), 'lat': _f(stax.get('LAT')), 'lon': _f(stax.get('LON')),
                 'period': {'from': alldays[0], 'to': alldays[-1], 'days': len(alldays)}}
        # --- climatologia mensile (media pluriennale) ---
        mon = {}                                  # '01'..'12' -> {tmin:[],tmax:[],tmean:[], prain: {anno: tot}}
        for day, (tn, tx, tm) in dstats.items():
            mm = day[4:6]; mon.setdefault(mm, {'tmin': [], 'tmax': [], 'tmean': [], 'prain': {}})
            mon[mm]['tmin'].append(tn); mon[mm]['tmax'].append(tx); mon[mm]['tmean'].append(tm)
        for day, r in drain.items():
            mm = day[4:6]; yy = day[0:4]
            mon.setdefault(mm, {'tmin': [], 'tmax': [], 'tmean': [], 'prain': {}})
            mon[mm]['prain'][yy] = mon[mm]['prain'].get(yy, 0.0) + r
        monthly = {}
        for mm, d in mon.items():
            tots = list(d['prain'].values())
            monthly[mm] = {'tmin': _month_mean(d['tmin']), 'tmax': _month_mean(d['tmax']),
                           'tmean': _month_mean(d['tmean']),
                           'prec': round(sum(tots) / len(tots), 1) if tots else None}
        if monthly:
            entry['monthly'] = monthly
        # --- record assoluti ---
        rec = {}
        if dstats:
            dmax = max(dstats.items(), key=lambda kv: kv[1][1])
            dmin = min(dstats.items(), key=lambda kv: kv[1][0])
            rec['tmax'] = {'val': round(dmax[1][1], 1), 'date': dmax[0]}
            rec['tmin'] = {'val': round(dmin[1][0], 1), 'date': dmin[0]}
        if drain:
            pmax = max(drain.items(), key=lambda kv: kv[1])
            rec['prec_day'] = {'val': round(pmax[1], 1), 'date': pmax[0]}
        if rec:
            entry['records'] = rec
        # --- indici ETCCDI: conteggi medi ANNUI (normalizzati per numero di anni con dati) ---
        years = set(d[0:4] for d in dstats)
        ny = max(1, len(years))
        frost = sum(1 for (tn, tx, tm) in dstats.values() if tn < 0)      # gelo (Tmin<0)
        ice   = sum(1 for (tn, tx, tm) in dstats.values() if tx < 0)      # ghiaccio (Tmax<0)
        summer = sum(1 for (tn, tx, tm) in dstats.values() if tx > 25)    # estivi (Tmax>25)
        hot    = sum(1 for (tn, tx, tm) in dstats.values() if tx > 30)    # caldi (Tmax>30)
        tropn  = sum(1 for (tn, tx, tm) in dstats.values() if tn > 20)    # notti tropicali (Tmin>20)
        wet    = sum(1 for r in drain.values() if r >= 1.0)               # giorni piovosi (>=1mm)
        yr_p = max(1, len(set(d[0:4] for d in drain)))
        idx = {}
        if dstats:
            idx.update({'frost_days': round(frost / ny, 1), 'ice_days': round(ice / ny, 1),
                        'summer_days': round(summer / ny, 1), 'hot_days': round(hot / ny, 1),
                        'tropical_nights': round(tropn / ny, 1)})
        if drain:
            idx['rainy_days'] = round(wet / yr_p, 1)
        if idx:
            entry['indices'] = idx
        result[sc] = entry
    if result:
        os.makedirs(out_dir, exist_ok=True)
        tmp = os.path.join(out_dir, 'climate.json') + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as fp:
            json.dump(result, fp, ensure_ascii=False, separators=(',', ':'))
            fp.flush(); os.fsync(fp.fileno())
        os.replace(tmp, os.path.join(out_dir, 'climate.json'))
    print('[%s] climatologia: %d stazioni' % (region, len(result)))
    return len(result)

REGIONS = None   # riempita dal main leggendo le cartelle presenti

def main():
    ap = argparse.ArgumentParser(description='Statistiche/indici climatici dall\'archivio completo.')
    ap.add_argument('-r', '--region', default='all')
    ap.add_argument('--site-dir', default='site')
    args = ap.parse_args()
    # regioni = sottocartelle con data-parsed
    all_reg = sorted(d for d in os.listdir(_BASE_DIR)
                     if os.path.isdir(os.path.join(_BASE_DIR, d, 'data-parsed')))
    regions = all_reg if args.region.lower() == 'all' else [r.strip() for r in args.region.split(',')]
    for reg in regions:
        parse_dir = os.path.join(_BASE_DIR, reg, 'data-parsed')
        if not os.path.isdir(parse_dir):
            print('SKIP ' + reg + ': niente data-parsed'); continue
        out_dir = os.path.join(args.site_dir if os.path.isabs(args.site_dir) else os.path.join(_BASE_DIR, args.site_dir), reg)
        try:
            climate_region(reg, parse_dir, out_dir)
        except Exception as e:
            sys.stderr.write('[%s] ERRORE climatologia: %s\n' % (reg, e))

if __name__ == '__main__':
    main()
