#!/usr/bin/env python3

# Meteotrentino data downloader/parser.
# Mirrors the behaviour of the ARPAV Veneto script (dati_veneto.py) but adapted to the
# Meteotrentino web service, whose XML structure is substantially different:
#   - station list : http://dati.meteotrentino.it/service.asmx/listaStazioni
#   - station data : http://dati.meteotrentino.it/service.asmx/ultimiDatiStazione?codice=<CODE>
# Notes on the differences (see comments below): the service only returns the LATEST data
# (no historical date selection), there is no ISTANTERUN, timestamps are ISO 8601 and every
# 15 minutes, all tags live in the http://www.meteotrentino.it/ default namespace, and the
# available variables are TEMP, PREC, VVENTO, DVENTO, RADSOL, UMID only.

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

# Meteotrentino service base URL and endpoints
base_URL     = 'http://dati.meteotrentino.it/service.asmx'
url_lista    = base_URL + '/listaStazioni'                       # station list
url_dati     = base_URL + '/ultimiDatiStazione?codice='         # station data (append the station code)

# subdirectory where the per-station xml files are stored
subdir_dati  = 'dati'

# XML default namespace used by every Meteotrentino response
NS = {'mt': 'http://www.meteotrentino.it/'}

# variable classes: each variable maps a fixed section/item of the station-data XML.
#   section  : wrapper tag                (e.g. <temperature>)
#   item     : repeated measure element   (e.g. <temperatura_aria>)
#   value    : tag holding the main value (stored as VALORE)
#   um_attr  : attribute of <item> holding the unit of measure
#   extra    : additional value tags to keep, {OUTPUT_LABEL: xml_tag}
class variables:
    class TEMP:
        section = 'temperature'
        item    = 'temperatura_aria'
        value   = 'temperatura'
        um_attr = 'UM'
        extra   = {}
    class PREC:
        section = 'precipitazioni'
        item    = 'precipitazione'
        value   = 'pioggia'
        um_attr = 'UM'
        extra   = {}
    class VVENTO:
        section = 'venti'
        item    = 'vento_al_suolo'
        value   = 'v'                    # wind speed (mean)
        um_attr = 'UM_VV'
        extra   = {'VMAX': 'vmax'}       # wind gust kept alongside the mean speed
    class DVENTO:
        section = 'venti'
        item    = 'vento_al_suolo'
        value   = 'd'                    # wind direction
        um_attr = 'UM_DV'
        extra   = {}
    class RADSOL:
        section = 'radiazione'
        item    = 'radiazioneglobale'
        value   = 'rsg'
        um_attr = 'UM'
        extra   = {}
    class UMID:
        section = 'umidita_relativa'
        item    = 'umidita_relativa'
        value   = 'rh'
        um_attr = 'UM'
        extra   = {}

#===========================================================================================================
# MODULES
#===========================================================================================================
import argparse                                         # argument parsing
import datetime                                         # date and time
import json                                             # manage json files
import os                                               # manage system commands (e.g. directory creation)
import requests                                         # download files from web
import sys                                              # system commands
import xml.etree.ElementTree as ET                      # XML parsing

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

# DOWNLOAD STATION LIST

    file_name        = datetime_string + '-listaStazioni.xml'
    xml_station_file = download_data_xml(url_lista, current_dir, file_name, debug_opt=DEBUG)

# PARSE STATION LIST

# parse current station list (full list, every station is checked at each run)
    station_list_new = parse_station_list(xml_station_file)

# load existing station list, if already existing, and merge new stations into it
    if os.path.exists(file_stazioni_json):
        station_list_old = json_load(file_stazioni_json)
        station_list     = check_new_stations(station_list_old, station_list_new)
    else:
        station_list     = station_list_new

# save merged station list
    json_save(station_list, file_stazioni_json)

# DOWNLOAD STATION DATA (active stations only, i.e. empty 'fine' field)

    active = [code for code, staz in station_list_new.items() if is_active(staz)]
    print('Active stations: ' + str(len(active)) + ' of ' + str(len(station_list_new)))

    for code in active:
        URL       = url_dati + code
        file_name = datetime_string + '-' + code + '.xml'
        download_data_xml(URL, current_dir, file_name, debug_opt=DEBUG)

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

# parse station list
    station_list = json_load(file_stazioni_json)

# directory holding the downloaded station files
    current_dir = os.path.join(directory.download, subdir_dati)

# loop over variables
    for var in var_processed:
        if var not in var_list:
            continue

# print summary
        print("\nVariable : " + var)
        cfg = getattr(variables, var)

# daily bins loaded on demand: day (YYYYMMDD) -> { code -> station record }
        daily = {}

# loop over stations
        for code, staz in station_list.items():

# station file for this download batch
            xml_station_file = os.path.join(current_dir, datetime_string + '-' + code + '.xml')
            if not os.path.exists(xml_station_file):
                continue

# parse the time series for the current variable
            um, series = parse_measures(xml_station_file, cfg, debug_opt=DEBUG)
            if not series:
                continue

# route each measure into the daily bin of its own date (a dump may span two days)
            for measure in series:
                day = measure['ISTANTE'][0:8]

# load the daily file the first time this day is touched
                if day not in daily:
                    filename_var = os.path.join(directory.parse, var, var + '-' + day + '.json')
                    daily[day] = json_load(filename_var) if os.path.exists(filename_var) else {}

                bin_day = daily[day]

# initialize the station record the first time it appears in this day
                if code not in bin_day:
                    bin_day[code] = {
                        'STAZIONE': staz,
                        'UM'      : um,
                        'MISURE'  : {'ISTANTE': [], 'VALORE': []},
                    }
                    for label in cfg.extra:
                        bin_day[code]['MISURE'][label] = []

                misure = bin_day[code]['MISURE']

# dedup / append: keep only measures newer than the last one already stored
                if misure['ISTANTE'] and int(measure['ISTANTE']) <= int(misure['ISTANTE'][-1]):
                    continue

                misure['ISTANTE'].append(measure['ISTANTE'])
                misure['VALORE'].append(measure['VALORE'])
                for label in cfg.extra:
                    misure[label].append(measure.get(label))

# save every daily file touched for this variable
        for day, bin_day in daily.items():
            filename_var = os.path.join(directory.parse, var, var + '-' + day + '.json')
            json_save(bin_day, filename_var, sort_keys=False)
            if DEBUG:
                print(filename_var + ' : ' + str(len(bin_day)) + ' stations')

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
def normalize_istante(iso_string):
    ''' This function converts a Meteotrentino ISO timestamp (YYYY-MM-DDTHH:MM:SS) to the compact
        YYYYMMDDHHMM form, so it can be compared/sorted as an integer. Returns None on failure. '''
    try:
        return datetime.datetime.strptime(iso_string, '%Y-%m-%dT%H:%M:%S').strftime('%Y%m%d%H%M')
    except (ValueError, TypeError):
        return None

#-----------------------------------------------------------------------------------------------------------
def is_active(station):
    ''' This function returns True if a station is active, i.e. its 'fine' field is empty. '''
    fine = station.get('fine')
    return fine is None or str(fine).strip() == ''

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
def download_data_xml(url, directory_name, file_name, **kwargs):
    ''' This function downloads an XML file from the given URL. '''

# debug switch
    DEBUG = kwargs.get('debug_opt', False)
    if DEBUG: print(url)

# query data from URL
    try:
        request = requests.get(url, allow_redirects=True)
    except requests.RequestException as error:
        sys.exit('Error downloading ' + url + ': ' + str(error))

# file name
    filename = os.path.join(directory_name, file_name)

# print summary
    string1 = (f"{'xml data file ' + file_name : <55}")
    print(string1, end=' ... ', flush=True)

# save XML file
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
def parse_station_list(xml_station_file):
    ''' This function returns a dictionary of the stations, keyed by their code. '''

# print summary
    string1 = (f"{'parse station list' : <55}")
    print(string1, end=' ... ', flush=True)

# initialize dictionary
    station_list = {}

# parse XML file
    tree = ET.parse(xml_station_file)
    root = tree.getroot()

# loop over anagrafica elements
    for item in root.findall('mt:anagrafica', NS):
        dictionary = {}
        for label in ['codice', 'nome', 'nomebreve', 'quota', 'latitudine', 'longitudine',
                      'est', 'north', 'inizio', 'fine']:
            child = item.find('mt:' + label, NS)
            dictionary[label] = child.text if child is not None else None

# append current station to storage (keyed by code)
        code = dictionary['codice']
        if code is not None:
            station_list[code] = dictionary

# print result
    print(str(len(station_list)) + ' items found')

# end of function
    return station_list

#-----------------------------------------------------------------------------------------------------------
def parse_measures(xml_station_file, cfg, **kwargs):
    ''' This function returns (unit, measures) for a given variable configuration.
        'measures' is a list of dicts: {'ISTANTE': YYYYMMDDHHMM, 'VALORE': value, <extra labels>: value}. '''

# debug switch
    DEBUG = kwargs.get('debug_opt', False)

# parse XML file
    tree = ET.parse(xml_station_file)
    root = tree.getroot()

# unit of measure and result list
    unit     = None
    measures = []

# loop over the items of the variable section
    for item in root.findall('mt:' + cfg.section + '/mt:' + cfg.item, NS):

# unit of measure (taken once from the item attributes)
        if unit is None:
            unit = item.get(cfg.um_attr)

# timestamp
        data_node = item.find('mt:data', NS)
        if data_node is None:
            continue
        istante = normalize_istante(data_node.text)
        if istante is None:
            continue

# main value
        value_node = item.find('mt:' + cfg.value, NS)
        record = {'ISTANTE': istante,
                  'VALORE' : value_node.text if value_node is not None else None}

# extra values
        for label, tag in cfg.extra.items():
            extra_node = item.find('mt:' + tag, NS)
            record[label] = extra_node.text if extra_node is not None else None

        measures.append(record)

# print result
    if DEBUG:
        print(str(len(measures)) + ' measures found for ' + cfg.value)

# end of function
    return unit, measures

#-----------------------------------------------------------------------------------------------------------
def check_new_stations(station_list_old, station_list_new):
    '''This function checks for new/updated stations and merges the new list into the old one.'''

# initialize station list (copy, so the caller's dict is not mutated in place)
    station_list = dict(station_list_old)

# loop over elements of the new station list, updating metadata and adding new stations
    for code, station in station_list_new.items():
        station_list[code] = station

# end of function
    return station_list

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
                        help="Variable(s) to be processed [all/TEMP/PREC/VVENTO/DVENTO/RADSOL/UMID]"
                        )

# NB: the Meteotrentino service only exposes the LATEST data, therefore there is no historical
#     date selection (no '-date' argument as in the ARPAV Veneto script).

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
