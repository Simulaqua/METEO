# Interfaccia "Mappa protagonista" (design)

Data: 2026-11-02 · Stato: direzione scelta in chat (proposta 1 di 3, mockup mostrati il 2026-11-02); questo
documento aspetta la revisione dell'utente prima del piano e del codice.

## Obiettivo

L'utente vuole un sito "più professionale e interattivo". La mappa diventa lo spazio principale e non sparisce mai:
filtri e ricerca stanno sopra la mappa, una stazione si legge al passaggio del mouse e si apre in un pannello
accanto alla mappa (sul telefono in un foglio che sale dal basso).

Oggi, sul sito pubblicato (verificato il 2026-11-02):
- a sinistra una barra di moduli (Dati, Regione, Stazione, Cerca, Variabile, Reset, stato fonti, tema, Note);
- al passaggio su un puntino un elenco di sigle grezze (fino a 27 righe, "TEMP: 17.0 °C");
- aprire una stazione nasconde la mappa (schede in alto) e si parte dalla prima variabile in ordine alfabetico.

## Criteri di successo

1. Su desktop aprire una stazione non nasconde mai la mappa; la stazione resta evidenziata.
2. Ogni stazione si trova scrivendo almeno 2 lettere del nome; Invio la apre.
3. La scheda al passaggio compare entro 100 ms (dati gia' in memoria) e non copre mai pulsanti o pannello.
4. Tutto quello che c'e' oggi resta raggiungibile: pagine (dirette, derivate, indici), regioni, variabili, Pioggia,
   Cursore, Radar con la sua plancia, modi del grafico (24 h, 3 g, 7 g, confronti 7 e 30 giorni, confronto schede,
   impilato, storico, rosa dei venti), CSV, PNG, Link, Note, stato delle fonti, tema chiaro/scuro.
5. I link gia' condivisi (`#REG/COD/VAR`, con le parti `S:` e `H:`) aprono la stessa vista.
6. Telefono 320, 375, 430 px: nessuna sovrapposizione, mappa usabile a foglio chiuso.
7. Nessuna regressione: tutte le prove di `tests/web` verdi; apertura della pagina non piu' lenta (confronto
   vecchia/nuova a cache vuota, come fatto per la plancia).

## Cosa non cambia

Dati e file pubblicati, `radar.js`, la plancia in basso (tempo, legenda, crediti), il motore dei grafici (uPlot,
impilato, storico, confronti), i colori delle variabili, il formato dei link, il punto decimale, le etichette brevi.

## Disegno

### Desktop (larghezza > 720 px)

**In alto a sinistra, sopra la mappa:**
- **Ricerca** (campo largo ~300 px): "Cerca fra N stazioni…", scorciatoie `/` e `⌘K`/`Ctrl+K`. Cerca nei nomi
  delle stazioni (anche i fiumi e i comuni che compaiono nei nomi), nel codice e nella sigla della regione.
  Risultati (max 8): nome, regione, ultimo valore della variabile scelta (senza variabile: il valore principale,
  con la stessa regola della scheda al passaggio). Frecce + Invio, Esc chiude. Invio o clic: la mappa vola sulla
  stazione e si apre il pannello.
- **Pillole** sotto la ricerca: `Misure dirette ▾` (le tre pagine), `Tutte le regioni ▾`, `Variabile ▾` (elenco
  della pagina, con un filtro di testo se lungo), e un piccolo `● Fonti` col colore dello stato (apre il pannello
  di oggi). Una pillola attiva e' evidenziata come nei mockup.
- **Menu ⋯** in fondo alle pillole: Note, Tema chiaro/scuro, Azzera i filtri.

**In alto a destra:** colonna di pulsanti a icona (sfondi, Radar, Pioggia, Cursore) con la scritta al passaggio, e
sotto lo zoom (+/−). Stato acceso/attenuato come oggi.

**Scheda al passaggio** (solo con mouse): al passaggio su un puntino, dopo 80 ms, una scheda accanto al puntino:
- nome; regione · fonte · ora del dato e da quanto ("12:00, 10 min fa");
- valore grande della variabile scelta (senza variabile: la prima disponibile fra temperatura, livello, pioggia
  24 h, indice aria) con la variazione nell'ultima ora; con il Cursore o il radar aperti, il valore all'istante
  scelto ("alle 09:00"), come fa oggi il tooltip del Cursore;
- andamento delle ultime 24 h e min/max, dai file orari gia' usati dal Cursore (`<REG>/snap/<VAR>.json`, caricati
  alla prima scheda e tenuti in memoria); per le variabili senza file orari niente andamento;
- tre valori chiave dall'ultimo dato della stazione (es. pioggia 24 h, vento, umidita'; per un idrometro livello e
  variazione);
- "Clic: apre la scheda". La scheda evita bordi, pulsanti e pannello; sparisce uscendo dal puntino.
Sostituisce i tooltip di Leaflet di oggi (anche quello del Cursore); le etichette fisse a zoom alto restano.

**Pannello della stazione** (al clic, dalla ricerca o da un link): a destra, largo 400 px, la mappa resta a
sinistra e si sposta per tenere visibile la stazione, evidenziata con un anello.
- Testata: nome, regione · fonte · ora del dato, pulsanti Link, Espandi (⤢), Chiudi (×).
- **Stazioni aperte** come pillole sotto la testata (al posto delle schede di oggi: massimo 8, la piu' vecchia
  esce) piu' la pillola `Confronto` quando serve; la × su ogni pillola la chiude.
- **Quattro riquadri** con i valori attuali, scelti dal tipo di stazione:
  meteo = temperatura, pioggia 24 h, vento, umidita'; idrometro = livello, variazione 3 h, portata se c'e';
  aria = indice EAQI e i tre inquinanti principali; mare = livello, onde, temperatura dell'acqua; altrimenti le
  prime quattro variabili con un valore. Clic su un riquadro = quella variabile nel grafico.
- Pillole delle variabili (come oggi, con il `+` per la seconda), modi `24 h · 3 g · 7 g` e un menu `Altro ▾`
  con Confronto 7 giorni, Confronto 30 giorni, Confronto schede, Impilato, Storico.
- Grafico, statistiche, fonte; in fondo Aggiorna, CSV, PNG.
- **Espandi** allarga il pannello al 70 % (la mappa resta come striscia a sinistra): per impilato, confronti e
  storico. Di nuovo ⤢ per tornare a 400 px; la scelta resta per la sessione.

### Telefono (fino a 720 px)

- In alto la ricerca a tutta larghezza e sotto una riga di pillole scorrevole di lato: Pagina, Regione, Variabile,
  Pioggia, Cursore, Radar, `● Fonti`, ⋯. Il pulsante degli sfondi resta a destra sotto le pillole; niente +/− (si
  ingrandisce con due dita), come oggi.
- Tocco su un puntino: **foglio basso** col contenuto della scheda al passaggio e "Apri la scheda".
- Trascinando in su (o col pulsante) il foglio diventa il pannello completo, a tutta altezza e scorrevole;
  trascinando in giu' torna basso, poi si chiude.
- Con il foglio aperto la plancia del radar/Cursore si nasconde; chiuso il foglio, torna.

### Collegamenti e stato

- I link restano `#REG/COD/VAR[/S:…|H:…]`: aprono il pannello (telefono: foglio completo). `#confronto` apre il
  confronto. Chiudere il pannello toglie l'ancora come oggi.
- Restano le preferenze del browser (tema, sfondo, prodotto radar, plancia chiusa, pila dell'impilato) e si
  aggiunge la larghezza del pannello (normale/espanso).

## Come si costruisce (scelte tecniche)

- **Un file solo, come oggi.** Il nuovo codice va in `site/index.html` in sezioni marcate (ricerca, pillole, scheda
  al passaggio, pannello); `publish.sh` pubblica solo `index.html` e `radar.js`, quindi nessun cambio sul Pi.
- **Stessi comandi sotto.** Le tendine di oggi (`#region`, `#varFilter`, `#stationFilter`, le pagine `#pages`)
  restano nel documento, nascoste, come fonte unica: le pillole le comandano e leggono le loro opzioni (cosi'
  regioni e variabili aggiunte da altre sessioni, es. Piemonte, compaiono da sole). Meno logica toccata, prove
  esistenti ancora valide.
- **Il pannello e' l'attuale `#panel`** spostato nel contenitore del pannello: grafici, impilato, storico, rosa e
  confronti continuano a usare gli stessi id. La barra delle schede (`#tabbar`) diventa la riga delle stazioni
  aperte dentro il pannello (`renderTabbar` cambia contenitore e aspetto).
- **Scheda al passaggio** con gli eventi `mouseover/mouseout` dei puntini (gia' su renderer canvas con tolleranza):
  un solo elemento riposizionato, niente tooltip Leaflet per puntino.
- Coordinamento: altre sessioni modificano `index.html` (Mappe: grafici; Dati: regioni). Solo modifiche mirate,
  si riparte sempre dal file aggiornato, si avvisa prima di pubblicare, md5 del Pi controllato prima di copiare.

## Rilasci

Ogni rilascio: prove scritte prima (`tests/web`, nuove suite dove serve), verifica desktop + 320/375/430 px + tema
scuro, pubblicazione solo col via dell'utente.

1. **Ricerca e pillole.** Via la barra laterale (desktop e telefono); ricerca con suggerimenti; pillole Pagina,
   Regione, Variabile; `● Fonti`; menu ⋯; pulsanti mappa in colonna a destra. La stazione si apre ancora nella
   vista a schede di oggi. Nuova suite `search`.
2. **Scheda al passaggio.** Scheda accanto al puntino (desktop) e foglio basso (telefono), con andamento 24 h e
   valori chiave. Nuova suite `hover`.
3. **Pannello accanto alla mappa.** Pannello a destra con riquadri, stazioni aperte, Altro ▾ ed Espandi; foglio
   completo sul telefono; via la vista a schede. Nuova suite `drawer`; adattate `dock`, `layout`, `hash`.

Dopo, se l'utente vuole (dalle proposte 2 e 3, fuori da questo documento): elenco ordinato per valore come scheda
del pannello, "Le mie stazioni" (stelle e preferiti).

## Rischi

- `index.html` cresce ancora (oggi ~3800 righe): sezioni marcate; se diventa scomodo, si valuta di separare il
  codice dell'interfaccia in un file pubblicato anche da `publish.sh` (richiede un cambio sul Pi).
- La scheda al passaggio con le variabili senza file orari (es. livelli idrometrici) non ha andamento: si mostra
  solo il valore e la variazione dall'ultimo dato. Aggiungere i livelli ai file orari e' un cambio dell'export, da
  decidere a parte.
- Abitudine: chi usa la barra laterale trova tutto nelle pillole; la ricerca copre la vecchia tendina Stazione.

## Da confermare (scelte fatte per default)

1. Le schede delle stazioni diventano pillole dentro il pannello (max 8) e `Confronto schede` resta.
2. Note, tema e azzera filtri vanno nel menu ⋯; lo stato delle fonti resta visibile come `● Fonti`.
3. La ricerca cerca solo nelle stazioni (nomi, codici, regioni): niente ricerca di indirizzi o comuni sulla mappa.
4. Pannello largo 400 px, Espandi al 70 %.
5. Pulsanti della mappa a icona con la scritta al passaggio (oggi hanno le scritte sempre visibili).
6. Ordine dei rilasci: ricerca e pillole, poi scheda al passaggio, poi pannello.
