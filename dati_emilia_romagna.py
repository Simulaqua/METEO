#!/usr/bin/env python3
# dati_emilia_romagna.py - stazioni ARPAE dell'Emilia-Romagna (ER), API della mappa "Allerta Meteo" (JSON).
# Per ogni variabile (descrittore BUFR) una chiamata dà tutte le stazioni a un istante; in testa alla risposta
# {'time': epoch in ms UTC} è l'istante dei valori, un'ora prima del time chiesto.
# Ogni giro aggiunge i valori a ER/data-parsed/<VAR>/<VAR>-AAAAMMGG.json (ora solare): un punto a giro, più
# i quarti d'ora recenti che mancano, quindi il cron lo lancia ogni 15 minuti.
# Uso: python3 dati_emilia_romagna.py [--debug]
import argparse
import bisect
import datetime
import glob
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
# l'istante del giro è l'ultimo campione di livello di questa stazione (Cesenatico porto, affidabile),
# arrotondato per difetto al quarto d'ora
REF_STATION = '5444'
QUARTER_MS = 15 * 60 * 1000
# il campione di riferimento a volte salta un quarto d'ora e un giro fallito ne perde uno: ogni giro chiede
# anche i quarti delle ultime 2 ore che mancano nell'archivio (un buco più lungo lo ricuce recover.py)
BACKFILL_QUARTERS = 8
# il feed dà la temperatura in kelvin e la pressione in pascal
VALUE_CONV = {
    'TEMP': lambda v: round(v - 273.15, 1),
    'PRESS': lambda v: round(v / 100.0, 1),
}


def call(endpoint, params, timeout, debug=False):
    """La risposta di API_URL + endpoint; requests.RequestException su errore di rete o di HTTP."""
    if debug:
        print(API_URL + endpoint, params)
    r = comune.get(API_URL + endpoint, params=params, timeout=timeout)
    r.raise_for_status()
    return r


def quarter_hour(ms):
    """Epoch in ms arrotondato per difetto al quarto d'ora: le stazioni misurano ogni 15 minuti."""
    return ms - ms % QUARTER_MS


def reference_time(debug=False):
    """Istante del giro (epoch in ms UTC): ultimo campione di REF_STATION, o l'ora attuale se la serie è vuota
    o illeggibile, al quarto d'ora. Un errore di rete o di HTTP ferma il giro."""
    params = {'stazione': REF_STATION, 'variabile': VARIABLES['LIVIDRO'][0]}
    try:
        r = call('get-time-series', params, 60, debug)
    except requests.RequestException as error:
        sys.exit('Error downloading get-time-series: ' + str(error))
    try:
        series = json.loads(r.content.decode('utf-8', 'replace'))
        if series:
            return quarter_hour(int(series[-1]['t']))
    except Exception:                       # non JSON, o forma diversa da [{'t': ...}, ...]
        pass
    return quarter_hour(
        int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000))


def fetch(var, time_ms, path, debug=False):
    """Salva in path la risposta di var al time chiesto e restituisce l'istante dei suoi valori (None se
    manca); requests.RequestException su errore di rete o di HTTP."""
    r = call('get-sensor-values-no-time', {'variabile': VARIABLES[var][0], 'time': str(time_ms)}, 90, debug)
    with open(path, 'wb') as fp:
        fp.write(r.content)
    try:
        return answer_time(json.loads(r.content.decode('utf-8', 'replace')))
    except ValueError:
        return None


def download(debug=False):
    """Scarica la risposta di ogni variabile in DOWNLOAD_DIR/dati/ (un file ciascuna), poi quelle dei quarti
    d'ora mancanti; restituisce il prefisso del giro AAAAMMGG-HHMMSS. Una variabile che non arriva si
    salta."""
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    os.makedirs(folder, exist_ok=True)
    os.makedirs(PARSE_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    ref_ms = reference_time(debug)
    print('Istante di riferimento (UTC ms): %d  (%s UTC)'
          % (ref_ms, datetime.datetime.utcfromtimestamp(ref_ms / 1000).strftime('%Y-%m-%d %H:%M')))
    # time = istante del giro: la risposta ha i valori di un'ora prima. Un'ora più tardi darebbero valori
    # freschi, ma il 3-9% non è ancora arrivato e non si recupererebbe più
    answered = []
    for var in sorted(VARIABLES):
        name = stamp + '-' + var + '.json'
        try:
            answered.append(fetch(var, ref_ms, os.path.join(folder, name), debug))
        except requests.RequestException as error:
            print('SKIP %s (%s)' % (name, error))
    answered = [ms for ms in answered if ms is not None]
    if answered:
        backfill(folder, stamp, ref_ms, ref_ms - answered[0], debug)
    return stamp


def backfill(folder, stamp, ref_ms, lag_ms, debug=False):
    """Scarica, dal più vecchio, i quarti d'ora prima di ref_ms che mancano nell'archivio (file
    <prefisso>-<VAR>-<time>.json); al primo errore di rete smette, li chiede il giro dopo."""
    for time_ms in missing_times(ref_ms, lag_ms):
        for var in sorted(VARIABLES):
            name = '%s-%s-%d.json' % (stamp, var, time_ms)
            try:
                fetch(var, time_ms, os.path.join(folder, name), debug)
            except requests.RequestException as error:
                print('SKIP %s (%s)' % (name, error))
                return


def missing_times(ref_ms, lag_ms):
    """I time dei BACKFILL_QUARTERS quarti d'ora prima di ref_ms la cui risposta (con i valori di lag_ms
    prima) manca nell'archivio, dal più vecchio. Solo dopo il primo quarto che c'è: con l'archivio vuoto o
    dopo un buco più lungo della finestra non si chiede niente."""
    times = [ref_ms - k * QUARTER_MS for k in range(BACKFILL_QUARTERS, 0, -1)]
    moments = [solar_moment(time_ms - lag_ms) for time_ms in times]
    saved = saved_moments({moment[:8] for moment in moments})
    present = [i for i, moment in enumerate(moments) if moment in saved]
    if not present:
        return []
    first = present[0]
    return [time_ms for time_ms, moment in zip(times[first:], moments[first:]) if moment not in saved]


def saved_moments(days):
    """Gli istanti (ora solare) che l'archivio ha in almeno una variabile, nei file dei giorni days."""
    saved = set()
    for var in VARIABLES:
        for day in days:
            archive = comune.load_json(os.path.join(PARSE_DIR, var, var + '-' + day + '.json'))
            for record in archive.values():
                saved.update(record.get('MISURE', {}).get('ISTANTE', []))
    return saved


def answer_time(readings):
    """Istante dei valori di una risposta (epoch in ms UTC), da {'time': ...} in testa; None se manca."""
    try:
        return int(readings[0]['time'])
    except (IndexError, KeyError, TypeError, ValueError):
        return None


def solar_moment(ms):
    """Epoch in ms (UTC) -> AAAAMMGGhhmm in ora solare (UTC+1), ai 15 minuti."""
    moment = datetime.datetime.utcfromtimestamp(ms / 1000)
    moment = moment.replace(minute=moment.minute // 15 * 15, second=0, microsecond=0)
    return comune.utc_to_solar(moment)


def coordinate(value):
    """lat o lon del feed, gradi per 100000 (lon=1240132 -> 12.40132) -> gradi; None se manca o è circa 0."""
    number = comune.to_float(value)
    if number is None:
        return None
    degrees = number / 100000.0
    return degrees if abs(degrees) > 0.001 else None


def add_answer(path, var, stations, debug=False):
    """Mette i valori della risposta in path nel file del giorno di var, a ogni stazione che non ha già
    quell'istante; restituisce l'istante e le letture aggiunte, None se la risposta non ha l'istante."""
    readings = comune.load_json(path)
    answered_ms = answer_time(readings)
    if answered_ms is None:
        print('WARN: [ER] variabile %s saltata (risposta senza istante)' % var)
        return None
    moment = solar_moment(answered_ms)
    day_path = os.path.join(PARSE_DIR, var, var + '-' + moment[:8] + '.json')
    archive = comune.load_json(day_path)
    added = 0
    for item in readings:
        if not isinstance(item, dict) or 'idstazione' not in item:
            continue                        # il primo elemento è l'intestazione {'time': ...}
        value = item.get('value')
        if value is None or item.get('precedente') == 'S':
            # nessun campione a quell'istante; con 'precedente' S è un valore ripetuto: la pioggia di
            # 30 minuti alle :15 e alle :45 si conterebbe due volte nelle somme di derive.py
            continue
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
            # prende le coordinate del primo valore che le ha; STAZIONE è lo stesso dizionario,
            # quindi le prendono anche i record creati in questo giro
            stations[code]['LAT'] = lat
            stations[code]['LON'] = lon
        if code not in archive:
            archive[code] = {
                'STAZIONE': stations[code],
                'UM': VARIABLES[var][1],
                'MISURE': {'ISTANTE': [], 'VALORE': []}
            }
        measures = archive[code]['MISURE']
        if moment in measures['ISTANTE']:
            continue
        at = bisect.bisect(measures['ISTANTE'], moment)
        measures['ISTANTE'].insert(at, moment)
        measures['VALORE'].insert(at, value)
        added += 1
    comune.save_json(archive, day_path)
    if debug:
        print('  %s: %d stazioni' % (os.path.basename(day_path), len(archive)))
    return moment, added


def parse(stamp, debug=False):
    """Le risposte del giro, quella dell'istante del giro e quelle dei quarti d'ora mancanti, vanno nei file
    del giorno (vedi add_answer); una risposta senza istante si salta, con un avviso.
    In stazioni.json entrano le stazioni con un valore, con nome e coordinate della prima apparizione."""
    for var in sorted(VARIABLES):
        os.makedirs(os.path.join(PARSE_DIR, var), exist_ok=True)
    stations = comune.load_json(STATIONS_JSON)
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    moments = set()
    added = 0
    # in ordine alfabetico: se un file rotto ferma il giro, restano scritte le variabili precedenti
    for var in sorted(VARIABLES):
        paths = [os.path.join(folder, stamp + '-' + var + '.json')]
        paths += sorted(glob.glob(os.path.join(folder, stamp + '-' + var + '-*.json')))
        for path in paths:
            if not os.path.exists(path):
                continue                    # non scaricata in questo giro
            result = add_answer(path, var, stations, debug)
            if result:
                moments.add(result[0])
                added += result[1]
    comune.save_json(stations, STATIONS_JSON, sort_keys=True)
    print('[ER] istante %s | nuove letture inserite: %d' % (', '.join(sorted(moments)) or '-', added))


def main():
    ap = argparse.ArgumentParser(description="Stazioni ARPAE dell'Emilia-Romagna (mappa Allerta Meteo).")
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== EMILIA-ROMAGNA (ARPAE) %s ===' %
          datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    stamp = download(debug=args.debug)
    parse(stamp, debug=args.debug)
    # solo dopo un parse riuscito: i file di un giro fallito restano, li toglie la pulizia notturna
    comune.delete_downloaded(DOWNLOAD_DIR, [RAW_SUBDIR], stamp, debug=args.debug)


if __name__ == '__main__':
    main()
