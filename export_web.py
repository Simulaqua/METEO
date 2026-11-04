#!/usr/bin/env python3

# Web exporter for the regional hydro-meteo data.
# Reads a region's parsed tree (data-parsed/<VAR>/<VAR>-YYYYMMDD.json + stazioni.json) and produces,
# for the last N days (default 7), the files needed by a static Leaflet + uPlot front-end:
#   - <out>/series/<SCODE>.csv   : one CSV per station, WIDE format
#                                  columns = datetime + one column per variable (sigla comune)
#   - <out>/stations.geojson     : station markers for the map, with the latest value per variable
#   - <out>/stations_nocoord.csv : stations without lat/lon (map TODO), for reference
# These files are meant to be committed/pushed to GitHub and read from the web page.
#
# The parsed JSON schema differs between regions (Veneto uses the 'VM' value key and X/Y projected
# coordinates; the others use 'VALORE' and native lat/lon): see REGION_CFG below.

#===========================================================================================================
# SETTING
#===========================================================================================================

# per-region configuration
#   value : key holding the value list inside MISURE ('VM' for Veneto, 'VALORE' for the others)
#   name  : station field to use as display name
#   lat   : station field with latitude  (None if not available -> station goes to stations_nocoord.csv)
#   lon   : station field with longitude (None if not available)
#   x / y : projected coordinates fields (kept in properties when lat/lon are missing, e.g. Veneto)
REGION_CFG = {
    'VEN': {'value': 'VM',     'name': 'NOME',         'lat': 'Y',          'lon': 'X'},  # ARPAV X/Y = lon/lat in EPSG:4258 (ETRS89 geografico)
    'TN' : {'value': 'VALORE', 'name': 'nome',         'lat': 'latitudine',  'lon': 'longitudine'},
    'BZ' : {'value': 'VALORE', 'name': 'NAME_I',       'lat': 'LAT',         'lon': 'LONG'},
    'FVG': {'value': 'VALORE', 'name': 'station_name', 'lat': None,          'lon': None},
    'LOM': {'value': 'VALORE', 'name': 'NOME',         'lat': 'LAT',         'lon': 'LON'},  # ARPA Lombardia (lat/lng WGS84)
    'ER' : {'value': 'VALORE', 'name': 'NOME',         'lat': 'LAT',         'lon': 'LON'},  # ARPAE Emilia-Romagna
    # --- QUALITA' DELL'ARIA (dati_aria.py) e IDROMETRIA PROT. CIVILE (dati_pc.py): schema uniforme
    #     VALORE + STAZIONE{NOME,LAT,LON}. Ogni codice e' una "regione-archivio" a se', raggruppata
    #     nel frontend sotto la voce geografica. export_web salta i codici senza data-parsed.
    'AQ_VEN': {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},
    'AQ_TN' : {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},
    'AQ_BZ' : {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},
    'AQ_FVG': {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},
    'AQ_LOM': {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},
    'AQ_ER' : {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},
    'PC_FVG': {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},
    'PC_TN' : {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},
    'MAR_VEN': {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},   # maree (CPSM Venezia)
    'MAR_ER' : {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},   # meteo-marino ER (ARPAE boe/mareografi)
    'MAR_FVG': {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},   # meteo-marino golfo di Trieste (OGS ERDDAP)
    'ACQ_VEN': {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},   # qualita' acque marino-costiere (ARPAV boe)
    'INV_ER' : {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},   # invasi Romagna Acque (Ridracoli + Conca)
    'LIG'    : {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},   # Liguria ARPAL/OMIRL (idro+meteo)
    # AIPO (bacino del Po): pubblicato COMPLETO (anche i doppioni ER/LOM). Le stazioni condivise
    # compaiono sia sotto AIPO sia sotto ER/LOM (scelta dell'utente). Per de-duplicare al publish
    # basterebbe rimettere 'dedup': True qui (il codice di dedup e' gia' in export_region).
    'PC_PO' : {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},
    'PC_PIE': {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},   # ARPA Piemonte: i soli idrometri (gruppo Po)
    'PIE'   : {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},   # ARPA Piemonte: tutte le stazioni, meteo + livelli
    'LAGHI' : {'value': 'VALORE', 'name': 'NOME', 'lat': 'LAT', 'lon': 'LON'},   # grandi laghi regolati (laghi.net)
    # CB_AE (Consorzio Adige Euganeo) ritirato il 2026-10-23: le sue 13 stazioni erano copie esatte di
    # stazioni ARPAV gia' in VEN (stessi nomi, coordinate e valori). Archivio lasciato in CB_AE/ sul Pi.
}

# base directory: the folder where this script lives (the region folders VEN/BZ/TN/FVG are siblings)
import os
_BASE_DIR = os.path.dirname(os.path.realpath(__file__))

# per-region folder (e.g. <base>/VEN), holding data-parsed/, web/ and stazioni_coords.csv
def region_dir(region):
    return os.path.join(_BASE_DIR, region)

#===========================================================================================================
# MODULES
#===========================================================================================================
import argparse                                         # argument parsing
import bisect                                           # ricerca binaria nei fotogrammi orari
import calendar                                         # epoch dei fotogrammi
import csv                                              # csv writing
import datetime                                         # date and time
import json                                             # json files
import os                                               # filesystem
import sys                                              # system
import quality                                          # sentinelle (-999...) e valori impossibili: scartati in lettura

#===========================================================================================================
# MAIN FUNCTION
#===========================================================================================================
def export_region(region, parse_dir, out_dir, days, **kwargs):

# debug switch
    DEBUG = kwargs.get('debug_opt', False)

# region configuration
    if region not in REGION_CFG:
        sys.exit('Unknown region: ' + region + ' (expected one of ' + '/'.join(REGION_CFG) + ')')
    cfg = REGION_CFG[region]

# optional coordinate lookup (scode -> (lat, lon)), used when the parsed metadata has no lat/lon (e.g. FVG)
    coords = kwargs.get('coords') or {}

    print('\n***  WEB EXPORT  ***   region ' + region)

# time window: keep measures with ISTANTE >= cutoff (compact YYYYMMDDHHMM form)
    cutoff_dt = datetime.datetime.now() - datetime.timedelta(days=days)
    cutoff    = cutoff_dt.strftime('%Y%m%d%H%M')
    cutoff_day = cutoff[0:8]
# la PREC si legge con 2 giorni IN PIU' (solo export principale): servono agli accumuli 1-48 h esatti anche
# all'inizio della finestra; dopo il calcolo delle derivate quei 2 giorni si tolgono (output identico a prima)
    prec_extra = 0 if kwargs.get('series_only', False) else 2
    cutoff_p     = (cutoff_dt - datetime.timedelta(days=prec_extra)).strftime('%Y%m%d%H%M')
    cutoff_p_day = cutoff_p[0:8]
    print('Keeping measures from ' + cutoff_dt.strftime('%Y-%m-%d %H:%M') + ' onward (last ' + str(days) + ' days)')

# station registry (metadata / coordinates)
    file_stazioni = os.path.join(parse_dir, 'stazioni.json')
    station_meta  = json_load(file_stazioni) if os.path.exists(file_stazioni) else {}

# zeri idrometrici (quota m s.m.m. dello zero dell'idrometro), se presenti: <regione>/zero_idrometrici.json
# keyed per scode (per Veneto = IDSTAZ). Servono al front-end per mostrare il LIVIDRO in quota assoluta.
    file_zeri = os.path.join(os.path.dirname(parse_dir), 'zero_idrometrici.json')
    zeri_idro = json_load(file_zeri) if os.path.exists(file_zeri) else {}

# variables actually present in the parsed tree (a subdir per variable)
    var_list = sorted([d for d in os.listdir(parse_dir)
                       if os.path.isdir(os.path.join(parse_dir, d))])
    if DEBUG:
        print('Variables: ' + ' / '.join(var_list))

# COLLECT: per station -> per variable -> {istante: value}, only within the time window

    data  = {}                                           # scode -> { var -> { istante -> value } }
    units = {}                                           # var -> unit of measure (last seen)

    for var in var_list:
        var_dir = os.path.join(parse_dir, var)
        qok = quality.checker(var)                       # scarta sentinelle (-999...) e valori impossibili
        v_cut, v_cut_day = (cutoff_p, cutoff_p_day) if var == 'PREC' else (cutoff, cutoff_day)
        for fname in sorted(os.listdir(var_dir)):
            if not fname.startswith(var + '-'):
                continue
# accetta sia i file recenti (.json) sia quelli d'archivio compressi (.json.gz)
            if   fname.endswith('.json.gz'): day = fname[len(var) + 1:-8]
            elif fname.endswith('.json'):    day = fname[len(var) + 1:-5]
            else:                            continue

# skip daily files entirely older than the window
            if day < v_cut_day:
                continue

            content = json_load(os.path.join(var_dir, fname))
            for scode, record in content.items():
                misure = record.get('MISURE', {})
                istanti = misure.get('ISTANTE', [])
                valori  = misure.get(cfg['value'], [])
                # unit of measure: 'UM' (TN/BZ/FVG) oppure SENSORE.UNITNM/UNITCODE (Veneto/ARPAV)
                um = record.get('UM')
                if um is None:
                    sens = record.get('SENSORE') or {}
                    um = sens.get('UNITNM') or sens.get('UNITCODE')
                if um:
                    units[var] = um

                for istante, value in zip(istanti, valori):
                    if istante is None or istante < v_cut:
                        continue
                    if not qok(value):
                        continue
                    data.setdefault(scode, {}).setdefault(var, {})[istante] = value

# ensure metadata exists for every station that has data (fallback to the series STAZIONE block)
                if scode not in station_meta:
                    station_meta[scode] = record.get('STAZIONE', {})

    print('Stations with data in window: ' + str(len(data)))

# letture "azzerate" del datalogger (UMID=0 + TEMP=0 allo stesso istante): via prima delle derivate
    glitches = sum(quality.drop_zero_glitches(per_var) for per_var in data.values())
    if glitches:
        print('Scartati ' + str(glitches) + ' istanti con letture azzerate (UMID=0)')

# GRANDEZZE DERIVATE + INDICI (calcolate AL VOLO dalle misure grezze della finestra, NON archiviate):
# si aggiungono a per_var cosi' passano nei CSV e nel geojson come fossero variabili. Disk-safe.
# Solo per l'export principale a 7 giorni: l'export series30 (--series-only) le salta (piu' pesante,
# poco utile in modalita' confronto 30gg).
    if not kwargs.get('series_only', False):
        try:
            import derive
            for scode, per_var in data.items():
                for name, ser in derive.derive_station(per_var, station_meta.get(scode, {})).items():
                    if ser:
                        per_var[name] = ser
                        units[name] = derive.DERIVED_UM.get(name, '')
        except Exception as e:
            sys.stderr.write('WARN: derivate non calcolate (' + str(e) + ')\n')
        if prec_extra:
            for scode in list(data):
                per_var = data[scode]
                for name in ('PREC', 'PREC1', 'PREC3', 'PREC6', 'PREC12', 'PREC24', 'PREC48'):
                    ser = per_var.get(name)
                    if ser is None:
                        continue
                    ser = {ist: v for ist, v in ser.items() if ist >= cutoff}
                    if ser: per_var[name] = ser
                    else:   del per_var[name]
                if not per_var:
                    del data[scode]

# OUTPUT DIRECTORIES

    series_subdir = kwargs.get('series_subdir', 'series')     # 'series' (7gg) o 'series30' (30gg)
    series_only   = kwargs.get('series_only', False)          # se True: scrive solo i CSV, niente geojson/units
    series_dir = os.path.join(out_dir, series_subdir)
    create_directory(out_dir)
    create_directory(series_dir)

# WRITE ONE WIDE CSV PER STATION

    for scode, per_var in data.items():

# variables this station actually has, sorted for stable columns
        vars_here = sorted(per_var.keys())

# union of all timestamps across the station's variables, sorted ascending
        all_ts = sorted({ts for v in vars_here for ts in per_var[v]})

# write CSV: datetime + one column per variable
        with open(os.path.join(series_dir, scode + '.csv'), 'w', newline='') as fp:
            writer = csv.writer(fp)
            writer.writerow(['datetime'] + vars_here)
            for ts in all_ts:
                row = [iso_datetime(ts, region)]
                for v in vars_here:
                    val = per_var[v].get(ts, '')
                    row.append('' if val is None else val)
                writer.writerow(row)

# modalita' "solo serie" (es. finestra 30gg in series30/): non rigenera geojson/units, gia' scritti
# dall'export principale a 7gg. Evita di appesantire il Pi ad ogni run.
    if series_only:
        print('Series-only export (' + series_subdir + ') written to ' + series_dir)
        return

# BUILD STATION INDEX (geojson for the map + no-coord list)

    features   = []
    no_coord   = []
    for scode, per_var in data.items():
        meta = station_meta.get(scode, {})
        name = meta.get(cfg['name']) or scode

# latest value + latest time per variable (for the map tooltip / colouring).
# NB: latest_time considera SOLO le variabili misurate: le derivate giornaliere (GDD/ET0/...) sono
# marcate alle 12:00 solari e al mattino risultano "nel futuro" -> falserebbero l'ultimo dato,
# lo stato delle fonti e il conteggio delle stazioni in ritardo.
        try:
            import derive
            _derived = set(derive.DERIVED_UM)
        except Exception:
            _derived = set()
        latest = {}
        latest_ts = None
        for v in sorted(per_var.keys()):
            ts = max(per_var[v])
            latest[v] = per_var[v][ts]
            if v not in _derived and (latest_ts is None or ts > latest_ts):
                latest_ts = ts
        if latest_ts is None and per_var:                     # stazione con sole derivate: improbabile
            latest_ts = max(max(s) for s in per_var.values())

        properties = {
            'scode'     : scode,
            'name'      : name,
            'variables' : sorted(per_var.keys()),
            'latest'    : latest,
            'latest_time': iso_datetime(latest_ts, region) if latest_ts else None,
            'series'    : 'series/' + scode + '.csv',
        }
# quota dello zero idrometrico (m s.m.m.): se disponibile per questa stazione, il front-end
# mostra il livello idrometrico riferito alla quota assoluta (livello + zero).
        z = zeri_idro.get(scode)
        if isinstance(z, dict): z = z.get('zero')
        if z is not None:
            properties['zero_idro'] = z

# coordinates: native lat/lon if available, otherwise record as no-coord (keep projected x/y if present)
        lat = _num(meta.get(cfg['lat'])) if cfg['lat'] else None
        lon = _num(meta.get(cfg['lon'])) if cfg['lon'] else None
# scarta la sentinella 0,0 (coordinate mancanti codificate come zero -> altrimenti finiscono nell'oceano)
        if lat is not None and lon is not None and abs(lat) < 0.01 and abs(lon) < 0.01:
            lat = lon = None

# fallback to the coordinate lookup file (by station code)
        if (lat is None or lon is None) and scode in coords:
            lat, lon = coords[scode]

        if lat is not None and lon is not None:
            features.append({
                'type': 'Feature',
                'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                'properties': properties,
            })
        else:
            row = {'scode': scode, 'name': name}
            if cfg.get('x'):
                row['x'] = meta.get(cfg['x'])
                row['y'] = meta.get(cfg['y'])
            no_coord.append(row)

# DEDUP cross-regione (es. AIPO): togli dalla mappa le stazioni gia' pubblicate da altre regioni,
# entro ~200 m. L'archivio (data-parsed) resta completo; qui filtriamo solo cosa finisce in geojson.
    pub_coords = kwargs.get('pub_coords')
    if cfg.get('dedup') and pub_coords:
        THRESH = 0.002
        kept = [f for f in features
                if not any(abs(f['geometry']['coordinates'][1] - a) < THRESH
                           and abs(f['geometry']['coordinates'][0] - b) < THRESH for a, b in pub_coords)]
        print('Dedup: ' + str(len(features) - len(kept)) + ' stazioni gia\' pubblicate altrove -> tolte')
        features = kept
    if pub_coords is not None:
        for f in features:
            pub_coords.append((f['geometry']['coordinates'][1], f['geometry']['coordinates'][0]))

# write geojson
    geojson = {'type': 'FeatureCollection',
               'name': region,
               'features': features}
    json_save(geojson, os.path.join(out_dir, 'stations.geojson'))
    print('Stations on map (with lat/lon): ' + str(len(features)))

# write no-coord list (if any)
    if no_coord:
        keys = ['scode', 'name'] + (['x', 'y'] if cfg.get('x') else [])
        with open(os.path.join(out_dir, 'stations_nocoord.csv'), 'w', newline='') as fp:
            writer = csv.DictWriter(fp, fieldnames=keys)
            writer.writeheader()
            writer.writerows(no_coord)
        print('Stations WITHOUT lat/lon (map TODO): ' + str(len(no_coord)) + '  -> stations_nocoord.csv')

# units summary file (handy for axis labels on the front-end)
    json_save(units, os.path.join(out_dir, 'units.json'))

# file orari per il "cursore del tempo" della mappa (solo stazioni pubblicate sulla mappa)
    write_snapshots(region, data, [f['properties']['scode'] for f in features], out_dir, units)

    print('Export written to ' + out_dir)
    return

#===========================================================================================================
# LOCAL FUNCTIONS
#===========================================================================================================

#-----------------------------------------------------------------------------------------------------------
# FILE ORARI PER IL CURSORE DEL TEMPO (mappa): <regione>/snap/<VAR>.json
#   {"t": [epoch ora civile "naive come UTC" di ogni fotogramma], "u": unita', "s": {scode: [valori|null...]}}
# Un fotogramma per ora tonda (solare) degli ultimi 7 giorni; il valore e' l'ultima lettura NON piu' vecchia della
# tolleranza (SNAP_TOL_MIN per variabile, altrimenti SNAP_TOL_DEF minuti) rispetto al fotogramma; se non c'e': null.
# Dimensione costante (finestra mobile): nessuna crescita sul Pi. Le derivate (PREC1..PREC48) sono gia' in 'data'.
SNAP_VARS   = ['TEMP', 'UMID', 'PRESS', 'VVENTO', 'VVENTOMAX', 'PREC1', 'PREC3', 'PREC6', 'PREC12', 'PREC24', 'PREC48']
SNAP_FRAMES = 168
SNAP_TOL_MIN = {'PREC1': 30, 'PREC3': 45, 'VVENTO': 60, 'VVENTOMAX': 60}   # default 90: gli accumuli brevi non devono "invecchiare"
SNAP_TOL_DEF = 90
SNAP_DEC    = {'UMID': 0}                  # decimali (default 1)

def write_snapshots(region, data, scodes, out_dir, units):
    snap_dir = os.path.join(out_dir, 'snap')
    now = datetime.datetime.utcnow() + datetime.timedelta(hours=1)               # ora SOLARE corrente
    last = now.replace(minute=0, second=0, microsecond=0)
    frames = [last - datetime.timedelta(hours=SNAP_FRAMES - 1 - k) for k in range(SNAP_FRAMES)]
    fstr = [d.strftime('%Y%m%d%H%M') for d in frames]
    tepoch = [calendar.timegm((d + datetime.timedelta(hours=1 if _ita_is_dst(d) else 0)).timetuple()) for d in frames]
    written = set()
    for var in SNAP_VARS:
        dec = SNAP_DEC.get(var, 1)
        tol = SNAP_TOL_MIN.get(var, SNAP_TOL_DEF)
        lstr = [(d - datetime.timedelta(minutes=tol)).strftime('%Y%m%d%H%M') for d in frames]
        series = {}
        for sc in scodes:
            pv = data.get(sc, {}).get(var)
            if not pv:
                continue
            keys = sorted(pv)
            vals, any_ = [], False
            for fs, ls in zip(fstr, lstr):
                i = bisect.bisect_right(keys, fs) - 1
                v = _num(pv[keys[i]]) if (i >= 0 and keys[i] >= ls) else None
                if v is None:
                    vals.append(None)
                else:
                    vals.append(round(v, dec) if dec else int(round(v))); any_ = True
            if any_:
                series[sc] = vals
        if series:
            create_directory(snap_dir)
            json_save({'t': tepoch, 'u': units.get(var, ''), 's': series}, os.path.join(snap_dir, var + '.json'))
            written.add(var + '.json')
    if os.path.isdir(snap_dir):                                                  # niente file orfani di variabili sparite
        for fn in os.listdir(snap_dir):
            if fn not in written:
                try: os.remove(os.path.join(snap_dir, fn))
                except OSError: pass
    if written:
        print('Snapshot orari: ' + str(len(written)) + ' variabili in ' + snap_dir)

#-----------------------------------------------------------------------------------------------------------
# TIMEZONE
# The parsed archive (data-parsed) is ALWAYS stored in ORA SOLARE (CET, UTC+1 fixed) by the dati_*.py
# scripts, for every region. For the web output we convert it to the CURRENT Italian civil time
# (Europe/Rome), i.e. solar in winter and legal (CEST) in summer - so the site shows the wall clock.
# NB: NON usiamo zoneinfo (assente su Python < 3.9, es. il Raspberry con 3.7). Calcolo DST italiano
# a mano: ora legale (CEST, +1h sul solare) dall'ultima domenica di marzo all'ultima di ottobre.
# dt e' in ORA SOLARE: i cambi avvengono entrambi alle 01:00 UTC = 02:00 solari (a ottobre le 03:00 CEST
# tornano 02:00 CET). Nei dati_*.py lo stesso nome riceve l'ora CIVILE delle fonti, per cui li' il limite
# di ottobre e' giustamente 03:00 (l'ora 02-03 civile si ripete: convenzione = prima volta, CEST).
def _ita_is_dst(dt):
    y = dt.year
    ls = lambda mo: 31 - ((datetime.date(y, mo, 31).weekday() + 1) % 7)   # giorno dell'ultima domenica
    return datetime.datetime(y, 3, ls(3), 2) <= dt < datetime.datetime(y, 10, ls(10), 2)

def iso_datetime(istante, region=None):
    ''' Convert a compact YYYYMMDDHHMM timestamp (stored in ORA SOLARE, UTC+1) to the current Italian
        civil time (solar in winter, +1h in summer) as ISO 'YYYY-MM-DDTHH:MM'. '''
    if not istante or len(istante) < 12:
        return istante
    plain = f"{istante[0:4]}-{istante[4:6]}-{istante[6:8]}T{istante[8:10]}:{istante[10:12]}"
    try:
        dt = datetime.datetime.strptime(istante[:12], '%Y%m%d%H%M')        # ora SOLARE
    except ValueError:
        return plain
    off = 1 if _ita_is_dst(dt) else 0                                      # solare -> civile
    return (dt + datetime.timedelta(hours=off)).strftime('%Y-%m-%dT%H:%M')

#-----------------------------------------------------------------------------------------------------------
def _num(value):
    ''' Best-effort conversion of a coordinate to float; returns None if not convertible. '''
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

#-----------------------------------------------------------------------------------------------------------
def load_coords(path):
    ''' Load a station-coordinate lookup CSV (scode,lat,lon,...). Lines starting with '#' are ignored.
        Returns { scode: (lat, lon) }. Returns {} if the file is missing. '''
    coords = {}
    if not path or not os.path.exists(path):
        return coords
    with open(path, newline='') as fp:
        for line in fp:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split(',')
            if parts[0] == 'scode':                       # header
                continue
            if len(parts) < 3:
                continue
            lat = _num(parts[1]); lon = _num(parts[2])
            if lat is not None and lon is not None:
                coords[parts[0]] = (lat, lon)
    return coords

#-----------------------------------------------------------------------------------------------------------
def create_directory(directory_name):
    ''' Create a directory if it does not exist. '''
    if not os.path.exists(directory_name):
        os.makedirs(directory_name)
    return

#-----------------------------------------------------------------------------------------------------------
def json_load(filename):
    ''' Legge un file JSON, trasparente ai file d'archivio compressi (.json.gz).
        Un file vuoto/troncato/corrotto (es. write interrotto o disco pieno) NON deve piu'
        bloccare tutto l'export: lo si salta con un avviso e si prosegue. '''
    try:
        if filename.endswith('.gz'):
            import gzip
            with gzip.open(filename, 'rt', encoding='utf-8') as fp:
                text = fp.read()
        else:
            with open(filename, 'r') as fp:
                text = fp.read()
        if not text.strip():
            sys.stderr.write('WARN: file JSON vuoto, saltato: ' + filename + '\n')
            return {}
        return json.loads(text)
    except (ValueError, OSError) as e:
        # ValueError copre JSONDecodeError; OSError copre gzip corrotto / errori di lettura
        sys.stderr.write('WARN: file JSON illeggibile (' + str(e) + '), saltato: ' + filename + '\n')
        return {}

#-----------------------------------------------------------------------------------------------------------
def json_save(data, filename):
    # scrittura ATOMICA (.tmp + fsync + rename): niente file di sito monchi se il processo muore.
    tmp = filename + '.tmp'
    with open(tmp, 'w') as fp:
        json.dump(data, fp, ensure_ascii=False, separators=(',',':'))
        fp.flush(); os.fsync(fp.fileno())
    os.replace(tmp, filename)
    return

#===========================================================================================================
# MAIN SENTINEL
#===========================================================================================================

if __name__ == "__main__":

    parser = argparse.ArgumentParser(description='Export rolling-window CSV/GeoJSON for the web front-end.')
    parser.add_argument("-r", "--region", required=True,
                        help="Region code [VEN/BZ/TN/FVG/all]")
    parser.add_argument("-n", "--days", type=int, default=7,
                        help="Rolling window length in days (default 7)")
    parser.add_argument("--parse-dir", default=None,
                        help="Override the parsed-data directory (default <script-dir>/<CODE>/data-parsed)")
    parser.add_argument("-o", "--out-dir", default=None,
                        help="Override the output directory (default <script-dir>/<CODE>/web)")
    parser.add_argument("--site-dir", default=None,
                        help="Write every region into <site-dir>/<CODE>/ (flat layout for the web page / GitHub Pages)")
    parser.add_argument("--coords", default=None,
                        help="Station-coordinate lookup CSV (scode,lat,lon). "
                             "Default: <script-dir>/<CODE>/stazioni_coords.csv if present (used e.g. for FVG).")
    parser.add_argument("--series-dir", default='series',
                        help="Nome della sottocartella delle serie CSV (default 'series'; usa 'series30' per la finestra 30gg)")
    parser.add_argument("--series-only", action='store_true',
                        help="Scrive solo i CSV delle serie (niente geojson/units) - per l'export 30gg")
    parser.add_argument("--debug", action='store_true', help="Verbose output")
    args = parser.parse_args()

# region list
    regions = list(REGION_CFG) if args.region.lower() == 'all' else [args.region]

# coordinate gia' pubblicate (accumulate tra le regioni): servono al dedup di AIPO (PC_PO, ultimo)
    pub_coords = []

    for region in regions:
        rdir      = region_dir(region)
        parse_dir = args.parse_dir if args.parse_dir else os.path.join(rdir, 'data-parsed')
        if args.site_dir:
            out_dir = os.path.join(args.site_dir, region)
        else:
            out_dir = args.out_dir if args.out_dir else os.path.join(rdir, 'web')
        if not os.path.isdir(parse_dir):
            print('SKIP ' + region + ': parsed dir not found (' + parse_dir + ')')
            continue
        coords_path = args.coords if args.coords else os.path.join(rdir, 'stazioni_coords.csv')
        coords = load_coords(coords_path)
        if coords:
            print('Coordinate lookup: ' + str(len(coords)) + ' stations from ' + coords_path)
        export_region(region, parse_dir, out_dir, args.days, coords=coords, debug_opt=args.debug,
                      series_subdir=args.series_dir, series_only=args.series_only, pub_coords=pub_coords)
