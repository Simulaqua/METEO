#!/usr/bin/env python3
# dati_liguria.py - Liguria (ARPAL, portale OMIRL), regione LIG, REST anonimo.
# Endpoint (https://omirl.regione.liguria.it/Omirl/rest/):
#   stations/<Classe>             ultimo valore di ogni stazione della classe, con coordinate
#   charts/csv/<Codice>/<Classe>  serie della stazione, CSV 'gg/mm/aaaa hh:mm;valore;...;' (pioggia oraria
#                                 ~2,5 giorni; vento 10 min ~7 giorni = velocita' + raffica; resto 30 min ~15 giorni)
#   charts/<Codice>/Vento         grafico XML: unica fonte della DIREZIONE del vento (oraria, ~640 KB)
# Tutti i tempi OMIRL sono UTC: ora solare = UTC + 1 h.
# Pluvio PREC mm = pioggia dell'ora che FINISCE all'istante. Viene SOLO dalla serie oraria: il 'value'
# dell'istantanea e' una cumulata mobile di un'ora e campionarla non da' ore sommabili.
# Ogni giro (cron :14 e :44): istantanee + serie oraria della pioggia (~200 CSV da 1,6 KB).
# Ogni 3 ore: serie del vento (raffiche). Nel giro delle 03: serie complete di tutte le classi + direzione del
# vento, per chiudere i buchi (Pi spento, fonte ferma) e avere la risoluzione piena.
# Uso: python3 dati_liguria.py [--full] [--debug]
import argparse
import datetime
import xml.etree.ElementTree as ET

import comune

BASE_URL = 'https://omirl.regione.liguria.it/Omirl/rest/'
# classe OMIRL -> (sigla, unità, fattore sul valore). Pluvio a parte (solo serie oraria).
CLASSES = [('Termo',  'TEMP',      '°C',   1.0),
           ('Igro',   'UMID',      '%',    1.0),
           ('Idro',   'LIVIDRO',   'm',    1.0),
           ('Vento',  'VVENTO',    'm/s',  1 / 3.6),    # OMIRL pubblica km/h (rapporto con ItaliaMeteo 3,60)
           ('Radio',  'RADSOL',    'W/m²', 1.0),
           ('Neve',   'LIVNEVE',   'cm',   1.0),
           ('Press',  'PRESS',     'hPa',  1.0),
           ('Foglie', 'BAGNATURA', '%',    1.0),
           ('Elio',   'SOLEGG',    'min',  1.0),
           ('Boa',    'ONDE',      'm',    1.0)]
UNITS = dict((var, unit) for _, var, unit, _ in CLASSES)
UNITS.update({'PREC': 'mm', 'VVENTOMAX': 'm/s', 'DVENTO': 'gradi'})


def add(readings, var, scode, moment, value):
    readings.setdefault(var, {}).setdefault(scode, []).append((moment, round(value, 2)))


def snapshot(cls):
    """Istantanea di una classe: [(scode, codice, nome, lat, lon, istante solare, valore)]."""
    out = []
    for s in comune.get_json(BASE_URL + 'stations/' + cls):
        lat, lon, value = comune.to_float(s.get('lat')), comune.to_float(s.get('lon')), comune.to_float(
            s.get('value'))
        code = s.get('shortCode')
        if lat is None or lon is None or not code:
            continue
        try:
            dt = datetime.datetime.strptime(str(s.get('refDate'))[:16], '%Y-%m-%dT%H:%M')   # UTC
        except (ValueError, TypeError):
            dt = None
        out.append(('LIG' + str(code), str(code), s.get('name') or code, lat, lon,
                    comune.utc_to_solar(dt) if dt else None, value))
    return out


def series_csv(code, cls):
    """Serie di una stazione: [(istante solare, [valori...])], tempi UTC nel CSV."""
    points = []
    for line in comune.get_text(BASE_URL + 'charts/csv/%s/%s' % (code, cls)).splitlines():
        fields = line.strip().split(';')
        try:
            dt = datetime.datetime.strptime(fields[0], '%d/%m/%Y %H:%M')
        except (ValueError, IndexError):
            continue
        points.append((comune.utc_to_solar(dt), [comune.to_float(x) for x in fields[1:]]))
    return points


def wind_direction_xml(code):
    """Direzione del vento (gradi) dal grafico XML: [(istante solare, gradi)], tempi epoch-ms UTC."""
    root = ET.fromstring(comune.get_text(BASE_URL + 'charts/%s/Vento' % code, timeout=120))
    out = []
    for series in root.findall('dataSeries'):
        if (series.findtext('name') or '').lower() != 'wind direction':
            continue
        for data in series.findall('data'):
            items = data.findall('item')
            if len(items) < 2:
                continue
            value = comune.to_float(items[1].text)
            if value is None:
                continue
            dt = datetime.datetime.utcfromtimestamp(int(items[0].text) / 1000)
            out.append((comune.utc_to_solar(dt), value))
    return out


def download(full=False, wind=False, debug=False):
    stations, readings = {}, {}
    per_class = {}
    # 1) istantanee di tutte le classi (anche Pluvio: solo per l'elenco delle stazioni con coordinate)
    for cls, var, unit, factor in CLASSES + [('Pluvio', None, None, None)]:
        try:
            snap = snapshot(cls)
        except Exception as e:
            print('WARN: classe %s non letta: %s' % (cls, e))
            continue
        per_class[cls] = snap
        count = 0
        for scode, code, name, lat, lon, moment, value in snap:
            stations.setdefault(scode, {'NOME': name, 'LAT': lat, 'LON': lon})
            if var and moment and value is not None:
                add(readings, var, scode, moment, value * factor)
                count += 1
        if debug and var:
            print('  %-6s -> %-9s istantanea: %d valori' % (cls, var, count))

    def run_series(cls, handle):
        ok = err = 0
        for scode, code, *_ in per_class.get(cls, []):
            try:
                handle(scode, code)
                ok += 1
            except Exception:
                err += 1
        if debug:
            print('  %-6s serie: %d stazioni lette, %d errori' % (cls, ok, err))

    # 2) pioggia oraria: serie di ogni pluviometro (l'unica fonte di ore sommabili)
    def rain(scode, code):
        for moment, values in series_csv(code, 'Pluvio'):
            if values and values[0] is not None:
                add(readings, 'PREC', scode, moment, values[0])
    run_series('Pluvio', rain)

    # 3) vento: velocità + raffica dalla serie (ogni 3 ore e di notte); direzione solo di notte (XML pesante)
    if wind or full:
        def wind_speed(scode, code):
            for moment, values in series_csv(code, 'Vento'):
                if len(values) > 0 and values[0] is not None:
                    add(readings, 'VVENTO', scode, moment, values[0] / 3.6)
                if len(values) > 1 and values[1] is not None:
                    add(readings, 'VVENTOMAX', scode, moment, values[1] / 3.6)
        run_series('Vento', wind_speed)
    if full:
        def wind_dir(scode, code):
            for moment, value in wind_direction_xml(code):
                add(readings, 'DVENTO', scode, moment, value)
        run_series('Vento', wind_dir)
        # 4) serie complete delle altre classi (risoluzione piena, chiude i buchi)
        for cls, var, unit, factor in CLASSES:
            if cls == 'Vento':
                continue

            def other(scode, code, cls=cls, var=var, factor=factor):
                for moment, values in series_csv(code, cls):
                    if values and values[0] is not None:
                        add(readings, var, scode, moment, values[0] * factor)
            run_series(cls, other)
    return stations, readings


def main():
    ap = argparse.ArgumentParser(description='Liguria (ARPAL OMIRL): idro + meteo, REST anonimo.')
    ap.add_argument('--full', action='store_true',
                    help='serie complete di tutte le classi (di norma nel giro delle 03)')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    now = datetime.datetime.now()                       # ora locale del Pi (cron alle :14 e :44)
    full = args.full or (now.hour == 3 and now.minute < 30)
    wind = full or (now.hour % 3 == 0 and now.minute < 30)
    print('\n=== LIGURIA (OMIRL) %s%s ===' % (
        now.strftime('%Y-%m-%d %H:%M:%S'),
        ' - serie complete' if full else (' + vento' if wind else '')))
    try:
        stations, readings = download(full=full, wind=wind, debug=args.debug)
        comune.write_parsed('LIG', stations, readings, UNITS)
    except Exception as e:
        print('[LIG] ERRORE: %s' % e)


if __name__ == '__main__':
    main()
