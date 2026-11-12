#!/usr/bin/env python3

# quality.py - plausibilita' dei valori misurati.
# Scarta, solo in lettura (l'archivio non si tocca), le sentinelle di dato mancante (-999, -9999,
# 99999...) e i valori fisicamente impossibili, qualunque sia la regione o l'unita'.
# Usato da export_web.py (prima delle derivate), climatology.py e dagli aggregati dello storico.

from comune import to_float

SENTINEL_LOW  = -990.0       # nessuna grandezza ha valori legittimi <= -990 (sentinelle -999, -9999)
SENTINEL_HIGH = 99990.0      # ne' >= 99990 (sentinelle 99999)

# (min, max) plausibili, volutamente larghi: le unita' cambiano da fonte a fonte
LIMITS = {
    'TEMP': (-60.0, 55.0),   'TEMPACQUA': (-5.0, 45.0),     # oltre 55 e' un guasto (record italiano 48.8)
    'UMID': (0.0, 105.0),                                   # 100.x capita (sensore saturo): si lascia
    'PRESS': (450.0, 1100.0),
    'VVENTO': (0.0, 400.0),  'VVENTOSCAL': (0.0, 400.0), 'VVENTOMAX': (0.0, 500.0),
    'DVENTO': (0.0, 360.0),  'DVENTOMAX': (0.0, 360.0),
    'PREC': (0.0, 1000.0),
    'RADSOL': (-50.0, 10000.0),
}

def _limits(var):
    lim = LIMITS.get(var)
    return lim if lim else (SENTINEL_LOW, SENTINEL_HIGH)

def _plausible(x, lo, hi):
    ''' x (float o None) fuori dalle sentinelle e dentro (lo, hi)? '''
    if x is None:
        return False
    if x <= SENTINEL_LOW or x >= SENTINEL_HIGH:
        return False
    return lo <= x <= hi

def valid(var, x):
    ''' x e' plausibile per la variabile? Non numerico/NaN/sentinella/fuori limiti -> False. '''
    lo, hi = _limits(var)
    return _plausible(to_float(x), lo, hi)

def drop_zero_glitches(per_var):
    ''' Guasto del datalogger: UMID=0% e' impossibile all'aperto, e con TEMP esattamente 0 sono letture
        "azzerate". Scarta UMID e, se pure 0, la TEMP di quell'istante. per_var = {var: {istante: valore}},
        modificato sul posto. Ritorna il numero di istanti scartati. '''
    um = per_var.get('UMID')
    if not um:
        return 0
    tp = per_var.get('TEMP')
    zeros = [ts for ts, v in um.items() if to_float(v) == 0.0]
    for ts in zeros:
        del um[ts]
        if tp and ts in tp and to_float(tp[ts]) == 0.0:
            del tp[ts]
    return len(zeros)

def checker(var):
    ''' ok(valore_grezzo) per un'intera variabile, per i cicli caldi dell'export: come valid(), con i
        limiti presi una volta. Un valore non numerico (es. '>>' di ARPAV = "dato non disponibile")
        viene scartato. '''
    lo, hi = _limits(var)
    def ok(v):
        if v is None or v == '':
            return True                      # i vuoti li gestisce il chiamante
        return _plausible(to_float(v), lo, hi)
    return ok
