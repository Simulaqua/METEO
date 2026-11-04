# Pulizia del codice — script di scarico del Pi (design)

Data: 2026-11-04 · Stato: disegno approvato in chat in due parti (struttura; rete di sicurezza e passaggio sul Pi);
questo documento aspetta la revisione dell'utente prima del piano.

## Richiesta

Testuale (2026-11-04): "alla fine, fai un controllo di tutto il framework eliminando parti morte o inutili, e fai un
refactoring spinto per semplificare il tutto. ragiona come un programmatore umano, non come una ai. il codice deve
essere comprensibile e lineare".

Scelte dell'utente: tutto, un pezzo alla volta; per gli script del Pi l'approccio A (tutti nella cartella principale,
con un modulo comune).

## Le quattro parti

Ognuna ha la sua spec, il suo piano e le sue prove.

1. Parti morte + 2. script di scarico del Pi: **questo documento** (la parte 1 è piccola e sta dentro la 2).
3. Export e pubblicazione: `export_web.py`, `derive.py`, `quality.py`, `history.py`, `climatology.py`, `recover.py`,
   `check_updates.py`, `publish.sh`, `publish_history.sh`, `backup_usb.sh`.
4. Sito: `site/index.html` e `site/radar.js`, dopo la pubblicazione del rilascio 2 dell'interfaccia.

## Fuori ambito

- **Il vecchio sistema ARPAV**: la cartella `old/` e, sul Pi, `/home/manuel/arpav` con il suo cron e i suoi dati.
  È un progetto personale dell'utente: resta esattamente com'è, anche nei commit (`old/` resta com'è nell'indice di git).
- **Il comportamento**: stessi file prodotti, stessi nomi, stesse cartelle. `export_web.py` e il sito non se ne accorgono.
- **Nuove librerie**: nessuna. Sul Pi ci sono già `requests`, `numpy` e `Pillow`; Python 3.7 (niente `zoneinfo`).
- `recover.py` e `check_updates.py` cambiano solo dove usano gli script (percorsi e impostazioni lette, vedi sotto);
  la loro pulizia è la parte 3. `export_web.py` non cambia.

## Oggi (misurato il 2026-11-04)

- 13 script di scarico, 5.864 righe: `VEN/dati_veneto.py` 903, `TN/dati_trentino.py` 615, `FVG/dati_fvg.py` 589,
  `dati_radar.py` 548, `LOM/dati_lombardia.py` 536, `BZ/dati_altoadige.py` 512, `dati_aria.py` 451, `dati_pc.py` 407,
  `ER/dati_emilia_romagna.py` 364, `dati_mare.py` 341, `dati_liguria.py` 241, `dati_laghi.py` 196, `dati_invasi.py` 161.
- Gli stessi attrezzi copiati più volte nel progetto, con due nomi diversi: scrittura JSON (`jsave` 9, `json_save` 7), lettura JSON
  (`jload` 9, `json_load` 7), `to_float` 8, `now_solar` 8, `http_json` 8, `write_parsed` 7, `create_directory` 7,
  `_ita_is_dst` 6, `civil_to_solar` 5.
- Due librerie per scaricare: `requests` nei sei script regionali, `urllib` negli altri.
- Forma da modello copiato: classi usate come contenitori (in `dati_veneto.py` 11 classi per dire quale elenco di
  stazioni usa ogni variabile), `import os` due volte, un commento per ogni import, opzioni sì/no che nessuno passa.
- Parti morte: `dati_consorzi.py` (non gira più: la fonte CB_AE è stata ritirata il 2026-10-23; l'archivio dei suoi
  dati sul Pi resta).
- Nessun test sugli script di scarico: i 57 test esistenti sono 54 sul radar e 3 sull'ora legale dell'export.
- `deploy.sh` copia i file nuovi ma non cancella quelli vecchi.
- `recover.py` e `check_updates.py` caricano gli script regionali come moduli e ne leggono le impostazioni: le classi
  delle variabili (`type`, `tipo`, `unit`, `desc`, `url_stazioni`), gli indirizzi (`base_URL`, `API`, `url_sensors`,
  `url_stations`, `url_anagrafica`, `url_dati`, `url_lista`) e la cartella dei dati (`directory.parse`).
  `recover.py` lancia anche `dati_veneto.py -date A M G -c no` e `dati_aria.py`/`dati_pc.py -r <rete>`.

## Come sarà

### Dove sta cosa

- Nella cartella principale: `comune.py` e i 13 script (`dati_veneto.py`, `dati_fvg.py`, `dati_trentino.py`,
  `dati_altoadige.py`, `dati_lombardia.py`, `dati_emilia_romagna.py` accanto a `dati_aria.py`, `dati_pc.py`,
  `dati_mare.py`, `dati_laghi.py`, `dati_invasi.py`, `dati_liguria.py`, `dati_radar.py`).
- Nelle cartelle delle regioni (`VEN/`, `FVG/`, `TN/`, …) solo dati: scaricati, interpretati, log, e i file di
  configurazione dei dati (`*/zero_idrometrici.json`, `FVG/stazioni_coords.csv`).
- Ogni script scrive gli stessi file nelle stesse cartelle di oggi.
- Via `dati_consorzi.py`. `.gitignore` ignora tutte le cartelle di dati (`site/*/`, le cache `sensors_map.json` e
  `elements_map.json`) invece di un elenco parziale.

### `comune.py`: ogni attrezzo una volta

Nomi in inglese come nel resto del codice, commenti in italiano.

| Funzione | Cosa fa |
|---|---|
| `BASE`, `region_dir(code)` | cartella del progetto; cartella dati di una regione (`region_dir('VEN')`) |
| `load_json(path)` | legge un JSON; `None` se manca o è rotto |
| `save_json(data, path)` | scrive su un file temporaneo e poi rinomina (mai un file a metà) |
| `get(url, **kw)`, `get_json(url, params)` | `requests` con timeout e un nuovo tentativo |
| `now_solar()`, `civil_to_solar(dt)` | ora solare italiana adesso; da ora civile a solare |
| `is_dst_civil(dt)`, `is_dst_solar(dt)` | le due regole dell'ora legale, con l'ora in ingresso detta nel nome (confonderle ha già prodotto un errore a ottobre) |
| `to_float(text)` | numero o `None` ("", "n.d.", virgola decimale) |
| `write_parsed(...)` | il file interpretato nel formato comune; dove uno script regionale ha un formato suo, resta il suo |

### Un downloader si legge dall'alto in basso

1. In testa le impostazioni, in tabelle semplici. Per esempio, in `dati_veneto.py` le 11 classi diventano:
   ```python
   STATION_LISTS = {'meteo': 'stazioni.xml', 'idro': 'stazioni_idro.xml', 'neve': 'stazioni_neve.xml'}
   VARIABLES = {'TEMP': 'meteo', 'PREC': 'meteo', 'VVENTO': 'meteo', 'DVENTO': 'meteo', 'RADSOL': 'meteo',
                'UMID': 'meteo', 'VISIB': 'meteo', 'PRESS': 'meteo', 'LIVIDRO': 'idro', 'PORTATA': 'idro', 'LIVNEVE': 'neve'}
   ```
2. Poi `download()`, `parse()`, `main()`. La logica propria di ogni fonte si sposta così com'è; cambia la forma.
3. Niente import doppi, niente commenti che ripetono il codice; un commento solo dove spiega un perché.

### Le impostazioni sono anche un'interfaccia

Le tabelle in testa agli script regionali (variabili con codice, unità, descrizione, elenco stazioni; indirizzi;
cartella dei dati come `PARSE_DIR`) sono lette da `recover.py` e `check_updates.py`. Nel passo di ogni fonte cambiano
anche le loro letture: per esempio `getattr(mod.variables, v).unit` diventa `mod.VARIABLES[v]['unit']`. Una prova
carica tutti gli script e controlla che ogni nome letto da quei due programmi esista.

### Opzioni da riga di comando

- **Restano** (le usano cron e `recover.py`): `-date` e `-c` di `dati_veneto.py` (`recover.py` passa `-c no`), `-r`
  delle fonti con più reti, `--full` di `dati_pc.py` e `dati_liguria.py`, `--out --no-push --remote` di
  `dati_radar.py`, `--debug` ovunque.
- **Vanno via**: `-d -p -v` di `dati_veneto.py` e `-d -p -v -c` degli altri cinque regionali, che nessuno passa; il
  `-c` "(compat)" di `dati_aria.py`, `dati_mare.py` e `dati_pc.py`, che non fa niente; il `-r` "(compat)" di
  `dati_laghi.py` (né cron né `recover.py` né `deploy.sh` lo passano).

## Rete di sicurezza

1. **Commit di partenza** (approvato dall'utente il 2026-11-04): solo codice, documenti, prove e file di configurazione;
   niente dati, niente cache, `old/` lasciata com'è nell'indice. Poi un commit per ogni passo, annullabile. Nessun push.
2. **Registratore** (`tests/registratore.py`): intercetta `requests`, `urllib` e l'orologio (`datetime`, `time`,
   con il fuso `Europe/Rome`).
   - in registrazione salva ogni risposta vera di una fonte in `tests/fixtures/<fonte>/`;
   - in riproduzione restituisce quelle risposte senza rete, con l'orologio fermo all'ora della registrazione.
3. **File attesi per ogni fonte**: lo script di oggi gira sulle risposte registrate, in una cartella temporanea, e i
   file che produce diventano gli attesi (`tests/fixtures/<fonte>/attesi/`). La prova di ogni fonte: lo script nuovo,
   sulle stesse risposte, produce file **identici byte per byte**.
4. **Prove di `comune.py`**: i due giorni del cambio d'ora (ultima domenica di marzo e di ottobre, ora per ora, con
   entrambe le regole), scrittura sicura, numeri strani.
5. **Ogni passo** lascia tutto verde: le prove nuove, i 57 test di oggi, le suite del sito che leggono quei file.
6. `recover.py` e `check_updates.py` ricevono una prova minima: caricano tutti gli script ai nuovi percorsi e ogni
   impostazione che leggono esiste.

## Ordine dei lavori

1. Commit di partenza; registratore; `comune.py` con le sue prove; `.gitignore`; via `dati_consorzi.py`.
2. Una fonte alla volta, dalla più piccola: per ognuna registrazione, attesi, riscrittura con `comune.py` (e, per i
   regionali, le letture in `recover.py`/`check_updates.py`), prova identica, commit. Ordine: laghi, invasi, Liguria, mare, aria, Protezione Civile; poi Veneto, FVG, Trentino,
   Alto Adige, Lombardia (un solo giro di registrazione: la fonte limita le chiamate), Emilia-Romagna; il radar per
   ultimo (ha già 54 test, gli attrezzi comuni si sostituiscono senza cambiare il resto).
3. Spostamento dei sei regionali nella cartella principale, percorsi nuovi in `crontab_regioni.txt`, `deploy.sh`,
   `recover.py`, `check_updates.py`.

## Passaggio sul Pi

Una volta sola, alla fine, con il permesso dell'utente e Tailscale acceso sul Mac.

1. Copia di riserva degli script attuali e del crontab in `~/backups/`.
2. Copia dei file nuovi (`deploy.sh`).
3. Nel blocco METEO del crontab cambiano solo i percorsi dei sei regionali. Le altre righe, compreso il vecchio
   sistema ARPAV, restano intatte (`deploy.sh` sostituisce solo il blocco fra i suoi marcatori).
4. Via le sei vecchie copie degli script dalle cartelle delle regioni (i dati restano).
5. Fra due giri del cron: Python legge lo script all'avvio, un giro già partito finisce con il codice vecchio.
6. Controllo: il primo giro di ogni fonte dopo il passaggio ha i log senza errori e i dati freschi sul sito.

## Criteri di riuscita

1. Nella cartella principale `comune.py` e i 13 `dati_*.py`; nelle cartelle delle regioni solo dati e configurazione.
2. Ogni attrezzo comune definito una volta sola, in `comune.py`: nessun'altra definizione di lettura/scrittura JSON,
   scarico, ora solare, ora legale, `to_float`, `write_parsed` negli script.
3. Per ogni fonte, sulle risposte registrate, file identici byte per byte a quelli dello script di oggi.
4. Verdi: le prove nuove, i 57 test di oggi, le suite del sito che leggono i dati.
5. Righe degli script di scarico contate prima e dopo, nel resoconto finale.
6. Sul Pi, dopo il passaggio: primo giro di ogni fonte senza errori, dati freschi sul sito, vecchio sistema ARPAV e
   altre righe del crontab invariati.

## Rischi

- **Casi che il giro registrato non contiene** (giorno del cambio d'ora, stazione nuova, fonte vuota o in errore):
  le prove di `comune.py` coprono l'ora legale; la logica di ogni fonte si sposta così com'è.
- **Lombardia limita le chiamate anonime**: un solo giro di registrazione, con le pause che lo script fa già.
- **Script caricati per percorso e letti dentro** (`recover.py`, `check_updates.py`): percorsi e letture aggiornati
  nello stesso passo, con la prova che ogni nome letto esista. `recover.py` si mette in moto solo dopo un buco nei
  dati: un errore qui non si vedrebbe subito, perciò la prova è necessaria.
- **Passaggio a metà di un giro**: si fa fra due giri.
- **Vecchie copie sul Pi**: `deploy.sh` non cancella; si tolgono a mano dopo la copia di riserva.
