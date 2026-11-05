#!/usr/bin/env python3
# dati_veneto.py - stazioni ARPAV del Veneto (codice VEN). Tre elenchi di stazioni e un file XML per stazione con le
# misure degli ultimi due giorni circa, istanti in ora solare:
#   BASE_URL/stazioni.xml, stazioni_idro.xml, stazioni_neve.xml   gli elenchi: IDSTAZ, NOME, ..., LINKSTAZ
#   BASE_URL/<LINKSTAZ>                                            una stazione: un SENSORE per variabile (TYPE),
#                                                                   con le misure DATI (ISTANTE, VM)
# Ogni giro scarica tutto in VEN/data-downloaded/<elenco>/, aggiunge al file del giorno scelto
# (VEN/data-parsed/<VAR>/<VAR>-AAAAMMGG.json) le misure nuove e poi cancella i file scaricati.
# Il cron lo lancia ogni 30 minuti con -date t e alle 06:05 con -date y (misure arrivate in ritardo); recover.py
# con -date AAAA MM GG -c no per i giorni da ricucire.
# Uso: python3 dati_veneto.py [-date t | y | AAAA MM GG] [-c yes|no] [--debug]
import argparse
import datetime
import os
import xml.etree.ElementTree as ET

import requests

import comune

BASE_URL = 'https://meteo.arpa.veneto.it/meteo/dati_meteo/xml'
DOWNLOAD_DIR = os.path.join(comune.region_dir('VEN'), 'data-downloaded')
PARSE_DIR = os.path.join(comune.region_dir('VEN'), 'data-parsed')
STATIONS_JSON = os.path.join(PARSE_DIR, 'stazioni.json')
# elenco di stazioni (è anche la cartella dei suoi file scaricati) -> file; variabile -> elenco delle stazioni che
# la misurano. Le variabili si chiamano come il TYPE dei sensori nei file delle stazioni.
STATION_LISTS = {'meteo': 'stazioni.xml', 'idro': 'stazioni_idro.xml', 'neve': 'stazioni_neve.xml'}
VARIABLES = {'TEMP': 'meteo', 'PREC': 'meteo', 'VVENTO': 'meteo', 'DVENTO': 'meteo', 'RADSOL': 'meteo',
             'UMID': 'meteo', 'VISIB': 'meteo', 'PRESS': 'meteo',
             'LIVIDRO': 'idro', 'PORTATA': 'idro', 'LIVNEVE': 'neve'}
# i campi che si tengono di un elenco, di una stazione e di un sensore
LIST_FIELDS = ('IDSTAZ', 'NOME', 'X', 'Y', 'QUOTA', 'TIPOSTAZ', 'COMUNE', 'PROVINCIA', 'LINKSTAZ')
STATION_FIELDS = ('IDSTAZ', 'NOME', 'X', 'Y', 'QUOTA', 'TIPOSTAZ', 'COMUNE', 'PROVINCIA', 'ATTIVAZIONE')
SENSOR_FIELDS = ('ID', 'PARAMNM', 'TYPE', 'UNITNM', 'UNITCODE', 'FREQ', 'GUARDIA1', 'GUARDIA2', 'GUARDIA3')


def fetch(url, path):
    """Salva in path il file di url; None se non arriva: una stazione persa non ferma il giro (~350 file)."""
    # comune.get manda lo User-Agent del progetto, che comincia come quello di un browser: ARPAV può rifiutare
    # quello di python-requests
    try:
        r = comune.get(url, timeout=30)
        r.raise_for_status()
    except requests.RequestException as error:
        print('SKIP %s (%s)' % (os.path.basename(path), error))
        return None
    with open(path, 'wb') as fp:
        fp.write(r.content)
    return path


def download():
    """Gli elenchi e il file di ogni stazione in DOWNLOAD_DIR/<elenco>/, con il prefisso del giro AAAAMMGG-HHMMSS
    (restituito). Le stazioni nuove si aggiungono a stazioni.json; quelle sparite dagli elenchi restano."""
    # tutte le cartelle subito: un giro fermato a metà le lascia comunque tutte (recover.py cerca i buchi in data-parsed)
    for list_id in STATION_LISTS:
        os.makedirs(os.path.join(DOWNLOAD_DIR, list_id), exist_ok=True)
    os.makedirs(PARSE_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    for list_id, list_file in STATION_LISTS.items():
        folder = os.path.join(DOWNLOAD_DIR, list_id)
        path = fetch(BASE_URL + '/' + list_file, os.path.join(folder, stamp + '-stazioni-' + list_file))
        if path is None:
            print('Lista stazioni non scaricata: salto ' + list_id)        # riprova al giro dopo
            continue
        root = ET.parse(path).getroot()
        update = datetime.datetime.strptime(root.find('ISTANTERUN').text, '%Y%m%d%H%M')
        new = {}
        for item in root.iter('STAZIONE'):
            new[item.find('IDSTAZ').text] = {field: item.find(field).text for field in LIST_FIELDS}
        print('%s: %d stazioni, aggiornamento %s' % (list_file, len(new), update.strftime('%d/%m/%Y %H:%M')))
        stations = comune.load_json(STATIONS_JSON)
        for code, station in new.items():
            stations.setdefault(code, station)
        comune.save_json(stations, STATIONS_JSON, sort_keys=True)
        for station in new.values():
            fetch(BASE_URL + '/' + station['LINKSTAZ'], os.path.join(folder, stamp + '-' + station['LINKSTAZ']))
    return stamp


def day_window(date):
    """Primo e ultimo istante (AAAAMMGGhhmm) del giorno da archiviare: oggi fino ad adesso, ieri, o AAAA MM GG."""
    # ora locale di proposito, anche se ARPAV dà gli istanti in ora solare: con l'ora legale funziona lo stesso
    now = datetime.datetime.now()
    if date[0] in ('today', 'Today', 'TODAY', 't', 'T'):
        return now.strftime('%Y%m%d0000'), now.strftime('%Y%m%d%H%M')
    if date[0] in ('yesterday', 'Yesterday', 'YESTERDAY', 'y', 'Y'):
        day = now - datetime.timedelta(days=1)
    else:
        day = datetime.datetime(int(date[0]), int(date[1]), int(date[2]))
    return day.strftime('%Y%m%d0000'), day.strftime('%Y%m%d2359')


def read_station(root, var):
    """Da un file di stazione: l'aggiornamento (ISTANTERUN), i dati della stazione, quelli del sensore della
    variabile e le sue misure [(ISTANTE, VM)]."""
    run = root.find('ISTANTERUN').text
    info = {field: root.find('STAZIONE/' + field).text for field in STATION_FIELDS}
    sensor, measures = {}, []
    for s in root.findall('STAZIONE/SENSORE'):
        if s.find('TYPE').text != var:
            continue
        for field in SENSOR_FIELDS:
            element = s.find(field)
            if element is not None:
                sensor[field] = element.text
        for d in s.findall('DATI'):
            measures.append((d.get('ISTANTE'), d.find('VM').text))
    return run, info, sensor, measures


def parse(stamp, date, debug=False):
    """Per ogni variabile, nel file del giorno: i dati di stazione e sensore del giro e, se la stazione si è
    aggiornata (ISTANTERUN), le sue misure del giorno successive all'ultima già salvata."""
    for var in VARIABLES:                   # tutte le cartelle subito, anche per le variabili senza letture
        os.makedirs(os.path.join(PARSE_DIR, var), exist_ok=True)
    stations = comune.load_json(STATIONS_JSON)
    begin, end = day_window(date)
    if debug:
        print('finestra %s - %s' % (begin, end))
    # ORALEGALE nei file: 1 se il giro avviene con l'ora legale (solo un'informazione)
    dst = int(comune.is_dst_civil(datetime.datetime.now()))
    added = 0
    # in ordine alfabetico: se un file rotto ferma il giro, restano scritte sempre le stesse variabili
    for var in sorted(VARIABLES):
        list_id = VARIABLES[var]
        path = os.path.join(PARSE_DIR, var, var + '-' + begin[:8] + '.json')
        archive = comune.load_json(path)
        done = set()
        for station in stations.values():
            xml_path = os.path.join(DOWNLOAD_DIR, list_id, stamp + '-' + station['LINKSTAZ'])
            if not os.path.exists(xml_path):
                continue
            root = ET.parse(xml_path).getroot()
            if var not in [t.text for t in root.findall('STAZIONE/SENSORE/TYPE')]:
                continue
            code = root.find('STAZIONE/IDSTAZ').text
            if code in done:                            # lo stesso IDSTAZ in due file: vale il primo
                continue
            done.add(code)
            run, info, sensor, measures = read_station(root, var)
            if debug:
                print('  %s %s: aggiornamento %s' % (var, code, run))
            since = int(begin)
            if code in archive:
                record = archive[code]
                last_run = record['ISTANTERUN']
                saved = record.get('MISURE', {}).get('ISTANTE', [])
                if saved:                               # una stazione già nel file può non avere ancora misure
                    since = max(since, int(saved[-1]) + 1)
            else:
                record = {'ISTANTERUN': None, 'ORALEGALE': None, 'STAZIONE': None, 'SENSORE': None,
                          'MISURE': {'ISTANTE': [], 'ORALEGALE': [], 'VM': []}}
                archive[code] = record
                last_run = None
            record['ISTANTERUN'] = run
            record['STAZIONE'] = info
            record['SENSORE'] = sensor
            record['ORALEGALE'] = dst
            if run == last_run:                         # stesso aggiornamento della stazione: niente di nuovo
                continue
            for moment, value in measures:
                if since <= int(moment) <= int(end):
                    record['MISURE']['ISTANTE'].append(moment)
                    record['MISURE']['VM'].append(value)
                    record['MISURE']['ORALEGALE'].append(dst)
                    added += 1
        comune.save_json(archive, path)
    print('[VEN] giorno %s | nuove letture inserite: %d' % (begin[:8], added))


def main():
    ap = argparse.ArgumentParser(description='Stazioni ARPAV del Veneto: meteo, idrometri, neve.')
    ap.add_argument('-date', '--date', nargs='*', default=['today'], help='giorno: today/t, yesterday/y o AAAA MM GG')
    ap.add_argument('-c', '--cleanup', default='yes', help='cancella i file scaricati dopo il parse (yes/no)')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== VENETO (ARPAV) %s ===' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    stamp = download()
    parse(stamp, args.date, debug=args.debug)
    # solo dopo un parse riuscito (un errore esce prima); i file di un giro fallito o interrotto li toglie un giro
    # successivo quando hanno più di 90 minuti (il cron parte ogni 30, un giro può durarne di più)
    if args.cleanup in ('yes', 'Yes', 'YES', 'y', 'Y'):
        comune.delete_downloaded(DOWNLOAD_DIR, list(STATION_LISTS), stamp, stale_min=90, debug=args.debug)


if __name__ == '__main__':
    main()
