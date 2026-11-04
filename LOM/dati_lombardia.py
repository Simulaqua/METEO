#!/usr/bin/env python3

# Lombardia (ARPA Lombardia) data downloader/parser.
# Mirrors the behaviour of the other regional scripts but reads the ARPA Lombardia Open Data
# (Socrata portal, JSON):
#   - anagrafica sensori (con coordinate): https://www.dati.lombardia.it/resource/nf78-nj6b.json
#   - dati sensori (serie a 10 min del mese corrente): https://www.dati.lombardia.it/resource/647i-nhxk.json
#
# Note (verificate sul feed reale):
#   - l'orario del dato e' "ora solare" (CET, UTC+1 fisso) -> l'archivio la memorizza cosi' com'e'.
#   - i dati live sono la serie a 10 min; ad ogni run si scarica una finestra recente e si accodano
#     i nuovi punti (dedup). La finestra e' relativa all'ULTIMO dato presente nel dataset (robusta
#     a eventuali ritardi di pubblicazione del portale).
#   - per ogni sensore possono esserci piu' 'idoperatore': si prende '1' (media/istantaneo),
#     tranne la Precipitazione che usa '4' (cumulata).
#   - valori speciali: -9999 = mancante; per la direzione vento 777/7777 = calma, 888/8888 = variabile.
#   - il portale risponde spesso HTTP 429 (Too many requests) alle richieste anonime: ogni chiamata
#     ritenta con pause crescenti e, se ancora fallisce, il run termina PULITO senza scrivere nulla.
#   - l'anagrafica sensori (620 KB) cambia di rado: si tiene in data-parsed/anagrafica.json e si
#     riscarica al piu' una volta ogni 24 h (se il portale non risponde si usa la copia precedente).
#   - ad ogni download si cancellano i grezzi piu' vecchi di 6 h (run interrotto da riavvio/crash).

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

# ARPA Lombardia Open Data (Socrata)
url_anagrafica = 'https://www.dati.lombardia.it/resource/nf78-nj6b.json'   # sensori + coordinate
url_dati       = 'https://www.dati.lombardia.it/resource/647i-nhxk.json'   # dati sensori (10 min)

# subdirectory dei file scaricati
subdir_dati    = 'dati'

# finestra (minuti) di dati scaricati ad ogni run, relativa all'ultimo dato del dataset
# (3h: cattura la serie a 10 min di tutte le stazioni attive anche saltando qualche run; ~19000 righe,
# ben sotto il limite di 50000 della richiesta: NON allargarla senza paginare, il taglio perderebbe i dati piu' recenti)
window_minutes = 180

# il portale Socrata limita le richieste anonime (HTTP 429): pause (s) fra i tentativi prima di rinunciare
retry_waits = (5, 15, 30)
retry_codes = (429, 500, 502, 503, 504)

# l'anagrafica sensori cambia di rado: copia in data-parsed (nome SENZA trattino: la compressione notturna
# comprime '*-*.json') e nuovo download al massimo ogni 'anagrafica_ttl_h' ore
anagrafica_ttl_h = 24
anagrafica_file  = os.path.join(directory.parse, 'anagrafica.json')

# grezzi piu' vecchi di 'stale_hours' ore sono orfani (run interrotto da riavvio/crash): si cancellano
stale_hours = 6

# operatore preferito per variabile (default '1' = media; la precipitazione usa '4' = cumulata)
pref_operator  = {'PREC': '4'}

# valori sentinella da scartare
SKIP_VALUES     = {'-9999', '-9999.0', '-999', '-999.0'}   # -999 non era scartato: avvelenava le somme di pioggia
SKIP_DIR_VALUES = {'777', '7777', '888', '8888'}   # solo per la direzione del vento

# variabili: ogni classe mappa una 'tipologia' del feed alla sigla comune
class variables:
    class TEMP:
        tipo = 'Temperatura'
    class PREC:
        tipo = 'Precipitazione'
    class UMID:
        tipo = 'Umidità Relativa'
    class VVENTO:
        tipo = 'Velocità Vento'
    class DVENTO:
        tipo = 'Direzione Vento'
    class RADSOL:
        tipo = 'Radiazione Globale'
    class LIVIDRO:
        tipo = 'Livello Idrometrico'
    class LIVNEVE:
        tipo = 'Altezza Neve'

#===========================================================================================================
# MODULES
#===========================================================================================================
import argparse                                         # argument parsing
import datetime                                         # date and time
import json                                             # json files
import re                                               # nomi dei file grezzi
import requests                                         # download from web
import sys                                              # system
import time                                             # pause fra i ritentativi

# HTTP headers
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; meteo-lombardia-fetcher/1.0)'}

#===========================================================================================================
# MAIN FUNCTIONS
#===========================================================================================================

#-----------------------------------------------------------------------------------------------------------
# DATA DOWNLOADING
#-----------------------------------------------------------------------------------------------------------
def download_data(directory, **kwargs):

    print('\n***  DATA DOWNLOADING  ***')
    title_date_time_now(title='Module starts on ')
    DEBUG = kwargs.get('debug_opt', False)

# directories
    current_dir = os.path.join(directory.download, subdir_dati)
    create_directory(current_dir)
    create_directory(directory.parse)
    file_stazioni_json = os.path.join(directory.parse, 'stazioni.json')

# orfani di run precedenti interrotti (prima di qualsiasi chiamata di rete: pulisce anche se il portale e' giu')
    purge_stale_raw(directory.download, subdir_dati, stale_hours)

    datetime_string = date_time_string()
    written = []        # file grezzi scritti da QUESTO run: se il run fallisce vengono rimossi (niente orfani)

    try:
# 1) ultimo timestamp presente nel dataset dei dati -> finestra recente (chiamata leggera: se il portale
#    sta limitando le richieste lo si scopre prima di scaricare qualsiasi cosa)
        _, latest = fetch_json(url_dati, {'$select': 'data', '$order': 'data DESC', '$limit': '1'}, 60,
                               debug_opt=DEBUG)
        if latest and latest[0].get('data'):
            cutoff = shift_iso(latest[0]['data'], -window_minutes)
        else:
            # fallback: ora solare corrente meno la finestra
            solar_now = datetime.datetime.utcnow() + datetime.timedelta(hours=1)
            cutoff = (solar_now - datetime.timedelta(minutes=window_minutes)).strftime('%Y-%m-%dT%H:%M:%S')
        print('Finestra dati da ' + cutoff + ' in poi')

# 2) dati della finestra (ordinati per data crescente)
        written.append(download_json(url_dati, {'$where': "data > '" + cutoff + "'", '$order': 'data', '$limit': '50000'},
                                     current_dir, datetime_string + '-dati.json', debug_opt=DEBUG))

# 3) anagrafica sensori (con coordinate): copia in data-parsed, riscaricata al piu' una volta al giorno
        refresh_anagrafica(debug_opt=DEBUG)
    except BaseException:
        for fn in written:
            try:
                os.remove(fn)
            except OSError:
                pass
        raise

    title_date_time_now(title='Module ends on ')
    return file_stazioni_json, datetime_string

#-----------------------------------------------------------------------------------------------------------
# DATA PARSING
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

# ANAGRAFICA: sensore -> metadati (tipologia, stazione, coordinate, unita')
#   copia in data-parsed; se manca si ripiega sul file grezzo del batch (formato dei vecchi run)
    anag_file = anagrafica_file
    if not os.path.exists(anag_file):
        anag_file = os.path.join(current_dir, datetime_string + '-anagrafica.json')
    anagrafica = json_load(anag_file) if os.path.exists(anag_file) else []
    if not isinstance(anagrafica, list):
        anagrafica = []
    sensors = {}
    for a in anagrafica:
        sensors[a.get('idsensore')] = {
            'tipo'      : a.get('tipologia'),
            'idstazione': a.get('idstazione'),
            'nome'      : a.get('nomestazione'),
            'lat'       : _coord(a.get('lat')),      # 0,0 (sentinella) -> None
            'lon'       : _coord(a.get('lng')),
            'quota'     : a.get('quota'),
            'provincia' : a.get('provincia'),
            'unit'      : a.get('unit_dimisura'),
        }
    print('Sensori in anagrafica: ' + str(len(sensors)))

# DATI: distribuisci ogni lettura alla sua variabile/stazione
    dati_file = os.path.join(current_dir, datetime_string + '-dati.json')
    readings = json_load(dati_file) if os.path.exists(dati_file) else []
    if not isinstance(readings, list):
        readings = []
    print('Letture scaricate: ' + str(len(readings)))

    type2var = {getattr(variables, v).tipo: v for v in var_list}
    daily   = {var: {} for var in var_processed if var in var_list}
    counter = {var: 0 for var in daily}

    for r in readings:
        s = sensors.get(r.get('idsensore'))
        if not s:
            continue
        var = type2var.get(s['tipo'])
        if var is None or var not in daily:
            continue

# operatore preferito
        if r.get('idoperatore') != pref_operator.get(var, '1'):
            continue

# valore: scarta mancanti e codici speciali
        val = r.get('valore')
        if val is None or val in SKIP_VALUES:
            continue
        if var == 'DVENTO' and val in SKIP_DIR_VALUES:
            continue

# timestamp (ora solare, memorizzato cosi' com'e')
        istante = normalize_istante(r.get('data'))
        if istante is None:
            continue

        scode = s['idstazione']
        if scode is None:
            continue
        day = istante[0:8]

# aggiorna il registro stazioni (solo quelle con dati)
        if scode not in station_list:
            station_list[scode] = {
                'SCODE': scode, 'NOME': s['nome'], 'LAT': s['lat'], 'LON': s['lon'],
                'QUOTA': s['quota'], 'PROVINCIA': s['provincia'],
            }
        elif station_list[scode].get('LAT') is None and s['lat'] is not None:
            station_list[scode]['LAT'] = s['lat']       # riempi la coord se un altro sensore ce l'ha valida
            station_list[scode]['LON'] = s['lon']

# carica il file giornaliero la prima volta che si tocca (var, day)
        if day not in daily[var]:
            filename_var = os.path.join(directory.parse, var, var + '-' + day + '.json')
            daily[var][day] = json_load(filename_var) if os.path.exists(filename_var) else {}
        bin_day = daily[var][day]

        if scode not in bin_day:
            bin_day[scode] = {
                'STAZIONE': station_list[scode],
                'UM'      : s['unit'],
                'MISURE'  : {'ISTANTE': [], 'VALORE': []},
            }
        misure = bin_day[scode]['MISURE']

# dedup / append: solo letture piu' recenti dell'ultima memorizzata
        if misure['ISTANTE'] and int(istante) <= int(misure['ISTANTE'][-1]):
            continue
        misure['ISTANTE'].append(istante)
        misure['VALORE'].append(val)
        counter[var] += 1

# salva i file giornalieri
    for var in daily:
        for day, bin_day in daily[var].items():
            json_save(bin_day, os.path.join(directory.parse, var, var + '-' + day + '.json'), sort_keys=False)
        print(f"Variable {var : <9}: {counter[var]} nuove letture")

    json_save(station_list, file_stazioni_json)
    title_date_time_now(title='Module ends on ')
    return

#===========================================================================================================
# LOCAL FUNCTIONS
#===========================================================================================================

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
def normalize_istante(iso_string):
    ''' '2026-07-06T12:10:00.000' -> '202607061210' (ora solare, invariata). None su errore. '''
    try:
        s = iso_string
        return s[0:4] + s[5:7] + s[8:10] + s[11:13] + s[14:16]
    except (TypeError, IndexError):
        return None

#-----------------------------------------------------------------------------------------------------------
def shift_iso(iso_string, minutes):
    ''' Sposta un timestamp ISO di 'minutes' e lo riformatta 'YYYY-MM-DDTHH:MM:SS' (per il filtro Socrata). '''
    dt = datetime.datetime.strptime(iso_string[:19], '%Y-%m-%dT%H:%M:%S')
    return (dt + datetime.timedelta(minutes=minutes)).strftime('%Y-%m-%dT%H:%M:%S')

#-----------------------------------------------------------------------------------------------------------
def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

#-----------------------------------------------------------------------------------------------------------
def _coord(value):
    ''' Coordinata valida (float) oppure None se mancante o 0,0 (sentinella ARPA Lombardia). '''
    v = _num(value)
    return v if (v is not None and abs(v) > 0.001) else None

#-----------------------------------------------------------------------------------------------------------
def class_parsing(**kwargs):
    var_list = [item for item in dir(variables) if not item.startswith('__')]
    if kwargs.get('debug_opt', False):
        print('Variable list: ' + ' / '.join(var_list))
    return var_list

#-----------------------------------------------------------------------------------------------------------
class DownloadError(Exception):
    ''' Download fallito anche dopo i ritentativi: il run termina senza lasciare file. '''

#-----------------------------------------------------------------------------------------------------------
def fetch_json(url, params, timeout, **kwargs):
    ''' GET di una risorsa Socrata. Ritenta (pause in retry_waits) su 429/5xx, errori di rete e risposte
        non valide; il portale con HTTP 429 risponde un dict di errore che, preso per un dato, mandava
        in crash lo script. Ritorna (corpo_grezzo, lista_json); DownloadError se alla fine ancora fallisce. '''
    if kwargs.get('debug_opt', False):
        print(url, params)
    detail = ''
    for attempt in range(len(retry_waits) + 1):
        if attempt:
            print('   ' + detail + ' -> riprovo fra ' + str(retry_waits[attempt - 1]) + ' s', flush=True)
            time.sleep(retry_waits[attempt - 1])
        try:
            request = requests.get(url, params=params, headers=HEADERS, timeout=timeout)
        except requests.RequestException as error:
            detail = 'rete: ' + str(error)[:100]
            continue
        if request.status_code in retry_codes:
            detail = 'HTTP ' + str(request.status_code)
            continue
        if request.status_code != 200:
            raise DownloadError('Error downloading ' + url + ': HTTP ' + str(request.status_code))
        try:
            data = request.json()
        except ValueError:
            detail = 'risposta non JSON'
            continue
        if not isinstance(data, list):
            detail = 'risposta inattesa: ' + str(data)[:80]
            continue
        return request.content, data
    raise DownloadError('Error downloading ' + url + ': ' + detail)

#-----------------------------------------------------------------------------------------------------------
def write_atomic(content, filename):
    ''' Scrive i byte su file in modo ATOMICO (tmp + rename): mai file monchi da riavvio a meta' write. '''
    tmp = filename + '.tmp'
    with open(tmp, 'wb') as fp:
        fp.write(content)
        fp.flush(); os.fsync(fp.fileno())
    os.replace(tmp, filename)

#-----------------------------------------------------------------------------------------------------------
def download_json(url, params, directory_name, file_name, **kwargs):
    ''' GET di una risorsa Socrata e salvataggio del JSON grezzo su file (SOLO se la risposta e' valida). '''
    DEBUG = kwargs.get('debug_opt', False)
    content, _ = fetch_json(url, params, 90, debug_opt=DEBUG)
    filename = os.path.join(directory_name, file_name)
    write_atomic(content, filename)
    print(f"{'data file ' + file_name : <55}" + ' ... downloaded (' + str(len(content)) + ' bytes)')
    return filename

#-----------------------------------------------------------------------------------------------------------
def refresh_anagrafica(**kwargs):
    ''' Anagrafica sensori in data-parsed/anagrafica.json, riscaricata al piu' ogni 'anagrafica_ttl_h' ore.
        Se il portale non risponde e una copia valida esiste, si usa quella (l'anagrafica cambia di rado). '''
    DEBUG = kwargs.get('debug_opt', False)
    have = False
    if os.path.exists(anagrafica_file):
        copy = json_load(anagrafica_file)
        have = isinstance(copy, list) and len(copy) > 0
        age_h = (time.time() - os.path.getmtime(anagrafica_file)) / 3600.0
        if have and age_h < anagrafica_ttl_h:
            print('anagrafica sensori: copia di ' + str(round(age_h, 1)) + ' h riusata (' + str(len(copy)) + ' sensori)')
            return
    try:
        content, data = fetch_json(url_anagrafica, {'$limit': '10000'}, 90, debug_opt=DEBUG)
        if not data:
            raise DownloadError('Error downloading ' + url_anagrafica + ': anagrafica vuota')
    except DownloadError as error:
        if have:
            print('WARN: anagrafica non aggiornata (' + str(error) + '), uso la copia precedente')
            return
        raise
    write_atomic(content, anagrafica_file)
    print('anagrafica sensori: scaricata (' + str(len(data)) + ' sensori, ' + str(len(content)) + ' bytes)')

#-----------------------------------------------------------------------------------------------------------
raw_name = re.compile(r'^\d{8}-\d{6}-(anagrafica|dati)\.json(\.tmp)?$')

def purge_stale_raw(download_dir, subdir, hours):
    ''' Cancella i grezzi ORFANI (run interrotto da riavvio/crash, parse fallito): file del tipo
        YYYYMMDD-HHMMSS-(anagrafica|dati).json piu' vecchi di 'hours' ore. Un run in corso ha file di
        pochi minuti, quindi non viene mai toccato. Ritorna il numero di file rimossi. '''
    current_dir = os.path.join(download_dir, subdir)
    if not os.path.isdir(current_dir):
        return 0
    limit = time.time() - hours * 3600
    removed, freed = 0, 0
    for name in os.listdir(current_dir):
        if not raw_name.match(name):
            continue
        path = os.path.join(current_dir, name)
        try:
            if os.path.getmtime(path) < limit:
                size = os.path.getsize(path)
                os.remove(path)
                removed += 1; freed += size
        except OSError:
            pass
    if removed:
        print('Grezzi orfani rimossi: ' + str(removed) + ' (' + str(round(freed / 1048576.0, 1)) + ' MB)')
    return removed

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
    sort_keys = kwargs.get('sort_keys', True)
    tmp = filename + '.tmp'
    with open(tmp, 'w') as fp:
        json.dump(data, fp, sort_keys=sort_keys, separators=(',',':'), ensure_ascii=False)
        fp.flush(); os.fsync(fp.fileno())
    os.replace(tmp, filename)   # scrittura atomica: mai file monchi da riavvio a meta' write
    return

#-----------------------------------------------------------------------------------------------------------
def delete_downloaded(download_dir, subdir_list, datetime_string, **kwargs):
    ''' Rimuove i file grezzi del batch, DOPO un parse riuscito. '''
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
                        help="Variable(s) [all/TEMP/PREC/UMID/VVENTO/DVENTO/RADSOL/LIVIDRO/LIVNEVE]")
    parser.add_argument("-c", "--cleanup", dest="cleanup_flag", default="yes",
                        help="Delete raw downloaded files after a successful parse [yes/no]")
    args = parser.parse_args()

    file_stazioni_json = os.path.join(directory.parse, 'stazioni.json')
    datetime_string    = None

    if args.download_flag in ['yes', 'Yes', 'YES', 'y', 'Y']:
        try:
            file_stazioni_json, datetime_string = download_data(directory, debug_opt=switch.debug)
        except DownloadError as error:
            sys.exit(str(error))     # portale che limita/non risponde: uscita pulita, riprova al prossimo run

    if args.parse_flag in ['yes', 'Yes', 'YES', 'y', 'Y']:
        if datetime_string is None:
            datetime_string = latest_datetime_string(directory.download, [subdir_dati])
            if datetime_string is None:
                sys.exit('No downloaded data found to parse. Run with --download yes first.')
        parse_data(file_stazioni_json, datetime_string, directory,
                   var=args.processing_variable, debug_opt=switch.debug)

        if args.cleanup_flag in ['yes', 'Yes', 'YES', 'y', 'Y']:
            delete_downloaded(directory.download, [subdir_dati], datetime_string, debug_opt=switch.debug)
