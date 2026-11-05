# Pulizia, parte 3 — export e pubblicazione — piano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** i dieci programmi che fanno e pubblicano il sito diventano semplici e lineari, con gli attrezzi comuni una
volta in `comune.py`, le parti morte tolte e gli stessi file prodotti di oggi; poi i rinforzi dello Storico, del backup
e del deploy.

**Architecture:** prima tre reti di sicurezza costruite con il codice di oggi (impronte dell'export su un campione
d'archivio con l'orologio fermo; giri registrati di `recover.py` e `check_updates.py` senza sottoprocessi veri;
scenari dei bash contro repository nudi locali e cartelle temporanee); poi un programma alla volta a uscite identiche;
poi i cambi voluti, ognuno con una prova che prima fallisce e il diff degli attesi guardato riga per riga.

**Tech Stack:** Python 3.7 sul Pi (3.9 sul Mac per le prove), `requests`, `unittest`, bash, git, rsync.

**Spec:** `docs/superpowers/specs/2026-11-05-pulizia-parte-3-design.md`

## Global Constraints

- Mai toccare il vecchio sistema ARPAV (`old/`, e sul Pi `/home/manuel/arpav`, `/home/manuel/dati/arpav/live`,
  `~/METEO/old`, le sue righe di cron). Mai `ssh`, mai push: il passaggio sul Pi non è in questo piano.
- Python 3.7: niente `:=`, `zoneinfo`, `removeprefix`/`removesuffix`, `functools.cache`, `math.prod`/`dist`,
  annotazioni `X | Y`; in 3.7 un gzip rovinato dà `OSError`, `EOFError` o `zlib.error` (niente `BadGzipFile`).
  `requests` 2.21: il JSON si decodifica da `r.content.decode('utf-8', 'replace')`.
- Nessuna libreria nuova. Ogni file di testo aperto con `encoding='utf-8'`.
- Nomi in inglese; commenti in italiano e solo per un perché; niente commento per import; import in testa.
- Nei task di pulizia (4-13) le uscite restano identiche: impronte, giri registrati, scenari bash. Le sole differenze
  ammesse sono quelle della spec ("Effetti accettati"), che le reti non vedono.
- Comandi di questa macchina: sempre `/usr/bin/python3` (il `python3` del PATH è Homebrew senza `requests`) e
  `/bin/sleep` (il `sleep` del PATH è `~/script/sleep`, che può addormentare il Mac); git solo in forma semplice (niente
  pipe né `<(...)` attorno a git).
- Le reti (Task 1 e 3) non fanno mai l'impronta di `site/index.html` né di `site/radar.js`: sono ingressi, e nella
  stessa copia di lavoro il lavoro sull'interfaccia li cambia. Dove una prova ha bisogno di una pagina usa copie
  sostitute piccole.
- Prove: `/usr/bin/python3 -m unittest discover -s tests -t .` → `OK` (136 all'inizio). Nessun task finisce con una
  prova rossa. Le reti non toccano mai GitHub (`GIT_ALLOW_PROTOCOL=file`), il Pi o la rete (salvo le registrazioni del
  Task 2 e le prove dal vivo dei Task 9-10, in copie temporanee).
- La copia di lavoro è condivisa con altri lavori: si committa solo per percorso. **Commit di un task:**

```bash
find . -name "* 2*"                             # vuoto: niente copie "nome 2" di iCloud (qui `.git` è un file)
git diff --cached --name-only                   # vuoto: nell'indice niente di altri
git add <file nuovi del task>
git commit -m "<messaggio in italiano>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- <file del task>
git show --stat --format=%s HEAD                # solo i file del task
```

Ogni passo "Commit" dei task è questo blocco: sempre per percorso (`git add` solo per i file nuovi), perché nella stessa
copia di lavoro un altro lavoro può committare. Dopo un `git mv` l'indice contiene la rinomina del task: il controllo
`git diff --cached --name-only` mostra proprio quella, e il commit nomina il vecchio e il nuovo percorso.

## Review Focus

1. **File dell'archivio strani**: `.json.gz`, vuoto, rotto, gzip rovinato (`zlib.error`), JSON valido di forma
   sbagliata, `.json` e `.json.gz` dello stesso giorno. → campione del Task 1 (gz, vuoto, rotto); `test_comune`
   (Task 4); `test_archivio` (Task 14).
2. **Ora solare contro ora civile**: due regole dell'ora legale, cutoff della finestra, bordo dello Storico. →
   `test_comune` ora per ora (Task 4); `test_export` (Task 6, 17); `test_finestra_otto_giorni` con `today` esplicito
   (Task 14).
3. **Da `urllib` a `requests`** in `recover`/`check_updates`: parametri, decodifica, errori HTTP, eccezioni prese. →
   giri registrati con una risposta 500 (BZ) e una 404 (AQ_TN) (Task 2); prove dal vivo (Task 9-10).
4. **Sottoprocessi nelle prove** (nella parte 2 un `recover.py -r all` di prova lanciò `dati_veneto.py` dal vivo). →
   stub del registratore e la sua prova; giro `recover -r all` (Task 2).
5. **Scritture e stato**: `recover` atomico, `.tracking/` compatto, `status.json` da file. → giri e scenari (Task 2-3).
6. **Bash del Pi contro bash del Mac**, esclusioni ancorate di rsync. → sostituti e scenari (Task 3); elenco del deploy
   con `tests/.../PIE/zero_idrometrici.json` escluso da `tests/` e i zeri VEN/LOM/PC_PO ancora copiati (Task 16).
7. **Spinta incrementale**: `data-inc` con il genitore giusto, nomi di `.delta/` stabili, tre errori → repo rifatto,
   lock occupato. → scenari di `publish.sh` (Task 3).
8. **Python 3.7**: `test_python37` su ogni `.py` della cartella principale (Task 1, rilanciato nel Task 18).
9. **Velocità del ciclo caldo** (`quality.checker` nell'export). → `tests/rete.py tempo` prima e dopo (Task 5-6).

---

## File

- Crea: `tests/rete.py`, `tests/orologio/sitecustomize.py`, `tests/shims/` (`flock`, `mountpoint`, `ionice`, `head`,
  `df`, `crontab`), `tests/test_rete.py`, `tests/test_pubblica.py`, `tests/test_archivio.py`,
  `tests/fixtures/rete/` (`impronte.txt`, `bash.json`), `tests/fixtures/scarico/recover/{bz,lom,er,tutte}/`,
  `tests/fixtures/scarico/check_updates/campione/`, `status.py`, `delta_names.py`, `deploy_exclude.txt`,
  `watchdog_storico.yml`.
- Rinomina: `tests/test_export_dst.py` → `tests/test_export.py`, `watchdog_actions.yml` → `watchdog.yml`.
- Modifica: i dieci programmi, `comune.py`, `deploy.sh`, `crontab_regioni.txt`, `README.md`, `.gitignore`,
  `dati_laghi.py`, `dati_aria.py`, `dati_mare.py` (solo `slug`), `dati_altoadige.py`, `dati_trentino.py`, `dati_fvg.py`
  (solo `fetch`), `tests/registratore.py`, `tests/test_registratore.py`, `tests/test_scarico.py`, `tests/test_comune.py`,
  `tests/test_history.py`.

---

### Task 1: rete di sicurezza 1/3 — export, climatologia, Storico

**Files:**
- Create: `tests/rete.py`, `tests/orologio/sitecustomize.py`, `tests/test_rete.py`, `tests/fixtures/rete/impronte.txt`
- Modify: `tests/test_comune.py`

**Interfaces:**
- Consumes: gli attesi delle prove di scarico; `tests/registratore.freeze_clock`.
- Produces (`tests/rete.py`, usato dai Task 3, 5-8, 14, 17):
  - `EPOCH = 1793883600` (2026-11-05 13:00 UTC, dopo l'ultimo dato del campione).
  - `build_archive(dest, regions=None)`: copia in `dest` gli `attesi/` di questi giri, in quest'ordine (a parità di
    percorso vince l'ultimo): laghi/normale, invasi/normale, liguria/full, mare/reti, mare/acqven, aria/normale,
    pc/tutte, veneto/ieri, veneto/oggi, fvg/normale, trentino/normale, altoadige/normale, lombardia/normale,
    emilia_romagna/normale; aggiunge dove mancano `*/zero_idrometrici.json` e `FVG/stazioni_coords.csv` del progetto;
    poi i file costruiti: `PC_PO/data-parsed/LIVIDRO/LIVIDRO-20261030.json` (dentro i 7 giorni) e
    `LIG/data-parsed/TEMP/TEMP-20261027.json` (30 giorni: climatologia e Storico) compressi in `.json.gz` (via il
    `.json`; sono i due `.json.gz` della spec: `LIG` ha `PREC` solo da 20261102, non c'è un `PREC-20261027.json`),
    `LAGHI/data-parsed/LIVLAGO/LIVLAGO-20261101.json` vuoto, `INV_ER/data-parsed/LIVLAGO/LIVLAGO-20261102.json` =
    `{rotto`. Con `regions`, solo quelle cartelle.
  - `copy_programs(dest)`: i `*.py` e `*.sh` della cartella principale, `site/index.html`, `site/radar.js`,
    `watchdog*.yml`, `favicon_site.ico`, `crontab_regioni.txt`. Le due pagine sono ingressi e non uscite.
  - `run(args, cwd, epoch=EPOCH, env=None)` → `subprocess.CompletedProcess` (testo utf-8), con
    `PYTHONPATH=<progetto>/tests/orologio`, `OROLOGIO_FERMO=<epoch>`, `RETE_VIETATA=1`, `TZ=Europe/Rome`,
    `PYTHONHASHSEED=0`, `PYTHONDONTWRITEBYTECODE=1`, `LC_ALL=C`, più `env`. Il processo figlio vede il `requests` del
    Mac (sta nel sito utente di `/usr/bin/python3`): se `env` cambia `HOME`, `run` aggiunge
    `PYTHONUSERBASE=<site.getuserbase() del processo di prova>`.
  - `fingerprints(folder, subdirs)` → `{percorso relativo: sha1}`, senza `site/index.html` e `site/radar.js` (copiati
    da `copy_programs`: l'impronta proverebbe la copia, e il lavoro sull'interfaccia le cambia).
  - `export_outputs(dest)`: campione e programmi in `dest`, poi con `run`: `export_web.py -r all --site-dir site`;
    `export_web.py -r all --site-dir site --days 30 --series-dir series30 --series-only`;
    `climatology.py -r all --site-dir site`; `history.py --out history_out --cache history_cache` due volte. Ogni
    comando deve dare codice 0; il secondo Storico deve lasciare `history_out/` uguale al primo. Restituisce le
    impronte di `site/`, `history_out/`, `history_cache/`.
  - riga di comando: `attesi export` (riscrive `tests/fixtures/rete/impronte.txt`, righe `<sha1>  <percorso>` in
    ordine, come `sha1sum`), `uscita CARTELLA` (lascia tutta l'uscita in CARTELLA, per `diff -r` fra due commit),
    `tempo` (secondi dell'export a 7 giorni sul campione: il migliore di 3 giri), `uscita CARTELLA [--da COMMIT]` (con
    `--da` i programmi si prendono dal commit con `git show COMMIT:<file>`, per rigenerare l'uscita del commit di
    partenza senza stash né worktree).
- `tests/orologio/sitecustomize.py`: con `OROLOGIO_FERMO`, prima di tutto `sys.modules['_datetime'] = None`, poi
  `freeze_clock(epoch, really_sleep=False)` di `tests/registratore.py` caricato dal suo percorso (senza toccare
  `sys.path`; il modulo non deve avere effetti all'importazione: l'intercettazione dei sottoprocessi del Task 2 si
  installa solo dentro `run_script`); sempre `warnings.filterwarnings('ignore', message='urllib3 v2 only supports
  OpenSSL')` (come già `registratore.run_script`: senza, l'avviso di urllib3 sporca le uscite appena un programma importa
  `requests`); con `RETE_VIETATA`, `socket.getaddrinfo` e `socket.socket.connect` sollevano
  `OSError('rete vietata nelle prove')`.

- [ ] **Step 1: Python 3.7 su ogni programma.** In `tests/test_comune.py`, `script_python()` restituisce tutti i `*.py`
  della cartella principale. Aggiungi `('gzip', 'BadGzipFile')` alle cose vietate (i Global Constraints la bandiscono, la
  prova oggi non la controlla). Run: `/usr/bin/python3 -m unittest tests.test_comune.TestPython37 -v` → OK (21 file oggi).
- [ ] **Step 2: scrivi `sitecustomize.py` e `tests/rete.py`** secondo le interfacce.
- [ ] **Step 3: orologio e rete.** Run:
  `PYTHONPATH=$PWD/tests/orologio OROLOGIO_FERMO=1793883600 RETE_VIETATA=1 /usr/bin/python3 -c "import datetime, urllib.request; print(datetime.datetime.utcnow()); urllib.request.urlopen('http://example.com')"`
  (dalla cartella del progetto, con il percorso assoluto: niente `cd`, niente cartella temporanea lasciata)
  Expected: `2026-11-05 13:00:00`, poi `URLError ... rete vietata nelle prove`.
- [ ] **Step 4: impronte del codice di oggi.** Run: `/usr/bin/python3 tests/rete.py attesi export` (circa 70 s) →
  circa 8.000 righe. Rilancia e confronta: stesso file (`shasum` uguale). Controlla che l'elenco non contenga `site/index.html` né `site/radar.js`.
- [ ] **Step 5: la prova.** `tests/test_rete.py`, classe `TestExport`: `setUpClass` chiama `export_outputs` una volta;
  `test_sito` (`site/` senza `climate.json`), `test_climatologia` (`site/*/climate.json`), `test_storico`
  (`history_out/`, `history_cache/`) confrontano con `impronte.txt` e nominano fino a 20 file diversi, mancanti o in più.
  Run: `/usr/bin/python3 -m unittest tests.test_rete -v` → 3 OK.
- [ ] **Step 6: guardala fallire.** Cambia lo sha1 di `site/VEN/units.json` in `impronte.txt` → `test_sito` FAIL che lo
  nomina; ripristina → OK.
- [ ] **Step 7:** tutte le prove → OK (3 in più).
- [ ] **Step 8: commit** "Rete della parte 3 (1/3): impronte di export, climatologia e Storico su un campione
  dell'archivio, con l'orologio fermo; Python 3.7 su tutti i programmi" — file: i quattro creati e `tests/test_comune.py`.

---

### Task 2: rete di sicurezza 2/3 — `recover.py` e `check_updates.py`

**Files:**
- Modify: `tests/registratore.py`, `tests/test_registratore.py`, `tests/test_scarico.py`, `.gitignore`
- Create: `tests/fixtures/scarico/recover/{er,bz,lom,tutte}/` (`tutte/risposte/.gitkeep`: git non tiene le cartelle
  vuote e `Responses` fa `os.listdir`; ignora i nomi che non finiscono in `.json.gz`),
  `tests/fixtures/scarico/check_updates/campione/`

**Interfaces:**
- Produces (`tests/registratore.py`):
  - `PROJECT_FILES` comprende anche `recover.py` e `check_updates.py`.
  - `copy_seeds(run_dir, project)`: copia `run_dir/iniziali/` (se c'è) nel progetto; la chiamano `registra` e
    `replay_twice` subito dopo `copy_project` (i semi non contano come file prodotti, se il giro non li cambia).
  - `intercept_subprocess(project)`, in `run_script` in entrambi i modi: `subprocess.run` scrive una riga in
    `<progetto>/sottoprocessi.txt` (`python3` al posto di `sys.executable`, i percorsi del progetto relativi) e
    restituisce `CompletedProcess(args, 0)`; `subprocess.Popen` solleva `RuntimeError('sottoprocesso vietato in un
    giro')`. `run_script` non ha `project`: la funzione prende la cartella del giro da `os.getcwd()`, e i percorsi si
    relativizzano con `os.path.realpath` da entrambe le parti (il cwd è `/private/var/…`, un percorso passato dal
    padre `/var/…`). Il modulo resta senza effetti all'importazione (lo carica `sitecustomize` del Task 1).
  - `read_response(path)` → il dizionario del `.json.gz` registrato (`method`, `url`, stato, tipo, corpo): serve a
    ridurre le registrazioni (`load_response` non restituisce `method` e `url`, che `save_response` richiede).
- Produces (`tests/test_scarico.py`): `check_source(..., decoded=())`: i file il cui percorso comincia con un prefisso di
  `decoded` si confrontano dopo `json.loads`, e contano come prodotti solo se il contenuto decodificato è diverso da
  quello decodificato del seme (`<giro>/iniziali/<percorso>`) o se il seme manca: un cambio di formato (il compatto del
  Task 10) non deve far comparire come prodotti i 12 stati rimasti uguali.

- [ ] **Step 1: prove del registratore** (`tests/test_registratore.py`):
  `test_sottoprocessi_annotati_non_lanciati` (lo script lancia `[sys.executable, <abs>/figlio.py, '-r', 'X']`; dopo il
  giro `sottoprocessi.txt` = `python3 figlio.py -r X\n` e il file che `figlio.py` scriverebbe non c'è);
  `test_file_iniziali` (`iniziali/a/b.json` letto dallo script; non è fra i file prodotti). Run:
  `/usr/bin/python3 -m unittest tests.test_registratore -v` → FAIL; scrivi le aggiunte → OK.
- [ ] **Step 2: giro `recover/er`.** Seme `iniziali/ER/data-parsed/stazioni.json` = le prime 3 stazioni (codici in
  ordine) di `tests/fixtures/scarico/emilia_romagna/normale/attesi/ER/data-parsed/stazioni.json`. Run:
  `/usr/bin/python3 tests/registratore.py registra tests/fixtures/scarico/recover/er -- recover.py -r ER --force --days 1`
  → codice 0, 18 risposte (3 stazioni × 6 variabili); poi
  `... attesi tests/fixtures/scarico/recover/er -- recover.py -r ER --force --days 1`.
- [ ] **Step 3: giro `recover/bz`.** `registra ... recover/bz -- recover.py -r BZ --force --days 1` (dal vivo, circa
  1.000 richieste). Riduci con `registratore.read_response` e, per risalvare, `save_response(path, r['method'], r['url'], …)`
  (il resto come chiede la sua firma), stessi nomi di file: nella risposta dei
  sensori resta chi ha uno dei primi 10 `SCODE` (in ordine); via le risposte `/timeseries` delle altre stazioni; la
  risposta della prima coppia rimasta diventa stato 500. Poi `attesi`.
- [ ] **Step 4: giro `recover/lom`.** Registra a hh:10-hh:20 o hh:40-hh:50 (lo scarico di Lombardia del Pi gira a :00 e
  :30 dalla stessa connessione); con un 429 nell'uscita aspetta 30 minuti (`/bin/sleep 1800` in un comando in background o con Monitor, mai `sleep`) e
  registra di nuovo. Riduci: nell'anagrafica
  le righe dei primi 5 `idstazione` (in ordine), nelle 6 risposte con `$where` le righe dei loro `idsensore` (quella
  dell'ultimo istante, `$limit=1`, resta com'è). Poi `attesi`.
- [ ] **Step 5: giro `recover/tutte`** (senza rete): `ora.json` = `{"epoch": 1793883600}`, `risposte/` con il solo `.gitkeep`, semi
  in `iniziali/` scritti da uno script una tantum (le regole vanno nel commento della prova): stazione `S1`, file del
  giorno con `MISURE.ISTANTE`/`VALORE`; BZ e LOM `TEMP` ogni 10 min dal 2026-10-29 00:00 al 2026-11-05 13:50 (ora
  solare); ER `TEMP` ogni 15 min dal 2026-11-02 00:00 al 2026-11-05 13:45; VEN `TEMP` ogni 30 min dal 2026-10-29 00:00
  al 2026-11-05 13:30 senza 2026-11-02 10:00-12:30; AQ_VEN `PM10` ogni ora fino al 2026-11-05 13:00; AQ_LOM `PM10` ogni
  ora fino al 2026-11-05 03:00. Run: `attesi ... recover/tutte -- recover.py -r all` → `sottoprocessi.txt` con, per
  giro, le 7 righe `python3 dati_veneto.py -date 2026 11 4 -c no` … `-date 2026 10 29 -c no` e
  `python3 dati_aria.py -r LOM`; codici `[0, 0]`.
- [ ] **Step 6: giro `check_updates/campione`.** `registra ... check_updates/campione -- check_updates.py -r all --sample 3`.
  Anche questo giro chiama `dati.lombardia.it` (`scan_lom`, `scan_aq_lom`): stessa regola di finestra (hh:10-20 /
  hh:40-50) e stesso controllo del 429 del Step 4, e prima di fare i semi controlla che gli stati di LOM e AQ_LOM non
  siano vuoti (con un 429 il seme di LOM è vuoto e le "6 NUOVA STAZIONE" non possono uscire).
  Semi: un `attesi` in una copia temporanea del giro dà gli stati `.tracking/*_stations.json`; in quelli di VEN, BZ e
  LOM togli gli ultimi 2 codici, via quello di PC_TN; mettili in `iniziali/.tracking/`. Poi la risposta di AQ_TN
  diventa 404, poi `attesi`.
- [ ] **Step 7: `.gitignore`.** Dopo le regole di `.tracking/` e `tracking.log` aggiungi
  `!tests/fixtures/**/.tracking/` e `!tests/fixtures/**/tracking.log`. Run:
  `git status --short --ignored -- tests/fixtures/scarico/recover tests/fixtures/scarico/check_updates` → nessuna riga
  che cominci con `!!`; `git check-ignore -v .tracking/x tracking.log` → stampa la regola per tutti e due (restano
  ignorati quelli veri della cartella principale).
- [ ] **Step 8: le prove** in `tests/test_scarico.py`: `test_recover_er`, `test_recover_bz`, `test_recover_lom`
  (`check_source('recover', <giro>, 'recover.py', [...])`); `test_recover_tutte` (in più, in ogni giro, le righe
  `[VEN] gate: buco massimo 210 min (> 90)`, `[BZ] gate (7gg): continuo (buco max 10 min)`,
  `[ER] gate (3gg): continuo (buco max 15 min)`, `[LOM] gate (7gg): continuo (buco max 10 min)`,
  `[AQ_VEN] gate: continuo (buco max 60 min)`, `[AQ_LOM] gate: buco in coda 660 min (ultimo campione vecchio)`,
  `[PC_TN] nessun archivio: salto.`); `test_check_updates` (`decoded=('.tracking/',)`; nel primo giro 6 righe
  `NUOVA STAZIONE`, nel secondo nessuna). In `READ_BY_CHECK_UPDATES`: `AQ_VEN` `VEN_POLLMAP`, `AQ_LOM` `LOM_TYPEMAP`,
  `AQ_BZ` `BZ_MCODEMAP`, `AQ_TN` `TN_POLLMAP`, `PC_FVG` `FVG_MAP`, `PC_TN` `TN_MAP`. Run:
  `/usr/bin/python3 -m unittest tests.test_scarico -v` → OK.
- [ ] **Step 9: guardale fallire**: cambia un byte di un file in `recover/bz/attesi/` → FAIL che lo nomina; ripristina.
- [ ] **Step 10:** `du -sh tests/fixtures/scarico/recover tests/fixtures/scarico/check_updates` → pochi MB (**ferma e
  chiedi** oltre 20 MB); tutte le prove → OK (7 in più).
- [ ] **Step 11: commit** "Rete della parte 3 (2/3): giri registrati di recover.py e check_updates.py, registratore
  senza sottoprocessi veri e con file di partenza" — per percorso: i file modificati e le cartelle nuove dei giri.

---

### Task 3: rete di sicurezza 3/3 — script bash e deploy

**Files:**
- Create: `tests/shims/{flock,mountpoint,ionice,head,df,crontab}`, `tests/fixtures/rete/bash.json`,
  `tests/fixtures/rete/index.html` e `radar.js` (pagine sostitute piccole)
- Modify: `tests/rete.py`, `tests/test_rete.py`

**Interfaces:**
- Produces:
  - sostituti (`#!/bin/sh`, eseguibili, solo per le prove): `flock` esce con `${FLOCK_EXIT:-0}`; `mountpoint` con
    `${MOUNTPOINT_EXIT:-0}`; `ionice` toglie le sue opzioni ed esegue il resto; `head -n -N` stampa tutto meno le ultime
    N righe (le altre forme vanno a `/usr/bin/head`); `df --output=avail|pcent` stampa due righe fisse; `crontab -l`
    stampa `# crontab di prova`.
  - in `tests/rete.py`: `BASH_REGIONS = ['LAGHI', 'INV_ER', 'MAR_ER', 'MAR_FVG']` (export di un secondo; MAR_* hanno
    PREC/TEMP per lo Storico); per i bash `run` aggiunge `PATH=<progetto>/tests/shims:/usr/bin:/bin:/usr/sbin:/sbin` (assoluto: gli script fanno
    `cd "$BASE"`), `HOME` temporanea con `.gitconfig` (`url.<repo nudo>.insteadOf = git@github.com:Simulaqua/METEO.git`,
    utente di prova), `PYTHONUSERBASE=<site.getuserbase() del processo di prova>` (senza, con la `HOME` temporanea
    `/usr/bin/python3` non trova più `requests` e da `quality` in poi `export_web.py`, `history.py` e `status.py`
    muoiono con `ModuleNotFoundError`), `GIT_ALLOW_PROTOCOL=file`, `GIT_CONFIG_NOSYSTEM=1`; `publish_scenarios()`, `publish_history_scenarios()`,
    `backup_scenarios()`, `deploy_list()`; riga di comando `attesi bash` (riscrive `bash.json`, chiavi in ordine,
    `indent=1`).
  - Effetti di un giro di `publish.sh`: `codice`; `righe` (stdout+stderr, ma solo le righe degli script bash
    stessi: `DATI…`, `PAGINA…`, `STORICO…`, `ERRORE…`, `ATTENZIONE…`, `Fatto. Repo…` e gli errori di git; le righe dei
    programmi Python sono già coperte dalle impronte del Task 1 e cambiano di proposito nel Task 6; in
    `backup_usb.sh` restano tutte, sono dello script; cartelle temporanee → `<tmp>`, `inviati …` → `inviati N`); `data` (percorsi del ramo `data` fuori da `.delta/`); `delta` (`site/.git/delta-map`);
    `uguale_al_sito` (ogni blob = `git hash-object` del file in `site/`); `data_inc` (`genitore = data di prima` o
    `assente`); `pagina` (righe `ls-tree -r` di `gh-pages`); `tracking` (`last_page_hash` com'è; `last_data_hash`
    uguale all'impronta ricalcolata dei file del sito, sì/no; `data_push_fails`); `repo_dati` (c'è `site/.git`);
    `status` (`site/STATUS/status.json` decodificato).
  - Di `publish_history.sh`: `codice`, `righe`, `history` (percorsi del ramo), `uguale_all_uscita`, `hash_salvato`,
    `hash_aggiornato` (prima del giro `.tracking/last_history_hash`, se c'è, riceve un'ora vecchia: il giro l'ha scritto
    o toccato?), `git_rimasto` (c'è `history_out/.git`). Di `backup_usb.sh`: `codice`, `righe` (senza data e ora in testa; secondi e
    MB → N), `versioni`, per versione `file` e `condivisi` (stesso inode della versione prima), `stop`
    (`.rotazione-ferma`). Di `deploy.sh`: i file che `rsync -an` copierebbe da un albero di prova, con le esclusioni di
    `deploy_exclude.txt` se c'è, altrimenti quelle `--exclude '...'` scritte in `deploy.sh`.

- [ ] **Step 1: scrivi sostituti e scenari.** Percorsi nelle uscite: prima il `realpath` (`/private/var/folders/…`,
  quello che vedono Python e `getcwd`), poi il percorso logico (`/var/folders/…`, di `mkdtemp`, della `pwd` di bash e
  dell'URL di `.gitconfig`), tutti e due → `<tmp>`. Le pagine: dopo `copy_programs` gli scenari di `publish.sh`
  sovrascrivono `site/index.html` e `site/radar.js` con i sostituti di `tests/fixtures/rete/` (l'`index.html` con la
  riga `const DATA_BASE = …` che `publish.sh` riscrive: leggila in `publish.sh`), così `pagina` e `last_page_hash` non
  dipendono dalla pagina vera; "pagina cambiata" modifica il sostituto. Ogni scenario in una cartella temporanea con `copy_programs`,
  `build_archive(regions=BASH_REGIONS)`, un `logs/backup-20261105-044000.log` con una riga `ERRORE: x -- y`, il repo nudo:
  - `publish.sh`, in fila sullo stesso progetto: primo giro; invariato; dato nuovo (una lettura in più in un file
    LAGHI dentro la finestra) → `data-inc`; pagina cambiata (una riga di commento nell'`index.html` sostituto); lock occupato
    (dato nuovo, `FLOCK_EXIT=1`) → codice 0 e "push precedente ancora in corso"; repo nudo spostato per tre giri (dato
    nuovo ogni volta) → `data_push_fails` 1, 2, 3 e `site/.git` tolto al terzo; repo rimesso → push completo.
  - `publish_history.sh`: primo giro; invariato; dato nuovo con repo nudo spostato → codice diverso da 0, hash non
    salvato; repo rimesso → push.
  - `backup_usb.sh` con `BACKUP_MNT/DEST/METEO/ARPAV/KEEP/DAY` in cartelle temporanee e sempre una versione precedente
    (`2026-11-01`, con `METEO/` e `arpav/`: la bash 3.2 del Mac non regge un array vuoto con `set -u`). Sorgente METEO con
    5 file in `VEN/data-parsed/`, e `site/`, `logs/`, `VEN/data-downloaded/`, `radar_out/`, `history_out/`,
    `history_cache/`, `.tracking/`, un `.lock` e un `.tmp`: versione 2026-11-02; di nuovo 2026-11-02; KEEP=2 e
    2026-11-03 (rotazione); 2 file d'archivio tolti e 2026-11-04 (rotazione ferma); `MOUNTPOINT_EXIT=1`;
    `BACKUP_DAY=1970-01-01`.
  - `deploy_list()`: albero di prova con `dati_veneto.py`, `comune.py`, `publish.sh`, `crontab_regioni.txt`,
    `site/index.html`, `site/radar.js`, `site/VEN/stations.geojson`, `site/.git/HEAD`, `VEN/zero_idrometrici.json`,
    `LOM/…`, `PC_PO/…`, `PIE/…`, `PC_PIE/zero_idrometrici.json`, `VEN/data-parsed/TEMP/x.json`,
    `VEN/data-downloaded/x`, `VEN/logs/x.log`, `logs/x.log`, `PC_PO/elements_map.json`, `PC_FVG/sensors_map.json`,
    `FVG/stazioni_coords.csv`, `tests/fixtures/pc/PIE/zero_idrometrici.json`, `.tracking/last_data_hash`,
    `tracking.log`, `radar_out/x.png`, `history_out/index.json`, `history_cache/VEN.json`, `.superpowers/x`, `.claude/x`,
    `.DS_Store`, `__pycache__/x.pyc`, `.git/HEAD`, `docs/x.md`, `old/x.py`.
- [ ] **Step 2: attesi del codice di oggi.** Run: `/usr/bin/python3 tests/rete.py attesi bash` → `bash.json`; rilancia →
  identico. Leggilo: primo giro con `data_inc` assente e terzo con `genitore = data di prima`; lock → "push precedente
  ancora in corso"; terzo errore → `repo_dati` falso; backup: file uguali `condivisi`, rotazione, `stop` scritto.
  Se la bash 3.2 non regge uno scenario, toglilo e scrivi il perché nel commento della prova.
- [ ] **Step 3: le prove** in `tests/test_rete.py`: `TestBash.test_publish`, `test_publish_history`, `test_backup`,
  `TestDeploy.test_elenco`, ognuna contro la sua parte di `bash.json`. Run: `/usr/bin/python3 -m unittest tests.test_rete -v` → OK.
- [ ] **Step 4: guardale fallire**: cambia `codice` del primo giro di `publish` in `bash.json` → FAIL; ripristina.
- [ ] **Step 5:** tutte le prove → OK (4 in più).
- [ ] **Step 6: commit** "Rete della parte 3 (3/3): scenari di publish.sh, publish_history.sh, backup_usb.sh e deploy
  contro repository e cartelle locali" — per percorso: `tests/rete.py`, `tests/test_rete.py`; nuovi: sostituti,
  `bash.json`, le due pagine sostitute.

---

### Task 4: `comune.py`, gli attrezzi della parte 3

**Files:** Modify: `comune.py`, `tests/test_comune.py`

**Interfaces:** Produces (firme esatte, senza annotazioni):
- `load_json(path)`: anche `.gz` (`gzip.open(path, 'rt', encoding='utf-8')`); `ValueError`, `OSError`, `EOFError`,
  `zlib.error` → `{}` con `WARN: file JSON illeggibile (...), ignorato: <path>`; vuoto → avviso; mancante → `{}` muto.
- `day_files(parse_dir, var)` → `{'AAAAMMGG': percorso}` per `<var>-AAAAMMGG.json` e `.json.gz` (vince il `.json`);
  cartella mancante → `{}`. Le chiavi sono in ordine di giorno crescente (il dizionario si costruisce dai nomi
  ordinati: `os.listdir` su APFS non è ordinato e export e climatologia dipendono dall'ordine di lettura).
- `value_key(region)` → `'VM'` se `region == 'VEN'`, altrimenti `'VALORE'`.
- `is_dst_solar(dt)`: `True` fra le 02:00 solari dell'ultima domenica di marzo e le 02:00 solari dell'ultima di ottobre.
- `merge_readings(parse_dir, var, readings, new_record)` → letture aggiunte; `readings = {sc: [(istante, valore)]}`;
  i `None` si saltano; per ogni giorno (nell'ordine in cui compare) un caricamento e un `save_json`; un istante già
  salvato tiene il suo valore; `new_record(sc)` per una stazione assente dal file.
- `write_parsed` riscritta su `merge_readings`, stesso comportamento. Commento in testa: "attrezzi condivisi dai
  programmi del Pi".

- [ ] **Step 1: prove** (prima rosse): `test_ora_legale_solare_e_civile` (29/03/2026 e 25/10/2026, ore 0-4, le due
  regole affiancate: marzo solare `[F, F, T, T, T]`, civile `[F, F, T, T, T]`; ottobre solare `[T, T, F, F, F]`,
  civile `[T, T, T, F, F]`); `test_carica_gz` (`.json.gz` letto; troncato e con dati rovinati → `{}` e una riga WARN);
  `test_day_files` (`.json` batte `.json.gz`; `TEMP-2026110.json` e `TEMPX-20261101.json` ignorati; le chiavi sono in
  ordine di giorno crescente);
  `test_value_key`; `test_merge_readings` (file esistente: istante doppio tiene il vecchio valore, il nuovo entra,
  ordine; stazione nuova dal `new_record`; `None` saltato; conteggio).
  Run: `/usr/bin/python3 -m unittest tests.test_comune -v` → FAIL (`AttributeError`).
  (Nota: la metà "civile" di `test_ora_legale_solare_e_civile` ripete `TestOraLegale.test_ora_legale_marzo/ottobre`
  già esistenti; non sono da togliere in questo task, il confronto affiancato è il punto della prova.)
- [ ] **Step 2: scrivi** gli attrezzi. Run la stessa riga → OK.
- [ ] **Step 3: `write_parsed` non è cambiata:** `/usr/bin/python3 -m unittest tests.test_scarico -v` → OK (tutti i giri
  degli script di scarico, file identici).
- [ ] **Step 4:** tutte le prove → OK (5 in più).
- [ ] **Step 5: commit** "comune.py: lettura anche dei .gz, file del giorno, chiave del valore, ora legale sull'ora
  solare, fusione delle letture (write_parsed la usa)".

---

### Task 5: `quality.py` e `derive.py`

**Files:** Modify: `quality.py`, `derive.py`; Create: `tests/test_quality.py` (se non c'è già, altrimenti Modify)

- [ ] **Step 1:** `/usr/bin/python3 tests/rete.py tempo` (migliore di 3) → annota T0. Scrivi una prova piccola, verde
  già oggi, che fissa la regola che il campione non vede: `quality.checker(var)(None)` e `('')` → `True` (i vuoti
  restano al chiamante), `'x'`, `-999`, `NaN` e un valore fuori dai limiti → `False`; `valid(var, None)` → `False`
  (dopo la riscrittura la regola di `valid` e quella di `checker` devono dare gli stessi risultati).
- [ ] **Step 2: `quality.py`**: `to_float` da `comune`; una regola `valid(var, x)`; `checker(var)` la usa con i limiti
  presi una volta; `drop_zero_glitches` invariata. **`derive.py`**: `_f` → `comune.to_float`; un solo
  `put(out, name, istante, valore)`; `_first_number(meta, keys)` al posto di `_station_alt`/`_lat_of`;
  `import datetime` in testa; via `DERIVED_CAT` e `vals`. Formule e arrotondamenti invariati.
- [ ] **Step 3:** `/usr/bin/python3 -m unittest tests.test_rete.TestExport tests.test_history -v` → OK;
  `tests/rete.py tempo` ≤ 1,1 × T0 (T0 e questo valore sono il migliore di 3: su ~33 s il rumore del portatile è dello
  stesso ordine).
- [ ] **Step 4:** tutte le prove → OK (1 in più). **Commit** "quality.py e derive.py: una regola di plausibilità, gli aiuti una
  volta sola, via le parti morte (righe prima -> dopo)".

---

### Task 6: `export_web.py`

**Files:** Modify: `export_web.py`; Rename+modify: `tests/test_export_dst.py` → `tests/test_export.py`

- [ ] **Step 1: prova della coordinata NaN** (prima rossa) in `tests/test_export.py` (dopo `git mv`; il commit nomina
  `tests/test_export_dst.py` e `tests/test_export.py`):
  `test_coordinata_nan_fuori_dalla_mappa`: archivio minimo (regione `LAGHI`, stazione `S1` con `LAT 'nan'`, una lettura
  nella finestra), export con `rete.run` → in `stations.geojson` nessuna feature `S1` e nessun `NaN`. Run:
  `/usr/bin/python3 -m unittest tests.test_export -v` → FAIL.
- [ ] **Step 2: riscrivi** come nella spec: `REGIONS`, `STATION_FIELDS`, `main()`, `export_region()` con parametri
  espliciti, `read_window` su `comune.day_files`/`load_json`/`value_key` (i giorni si leggono in ordine crescente, com'è oggi con
  `sorted()`: l'ordine delle feature, `units` e il ripiego di `station_meta` dipendono da questo), derivate (un `import derive` in testa, il
  `try` resta attorno al calcolo), serie, mappa, `units.json`, cursore (`comune.now_solar`, `comune.is_dst_solar`), in
  fondo `iso_datetime(istante)` e `load_coords`. Via: `dedup`/`pub_coords`, x/y, `AQ_FVG`, `--parse-dir`, `-o`,
  `--coords`, `--debug`, l'uscita in `<REGIONE>/web/`, le copie di JSON, numero, cartelle, ora. Ogni `open` con
  `encoding='utf-8'`. La finestra resta su `datetime.datetime.now()` (cambia nel Task 17).
- [ ] **Step 3:** nella prova dell'ora legale `ew._ita_is_dst` → `comune.is_dst_solar` (stessi valori). Run:
  `/usr/bin/python3 -m unittest tests.test_export tests.test_rete.TestExport -v` → OK; `tempo` ≤ 1,1 × T0 del Task 5 (migliore di 3).
  (Nota: `test_fotogrammi_del_cursore` diventerebbe 4 asserzioni su `comune.is_dst_solar`, già provate ora per ora dal
  Task 4: tienila solo se controlla gli epoch dei fotogrammi dell'export, altrimenti toglila e dillo nel resoconto.)
- [ ] **Step 4:** tutte le prove → OK (1 in più). **Commit** "export_web.py: si legge dall'alto in basso, attrezzi da
  comune.py, via dedup, x/y, AQ_FVG e quattro opzioni mai passate (righe prima -> dopo)".

---

### Task 7: `climatology.py`

**Files:** Modify: `climatology.py`

- [ ] **Step 1: riscrivi**: `scan(parse_dir, var, region)` su `comune.day_files`/`load_json`/`value_key` (TEMP:
  min/max/somma/conteggio; PREC: somma), `climate_region()`, `main()`; `comune.save_json`; via `_f`, `jload`,
  `REGIONS`, `meta`, `import datetime`. Regole dei numeri invariate. L'ordine delle stazioni in `climate.json` è quello
  dell'espressione `set(tday) | set(pday)` (fissato da `PYTHONHASHSEED=0`) e i giorni si leggono in ordine crescente:
  tieni l'espressione e l'ordine, una costruzione "più ordinata" cambia ogni `climate.json`.
- [ ] **Step 2:** `/usr/bin/python3 -m unittest tests.test_rete.TestExport -v` → OK; tutte le prove → OK.
- [ ] **Step 3: commit** "climatology.py: un ciclo per TEMP e PREC, attrezzi da comune.py (righe prima -> dopo)".

---

### Task 8: `history.py`

**Files:** Modify: `history.py`, `tests/test_history.py`

**Interfaces:** `process_region(region, cache_dir, full=False, verbose=False, today=None)` (`today` = `'AAAAMMGG'`
solare; `None` → da `comune.now_solar()`); `main()` calcola l'ora una volta e la passa (anche a `index.json`).
`BASE` e `OLD_VEN` restano nomi del modulo (le prove li cambiano).

- [ ] **Step 1: riscrivi**: `list_days` → `comune.day_files`; `load_json`/`save_atomic` → `comune`; `value_key` →
  `comune.value_key`; via `day_add`, `import sys`, `out_dir`, `--from`. `RECENT_DAYS` resta 3 (cambia nel Task 14).
- [ ] **Step 2:** in `tests/test_history.py` solo le chiamate (`run_region`: `process_region(region, self.cache,
  full=full)`; `list_days` → `comune.day_files`), nessuna asserzione cambiata; `test_value_key_per_region` si toglie (diventerebbe
  la copia di `test_value_key` del Task 4: 24 → 23 prove di Storico).
  Run: `/usr/bin/python3 -m unittest tests.test_history tests.test_rete.TestExport -v` → 23 + 3 OK.
- [ ] **Step 3:** tutte le prove → OK (una in meno). `comune.save_json` scrive `ensure_ascii=False`: i byte di
  `history_cache` cambierebbero per un codice stazione non ASCII (nel campione non ce ne sono; `history_out` è ASCII):
  dillo nel resoconto. **Commit** "history.py: attrezzi da comune.py, l'ora presa una volta, via le
  parti morte (righe prima -> dopo)".

---

### Task 9: `recover.py`

**Files:** Modify: `recover.py`, `tests/test_scarico.py`

**Interfaces:** `REGION_MODULE = {'VEN': 'dati_veneto', 'TN': 'dati_trentino', 'BZ': 'dati_altoadige',
'FVG': 'dati_fvg', 'LOM': 'dati_lombardia', 'ER': 'dati_emilia_romagna'}`, moduli con `importlib.import_module`;
`has_hole(parse_dir, variables, days, cadence_min)` e le righe che stampa invariate.

- [ ] **Step 1: riscrivi**: `http_json` → `comune.get_json` (stessi timeout 90/60/45); `jload`/`jsave` → `comune`;
  `now_solar` → `comune`; `collect_archive_istanti` su `comune.day_files`; `flush_points` su `comune.merge_readings`
  (le stazioni nuove si aggiungono a `stazioni.json` come oggi; via la chiave `('*', sc)`); `mod.solar_moment`,
  `mod.VALUE_CONV`, `mod.OPERATORS`, `mod.SKIP_VALUES`, `mod.SKIP_DIR_VALUES` letti direttamente; `_coord_deg` →
  `mod.coordinate`, `_iso_to_istante` → `mod.compact_moment`; via `_bz_istante`, `_er_solar`, `load_module`,
  `n_chunk`, i parametri mai letti; `recover_ven` usa `sorted(mod.VARIABLES)` come gli altri.
- [ ] **Step 2:** la prova dei moduli carica con `importlib.import_module(recover.REGION_MODULE[r])`; in
  `READ_BY_RECOVER` LOM aggiunge `coordinate`, `compact_moment`. Run:
  `/usr/bin/python3 -m unittest tests.test_scarico -k recover -k moduli -v` → OK (giri identici).
- [ ] **Step 3: prova dal vivo** (Review Focus 3): in una copia temporanea (`registratore.copy_project` + il seme di
  `recover/er`), `/usr/bin/python3 recover.py -r ER --force --days 1` → `N > 0` nella riga `punti recuperati e inseriti: N` (è il
  vero controllo: il "codice 0" c'è sempre, `main` prende tutto).
- [ ] **Step 4:** tutte le prove → OK. **Commit** "recover.py: scarica con comune.get_json e scrive in modo atomico,
  legge gli script come moduli, via riserve e copie (righe prima -> dopo)".

---

### Task 10: `check_updates.py`

**Files:** Modify: `check_updates.py`, `tests/test_scarico.py`

**Interfaces:** `REGIONS = {codice: nome del modulo}` (`'AQ_VEN': 'dati_aria'`, `'PC_TN': 'dati_pc'`, …);
`get_or_none(url, params=None, timeout=25)` (`scan_er` passa i parametri senza `urllib.parse.quote`) → `r.content` se `r.ok`, altrimenti `None` (anche su `requests.RequestException`);
`get_json_or_none(url)`.

- [ ] **Step 1: riscrivi**: `get`/`_jget`/`_UA` → `get_or_none`/`get_json_or_none` su `comune.get`; `load_module` → `import`;
  indirizzi dai moduli (`m.VEN_BASE + 'data.json'`, `+ 'stats.json'`, `m.LOM_ANAGRAFICA`, `m.BZ_AIRQUALITY + '/sensors'`,
  `m.TN_URL`, `m.ER_STATIONS_CSV`, `m.FVG_API + '/stations'`, `m.TN_BASE + 'index.json'`: stessi URL di oggi);
  `.tracking/` con `comune.load_json` (dopo `os.path.exists`: un file mancante resta "snapshot iniziale") e
  `save_json`; `tracking.log` con `encoding='utf-8'`; `os.makedirs(TRACK_DIR, exist_ok=True)`; via `import sys`.
- [ ] **Step 2:** la prova dei moduli carica `check_updates.REGIONS`; `READ_BY_CHECK_UPDATES` aggiunge gli indirizzi
  letti. Run: `/usr/bin/python3 -m unittest tests.test_scarico -k check_updates -k moduli -v` → OK.
- [ ] **Step 3: prova dal vivo.** "Codice 0 e `Totale:`" non può fallire (con tutte le fonti che rifiutano il nuovo
  User-Agent `check_updates` stampa lo stesso `Totale:` con 0 stazioni). Lancia invece, nello stesso minuto, il
  `check_updates.py` del commit di partenza (`git show <commit di partenza>:check_updates.py`) e il nuovo in due copie
  temporanee, senza `.tracking/`: `/usr/bin/python3 check_updates.py -r all --sample 3` in ciascuna; le righe
  `stazioni: N (snapshot iniziale creato)` devono coincidere regione per regione.
  (Con il formato compatto di `.tracking/` il `decoded` del Task 2 conta come prodotti solo gli stati cambiati nel
  contenuto: `test_check_updates` resta verde.)
- [ ] **Step 4:** tutte le prove → OK. **Commit** "check_updates.py: scarica con comune.get, indirizzi presi dagli
  script, stato scritto in modo atomico (righe prima -> dopo)".

---

### Task 11: `publish.sh`

**Files:**
- Create: `status.py`, `delta_names.py`, `tests/test_pubblica.py`
- Modify: `publish.sh`; Rename: `watchdog_actions.yml` → `watchdog.yml`

**Interfaces:**
- `status.py`: `build_status(site_dir, logs_dir, backup_root)` → il dizionario di oggi (`latest`, `regions`, `backup`);
  `main()` lo scrive in `site/STATUS/status.json` solo se `latest` non è vuoto, con `json.dump(out, fp)` ai valori
  predefiniti (separatori `", "`/`": "`, escape ASCII) in un `.tmp` e poi `os.replace`: il file pubblicato sul ramo
  `data` (banner del sito, avvisi) resta identico byte per byte; NON `comune.save_json` (compatto, cambierebbe l'uscita
  e la rete bash, che confronta `status` decodificato, non lo vedrebbe);
  `BACKUP_ROOT = '/mnt/usb/backup'`.
- `delta_names.py`: il Python di `DELTA_PY` così com'è (stdin `git ls-files -s -z`, argomento la mappa dei nomi,
  stdout le righe per `git mktree`), con in testa il commento sui "name hash" spostato da `publish.sh`.

- [ ] **Step 1: prova di `status.py`** (prima rossa) in `tests/test_pubblica.py`: `test_stato_regioni_e_backup` (due
  `stations.geojson` con `latest_time`, una stazione più vecchia di 3 ore, un log di backup con righe
  `ERRORE: a -- b` e `ATTENZIONE: c`, una cartella di versioni) → `latest`, `regions[...]['old']`, `backup.last`,
  `backup.warn == ['a', 'c']`. Run: `/usr/bin/python3 -m unittest tests.test_pubblica -v` → FAIL.
- [ ] **Step 2: scrivi** `status.py` e `delta_names.py`; in `publish.sh`: `python3 status.py || echo "ATTENZIONE:
  status.json non aggiornato"`, `python3 "$BASE/delta_names.py" "$DATA_GIT/delta-map"`; via il ripiego del segnaposto,
  il controllo di `REMOTE` vuoto, `HEALTHCHECK_URL` e la sua riga, i commenti superati; avvisi in una lista
  (`for f in watchdog.yml watchdog_backup.yml`) per l'impronta della pagina e per la copia in `.github/workflows/$f`
  (`git mv watchdog_actions.yml watchdog.yml`, contenuto invariato: i commenti dello schema che lo nominano si
  aggiornano nel Task 15, che cambia la pagina comunque).
- [ ] **Step 3:** `/usr/bin/python3 -m unittest tests.test_pubblica tests.test_rete.TestBash -v` → OK (`bash.json`
  identico: stesso albero di `gh-pages`, stessa impronta della pagina, `status` uguale decodificato). Controllo in più,
  a mano, perché la rete non lo vede: con lo stesso sito, il `status.json` scritto da `status.py` e quello del codice
  di partenza hanno gli stessi byte (`cmp`).
- [ ] **Step 4:** tutte le prove → OK (1 in più). Il commit nomina `watchdog_actions.yml` e `watchdog.yml` (`git mv`).
  **Commit** "publish.sh: il Python incollato va in status.py e
  delta_names.py, via le parti morte, gli avvisi con il loro nome (righe prima -> dopo)".

---

### Task 12: `deploy.sh`, `crontab_regioni.txt`, `README.md`

**Files:** Create: `deploy_exclude.txt`; Modify: `deploy.sh`, `crontab_regioni.txt`, `README.md`

- [ ] **Step 1: `deploy_exclude.txt`** = le esclusioni di oggi, una per riga, con un commento per gruppo; `deploy.sh`:
  `rsync -av --exclude-from "$SRC_DIR/deploy_exclude.txt" ...`; via il blocco delle "prime raccolte" (restano crontab
  fra i marcatori e il controllo di `python3`/`flock`); intestazione aggiornata.
- [ ] **Step 2: crontab**: via la riga commentata "solo export"; commenti superati (impostare `REMOTE`, `which bash`)
  corretti. **README**: elenco dei programmi (anche `climatology.py`, `history.py`, `recover.py`, `status.py`,
  `backup_usb.sh`, `deploy.sh`), pubblicazione com'è oggi (rami `data`, `gh-pages`, `history`, chiave SSH del Pi). Il
  README non nomina ancora i cambi dei Task 14, 15 e 17 (finestra dello Storico, avviso dello Storico, niente CSV):
  quei task lo aggiornano se citano questi punti.
- [ ] **Step 3: verifica.** Run: `bash -n deploy.sh && /usr/bin/python3 -m unittest tests.test_rete.TestDeploy -v` → OK
  (stesso elenco); `git diff -U0 HEAD -- crontab_regioni.txt` → ogni riga cambiata comincia con `#` o è vuota (cambiano solo commenti).
- [ ] **Step 4:** tutte le prove → OK. **Commit** "deploy.sh con le esclusioni in un file e senza le prime raccolte;
  crontab e README aggiornati".

---

### Task 13: rimasugli degli script di scarico — `slug` e `fetch` una volta sola

**Files:** Modify: `comune.py`, `dati_laghi.py`, `dati_aria.py`, `dati_mare.py`, `dati_altoadige.py`,
`dati_trentino.py`, `dati_fvg.py`, `tests/test_comune.py`

**Interfaces:** `comune.slug(name, empty='staz')`; `comune.save_url(url, path)`: salva in `path` il corpo di `url`
qualunque sia lo stato HTTP e lo restituisce; un errore di rete (`requests.RequestException`) ferma il giro con
`sys.exit('Error downloading <url>: <errore>')`, come le tre copie di oggi.

- [ ] **Step 1:** prove (prima rosse): `test_slug` (`slug('Lago di Garda')` → `'Lago_di_Garda'`; `slug('')` →
  `'staz'`; `slug(None, 'lago')` → `'lago'`); `test_save_url` (server locale: un 404 si salva e si restituisce; una
  connessione rifiutata → `SystemExit` con `Error downloading`, con `time.sleep` sostituito per il nuovo tentativo).
- [ ] **Step 2:** scrivi i due attrezzi; `dati_laghi.py` (con `'lago'`), `dati_aria.py`, `dati_mare.py` usano
  `comune.slug`; `dati_altoadige.py`, `dati_trentino.py`, `dati_fvg.py` usano `comune.save_url`; via le loro copie
  (`dati_veneto.py` tiene la sua `fetch`). Run:
  `/usr/bin/python3 -m unittest tests.test_comune tests.test_scarico -v` → OK (giri di scarico identici).
- [ ] **Step 3:** tutte le prove → OK (2 in più). **Commit** "comune.slug e comune.save_url al posto delle copie negli
  script di laghi, aria, mare, Alto Adige, Trentino e FVG".

---

### Task 14: rinforzo — Storico a 8 giorni; file rovinati saltati e detti

**Files:** Create: `tests/test_archivio.py`; Modify: `history.py`, `export_web.py`, `climatology.py`,
`tests/test_history.py`, `crontab_regioni.txt` (e `README.md` se cita la finestra dello Storico)

- [ ] **Step 1: prove** (prima rosse). In `tests/test_history.py`, `test_recent_window_is_three_days` diventa
  `test_finestra_otto_giorni`: `today='20261105'`, file PREC di `20261028` (G-8) e `20261027` (G-9); primo giro, poi
  valori cambiati in entrambi; secondo giro con lo stesso `today` → `20261028` ricalcolato, `20261027` dalla cache,
  `n == 1`. Per passare `today` il `run_region` della prova prende `today=None` e lo gira a `process_region`. In `tests/test_archivio.py` un archivio minimo con un giorno buono e tre file rovinati (record lista;
  `ISTANTE` numero; `MISURE` stringa) per tre prove: `test_export`, `test_climatologia`, `test_storico` → codice 0, i
  dati buoni in uscita, una riga `WARN: file saltato (` con il percorso per ogni file rovinato.
  Run: `/usr/bin/python3 -m unittest tests.test_history tests.test_archivio -v` → FAIL.
- [ ] **Step 2: scrivi**: `RECENT_DAYS = 8` (commento con il perché della spec: `recover.py` a 7 giorni, giro delle
  18:40); nei tre programmi il lavoro su un file va in una funzione, chiamata dentro un `try` che stampa
  `WARN: file saltato (<motivo>): <percorso>` e va avanti. Intestazione di `history.py` e commento del cron delle 07:20:
  "gli ultimi 8".
- [ ] **Step 3:** stessa riga → OK; `tests.test_rete.TestExport` → OK (impronte invariate).
- [ ] **Step 4:** tutte le prove → OK (3 in più). **Commit** "Storico: ricalcola gli ultimi 8 giorni (bordo provato);
  export, climatologia e Storico saltano un file rovinato e lo dicono".

---

### Task 15: rinforzo — lo Storico nello stato e il suo avviso

**Files:** Create: `watchdog_storico.yml`; Modify: `status.py`, `publish_history.sh`, `publish.sh`, `watchdog.yml`,
`watchdog_backup.yml`, `tests/test_pubblica.py`, `tests/fixtures/rete/bash.json` (e `README.md` se cita gli avvisi)

- [ ] **Step 1: prove** (prima rosse) in `tests/test_pubblica.py`: `test_stato_dello_storico` (con
  `.tracking/last_history_hash` → `history.last` = la sua ora di modifica `AAAA-MM-GGThh:mm`; senza → `''`);
  `test_avviso_storico` (il Python di `watchdog_storico.yml` estratto e lanciato con `urlopen` sostituito: `last` di oggi
  (data vera) → codice 0 e `::notice title=storico ok::`; 3 giorni fa → codice 1 e `::error title=storico off::`;
  `history` assente → 1).
- [ ] **Step 2: scrivi**: `build_status(site_dir, logs_dir, backup_root, history_hash)` aggiunge
  `"history": {"last": ...}` (la prova del Task 11 passa anche il quarto argomento; il file continua a scriversi con `json.dump` predefinito, vedi
  Task 11); `publish_history.sh` fa
  `touch .tracking/last_history_hash` nel ramo "invariato"; `watchdog_storico.yml` con lo schema comune degli altri
  due ('Warning - storico off', `cron: '35 8 * * *'`, `SOGLIA_GIORNI = 2`, prova con `prova`); il blocco Python "comune" resta copiato tal quale nei tre avvisi (è lo schema di oggi: ogni
  avviso deve bastare a sé su `gh-pages`, non da unificare); il commento dello schema
  nei tre avvisi nomina `watchdog.yml`, `watchdog_backup.yml`, `watchdog_storico.yml`; `publish.sh` aggiunge il nuovo
  alla lista degli avvisi.
- [ ] **Step 3: attesi voluti.** `/usr/bin/python3 tests/rete.py attesi bash`; `git diff tests/fixtures/rete/bash.json`
  deve mostrare solo: `history` in `status`; in `pagina` il nuovo `watchdog_storico.yml` e i blob di `watchdog.yml` e
  `watchdog_backup.yml` (commento dello schema); `last_page_hash`; `hash_aggiornato` vero nello scenario "invariato"
  dello Storico. Altro → fermati e capisci.
- [ ] **Step 4:** tutte le prove → OK (2 in più). **Commit** "Lo Storico nello stato del sito e il suo avviso 'Warning -
  storico off'".

---

### Task 16: rinforzo — backup senza lo Storico; deploy senza gli zeri scritti dal Pi

**Files:** Modify: `backup_usb.sh`, `deploy_exclude.txt`, `tests/fixtures/rete/bash.json`

- [ ] **Step 1:** `backup_usb.sh`: `--exclude='/history_out/' --exclude='/history_cache/'` e il commento in testa;
  `deploy_exclude.txt`: `/PIE/zero_idrometrici.json` e `/PC_PIE/zero_idrometrici.json` (con il perché: li riscrive
  `dati_pc.py` a ogni giro).
- [ ] **Step 2: attesi voluti.** `/usr/bin/python3 tests/rete.py attesi bash`; `git diff` deve mostrare solo: via
  `history_out/…` e `history_cache/…` dalle versioni del backup; via `PIE/zero_idrometrici.json` e
  `PC_PIE/zero_idrometrici.json` dall'elenco del deploy, dove restano VEN, LOM, PC_PO e dove
  `tests/fixtures/pc/PIE/zero_idrometrici.json` non c'era già; e, nelle righe `fatto in Ns: versione …` del backup, il
  numero di file della versione (`<NF> file`, scende perché `history_out/` e `history_cache/` non ci sono più; secondi
  e MB li normalizza già la rete). Altro → fermati e capisci.
- [ ] **Step 3:** `bash -n backup_usb.sh`; tutte le prove → OK. **Commit** "Backup senza history_out e history_cache;
  deploy senza gli zeri idrometrici che il Pi riscrive".

---

### Task 17: cambio voluto — export con la finestra in ora solare e senza `stations_nocoord.csv`

**Files:** Modify: `export_web.py`, `tests/test_export.py`, `tests/fixtures/rete/impronte.txt` (e `README.md` se nomina
`stations_nocoord.csv`)

- [ ] **Step 1: prove** (prima rosse) in `tests/test_export.py`: `test_finestra_in_ora_solare_d_estate` (una stazione
  con TEMP oraria dal 2026-07-01 al 2026-07-10, orologio fermo a `1783677600` = 2026-07-10 10:00 UTC → la prima riga
  della serie è `2026-07-03T12:00`, cioè ora solare 11:00 = adesso solare meno 7 giorni; oggi è `2026-07-03T13:00`);
  `test_stazioni_senza_coordinate_nel_log` (nessun `stations_nocoord.csv`; nel log la riga
  `Stazioni senza coordinate, non in mappa: 1 (S2)`; la riga esce solo se N > 0, come oggi il CSV).
- [ ] **Step 2: scrivi**: `cutoff = comune.now_solar() - timedelta(days=days)`; via il CSV, la riga del log nomina i codici.
- [ ] **Step 3: attesi voluti.** `/usr/bin/python3 tests/rete.py attesi export`; `git diff --stat
  tests/fixtures/rete/impronte.txt` → 1 riga tolta, quella di `site/FVG/stations_nocoord.csv` (in novembre l'ora
  solare è l'ora civile: nient'altro cambia).
- [ ] **Step 4:** tutte le prove → OK (2 in più). **Commit** "Export: la finestra si taglia in ora solare come
  l'archivio; via stations_nocoord.csv (nessuno lo leggeva), le stazioni senza coordinate nel log".

---

### Task 18: controllo finale

**Files:** nessuno nuovo (correzioni dove il controllo trova qualcosa).

- [ ] **Step 1: un attrezzo una volta sola.** Run:
  `grep -nE "^\s*def (jload|jsave|json_load|json_save|load_json|save_json|save_atomic|_f|_num|to_float|now_solar|_ita_is_dst|is_dst_\w+|create_directory|region_dir|load_module|http_json|_jget|get|list_days|value_key|day_files|merge_readings|day_add|_coord_deg|_iso_to_istante|_bz_istante|_er_solar|slug|save_url)\b" *.py | grep -v '^comune.py'`
  → nessuna riga (30 sul codice di partenza); `grep -ln "^def fetch(url, path)" dati_*.py` → solo `dati_veneto.py`.
- [ ] **Step 2: niente `urllib`, ore in riga, aperture senza codifica.** Run (la shell è zsh: file elencati per esteso):
  `grep -nE "urllib|utcnow\(\) \+" export_web.py derive.py quality.py history.py climatology.py recover.py check_updates.py status.py delta_names.py`
  → nessuna riga;
  `grep -n "open(" export_web.py derive.py quality.py history.py climatology.py recover.py check_updates.py status.py delta_names.py | grep -v "encoding='utf-8'"`
  → nessuna riga.
- [ ] **Step 3: tutte le prove** → OK; `test_python37` passa su ogni `.py` della cartella principale (23 file).
- [ ] **Step 4: righe.** `wc -l export_web.py derive.py quality.py history.py climatology.py recover.py check_updates.py publish.sh publish_history.sh backup_usb.sh status.py delta_names.py`
  contro le 2.589 di partenza; il numero va nel resoconto.
- [ ] **Step 5: note per il passaggio sul Pi** (spec, "Al passaggio sul Pi") riportate nel registro del piano.
- [ ] **Step 6:** commit delle eventuali correzioni (per percorso).
