# Rete di sicurezza della pulizia, parte 3: export, climatologia e Storico girano su un campione dell'archivio con
# l'orologio fermo e la rete vietata (tests/orologio/sitecustomize.py); le impronte (sha1) di ogni file che producono
# stanno in tests/fixtures/rete/impronte.txt e tests/test_rete.py le confronta.
# Il campione sono gli attesi delle prove di scarico, un giro per fonte, più quattro file costruiti: due .json.gz, uno
# vuoto, uno rotto.
#   python3 tests/rete.py attesi export                 riscrive impronte.txt con l'uscita dei programmi di adesso
#   python3 tests/rete.py uscita CARTELLA [--da COMMIT]  lascia l'uscita in CARTELLA, per un diff -r fra due commit;
#                                                       con --da i programmi sono quelli del commit
#   python3 tests/rete.py tempo                         secondi dell'export a 7 giorni, il migliore di 3 giri
# Gira solo sul Mac, con /usr/bin/python3.
import fnmatch, glob, gzip, hashlib, os, shutil, site, subprocess, sys, tempfile, time

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
# il primo dentro la finestra di 7 giorni; il secondo lo leggono l'export a 30 giorni, la climatologia e lo Storico,
# ma nella climatologia non si vede (1-2 letture per stazione, meno delle 6 di un giorno valido)
GZIPPED =['PC_PO/data-parsed/LIVIDRO/LIVIDRO-20261030.json', 'LIG/data-parsed/TEMP/TEMP-20261027.json']
BROKEN = {'LAGHI/data-parsed/LIVLAGO/LIVLAGO-20261101.json': b'',
          'INV_ER/data-parsed/LIVLAGO/LIVLAGO-20261102.json': b'{rotto'}
PROGRAMS = ['*.py', '*.sh', 'site/index.html', 'site/radar.js', 'watchdog*.yml', 'favicon_site.ico',
            'crontab_regioni.txt']
# ingressi e non uscite: l'impronta proverebbe solo la copia, e il lavoro sull'interfaccia le cambia
PAGES = ['site/index.html', 'site/radar.js']
OUTPUTS = ['site', 'history_out', 'history_cache']
EXPORT = ['export_web.py', '-r', 'all', '--site-dir', 'site']
HISTORY = ['history.py', '--out', 'history_out', '--cache', 'history_cache']
COMMANDS = [EXPORT,
            EXPORT + ['--days', '30', '--series-dir', 'series30', '--series-only'],
            ['climatology.py', '-r', 'all', '--site-dir', 'site'],
            HISTORY]
USAGE = 'uso: python3 tests/rete.py attesi export | uscita CARTELLA [--da COMMIT] | tempo'


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
    # ordine degli insiemi fisso, il fuso e la locale del cron del Pi, niente __pycache__ fra i file prodotti
    full = dict(os.environ, PYTHONPATH=CLOCK, OROLOGIO_FERMO=str(epoch), RETE_VIETATA='1', TZ='Europe/Rome',
                PYTHONHASHSEED='0', PYTHONDONTWRITEBYTECODE='1', LC_ALL='C')
    full.update(env or {})
    # il requests del Mac sta nel sito utente di /usr/bin/python3, che Python cerca sotto HOME
    if full.get('HOME') != os.environ.get('HOME'):
        full.setdefault('PYTHONUSERBASE', site.getuserbase())
    return subprocess.run(args, cwd=cwd, env=full, capture_output=True, encoding='utf-8', errors='replace')


def fingerprints(folder, subdirs):
    """{percorso relativo a folder: sha1} dei file nelle sottocartelle subdirs, senza le due pagine."""
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


# ---------------------------------------------------------------------------------------------------------------

def save_fingerprints():
    with tempfile.TemporaryDirectory() as dest:
        found = export_outputs(dest)
    os.makedirs(os.path.dirname(FINGERPRINTS), exist_ok=True)
    with open(FINGERPRINTS, 'w', encoding='utf-8') as fp:
        fp.writelines('%s  %s\n' % (found[path], path) for path in sorted(found))
    print('%d impronte in %s' % (len(found), FINGERPRINTS))


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
