#!/usr/bin/env python3

# Friuli-Venezia Giulia (meteo.fvg / ARPA FVG - OSMER) data downloader/parser.
# Mirrors the behaviour of the ARPAV Veneto script (dati_veneto.py) but adapted to the
# meteo.fvg web service, whose XML structure is substantially different:
#   - no station-list endpoint: the station links are scraped from the home page
#         https://dev.meteo.fvg.it   ->   .../xml/stazioni/<CODE>.xml
#   - each station file exposes ONE current hourly observation (<meteo_data>), NOT a time series.
#     A time series is therefore built by ACCUMULATING one observation per run: this script is
#     meant to be scheduled hourly (e.g. via cron), and each run appends one point per station.
#   - timestamps are 'DD/MM/YYYY HH.MM UTC' (UTC!), there is no XML namespace, and the field set
#     varies from station to station (missing tags are simply skipped).

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

# meteo.fvg URLs
home_URL     = 'https://dev.meteo.fvg.it'                        # home page listing the stations
station_base = 'https://dev.meteo.fvg.it/xml/stazioni/'         # per-station data: station_base + <code> + '.xml'

# subdirectory where the per-station xml files are stored
subdir_dati  = 'dati'

# HTTP headers (some endpoints reject the default python-requests user agent)
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; meteo-fvg-fetcher/1.0)'}

# variable classes: each variable maps a single tag of the <meteo_data> observation block.
#   tag    : xml tag holding the value (stored as VALORE); the unit is read from its 'um' attribute
#   extra  : additional value tags to keep, {OUTPUT_LABEL: xml_tag}
class variables:
    class TEMP:                          # temperatura a 2m
        tag   = 't180'
        extra = {}
    class PREC:                          # precipitazione
        tag   = 'rr'
        extra = {}
    class VVENTO:                        # velocita' vento a 10m (vettoriale), con raffica come extra
        tag   = 'ff10'
        extra = {'VMAX': 'vmax'}
    class DVENTO:                        # direzione vento a 10m
        tag   = 'dd10'
        extra = {}
    class RADSOL:                        # radiazione solare
        tag   = 'rg'
        extra = {}
    class UMID:                          # umidita' relativa
        tag   = 'rh'
        extra = {}
    class PRESS:                         # pressione
        tag   = 'press'
        extra = {}
    class BAGNATURA:                     # bagnatura fogliare
        tag   = 'bf'
        extra = {}
    class PREC_TYPE:                     # tipo di precipitazione (0:nulla 1:pioggia 2:pioggia+neve 3:neve)
        tag   = 'prec_type'
        extra = {}
    class CLOUDINESS:                    # nuvolosita' (0:n.d. 1:sereno ... 5:coperto)
        tag   = 'cloudiness'
        extra = {}
    class VVENTOSCAL:                    # velocita' vento scalare a 10m (v10)
        tag   = 'v10'
        extra = {}
    class DVENTOMAX:                     # direzione della raffica a 10m (dd10max)
        tag   = 'dd10max'
        extra = {}
    class TEMPACQUA:                     # temperatura acqua (mare) - stazioni marine
        tag   = 'tmare'
        extra = {}

# tags of <meteo_data> that are metadata, not measures
META_TAGS = {'observation_time', 'observation_date', 'observation_hour',
             'station_id', 'station_name', 'station_altitude'}

#===========================================================================================================
# MODULES
#===========================================================================================================
import argparse                                         # argument parsing
import datetime                                         # date and time
import json                                             # manage json files
import os                                               # manage system commands (e.g. directory creation)
import re                                               # regular expressions (home page scraping)
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

# SCRAPE STATION LIST FROM HOME PAGE

    codes = fetch_station_codes(home_URL, current_dir, datetime_string, debug_opt=DEBUG)
    print('Stations found on home page: ' + str(len(codes)))

# DOWNLOAD STATION DATA

    for code in codes:
        URL       = station_base + code + '.xml'
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

# load existing station list (code -> metadata), if any
    station_list = json_load(file_stazioni_json) if os.path.exists(file_stazioni_json) else {}

# directory holding the downloaded station files
    current_dir = os.path.join(directory.download, subdir_dati)

# PARSE EVERY STATION OBSERVATION OF THIS BATCH (once)

    observations = []
    prefix = datetime_string + '-'
    for name in sorted(os.listdir(current_dir)):
        if not (name.startswith(prefix) and name.endswith('.xml')):
            continue
        code = name[len(prefix):-4]                  # station code (numeric or alphanumeric)
        if not code:                                 # the home page is saved as '-home.html' (not .xml), so already excluded
            continue

        obs = parse_observation(os.path.join(current_dir, name), debug_opt=DEBUG)
        if obs is None:
            continue
        obs['code'] = code
        observations.append(obs)

# keep the station metadata up to date
        station_list[code] = obs['STAZIONE']

    print('Stations parsed: ' + str(len(observations)))

# LOOP OVER VARIABLES

    for var in var_processed:
        if var not in var_list:
            continue

# print summary
        print("\nVariable : " + var)
        cfg = getattr(variables, var)

# daily bins loaded on demand: day (YYYYMMDD) -> { code -> station record }
        daily = {}

# loop over the parsed observations
        for obs in observations:

# skip stations that do not carry this variable
            if cfg.tag not in obs['values']:
                continue
            istante = obs['istante']
            if istante is None:
                continue

            day  = istante[0:8]
            code = obs['code']

# load the daily file the first time this day is touched
            if day not in daily:
                filename_var = os.path.join(directory.parse, var, var + '-' + day + '.json')
                daily[day] = json_load(filename_var) if os.path.exists(filename_var) else {}

            bin_day = daily[day]

# initialize the station record the first time it appears in this day
            if code not in bin_day:
                bin_day[code] = {
                    'STAZIONE': obs['STAZIONE'],
                    'UM'      : obs['ums'].get(cfg.tag),
                    'MISURE'  : {'ISTANTE': [], 'VALORE': []},
                }
                for label in cfg.extra:
                    bin_day[code]['MISURE'][label] = []

            misure = bin_day[code]['MISURE']

# dedup / append: keep only observations newer than the last one already stored
            if misure['ISTANTE'] and int(istante) <= int(misure['ISTANTE'][-1]):
                continue

            misure['ISTANTE'].append(istante)
            misure['VALORE'].append(obs['values'].get(cfg.tag))
            for label, tag in cfg.extra.items():
                misure[label].append(obs['values'].get(tag))

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
def normalize_istante(fvg_string):
    ''' This function converts a meteo.fvg timestamp ('DD/MM/YYYY HH.MM UTC') to the compact
        YYYYMMDDHHMM form in ORA SOLARE (CET, UTC+1). meteo.fvg publishes in UTC, so we add 1 hour.
        The archive is thus always stored in solar time. Returns None on failure. '''
    try:
        clean = fvg_string.strip().replace(' UTC', '')
        dt = datetime.datetime.strptime(clean, '%d/%m/%Y %H.%M') + datetime.timedelta(hours=1)
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
def fetch_station_codes(url, directory_name, datetime_string, **kwargs):
    ''' This function downloads the home page and scrapes the station codes from the links of the
        form .../xml/stazioni/<code>.xml (the '_week' daily-aggregate variants are ignored). '''

# download the home page (saved for reference alongside the data)
    filename = download_data_xml(url, directory_name, datetime_string + '-home.html', **kwargs)

# read the html
    with open(filename, 'r', encoding='utf-8', errors='replace') as fp:
        html = fp.read()

# scrape the station codes: numeric AND alphanumeric (101, G201, A009, ...). The '_week' aggregate
# links are naturally skipped because '_' is not in the character class.
    codes = sorted(set(re.findall(r'stazioni/([A-Za-z0-9]+)\.xml', html)))

# end of function
    return codes

#-----------------------------------------------------------------------------------------------------------
def download_data_xml(url, directory_name, file_name, **kwargs):
    ''' This function downloads a file (xml or html) from the given URL. '''

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
def parse_observation(xml_station_file, **kwargs):
    ''' This function parses the current observation (<meteo_data>) of a station file and returns
        {'istante', 'STAZIONE', 'values', 'ums'} or None if the file has no observation. '''

# debug switch
    DEBUG = kwargs.get('debug_opt', False)

# parse XML file (be robust against error pages / malformed content)
    try:
        tree = ET.parse(xml_station_file)
    except ET.ParseError:
        if DEBUG:
            print('skip (not valid XML): ' + xml_station_file)
        return None
    root = tree.getroot()

# locate the current observation block
    md = root.find('meteo_data')
    if md is None:
        return None

# timestamp (UTC) normalized to YYYYMMDDHHMM
    istante = normalize_istante(md.findtext('observation_time'))

# station metadata
    altitude_node = md.find('station_altitude')
    station = {
        'station_id'      : md.findtext('station_id'),
        'station_name'    : md.findtext('station_name'),
        'station_altitude': altitude_node.text if altitude_node is not None else None,
    }

# measured values and their units
    values = {}
    ums    = {}
    for element in md:
        if element.tag in META_TAGS:
            continue
        values[element.tag] = element.text.strip() if element.text else None
        if element.get('um'):
            ums[element.tag] = element.get('um')

    if DEBUG:
        print(station['station_id'], istante, str(len(values)) + ' fields')

# end of function
    return {'istante': istante, 'STAZIONE': station, 'values': values, 'ums': ums}

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
                        help="Variable(s) [all/TEMP/PREC/VVENTO/VVENTOSCAL/DVENTO/DVENTOMAX/RADSOL/UMID/PRESS/"
                             "BAGNATURA/PREC_TYPE/CLOUDINESS/TEMPACQUA]"
                        )

# NB: meteo.fvg only exposes the LATEST hourly observation, therefore there is no historical
#     date selection (no '-date' argument as in the ARPAV Veneto script). Run hourly to build a series.

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
