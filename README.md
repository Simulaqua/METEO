# Stazioni idro-meteo - Nord Italia

Scarico, archiviazione e visualizzazione dei dati di molte reti idro-meteo del Nord Italia (meteo, idrometri,
qualita' dell'aria, maree, laghi, invasi, radar). Una mappa web mostra le stazioni; cliccandone una si vede la serie
degli ultimi 7 giorni, e lo "Storico" riassume anni di pioggia e temperatura. Tutto gira su un Raspberry Pi, il
sito e' su GitHub Pages.

## Programmi (cartella principale)
```
dati_<fonte>.py      un downloader per fonte: veneto, trentino, altoadige, fvg, lombardia, emilia_romagna, liguria,
                     pc (Protezione Civile + Piemonte), aria, mare, laghi, invasi, radar (radar DPC)
comune.py            attrezzi in comune dei downloader (scarico, percorsi, archivio)
quality.py           scarta in lettura i valori impossibili e le sentinelle (-999...); lo usano tutti i lettori
export_web.py        dall'archivio ai file del sito (ultimi 7 o 30 giorni, geojson, unita', fotogrammi per il cursore)
derive.py            grandezze derivate e indici, calcolati al volo (mai archiviati)
climatology.py       statistiche climatiche dall'archivio completo -> <REG>/climate.json (una volta al giorno)
history.py           aggregati giornalieri di pioggia e temperatura di tutto l'archivio (scheda "Storico")
recover.py           riempie i buchi (dopo un blackout) scaricando lo storico dalle fonti
check_updates.py     segnala stazioni nuove e variabili non mappate
status.py            stato del sito (site/STATUS/status.json): banner "dati fermi" e avvisi
publish.sh           export + pubblicazione su GitHub (vedi sotto); delta_names.py ne e' un aiuto
publish_history.sh   pubblica lo storico sul branch history (una volta al giorno)
backup_usb.sh        backup notturno su chiavetta USB (30 versioni, file uguali come hard link)
check_size.sh        spazio occupato dal progetto sul Pi
deploy.sh            dal Mac al Pi: copia il codice (esclusioni in deploy_exclude.txt) e aggiorna il crontab
crontab_regioni.txt  le righe di cron del Pi, fra i marcatori METEO
watchdog.yml, watchdog_backup.yml, watchdog_storico.yml
                     avvisi GitHub Actions (mail): dati fermi, backup, Storico; watchdog_mac.sh e' il guardiano lato Mac
site/                pagina web (index.html, radar.js); site/<REG>/ e' generato e non sta nel repo
tests/               solo Mac: giri registrati delle fonti (~45 MB) e prove di ogni programma
```
Gli script stanno tutti nella cartella principale e trovano da soli il progetto (percorsi relativi a `__file__`).
I dati stanno nelle cartelle delle regioni (`VEN/`, `FVG/`, `PC_PO/`, ...): `data-parsed/` e `data-downloaded/`.
I `logs/` sono nella cartella della regione solo per sei script regionali (VEN, FVG, TN, BZ, LOM, ER); gli altri
scrivono in `logs/` della cartella principale. Dati, log e cache sono in `.gitignore`.

## Come funziona
- **Archivio**: i `dati_*.py` scaricano, estraggono le misure e le accodano in file JSON giornalieri per variabile
  (`data-parsed/<VAR>/<VAR>-AAAAMMGG.json`, con dedup), poi cancellano i grezzi. L'archivio e' sempre in ora
  solare (UTC+1 fisso); i file piu' vecchi di 8 giorni vengono compressi (`.gz`) ma non cancellati.
- **Sito**: `export_web.py` legge l'archivio e scrive i file per la pagina in ora civile italiana. La pagina legge i
  dati da GitHub e disegna mappa (Leaflet) e grafici (uPlot).
- **Radar**: `dati_radar.py` (ogni 5 minuti) scarica 23 prodotti del radar DPC, li riproietta sulla mappa e salva le
  ultime 6 ore in PNG sul branch `radar`.

## Pubblicazione (branch del repository Simulaqua/METEO)
`publish.sh` gira dal cron ogni 10 minuti sul Pi e separa i dati dalla pagina:
- `data`: i dati del sito (e lo stato), letti dalla pagina via raw.githubusercontent.com. Il push e' incrementale
  (repository locale persistente in `site/.git`, solo i file cambiati), cosi' pesa poche centinaia di KB a giro.
- `gh-pages`: la pagina (GitHub Pages) e gli avvisi, pushata solo quando cambia.
- `history`: lo storico lungo, ricreato ogni giorno alle 07:20 da `publish_history.sh`.
- `radar`: i fotogrammi del radar, scritti da `dati_radar.py`.

Il Pi pubblica via SSH con una deploy key (`~/.ssh/meteo_github`, non scade); l'indirizzo del repository (`REMOTE`) e'
in `publish.sh`.

## Requisiti ed esecuzione manuale
```
python3 -m pip install -r requirements.txt   # requests
python3 dati_veneto.py                        # scarica + parsa una regione
python3 export_web.py -r all --site-dir site
cd site && python3 -m http.server 8770        # apri http://localhost:8770
```

## Sul Raspberry
`./deploy.sh [host]` (di solito `pitail`) copia il codice in `/home/manuel/METEO` e sostituisce solo il blocco fra
`# >>> METEO` e `# <<< METEO` del crontab: le altre righe del crontab restano come sono. I dati sul Pi non si toccano.
Le raccolte e le pubblicazioni partono dal cron (`crontab_regioni.txt`; `BASE` e' la cartella del progetto).
Controllo veloce dello spazio: `~/METEO/check_size.sh`.

## Prove (solo Mac)
```
/usr/bin/python3 -m unittest discover -s tests -t .
```
