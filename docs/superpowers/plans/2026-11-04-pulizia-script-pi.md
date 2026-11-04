# Pulizia degli script di scarico del Pi — piano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** i 13 script di scarico diventano semplici e lineari, con gli attrezzi comuni scritti una volta in
`comune.py`, tutti nella cartella principale, e producono esattamente gli stessi file di oggi.

**Architecture:** prima una rete di sicurezza (un registratore che salva le risposte vere di ogni fonte e le
ripete senza rete, con l'orologio fermo, e i file "attesi" prodotti dallo script di oggi); poi `comune.py`; poi una
fonte alla volta, ognuna riscritta e verificata contro i suoi attesi; per ultimo il passaggio sul Pi.

**Tech Stack:** Python 3.7 sul Pi (3.9 sul Mac per le prove), `requests`, `unittest`; `numpy`/`Pillow` solo per il radar.

**Spec:** `docs/superpowers/specs/2026-11-04-pulizia-script-pi-design.md`

## Global Constraints

- Mai toccare il vecchio sistema ARPAV: la cartella `old/` (resta com'è anche nell'indice di git) e, sul Pi,
  `/home/manuel/arpav` con il suo cron e i suoi dati.
- Python 3.7 sul Pi: niente `:=`, niente `zoneinfo`, niente API 3.8+ (`removeprefix`, `removesuffix`,
  `functools.cache`, `math.prod`, `math.dist`), niente annotazioni `X | Y`.
- Nessuna libreria nuova. `requests` sul Pi è vecchia (Buster): niente `requests.JSONDecodeError`; il JSON si
  decodifica sempre da `r.content.decode('utf-8', 'replace')`, mai da `r.text` o `r.json()`.
- Stessi file, stessi nomi, stesse cartelle: per ogni fonte file identici byte per byte agli attesi (unica eccezione
  decisa nel Task 10: i JSON del Veneto).
- Nomi in inglese, commenti in italiano e solo dove spiegano un perché; niente commento per ogni import.
- Ogni script si legge dall'alto in basso: tabelle di impostazioni, `download()`, `parse()`, `main()`; niente classi
  usate come contenitori; niente import doppi.
- Opzioni: restano `-date` e `-c` di `dati_veneto.py`, `-r` delle fonti con più reti, `--full` di `dati_pc.py` e
  `dati_liguria.py`, `--out --no-push --remote` di `dati_radar.py`, `--debug` ovunque; vanno via tutte le altre.
- Ogni file letto o scritto con `encoding='utf-8'` esplicito (il cron gira senza locale).
- Un solo User-Agent per il progetto (`comune.USER_AGENT`), tranne il radar che tiene il suo (identità verso il DPC).
- Log: una riga di titolo con data e ora a ogni giro; avvisi ed errori restano; via le righe "directory … exists".
- Un commit per task (approvato dall'utente il 2026-11-04), messaggio in italiano chiuso da
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; mai push; mai `git add -A` (si aggiungono i file per nome).
- Prove: `/usr/bin/python3 -m unittest discover -s tests -t .` (sul Mac); nessun task finisce con una prova rossa.

## Review Focus

1. Una fonte risponde con un errore o rallenta (HTTP 429, 500, timeout): stessa reazione di oggi (la Lombardia
   riprova e poi esce pulita senza scrivere dati a metà; le altre saltano quella rete e tengono i dati di prima). →
   prove "errore registrato" nei Task 9 (Protezione Civile, 500) e 14 (Lombardia, 429).
2. Il secondo giro, con i file del giro prima già presenti, si fonde esattamente come oggi. → ogni prova di fonte fa
   due giri di fila (procedura del Task 4).
3. Le eccezioni cambiano tipo passando da `urllib` a `requests`: ogni `except` che nomina errori di `urllib` deve
   prendere anche quelli di `requests`. → prova del Task 9 e controllo del Task 17 (nessun `urllib.error` negli script
   convertiti).
4. Python 3.7 sul Pi. → prova `test_python37` del Task 3, rilanciata su tutti gli script nel Task 17.
5. Ciò che la riproduzione non vede (User-Agent unico, `requests` al posto di `urllib`, certificato della fonte Po,
   cookie dei laghi): → una prova dal vivo sul Mac in ogni task di fonte (procedura del Task 4, passo 6).

---

## File

- Crea: `comune.py` (attrezzi comuni), `tests/registratore.py` (registra e ripete), `tests/test_registratore.py`,
  `tests/test_comune.py`, `tests/test_scarico.py` (una prova per fonte), `tests/fixtures/scarico/<fonte>/<giro>/`
  (`ora.json`, `risposte/*.json.gz`, `attesi/…`).
- Sposta nella cartella principale: `VEN/dati_veneto.py`, `FVG/dati_fvg.py`, `TN/dati_trentino.py`,
  `BZ/dati_altoadige.py`, `LOM/dati_lombardia.py`, `ER/dati_emilia_romagna.py`.
- Modifica: i 13 `dati_*.py`, `recover.py` e `check_updates.py` (solo percorsi e letture delle impostazioni),
  `crontab_regioni.txt` (percorsi dei sei regionali), `.gitignore`, `README.md` (dove cita i percorsi).
- Elimina: `dati_consorzi.py`.

---

### Task 1: parti morte e `.gitignore`

**Files:**
- Delete: `dati_consorzi.py`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: niente.
- Produces: `.gitignore` che ignora tutti i dati generati.

- [ ] **Step 1: controlla che nessuno usi `dati_consorzi.py`**

Run: `git grep -n "dati_consorzi" -- ':!docs' ':!old'`
Expected: nessuna riga (né cron, né `recover.py`, né `deploy.sh`, né `check_updates.py`).

- [ ] **Step 2: elimina `dati_consorzi.py`; in `.gitignore` sostituisci le quattro righe `site/VEN/`, `site/BZ/`,
  `site/TN/`, `site/FVG/` con `site/*/` e aggiungi `*/sensors_map.json` e `*/elements_map.json` (cache di `dati_pc.py`)**

- [ ] **Step 3: verifica**

Run: `git status --short --ignored site | head -5; git check-ignore -q site/LOM/x && echo ignorato; /usr/bin/python3 -m unittest discover -s tests -t . 2>&1 | tail -2`
Expected: `site/LOM/x` ignorato; `OK` (57 test).

- [ ] **Step 4: commit**

```bash
git rm -q dati_consorzi.py && git add .gitignore
git commit -m "Via dati_consorzi.py (fonte CB_AE ritirata); .gitignore ignora tutti i dati di site/ e le cache"
```

---

### Task 2: il registratore

**Files:**
- Create: `tests/registratore.py`, `tests/test_registratore.py`

**Interfaces:**
- Consumes: niente.
- Produces (riga di comando, dalla cartella del progetto):
  - `python3 tests/registratore.py registra CARTELLA_GIRO -- SCRIPT [ARGOMENTI…]`: esegue lo script dal vivo in una
    copia temporanea del progetto; salva in `CARTELLA_GIRO/ora.json` (`{"epoch": <float>}`) l'ora di partenza e in
    `CARTELLA_GIRO/risposte/` ogni risposta.
  - `python3 tests/registratore.py attesi CARTELLA_GIRO -- SCRIPT [ARGOMENTI…]`: esegue lo script due volte di fila
    in riproduzione in una copia nuova e salva in `CARTELLA_GIRO/attesi/` tutti i file prodotti (percorsi relativi).
  - in Python: `replay(cartella_giro, script, args, progetto) -> subprocess.CompletedProcess` (un giro in riproduzione
    nella cartella `progetto`), `copy_project(dest) -> None`, `tree(cartella) -> dict` (percorso relativo → bytes,
    esclusi i `*.py`).
- Regole fisse:
  - si intercettano `requests.Session.request` e `urllib.request.OpenerDirector.open` (coprono `requests.get/post`,
    le sessioni, `urlopen` e gli opener con cookie);
  - chiave di una risposta: metodo + URL completo (parametri ordinati) + corpo; più risposte con la stessa chiave
    si ripetono nell'ordine registrato, poi l'ultima;
  - in riproduzione una richiesta non registrata solleva `RuntimeError('risposta non registrata: GET <url>')`; uno
    stato ≥ 400 si restituisce com'era (per `urllib` come `HTTPError`, come farebbe la rete);
  - l'orologio parte da `ora.json` e avanza solo con `time.sleep` (che in riproduzione non aspetta): `time.time`,
    `time.localtime`, `time.gmtime`, `time.strftime`, `datetime.datetime.now/utcnow/today`, `datetime.date.today`;
  - ogni giro è un processo nuovo con `PYTHONHASHSEED=0` e `TZ=Europe/Rome`;
  - `copy_project` copia `comune.py` (se c'è), tutti i `dati_*.py` della cartella principale, i sei script nelle
    cartelle delle regioni (se ci sono ancora) e `*/zero_idrometrici.json`, `FVG/stazioni_coords.csv`;
  - le risposte si salvano compresse (`<chiave>-<n>.json.gz`: metodo, URL, stato, `Content-Type`, corpo in base64).

- [ ] **Step 1: scrivi le prove** in `tests/test_registratore.py`, con un server HTTP locale (`http.server` in un
  thread su `127.0.0.1`, porta libera) che serve `/a.json` (`{"x": 1}`), `/b.txt` (`"àè"` in UTF-8) e `/err` (500), e
  un piccolo script di prova scritto nella cartella temporanea che legge `/a.json` con `requests`, `/b.txt` con
  `urllib`, `/err` con `requests`, dorme 30 s e scrive in `out.json` i tre risultati, `time.time()` e
  `datetime.datetime.now().isoformat()`:

```python
def test_ripete_senza_rete(self):        # registra col server acceso, spegne il server, ripete due volte
    self.assertEqual(out1, out2)
    self.assertEqual(out1['a'], {'x': 1}); self.assertEqual(out1['b'], 'àè'); self.assertEqual(out1['err'], 500)

def test_orologio_fermo(self):           # epoch del giro = ora.json + 30 s di sleep, anche in now()
    self.assertEqual(out1['t'], ora + 30)

def test_richiesta_non_registrata(self): # lo script chiede /nuovo: il giro fallisce e lo dice
    self.assertIn('risposta non registrata: GET http://127.0.0.1', proc.stderr)
```

- [ ] **Step 2: esegui** `/usr/bin/python3 -m unittest tests.test_registratore -v` → FAIL (`tests/registratore.py` non esiste)
- [ ] **Step 3: scrivi `tests/registratore.py`** secondo le regole fisse sopra
- [ ] **Step 4: esegui** la stessa riga → 3 OK; poi tutte le prove → OK
- [ ] **Step 5: commit** `git add tests/registratore.py tests/test_registratore.py` e
  `git commit -m "Prove: registratore delle risposte delle fonti, con orologio fermo"`

---

### Task 3: `comune.py`

**Files:**
- Create: `comune.py`, `tests/test_comune.py`

**Interfaces:**
- Consumes: niente.
- Produces (firme esatte; nessuna annotazione di tipo nel codice, per Python 3.7):
  - `BASE` (cartella di `comune.py`), `USER_AGENT = 'Mozilla/5.0 (compatible; meteo.simulaqua.it)'`
  - `region_dir(code)` → `os.path.join(BASE, code)`
  - `load_json(path)` → il contenuto; `{}` con un avviso stampato se il file manca, è vuoto o è rotto
  - `save_json(data, path, sort_keys=False)` → crea la cartella se manca, scrive `path + '.tmp'` con
    `json.dump(data, fp, ensure_ascii=False, separators=(',', ':'), sort_keys=sort_keys)`, `flush`, `fsync`, `os.replace`
  - `get(url, params=None, headers=None, timeout=60, verify=True)` → `requests.Response` (non solleva per lo stato);
    intestazione `User-Agent: USER_AGENT` salvo `headers` diverso; su `ConnectionError`/`Timeout` aspetta 5 s e
    riprova una volta, poi solleva
  - `get_text(url, params=None, headers=None, timeout=60, verify=True)` → `raise_for_status()`, poi
    `r.content.decode('utf-8', 'replace')`
  - `get_json(url, params=None, headers=None, timeout=60, verify=True)` → `json.loads(get_text(…))`
  - `now_solar()` → `datetime.datetime.utcnow() + datetime.timedelta(hours=1)`
  - `is_dst_civil(dt)` → `True` fra le 02:00 dell'ultima domenica di marzo e le 03:00 dell'ultima domenica di ottobre
    (ora civile in ingresso; la regola delle copie `_ita_is_dst` di oggi)
  - `civil_to_solar(dt)` → stringa `'%Y%m%d%H%M'`, un'ora indietro se `is_dst_civil(dt)`
  - `to_float(v)` → `float` o `None` (per `None`, testo non numerico, NaN)
  - `write_parsed(region_code, stations, readings, units, days=8)` → la funzione delle copie di oggi
    (`dati_pc.py` è il riferimento); `days=None` non scarta le letture vecchie (serve all'aria); stampa
    `[<codice>] stazioni: N | nuove letture inserite: M`
  - `latest_stamp(download_dir, subdirs)` e `delete_downloaded(download_dir, subdirs, stamp, stale_min=None)` → le
    funzioni dei regionali (`latest_datetime_string`, `delete_downloaded`); `stale_min` serve solo al Veneto (90)
- Non c'è `is_dst_solar`: nessuno script di scarico la usa (le copie di oggi sono tutte la regola civile); arriva con
  `export_web.py` nella parte 3.

- [ ] **Step 1: scrivi le prove** in `tests/test_comune.py`:

```python
def test_ora_legale_marzo(self):    # 2026: ultima domenica di marzo = 29
    self.assertEqual([is_dst_civil(datetime(2026, 3, 29, h)) for h in (1, 2, 3)], [False, True, True])
def test_ora_legale_ottobre(self):  # 2026: ultima domenica di ottobre = 25
    self.assertEqual([is_dst_civil(datetime(2026, 10, 25, h)) for h in (1, 2, 3)], [True, True, False])
def test_da_civile_a_solare(self):
    self.assertEqual(civil_to_solar(datetime(2026, 7, 1, 12, 30)), '202607011130')
    self.assertEqual(civil_to_solar(datetime(2026, 12, 1, 12, 30)), '202612011230')
def test_to_float(self):
    self.assertEqual([to_float(x) for x in ('1.5', 2, '', None, 'n.d.', 'nan')], [1.5, 2.0, None, None, None, None])
def test_salva_e_rilegge(self):     # accenti scritti come UTF-8, chiavi ordinate solo se richiesto, niente .tmp
    save_json({'b': 'àè', 'a': 1}, p, sort_keys=True)
    self.assertEqual(open(p, 'rb').read(), '{"a":1,"b":"àè"}'.encode('utf-8'))
def test_carica_mancante_vuoto_rotto(self):
    self.assertEqual([load_json(mancante), load_json(vuoto), load_json(rotto)], [{}, {}, {}])
def test_get_manda_lo_user_agent_e_riprova(self):   # server locale: la prima connessione cade, la seconda risponde
    self.assertEqual(get_json(url), {'x': 1}); self.assertEqual(ua_ricevuto, USER_AGENT)
def test_get_json_errore_http(self):
    with self.assertRaises(requests.HTTPError): get_json(url_500)
def test_write_parsed_fonde_e_scarta(self):   # due giri: le letture si fondono senza doppioni, ordinate;
    ...                                       # quelle più vecchie di days giorni spariscono; days=None le tiene
def test_python37(self):            # comune.py e ogni dati_*.py: sintassi 3.7 e nessuna API 3.8+
    for f in script_python():
        ast.parse(open(f, encoding='utf-8').read(), feature_version=(3, 7))
        self.assertNotRegex(src, r'removeprefix|removesuffix|zoneinfo|functools\.cache\b|math\.(prod|dist)')
```

- [ ] **Step 2: esegui** `/usr/bin/python3 -m unittest tests.test_comune -v` → FAIL (`No module named 'comune'`)
- [ ] **Step 3: scrivi `comune.py`** secondo le firme; il corpo di `write_parsed`, `latest_stamp` e `delete_downloaded`
  si prende dalle copie di oggi così com'è (solo i nomi degli attrezzi cambiano)
- [ ] **Step 4: esegui** la stessa riga → tutti OK; poi tutte le prove → OK
- [ ] **Step 5: commit** `git add comune.py tests/test_comune.py` e `git commit -m "comune.py: gli attrezzi condivisi dagli script di scarico, con le loro prove"`

---

### Task 4: procedura per una fonte — prima fonte, `dati_laghi.py`

Questa procedura vale per ogni fonte (Task 5–15); i task successivi dicono solo cosa cambia.

**Files:**
- Create: `tests/test_scarico.py`, `tests/fixtures/scarico/laghi/normale/`
- Modify: `dati_laghi.py`

**Interfaces:**
- Consumes: `tests/registratore.py` (Task 2), `comune.py` (Task 3).
- Produces: in `tests/test_scarico.py` l'aiuto `check_source(self, fonte, giro, script, args, json_equal=False)`: copia
  il progetto in una cartella temporanea, fa due giri in riproduzione e confronta `tree()` con gli attesi
  (byte per byte; con `json_equal=True` i `.json` si confrontano decodificati); e la prova `test_laghi`.

- [ ] **Step 1: registra un giro vero con lo script di oggi**

Run: `/usr/bin/python3 tests/registratore.py registra tests/fixtures/scarico/laghi/normale -- dati_laghi.py`
Expected: lo script finisce con codice 0; `du -sh tests/fixtures/scarico/laghi` stampa la dimensione.
**Ferma e chiedi all'utente** se una fonte supera 20 MB compressi: finirebbe nella storia del repository.

- [ ] **Step 2: produci gli attesi con lo script di oggi**

Run: `/usr/bin/python3 tests/registratore.py attesi tests/fixtures/scarico/laghi/normale -- dati_laghi.py`
Expected: `attesi/LAGHI/data-parsed/…` presenti.

- [ ] **Step 3: scrivi la prova** `test_laghi` → `self.check_source('laghi', 'normale', 'dati_laghi.py', [])`; esegui
  `/usr/bin/python3 -m unittest tests.test_scarico -v` → PASS sullo script di oggi. Poi **guardala fallire**: cambia
  un byte di un file in `attesi/`, riesegui → FAIL che nomina quel file; ripristina con `git checkout` / riscrivendo
  il file, riesegui → PASS.

- [ ] **Step 4: riscrivi `dati_laghi.py`** con `comune.py` e le regole dei Global Constraints:
  - via le copie di `jload`, `jsave`, `to_float`, `now_solar`, `write_parsed`, `http_*`: si usano quelle di `comune`;
  - i cookie: una `requests.Session()` con `headers['User-Agent'] = USER_AGENT` al posto di `http.cookiejar`;
  - ogni `except` che nomina errori di `urllib` prende `requests.RequestException`;
  - via il `-r` "(compat)"; la logica propria della fonte resta com'è.

- [ ] **Step 5: esegui** `/usr/bin/python3 -m unittest tests.test_scarico tests.test_comune -v` → PASS (file identici);
  poi tutte le prove → OK.

- [ ] **Step 6: prova dal vivo** (Review Focus 5): esegui lo script nuovo dal vivo in una copia temporanea
  (`copy_project`, poi `python3 dati_laghi.py`) → codice 0 e, nei file interpretati, un numero di stazioni pari a
  quello degli attesi ± 5%.

- [ ] **Step 7: commit**

```bash
git add tests/test_scarico.py tests/fixtures/scarico/laghi dati_laghi.py
git commit -m "dati_laghi.py con comune.py: <righe prima> -> <righe dopo>, file identici sulle risposte registrate"
```

---

### Task 5: `dati_invasi.py`

Procedura del Task 4 con `fonte='invasi'`, giro `normale`, argomenti `-r all`. Via il suo `http_json` (diventa
`comune.get_json`).

### Task 6: `dati_liguria.py`

Procedura del Task 4 con due giri registrati: `normale` (nessun argomento) e `full` (`--full`); una prova per giro.

### Task 7: `dati_mare.py`

Procedura del Task 4 con due giri: `reti` (`-r VEN,ER,FVG`) e `acqven` (`-r ACQVEN`), come nel cron. Via il `-c`
"(compat)".

### Task 8: `dati_aria.py`

Procedura del Task 4, giro `normale`, `-r all`. `write_parsed(…, days=None)`; l'unità che oggi viene da
`units.get(var, POLLUTANTS.get(var))` si passa già pronta nel dizionario `units`. Via il `-c` "(compat)".

### Task 9: `dati_pc.py`

Procedura del Task 4 con due giri: `tutte` (`-r all`) e `pie_full` (`-r PIE --full`).
- La fonte Po: `verify=False` (certificato incompleto, come oggi) senza stampare l'avviso di `urllib3` a ogni giro;
  l'accesso anonimo resta com'è.
- `utc_epoch_to_solar` resta in questo script (lo usa solo lui).
- **Errore registrato** (Review Focus 1 e 3): un terzo giro `tutte_500`, copia di `tutte` in cui una risposta di una
  rete è sostituita a mano con stato 500: lo script di oggi e quello nuovo producono gli stessi file (le altre reti
  scritte, quella rete con i dati di prima) e lo stesso codice di uscita. Gli attesi si fanno con lo script di oggi
  prima di riscriverlo.

### Task 10: `dati_veneto.py` (si sposta nella cartella principale)

Procedura del Task 4 con due giri: `oggi` (`-date t`) e `ieri` (`-date y`), come nel cron. In più:
- `git mv VEN/dati_veneto.py dati_veneto.py`; le cartelle dei dati con `region_dir('VEN')`;
- le 11 classi diventano le tabelle `STATION_LISTS` e `VARIABLES` della spec; `directory.parse` diventa `PARSE_DIR`;
- **JSON del Veneto**: oggi è l'unico che scrive gli accenti come `à`; con `comune.save_json` li scrive in UTF-8
  come tutti. Contenuto identico, byte diversi: la prova usa `json_equal=True` (decisione del piano, da dire
  all'utente nel resoconto);
- `delete_downloaded(…, stale_min=90)`;
- `recover.py`: percorso nuovo in `REGION_FILE`, letture `mod.PARSE_DIR` e `mod.VARIABLES`; `-date A M G -c no` resta;
- `check_updates.py`: percorso nuovo in `REGIONS`, letture `m.BASE_URL`, `m.STATION_LISTS`, `m.VARIABLES`;
- in `tests/test_scarico.py` la prova `test_moduli_letti_da_recover_e_check_updates`: carica i moduli dai percorsi
  di `recover.py` e `check_updates.py` e controlla che ogni nome che quei due leggono per il Veneto esista (l'elenco
  si scrive leggendo `recover.py` e `check_updates.py` mentre si converte); i task 11–15 ci aggiungono le loro regioni;
- `crontab_regioni.txt`: le due righe del Veneto con `$BASE/dati_veneto.py`.

### Task 11: `dati_fvg.py` (si sposta)

Come il Task 10 (spostamento, tabelle, `recover.py`/`check_updates.py`, prova dei moduli, riga del cron), giro
`normale`. `FVG/stazioni_coords.csv` resta nella cartella `FVG/` e si legge da `region_dir('FVG')`.

### Task 12: `dati_trentino.py` (si sposta)

Come il Task 11, giro `normale`. Oggi scarica senza User-Agent e senza tempo massimo: con `comune.get` li riceve.

### Task 13: `dati_altoadige.py` (si sposta)

Come il Task 11, giro `normale`. I nomi tedeschi delle stazioni sono la prova degli accenti in UTF-8.

### Task 14: `dati_lombardia.py` (si sposta)

Come il Task 11, giro `normale`, registrato **una volta sola** (la fonte limita le chiamate anonime); la prova dal
vivo almeno 30 minuti dopo la registrazione. La cache giornaliera dell'anagrafica resta com'è.
- I tentativi ripetuti sul 429 restano nello script (non in `comune.get`).
- **Errore registrato** (Review Focus 1): un secondo giro `429`, copia di `normale` con la prima risposta dei dati a
  stato 429 ripetuto: lo script di oggi e quello nuovo fanno gli stessi tentativi (l'orologio virtuale li conta),
  escono puliti, stessi file, stesso codice di uscita.

### Task 15: `dati_emilia_romagna.py` (si sposta)

Come il Task 11, giro `normale`.

### Task 16: `dati_radar.py`

Niente registrazione: le sue 54 prove esistenti fanno da rete. Si sostituiscono `jsave` e gli scarichi GET con
`comune.save_json` e `comune.get`; la sua chiamata POST resta sua (unico posto), con il suo User-Agent e `origin`.
Opzioni e comportamento invariati.

- [ ] **Step 1:** `/usr/bin/python3 -m unittest tests.test_dati_radar -v` → 54 OK prima di toccare
- [ ] **Step 2:** riscrivi; **Step 3:** stessa riga → 54 OK; tutte le prove → OK
- [ ] **Step 4: commit** `git add dati_radar.py` e `git commit -m "dati_radar.py con comune.py: <righe prima> -> <righe dopo>"`

---

### Task 17: controllo finale

**Files:** nessuno nuovo (eventuali correzioni dove il controllo trova qualcosa).

- [ ] **Step 1: un attrezzo una volta sola** (criterio 2 della spec)

Run: `grep -nE "^def (jsave|jload|json_save|json_load|to_float|now_solar|http_json|http_get|http_text|write_parsed|create_directory|_ita_is_dst|civil_to_solar|latest_datetime_string|delete_downloaded|class_parsing|date_time_string|title_date_time_now)\b" dati_*.py`
Expected: nessuna riga.

- [ ] **Step 2: niente `urllib` negli script convertiti** (Review Focus 3)

Run: `grep -n "urllib" dati_*.py`
Expected: nessuna riga.

- [ ] **Step 3: le cartelle delle regioni hanno solo dati**

Run: `ls */dati_*.py 2>/dev/null | grep -v '^old/'`
Expected: nessuna riga.

- [ ] **Step 4: tutte le prove** — Python: `/usr/bin/python3 -m unittest discover -s tests -t .` → OK; sito (per i
  file che il sito legge): `python3 tests/web/setup.py` e le pagine `it_local.html?suite=cursor`,
  `it_local.html?suite=hover` → tutte verdi; poi `python3 tests/web/setup.py --clean`.

- [ ] **Step 5: righe prima e dopo** (criterio 5): `wc -l dati_*.py comune.py` contro le 5.864 righe di partenza;
  il numero va nel resoconto.

- [ ] **Step 6: commit** delle eventuali correzioni (`git add` per nome).

---

### Task 18: passaggio sul Pi

**Fermati e chiedi all'utente** il permesso e di accendere Tailscale sul Mac; senza, il task non parte.

- [ ] **Step 1: copia di riserva** sul Pi (legge soltanto): `ssh pitail 'cd ~/METEO && d=~/backups/pulizia-$(date +%Y%m%d-%H%M) && mkdir -p $d && cp -p --parents dati_*.py */dati_*.py recover.py check_updates.py crontab_regioni.txt $d/; crontab -l > $d/crontab.txt; find $d -type f | wc -l'`
  → 13 script, `dati_consorzi.py`, `recover.py`, `check_updates.py`, `crontab_regioni.txt`, `crontab.txt`.
- [ ] **Step 2: in un minuto libero dal cron** (per esempio hh:58-hh:59 o hh:10-hh:11; mai durante `publish.sh` a
  hh:05/15/…): `./deploy.sh` (copia il codice e sostituisce solo il blocco METEO del crontab).
- [ ] **Step 3: via le vecchie copie** sul Pi: `ssh pitail 'cd ~/METEO && rm -v VEN/dati_veneto.py FVG/dati_fvg.py TN/dati_trentino.py BZ/dati_altoadige.py LOM/dati_lombardia.py ER/dati_emilia_romagna.py dati_consorzi.py'`
  (i dati delle cartelle restano; `old/` e `/home/manuel/arpav` non si toccano).
- [ ] **Step 4: il resto del crontab è invariato**: `ssh pitail crontab -l | sed '/# >>> METEO/,/# <<< METEO/d'`
  confrontato con la stessa parte della copia di riserva → identico (comprese le righe del vecchio sistema ARPAV).
- [ ] **Step 5: primo giro di ogni fonte**: dopo un'ora, l'ultimo log di ogni fonte senza `Traceback`/`ERRORE`
  (`ssh pitail 'cd ~/METEO && for f in $(ls -t logs/*.log */logs/*.log | head -40); do grep -l "Traceback\|ERRORE" $f; done'` → nessun file)
  e i dati freschi sul sito (`site/STATUS/status.json` sul branch `data`).
- [ ] **Step 6: aggiorna la memoria** del progetto (script nella cartella principale, `comune.py`) e chiudi.
