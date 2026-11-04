#!/usr/bin/env python3

# Emilia-Romagna (ARPAE / Allerta Meteo ER) data downloader/parser.
# Legge l'API real-time della mappa "Allerta Meteo" della Regione Emilia-Romagna:
#   base: https://allertameteo.regione.emilia-romagna.it/o/api/allerta/
#   - get-sensor-values-no-time?variabile=<desc>&time=<t_ms>  -> tutte le stazioni con il valore
#                                                                corrente + coordinate, per una variabile
#   - get-time-series?stazione=<id>&variabile=<desc>          -> serie {t: epoch_ms, v}
#
# Note (verificate sul feed reale):
#   - i timestamp 't' sono epoch UTC standard (l'ultimo campione coincide con l'ora reale UTC) ->
#     li convertiamo a ORA SOLARE (CET, UTC+1) per uniformarsi all'archivio.
#   - le coordinate 'lat'/'lon' sono gradi WGS84 * 100000 (es. lon=1240132 -> 12.40132) -> /100000.
#   - modello a snapshot: 6 chiamate per run (una per variabile), il valore corrente per ogni stazione;
#     il timestamp del batch e' l'ultimo istante disponibile (letto da una serie di riferimento),
#     arrotondato a 15 minuti. La serie si costruisce accumulando ad ogni run (dedup).
#   - i descrittori 'variabile' (codici BUFR) sono quelli usati dalla mappa ufficiale ARPAE.

#===========================================================================================================
# SETTING
#===========================================================================================================

import os
_BASE_DIR = os.path.dirname(os.path.realpath(__file__))

class directory:
    download = os.path.join(_BASE_DIR, 'data-downloaded')
    parse    = os.path.join(_BASE_DIR, 'data-parsed')

class switch:
    debug = False

# API Allerta Meteo Emilia-Romagna
API   = 'https://allertameteo.regione.emilia-romagna.it/o/api/allerta/'
subdir_dati = 'dati'

# variabili: descrittore 'variabile' (BUFR) + unita' di misura
class variables:
    class TEMP:
        desc = '254,0,0/103,2000,-,-/B12101'    # temperatura a 2 m
        unit = '°C'
    class PREC:
        desc = '1,0,1800/1,-,-,-/B13011'        # precipitazione cumulata 30 min
        unit = 'mm'
    class UMID:
        desc = '254,0,0/103,2000,-,-/B13003'    # umidita' relativa a 2 m
        unit = '%'
    class VVENTO:
        desc = '254,0,0/103,10000,-,-/B11002'   # velocita' vento a 10 m
        unit = 'm/s'
    class PRESS:
        desc = '254,0,0/1,-,-,-/B10004'         # pressione
        unit = 'hPa'
    class LIVIDRO:
        desc = '254,0,0/1,-,-,-/B13215'         # livello idrometrico
        unit = 'm'

# stazione di riferimento per leggere l'ultimo istante disponibile (idrometro affidabile)
REF_STATION = '5444'

# conversione valore (il feed usa unita' SI): Temperatura in Kelvin, Pressione in Pascal
VALUE_CONV = {
    'TEMP' : lambda v: round(v - 273.15, 1),    # Kelvin -> °C
    'PRESS': lambda v: round(v / 100.0, 1),     # Pascal -> hPa
}

#===========================================================================================================
# MODULES
#===========================================================================================================
import argparse
import datetime
import json
import requests
import sys

HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; meteo-er-fetcher/1.0)'}

#===========================================================================================================
# MAIN FUNCTIONS
#===========================================================================================================

#-----------------------------------------------------------------------------------------------------------
def download_data(directory, **kwargs):

    print('\n***  DATA DOWNLOADING  ***')
    title_date_time_now(title='Module starts on ')
    DEBUG = kwargs.get('debug_opt', False)

    current_dir = os.path.join(directory.download, subdir_dati)
    create_directory(current_dir)
    create_directory(directory.parse)
    file_stazioni_json = os.path.join(directory.parse, 'stazioni.json')

    datetime_string = date_time_string()

# 1) istante di riferimento (ms UTC) dall'ultimo campione della stazione di riferimento
    ref_ms = reference_time(DEBUG)
    print('Istante di riferimento (UTC ms): ' + str(ref_ms) +
          '  (' + datetime.datetime.utcfromtimestamp(ref_ms/1000).strftime('%Y-%m-%d %H:%M') + ' UTC)')
    json_save({'ref_ms': ref_ms}, os.path.join(current_dir, datetime_string + '-ref.json'))

# 2) per ogni variabile: valori correnti di tutte le stazioni
    for var in class_parsing():
        desc = getattr(variables, var).desc
        download_json(API + 'get-sensor-values-no-time', {'variabile': desc, 'time': str(ref_ms)},
                      current_dir, datetime_string + '-' + var + '.json', debug_opt=DEBUG)

    title_date_time_now(title='Module ends on ')
    return file_stazioni_json, datetime_string

#-----------------------------------------------------------------------------------------------------------
def parse_data(file_stazioni_json, datetime_string, directory, **kwargs):

    print('\n***  DATA PARSING  ***')
    title_date_time_now(title='Module starts on ')
    DEBUG = kwargs.get('debug_opt', False)

    var_list = class_parsing(debug_opt=DEBUG)
    var_processed = kwargs.get('var', var_list)
    if var_processed == "all" or "all" in var_processed:
        var_processed = var_list
    for var in var_processed:
        if var in var_list:
            create_directory(os.path.join(directory.parse, var))

    station_list = json_load(file_stazioni_json) if os.path.exists(file_stazioni_json) else {}
    current_dir = os.path.join(directory.download, subdir_dati)

# istante del batch = riferimento (UTC) -> ora solare, arrotondato a 15 minuti
    ref_file = os.path.join(current_dir, datetime_string + '-ref.json')
    ref_ms = json_load(ref_file)['ref_ms'] if os.path.exists(ref_file) else int(now_utc_ms())
    istante = solar_istante(ref_ms)
    day = istante[0:8]
    print('Istante batch (ora solare): ' + istante)

    for var in var_processed:
        if var not in var_list:
            continue
        print("\nVariable : " + var)
        vfile = os.path.join(current_dir, datetime_string + '-' + var + '.json')
        if not os.path.exists(vfile):
            continue
        readings = json_load(vfile)
        um = getattr(variables, var).unit

        filename_var = os.path.join(directory.parse, var, var + '-' + day + '.json')
        bin_day = json_load(filename_var) if os.path.exists(filename_var) else {}

        added = 0
        for s in readings:
            if not isinstance(s, dict) or 'idstazione' not in s:   # salta l'header {'time':...}
                continue
            val = s.get('value')
            if val is None:
                continue
# conversione unita' SI -> unita' d'uso (Kelvin->°C, Pascal->hPa) dove serve
            conv = VALUE_CONV.get(var)
            if conv is not None:
                try:
                    val = conv(float(val))
                except (TypeError, ValueError):
                    continue
            scode = s.get('idstazione')
            lat = _coord(s.get('lat')); lon = _coord(s.get('lon'))

# registro stazioni (solo quelle con dati)
            if scode not in station_list:
                station_list[scode] = {'SCODE': scode, 'NOME': s.get('nomestaz'), 'LAT': lat, 'LON': lon}
            elif station_list[scode].get('LAT') is None and lat is not None:
                station_list[scode]['LAT'] = lat; station_list[scode]['LON'] = lon

            if scode not in bin_day:
                bin_day[scode] = {'STAZIONE': station_list[scode], 'UM': um,
                                  'MISURE': {'ISTANTE': [], 'VALORE': []}}
            misure = bin_day[scode]['MISURE']
# dedup / append: solo se piu' recente dell'ultimo memorizzato
            if misure['ISTANTE'] and int(istante) <= int(misure['ISTANTE'][-1]):
                continue
            misure['ISTANTE'].append(istante)
            misure['VALORE'].append(val)
            added += 1

        json_save(bin_day, filename_var, sort_keys=False)
        print(f"  {added} nuove letture")

    json_save(station_list, file_stazioni_json)
    title_date_time_now(title='Module ends on ')
    return

#===========================================================================================================
# LOCAL FUNCTIONS
#===========================================================================================================

#-----------------------------------------------------------------------------------------------------------
def reference_time(debug=False):
    ''' Ultimo istante disponibile (epoch ms UTC) dalla serie della stazione di riferimento.
        Fallback: ora UTC corrente. '''
    try:
        ts = api_get('get-time-series', {'stazione': REF_STATION, 'variabile': variables.LIVIDRO.desc}, debug)
        if ts:
            return int(ts[-1]['t'])
    except Exception:
        pass
    return int(now_utc_ms())

#-----------------------------------------------------------------------------------------------------------
def now_utc_ms():
    return datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000

#-----------------------------------------------------------------------------------------------------------
def solar_istante(ref_ms):
    ''' epoch ms (UTC) -> ora solare (UTC+1), arrotondato a 15 min, formato YYYYMMDDHHMM. '''
    dt = datetime.datetime.utcfromtimestamp(ref_ms/1000)
    dt = dt.replace(minute=(dt.minute//15)*15, second=0, microsecond=0)
    dt = dt + datetime.timedelta(hours=1)          # UTC -> ora solare CET
    return dt.strftime('%Y%m%d%H%M')

#-----------------------------------------------------------------------------------------------------------
def _coord(value):
    ''' 'lat'/'lon' del feed = gradi WGS84 * 100000 -> gradi; None se mancante o ~0. '''
    try:
        v = float(value) / 100000.0
        return v if abs(v) > 0.001 else None
    except (TypeError, ValueError):
        return None

#-----------------------------------------------------------------------------------------------------------
def create_directory(directory_name):
    string1 = 'directory ' + directory_name + ' '
    print(string1.ljust(65, '.'), end=' ', flush=True)
    if not os.path.exists(directory_name):
        os.makedirs(directory_name); print('created')
    else:
        print('already exists')
    return

#-----------------------------------------------------------------------------------------------------------
def title_date_time_now(**kwargs):
    print('\n-------------------------------------------------------------------------')
    print(kwargs.get('title', '') + ' ' + date_time_string(format_print="%d/%m/%Y %H:%M:%S"))
    print('-------------------------------------------------------------------------\n')
    return

#-----------------------------------------------------------------------------------------------------------
def date_time_string(**kwargs):
    return datetime.datetime.now().strftime(kwargs.get('format_print', "%Y%m%d-%H%M%S"))

#-----------------------------------------------------------------------------------------------------------
def class_parsing(**kwargs):
    var_list = [item for item in dir(variables) if not item.startswith('__')]
    if kwargs.get('debug_opt', False):
        print('Variable list: ' + ' / '.join(var_list))
    return var_list

#-----------------------------------------------------------------------------------------------------------
def api_get(endpoint, params, debug=False):
    if debug: print(API + endpoint, params)
    try:
        r = requests.get(API + endpoint, params=params, headers=HEADERS, timeout=60)
        r.raise_for_status()
    except requests.RequestException as error:
        sys.exit('Error downloading ' + endpoint + ': ' + str(error))
    return r.json()

#-----------------------------------------------------------------------------------------------------------
def download_json(url, params, directory_name, file_name, **kwargs):
    DEBUG = kwargs.get('debug_opt', False)
    if DEBUG: print(url, params)
    string1 = (f"{'data file ' + file_name : <45}")
    print(string1, end=' ... ', flush=True)
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=90)
        r.raise_for_status()
    except requests.RequestException as error:
        print('SKIP (' + str(error) + ')')
        return None
    filename = os.path.join(directory_name, file_name)
    with open(filename, 'wb') as fp:
        fp.write(r.content)
    print('downloaded (' + str(len(r.content)) + ' bytes)')
    return filename

#-----------------------------------------------------------------------------------------------------------
def json_load(filename):
    with open(filename, 'r') as fp:
        text = fp.read()
    if not text.strip():
        print('WARN: file JSON vuoto, ignorato: ' + filename); return {}
    try:
        return json.loads(text)
    except ValueError as e:
        print('WARN: file JSON illeggibile (' + str(e) + '), ignorato: ' + filename); return {}

#-----------------------------------------------------------------------------------------------------------
def json_save(data, filename, **kwargs):
    tmp = filename + '.tmp'
    with open(tmp, 'w') as fp:
        json.dump(data, fp, sort_keys=kwargs.get('sort_keys', True), separators=(',',':'), ensure_ascii=False)
        fp.flush(); os.fsync(fp.fileno())
    os.replace(tmp, filename)   # scrittura atomica: mai file monchi da riavvio a meta' write
    return

#-----------------------------------------------------------------------------------------------------------
def delete_downloaded(download_dir, subdir_list, datetime_string, **kwargs):
    DEBUG = kwargs.get('debug_opt', False)
    removed = 0
    prefix = datetime_string + '-'
    for subdir in subdir_list:
        current_dir = os.path.join(download_dir, subdir)
        if not os.path.isdir(current_dir):
            continue
        for name in os.listdir(current_dir):
            if name.startswith(prefix):
                try:
                    os.remove(os.path.join(current_dir, name)); removed += 1
                except OSError as error:
                    if DEBUG: print('could not remove ' + name + ': ' + str(error))
    print('Raw downloaded files removed: ' + str(removed))
    return removed

#-----------------------------------------------------------------------------------------------------------
def latest_datetime_string(download_dir, subdir_list):
    stamps = []
    for subdir in subdir_list:
        current_dir = os.path.join(download_dir, subdir)
        if not os.path.isdir(current_dir):
            continue
        for name in os.listdir(current_dir):
            parts = name.split('-')
            if len(parts) >= 2:
                stamps.append(parts[0] + '-' + parts[1])
    return max(stamps) if stamps else None

#===========================================================================================================
# MAIN SENTINEL
#===========================================================================================================

if __name__ == "__main__":

    parser = argparse.ArgumentParser()
    parser.add_argument("-d", "--download", dest="download_flag", default="yes", help="Flag for download [yes/no]")
    parser.add_argument("-p", "--parse",    dest="parse_flag",    default="yes", help="Flag for parsing [yes/no]")
    parser.add_argument("-v", "--variables", dest="processing_variable", nargs='*', default="all",
                        help="Variable(s) [all/TEMP/PREC/UMID/VVENTO/PRESS/LIVIDRO]")
    parser.add_argument("-c", "--cleanup", dest="cleanup_flag", default="yes",
                        help="Delete raw downloaded files after a successful parse [yes/no]")
    args = parser.parse_args()

    file_stazioni_json = os.path.join(directory.parse, 'stazioni.json')
    datetime_string    = None

    if args.download_flag in ['yes', 'Yes', 'YES', 'y', 'Y']:
        file_stazioni_json, datetime_string = download_data(directory, debug_opt=switch.debug)

    if args.parse_flag in ['yes', 'Yes', 'YES', 'y', 'Y']:
        if datetime_string is None:
            datetime_string = latest_datetime_string(directory.download, [subdir_dati])
            if datetime_string is None:
                sys.exit('No downloaded data found to parse. Run with --download yes first.')
        parse_data(file_stazioni_json, datetime_string, directory,
                   var=args.processing_variable, debug_opt=switch.debug)

        if args.cleanup_flag in ['yes', 'Yes', 'YES', 'y', 'Y']:
            delete_downloaded(directory.download, [subdir_dati], datetime_string, debug_opt=switch.debug)
