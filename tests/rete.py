# Rete di sicurezza della pulizia, parte 3: export, climatologia e Storico girano su un campione dell'archivio con
# l'orologio fermo e la rete vietata (tests/orologio/sitecustomize.py); le impronte (sha1) di ogni file che producono
# stanno in tests/fixtures/rete/impronte.txt e tests/test_rete.py le confronta.
# Il campione sono gli attesi delle prove di scarico, un giro per fonte, più cinque file costruiti: tre .json.gz, uno
# vuoto, uno rotto.
# I bash (publish.sh, publish_history.sh, backup_usb.sh) girano in cartelle temporanee: GitHub è un repository nudo
# locale, gli strumenti del Pi che il Mac non ha sono i sostituti di tests/shims/ (dove curl rifiuta di partire: niente
# rete); i loro effetti stanno in tests/fixtures/rete/bash.json, con i file che deploy.sh copierebbe da un albero di
# prova.
#   python3 tests/rete.py attesi export                 riscrive impronte.txt con l'uscita dei programmi di adesso
#   python3 tests/rete.py attesi bash                   riscrive bash.json con gli effetti dei bash di adesso
#   python3 tests/rete.py uscita CARTELLA [--da COMMIT]  lascia l'uscita in CARTELLA, per un diff -r fra due commit;
#                                                       con --da i programmi sono quelli del commit
#   python3 tests/rete.py tempo                         secondi dell'export a 7 giorni, il migliore di 3 giri
# Gira solo sul Mac, con /usr/bin/python3.
import datetime, fnmatch, glob, gzip, hashlib, json, os, re, shutil, site, subprocess, sys, tempfile, time

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(PROJECT, 'tests', 'fixtures', 'scarico')
CLOCK = os.path.join(PROJECT, 'tests', 'orologio')
FINGERPRINTS = os.path.join(PROJECT, 'tests', 'fixtures', 'rete', 'impronte.txt')
EPOCH = 1793883600          # 2026-11-05 13:00 UTC, dopo l'ultimo dato del campione

# un giro per fonte; a parità di percorso vince l'ultimo
RUNS = ['laghi/normale', 'invasi/normale', 'liguria/full', 'mare/reti', 'mare/acqven', 'aria/normale', 'pc/tutte',
        'veneto/ieri', 'veneto/oggi', 'fvg/normale', 'trentino/normale', 'altoadige/normale', 'lombardia/normale',
        'emilia_romagna/normale']
# configurazione dei dati che sta nel progetto e non nell'archivio
PROJECT_DATA = ['*/zero_idrometrici.json', 'FVG/stazioni_coords.csv']
# il primo dentro la finestra di 7 giorni; gli altri fuori: li leggono l'export a 30 giorni, la climatologia e lo
# Storico. La climatologia vede solo il 28: il 27 ha 1-2 letture per stazione, meno delle 6 di un giorno valido.
GZIPPED = ['PC_PO/data-parsed/LIVIDRO/LIVIDRO-20261030.json', 'LIG/data-parsed/TEMP/TEMP-20261027.json',
           'LIG/data-parsed/TEMP/TEMP-20261028.json']
BROKEN = {'LAGHI/data-parsed/LIVLAGO/LIVLAGO-20261101.json': b'',
          'INV_ER/data-parsed/LIVLAGO/LIVLAGO-20261102.json': b'{rotto'}
PROGRAMS = ['*.py', '*.sh', 'site/index.html', 'site/radar.js', 'watchdog*.yml', 'favicon_site.ico',
            'crontab_regioni.txt']
# ingressi e non uscite: l'impronta proverebbe solo la copia, e il lavoro sull'interfaccia le cambia
PAGES = ['site/index.html', 'site/radar.js', 'site/stile.css', 'site/comune.js']
OUTPUTS = ['site', 'history_out', 'history_cache']
EXPORT = ['export_web.py', '-r', 'all', '--site-dir', 'site']
HISTORY = ['history.py', '--out', 'history_out', '--cache', 'history_cache']
COMMANDS = [EXPORT,
            EXPORT + ['--days', '30', '--series-dir', 'series30', '--series-only'],
            ['climatology.py', '-r', 'all', '--site-dir', 'site'],
            HISTORY]
USAGE = 'uso: python3 tests/rete.py attesi export | attesi bash | uscita CARTELLA [--da COMMIT] | tempo'

BASH_REGIONS = ['LAGHI', 'INV_ER', 'MAR_ER', 'MAR_FVG']   # export di un secondo; MAR_* hanno la TEMP per lo Storico
BASH_FIXTURES = os.path.join(PROJECT, 'tests', 'fixtures', 'rete')
BASH_EXPECTED = os.path.join(BASH_FIXTURES, 'bash.json')
BASH_PATH = os.path.join(PROJECT, 'tests', 'shims') + ':/usr/bin:/bin:/usr/sbin:/sbin'
REMOTE = 'git@github.com:Simulaqua/METEO.git'              # scritto in publish.sh e publish_history.sh
BARE, MOVED = 'remoto.git', 'remoto-spostato.git'          # il remoto nella cartella di prova, al suo posto o no
GITCONFIG = '[user]\n\tname = prova\n\temail = prova@localhost\n[url "%s"]\n\tinsteadOf = %s\n'
BACKUP_LOG = 'logs/backup-20261105-044000.log'
# una lettura in più (file, stazione, minuti dopo la sua ultima): LAGHI dentro la finestra dell'export; MAR_FVG
# TEMP di oggi per lo Storico, che non legge i laghi
NEW_DATA = ('LAGHI/data-parsed/LIVLAGO/LIVLAGO-20261104.json', 'Lago_d_Idro', 10)
NEW_HISTORY_DATA = ('MAR_FVG/data-parsed/TEMP/TEMP-20261105.json', 'MAMBO1', 60)
# JSON valido di forma sbagliata (una lista) in una cartella di site/ che l'export non riscrive: status.py si ferma
BAD_STATIONS = ('site/PROVA/stations.geojson', b'[]')
# le righe dei due bash di pubblicazione e gli errori di git; quelle dei programmi Python le coprono le impronte, e
# cambiano di proposito
SCRIPT_LINES = ('DATI', 'PAGINA', 'STORICO', 'ERRORE', 'ATTENZIONE', 'Fatto. Repo', 'fatal:', 'error:')
OLD_MTIME = 946684800                                      # 2000-01-01: un giro che scrive o tocca il file la cambia
BACKUP_ARCHIVE = ['VEN/data-parsed/TEMP/TEMP-2026110%d.json' % day for day in range(1, 6)]
BACKUP_OTHERS = ['site/index.html', 'logs/x.log', 'VEN/data-downloaded/x.csv', 'radar_out/x.png',
                 'history_out/VEN/x.json', 'history_cache/VEN.json', '.tracking/last_data_hash', '.history.lock',
                 '.tracking/stato.json.tmp']
ARPAV_ARCHIVE = ['live/data-parsed/TEMP/TEMP-20261101.json']
ARPAV_OTHERS = ['live/logs/x.log', 'live/data-downloaded/x.csv']
DEPLOY_TREE = ['dati_veneto.py', 'comune.py', 'publish.sh', 'crontab_regioni.txt', 'site/index.html', 'site/radar.js',
               'site/stile.css', 'site/comune.js',
               'site/VEN/stations.geojson', 'site/.git/HEAD', 'VEN/zero_idrometrici.json', 'LOM/zero_idrometrici.json',
               'PC_PO/zero_idrometrici.json', 'PIE/zero_idrometrici.json', 'PC_PIE/zero_idrometrici.json',
               'VEN/data-parsed/TEMP/x.json', 'VEN/data-downloaded/x', 'VEN/logs/x.log', 'logs/x.log',
               'PC_PO/elements_map.json', 'PC_FVG/sensors_map.json', 'FVG/stazioni_coords.csv',
               'tests/fixtures/pc/PIE/zero_idrometrici.json', '.tracking/last_data_hash', 'tracking.log',
               'radar_out/x.png', 'history_out/index.json', 'history_cache/VEN.json', '.superpowers/x', '.claude/x',
               '.DS_Store', '__pycache__/x.pyc', '.git/HEAD', 'docs/x.md', 'old/x.py']


def build_archive(dest, regions=None):
    """Il campione dell'archivio in dest; con regions solo le cartelle di quelle regioni."""
    def wanted(path):
        return regions is None or path.split(os.sep)[0] in regions

    for name in RUNS:
        expected = os.path.join(FIXTURES, name, 'attesi')
        for path in files_in(expected):
            if wanted(path):
                copy(os.path.join(expected, path), os.path.join(dest, path))
    for pattern in PROJECT_DATA:
        for source in glob.glob(os.path.join(PROJECT, pattern)):
            path = os.path.relpath(source, PROJECT)
            if wanted(path) and not os.path.exists(os.path.join(dest, path)):
                copy(source, os.path.join(dest, path))
    for path in GZIPPED:
        if wanted(path):
            compress(os.path.join(dest, path))
    for path, content in BROKEN.items():
        if wanted(path):
            write(os.path.join(dest, path), content)


def copy_programs(dest, commit=None):
    """I programmi del progetto in dest; con commit quelli del commit."""
    if commit is None:
        for pattern in PROGRAMS:
            for source in glob.glob(os.path.join(PROJECT, pattern)):
                copy(source, os.path.join(dest, os.path.relpath(source, PROJECT)))
        return
    for entry in git('ls-tree', '-r', '-z', commit).decode('utf-8').split('\0'):
        if not entry:
            continue
        info, path = entry.split('\t', 1)
        if any(matches(path, pattern) for pattern in PROGRAMS):
            target = os.path.join(dest, path)
            write(target, git('show', commit + ':' + path))
            if info.split()[0] == '100755':
                os.chmod(target, 0o755)


def run(args, cwd, epoch=EPOCH, env=None):
    """Lancia args in cwd con l'orologio fermo a epoch e la rete vietata, più le variabili di env; stdout e stderr
    nel risultato, in testo."""
    # niente GIT_* del processo di prova: dentro un hook di git (GIT_DIR, GIT_INDEX_FILE) i git dei bash
    # lavorerebbero sul repository del progetto
    full = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    # ordine degli insiemi fisso, il fuso e la locale del cron del Pi, niente __pycache__ fra i file prodotti
    full.update(PYTHONPATH=CLOCK, OROLOGIO_FERMO=str(epoch), RETE_VIETATA='1', TZ='Europe/Rome', PYTHONHASHSEED='0',
                PYTHONDONTWRITEBYTECODE='1', LC_ALL='C')
    full.update(env or {})
    # il requests del Mac sta nel sito utente di /usr/bin/python3, che Python cerca sotto HOME
    if full.get('HOME') != os.environ.get('HOME'):
        full.setdefault('PYTHONUSERBASE', site.getuserbase())
    return subprocess.run(args, cwd=cwd, env=full, capture_output=True, encoding='utf-8', errors='replace')


def fingerprints(folder, subdirs):
    """{percorso relativo a folder: sha1} dei file nelle sottocartelle subdirs, senza i file della pagina."""
    found = {}
    for subdir in subdirs:
        for path in files_in(os.path.join(folder, subdir)):
            path = os.path.join(subdir, path)
            if path not in PAGES:
                with open(os.path.join(folder, path), 'rb') as fp:
                    found[path] = hashlib.sha1(fp.read()).hexdigest()
    return found


def export_outputs(dest, commit=None):
    """Campione e programmi in dest, poi export a 7 giorni, export a 30 giorni (solo serie), climatologia e Storico
    due volte: il secondo, dalla cache, deve lasciare history_out/ com'era. Le impronte di site/, history_out/ e
    history_cache/."""
    build_archive(dest)
    copy_programs(dest, commit)
    for command in COMMANDS:
        check(run([sys.executable] + command, dest))
    first = fingerprints(dest, ['history_out'])
    check(run([sys.executable] + HISTORY, dest))
    if fingerprints(dest, ['history_out']) != first:
        raise RuntimeError('il secondo Storico, dalla cache, ha cambiato history_out/')
    return fingerprints(dest, OUTPUTS)


def check(proc):
    if proc.returncode != 0:
        raise RuntimeError('%s: codice di uscita %d\n%s' % (' '.join(proc.args), proc.returncode,
                                                            (proc.stdout + proc.stderr)[-3000:]))


def files_in(folder):
    """I percorsi relativi dei file di folder, in ordine; non i .DS_Store lasciati dal Finder."""
    found = []
    for root, _, names in os.walk(folder):
        found += [os.path.relpath(os.path.join(root, name), folder) for name in names if name != '.DS_Store']
    return sorted(found)


def matches(path, pattern):
    """path è uno dei file di pattern, come per glob: * non passa da una cartella all'altra."""
    return (os.path.dirname(path) == os.path.dirname(pattern)
            and fnmatch.fnmatchcase(os.path.basename(path), os.path.basename(pattern)))


def copy(source, target):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.copy(source, target)                     # con i permessi: i .sh si lanciano


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as fp:
        fp.write(content)


def compress(path):
    """path diventa path.gz, come i file d'archivio compressi; senza nome né data nell'intestazione, così il campione
    è lo stesso a ogni giro."""
    with open(path, 'rb') as fp:
        content = fp.read()
    with open(path + '.gz', 'wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as packed:
        packed.write(content)
    os.remove(path)


def git(*args):
    return subprocess.run(['git'] + list(args), cwd=PROJECT, stdout=subprocess.PIPE, check=True).stdout


# --- i bash ------------------------------------------------------------------------------------------------------

def bash_env(root, **extra):
    """Le variabili dei bash nella cartella di prova root, più extra: i sostituti davanti nel PATH (assoluto: gli
    script fanno cd "$BASE"), la HOME di root con il .gitconfig che manda REMOTE al repository nudo (run aggiunge il
    sito utente di Python, dove sta requests), git solo verso file locali: se il rimando mancasse, ssh e https sono
    rifiutati. Anche XDG_CONFIG_HOME punta nella HOME di prova: ereditata, farebbe leggere a git la configurazione
    vera di chi lancia le prove."""
    home = os.path.join(root, 'home')
    env = {'PATH': BASH_PATH, 'HOME': home, 'XDG_CONFIG_HOME': os.path.join(home, '.config'),
           'GIT_ALLOW_PROTOCOL': 'file', 'GIT_CONFIG_NOSYSTEM': '1'}
    env.update(extra)
    return env


def make_remote(root):
    """Il repository nudo root/remoto.git al posto di GitHub e il .gitconfig della HOME di prova che ci manda."""
    write(os.path.join(root, 'home', '.gitconfig'), (GITCONFIG % (os.path.join(root, BARE), REMOTE)).encode('utf-8'))
    check(run(['git', 'init', '-q', '--bare', os.path.join(root, BARE)], root, env=bash_env(root)))


def move_remote(root, back=False):
    """Toglie il repository nudo dal suo posto (il remoto non risponde) o, con back, ce lo rimette."""
    bare, moved = os.path.join(root, BARE), os.path.join(root, MOVED)
    if back:
        os.rename(moved, bare)
    else:
        os.rename(bare, moved)


def bash_project(root):
    """Il progetto di publish.sh e publish_history.sh in root/progetto: i programmi, il campione delle regioni di
    BASH_REGIONS, le pagine sostitute (le vere cambiano con il lavoro sull'interfaccia), un log del backup con un
    errore; e il remoto."""
    project = os.path.join(root, 'progetto')
    copy_programs(project)
    build_archive(project, BASH_REGIONS)
    for page in PAGES:
        copy(os.path.join(BASH_FIXTURES, os.path.basename(page)), os.path.join(project, page))
    write(os.path.join(project, BACKUP_LOG), b'ERRORE: x -- y\n')
    make_remote(root)
    return project


def add_reading(project, path, station, minutes):
    """Una lettura in più nel file d'archivio path: alla stazione station, minutes minuti dopo la sua ultima, con lo
    stesso valore."""
    full = os.path.join(project, path)
    with open(full, encoding='utf-8') as fp:
        data = json.load(fp)
    measures = data[station]['MISURE']
    last = datetime.datetime.strptime(measures['ISTANTE'][-1], '%Y%m%d%H%M')
    measures['ISTANTE'].append((last + datetime.timedelta(minutes=minutes)).strftime('%Y%m%d%H%M'))
    measures['VALORE'].append(measures['VALORE'][-1])
    with open(full, 'w', encoding='utf-8') as fp:
        json.dump(data, fp, ensure_ascii=False, separators=(',', ':'))


def move_last_line(source, target):
    """L'ultima riga del file source passa in testa al file target: source e target, uno dopo l'altro, restano gli
    stessi byte."""
    with open(source, 'rb') as fp:
        lines = fp.read().splitlines(keepends=True)
    with open(target, 'rb') as fp:
        rest = fp.read()
    write(source, b''.join(lines[:-1]))
    write(target, lines[-1] + rest)


def remote_git(root, *args):
    """git sul repository nudo di root, dovunque sia, con le variabili dei bash."""
    bare = os.path.join(root, MOVED)
    if not os.path.isdir(bare):
        bare = os.path.join(root, BARE)
    return run(['git', '--git-dir', bare] + list(args), root, env=bash_env(root))


def commit_of(root, ref):
    """Lo sha del commit ref nel remoto, None se non c'è."""
    return remote_git(root, 'rev-parse', '-q', '--verify', ref + '^{commit}').stdout.strip() or None


def tree_of(root, branch):
    """I file del ramo branch del remoto, [(modo, tipo, sha, percorso)] come in ls-tree -r; None se il ramo non c'è."""
    proc = remote_git(root, 'ls-tree', '-r', '-z', 'refs/heads/' + branch)
    if proc.returncode != 0:
        return None
    entries = []
    for entry in proc.stdout.split('\0'):
        if entry:
            info, path = entry.split('\t', 1)
            entries.append(tuple(info.split()) + (path,))
    return entries


def blob_sha(path):
    """Lo sha che git hash-object dà al file path, None se il file non c'è."""
    if not os.path.isfile(path):
        return None
    with open(path, 'rb') as fp:
        content = fp.read()
    return hashlib.sha1(b'blob %d\0' % len(content) + content).hexdigest()


def same_blobs(entries, folder):
    """Ogni file di entries (da tree_of) è il suo file in folder, blob per blob."""
    return all(blob_sha(os.path.join(folder, path)) == sha for _, _, sha, path in entries)


def joined_sha1(folder, wanted):
    """L'impronta che i bash fanno con find | sort | xargs cat | sha1sum: i file di folder scelti da wanted (sul
    percorso relativo), in ordine, uno dopo l'altro."""
    sha = hashlib.sha1()
    for path in files_in(folder):
        if wanted(path):
            with open(os.path.join(folder, path), 'rb') as fp:
                sha.update(fp.read())
    return sha.hexdigest()


def is_data(path):
    """Un file dei dati di publish.sh: in una cartella di site/, fuori da .git (find -mindepth 2 -not -path)."""
    return '/' in path and '/.git/' not in '/' + path


def is_history(path):
    """Un file dello Storico di publish_history.sh: un .json che non è index.json."""
    return path.endswith('.json') and os.path.basename(path) != 'index.json'


def read_text(path):
    """Il testo del file path senza gli a capo finali, None se il file non c'è."""
    if not os.path.isfile(path):
        return None
    with open(path, encoding='utf-8') as fp:
        return fp.read().rstrip('\n')


def read_json(path):
    """Il JSON del file path, None se il file non c'è."""
    if not os.path.isfile(path):
        return None
    with open(path, encoding='utf-8') as fp:
        return json.load(fp)


def anonymize(text, root):
    """I percorsi della cartella di prova root diventano <tmp>: prima quello vero (/private/var/…, di Python e
    getcwd), poi quello logico (/var/…, di mkdtemp, della pwd di bash e del .gitconfig)."""
    return text.replace(os.path.realpath(root), '<tmp>').replace(root, '<tmp>')


def script_lines(proc, root):
    """Le righe di publish.sh o publish_history.sh, prima stdout e poi stderr, con i percorsi come <tmp> e i byte
    inviati come N."""
    return [re.sub(r'inviati [^)]*', 'inviati N', anonymize(line, root))
            for line in proc.stdout.splitlines() + proc.stderr.splitlines() if line.startswith(SCRIPT_LINES)]


def delta_names(project):
    """{percorso: nome in .delta/} dalla mappa di publish.sh (site/.git/delta-map), None se non c'è."""
    text = read_text(os.path.join(project, 'site', '.git', 'delta-map'))
    if text is None:
        return None
    return dict(line.split('\t', 1) for line in text.split('\n') if line)


def inc_state(root, before):
    """data-inc dopo il giro: assente, invariato, o nuovo con genitore il data che il remoto aveva prima (before)."""
    inc = commit_of(root, 'refs/heads/data-inc')
    if inc is None:
        return 'assente'
    if inc == before['data-inc']:
        return 'invariato'
    if commit_of(root, inc + '^1') == before['data']:
        return 'genitore = data di prima'
    return 'genitore = altro'


def publish_run(root, name, **extra):
    """Un giro di publish.sh nel progetto di root, con le variabili extra, e i suoi effetti."""
    project = os.path.join(root, 'progetto')
    site_dir = os.path.join(project, 'site')
    tracking = os.path.join(project, '.tracking')
    before = {ref: commit_of(root, 'refs/heads/' + ref) for ref in ('data', 'data-inc')}
    proc = run([os.path.join(project, 'publish.sh')], project, env=bash_env(root, **extra))
    data = tree_of(root, 'data')
    pages = tree_of(root, 'gh-pages')
    saved = read_text(os.path.join(tracking, 'last_data_hash'))
    effects = {'giro': name, 'codice': proc.returncode, 'righe': script_lines(proc, root), 'data': None,
               'delta': delta_names(project), 'uguale_al_sito': None, 'data_inc': inc_state(root, before),
               'pagina': None if pages is None else ['%s %s %s\t%s' % entry for entry in pages],
               'tracking': {'last_page_hash': read_text(os.path.join(tracking, 'last_page_hash')),
                            'last_data_hash': None if saved is None else saved == joined_sha1(site_dir, is_data),
                            'data_push_fails': read_text(os.path.join(tracking, 'data_push_fails'))},
               'repo_dati': os.path.isdir(os.path.join(site_dir, '.git')),
               'status': read_json(os.path.join(site_dir, 'STATUS', 'status.json'))}
    if data is not None:
        files = [entry for entry in data if not entry[3].startswith('.delta/')]
        # .delta/ sono gli stessi blob con altri nomi
        delta = sorted(entry[2] for entry in data if entry[3].startswith('.delta/'))
        effects['data'] = [entry[3] for entry in files]
        effects['uguale_al_sito'] = same_blobs(files, site_dir) and delta == sorted(entry[2] for entry in files)
    return effects


def publish_scenarios():
    """I giri di publish.sh, in fila sullo stesso progetto: primo; invariato; dato nuovo (data-inc); pagina cambiata;
    stile cambiato (solo un file che index.html carica); un file della pagina mancante; testo spostato da un file
    della pagina al successivo; un file locale citato in una forma che publish.sh non pubblica; lock occupato; tre con
    il remoto che non risponde (al terzo si rifà il repository dei dati); remoto di nuovo al suo posto (push
    completo); status.py che si ferma."""
    with tempfile.TemporaryDirectory() as root:
        project = bash_project(root)
        runs = [publish_run(root, 'primo giro'), publish_run(root, 'invariato')]
        add_reading(project, *NEW_DATA)
        runs.append(publish_run(root, 'dato nuovo'))
        with open(os.path.join(project, 'site', 'index.html'), 'a', encoding='utf-8') as fp:
            fp.write('<!-- pagina cambiata -->\n')
        runs.append(publish_run(root, 'pagina cambiata'))
        with open(os.path.join(project, 'site', 'stile.css'), 'a', encoding='utf-8') as fp:
            fp.write('/* stile cambiato */\n')
        runs.append(publish_run(root, 'stile cambiato'))
        # senza un file che index.html carica publish.sh si ferma prima della pagina e gh-pages resta com'era; il
        # file torna, uguale, prima del giro dopo
        missing = os.path.join(project, 'site', 'comune.js')
        os.remove(missing)
        runs.append(publish_run(root, 'file della pagina mancante'))
        copy(os.path.join(BASH_FIXTURES, 'comune.js'), missing)
        # l'ultima riga di stile.css passa in testa a radar.js, il file che la pagina carica dopo: i due file di
        # seguito sono gli stessi byte, ma sono cambiati tutti e due e la pagina si ripubblica
        move_last_line(os.path.join(project, 'site', 'stile.css'), os.path.join(project, 'site', 'radar.js'))
        runs.append(publish_run(root, 'testo spostato fra due file'))
        # un file citato in un'altra forma (./extra.js) publish.sh non lo pubblica, anche se c'è in site/: si ferma
        # prima del push, gh-pages e last_page_hash restano com'erano; poi la pagina torna com'era
        index, extra = os.path.join(project, 'site', 'index.html'), os.path.join(project, 'site', 'extra.js')
        with open(index, 'rb') as fp:
            page = fp.read()
        write(extra, b'// extra.js, citato come ./extra.js\n')
        write(index, page + b'<script src="./extra.js"></script>\n')
        runs.append(publish_run(root, 'riferimento locale non pubblicato'))
        write(index, page)
        os.remove(extra)
        add_reading(project, *NEW_DATA)
        runs.append(publish_run(root, 'lock occupato', FLOCK_EXIT='1'))
        move_remote(root)
        for n in (1, 2, 3):
            add_reading(project, *NEW_DATA)
            runs.append(publish_run(root, 'remoto spostato %d' % n))
        move_remote(root, back=True)
        runs.append(publish_run(root, 'remoto rimesso'))
        # con status.py fermo publish.sh lo dice e pubblica lo stesso dati e pagina, cambiati tutti e due; status.json
        # resta quello di prima: LAGHI senza la lettura nuova
        write(os.path.join(project, BAD_STATIONS[0]), BAD_STATIONS[1])
        add_reading(project, *NEW_DATA)
        with open(os.path.join(project, 'site', 'index.html'), 'a', encoding='utf-8') as fp:
            fp.write('<!-- pagina cambiata ancora -->\n')
        runs.append(publish_run(root, 'status.py fermo'))
        return runs


def history_run(root, name):
    """Un giro di publish_history.sh nel progetto di root e i suoi effetti."""
    project = os.path.join(root, 'progetto')
    out = os.path.join(project, 'history_out')
    saved = os.path.join(project, '.tracking', 'last_history_hash')
    if os.path.exists(saved):
        os.utime(saved, (OLD_MTIME, OLD_MTIME))
    proc = run([os.path.join(project, 'publish_history.sh')], project, env=bash_env(root))
    tree = tree_of(root, 'history')
    return {'giro': name, 'codice': proc.returncode, 'righe': script_lines(proc, root),
            'history': None if tree is None else [entry[3] for entry in tree],
            'uguale_all_uscita': None if tree is None else same_blobs(tree, out),
            'hash_salvato': read_text(saved) == joined_sha1(out, is_history),
            'hash_aggiornato': os.path.exists(saved) and os.path.getmtime(saved) != OLD_MTIME,
            'git_rimasto': os.path.isdir(os.path.join(out, '.git'))}


def publish_history_scenarios():
    """I giri di publish_history.sh, in fila sullo stesso progetto: primo; invariato; dato nuovo con il remoto che non
    risponde; remoto di nuovo al suo posto."""
    with tempfile.TemporaryDirectory() as root:
        project = bash_project(root)
        runs = [history_run(root, 'primo giro'), history_run(root, 'invariato')]
        add_reading(project, *NEW_HISTORY_DATA)
        move_remote(root)
        runs.append(history_run(root, 'dato nuovo, remoto spostato'))
        move_remote(root, back=True)
        runs.append(history_run(root, 'remoto rimesso'))
        return runs


def backup_lines(proc, root):
    """Le righe di backup_usb.sh, prima stdout e poi stderr, senza data e ora in testa, con secondi e MB come N e i
    percorsi come <tmp>."""
    lines = []
    for line in proc.stdout.splitlines() + proc.stderr.splitlines():
        line = re.sub(r'^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d ', '', anonymize(line, root))
        line = re.sub(r'fatto in \d+s', 'fatto in Ns', line)
        lines.append(re.sub(r'[\d.]+ MB nuovi', 'N MB nuovi', line))
    return lines


def backup_versions(dest):
    """{versione: {'file': [...], 'condivisi': [...]}} delle versioni in dest: i file e quelli che sono lo stesso
    file (stesso inode) della versione prima."""
    versions = {}
    previous = None
    for name in sorted(os.listdir(dest)):
        if not re.fullmatch(r'\d{4}-\d\d-\d\d', name):
            continue
        folder = os.path.join(dest, name)
        files = files_in(folder)
        shared = [path for path in files if previous and os.path.isfile(os.path.join(previous, path))
                  and os.path.samefile(os.path.join(previous, path), os.path.join(folder, path))]
        versions[name] = {'file': files, 'condivisi': shared}
        previous = folder
    return versions


def backup_run(root, name, **extra):
    """Un giro di backup_usb.sh con chiavetta, sorgenti e versioni in root, più le variabili extra, e i suoi
    effetti."""
    project = os.path.join(root, 'progetto')
    dest = os.path.join(root, 'usb', 'backup')
    env = bash_env(root, BACKUP_MNT=os.path.join(root, 'usb'), BACKUP_DEST=dest,
                   BACKUP_METEO=os.path.join(root, 'meteo'), BACKUP_ARPAV=os.path.join(root, 'arpav'),
                   BACKUP_KEEP='30')
    env.update(extra)
    proc = run([os.path.join(project, 'backup_usb.sh')], project, env=env)
    stop = read_text(os.path.join(dest, '.rotazione-ferma'))
    return {'giro': name, 'codice': proc.returncode, 'righe': backup_lines(proc, root),
            'versioni': backup_versions(dest), 'stop': None if stop is None else stop.split('\n')}


def backup_scenarios():
    """I giri di backup_usb.sh, in fila: versione nuova (l'archivio collegato alla versione precedente); di nuovo lo
    stesso giorno; con KEEP=2 il giorno dopo (rotazione); due file d'archivio in meno (rotazione ferma); chiavetta
    assente; data non valida. C'è sempre una versione precedente: con set -u la bash 3.2 del Mac non regge l'array
    vuoto del primo backup in assoluto."""
    with tempfile.TemporaryDirectory() as root:
        copy_programs(os.path.join(root, 'progetto'))
        sources = [('METEO', 'meteo', BACKUP_ARCHIVE, BACKUP_OTHERS), ('arpav', 'arpav', ARPAV_ARCHIVE, ARPAV_OTHERS)]
        for name, folder, archive, others in sources:
            for path in archive + others:
                write(os.path.join(root, folder, path), path.encode('utf-8'))
            # nella versione precedente l'archivio ha la stessa ora di modifica: rsync lo collega
            for path in archive:
                target = os.path.join(root, 'usb', 'backup', '2026-11-01', name, path)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                shutil.copy2(os.path.join(root, folder, path), target)
        runs = [backup_run(root, 'versione nuova', BACKUP_DAY='2026-11-02'),
                backup_run(root, 'stesso giorno', BACKUP_DAY='2026-11-02'),
                backup_run(root, 'rotazione', BACKUP_DAY='2026-11-03', BACKUP_KEEP='2')]
        for path in BACKUP_ARCHIVE[:2]:
            os.remove(os.path.join(root, 'meteo', path))
        runs += [backup_run(root, 'archivio sceso', BACKUP_DAY='2026-11-04', BACKUP_KEEP='2'),
                 backup_run(root, 'chiavetta assente', BACKUP_DAY='2026-11-05', MOUNTPOINT_EXIT='1'),
                 backup_run(root, 'data non valida', BACKUP_DAY='1970-01-01')]
        return runs


def deploy_list():
    """I file che deploy.sh copierebbe sul Pi da un albero di prova (DEPLOY_TREE): rsync -an in locale, verso una
    cartella vuota, con le esclusioni di deploy_exclude.txt se c'è, altrimenti con quelle scritte in deploy.sh."""
    listed = os.path.join(PROJECT, 'deploy_exclude.txt')
    if os.path.exists(listed):
        excludes = ['--exclude-from=' + listed]
    else:
        with open(os.path.join(PROJECT, 'deploy.sh'), encoding='utf-8') as fp:
            excludes = ['--exclude=' + pattern for pattern in re.findall(r"--exclude '([^']*)'", fp.read())]
    with tempfile.TemporaryDirectory() as root:
        tree, target = os.path.join(root, 'albero'), os.path.join(root, 'pi')
        for path in DEPLOY_TREE:
            write(os.path.join(tree, path), b'x\n')
        os.makedirs(target)
        proc = run(['rsync', '-an', '--out-format=%n'] + excludes + [tree + '/', target + '/'], root,
                   env={'PATH': BASH_PATH})
        check(proc)
    return sorted(line for line in proc.stdout.splitlines() if not line.endswith('/'))


# ---------------------------------------------------------------------------------------------------------------

def save_fingerprints():
    with tempfile.TemporaryDirectory() as dest:
        found = export_outputs(dest)
    os.makedirs(os.path.dirname(FINGERPRINTS), exist_ok=True)
    with open(FINGERPRINTS, 'w', encoding='utf-8') as fp:
        fp.writelines('%s  %s\n' % (found[path], path) for path in sorted(found))
    print('%d impronte in %s' % (len(found), FINGERPRINTS))


def save_bash():
    found = {'publish': publish_scenarios(), 'publish_history': publish_history_scenarios(),
             'backup': backup_scenarios(), 'deploy': deploy_list()}
    with open(BASH_EXPECTED, 'w', encoding='utf-8') as fp:
        json.dump(found, fp, ensure_ascii=False, indent=1, sort_keys=True)
        fp.write('\n')
    print('effetti dei bash in %s' % BASH_EXPECTED)


def save_output(target, commit=None):
    if os.path.isdir(target) and os.listdir(target):
        sys.exit('uscita non salvata: %s non è vuota' % target)
    with tempfile.TemporaryDirectory() as dest:
        found = export_outputs(dest, commit)
        for path in found:
            copy(os.path.join(dest, path), os.path.join(target, path))
    print('%d file in %s' % (len(found), target))


def print_time():
    seconds = []
    for _ in range(3):
        with tempfile.TemporaryDirectory() as dest:
            build_archive(dest)
            copy_programs(dest)
            start = time.perf_counter()
            check(run([sys.executable] + EXPORT, dest))
            seconds.append(time.perf_counter() - start)
    print('export a 7 giorni: %.1f s (giri: %s)' % (min(seconds), ', '.join('%.1f' % s for s in seconds)))


def main(argv):
    command = argv[1:]
    if command == ['attesi', 'export']:
        save_fingerprints()
    elif command == ['attesi', 'bash']:
        save_bash()
    elif command[:1] == ['uscita'] and len(command) == 2:
        save_output(command[1])
    elif command[:1] == ['uscita'] and len(command) == 4 and command[2] == '--da':
        save_output(command[1], command[3])
    elif command == ['tempo']:
        print_time()
    else:
        sys.exit(USAGE)


if __name__ == '__main__':
    main(sys.argv)
