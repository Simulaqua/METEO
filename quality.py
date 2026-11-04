#!/usr/bin/env python3

# quality.py - PLAUSIBILITA' dei valori misurati.
# Scarta (solo in LETTURA: l'archivio non si tocca mai) le SENTINELLE di dato mancante (-999, -9999,
# 99999...) e i valori fisicamente impossibili, in modo indipendente dalla regione e dall'unita'
# (km/h, m/s, cm, ...). Prima mancava: un solo -999 di ARPA Lombardia avvelenava le somme mobili della
# pioggia (PREC24/PREC48 fino a -9990 mm), i grafici (asse y a -999) e i record climatologici.
# Usato da export_web.py (prima delle derivate), climatology.py e dagli aggregati dello storico lungo.

SENTINEL_LOW  = -990.0       # nessuna grandezza ha valori legittimi <= -990 (sentinelle -999, -9999)
SENTINEL_HIGH = 99990.0      # ne' >= 99990 (sentinelle 99999)

# (min, max) fisicamente plausibili, volutamente larghi (le unita' cambiano da fonte a fonte)
LIMITS = {
    'TEMP': (-60.0, 55.0),   'TEMPACQUA': (-5.0, 45.0),     # 55: oltre e' un guasto (record italiano 48.8)
    'UMID': (0.0, 105.0),                                   # 100.x capita (saturazione del sensore): si lascia
    'PRESS': (450.0, 1100.0),
    'VVENTO': (0.0, 400.0),  'VVENTOSCAL': (0.0, 400.0), 'VVENTOMAX': (0.0, 500.0),
    'DVENTO': (0.0, 360.0),  'DVENTOMAX': (0.0, 360.0),
    'PREC': (0.0, 1000.0),
    'RADSOL': (-50.0, 10000.0),
}

def to_float(v):
    try:
        x = float(v)
        return None if x != x else x
    except (TypeError, ValueError):
        return None

def valid(var, x):
    ''' x (float) e' plausibile per la variabile? None/NaN/sentinella/fuori limiti -> False. '''
    if x is None or x != x:
        return False
    if x <= SENTINEL_LOW or x >= SENTINEL_HIGH:
        return False
    lim = LIMITS.get(var)
    return lim is None or (lim[0] <= x <= lim[1])

def drop_zero_glitches(per_var):
    ''' Guasto del datalogger: UMID=0% e' impossibile all'aperto; se allo stesso istante anche TEMP e' esattamente 0
        sono letture "azzerate" (visto su ARPA Lombardia: TEMP=0, UMID=0, RADSOL=0 alle 23:00). Scarta UMID e,
        se pure 0, la TEMP di quell'istante. per_var = {var: {istante: valore}}, modificato sul posto.
        Ritorna il numero di istanti scartati. '''
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
    ''' Funzione veloce ok(valore_grezzo) per un'intera variabile (usata nei cicli caldi dell'export).
        Un valore NON numerico (es. '>>' di ARPAV = "dato non disponibile": 32000 letture su 150 stazioni
        venete) non e' un dato: viene scartato. Tutte le grandezze esportate sono numeriche. '''
    lim = LIMITS.get(var)
    lo, hi = (lim if lim else (SENTINEL_LOW, SENTINEL_HIGH))
    def ok(v):
        if v is None or v == '':
            return True                      # i vuoti li gestisce il chiamante
        try:
            x = float(v)
        except (TypeError, ValueError):
            return False
        if x != x:
            return False
        if x <= SENTINEL_LOW or x >= SENTINEL_HIGH:
            return False
        return lo <= x <= hi
    return ok
