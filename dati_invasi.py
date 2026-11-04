#!/usr/bin/env python3
# dati_invasi.py - invasi artificiali (dighe) con API pubblica anonima, ognuno come una regione a sé (codice INV_<sigla>).
#   INV_ER = Romagna Acque - Società delle Fonti (Forlì-Cesena / Rimini). Endpoint JSON anonimo del widget
#     "acqua in diretta" (trovato ispezionando la pagina /acqua-in-diretta/, 2026-08):
#     GET https://www.romagnacque.it/datidiretta/index2.php
#     -> diga di RIDRACOLI: livelloInvaso, volumeInvaso, apporto, deflusso, temperaturaAcqua, con il timestamp
#        direttaDt+direttaOra in ora civile italiana (aggiornamento ogni 30-60 min)
#     -> traversa del CONCA (concaDati): livello, volume, apporto, portataus, senza timestamp proprio: usa quello generale
# Livelli in m (Ridracoli = quota assoluta s.l.m.), volumi in Mm³ (milioni di m³). Coordinate fisse, sulle dighe.
# Una lettura per giro: il merge per istante evita i doppioni.
# Uso: python3 dati_invasi.py [-r ER|all] [--debug]
import argparse
import datetime

import comune

DATA_URL = 'https://www.romagnacque.it/datidiretta/index2.php'


def download(debug=False):
    """Stazioni, letture (variabile -> {sigla -> [(istante, valore), ...]}) e unità di misura."""
    d = comune.get_json(DATA_URL)
    try:
        dt = datetime.datetime.strptime(str(d.get('direttaDt')) + ' ' + str(d.get('direttaOra')),
                                        '%d/%m/%Y %H:%M')
    except (ValueError, TypeError):
        raise RuntimeError('timestamp direttaDt/direttaOra assente o illeggibile')
    moment = comune.civil_to_solar(dt)
    stations, readings, units = {}, {}, {}

    def put(code, var, unit, value):
        value = comune.to_float(value)
        if value is None:
            return
        readings.setdefault(var, {}).setdefault(code, []).append((moment, round(value, 3)))
        units[var] = unit

    # Diga di Ridracoli (Bagno di Romagna, FC) - livello = quota assoluta s.l.m.
    stations['RIDRACOLI'] = {'NOME': 'Diga di Ridracoli', 'LAT': 43.9711, 'LON': 11.8261}
    put('RIDRACOLI', 'LIVLAGO', 'm', d.get('livelloInvaso'))
    volume = comune.to_float(d.get('volumeInvaso'))
    put('RIDRACOLI', 'VOLINVASO', 'Mm³', volume / 1e6 if volume is not None else None)
    put('RIDRACOLI', 'AFFLUSSO', 'm³/s', d.get('apporto'))
    put('RIDRACOLI', 'DEFLUSSO', 'm³/s', d.get('deflusso'))
    put('RIDRACOLI', 'TEMPACQUA', '°C', d.get('temperaturaAcqua'))
    # Traversa del Conca (San Giovanni in Marignano / Misano, RN) - coordinate approssimative
    conca = d.get('concaDati') or {}
    if conca:
        stations['CONCA'] = {'NOME': 'Invaso del Conca', 'LAT': 43.9400, 'LON': 12.6720}
        put('CONCA', 'LIVLAGO', 'm', conca.get('livello'))
        volume = comune.to_float(conca.get('volume'))
        put('CONCA', 'VOLINVASO', 'Mm³', volume / 1e6 if volume is not None else None)
        put('CONCA', 'AFFLUSSO', 'm³/s', conca.get('apporto'))
        put('CONCA', 'DEFLUSSO', 'm³/s', conca.get('portataus'))
    with_data = {code for per_station in readings.values() for code in per_station}
    stations = {code: meta for code, meta in stations.items() if code in with_data}
    if debug:
        for var, per_station in sorted(readings.items()):
            for code, points in per_station.items():
                print('  %-10s %-9s %s' % (code, var, points[-1]))
    return stations, readings, units


SOURCES = {'ER': ('INV_ER', download)}


def main():
    ap = argparse.ArgumentParser(description='Invasi artificiali (dighe) con API pubblica anonima.')
    ap.add_argument('-r', '--region', default='all', help='ER/all')
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    print('\n=== INVASI (Romagna Acque) %s ===' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    regions = list(SOURCES) if args.region.lower() == 'all' else [args.region.upper()]
    for reg in regions:
        if reg not in SOURCES:
            print('Gestore invasi non disponibile: ' + reg)
            continue
        code, fetch = SOURCES[reg]
        try:
            stations, readings, units = fetch(debug=args.debug)
            comune.write_parsed(code, stations, readings, units)
        except Exception as e:
            print('[%s] ERRORE: %s' % (reg, e))


if __name__ == '__main__':
    main()
