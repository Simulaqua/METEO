#!/usr/bin/env python3
# dati_altoadige.py - stazioni meteo e idrometriche della Provincia di Bolzano / Alto Adige (codice BZ), dagli Open
# Data della Provincia in JSON. Per tutta la rete bastano due chiamate:
#   STATIONS_URL   l'anagrafica delle stazioni (GeoJSON): SCODE, nomi in italiano e in tedesco, quota, coordinate
#   SENSORS_URL    l'ultima lettura di ogni sensore: SCODE, TYPE (la grandezza), UNIT, DATE ('AAAA-MM-GGThh:mm:ss'
#                  in ora locale seguita dal fuso, CET o CEST), VALUE
# Ogni giro scarica i due file in BZ/data-downloaded/dati/, aggiunge ogni lettura nuova al file del suo giorno
# (BZ/data-parsed/<VAR>/<VAR>-AAAAMMGG.json, in ora solare) e poi cancella i file scaricati: la serie cresce di un
# punto per sensore a giro, per questo il cron lo lancia ogni 10 minuti.
# Uso: python3 dati_altoadige.py [--debug]
import argparse
import datetime
import os
import re
import sys

import requests

import comune

STATIONS_URL = 'https://geoservices.buergernetz.bz.it/services/meteo/v1/stations'
SENSORS_URL = 'https://geoservices.buergernetz.bz.it/services/meteo/v1/sensors'
DOWNLOAD_DIR = os.path.join(comune.region_dir('BZ'), 'data-downloaded')
RAW_SUBDIR = 'dati'
PARSE_DIR = os.path.join(comune.region_dir('BZ'), 'data-parsed')
STATIONS_JSON = os.path.join(PARSE_DIR, 'stazioni.json')
# i campi che si tengono di una stazione dell'anagrafica, più 'coordinates' (il punto del GeoJSON, in metri UTM)
STATION_FIELDS = ('SCODE', 'NAME_I', 'NAME_D', 'ALT', 'LONG', 'LAT')
# variabile -> TYPE dei suoi sensori (l'unità di misura è nel campo UNIT di ogni lettura)
VARIABLES = {
    'TEMP': 'LT',
    'PREC': 'N',
    'UMID': 'LF',
    'PRESS': 'LD.RED',
    'RADSOL': 'GS',
    'SOLEGG': 'SD',                     # durata del soleggiamento
    'VVENTO': 'WG',
    'VVENTOMAX': 'WG.BOE',              # raffica
    'DVENTO': 'WR',
    'LIVNEVE': 'HS',                    # altezza della neve al suolo
    'LIVIDRO': 'W',
    'PORTATA': 'Q',
    'FREATICA': 'W.ABST',               # livello della falda
    'TEMPACQUA': 'WT',
    'SOLIDI': 'SSTF',                   # solidi sospesi
}


def fetch(url, path):
    """Salva in path il file di url, qualunque sia lo stato HTTP. Un errore di rete ferma il giro."""
    try:
        r = comune.get(url)
    except requests.RequestException as error:
        sys.exit('Error downloading ' + url + ': ' + str(error))
    with open(path, 'wb') as fp:
        fp.write(r.content)


def download():
    """L'anagrafica e le letture in DOWNLOAD_DIR/dati/, con il prefisso del giro AAAAMMGG-HHMMSS (restituito)."""
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    # tutte e due le cartelle subito: anche un giro che si ferma all'anagrafica le lascia
    os.makedirs(folder, exist_ok=True)
    os.makedirs(PARSE_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    fetch(STATIONS_URL, os.path.join(folder, stamp + '-stations.json'))
    fetch(SENSORS_URL, os.path.join(folder, stamp + '-sensors.json'))
    return stamp


def solar_moment(text):
    """'AAAA-MM-GGThh:mm:ss' seguito dal fuso, CET o CEST -> AAAAMMGGhhmm in ora solare (CET), come tutto l'archivio;
    None se manca o non si legge. Conta il fuso scritto dalla fonte, non la regola dell'ora legale: la notte in cui
    l'ora legale finisce, le letture fra le 02:00 e le 03:00 arrivano due volte, prima in CEST e poi in CET."""
    try:
        text = text.strip()
        zone = re.search(r'[A-Za-z]+$', text)
        moment = datetime.datetime.strptime(re.sub(r'[A-Za-z]+$', '', text), '%Y-%m-%dT%H:%M:%S')
        if zone and zone.group(0).upper() == 'CEST':
            moment -= datetime.timedelta(hours=1)
        return moment.strftime('%Y%m%d%H%M')
    except (ValueError, TypeError, AttributeError):         # campo mancante, vuoto o in un altro formato
        return None


def parse(stamp, debug=False):
    """Ogni lettura del giro va nel file del suo giorno, se è più recente dell'ultima già salvata per quella stazione.
    L'anagrafica scaricata si fonde in stazioni.json: i dati di una stazione si aggiornano, le stazioni che escono
    dall'anagrafica restano."""
    for var in VARIABLES:                   # tutte le cartelle, anche delle variabili senza letture in questo giro
        os.makedirs(os.path.join(PARSE_DIR, var), exist_ok=True)
    stations = comune.load_json(STATIONS_JSON)
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    for feature in comune.load_json(os.path.join(folder, stamp + '-stations.json')).get('features', []):
        properties = feature.get('properties', {})
        if properties.get('SCODE') is None:
            continue
        station = {field: properties.get(field) for field in STATION_FIELDS}
        station['coordinates'] = (feature.get('geometry') or {}).get('coordinates')
        stations[station['SCODE']] = station
    readings = comune.load_json(os.path.join(folder, stamp + '-sensors.json'))
    var_of_type = {sensor_type: var for var, sensor_type in VARIABLES.items()}
    day_files = {var: {} for var in VARIABLES}  # variabile -> {percorso: contenuto}, letto la prima volta che serve
    added = 0
    for reading in readings:
        var = var_of_type.get(reading.get('TYPE'))
        if var is None:
            continue
        moment = solar_moment(reading.get('DATE'))
        code = reading.get('SCODE')
        if moment is None or code is None:
            continue
        path = os.path.join(PARSE_DIR, var, var + '-' + moment[:8] + '.json')
        if path not in day_files[var]:
            day_files[var][path] = comune.load_json(path)
        archive = day_files[var][path]
        if code not in archive:
            archive[code] = {'STAZIONE': stations.get(code, {'SCODE': code}), 'UM': reading.get('UNIT'),
                             'MISURE': {'ISTANTE': [], 'VALORE': []}}
        measures = archive[code]['MISURE']
        if measures['ISTANTE'] and int(moment) <= int(measures['ISTANTE'][-1]):
            continue                        # già salvata: il sensore non ha ancora una lettura nuova
        measures['ISTANTE'].append(moment)
        measures['VALORE'].append(reading.get('VALUE'))
        added += 1
    # in ordine alfabetico: se una scrittura si ferma (disco pieno, permessi), restano scritte le variabili che vengono
    # prima nell'alfabeto
    for var in sorted(VARIABLES):
        for path, archive in day_files[var].items():
            comune.save_json(archive, path)
            if debug:
                print('  %s: %d stazioni' % (os.path.basename(path), len(archive)))
    comune.save_json(stations, STATIONS_JSON, sort_keys=True)
    print('[BZ] sensori: %d | nuove letture inserite: %d' % (len(readings), added))


def main():
    ap = argparse.ArgumentParser(description='Stazioni meteo e idrometriche della Provincia di Bolzano.')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== ALTO ADIGE (Provincia di Bolzano) %s ===' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    stamp = download()
    parse(stamp, debug=args.debug)
    # solo dopo un parse riuscito (un errore esce prima): i file di un giro fallito restano, li toglie la pulizia
    # notturna del cron
    comune.delete_downloaded(DOWNLOAD_DIR, [RAW_SUBDIR], stamp, debug=args.debug)


if __name__ == '__main__':
    main()
