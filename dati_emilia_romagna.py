#!/usr/bin/env python3
# dati_emilia_romagna.py - stazioni ARPAE dell'Emilia-Romagna (codice ER), dall'API della mappa "Allerta Meteo" della
# Regione (JSON). Una variabile si chiede con il suo descrittore (un codice BUFR, quelli della mappa ufficiale):
#   API_URL + get-time-series             la serie di una stazione: [{'t': epoch in ms UTC, 'v': valore}, ...]
#   API_URL + get-sensor-values-no-time   tutte le stazioni di una variabile con il valore a un istante, il nome e le
#                                         coordinate (gradi WGS84 per 100000)
# Ogni giro prende come istante l'ultimo campione del livello di REF_STATION, scarica in ER/data-downloaded/dati/ il
# valore di ogni stazione a quell'istante per ogni variabile, lo aggiunge al file del giorno
# (ER/data-parsed/<VAR>/<VAR>-AAAAMMGG.json, in ora solare, istante arrotondato ai 15 minuti) e poi cancella i file
# scaricati: la serie cresce di un punto a giro, per questo il cron lo lancia ogni 15 minuti.
# Uso: python3 dati_emilia_romagna.py [--debug]
import argparse
import datetime
import json
import os
import sys

import requests

import comune

API_URL = 'https://allertameteo.regione.emilia-romagna.it/o/api/allerta/'
DOWNLOAD_DIR = os.path.join(comune.region_dir('ER'), 'data-downloaded')
RAW_SUBDIR = 'dati'
PARSE_DIR = os.path.join(comune.region_dir('ER'), 'data-parsed')
STATIONS_JSON = os.path.join(PARSE_DIR, 'stazioni.json')
# variabile -> descrittore per l'API e unità di misura nei file
VARIABLES = {
    'TEMP': ('254,0,0/103,2000,-,-/B12101', '°C'),         # temperatura a 2 m
    'PREC': ('1,0,1800/1,-,-,-/B13011', 'mm'),             # pioggia cumulata in 30 minuti
    'UMID': ('254,0,0/103,2000,-,-/B13003', '%'),          # umidità relativa a 2 m
    'VVENTO': ('254,0,0/103,10000,-,-/B11002', 'm/s'),     # velocità del vento a 10 m
    'PRESS': ('254,0,0/1,-,-,-/B10004', 'hPa'),
    'LIVIDRO': ('254,0,0/1,-,-,-/B13215', 'm'),            # livello idrometrico
}
# l'istante del giro è l'ultimo campione del livello di questa stazione (Cesenatico porto, un idrometro affidabile)
REF_STATION = '5444'
# il feed dà la temperatura in kelvin e la pressione in pascal
VALUE_CONV = {
    'TEMP': lambda v: round(v - 273.15, 1),
    'PRESS': lambda v: round(v / 100.0, 1),
}


def call(endpoint, params, timeout, debug=False):
    """La risposta di API_URL + endpoint; requests.RequestException su un errore di rete o uno stato HTTP di errore."""
    if debug:
        print(API_URL + endpoint, params)
    r = comune.get(API_URL + endpoint, params=params, timeout=timeout)
    r.raise_for_status()
    return r


def reference_time(debug=False):
    """L'istante del giro (epoch in ms UTC): l'ultimo campione del livello di REF_STATION, o l'ora attuale se la serie è
    vuota o non si legge. Un errore di rete o di HTTP ferma il giro."""
    params = {'stazione': REF_STATION, 'variabile': VARIABLES['LIVIDRO'][0]}
    try:
        r = call('get-time-series', params, 60, debug)
    except requests.RequestException as error:
        sys.exit('Error downloading get-time-series: ' + str(error))
    try:
        series = json.loads(r.content.decode('utf-8', 'replace'))
        if series:
            return int(series[-1]['t'])
    except Exception:                       # non JSON, o una forma diversa da [{'t': ...}, ...]
        pass
    return int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)


def download(debug=False):
    """L'istante del giro e il valore di ogni stazione a quell'istante, una variabile per file, in DOWNLOAD_DIR/dati/
    con il prefisso del giro AAAAMMGG-HHMMSS (restituito). Una variabile che non arriva si salta."""
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    # tutte e due le cartelle subito: anche un giro che si ferma alla prima chiamata le lascia
    os.makedirs(folder, exist_ok=True)
    os.makedirs(PARSE_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    ref_ms = reference_time(debug)
    print('Istante di riferimento (UTC ms): %d  (%s UTC)'
          % (ref_ms, datetime.datetime.utcfromtimestamp(ref_ms / 1000).strftime('%Y-%m-%d %H:%M')))
    comune.save_json({'ref_ms': ref_ms}, os.path.join(folder, stamp + '-ref.json'))
    for var in sorted(VARIABLES):
        name = stamp + '-' + var + '.json'
        try:
            r = call('get-sensor-values-no-time', {'variabile': VARIABLES[var][0], 'time': str(ref_ms)}, 90, debug)
        except requests.RequestException as error:
            print('SKIP %s (%s)' % (name, error))
            continue
        with open(os.path.join(folder, name), 'wb') as fp:
            fp.write(r.content)
    return stamp


def solar_moment(ms):
    """Epoch in ms (UTC) -> AAAAMMGGhhmm in ora solare (UTC+1), come tutto l'archivio, arrotondato ai 15 minuti."""
    moment = datetime.datetime.utcfromtimestamp(ms / 1000)
    moment = moment.replace(minute=moment.minute // 15 * 15, second=0, microsecond=0)
    return (moment + datetime.timedelta(hours=1)).strftime('%Y%m%d%H%M')


def coordinate(value):
    """lat o lon del feed, gradi per 100000 (lon=1240132 -> 12.40132) -> gradi; None se manca o è circa 0."""
    number = comune.to_float(value)
    if number is None:
        return None
    degrees = number / 100000.0
    return degrees if abs(degrees) > 0.001 else None


def parse(stamp, debug=False):
    """Per ogni variabile, il valore di ogni stazione va nel file del giorno dell'istante del giro, se è più recente
    dell'ultimo già salvato. In stazioni.json entrano le stazioni con un valore, con il nome e le coordinate di quando
    compaiono la prima volta."""
    for var in sorted(VARIABLES):           # tutte le cartelle, anche delle variabili senza valori in questo giro
        os.makedirs(os.path.join(PARSE_DIR, var), exist_ok=True)
    stations = comune.load_json(STATIONS_JSON)
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    moment = solar_moment(comune.load_json(os.path.join(folder, stamp + '-ref.json'))['ref_ms'])
    added = 0
    # in ordine alfabetico, ogni variabile salvata prima della successiva: se un file rotto ferma il giro, restano
    # scritte le variabili che vengono prima nell'alfabeto
    for var in sorted(VARIABLES):
        path = os.path.join(folder, stamp + '-' + var + '.json')
        if not os.path.exists(path):
            continue                        # non scaricata in questo giro
        readings = comune.load_json(path)
        unit = VARIABLES[var][1]
        day_path = os.path.join(PARSE_DIR, var, var + '-' + moment[:8] + '.json')
        archive = comune.load_json(day_path)
        for item in readings:
            if not isinstance(item, dict) or 'idstazione' not in item:
                continue                    # il primo elemento è l'intestazione {'time': ...}
            value = item.get('value')
            if value is None:
                continue                    # la stazione non ha un campione a quell'istante
            if var in VALUE_CONV:
                try:
                    value = VALUE_CONV[var](float(value))
                except (TypeError, ValueError):
                    continue
            code = item.get('idstazione')
            lat, lon = coordinate(item.get('lat')), coordinate(item.get('lon'))
            if code not in stations:
                stations[code] = {'SCODE': code, 'NOME': item.get('nomestaz'), 'LAT': lat, 'LON': lon}
            elif stations[code].get('LAT') is None and lat is not None:
                # una stazione salvata senza coordinate prende quelle del primo valore che le ha; nei record creati in
                # questo giro STAZIONE è lo stesso dizionario, quindi le prendono anche loro
                stations[code]['LAT'] = lat
                stations[code]['LON'] = lon
            if code not in archive:
                archive[code] = {'STAZIONE': stations[code], 'UM': unit, 'MISURE': {'ISTANTE': [], 'VALORE': []}}
            measures = archive[code]['MISURE']
            if measures['ISTANTE'] and int(moment) <= int(measures['ISTANTE'][-1]):
                continue                    # già salvato: la stazione non ha ancora un valore più recente
            measures['ISTANTE'].append(moment)
            measures['VALORE'].append(value)
            added += 1
        comune.save_json(archive, day_path)
        if debug:
            print('  %s: %d stazioni' % (os.path.basename(day_path), len(archive)))
    comune.save_json(stations, STATIONS_JSON, sort_keys=True)
    print('[ER] istante %s | nuove letture inserite: %d' % (moment, added))


def main():
    ap = argparse.ArgumentParser(description="Stazioni ARPAE dell'Emilia-Romagna (mappa Allerta Meteo).")
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== EMILIA-ROMAGNA (ARPAE) %s ===' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    stamp = download(debug=args.debug)
    parse(stamp, debug=args.debug)
    # solo dopo un parse riuscito (un errore esce prima): i file di un giro fallito restano, li toglie la pulizia
    # notturna del cron
    comune.delete_downloaded(DOWNLOAD_DIR, [RAW_SUBDIR], stamp, debug=args.debug)


if __name__ == '__main__':
    main()
