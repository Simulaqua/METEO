#!/usr/bin/env python3
# dati_laghi.py - livelli dei grandi laghi regolati (LAGHI): Maggiore, Como, Iseo, Idro, Garda, da laghi.net.
# Ogni giro legge le serie degli ultimi 3 giorni. Prima la home (cookie di sessione), poi
#   POST /MappaConSegnaposti/BootWidgetData (config=370): i laghi con le loro serie (id_sensore, id_funzione)
#   POST /GraficoMultiserie/GetSerieData: i punti di una serie, ['AAAA-MM-GG hh:mm' in ora solare, 'valore', ...]
# Uso: python3 dati_laghi.py [--debug]
import argparse
import datetime
import json

import requests

import comune

BASE_URL = 'https://laghi.net'
MAP_CONFIG = '370'
UNITS = {'LIVLAGO': 'm', 'AFFLUSSO': 'm³/s', 'DEFLUSSO': 'm³/s'}
SERIES = {'Livello': 'LIVLAGO', 'Afflusso': 'AFFLUSSO', 'Deflusso': 'DEFLUSSO'}
# questi laghi danno il livello in cm sullo zero idrometrico (si porta in metri); l'Idro in m s.l.m.
LEVEL_IN_CM = {'Lago Maggiore', 'Lago di Como', "Lago d'Iseo", 'Lago di Garda'}
# i segnaposti di laghi.net stanno sul punto di regolazione, sulla terraferma: la mappa usa il centro del lago
LAKE_CENTER = {
    'Lago Maggiore': (45.9300, 8.6000),
    'Lago di Como': (46.0000, 9.2600),     # tratto centrale (Menaggio-Varenna)
    "Lago d'Iseo": (45.7100, 10.0500),     # acqua a ovest di Monte Isola
    "Lago d'Idro": (45.7900, 10.5100),
    'Lago di Garda': (45.6000, 10.6300),
}


def post_json(session, path, data):
    r = session.post(BASE_URL + path, data=data, headers={'X-Requested-With': 'XMLHttpRequest'}, timeout=60)
    r.raise_for_status()
    return json.loads(r.content.decode('utf-8', 'replace'))


def download(debug=False):
    """Stazioni (una per lago) e letture: sigla -> {codice del lago -> [(istante, valore), ...]}."""
    session = requests.Session()
    session.headers['User-Agent'] = comune.USER_AGENT
    session.get(BASE_URL + '/', timeout=60).raise_for_status()      # per i cookie di sessione
    boot = post_json(session, '/MappaConSegnaposti/BootWidgetData', {'config': MAP_CONFIG})
    markers = boot['config']['segnaposti']
    now = comune.now_solar()
    since = (now - datetime.timedelta(days=3)).strftime('%Y-%m-%d %H:%M')
    until = (now + datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M')

    stations = {}
    readings = {}
    for i, lake in enumerate(boot['data']):
        tooltip = lake.get('tooltip_config') or {}
        name = tooltip.get('titolo')
        if not name:
            continue
        marker = markers[i] if i < len(markers) else {}
        code = comune.slug(name, 'lago')
        center = LAKE_CENTER.get(name)
        stations[code] = {
            'NOME': name,
            'LAT': center[0] if center else marker.get('lat'),
            'LON': center[1] if center else marker.get('lng')
        }
        for series in tooltip.get('series', []):
            var = SERIES.get(series.get('nome'))
            if not var:
                continue
            try:
                answer = post_json(
                    session, '/GraficoMultiserie/GetSerieData',
                    {'idSensore': series['id_sensore'], 'idFunzione': series['id_funzione'],
                     'from': since, 'to': until})
            except Exception as e:
                print('WARN: serie non letta (%s/%s): %s' % (name, series.get('nome'), e))
                continue
            points = parse(answer, var == 'LIVLAGO' and name in LEVEL_IN_CM)
            if points:
                readings.setdefault(var, {})[code] = points
                if debug:
                    print('  %-16s %-10s punti=%d ultimo=%s' % (name, var, len(points), points[-1]))
    return stations, readings


def parse(answer, in_cm):
    """I punti di una risposta di GetSerieData -> [(AAAAMMGGhhmm, valore)], senza i valori assenti ('NaN')."""
    if not answer.get('success'):
        return []
    data = answer.get('return_data') or []
    # i punti stanno in return_data[0][0] (lista di liste) oppure direttamente in return_data[0]
    points = data[0][0] if (data and data[0] and isinstance(data[0][0], list)) else (data[0] if data else [])
    out = []
    for p in points:
        if not isinstance(p, list) or len(p) < 2:
            continue
        value = comune.to_float(p[1])
        if value is None:
            continue
        if in_cm:
            value = round(value / 100.0, 3)
        moment = str(p[0]).replace('-', '').replace(':', '').replace(' ', '')[:12]
        if len(moment) == 12 and moment.isdigit():
            out.append((moment, value))
    return out


def main():
    ap = argparse.ArgumentParser(description='Livelli dei grandi laghi regolati (laghi.net).')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== LAGHI (laghi.net) %s ===' %
          datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    try:
        stations, readings = download(debug=args.debug)
        comune.write_parsed('LAGHI', stations, readings, UNITS)
    except Exception as e:
        print('[LAGHI] ERRORE: ' + str(e))


if __name__ == '__main__':
    main()
