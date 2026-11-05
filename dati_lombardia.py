#!/usr/bin/env python3
# dati_lombardia.py - stazioni meteo e idrometriche di ARPA Lombardia (codice LOM), dagli Open Data della Regione
# (portale Socrata, JSON). Due dataset:
#   DATA_URL       le letture a 10 minuti: idsensore, data ('AAAA-MM-GGThh:mm:ss.000', già in ora solare), valore,
#                  idoperatore (un sensore ha più serie: media, massimo, cumulata...)
#   REGISTRY_URL   l'anagrafica dei sensori: tipologia, unità di misura, stazione (codice, nome, quota, provincia),
#                  coordinate
# Ogni giro scarica le letture degli ultimi WINDOW_MINUTES minuti del dataset in LOM/data-downloaded/dati/, aggiunge
# ai file del giorno di ogni lettura (LOM/data-parsed/<VAR>/<VAR>-AAAAMMGG.json) quelle successive all'ultima già
# salvata e poi cancella il file scaricato. Il portale limita le chiamate anonime (HTTP 429): ogni chiamata si riprova
# con pause crescenti e, se non basta, il giro si ferma senza lasciare file scaricati né dati scritti.
# Uso: python3 dati_lombardia.py [--debug]
import argparse
import datetime
import json
import os
import re
import sys
import time

import requests

import comune

DATA_URL = 'https://www.dati.lombardia.it/resource/647i-nhxk.json'
REGISTRY_URL = 'https://www.dati.lombardia.it/resource/nf78-nj6b.json'
DOWNLOAD_DIR = os.path.join(comune.region_dir('LOM'), 'data-downloaded')
RAW_SUBDIR = 'dati'
PARSE_DIR = os.path.join(comune.region_dir('LOM'), 'data-parsed')
STATIONS_JSON = os.path.join(PARSE_DIR, 'stazioni.json')
# l'anagrafica (620 KB) cambia di rado: se ne tiene una copia, riscaricata al più ogni REGISTRY_TTL_H ore. Il nome è
# senza trattino perché la compressione notturna comprime i '*-*.json'
REGISTRY_JSON = os.path.join(PARSE_DIR, 'anagrafica.json')
REGISTRY_TTL_H = 24
# 3 ore: la serie di tutte le stazioni anche se qualche giro salta (circa 19000 righe). Le righe arrivano dalla più
# vecchia e una chiamata ne dà al massimo 50000: una finestra più larga, senza paginare, perderebbe le più recenti
WINDOW_MINUTES = 180
# pause (secondi) prima dei nuovi tentativi di una chiamata, e gli stati HTTP che si riprovano
RETRY_WAITS = (5, 15, 30)
RETRY_CODES = (429, 500, 502, 503, 504)
# i file scaricati più vecchi di STALE_HOURS ore sono di un giro interrotto (riavvio, crash): si cancellano
STALE_HOURS = 6
RAW_NAME = re.compile(r'^\d{8}-\d{6}-(anagrafica|dati)\.json(\.tmp)?$')
# variabile -> tipologia dei suoi sensori nell'anagrafica
VARIABLES = {
    'TEMP': 'Temperatura',
    'PREC': 'Precipitazione',
    'UMID': 'Umidità Relativa',
    'VVENTO': 'Velocità Vento',
    'DVENTO': 'Direzione Vento',
    'RADSOL': 'Radiazione Globale',
    'LIVIDRO': 'Livello Idrometrico',
    'LIVNEVE': 'Altezza Neve',
}
# ogni sensore ha una serie per idoperatore: si tiene la '1' (media o valore istantaneo), per la pioggia la '4'
# (cumulata)
OPERATORS = {'PREC': '4'}
# valori che si scartano: dato mancante (-999 avvelenava le somme di pioggia) e, solo per la direzione del vento,
# calma (777, 7777) e vento variabile (888, 8888)
SKIP_VALUES = {'-9999', '-9999.0', '-999', '-999.0'}
SKIP_DIR_VALUES = {'777', '7777', '888', '8888'}


class DownloadError(Exception):
    """Una chiamata al portale non riuscita: il giro si ferma con questo messaggio."""


def fetch_json(url, params, timeout, debug=False):
    """Il corpo e la lista JSON di una risorsa Socrata. Su 429 o 5xx, errore di rete, risposta non JSON o che non è
    una lista (con il 429 il portale manda un dizionario di errore) si riprova dopo le pause di RETRY_WAITS, poi
    DownloadError; un altro stato di errore dà subito DownloadError."""
    if debug:
        print(url, params)
    detail = ''
    for wait in (0,) + RETRY_WAITS:
        if wait:
            print('   %s -> riprovo fra %d s' % (detail, wait), flush=True)
            time.sleep(wait)
        try:
            r = comune.get(url, params=params, timeout=timeout)
        except requests.RequestException as error:
            detail = 'rete: ' + str(error)[:100]
            continue
        if r.status_code in RETRY_CODES:
            detail = 'HTTP ' + str(r.status_code)
            continue
        if r.status_code != 200:
            raise DownloadError('Error downloading ' + url + ': HTTP ' + str(r.status_code))
        try:
            data = json.loads(r.content.decode('utf-8', 'replace'))
        except ValueError:
            detail = 'risposta non JSON'
            continue
        if not isinstance(data, list):
            detail = 'risposta inattesa: ' + str(data)[:80]
            continue
        return r.content, data
    raise DownloadError('Error downloading ' + url + ': ' + detail)


def write_atomic(content, path):
    """Su un .tmp e poi rinominato: un riavvio a metà scrittura non lascia un file monco."""
    tmp = path + '.tmp'
    with open(tmp, 'wb') as fp:
        fp.write(content)
        fp.flush()
        os.fsync(fp.fileno())
    os.replace(tmp, path)


def remove_orphans(folder):
    """Cancella i file scaricati da giri interrotti (riavvio, crash, parse fallito) più vecchi di STALE_HOURS ore:
    quelli di un giro in corso hanno pochi minuti."""
    limit = time.time() - STALE_HOURS * 3600
    removed = freed = 0
    for name in os.listdir(folder):
        if not RAW_NAME.match(name):
            continue
        path = os.path.join(folder, name)
        try:
            if os.path.getmtime(path) < limit:
                size = os.path.getsize(path)
                os.remove(path)
                removed += 1
                freed += size
        except OSError:
            pass
    if removed:
        print('Grezzi orfani rimossi: %d (%s MB)' % (removed, round(freed / 1048576.0, 1)))


def refresh_registry(debug=False):
    """L'anagrafica in REGISTRY_JSON, riscaricata se la copia ha più di REGISTRY_TTL_H ore, è vuota o non si legge. Se
    il portale non la dà si tiene la copia che c'è; senza una copia, DownloadError."""
    have = False
    if os.path.exists(REGISTRY_JSON):
        copy = comune.load_json(REGISTRY_JSON)
        have = isinstance(copy, list) and len(copy) > 0
        age_h = (time.time() - os.path.getmtime(REGISTRY_JSON)) / 3600.0
        if have and age_h < REGISTRY_TTL_H:
            print('anagrafica sensori: copia di %s h riusata (%d sensori)' % (round(age_h, 1), len(copy)))
            return
    try:
        content, data = fetch_json(REGISTRY_URL, {'$limit': '10000'}, 90, debug)
        if not data:
            raise DownloadError('Error downloading ' + REGISTRY_URL + ': anagrafica vuota')
    except DownloadError as error:
        if have:
            print('WARN: anagrafica non aggiornata (' + str(error) + '), uso la copia precedente')
            return
        raise
    write_atomic(content, REGISTRY_JSON)
    print('anagrafica sensori: scaricata (%d sensori, %d bytes)' % (len(data), len(content)))


def download(debug=False):
    """Le letture della finestra in DOWNLOAD_DIR/dati/, con il prefisso del giro AAAAMMGG-HHMMSS (restituito), e
    l'anagrafica in REGISTRY_JSON. DownloadError se il portale non risponde."""
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    # tutte e due le cartelle subito: anche un giro che si ferma alla prima chiamata le lascia
    os.makedirs(folder, exist_ok=True)
    os.makedirs(PARSE_DIR, exist_ok=True)
    remove_orphans(folder)                  # prima delle chiamate: pulisce anche quando il portale non risponde
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    # prima l'ultimo istante del dataset, con una chiamata leggera: se il portale limita le chiamate lo si scopre prima
    # di scaricare il resto, e la finestra segue il ritardo con cui il portale pubblica
    _, latest = fetch_json(DATA_URL, {'$select': 'data', '$order': 'data DESC', '$limit': '1'}, 60, debug)
    if latest and latest[0].get('data'):
        end = datetime.datetime.strptime(latest[0]['data'][:19], '%Y-%m-%dT%H:%M:%S')
    else:
        end = comune.now_solar()
    start = (end - datetime.timedelta(minutes=WINDOW_MINUTES)).strftime('%Y-%m-%dT%H:%M:%S')
    print('Finestra dati da ' + start + ' in poi')
    content, _ = fetch_json(DATA_URL, {'$where': "data > '" + start + "'", '$order': 'data', '$limit': '50000'}, 90,
                            debug)
    path = os.path.join(folder, stamp + '-dati.json')
    write_atomic(content, path)
    try:
        refresh_registry(debug)
    except BaseException:
        # anche su un'interruzione: un giro che si ferma qui non lascia il file delle letture
        try:
            os.remove(path)
        except OSError:
            pass
        raise
    return stamp


def coordinate(value):
    """Gradi WGS84; None se manca o è 0 (così l'anagrafica scrive una coordinata che non ha)."""
    degrees = comune.to_float(value)
    return degrees if degrees is not None and abs(degrees) > 0.001 else None


def compact_moment(text):
    """'AAAA-MM-GGThh:mm:ss.000' -> AAAAMMGGhhmm, così com'è: il portale dà già l'ora solare dell'archivio. None se la
    data manca."""
    try:
        return text[0:4] + text[5:7] + text[8:10] + text[11:13] + text[14:16]
    except TypeError:
        return None


def parse(stamp, debug=False):
    """Ogni lettura scaricata va nel file del suo giorno, se è più recente dell'ultima già salvata per quella stazione.
    In stazioni.json entrano le stazioni con letture, con i dati dell'anagrafica di quando compaiono la prima volta."""
    for var in sorted(VARIABLES):           # tutte le cartelle, anche delle variabili senza letture in questo giro
        os.makedirs(os.path.join(PARSE_DIR, var), exist_ok=True)
    stations = comune.load_json(STATIONS_JSON)
    registry = comune.load_json(REGISTRY_JSON)
    if not isinstance(registry, list):
        registry = []
    sensors = {item.get('idsensore'): item for item in registry}
    readings = comune.load_json(os.path.join(DOWNLOAD_DIR, RAW_SUBDIR, stamp + '-dati.json'))
    if not isinstance(readings, list):
        readings = []
    var_of_type = {sensor_type: var for var, sensor_type in VARIABLES.items()}
    day_files = {var: {} for var in VARIABLES}  # variabile -> {percorso: contenuto}, letto la prima volta che serve
    added = 0
    for reading in readings:
        sensor = sensors.get(reading.get('idsensore'))
        if sensor is None:
            continue
        var = var_of_type.get(sensor.get('tipologia'))
        if var is None or reading.get('idoperatore') != OPERATORS.get(var, '1'):
            continue
        value = reading.get('valore')
        if value is None or value in SKIP_VALUES or (var == 'DVENTO' and value in SKIP_DIR_VALUES):
            continue
        moment = compact_moment(reading.get('data'))
        code = sensor.get('idstazione')
        if moment is None or code is None:
            continue
        if code not in stations:
            stations[code] = {'SCODE': code, 'NOME': sensor.get('nomestazione'), 'LAT': coordinate(sensor.get('lat')),
                              'LON': coordinate(sensor.get('lng')), 'QUOTA': sensor.get('quota'),
                              'PROVINCIA': sensor.get('provincia')}
        elif stations[code].get('LAT') is None and coordinate(sensor.get('lat')) is not None:
            # una stazione salvata senza coordinate prende quelle di un altro suo sensore; nei record creati in questo
            # giro STAZIONE è lo stesso dizionario, quindi le prendono anche loro
            stations[code]['LAT'] = coordinate(sensor.get('lat'))
            stations[code]['LON'] = coordinate(sensor.get('lng'))
        path = os.path.join(PARSE_DIR, var, var + '-' + moment[:8] + '.json')
        if path not in day_files[var]:
            day_files[var][path] = comune.load_json(path)
        archive = day_files[var][path]
        if code not in archive:
            archive[code] = {'STAZIONE': stations[code], 'UM': sensor.get('unit_dimisura'),
                             'MISURE': {'ISTANTE': [], 'VALORE': []}}
        measures = archive[code]['MISURE']
        if measures['ISTANTE'] and int(moment) <= int(measures['ISTANTE'][-1]):
            continue                        # già salvata: ogni giro riscarica tutta la finestra
        measures['ISTANTE'].append(moment)
        measures['VALORE'].append(value)
        added += 1
    # in ordine alfabetico: se una scrittura si ferma (disco pieno, permessi), restano scritte le variabili che vengono
    # prima nell'alfabeto
    for var in sorted(VARIABLES):
        for path, archive in day_files[var].items():
            comune.save_json(archive, path)
            if debug:
                print('  %s: %d stazioni' % (os.path.basename(path), len(archive)))
    comune.save_json(stations, STATIONS_JSON, sort_keys=True)
    print('[LOM] letture scaricate: %d | nuove letture inserite: %d' % (len(readings), added))


def main():
    ap = argparse.ArgumentParser(description='Stazioni meteo e idrometriche di ARPA Lombardia.')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== LOMBARDIA (ARPA Lombardia) %s ===' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    try:
        stamp = download(debug=args.debug)
    except DownloadError as error:
        sys.exit(str(error))                # il portale limita le chiamate o non risponde: riprova il prossimo giro
    parse(stamp, debug=args.debug)
    # solo dopo un parse riuscito (un errore esce prima): i file di un giro fallito restano, li toglie remove_orphans
    comune.delete_downloaded(DOWNLOAD_DIR, [RAW_SUBDIR], stamp, debug=args.debug)


if __name__ == '__main__':
    main()
