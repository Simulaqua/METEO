#!/usr/bin/env python3


# tree = ET.parse('movies.xml')
# root = tree.getroot()
# for item in root.findall('STAZIONE/SENSORE/DATI'):
#   print(item.get('ISTANTE'), item.find('VM').text)

# value
# root.findall('STAZIONE/SENSORE/DATI')[-1].find('VM').text
# istante
# root.findall('STAZIONE/SENSORE/DATI')[-1].get('ISTANTE')

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

# Arpav base URL
base_URL     = 'https://meteo.arpa.veneto.it/meteo/dati_meteo/xml'

# variable classes
class variables:
    class TEMP:
        url_stazioni    = 'stazioni.xml'
        id_stazioni     = 'meteo'
    class PREC:
        url_stazioni    = 'stazioni.xml'
        id_stazioni     = 'meteo'
    class VVENTO:
        url_stazioni    = 'stazioni.xml'
        id_stazioni     = 'meteo'
    class DVENTO:
        url_stazioni    = 'stazioni.xml'
        id_stazioni     = 'meteo'
    class RADSOL:
        url_stazioni    = 'stazioni.xml'
        id_stazioni     = 'meteo'
    class UMID:
        url_stazioni    = 'stazioni.xml'
        id_stazioni     = 'meteo'
    class VISIB:
        url_stazioni    = 'stazioni.xml'
        id_stazioni     = 'meteo'
    class PRESS:
        url_stazioni    = 'stazioni.xml'
        id_stazioni     = 'meteo'
    class LIVIDRO:
        url_stazioni    = 'stazioni_idro.xml'
        id_stazioni     = 'idro'
    class PORTATA:
        url_stazioni    = 'stazioni_idro.xml'
        id_stazioni     = 'idro'
    class LIVNEVE:
        url_stazioni    = 'stazioni_neve.xml'
        id_stazioni     = 'neve'

#===========================================================================================================
# MODULES
#===========================================================================================================
import argparse                                         # argument parsing
import datetime                                         # date and time
import csv                                              # csv file management
import time                                             # local time
import json                                             # manage json files
import os                                               # manage system commands (e.g. directory creation)
import requests                                         # download files from web
import sys                                              # system commands
import xml.etree.ElementTree as ET                     # XML parsing
 
#===========================================================================================================
# MAIN FUNCTION
#===========================================================================================================

#-----------------------------------------------------------------------------------------------------------
# DATA DOWNLOADING
#-----------------------------------------------------------------------------------------------------------

def download_data(base_URL, variables, directory, **kwargs):

# print function title
    print('\n***  DATA DOWNLOADING  ***')

# print initial date and time
    title_date_time_now(title = 'Module starts on ')

# debug switch
    DEBUG = kwargs.get('debug_opt', False)

# class parsing    
    var_list, station_url_list, subdir_list = class_parsing(variables, debug_opt = DEBUG)

# variables
    var_processed = kwargs.get('var', var_list)
    if var_processed == "all":
        var_processed = var_list

# DIRECTORIES

# create dowload directories, if not already existing
    for subdir in subdir_list:
        current_directory = os.path.join(directory.download, subdir)
        create_directory(current_directory)
    
# create parsing directory, if not already existing
    create_directory(directory.parse)

# default station-list json path (ensures a defined return value even if no variable is processed)
    file_stazioni_json = os.path.join(directory.parse, 'stazioni.json')

# DATE AND TIME

# current date
    today = datetime.date.today()

# current datetime
    datetime_string = date_time_string()

# LOOP OVER VARIABLES TO BE PROCESSED

# initialize array for already-downloaded stations
    downloaded_subset = []

# loops for variables, without donwload repetition
    for var in var_processed:
        if var in var_list:

# print summary
            print("\nVariable : " + var)

# exclude download repetition
            if getattr(variables, var).id_stazioni in downloaded_subset:
                print("Stations " + getattr(variables, var).id_stazioni + ": already downloaded.")

# add current subset
            else:
                downloaded_subset.append( getattr(variables, var).id_stazioni )
                print("Stations " + getattr(variables, var).id_stazioni + ": not yet donwloaded.")

# DOWNLOAD STATION LIST

# station URL
                URL = os.path.join(base_URL, getattr(variables, var).url_stazioni)

# retrieve station list from URL and save xml file
                file_name   = datetime_string + '-stazioni-' + getattr(variables, var).url_stazioni
                current_dir = os.path.join(directory.download, getattr(variables, var).id_stazioni)
                xml_station_file = download_data_xml(URL, current_dir, file_name, debug_opt=DEBUG)

# se il download della lista stazioni fallisce, salta questa variabile (riprova al run successivo)
                if xml_station_file is None:
                    print('Lista stazioni non scaricata: salto ' + var)
                    continue

# PARSE STATION LIST

# parse data last update
                last_update = parse_last_update(xml_station_file)

# parse current station list
                station_list_new = parse_station_list(xml_station_file) 
   
# load existing station list, if already existing
                file_name = os.path.join(directory.parse, 'stazioni.json')
                if os.path.exists(file_name):
                    print(file_name)
                    station_list_old = json_load(file_name)

# check for new elements in station list
                    station_list = check_new_stations(station_list_old, station_list_new)    
 
# if station list not yet existst, then consider the just-downloaded station list
                else:
                    station_list = station_list_new

 # save station list
                json_save(station_list, file_name) 
                file_stazioni_json = file_name

# DOWNLOAD STATION DATA

# loop over station list
                for item in station_list_new.values():

# station URL   
                    URL = os.path.join(base_URL, item['LINKSTAZ'])

# retrieve station list from URL and save xml file
                    file_name = datetime_string + '-' + item['LINKSTAZ']
                    xml_station_file = download_data_xml(URL, current_dir, file_name, debug_opt=DEBUG)

# print final date and time
    title_date_time_now(title = 'Module ends on ')

# end of the function
    return file_stazioni_json, datetime_string

#-----------------------------------------------------------------------------------------------------------
# DATA PARSING
#-----------------------------------------------------------------------------------------------------------
def parse_data(file_stazioni_json, datetime_string, variables, directory, processing_date, **kwargs):

# print function title
    print('\n***  DATA PARSING  ***')

# print initial date and time
    title_date_time_now(title = 'Module starts on ')

# debug switch
    DEBUG = kwargs.get('debug_opt', False)

# class parsing    
    var_list, station_url_list, subdir_list = class_parsing(variables, debug_opt = DEBUG)

# variables
    var_processed = kwargs.get('var', var_list)
    if var_processed == "all" or "all" in var_processed:
        var_processed = var_list

# create parse directories, if not already existing
    for var in var_processed:
        if var in var_list:
            current_directory = os.path.join(directory.parse, var)
            create_directory(current_directory)

# parse station_list
    station_list = json_load(file_stazioni_json)

# initialize data storage arrays
    data_old = {} #dict.fromkeys(variable_list, None)
    data_new = {} #dict.fromkeys(variable_list, None)

# processing dates(NB 'local' time is intentionally even if ARPAV times are referred to local solar time, because on daylight saving time the function works still correctly, e.g. 
    if processing_date[0] in ['today', 'Today', 'TODAY', 't', 'T']:
        timestamp_begin = timestamp('local', hour=0, minute=0, second=0)
        timestamp_end   = timestamp('local')

    elif processing_date[0] in ['yesterday', 'Yesterday', 'YESTERDAY', 'y', 'Y']:
        YY, MM, DD, HH, MN, SS = time_operation(delta_day = -1)
        timestamp_begin = timestamp('local', year=YY, month=MM, day=DD, hour=0, minute=0, second=0)
        timestamp_end   = timestamp('local', year=YY, month=MM, day=DD, hour=23, minute=59, second=59)

    else:
        timestamp_begin = timestamp('local', 
                        year  = processing_date[0], 
                        month = processing_date[1], 
                        day   = processing_date[2], 
                        hour=0, minute=0, second=0)
        timestamp_end   = timestamp('local', 
                        year  = processing_date[0], 
                        month = processing_date[1], 
                        day = processing_date[2], 
                        hour=23, minute=59, second=59)
    if DEBUG:
        print('Prsed time from ' + timestamp_begin + ' to ' + timestamp_end)

# loop over variables
    for var in var_processed:
        if var in var_list:

# print summary
            print("\nVariable : " + var)

# initialize current bin
            data_new[var] = {}

# file name
            filename_var = os.path.join(directory.parse, var, var + '-' + str(timestamp_begin)[0:8] + '.json' )
            if DEBUG:
                print(filename_var)

# case 1: file already exists, therefore data are appended
            if os.path.exists( filename_var) :
                data_old[var] = json_load(filename_var)                                        

# case 2: file is to be created 
            else:
                data_old[var] = {}

# loop over stations
            for staz in station_list.values():

# dataset of the current variable and station
                subdir = getattr(variables, var).id_stazioni

# station file
                xml_station_file = os.path.join( directory.download, subdir, datetime_string + '-' + staz['LINKSTAZ'] )

# check if file is really present in current dataset
                if os.path.exists( xml_station_file ):

# check if current variable belongs to variable measured by the parsed file
                    current_var_list = parse_measures(xml_station_file, 2, None, debug_opt = DEBUG)
                    if var in current_var_list:

# update station list with current variable
#                        if ['VAR'] not in station_list[ staz['IDSTAZ'] ]:
#                            station_list[ staz['IDSTAZ'] ]['VAR'] = []
#                        if var not in station_list[ staz['IDSTAZ'] ]['VAR']:
#                            station_list[ staz['IDSTAZ'] ]['VAR'].append( var )

# check current station ID
                        idstaz = parse_measures(xml_station_file, 3, None, debug_opt = DEBUG) 
                        if idstaz not in data_new[var]:

# initialize bin
                            data_new[var][idstaz] = {}

# parse last update
                            data_new[var][idstaz]['ISTANTERUN'] = parse_last_update(xml_station_file)

# parse station data, sensor data, and measures
                            for label, flag in zip( ['STAZIONE', 'SENSORE', 'MISURE'], [1, 4, 5] ):
                                data_new[var][idstaz][label] = parse_measures(
                                    xml_station_file, flag, var, debug_opt = DEBUG)
                               
# print summary
                            if DEBUG:
                                print(var, '  ', idstaz)              

# the station already has history only if the file exists AND the station is already in it
                            station_exists = os.path.exists( filename_var ) and idstaz in data_old[var]

# case 1: station already present, therefore data are appended
                            if station_exists:

# parse istante run
                                istanterun = data_old[var][idstaz]['ISTANTERUN']

# beginning time is the last recorded time (per-station: DO NOT mutate the shared timestamp_begin).
# NB: a station may be already in the archive but with an EMPTY history (a previous run created the
# bin without appending any measure, e.g. nothing fell in the time window) -> ISTANTE[-1] would raise
# IndexError and crash the whole run. Guard the empty case by falling back to timestamp_begin.
                                istante_hist  = data_old[var][idstaz].get('MISURE', {}).get('ISTANTE', [])
                                last_recorded = int(istante_hist[-1]) + 1 if istante_hist else int(timestamp_begin)
                                station_begin = max( int(timestamp_begin), last_recorded )

# case 2: station bin is to be created (new file, or new station in an existing file)
                            else:

# dummy instante run    
                                istanterun = None

# beginning time is the requested one
                                station_begin = int(timestamp_begin)

# initialize array
                                data_old[var][idstaz] = { 
                                    'ISTANTERUN':None, 'ORALEGALE':None, 'STAZIONE':None, 'SENSORE':None, 
                                'MISURE': { 'ISTANTE':[], 'ORALEGALE':[], 'VM':[] } } 
                        
# set last update time and station characteristics
                            for label in [ 'ISTANTERUN', 'STAZIONE', 'SENSORE' ]:
                                data_old[var][idstaz][label] = data_new[var][idstaz][label]
                            data_old[var][idstaz]['ORALEGALE'] = ora_legale()
                         
# set measures on the basis of time, i.e. station_begin <= current_time <= timestamp_end
                            if data_new[var][idstaz]['ISTANTERUN'] != istanterun:
                                for i in range(len(data_new[var][idstaz]['MISURE']['ISTANTE'])):

                                    if int(data_new[var][idstaz]['MISURE']['ISTANTE'][i]) >= station_begin and int(data_new[var][idstaz]['MISURE']['ISTANTE'][i]) <= int(timestamp_end):
                                        for label in ['ISTANTE', 'VM']:
                                            data_old[var][idstaz]['MISURE'][label].append(
                                                data_new[var][idstaz]['MISURE'][label][i] )
                                        data_old[var][idstaz]['MISURE']['ORALEGALE'].append( ora_legale() )

# print json file            
            json_save(data_old[var], filename_var, sort_keys=False)

# print json file with stations
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
    print(string1.ljust(65,'.'), end=' ', flush=True)    
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
    ''' This function prints the current date and time within a string. '''

# format switch
    format_print = kwargs.get('format_print', "%Y%m%d-%H%M%S")

# current date and time
    now = datetime.datetime.now()

# date and time string
    dt_string= now.strftime(format_print)

# end of the function
    return dt_string

#-----------------------------------------------------------------------------------------------------------
def ora_legale():
    ''' This function returns 1 if current time is Daylight Saving Time, 0 otherwise (metadata only).
        Se il fuso non e' determinabile (tm_isdst == -1) ritorna 0 invece di uscire, per non
        interrompere il parse su sistemi con timezone non configurato. '''
    DST = time.localtime().tm_isdst
    return DST if DST != -1 else 0

#-----------------------------------------------------------------------------------------------------------
def utc_delta():
    ''' This functions returns the hour difference of local time from UTC time. '''
    diff = datetime.datetime.now().hour - datetime.datetime.now(datetime.timezone.utc).hour
    return diff

#-----------------------------------------------------------------------------------------------------------
def time_operation(** kwargs):

# optional arguments
    year    = int( kwargs.get( 'year',   datetime.datetime.now().year   ) )
    month   = int( kwargs.get( 'month',  datetime.datetime.now().month  ) )
    day     = int( kwargs.get( 'day',    datetime.datetime.now().day    ) )
    hour    = int( kwargs.get( 'hour',   datetime.datetime.now().hour   ) )
    minute  = int( kwargs.get( 'minute', datetime.datetime.now().minute ) )
    second  = int( kwargs.get( 'second', datetime.datetime.now().second ) )
    
    delta_day     = int( kwargs.get( 'delta_day',    0 ) )   
    delta_hour    = int( kwargs.get( 'delta_hour',   0 ) )   
    delta_minute  = int( kwargs.get( 'delta_minute', 0 ) )  
    delta_second  = int( kwargs.get( 'delta_second', 0 ) ) 

# time array
    datetime_array = datetime.datetime( year, month, day, hour, minute, second ) + \
                     datetime.timedelta(days    = delta_day)    + \
                     datetime.timedelta(hours   = delta_hour)   + \
                     datetime.timedelta(minutes = delta_minute) + \
                     datetime.timedelta(seconds = delta_second) 

# end of function
    return datetime_array.year, datetime_array.month, datetime_array.day, datetime_array.hour, datetime_array.minute, datetime_array.second

#-----------------------------------------------------------------------------------------------------------
def timestamp(flag, **kwargs):
    '''This function returns a timestamp yyyymmddHHMMSS format) of a given time, with respect to a time reference (local, solar, UTC). '''

# optional arguments
    year    = int( kwargs.get( 'year',   datetime.datetime.now().year   ) )
    month   = int( kwargs.get( 'month',  datetime.datetime.now().month  ) )
    day     = int( kwargs.get( 'day',    datetime.datetime.now().day    ) )
    hour    = int( kwargs.get( 'hour',   datetime.datetime.now().hour   ) )
    minute  = int( kwargs.get( 'minute', datetime.datetime.now().minute ) )
    second  = int( kwargs.get( 'second', datetime.datetime.now().second ) )

# time array
    datetime_local = datetime.datetime( year, month, day, hour, minute, second )

# lag from reference system
    if flag in ['local', 'Local', 'LOCAL', 'l', 'L']:
        datetime_output = datetime_local

    elif flag in ['solar', 'Solar', 'SOLAR', 's', 'S']:
        is_dst = time.daylight and time.localtime().tm_isdst > 0
        datetime_output = datetime_local - datetime.timedelta(hours = 1) if is_dst else datetime_local

    elif flag in ['utc', 'Utc', 'UTC', 'u', 'U']:
        is_dst = time.daylight and time.localtime().tm_isdst > 0
        delta_utc = - (time.altzone if is_dst else time.timezone)    
        datetime_output = datetime_local - datetime.timedelta(hours = delta_utc // 3600)

# timestamp
    timestamp_output = datetime_output.strftime("%Y%m%d%H%M")

# end of the function
    return timestamp_output
 
#-----------------------------------------------------------------------------------------------------------
def class_parsing(variables, **kwargs):
    '''This function parses the variables class. '''

# debug switch
    DEBUG = kwargs.get('debug_opt', False)

# extract variables
    var_list = []
    for item in dir(variables):
        if not item.startswith('__'):
            var_list.append(item) 
    if DEBUG:
        print('Variable list:', end = ' ')
        print(' / '.join(var_list))

# extract station url
    station_url_list = []
    for item in dir(variables):
        if not item.startswith('__'):
            station_url_list.append( getattr(variables, item).url_stazioni)
    if DEBUG:
        print('Station URLs:', end = '  ')
        print(' / '.join(list(dict.fromkeys(station_url_list))))

# extract subdirectories and remove duplicates
    subdir_list = []
    for item in dir(variables):
        if not item.startswith('__'):
            subdir_list.append( getattr(variables, item).id_stazioni ) # extract current subdirectory
    subdir_list = list(dict.fromkeys(subdir_list)) # remove duplicates
    if DEBUG:
        print('Subdirectory list:', end = '  ')
        print(' / '.join(subdir_list))

# end of function
    return var_list, station_url_list, subdir_list

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
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; meteo-veneto-fetcher/1.0)'}

def download_data_xml(url, directory_name, file_name, **kwargs):
    ''' This function downloads the XML file containing the data. On a request error it prints a
        warning and returns None (skip) instead of aborting: cosi' una singola stazione fallita non
        interrompe l'intero run (importante con ~500 stazioni per esecuzione). '''

# debug switch
    DEBUG = kwargs.get('debug_opt',False)
    if DEBUG: print(url)

# print summary
    string1 = (f"{'xml data file ' + file_name : <50}")
    print(string1, end=' ... ', flush=True)

# query data from URL (con User-Agent browser: ARPAV puo' bloccare lo UA di python-requests)
    try:
        request = requests.get(url, allow_redirects=True, headers=HEADERS, timeout=30)
        request.raise_for_status()
    except requests.RequestException as error:
        print('SKIP (' + str(error) + ')')
        return None

# save XML file
    filename = os.path.join(directory_name, file_name)
    with open(filename, 'wb') as fp:
        fp.write(request.content)

# end of function
    print('downloaded')
    return filename

#-----------------------------------------------------------------------------------------------------------
def json_load(filename):
    '''This functions loads data from a json file. '''
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
        json.dump(data, fp, sort_keys=sort_keys, separators=(',',':'))
        fp.flush(); os.fsync(fp.fileno())
    os.replace(tmp, filename)   # scrittura atomica: mai file monchi da riavvio a meta' write
    return 

#-----------------------------------------------------------------------------------------------------------
def parse_last_update(xml_data):
    ''' This function retrieves the last update date in the xml data file. '''

# print summary
    print(xml_data)
    string1 = (f"{'parse last update' : <50}")
    print(string1, end=' ... ', flush=True) 

# parse XML file
    tree = ET.parse(xml_data)
    root = tree.getroot()

# loop over elements until last update is found
    last_update = tree.find('ISTANTERUN')
    last_update = last_update.text

# end of the function
    print(datetime.datetime.strptime(last_update, '%Y%m%d%H%M').strftime('%d/%m/%Y %H:%M'))

# end of the function
    return last_update

#-----------------------------------------------------------------------------------------------------------
def parse_station_list(xml_station_file): 
    ''' This function returns a list containing the station tags. '''

# print summary
    string1 = (f"{'parse station list' : <50}")
    print(string1, end=' ... ', flush=True)

# initialize dictionary
    station_list = {}

# parse XML file
    tree = ET.parse(xml_station_file)
    root = tree.getroot()

# loop over XML elements to find all station data
    for item in tree.iter():
        if item.tag == 'STAZIONE':
            dictionary = {}
            for label in ['IDSTAZ', 'NOME', 'X', 'Y', 'QUOTA', 'TIPOSTAZ', 'COMUNE', 'PROVINCIA', 'LINKSTAZ']:
                dictionary[label] = item.find(label).text

# append current station to storage array
            station_list[item.find('IDSTAZ').text] = dictionary

# print result
    print(str(len(station_list)) + ' items found')

# end of function
    return station_list

#-----------------------------------------------------------------------------------------------------------
def parse_measures(xml_station_file, flag, TYPE, **kwargs): 
    ''' This function returns the station data. '''

# debug switch
    DEBUG = kwargs.get('debug_opt',False)

# print summary
    if DEBUG:
        print('parse file ' + xml_station_file, flush=True)

# initialize dictionary
    if flag == 2:
        dictionary = []
    else:
        dictionary = {}

# parse XML file
    tree = ET.parse(xml_station_file)
    root = tree.getroot()

# parse station data
    if flag == 1:
        for label in ['IDSTAZ', 'NOME', 'X', 'Y', 'QUOTA', 'TIPOSTAZ', 'COMUNE', 'PROVINCIA', 'ATTIVAZIONE']:
            dictionary[label] = root.find('STAZIONE/' + label).text

# print result
            if DEBUG:
                string1 = (f"{label : >12} : {dictionary[label]}") 
                print(string1)

# parse variable list
    elif flag == 2:
        for item in root.findall('STAZIONE/SENSORE/TYPE'):
            dictionary.append( item.text )

# print result
        if DEBUG:
            print(str(len(dictionary)) + ' variables found : ' + " ".join(map(str,dictionary)) )

# parse station ID
    elif flag == 3:
        dictionary = root.find('STAZIONE/IDSTAZ').text

# print result
        if DEBUG:
            print('parsed file with station ID ' + dictionary)

# parse sensor characteristics
    elif flag == 4:
        for sensore in root.findall('STAZIONE/SENSORE'):
            if sensore.find('./TYPE').text == TYPE:
                for label in ['ID', 'PARAMNM', 'TYPE', 'UNITNM', 'UNITCODE', 'FREQ', 'GUARDIA1', 'GUARDIA2', 'GUARDIA3']:
                    if sensore.find('./' + label) is not None:
                        dictionary[label] = sensore.find('./' + label).text 
                
# print result
                    if DEBUG:
                        string1 = (f"{label : >12} : {dictionary[label]}")
                        print(string1)

# parse measures
    elif flag == 5:

# initialize lists
        for label in ['ISTANTE', 'VM']:
            dictionary[label] = []

# append data
        for sensore in root.findall('STAZIONE/SENSORE'):
            if sensore.find('./TYPE').text == TYPE:
                for measure in sensore.findall('./DATI'):
                    dictionary['ISTANTE'].append( measure.get('ISTANTE') )
                    dictionary['VM'].append( measure.find('VM').text )
                
# print result
        if DEBUG:
            print(str(len(dictionary['VM'])) + ' measures found for ' + TYPE)

# end of function
    return dictionary

#-----------------------------------------------------------------------------------------------------------
def check_new_stations(station_list_old, station_list_new):
    '''This function checks for new element in station list, and add them to pristine list.'''

# initialize station list (copy, so the caller's dict is not mutated in place)
    station_list = dict(station_list_old)

# loop over elements of new station list
    for item in station_list_new.keys():

# check if current element is already in existing station list; if it does not, then add it
        if item not in station_list:
            station_list[item] = station_list_new[item]

# end of function
    return station_list

#-----------------------------------------------------------------------------------------------------------
def delete_downloaded(download_dir, subdir_list, datetime_string, **kwargs):
    ''' This function removes the raw downloaded files of a given batch. It is meant to be called ONLY
        after a successful parse, so the redundant raw dumps do not pile up on disk.
        In addition to this batch's files, it also sweeps STALE ORPHANS left behind by earlier runs
        that were killed (e.g. by an overlapping cron) before reaching their own cleanup: any raw file
        older than STALE_MIN minutes is removed regardless of its timestamp prefix. Without this sweep,
        each run only deletes its own batch, so orphans pile up until the nightly find. '''

# debug switch
    DEBUG = kwargs.get('debug_opt', False)
    STALE_MIN = kwargs.get('stale_min', 90)                  # orphans older than this (minutes) are swept
    stale_cutoff = time.time() - STALE_MIN * 60

# remove this batch's files (by prefix) plus any stale orphan left by a previous killed run (by mtime)
    removed = stale = 0
    prefix  = datetime_string + '-'
    for subdir in subdir_list:
        current_dir = os.path.join(download_dir, subdir)
        if not os.path.isdir(current_dir):
            continue
        for name in os.listdir(current_dir):
            full = os.path.join(current_dir, name)
            is_batch = name.startswith(prefix)
            is_stale = False
            if not is_batch:
                try:
                    is_stale = os.path.isfile(full) and os.path.getmtime(full) < stale_cutoff
                except OSError:
                    is_stale = False
            if is_batch or is_stale:
                try:
                    os.remove(full)
                    removed += 1
                    if is_stale:
                        stale += 1
                except OSError as error:
                    if DEBUG:
                        print('could not remove ' + name + ': ' + str(error))

# print summary
    print('Raw downloaded files removed: ' + str(removed) + ' (of which stale orphans: ' + str(stale) + ')')

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

    parser.add_argument("-date", "--date",
                        dest = "processing_date",
                        nargs = '*',
                        default = ["today"],
                        help="Date to be processed [today/yesterday/YYYY MM DD]")

    parser.add_argument("-v", "--variables",
                        dest = "processing_variable",
                        nargs = '*',
                        default = "all",
                        help="Variable(s) [all/TEMP/PREC/UMID/PRESS/VVENTO/DVENTO/VISIB/RADSOL/LIVIDRO/PORTATA/LIVNEVE]"
                        )

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
                                        base_URL,
                                        variables, directory,
                                        var = args.processing_variable,
                                        debug_opt = switch.debug,
                                        )

# data parsing
    if args.parse_flag in ['yes', 'Yes', 'YES', 'y', 'Y']:

# if no download was performed, parse the most recent already-downloaded batch
        if datetime_string is None:
            _, _, subdir_list = class_parsing(variables, debug_opt = switch.debug)
            datetime_string = latest_datetime_string(directory.download, subdir_list)
            if datetime_string is None:
                sys.exit('No downloaded data found to parse. Run with --download yes first.')

        parse_data(file_stazioni_json, datetime_string, variables,
                                        directory,
                                        args.processing_date, 
                                        var = args.processing_variable,
                                        debug_opt = switch.debug,
                                        )

# remove the raw downloaded files, but ONLY after a successful parse (no exception was raised above)
        if args.cleanup_flag in ['yes', 'Yes', 'YES', 'y', 'Y']:
            _, _, subdir_list = class_parsing(variables, debug_opt = switch.debug)
            delete_downloaded(directory.download, subdir_list, datetime_string, debug_opt = switch.debug)
