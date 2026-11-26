#!/usr/bin/env python3

# er_storico.py - valori giornalieri dall'archivio storico ARPAE (Emilia-Romagna, dal 2006): un file al mese
# con tutte le stazioni, nello stesso formato di realtime.jsonl
# (https://dati-simc.arpae.it/opendata/osservati/meteo/storico/AAAA-MM.json.gz). Si tengono solo gli
# aggregati del giorno solare, calcolati come in history.py. Stazioni a terra -> ER (il codice dell'allerta
# dove le coordinate coincidono, se no A_<nome>, come in dati_mare.py); boe e mareografi -> MAR_ER; fuori la
# rete partecipativa rmap. Per stazione e grandezza un solo passo, l'istantaneo o il piu' breve.
#
# Uscita: er_storico/<REGIONE>/<VAR>/<VAR>-<AAAA-MM>.json.gz =
#         {stazione: {"k": tipo, "u": unita', "giorni": {"AAAAMMGG": aggregato}}}
# I mesi gia' fatti si saltano, tranne gli ultimi due (ARPAE completa il mese dopo). L'ora fra le 00 e
# l'01 del primo giorno di un mese sta nel file del mese prima: in un giro passa da un mese all'altro.
#
# Uso: python3 er_storico.py [--da 2006-01] [--a 2026-10] [--forza]

import argparse
import datetime
import gzip
import json
import os
import sys
import time

import comune
import dati_mare
import history
import quality

BASE = os.path.dirname(os.path.realpath(__file__))
URL = 'https://dati-simc.arpae.it/opendata/osservati/meteo/storico/%s.json.gz'
OUT = os.path.join(BASE, 'er_storico')
FIRST = '2006-01'


class Day:
    ''' Un giorno di una stazione, grandezza e passo, sommato man mano che arrivano le letture. '''
    __slots__ = ('byh', 'mn', 'mx', 'tot', 'sect')

    def __init__(self):
        self.byh, self.mn, self.mx, self.tot, self.sect = {}, None, None, 0.0, [0] * 8

    def add(self, hour, x):
        s = self.byh.setdefault(hour, [0.0, 0])
        s[0] += x
        s[1] += 1
        self.mn = x if self.mn is None else min(self.mn, x)
        self.mx = x if self.mx is None else max(self.mx, x)
        self.tot += x
        self.sect[int(((x % 360) + 22.5) // 45) % 8] += 1

    def aggregate(self, var, mode, factor):
        ''' Lo stesso aggregato di history.day_aggregate. '''
        dec, hours = history.DECIMALS.get(var, 2), len(self.byh)
        if mode == 'sum':
            if var == 'PREC' and self.tot > history.PREC_DAY_MAX:
                return None
            return [round(self.tot * factor, dec), hours]
        if mode == 'dir':
            return [self.sect.index(max(self.sect)) * 45, hours]
        mean = sum(s / n for s, n in self.byh.values()) / hours
        if mode == 'mean':
            return [round(mean * factor, dec), hours]
        return [round(self.mn, dec), round(self.mx, dec), round(mean, dec), hours]


def land_codes():
    ''' (lon, lat) x 1e5 -> codice dell'allerta, dall'anagrafica di ER. '''
    registry = comune.load_json(os.path.join(comune.region_dir('ER'), 'data-parsed', 'stazioni.json'))
    out = {}
    for sc, meta in (registry or {}).items():
        lat, lon = comune.to_float(meta.get('LAT')), comune.to_float(meta.get('LON'))
        if sc.isdigit() and lat is not None and lon is not None:
            out[(round(lon * 1e5), round(lat * 1e5))] = sc
    return out


def read_month(path, api, acc):
    ''' Aggiunge ad acc[(regione, stazione, grandezza)][passo][giorno] le letture di un file del mese. '''
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        for line in f:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            net = o.get('network')
            if net == 'rmap':
                continue
            moment, meta = dati_mare.er_moment_meta(o)
            if moment is None:
                continue
            sea = net in dati_mare.ER_NETWORKS
            name = meta.get('B01019')
            if sea:
                region, sc = 'MAR_ER', comune.slug(name) if name else None
            else:
                region = 'ER'
                sc = api.get((o.get('lon'), o.get('lat'))) or ('A_' + comune.slug(name) if name else None)
            if sc is None:
                continue
            for var, step, x in dati_mare.er_measures(o, dati_mare.ER_SEA if sea else dati_mare.ER_LAND):
                if quality.valid(var, x):
                    days = acc.setdefault((region, sc, var), {}).setdefault(step, {})
                    days.setdefault(moment[:8], Day()).add(moment[8:10], x)


def flush(acc, month, units):
    ''' Aggregati dei giorni del mese (per stazione e grandezza il passo istantaneo o il piu' breve);
        restano in acc i giorni dopo il mese. Ritorna {(regione, grandezza): {stazione: {...}}}. '''
    out, ym = {}, month.replace('-', '')
    for (region, sc, var), steps in acc.items():
        step = min(steps)
        kind, unit, factor, mode = history.kind_of(var, units[region].get(var))
        giorni = {}
        for day, d in steps[step].items():
            if day[:6] == ym:
                agg = d.aggregate(var, mode, factor)
                if agg:
                    giorni[day] = agg
        if giorni:
            out.setdefault((region, var), {})[sc] = {'k': kind, 'u': unit, 'giorni': giorni}
        for days in steps.values():
            for day in [day for day in days if day[:6] <= ym]:
                del days[day]
    for key in [k for k, steps in acc.items() if not any(steps.values())]:
        del acc[key]
    return out


def write_month(out, month):
    for (region, var), stations in out.items():
        d = os.path.join(OUT, region, var)
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, '%s-%s.json.gz' % (var, month))
        with gzip.open(path + '.tmp', 'wt', encoding='utf-8') as f:
            json.dump(stations, f, separators=(',', ':'), ensure_ascii=False)
        os.replace(path + '.tmp', path)


def months(first, last):
    y, m = int(first[:4]), int(first[5:7])
    while '%04d-%02d' % (y, m) <= last:
        yield '%04d-%02d' % (y, m)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def done(month):
    return any(os.path.exists(os.path.join(OUT, r, v, '%s-%s.json.gz' % (v, month)))
               for r in ('ER', 'MAR_ER') if os.path.isdir(os.path.join(OUT, r))
               for v in os.listdir(os.path.join(OUT, r)))


def download(month, path):
    for k in range(4):
        try:
            r = comune.get(URL % month)
            if r.status_code == 404:
                return False
            r.raise_for_status()
            with open(path, 'wb') as f:
                f.write(r.content)
            return True
        except Exception as e:
            if k == 3:
                raise
            print('  riprovo fra %d s: %s' % (60 * (k + 1), e), file=sys.stderr, flush=True)
            time.sleep(60 * (k + 1))


def main():
    today = comune.now_solar().date()
    last = (today.replace(day=1) - datetime.timedelta(days=1)).strftime('%Y-%m')
    ap = argparse.ArgumentParser(description="Valori giornalieri dall'archivio storico ARPAE.")
    ap.add_argument('--da', default=FIRST, help='primo mese AAAA-MM')
    ap.add_argument('--a', default=last, help='ultimo mese AAAA-MM')
    ap.add_argument('--forza', action='store_true', help="rifa' anche i mesi gia' fatti")
    a = ap.parse_args()
    recent = (today.replace(day=1) - datetime.timedelta(days=40)).strftime('%Y-%m')
    units = {'ER': dati_mare.ER_LAND_UNITS, 'MAR_ER': dati_mare.UNITS}
    api, acc, prev = land_codes(), {}, None
    tmp = os.path.join(OUT, '.mese-%d.json.gz' % os.getpid())     # piu' giri insieme, ognuno il suo
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    for month in months(a.da, a.a):
        if not a.forza and month < recent and done(month):
            prev = None
            continue
        if prev is None and month > FIRST:              # l'ora di confine sta nel file del mese prima
            first = datetime.date(int(month[:4]), int(month[5:7]), 1) - datetime.timedelta(days=1)
            if download(first.strftime('%Y-%m'), tmp):
                read_month(tmp, api, acc)
                flush(acc, first.strftime('%Y-%m'), units)
        t = time.time()
        if not download(month, tmp):
            print('%s: nessun file' % month, flush=True)
            prev = None
            continue
        read_month(tmp, api, acc)
        out = flush(acc, month, units)
        write_month(out, month)
        prev = month
        n = sum(len(st['giorni']) for stations in out.values() for st in stations.values())
        print('%s: %d grandezze, %d giorni-stazione (%.0fs)' % (month, len(out), n, time.time() - t),
              flush=True)
    if os.path.exists(tmp):
        os.remove(tmp)
    print('Fatto in %.0fs -> %s' % (time.time() - t0, OUT))


if __name__ == '__main__':
    main()
