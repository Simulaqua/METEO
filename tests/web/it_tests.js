// Prove integrate della pagina vera (copiata da build_it.py in it_local.html / it_live.html, NON pubblicate).
// Suite scelta con ?suite=cursor|radar|hash. Esito in #out ("RISULTATO: n/n"; la suite cursor stampa anche
// una riga JSON da confrontare prima/dopo il refactoring del Cursore).
(() => {
  const res = [], log = (ok, name, info) => res.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ': ' + info));
  const eq = (name, got, want) => log(JSON.stringify(got) === JSON.stringify(want), name, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function until(fn, ms = 8000){ const t0 = Date.now(); while(Date.now() - t0 < ms){ try { if(fn()) return true; } catch(e){} await sleep(50); } return false; }
  // pronto = caricamento iniziale di tutte le regioni finito (numero di stazioni fermo per 1.5 s)
  async function ready(){
    await until(() => typeof allFeatures !== 'undefined' && allFeatures.length > 0 && typeof map !== 'undefined', 30000);
    let n = -1, since = Date.now();
    while(Date.now() - since < 1500){ if(allFeatures.length !== n){ n = allFeatures.length; since = Date.now(); } await sleep(100); }
  }
  const finish = extra => {
    const ok = res.filter(l => l.startsWith('PASS')).length;
    document.getElementById('out').textContent = (extra ? extra + '\n' : '') + res.join('\n') + '\nRISULTATO: ' + ok + '/' + res.length;
  };
  // clic DOM vero nel punto della mappa (passa dal renderer canvas dei puntini, come un dito)
  function clickAt(latlng){
    const p = map.latLngToContainerPoint(latlng), r = map.getContainer().getBoundingClientRect();
    const x = r.left + p.x, y = r.top + p.y, t = document.elementFromPoint(x, y);
    ['mousedown', 'mouseup', 'click'].forEach(type =>
      t.dispatchEvent(new MouseEvent(type, { clientX:x, clientY:y, bubbles:true, cancelable:true, view:window })));
  }

  async function suiteCursor(){                       // registrazione del Cursore delle stazioni (FVG, PREC24)
    el('region').value = 'FVG';
    await loadRegions(REGION_GROUPS.FVG || ['FVG']);
    setMapVar('PREC24');
    await until(() => filterVar === 'PREC24');
    await openSlider();
    await until(() => snap.on && snap.T.length, 20000);
    const kmax = +el('tsRange').max, k0 = +el('tsRange').min, rec = { k0, kmax, labels:[], steps:[] };
    for(let k = kmax; k >= kmax - 5; k--){ setFrame(k); rec.labels.push(el('tsLab').innerHTML + ' | ' + el('tsLab').title); }
    setFrame(k0);
    for(let i = 0; i < 10; i++){ snapStep(); rec.steps.push(+el('tsRange').value); }
    setFrame(kmax - 2); snap.speed = 8; snapPlay();
    await until(() => !snap.playing, 10000);
    rec.end = { k:+el('tsRange').value, playing:snap.playing, btn:el('tsPlay').textContent };
    snap.speed = 1; closeSlider();
    log(rec.labels.length === 6 && rec.end.k === kmax && !rec.end.playing, 'registrazione completa', JSON.stringify(rec.end));
    eq('errori JS', window.__errs, []);
    finish('JSON ' + JSON.stringify(rec));
  }

  async function suiteRadar(){
    const btn = el('mcRadar');
    log(!!btn, 'pulsante Radar', 'assente');
    if(!btn) return finish();
    const rawIdx = await (await fetch('https://raw.githubusercontent.com/Simulaqua/METEO/radar/index.json', { cache:'no-store' })).json();
    const fr = rawIdx.products.SRI.frames, age = Math.round((Date.now() / 1000 - fr[fr.length - 1]) / 60);
    setMapVar('TEMP');                                 // variabile di partenza da ripristinare
    await until(() => filterVar === 'TEMP');
    btn.click();
    await until(() => Radar.on && snap.on && filterVar === 'PREC1' && tsSrc === Radar.source, 20000);
    log(Radar.on, 'radar acceso', Radar.state);
    eq('puntini su PREC1', filterVar, 'PREC1');
    log(snap.on && getComputedStyle(el('tsbar')).display !== 'none', 'barra aperta', snap.on);
    eq('sorgente di tempo radar', tsSrc === Radar.source, true);
    eq('barra = fotogrammi radar', +el('tsRange').max, Radar.source.max());
    eq('aperta sull\'ultimo', +el('tsRange').value, Radar.source.max());
    log(/^\d\d:\d\d$/.test((el('tsLab').querySelector('span') || {}).textContent), 'ora grande nella barra', el('tsLab').innerHTML);
    const tk = [...document.querySelectorAll('#tsTicks b')].map(b => b.textContent);
    log(tk.length >= 4 && tk.every(t => /^\d\d:00$/.test(t)), 'barra radar: ore piene', JSON.stringify(tk));
    const staT = () => (el('mcStaTime') || {}).textContent || '';
    log(/^\d\d:00$/.test(staT()), 'ora delle stazioni accanto a "Stazioni"', staT());
    // all'ultimo fotogramma i puntini usano l'ultima ora COMPLETA delle stazioni (come il loro Cursore), non una
    // ora ancora vuota per i ritardi delle fonti
    await until(() => snap.T.length);
    eq('stazioni all\'ultima ora completa', snap.k, Math.min(snap.kmax, snap.k));
    log(staT() === fmtFrame(snap.T[snap.k]).slice(-5) && snap.k <= snap.kmax,
        'etichetta = ora usata dai puntini', staT() + ' k=' + snap.k + ' kmax=' + snap.kmax);
    log(el('colorbar').textContent.includes('Pioggia adesso') && el('colorbar').textContent.includes('mm/h') &&
        el('colorbar').contains(el('mcStations')), 'legenda unica radar/stazioni', el('colorbar').textContent);
    eq('in alto solo Pioggia, Cursore, Radar', [...document.querySelectorAll('.mapctl button')].map(b => b.id), ['mcRain', 'mcSnap', 'mcRadar']);
    log(!el('mcRain').classList.contains('on'), 'Pioggia spento col radar', el('mcRain').className);
    el('dkProd').click(); await sleep(100);
    eq('menu del radar a gruppi', [...document.querySelectorAll('#prodMenu .pm-g')].map(g => g.dataset.g),
       ['Pioggia', 'Riflettività', 'Temporali', 'Altro']);
    eq('menu: prodotto scelto', ((document.querySelector('#prodMenu [data-key].on') || {}).dataset || {}).key, 'SRI');
    el('dkProd').click(); await sleep(100);
    log(getComputedStyle(el('prodMenu')).display === 'none', 'menu richiuso', '');
    log(document.querySelector('.leaflet-control-attribution').textContent.includes('Radar-DPC'), 'attribuzione', '');
    log(el('dock').contains(document.querySelector('.leaflet-control-attribution')), 'crediti nella plancia', '');
    log(age <= 20, 'K1 ultimo fotogramma ≤ 20 min (' + age + ' min)', age);
    // riproduzione: ~4 fotogrammi al secondo a 1x, in loop
    setFrame(0); snap.speed = 1; snapPlay(); await sleep(2000); snapPause();
    const steps = +el('tsRange').value;
    log(steps >= 6 && steps <= 10, 'K7 velocità 250 ms/fotogramma (' + steps + ' in 2 s)', steps);
    setFrame(Radar.source.max()); snapStep();
    // in fondo ricomincia dall'inizio; il piu' vecchio puo' mancare (indice in cache su raw fino a 5 min, fotogramma gia'
    // potato: 404, saltato), quindi basta che sia tornato fra i primi
    log(+el('tsRange').value <= 2, 'in fondo ricomincia', 'indice ' + el('tsRange').value + ', fotogramma 0: ' + Radar.source.label(0));
    setFrame(Radar.source.max());
    // zoom: da 11 nascosto, pulsante attenuato
    map.setZoom(11); await sleep(300);
    log(Radar.state === 'zoom' && el('mcRadar').classList.contains('dim'), 'zoom 11: nascosto e pulsante attenuato', Radar.state);
    map.setZoom(8); await sleep(300);
    log(Radar.state !== 'zoom' && !el('mcRadar').classList.contains('dim'), 'zoom 8: di nuovo visibile', Radar.state);
    // tocco in un punto vuoto della vista (nessun puntino entro 20 px): popup con la classe del radar
    const sz = map.getSize();
    let empty = null;
    const rect = map.getContainer().getBoundingClientRect();
    for(let y = 60; y < sz.y - 60 && !empty; y += 30) for(let x = 60; x < sz.x - 60 && !empty; x += 30){
      const ll = map.containerPointToLatLng([x, y]), t = document.elementFromPoint(rect.left + x, rect.top + y);
      const onMap = t && t.closest('#map') && !t.closest('.leaflet-control');           // niente pannelli o controlli sopra
      if(onMap && Radar.gridPixel(ll.lat, ll.lng) &&
         !markerRefs.some(r => map.latLngToContainerPoint(r.m.getLatLng()).distanceTo([x, y]) < 20)) empty = ll;
    }
    if(!empty){ log(false, 'punto vuoto sulla mappa', 'nessuno'); return finish(); }
    clickAt(empty); await until(() => document.querySelector('.leaflet-popup-content'), 3000);
    log(/Radar \d\d:\d\d/.test((document.querySelector('.leaflet-popup-content') || {}).textContent || ''), 'tocco vuoto = popup radar',
        'zoom ' + map.getZoom() + ', stato ' + Radar.state + ', punto ' + (empty && empty.toString()) +
        ', pixel ' + JSON.stringify(empty && Radar.gridPixel(empty.lat, empty.lng)) +
        ', elemento ' + (empty && (() => { const p = map.latLngToContainerPoint(empty), r = map.getContainer().getBoundingClientRect();
                                           const t = document.elementFromPoint(r.left + p.x, r.top + p.y); return t && (t.tagName + '.' + t.className); })()));
    map.closePopup();
    // tocco su un puntino: si apre una stazione, NON il popup del radar
    const before = selectedKey;
    const ref = markerRefs.find(r => map.getBounds().contains(r.m.getLatLng()));
    clickAt(ref.m.getLatLng()); await sleep(400);
    log(!document.querySelector('.leaflet-popup') && selectedKey && selectedKey !== before && Radar.on, 'tocco su puntino = stazione',
        'popup ' + !!document.querySelector('.leaflet-popup') + ', stazione ' + selectedKey + ', radar ' + Radar.on);
    // chiudi la stazione: col selettore ristretto alle sue variabili i passi dopo dipenderebbero da quale puntino si e' toccato
    el('stationFilter').value = ''; el('stationFilter').dispatchEvent(new Event('change'));
    await until(() => !selectedKey);
    // la x chiude la barra, il radar resta acceso e torna all'ultimo
    el('tsClose').click(); await sleep(200);
    log(!snap.on && Radar.on, 'x chiude la barra, radar resta acceso', snap.on + ' ' + Radar.on);
    el('mcSnap').click(); await until(() => snap.on && tsSrc === Radar.source);
    eq('Cursore riaperto in modo radar', tsSrc === Radar.source, true);
    // un'altra variabile spegne il radar; la barra (aperta dal radar) si chiude
    setMapVar('UMID'); await until(() => !Radar.on);
    log(!Radar.on && !snap.on && tsSrc === snapSource, 'altra variabile spegne il radar e chiude la barra', Radar.on + ' ' + snap.on);
    // acceso e spento dal pulsante: torna la variabile di prima
    el('mcRadar').click(); await until(() => Radar.on && filterVar === 'PREC1');
    el('mcRadar').click(); await until(() => !Radar.on && filterVar === 'UMID');
    log(filterVar === 'UMID', 'spento: torna la variabile di prima',
        'filterVar "' + filterVar + '", pagina ' + currentPage + ', UMID nel selettore ' + [...el('varFilter').options].some(o => o.value === 'UMID') +
        ', avviso "' + el('toast').textContent + '", prevVar "' + radarUi.prevVar + '", busy ' + radarUi.busy + ', snap.on ' + snap.on);
    // Cursore delle stazioni aperto prima del radar: spento il radar si torna ai 7 giorni
    setMapVar('PREC24'); await until(() => filterVar === 'PREC24');
    await openSlider(); await until(() => snap.on && snap.var === 'PREC24');
    el('mcRadar').click(); await until(() => Radar.on && tsSrc === Radar.source);
    el('mcRadar').click(); await until(() => !Radar.on && filterVar === 'PREC24' && snap.on && snap.var === 'PREC24');
    log(snap.on && tsSrc === snapSource && +el('tsRange').max === snap.kmax, 'spento: la barra torna ai 7 giorni', snap.on);
    closeSlider();
    eq('errori JS', window.__errs, []);
    finish();
  }

  async function suiteHash(){
    const withPrec = allFeatures.filter(f => (f.properties.variables || []).includes('PREC')).slice(0, 3);
    const fmts = [['vecchio |', (r, c) => '#' + r + '|' + c + '|PREC'], ['vecchio %7C', (r, c) => '#' + r + '%7C' + c + '%7CPREC'],
                  ['nuovo /', (r, c) => '#' + r + '/' + c + '/PREC']];
    for(let i = 0; i < 3; i++){
      const p = withPrec[i].properties;
      history.replaceState(null, '', fmts[i][1](p._region, p.scode));
      await applyHash();
      await until(() => currentStation && currentStation.scode === p.scode && currentVar === 'PREC');
      log(currentStation && currentStation.scode === p.scode && currentVar === 'PREC', 'link ' + fmts[i][0], location.hash);
    }
    updateHash();
    const p = withPrec[2].properties;
    log(location.hash.indexOf('#' + encodeURIComponent(p._region) + '/' + encodeURIComponent(p.scode) + '/') === 0 && location.hash.indexOf('|') < 0,
        'updateHash scrive con /', location.hash);
    eq('errori JS', window.__errs, []);
    finish();
  }

  // impaginazione: radar acceso (o solo stazioni con &noradar=1). In alto i pulsanti, in basso UNA plancia con tempo,
  // legenda e crediti: niente sovrapposizioni, tutto dentro lo schermo; sul telefono la plancia si chiude e si riapre
  async function suiteLayout(){
    if(new URLSearchParams(location.search).get('dark')) document.body.classList.add('dark');
    el('region').value = 'FVG';
    await loadRegions(REGION_GROUPS.FVG || ['FVG']);
    const btn = el('mcRadar'), noradar = new URLSearchParams(location.search).get('noradar');
    if(noradar){ setMapVar('PREC24'); await until(() => filterVar === 'PREC24'); }           // confronto: solo stazioni
    else if(btn){ btn.click(); await until(() => Radar.on && snap.on, 20000); }
    await sleep(800);
    const dock = el('dock'), phone = innerWidth <= 720;
    log(!!dock, 'plancia', 'assente');
    if(!dock) return finish();
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
    function check(tag){
      const sels = { pulsanti:'.mapctl', zoom:'.leaflet-control-zoom', sfondi:'.leaflet-control-layers', plancia:'#dock', barra:'#topbar' };
      const R = {};
      for(const k in sels){
        const e = document.querySelector(sels[k]);
        if(k === 'pulsanti' && e && el('topbar') && el('topbar').contains(e)) continue;     // telefono: nella riga delle pillole
        if(vis(e)) R[k] = e.getBoundingClientRect();
      }
      const over = [], ks = Object.keys(R);
      for(let i = 0; i < ks.length; i++) for(let j = i + 1; j < ks.length; j++){
        const a = R[ks[i]], b = R[ks[j]];
        if(!(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)) over.push(ks[i] + '×' + ks[j]);
      }
      eq(tag + 'nessuna sovrapposizione a ' + innerWidth + ' px', over, []);
      eq(tag + 'tutto dentro lo schermo', ks.filter(k => R[k].left < 0 || R[k].right > innerWidth + 0.5), []);
      const D = dock.getBoundingClientRect(), M = el('map').getBoundingClientRect(), at = document.querySelector('.leaflet-control-attribution');
      log(inside(D, M), tag + 'plancia dentro la mappa', JSON.stringify([D.top, D.bottom, M.top, M.bottom]));
      log(vis(at) && dock.contains(at) && inside(at.getBoundingClientRect(), D), tag + 'crediti visibili nella plancia', at && at.textContent);
      const lg = el('colorbar');
      log(vis(lg) && dock.contains(lg) && inside(lg.getBoundingClientRect(), D), tag + 'legenda nella plancia', lg && lg.textContent);
      return D.height;
    }
    log(noradar || (!!btn && Radar.on), 'radar acceso', '');
    const inRow = !!el('pillRow') && el('pillRow').contains(document.querySelector('.mapctl'));
    const inRight = !!document.querySelector('.leaflet-top.leaflet-right .mapctl');
    eq('pulsanti mappa al posto giusto', [inRow, inRight], phone ? [true, false] : [false, true]);
    const lab = [...document.querySelectorAll('.mapctl .mc-l')].map(s => vis(s));
    log(lab.length === 3 && (phone ? lab.every(Boolean) : lab.every(v => !v)), phone ? 'etichette visibili sul telefono' : 'solo icone su desktop', JSON.stringify(lab));
    log([...document.querySelectorAll('.mapctl button')].every(b => b.getAttribute('aria-label')), 'pulsanti con aria-label', '');
    if(!phone){
      check('');
      log(!vis(el('dkToggle')) && !dock.classList.contains('min'), 'desktop: plancia sempre aperta', dock.className);
    } else {
      log(!vis(document.querySelector('.leaflet-control-zoom')), 'telefono: niente +/−', '');
      const pa = el('pgPill').getBoundingClientRect(), pb = el('regPill').getBoundingClientRect();
      const gap = document.elementFromPoint((pa.right + pb.left) / 2, (pa.top + pa.bottom) / 2);
      log(!!gap && el('pillRow').contains(gap), 'telefono: fra le pillole il tocco resta alla riga', gap && (gap.id || gap.className));
      log(dock.classList.contains('min'), 'telefono: parte chiusa', dock.className);
      const hMin = check('chiusa: ');
      const lim = innerWidth < 360 ? 115 : 100;                        // a 320 px i crediti vanno su due righe
      log(hMin <= lim, 'chiusa: alta al massimo ' + lim + ' px (' + Math.round(hMin) + ')', hMin);
      log(!snap.on || (vis(el('tsPlay')) && vis(el('tsRange')) && vis(el('tsLab'))), 'chiusa: play, cursore e ora', '');
      el('dkToggle').click(); await sleep(300);
      log(!dock.classList.contains('min'), 'freccia: si apre', dock.className);
      const hMax = check('aperta: ');
      log(hMax > hMin, 'aperta più alta della chiusa', hMin + ' → ' + hMax);
      log(!snap.on || vis(el('tsPrev')), 'aperta: passo ‹ ›', '');
      el('dkToggle').click(); await sleep(300);
      log(dock.classList.contains('min'), 'freccia: si richiude', dock.className);
      let saved = null; try { saved = localStorage.getItem('dockMin'); } catch(e){}
      eq('scelta ricordata', saved, '1');
    }
    if(innerWidth <= 360){
      el('varPill').click(); await sleep(100);
      const mb = el('pillMenu').getBoundingClientRect();
      log(mb.height > 0 && mb.bottom <= innerHeight && mb.left >= 0 && mb.right <= innerWidth, 'menu dentro lo schermo a 320 px', JSON.stringify([mb.left, mb.right, mb.bottom, innerHeight]));
      document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' }));
    }
    eq('errori JS', window.__errs, []);
    finish();
  }

  // plancia senza radar: solo crediti, legenda delle stazioni, menu delle finestre di pioggia, Cursore con i giorni
  async function suiteDock(){
    el('region').value = 'FVG';
    await loadRegions(REGION_GROUPS.FVG || ['FVG']);
    const dock = el('dock');
    log(!!dock, 'plancia', 'assente');
    if(!dock) return finish();
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    setMapVar(''); await sleep(200);
    log(!vis(el('colorbar')) && vis(document.querySelector('.leaflet-control-attribution')), 'nessuna variabile: solo crediti', dock.className);
    el('mcRain').click(); await until(() => isRain(filterVar));
    log(el('mcRain').classList.contains('on'), 'Pioggia acceso', el('mcRain').className);
    log(vis(el('colorbar')) && el('dkProd').textContent.includes(varLabel(filterVar)), 'legenda col nome della variabile', el('colorbar').textContent);
    el('dkProd').click(); await sleep(100);
    const items = [...document.querySelectorAll('#prodMenu [data-v]')];
    eq('menu: finestre di pioggia', items.map(b => b.dataset.v), RAIN_VARS);
    eq('menu: etichette', items.map(b => b.textContent), ['1 h', '3 h', '6 h', '12 h', '24 h', '48 h']);
    const pick = document.querySelector('#prodMenu [data-v="PREC6"]');
    if(pick) pick.click();
    await until(() => filterVar === 'PREC6');
    eq('scelta 6 h', filterVar, 'PREC6');
    log(!vis(el('prodMenu')), 'menu chiuso dopo la scelta', '');
    setMapVar('TEMP'); await until(() => filterVar === 'TEMP');
    log(!el('mcRain').classList.contains('on') && el('colorbar').textContent.includes(varLabel('TEMP')),
        'temperatura: legenda, Pioggia spento', el('colorbar').textContent);
    el('dkProd').click(); await sleep(100);
    log(!vis(el('prodMenu')), 'temperatura: nessun menu', '');
    setMapVar('PREC24'); await until(() => filterVar === 'PREC24');
    await openSlider(); await until(() => snap.on && snap.T.length, 20000);
    const ticks = [...document.querySelectorAll('#tsTicks b')].map(b => b.textContent);
    log(ticks.length >= 5 && ticks.every(t => /^(lun|mar|mer|gio|ven|sab|dom) \d+$/.test(t)), 'Cursore 7 giorni: etichette dei giorni', JSON.stringify(ticks));
    log(/^\d\d:\d\d$/.test((el('tsLab').querySelector('span') || {}).textContent), 'ora grande nella barra', el('tsLab').innerHTML);
    closeSlider();
    eq('errori JS', window.__errs, []);
    finish();
  }

  // radar.js non arrivato: la pagina deve funzionare lo stesso (puntini, Cursore), pulsante Radar grigio
  async function suiteResilience(){
    log(markerRefs.length > 0, 'puntini disegnati', markerRefs.length);
    log(el('mcRadar').classList.contains('dim'), 'pulsante Radar grigio', el('mcRadar').className);
    const v0 = filterVar;
    el('mcRadar').click(); await sleep(300);
    log(el('toast').textContent.includes('Radar non disponibile') && filterVar === v0, 'clic: avviso e nient\'altro', el('toast').textContent);
    setMapVar('PREC24'); await until(() => filterVar === 'PREC24');
    await openSlider(); await until(() => snap.on && snap.T.length, 20000);
    log(snap.on && +el('tsRange').max === snap.kmax, 'Cursore delle stazioni funziona', snap.kmax);
    closeSlider();
    eq('errori JS', window.__errs, []);
    finish();
  }

  // rilascio 2: menu "Mappa", interruttore "Stazioni", puntini accoppiati per prodotto (radar locale: SRI, VMI, TEMP)
  async function suiteProdotti(){
    try { localStorage.removeItem('radarProd'); } catch(e){}
    const shown = () => getComputedStyle(el('prodMenu')).display !== 'none';
    const openMenu = async () => { if(!shown()){ el('dkProd').click(); await sleep(50); } };
    const pick = async key => { await openMenu(); const b = document.querySelector('#prodMenu [data-key="' + key + '"]'); if(b) b.click(); };
    const fills = () => markerRefs.map(r => r.m.options.fillColor);
    el('mcRadar').click();
    await until(() => Radar.on && snap.on && el('dkProd'), 20000);
    log(!!el('dkProd') && !!el('prodMenu'), 'menu prodotti', 'assente');
    if(!el('dkProd') || !el('prodMenu')) return finish();
    await openMenu();
    eq('gruppi del menu', [...document.querySelectorAll('#prodMenu .pm-g')].map(g => g.dataset.g), ['Pioggia', 'Riflettività', 'Altro']);
    eq('voci del menu', [...document.querySelectorAll('#prodMenu [data-key]')].map(b => b.dataset.key), ['SRI', 'VMI', 'TEMP']);
    eq('etichette brevi', [...document.querySelectorAll('#prodMenu [data-key]')].map(b => b.textContent), ['adesso', 'max', 'Temperatura']);
    eq('prodotto iniziale', ((document.querySelector('#prodMenu [data-key].on') || {}).dataset || {}).key, 'SRI');
    el('dkProd').click(); await sleep(50);
    log(!shown(), 'menu richiuso dal pulsante', '');
    log(el('mcStations') && el('mcStations').classList.contains('on'), 'interruttore Stazioni acceso', '');
    setFrame(10);                                                       // 03:40 UTC = 05:40 ora legale
    await pick('VMI'); await until(() => Radar.product && Radar.product.key === 'VMI');
    log(!shown(), 'menu chiuso dopo la scelta', '');
    eq('VMI: puntini neutri (nessuna variabile)', filterVar, '');
    log(Radar.on && tsSrc === Radar.source, 'VMI: radar acceso, barra sul radar', Radar.state);
    log(fills().length > 0 && fills().every(c => c === DOT_COLOR), 'VMI: puntini grigi', fills().slice(0, 3).join(' '));
    log(el('colorbar').textContent.includes('Riflettività') && el('colorbar').textContent.includes('dBZ'), 'VMI: legenda', el('colorbar').textContent);
    log(el('tsLab').innerHTML.includes('05:40') && !el('tsLab').innerHTML.includes('stazioni'), 'VMI: stesso istante, niente ora stazioni', el('tsLab').innerHTML);
    await pick('TEMP'); await until(() => Radar.product.key === 'TEMP' && filterVar === 'TEMP' && snap.var === 'TEMP', 20000);
    eq('TEMP: puntini sulla temperatura', filterVar, 'TEMP');
    const tc = Radar.legend().colors, colored = fills().filter(c => c !== NEUTRAL_COLOR);
    log(colored.length > 0 && colored.every(c => tc.indexOf(c) >= 0), 'TEMP: puntini con la palette del prodotto', colored.slice(0, 3).join(' '));
    log(el('tsLab').innerHTML.includes('05:00'), 'TEMP: ora piena precedente', el('tsLab').innerHTML);
    log(el('colorbar').textContent.includes('Temperatura'), 'TEMP: legenda', el('colorbar').textContent);
    await pick('SRI'); await until(() => Radar.product.key === 'SRI' && filterVar === 'PREC1');
    eq('SRI: puntini sulla pioggia di 1 h', filterVar, 'PREC1');
    el('mcStations').click(); await sleep(200);
    eq('Stazioni spento: nessun puntino', markerRefs.length, 0);
    log(!el('mcStations').classList.contains('on') && getComputedStyle(el('colorbar')).display !== 'none', 'legenda resta', '');
    el('mcStations').click(); await sleep(200);
    log(markerRefs.length > 0, 'Stazioni acceso: puntini di nuovo', markerRefs.length);
    await pick('VMI'); await until(() => Radar.product.key === 'VMI');
    setMapVar('UMID'); await until(() => !Radar.on);
    log(!Radar.on && filterVar === 'UMID', 'altra variabile: radar spento', Radar.on + ' ' + filterVar);
    el('mcRadar').click(); await until(() => Radar.on && Radar.product);
    eq('prodotto ricordato', Radar.product.key, 'VMI');
    eq('errori JS', window.__errs, []);
    finish();
  }

  // caricamento del radar: il play aspetta il fotogramma non ancora scaricato; sul cursore la striscia del gia' scaricato
  async function suiteBuffer(){
    el('mcRadar').click();
    await until(() => Radar.on && snap.on && tsSrc === Radar.source, 20000);
    log(typeof Radar.source.ready === 'function' && typeof Radar.source.buffered === 'function', 'radar.js: ready e buffered', '');
    if(typeof Radar.source.ready !== 'function') return finish();
    const realReady = Radar.source.ready, realBuf = Radar.source.buffered, r = el('tsRange');
    Radar.source.ready = () => false;                                  // come su rete lenta: niente ancora scaricato
    setFrame(5); snapPlay(); await sleep(1000);
    eq('play aspetta il fotogramma', +r.value, 5);
    Radar.source.ready = realReady; await sleep(800); snapPause();
    log(+r.value > 5, 'scaricato: riparte', r.value);
    Radar.source.buffered = () => 0.5;
    if(typeof tsBuffer === 'function') tsBuffer();
    eq('striscia: meta\' scaricata', r.style.getPropertyValue('--b'), '0.5000');
    Radar.source.buffered = realBuf;
    if(typeof tsBuffer === 'function') tsBuffer();
    eq('tutto scaricato: niente striscia', r.style.getPropertyValue('--b'), r.style.getPropertyValue('--p'));
    eq('errori JS', window.__errs, []);
    finish();
  }

  // ora legale nei grafici delle stazioni: il 25/10/2026 l'ora 02:00-02:59 si ripete (prima CEST, poi CET).
  // Il CSV ha gli orari civili in ordine di tempo; l'asse deve restare crescente e le etichette in ora italiana
  async function suiteOraLegale(){
    const U = (mo, d, h, mi) => Date.UTC(2026, mo - 1, d, h, mi) / 1000;
    const fb = ['01:40', '01:50', '02:00', '02:10', '02:20', '02:30', '02:40', '02:50',
                '02:00', '02:10', '02:20', '02:30', '02:40', '02:50', '03:00', '03:10'];
    const temps = [10, 10.1, 11, 11.1, 11.2, 11.3, 11.4, 11.5, 12, 12.1, 12.2, 12.3, 12.4, 12.5, 13, 13.1];
    const t = parseCSV('datetime,PREC,TEMP\n' + fb.map((h, i) => '2026-10-25T' + h + ',1,' + temps[i]).join('\n'));
    eq('ottobre: orari reali, l\'ora doppia in ordine', t.x,
       [[24, 23, 40], [24, 23, 50], [25, 0, 0], [25, 0, 10], [25, 0, 20], [25, 0, 30], [25, 0, 40], [25, 0, 50],
        [25, 1, 0], [25, 1, 10], [25, 1, 20], [25, 1, 30], [25, 1, 40], [25, 1, 50], [25, 2, 0], [25, 2, 10]].map(([d, h, mi]) => U(10, d, h, mi)));
    eq('marzo: l\'ora che manca', parseCSV('datetime,TEMP\n2026-03-29T01:50,1\n2026-03-29T03:00,2\n2026-03-29T03:10,3').x,
       [U(3, 29, 0, 50), U(3, 29, 1, 0), U(3, 29, 1, 10)]);
    eq('estate e inverno', parseCSV('datetime,TEMP\n2026-07-01T12:00,1\n2026-12-01T12:00,2').x, [U(7, 1, 10, 0), U(12, 1, 11, 0)]);

    eq('etichetta: 02:30 della prima volta', fmtFull(U(10, 25, 0, 30)), '25/10/2026 02:30');
    eq('etichetta: 02:30 della seconda volta', fmtFull(U(10, 25, 1, 30)), '25/10/2026 02:30');
    eq('etichetta: estate e inverno', [fmtFull(U(7, 1, 10, 0)), fmtFull(U(12, 1, 11, 0))], ['01/07/2026 12:00', '01/12/2026 12:00']);
    eq('asse: mezzanotte del 25 (CEST) e del 26 (CET)', [fmtAxis(U(10, 24, 22, 0)), fmtAxis(U(10, 25, 23, 0))], ['25/10', '26/10']);
    eq('asse: le 2 della seconda volta', fmtAxis(U(10, 25, 1, 0)), '2');
    eq('cursore: giorno e ora', fmtDayTime(U(10, 25, 1, 0)), '25/10 02:00');

    const rs = rainSeries(t.x, t.cols.PREC, 'PREC', t.x[0], t.x[t.x.length - 1], true);
    eq('pioggia: una barra per ciascuna ora', rs.x, [U(10, 24, 23, 0), U(10, 25, 0, 0), U(10, 25, 1, 0), U(10, 25, 2, 0)]);
    eq('pioggia: somme per ora', rs.y, [3, 6, 6, 1]);
    const fu = { data: [rs.x], series: [{}, { slotTxt: 'range' }] };
    eq('pioggia: le due barre delle 2', [1, 2].map(j => slotTimeTxt(fu, 1, j)), ['25/10 02:00–03:00', '25/10 02:00–03:00']);
    fu.series[1].slotTxt = 'end';                                      // cumulate orarie: valore a fine ora
    eq('cumulate: fine delle due ore delle 2', [1, 2].map(j => slotTimeTxt(fu, 1, j)), ['25/10 03:00', '25/10 03:00']);
    const tm = parseCSV('datetime,PREC\n2026-03-29T01:50,1\n2026-03-29T03:00,1\n2026-03-29T03:10,1');
    const rm = rainSeries(tm.x, tm.cols.PREC, 'PREC', tm.x[0], tm.x[2], true);
    eq('marzo: barre prima e dopo l\'ora che manca', [0, 1].map(j => slotTimeTxt({ data: [rm.x], series: [{}, { slotTxt: 'range' }] }, 1, j)),
       ['29/03 01:00–02:00', '29/03 03:00–04:00']);

    const m = mainModel({ _table: t, scode: 'T', _region: 'VEN' }, 'TEMP', null, 'week');
    log(m.data[0].every((x, i) => i === 0 || x > m.data[0][i - 1]), 'grafico: tempo sempre crescente', JSON.stringify(m.data[0]));
    eq('grafico: valori nell\'ordine giusto', m.data[1], temps);

    const rects = [], fake = { scales: { x: { min: U(10, 24, 12, 0), max: U(10, 26, 12, 0) } }, valToPos: v => v, bbox: { top: 0, height: 10 },
                               ctx: { save(){}, restore(){}, fillRect(x, y, w){ rects.push([x, x + w]); } } };
    dayBands(fake);
    eq('bande: il 25/10 da mezzanotte a mezzanotte (25 ore)', rects, [[U(10, 24, 22, 0), U(10, 25, 23, 0)]]);

    // etichette civili scritte dal browser (Europe/Rome), indipendenti dal codice della pagina
    const civLab = s => new Date(s * 1000).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 16).replace(' ', 'T');
    const rows = []; for(let s = U(10, 24, 10, 0); s <= U(10, 26, 11, 0); s += 3600) rows.push(civLab(s) + ',' + ((s / 3600) % 7));
    const m2 = mainModel({ _table: parseCSV('datetime,TEMP\n' + rows.join('\n')), scode: 'T', _region: 'VEN' }, 'TEMP', null, 'week');
    const host = document.createElement('div'); document.body.appendChild(host);
    const u = new uPlot(mainOpts(m2, { w: 900, h: 300 }), m2.data, host);
    await sleep(50);                                                   // uPlot disegna (e calcola le etichette) dopo un microtask
    const labs = (u.axes[0]._values || []).filter(Boolean);
    log(labs.includes('25/10') && labs.includes('26/10'), 'asse: date alla mezzanotte italiana', JSON.stringify(labs));
    u.destroy(); host.remove();

    const hrs = []; for(let h = 0; h <= 25; h++) hrs.push(civLab(U(10, 23, 22, 0) + h * 3600) + ',' + h);
    renderCompare(parseCSV('datetime,TEMP\n' + hrs.join('\n')), 'TEMP', '°C');
    const X = chart.data[0], at = (si, tod) => chart.data[si][X.indexOf(tod)];
    eq('confronto: giorni', chart.series.slice(1).map(s => s.label), ['24/10', 'Oggi']);
    eq('confronto: 24/10 alle 23, oggi alle 00 e alle 01', [at(1, 23 * 3600), at(2, 0), at(2, 3600)], [23, 24, 25]);
    clearChart();
    eq('errori JS', window.__errs, []);
    finish();
  }

  async function suiteSearch(){                       // barra in alto: ricerca, pillole, menu (rilascio 1)
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    log(!vis(el('sidebar')), 'niente barra laterale', '');
    log(vis(el('topbar')) && vis(el('stationQ')), 'ricerca sopra la mappa', '');
    eq('pillole', ['pgPill', 'regPill', 'varPill', 'srcinfo', 'moreBtn'].map(id => vis(el(id))), [true, true, true, true, true]);
    log(/^Cerca fra \d+ stazioni…$/.test(el('stationQ').placeholder), 'segnaposto col numero di stazioni', el('stationQ').placeholder);
    log(!vis(el('legacyCtl')) && !!el('region') && !!el('varFilter') && !!el('stationFilter'), 'tendine nascoste ma presenti', '');
    el('srcinfo').click(); await sleep(100);
    log(getComputedStyle(el('srcpanel')).display === 'block', '"Fonti" apre lo stato delle fonti', '');

    // menu delle pillole: voci dalle tendine nascoste, la scelta passa da loro
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
    // un pannello alla volta anche con Fonti e Note (i loro clic non arrivano al documento)
    el('regPill').click(); await sleep(50); el('srcinfo').click(); await sleep(50);
    eq('Fonti chiude il menu', [vis(el('pillMenu')), getComputedStyle(el('srcpanel')).display], [false, 'block']);
    el('noteBtn').click(); await sleep(50);
    eq('Note chiude Fonti', [getComputedStyle(el('notepanel')).display, getComputedStyle(el('srcpanel')).display], ['block', 'none']);
    el('srcinfo').click(); await sleep(50);
    eq('Fonti chiude Note', [getComputedStyle(el('notepanel')).display, getComputedStyle(el('srcpanel')).display], ['none', 'block']);
    el('stationQ').value = 'ar'; el('stationQ').dispatchEvent(new Event('input'));
    el('srcinfo').click(); await sleep(50);
    log(!vis(el('searchList')), 'Fonti chiude la ricerca', '');
    el('stationQ').value = ''; el('stationQ').dispatchEvent(new Event('input'));
    // tastiera nei menu: il fuoco entra sulla voce scelta, frecce, dopo la scelta torna sulla pillola, Tab fuori chiude
    const fa = () => document.activeElement;
    el('pgPill').focus(); el('pgPill').click(); await sleep(50);
    log(el('pillMenu').contains(fa()) && fa().dataset.v === 'derivate', 'menu: il fuoco va sulla voce scelta', fa() && (fa().dataset.v || fa().id || fa().tagName));
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true }));
    eq('menu: freccia giù', fa().dataset.v, 'indici');
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowUp', bubbles:true }));
    eq('menu: freccia su', fa().dataset.v, 'derivate');
    fa().click(); await sleep(50);
    log(!vis(el('pillMenu')) && fa() === el('pgPill'), 'menu: dopo la scelta il fuoco torna sulla pillola', fa() && (fa().id || fa().tagName));
    el('pgPill').click(); await sleep(50);
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', bubbles:true, cancelable:true }));
    log(!vis(el('pillMenu')) && fa() === el('pgPill'), 'menu: Tab lo chiude e riparte dalla pillola', fa() && (fa().id || fa().tagName));
    log([...el('pillMenu').querySelectorAll('[data-v]'), ...el('moreMenu').querySelectorAll('button')].every(b => b.tabIndex === -1),
        'menu: le voci si raggiungono con le frecce, Tab esce subito', '');
    el('moreBtn').click(); await sleep(50);
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', shiftKey:true, bubbles:true, cancelable:true }));
    log(!vis(el('moreMenu')) && fa() === el('moreBtn'), 'menu ⋯: Maiusc+Tab lo chiude e torna su ⋯', fa() && (fa().id || fa().tagName));
    el('regPill').click(); await sleep(50);
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'/', bubbles:true, cancelable:true }));
    log(!vis(el('pillMenu')) && fa() === el('stationQ'), '"/" da un menu aperto: chiude e va alla ricerca', fa() && (fa().id || fa().tagName));
    el('stationQ').blur();
    eq('pillole con nome accessibile', ['pgPill', 'regPill', 'varPill'].map(id => (el(id).getAttribute('aria-label') || '').split(':')[0]), ['Pagina', 'Regione', 'Variabile']);
    el('moreBtn').click(); await sleep(50);
    const dark0 = document.body.classList.contains('dark'); el('themeBtn').click();
    log(document.body.classList.contains('dark') !== dark0, '⋯ → tema', ''); el('moreBtn').click(); el('themeBtn').click();
    el('moreBtn').click(); el('resetBtn').click(); await until(() => el('region').value === 'ALL' && !filterVar, 20000);
    eq('⋯ → azzera i filtri', [el('regPill').textContent.trim(), el('varPill').textContent.trim()], ['Tutte le regioni', 'Tutte le variabili']);
    el('pgPill').click(); await sleep(50);
    items().find(b => b.dataset.v === 'dirette').click(); await until(() => currentPage === 'dirette');
    el('varPill').click(); await sleep(50);                                 // elenco lungo: campo per filtrare, senza accenti
    const flt = el('pillMenu').querySelector('.pm-filter');
    log(!!flt && items().length > 12, 'menu lungo: filtro', items().length);
    if(flt){
      flt.value = 'umidita'; flt.dispatchEvent(new Event('input')); await sleep(30);
      const shown = items().filter(vis).map(b => b.dataset.v);
      log(shown.includes('UMID') && !shown.includes('TEMP'), 'filtro: "umidita" trova Umidità', JSON.stringify(shown));
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' })); await sleep(50);
    history.replaceState(null, '', '#FVG/A280/TAPP'); await applyHash();                       // variabile derivata
    eq('pillole seguono lo stato', el('pgPill').textContent.trim(), 'Misure derivate');

    // ricerca: senza badare ad accenti, maiuscole e punteggiatura; codice; elenco sotto il campo
    const F = (name, scode, r) => ({ properties:{ name, scode, _region:r, variables:[] } });
    const L = [F('FORLÌ', 'F1', 'ER'), F("Sant'Ambrogio di Valpolicella", 'S2', 'VEN'), F('Monte Forlì', 'M3', 'ER')];
    eq('ricerca: accenti e apostrofi', [searchStations('forli', L), searchStations('sant amb', L)].map(r => r.map(f => f.properties.scode)), [['F1', 'M3'], ['S2']]);
    eq('ricerca: codice', searchStations('s2', L).map(f => f.properties.scode), ['S2']);
    eq('ricerca: niente', searchStations('zzzz', L), []);
    eq('ricerca: omonimi in ordine fisso', searchStations('arba', [F('Arba', 'FVG5', 'PC_FVG'), F('Arba', 'A280', 'FVG')]).map(f => f.properties.scode), ['A280', 'FVG5']);
    const fv0 = filterVar; filterVar = 'PREC24';
    const mv = stationMainValue({ _region:'FVG', variables:['TEMP', 'PREC24'], latest:{ TEMP:13.2 } });
    filterVar = fv0;
    eq('valore principale: la variabile scelta, anche senza dato', mv && [mv.label, mv.text], [varLabel('PREC24'), 'n.d.']);
    const q = el('stationQ'), type = s => { q.value = s; q.dispatchEvent(new Event('input')); };
    q.focus(); type('arba'); await sleep(100);
    const first = el('searchList').querySelector('[data-k]');
    log(first && first.textContent.includes('Arba') && first.textContent.includes(regionLabel('FVG')), 'suggerimento con regione', first && first.textContent);
    const arba = [...el('searchList').querySelectorAll('[data-k]')].filter(r => r.querySelector('.sr-n').textContent === 'Arba').map(r => r.querySelector('.sr-r').textContent);
    log(arba.length === 2 && arba[0] !== arba[1], 'omonimi distinguibili (FVG e PC_FVG)', JSON.stringify(arba));
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
    eq('errori JS', window.__errs, []);
    finish();
  }

  async function suiteHover(){                        // scheda al passaggio (mouse) e foglio basso (tocco), rilascio 2
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    const now = Date.UTC(2026, 10, 2, 11, 10);                                    // 12:10 ora italiana (CET)
    eq('da quanto', ['2026-11-02T12:10', '2026-11-02T12:00', '2026-11-02T09:10', '2026-10-30T12:10', '', 'x'].map(s => ageText(s, now)),
       ['adesso', '10 min fa', '3 h fa', '3 g fa', '', '']);
    eq('ora del dato', [timeText('2026-11-02T12:00', now), timeText('2026-10-30T12:10', now), timeText(undefined, now)],
       ['12:00, 10 min fa', '30/10 12:10, 3 g fa', '']);
    const P = { name:'Arba', scode:'X1', _region:'FVG', variables:['TEMP','PREC24','VVENTO','DVENTO','UMID','PRESS'],
                latest:{ TEMP:'16.9', PREC24:2.4, VVENTO:'12', DVENTO:'135', UMID:'71', PRESS:'1012' }, latest_time:'2026-11-02T12:00' };
    const K = keyValues(P, 'TEMP');
    eq('valori chiave', K.map(k => [k.v, k.label]), [['PREC24', 'Pioggia 24 h'], ['VVENTO', 'Vento'], ['UMID', 'Umidità']]);
    log(/ SE$/.test(K[1].text), 'vento con la direzione', K[1].text);
    const M = cardModel(P);
    eq('modello', [M.name, M.where, M.main && M.main.v, M.keys.length], ['Arba', regionLabel('FVG') + ' · ' + SOURCES.FVG.name, 'TEMP', 3]);
    const E = cardModel({ name:'Vuota', scode:'X2', _region:'ZZ', variables:[], latest:{ TEMP:'' } });
    eq('stazione senza dati', [E.name, E.where, E.main, E.keys, E.time], ['Vuota', 'ZZ', null, [], '']);
    const Q = { name:'Aria', scode:'X3', _region:'ZZ', variables:['EAQI'], latest:{ EAQI:'3' } };
    eq('nome della variabile solo per un valore senza unità', [cardHtml(M).includes('hc-lab'), cardHtml(cardModel(Q)).includes('hc-lab')], [false, true]);
    const U = unitsByRegion.FVG.TEMP;
    eq('al massimo due decimali', ['20.8333333333333', 16.9, '12.70', 0.54].map(x => latestText({ _region:'FVG', latest:{ TEMP:x } }, 'TEMP')),
       ['20.83 ' + U, '16.9 ' + U, '12.70 ' + U, '0.54 ' + U]);
    // scheda col mouse: stazione FVG isolata (Arba ha un omonimo PC_FVG nello stesso punto) presente nei file orari TEMP e PREC1
    el('region').value = 'FVG'; await loadRegions(REGION_GROUPS.FVG || ['FVG']); await sleep(300);
    map.setZoom(10, { animate:false }); await sleep(300);                        // a 375 px la vista intera e' troppo fitta
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
    const onMap = r => { const t = document.elementFromPoint(...scr(r)); return !!t && t.tagName === 'CANVAS' && map.getContainer().contains(t); };
    const far = r => markerRefs.find(o => { const a = scr(r), b = scr(o); return lone(o) && onMap(o) && Math.hypot(a[0] - b[0], a[1] - b[1]) > 100; });
    const meet = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    map.panTo(A.m.getLatLng(), { animate:false }); await sleep(150);               // il puntino al centro, lontano da barra e plancia
    hoverAt(A); await sleep(100);
    log(vis(card) && card.querySelector('.hc-name').textContent === NAME, 'scheda entro 100 ms', card && card.textContent.slice(0, 80));
    log(!!card && !/undefined|NaN|null/.test(card.textContent), 'nessun undefined', card && card.textContent);
    log(!!card && !/Clic|apre la scheda|ultima ora/.test(card.textContent) && !card.querySelector('.hc-hint'), 'niente scritte inutili', card && card.textContent);
    log(markerRefs.every(r => !r.m.getTooltip() || r.m.getTooltip().options.permanent), 'niente tooltip di Leaflet al passaggio', '');
    const B = far(A); hoverAt(A); await sleep(40); hoverAt(B); await sleep(120);   // 40 ms: Leaflet ignora i movimenti entro 32 ms
    eq('passaggio veloce', card && card.querySelector('.hc-name').textContent, prettyName(B.p.name || B.p.scode));
    move(5, innerHeight / 2); await sleep(150);                                   // fuori dai puntini
    log(!vis(card), 'uscendo dal puntino sparisce', '');
    {                                                                             // ogni scheda (e foglio) della regione
      const sh = el('sheet'), cut = new Set();
      for(const box of [card, sh]){
        box.hidden = false; box.style.visibility = 'hidden';
        for(const r of markerRefs){
          (box === sh ? sh.querySelector('.sh-body') : box).innerHTML = cardHtml(cardModel(r.p));
          box.querySelectorAll('.hc-keys span, .hc-keys b').forEach(e => { if(e.scrollWidth > e.clientWidth) cut.add(e.textContent); });
        }
        box.hidden = true; box.style.visibility = '';
      }
      log(!cut.size, 'valori chiave interi, mai tagliati', cut.size + ': ' + [...cut].slice(0, 8).join(' | '));
    }
    for(const [tag, X, Y] of [['sotto la barra', 40, el('topbar').getBoundingClientRect().bottom + 14],
                              ['vicino alla colonna', innerWidth - 70, Math.max(160, el('topbar').getBoundingClientRect().bottom + 30)],
                              ['sopra la plancia', innerWidth / 2, el('dock').getBoundingClientRect().top - 12]]){
      const [x, y] = scr(A), c = map.getContainer().getBoundingClientRect();
      map.panBy([x - X, y - Y], { animate:false }); await sleep(150); hoverAt(A); await sleep(120);
      const R = card.getBoundingClientRect(), [dx, dy] = scr(A);
      const hits = cardObstacles().filter(o => meet(R, o)).length;
      const who = [...document.querySelectorAll(CARD_OBST)].filter(o => o.getClientRects().length && o.offsetWidth && meet(R, o.getBoundingClientRect()))
                    .map(o => (o.id || o.className) + JSON.stringify(['left', 'top', 'right', 'bottom'].map(k => Math.round(o.getBoundingClientRect()[k]))));
      // schermo piu' basso di barra + scheda + plancia: nessun posto libero, la scheda puo' toccarle (resta nella mappa, mai sul puntino)
      const room = el('dock').getBoundingClientRect().top - el('topbar').getBoundingClientRect().bottom >= R.height + 24;
      log(vis(card) && (!hits || !room) && !(dx > R.left - 6 && dx < R.right + 6 && dy > R.top - 6 && dy < R.bottom + 6) &&
          R.left >= c.left && R.right <= c.right && R.top >= c.top && R.bottom <= c.bottom, 'posizione: ' + tag + (room ? '' : ' (schermo basso)'),
          JSON.stringify([R.left, R.top, R.right, R.bottom, dx, dy, who]));
    }
    {                                                                             // la mappa porta il puntino sotto una pillola
      const pg = el('pgPill').getBoundingClientRect(), [x, y] = scr(A);
      map.panBy([x - (pg.left + pg.width / 2), y - (pg.top + pg.height / 2)], { animate:false }); await sleep(150);
      log(!vis(card) || !meet(card.getBoundingClientRect(), el('pillRow').getBoundingClientRect()), 'puntino sotto la barra: la scheda non la copre', '');
      move(5, innerHeight / 2); await sleep(150);
    }
    map.panTo(A.m.getLatLng(), { animate:false }); await sleep(150);
    map.getContainer().dispatchEvent(new PointerEvent('pointerdown', { pointerType:'mouse', bubbles:true }));
    clickAt(A.m.getLatLng()); await until(() => currentStation === AP);
    log(currentStation === AP && !vis(card), 'clic col mouse: apre la stazione, la scheda sparisce', '');
    showMapView();
    // andamento 24 h dai file orari, variazione in 1 h, pioggia a barre, Cursore
    move(5, innerHeight / 2); map.panTo(mk(AP).m.getLatLng(), { animate:false }); await sleep(150);
    eq('andamento: linea con area, barre', [sparkSvg([1, 2, null, 3], false).includes('<polyline'), sparkSvg([1, 2, 3], false).includes('class="ar"'),
                                          sparkSvg([0, 1.2, 0], true).includes('<rect'), sparkSvg([5], false)], [true, true, true, '']);
    hoverAt(mk(AP)); await until(() => vis(card) && card.querySelector('.hc-spark svg'), 5000);   // visibile: la scheda nascosta tiene il contenuto vecchio
    log(!!card.querySelector('.hc-spark svg') && /^min .+ · max .+$/.test(card.querySelector('.hc-mm').textContent) &&
        (card.querySelector('.hc-span') || {}).textContent === '24 h', 'temperatura: andamento, "24 h" e min/max', card.textContent);
    {                                                                             // accanto al valore, freccia e niente unita'
      const tv = ST.s[AP.scode].slice(-25); let i = tv.length - 1;
      while(i > 0 && (tv[i] == null || tv[i - 1] == null)) i--;
      const d = i > 0 ? Math.round((tv[i] - tv[i - 1]) * 10) / 10 : 0, dl = card.querySelector('.hc-main .hc-delta');
      eq('variazione in 1 h accanto al valore', dl && dl.textContent, d === 0 ? '' : (d > 0 ? '↑ ' : '↓ ') + Math.abs(d).toFixed(1) + ' in 1 h');
    }
    const L = markerRefs.find(r => r.p._region === 'PC_FVG' && r.p.latest.LIVIDRO != null && r.p.latest.TEMP == null && lone(r));   // solo livello
    if(L){ map.panTo(L.m.getLatLng(), { animate:false }); await sleep(150); hoverAt(mk(L.p)); await sleep(600); }
    log(!!L && vis(card) && !card.querySelector('.hc-spark svg') && !card.querySelector('.hc-delta').textContent, 'livello: niente andamento', L && L.p.scode);
    setMapVar('PREC24'); await until(() => filterVar === 'PREC24'); await sleep(200);
    map.panTo(mk(AP).m.getLatLng(), { animate:false }); await sleep(150);
    hoverAt(mk(AP)); await until(() => vis(card) && card.querySelector('.hc-spark rect'), 5000);
    log(/^max .+ in 1 h$/.test(card.querySelector('.hc-mm').textContent) && !card.querySelector('.hc-delta').textContent,
        'pioggia: barre orarie e massimo in 1 h', card.querySelector('.hc-mm').textContent + ' | ' + card.querySelector('.hc-delta').textContent);
    await openSlider(); await until(() => snap.on && snap.T.length, 20000);
    setFrame(snap.kmax - 3); map.panTo(mk(AP).m.getLatLng(), { animate:false }); await sleep(150); hoverAt(mk(AP)); await sleep(150);
    const sv = snapVal(AP), fr = () => card.querySelector('.hc-time').textContent;
    eq('Cursore: valore al fotogramma', [vis(card) && fr(), card.querySelector('.hc-val') && card.querySelector('.hc-val').textContent],
       [fmtFrame(snap.T[snap.k]), sv == null ? 'n.d.' : sv + (snap.unit ? ' ' + snap.unit : '')]);
    setFrame(snap.kmax); await sleep(50);
    eq('Cursore: la scheda segue il fotogramma', vis(card) && fr(), fmtFrame(snap.T[snap.k]));
    {                                                                             // tutto all'ora del fotogramma, non all'ultimo dato
      const sh = snap.shift.FVG || 0, win = (a, k) => a.slice(k - sh - 23, k - sh + 1), ar = SP.s[AP.scode];
      const dom = s => { const d = document.createElement('div'); d.innerHTML = s; return d.innerHTML; };   // come lo riscrive il browser
      let kr = snap.kmax, best = -1;                                              // l'ora con la pioggia piu' forte nelle 24 h prima
      for(let k = snap.k0 + 24; k <= snap.kmax; k++){ const m = Math.max(...win(ar, k).map(x => x || 0)); if(m > best){ best = m; kr = k; } }
      setFrame(kr); const mmR = 'max ' + n2(best) + (SP.u ? ' ' + SP.u : '') + ' in 1 h';
      await until(() => vis(card) && card.querySelector('.hc-mm').textContent === mmR, 3000);
      eq('Cursore: pioggia delle 24 h fino al fotogramma', [card.querySelector('.hc-mm').textContent, card.querySelector('.hc-spark').innerHTML],
         [mmR, dom(sparkSvg(win(ar, kr), true))]);
      eq('Cursore: niente valori chiave dell\'ultimo dato', card.querySelectorAll('.hc-keys > div').length, 0);
      closeSlider(); setMapVar('TEMP'); await until(() => filterVar === 'TEMP');     // cambio pagina: il Cursore si chiude
      await openSlider(); await until(() => snap.on && snap.var === 'TEMP' && snap.T.length, 20000);
      const kt = snap.kmax - 30, wt = win(ST.s[AP.scode], kt), xt = wt.filter(x => x != null);
      setFrame(kt); map.panTo(mk(AP).m.getLatLng(), { animate:false }); await sleep(150);
      move(5, innerHeight / 2); await sleep(60); hoverAt(mk(AP));
      const mmT = 'min ' + n2(Math.min(...xt)) + ' · max ' + n2(Math.max(...xt));
      await until(() => vis(card) && card.querySelector('.hc-mm').textContent === mmT, 3000);
      eq('Cursore: temperatura delle 24 h fino al fotogramma', [vis(card) && fr(), card.querySelector('.hc-mm').textContent, card.querySelector('.hc-spark').innerHTML],
         [fmtFrame(snap.T[kt]), mmT, dom(sparkSvg(wt, false))]);
    }
    closeSlider(); setMapVar(''); move(5, innerHeight / 2); await sleep(150);
    // foglio basso al tocco (telefono e schermi touch)
    const tapAt = (r, type) => { const [x, y] = scr(r);
      map.getContainer().dispatchEvent(new PointerEvent('pointerdown', { pointerType:type, clientX:x, clientY:y, bubbles:true }));
      clickAt(r.m.getLatLng()); };
    const inStation = () => document.body.classList.contains('view-station');
    showMapView(); map.panTo(mk(AP).m.getLatLng(), { animate:false }); await sleep(150);
    const sheetEl = () => el('sheet');
    tapAt(mk(AP), 'touch'); await sleep(150);
    log(vis(sheetEl()) && sheetEl().textContent.includes(NAME) && sheetEl().textContent.includes('Apri la scheda'), 'tocco: foglio basso', '');
    eq('tocco: la stazione non si apre da sola', inStation(), false);
    log(!vis(card), 'tocco: niente scheda del mouse', '');
    log(!vis(el('dock')) && typeof sheetRing !== 'undefined' && !!sheetRing && map.hasLayer(sheetRing), 'foglio aperto: plancia nascosta, stazione evidenziata', '');
    if(innerWidth <= 720){ const S = sheetEl().getBoundingClientRect(); log(Math.abs(S.left - 8) < 1 && Math.abs(innerWidth - 8 - S.right) < 1, 'telefono: foglio largo quanto lo schermo', JSON.stringify([S.left, S.right])); }
    {                                                                             // schermo basso (telefono in orizzontale)
      const S = sheetEl().getBoundingClientRect(), T = el('topbar').getBoundingClientRect(), X = el('sheetClose').getBoundingClientRect();
      const O = el('sheetOpen').getBoundingClientRect(), hit = document.elementFromPoint(X.left + X.width / 2, X.top + X.height / 2);
      log(S.top >= T.bottom && el('sheetClose').contains(hit) && O.top >= S.top && O.bottom <= Math.min(S.bottom, innerHeight),
          'foglio sotto la barra in alto, × e "Apri la scheda" a portata', JSON.stringify([S.top, S.bottom, T.bottom, O.bottom, hit && (hit.id || hit.className)]));
      const A = map.attributionControl.getContainer(), R = A.getBoundingClientRect(), h = document.elementFromPoint(R.left + R.width / 2, R.top + R.height / 2);
      log(vis(A) && A.textContent.trim() !== '' && A.contains(h), 'foglio aperto: crediti della mappa visibili', A.textContent);
    }
    el('sheetClose').click(); await sleep(50);
    log(!vis(sheetEl()) && vis(el('dock')) && !map.hasLayer(sheetRing), '× chiude, la plancia torna', '');
    log(el('dkCredits').contains(map.attributionControl.getContainer()), 'foglio chiuso: crediti di nuovo nella plancia', '');
    tapAt(mk(AP), 'touch'); await sleep(100);
    const gr = sheetEl().querySelector('.sh-grab'), g = gr.getBoundingClientRect();
    gr.dispatchEvent(new PointerEvent('pointerdown', { pointerType:'touch', clientX:g.left + 10, clientY:g.top + 2, bubbles:true }));
    gr.dispatchEvent(new PointerEvent('pointerup', { pointerType:'touch', clientX:g.left + 10, clientY:g.top + 60, bubbles:true }));
    await sleep(50); log(!vis(sheetEl()), 'trascinato in giù: si chiude', '');
    tapAt(mk(AP), 'touch'); await sleep(100);
    const mr = map.getContainer().getBoundingClientRect(), empty = map.containerPointToLatLng([6, mr.height / 2]);
    map.getContainer().dispatchEvent(new PointerEvent('pointerdown', { pointerType:'touch', bubbles:true })); clickAt(empty); await sleep(50);
    log(!vis(sheetEl()), 'tocco sulla mappa fuori dai puntini: si chiude', '');
    tapAt(mk(AP), 'touch'); await sleep(100);
    el('sheetOpen').click(); await until(() => inStation() && currentStation === AP);
    log(inStation() && currentStation === AP && !vis(sheetEl()), '"Apri la scheda" apre la stazione e chiude il foglio', '');
    showMapView(); map.panTo(mk(AP).m.getLatLng(), { animate:false }); await sleep(150);
    tapAt(mk(AP), 'touch'); await sleep(100);
    const OB = markerRefs.find(r => r.p !== AP).p; selectStation(OB); await until(() => inStation() && currentStation === OB); showMapView(); await sleep(50);
    log(!vis(sheetEl()) && !map.hasLayer(sheetRing) && !document.body.classList.contains('sheet-open'),
        'un\'altra stazione aperta (ricerca, link): il foglio si chiude', '');
    // chiudi la stazione a caricamento finito: col selettore ristretto alle sue variabili PREC24 potrebbe mancare
    await until(() => el('stationFilter').value === OB._region + '|' + OB.scode);
    el('stationFilter').value = ''; el('stationFilter').dispatchEvent(new Event('change')); await until(() => !selectedKey);
    // un file orario lento non sovrascrive il foglio (o la scheda) gia' passato a un'altra variabile
    let release; const slow = () => { _cardSnap['FVG/TEMP'] = new Promise(r => { release = r; }); };
    slow(); map.panTo(mk(AP).m.getLatLng(), { animate:false }); await sleep(150);
    tapAt(mk(AP), 'touch'); await sleep(100);                                     // foglio sulla temperatura, file in attesa
    setMapVar('PREC24'); await until(() => filterVar === 'PREC24' && vis(sheetEl()) && sheetEl().querySelector('.hc-spark rect'), 3000);
    release(ST); await sleep(100);
    log(!sheetEl().querySelector('.hc-spark polyline') && /^max .+ in 1 h$/.test(sheetEl().querySelector('.hc-mm').textContent),
        'foglio: un file lento non sovrascrive la variabile nuova', sheetEl().querySelector('.hc-mm').textContent);
    closeSheet(); setMapVar(''); await until(() => filterVar === ''); await sleep(100);
    slow(); map.panTo(mk(AP).m.getLatLng(), { animate:false }); await sleep(150);
    move(5, innerHeight / 2); await sleep(60); hoverAt(mk(AP)); await sleep(150);  // scheda sulla temperatura, file in attesa
    setMapVar('PREC24'); await until(() => filterVar === 'PREC24'); await sleep(100);
    map.panTo(mk(AP).m.getLatLng(), { animate:false }); await sleep(150);
    move(5, innerHeight / 2); await sleep(60); hoverAt(mk(AP)); await until(() => vis(card) && card.querySelector('.hc-spark rect'), 3000);
    release(ST); await sleep(100);
    log(vis(card) && !card.querySelector('.hc-spark polyline') && /^max .+ in 1 h$/.test(card.querySelector('.hc-mm').textContent),
        'scheda: un file lento non sovrascrive la variabile nuova', card.querySelector('.hc-mm').textContent);
    move(5, innerHeight / 2); setMapVar('');
    eq('errori JS', window.__errs, []);
    finish();
  }
  async function suiteHoverRadar(){                   // scheda col radar locale (it_prod): SRI coi puntini, VMI senza
    try { localStorage.removeItem('radarProd'); } catch(e){}
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    const shown = () => getComputedStyle(el('prodMenu')).display !== 'none';
    const pick = async key => { if(!shown()){ el('dkProd').click(); await sleep(50); } const b = document.querySelector('#prodMenu [data-key="' + key + '"]'); if(b) b.click(); };
    const scr = r => { const p = map.latLngToContainerPoint(r.m.getLatLng()), c = map.getContainer().getBoundingClientRect(); return [c.left + p.x, c.top + p.y]; };
    const move = (x, y) => { const t = document.elementFromPoint(x, y);
      t.dispatchEvent(new PointerEvent('pointermove', { pointerType:'mouse', clientX:x, clientY:y, bubbles:true }));
      t.dispatchEvent(new MouseEvent('mousemove', { clientX:x, clientY:y, bubbles:true })); };
    const lone = r => markerRefs.every(o => o === r || Math.hypot(scr(o)[0] - scr(r)[0], scr(o)[1] - scr(r)[1]) > 12);
    const card = el('hoverCard'), mk = p => markerRefs.find(r => r.p === p), txt = s => (card.querySelector(s) || {}).textContent;
    const hover = async p => { map.panTo(mk(p).m.getLatLng(), { animate:false }); await sleep(150);
      move(5, innerHeight / 2); await sleep(60); move(...scr(mk(p))); await until(() => vis(card), 2000); };
    el('region').value = 'FVG'; await loadRegions(REGION_GROUPS.FVG || ['FVG']); await sleep(300);
    el('mcRadar').click(); await until(() => Radar.on && snap.on && el('dkProd') && snap.var === 'PREC1', 20000);
    map.setZoom(10, { animate:false }); await sleep(300);
    const A = markerRefs.find(r => r.p._region === 'FVG' && r.p.latest.TEMP != null && lone(r)), AP = A.p;
    await hover(AP);
    const sv = snapVal(AP);
    eq('SRI: la scheda al fotogramma delle stazioni', [txt('.hc-time'), txt('.hc-val')],
       [fmtFrame(snap.T[snap.k]), sv == null ? 'n.d.' : sv + (snap.unit ? ' ' + snap.unit : '')]);
    await pick('VMI'); await until(() => Radar.product && Radar.product.key === 'VMI' && filterVar === '');
    const BP = markerRefs.find(r => r.p._region === 'FVG' && r.p.latest.TEMP != null && lone(r)).p;    // tutte le stazioni: altri vicini
    await hover(BP);
    const last = [timeText(BP.latest_time, Date.now()), stationMainValue(BP).text];
    eq('VMI (puntini neutri): la scheda mostra l\'ultimo dato', [txt('.hc-time'), txt('.hc-val')], last);
    setFrame(Radar.source.min()); await sleep(100);
    eq('VMI: cambiando istante resta l\'ultimo dato', [vis(card), txt('.hc-time'), txt('.hc-val')], [true, ...last]);
    eq('errori JS', window.__errs, []);
    finish();
  }

  const suite = new URLSearchParams(location.search).get('suite') || 'radar';
  ready().then(() => ({ cursor:suiteCursor, radar:suiteRadar, hash:suiteHash, layout:suiteLayout, resilience:suiteResilience, prodotti:suiteProdotti,
            dock:suiteDock, buffer:suiteBuffer, oralegale:suiteOraLegale, search:suiteSearch, hover:suiteHover,
            hoverradar:suiteHoverRadar })[suite]())
         .catch(e => { log(false, 'eccezione', e && e.stack || e); finish(); });
})();
