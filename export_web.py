#!/usr/bin/env python3
# export_web.py - i file del sito dall'archivio. Di ogni regione legge gli ultimi N giorni (7 di solito) di
# <REGIONE>/data-parsed/<VAR>/<VAR>-AAAAMMGG.json[.gz] e scrive in <site-dir>/<REGIONE>/:
#   series/<SCODE>.csv     la serie di ogni stazione, una colonna per variabile (con le derivate di derive.py)
#   stations.geojson       le stazioni della mappa, con l'ultimo valore di ogni variabile
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
import math
import os
import sys

import comune
import derive
import quality

# le cartelle del sito, nell'ordine dell'export. Le reti AQ_, PC_, MAR_... sono archivi a sé, che il sito raggruppa
# sotto la voce geografica. PC_PO (AIPO) si pubblica intero, anche con le stazioni che hanno già ER e LOM (scelta
# dell'utente).
REGIONS = ['VEN', 'TN', 'BZ', 'FVG', 'LOM', 'ER', 'AQ_VEN', 'AQ_TN', 'AQ_BZ', 'AQ_LOM', 'AQ_ER', 'PC_FVG', 'PC_TN',
           'MAR_VEN', 'MAR_ER', 'MAR_FVG', 'ACQ_VEN', 'INV_ER', 'LIG', 'PC_PO', 'PC_PIE', 'PIE', 'LAGHI']
# i campi di stazioni.json con nome, latitudine e longitudine, dove non sono NOME, LAT e LON. In VEN X e Y sono lon e
# lat in EPSG:4258 (ETRS89 geografico); in FVG le coordinate non ci sono: vengono da FVG/stazioni_coords.csv
STATION_FIELDS = {'VEN': ('NOME', 'Y', 'X'),
                  'TN': ('nome', 'latitudine', 'longitudine'),
                  'BZ': ('NAME_I', 'LAT', 'LONG'),
                  'FVG': ('station_name', None, None)}

# il cursore del tempo: un fotogramma per ora tonda (solare) degli ultimi 7 giorni, con l'ultima lettura non più
# vecchia della tolleranza in minuti (più stretta per gli accumuli brevi, che non devono "invecchiare")
SNAP_VARS = ['TEMP', 'UMID', 'PRESS', 'VVENTO', 'VVENTOMAX', 'PREC1', 'PREC3', 'PREC6', 'PREC12', 'PREC24', 'PREC48']
SNAP_FRAMES = 168
SNAP_TOL_MIN = {'PREC1': 30, 'PREC3': 45, 'VVENTO': 60, 'VVENTOMAX': 60}
SNAP_TOL_DEF = 90
SNAP_DEC = {'UMID': 0}


def main():
    ap = argparse.ArgumentParser(description="I file del sito dagli ultimi giorni dell'archivio.")
    ap.add_argument('-r', '--region', required=True, choices=REGIONS + ['all'])
    ap.add_argument('-n', '--days', type=int, default=7, help='giorni della finestra (7)')
    ap.add_argument('--site-dir', required=True, help='cartella del sito: ogni regione in <site-dir>/<REGIONE>/')
    ap.add_argument('--series-dir', default='series', help='sottocartella delle serie (series30 per i 30 giorni)')
    ap.add_argument('--series-only', action='store_true', help='solo le serie: niente derivate, mappa, unità e cursore')
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
        export_region(region, parse_dir, os.path.join(args.site_dir, region), args.days, coords, args.series_dir,
                      args.series_only)


def export_region(region, parse_dir, out_dir, days, coords, series_subdir, series_only):
    """I file del sito di una regione in out_dir. coords = {scode: (lat, lon)} per le stazioni che in stazioni.json
    non hanno coordinate."""
    print('\n***  WEB EXPORT  ***   region ' + region)
    cutoff_dt = comune.now_solar() - datetime.timedelta(days=days)
    cutoff = cutoff_dt.strftime('%Y%m%d%H%M')
    # le somme di pioggia 1-48 h sono giuste anche all'inizio della finestra solo con la PREC dei 2 giorni prima: si
    # legge in più e si toglie dopo le derivate (l'export a 30 giorni non le calcola)
    prec_cutoff = cutoff
    if not series_only:
        prec_cutoff = (cutoff_dt - datetime.timedelta(days=2)).strftime('%Y%m%d%H%M')
    print('Keeping measures from ' + cutoff_dt.strftime('%Y-%m-%d %H:%M') + ' onward (last ' + str(days) + ' days)')

    data, units, station_meta = read_window(parse_dir, region, cutoff, prec_cutoff)
    print('Stations with data in window: ' + str(len(data)))

    # letture "azzerate" del datalogger (UMID=0 e TEMP=0 allo stesso istante): via prima delle derivate. Una serie
    # rimasta vuota (l'umidità sempre a zero) esce, e così una stazione rimasta senza serie: la mappa cerca l'ultimo
    # istante di ogni serie
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
    print('Export written to ' + out_dir)


def read_window(parse_dir, region, cutoff, prec_cutoff):
    """Dall'archivio della regione: data = {scode: {var: {istante: valore}}}, le letture plausibili da cutoff in poi
    (da prec_cutoff per la PREC); units = {var: unità}, l'ultima vista; station_meta = stazioni.json, più il blocco
    STAZIONE delle serie per le stazioni che non ci sono. I giorni si leggono in ordine: ne dipendono l'ordine delle
    stazioni, le unità e il blocco STAZIONE che resta."""
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
        # i file di ARPAV (VEN) non hanno UM: l'unità sta nel blocco SENSORE
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


def add_derived(data, units, station_meta):
    """Le grandezze derivate e gli indici di derive.py, calcolati dalle letture della finestra e mai archiviati: entrano
    in data come variabili, quindi nelle serie, in mappa e nel cursore."""
    try:
        for scode, per_var in data.items():
            for name, series in derive.derive_station(per_var, station_meta.get(scode, {})).items():
                if series:
                    per_var[name] = series
                    units[name] = derive.DERIVED_UM.get(name, '')
    except Exception as e:
        print('WARN: derivate non calcolate (' + str(e) + ')', file=sys.stderr)


def drop_extra_prec(data, cutoff):
    """Via la PREC prima di cutoff, letta solo per le somme, e le somme di quegli istanti; una stazione rimasta senza
    dati esce."""
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
    """stations.geojson con le stazioni che hanno coordinate (da stazioni.json, altrimenti da coords) e
    le altre sono solo nel log. Ritorna i codici delle stazioni in mappa."""
    name_field, lat_field, lon_field = STATION_FIELDS.get(region, ('NOME', 'LAT', 'LON'))
    features = []
    no_coord = []
    for scode, per_var in data.items():
        meta = station_meta.get(scode, {})
        name = meta.get(name_field) or scode
        lat = coordinate(meta.get(lat_field))
        lon = coordinate(meta.get(lon_field))
        if lat is not None and lon is not None and abs(lat) < 0.01 and abs(lon) < 0.01:
            lat = lon = None                    # 0,0 vuol dire "mancanti": la stazione finirebbe nell'oceano
        if (lat is None or lon is None) and scode in coords:
            lat, lon = coords[scode]
        if lat is None or lon is None:
            no_coord.append([scode, name])
        else:
            features.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                             'properties': station_properties(scode, name, per_var, zeros.get(scode))})
    comune.save_json({'type': 'FeatureCollection', 'name': region, 'features': features},
                     os.path.join(out_dir, 'stations.geojson'))
    print('Stations on map (with lat/lon): ' + str(len(features)))
    if no_coord:
        print('Stazioni senza coordinate, non in mappa: ' + str(len(no_coord)) + ' (' +
              ', '.join(scode for scode, _ in no_coord) + ')')
    return [feature['properties']['scode'] for feature in features]


def station_properties(scode, name, per_var, zero):
    """Le proprietà di una stazione in mappa: l'ultimo valore di ogni variabile e l'ora dell'ultima misura."""
    latest = {}
    latest_moment = None
    for var in sorted(per_var):
        moment = max(per_var[var])
        latest[var] = per_var[var][moment]
        # l'ora dell'ultima misura non guarda le derivate: quelle giornaliere (GDD, ET0...) sono segnate alle 12:00
        # solari, al mattino sarebbero "nel futuro" e falserebbero lo stato delle fonti e le stazioni in ritardo
        if var not in derive.DERIVED_UM and (latest_moment is None or moment > latest_moment):
            latest_moment = moment
    if latest_moment is None:
        latest_moment = max(max(series) for series in per_var.values())
    properties = {'scode': scode, 'name': name, 'variables': sorted(per_var), 'latest': latest,
                  'latest_time': iso_datetime(latest_moment), 'series': 'series/' + scode + '.csv'}
    # la quota dello zero idrometrico: il sito mostra il livello anche in quota assoluta
    if isinstance(zero, dict):
        zero = zero.get('zero')
    if zero is not None:
        properties['zero_idro'] = zero
    return properties


def write_snapshots(data, scodes, units, out_dir):
    """snap/<VAR>.json per le stazioni scodes: {"t": [epoch di ogni fotogramma], "u": unità, "s": {scode: [valore o
    null per fotogramma]}}. L'epoch è l'ora civile letta come se fosse UTC: il sito la mostra così com'è."""
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
                if i >= 0 and moments[i] >= oldest:
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
            comune.save_json({'t': epochs, 'u': units.get(var, ''), 's': series}, os.path.join(snap_dir, var + '.json'))
            written.add(var + '.json')
    # il file di una variabile che la regione non ha più non si riscriverebbe: il cursore mostrerebbe dati vecchi
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
    """AAAAMMGGhhmm in ora solare -> 'AAAA-MM-GGThh:mm' nell'ora civile italiana (legale d'estate). Un istante
    troppo corto torna com'è, una data impossibile solo riscritta."""
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
    """{scode: (lat, lon)} da un CSV scode,lat,lon,... (FVG/stazioni_coords.csv), senza le righe con # e
    l'intestazione; {} se il file non c'è."""
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
    """Il numero di una coordinata, o None: NaN e infinito non sono JSON, e nel geojson toglierebbero dalla mappa tutta
    la regione."""
    number = comune.to_float(value)
    if number is None or not math.isfinite(number):
        return None
    return number


if __name__ == '__main__':
    main()
