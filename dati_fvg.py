#!/usr/bin/env python3
# dati_fvg.py - stazioni OSMER / ARPA FVG del Friuli Venezia Giulia (codice FVG). La fonte non ha un elenco delle
# stazioni e ogni stazione dà solo la sua ultima osservazione oraria:
#   HOME_URL                     la pagina principale: i codici delle stazioni dai link .../xml/stazioni/<CODICE>.xml
#   STATION_URL + <CODICE>.xml   una stazione: il blocco <meteo_data> con l'istante in UTC e un tag per misura; i tag
#                                cambiano da stazione a stazione, quelli che mancano si saltano
# Ogni giro scarica tutto in FVG/data-downloaded/dati/, aggiunge l'osservazione di ogni stazione al file del suo giorno
# (FVG/data-parsed/<VAR>/<VAR>-AAAAMMGG.json, in ora solare) e poi cancella i file scaricati: la serie cresce di un
# punto a giro, per questo il cron lo lancia ogni ora.
# Uso: python3 dati_fvg.py [--debug]
import argparse
import datetime
import os
import re
import sys
import xml.etree.ElementTree as ET

import requests

import comune

HOME_URL = 'https://dev.meteo.fvg.it'
STATION_URL = 'https://dev.meteo.fvg.it/xml/stazioni/'
DOWNLOAD_DIR = os.path.join(comune.region_dir('FVG'), 'data-downloaded')
RAW_SUBDIR = 'dati'
PARSE_DIR = os.path.join(comune.region_dir('FVG'), 'data-parsed')
STATIONS_JSON = os.path.join(PARSE_DIR, 'stazioni.json')
# variabile -> tag di <meteo_data> con il suo valore (l'unità di misura è nell'attributo um del tag)
VARIABLES = {
    'TEMP': 't180',
    'PREC': 'rr',
    'VVENTO': 'ff10',                   # vento vettoriale; VVENTOSCAL è quello medio
    'DVENTO': 'dd10',
    'RADSOL': 'rg',
    'UMID': 'rh',
    'PRESS': 'press',
    'BAGNATURA': 'bf',                  # bagnatura fogliare
    'PREC_TYPE': 'prec_type',           # 0 niente, 1 pioggia, 2 pioggia e neve, 3 neve
    'CLOUDINESS': 'cloudiness',         # 0 non disponibile, da 1 sereno a 5 coperto
    'VVENTOSCAL': 'v10',
    'DVENTOMAX': 'dd10max',             # direzione della raffica
    'TEMPACQUA': 'tmare',               # solo le stazioni sul mare
}
# altri valori da tenere nel file di una variabile: variabile -> {nome nelle MISURE: tag}
EXTRA = {'VVENTO': {'VMAX': 'vmax'}}
# i tag di <meteo_data> che non sono misure
META_TAGS = {'observation_time', 'observation_date', 'observation_hour',
             'station_id', 'station_name', 'station_altitude'}


def fetch(url, path):
    """Salva in path il file di url, qualunque sia lo stato HTTP (una pagina di errore non è XML: parse la salta), e
    ne restituisce il contenuto. Un errore di rete ferma il giro."""
    try:
        r = comune.get(url)
    except requests.RequestException as error:
        sys.exit('Error downloading ' + url + ': ' + str(error))
    with open(path, 'wb') as fp:
        fp.write(r.content)
    return r.content


def download():
    """La pagina principale e il file di ogni stazione in DOWNLOAD_DIR/dati/, con il prefisso del giro
    AAAAMMGG-HHMMSS (restituito)."""
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    # le cartelle subito: un giro fermato a metà le lascia comunque tutte (recover.py cerca i buchi in data-parsed)
    os.makedirs(folder, exist_ok=True)
    os.makedirs(PARSE_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    home = fetch(HOME_URL, os.path.join(folder, stamp + '-home.html'))
    # codici di cifre o di lettere e cifre (101, G201, A009); i link <codice>_week.xml (gli aggregati giornalieri)
    # restano fuori perché '_' non è fra i caratteri ammessi
    codes = sorted(set(re.findall(r'stazioni/([A-Za-z0-9]+)\.xml', home.decode('utf-8', 'replace'))))
    print('Pagina principale: %d stazioni' % len(codes))
    for code in codes:
        fetch(STATION_URL + code + '.xml', os.path.join(folder, stamp + '-' + code + '.xml'))
    return stamp


def solar_moment(text):
    """'GG/MM/AAAA hh.mm UTC' -> AAAAMMGGhhmm in ora solare (UTC+1), come tutto l'archivio; None se non si legge."""
    try:
        moment = datetime.datetime.strptime(text.strip().replace(' UTC', ''), '%d/%m/%Y %H.%M')
        return comune.utc_to_solar(moment)
    except (ValueError, TypeError, AttributeError):         # tag vuoto o mancante, formato diverso
        return None


def read_observation(path):
    """L'osservazione di un file di stazione: istante, dati della stazione, valore e unità di ogni tag di misura.
    None se il file non è XML (una pagina di errore) o non ha il blocco <meteo_data>."""
    try:
        block = ET.parse(path).getroot().find('meteo_data')
    except ET.ParseError:
        return None
    if block is None:
        return None
    moment = solar_moment(block.findtext('observation_time'))
    altitude = block.find('station_altitude')
    station = {'station_id': block.findtext('station_id'), 'station_name': block.findtext('station_name'),
               'station_altitude': None if altitude is None else altitude.text}
    values, units = {}, {}
    for element in block:
        if element.tag in META_TAGS:
            continue
        values[element.tag] = element.text.strip() if element.text else None
        if element.get('um'):
            units[element.tag] = element.get('um')
    return {'moment': moment, 'station': station, 'values': values, 'units': units}


def parse(stamp, debug=False):
    """Per ogni variabile, l'osservazione del giro di ogni stazione che la misura va nel file del suo giorno, se è più
    recente dell'ultima già salvata. I dati delle stazioni lette si aggiornano in stazioni.json."""
    for var in sorted(VARIABLES):           # tutte le cartelle subito, anche per le variabili senza letture
        os.makedirs(os.path.join(PARSE_DIR, var), exist_ok=True)
    stations = comune.load_json(STATIONS_JSON)
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    observations = {}                       # codice -> osservazione, in ordine di nome del file
    for name in sorted(os.listdir(folder)):
        if not (name.startswith(stamp + '-') and name.endswith('.xml')):
            continue
        code = name[len(stamp) + 1:-len('.xml')]
        obs = read_observation(os.path.join(folder, name))
        if obs is None:
            if debug:
                print('  salto %s: non è XML o manca <meteo_data>' % name)
            continue
        observations[code] = obs
        stations[code] = obs['station']
    added = 0
    # in ordine alfabetico: se un file rotto ferma il giro, restano scritte sempre le stesse variabili
    for var in sorted(VARIABLES):
        tag, extra = VARIABLES[var], EXTRA.get(var, {})
        day_files = {}                      # percorso -> contenuto, letto la prima volta che serve
        for code, obs in observations.items():
            if tag not in obs['values'] or obs['moment'] is None:
                continue
            path = os.path.join(PARSE_DIR, var, var + '-' + obs['moment'][:8] + '.json')
            if path not in day_files:
                day_files[path] = comune.load_json(path)
            archive = day_files[path]
            if code not in archive:
                archive[code] = {'STAZIONE': obs['station'], 'UM': obs['units'].get(tag),
                                 'MISURE': {'ISTANTE': [], 'VALORE': []}}
                for label in extra:
                    archive[code]['MISURE'][label] = []
            measures = archive[code]['MISURE']
            if measures['ISTANTE'] and int(obs['moment']) <= int(measures['ISTANTE'][-1]):
                continue                    # già salvata: la stazione non ha ancora un'osservazione nuova
            measures['ISTANTE'].append(obs['moment'])
            measures['VALORE'].append(obs['values'][tag])
            for label, extra_tag in extra.items():
                measures[label].append(obs['values'].get(extra_tag))
            added += 1
        for path, archive in day_files.items():
            comune.save_json(archive, path)
            if debug:
                print('  %s: %d stazioni' % (os.path.basename(path), len(archive)))
    comune.save_json(stations, STATIONS_JSON, sort_keys=True)
    print('[FVG] stazioni lette: %d | nuove letture inserite: %d' % (len(observations), added))


def main():
    ap = argparse.ArgumentParser(description='Stazioni OSMER / ARPA FVG del Friuli Venezia Giulia.')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== FRIULI VENEZIA GIULIA (OSMER) %s ===' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    stamp = download()
    parse(stamp, debug=args.debug)
    # solo dopo un parse riuscito (un errore esce prima): i file di un giro fallito restano, li toglie la pulizia
    # notturna del cron
    comune.delete_downloaded(DOWNLOAD_DIR, [RAW_SUBDIR], stamp, debug=args.debug)


if __name__ == '__main__':
    main()
