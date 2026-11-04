# Interfaccia "Mappa protagonista", rilascio 2 "Scheda al passaggio" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** al passaggio del mouse su un puntino una scheda accanto al puntino (nome, regione · fonte, ora del dato,
valore grande con la variazione, andamento 24 h, tre valori chiave); al tocco un foglio basso con lo stesso contenuto e
"Apri la scheda". Spariscono i tooltip di Leaflet (anche quello del Cursore).

**Architecture:** tutto in `site/index.html`, nuova sezione script "SCHEDA AL PASSAGGIO" dopo la sezione RICERCA del
rilascio 1 (ne riusa `stationMainValue`, `latestText`, `regionLabel`). Il contenuto e' calcolato da funzioni pure
(`cardModel`) e disegnato in un solo elemento riposizionato (`#hoverCard`) o nel foglio (`#sheet`). L'andamento viene
dai file orari del Cursore (`<REG>/snap/<VAR>.json`), caricati alla prima scheda e tenuti in memoria. Il tipo di
puntatore dell'ultimo gesto (mouse o tocco) decide scheda o foglio.

**Tech Stack:** HTML/CSS/JS in un file, Leaflet 1.9.4 (renderer canvas), prove nel browser di `tests/web`.

**Spec:** `docs/superpowers/specs/2026-11-02-interfaccia-mappa-protagonista-design.md` (rilascio 2; sezioni "Scheda al
passaggio", "Telefono", "Rischi"). Rilascio 1 fatto: `docs/superpowers/plans/2026-11-02-interfaccia-r1-ricerca-pillole.md`
e il suo registro `…r1-ricerca-pillole.ledger.md` (minori rimandati, non in questo piano).

## Global Constraints

- Un solo file del sito: `site/index.html` (`publish.sh` pubblica solo `index.html` e `radar.js`).
- Altre sessioni modificano `index.html` (Dati: forse `fmtNum`): avvisarle prima di iniziare, solo Edit mirate,
  rileggere il pezzo prima di toccarlo, mai riscrivere il file; prima di pubblicare md5 del Pi e diff solo di R2.
- Etichette brevi in italiano, punto decimale. Testi fissi: `Clic: apre la scheda`, `Apri la scheda`, `n.d.`,
  `min`, `max`, `in 1 h`, `ultima ora`, `adesso`, `N min fa`, `N h fa`, `N g fa`. Etichette dei valori chiave:
  PREC24 `Pioggia 24 h`, VVENTO `Vento`, UMID `Umidità`, TEMP `Temperatura`, LIVIDRO `Livello`, PORTATA `Portata`,
  TEMPACQUA `Acqua`, MAREA `Marea`, ONDE `Onde`, PM10 `PM10`, NO2 `NO₂`, O3 `O₃`, PRESS `Pressione`, LIVNEVE `Neve`.
- Materiali e colori della plancia e della barra in alto: `--pbg`, `--pl`, `--pl2`, `--psh`, `--ink`, `--fg`, `--muted`,
  `--accent`; tema scuro con `body.dark`.
- Verifica a 320, 375, 430 px e desktop, chiaro e scuro. Link `#REG/COD/VAR[/S:…|H:…]` invariati.
- Niente commit git (l'utente li fa solo su richiesta). Nessuna pubblicazione senza il suo via.
- Prove: `/usr/bin/python3 tests/web/setup.py` dopo ogni modifica di `index.html`; server `site` sulla 8772
  (preview_start); `tests/web/run.sh "it_local.html?suite=hover"` e
  `tests/web/run.sh "w.html?w=375&h=812&src=it_local.html%3Fsuite%3Dhover"`; alla fine `setup.py --clean`.
  Sul Mac per attendere usare `/bin/sleep`.

## Scelte di questo piano (da confermare con il piano)

1. Decide il gesto, non la larghezza: col mouse la scheda (anche in una finestra stretta), col tocco il foglio (anche
   su un tablet largo). La spec parla di "solo con mouse" e "Tocco su un puntino": e' la stessa intenzione.
2. Senza file orari (livelli, aria, mare, laghi) niente andamento e niente variazione: il valore precedente non e' in
   memoria e scaricare la serie della stazione a ogni passaggio romperebbe i 100 ms.
3. Pioggia: l'andamento sono le barre della pioggia oraria (PREC1) delle ultime 24 h e la riga `ultima ora: X mm`,
   non la variazione oraria di una somma mobile.
4. Al tocco un puntino non apre piu' subito la stazione: apre il foglio; `Apri la scheda` la apre (un tocco in piu',
   come dice la spec). Col mouse il clic apre la stazione come oggi.
5. Il puntino del foglio aperto ha un anello sulla mappa.
6. Col Cursore o il radar la scheda mostra il valore del fotogramma scelto e si aggiorna quando il fotogramma cambia
   (anche durante la riproduzione).

## Review Focus

1. Passaggio veloce su puntini fitti (laguna di Venezia, pianura lombarda): la scheda mostra sempre e solo la stazione
   sotto il mouse, senza sfarfallare fra due (Task 2, prova `passaggio veloce`).
2. Stazione senza ultimo valore o senza ora del dato (o con valori vuoti): la scheda mostra nome e regione, mai
   "undefined", "NaN" o "null" (Task 1 `stazione senza dati`, Task 2 `nessun undefined`).
3. Cursore o radar in riproduzione: la scheda segue il fotogramma; `n.d.` dove il fotogramma non ha dato (Task 3).
4. Puntini vicino alla barra in alto, alla colonna di destra, alla plancia e ai bordi: la scheda resta tutta visibile e
   non copre mai pulsanti, plancia o il puntino stesso (Task 2, tre posizioni).
5. Tocco: il foglio si apre al posto della stazione, la scheda del mouse non compare per gli eventi mouse emulati dal
   tocco, la plancia torna quando il foglio si chiude (Task 4).

---

### Task 1: Contenuto della scheda (funzioni pure)

**Files:**
- Modify: `site/index.html` (nuova sezione script "SCHEDA AL PASSAGGIO" dopo la sezione RICERCA; `stationMainValue`
  restituisce anche `v`)
- Test: `tests/web/it_tests.js` (nuova `suiteHover`, registrata come `hover`)

**Interfaces:**
- Consumes (rilascio 1): `stationMainValue(p)`, `latestText(p, v)`, `regionLabel(reg)`, `SOURCES`, `_DIR16`,
  `civToUtc`, `civT`, `prettyName`.
- Produces: `ageText(latestTime: string, nowMs: number) -> string` ('' se manca o non si legge); `timeText(latestTime,
  nowMs) -> string` (`HH:MM · <age>` se e' lo stesso giorno civile di `nowMs`, altrimenti `GG/MM HH:MM · <age>`; '' se
  manca); `KEY_VARS: string[]` e `KEY_LABELS: {[v]: string}` (ordine e testi delle Global Constraints);
  `keyValues(p, main: string|null) -> {v, label, text}[]` (al massimo 3, nell'ordine di `KEY_VARS`, senza `main`, solo
  con `p.latest[v] != null && p.latest[v] !== ''`; per VVENTO con DVENTO il testo finisce con la direzione da
  `_DIR16`); `cardModel(p) -> {name, where, time, main: {v, label, text}|null, keys}` (`where` = regione e, se c'e',
  ` · ` + nome della fonte). `stationMainValue(p)` restituisce `{v, label, text}`.

- [ ] **Step 1: Scrivi le prove che falliscono** — `suiteHover` (e `hover:suiteHover` nella mappa delle suite):

```js
async function suiteHover(){                          // scheda al passaggio (mouse) e foglio basso (tocco), rilascio 2
  const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
  const now = Date.UTC(2026, 10, 2, 11, 10);                                      // 12:10 ora italiana (CET)
  eq('da quanto', ['2026-11-02T12:10', '2026-11-02T12:00', '2026-11-02T09:10', '2026-10-30T12:10', '', 'x'].map(s => ageText(s, now)),
     ['adesso', '10 min fa', '3 h fa', '3 g fa', '', '']);
  eq('ora del dato', [timeText('2026-11-02T12:00', now), timeText('2026-10-30T12:10', now), timeText(undefined, now)],
     ['12:00 · 10 min fa', '30/10 12:10 · 3 g fa', '']);
  const P = { name:'Arba', scode:'X1', _region:'FVG', variables:['TEMP','PREC24','VVENTO','DVENTO','UMID','PRESS'],
              latest:{ TEMP:'16.9', PREC24:2.4, VVENTO:'12', DVENTO:'135', UMID:'71', PRESS:'1012' }, latest_time:'2026-11-02T12:00' };
  const K = keyValues(P, 'TEMP');
  eq('valori chiave', K.map(k => [k.v, k.label]), [['PREC24', 'Pioggia 24 h'], ['VVENTO', 'Vento'], ['UMID', 'Umidità']]);
  log(/ SE$/.test(K[1].text), 'vento con la direzione', K[1].text);
  const M = cardModel(P);
  eq('modello', [M.name, M.where, M.main && M.main.v, M.keys.length], ['Arba', regionLabel('FVG') + ' · ' + SOURCES.FVG.name, 'TEMP', 3]);
  const E = cardModel({ name:'Vuota', scode:'X2', _region:'ZZ', variables:[], latest:{ TEMP:'' } });
  eq('stazione senza dati', [E.name, E.where, E.main, E.keys, E.time], ['Vuota', 'ZZ', null, [], '']);
  // (Task 2-4: le loro prove vanno qui, prima della chiusura)
  eq('errori JS', window.__errs, []);
  finish();
}
```

- [ ] **Step 2: Verifica che falliscano** — `setup.py && run.sh "it_local.html?suite=hover"`. Atteso: `FAIL eccezione:
  ReferenceError: ageText is not defined`.
- [ ] **Step 3: Implementa** le funzioni dell'Interfaccia. `ageText`: minuti dall'istante vero
  (`civToUtc(Date.UTC(...)/1000)`) a `nowMs`; < 1 → `adesso`, < 60 → `N min fa`, < 48 h → `N h fa`, poi `N g fa`
  (per difetto). `stationMainValue`: stesso comportamento del rilascio 1, piu' `v`; un valore `''` vale come assente.
- [ ] **Step 4: Verifica che passino** — stessa pagina: `RISULTATO: 7/7`; `it_local.html?suite=search` ancora 43/43.

### Task 2: Scheda accanto al puntino (mouse)

**Files:**
- Modify: `site/index.html` (markup `<div id="hoverCard" role="tooltip" hidden>` dentro `#views`; CSS della scheda;
  `renderMarkers`: via i `bindTooltip` non fissi, `mouseover`/`mouseout`, clic diviso per puntatore; via
  `tooltipHtml`, `snapTooltip` e `.leaflet-tooltip.stz`; ascoltatori `pointerdown`/`pointermove` sulla mappa)
- Test: `tests/web/it_tests.js` (`suiteHover`)

**Interfaces:**
- Consumes: `cardModel` (Task 1), `markerRefs`, `clickAt` (prove).
- Produces: `lastPointer: string` (`'mouse'` all'avvio, poi il `pointerType` dell'ultimo `pointerdown`/`pointermove`
  sulla mappa); `showCard(p, m) -> void` (dopo 80 ms dal `mouseover`, solo se `lastPointer === 'mouse'`; un nuovo
  `mouseover` annulla quello in attesa); `hideCard() -> void` (anche all'inizio di `renderMarkers`, al clic, alla
  partenza di uno spostamento della mappa); `renderCard() -> void` (ridisegna la scheda aperta); `cardObstacles() ->
  DOMRect[]` (`#topbar` con i menu e i pannelli aperti, `.leaflet-top.leaflet-right`, `#dock`, `#prodMenu` aperto);
  `placeCard(card, pt) -> void`.
  Algoritmo di `placeCard` (le prove non lo fissano tutto): candidati a destra del puntino (centrata in verticale), a
  sinistra, sotto, sopra, a 12 px; ognuno stretto dentro `#views` meno 8 px; vince il primo che non tocca nessun
  ostacolo e non copre il puntino (±6 px); se nessuno, quello con meno area coperta. Larghezza 260 px.
  Contenuto: `.hc-name`, `.hc-where`, `.hc-time`, `.hc-main` (`.hc-val` grande, `.hc-lab` etichetta), `.hc-delta`
  (Task 3), `.hc-spark` (Task 3), `.hc-keys` (tre riquadri `label` sopra, valore sotto), `.hc-hint` `Clic: apre la
  scheda`. Righe vuote non disegnate.

- [ ] **Step 1: Scrivi le prove che falliscono** (in `suiteHover`, dopo il Task 1, prima della chiusura). La stazione di
  prova e' una FVG isolata (nessun altro puntino entro 12 px: Arba ha un omonimo PC_FVG nello stesso punto) presente nei
  file orari TEMP e PREC1; `mk(AP)` ritrova il suo puntino dopo ogni `renderMarkers`:

```js
  el('region').value = 'FVG'; await loadRegions(REGION_GROUPS.FVG || ['FVG']); await sleep(300);
  const scr = r => { const p = map.latLngToContainerPoint(r.m.getLatLng()), c = map.getContainer().getBoundingClientRect(); return [c.left + p.x, c.top + p.y]; };
  const [ST, SP] = await Promise.all(['TEMP', 'PREC1'].map(async v => (await fdata('FVG/snap/' + v + '.json')).json()));
  const lone = r => markerRefs.every(o => o === r || Math.hypot(scr(o)[0] - scr(r)[0], scr(o)[1] - scr(r)[1]) > 12);
  const A = markerRefs.find(r => r.p._region === 'FVG' && r.p.latest.TEMP != null && r.p.latest.PREC24 != null && ST.s[r.p.scode] &&
                                 ST.s[r.p.scode].slice(-25).filter(x => x != null).length > 20 && SP.s[r.p.scode] && lone(r));
  const AP = A.p, mk = p => markerRefs.find(r => r.p === p), card = el('hoverCard'), NAME = prettyName(AP.name || AP.scode);
  const move = (x, y) => { const t = document.elementFromPoint(x, y);
    t.dispatchEvent(new PointerEvent('pointermove', { pointerType:'mouse', clientX:x, clientY:y, bubbles:true }));
    t.dispatchEvent(new MouseEvent('mousemove', { clientX:x, clientY:y, bubbles:true })); };
  const hoverAt = r => move(...scr(r));
  const far = r => markerRefs.find(o => { const a = scr(r), b = scr(o); return lone(o) && Math.hypot(a[0] - b[0], a[1] - b[1]) > 200; });
  const meet = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  hoverAt(A); await sleep(100);
  log(vis(card) && card.querySelector('.hc-name').textContent === NAME, 'scheda entro 100 ms', card.textContent.slice(0, 80));
  log(!/undefined|NaN|null/.test(card.textContent), 'nessun undefined', card.textContent);
  log(card.textContent.includes('Clic: apre la scheda'), 'invito al clic', '');
  log(markerRefs.every(r => !r.m.getTooltip() || r.m.getTooltip().options.permanent), 'niente tooltip di Leaflet al passaggio', '');
  const B = far(A); hoverAt(A); await sleep(30); hoverAt(B); await sleep(120);
  eq('passaggio veloce', card.querySelector('.hc-name').textContent, prettyName(B.p.name || B.p.scode));
  move(5, innerHeight / 2); await sleep(150);                                     // fuori dai puntini
  log(!vis(card), 'uscendo dal puntino sparisce', '');
  for(const [tag, X, Y] of [['sotto la barra', 40, el('topbar').getBoundingClientRect().bottom + 14],
                            ['vicino alla colonna', innerWidth - 70, 160],
                            ['sopra la plancia', innerWidth / 2, el('dock').getBoundingClientRect().top - 12]]){
    const [x, y] = scr(A), c = map.getContainer().getBoundingClientRect();
    map.panBy([x - X, y - Y], { animate:false }); await sleep(150); hoverAt(A); await sleep(120);
    const R = card.getBoundingClientRect(), [dx, dy] = scr(A);
    const hits = cardObstacles().filter(o => meet(R, o)).length;
    log(vis(card) && !hits && !(dx > R.left - 6 && dx < R.right + 6 && dy > R.top - 6 && dy < R.bottom + 6) &&
        R.left >= c.left && R.right <= c.right && R.top >= c.top && R.bottom <= c.bottom, 'posizione: ' + tag, JSON.stringify([R.left, R.top, R.right, R.bottom, hits]));
  }
  map.getContainer().dispatchEvent(new PointerEvent('pointerdown', { pointerType:'mouse', bubbles:true }));
  clickAt(A.m.getLatLng()); await until(() => currentStation === AP);
  log(currentStation === AP && !vis(card), 'clic col mouse: apre la stazione, la scheda sparisce', '');
  showMapView();
```

- [ ] **Step 2: Verifica che falliscano** — `run.sh "it_local.html?suite=hover"`: le righe del Task 2 FAIL (prima
  `scheda entro 100 ms`), quelle del Task 1 PASS.
- [ ] **Step 3: Implementa** l'Interfaccia; il clic su un puntino: col mouse `hideCard(); selectStation(p)` come oggi,
  col tocco il foglio (Task 4; fino ad allora come oggi). Le etichette fisse a zoom alto (`vlab`) restano.
- [ ] **Step 4: Verifica che passino** — `hover` tutto PASS; `it_live.html?suite=radar`, `it_local.html?suite=cursor`,
  `?suite=hash`, `?suite=search` PASS.

### Task 3: Andamento 24 h, variazione e Cursore

**Files:**
- Modify: `site/index.html` (sezione SCHEDA: file orari in memoria, andamento, variazione; `setFrame` ridisegna la
  scheda aperta)
- Test: `tests/web/it_tests.js` (`suiteHover`)

**Interfaces:**
- Consumes: `showCard`/`renderCard` (Task 2), `snap`, `snapVal`, `fmtFrame`, `fdata`, `SNAP_VARS`, `isRain`.
- Produces: `cardSeries(p, v) -> Promise<(number|null)[] | null>` (le ultime 25 ore della stazione: da `snap.data` se
  il Cursore ha gia' quella variabile, se no da `<REG>/snap/<v>.json` scaricato una volta per regione e variabile e
  tenuto in `_cardSnap`; `null` se la variabile non ha file orari o la stazione non c'e');
  `sparkSvg(vals: (number|null)[], bars: boolean) -> string` (SVG 236×34, linea spezzata sui buchi o barre; '' se meno
  di 2 valori); testo `.hc-delta`: non pioggia `+0.4 °C in 1 h` (segno sempre, un decimale, unita' della regione),
  pioggia `ultima ora: X mm` da `p.latest.PREC1`; `.hc-mm` `min X · max Y` delle 24 h.
  Col Cursore o il radar aperti (`snap.on`): `.hc-time` = `fmtFrame(snap.T[snap.k])`, valore = `snapVal(p)` con
  `snap.unit` (o `n.d.`), etichetta `varLabel(snap.var)`; niente variazione.

- [ ] **Step 1: Scrivi le prove che falliscono:**

```js
  eq('andamento: linea e barre', [sparkSvg([1, 2, null, 3], false).includes('<polyline'), sparkSvg([0, 1.2, 0], true).includes('<rect'), sparkSvg([5], false)], [true, true, '']);
  hoverAt(mk(AP)); await until(() => card.querySelector('.hc-spark svg'), 5000);
  log(!!card.querySelector('.hc-spark svg') && /^min .+ · max .+$/.test(card.querySelector('.hc-mm').textContent), 'temperatura: andamento 24 h e min/max', card.textContent);
  log(/^[+-]\d+\.\d .+ in 1 h$/.test(card.querySelector('.hc-delta').textContent), 'variazione in 1 h', card.querySelector('.hc-delta').textContent);
  const L = markerRefs.find(r => r.p._region === 'PC_FVG' && r.p.latest.LIVIDRO != null && r.p.latest.TEMP == null && lone(r));   // solo livello
  if(L){ hoverAt(L); await sleep(600); }
  log(!!L && vis(card) && !card.querySelector('.hc-spark svg') && !card.querySelector('.hc-delta').textContent, 'livello: niente andamento', L && L.p.scode);
  setMapVar('PREC24'); await until(() => filterVar === 'PREC24'); await sleep(200);
  hoverAt(mk(AP)); await until(() => card.querySelector('.hc-spark rect'), 5000);
  log(/^ultima ora: /.test(card.querySelector('.hc-delta').textContent), 'pioggia: barre orarie e ultima ora', card.querySelector('.hc-delta').textContent);
  await openSlider(); await until(() => snap.on && snap.T.length, 20000);
  setFrame(snap.kmax - 3); hoverAt(mk(AP)); await sleep(150);
  const sv = snapVal(AP), fr = () => card.querySelector('.hc-time').textContent;
  eq('Cursore: valore al fotogramma', [fr(), card.querySelector('.hc-val').textContent], [fmtFrame(snap.T[snap.k]), sv == null ? 'n.d.' : sv + (snap.unit ? ' ' + snap.unit : '')]);
  setFrame(snap.kmax); await sleep(50);
  eq('Cursore: la scheda segue il fotogramma', fr(), fmtFrame(snap.T[snap.k]));
  closeSlider(); setMapVar(''); move(5, innerHeight / 2); await sleep(150);
```

- [ ] **Step 2: Verifica che falliscano** — FAIL da `sparkSvg is not defined`.
- [ ] **Step 3: Implementa** l'Interfaccia. La scheda compare subito senza andamento e lo aggiunge quando il file
  arriva (solo se mostra ancora la stessa stazione).
- [ ] **Step 4: Verifica che passino** — `hover` tutto PASS; `it_local.html?suite=cursor` PASS (registrazione del Cursore
  invariata).

### Task 4: Foglio basso al tocco

**Files:**
- Modify: `site/index.html` (markup `<div id="sheet" role="dialog" aria-label="Stazione" hidden>` dentro `#views` con
  `.sh-grab`, `#sheetClose` (×), contenuto come la scheda, `#sheetOpen` `Apri la scheda`; CSS; clic dei puntini;
  `body.sheet-open` nasconde `#dock` e `#prodMenu`)
- Test: `tests/web/it_tests.js` (`suiteHover`)

**Interfaces:**
- Consumes: `cardModel`, `renderCard` (stesso disegno), `lastPointer` (Task 2).
- Produces: `openSheet(p) -> void` (riempie e mostra `#sheet`, anello `sheetRing` (`L.circleMarker` senza riempimento,
  raggio del puntino + 5) sulla stazione, `body.sheet-open`); `closeSheet() -> void` (nasconde, toglie l'anello e la
  classe; chiamata da ×, dal tocco sulla mappa fuori dai puntini, dal trascinamento in giu' di oltre 40 px sulla
  linguetta, da `Apri la scheda` dopo `selectStation(p)`, all'inizio di `renderMarkers`). Il foglio: in basso, sul
  telefono largo quanto lo schermo meno 16 px, su schermi larghi 440 px a sinistra (dove sta la plancia).

- [ ] **Step 1: Scrivi le prove che falliscono:**

```js
  const tapAt = (r, type) => { const [x, y] = scr(r);
    map.getContainer().dispatchEvent(new PointerEvent('pointerdown', { pointerType:type, clientX:x, clientY:y, bubbles:true }));
    clickAt(r.m.getLatLng()); };
  showMapView(); await sleep(100);
  const A2 = mk(AP), st0 = currentStation;
  tapAt(A2, 'touch'); await sleep(150);
  log(vis(el('sheet')) && el('sheet').textContent.includes(NAME) && el('sheet').textContent.includes('Apri la scheda'), 'tocco: foglio basso', '');
  eq('tocco: la stazione non si apre da sola', currentStation, st0);
  log(!vis(el('hoverCard')), 'tocco: niente scheda del mouse', '');
  log(!vis(el('dock')) && !!sheetRing && map.hasLayer(sheetRing), 'foglio aperto: plancia nascosta, stazione evidenziata', '');
  if(innerWidth <= 720){ const S = el('sheet').getBoundingClientRect(); log(Math.abs(S.left - 8) < 1 && Math.abs(innerWidth - 8 - S.right) < 1, 'telefono: foglio largo quanto lo schermo', JSON.stringify([S.left, S.right])); }
  el('sheetClose').click(); await sleep(50);
  log(!vis(el('sheet')) && vis(el('dock')) && !map.hasLayer(sheetRing), '× chiude, la plancia torna', '');
  tapAt(A2, 'touch'); await sleep(100);
  const g = el('sheet').querySelector('.sh-grab').getBoundingClientRect();
  el('sheet').querySelector('.sh-grab').dispatchEvent(new PointerEvent('pointerdown', { pointerType:'touch', clientX:g.left + 10, clientY:g.top + 2, bubbles:true }));
  el('sheet').querySelector('.sh-grab').dispatchEvent(new PointerEvent('pointerup', { pointerType:'touch', clientX:g.left + 10, clientY:g.top + 60, bubbles:true }));
  await sleep(50); log(!vis(el('sheet')), 'trascinato in giu: si chiude', '');
  tapAt(A2, 'touch'); await sleep(100);
  el('sheetOpen').click(); await until(() => currentStation === AP);
  log(currentStation === AP && !vis(el('sheet')), '"Apri la scheda" apre la stazione e chiude il foglio', '');
  showMapView();
```

- [ ] **Step 2: Verifica che falliscano** — FAIL da `tocco: foglio basso` in poi.
- [ ] **Step 3: Implementa** l'Interfaccia; nel `click` dei puntini `lastPointer === 'mouse'` apre la stazione, altrimenti
  `openSheet(p)`; un `click` della mappa fuori dai puntini chiude il foglio (i puntini hanno gia'
  `bubblingMouseEvents:false`).
- [ ] **Step 4: Verifica che passino** — `run.sh "it_local.html?suite=hover"` e
  `run.sh "w.html?w=375&h=812&src=it_local.html%3Fsuite%3Dhover"` tutto PASS; `it_live.html?suite=layout` e i telefoni
  320/375/430 PASS (la plancia non cambia a foglio chiuso).

### Task 5: Controllo finale, misure e pubblicazione

**Files:**
- Modify: `tests/web/README.md` (riga della suite `hover`)
- Test: tutte le suite di `tests/web`, prove Python

- [ ] **Step 1: Tutte le prove** — rigenera le pagine e lancia tutte le suite del rilascio 1 piu' `hover` (desktop e
  375 px). Atteso: tutte `RISULTATO: n/n`. Poi `/usr/bin/python3 -m unittest discover -s tests -t .` → OK.
- [ ] **Step 2: Controllo a occhio** — anteprima con i dati veri (`it_live.html?suite=x`, `#out` nascosto): desktop
  1280 e ~800, telefono 320/375/430, chiaro e scuro; scheda su meteo, idrometro, aria, mare; scheda col Cursore in
  riproduzione e col radar; foglio al tocco col radar acceso. Screenshot per l'utente.
- [ ] **Step 3: Nessun rallentamento** — confronto vecchia/nuova a cache vuota dei dati (indirizzi resi unici, 3 prove
  alternate): stazioni complete entro il rumore; tempo dalla mossa del mouse alla scheda visibile < 100 ms.
- [ ] **Step 4: Pubblicazione, solo col via dell'utente** — avvisa Dati; md5 di `site/index.html` sul Pi uguale
  all'ultima versione nota (oggi 0a2cc84d, o quella che Dati comunica) e diff Pi↔locale fatto solo di R2; copia di
  sicurezza in `~/backups/`; `rsync` di `site/index.html` (via `pitail`, o `manuel01` da casa se Tailscale e' spento);
  dopo il publish delle :x5 verifica il sito con il diff che ignora `DATA_BASE` e una prova a occhio sul sito vero;
  `setup.py --clean`, server di anteprima fermato.
