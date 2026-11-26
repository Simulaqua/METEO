#!/usr/bin/env python3

# arpav_storico.py - copia locale dei dati giornalieri ARPAV del Veneto dal 2010 (pagina «Dati meteorologici
# ultimi anni», API pubblica di api.arpa.veneto.it): per variabile e anno un file con tutte le stazioni e il
# valore di ogni giorno cosi' come lo da' ARPAV (minimo, media e massimo; per la pioggia il totale).
#
# Uscita: arpav_storico/<VAR>/<VAR>-<ANNO>.json.gz
#   {"fonte", "coordcd", "anno", "scaricato", "stazioni": {"<codseq>": {"codice", "nome", "lat", "lon", "quota",
#    "comune", "provincia", "tipo", "sensore", "unita", "aggiornamento", "giorni": {"AAAA-MM-GG": valore}}}}
# codseq identifica il sensore (una stazione puo' averne piu' d'uno); codice e' il codice ARPAV della
# stazione, lo stesso del nostro archivio VEN.
# ARPAV aggiunge un mese il 25 di ogni mese: gli anni chiusi si scaricano una volta, l'anno in corso e il
# precedente a ogni giro.
#
# Uso: python3 arpav_storico.py [--vars PREC,TEMP] [--anni 2010-2026] [--forza]

import argparse
import datetime
import gzip
import json
import os
import sys
import time
import urllib.request

BASE = os.path.dirname(os.path.realpath(__file__))
API = 'https://api.arpa.veneto.it/REST/v1/'
# codice del sensore nell'API; prima le variabili dello Storico
SENSORI = {'PREC': 23, 'TEMP': 18, 'LIVIDRO': 20005, 'PORTATA': 10001, 'UMID': 19, 'RADSOL': 22,
           'VVENTO': 20036, 'DVENTO': 20026, 'RAFF': 20027, 'PRESS': 20}
PRIMO_ANNO = 2010
PAUSA = 0.3                                                    # secondi fra due richieste


def get(path, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(API + path, timeout=90) as r:
                j = json.load(r)
            if not isinstance(j, dict) or j.get('success') is False:
                raise ValueError('risposta inattesa')
            return j.get('data') or []
        except (OSError, ValueError) as e:
            if k == tries - 1:
                raise
            print('  riprovo fra %d s (%s): %s' % (10 * (k + 1), e, path), file=sys.stderr, flush=True)
            time.sleep(10 * (k + 1))


def valore(s):
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return s


def uno_o_tutti(righe, chiave):
    vals = sorted(set(r[chiave] for r in righe if r.get(chiave) is not None))
    return vals[0] if len(vals) == 1 else (vals or None)


def scarica_anno(var, anno):
    cd = SENSORI[var]
    out = {'fonte': API + 'meteo_storici_tabella', 'coordcd': cd, 'anno': anno,
           'scaricato': datetime.datetime.now().strftime('%Y-%m-%dT%H:%M'), 'stazioni': {}}
    for s in get('meteo_storici?coordcd=%d&anno=%d' % (cd, anno)):
        time.sleep(PAUSA)
        righe = get('meteo_storici_tabella?codseq=%s&anno=%d' % (s['codseq'], anno))
        agg = [r['aggiornamento'] for r in righe if r.get('aggiornamento')]
        out['stazioni'][str(s['codseq'])] = {
            'codice': s.get('codice_stazione'), 'nome': s.get('nome_stazione'), 'lat': s.get('latitudine'),
            'lon': s.get('longitudine'), 'quota': s.get('altitude'), 'comune': s.get('comune'),
            'provincia': s.get('provincia'), 'tipo': s.get('tipo'), 'sensore': uno_o_tutti(righe, 'nome_sensore'),
            'unita': uno_o_tutti(righe, 'unitnm'), 'aggiornamento': max(agg) if agg else None,
            'giorni': {(r.get('dataora') or '')[:10]: valore(r.get('valore')) for r in righe}}
    return out


def scrivi(obj, path):
    tmp = path + '.tmp'
    with gzip.open(tmp, 'wt', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, path)


def main():
    oggi = datetime.date.today()
    ap = argparse.ArgumentParser(description='Copia locale dei dati giornalieri ARPAV dal 2010.')
    ap.add_argument('--out', default=os.path.join(BASE, 'arpav_storico'), help='cartella di uscita')
    ap.add_argument('--vars', default=','.join(SENSORI), help='variabili separate da virgole')
    ap.add_argument('--anni', default='%d-%d' % (PRIMO_ANNO, oggi.year), help='anno o intervallo AAAA-AAAA')
    ap.add_argument('--forza', action='store_true', help="riscarica anche gli anni chiusi gia' presenti")
    a = ap.parse_args()
    a0, _, a1 = a.anni.partition('-')
    t0 = time.time()
    for var in a.vars.split(','):
        os.makedirs(os.path.join(a.out, var), exist_ok=True)
        for anno in range(int(a0), int(a1 or a0) + 1):
            path = os.path.join(a.out, var, '%s-%d.json.gz' % (var, anno))
            if os.path.exists(path) and anno < oggi.year - 1 and not a.forza:
                continue
            t = time.time()
            obj = scarica_anno(var, anno)
            if not obj['stazioni']:
                print('%-8s %d: nessuna stazione' % (var, anno), flush=True)
                continue
            scrivi(obj, path)
            n = sum(len(s['giorni']) for s in obj['stazioni'].values())
            print('%-8s %d: %3d sensori, %6d giorni (%.0fs)' % (var, anno, len(obj['stazioni']), n,
                                                                  time.time() - t), flush=True)
    print('Fatto in %.0fs -> %s' % (time.time() - t0, a.out))


if __name__ == '__main__':
    main()
