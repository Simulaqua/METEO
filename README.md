# Stazioni idro-meteo — Nord-Est

Scarico, archiviazione e visualizzazione dei dati delle reti idro-meteo di 4 regioni:
**Veneto (ARPAV)**, **Trentino (Meteotrentino)**, **Alto Adige (Provincia di Bolzano)**,
**Friuli-Venezia Giulia (OSMER)**. Una mappa web mostra le stazioni; cliccandone una si vede
la serie degli ultimi 7 giorni.

## Struttura
```
VEN/ BZ/ TN/ FVG/    una cartella per regione, con lo script dati_<regione>.py
export_web.py        genera i file per il sito (CSV serie 7gg + stations.geojson + units.json)
check_updates.py     monitor: segnala nuove stazioni / variabili non mappate
site/index.html      pagina web (Leaflet + uPlot)
dati_radar.py        radar DPC (Protezione Civile): 23 prodotti, ultime 6 ore in PNG -> branch 'radar'
site/radar.js        layer radar della mappa (pulsante "Radar", menu "Mappa"), legge il branch 'radar'
tests/               test di dati_radar.py (python3 -m unittest tests.test_dati_radar)
publish.sh           rigenera i dati e li pubblica su GitHub Pages (branch gh-pages)
crontab_regioni.txt  righe di cron
legenda_variabili.txt  corrispondenza nomi variabili tra le regioni
FVG/stazioni_coords.csv  coordinate stazioni FVG (non presenti nel feed dati)
dati_pc.py           idrometria Protezione Civile (PC_FVG, PC_TN, PC_PO) e ARPA Piemonte: un solo scarico
                     orario alimenta la regione PIE (meteo + livelli, voce "Piemonte") e PC_PIE (idrometri, voce Po)
dati_liguria.py      Liguria ARPAL/OMIRL (LIG): istantanee + serie (pioggia oraria, raffiche); di notte serie complete
```
Ogni script capisce da solo la propria cartella (percorsi relativi a `__file__`) e vi crea dentro
`data-downloaded/`, `data-parsed/`, `logs/`, `web/` (tutti in `.gitignore`).

## Come funziona
- **dati_*.py**: scaricano il feed della regione, ne estraggono le misure e le **accodano** in file
  JSON giornalieri per variabile (`data-parsed/<VAR>/<VAR>-YYYYMMDD.json`, con dedup), poi cancellano
  i grezzi. L'archivio e' **sempre in ora solare** (CET, UTC+1 fisso) per tutte le regioni.
- **export_web.py**: legge l'archivio, tiene gli ultimi 7 giorni e scrive i file per il sito,
  convertendo gli orari all'**ora civile italiana** attuale (Europe/Rome, solare o legale).
  Oltre a serie CSV e geojson scrive `<REGIONE>/snap/<VAR>.json`: 168 fotogrammi orari (finestra mobile,
  dimensione costante) per il **cursore del tempo** sulla mappa (pioggia 1-48 h, temperatura, umidita', ecc.).
- **derive.py**: grandezze derivate e indici calcolati al volo (mai archiviati), fra cui la pioggia
  cumulata mobile 1/3/6/12/24/48 h.
- **dati_radar.py** (cron ogni 5 min): scarica dall'API della piattaforma Radar-DPC 23 prodotti (pioggia
  adesso e cumulata 1-48 h, riflettivita' anche a 1-10 km di quota, acqua in colonna, altezza dei temporali,
  grandine, nuvole da satellite, temperatura), li riproietta sulla griglia della mappa (Web Mercator, Nord
  Italia), salva le ultime 6 ore come PNG con palette fisse (la pioggia con le classi del sito) e le pubblica
  sul branch `radar` con `index.json` (palette e fotogrammi), in modo incrementale. Sul sito: pulsante
  "Radar", menu "Mappa" e interruttore "Stazioni". Dati CC BY-SA 4.0, fonte Radar-DPC.
- **site/index.html**: mappa delle stazioni (pulsanti "Pioggia" e "Cursore") + grafico della serie 7gg,
  anche a fasce impilate. Pioggia a barre (orarie nei 7 e 3 giorni) con curva cumulata e fasce tratteggiate
  dove mancano i dati; nei confronti fra giorni curve cumulate da mezzanotte; direzione del vento a puntini;
  valore e ora in un'etichetta accanto al cursore; zoom anche col dito e pulsante "Tutto". Legge i dati da
  GitHub Pages.

## Requisiti
```
python3 -m pip install -r requirements.txt   # requests
```

## Esecuzione manuale
```
python3 dati_veneto.py                # scarica + parsa (una regione)
python3 export_web.py -r all --site-dir site
cd site && python3 -m http.server 8770   # apri http://localhost:8770
```

## Automazione (Raspberry, cron)
Vedi `crontab_regioni.txt`: imposta la variabile `BASE` sulla cartella che contiene VEN/BZ/TN/FVG.
Le righe scaricano/parsano a intervalli, esportano i dati e (aggiungendo `publish.sh`) pubblicano.

## Pubblicazione su GitHub Pages
1. Crea un repo su GitHub e collegalo:
   ```
   git remote add origin git@github.com:<utente>/<repo>.git
   git push -u origin main
   ```
2. Pubblica il sito (pagina + dati) sul branch `gh-pages`:
   ```
   ./publish.sh
   ```
3. Su GitHub: **Settings → Pages → Branch: gh-pages** → il sito sara' su
   `https://<utente>.github.io/<repo>/`.
4. Per aggiornare i dati periodicamente, aggiungi `publish.sh` al cron.
