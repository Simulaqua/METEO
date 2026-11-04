# Radar-DPC sulla mappa — rilascio 1 "Radar" (design)

Data: 2026-10-22 · Stato: approvato in chat (sezioni 1-3), esecuzione autonoma richiesta dall'utente.

## Obiettivo

Sovrapporre alla mappa di meteo.simulaqua.it il radar nazionale della Protezione Civile (prodotto SRI,
intensità di pioggia in mm/h) e scorrerne le **ultime 6 ore a passi di 5 minuti** con il Cursore esistente,
per vedere "cosa sta arrivando adesso" anche dove non ci sono stazioni.

Ambito complessivo concordato = **C**, in due rilasci:
1. **Radar** (questo documento).
2. **Pioggia caduta**: griglia DPC delle cumulate 1/3/6/12/24 h (+48 h calcolata) sotto i puntini,
   legata ai chip Pioggia e al Cursore. Avrà un suo breve giro di design dopo che il rilascio 1 è stabile.

## Decisioni prese (con l'utente)

| Tema | Decisione |
|---|---|
| Fonte | **Piano B**: il Pi scarica i GeoTIFF dall'API REST documentata (`radar-api.protezionecivile.it`) e genera immagini nostre. NON si usano le tile WebP interne della web app DPC (contratto non documentato). |
| Cursore | **Opzione A**: una sola barra che si adatta (radar acceso: 6 h a 5 min; spento: 7 giorni a 1 h come oggi). |
| Zoom | Layer **nascosto da zoom 11** in su. |
| Controlli | Massimo 3-4 scelte sulla mappa; si riusano i chip esistenti. |
| Formato | **(a)** PNG con la nostra palette già dentro. |
| Altre criticità | Risolte nel design (sotto). |

## Architettura

```
DPC REST API ──(ogni 5 min, Pi)──> dati_radar.py ──> radar_out/ ──push──> branch GitHub `radar`
                                                                         │
meteo.simulaqua.it (gh-pages) ── site/radar.js ──fetch── raw.githubusercontent.com/Simulaqua/METEO/radar/…
                                                   (fallback jsDelivr solo per i fotogrammi)
```

### 1. `dati_radar.py` (Pi, radice del progetto)

- Cron ogni 5 minuti con `flock -n`; log giornaliero in append `logs/radar-AAAAMMGG.log` (una riga di
  riepilogo a giro). Python 3.7, numpy 1.16, Pillow 5.4 (già sul Pi, nessuna dipendenza nuova).
- A ogni giro:
  1. `GET /findLastProductByType?type=SRI` → ultimo istante `T` (ms UTC, passo 5 min).
  2. Finestra = 72 istanti `T, T-5', …, T-355'`. Per ogni istante senza PNG locale: `POST /downloadProduct`
     → URL S3 firmato (scade dopo 300 s) → GeoTIFF Float32 1200×1400.
  3. Controllo georeferenziazione (tag GeoTIFF 33550/33922: pixel 1000 m, origine −600000/650000); se diversa
     → errore, niente immagine (meglio nessun fotogramma che uno spostato).
  4. Riproiezione nearest-neighbour su griglia **Web Mercator fissa del Nord Italia**: lon 6,0-14,5,
     lat 43,3-47,3, 1222,99 m/px (≈ zoom 7, ~0,87 km a 45°N) → 773×517 px. Tabella di indici calcolata una
     volta e messa in cache (`radar_out/.lut-<chiave>.npy`).
     Proiezione sorgente: Transverse Mercator lat0 42, lon0 12,5, k 1, WGS84. `-9999` = fuori copertura.
  5. Classi della pioggia oraria del sito (`RAIN_STEPS.PREC1` = 0,1 · 0,5 · 1 · 2 · 5 · 10 · 20 · 30 · 50 mm/h,
     stessa semantica di `rainClass`: classe = numero di soglie ≤ valore). Classe 0 (sotto 0,1, NaN,
     sentinelle) = trasparente; classi 1-9 = `RAIN_COLORS[1..9]`.
  6. PNG a palette (modo P, tRNS sull'indice 0), nome `SRI/AAAAMMGGhhmm.png` in **UTC** (immutabile).
  7. Cancella i PNG fuori finestra; scrive `index.json`; se l'insieme dei file è cambiato → push.
- **Autoriparazione**: i buchi dentro le 6 ore (riavvio 05:50, DPC irraggiungibile) si recuperano ai giri
  successivi (il DPC conserva 14 giorni). Budget di tempo per giro (~4 min) per non sforare la cadenza.
- File in `radar_out/` (FUORI da `site/`, altrimenti `git add */` di publish.sh li porterebbe nel branch data).

### 2. `index.json` (manifest)

```json
{"v": 1, "updated": 1792658700,
 "source": "Radar-DPC – Dipartimento della Protezione Civile", "license": "CC BY-SA 4.0",
 "products": {"SRI": {"unit": "mm/h", "step": 300, "size": [773, 517],
   "bounds": [[43.30, 6.00], [47.30, 14.50]],
   "steps": [0.1, 0.5, 1, 2, 5, 10, 20, 30, 50],
   "frames": [1792637400, "…", 1792658700]}}}
```
Tempi in epoch UTC (secondi), ordinati. `bounds` = bordi esterni esatti della griglia (per `L.imageOverlay`).
Una sezione per prodotto: il rilascio 2 aggiunge le cumulate senza cambiare formato.

### 3. Pubblicazione: branch `radar`

- Commit orfano in un repo temporaneo + `git push -f` sul branch `radar` dello stesso remote di publish.sh
  (`git@github.com:Simulaqua/METEO.git`, deploy key del Pi), fatto dallo script stesso subito dopo il giro.
  Indipendente da publish.sh (che un'altra sessione sta modificando).
- Contenuto: `index.json`, `SRI/*.png` (≤ 72), `LICENSE.txt` ("Derivato da Radar-DPC – Dipartimento della
  Protezione Civile, CC BY-SA 4.0").
- Peso 0,2-2 MB a push → ~150 MB/giorno tipici, ≤ ~500 MB nei giorni di nubifragio.

### 4. Sito: `site/radar.js` + agganci in `index.html`

- **Pulsante "Radar"** dopo Pioggia e Cursore. Acceso:
  - overlay del fotogramma più recente in un pane sotto i puntini, opacità fissa (~0,75), pixel nitidi;
  - **i puntini passano a PREC1** (pioggia dell'ultima ora, stessa scala del radar), chip 1-48 h nascosti;
    scegliere un'altra variabile spegne il radar; spegnendolo torna la variabile di prima;
  - legenda unica: classi PREC1, titolo "Radar mm/h · stazioni mm in 1 h";
  - attribuzione Leaflet "Radar-DPC – Protezione Civile (CC BY-SA)";
  - zoom ≥ 11: overlay nascosto, pulsante attenuato, suggerimento "Radar visibile fino a zoom 10";
  - tocco su un punto vuoto della mappa: popup con ora e classe del radar ("10:35 · 2-5 mm/h").
- **Cursore adattivo**: la barra (`#tsbar`) delega a una "sorgente di tempo" (stazioni | radar), nessun
  secondo player.
  - Radar: 72 fotogrammi; etichetta "Gio 22/10 10:35" + sotto "stazioni 10:00" (fotogramma orario PREC1 ≤ t,
    in ora civile italiana); riproduzione 6 h ≈ 18 s a 1× (250 ms/fotogramma), in loop; se si è sull'ultimo
    fotogramma la barra segue i nuovi, altrimenti resta ferma.
  - Stazioni: come oggi.
  - Premendo Radar la barra si apre sull'ultimo fotogramma, ferma. La × chiude la barra, il radar resta
    acceso in modalità "dal vivo". Spegnendo il radar la barra torna ai 7 giorni se era stata aperta per le
    stazioni, altrimenti si chiude.
- **Orari**: conversione UTC → ora civile italiana con la stessa regola di `_ita_is_dst` (export_web.py).
- **Leggerezza**: un solo overlay; il fotogramma successivo si precarica prima dello scambio (niente
  lampeggio); gli altri si scaricano in background dal più recente (cache del browser, nomi immutabili);
  nessun fotogramma decodificato tenuto in memoria. Manifest ricontrollato ogni 2 minuti a radar acceso.
- **Errori**: manifest irraggiungibile → pulsante grigio "Radar non disponibile"; ultimo fotogramma > 30 min →
  etichetta "radar fermo alle hh:mm"; fotogramma mancante → fallback jsDelivr, poi saltato.
- **Deploy pagina**: `publish.sh` (sezione pagina) deve copiare `site/radar.js` su gh-pages e includerlo
  nell'hash della pagina. Modifica da fare dopo/insieme alla sessione che sta cambiando publish.sh.

## Coordinamento (stato del repo al 2026-10-22)

Altre sessioni lavorano nella stessa cartella: "Dati" sta modificando `site/index.html` (non ancora sul Pi);
"Push incrementale" lavora su `publish.sh`; `deploy.sh` e `crontab_regioni.txt` locali divergono dal Pi.
Regole: niente `deploy.sh`; sul Pi solo i file di questo lavoro; cron radar inserito come riga nel crontab
attivo (backup in `~/backups/`) + stesso blocco aggiunto a `crontab_regioni.txt` locale e del Pi;
`index.html` toccato solo dopo accordo con la sessione "Dati".

## KPI di accettazione

| # | KPI | Obiettivo |
|---|---|---|
| K1 | Freschezza | ultimo fotogramma sul sito ≤ 20 min dopo l'istante osservato (tipico 12-20) |
| K2 | Continuità | 72 fotogrammi nelle ultime 6 h; buco recuperato entro il giro successivo |
| K3 | Costo sul Pi | giro tipico < 2 s; primo riempimento ≤ 3 min |
| K4 | Peso | fotogramma 3-25 KB; branch ≤ 2 MB; upload ~150 MB/giorno (≤ 500 in nubifragio) |
| K5 | Georeferenziazione | angolo TM esatto; valori città = GeoTIFF; celle allineate alla web app DPC |
| K6 | Interfaccia | nascosto da zoom 11; nessuna sovrapposizione a 320/375/430 px (FVG/A280); tema scuro ok |
| K7 | Animazione | 6 h in ~18 s a 1×; loop; segue i nuovi fotogrammi; nessun lampeggio |
| K8 | Robustezza | manifest assente → pulsante grigio; > 30 min → "radar fermo"; fotogramma mancante saltato; 0 errori JS |
| K9 | Isolamento | branch data e resto del sito invariati; nessun file radar nel branch data |
| K10 | Licenza | attribuzione visibile a layer attivo; nota nel branch |

## Prove

- Python (sul Mac in venv e sul Pi con le versioni vere): proiezione (angolo documentato, città), classi e
  sentinelle, finestra/buchi/potatura, manifest, compatibilità numpy 1.16 / Python 3.7.
- Sito (Chrome headless o pannello browser): desktop, 320/375/430 px con FVG/A280, tema scuro; tutti i casi
  di §4 inclusi errori e cambio d'ora (istanti finti a cavallo del 25/10).

## Messa in produzione e ritorno indietro

1. Script sul Pi, giro a mano senza push → controllo fotogrammi. 2. Giro a mano con push → branch `radar`
raggiungibile da raw e jsDelivr. 3. Riga cron (inserimento nel crontab attivo) → un'ora di giri controllati.
4. Sito: radar.js + agganci, prova in locale sul branch vero, publish.sh, verifica dal vivo.
Ritorno indietro: togliere la riga del cron e il pulsante; dati e resto del sito non vengono mai toccati.

## Fuori ambito (rilascio 1)

Cumulate sotto i puntini (rilascio 2), TEMP / IR108 / VMI, trasparenza regolabile, stato del radar nell'URL,
stato dei siti radar (SITES), "pluviometri sospetti".
