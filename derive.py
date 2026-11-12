#!/usr/bin/env python3

# derive.py - grandezze derivate e indici calcolati al volo dall'export, dalle misure grezze della
# finestra pubblicata. Nulla finisce in data-parsed: le derivate vivono solo in site/.
# derive_station(per_var, meta) -> {sigla_derivata: {istante: valore}} da unire a per_var.

import datetime
import math

from comune import to_float

# --- unita' delle grandezze derivate e degli indici (per il front-end)
DERIVED_UM = {
    'TDEW': '°C', 'TAPP': '°C', 'VPD': 'kPa', 'QSPEC': 'g/kg', 'PSLM': 'hPa',
    'UWND': 'm/s', 'VWND': 'm/s',
    'EAQI': '', 'O3_8H': 'µg/m³',
    'PREC1': 'mm', 'PREC3': 'mm', 'PREC6': 'mm', 'PREC12': 'mm', 'PREC24': 'mm', 'PREC48': 'mm',
    'GDD': '°C·g', 'HDD': '°C·g', 'CDD': '°C·g', 'ET0': 'mm',
}
# finestre (ore) delle cumulate di pioggia -> sigla
ACC_WINDOWS = ((1, 'PREC1'), (3, 'PREC3'), (6, 'PREC6'), (12, 'PREC12'), (24, 'PREC24'), (48, 'PREC48'))
ACC_MIN_COVER = 0.7        # frazione minima di letture attese nella finestra

def _es(T):
    ''' pressione di vapore saturo (kPa), T in gradi C (Tetens/FAO-56). '''
    return 0.6108 * math.exp(17.27 * T / (T + 237.3))

def _first_number(meta, keys):
    ''' Primo valore numerico di meta sotto una delle chiavi (None se manca). '''
    if not isinstance(meta, dict):
        return None
    for k in keys:
        a = to_float(meta.get(k))
        if a is not None:
            return a
    return None

ALT_KEYS = ('QUOTA', 'ALT', 'quota', 'quote', 'ALTITUDE', 'altitudine')
LAT_KEYS = ('LAT', 'Y', 'lat', 'latitude', 'Latitude')

def put(out, name, ist, val):
    if val is not None:
        out.setdefault(name, {})[ist] = val

# --- Grandezze derivate istantanee: per istante, dove esistono gli input concomitanti
def _derive_instant(per_var, meta):
    out = {}
    T  = per_var.get('TEMP', {}); RH = per_var.get('UMID', {})
    WS = per_var.get('VVENTO', {}); WD = per_var.get('DVENTO', {}); P = per_var.get('PRESS', {})
    alt = _first_number(meta, ALT_KEYS)

    # punto di rugiada (Magnus) e VPD: servono T + RH
    for ist in T:
        t = to_float(T[ist]); rh = to_float(RH.get(ist))
        if t is None or rh is None or rh <= 0:
            continue
        rh = min(rh, 100.0)
        g = math.log(rh / 100.0) + 17.62 * t / (243.12 + t)
        put(out, 'TDEW', ist, round(243.12 * g / (17.62 - g), 1))
        es = _es(t)
        put(out, 'VPD', ist, round(es * (1 - rh / 100.0), 3))
        # temperatura percepita (Australian BOM): T + RH + vento
        ws = to_float(WS.get(ist))
        if ws is not None:
            e = (rh / 100.0) * 6.105 * math.exp(17.27 * t / (237.7 + t))   # hPa
            put(out, 'TAPP', ist, round(t + 0.33 * e - 0.70 * ws - 4.00, 1))
        # umidita' specifica: T + RH + P
        p = to_float(P.get(ist))
        if p is not None:
            e_hpa = (rh / 100.0) * 6.112 * math.exp(17.62 * t / (243.12 + t))
            put(out, 'QSPEC', ist, round(622.0 * e_hpa / (p - 0.378 * e_hpa), 2))

    # pressione ridotta al livello del mare: P + quota (+ T per la riduzione)
    if alt is not None:
        for ist in P:
            p = to_float(P[ist]); t = to_float(T.get(ist))
            if p is None:
                continue
            tk = (t if t is not None else 15.0) + 273.15
            p0 = p * math.pow(1 - 0.0065 * alt / (tk + 0.0065 * alt), -5.257)
            put(out, 'PSLM', ist, round(p0, 1))

    # componenti del vento (convenzione meteo: direzione = provenienza)
    for ist in WS:
        ws = to_float(WS[ist]); wd = to_float(WD.get(ist))
        if ws is None or wd is None:
            continue
        th = math.radians(wd)
        put(out, 'UWND', ist, round(-ws * math.sin(th), 2))
        put(out, 'VWND', ist, round(-ws * math.cos(th), 2))
    return out

# --- Indici qualita' dell'aria
# Soglie EAQI (EEA): per inquinante i limiti superiori delle classi 1 Buona ... 5 Molto scarsa;
# oltre l'ultimo limite e' la 6 Pessima.
_EAQI_BANDS = {
    'PM25': [10, 20, 25, 50, 75], 'PM10': [20, 40, 50, 100, 150],
    'NO2':  [40, 90, 120, 230, 340], 'O3': [50, 100, 130, 240, 380],
    'SO2':  [100, 200, 350, 500, 750],
}
def _eaqi_subindex(poll, val):
    lim = _EAQI_BANDS.get(poll)
    if lim is None or val is None:
        return None
    for i, up in enumerate(lim):
        if val <= up:
            return i + 1
    return 6

def _derive_airquality(per_var):
    out = {}
    # EAQI = peggior sotto-indice fra gli inquinanti disponibili, per istante. Applicato ai valori
    # riportati, non alle medie ufficiali (PM su 24h): e' un indice indicativo.
    ists = set()
    for p in _EAQI_BANDS:
        ists |= set(per_var.get(p, {}).keys())
    for ist in ists:
        worst = None
        for p in _EAQI_BANDS:
            si = _eaqi_subindex(p, to_float(per_var.get(p, {}).get(ist)))
            if si is not None:
                worst = si if worst is None else max(worst, si)
        put(out, 'EAQI', ist, worst)
    # O3: media mobile 8 ore
    o3 = per_var.get('O3', {})
    if o3:
        keys = sorted(o3.keys())
        ep = [(datetime.datetime.strptime(k, '%Y%m%d%H%M'), to_float(o3[k]), k) for k in keys]
        for i in range(len(ep)):
            t_i = ep[i][0]; window = [v for (t, v, k) in ep
                                      if v is not None and 0 <= (t_i - t).total_seconds() <= 8*3600]
            if len(window) >= 4:                                  # almeno 4 valori nelle 8h
                put(out, 'O3_8H', ep[i][2], round(sum(window) / len(window), 1))
    return out

# --- Accumuli e indici cumulati: pioggia, gradi-giorno, ET0 giornaliera
def _Ra(lat_deg, doy):
    ''' radiazione extraterrestre giornaliera Ra (MJ/m2/giorno), FAO-56. '''
    phi = math.radians(lat_deg)
    dr = 1 + 0.033 * math.cos(2 * math.pi * doy / 365.0)
    dec = 0.409 * math.sin(2 * math.pi * doy / 365.0 - 1.39)
    x = -math.tan(phi) * math.tan(dec)
    ws = math.acos(max(-1.0, min(1.0, x)))
    return (24 * 60 / math.pi) * 0.0820 * dr * (ws * math.sin(phi) * math.sin(dec)
             + math.cos(phi) * math.cos(dec) * math.sin(ws))

def _et0_penman(tmin, tmax, tmean, rh, rs_mj, u2, p_kpa, lat, doy, z):
    ''' ET0 di riferimento FAO-56 Penman-Monteith (mm/giorno). rs_mj = radiazione solare giornaliera
        (MJ/m2), u2 = vento a 2 m (m/s), p_kpa = pressione (kPa), z = quota (m). '''
    es = (_es(tmax) + _es(tmin)) / 2.0
    ea = _es(tmean) * max(0.0, min(rh, 100.0)) / 100.0
    delta = 4098 * _es(tmean) / (tmean + 237.3) ** 2
    gamma = 0.000665 * p_kpa
    Ra = _Ra(lat, doy)
    Rso = (0.75 + 2e-5 * z) * Ra
    Rns = 0.77 * rs_mj
    ratio = 1.0 if Rso <= 0 else max(0.0, min(rs_mj / Rso, 1.0))
    Rnl = 4.903e-9 * (((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2.0) \
          * (0.34 - 0.14 * math.sqrt(max(0.0, ea))) * (1.35 * ratio - 0.35)
    Rn = Rns - Rnl
    num = 0.408 * delta * Rn + gamma * (900.0 / (tmean + 273.0)) * u2 * (es - ea)
    den = delta + gamma * (1 + 0.34 * u2)
    return max(0.0, num / den) if den else None

def _daily_agg(per_var, varname):
    ''' {day: [min, max, sum, cnt]} per una variabile. '''
    agg = {}
    for ist, v in per_var.get(varname, {}).items():
        fv = to_float(v)
        if fv is None:
            continue
        d = ist[:8]; a = agg.get(d)
        if a is None:
            agg[d] = [fv, fv, fv, 1]
        else:
            if fv < a[0]: a[0] = fv
            if fv > a[1]: a[1] = fv
            a[2] += fv; a[3] += 1
    return agg

def _derive_accumulations(per_var, meta):
    out = {}

    # PREC1..48: pioggia cumulata mobile (PREC = mm dell'intervallo che TERMINA all'istante).
    # Finestra (t-W, t]: la lettura esattamente a t-W non conta.
    PR = per_var.get('PREC', {})
    items = sorted((ist, to_float(v)) for ist, v in PR.items()
                   if to_float(v) is not None)           # ordine cronologico
    if items:
        ep = [(datetime.datetime.strptime(ist, '%Y%m%d%H%M'), ist, v) for ist, v in items]
        # Cadenza della stazione = mediana dei passi. Una finestra vale solo se e' quasi piena
        # (ACC_MIN_COVER) e piu' lunga della cadenza: dopo un buco restano vuote, non sottostimano.
        steps = sorted((ep[i + 1][0] - ep[i][0]).total_seconds() for i in range(len(ep) - 1))
        step = steps[len(steps) // 2] if steps else 0
        for win_h, name in ACC_WINDOWS:
            if step and win_h * 3600 < step:
                continue
            need = max(1, int(math.ceil(ACC_MIN_COVER * win_h * 3600 / step - 1e-9))) if step else 1
            left = 0; run = 0.0                                   # somma scorrevole O(n)
            for right in range(len(ep)):
                run += ep[right][2]
                while (ep[right][0] - ep[left][0]).total_seconds() >= win_h * 3600:
                    run -= ep[left][2]; left += 1
                if right - left + 1 < need:
                    continue
                v = round(run, 1)
                put(out, name, ep[right][1], v if v > 0 else 0.0)      # niente "-0.0" (residui ~1e-16)

    # Gradi-giorno (GDD base 10, HDD base 18, CDD base 21) ed ET0: valori giornalieri marcati alle 12:00.
    # ET0 Penman-Monteith dove ci sono tutti gli input (T, umidita', radiazione, vento), altrimenti
    # Hargreaves (sola temperatura).
    Td = _daily_agg(per_var, 'TEMP')
    RHd = _daily_agg(per_var, 'UMID')
    RAd = _daily_agg(per_var, 'RADSOL')
    Wd = _daily_agg(per_var, 'VVENTO')
    Pd = _daily_agg(per_var, 'PRESS')
    lat = _first_number(meta, LAT_KEYS)
    z = _first_number(meta, ALT_KEYS)
    for day, a in Td.items():
        if a[3] < 6:
            continue
        tmin, tmax, tmean = a[0], a[1], a[2] / a[3]
        stamp = day + '1200'
        put(out, 'GDD', stamp, round(max(0.0, (tmax + tmin) / 2 - 10.0), 1))
        put(out, 'HDD', stamp, round(max(0.0, 18.0 - tmean), 1))
        put(out, 'CDD', stamp, round(max(0.0, tmean - 21.0), 1))
        if lat is None:
            continue
        doy = datetime.datetime.strptime(day, '%Y%m%d').timetuple().tm_yday
        rh_a, ra_a, w_a = RHd.get(day), RAd.get(day), Wd.get(day)
        et0 = None
        if rh_a and ra_a and w_a and rh_a[3] >= 6 and ra_a[3] >= 6 and w_a[3] >= 6:
            # Penman-Monteith: radiazione W/m2 media -> MJ/m2/giorno (x0.0864); vento 10 m -> 2 m (x0.748)
            zz = z if z is not None else 0.0
            rh = rh_a[2] / rh_a[3]
            rs_mj = (ra_a[2] / ra_a[3]) * 0.0864
            u2 = (w_a[2] / w_a[3]) * 0.748
            p_a = Pd.get(day)
            p_kpa = (p_a[2] / p_a[3]) / 10.0 if p_a else 101.3 * ((293 - 0.0065 * zz) / 293) ** 5.26
            et0 = _et0_penman(tmin, tmax, tmean, rh, rs_mj, u2, p_kpa, lat, doy, zz)
        if et0 is None and tmax > tmin:
            et0 = 0.0023 * (tmean + 17.8) * math.sqrt(tmax - tmin) * _Ra(lat, doy) * 0.408
        if et0 is not None:
            put(out, 'ET0', stamp, round(max(0.0, et0), 2))
    return out

# --- API pubblica
def derive_station(per_var, meta):
    ''' Ritorna {sigla_derivata: {istante: valore}} da unire a per_var. Calcola solo dove esistono
        gli input; non tocca l'archivio. '''
    out = {}
    out.update(_derive_instant(per_var, meta or {}))
    out.update(_derive_airquality(per_var))
    out.update(_derive_accumulations(per_var, meta or {}))
    return out
