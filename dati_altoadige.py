#!/usr/bin/env python3
# dati_altoadige.py - stazioni meteo e idrometriche di Bolzano (BZ), Open Data della Provincia.
# Due chiamate per tutta la rete: anagrafica (GeoJSON) e ultima lettura di ogni sensore (DATE in CET o CEST).
# Ogni giro aggiunge le letture nuove a BZ/data-parsed/<VAR>/<VAR>-AAAAMMGG.json (ora solare): un punto per
# sensore a giro, quindi il cron lo lancia ogni 10 minuti.
# Uso: python3 dati_altoadige.py [--debug]
import argparse
import datetime
import os
import re

import comune

STATIONS_URL = 'https://geoservices.buergernetz.bz.it/services/meteo/v1/stations'
SENSORS_URL = 'https://geoservices.buergernetz.bz.it/services/meteo/v1/sensors'
DOWNLOAD_DIR = os.path.join(comune.region_dir('BZ'), 'data-downloaded')
RAW_SUBDIR = 'dati'
PARSE_DIR = os.path.join(comune.region_dir('BZ'), 'data-parsed')
STATIONS_JSON = os.path.join(PARSE_DIR, 'stazioni.json')
# campi dell'anagrafica che si tengono, più 'coordinates' (punto del GeoJSON, in metri UTM)
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


def download():
    """Scarica anagrafica e letture; restituisce il prefisso del giro (AAAAMMGG-HHMMSS)."""
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    os.makedirs(folder, exist_ok=True)
    os.makedirs(PARSE_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    comune.save_url(STATIONS_URL, os.path.join(folder, stamp + '-stations.json'))
    comune.save_url(SENSORS_URL, os.path.join(folder, stamp + '-sensors.json'))
    return stamp


def solar_moment(text):
    """'AAAA-MM-GGThh:mm:ss' + fuso (CET o CEST) -> AAAAMMGGhhmm in ora solare; None se manca o non si legge.
    Conta il fuso scritto dalla fonte: a fine ora legale 02:00-03:00 arriva prima in CEST, poi in CET."""
    try:
        text = text.strip()
        zone = re.search(r'[A-Za-z]+$', text)
        moment = datetime.datetime.strptime(re.sub(r'[A-Za-z]+$', '', text), '%Y-%m-%dT%H:%M:%S')
        if zone and zone.group(0).upper() == 'CEST':
            moment -= datetime.timedelta(hours=1)
        return moment.strftime('%Y%m%d%H%M')
    except (ValueError, TypeError, AttributeError):     # campo mancante, vuoto o in un altro formato
        return None


def parse(stamp, debug=False):
    """Salva nel file del suo giorno ogni lettura più recente dell'ultima della stazione.
    L'anagrafica si fonde in stazioni.json: le stazioni uscite dall'anagrafica restano."""
    for var in VARIABLES:
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
    # variabile -> {percorso: contenuto}, letto la prima volta che serve
    day_files = {var: {} for var in VARIABLES}
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
            archive[code] = {
                'STAZIONE': stations.get(code, {'SCODE': code}),
                'UM': reading.get('UNIT'),
                'MISURE': {'ISTANTE': [], 'VALORE': []}
            }
        measures = archive[code]['MISURE']
        if measures['ISTANTE'] and int(moment) <= int(measures['ISTANTE'][-1]):
            continue
        measures['ISTANTE'].append(moment)
        measures['VALORE'].append(reading.get('VALUE'))
        added += 1
    # in ordine alfabetico: se una scrittura si ferma (disco pieno), restano scritte le variabili precedenti
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
    print('\n=== ALTO ADIGE (Provincia di Bolzano) %s ===' %
          datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    stamp = download()
    parse(stamp, debug=args.debug)
    # solo dopo un parse riuscito: i file di un giro fallito restano, li toglie la pulizia notturna
    comune.delete_downloaded(DOWNLOAD_DIR, [RAW_SUBDIR], stamp, debug=args.debug)


if __name__ == '__main__':
    main()
