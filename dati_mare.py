#!/usr/bin/env python3
# dati_mare.py - maree e dati marini, ognuna delle quattro reti come una regione a sé (codice MAR_<RETE>, ACQ_VEN):
#   VEN     MAR_VEN  CPSM, Centro Previsioni e Segnalazioni Maree del Comune di Venezia (dati.venezia.it): un file JSON
#                    per grandezza (livello, onde, vento, temperature, umidità, pressione, radiazione), dato ogni ~5 min;
#                    i 'valore' sono stringhe con l'unità, se ne leggono i numeri; le coordinate si uniscono per ID
#   ER      MAR_ER   ARPAE-SIMC, boe Nausicaa/Calipso e mareografi, da realtime.jsonl (codici BUFR)
#   ACQVEN  ACQ_VEN  ARPAV, qualità delle acque: boe automatiche del Delta del Po e delle lagune (REST JSON)
#   FVG     MAR_FVG  OGS Trieste (ERDDAP): boe e sensori del Golfo di Trieste e della costa
# Ogni stazione ha lat/lon. Gli istanti sono in ora solare (UTC+1).
# Uso: python3 dati_mare.py [-r all | -r VEN,ER,...] [--debug]
import argparse
import datetime
import json
import re

import comune

# unità per sigla, per la legenda
UNITS = {'MAREA': 'm', 'ONDE': 'm', 'TEMP': '°C', 'TEMPACQUA': '°C', 'UMID': '%',
         'PRESS': 'hPa', 'RADSOL': 'W/m²', 'DVENTO': '°N', 'VVENTO': 'm/s', 'VVENTOMAX': 'm/s',
         'PORTATA': 'm³/s'}

# VEN: file -> sigla. Il vento è a parte: tre numeri (direzione, velocità, raffica).
CPSM_BASE = 'http://dati.venezia.it/sites/default/files/dataset/opendata/'
CPSM_SCALAR = [('livello', 'MAREA'), ('onde_mare', 'ONDE'), ('onde_laguna', 'ONDE'),
               ('tempacqua', 'TEMPACQUA'), ('temparia', 'TEMP'), ('umidita', 'UMID'),
               ('pressione', 'PRESS'), ('radiazione', 'RADSOL')]

# ER: codice B -> (sigla, in kelvin?). Livello del mare, altezza d'onda significativa, temperature del mare e dell'aria
# (kelvin), umidità, vento. Le coordinate sono nei campi B05001 (lat) e B06001 (lon), le date di primo livello in UTC.
ER_URL = 'https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl'
ER_NETWORKS = ('boa', 'marefe')          # solo boe e mareografi
ER_CODES = {'B22037': ('MAREA', False), 'B22070': ('ONDE', False), 'B22043': ('TEMPACQUA', True),
            'B12101': ('TEMP', True), 'B13003': ('UMID', False), 'B11002': ('VVENTO', False)}

# ACQVEN: parametro ARPAV -> sigla
ACQUE_BASE = 'https://api.arpa.veneto.it/REST/v1'
ACQUE_PARAMETERS = {'Temperatura acqua': 'TEMPACQUA', 'Salinità': 'SALINITA', 'Ossigeno disciolto': 'OSSIGENO',
                    'pH misurato a campo': 'PH', 'Clorofilla a': 'CLOROFILLA',
                    'Conducibilità elettrica': 'CONDUCIBILITA', 'Ossigeno disciolto al prel.': 'OSSIGENO_SAT'}

# FVG: ERDDAP tabledap, un dataset '<ID>_TS' per piattaforma. Il time è UTC con la 'Z' finale, tolta prima di
# leggerlo. Le coordinate sono fisse (ancoraggi e pozzetti, confermate dall'actual_range del .das): scritte qui
# invece di una query per riga. Il dataset di MAMBO1 mette più strumenti sullo stesso istante (righe doppie quasi
# tutte nulle): innocuo, i valori nulli si scartano per colonna. La portata RVFL alla foce dell'Isonzo può essere
# negativa (la marea risale): è un valore vero, passa com'è.
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


def slug(name):
    return ''.join(c if c.isalnum() else '_' for c in (name or '')).strip('_') or 'staz'


def numbers(text):
    """Tutti i numeri di una stringa come '209 gradi, 1.4 m/s, 2.2 m/s'."""
    return [float(x) for x in re.findall(r'-?\d+\.?\d*', text or '')]


def first_number(text):
    found = numbers(text)
    return found[0] if found else None


def download_ven(debug=False):
    # prima le coordinate e il nome di ogni stazione, da tutti i file che li hanno
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
    raw = comune.get_text(ER_URL, timeout=90)
    stations, readings, units = {}, {}, {}
    for line in raw.split('\n'):
        if not line.strip():
            continue
        try:
            o = json.loads(line)
        except ValueError:
            continue
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
        sc = slug(name)
        moment = comune.utc_to_solar(dt)
        stations[sc] = {'NOME': name, 'LAT': lat, 'LON': lon}
        for var, v in vals.items():
            readings.setdefault(var, {}).setdefault(sc, []).append((moment, v))
            units[var] = UNITS.get(var)
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
    # finestra di 2 giorni: recupera un'interruzione del Pi senza riscaricare la storia (write_parsed scarta
    # le letture già note)
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
    ap.add_argument('-r', '--region', default='all', help="all | una o più reti separate da virgola, es. VEN,ER")
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== MARE (maree e dati marini) %s ===' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    names = list(NETWORKS) if args.region.lower() == 'all' else [r.strip().upper() for r in args.region.split(',') if r.strip()]
    for name in names:
        if name not in NETWORKS:
            print('Rete maree non disponibile: ' + name)
            continue
        code, download = NETWORKS[name]
        try:
            stations, readings, units = download(debug=args.debug)
            comune.write_parsed(code, stations, readings, units)
        except Exception as e:
            print('[%s] ERRORE: %s' % (name, e))


if __name__ == '__main__':
    main()
