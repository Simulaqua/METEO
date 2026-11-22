#!/usr/bin/env python3
# dati_mare.py - maree e dati marini, ogni rete come regione a sé (MAR_<RETE>, ACQ_VEN):
#   VEN     MAR_VEN  CPSM Venezia (dati.venezia.it): un JSON per grandezza, dato ogni ~5 min; i 'valore' sono
#                    stringhe con l'unità, se ne leggono i numeri; le coordinate si uniscono per ID
#   ER      MAR_ER   ARPAE-SIMC, boe e mareografi, da realtime.jsonl (codici BUFR); dallo stesso file anche
#                    le misure a terra che l'API dell'allerta non dà (regione ER)
#   ACQVEN  ACQ_VEN  ARPAV, qualità delle acque: boe del Delta del Po e delle lagune (REST JSON)
#   FVG     MAR_FVG  OGS Trieste (ERDDAP): boe e sensori del Golfo di Trieste e della costa
# Ogni stazione ha lat/lon. Gli istanti sono in ora solare (UTC+1).
# Uso: python3 dati_mare.py [-r all | -r VEN,ER,...] [--debug]
import argparse
import datetime
import json
import os
import re

import comune
import dati_emilia_romagna

# unità per sigla, per la legenda
UNITS = {'MAREA': 'm', 'ONDE': 'm', 'TEMP': '°C', 'TEMPACQUA': '°C', 'UMID': '%',
         'PRESS': 'hPa', 'RADSOL': 'W/m²', 'DVENTO': '°N', 'VVENTO': 'm/s', 'VVENTOMAX': 'm/s',
         'PORTATA': 'm³/s'}

# VEN: file -> sigla. Il vento è a parte: tre numeri (direzione, velocità, raffica).
CPSM_BASE = 'http://dati.venezia.it/sites/default/files/dataset/opendata/'
CPSM_SCALAR = [('livello', 'MAREA'), ('onde_mare', 'ONDE'), ('onde_laguna', 'ONDE'),
               ('tempacqua', 'TEMPACQUA'), ('temparia', 'TEMP'), ('umidita', 'UMID'),
               ('pressione', 'PRESS'), ('radiazione', 'RADSOL')]

# ER: codice B -> (sigla, in kelvin?). Coordinate nei campi B05001 (lat) e B06001 (lon); le date di primo
# livello sono in UTC.
ER_URL = 'https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl'
ER_NETWORKS = ('boa', 'marefe')          # solo boe e mareografi
ER_CODES = {'B22037': ('MAREA', False), 'B22070': ('ONDE', False), 'B22043': ('TEMPACQUA', True),
            'B12101': ('TEMP', True), 'B13003': ('UMID', False), 'B11002': ('VVENTO', False)}
# A terra lo stesso file ha le stazioni dell'allerta: a quelle dell'API (riconosciute dalle coordinate)
# si aggiunge ciò che l'API non dà; le stazioni che l'API non ha entrano con tutte le misure, con la sigla
# A_ e il nome. Restano fuori la rete partecipativa rmap e i codici locali B112xx e B14199-201, di cui la
# fonte non dice il significato. Codice B -> (sigla, conversione dall'unità BUFR).
ER_LAND = {
    'B12101': ('TEMP', lambda v: round(v - 273.15, 1)), 'B13003': ('UMID', None), 'B13011': ('PREC', None),
    'B11002': ('VVENTO', None), 'B11001': ('DVENTO', None), 'B11041': ('VVENTOMAX', None),
    'B11043': ('DVENTOMAX', None), 'B10004': ('PRESS', lambda v: round(v / 100.0, 1)),
    'B13215': ('LIVIDRO', None), 'B13013': ('LIVNEVE', lambda v: round(v * 100, 1)),
    'B14198': ('RADSOL', None), 'B13082': ('TEMPACQUA', lambda v: round(v - 273.15, 1)),
    'B13080': ('PH', None), 'B13081': ('CONDUCIBILITA', lambda v: round(v * 1e4)),
    'B13083': ('OSSIGENO', lambda v: round(v * 1e3, 2)), 'B13084': ('TORBIDITA', None),
    'B13085': ('POTREDOX', lambda v: round(v * 1e3))}
ER_LAND_UNITS = {'TEMP': '°C', 'UMID': '%', 'PREC': 'mm', 'VVENTO': 'm/s', 'DVENTO': '°N', 'VVENTOMAX': 'm/s',
                 'DVENTOMAX': '°N', 'PRESS': 'hPa', 'LIVIDRO': 'm', 'LIVNEVE': 'cm', 'RADSOL': 'W/m²',
                 'TEMPACQUA': '°C', 'PH': 'pH', 'CONDUCIBILITA': 'µS/cm', 'OSSIGENO': 'mg/l',
                 'TORBIDITA': 'NTU', 'POTREDOX': 'mV'}
ER_LAND_SKIP = ER_NETWORKS + ('rmap',)

# ACQVEN: parametro ARPAV -> sigla
ACQUE_BASE = 'https://api.arpa.veneto.it/REST/v1'
ACQUE_PARAMETERS = {
    'Temperatura acqua': 'TEMPACQUA', 'Salinità': 'SALINITA', 'Ossigeno disciolto': 'OSSIGENO',
    'pH misurato a campo': 'PH', 'Clorofilla a': 'CLOROFILLA',
    'Conducibilità elettrica': 'CONDUCIBILITA', 'Ossigeno disciolto al prel.': 'OSSIGENO_SAT'
}

# FVG: ERDDAP tabledap, un dataset '<ID>_TS' per piattaforma. Il time è UTC con la 'Z' finale, tolta prima di
# leggerlo. Coordinate fisse, scritte qui invece di una query per riga. MAMBO1 ha righe doppie sullo stesso
# istante, quasi tutte nulle: i valori nulli si scartano per colonna. La portata RVFL alla foce dell'Isonzo
# può essere negativa (la marea risale): è un valore vero, passa com'è.
OGS_BASE = 'https://nodc.ogs.it/erddap/tabledap/'
OGS_STATIONS = [
    # dataset ERDDAP, sigla stazione, nome, lat, lon, [(variabile OGS, sigla comune), ...]
    ('MAMBO1_TS',  'MAMBO1',  'Boa MAMBO1 (Golfo di Trieste)',      45.6976667, 13.7083333,
     [('WSPD', 'VVENTO'), ('WDIR', 'DVENTO'), ('DRYT', 'TEMP'), ('ATMS', 'PRESS'), ('RELH', 'UMID')]),
    ('DWRG1_TS',   'DWRG1',   'Ondametro DWRG1 (Golfo di Trieste)', 45.5655,    13.248,
     [('VAVH', 'ONDE')]),
    ('DWRG2_TS',   'DWRG2',   'Ondametro DWRG2 (Golfo di Trieste)', 45.6995,    13.209,
     [('VAVH', 'ONDE')]),
    ('DWRG3_TS',   'DWRG3',   'Ondametro DWRG3 (Golfo di Trieste)', 45.688266,  13.521316,
     [('VAVH', 'ONDE')]),
    ('CURRISO_TS', 'CURRISO', 'CURRISO - Foce Isonzo',              45.7616667, 13.4963333,
     [('RVFL', 'PORTATA'), ('TEMP', 'TEMPACQUA')]),
    ('PIEZTAG_TS', 'PIEZTAG', 'PIEZTAG - Foce Tagliamento',         45.6714885, 13.0685195,
     [('ASLV', 'MAREA'), ('TEMP', 'TEMPACQUA')]),
]
OGS_QC_OK = (0, 1, 2)   # SeaDataNet L20: non controllato, buono, probabilmente buono; 3-9 si scartano


def numbers(text):
    """Tutti i numeri di una stringa come '209 gradi, 1.4 m/s, 2.2 m/s'."""
    return [float(x) for x in re.findall(r'-?\d+\.?\d*', text or '')]


def first_number(text):
    found = numbers(text)
    return found[0] if found else None


def download_ven(debug=False):
    # prima nome e coordinate di ogni stazione, da tutti i file che li hanno
    coords, names = {}, {}
    files = {}
    for name, _ in CPSM_SCALAR + [('vento', None)]:
        try:
            files[name] = comune.get_json(CPSM_BASE + name + '.json')
        except Exception as e:
            print('WARN: [VEN] file %s saltato (%s)' % (name, e))
            files[name] = []
        for r in files[name]:
            sid = r.get('ID_stazione')
            lat, lon = r.get('latDDN'), r.get('lonDDE')
            if sid and lat and lon and sid not in coords:
                try:
                    coords[sid] = (float(lat), float(lon))
                    names[sid] = r.get('stazione') or sid
                except (TypeError, ValueError):
                    pass

    stations, readings, units = {}, {}, {}

    def add(sid, var, dt_str, value):
        if value is None or sid not in coords:
            return
        try:
            dt = datetime.datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
        except (TypeError, ValueError):
            return
        stations[sid] = {'NOME': names.get(sid, sid), 'LAT': coords[sid][0], 'LON': coords[sid][1]}
        readings.setdefault(var, {}).setdefault(sid, []).append((comune.civil_to_solar(dt), value))
        units[var] = UNITS.get(var)

    # grandezze scalari: il primo numero della stringa
    for name, var in CPSM_SCALAR:
        for r in files.get(name, []):
            add(r.get('ID_stazione'), var, r.get('data'), first_number(r.get('valore')))

    # vento: "direzione gradi, velocità m/s, raffica m/s"
    for r in files.get('vento', []):
        n = numbers(r.get('valore'))
        sid, dt = r.get('ID_stazione'), r.get('data')
        if len(n) >= 1: add(sid, 'DVENTO', dt, n[0])
        if len(n) >= 2: add(sid, 'VVENTO', dt, n[1])
        if len(n) >= 3: add(sid, 'VVENTOMAX', dt, n[2])

    return stations, readings, units


def download_er(debug=False):
    records = []
    for line in comune.get_text(ER_URL, timeout=90).split('\n'):
        try:
            records.append(json.loads(line))
        except ValueError:
            continue
    result = {'MAR_ER': er_sea(records)}
    land = er_land(records)
    if land[1]:
        result['ER'] = land
    return result


def er_sea(records):
    stations, readings, units = {}, {}, {}
    for o in records:
        if o.get('network') not in ER_NETWORKS:
            continue
        name, lat, lon, vals = None, None, None, {}
        for blk in o.get('data', []):
            vs = blk.get('vars', {})
            if 'B01019' in vs: name = vs['B01019']['v']
            if 'B05001' in vs: lat = comune.to_float(vs['B05001']['v'])
            if 'B06001' in vs: lon = comune.to_float(vs['B06001']['v'])
            for code, (var, kelvin) in ER_CODES.items():
                if code in vs:
                    v = comune.to_float(vs[code]['v'])
                    if v is None:
                        continue
                    vals[var] = round(v - 273.15, 1) if kelvin else v
        if not name or lat is None or lon is None or not vals:
            continue
        try:
            dt = datetime.datetime.strptime(o['date'], '%Y-%m-%dT%H:%M:%SZ')
        except (KeyError, ValueError):
            continue
        sc = comune.slug(name)
        moment = comune.utc_to_solar(dt)
        stations[sc] = {'NOME': name, 'LAT': lat, 'LON': lon}
        for var, v in vals.items():
            readings.setdefault(var, {}).setdefault(sc, []).append((moment, v))
            units[var] = UNITS.get(var)
    return stations, readings, units


def er_land(records):
    """Le stazioni a terra. Per stazione e grandezza un solo passo, l'istantaneo o il più breve: la pioggia
    di 15 minuti e quella oraria della stessa stazione non si sommano."""
    registry = comune.load_json(os.path.join(comune.region_dir('ER'), 'data-parsed', 'stazioni.json'))
    api = {}
    for sc, meta in (registry or {}).items():
        lat, lon = comune.to_float(meta.get('LAT')), comune.to_float(meta.get('LON'))
        if sc.isdigit() and lat is not None and lon is not None:
            api[(round(lon * 1e5), round(lat * 1e5))] = sc
    if not api:                 # senza l'anagrafica dell'allerta ogni sua stazione sembrerebbe nuova
        return {}, {}, {}
    api_vars = set(dati_emilia_romagna.VARIABLES)
    stations, found = {}, []
    for o in records:
        if o.get('network') in ER_LAND_SKIP:
            continue
        try:
            moment = comune.utc_to_solar(datetime.datetime.strptime(o['date'], '%Y-%m-%dT%H:%M:%SZ'))
        except (KeyError, ValueError):
            continue
        blocks = o.get('data', [])
        meta = {k: c.get('v') for b in blocks if 'timerange' not in b for k, c in b.get('vars', {}).items()}
        sc = api.get((o.get('lon'), o.get('lat')))
        from_api = sc is not None
        if not from_api:
            name = meta.get('B01019')
            lat, lon = comune.to_float(meta.get('B05001')), comune.to_float(meta.get('B06001'))
            if not name or lat is None or lon is None:
                continue
            sc = 'A_' + comune.slug(name)
            stations[sc] = {'NOME': name, 'LAT': lat, 'LON': lon}
        for b in blocks:
            if 'timerange' not in b:
                continue
            step = (b['timerange'][0] != 254, b['timerange'][2], json.dumps(b.get('level')))
            for code, cell in b.get('vars', {}).items():
                if code not in ER_LAND:
                    continue
                var, conv = ER_LAND[code]
                value = comune.to_float(cell.get('v'))
                if value is None or (from_api and var in api_vars):
                    continue
                found.append((sc, var, step, moment, conv(value) if conv else value))
    chosen = {}
    for sc, var, step, _, _ in found:
        if (sc, var) not in chosen or step < chosen[(sc, var)]:
            chosen[(sc, var)] = step
    readings, units = {}, {}
    for sc, var, step, moment, value in found:
        if step == chosen[(sc, var)]:
            readings.setdefault(var, {}).setdefault(sc, []).append((moment, value))
            units[var] = ER_LAND_UNITS[var]
    return stations, readings, units


def download_acque_ven(debug=False):
    coords = {}
    for s in comune.get_json(ACQUE_BASE + '/acqua_boe_stazioni_point').get('data', []):
        try:
            g = json.loads(s['geometria'])
            lon, lat = g['coordinates'][0], g['coordinates'][1]
            coords[s['codseqst']] = {'lat': lat, 'lon': lon, 'nome': s.get('nome')}
        except (KeyError, ValueError, TypeError):
            continue
    stations, readings, units = {}, {}, {}
    for r in comune.get_json(ACQUE_BASE + '/acqua_boe_dati').get('data', []):
        var = ACQUE_PARAMETERS.get(r.get('PARAMETRO'))
        co = coords.get(r.get('CODSEQST'))
        if not var or not co:
            continue
        val = comune.to_float(r.get('MEDIA'))
        if val is None:
            continue
        try:
            dt = datetime.datetime.strptime(r['DATA'][:19], '%Y-%m-%dT%H:%M:%S')   # ora locale
        except (KeyError, ValueError):
            continue
        sc = str(r.get('CODSEQST'))
        stations[sc] = {'NOME': co['nome'], 'LAT': co['lat'], 'LON': co['lon']}
        readings.setdefault(var, {}).setdefault(sc, []).append((comune.civil_to_solar(dt), val))
        units[var] = (r.get('UDM') or '').replace('gradi C.', '°C')
    return stations, readings, units


def download_fvg(debug=False):
    # finestra di 2 giorni: recupera un'interruzione del Pi (write_parsed scarta le letture già note)
    since = (datetime.datetime.utcnow() - datetime.timedelta(days=2)).strftime('%Y-%m-%dT%H:%M:%SZ')
    stations, readings, units = {}, {}, {}
    for dataset_id, sc, name, lat, lon, colmap in OGS_STATIONS:
        cols = ['time'] + [v for v, _ in colmap] + [v + '_QC' for v, _ in colmap]
        url = OGS_BASE + dataset_id + '.json?' + ','.join(cols) + '&time>=' + since
        try:
            rows = comune.get_json(url)['table']['rows']
        except Exception as e:
            if debug: print('  OGS ' + dataset_id + ' skip: ' + str(e))
            continue
        got = False
        for row in rows:
            try:
                dt = datetime.datetime.strptime(row[0][:19], '%Y-%m-%dT%H:%M:%S')
            except (TypeError, ValueError):
                continue
            moment = comune.utc_to_solar(dt)
            for i, (_, var) in enumerate(colmap):
                v = comune.to_float(row[1 + i])
                qc = row[1 + len(colmap) + i]
                if v is None or qc not in OGS_QC_OK:
                    continue
                readings.setdefault(var, {}).setdefault(sc, []).append((moment, v))
                units[var] = UNITS.get(var)
                got = True
        if got:
            stations[sc] = {'NOME': name, 'LAT': lat, 'LON': lon}
    return stations, readings, units


NETWORKS = {'VEN': ('MAR_VEN', download_ven), 'ER': ('MAR_ER', download_er),
            'ACQVEN': ('ACQ_VEN', download_acque_ven), 'FVG': ('MAR_FVG', download_fvg)}


def main():
    ap = argparse.ArgumentParser(description='Dati meteo-marini / maree (stazioni con coordinate).')
    ap.add_argument('-r', '--region', default='all',
                    help="all | una o più reti separate da virgola, es. VEN,ER")
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== MARE (maree e dati marini) %s ===' %
          datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    names = list(NETWORKS) if args.region.lower() == 'all' else [
        r.strip().upper() for r in args.region.split(',') if r.strip()]
    for name in names:
        if name not in NETWORKS:
            print('Rete maree non disponibile: ' + name)
            continue
        code, download = NETWORKS[name]
        try:
            result = download(debug=args.debug)
            # un solo scarico può scrivere più regioni (il file di ARPAE: mare e terra)
            for region, (stations, readings, units) in (result.items() if isinstance(result, dict)
                                                         else [(code, result)]):
                comune.write_parsed(region, stations, readings, units)
        except Exception as e:
            print('[%s] ERRORE: %s' % (name, e))


if __name__ == '__main__':
    main()
