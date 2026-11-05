# Pulizia del codice, parte 3 — export e pubblicazione (design)

Data: 2026-11-05 · Stato: punto 4 del programma dei 5 punti. L'utente ha dato il via a tutti i punti il 2026-11-05
("procedi con tutti e 5 i punti, in ordine ... automaticamente"): il disegno lo rivede il controllore; le voci di
"Da decidere" vanno all'utente.

## Richiesta

Testuale (2026-11-04): "alla fine, fai un controllo di tutto il framework eliminando parti morte o inutili, e fai un
refactoring spinto per semplificare il tutto. ragiona come un programmatore umano, non come una ai. il codice deve
essere comprensibile e lineare".

Parti 1-2 (13 script di scarico e `comune.py`): fatte, sul Pi dal 2026-11-05. Questa è la parte 3. La parte 4
(`site/index.html`, `site/radar.js`) viene dopo, con la sua spec. Modello: `2026-11-04-pulizia-script-pi-design.md`.

## Cosa entra

- I dieci programmi che dall'archivio fanno il sito e lo pubblicano: `export_web.py`, `derive.py`, `quality.py`,
  `climatology.py`, `history.py`, `recover.py`, `check_updates.py`, `publish.sh`, `publish_history.sh`, `backup_usb.sh`.
- Ciò che i loro cambi toccano: `comune.py`, `deploy.sh`, `crontab_regioni.txt`, `README.md`, gli avvisi GitHub
  (`watchdog_*.yml`), i test.
- I rinforzi lasciati dalle revisioni del 2026-11-05 (Storico, pulizia 1-2): sezione "Rinforzi".

## Fuori ambito

- **Il vecchio sistema ARPAV**: `old/` (nel checkout principale sta nell'indice di git) e, sul Pi, `/home/manuel/arpav`,
  `/home/manuel/dati/arpav/live`, `~/METEO/old` e le loro righe di cron. Non si toccano, neanche nei commit.
- **Il passaggio sul Pi**: avviene nella pubblicazione unica alla fine del programma; qui solo le note che le servono.
- **Il sito** (parte 4), compresa la voce `AQ_FVG` rimasta nell'elenco delle fonti della pagina.
- **Gli script di scarico**, salvo due attrezzi ancora doppi (`slug`, `fetch`: rimasugli, sotto).
- **Le regole dei numeri**: formule di `derive.py`, aggregati di `climatology.py` e `history.py`, soglie di
  `quality.py` e del controllo dei buchi di `recover.py`.
- **I difetti di dati e fonti** già noti (Lombardia 429, ore FVG, i 47 file VEN dello Storico senza PREC/TEMP sul sito,
  peso del ramo `history` su jsDelivr).
- `deploy.sh` che copia anche `old/`: deciso nella revisione finale delle parti 1-2 (sul Pi è identica e non si tocca).
- `check_size.sh`, `watchdog_mac.sh`: strumenti a mano, non pubblicano.
- Nuove librerie. Sul Pi: Python 3.7 (niente `zoneinfo`), `requests` 2.21, bash 5, git 2.20.

## Oggi (misurato il 2026-11-05)

- **Righe**: 2.589 in tutto. `export_web.py` 545, `recover.py` 428, `check_updates.py` 313, `derive.py` 299,
  `history.py` 290, `publish.sh` 279, `climatology.py` 182, `backup_usb.sh` 141, `quality.py` 74, `publish_history.sh` 38.
  93 funzioni nei sette file Python.
- **Lo stesso attrezzo scritto più volte** (oltre a quello che `comune.py` ha già):

| Attrezzo | Copie oggi | Differenze che contano |
|---|---|---|
| leggere un JSON | 5: `comune.load_json`, `export_web.json_load`, `climatology.jload`, `history.load_json`, `recover.jload` | `.gz` sì/no; file rotto → avviso+`{}`, `{}`, `None`, eccezione |
| scrivere un JSON | 7: `comune.save_json`, `export_web.json_save`, `history.save_atomic`, `recover.jsave`, in riga in `climatology.py`, `check_updates.py` e nello stato di `publish.sh` | 3 senza scrittura atomica: `recover.py` scrive così **dentro l'archivio** |
| numero da un testo | 5: `comune.to_float`, `quality.to_float`, `derive._f`, `climatology._f`, `export_web._num` | `_num` lascia passare NaN |
| ora solare adesso | 5: `comune.now_solar`, `recover.now_solar`, 3 volte in riga (`export_web`, `history` ×2) | — |
| ora legale su ora solare | 1: `export_web._ita_is_dst` | la spec 1-2 la manda in `comune.py` con questa parte |
| file giornalieri di una variabile | 4 modi: `export_web`, `climatology` (due glob), `history.list_days`, `recover` | con `.json` e `.json.gz` dello stesso giorno: solo lo Storico sceglie |
| chiave del valore (`VM`/`VALORE`) | 3: tabella di `export_web`, `history.value_key`, doppio tentativo di `climatology` | — |
| fondere letture nei file del giorno | 2: `comune.write_parsed`, `recover.flush_points` | stesso algoritmo |
| scaricare | 2 copie con `urllib` (`recover.http_json`, `check_updates.get`/`_jget`) | due User-Agent in più contro la regola del User-Agent unico |
| caricare uno script di scarico | 2: `recover.load_module`, `check_updates.load_module` | dalle parti 1-2 gli script sono nella stessa cartella: basta `import` |
| aiuti degli script di scarico | `recover`: `_coord_deg` = `dati_lombardia.coordinate`, `_iso_to_istante` = `dati_lombardia.compact_moment` | — |
| indirizzi delle fonti | `check_updates`: 7 URL riscritti, già costanti in `dati_aria.py`/`dati_pc.py` | — |
| dentro un file | `derive`: `put` 3 volte, `_station_alt`/`_lat_of` stesso ciclo; `climatology`: `_scan_temp`/`_scan_prec` stesso ciclo | — |

- **Parti morte** (nessun chiamante, o condizione mai vera):
  - `export_web.py`: il ramo `dedup` e `pub_coords` (nessuna regione ha `dedup`); le colonne x/y delle stazioni senza
    coordinate (nessuna regione ha `x`); `AQ_FVG` (nessuno script lo scrive: "SKIP AQ_FVG" in ogni log del publish);
    le opzioni `--parse-dir`, `-o/--out-dir` (con l'uscita in `<REGIONE>/web/`), `--coords`, `--debug` (cron,
    `publish.sh` e `deploy.sh` passano solo `-r --site-dir --days --series-dir --series-only`); il parametro `region`
    di `iso_datetime` e `write_snapshots`; `import os` due volte; `import derive` dentro il ciclo delle stazioni.
    `stations_nocoord.csv`: scritto (oggi solo FVG, 1 stazione nel campione), letto da nessuno (né il sito né un programma).
  - `derive.py`: `DERIVED_CAT` (mai letto, neanche dal sito), la variabile `vals`.
  - `history.py`: `day_add` (mai chiamata), `import sys`, il parametro `out_dir` di `process_region`, l'opzione `--from`.
  - `climatology.py`: `REGIONS = None`, `import datetime`, la variabile `meta`.
  - `recover.py`: `n_chunk`; i parametri `region` e `debug` di `recover_ven`, `debug` di `recover_windowed`; la ricerca
    dell'unità con chiave `('*', stazione)` (nessuno la scrive); i valori di riserva letti con `getattr` (`_bz_istante`,
    `_er_solar` non servono mai: i moduli hanno `solar_moment`; e se un nome sparisse, `recover.py` userebbe senza dirlo
    riserve sbagliate: il suo `SKIP_VALUES` non scarta -999).
  - `check_updates.py`: `import sys`.
  - `publish.sh`: il ripiego sul segnaposto di `REMOTE` e il controllo di `REMOTE` vuoto (è fisso); `HEALTHCHECK_URL`
    vuoto, cioè spento (gli avvisi li fanno i workflow GitHub); commenti sul credential store e sugli indirizzi HTTPS.
  - `crontab_regioni.txt`: la riga commentata "solo export, senza publish".
  - `deploy.sh`: il blocco delle "prime raccolte" (a ogni deploy lancia tutti gli scarichi, l'export e la climatologia,
    in parallelo al cron; nelle due ultime copie sul Pi è stato saltato a mano).
- **Fragilità**:
  - un `.json.gz` rovinato (`zlib.error`, non preso da nessuno): ferma lo Storico ogni notte, l'export a 30 giorni ogni
    ora, la climatologia di quella regione;
  - un JSON valido ma di forma sbagliata (un record lista, un istante numero): ferma `history.py` e `export_web.py`,
    cioè anche `publish.sh` e il sito;
  - `recover.py` scrive i file del giorno senza scrittura atomica;
  - 13 aperture di file di testo senza `encoding='utf-8'` (5 `export_web`, 2 `recover`, 3 `check_updates`, 3 `publish.sh`);
  - `export_web.py` taglia la finestra con `datetime.now()` (ora civile) su istanti in ora solare: d'estate i 7 giorni
    cominciano un'ora dopo;
  - una coordinata NaN finirebbe come `NaN` in `stations.geojson`: JSON non valido, la regione sparisce dalla mappa.
- **Prove**: 136 (nessuna su `export_web`, `climatology`, `recover`, `check_updates` e sui bash, salvo 3 sull'ora legale
  dell'export e la prova che i nomi letti da `recover`/`check_updates` esistano). `test_history.py` ne ha 24.
- **Campione per le prove**: gli attesi delle prove di scarico (`tests/fixtures/scarico/*/<giro>/attesi/`, già nel
  repository) formano un archivio di 22 regioni, 1-10 giorni. Con l'orologio fermo al 2026-11-05 13:00 UTC: export
  7 giorni 33 s, export 30 giorni 24 s, climatologia 0,5 s, Storico 1,7 s sul Mac; uscita 51 MB (6.387 file nel sito,
  1.751 nello Storico), identica byte per byte fra due giri anche con un altro `PYTHONHASHSEED`.
- **Mac contro Pi**: sul Mac mancano `flock`, `mountpoint`, `ionice`, `head -n -N`, `df --output`; `rsync` è openrsync;
  bash è la 3.2 (con `set -u` un array vuoto è un errore: il primo backup in assoluto non gira).

## Come sarà

### `comune.py`: gli attrezzi in più

Il commento in testa diventa "attrezzi condivisi dai programmi del Pi".

| Funzione | Cosa fa |
|---|---|
| `load_json(path)` | legge anche i `.json.gz`; un file illeggibile (anche `EOFError`, `zlib.error`) dà `{}` con un avviso |
| `day_files(parse_dir, var)` | `{AAAAMMGG: percorso}` dei file `<VAR>-AAAAMMGG.json[.gz]`; con entrambi vale il `.json` |
| `value_key(region)` | `'VM'` per il Veneto, `'VALORE'` per le altre |
| `is_dst_solar(dt)` | la regola dell'ora legale con l'ora **solare** in ingresso (dalle 02:00 solari dell'ultima domenica di marzo alle 02:00 solari dell'ultima di ottobre); accanto a `is_dst_civil`, con le due regole provate ora per ora sui due giorni del cambio |
| `merge_readings(parse_dir, var, readings, new_record)` | fonde `{stazione: [(istante, valore)]}` nei file del giorno, ordinate e senza doppioni (resta il valore già salvato); `new_record(stazione)` dà il record di una stazione nuova nel file; restituisce quante letture sono entrate. `write_parsed` e `recover.flush_points` la usano |
| `slug(name, empty='staz')`, `save_url(url, path)` | rimasugli degli script di scarico (sotto) |

Si usano quelli che ci sono già: `save_json`, `to_float`, `now_solar`, `get`/`get_json`, `region_dir`, `USER_AGENT`.

### Ogni programma si legge dall'alto in basso

- **`export_web.py`** (circa 330 righe): in testa `REGIONS` (le 23 cartelle del sito, nell'ordine di oggi),
  `STATION_FIELDS` (nome e coordinate dove non sono `NOME`/`LAT`/`LON`: VEN, TN, BZ, FVG) e le costanti del cursore;
  poi `main()`; `export_region()` in sequenza: finestra letta, derivate (non con `--series-only`), serie CSV, mappa,
  `units.json`, cursore; in fondo `iso_datetime` e `load_coords`. Parametri espliciti al posto di `**kwargs`.
- **`derive.py`** (circa 250): stesse formule; `put(out, name, istante, valore)` una volta; `_first_number(meta, keys)`
  per quota e latitudine; import in testa.
- **`quality.py`** (circa 55): una regola (`valid`); `checker` la usa con i limiti presi una volta (è nel ciclo più
  caldo dell'export: stessa velocità di oggi, misurata).
- **`climatology.py`** (circa 120): `scan(parse_dir, var, region)` (un ciclo per TEMP e PREC), `climate_region()`, `main()`.
- **`history.py`** (circa 240): impostazioni; fonti (`sources_of`, `discover_regions`); aggregati (`aggregate_file`,
  `day_record`); cache e uscita (`process_region` riceve `today`, `write_region`); `main()`.
- **`recover.py`** (circa 300): impostazioni (cadenze, profondità delle fonti, moduli, livelli a finestra); controllo
  dei buchi (`collect_archive_istanti`, `biggest_gap_minutes`, `has_hole`); fusione (`flush_points` su
  `merge_readings`); le tre fonti con storico (`fetch_bz`, `fetch_er`, `fetch_lom`); i tre modi di recupero; `main()`.
  Legge i moduli direttamente (un nome sparito ferma la regione con `ERRORE`, invece di usare riserve sbagliate) e usa
  `coordinate`/`compact_moment` di `dati_lombardia`.
- **`check_updates.py`** (circa 240): `REGIONS` (codice → modulo); `get_or_none(url)` (contenuto o `None`, con
  `comune.get`); gli scanner, con gli indirizzi presi dai moduli; `main()`; lo stato `.tracking/` con
  `load_json`/`save_json`.
- **`publish.sh`** (circa 150): export, stato, dati sul ramo `data`, pagina su `gh-pages`. Il Python incollato nel bash
  va in due file suoi: `status.py` (lo stato per il banner e gli avvisi) e `delta_names.py` (i nomi di `.delta/`,
  spostati così come sono). Gli avvisi si copiano con il loro nome: `watchdog_actions.yml` diventa `watchdog.yml`, il
  nome che ha già su `gh-pages` (stesso flusso su GitHub; l'impronta della pagina resta la stessa, niente pagina
  ripubblicata per questo).
- **`deploy.sh`** (circa 35): copia (esclusioni in `deploy_exclude.txt`, che le prove leggono e che toglie il `.git`
  dalla riga di comando), crontab fra i marcatori, controllo di `python3` e `flock`.
- **`publish_history.sh`, `backup_usb.sh`**: già lineari; cambiano solo per i rinforzi.

### Cosa resta com'è

- Formato e cartelle dell'archivio; file del sito e loro nomi; rami `data`, `data-inc`, `gh-pages`, `history`; orari
  del cron e opzioni che passa.
- La spinta incrementale dei dati (repository in `site/.git`, `data-inc`, nomi di `.delta/`, tre errori di fila → repo
  rifatto, lock): il codice si sposta, non cambia.
- Le regole dei numeri (vedi "Fuori ambito").

### Opzioni

- **Restano**: `export_web.py -r --days --site-dir --series-dir --series-only`; `climatology.py -r --site-dir`;
  `history.py --out --cache --regions --full -v`; `recover.py -r --days --force --debug` (riparazioni a mano, scritte
  nella sua intestazione); `check_updates.py -r --sample`.
- **Vanno via**: `export_web.py --parse-dir -o/--out-dir --coords --debug` (e l'uscita in `<REGIONE>/web/`);
  `history.py --from`.

### Effetti accettati degli attrezzi comuni

Invisibili sul campione, scritti qui perché cambiano il comportamento:
- un `.gz` rovinato non ferma più export a 30 giorni, climatologia e Storico: avviso `WARN` e si va avanti;
- `recover.py` scrive in modo atomico; un file del giorno illeggibile si riscrive con i soli punti recuperati (come
  fanno gli script di scarico dalle parti 1-2) invece di fermare la regione;
- `recover.py` e `check_updates.py` scaricano con `requests` e `comune.USER_AGENT`, con un nuovo tentativo dopo una
  connessione caduta (non dopo un timeout); cambia il testo degli errori nei log;
- una coordinata NaN rende la stazione "senza coordinate" (prima: `NaN` nel geojson);
- lo stato `.tracking/*_stations.json` di `check_updates.py` si scrive compatto (stesso contenuto);
- con `.json` e `.json.gz` dello stesso giorno vale il `.json` per tutti (oggi solo per lo Storico; non succede: la
  compressione delle 03:30 tocca file fermi da più di 8 giorni);
- le righe `WARN` di export, climatologia e Storico vanno su stdout con le parole di `comune.load_json` (stesso log).

## Rinforzi e cambi voluti

Dopo la pulizia, ognuno in un passo suo e con una prova che oggi fallisce.

1. **Storico, finestra di 8 giorni** (`RECENT_DAYS` da 3 a 8). Bordo: con oggi = G (giorno solare del giro) si
   ricalcolano i giorni da G-8 a G; G-9 e prima vengono dalla cache. Perché 8: `recover.py` (00:40, 06:40, 12:40,
   18:40) ricuce fino a 7 giorni prima del giorno in cui gira; il suo giro delle 18:40 di G-1 cade dopo lo Storico
   delle 07:20 di G-1, quindi fra due Storici il giorno più vecchio che può cambiare è G-8. Le altre scritture in
   ritardo stanno dentro: i giri notturni di Liguria e Piemonte (03:xx, prima dello Storico) arrivano al più a 8 giorni
   prima (il limite di `write_parsed`), ER a 3, il mare a 2; le serie a 7 giorni scritte durante il giorno (PC_TN,
   PC_PO) e l'aria non hanno PREC/TEMP. Un recupero a mano più lungo chiede `history.py --full`. Costo: 9 giorni per
   regione a notte invece di 4.
2. **File rovinati**: `export_web.py`, `climatology.py` e `history.py` saltano il file che non riescono a usare (anche
   un JSON valido di forma sbagliata) con una riga `WARN: file saltato (<motivo>): <percorso>`, e vanno avanti. Lo
   chiede la revisione dello Storico; vale anche per l'export, dove lo stesso file fermerebbe il sito.
3. **Lo Storico nello stato e il suo avviso**: `status.json` riceve `"history": {"last": "AAAA-MM-GGThh:mm"}`, l'ora
   dell'ultimo giro riuscito di `publish_history.sh` (= ora di modifica di `.tracking/last_history_hash`, scritto solo
   dopo un push riuscito; d'ora in poi lo tocca anche il giro "invariato"). Un nuovo avviso GitHub, `watchdog_storico.yml`
   ('Warning - storico off'), con lo schema degli altri due: ogni mattina, mail se l'ultimo giro ha 2 giorni o più o
   manca (una notte saltata non basta, come per il backup).
4. **Backup senza `history_out/` e `history_cache/`**: si rifanno dall'archivio (che è nel backup) e cambiano ogni notte
   (~27 MB, fino a 30 versioni).
5. **Deploy senza gli zeri idrometrici scritti dal Pi**: `/PIE/zero_idrometrici.json` e `/PC_PIE/zero_idrometrici.json`
   (li riscrive `dati_pc.py` a ogni giro; il secondo è anche in git). Esclusioni ancorate: gli altri
   `zero_idrometrici.json` (VEN, LOM, PC_PO) sono fissi e si copiano ancora.
6. **Export**: la finestra comincia a `now_solar() - giorni`, come ogni confronto con l'archivio (cambia solo d'estate:
   un'ora in più all'inizio); via `stations_nocoord.csv`: il log dell'export nomina le stazioni senza coordinate.

## Rimasugli delle parti 1-2

- `test_python37` su tutti i `.py` della cartella principale (anche `recover.py`, `check_updates.py`): sì, Task 1.
- I nomi che `check_updates.py` legge da `dati_aria.py`/`dati_pc.py` nella prova dei moduli: sì, Task 2 (tabelle) e
  Task 10 (indirizzi).
- `slug()` tre volte (laghi, aria, mare): sì, `comune.slug(name, empty)`, Task 13.
- Trovato misurando: `fetch(url, path)` uguale in `dati_altoadige.py`, `dati_trentino.py`, `dati_fvg.py` (salva il file
  di qualunque stato HTTP; un errore di rete ferma il giro; FVG ne usa anche il contenuto): sì, `comune.save_url(url,
  path)`, Task 13. Quello di `dati_veneto.py` resta suo: salta la stazione invece di fermare il giro.
- Ordine di creazione delle cartelle (TN/BZ/VEN): **lasciato**. Nessun effetto fuori da un crash a metà della creazione;
  tre script vivi e verificati non si riaprono per questo.
- `RAW_DIR` calcolato due volte (FVG/TN/BZ/ER): **lasciato**. La cartella si calcola alla chiamata, ed è ciò che
  permette a `test_emilia_romagna_risposta_senza_istante` di spostare `DOWNLOAD_DIR`: una costante la romperebbe.

## Rete di sicurezza

Prima di toccare un programma, con il codice di oggi; mai GitHub, mai il Pi.

1. **Export, climatologia, Storico.** Campione = gli attesi di un giro per fonte (22 regioni) più quattro file costruiti
   (due `.json.gz`, uno vuoto, uno rotto). In una cartella temporanea, con l'orologio fermo al 2026-11-05 13:00 UTC e la
   rete vietata: export a 7 giorni, export a 30 giorni (solo serie), climatologia, Storico due volte (il secondo dalla
   cache, uguale al primo). Si salvano le impronte (sha1) di ogni file prodotto: `tests/fixtures/rete/impronte.txt`,
   circa 8.000 righe nel formato di `sha1sum`; i 51 MB di uscita non entrano nel repository. Per vedere una differenza
   si rigenera l'uscita completa dal commit di partenza (`tests/rete.py uscita`) e si confronta con `diff -r`.
   L'orologio fermo vale per ogni Python lanciato con `PYTHONPATH=tests/orologio` (un `sitecustomize.py` che usa
   `freeze_clock` del registratore), anche quelli lanciati dai bash.
2. **`recover.py` e `check_updates.py`.** Il registratore delle parti 1-2, con due aggiunte: file di partenza
   (`<giro>/iniziali/`, copiati nel progetto prima di ogni giro) e **niente sottoprocessi veri** in un giro: ogni comando
   si annota in `sottoprocessi.txt` e "riesce" (nella parte 2 un `recover.py -r all` di prova lanciò `dati_veneto.py`
   dal vivo).
   Giri: `recover -r BZ/LOM/ER --force --days 1` registrati dal vivo (BZ e LOM ridotti dopo a poche stazioni; in BZ una
   risposta 500); `recover -r all` senza rete su un archivio di partenza in cui scattano solo VEN e AQ_LOM;
   `check_updates -r all --sample 3` con uno stato di partenza a cui mancano stazioni e una fonte che risponde 404.
   Si confrontano file, cartelle, codici di uscita, comandi lanciati e le righe del controllo dei buchi; lo stato
   `.tracking/` decodificato.
3. **Script bash.** In cartelle temporanee: il remoto è un repository nudo locale (`insteadOf` in una HOME temporanea,
   `GIT_ALLOW_PROTOCOL=file`: git rifiuta ogni altro indirizzo); per `flock`, `mountpoint`, `ionice`, `head -n -N`,
   `df --output`, `crontab` piccoli sostituti in `tests/shims/`. Scenari: `publish.sh` (primo giro, invariato, dato
   nuovo → `data-inc`, pagina cambiata, lock occupato, remoto irraggiungibile tre volte → repo rifatto, ritorno);
   `publish_history.sh` (primo, invariato, push fallito, ritorno); `backup_usb.sh` (versione nuova con file condivisi,
   stesso giorno, rotazione, archivio sceso → rotazione ferma, chiavetta assente, data non valida; sempre con una
   versione precedente, per la bash del Mac); `deploy.sh` (i file che copierebbe da un albero di prova). Si salvano gli
   effetti: codici, righe del log normalizzate, file sui rami e uguaglianza con i file locali, nomi di `.delta/`,
   genitore di `data-inc`, file di `.tracking/`, versioni del backup con i file condivisi, `status.json` decodificato.
4. Ogni passo lascia verdi le tre reti, le 136 prove di oggi e `test_python37`.

## Ordine dei lavori

1. Le tre reti (Task 1-3).
2. `comune.py` (Task 4), poi un programma o un gruppo alla volta: `quality`+`derive`, `export_web`, `climatology`,
   `history`, `recover`, `check_updates`, `publish.sh`, `deploy`+cron+README, `slug`+`fetch` (Task 5-13). Uscite
   identiche.
3. Rinforzi e cambi voluti (Task 14-17), ognuno con il diff delle uscite attese guardato riga per riga.
4. Controllo finale (Task 18).

## Al passaggio sul Pi (non in questo piano)

- Copia con `deploy.sh` (legge `deploy_exclude.txt`), in un minuto libero dal cron: rsync scrive un file nuovo e lo
  rinomina, i bash in corsa non si riscrivono. Crontab: cambiano solo commenti (marker-merge come sempre).
- Da togliere a mano sul Pi: `~/METEO/watchdog_actions.yml` (rinominato; resterebbe lì) e
  `~/METEO/site/FVG/stations_nocoord.csv` (non più scritto; resterebbe sul ramo `data`).
- Il primo `publish.sh` dopo la copia ripubblica la pagina (c'è il nuovo avviso); il primo Storico ricalcola 9 giorni
  per regione; `.tracking/last_history_hash` c'è dal 2026-11-05 14:26, quindi lo stato dello Storico è giusto subito.

## Criteri di riuscita

1. Ogni attrezzo comune definito una volta, in `comune.py`: la ricerca del Task 18 (lettura/scrittura JSON, numero,
   ora solare, ora legale, cartelle, file del giorno, chiave del valore, scarico, caricamento di moduli, aiuti copiati,
   `slug`) trova oggi 30 definizioni fuori da `comune.py`, alla fine nessuna; `fetch(url, path)` resta solo nel Veneto.
2. Nei programmi: niente `urllib`, niente `utcnow() + 1 h` in riga, nessun file di testo aperto senza `encoding='utf-8'`.
3. Uscite: impronte identiche (salvo la riga voluta di `stations_nocoord.csv`); giri di `recover`/`check_updates`
   identici; scenari bash identici salvo i cambi voluti, ognuno visto nel diff.
4. Verdi: le 136 prove di oggi, le nuove, `test_python37` su ogni `.py` della cartella principale.
5. Righe prima e dopo nel resoconto: oggi 2.589; attese circa 2.100 contando `status.py` e `delta_names.py`.
6. Export del campione non più lento di oggi oltre il 10%.

## Rischi

- **Il campione copre 1-10 giorni**: i percorsi pluriennali della climatologia (medie su più anni, record fra anni) e
  della cache dello Storico si vedono poco; le loro regole si spostano così come sono e `test_history.py` (24 prove)
  copre gli anni dello Storico.
- **Ciò che la riproduzione non vede** (User-Agent, `requests` al posto di `urllib`, nuovo tentativo): una prova dal
  vivo di `recover.py -r ER` e `check_updates.py --sample 3` in una copia temporanea (Task 9-10).
- **Il Mac non è il Pi**: sostituti per gli strumenti mancanti; il primo backup in assoluto non gira con la bash 3.2 del
  Mac (non cambia in questo piano).
- **Attesi riscritti nei passi voluti**: il diff delle impronte o degli effetti si guarda riga per riga; solo le righe
  previste.
- **Copia di lavoro condivisa**: un altro lavoro (interfaccia) usa la stessa cartella; si committa solo per percorso.
- **La registrazione di Lombardia** può prendere un 429: si registra lontano dai giri del Pi (:00/:30, stessa
  connessione di casa) e, se capita, si riprova dopo 30 minuti.

## Da decidere (per l'utente, fuori da questo piano)

1. **Climatologia e Storico calcolano due volte gli aggregati giornalieri, con regole diverse**: media delle letture con
   almeno 6 letture contro media delle medie orarie con le ore di dato; la climatologia non scarta le letture
   "azzerate" (TEMP=0 con UMID=0: falsi minimi a 0 °C, giorni di gelo in più) e non legge l'archivio ARPAV dal 2022.
   Calcolarla dalla cache dello Storico toglierebbe un programma di lettura e quei difetti, ma cambierebbe i numeri
   pubblicati della pagina "indici".
