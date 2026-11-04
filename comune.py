"""Attrezzi condivisi dagli script di scarico (Python 3.7 sul Pi, requests vecchia: niente API recenti)."""
import datetime
import json
import os
import time

import requests

BASE = os.path.dirname(os.path.abspath(__file__))
USER_AGENT = 'Mozilla/5.0 (compatible; meteo.simulaqua.it)'


def region_dir(code):
    return os.path.join(BASE, code)


# ---------------------------------------------------------------------------------------------------------
# File JSON

def load_json(path):
    """Un file mancante, vuoto o troncato (scrittura interrotta, disco pieno) non deve fermare lo script:
    si riparte da {} con un avviso nel log."""
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding='utf-8') as fp:
            text = fp.read()
        if not text.strip():
            print('WARN: file JSON vuoto, ignorato: ' + path)
            return {}
        return json.loads(text)
    except (ValueError, OSError) as error:
        print('WARN: file JSON illeggibile (' + str(error) + '), ignorato: ' + path)
        return {}


def save_json(data, path, sort_keys=False):
    """Scrittura atomica: su .tmp, fsync, poi rename; un kill a metà non lascia mai un .json monco."""
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fp:
        json.dump(data, fp, ensure_ascii=False, separators=(',', ':'), sort_keys=sort_keys)
        fp.flush()
        os.fsync(fp.fileno())
    os.replace(tmp, path)


# ---------------------------------------------------------------------------------------------------------
# Rete

def get(url, params=None, headers=None, timeout=60, verify=True):
    """GET che non solleva per lo stato HTTP. Su errore di connessione (rete caduta, connessione rifiutata o
    chiusa) riprova una volta dopo 5 secondi. Dopo un timeout NON riprova: una fonte ferma verrebbe
    interrogata due volte e il giro durerebbe il doppio. ConnectTimeout è anche ConnectionError: conta come
    timeout, quindi niente secondo tentativo."""
    if headers is None:
        headers = {'User-Agent': USER_AGENT}
    for attempt in (1, 2):
        try:
            return requests.get(url, params=params, headers=headers, timeout=timeout, verify=verify)
        except requests.ConnectionError as error:
            if attempt == 2 or isinstance(error, requests.Timeout):
                raise
            time.sleep(5)


def get_text(url, params=None, headers=None, timeout=60, verify=True):
    r = get(url, params=params, headers=headers, timeout=timeout, verify=verify)
    r.raise_for_status()
    return r.content.decode('utf-8', 'replace')


def get_json(url, params=None, headers=None, timeout=60, verify=True):
    return json.loads(get_text(url, params=params, headers=headers, timeout=timeout, verify=verify))


# ---------------------------------------------------------------------------------------------------------
# Tempo: i file dati usano l'ora solare (UTC+1 tutto l'anno)

def now_solar():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=1)


def is_dst_civil(dt):
    """Ora civile in ingresso: legale dalle 02:00 dell'ultima domenica di marzo alle 03:00 dell'ultima di ottobre."""
    y = dt.year
    last_sunday = lambda month: 31 - ((datetime.date(y, month, 31).weekday() + 1) % 7)
    return datetime.datetime(y, 3, last_sunday(3), 2) <= dt < datetime.datetime(y, 10, last_sunday(10), 3)


def civil_to_solar(dt):
    if is_dst_civil(dt):
        dt = dt - datetime.timedelta(hours=1)
    return dt.strftime('%Y%m%d%H%M')


def to_float(v):
    try:
        f = float(v)
        return None if f != f else f
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------------------------------------
def write_parsed(region_code, stations, readings, units, days=8):
    """Fonde le letture nei file giornalieri <regione>/data-parsed/<VAR>/<VAR>-<AAAAMMGG>.json, ordinate e
    senza doppioni per istante. Le letture più vecchie di `days` giorni si scartano (days=None: si tengono)."""
    parse_dir = os.path.join(BASE, region_code, 'data-parsed')
    stazioni_path = os.path.join(parse_dir, 'stazioni.json')
    station_list = load_json(stazioni_path)
    for sc, meta in stations.items():
        station_list[sc] = {'SCODE': sc, 'NOME': meta.get('NOME'),
                            'LAT': meta.get('LAT'), 'LON': meta.get('LON')}
    floor = None
    if days is not None:
        floor = (now_solar() - datetime.timedelta(days=days)).strftime('%Y%m%d%H%M')
    added = 0
    for var, per_scode in readings.items():
        by_day = {}
        for sc, pts in per_scode.items():
            for ist, val in pts:
                if val is None or (floor is not None and ist < floor):
                    continue
                by_day.setdefault(ist[:8], {}).setdefault(sc, []).append((ist, val))
        for day, per in by_day.items():
            fn = os.path.join(parse_dir, var, var + '-' + day + '.json')
            bin_day = load_json(fn)
            for sc, pts in per.items():
                rec = bin_day.get(sc)
                if rec is None:
                    rec = {'STAZIONE': station_list.get(sc, {'SCODE': sc}),
                           'UM': units.get(var), 'MISURE': {'ISTANTE': [], 'VALORE': []}}
                    bin_day[sc] = rec
                m = rec['MISURE']
                merged = dict(zip(m['ISTANTE'], m['VALORE']))
                before = len(merged)
                for ist, val in pts:
                    if ist not in merged:
                        merged[ist] = val
                keys = sorted(merged.keys())
                m['ISTANTE'] = keys
                m['VALORE'] = [merged[k] for k in keys]
                added += len(merged) - before
            save_json(bin_day, fn)
    save_json(station_list, stazioni_path)
    print('[%s] stazioni: %d | nuove letture inserite: %d' % (region_code, len(stations), added))
    return added


# ---------------------------------------------------------------------------------------------------------
# File grezzi dei regionali: nomi AAAAMMGG-HHMMSS-<resto>

def latest_stamp(download_dir, subdirs):
    """L'ultimo AAAAMMGG-HHMMSS fra i file già scaricati, None se non c'è niente."""
    stamps = []
    for subdir in subdirs:
        current_dir = os.path.join(download_dir, subdir)
        if not os.path.isdir(current_dir):
            continue
        for name in os.listdir(current_dir):
            parts = name.split('-')
            if len(parts) >= 2:
                stamps.append(parts[0] + '-' + parts[1])
    return max(stamps) if stamps else None


def delete_downloaded(download_dir, subdirs, stamp, stale_min=None, debug=False):
    """Toglie i file grezzi del lotto `stamp`, da chiamare solo dopo un parse riuscito. Con `stale_min`
    toglie anche gli orfani: file più vecchi di tanti minuti lasciati da un giro ucciso prima della pulizia."""
    stale_cutoff = None if stale_min is None else time.time() - stale_min * 60
    removed = stale = 0
    prefix = stamp + '-'
    for subdir in subdirs:
        current_dir = os.path.join(download_dir, subdir)
        if not os.path.isdir(current_dir):
            continue
        for name in os.listdir(current_dir):
            full = os.path.join(current_dir, name)
            is_batch = name.startswith(prefix)
            is_stale = False
            if stale_cutoff is not None and not is_batch:
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
                    if debug:
                        print('could not remove ' + name + ': ' + str(error))
    if stale_min is None:
        print('Raw downloaded files removed: ' + str(removed))
    else:
        print('Raw downloaded files removed: ' + str(removed) + ' (of which stale orphans: ' + str(stale) + ')')
    return removed
