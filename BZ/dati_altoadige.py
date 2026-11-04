#!/usr/bin/env python3

# Alto Adige / Sudtirol (Provincia Autonoma di Bolzano) data downloader/parser.
# Mirrors the behaviour of the ARPAV Veneto script (dati_veneto.py) but adapted to the
# Open Data weather/hydro service of the Province of Bolzano, which is JSON (not XML):
#   - stations : https://geoservices.buergernetz.bz.it/services/meteo/v1/stations   (GeoJSON)
#   - sensors  : https://geoservices.buergernetz.bz.it/services/meteo/v1/sensors    (flat JSON array)
#
# Alternative (mirror) endpoints, in case the ones above change:
#   - stations : https://geoservices.buergernetz.bz.it/services/meteo/v1/stations
#   - sensors  : https://geoservices.buergernetz.bz.it/services/meteo/v1/sensors
#
# Notes on the differences: the '/sensors' endpoint returns ONE current reading per sensor for the
# whole network in a single call (no per-station requests, no time series). A time series is therefore
# built by ACCUMULATING one reading per run: this script is meant to be scheduled (e.g. hourly via cron),
# and each run appends one point per sensor. Timestamps are 'YYYY-MM-DDTHH:MM:SS' with a local timezone
# suffix (CET/CEST). Each sensor TYPE code is mapped to its own variable (meteo + hydrology).

#===========================================================================================================
# SETTING
#===========================================================================================================

import os
_BASE_DIR = os.path.dirname(os.path.realpath(__file__))   # cartella in cui si trova questo script

# directory class
class directory:
    download    = os.path.join(_BASE_DIR, 'data-downloaded')
    parse       = os.path.join(_BASE_DIR, 'data-parsed')

# switch class:
class switch:
    debug   = False

# Open Data Bolzano endpoints
url_stations = 'https://geoservices.buergernetz.bz.it/services/meteo/v1/stations'    # station registry (GeoJSON)
url_sensors  = 'https://geoservices.buergernetz.bz.it/services/meteo/v1/sensors'     # latest sensor readings (JSON)

# subdirectory where the downloaded json files are stored
subdir_dati  = 'dati'

# HTTP headers (be a good citizen / avoid default UA blocks)
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; meteo-altoadige-fetcher/1.0)'}

# variable classes: each variable maps a single sensor TYPE code of the '/sensors' feed.
#   type : the value of the "TYPE" field in a sensor reading
# (the unit of measure is read at run time from the "UNIT" field of the reading itself)
class variables:
    class TEMP:                          # temperatura dell'aria
        type = 'LT'
    class PREC:                          # precipitazioni
        type = 'N'
    class UMID:                          # umidita' relativa
        type = 'LF'
    class PRESS:                         # pressione atmosferica
        type = 'LD.RED'
    class RADSOL:                        # radiazione globale
        type = 'GS'
    class SOLEGG:                        # durata soleggiamento
        type = 'SD'
    class VVENTO:                        # velocita' del vento
        type = 'WG'
    class VVENTOMAX:                     # velocita' raffica
        type = 'WG.BOE'
    class DVENTO:                        # direzione del vento
        type = 'WR'
    class LIVNEVE:                       # altezza neve al suolo
        type = 'HS'
    class LIVIDRO:                       # livello idrometrico
        type = 'W'
    class PORTATA:                       # portata
        type = 'Q'
    class FREATICA:                      # altezza freatimetrica (falda)
        type = 'W.ABST'
    class TEMPACQUA:                     # temperatura dell'acqua
        type = 'WT'
    class SOLIDI:                        # concentrazione solidi sospesi
        type = 'SSTF'

#===========================================================================================================
# MODULES
#===========================================================================================================
import argparse                                         # argument parsing
import datetime                                         # date and time
import json                                             # manage json files
import os                                               # manage system commands (e.g. directory creation)
import re                                               # regular expressions (timestamp cleaning)
import requests                                         # download files from web
import sys                                              # system commands

#===========================================================================================================
# MAIN FUNCTIONS
#===========================================================================================================

#-----------------------------------------------------------------------------------------------------------
# DATA DOWNLOADING
#-----------------------------------------------------------------------------------------------------------
def download_data(directory, **kwargs):

# print function title
    print('\n***  DATA DOWNLOADING  ***')

# print initial date and time
    title_date_time_now(title = 'Module starts on ')

# debug switch
    DEBUG = kwargs.get('debug_opt', False)

# DIRECTORIES

# create download directory, if not already existing
    current_dir = os.path.join(directory.download, subdir_dati)
    create_directory(current_dir)

# create parsing directory, if not already existing
    create_directory(directory.parse)

# default station-list json path (ensures a defined return value)
    file_stazioni_json = os.path.join(directory.parse, 'stazioni.json')

# current datetime string (identifies this download batch)
    datetime_string = date_time_string()

# DOWNLOAD STATION REGISTRY AND SENSOR READINGS (two calls only)

    download_file(url_stations, current_dir, datetime_string + '-stations.json', debug_opt=DEBUG)
    download_file(url_sensors,  current_dir, datetime_string + '-sensors.json',  debug_opt=DEBUG)

# print final date and time
    title_date_time_now(title = 'Module ends on ')

# end of the function
    return file_stazioni_json, datetime_string

#-----------------------------------------------------------------------------------------------------------
# DATA PARSING
#-----------------------------------------------------------------------------------------------------------
def parse_data(file_stazioni_json, datetime_string, directory, **kwargs):

# print function title
    print('\n***  DATA PARSING  ***')

# print initial date and time
    title_date_time_now(title = 'Module starts on ')

# debug switch
    DEBUG = kwargs.get('debug_opt', False)

# variable list
    var_list = class_parsing(debug_opt=DEBUG)

# variables to be processed
    var_processed = kwargs.get('var', var_list)
    if var_processed == "all" or "all" in var_processed:
        var_processed = var_list

# create parse directories, if not already existing
    for var in var_processed:
        if var in var_list:
            create_directory(os.path.join(directory.parse, var))

# load existing station list (code -> metadata), if any
    station_list = json_load(file_stazioni_json) if os.path.exists(file_stazioni_json) else {}

# directory holding the downloaded json files
    current_dir = os.path.join(directory.download, subdir_dati)

# STATION REGISTRY (GeoJSON): update station metadata

    stations_file = os.path.join(current_dir, datetime_string + '-stations.json')
    if os.path.exists(stations_file):
        geo = json_load(stations_file)
        for feature in geo.get('features', []):
            prop  = feature.get('properties', {})
            scode = prop.get('SCODE')
            if scode is None:
                continue
            geometry = feature.get('geometry') or {}
            station_list[scode] = {
                'SCODE'      : scode,
                'NAME_I'     : prop.get('NAME_I'),
                'NAME_D'     : prop.get('NAME_D'),
                'ALT'        : prop.get('ALT'),
                'LONG'       : prop.get('LONG'),
                'LAT'        : prop.get('LAT'),
                'coordinates': geometry.get('coordinates'),
            }

# SENSOR READINGS: distribute each reading to its variable

    sensors_file = os.path.join(current_dir, datetime_string + '-sensors.json')
    sensors = json_load(sensors_file) if os.path.exists(sensors_file) else []
    print('Sensor readings: ' + str(len(sensors)))

# reverse map: sensor TYPE code -> variable name
    type2var = {getattr(variables, v).type: v for v in var_list}

# daily bins per variable, loaded on demand: var -> day (YYYYMMDD) -> { scode -> station record }
    daily   = {var: {} for var in var_processed if var in var_list}
    counter = {var: 0 for var in daily}

# loop over readings (single pass over the whole feed)
    for reading in sensors:

# map the sensor type to a variable to be processed
        var = type2var.get(reading.get('TYPE'))
        if var is None or var not in daily:
            continue

# timestamp (local CET/CEST) normalized to YYYYMMDDHHMM
        istante = normalize_istante(reading.get('DATE'))
        if istante is None:
            continue

        scode = reading.get('SCODE')
        if scode is None:
            continue
        day = istante[0:8]

# load the daily file the first time this (variable, day) is touched
        if day not in daily[var]:
            filename_var = os.path.join(directory.parse, var, var + '-' + day + '.json')
            daily[var][day] = json_load(filename_var) if os.path.exists(filename_var) else {}

        bin_day = daily[var][day]

# initialize the station record the first time it appears in this day
        if scode not in bin_day:
            bin_day[scode] = {
                'STAZIONE': station_list.get(scode, {'SCODE': scode}),
                'UM'      : reading.get('UNIT'),
                'MISURE'  : {'ISTANTE': [], 'VALORE': []},
            }

        misure = bin_day[scode]['MISURE']

# dedup / append: keep only readings newer than the last one already stored
        if misure['ISTANTE'] and int(istante) <= int(misure['ISTANTE'][-1]):
            continue

        misure['ISTANTE'].append(istante)
        misure['VALORE'].append(reading.get('VALUE'))
        counter[var] += 1

# save every daily file touched, per variable
    for var in daily:
        for day, bin_day in daily[var].items():
            filename_var = os.path.join(directory.parse, var, var + '-' + day + '.json')
            json_save(bin_day, filename_var, sort_keys=False)
        print(f"Variable {var : <10}: {counter[var]} new readings")

# save station list (kept in sync)
    json_save(station_list, file_stazioni_json)

# print final date and time
    title_date_time_now(title = 'Module ends on ')

# end of the function
    return

#===========================================================================================================
# LOCAL FUNCTIONS
#===========================================================================================================

#-----------------------------------------------------------------------------------------------------------
def create_directory(directory_name):
    ''' This function creates a directory. '''

# create target directory if does not exist
    string1 = 'directory ' + directory_name + ' '
    print(string1.ljust(65, '.'), end=' ', flush=True)
    if not os.path.exists(directory_name):
        os.makedirs(directory_name)
        print('created')
    else:
        print('already exists')

# end of function
    return

#-----------------------------------------------------------------------------------------------------------
def title_date_time_now(**kwargs):
    ''' This function prints the current date and time with an optional title. '''

# get title
    print_title = kwargs.get('title', '')

# print current date and time
    print('\n-------------------------------------------------------------------------')
    dt_string = date_time_string(format_print = "%d/%m/%Y %H:%M:%S")
    print(print_title + ' ' + dt_string)
    print('-------------------------------------------------------------------------\n')

# end of the function
    return

#-----------------------------------------------------------------------------------------------------------
def date_time_string(**kwargs):
    ''' This function returns the current date and time as a string. '''

# format switch
    format_print = kwargs.get('format_print', "%Y%m%d-%H%M%S")

# current date and time
    now = datetime.datetime.now()

# end of the function
    return now.strftime(format_print)

#-----------------------------------------------------------------------------------------------------------
def normalize_istante(date_string):
    ''' This function converts a Bolzano timestamp ('YYYY-MM-DDTHH:MM:SS' + tz suffix, CET/CEST)
        to the compact YYYYMMDDHHMM form in ORA SOLARE (CET, UTC+1). Bolzano publishes local civil time:
        if the value is CEST (DST, UTC+2) we subtract 1 hour; if CET (UTC+1) it is left unchanged.
        The archive is thus always stored in solar time. None on failure. '''
    try:
        s  = date_string.strip()
        tz = re.search(r'[A-Za-z]+$', s)
        clean = re.sub(r'[A-Za-z]+$', '', s)                            # drop trailing tz (CET/CEST/...)
        dt = datetime.datetime.strptime(clean, '%Y-%m-%dT%H:%M:%S')
        if tz and tz.group(0).upper() == 'CEST':
            dt -= datetime.timedelta(hours=1)                           # CEST(UTC+2) -> solare(UTC+1)
        return dt.strftime('%Y%m%d%H%M')
    except (ValueError, TypeError, AttributeError):
        return None

#-----------------------------------------------------------------------------------------------------------
def class_parsing(**kwargs):
    '''This function parses the variables class and returns the variable list. '''

# debug switch
    DEBUG = kwargs.get('debug_opt', False)

# extract variables
    var_list = [item for item in dir(variables) if not item.startswith('__')]
    if DEBUG:
        print('Variable list: ' + ' / '.join(var_list))

# end of function
    return var_list

#-----------------------------------------------------------------------------------------------------------
def download_file(url, directory_name, file_name, **kwargs):
    ''' This function downloads a file (json) from the given URL. '''

# debug switch
    DEBUG = kwargs.get('debug_opt', False)
    if DEBUG: print(url)

# query data from URL
    try:
        request = requests.get(url, allow_redirects=True, headers=HEADERS)
    except requests.RequestException as error:
        sys.exit('Error downloading ' + url + ': ' + str(error))

# file name
    filename = os.path.join(directory_name, file_name)

# print summary
    string1 = (f"{'data file ' + file_name : <55}")
    print(string1, end=' ... ', flush=True)

# save file
    with open(filename, 'wb') as fp:
        fp.write(request.content)

# end of function
    print('downloaded')
    return filename

#-----------------------------------------------------------------------------------------------------------
def json_load(filename):
    '''This function loads data from a json file. '''
    with open(filename, 'r') as fp:
        text = fp.read()
    if not text.strip():
        print('WARN: file JSON vuoto, ignorato: ' + filename); return {}
    try:
        data = json.loads(text)
    except ValueError as e:
        print('WARN: file JSON illeggibile (' + str(e) + '), ignorato: ' + filename); return {}
    return data

#-----------------------------------------------------------------------------------------------------------
def json_save(data, filename, **kwargs):
    ''' This function exports data to a json file. '''
    sort_keys = kwargs.get('sort_keys', True)
    tmp = filename + '.tmp'
    with open(tmp, 'w') as fp:
        json.dump(data, fp, sort_keys=sort_keys, separators=(',',':'), ensure_ascii=False)
        fp.flush(); os.fsync(fp.fileno())
    os.replace(tmp, filename)   # scrittura atomica: mai file monchi da riavvio a meta' write
    return

#-----------------------------------------------------------------------------------------------------------
def latest_datetime_string(download_dir, subdir_list):
    ''' This function returns the most recent datetime_string (YYYYMMDD-HHMMSS) among the already-downloaded
        files, so that data can be parsed without re-downloading. Returns None if nothing has been downloaded. '''

# collect the datetime prefixes of every downloaded file
    stamps = []
    for subdir in subdir_list:
        current_dir = os.path.join(download_dir, subdir)
        if not os.path.isdir(current_dir):
            continue
        for name in os.listdir(current_dir):
            parts = name.split('-')
            if len(parts) >= 2:
                stamps.append(parts[0] + '-' + parts[1])

# most recent one (string sort works on the YYYYMMDD-HHMMSS format)
    return max(stamps) if stamps else None

#-----------------------------------------------------------------------------------------------------------
def delete_downloaded(download_dir, subdir_list, datetime_string, **kwargs):
    ''' This function removes the raw downloaded files of a given batch. It is meant to be called ONLY
        after a successful parse, so the redundant raw dumps do not pile up on disk. '''

# debug switch
    DEBUG = kwargs.get('debug_opt', False)

# remove every downloaded file whose name starts with the batch timestamp
    removed = 0
    prefix  = datetime_string + '-'
    for subdir in subdir_list:
        current_dir = os.path.join(download_dir, subdir)
        if not os.path.isdir(current_dir):
            continue
        for name in os.listdir(current_dir):
            if name.startswith(prefix):
                try:
                    os.remove(os.path.join(current_dir, name))
                    removed += 1
                except OSError as error:
                    if DEBUG:
                        print('could not remove ' + name + ': ' + str(error))

# print summary
    print('Raw downloaded files removed: ' + str(removed))

# end of function
    return removed

#===========================================================================================================
# MAIN SENTINEL
#===========================================================================================================

if __name__ == "__main__":

# initialize argument parser
    parser = argparse.ArgumentParser()

# parse arguments
    parser.add_argument("-d", "--download",
                        dest = "download_flag",
                        default = "yes",
                        help="Flag for download [yes/no]")

    parser.add_argument("-p", "--parse",
                        dest = "parse_flag",
                        default = "yes",
                        help="Flag for parsing [yes/no]")

    parser.add_argument("-v", "--variables",
                        dest = "processing_variable",
                        nargs = '*',
                        default = "all",
                        help="Variable(s) [all/TEMP/PREC/UMID/PRESS/RADSOL/SOLEGG/VVENTO/VVENTOMAX/DVENTO/"
                             "LIVNEVE/LIVIDRO/PORTATA/FREATICA/TEMPACQUA/SOLIDI]"
                        )

# NB: the Bolzano '/sensors' feed only exposes the LATEST reading per sensor, therefore there is no
#     historical date selection (no '-date' argument as in the ARPAV Veneto script). Run periodically
#     (e.g. hourly) to accumulate a time series.

    parser.add_argument("-c", "--cleanup",
                        dest = "cleanup_flag",
                        default = "yes",
                        help="Delete raw downloaded files after a successful parse [yes/no]")

# retrieve flags
    args = parser.parse_args()

# default station-list path and batch timestamp (used when parsing without a fresh download)
    file_stazioni_json = os.path.join(directory.parse, 'stazioni.json')
    datetime_string    = None

# data download
    if args.download_flag in ['yes', 'Yes', 'YES', 'y', 'Y']:
        file_stazioni_json, datetime_string = download_data(
                                        directory,
                                        debug_opt = switch.debug,
                                        )

# data parsing
    if args.parse_flag in ['yes', 'Yes', 'YES', 'y', 'Y']:

# if no download was performed, parse the most recent already-downloaded batch
        if datetime_string is None:
            datetime_string = latest_datetime_string(directory.download, [subdir_dati])
            if datetime_string is None:
                sys.exit('No downloaded data found to parse. Run with --download yes first.')

        parse_data(file_stazioni_json, datetime_string,
                                        directory,
                                        var = args.processing_variable,
                                        debug_opt = switch.debug,
                                        )

# remove the raw downloaded files, but ONLY after a successful parse (no exception was raised above)
        if args.cleanup_flag in ['yes', 'Yes', 'YES', 'y', 'Y']:
            delete_downloaded(directory.download, [subdir_dati], datetime_string, debug_opt = switch.debug)
