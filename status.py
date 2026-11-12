#!/usr/bin/env python3

# status.py - lo stato del sito per il banner "dati fermi" e per gli avvisi GitHub (watchdog*.yml):
# site/STATUS/status.json, scritto da publish.sh dopo l'export e pubblicato con i dati.
#   latest   la misura piu' recente fra tutte le regioni
#   regions  per regione: misura piu' recente, stazioni, stazioni "indietro" (ultimo dato oltre 3 ore
#            prima della piu' recente della regione)
#   backup   il backup notturno su chiavetta (backup_usb.sh), per 'Warning - backup off'
#   history  l'ultimo giro riuscito dello Storico (publish_history.sh), per 'Warning - storico off'
# Cambia solo quando i dati avanzano: non fa ripartire il push dei dati a ogni giro.
#
# Uso:   python3 status.py      (lavora nella sua cartella, il progetto)

import datetime
import glob
import json
import os
import re

BACKUP_ROOT = '/mnt/usb/backup'
HISTORY_HASH = os.path.join('.tracking', 'last_history_hash')


def build_status(site_dir, logs_dir, backup_root, history_hash):
    """{'latest', 'regions', 'backup', 'history'} dagli stations.geojson di site_dir, dal backup in
    backup_root e dal suo ultimo log in logs_dir, dall'impronta dello Storico history_hash. Un geojson
    illeggibile si salta; uno di forma sbagliata ferma lo stato (publish.sh lo dice e pubblica lo stesso)."""
    out = {'latest': '', 'regions': {}}
    for path in glob.glob(os.path.join(site_dir, '*', 'stations.geojson')):
        try:
            with open(path, encoding='utf-8') as fp:
                geojson = json.load(fp)
        except Exception:
            continue
        times = []
        for feature in geojson.get('features', []):
            moment = (feature.get('properties', {}) or {}).get('latest_time')
            if moment:
                times.append(moment)
        if not times:
            continue
        latest = max(times)
        if latest > out['latest']:
            out['latest'] = latest
        try:
            cut = (datetime.datetime.strptime(latest, '%Y-%m-%dT%H:%M')
                   - datetime.timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M')
            old = sum(1 for moment in times if moment < cut)
        except Exception:
            old = 0
        out['regions'][os.path.basename(os.path.dirname(path))] = {'latest': latest, 'n': len(times),
                                                                   'old': old}
    out['backup'] = backup_status(logs_dir, backup_root)
    out['history'] = history_status(history_hash)
    return out


def backup_status(logs_dir, backup_root):
    """L'ultima versione del backup e le etichette delle righe 'ERRORE|ATTENZIONE: <etichetta> -- <dettagli>'
    del suo ultimo log (i dettagli restano nel log). Un errore qui non ferma lo stato del resto."""
    try:
        versions = sorted(glob.glob(os.path.join(backup_root, '20??-??-??')))
        logs = sorted(glob.glob(os.path.join(logs_dir, 'backup-*.log')))
        lines = []
        if logs:
            with open(logs[-1], encoding='utf-8', errors='replace') as fp:
                lines = [line.rstrip('\n') for line in fp]
        tags = []
        for line in lines:
            match = re.search(r'(?:ERRORE|ATTENZIONE): (.*?)(?: -- |$)', line)
            if match and match.group(1)[:40] not in tags:
                tags.append(match.group(1)[:40])
        return {'last': os.path.basename(versions[-1]) if versions else '', 'warn': tags[:3],
                'info': lines[-1][:200] if lines else ''}
    except Exception as error:
        return {'last': '', 'warn': ['stato illeggibile'], 'info': str(error)[:200]}


def history_status(history_hash):
    """L'ultimo giro riuscito dello Storico: l'ora di modifica di history_hash, che publish_history.sh
    riscrive dopo il push e tocca quando lo Storico non cambia. 'AAAA-MM-GGThh:mm' in ora locale (sul
    Pi l'italiana, come latest); '' se il file manca."""
    try:
        moment = datetime.datetime.fromtimestamp(os.path.getmtime(history_hash))
    except OSError:
        return {'last': ''}
    return {'last': moment.strftime('%Y-%m-%dT%H:%M')}


def main():
    # percorsi relativi alla cartella del programma, da dovunque lo si lanci
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    out = build_status('site', 'logs', BACKUP_ROOT, HISTORY_HASH)
    if not out['latest']:
        return
    path = os.path.join('site', 'STATUS', 'status.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # temporaneo per processo: due publish sovrapposti (il cron non ha lock) non si pestano
    tmp = '%s.%d.tmp' % (path, os.getpid())
    try:
        # json.dump predefinito (", " e ": ", escape ASCII), non comune.save_json: stessi byte pubblicati
        with open(tmp, 'w', encoding='utf-8') as fp:
            json.dump(out, fp)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):                 # scrittura fallita: niente avanzi in STATUS/
            os.remove(tmp)


if __name__ == '__main__':
    main()
