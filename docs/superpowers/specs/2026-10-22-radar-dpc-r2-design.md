# Radar-DPC sulla mappa — rilascio 2 "Tutte le mappe" (design)

Data: 2026-10-22 · Stato: approvato in chat (insieme "A + specialistici", cadenza ridotta per quote e nuvole).
Si appoggia al rilascio 1 (`2026-10-22-radar-dpc-design.md`): stessa griglia di uscita, stesso branch `radar`,
stesso Cursore a "sorgenti di tempo".

## Obiettivo

Col radar acceso l'utente sceglie da un menu **"Mappa"** uno dei 23 prodotti della piattaforma Radar-DPC e può
spegnere i puntini delle stazioni (**"Stazioni"**) per vedere solo la mappa.

## Prodotti (chiave nel manifest = cartella del branch)

| Gruppo | Chiave | API | Etichetta | Unità | Passo | Fotogrammi in 6 h | Palette | Puntini |
|---|---|---|---|---|---|---|---|---|
| Pioggia | SRI | SRI | Adesso | mm/h | 5 min | 72 | PREC1 | PREC1 |
| Pioggia | SRT1 | SRT1 | 1 h | mm | 5 min | 72 | PREC1 | PREC1 |
| Pioggia | CUM3/6/12/24 | CUM3/6/12/24 | 3/6/12/24 h | mm | 30 min | 12 | PREC3/6/12/24 | PREC3/6/12/24 |
| Pioggia | CUM48 | CUM24(t)+CUM24(t-24 h) | 48 h | mm | 30 min | 12 | PREC48 | PREC48 |
| Radar | VMI | VMI | Riflettività | dBZ | 5 min | 72 | dBZ | — |
| Radar | CAPPI1…10 | CAPPI_1…10 | Riflettività a 1…10 km | dBZ | **10 min** | 36 | dBZ | — |
| Radar | VIL | VIL | Acqua in colonna | kg/m² | 5 min | 72 | VIL | — |
| Radar | ETM | ETM (m → km) | Altezza temporali | km | 5 min | 72 | ETM | — |
| Radar | POH | POH (0-1 → %) | Grandine | % | 5 min | 72 | POH | — |
| Altro | IR108 | IR_108 | Nuvole | °C | **15 min** | 24 | IR108 | — |
| Altro | TEMP | TEMP | Temperatura | °C | 60 min | 6 | TEMP | TEMP |

Valori verificati il 2026-10-22: dBZ da -10 a ~50 (sentinelle -9999 fuori copertura, -9998 nessuna eco); ETM in metri;
POH frazione 0-1; IR108 °C senza sentinelle; TEMP °C con -99999; CUM in mm con -9999. Griglie sorgente: TM 1 km
(radar, satellite), EPSG:4326 0,01° (CUM), EPSG:4326 ~0,02° (TEMP); tutte riproiettate sulla griglia Web Mercator del
rilascio 1 (773×517, stessi bounds) → stessi overlay per ogni prodotto.

## Palette (fisse, definite in `dati_radar.py`, pubblicate nel manifest)

Classe = numero di soglie ≤ valore (semantica di `rainClass`). Ogni prodotto ha `steps` (N soglie) e `colors` (N+1 colori,
stringa vuota = trasparente). Nel PNG: indice 0 = nessun dato (trasparente), indice i+1 = classe i; tRNS dà alpha 0 a
indice 0 e alle classi trasparenti.

- Pioggia: `RAIN_STEPS` del sito e `RAIN_COLORS` (classe 0 trasparente).
- dBZ (VMI, CAPPI): 10,15,…,60 dBZ, scala radar classica (classe 0 < 10 dBZ trasparente).
- VIL: 0,5 · 1 · 2 · 5 · 10 · 20 · 30 · 45 · 60 kg/m² (classe 0 trasparente).
- ETM: 2 · 3 · 4 · 5 · 6 · 8 · 10 · 12 km (classe 0 trasparente).
- POH: 10 · 30 · 50 · 70 · 90 % (classe 0 trasparente).
- IR108: -60 · -50 · -40 · -30 · -20 · -10 · 0 °C; colori per le cime fredde (sotto -40), grigi fino a 0 °C, sopra 0 °C
  trasparente (cielo sereno/suolo).
- TEMP: da -10 a 36 °C ogni 2 °C, scala blu→rosso, tutte le classi opache.

## Pi (`dati_radar.py`)

- Elenco `PRODUCTS` con i campi della tabella; finestra = 6 h / passo; istanti allineati al passo del prodotto (anche
  quote e nuvole, campionate a 10 e 15 min sui 5 min nativi).
- Giro: per ogni prodotto ultimo istante dall'API (CUM48 = quello di CUM24); poi **a turno fra i prodotti**, prima il
  fotogramma mancante più recente di ciascuno, finché resta budget (240 s). CUM48 riusa nello stesso giro il CUM24(t)
  già scaricato e scarica CUM24(t-24 h).
- Georeferenziazione controllata per griglia (TM / 0,01° / TEMP): diversa → errore, niente fotogramma.
- Log: una riga per giro con nuovi, mancanti (totale e prodotti incompleti), errori, MB scaricati, push, secondi.
- **Push incrementale** del branch `radar`: repo git persistente in `radar_out/` (`.gitignore`: `.lut-*`, `.state.json`,
  `*.tmp`), un commit per giro con genitore il precedente (solo i file nuovi viaggiano), compattazione orfana una volta
  al giorno (UTC) e dopo 3 push falliti di fila.
- Compatibilità: `products.SRI` resta, quindi il `radar.js` del rilascio 1 continua a funzionare durante il passaggio.

## Sito (`site/radar.js` + agganci in `index.html`)

- Il manifest porta per ogni prodotto: gruppo, etichetta, unità, passo, steps, colors, puntini, fotogrammi.
- **Menu "Mappa"** (`<select>` con gruppi Pioggia/Radar/Altro; prodotti senza fotogrammi esclusi) + interruttore
  **"Stazioni"**, al posto dei chip 1-48 h quando il radar è acceso. Ultima scelta ricordata nel browser.
- Cambio prodotto: stesso istante (fotogramma più vicino non successivo), oppure l'ultimo se si era "dal vivo";
  precarica solo i fotogrammi del prodotto scelto.
- Puntini: prodotto con equivalente (PREC1…PREC48, TEMP) → la variabile della mappa diventa quella, colori dalla palette
  del prodotto (stessa legenda); prodotto senza equivalente → puntini neutri (variabile vuota); "Stazioni" spento →
  nessun puntino. Il radar si spegne se l'utente sceglie una variabile diversa da quella del prodotto.
- Legenda unica dalla palette del prodotto (stesso disegno della legenda pioggia); popup "Radar hh:mm · <classe>".
- Etichetta della barra: "· stazioni hh:00" solo con puntini accoppiati e accesi.

## KPI di accettazione

| # | KPI | Obiettivo |
|---|---|---|
| R1 | Completezza | 23 prodotti nel manifest; finestre complete (72/36/24/12/6) entro ~1 h dal deploy |
| R2 | Costo sul Pi | giro a regime: mediana < 20 s, nessun giro oltre il budget |
| R3 | Download | ~1,6 GB/giorno (stimato dai MB a giro nel log) |
| R4 | Upload | push incrementale: mediana < 1 MB a giro |
| R5 | Georeferenziazione | CUM24 vs PREC24 stazioni coerenti; dBZ allineato alle tile DPC |
| R6 | Interfaccia | menu + Stazioni senza sovrapposizioni a 320/375/430 px, scuro, desktop; il cambio prodotto tiene l'istante |
| R7 | Puntini | accoppiamento giusto per prodotto (PRECn, TEMP, neutri, spenti), una sola legenda |
| R8 | Regressioni | 0 errori JS; rilascio 1 (Adesso), Cursore stazioni, link, resilienza invariati |

## Fuori ambito

Fulmini, celle HRD, vento in quota (non forniti dall'API); stato dei radar (SITES); trasparenza regolabile.
