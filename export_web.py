#!/usr/bin/env python3
# export_web.py - i file del sito dall'archivio. Di ogni regione legge gli ultimi N giorni (7 di solito)
# di <REGIONE>/data-parsed/<VAR>/<VAR>-AAAAMMGG.json[.gz] e scrive in <site-dir>/<REGIONE>/:
#   series/<SCODE>.csv     la serie di ogni stazione, una colonna per variabile (con le derivate)
#   stations.geojson       le stazioni della mappa, con l'ultimo valore di ogni variabile, il ritardo di
#                          ognuna e i valori di riferimento dei colori (pioggia di oggi...)
#   units.json             l'unità di ogni variabile
#   snap/<VAR>.json        i fotogrammi orari del cursore del tempo
# Con --series-only (l'export a 30 giorni, in series30/) scrive solo le serie, senza derivate.
# L'archivio è in ora solare (UTC+1 tutto l'anno); il sito mostra l'ora civile italiana.
# Uso: python3 export_web.py -r all --site-dir site [--days 30 --series-dir series30 --series-only]
import argparse
import bisect
import calendar
import csv
import datetime
import glob
import math
import os
import sys

import comune
import derive
import quality

# Le cartelle del sito, nell'ordine dell'export. Le reti AQ_, PC_, MAR_... sono archivi a sé, che il
# sito raggruppa sotto la voce geografica. PC_PO (AIPO) si pubblica intero, anche con le stazioni
# già presenti in ER e LOM.
REGIONS = ['VEN', 'TN', 'BZ', 'FVG', 'LOM', 'ER', 'AQ_VEN', 'AQ_TN', 'AQ_BZ', 'AQ_LOM', 'AQ_ER',
           'PC_FVG', 'PC_TN', 'MAR_VEN', 'MAR_ER', 'MAR_FVG', 'ACQ_VEN', 'INV_ER', 'LIG', 'PC_PO', 'PC_PIE',
           'PIE', 'LAGHI']
# I campi di stazioni.json con nome, latitudine e longitudine, dove non sono NOME, LAT e LON.
# In VEN X e Y sono lon e lat in EPSG:4258; in FVG le coordinate vengono da FVG/stazioni_coords.csv.
STATION_FIELDS = {'VEN': ('NOME', 'Y', 'X'),
                  'TN': ('nome', 'latitudine', 'longitudine'),
                  'BZ': ('NAME_I', 'LAT', 'LONG'),
                  'FVG': ('station_name', None, None)}
# Quota in metri, comune e provincia, dove stazioni.json li ha: la scheda li mostra nella "i" della stazione.
ALT_FIELDS = {'VEN': 'QUOTA', 'LOM': 'QUOTA', 'TN': 'quota', 'BZ': 'ALT', 'FVG': 'station_altitude'}
PLACE_FIELDS = {'VEN': ('COMUNE', 'PROVINCIA'), 'LOM': (None, 'PROVINCIA')}

# Cursore del tempo: un fotogramma per ora tonda (solare) degli ultimi 7 giorni, con l'ultima lettura
# non più vecchia della tolleranza in minuti (più stretta per gli accumuli brevi).
SNAP_VARS = ['TEMP', 'UMID', 'PRESS', 'VVENTO', 'VVENTOMAX',
             'PREC1', 'PREC3', 'PREC6', 'PREC12', 'PREC24', 'PREC48']
SNAP_FRAMES = 168
SNAP_TOL_MIN = {'PREC1': 30, 'PREC3': 45, 'VVENTO': 60, 'VVENTOMAX': 60}
SNAP_TOL_DEF = 90
SNAP_DEC = {'UMID': 0}
# La raffica di un fotogramma e' la massima dell'ora che finisce li': prese all'ora tonda, le reti a 10-15
# minuti perdevano i picchi
SNAP_MAX = {'VVENTOMAX'}

# Mappa: una stazione con l'ultima lettura di una variabile piu' vecchia di cosi' e' grigia (lo stesso
# numero sta in site/mappa.js). Le derivate giornaliere, segnate alle 12:00, non sono mai in ritardo.
LATE_HOURS = 3
DAILY_DERIVED = {'GDD', 'HDD', 'CDD', 'ET0'}
# Livello idrometrico: la mappa ne colora la variazione, perche' ogni asta ha il suo zero
LEVEL_HOURS = 3
LEVEL_TOLERANCE = datetime.timedelta(minutes=30)
# Qualita' dell'aria sulla mappa: i valori di ieri, il giorno che hanno pubblicato tutte le fonti (ARPAE e
# APPA Trento solo il mattino dopo). Media per le polveri, massimo orario per ozono e NO2.
AQ_DAILY_MEAN = ('PM10', 'PM25')
AQ_DAILY_MAX = ('O3', 'NO2')


def main():
    ap = argparse.ArgumentParser(description="I file del sito dagli ultimi giorni dell'archivio.")
    ap.add_argument('-r', '--region', required=True, choices=REGIONS + ['all'])
    ap.add_argument('-n', '--days', type=int, default=7, help='giorni della finestra (7)')
    ap.add_argument('--site-dir', required=True,
                    help='cartella del sito: ogni regione in <site-dir>/<REGIONE>/')
    ap.add_argument('--series-dir', default='series',
                    help='sottocartella delle serie (series30 per i 30 giorni)')
    ap.add_argument('--series-only', action='store_true',
                    help='solo le serie: niente derivate, mappa, unità e cursore')
    args = ap.parse_args()

    regions = REGIONS if args.region == 'all' else [args.region]
    for region in regions:
        folder = comune.region_dir(region)
        parse_dir = os.path.join(folder, 'data-parsed')
        if not os.path.isdir(parse_dir):
            print('SKIP ' + region + ': parsed dir not found (' + parse_dir + ')')
            continue
        coords_path = os.path.join(folder, 'stazioni_coords.csv')
        coords = load_coords(coords_path)
        if coords:
            print('Coordinate lookup: ' + str(len(coords)) + ' stations from ' + coords_path)
        export_region(region, parse_dir, os.path.join(args.site_dir, region), args.days, coords,
                      args.series_dir, args.series_only)


def export_region(region, parse_dir, out_dir, days, coords, series_subdir, series_only):
    """I file del sito di una regione in out_dir. coords = {scode: (lat, lon)} per le stazioni senza
    coordinate in stazioni.json."""
    print('\n***  WEB EXPORT  ***   region ' + region)
    cutoff_dt = comune.now_solar() - datetime.timedelta(days=days)
    cutoff = cutoff_dt.strftime('%Y%m%d%H%M')
    # Le somme di pioggia 1-48 h, anche a inizio finestra, servono la PREC dei 2 giorni prima: si legge
    # in più e si toglie dopo le derivate (l'export a 30 giorni non le calcola).
    prec_cutoff = cutoff
    if not series_only:
        prec_cutoff = (cutoff_dt - datetime.timedelta(days=2)).strftime('%Y%m%d%H%M')
    print('Keeping measures from ' + cutoff_dt.strftime('%Y-%m-%d %H:%M')
          + ' onward (last ' + str(days) + ' days)')

    data, units, station_meta = read_window(parse_dir, region, cutoff, prec_cutoff)
    print('Stations with data in window: ' + str(len(data)))

    # Letture "azzerate" del datalogger (UMID=0 e TEMP=0 insieme): via prima delle derivate. Le serie
    # e le stazioni rimaste vuote escono: la mappa cerca l'ultimo istante di ogni serie.
    glitches = sum(quality.drop_zero_glitches(per_var) for per_var in data.values())
    if glitches:
        print('Scartati ' + str(glitches) + ' istanti con letture azzerate (UMID=0)')
        for scode in list(data):
            data[scode] = {var: series for var, series in data[scode].items() if series}
            if not data[scode]:
                del data[scode]

    if not series_only:
        add_derived(data, units, station_meta)
        drop_extra_prec(data, cutoff)
    else:
        add_et0(data, station_meta)

    series_dir = os.path.join(out_dir, series_subdir)
    os.makedirs(series_dir, exist_ok=True)
    write_series(data, series_dir)
    if series_only:
        print('Series-only export (' + series_subdir + ') written to ' + series_dir)
        return

    zeros = comune.load_json(os.path.join(os.path.dirname(parse_dir), 'zero_idrometrici.json'))
    on_map = write_map(region, data, station_meta, zeros, coords, out_dir)
    comune.save_json(units, os.path.join(out_dir, 'units.json'))
    write_snapshots(data, on_map, units, out_dir)
    if region.startswith('AQ_'):
        write_pm10_year(region, parse_dir, out_dir)
    print('Export written to ' + out_dir)


# Giorni di superamento del PM10 (scheda della stazione dell'aria): una media per stazione e giorno dal 1
# gennaio, come la da' ogni fonte. ER e LOM: un valore al giorno; VEN: la media del giorno e' aggiornata piu'
# volte, vale l'ultima; TN e BZ: le orarie, con almeno 18.
PM10_DAILY = {'AQ_ER', 'AQ_LOM'}
PM10_LAST = {'AQ_VEN'}
PM10_MIN_HOURS = 18


def pm10_day(region, instant):
    """Il giorno di una lettura. ER segna la fine della giornata (le 00:00 del giorno dopo; il vecchio
    portale, fino a settembre 2026, le 23:00): conta il minuto prima."""
    t = datetime.datetime.strptime(instant, '%Y%m%d%H%M')
    if region == 'AQ_ER':
        t -= datetime.timedelta(minutes=1)
    return t.date()


def pm10_year(parse_dir, region, today):
    """{scode: [media intera, o None, per ogni giorno dal 1 gennaio dell'anno di today a today]}."""
    value_key = comune.value_key(region)
    jan1 = datetime.date(today.year, 1, 1)
    # lo stesso giorno compresso e non: prima il .gz, cosi' a parita' d'istante vince il .json
    files = sorted(glob.glob(os.path.join(parse_dir, 'PM10', 'PM10-%d*.json*' % today.year)),
                   key=lambda f: (os.path.basename(f)[:13], not f.endswith('.gz')))
    readings = {}
    for fn in files:
        for scode, rec in comune.load_json(fn).items():
            m = (rec or {}).get('MISURE') or {}
            per = readings.setdefault(scode, {})
            for instant, v in zip(m.get('ISTANTE') or [], m.get(value_key) or []):
                x = comune.to_float(v)
                if x is not None and quality.valid('PM10', x):
                    per[instant] = x
    out = {}
    for scode, per in readings.items():
        days = {}
        for instant in sorted(per):
            try:
                day = pm10_day(region, instant)
            except ValueError:
                continue
            if day.year == today.year and day <= today:
                days.setdefault(day, []).append(per[instant])
        row = [None] * ((today - jan1).days + 1)
        for day, vals in days.items():
            if region in PM10_LAST:
                mean = vals[-1]
            elif region in PM10_DAILY or len(vals) >= PM10_MIN_HOURS:
                mean = sum(vals) / len(vals)
            else:
                continue
            row[(day - jan1).days] = int(math.floor(mean + 0.5))
        if any(v is not None for v in row):
            out[scode] = row
    return out


def write_pm10_year(region, parse_dir, out_dir):
    """<REGIONE>/pm10_anno.json; si rifa' solo quando l'archivio del PM10 e' piu' nuovo del file. Un errore
    qui non ferma l'export delle regioni dopo."""
    try:
        files = glob.glob(os.path.join(parse_dir, 'PM10', 'PM10-*.json*'))
        target = os.path.join(out_dir, 'pm10_anno.json')
        if not files or (os.path.exists(target)
                         and os.path.getmtime(target) >= max(os.path.getmtime(f) for f in files)):
            return
        today = comune.now_solar().date()
        comune.save_json({'anno': today.year, 'soglia': 50, 'ammessi': 35,
                          's': pm10_year(parse_dir, region, today)}, target)
    except Exception as e:
        print('WARN: pm10_anno.json non scritto (' + str(e) + ')', file=sys.stderr)


def read_window(parse_dir, region, cutoff, prec_cutoff):
    """Dall'archivio della regione: data = {scode: {var: {istante: valore}}}, le letture plausibili da
    cutoff in poi (da prec_cutoff per la PREC); units = {var: unità}, l'ultima vista; station_meta =
    stazioni.json, più il blocco STAZIONE delle serie per le stazioni che non ci sono. I giorni si
    leggono in ordine: ne dipendono ordine delle stazioni, unità e blocco STAZIONE."""
    station_meta = comune.load_json(os.path.join(parse_dir, 'stazioni.json'))
    value_key = comune.value_key(region)
    data = {}
    units = {}
    for var in sorted(os.listdir(parse_dir)):
        var_dir = os.path.join(parse_dir, var)
        if not os.path.isdir(var_dir):
            continue
        var_cutoff = prec_cutoff if var == 'PREC' else cutoff
        plausible = quality.checker(var)
        for day, path in comune.day_files(var_dir, var).items():
            if day < var_cutoff[:8]:
                continue
            try:
                read_file(path, var, value_key, var_cutoff, plausible, data, units, station_meta)
            except (TypeError, ValueError, KeyError, AttributeError) as e:
                print('WARN: file saltato (' + str(e) + '): ' + path, file=sys.stderr)
    return data, units, station_meta


def read_file(path, var, value_key, var_cutoff, plausible, data, units, station_meta):
    """Aggiunge a data, units e station_meta le letture di un file giornaliero."""
    for scode, record in comune.load_json(path).items():
        # ARPAV (VEN) non ha UM: l'unità sta nel blocco SENSORE
        unit = record.get('UM')
        if unit is None:
            sensor = record.get('SENSORE') or {}
            unit = sensor.get('UNITNM') or sensor.get('UNITCODE')
        if unit:
            units[var] = unit
        measures = record.get('MISURE', {})
        for moment, value in zip(measures.get('ISTANTE', []), measures.get(value_key, [])):
            if moment is not None and moment >= var_cutoff and plausible(value):
                data.setdefault(scode, {}).setdefault(var, {})[moment] = value
        if scode not in station_meta:
            station_meta[scode] = record.get('STAZIONE', {})


def add_et0(data, station_meta):
    """Nella serie a 30 giorni delle derivate entra solo l'ET0: il bilancio idrico della scheda."""
    try:
        for scode, per_var in data.items():
            per_var.update(derive.daily_et0(per_var, station_meta.get(scode, {})))
    except Exception as e:
        print('WARN: ET0 non calcolata (' + str(e) + ')', file=sys.stderr)


def add_derived(data, units, station_meta):
    """Le derivate di derive.py, calcolate dalle letture della finestra e mai archiviate: entrano in data
    come variabili, quindi nelle serie, in mappa e nel cursore."""
    try:
        for scode, per_var in data.items():
            for name, series in derive.derive_station(per_var, station_meta.get(scode, {})).items():
                if series:
                    per_var[name] = series
                    units[name] = derive.DERIVED_UM.get(name, '')
    except Exception as e:
        print('WARN: derivate non calcolate (' + str(e) + ')', file=sys.stderr)


def drop_extra_prec(data, cutoff):
    """Via la PREC prima di cutoff, letta solo per le somme, e le somme di quegli istanti; una stazione
    rimasta senza dati esce."""
    for scode in list(data):
        per_var = data[scode]
        for name in ('PREC', 'PREC1', 'PREC3', 'PREC6', 'PREC12', 'PREC24', 'PREC48'):
            if name not in per_var:
                continue
            kept = {moment: value for moment, value in per_var[name].items() if moment >= cutoff}
            if kept:
                per_var[name] = kept
            else:
                del per_var[name]
        if not per_var:
            del data[scode]


def write_series(data, series_dir):
    """<SCODE>.csv per stazione: datetime (ora civile) e una colonna per variabile."""
    for scode, per_var in data.items():
        variables = sorted(per_var)
        moments = sorted({moment for var in variables for moment in per_var[var]})
        with open(os.path.join(series_dir, scode + '.csv'), 'w', newline='', encoding='utf-8') as fp:
            writer = csv.writer(fp)
            writer.writerow(['datetime'] + variables)
            for moment in moments:
                row = [iso_datetime(moment)]
                for var in variables:
                    value = per_var[var].get(moment)
                    row.append('' if value is None else value)
                writer.writerow(row)


def write_map(region, data, station_meta, zeros, coords, out_dir):
    """stations.geojson con le stazioni che hanno coordinate (da stazioni.json, altrimenti da coords);
    le altre sono solo nel log. Ritorna i codici delle stazioni in mappa."""
    name_field, lat_field, lon_field = STATION_FIELDS.get(region, ('NOME', 'LAT', 'LON'))
    now = comune.now_solar()
    features = []
    no_coord = []
    for scode, per_var in data.items():
        meta = station_meta.get(scode, {})
        name = meta.get(name_field) or scode
        lat = coordinate(meta.get(lat_field))
        lon = coordinate(meta.get(lon_field))
        if lat is not None and lon is not None and abs(lat) < 0.01 and abs(lon) < 0.01:
            lat = lon = None                    # 0,0 = mancanti: la stazione finirebbe nell'oceano
        if (lat is None or lon is None) and scode in coords:
            lat, lon = coords[scode]
        if lat is None or lon is None:
            no_coord.append([scode, name])
        else:
            properties = station_properties(scode, name, per_var, zeros.get(scode), region, now)
            properties.update(station_place(region, meta))
            features.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                             'properties': properties})
    comune.save_json({'type': 'FeatureCollection', 'name': region, 'features': features},
                     os.path.join(out_dir, 'stations.geojson'))
    print('Stations on map (with lat/lon): ' + str(len(features)))
    if no_coord:
        print('Stazioni senza coordinate, non in mappa: ' + str(len(no_coord)) + ' (' +
              ', '.join(scode for scode, _ in no_coord) + ')')
    return [feature['properties']['scode'] for feature in features]


def station_place(region, meta):
    """{'quota': metri interi, 'comune': ..., 'prov': ...} con i soli campi che la regione ha e che sono
    leggibili."""
    place = {}
    quota = coordinate(meta.get(ALT_FIELDS.get(region)))
    if quota is not None:
        place['quota'] = int(round(quota))
    town_field, province_field = PLACE_FIELDS.get(region, (None, None))
    for key, field in (('comune', town_field), ('prov', province_field)):
        value = str(meta.get(field) or '').strip() if field else ''
        if value:
            place[key] = value
    return place


def station_properties(scode, name, per_var, zero, region, now):
    """Le proprietà di una stazione in mappa: l'ultimo valore di ogni variabile, l'ora dell'ultima misura, i
    minuti di ritardo delle variabili rimaste indietro (lag) e i valori di riferimento dei colori (rif)."""
    latest = {}
    latest_moment = None
    for var in sorted(per_var):
        moment = max(per_var[var])
        latest[var] = per_var[var][moment]
        # L'ora dell'ultima misura ignora le derivate: quelle giornaliere (GDD, ET0...) sono alle 12:00
        # solari e al mattino sarebbero "nel futuro", falsando lo stato delle fonti.
        if var not in derive.DERIVED_UM and (latest_moment is None or moment > latest_moment):
            latest_moment = moment
    if latest_moment is None:
        latest_moment = max(max(series) for series in per_var.values())
    properties = {'scode': scode, 'name': name, 'variables': sorted(per_var), 'latest': latest,
                  'latest_time': iso_datetime(latest_moment), 'series': 'series/' + scode + '.csv'}
    lags = var_lags(per_var, latest_moment)
    if lags:
        properties['lag'] = lags
    refs = map_refs(region, per_var, now)
    if refs:
        properties['rif'] = refs
    # quota dello zero idrometrico: il sito mostra il livello anche in quota assoluta
    if isinstance(zero, dict):
        zero = zero.get('zero')
    if zero is not None:
        properties['zero_idro'] = zero
    return properties


def moment_of(instant):
    return datetime.datetime.strptime(instant[:12], '%Y%m%d%H%M')


def moment_or_none(instant):
    try:
        return moment_of(instant)
    except (TypeError, ValueError):
        return None


def readable(series):
    """Gli istanti di una serie che hanno la forma AAAAMMGGhhmm (si ordinano come stringhe)."""
    return [instant for instant in series if instant[:12].isdigit()]


def readings_of(series, since=''):
    """[(momento, valore)] in ordine di tempo dall'istante since in poi, senza valori vuoti e istanti
    illeggibili. Si leggono solo gli istanti che servono: l'export gira a ogni pubblicazione."""
    points = []
    for instant in readable(series):
        if instant[:12] < since:
            continue
        number, moment = comune.to_float(series[instant]), moment_or_none(instant)
        if number is not None and moment is not None:
            points.append((moment, number))
    return sorted(points)


def last_moment(series):
    instants = readable(series or {})
    return moment_or_none(max(instants)) if instants else None


def var_lags(per_var, latest_moment):
    """{variabile: minuti fra la sua ultima lettura e latest_moment}, solo per quelle rimaste indietro."""
    end = moment_or_none(latest_moment)
    lags = {}
    for var, series in per_var.items():
        last = last_moment(series) if end and var not in DAILY_DERIVED else None
        minutes = int((end - last).total_seconds() // 60) if last else 0
        if minutes > 0:
            lags[var] = minutes
    return lags


def civil_midnight(now):
    """L'istante solare dell'ultima mezzanotte civile non dopo now (ora solare): d'estate le 23:00 solari del
    giorno prima."""
    midnight = civil_time(now).replace(hour=0, minute=0, second=0, microsecond=0)
    if comune.is_dst_civil(midnight):
        midnight -= datetime.timedelta(hours=1)
    return midnight.strftime('%Y%m%d%H%M')


def since_midnight(series, midnight):
    """I valori letti dopo midnight (la lettura delle 00:00 chiude il giorno prima); None se sono meno di
    quelli attesi nel tempo trascorso (la regola delle somme di derive.py). La cadenza e' quella di oggi: i
    giorni passati possono essere stati riscritti a un passo diverso (in Alto Adige 5 minuti invece di 10)."""
    today = readings_of({instant: value for instant, value in (series or {}).items()
                         if instant[:12] > midnight})
    if not today:
        return []
    steps = sorted((b[0] - a[0]).total_seconds() for a, b in zip(today, today[1:]))
    if len(steps) < 2:
        whole = readings_of(series)
        steps = sorted((b[0] - a[0]).total_seconds() for a, b in zip(whole, whole[1:]))
    step = steps[len(steps) // 2] if steps else 0
    elapsed = (today[-1][0] - moment_of(midnight)).total_seconds()
    need = math.ceil(derive.ACC_MIN_COVER * elapsed / step - 1e-9) if step else 1
    return [value for _, value in today] if len(today) >= need else None


def level_change(series):
    """Ultima lettura meno quella di LEVEL_HOURS prima (la più recente fatta allora o prima, non più vecchia
    di LEVEL_TOLERANCE), nell'unità della fonte; None se manca."""
    last = last_moment(series)
    if last is None:
        return None
    target = last - datetime.timedelta(hours=LEVEL_HOURS)
    points = readings_of(series, (target - LEVEL_TOLERANCE).strftime('%Y%m%d%H%M'))
    before = [point for point in points if point[0] <= target]
    if not before or points[-1][0] != last:
        return None
    return round(points[-1][1] - before[-1][1], 3) + 0.0                # niente "-0.0"


def aq_yesterday(region, var, readings, today):
    """Il valore di ieri (today - 1, giorno solare come nella striscia del PM10), intero: per le polveri la
    media con le regole di pm10_year, per ozono e NO2 il massimo orario; None se il giorno non è completo."""
    day = today - datetime.timedelta(days=1)
    values = []
    for instant in sorted(readings):
        number = comune.to_float(readings[instant])
        try:
            if number is not None and pm10_day(region, instant) == day:
                values.append(number)
        except ValueError:
            continue
    value = None
    if var in AQ_DAILY_MAX:
        if len(values) >= PM10_MIN_HOURS:
            value = max(values)
    elif values and region in PM10_LAST:
        value = values[-1]
    elif values and (region in PM10_DAILY or len(values) >= PM10_MIN_HOURS):
        value = sum(values) / len(values)
    return None if value is None else int(math.floor(value + 0.5))


def map_refs(region, per_var, now):
    """I valori che colorano la mappa quando non sono l'ultimo letto: pioggia e raffica massima di oggi,
    variazione del livello, qualità dell'aria di ieri."""
    refs = {}
    midnight = civil_midnight(now)
    rain = per_var.get('PREC')
    values = since_midnight(rain, midnight)
    if values:
        refs['PREC'] = max(0.0, round(sum(values), 1))
    # nessuna lettura dopo mezzanotte: zero se il pluviometro trasmette (stazione oraria alle 00:30)
    elif values == [] and rain:
        last = last_moment(rain)
        if last and now - last <= datetime.timedelta(hours=LATE_HOURS):
            refs['PREC'] = 0.0
    values = since_midnight(per_var.get('VVENTOMAX'), midnight)
    if values:
        refs['VVENTOMAX'] = round(max(values), 1)
    change = level_change(per_var.get('LIVIDRO'))
    if change is not None:
        refs['LIVIDRO'] = change
    for var in AQ_DAILY_MEAN + AQ_DAILY_MAX:
        value = aq_yesterday(region, var, per_var.get(var) or {}, now.date())
        if value is not None:
            refs[var] = value
    return refs


def write_snapshots(data, scodes, units, out_dir):
    """snap/<VAR>.json per le stazioni scodes: {"t": [epoch di ogni fotogramma], "u": unità,
    "s": {scode: [valore o null per fotogramma]}}. L'epoch è l'ora civile letta come UTC: il sito la
    mostra così com'è."""
    snap_dir = os.path.join(out_dir, 'snap')
    last = comune.now_solar().replace(minute=0, second=0, microsecond=0)
    frames = [last - datetime.timedelta(hours=SNAP_FRAMES - 1 - k) for k in range(SNAP_FRAMES)]
    frame_moments = [frame.strftime('%Y%m%d%H%M') for frame in frames]
    epochs = [calendar.timegm(civil_time(frame).timetuple()) for frame in frames]
    written = set()
    for var in SNAP_VARS:
        decimals = SNAP_DEC.get(var, 1)
        tolerance = datetime.timedelta(minutes=SNAP_TOL_MIN.get(var, SNAP_TOL_DEF))
        oldest_moments = [(frame - tolerance).strftime('%Y%m%d%H%M') for frame in frames]
        series = {}
        for scode in scodes:
            readings = data[scode].get(var)
            if not readings:
                continue
            moments = sorted(readings)
            values = []
            for frame_moment, oldest in zip(frame_moments, oldest_moments):
                i = bisect.bisect_right(moments, frame_moment) - 1
                value = None
                if var in SNAP_MAX:
                    window = [comune.to_float(readings[moment])
                              for moment in moments[bisect.bisect_right(moments, oldest):i + 1]]
                    window = [number for number in window if number is not None]
                    value = max(window) if window else None
                elif i >= 0 and moments[i] >= oldest:
                    value = comune.to_float(readings[moments[i]])
                if value is None:
                    values.append(None)
                elif decimals:
                    values.append(round(value, decimals))
                else:
                    values.append(int(round(value)))
            if any(value is not None for value in values):
                series[scode] = values
        if series:
            comune.save_json({'t': epochs, 'u': units.get(var, ''), 's': series},
                             os.path.join(snap_dir, var + '.json'))
            written.add(var + '.json')
    # il file di una variabile che la regione non ha più resterebbe: il cursore mostrerebbe dati vecchi
    if os.path.isdir(snap_dir):
        for name in os.listdir(snap_dir):
            if name not in written:
                try:
                    os.remove(os.path.join(snap_dir, name))
                except OSError:
                    pass
    if written:
        print('Snapshot orari: ' + str(len(written)) + ' variabili in ' + snap_dir)


def iso_datetime(istante):
    """AAAAMMGGhhmm in ora solare -> 'AAAA-MM-GGThh:mm' in ora civile italiana. Un istante troppo corto
    torna com'è, una data impossibile solo riscritta."""
    if not istante or len(istante) < 12:
        return istante
    try:
        moment = datetime.datetime.strptime(istante[:12], '%Y%m%d%H%M')
    except ValueError:
        return f'{istante[0:4]}-{istante[4:6]}-{istante[6:8]}T{istante[8:10]}:{istante[10:12]}'
    return civil_time(moment).strftime('%Y-%m-%dT%H:%M')


def civil_time(solar):
    """L'ora civile italiana di un'ora solare: un'ora in più quando è in vigore l'ora legale."""
    if comune.is_dst_solar(solar):
        return solar + datetime.timedelta(hours=1)
    return solar


def load_coords(path):
    """{scode: (lat, lon)} da un CSV scode,lat,lon,... (FVG/stazioni_coords.csv), senza le righe con #
    e l'intestazione; {} se il file non c'è."""
    coords = {}
    if not os.path.exists(path):
        return coords
    with open(path, encoding='utf-8') as fp:
        for line in fp:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split(',')
            if parts[0] == 'scode' or len(parts) < 3:
                continue
            lat = coordinate(parts[1])
            lon = coordinate(parts[2])
            if lat is not None and lon is not None:
                coords[parts[0]] = (lat, lon)
    return coords


def coordinate(value):
    """Il numero di una coordinata, o None: NaN e infinito non sono JSON e nel geojson toglierebbero
    dalla mappa tutta la regione."""
    number = comune.to_float(value)
    if number is None or not math.isfinite(number):
        return None
    return number


if __name__ == '__main__':
    main()
