# Come e' fatto il sistema

Per chi arriva nuovo. Il README dice cosa c'e' nella cartella; qui c'e' come funziona e perche'. Gli appunti di lavoro
piu' dettagliati (piani, revisioni) restano nella storia di git.

## Cosa fa

Scarica ogni pochi minuti le misure di molte reti idro-meteo del Nord Italia (meteo, idrometri, qualita' dell'aria,
maree, laghi, invasi, radar), le archivia e le pubblica su una mappa web. Gira su un Raspberry Pi (cron); il sito e'
su GitHub Pages. Il Mac serve per sviluppare, provare e installare sul Pi.

## Le parti

- **Scarico**: un `dati_<fonte>.py` per ogni fonte (veneto, trentino, altoadige, fvg, lombardia, emilia_romagna,
  liguria, pc, aria, mare, laghi, invasi, radar). Ognuno scarica, estrae le misure e le accoda all'archivio della
  regione. `comune.py` ha gli attrezzi che tutti usano (richieste con ritentativi, percorsi, scrittura dei file).
- **Letture**: `quality.py` scarta in lettura i valori impossibili e le sentinelle (-999...). `derive.py` calcola
  al volo le grandezze derivate (non si archiviano mai).
- **Dall'archivio al sito**: `export_web.py` scrive i file del sito (ultimi 7 e 30 giorni, geojson, fotogrammi del
  cursore); `climatology.py` le statistiche climatiche (una volta al giorno); `history.py` gli aggregati giornalieri
  di pioggia e temperatura di tutto l'archivio (lo "Storico"); `status.py` lo stato del sito (`STATUS/status.json`).
- **Pubblicazione**: `publish.sh` (ogni 10 minuti) esporta e pubblica; `delta_names.py` e' un suo aiuto per il push
  incrementale; `publish_history.sh` pubblica lo Storico una volta al giorno (07:20).
- **Manutenzione**: `recover.py` riempie i buchi dopo un blackout; `check_updates.py` segnala stazioni nuove e
  variabili non mappate; `backup_usb.sh` fa il backup notturno su chiavetta (04:40, 30 versioni); `check_size.sh`
  mostra lo spazio usato.
- **Pagina**: `site/index.html` (mappa Leaflet, grafici uPlot) e `site/radar.js` (radar). Legge i dati da GitHub.
- **Guardiani**: `watchdog.yml`, `watchdog_backup.yml`, `watchdog_storico.yml` sono avvisi GitHub Actions (mail:
  "Warning - meteo off", backup, storico) che leggono `status.json`; `watchdog_mac.sh` fa lo stesso dal Mac con una
  notifica, lanciato da launchd.

## Come passano i dati

1. Il cron lancia i `dati_*.py`. Ognuno accoda le misure in `<REG>/data-parsed/<VAR>/<VAR>-AAAAMMGG.json` (con
   dedup) e cancella i grezzi. I file piu' vecchi di 8 giorni vengono compressi (`.gz`), mai cancellati.
2. `publish.sh` lancia `export_web.py` e `status.py`, poi pubblica sul repository `Simulaqua/METEO` (via SSH, con
   una deploy key che non scade) quattro rami:
   - `data`: i dati del sito, letti dalla pagina via raw.githubusercontent.com. Il push e' incrementale: un
     repository locale persistente in `site/.git` manda solo i file cambiati (poche centinaia di KB a giro).
   - `gh-pages`: la pagina e gli avvisi, solo quando cambiano.
   - `history`: lo Storico, ricreato ogni giorno.
   - `radar`: i fotogrammi del radar, scritti da `dati_radar.py` ogni 5 minuti.
3. La pagina scarica i dati dal ramo `data` e disegna mappa e grafici.

Esiste anche un ramo `sources` con una copia del codice, aggiornata a mano.

## Regole del Raspberry

- Il progetto sta in `/home/manuel/METEO`; si raggiunge con `ssh pitail` (Tailscale, funziona anche fuori casa).
  Python 3.7, niente `zoneinfo` (l'ora legale si calcola a mano), OpenSSH 7.9, git 2.20.
- Il codice si installa solo con `./deploy.sh`, in un minuto in cui il cron non parte (i minuti liberi si leggono
  in `crontab_regioni.txt`). `deploy.sh` usa rsync con `deploy_exclude.txt`: dati, log, esportazioni del sito e
  le cartelle che il Pi non usa (`tests/`, `docs/`) non si copiano. Un file tolto dal Mac non sparisce dal Pi.
- Il crontab si cambia solo fra i marcatori `# >>> METEO` e `# <<< METEO`: `deploy.sh` sostituisce quel blocco e
  lascia tutte le altre righe. Mai `crontab <file>`: cancellerebbe le righe che non sono nostre.
- Mai toccare `old/` (nel repository) ne' il vecchio sistema ARPAV sul Pi (`/home/manuel/arpav`, i suoi dati, le
  sue 4 righe di cron fuori dal blocco): e' un progetto personale a parte, resta com'e'.
- Non riscrivere in loco uno script che il cron sta eseguendo (bash lo legge mentre gira): usare un file
  temporaneo e `mv`, o intervenire a minuti liberi.

## Le prove

Girano solo sul Mac e proteggono le modifiche; sono in `tests/` (circa 45 MB di giri registrati).

- **Giri registrati degli scarichi** (`tests/registratore.py`, `tests/test_scarico.py`): ogni downloader gira
  sulle risposte vere registrate, senza rete, e deve scrivere gli stessi file.
- **Impronte delle uscite** (`tests/rete.py`, `tests/test_rete.py`): export, climatologia e Storico su un campione
  dell'archivio, con orologio fermo e rete vietata; si confrontano gli sha1 dei file prodotti
  (`tests/fixtures/rete/impronte.txt`).
- **Scenari bash**: `publish.sh`, `publish_history.sh`, `backup_usb.sh` e `deploy.sh` girano in cartelle temporanee
  contro repository nudi locali, con strumenti finti in `tests/shims/`. Gli effetti attesi sono in
  `tests/fixtures/rete/bash.json`. Se cambia di proposito cio' che `deploy.sh` copia, si rigenera con
  `/usr/bin/python3 tests/rete.py attesi bash` (due volte: deve uscire uguale).
- **Prove nel browser** (`tests/web`, Chrome headless): pagina, radar, Storico, schede, link. Istruzioni in
  `tests/web/README.md`.

Tutte le prove Python:

```
/usr/bin/python3 -m unittest discover -s tests -t .
```

Servono circa 5 minuti. `test_dati_radar` ha una prova ("push_failure_retry") che a volte fallisce insieme alle
altre e passa da sola.

## Decisioni principali

- **Ora solare ovunque nell'archivio.** L'archivio e' sempre in UTC+1 fisso, tutto l'anno: niente ore doppie o
  mancanti a ottobre e marzo. Solo `export_web.py` converte in ora civile italiana, e il confine di ottobre
  (02:00) si calcola sull'ora solare. I `dati_*.py` che copiano dati di altri usano l'ora civile della fonte.
- **Il filtro di qualita' agisce in lettura.** Gli archivi conservano quello che la fonte ha detto; `quality.py`
  scarta sentinelle e valori impossibili quando si legge (export, climatologia, Storico, ogni nuovo aggregato). Un
  -999 della Lombardia una volta aveva falsato le piogge a 24 e 48 ore.
- **Storico.** Si conta per giorno solare. Un giorno e' completo con almeno 20 ore con dato; un giorno senza dati e'
  `null`, mai 0. Dove il vecchio archivio ARPAV e il nuovo si sovrappongono (Veneto) vince il giorno con piu' ore.
  Ogni notte si ricalcolano i giorni nuovi e gli ultimi 8 (`recover.py` puo' ricucire fino a 7 giorni indietro).
  Le viste sono Giorni, Mesi, Anni, Tabella; negli Anni un colore per anno.
- **La stazione si apre in una finestra intera sotto la barra a schede.** Un pannello laterale e' stato provato
  (6 novembre 2026) e tolto lo stesso giorno su richiesta dell'utente: si vedeva troppo poco.
- **Il vento.** L'etichetta (NNE...) dice da dove viene il vento; la freccia accanto mostra dove va.
- **Nessuna chiave ne' token per nessuna fonte.** Solo fonti aperte e anonime. Se una fonte limita le richieste
  (la Lombardia risponde 429), lo scarico ritenta con pause e, se non basta, esce senza scrivere.
