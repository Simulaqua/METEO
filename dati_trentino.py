#!/usr/bin/env python3
# dati_trentino.py - stazioni Meteotrentino del Trentino (codice TN). Un elenco delle stazioni e un file XML per
# stazione con le misure a 15 minuti da ieri a oggi; tutti i tag sono nel namespace NS:
#   LIST_URL                 l'elenco: un <anagrafica> per stazione (codice, nome, quota, coordinate, inizio, fine);
#                            sono attive le stazioni senza data di fine
#   STATION_URL + <CODICE>   una stazione: una sezione per grandezza (<temperature>, <precipitazioni>, ...) con un
#                            elemento per istante (<data> AAAA-MM-GGThh:mm:ss, il valore, l'unità in un attributo)
# Ogni giro scarica tutto in TN/data-downloaded/dati/, aggiunge ai file del giorno di ogni misura
# (TN/data-parsed/<VAR>/<VAR>-AAAAMMGG.json) quelle successive all'ultima già salvata e poi cancella i file scaricati.
# Uso: python3 dati_trentino.py [--debug]
import argparse
import datetime
import os
import xml.etree.ElementTree as ET

import comune

LIST_URL = 'http://dati.meteotrentino.it/service.asmx/listaStazioni'
STATION_URL = 'http://dati.meteotrentino.it/service.asmx/ultimiDatiStazione?codice='
NS = {'mt': 'http://www.meteotrentino.it/'}
DOWNLOAD_DIR = os.path.join(comune.region_dir('TN'), 'data-downloaded')
RAW_SUBDIR = 'dati'
PARSE_DIR = os.path.join(comune.region_dir('TN'), 'data-parsed')
STATIONS_JSON = os.path.join(PARSE_DIR, 'stazioni.json')
# i campi che si tengono di una stazione dell'elenco
LIST_FIELDS = ('codice', 'nome', 'nomebreve', 'quota', 'latitudine', 'longitudine', 'est', 'north', 'inizio', 'fine')
# variabile -> sezione del file di una stazione, elemento con un istante, tag del valore, attributo dell'elemento con
# l'unità di misura
VARIABLES = {
    'TEMP': ('temperature', 'temperatura_aria', 'temperatura', 'UM'),
    'PREC': ('precipitazioni', 'precipitazione', 'pioggia', 'UM'),
    'VVENTO': ('venti', 'vento_al_suolo', 'v', 'UM_VV'),           # velocità media
    'DVENTO': ('venti', 'vento_al_suolo', 'd', 'UM_DV'),
    'RADSOL': ('radiazione', 'radiazioneglobale', 'rsg', 'UM'),
    'UMID': ('umidita_relativa', 'umidita_relativa', 'rh', 'UM'),
}
# altri valori da tenere nel file di una variabile: variabile -> {nome nelle MISURE: tag}
EXTRA = {'VVENTO': {'VMAX': 'vmax'}}                               # la raffica


def child_text(element, tag):
    """Il testo del tag figlio; None se il tag manca o è vuoto."""
    child = element.find('mt:' + tag, NS)
    return None if child is None else child.text


def download():
    """L'elenco delle stazioni e il file di ogni stazione attiva in DOWNLOAD_DIR/dati/, con il prefisso del giro
    AAAAMMGG-HHMMSS (restituito). L'elenco si fonde in stazioni.json: i dati di una stazione si aggiornano, le stazioni
    che escono dall'elenco restano."""
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    # tutte e due le cartelle subito: anche un giro che si ferma all'elenco le lascia
    os.makedirs(folder, exist_ok=True)
    os.makedirs(PARSE_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    list_path = os.path.join(folder, stamp + '-listaStazioni.xml')
    comune.save_url(LIST_URL, list_path)
    listed = {}
    for item in ET.parse(list_path).getroot().findall('mt:anagrafica', NS):
        station = {field: child_text(item, field) for field in LIST_FIELDS}
        if station['codice'] is not None:
            listed[station['codice']] = station
    stations = dict(comune.load_json(STATIONS_JSON))
    stations.update(listed)
    comune.save_json(stations, STATIONS_JSON, sort_keys=True)
    active = [code for code, station in listed.items() if not (station['fine'] or '').strip()]
    print('Elenco: %d stazioni, %d attive' % (len(listed), len(active)))
    for code in active:
        comune.save_url(STATION_URL + code, os.path.join(folder, stamp + '-' + code + '.xml'))
    return stamp


def compact_moment(text):
    """'AAAA-MM-GGThh:mm:ss' -> AAAAMMGGhhmm; None se manca o non si legge."""
    try:
        return datetime.datetime.strptime(text, '%Y-%m-%dT%H:%M:%S').strftime('%Y%m%d%H%M')
    except (ValueError, TypeError):
        return None


def read_measures(path, var):
    """L'unità di misura e le misure della variabile in un file di stazione:
    [{'ISTANTE': AAAAMMGGhhmm, 'VALORE': testo, <EXTRA>: testo}]. Gli elementi senza un istante leggibile si saltano."""
    section, item, value_tag, unit_attr = VARIABLES[var]
    unit, measures = None, []
    for element in ET.parse(path).getroot().findall('mt:' + section + '/mt:' + item, NS):
        if unit is None:
            unit = element.get(unit_attr)
        moment = compact_moment(child_text(element, 'data'))
        if moment is None:
            continue
        measure = {'ISTANTE': moment, 'VALORE': child_text(element, value_tag)}
        for label, tag in EXTRA.get(var, {}).items():
            measure[label] = child_text(element, tag)
        measures.append(measure)
    return unit, measures


def parse(stamp, debug=False):
    """Per ogni variabile, le misure di ogni stazione scaricata nel giro vanno nel file del loro giorno, se sono
    successive all'ultima già salvata per quella stazione."""
    for var in VARIABLES:                   # tutte le cartelle, anche delle variabili senza misure in questo giro
        os.makedirs(os.path.join(PARSE_DIR, var), exist_ok=True)
    # da stazioni.json, non dall'elenco appena scaricato: nei file del giorno stazioni e campi seguono il suo ordine
    # (alfabetico)
    stations = comune.load_json(STATIONS_JSON)
    folder = os.path.join(DOWNLOAD_DIR, RAW_SUBDIR)
    files = {}                              # codice -> file della stazione scaricato nel giro
    for code in stations:
        path = os.path.join(folder, stamp + '-' + code + '.xml')
        if os.path.exists(path):
            files[code] = path
    added = 0
    # in ordine alfabetico: se un file rotto ferma il giro, restano scritte le variabili che vengono prima nell'alfabeto
    for var in sorted(VARIABLES):
        extra = EXTRA.get(var, {})
        day_files = {}                      # percorso -> contenuto, letto la prima volta che serve
        for code, path in files.items():
            unit, measures = read_measures(path, var)
            for measure in measures:
                day_path = os.path.join(PARSE_DIR, var, var + '-' + measure['ISTANTE'][:8] + '.json')
                if day_path not in day_files:
                    day_files[day_path] = comune.load_json(day_path)
                archive = day_files[day_path]
                if code not in archive:
                    archive[code] = {'STAZIONE': stations[code], 'UM': unit, 'MISURE': {'ISTANTE': [], 'VALORE': []}}
                    for label in extra:
                        archive[code]['MISURE'][label] = []
                saved = archive[code]['MISURE']
                if saved['ISTANTE'] and int(measure['ISTANTE']) <= int(saved['ISTANTE'][-1]):
                    continue                # non più recente dell'ultima salvata: ogni file ripete le misure da ieri
                saved['ISTANTE'].append(measure['ISTANTE'])
                saved['VALORE'].append(measure['VALORE'])
                for label in extra:
                    saved[label].append(measure[label])
                added += 1
        for day_path, archive in day_files.items():
            comune.save_json(archive, day_path)
            if debug:
                print('  %s: %d stazioni' % (os.path.basename(day_path), len(archive)))
    print('[TN] stazioni lette: %d | nuove letture inserite: %d' % (len(files), added))


def main():
    ap = argparse.ArgumentParser(description='Stazioni Meteotrentino del Trentino.')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== TRENTINO (Meteotrentino) %s ===' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    stamp = download()
    parse(stamp, debug=args.debug)
    # solo dopo un parse riuscito (un errore esce prima): i file di un giro fallito restano, li toglie la pulizia
    # notturna del cron
    comune.delete_downloaded(DOWNLOAD_DIR, [RAW_SUBDIR], stamp, debug=args.debug)


if __name__ == '__main__':
    main()
