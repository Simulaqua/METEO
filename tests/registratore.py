# Registratore delle risposte delle fonti: la rete di sicurezza della pulizia degli script di scarico.
# Lo script di scarico gira in una copia del progetto in una cartella temporanea (i suoi dati non toccano il progetto)
# e ogni sua richiesta HTTP passa di qui:
#   registra  lo script gira dal vivo: l'ora di partenza va in CARTELLA_GIRO/ora.json, ogni risposta in
#             CARTELLA_GIRO/risposte/; i file che scrive si buttano
#   attesi    lo script gira due volte di fila sulle risposte registrate, senza rete, in una copia nuova; i file che
#             scrive o cambia vanno in CARTELLA_GIRO/attesi/, i codici di uscita dei due giri in codici.json e le
#             cartelle che lasciano in cartelle.json (git non tiene le cartelle vuote)
# In ogni giro l'orologio parte da ora.json e avanza solo con time.sleep, che aspetta davvero solo dal vivo.
#   python3 tests/registratore.py registra tests/fixtures/scarico/laghi/normale -- dati_laghi.py
#   python3 tests/registratore.py attesi tests/fixtures/scarico/laghi/normale -- dati_laghi.py
# Gira solo sul Mac. Per le prove: record(), replay(), replay_twice() (quello che fa "attesi"), copy_project(), tree().
import base64, glob, gzip, hashlib, itertools, json, os, shutil, subprocess, sys, tempfile, time, urllib.parse

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# ciò che serve a uno script di scarico per girare: gli script e la configurazione dei dati, niente dati
PROJECT_FILES = ['comune.py', 'dati_*.py', '*/zero_idrometrici.json', 'FVG/stazioni_coords.csv']
MISSING = 'risposta non registrata'
MISSING_EXIT = 3        # codice di uscita di un giro in cui è mancata una risposta


# ---------------------------------------------------------------------------------------------------------------
# Nel processo che lancia i giri

def copy_project(dest):
    """Copia in dest gli script di scarico e la configurazione dei dati (quelli che ci sono)."""
    for pattern in PROJECT_FILES:
        for source in glob.glob(os.path.join(PROJECT, pattern)):
            target = os.path.join(dest, os.path.relpath(source, PROJECT))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copyfile(source, target)


def tree(folder):
    """I file di folder, percorso relativo -> contenuto, tranne gli script .py."""
    files = {}
    for root, _, names in os.walk(folder):
        for name in names:
            if not name.endswith('.py'):
                path = os.path.join(root, name)
                with open(path, 'rb') as fp:
                    files[os.path.relpath(path, folder)] = fp.read()
    return files


def record(run_dir, script, args, project):
    """Un giro dal vivo nella cartella project; l'uscita dello script si vede mentre gira."""
    answers = os.path.join(run_dir, 'risposte')
    if os.path.isdir(answers):                 # una registrazione nuova non si mescola con la vecchia
        shutil.rmtree(answers)
    os.makedirs(answers)
    with open(os.path.join(run_dir, 'ora.json'), 'w', encoding='utf-8') as fp:
        json.dump({'epoch': time.time()}, fp)
    return run('registra', run_dir, script, args, project, capture=False)


def replay(run_dir, script, args, project):
    """Un giro in riproduzione nella cartella project, senza rete; stdout e stderr nel risultato."""
    return run('riproduci', run_dir, script, args, project, capture=True)


def replay_twice(run_dir, script, args):
    """Due giri di fila in riproduzione in una copia nuova del progetto: i file scritti o cambiati, i due giri e le
    cartelle lasciate dai giri."""
    with tempfile.TemporaryDirectory() as project:
        copy_project(project)
        before = tree(project)
        runs = [replay(run_dir, script, args, project) for _ in range(2)]
        after = tree(project)
        files = {name: content for name, content in after.items() if before.get(name) != content}
        return files, runs, folders(project, files)


def folders(project, files):
    """Le cartelle dei file scritti o cambiati e quelle vuote, con le cartelle che le contengono, in ordine.
    Non quelle che hanno solo i file copiati dal progetto: dipendono dalla copia, non dallo script."""
    found = {os.path.dirname(name) for name in files}
    for root, dirs, names in os.walk(project):
        if root != project and not dirs and not names:
            found.add(os.path.relpath(root, project))
    result = set()
    for folder in found:
        while folder:
            result.add(folder)
            folder = os.path.dirname(folder)
    return sorted(result)


def run(mode, run_dir, script, args, project, capture):
    # ogni giro è un processo nuovo: ordine degli insiemi fisso, il fuso del Pi, niente __pycache__ nella copia
    # del progetto (finirebbe tra i file prodotti)
    env = dict(os.environ, PYTHONHASHSEED='0', TZ='Europe/Rome', PYTHONDONTWRITEBYTECODE='1')
    command = [sys.executable, os.path.abspath(__file__), 'giro', mode, os.path.abspath(run_dir), script] + list(args)
    if capture:
        return subprocess.run(command, cwd=project, env=env, capture_output=True, encoding='utf-8', errors='replace')
    return subprocess.run(command, cwd=project, env=env)


# ---------------------------------------------------------------------------------------------------------------
# Dentro un giro (un processo nuovo): orologio fermo, rete intercettata, poi lo script come se partisse da solo

def run_script(mode, run_dir, script, args):
    # datetime in C legge l'ora di sistema da sé; senza il modulo C si usa la versione in Python della libreria
    # standard, che la chiede a time.time(), cioè all'orologio fermo. Va fatto prima di ogni import di datetime.
    sys.modules['_datetime'] = None
    import runpy, uuid, warnings
    warnings.filterwarnings('ignore', message='urllib3 v2 only supports OpenSSL')     # avviso del Python del Mac
    with open(os.path.join(run_dir, 'ora.json'), encoding='utf-8') as fp:
        freeze_clock(json.load(fp)['epoch'], really_sleep=(mode == 'registra'))
    # dati_pc.py manda un uuid4 nel corpo di una richiesta: deve essere lo stesso in ogni giro
    numbers = itertools.count(1)
    uuid.uuid4 = lambda: uuid.UUID(int=next(numbers), version=4)
    responses = Responses(mode, os.path.join(run_dir, 'risposte'))
    intercept_requests(responses)
    intercept_urllib(responses)

    path = os.path.abspath(script)
    sys.argv = [path] + args
    sys.path[0] = os.path.dirname(path)
    try:
        runpy.run_path(path, run_name='__main__')
        code = 0
    except SystemExit as stop:
        code = stop.code
    if responses.missing:
        print('giro fallito, richieste senza risposta registrata: %d' % len(responses.missing), file=sys.stderr)
        return MISSING_EXIT
    return code


def freeze_clock(epoch, really_sleep):
    """L'orologio parte da epoch e avanza solo con time.sleep, che aspetta davvero solo se really_sleep."""
    real_sleep, real_localtime, real_gmtime, real_strftime = time.sleep, time.localtime, time.gmtime, time.strftime
    now = epoch

    def sleep(seconds):
        nonlocal now
        if really_sleep:
            real_sleep(seconds)
        now += seconds

    def localtime(seconds=None):
        return real_localtime(now if seconds is None else seconds)

    def gmtime(seconds=None):
        return real_gmtime(now if seconds is None else seconds)

    def strftime(fmt, moment=None):
        return real_strftime(fmt, localtime() if moment is None else moment)

    time.time = lambda: now
    time.sleep, time.localtime, time.gmtime, time.strftime = sleep, localtime, gmtime, strftime


class Responses:
    """Le risposte di un giro: dalla rete e salvate, una per file (registra), o lette dai file (riproduci)."""

    def __init__(self, mode, folder):
        self.mode = mode
        self.folder = folder
        self.saved = {}          # chiave -> quante risposte ci sono nella cartella
        self.asked = {}          # chiave -> quante volte lo script l'ha chiesta in questo giro
        self.missing = []        # richieste senza risposta registrata
        for name in os.listdir(folder):
            if name.endswith('.json.gz'):             # non un .DS_Store lasciato dal Finder
                key, number = name[:-len('.json.gz')].rsplit('-', 1)
                self.saved[key] = max(self.saved.get(key, 0), int(number))

    def answer(self, method, url, body, fetch):
        """(stato, Content-Type, corpo) della risposta; fetch() la chiede alla rete (solo dal vivo)."""
        key = request_key(method, url, body)
        if self.mode == 'registra':
            status, content_type, content = fetch()
            self.saved[key] = self.saved.get(key, 0) + 1
            save_response(self.file(key, self.saved[key]), method, url, status, content_type, content)
            return status, content_type, content
        if key not in self.saved:
            message = '%s: %s %s' % (MISSING, method, url)
            print(message, file=sys.stderr, flush=True)          # si vede anche se lo script prende l'errore
            self.missing.append(message)
            raise RuntimeError(message)
        # più risposte con la stessa chiave: nell'ordine registrato, poi sempre l'ultima
        self.asked[key] = self.asked.get(key, 0) + 1
        return load_response(self.file(key, min(self.asked[key], self.saved[key])))

    def file(self, key, number):
        return os.path.join(self.folder, '%s-%d.json.gz' % (key, number))


def request_key(method, url, body):
    """La chiave di una richiesta (il nome dei suoi file): metodo, URL con i parametri in ordine, corpo."""
    parts = urllib.parse.urlsplit(url)
    params = urllib.parse.urlencode(sorted(urllib.parse.parse_qsl(parts.query, keep_blank_values=True)))
    text = '%s %s://%s%s?%s\n' % (method, parts.scheme, parts.netloc, parts.path or '/', params)
    return hashlib.sha1(text.encode('utf-8') + body).hexdigest()[:16]


def save_response(path, method, url, status, content_type, content):
    response = {'method': method, 'url': url, 'status': status, 'content_type': content_type,
                'body': base64.b64encode(content).decode('ascii')}
    with gzip.open(path, 'wt', encoding='utf-8') as fp:
        json.dump(response, fp, indent=1)


def load_response(path):
    with gzip.open(path, 'rt', encoding='utf-8') as fp:
        response = json.load(fp)
    return response['status'], response['content_type'], base64.b64decode(response['body'])


def intercept_requests(responses):
    """requests.Session.request, che sta dietro a requests.get/post e alle sessioni, chiede a responses."""
    import http.client
    import requests
    real_request = requests.Session.request

    def request(session, method, url, **kwargs):
        prepared = session.prepare_request(requests.Request(
            method=method, url=url, params=kwargs.get('params'), data=kwargs.get('data'), json=kwargs.get('json'),
            headers=kwargs.get('headers'), cookies=kwargs.get('cookies'), files=kwargs.get('files'),
            auth=kwargs.get('auth')))
        body = prepared.body or b''
        if isinstance(body, str):
            body = body.encode('utf-8')

        def fetch():
            real = real_request(session, method, url, **kwargs)
            return real.status_code, real.headers.get('Content-Type'), real.content

        status, content_type, content = responses.answer(prepared.method, prepared.url, body, fetch)
        response = requests.Response()
        response.status_code = status
        response.reason = http.client.responses.get(status, '')
        if content_type:
            response.headers['Content-Type'] = content_type
        response.encoding = requests.utils.get_encoding_from_headers(response.headers)
        response._content = content
        response._content_consumed = True
        response.url = prepared.url
        response.request = prepared
        return response

    requests.Session.request = request


def intercept_urllib(responses):
    """urllib.request.OpenerDirector.open, che sta dietro a urlopen e agli opener con i cookie, chiede a responses."""
    import http.client, io, socket, urllib.error, urllib.request, urllib.response
    real_open = urllib.request.OpenerDirector.open

    def open_url(opener, fullurl, data=None, timeout=socket._GLOBAL_DEFAULT_TIMEOUT):
        request = urllib.request.Request(fullurl) if isinstance(fullurl, str) else fullurl
        if data is not None:
            request.data = data

        def fetch():
            try:
                with real_open(opener, request, None, timeout) as real:
                    return real.status, real.headers.get('Content-Type'), real.read()
            except urllib.error.HTTPError as error:
                return error.code, error.headers.get('Content-Type'), error.read()

        status, content_type, content = responses.answer(request.get_method(), request.full_url,
                                                         request.data or b'', fetch)
        headers = http.client.HTTPMessage()
        if content_type:
            headers['Content-Type'] = content_type
        if status >= 400:                    # come la rete: per urllib uno stato di errore è un'eccezione
            raise urllib.error.HTTPError(request.full_url, status, http.client.responses.get(status, ''),
                                         headers, io.BytesIO(content))
        return urllib.response.addinfourl(io.BytesIO(content), headers, request.full_url, status)

    urllib.request.OpenerDirector.open = open_url


# ---------------------------------------------------------------------------------------------------------------

def main(argv):
    if argv[1:2] == ['giro']:                  # dentro un giro lanciato da run()
        sys.exit(run_script(argv[2], argv[3], argv[4], argv[5:]))
    if len(argv) < 5 or argv[1] not in ('registra', 'attesi') or argv[3] != '--':
        sys.exit('uso: python3 tests/registratore.py registra|attesi CARTELLA_GIRO -- SCRIPT [ARGOMENTI...]')
    command, run_dir, script, args = argv[1], argv[2], argv[4], argv[5:]

    if command == 'registra':
        with tempfile.TemporaryDirectory() as project:
            copy_project(project)
            proc = record(run_dir, script, args, project)
        answers = os.path.join(run_dir, 'risposte')
        print('%d risposte in %s, codice di uscita %d' % (len(os.listdir(answers)), answers, proc.returncode))
        sys.exit(proc.returncode)

    if not os.path.isfile(os.path.join(run_dir, 'ora.json')) or not os.path.isdir(os.path.join(run_dir, 'risposte')):
        sys.exit('attesi non salvati: in %s mancano ora.json o risposte/ (prima si registra)' % run_dir)
    files, runs, folder_list = replay_twice(run_dir, script, args)
    for number, proc in enumerate(runs, 1):
        print('--- giro %d in riproduzione: codice di uscita %d' % (number, proc.returncode))
        print(proc.stdout, end='', flush=True)
        print(proc.stderr, end='', file=sys.stderr, flush=True)
    if any(MISSING in proc.stderr for proc in runs):
        sys.exit('attesi non salvati: alla registrazione mancano delle risposte')
    expected = os.path.join(run_dir, 'attesi')
    if os.path.isdir(expected):
        shutil.rmtree(expected)
    for name, content in files.items():
        path = os.path.join(expected, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as fp:
            fp.write(content)
    codes = [proc.returncode for proc in runs]
    with open(os.path.join(run_dir, 'codici.json'), 'w', encoding='utf-8') as fp:
        fp.write(json.dumps(codes) + '\n')
    with open(os.path.join(run_dir, 'cartelle.json'), 'w', encoding='utf-8') as fp:
        fp.write(json.dumps(folder_list, indent=1) + '\n')
    print('%d file in %s, %d cartelle, codici di uscita %s' % (len(files), expected, len(folder_list), codes))


if __name__ == '__main__':
    main(sys.argv)
