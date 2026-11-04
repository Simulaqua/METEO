# Interfaccia "Mappa protagonista", rilascio 1 "Ricerca e pillole" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** via la barra laterale; sopra la mappa una ricerca con suggerimenti e le pillole Pagina, Regione,
Variabile, `● Fonti`, ⋯; i pulsanti della mappa in colonna a destra (sul telefono nella riga delle pillole).

**Architecture:** tutto in `site/index.html`. Le tendine di oggi (`#pages`, `#region`, `#stationFilter`, `#varFilter`)
restano nel documento, nascoste, come fonte unica: le pillole aprono un menu costruito dalle loro opzioni e, alla
scelta, impostano il loro valore e mandano lo stesso evento di oggi (`click`/`change`), cosi' la logica esistente non
cambia. Un solo menu a comparsa riusato (`#pillMenu`). La ricerca e' una funzione pura (`searchStations`) piu' un
elenco sotto il campo.

**Tech Stack:** HTML/CSS/JS in un file, Leaflet 1.9.4, prove nel browser di `tests/web` (Chrome headless).

**Spec:** `docs/superpowers/specs/2026-11-02-interfaccia-mappa-protagonista-design.md` (rilascio 1). I rilasci 2
(scheda al passaggio) e 3 (pannello accanto alla mappa) avranno piani propri.

## Global Constraints

- Un solo file: `site/index.html` (`publish.sh` pubblica solo `index.html` e `radar.js`); nessun file nuovo nel sito.
- Altre sessioni modificano `index.html` (Mappe: grafici; Dati: regioni): solo modifiche mirate con Edit, rileggere il
  pezzo prima di toccarlo, mai riscrivere il file intero.
- Etichette brevi in italiano, punto decimale. Testi fissi: segnaposto `Cerca fra N stazioni…`; nessun risultato
  `Nessuna stazione`; pillola stato `Fonti`; voci del menu ⋯ `Note`, `Tema scuro`/`Tema chiaro`, `Azzera i filtri`.
- Materiali e colori come la plancia: variabili CSS `--pbg`, `--pl`, `--pl2`, `--psh`, `--ink`, `--fg`, `--muted`,
  `--accent`; funziona col tema scuro (`body.dark`).
- Telefono = `max-width:720px` (lo stesso `PHONE` della plancia). Verifica a 320, 375, 430 px e su desktop, anche scuro.
- Link `#REG/COD/VAR[/S:…|H:…]` invariati.
- Niente commit git (l'utente li fa solo su richiesta). Nessuna pubblicazione senza il suo via.
- Prove: `/usr/bin/python3 tests/web/setup.py` (numpy c'e' solo nel Python 3.9) dopo ogni modifica di `index.html`
  (le pagine di prova sono copie); server `site` sulla 8772 (preview_start); `tests/web/run.sh "<pagina>?suite=…"`;
  telefono `tests/web/run.sh "w.html?w=375&h=812&src=<pagina codificata>"`; alla fine `setup.py --clean`. Sul Mac
  per attendere usare `/bin/sleep`.

## Review Focus

1. Nomi con accenti, apostrofi e maiuscole ("Forlì", "Sant'Ambrogio", "MONTE CESEN"): la ricerca li trova senza
   badare ad accenti, maiuscole e punteggiatura (Task 3, test `ricerca: accenti e apostrofi`).
2. Il tasto `/` premuto mentre si scrive in un altro campo (filtro del menu Variabile, campi dello Storico) non deve
   rubare il fuoco (Task 3, test `"/" non ruba il fuoco`).
3. Menu Variabile lungo (decine di voci con "Tutte") su telefono 320×568: resta dentro lo schermo e scorre (Task 2,
   test `menu dentro lo schermo a 320 px`).
4. Stato cambiato da altre parti (link condiviso su una variabile derivata, radar che porta i puntini su PREC1,
   "Azzera i filtri"): le etichette delle pillole seguono lo stato vero (Task 2, test `pillole seguono lo stato`).
5. Menu aperto e clic fuori, Esc, o apertura di un altro menu: resta aperto al piu' un menu (Task 2, test
   `un menu alla volta`).

---

### Task 1: Guscio sopra la mappa, barra laterale tolta

**Files:**
- Modify: `site/index.html` (CSS della barra laterale e di `#srcpanel`/`#notepanel`; markup `<aside id="sidebar">`,
  `#tabbar`; script: `_syncThemeBtn`, ascoltatore di `#sbToggle`, `renderMarkers` dove scrive `#count`)
- Test: `tests/web/it_tests.js` (nuova `suiteSearch`, registrata come `search`)

**Interfaces:**
- Produces: markup `#topbar` (dentro `#views`, sopra la mappa) con `input#stationQ`, `div#searchList` (vuoto),
  `div#pillRow` con `button#pgPill`, `button#regPill`, `button#varPill`, `button#srcinfo` (contiene `span#srcdot` e il
  testo `Fonti`), `button#moreBtn`; `div#moreMenu` (nascosto) con `button#noteBtn`, `button#themeBtn`, `button#resetBtn`;
  contenitore nascosto `div#legacyCtl` con `#pages`, `#region`, `#stationFilter`, `#stationSearch`, `#stationOptions`,
  `#varFilter`, `#count` spostati li' senza cambiare id. Il marchio "Simulaqua Meteo" passa in testa a `#tabbar`.

- [ ] **Step 1: Scrivi la prova che fallisce** — `suiteSearch` in `tests/web/it_tests.js`, registrata nella mappa
  delle suite come `search`:

```js
const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
log(!vis(el('sidebar')), 'niente barra laterale', '');
log(vis(el('topbar')) && vis(el('stationQ')), 'ricerca sopra la mappa', '');
eq('pillole', ['pgPill', 'regPill', 'varPill', 'srcinfo', 'moreBtn'].map(id => vis(el(id))), [true, true, true, true, true]);
log(/^Cerca fra \d+ stazioni…$/.test(el('stationQ').placeholder), 'segnaposto col numero di stazioni', el('stationQ').placeholder);
log(!vis(el('legacyCtl')) && !!el('region') && !!el('varFilter') && !!el('stationFilter'), 'tendine nascoste ma presenti', '');
el('srcinfo').click(); await sleep(100);
log(getComputedStyle(el('srcpanel')).display === 'block', '"Fonti" apre lo stato delle fonti', '');
eq('errori JS', window.__errs, []);
```

- [ ] **Step 2: Verifica che fallisca** — `/usr/bin/python3 tests/web/setup.py && tests/web/run.sh "it_local.html?suite=search"`
  Atteso: `FAIL niente barra laterale` (e le altre), `RISULTATO: 0/…` o quasi.
- [ ] **Step 3: Implementa** — togli `<aside id="sidebar">` lasciando i controlli in `div#legacyCtl hidden` (stessi id);
  marchio in `#tabbar`; togli `#sbToggle` e il suo ascoltatore; `#topbar` assoluto in `#views` (desktop: in alto a
  sinistra, 12 px dai bordi, ricerca larga 300 px, pillole sotto; telefono: ricerca a tutta larghezza 10 px dai bordi,
  `#pillRow` scorrevole di lato senza barra); `#topbar` sotto `#panel` (z-index < 1200) cosi' la vista stazione lo
  copre; `#srcpanel` e `#notepanel` sotto le pillole (desktop `top:104px; left:12px`, telefono `left:8px; right:8px;
  top:110px`); `#themeBtn` mostra `Tema scuro`/`Tema chiaro` invece dell'emoji (`_syncThemeBtn`); `renderMarkers`
  aggiorna anche `el('stationQ').placeholder = 'Cerca fra ' + list.length + ' stazioni…'`. Le pillole qui hanno solo
  l'etichetta (i menu sono il Task 2): `Misure dirette`, `Tutte le regioni`, `Tutte le variabili`.
- [ ] **Step 4: Verifica che passi** — stesso comando, atteso `RISULTATO: 7/7`; poi tutte le suite esistenti
  (`it_local` dock, cursor, hash; `it_prod` prodotti, buffer; `it_live` radar; `it_noradar` resilience; `test.html`)
  verdi come prima.

### Task 2: Menu delle pillole e menu ⋯

**Files:**
- Modify: `site/index.html` (nuova sezione script "PILLOLE"; CSS `#pillMenu`, `#moreMenu`)
- Test: `tests/web/it_tests.js` (`suiteSearch`, nuove righe)

**Interfaces:**
- Consumes: gli id del Task 1.
- Produces: `openMenu(anchor: HTMLElement, items: {v: string, label: string, on: boolean}[], onPick: (v: string) => void, opts?: {filter?: boolean}) -> void`
  (riempie e mostra `div#pillMenu` sotto `anchor`; con `filter` un campo `input.pm-filter` in testa che filtra le
  voci); `closeMenu() -> void` (chiude `#pillMenu` e `#moreMenu`); `syncPills() -> void` (etichette: pagina dal
  pulsante attivo di `#pages`, regione dal testo dell'opzione scelta di `#region`, variabile `varLabel(filterVar)` o
  `Tutte le variabili`; classe `on` sulla pillola Variabile se `filterVar`, su Regione se diversa da `ALL`).
  `syncPills` e' chiamata alla fine di `syncMapControls` (gia' chiamata da `renderMarkers`) e dopo `applyHash`.

- [ ] **Step 1: Scrivi le prove che falliscono** (in `suiteSearch`, dopo il Task 1):

```js
const items = () => [...el('pillMenu').querySelectorAll('[data-v]')];
el('regPill').click(); await sleep(50);
eq('menu regioni = opzioni di #region', items().map(b => b.dataset.v), [...el('region').options].map(o => o.value));
items().find(b => b.dataset.v === 'FVG').click();
await until(() => el('region').value === 'FVG' && allFeatures.length > 0 && allFeatures.every(f => (REGION_GROUPS.FVG || ['FVG']).includes(f.properties._region)), 20000);
eq('regione scelta', el('regPill').textContent.trim(), [...el('region').options].find(o => o.value === 'FVG').textContent);
el('varPill').click(); await sleep(50);
eq('menu variabili = opzioni di #varFilter', items().map(b => b.dataset.v), [...el('varFilter').options].map(o => o.value));
items().find(b => b.dataset.v === 'TEMP').click(); await until(() => filterVar === 'TEMP');
log(el('varPill').textContent.includes(varLabel('TEMP')) && el('varPill').classList.contains('on'), 'variabile scelta', el('varPill').textContent);
el('pgPill').click(); await sleep(50);
items().find(b => b.dataset.v === 'derivate').click(); await until(() => currentPage === 'derivate');
eq('pagina scelta', el('pgPill').textContent.trim(), 'Misure derivate');
el('regPill').click(); await sleep(50); el('varPill').click(); await sleep(50);
eq('un menu alla volta', [...document.querySelectorAll('#pillMenu, #moreMenu')].filter(vis).length, 1);
document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' })); await sleep(50);
log(!vis(el('pillMenu')), 'Esc chiude', '');
el('moreBtn').click(); await sleep(50);
const dark0 = document.body.classList.contains('dark'); el('themeBtn').click();
log(document.body.classList.contains('dark') !== dark0, '⋯ → tema', ''); el('moreBtn').click(); el('themeBtn').click();
el('moreBtn').click(); el('resetBtn').click(); await until(() => el('region').value === 'ALL' && !filterVar, 20000);
eq('⋯ → azzera i filtri', [el('regPill').textContent.trim(), el('varPill').textContent.trim()], ['Tutte le regioni', 'Tutte le variabili']);
el('pgPill').click(); await sleep(50);
items().find(b => b.dataset.v === 'dirette').click(); await until(() => currentPage === 'dirette');
history.replaceState(null, '', '#FVG/A280/TAPP'); await applyHash();                       // variabile derivata
eq('pillole seguono lo stato', el('pgPill').textContent.trim(), 'Misure derivate');
```

  e in `suiteLayout`, solo a `innerWidth <= 360`, `el('varPill').click()` poi
  `log(el('pillMenu').getBoundingClientRect().bottom <= innerHeight, 'menu dentro lo schermo a 320 px', …)`.
- [ ] **Step 2: Verifica che falliscano** — `run.sh "it_local.html?suite=search"`: le nuove righe FAIL (`openMenu`
  assente), le 7 del Task 1 PASS.
- [ ] **Step 3: Implementa** `openMenu`, `closeMenu`, `syncPills` e i clic delle pillole: Pagina → voci dai
  pulsanti `#pages .pg` (`v` = `data-page`), scelta = `click()` su quel pulsante; Regione → opzioni di `#region`,
  scelta = valore + `dispatchEvent(new Event('change'))`; Variabile → opzioni di `#varFilter` con `filter:true` se
  piu' di 12, scelta come Regione; ⋯ → mostra/nasconde `#moreMenu` (i tre pulsanti hanno gia' i loro ascoltatori);
  un clic fuori o Esc chiude; aprire un menu chiude l'altro. `#pillMenu` alto al massimo
  `calc(100vh - <top> - 16px)` con scorrimento interno; sul telefono largo quanto lo schermo meno 16 px.
- [ ] **Step 4: Verifica che passino** — `run.sh "it_local.html?suite=search"` tutto PASS; `w.html?w=320&h=568&src=it_live.html%3Fsuite%3Dlayout`
  PASS compresa la riga del menu.

### Task 3: Ricerca con suggerimenti

**Files:**
- Modify: `site/index.html` (sezione script "RICERCA": sostituisce quella del datalist `#stationSearch`; CSS
  `#searchList`)
- Test: `tests/web/it_tests.js` (`suiteSearch`)

**Interfaces:**
- Produces: `normTxt(s: string) -> string` (minuscole, senza accenti via `normalize('NFD')`, ogni carattere non
  alfanumerico diventa spazio, spazi compattati); `searchStations(q: string, list: Feature[]) -> Feature[]` (al
  massimo 8; ogni parola della richiesta deve essere inizio di una parola del nome, oppure la richiesta e' uguale
  al codice o alla sigla della regione; ordine: nome che comincia con la richiesta, poi parola che comincia, poi
  il resto, a parita' alfabetico); `stationMainValue(p) -> {label: string, text: string} | null` (la variabile
  scelta se la stazione l'ha, altrimenti la prima fra `TEMP`, `LIVIDRO`, `PREC24`, `EAQI` presente in
  `p.latest`; `text` = valore + unita' della regione, come `tooltipHtml`); `regionLabel(reg) -> string` (testo
  dell'opzione di `#region` del gruppo che contiene `reg`, o `reg`); `pickStation(f: Feature) -> void`
  (`map.flyTo` sulla stazione a zoom almeno 10, poi `selectStation(f.properties)`). R2 riusera'
  `stationMainValue` nella scheda al passaggio.

- [ ] **Step 1: Scrivi le prove che falliscono:**

```js
const F = (name, scode, r) => ({ properties:{ name, scode, _region:r, variables:[] } });
const L = [F('FORLÌ', 'F1', 'ER'), F("Sant'Ambrogio di Valpolicella", 'S2', 'VEN'), F('Monte Forlì', 'M3', 'ER')];
eq('ricerca: accenti e apostrofi', [searchStations('forli', L), searchStations('sant amb', L)].map(r => r.map(f => f.properties.scode)), [['F1', 'M3'], ['S2']]);
eq('ricerca: codice', searchStations('s2', L).map(f => f.properties.scode), ['S2']);
eq('ricerca: niente', searchStations('zzzz', L), []);
const q = el('stationQ'), type = s => { q.value = s; q.dispatchEvent(new Event('input')); };
q.focus(); type('arba'); await sleep(100);
const first = el('searchList').querySelector('[data-k]');
log(first && first.textContent.includes('Arba') && first.textContent.includes(regionLabel('FVG')), 'suggerimento con regione', first && first.textContent);
q.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter' }));
await until(() => currentStation && currentStation.scode === 'A280');
eq('Invio apre la stazione', [currentStation.scode, q.value, vis(el('searchList'))], ['A280', '', false]);
showMapView();
type('zzzz'); await sleep(100);
eq('nessun risultato', el('searchList').textContent.trim(), 'Nessuna stazione');
q.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'/', bubbles:true }));
log(document.activeElement === q, '"/" porta alla ricerca', document.activeElement && document.activeElement.id);
const other = document.createElement('input'); document.body.appendChild(other); other.focus();
other.dispatchEvent(new KeyboardEvent('keydown', { key:'/', bubbles:true }));
log(document.activeElement === other, '"/" non ruba il fuoco', ''); other.remove();
```

- [ ] **Step 2: Verifica che falliscano** — `run.sh "it_local.html?suite=search"`: FAIL da `searchStations` assente.
- [ ] **Step 3: Implementa** le cinque funzioni e l'elenco: `input` sul campo → `searchStations(q, stationsForList())`
  → righe `[data-k=featKey]` con nome (`featName`), `regionLabel` e `stationMainValue().text`; frecce su/giu' spostano
  la riga attiva, Invio o clic → `pickStation`, campo svuotato, elenco chiuso; Esc chiude e toglie il fuoco; `/` e
  `Ctrl/⌘+K` danno il fuoco al campo solo se il fuoco non e' gia' in un `input`, `textarea` o `select`. Togli il
  datalist (`#stationOptions`, `_searchMap` e il suo riempimento in `buildStationFilter`) e il campo `#stationSearch`.
- [ ] **Step 4: Verifica che passino** — `run.sh "it_local.html?suite=search"` tutto PASS; `it_local.html?suite=hash`
  PASS.

### Task 4: Pulsanti della mappa in colonna a destra (telefono: nella riga delle pillole)

**Files:**
- Modify: `site/index.html` (`initMap`: posizione di `.mapctl` e dello zoom; testo dei pulsanti in
  `<span class="mc-l">`; CSS `.leaflet-top.leaflet-right`, `.mapctl`; nuova `placeTools()`)
- Test: `tests/web/it_tests.js` (`suiteLayout`, `suiteSearch`)

**Interfaces:**
- Consumes: `PHONE` (plancia), `#pillRow` (Task 1).
- Produces: `placeTools() -> void`: sul telefono sposta `.mapctl` in fondo a `#pillRow` (etichette visibili), su
  desktop lo rimette nell'angolo in alto a destra di Leaflet fra sfondi e zoom (solo icone, etichetta in `title` e
  `aria-label`); chiamata da `initMap` e su `PHONE` `change`. Lo zoom va in `topright` (`map.zoomControl.setPosition`).
  Sul telefono gli angoli alti di Leaflet scendono sotto `#topbar` (`top` = altezza di `#topbar` + 8 px).

- [ ] **Step 1: Scrivi le prove che falliscono** — in `suiteLayout` aggiungi `barra:'#topbar'` ai selettori e salta
  `.mapctl` quando sta dentro `#topbar`; poi:

```js
const inRow = !!el('pillRow') && el('pillRow').contains(document.querySelector('.mapctl'));
const inRight = !!document.querySelector('.leaflet-top.leaflet-right .mapctl');
eq('pulsanti mappa al posto giusto', phone ? [inRow, inRight] : [inRow, inRight], phone ? [true, false] : [false, true]);
const lab = [...document.querySelectorAll('.mapctl .mc-l')].map(s => vis(s));
log(phone ? lab.every(Boolean) : lab.every(v => !v), phone ? 'etichette visibili sul telefono' : 'solo icone su desktop', JSON.stringify(lab));
log([...document.querySelectorAll('.mapctl button')].every(b => b.getAttribute('aria-label')), 'pulsanti con aria-label', '');
```

- [ ] **Step 2: Verifica che falliscano** — `run.sh "it_live.html?suite=layout"` e `w.html?w=375&h=812&src=it_live.html%3Fsuite%3Dlayout`:
  FAIL `pulsanti mappa al posto giusto` (e sovrapposizioni `barra×pulsanti` su desktop).
- [ ] **Step 3: Implementa** `placeTools`, lo zoom in alto a destra, le etichette `.mc-l` (nascoste su desktop
  con `display:none`, visibili sul telefono), `aria-label` e `title` sui tre pulsanti.
- [ ] **Step 4: Verifica che passino** — layout desktop, scuro, solo stazioni, 320/375/430 tutti PASS; `it_live.html?suite=radar`
  e `it_prod.html?suite=prodotti` PASS (gli id `mcRain`, `mcSnap`, `mcRadar` non cambiano).

### Task 5: Controllo finale, misure e pubblicazione

**Files:**
- Modify: `tests/web/README.md` (riga della suite `search`)
- Test: tutte le suite di `tests/web`, prove Python

- [ ] **Step 1: Tutte le prove** — rigenera le pagine e lancia: `test.html`; `it_local` search, dock, cursor, hash;
  `it_noradar` resilience; `it_prod` prodotti, buffer; `it_live` radar e layout (desktop, `&dark=1`, `&noradar=1`,
  w.html 320/375/430). Atteso: tutte `RISULTATO: n/n`. Poi `/usr/bin/python3 -m unittest discover -s tests -t .` → OK.
- [ ] **Step 2: Controllo a occhio** — anteprima locale (`it_live.html?suite=x`, nascondendo `#out`): desktop 1280,
  900, telefono 320/375/430, chiaro e scuro; ricerca, tre menu, ⋯, pannello Fonti, radar acceso. Screenshot per l'utente.
- [ ] **Step 3: Nessun rallentamento** — confronto vecchia/nuova a cache vuota come per la plancia (pagine con
  indirizzi dei dati resi unici, 3 prove alternate): tempi delle stazioni entro il rumore.
- [ ] **Step 4: Pubblicazione, solo col via dell'utente** — avvisa le sessioni Mappe e Dati; md5 di
  `site/index.html` sul Pi uguale all'ultima versione nota e `diff` Pi↔locale fatto solo di questo rilascio;
  `rsync` di `site/index.html` sul Pi; dopo il publish delle :x5 verifica il sito con il `diff` che ignora la riga
  `DATA_BASE` e una prova a occhio sul sito vero; `setup.py --clean`, server di anteprima fermato.
