#!/usr/bin/env python3

# quality.py - plausibilita' dei valori misurati.
# Scarta, solo in lettura (l'archivio non si tocca), le sentinelle di dato mancante (-999, -9999,
# 99999...) e i valori fisicamente impossibili, qualunque sia la regione o l'unita'.
# Usato da export_web.py (prima delle derivate) e dagli aggregati dello Storico.

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
    'MAREA': (-1.5, 2.5),                                   # m; l'acqua alta record a Venezia e' 1.94
    'TEMP50': (-60.0, 60.0), 'TEMP0': (-60.0, 80.0),        # al suolo, col sole, si passano i 60
    'RADRIFL': (-50.0, 10000.0),
    'ONDEPERIODO': (0.0, 25.0), 'ONDEPERIODOM': (0.0, 25.0),  # s; con mare piatto gli ondametri danno 40
}
# le altre misure dei profili (suolo, neve) e del vento a 2 m o su 1 s, come le grandezze sorelle
LIMITS.update({v: (-50.0, 70.0) for v in ('TSUOLO5', 'TSUOLO10', 'TSUOLO20', 'TSUOLO30', 'TSUOLO40',
                                          'TSUOLO50', 'TNEVESUP', 'TNEVE0', 'TNEVE30', 'TNEVE60', 'TNEVE90')})
LIMITS.update({v: (0.0, 100.0) for v in ('USUOLO5', 'USUOLO10', 'USUOLO20', 'USUOLO30', 'USUOLO40',
                                         'USUOLO50')})
LIMITS.update({v: (0.0, 400.0) for v in ('VVENTO2', 'VVENTOVETT', 'VVENTOVETT2')})
LIMITS.update({v: (0.0, 500.0) for v in ('VVENTOMAX2', 'VVENTOMAX1S')})
LIMITS.update({v: (0.0, 360.0) for v in ('DVENTO2', 'DVENTOMAX2', 'DVENTOVETT', 'DVENTOVETT2',
                                         'DVENTOMAX1S', 'ONDEDIR', 'CORRENTEDIR')})

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
