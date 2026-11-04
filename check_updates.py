#!/usr/bin/env python3

# check_updates.py - monitor: rileva NUOVE STAZIONI e NUOVE VARIABILI (non mappate) in tutte le regioni.
#
# Per ogni regione confronta il feed live con:
#   - le variabili MAPPATE, lette direttamente dalla classe `variables` dello script della regione
#     (cosi' quando aggiungi una variabile allo script, qui smette automaticamente di segnalarla);
#   - uno SNAPSHOT delle stazioni note (.tracking/<REGION>_stations.json): segnala solo quelle nuove.
#
# Uso:  python3 check_updates.py -r all            (tutte le regioni)
#       python3 check_updates.py -r BZ             (una regione)
#       python3 check_updates.py -r all --sample 40   (piu' veloce: campiona 40 stazioni/lista)
# Le eventuali novita' vengono stampate e appese a tracking.log (con data/ora).

import os, sys, json, re, csv, io, argparse, datetime, importlib.util, urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

_UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) meteo-check/1.0'}   # alcune fonti bloccano l'UA di default

_BASE_DIR = os.path.dirname(os.path.realpath(__file__))
TRACK_DIR = os.path.join(_BASE_DIR, '.tracking')
LOG_FILE  = os.path.join(_BASE_DIR, 'tracking.log')

REGIONS = {
    'VEN': 'VEN/dati_veneto.py',
    'TN' : 'TN/dati_trentino.py',
    'BZ' : 'BZ/dati_altoadige.py',
    'FVG': 'FVG/dati_fvg.py',
    'LOM': 'LOM/dati_lombardia.py',
    'ER' : 'ER/dati_emilia_romagna.py',
    # layer aggiuntivi: il "modulo" e' lo script multi-rete (per riusarne le mappe sigla/variabile)
    'AQ_VEN': 'dati_aria.py', 'AQ_LOM': 'dati_aria.py', 'AQ_BZ': 'dati_aria.py',
    'AQ_TN' : 'dati_aria.py', 'AQ_ER' : 'dati_aria.py',
    'PC_FVG': 'dati_pc.py',   'PC_TN' : 'dati_pc.py',
}

#-----------------------------------------------------------------------------------------------------------
def load_module(rel_path):
    ''' Import a region script by file path (to read its `variables` class and endpoint constants). '''
    path = os.path.join(_BASE_DIR, rel_path)
    name = 'reg_' + os.path.basename(os.path.dirname(path))
    spec = importlib.util.spec_from_file_location(name, path)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def get(url, timeout=25):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers=_UA), timeout=timeout).read()
    except Exception:
        return None

def var_names(m):
    return [n for n in dir(m.variables) if not n.startswith('__')]

#-----------------------------------------------------------------------------------------------------------
# SCANNER PER REGIONE  ->  (mapped:set, live:dict{code:n_staz}, stations:dict{code:name})
#-----------------------------------------------------------------------------------------------------------
def scan_ven(m, sample):
    mapped = set(var_names(m))                                   # per ARPAV il TYPE == nome variabile
    lists  = []
    for n in var_names(m):
        u = getattr(m.variables, n).url_stazioni
        if u not in lists: lists.append(u)
    stations, links = {}, []
    for u in lists:
        raw = get(m.base_URL + '/' + u)
        if not raw: continue
        for s in ET.fromstring(raw).iter('STAZIONE'):
            ids = s.findtext('IDSTAZ'); nm = s.findtext('NOME'); ln = s.findtext('LINKSTAZ')
            if ids: stations[ids] = nm
            if ln:  links.append(ln)
    if sample: links = links[:sample]
    def types(ln):
        raw = get(m.base_URL + '/' + ln)
        if not raw: return []
        try: return [t.text for t in ET.fromstring(raw).findall('STAZIONE/SENSORE/TYPE')]
        except Exception: return []
    live = Counter()
    with ThreadPoolExecutor(max_workers=16) as ex:
        for res in ex.map(types, links):
            for t in set(res): live[t] += 1
    return mapped, dict(live), stations

def scan_bz(m, sample):
    mapped = set(getattr(m.variables, n).type for n in var_names(m))
    stations = {}
    raw = get(m.url_stations)
    if raw:
        for f in json.loads(raw).get('features', []):
            p = f.get('properties', {}); sc = p.get('SCODE')
            if sc: stations[sc] = p.get('NAME_I') or p.get('NAME_D')
    live = Counter()
    raw = get(m.url_sensors)
    if raw:
        for r in json.loads(raw):
            live[r.get('TYPE')] += 1
            stations.setdefault(r.get('SCODE'), None)
    return mapped, dict(live), stations

def scan_tn(m, sample):
    NS = m.NS
    mapped = set()
    for n in var_names(m):
        c = getattr(m.variables, n)
        mapped.add(c.value); mapped.update(getattr(c, 'extra', {}).values())
    stations, codes = {}, []
    raw = get(m.url_lista)
    if raw:
        for a in ET.fromstring(raw).findall('mt:anagrafica', NS):
            code = a.find('mt:codice', NS); nome = a.find('mt:nome', NS)
            if code is not None:
                codes.append(code.text)
                stations[code.text] = nome.text if nome is not None else None
    smp = codes[:sample] if sample else codes
    nsuri = '{' + NS['mt'] + '}'
    def leaves(c):
        raw = get(m.url_dati + c)
        if not raw: return []
        try:
            out = []
            for sec in ET.fromstring(raw):
                kids = list(sec)
                if kids:
                    for leaf in kids[0]:
                        tag = leaf.tag.replace(nsuri, '')
                        if tag != 'data': out.append(tag)
            return out
        except Exception: return []
    live = Counter()
    with ThreadPoolExecutor(max_workers=16) as ex:
        for res in ex.map(leaves, smp):
            for t in set(res): live[t] += 1
    return mapped, dict(live), stations

def scan_fvg(m, sample):
    mapped = set()
    for n in var_names(m):
        c = getattr(m.variables, n)
        mapped.add(c.tag); mapped.update(getattr(c, 'extra', {}).values())
    raw = get(m.home_URL)
    codes = sorted(set(re.findall(r'stazioni/([A-Za-z0-9]+)\.xml', raw.decode('utf-8', 'replace')))) if raw else []
    smp = codes[:sample] if sample else codes
    def fields(c):
        raw = get(m.station_base + c + '.xml')
        if not raw: return (c, None, [])
        try:
            md = ET.fromstring(raw).find('meteo_data')
            if md is None: return (c, None, [])
            return (c, md.findtext('station_name'), [e.tag for e in md if e.tag not in m.META_TAGS])
        except Exception: return (c, None, [])
    stations, live = {}, Counter()
    with ThreadPoolExecutor(max_workers=12) as ex:
        for c, nm, tags in ex.map(fields, smp):
            stations[c] = nm
            for t in set(tags): live[t] += 1
    for c in codes: stations.setdefault(c, None)                 # stazioni anche se non campionate
    return mapped, dict(live), stations

def scan_lom(m, sample):
    mapped = set(getattr(m.variables, n).tipo for n in var_names(m))
    q = "?$select=tipologia,idstazione,nomestazione&$where=storico%3D%27N%27&$limit=20000"
    stations, live = {}, Counter()
    raw = get(m.url_anagrafica + q)
    if raw:
        for a in json.loads(raw):
            live[a.get('tipologia')] += 1
            sc = a.get('idstazione')
            if sc:
                stations[sc] = a.get('nomestazione')
    return mapped, dict(live), stations

def scan_er(m, sample):
    import urllib.parse
    mapped = set(getattr(m.variables, n).desc for n in var_names(m))
    stations = {}
    for n in ('LIVIDRO', 'TEMP', 'PREC'):
        desc = getattr(m.variables, n).desc
        raw = get(m.API + 'get-sensor-values?variabile=' + urllib.parse.quote(desc, safe=''))
        if not raw:
            continue
        for s in json.loads(raw):
            if isinstance(s, dict) and 'idstazione' in s:
                stations[s['idstazione']] = s.get('nomestaz')
    # ER non espone un elenco di variabili: 'live' = 'mapped' (nessuna variabile non mappata)
    return mapped, {d: 1 for d in mapped}, stations

#-----------------------------------------------------------------------------------------------------------
# LAYER AGGIUNTIVI: qualita' aria (AQ_*) e idrometria PC (PC_*). Qui interessa soprattutto rilevare
# NUOVE STAZIONI (per l'aria TN/ER servono a sapere che va aggiunta/verificata una coordinata). Il
# flag "variabile non mappata" e' tenuto solo dove e' pulito (PC_TN: 2 grandezze); per l'aria le reti
# misurano molte specie che non tracciamo di proposito, quindi non lo attiviamo (sarebbe rumore).
def _jget(url):
    raw = get(url)
    try: return json.loads(raw) if raw else None
    except Exception: return None

def scan_aq_ven(m, sample):
    data = _jget('https://www2.arpa.veneto.it/aria-json/exported/aria/data.json') or {}
    stats = _jget('https://www2.arpa.veneto.it/aria-json/exported/aria/stats.json') or {}
    names = {s['codseqst']: s.get('nome') for s in stats.get('stazioni', [])}
    stations = {s['codseqst']: names.get(s['codseqst']) for s in data.get('stazioni', [])}
    return set(m.VEN_POLLMAP.values()), {}, stations

def scan_aq_lom(m, sample):
    q = "?$select=idstazione,nomestazione&$where=storico%3D%27N%27&$group=idstazione,nomestazione&$limit=5000"
    stations = {}
    for a in (_jget('https://www.dati.lombardia.it/resource/ib47-atvt.json' + q) or []):
        if a.get('idstazione'):
            stations[a['idstazione']] = a.get('nomestazione')
    return set(m.LOM_TYPEMAP.values()), {}, stations

def scan_aq_bz(m, sample):
    stations = {}
    for r in (_jget('https://dati.retecivica.bz.it/services/airquality/sensors') or []):
        if r.get('MCODE') in m.BZ_MCODEMAP and r.get('SCODE'):
            stations.setdefault(r['SCODE'], r['SCODE'])
    return set(m.BZ_MCODEMAP.values()), {}, stations

def scan_aq_tn(m, sample):
    d = _jget('https://bollettino.appa.tn.it/aria/opendata/json/last/2,4,6,8,9,15,22,23') or {}
    stations = {s.get('nome'): s.get('nome') for s in d.get('stazione', []) if s.get('nome')}
    return set(m.TN_POLLMAP.values()), {}, stations

def scan_aq_er(m, sample):
    raw = get('https://docs.google.com/spreadsheets/d/1-4wgZ8JeLeg0bODTSFUrshPY-_y9mERUu0FJtSFr78s/export?format=csv')
    stations = {}
    if raw:
        for r in csv.DictReader(io.StringIO(raw.decode('utf-8', 'replace'))):
            code = (r.get('Cod_staz') or '').replace('.', '')
            if code:
                stations[code] = r.get('Stazione')
    return set(), {}, stations

def scan_pc_fvg(m, sample):
    d = _jget('https://monitor.protezionecivile.fvg.it/api/stations') or {}
    stations = {str(s.get('id')): s.get('name') for s in d.get('stations', []) if s.get('id') is not None}
    return set(m.FVG_MAP.values()), {}, stations

def scan_pc_tn(m, sample):
    g = _jget('https://www.floods.it/api/v1/monitoring/index.json') or {}
    stations, live = {}, Counter()
    for f in g.get('features', []):
        md = (f.get('properties') or {}).get('metadata', {})
        sid = str(md.get('series id'))
        if sid and sid != 'None':
            stations[sid] = md.get('site')
        if md.get('quantity'):
            live[md['quantity']] += 1
    return set(m.TN_MAP), dict(live), stations           # PC_TN: flag anche nuove grandezze (solo 2 attese)

SCANNERS = {'VEN': scan_ven, 'BZ': scan_bz, 'TN': scan_tn, 'FVG': scan_fvg, 'LOM': scan_lom, 'ER': scan_er,
            'AQ_VEN': scan_aq_ven, 'AQ_LOM': scan_aq_lom, 'AQ_BZ': scan_aq_bz, 'AQ_TN': scan_aq_tn,
            'AQ_ER': scan_aq_er, 'PC_FVG': scan_pc_fvg, 'PC_TN': scan_pc_tn}

#-----------------------------------------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description='Rileva nuove stazioni / nuove variabili non mappate.')
    parser.add_argument('-r', '--region', default='all', help='VEN/BZ/TN/FVG/all')
    parser.add_argument('--sample', type=int, default=0,
                        help='Campiona N stazioni per lista (0 = tutte, default). Piu\' veloce ma puo\' perdere variabili rare.')
    args = parser.parse_args()

    if not os.path.exists(TRACK_DIR):
        os.makedirs(TRACK_DIR)
    sample  = args.sample or None
    regions = list(REGIONS) if args.region.lower() == 'all' else [args.region]
    stamp   = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    tot_vars = tot_staz = 0
    log_blocks = []

    for region in regions:
        if region not in REGIONS:
            print('Regione sconosciuta: ' + region); continue
        m = load_module(REGIONS[region])
        mapped, live, stations = SCANNERS[region](m, sample)

# variabili presenti nel feed ma NON mappate
        new_vars = sorted(k for k in live if k is not None and k not in mapped)

# stazioni nuove rispetto allo snapshot
        snap = os.path.join(TRACK_DIR, region + '_stations.json')
        known = set(json.load(open(snap))) if os.path.exists(snap) else None
        cur   = set(stations)
        baseline = known is None
        new_staz = [] if baseline else sorted(cur - known)
        json.dump(sorted(cur | (known or set())), open(snap, 'w'))   # aggiorna snapshot (unione)

# report a schermo
        print(f"\n=== {region} ===")
        if baseline:
            print(f"  stazioni: {len(cur)} (snapshot iniziale creato)")
        else:
            print(f"  stazioni: {len(cur)} nel feed | nuove: {len(new_staz)}")
            for c in new_staz:
                print(f"    + NUOVA STAZIONE {c}  {stations.get(c) or ''}")
        if new_vars:
            for v in new_vars:
                print(f"    ! VARIABILE NON MAPPATA: '{v}'  (in {live[v]} stazioni) -> aggiungila allo script {region}")
        else:
            print("  variabili: tutte mappate")

        tot_vars += len(new_vars); tot_staz += len(new_staz)

# blocco per il log (solo se c'e' qualcosa di nuovo)
        if new_vars or new_staz:
            lines = [f"[{stamp}] {region}:"]
            for v in new_vars: lines.append(f"  NUOVA VARIABILE '{v}' ({live[v]} staz)")
            for c in new_staz: lines.append(f"  NUOVA STAZIONE {c} {stations.get(c) or ''}")
            log_blocks.append("\n".join(lines))

    print(f"\n---\nTotale: {tot_vars} variabili non mappate, {tot_staz} stazioni nuove.")
    if log_blocks:
        with open(LOG_FILE, 'a') as fp:
            fp.write("\n".join(log_blocks) + "\n")
        print('Novita\' registrate in ' + LOG_FILE)

if __name__ == '__main__':
    main()
