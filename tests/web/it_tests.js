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
  // niente esce dalla pagina: ne' la pagina ne' la scheda scorrono di lato e nessun elemento visibile sporge dallo schermo
  // (tranne dentro le zone che scorrono da se', come la riga 2 sul telefono o una tabella larga)
  function noOverflow(tag){
    const pn = el('panel'), de = document.documentElement, R = e => e.getBoundingClientRect();
    const clipped = e => { for(let a = e.parentElement; a && a !== pn; a = a.parentElement) if(getComputedStyle(a).overflowX !== 'visible') return true; return false; };
    const out = [...pn.querySelectorAll('*')].filter(e => e.getClientRects().length > 0 && R(e).width > 0 && !clipped(e) && (R(e).left < -0.5 || R(e).right > innerWidth + 0.5))
                                              .map(e => e.id || e.className || e.tagName);
    log(de.scrollWidth <= innerWidth && pn.scrollWidth <= pn.clientWidth && !out.length, tag + ': niente esce dalla pagina a ' + innerWidth + ' px',
        JSON.stringify([de.scrollWidth, pn.scrollWidth, pn.clientWidth, out.slice(0, 6)]));
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

  async function suiteStazione(){                     // con quale variabile si apre una stazione
    const has = (p, v) => (p.variables || []).includes(v);
    const onPage = p => (p.variables || []).filter(v => varCat(v) === currentPage).sort(natVars);
    const pick = test => (allFeatures.find(f => test(f.properties)) || {}).properties;
    const A = pick(p => has(p, 'TEMP') && has(p, 'UMID'));
    const A2 = pick(p => has(p, 'TEMP') && has(p, 'UMID') && p !== A);
    const B = pick(p => !has(p, 'TEMP') && has(p, 'PREC'));
    const C = pick(p => !has(p, 'TEMP') && !has(p, 'PREC') && has(p, 'LIVIDRO'));
    const D = pick(p => !has(p, 'TEMP') && !has(p, 'PREC') && !has(p, 'LIVIDRO') && onPage(p).length);
    log(A && A2 && B && C && D, 'stazioni di prova trovate', JSON.stringify([!!A, !!A2, !!B, !!C, !!D]));
    if(!(A && A2 && B && C && D)) return finish();
    const open = async p => { await selectStation(p); await until(() => currentStation === p); return currentVar; };
    setMapVar(''); await until(() => filterVar === '');
    eq('si apre sulla temperatura', await open(A), 'TEMP');
    eq('senza temperatura: la precipitazione', await open(B), 'PREC');
    eq('senza temperatura né precipitazione: il livello idrometrico', await open(C), 'LIVIDRO');
    eq('altrimenti la prima variabile disponibile', await open(D), onPage(D)[0]);
    await open(A); drawVar('UMID');
    eq('la variabile della stazione di prima non passa alla successiva', await open(A2), 'TEMP');
    setMapVar('UMID'); await until(() => filterVar === 'UMID');
    eq('la variabile scelta sulla mappa vince', await open(A), 'UMID');
    showMapView(); setMapVar('');
    eq('errori JS', window.__errs, []);
    finish();
  }

  async function suiteStorico(){                      // Storico: pulsante, viste Mesi/Anni/Giorni/Tabella, CSV, link H:VAR:VIEW (campione vero in tests/web/storico)
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    const R = e => e.getBoundingClientRect();
    const st = (reg, test) => (allFeatures.find(f => f.properties._region === reg && test(f.properties)) || {}).properties;
    const has = (p, v) => (p.variables || []).includes(v);
    const V = st('VEN', p => p.scode === '79');                                    // Valdagno: PREC+TEMP, nel campione
    const L = st('LOM', p => has(p, 'PREC'));                                      // regione non in index.json
    const N = st('VEN', p => !has(p, 'PREC') && !has(p, 'TEMP'));                  // regione presente ma niente PREC/TEMP
    log(V && L && N, 'stazioni di prova trovate', JSON.stringify([!!V, !!L, !!N]));
    if(!(V && L && N)) return finish();
    const open = async p => { await selectStation(p); await until(() => currentStation === p); await sleep(400); };
    const raw = await (await fetch('./_radar_test/_HIST/VEN/79.json')).json();      // il file vero, per i conteggi attesi
    const nrow = raw.p.filter((x, i) => x != null || (raw.tm || [])[i] != null || (raw.tn || [])[i] != null).length;
    const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    // dentro lo schermo; sul telefono la riga dei comandi scorre di lato: prima la si porta al comando (come col dito)
    const inside = e => { e.scrollIntoView({ block:'nearest', inline:'nearest' }); const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; };
    // niente legenda di uPlot ("Mese: --"), niente "*", trattini al posto dei mesi mancanti o corsivo
    const clean = name => {
      const hv = el('histview'), txt = hv.innerText, it = [...hv.querySelectorAll('*')].filter(e => vis(e) && getComputedStyle(e).fontStyle !== 'normal');
      log(![...hv.querySelectorAll('.u-legend')].some(vis) && !/--/.test(txt), name + ': niente legenda sotto il grafico ("--")', txt.slice(0, 100));
      log(!/\*/.test(txt) && !/–/.test(el('hvTable').innerText) && !it.length, name + ': niente "*", "–" o corsivo',
          JSON.stringify([txt.match(/\S*\*\S*/g), it.slice(0, 3).map(e => e.tagName + '.' + e.className)]));
    };
    const okView = (name) => {
      const c = el('hvChart');
      log(!!c.querySelector('canvas') && !c.querySelector('.hint'), name + ': grafico disegnato', c.innerHTML.slice(0, 120));
      log(histU && histU.width > 0 && histU.width <= innerWidth + 1, name + ': grafico largo quanto la pagina', histU && histU.width + ' / ' + innerWidth);
      log(/Dati dal 23\/10\/2024 al /.test(el('hvNote').textContent), name + ': nota', el('hvNote').textContent.slice(0, 80));
      log(!/undefined|NaN|null/.test(el('hvTable').textContent + el('hvNote').textContent), name + ': niente undefined/NaN', el('hvTable').textContent.slice(0, 120));
      log(el('hvTable').textContent.trim() === '', name + ': niente tabella sotto il grafico', el('hvTable').textContent.slice(0, 60));
      clean(name);
    };
    const okTable = name => {                                        // la voce Tabella: solo la tabella, nessun grafico
      log(!histU && !vis(el('hvChart')) && !el('hvChart').querySelector('canvas'), name + ': nessun grafico', '');
      log(!!el('hvTable').querySelector('table') && el('hvTable').textContent.trim().length > 20 && vis(el('hvTable')), name + ': tabella', '');
      log(/Dati dal 23\/10\/2024 al /.test(el('hvNote').textContent), name + ': nota', el('hvNote').textContent.slice(0, 80));
      log(!/undefined|NaN|null/.test(el('hvTable').textContent + el('hvNote').textContent), name + ': niente undefined/NaN', '');
      log(inside(el('hvView')) && el('hvView').querySelector('.on').dataset.w === 'tabella', name + ': voce Tabella accesa', '');
      clean(name);
    };

    // valori attesi ricalcolati dal file vero, con la regola del piano (giorno completo >= 20 ore; mese completo = intero e >= 90% di giorni completi)
    const r1 = x => Math.round(x * 10) / 10, f1 = x => r1(x).toFixed(1);
    const d0 = Date.UTC(+raw.d0.slice(0, 4), +raw.d0.slice(4, 6) - 1, +raw.d0.slice(6, 8)), nraw = raw.p.length;
    const dayOf = i => new Date(d0 + 86400000 * i);
    const doyOf = d => Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000);
    const expMonths = isP => {                                       // anno-mese -> { y, m, val, full, span, have, dim, mn, mx }
      const val = isP ? raw.p : raw.tm, hrs = isP ? raw.hp : raw.ht, out = {};
      const i0 = val.findIndex(x => x != null);
      for(let i = i0; i < nraw; i++){
        const d = dayOf(i), y = d.getUTCFullYear(), m = d.getUTCMonth(), c = out[y + '-' + m] || (out[y + '-' + m] = { y, m, sum:0, any:0, tsum:0, have:0, span:0, mn:null, mx:null });
        c.span++;
        if(isP && raw.p[i] != null){ c.sum += raw.p[i]; c.any++; }
        if(!isP && raw.tn[i] != null) c.mn = c.mn == null ? raw.tn[i] : Math.min(c.mn, raw.tn[i]);
        if(!isP && raw.tx[i] != null) c.mx = c.mx == null ? raw.tx[i] : Math.max(c.mx, raw.tx[i]);
        if(val[i] != null && hrs[i] >= 20){ c.have++; if(!isP) c.tsum += raw.tm[i]; }
      }
      Object.values(out).forEach(c => { c.dim = new Date(Date.UTC(c.y, c.m + 1, 0)).getUTCDate(); c.full = c.span === c.dim && c.have >= 0.9 * c.dim;
        c.val = isP ? (c.any ? r1(c.sum) : null) : (c.have ? r1(c.tsum / c.have) : null); });
      return out;
    };
    // anni tratteggiati (incompleti): dati da dopo il 10 gennaio o meno del 90% di giorni completi fra il primo e l'ultimo dato
    const partYears = isP => {
      const val = isP ? raw.p : raw.tm, hrs = isP ? raw.hp : raw.ht, Y = {};
      val.forEach((x, i) => { if(x == null) return; const d = dayOf(i), y = d.getUTCFullYear(), doy = doyOf(d);
        const o = Y[y] || (Y[y] = { first:doy, last:doy, have:0 }); o.last = doy; if(hrs[i] >= 20) o.have++; });
      return Object.keys(Y).map(Number).filter(y => Y[y].first > 10 || Y[y].have < 0.9 * (Y[y].last - Y[y].first + 1));
    };
    // righe del riquadro al passaggio: mese o giorno, i valori ("162 mm"; "media 23.0 °C", "min 13.3 · max 35.9"), "incompleto"
    const vals = (isP, rain, m, mn, mx) => isP ? [rain + ' mm'] : ['media ' + f1(m) + ' °C', 'min ' + f1(mn) + ' · max ' + f1(mx)];
    const monTxt = (isP, c) => [MESI[c.m] + ' ' + c.y, ...vals(isP, Math.round(c.val), c.val, c.mn, c.mx), ...(c.full ? [] : ['incompleto'])].join(' | ');
    const dayTxt = (isP, i) => { const d = dayOf(i);
      return [d.getUTCDate() + ' ' + MESI[d.getUTCMonth()] + ' ' + d.getUTCFullYear(), ...vals(isP, f1(raw.p[i]), raw.tm[i], raw.tn[i], raw.tx[i]),
              ...((isP ? raw.hp[i] : raw.ht[i]) < 20 ? ['incompleto'] : [])].join(' | '); };
    const dayWith = isP => { for(let i = nraw - 15; i > nraw - 30; i--) if(isP ? raw.p[i] != null : raw.tm[i] != null && raw.tn[i] != null && raw.tx[i] != null) return i; return -1; };
    const colorOf = css => { const s = document.createElement('span'); s.style.color = css; el('histview').appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };

    // Tabella: una riga per mese (gen..dic) e in fondo tot/media, una colonna per anno (dal piu' vecchio); pioggia in mm
    // interi, temperatura con un decimale; mese mancante = cella vuota; incompleto = piu' chiaro col perche' (title);
    // dietro ogni numero una barra (pioggia: valore / mese piu' piovoso; temperatura: dal mese piu' freddo al piu' caldo)
    const tbl = () => el('hvTable').querySelector('table');
    const cell = (y, m) => {                                         // m = 0..11 i mesi, 12 la riga del totale/media
      const t = tbl(), k = t ? [...t.rows[0].cells].findIndex(c => c.textContent.trim() === String(y)) : -1, tr = t && t.tBodies[0] && t.tBodies[0].rows[m];
      return k > 0 && tr ? tr.cells[k] : null;
    };
    const barW = td => { const s = getComputedStyle(td); return s.backgroundImage === 'none' ? null : parseFloat(s.backgroundSize); };
    const barColor = {};
    const checkTable = (isP, name) => {
      const E = expMonths(isP), ok = Object.values(E).filter(c => c.val != null), t = tbl();
      const years = [...new Set(Object.values(E).map(c => c.y))].sort((a, b) => a - b);
      const num = x => isP ? String(Math.round(x)) : f1(x), why = c => 'incompleto: ' + c.have + ' giorni completi su ' + c.dim;
      const hi = Math.max(...ok.map(c => c.val)), lo = Math.min(...ok.map(c => c.val)), wantW = x => 100 * (isP ? x / hi : (x - lo) / (hi - lo));
      eq(name + ': in alto l\'unità e gli anni, dal più vecchio', t ? [...t.rows[0].cells].map(c => c.textContent.trim()) : null, [isP ? 'mm' : '°C', ...years.map(String)]);
      eq(name + ': una riga per mese e in fondo ' + (isP ? 'tot' : 'media'), t && t.tBodies[0] ? [...t.tBodies[0].rows].map(r => r.cells[0].textContent.trim()) : null,
         [...MESI, isP ? 'tot' : 'media']);
      const full = ok.find(c => c.full), partial = ok.find(c => !c.full && c.span === c.dim), edge = ok[0];     // incompleto "per giorni mancanti" e primo mese (parziale)
      log(!!full, name + ': nei dati c\'e\' un mese completo', '');
      for(const [tag, c] of [['completo', full], ['incompleto (giorni mancanti)', partial], ['primo (parziale)', edge], ['ultimo', ok[ok.length - 1]]]){
        if(!c){ log(tag !== 'completo', name + ': mese ' + tag + ' (assente nei dati: saltato)', ''); continue; }
        const td = cell(c.y, c.m);
        eq(name + ': mese ' + tag + ' ' + (c.m + 1) + '/' + c.y + ' (valore, più chiaro, perché)', td && [td.textContent, td.classList.contains('part'), td.title],
           [num(c.val), !c.full, c.full ? '' : why(c)]);
      }
      const bad = [];
      for(const y of years) for(let m = 0; m < 12; m++){
        const c = E[y + '-' + m], td = cell(y, m), tag = (m + 1) + '/' + y;
        if(!td){ bad.push(tag + ' assente'); continue; }
        if(!c || c.val == null){ if(td.textContent !== '' || barW(td) != null) bad.push(tag + ' non vuota: "' + td.textContent + '"'); continue; }
        const w = barW(td);
        if(td.textContent !== num(c.val) || td.classList.contains('part') === c.full || td.title !== (c.full ? '' : why(c)) || !(Math.abs(w - wantW(c.val)) <= 0.6))
          bad.push(tag + ' ' + td.textContent + (td.classList.contains('part') ? ' [part]' : '') + ' barra ' + w + ' (atteso ' + num(c.val) + ' barra ' + wantW(c.val).toFixed(1) + ')');
      }
      eq(name + ': ogni mese (valore, più chiaro col perché, barra; vuoto se manca)', bad.slice(0, 6), []);
      for(const y of years){                                         // riga in fondo: totale (pioggia) o media delle medie (temperatura), in grassetto
        const ms = ok.filter(c => c.y === y), s = ms.reduce((a, c) => a + c.val, 0), nf = ms.filter(c => c.full).length, td = cell(y, 12);
        eq(name + ': ' + (isP ? 'tot ' : 'media ') + y + ' (valore, più chiaro, perché, grassetto)',
           td && [td.textContent, td.classList.contains('part'), td.title, +getComputedStyle(td).fontWeight >= 600],
           [num(isP ? s : s / ms.length), nf < 12, nf < 12 ? 'incompleto: ' + nf + ' mesi completi su 12' : '', true]);
      }
      if(!t || !t.tBodies[0]) return;
      const months = [...t.tBodies[0].rows].slice(0, 12).flatMap(r => [...r.cells].slice(1)).filter(td => td.textContent !== '');
      const part = months.filter(td => td.classList.contains('part')), fullc = months.filter(td => !td.classList.contains('part'));
      const MUTED = colorOf('var(--muted)'), bg = td => getComputedStyle(td).backgroundImage;
      log(part.length > 0 && fullc.length > 0 && part.every(td => getComputedStyle(td).color === MUTED) && fullc.every(td => getComputedStyle(td).color !== MUTED),
          name + ': incompleti in grigio, completi no', JSON.stringify([MUTED, part.length && getComputedStyle(part[0]).color, fullc.length && getComputedStyle(fullc[0]).color]));
      const fb = [...new Set(fullc.map(bg))], pb = [...new Set(part.map(bg))];
      log(fb.length === 1 && pb.length === 1 && fb[0] !== 'none' && pb[0] !== 'none' && fb[0] !== pb[0], name + ': barra colorata se completo, grigia se incompleto', JSON.stringify([fb, pb]));
      barColor[isP ? 'P' : 'T'] = fb[0];
      if(fullc.length){
        document.body.classList.add('dark'); const dark = bg(fullc[0]); document.body.classList.remove('dark');
        log(dark !== 'none' && dark !== fb[0], name + ': barre col tema scuro', JSON.stringify([fb[0], dark]));
      }
      const c1 = t.tBodies[0].rows[0].cells;
      log(c1.length > 1 && getComputedStyle(c1[1]).textAlign === 'right' && getComputedStyle(t.rows[0].cells[1]).textAlign === 'right' &&
          /tabular-nums/.test(getComputedStyle(c1[1]).fontVariantNumeric), name + ': numeri a destra, cifre della stessa larghezza', '');
      log(getComputedStyle(c1[0]).position === 'sticky' && getComputedStyle(t.rows[0].cells[0]).position === 'sticky', name + ': colonna dei mesi ferma se la tabella scorre', getComputedStyle(c1[0]).position);
      const pn = el('panel'), ps = getComputedStyle(pn), x0 = R(pn).left + parseFloat(ps.paddingLeft),
            avail = pn.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight), tw = R(t).width;
      if(avail > 520) log(tw <= 520.5 && Math.abs(R(t).left - x0) <= 1, name + ': tabella stretta (al massimo 520 px), a sinistra', JSON.stringify([R(t).left, tw, x0, avail]));
      else log(Math.abs(tw - avail) <= 1 && Math.abs(R(t).left - x0) <= 1, name + ': tabella larga quanto lo schermo', JSON.stringify([R(t).left, tw, x0, avail]));
    };

    // grafici: chiave fissa in alto a destra (sopra i dati) ed etichetta dove sta il puntatore (mouse; al tocco sul telefono)
    const okKey = (name, want) => {
      const k = el('hvChart').querySelector('.hv-key'), w = histU && histU.over.parentNode;
      eq(name + ': chiave', k ? [...k.children].map(e => e.textContent.trim()) : null, want);
      log(vis(k) && R(k).right <= R(w).right + 0.5 && R(k).right >= R(w).right - 60 && R(k).top >= R(w).top - 0.5 && R(k).bottom <= R(histU.over).top + 1,
          name + ': chiave in alto a destra, sopra i dati', k && JSON.stringify([R(k).left, R(k).top, R(k).right, R(k).bottom, R(histU.over).top, R(w).right]));
    };
    const tipAt = async (xv, yv) => {                                // mousemove vero sul grafico nel punto (xv, yv) dei suoi assi (yv null = a meta' altezza)
      const o = histU.over, r = R(o), x = r.left + histU.valToPos(xv, 'x'), y = r.top + (yv == null ? r.height / 2 : histU.valToPos(yv, 'y'));
      o.dispatchEvent(new MouseEvent('mouseenter', { clientX:x, clientY:y }));
      o.dispatchEvent(new MouseEvent('mousemove', { clientX:x, clientY:y, bubbles:true }));
      await sleep(60);
      return o.querySelector('.ctip');
    };
    const tipText = t => vis(t) ? t.innerText.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ') : null;
    const tipIn = t => { if(!vis(t)) return false; const a = R(t), o = R(histU.over);
      return a.left >= o.left - 0.5 && a.right <= o.right + 0.5 && a.top >= o.top - 0.5 && a.bottom <= o.bottom + 0.5 && a.left >= -0.5 && a.right <= innerWidth + 0.5; };
    const okTip = async (name, xv, want) => {
      const t = await tipAt(xv, null);
      eq(name + ': etichetta al passaggio', tipText(t), want);
      log(tipIn(t), name + ': etichetta dentro il grafico e lo schermo', t && JSON.stringify([R(t).left, R(t).right, R(histU.over).left, R(histU.over).right]));
    };
    const tipEdges = async name => {                                 // vicino ai bordi resta dentro: in alto a destra, in basso a sinistra
      const sx = histU.scales.x, sy = histU.scales.y, dx = (sx.max - sx.min) / 100, dy = (sy.max - sy.min) / 50;
      const a = tipIn(await tipAt(sx.max - dx, sy.max - dy)), b = tipIn(await tipAt(sx.min + dx, sy.min + dy));
      log(a && b, name + ': vicino ai bordi l\'etichetta resta dentro', JSON.stringify([a, b]));
    };
    // Anni: nessuna legenda, il nome dell'anno in fondo alla sua linea; ultimo anno blu e piu' spesso, gli altri grigi, incompleti tratteggiati
    const okYears = (name, isP) => {
      const S = histU.series.slice(1), n = S.length, yrs = S.map(s => String(s.label));
      const col = k => { const s = histU.series[k]; return typeof s.stroke === 'function' ? s.stroke(histU, k) : s.stroke; };
      const rgb = c => (/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c || '') || []).slice(1).map(h => parseInt(h, 16));
      const grey = c => { const v = rgb(c); return v.length === 3 && Math.max(...v) - Math.min(...v) <= 40; };
      const lv = rgb(col(n));
      log(lv.length === 3 && lv[2] - lv[0] >= 60 && S.every((s, k) => k === n - 1 || (s.width < S[n - 1].width && grey(col(k + 1)))),
          name + ': ultimo anno blu e più spesso, gli altri grigi', JSON.stringify(S.map((s, k) => [s.label, col(k + 1), s.width])));
      eq(name + ': anni incompleti tratteggiati', S.filter(s => s.dash && s.dash.length).map(s => s.label), partYears(isP).map(String));
      const o = histU.over, w = o.parentNode, labs = [...w.children].filter(e => vis(e) && /^\d{4}$/.test(e.textContent.trim()));
      eq(name + ': il nome di ogni anno sul grafico', labs.map(l => l.textContent.trim()).sort(), yrs.slice().sort());
      const bad = [];
      S.forEach((s, k) => {
        const d = histU.data[k + 1], lab = labs.find(l => l.textContent.trim() === yrs[k]); let j = d.length - 1;
        while(j >= 0 && d[j] == null) j--;
        if(!lab || j < 0){ bad.push(yrs[k] + ' senza nome'); return; }
        const px = R(o).left + histU.valToPos(histU.data[0][j], 'x'), py = R(o).top + histU.valToPos(d[j], 'y'), r = R(lab);
        if(r.left < px || r.left > px + 12 || Math.abs((r.top + r.bottom) / 2 - py) > 20 || r.right > R(w).right + 0.5 || r.top < R(w).top - 0.5 || r.bottom > R(w).bottom + 0.5)
          bad.push(yrs[k] + ' ' + JSON.stringify([Math.round(r.left), Math.round((r.top + r.bottom) / 2), Math.round(px), Math.round(py)]));
      });
      eq(name + ': nome in fondo alla propria linea, dentro il grafico', bad, []);
      const ov = []; labs.forEach((a, i) => labs.slice(i + 1).forEach(b => { const p = R(a), q = R(b);
        if(p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) ov.push(a.textContent + '/' + b.textContent); }));
      log(labs.length === n && !ov.length, name + ': nomi degli anni non sovrapposti', JSON.stringify(ov));
      let ml = []; try { const a = histU.axes[0]; ml = a.values(histU, a.splits(histU, 0, 0, 365, 1, 1), 0, 30, 1).filter(Boolean); } catch(e){ ml = [String(e)]; }
      log(ml.length >= 6 && R(o).width / ml.length >= 26, name + ': nomi dei mesi sull\'asse non sovrapposti (almeno 26 px l\'uno)', JSON.stringify([ml, R(o).width]));
    };
    // la "i" accanto a "Dati dal ... al ...": chiusa all'inizio, mostra il metodo, si usa da tastiera
    const okInfo = async name => {
      const b = el('hvInfoBtn'), box = el('hvInfo'), last = dayOf(nraw - 1), dd = n => String(n).padStart(2, '0');
      eq(name + ': riga della nota', el('hvDates') && el('hvDates').textContent, 'Dati dal 23/10/2024 al ' + dd(last.getUTCDate()) + '/' + dd(last.getUTCMonth() + 1) + '/' + last.getUTCFullYear());
      if(!b || !box){ log(false, name + ': "i" del metodo', 'assente'); return; }
      log(b.tagName === 'BUTTON' && vis(b) && b.getAttribute('aria-expanded') === 'false' && !vis(box), name + ': "i" chiusa all\'inizio', b.outerHTML.slice(0, 160));
      b.click(); await sleep(50);
      log(vis(box) && b.getAttribute('aria-expanded') === 'true' && ['giorno solare (UTC+1)', 'giorno completo = almeno 20 ore con dato', 'più chiaro o tratteggiato = incompleto',
          'elaborazioni non ufficiali dei dati grezzi delle fonti'].every(s => box.innerText.includes(s)), name + ': "i" mostra il metodo', box.innerText);
      noOverflow(name + ', metodo aperto');
      b.click(); await sleep(50);
      log(!vis(box) && b.getAttribute('aria-expanded') === 'false', name + ': "i" si richiude', '');
      b.focus(); b.click(); await sleep(30);                         // tastiera: e' un pulsante (Invio e spazio lo premono); Esc chiude
      b.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); await sleep(30);
      log(document.activeElement === b && b.tabIndex >= 0 && !vis(box) && b.getAttribute('aria-expanded') === 'false', name + ': "i" da tastiera (fuoco, Esc chiude)',
          document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    };

    // pulsante
    setMapVar(''); await until(() => filterVar === '');
    await open(L);
    log(!vis(el('histbtn')), 'regione non in index.json: pulsante nascosto', '');
    await open(N);
    log(!vis(el('histbtn')), 'senza pioggia ne temperatura: pulsante nascosto', JSON.stringify(N.variables));
    await open(V);
    log(vis(el('histbtn')), 'Valdagno (PREC+TEMP): pulsante visibile', '');
    for(const v of ['UMID', 'PREC24', 'TEMP']){                                    // il pulsante non dipende dalla variabile aperta
      if(has(V, v) && el('vars').querySelector('[data-var="' + v + '"]')){ drawVar(v); await sleep(100);
        log(vis(el('histbtn')), 'pulsante visibile con ' + v + ' aperta', ''); }
    }
    await setHistMode(true, 'PREC', 'mesi');                                        // con lo Storico aperto, una stazione senza pioggia/temperatura lo chiude
    await open(N);
    log(!histMode && !vis(el('histview')) && !vis(el('histbtn')), 'stazione senza PREC/TEMP: Storico chiuso', histMode);
    await open(V);
    // viste
    const EP = expMonths(true), ET = expMonths(false);
    await setHistMode(true, 'PREC', 'mesi');
    log(histMode && vis(el('histview')) && el('histbtn').classList.contains('active'), 'Storico aperto', '');
    eq('vista iniziale', [histVar, histView], ['PREC', 'mesi']);
    okView('Pioggia/Mesi');
    okKey('Pioggia/Mesi', ['mm', 'incompleto']);
    await okTip('Pioggia/Mesi, agosto 2025', Date.UTC(2025, 7, 1) / 1000, monTxt(true, EP['2025-7']));
    await okTip('Pioggia/Mesi, settembre 2025 (incompleto)', Date.UTC(2025, 8, 1) / 1000, monTxt(true, EP['2025-8']));
    {                                                                // telefono: al tocco il riquadro compare, trascinando il dito lo segue
      const o = histU.over, r = R(o), y = r.top + r.height / 2, at = (yy, mm) => r.left + histU.valToPos(Date.UTC(yy, mm, 1) / 1000, 'x');
      const touch = (type, x) => o.dispatchEvent(new PointerEvent(type, { pointerType:'touch', isPrimary:true, clientX:x, clientY:y, bubbles:true }));
      let got = null;
      try { touch('pointerdown', at(2025, 2)); await sleep(40); got = [tipText(o.querySelector('.ctip'))];
            touch('pointermove', at(2025, 3)); await sleep(40); got.push(tipText(o.querySelector('.ctip'))); } catch(e){ got = String(e); }
      eq('Pioggia/Mesi: al tocco e trascinando il dito (marzo, poi aprile 2025)', got, [monTxt(true, EP['2025-2']), monTxt(true, EP['2025-3'])]);
    }
    noOverflow('Pioggia/Mesi, etichetta');
    await tipEdges('Pioggia/Mesi');
    await okInfo('Pioggia/Mesi');
    histView = 'tabella'; await renderHist(); okTable('Pioggia/Tabella');
    checkTable(true, 'Pioggia/Tabella');
    noOverflow('Pioggia/Tabella');
    histView = 'mesi'; await renderHist();
    log(inside(el('hvVar')) && inside(el('hvView')) && inside(el('hvCsv')), 'comandi dentro lo schermo', '');
    histView = 'anni'; await renderHist(); okView('Pioggia/Anni');
    {                                                                // cumulata: a fine 2025 il totale dell'anno; al passaggio la cumulata di ogni anno
      const yrs = [...new Set(Object.values(EP).map(c => c.y))], k = yrs.indexOf(2025) + 1;
      const tot = r1(raw.p.reduce((a, x, i) => a + (dayOf(i).getUTCFullYear() === 2025 && x != null ? x : 0), 0));
      eq('Pioggia/Anni: cumulata del 2025 al 31/12', [histU.data[k][364], histU.series[k].label], [tot, '2025']);
      let ax = null; try { ax = histU.axes[1].values(histU, [1000, 2.5, -10], 1, 50, 100); } catch(e){ ax = String(e); }
      eq('Pioggia/Anni: asse col punto decimale e senza separatore delle migliaia', ax, ['1000', '2.5', '-10']);
      okYears('Pioggia/Anni', true);
      okKey('Pioggia/Anni', ['incompleto']);
      const t = await tipAt(300, null), i = histU.cursor.idx, lab = new Date(Date.UTC(2023, 0, 1 + i));
      const cum = y => { let run = 0, first = -1, lastd = -1;                 // come il grafico: cumulata dal 1 gennaio, null fuori dai dati dell'anno
        raw.p.forEach((x, j) => { const d = dayOf(j); if(x == null || d.getUTCFullYear() !== y) return; const doy = doyOf(d);
          if(first < 0) first = doy; lastd = doy; if(doy <= i) run += x; });
        return first < 0 || i < first || i > lastd ? null : r1(run); };
      const want = [lab.getUTCDate() + ' ' + MESI[lab.getUTCMonth()], ...yrs.slice().reverse().filter(y => cum(y) != null).map(y => y + ' ' + Math.round(cum(y)) + ' mm')];
      log(Math.abs(i - 300) <= 3, 'Pioggia/Anni: puntatore sul giorno 300', i);
      eq('Pioggia/Anni: etichetta al passaggio (ogni anno)', tipText(t), want.join(' | '));
      log(tipIn(t), 'Pioggia/Anni: etichetta dentro il grafico e lo schermo', '');
      noOverflow('Pioggia/Anni');
    }
    histView = 'giorni'; await renderHist(); okView('Pioggia/Giorni');
    okKey('Pioggia/Giorni', ['mm', 'incompleto']);
    log(vis(el('hvRange')) && inside(el('hvRange')), 'Giorni: scelta del periodo visibile e dentro lo schermo', '');
    for(const [r, days] of [[30, 30], [90, 90], [365, 365], [0, raw.p.length]]){
      el('hvRange').querySelector('[data-r="' + r + '"]').click(); await sleep(150);
      const sx = histU.scales.x, span = Math.round((sx.max - sx.min) / 86400);
      log(Math.abs(span - days) <= 1 && el('hvRange').querySelector('.on').dataset.r === String(r), 'Giorni ' + (r || 'Tutto'), 'span ' + span + ' giorni, atteso ' + days);
    }
    el('hvRange').querySelector('[data-r="30"]').click(); await sleep(150);
    { const i = dayWith(true); await okTip('Pioggia/Giorni, ' + dayOf(i).toISOString().slice(0, 10), d0 / 1000 + 86400 * i, dayTxt(true, i)); }
    await tipEdges('Pioggia/Giorni');
    histVar = 'TEMP'; currentVar = 'TEMP'; histView = 'mesi'; await renderHist(); okView('Temperatura/Mesi');
    okKey('Temperatura/Mesi', ['min–max', 'media']);
    {
      const S = histU.series, big = k => { try { return !!S[k].points.show(histU, k, 0, histU.data[0].length - 1) && S[k].points.size > 3; } catch(e){ return true; } };
      log(S.length === 4 && histU.bands.length === 1 && S[3].width > Math.max(S[1].width, S[2].width) && ![1, 2, 3].some(big),
          'Temperatura/Mesi: banda min-max e linea della media, senza puntini grandi', JSON.stringify([S.map(s => [s.label, s.width]), histU.bands.length]));
    }
    await okTip('Temperatura/Mesi, agosto 2025', Date.UTC(2025, 7, 1) / 1000, monTxt(false, ET['2025-7']));
    await okTip('Temperatura/Mesi, settembre 2025 (incompleto)', Date.UTC(2025, 8, 1) / 1000, monTxt(false, ET['2025-8']));
    noOverflow('Temperatura/Mesi, etichetta');
    await tipEdges('Temperatura/Mesi');
    histView = 'tabella'; await renderHist(); okTable('Temperatura/Tabella');
    checkTable(false, 'Temperatura/Tabella');
    log(!!barColor.P && !!barColor.T && barColor.P !== barColor.T, 'Tabella: barre della temperatura di un altro colore (calde)', JSON.stringify(barColor));
    noOverflow('Temperatura/Tabella');
    histView = 'mesi'; await renderHist();
    histView = 'anni'; await renderHist(); okView('Temperatura/Anni');
    {                                                                // media mensile nel grafico (almeno 10 giorni completi nel mese); al passaggio ogni anno
      const yrs = [...new Set(Object.values(ET).map(c => c.y))], k = yrs.indexOf(2025) + 1;
      const mean = (y, m) => { let t = 0, n = 0; raw.tm.forEach((x, i) => { const d = dayOf(i); if(d.getUTCFullYear() === y && d.getUTCMonth() === m && x != null && raw.ht[i] >= 20){ t += x; n++; } });
        return n >= 10 ? r1(t / n) : null; };
      eq('Temperatura/Anni: medie mensili 2025 nel grafico', histU.data[k], MESI.map((_, m) => mean(2025, m)));
      okYears('Temperatura/Anni', false);
      okKey('Temperatura/Anni', ['incompleto']);
      const t = await tipAt(7, null);
      eq('Temperatura/Anni: etichetta al passaggio (ogni anno)', tipText(t),
         ['ago', ...yrs.slice().reverse().filter(y => mean(y, 7) != null).map(y => y + ' ' + f1(mean(y, 7)) + ' °C')].join(' | '));
      log(tipIn(t), 'Temperatura/Anni: etichetta dentro il grafico e lo schermo', '');
      await tipEdges('Temperatura/Anni');
      noOverflow('Temperatura/Anni');
    }
    histView = 'giorni'; await renderHist(); okView('Temperatura/Giorni');
    okKey('Temperatura/Giorni', ['min–max', 'media']);
    for(const r of [30, 90, 365, 0]){ el('hvRange').querySelector('[data-r="' + r + '"]').click(); await sleep(100); }
    log(!!el('hvChart').querySelector('canvas') && !el('hvChart').querySelector('.hint'), 'Temperatura/Giorni: tutti i periodi senza errori', '');
    el('hvRange').querySelector('[data-r="30"]').click(); await sleep(150);
    { const i = dayWith(false); await okTip('Temperatura/Giorni, ' + dayOf(i).toISOString().slice(0, 10), d0 / 1000 + 86400 * i, dayTxt(false, i)); }
    // i pulsanti veri (clic DOM) cambiano vista e variabile
    el('hvView').querySelector('[data-w="mesi"]').click(); await sleep(300);
    el('hvVar').querySelector('[data-v="PREC"]').click(); await sleep(300);
    eq('clic su Mesi e Pioggia', [histView, histVar, currentVar], ['mesi', 'PREC', 'PREC']);

    // CSV: una riga per giorno
    let csv = null; const oc = URL.createObjectURL, oclick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = b => { csv = b; return 'blob:test'; };
    HTMLAnchorElement.prototype.click = function(){ if(this.download) csv = csv || true; else oclick.call(this); };
    el('hvCsv').click(); await sleep(200);
    URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = oclick;
    const lines = csv && csv.text ? (await csv.text()).trim().split('\n') : [];
    const days = lines.slice(1).map(l => l.split(';')[0]);
    eq('CSV: intestazione', lines[0], 'data;pioggia_mm;ore_pioggia;tmin;tmax;tmedia;ore_temp');
    eq('CSV: una riga per giorno con dati', lines.length - 1, nrow);
    log(new Set(days).size === days.length && days.every((d, i) => i === 0 || d > days[i - 1]) && days[0] === '2024-10-23', 'CSV: giorni distinti e in ordine', days.slice(0, 3).join(','));
    log(lines.slice(1).every(l => l.split(';').length === 7), 'CSV: sette colonne', '');
    const k = raw.p.findIndex((x, i) => x != null && raw.hp[i] != null && raw.tn[i] != null && raw.tx[i] != null && raw.tn[i] !== raw.tx[i] && raw.tm[i] != null && raw.ht[i] != null);
    const ds = dayOf(k).toISOString().slice(0, 10), row = (lines.find(l => l.startsWith(ds + ';')) || '').split(';');
    eq('CSV: ' + ds + ' uguale al file (pioggia, ore, tmin, tmax, tmedia, ore)', row.slice(1).map(Number), [raw.p[k], raw.hp[k], raw.tn[k], raw.tx[k], raw.tm[k], raw.ht[k]]);
    log(+row[3] < +row[4], 'CSV: tmin < tmax', row.join(';'));

    // link H:VAR:VIEW
    for(const [v, w] of [['PREC', 'mesi'], ['PREC', 'anni'], ['PREC', 'giorni'], ['PREC', 'tabella'], ['TEMP', 'mesi'], ['TEMP', 'anni'], ['TEMP', 'giorni'], ['TEMP', 'tabella']]){
      await setHistMode(false); await open(L);                                       // parte da un'altra stazione, senza Storico
      history.replaceState(null, '', '#VEN/79/' + v + '/H:' + v + ':' + w);
      await applyHash(); await until(() => histMode && (w === 'tabella' ? !!el('hvTable').querySelector('table') : !!histU), 8000); await sleep(300);
      eq('link H:' + v + ':' + w + ' apre la stessa vista', [currentStation && currentStation.scode, histMode, histVar, histView], ['79', true, v, w]);
      if(w === 'tabella') log(!histU && !!el('hvTable').querySelector('table'), 'link H:' + v + ':' + w + ': tabella senza grafico', '');
      else log(!!el('hvChart').querySelector('canvas') && !el('hvChart').querySelector('.hint'), 'link H:' + v + ':' + w + ': grafico disegnato', '');
      eq('link H:' + v + ':' + w + ' riscritto uguale', decodeURIComponent(location.hash), '#VEN/79/' + v + '/H:' + v + ':' + w);
    }
    await setHistMode(false); await open(L);                                          // vista sconosciuta: resta quella di prima, niente errori
    history.replaceState(null, '', '#VEN/79/PREC/H:PREC:zzz'); await applyHash(); await until(() => histMode, 8000); await sleep(300);
    log(histMode && histView === 'tabella' && !!el('hvTable').querySelector('table'), 'link con vista sconosciuta', histView);
    // uscita
    await setHistMode(false);
    log(!histMode && !vis(el('histview')) && !!el('chart').querySelector('canvas'), 'uscendo dallo Storico torna il grafico', '');
    eq('errori JS', window.__errs, []);
    finish();
  }

  // scheda della stazione su due righe: in alto nome, codice e ultimo dato, azioni; sotto variabili e modi (i tre confronti
  // in "Confronti ▾"); nello Storico la sua barra al posto di variabili e modi, in fondo "Storico ×".
  // Desktop (w.html 1024x768): grafico entro 75 px dalla barra delle schede. Telefono (w.html 320/375/430, FVG/A280 con
  // molte variabili): la seconda riga resta una e scorre di lato, niente esce dalla pagina, le azioni restano visibili
  async function suiteSchede(){
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    const R = e => e.getBoundingClientRect(), mid = e => (R(e).top + R(e).bottom) / 2;
    const phone = innerWidth <= 720, fa = () => document.activeElement;
    const st = (reg, sc) => (allFeatures.find(f => f.properties._region === reg && f.properties.scode === sc) || {}).properties;
    const P = st('VEN', '234'), V = st('VEN', '79'), A = st('FVG', 'A280');        // Padova; Valdagno (nel campione dello Storico); Arba
    log(P && V && A, 'stazioni di prova trovate', JSON.stringify([!!P, !!V, !!A]));
    if(!(P && V && A)) return finish();
    const open = async p => { await selectStation(p); await until(() => currentStation === p && !!el('chart').querySelector('canvas'), 8000); await sleep(300); };
    const gap = id => Math.round(R(el(id)).top - R(el('tabbar')).bottom);        // dalla barra delle schede all'inizio del grafico
    const sameRow = es => es.length > 0 && Math.max(...es.map(mid)) - Math.min(...es.map(mid)) <= 6;
    const acts = () => ['refresh', 'download', 'exportpng', 'hvCsv', 'copylink'].filter(id => vis(el(id)));
    // riga 2 tutta sotto la riga 1 (nome, dati, azioni) e tutta sopra il grafico: niente sovrapposizioni
    const stacked = (c, chartId) => { const b1 = Math.max(...[el('stationName'), el('stationMeta'), ...acts().map(el)].map(e => R(e).bottom));
      return Math.min(...c.map(e => R(e).top)) >= b1 - 1 && Math.max(...c.map(e => R(e).bottom)) <= R(el(chartId)).top + 1; };
    // comandi visibili della seconda riga, nell'ordine della pagina (le voci di "Confronti" stanno nel menu chiuso)
    const ctl2 = () => [...document.querySelectorAll('#vars > button, button[data-mode], #cmpBtn, #stackbtn, #histbtn, #hvVar, #hvView, #hvRange')].filter(vis);
    const tag2 = e => e.id || (e.dataset.mode ? 'mode:' + e.dataset.mode : 'var');
    const scroller = () => { for(let e = el('vars'); e && e !== el('panel'); e = e.parentElement) if(/auto|scroll/.test(getComputedStyle(e).overflowX)) return e; return null; };
    const actsOk = (tag, want) => {                                  // dentro lo schermo e non coperte
      const bad = want.filter(id => { const e = el(id); if(!vis(e)) return true;
        const r = R(e), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.left < -0.5 || r.right > innerWidth + 0.5 || !(h && e.contains(h)); });
      eq(tag + ': azioni visibili e intere', bad, []);
    };
    const M = { w:innerWidth, h:innerHeight };
    setMapVar(''); await until(() => filterVar === '');

    // riga 1 e riga 2 (Padova: tre variabili)
    await open(P); await until(() => vis(el('histbtn')), 5000);
    const name = el('stationName'), meta = el('stationMeta');
    log(/^234\b|\b234\b/.test(meta.textContent) && /ultimo dato \S/.test(meta.textContent), 'riga 1: codice e ultimo dato', meta.textContent);
    eq('riga 1: azioni', acts(), ['refresh', 'download', 'exportpng', 'copylink']);
    if(!phone) log(sameRow([name, meta, ...acts().map(el)]), 'riga 1: nome, dati e azioni sulla stessa riga',
                   JSON.stringify([name, meta, ...acts().map(el)].map(e => Math.round(mid(e)))));
    else log(sameRow([name, ...acts().map(el)]) && R(meta).top >= R(name).bottom - 1, 'riga 1 (telefono): nome e azioni, sotto codice e ultimo dato',
             JSON.stringify([name, meta, ...acts().map(el)].map(e => Math.round(mid(e)))));
    const c2 = ctl2();
    eq('riga 2: variabili poi modi', c2.map(tag2), ['var', 'var', 'var', 'mode:week', 'mode:day3', 'mode:day', 'cmpBtn', 'stackbtn', 'histbtn']);
    log(sameRow(c2) && stacked(c2, 'chart'), 'riga 2: tutta su una riga, fra la prima e il grafico',
        JSON.stringify([...new Set(c2.map(e => Math.round(mid(e))))]));
    M.normale = gap('chart');
    if(!phone) log(M.normale <= 75, 'normale: grafico a ' + M.normale + ' px dalla barra delle schede (al massimo 75)', M.normale);

    // "Confronti ▾": un comando, un menu con i tre confronti
    const cb = el('cmpBtn'), cm = el('cmpMenu');
    log(!!cb && !!cm, 'Confronti: un comando con il suo menu', 'assente');
    if(cb && cm){
      const item = m => cm.querySelector('[data-mode="' + m + '"]');
      const esc = () => fa().dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
      const openCmp = async () => { cb.scrollIntoView({ block:'nearest', inline:'nearest' }); await sleep(120); cb.focus(); cb.click(); await sleep(60); };
      log(!vis(cm) && cb.getAttribute('aria-haspopup') === 'menu' && cb.getAttribute('aria-expanded') === 'false' && /Confronti/.test(cb.textContent),
          'Confronti: chiuso all\'inizio', cb.outerHTML.slice(0, 120));
      await openCmp();
      log(vis(cm) && cb.getAttribute('aria-expanded') === 'true', 'Confronti: si apre', '');
      eq('Confronti: le tre voci', [...cm.querySelectorAll('[data-mode]')].map(b => [b.dataset.mode, b.textContent.trim()]),
         [['compare', 'Confronto 7 giorni'], ['compare30', 'Confronto 30 giorni'], ['tabs', 'Confronto schede']]);
      {
        const r = R(cm), b = R(item('tabs')), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        log(cm.contains(hit) && r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
            'Confronti: menu sopra il grafico e dentro lo schermo', JSON.stringify([r.left, r.right, r.bottom, hit && (hit.id || hit.className || hit.tagName)]));
      }
      log(cm.contains(fa()) && fa().dataset.mode === 'compare', 'Confronti: il fuoco entra sulla prima voce', fa() && (fa().dataset.mode || fa().id || fa().tagName));
      fa().dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true }));
      eq('Confronti: freccia giù', fa().dataset.mode, 'compare30');
      fa().dispatchEvent(new KeyboardEvent('keydown', { key:'End', bubbles:true }));
      eq('Confronti: Fine', fa().dataset.mode, 'tabs');
      fa().dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowUp', bubbles:true }));
      eq('Confronti: freccia su', fa().dataset.mode, 'compare30');
      esc(); await sleep(60);
      log(!vis(cm) && fa() === cb && cb.getAttribute('aria-expanded') === 'false', 'Confronti: Esc chiude e il fuoco torna al comando', fa() && (fa().id || fa().tagName));
      await openCmp();
      fa().dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', bubbles:true, cancelable:true }));
      log(!vis(cm) && fa() === cb, 'Confronti: Tab chiude', fa() && (fa().id || fa().tagName));
      await openCmp();
      name.click(); await sleep(60);
      log(!vis(cm), 'Confronti: clic fuori chiude', '');
      if(phone){                                                   // il menu e' fisso: se la riga 2 scorre di lato si chiude
        const sc = scroller(); await openCmp();
        const open0 = vis(cm), s0 = sc.scrollLeft;
        sc.scrollLeft = s0 > 60 ? s0 - 60 : s0 + 60;
        // il browser manda 'scroll' (che non risale ai genitori) al fotogramma dopo; il Chrome headless di run.sh, col tempo
        // virtuale, non disegna altri fotogrammi e non lo manda mai: lo si manda qui, uguale
        sc.dispatchEvent(new Event('scroll')); await sleep(50);
        log(open0 && sc.scrollLeft !== s0 && !vis(cm) && cb.getAttribute('aria-expanded') === 'false', 'telefono: scorrendo la riga 2 il menu si chiude',
            JSON.stringify([open0, s0, sc.scrollLeft, vis(cm)]));
        if(vis(cm)) esc();
        sc.scrollLeft = 0; await sleep(150);
      }
      for(const [m, lab] of [['compare', 'Confronto 7 g'], ['compare30', 'Confronto 30 g']]){
        await openCmp(); item(m).click();
        await until(() => chartMode === m && !!el('chart').querySelector('canvas'), 8000); await sleep(300);
        const others = [...document.querySelectorAll('button[data-mode]')].filter(b => vis(b) && b.classList.contains('active'));
        log(chartMode === m && !vis(cm) && cb.classList.contains('active') && cb.textContent.includes(lab) && !others.length,
            'Confronti: ' + lab + ' scelto, acceso sul comando', [chartMode, vis(cm), cb.className, cb.textContent, others.map(tag2)].join(' | '));
        log(!!chart && chart.series.length > 3, 'Confronti: ' + lab + ': grafico coi giorni sovrapposti', chart && chart.series.length);
        await openCmp();
        eq('Confronti: ' + lab + ' segnato nel menu', [...cm.querySelectorAll('[data-mode]')].map(b => b.classList.contains('on')), [m === 'compare', m === 'compare30', false]);
        esc(); await sleep(60);
      }
      document.querySelector('button[data-mode="week"]').click(); await until(() => chartMode === 'week'); await sleep(200);
      log(!cb.classList.contains('active') && /Confronti/.test(cb.textContent) && document.querySelector('button[data-mode="week"]').classList.contains('active'),
          'Confronti: 7 g lo spegne', cb.className + ' ' + cb.textContent);
      await openCmp(); item('tabs').click();
      await until(() => document.body.classList.contains('view-compare'), 8000); await sleep(300);
      log(document.body.classList.contains('view-compare') && !vis(cm) && el('stationName').textContent === 'Confronto schede',
          'Confronti: "Confronto schede" apre la scheda Confronto', '');
      eq('scheda Confronto: niente Confronti, Impilato, Storico', [vis(cb), vis(el('stackbtn')), vis(el('histbtn'))], [false, false, false]);
      closeCompare(); await sleep(100);
    }

    // Storico: la sua barra nella seconda riga, "Storico ×" in fondo, CSV e Link in alto
    await open(V); await until(() => vis(el('histbtn')), 5000);
    el('histbtn').click(); await until(() => histMode && !!histU, 8000); await sleep(300);
    const hb = el('histbtn');
    log(histMode && vis(hb) && /Storico\s*×/.test(hb.innerText), 'Storico: "Storico ×"', hb.innerText);
    log(![...el('vars').children].some(vis), 'Storico: niente variabili', '');
    eq('Storico: azioni', acts(), ['hvCsv', 'copylink']);
    eq('Storico/Mesi: riga 2', ctl2().map(tag2), ['hvVar', 'hvView', 'histbtn']);
    log(sameRow(ctl2()) && stacked(ctl2(), 'hvChart'), 'Storico: riga 2 su una riga, fra la prima e il grafico', JSON.stringify(ctl2().map(e => Math.round(mid(e)))));
    M.storico = gap('hvChart');
    if(!phone) log(M.storico <= 75, 'Storico (Valdagno): grafico a ' + M.storico + ' px dalla barra delle schede (al massimo 75)', M.storico);
    el('hvView').querySelector('[data-w="giorni"]').click(); await until(() => histView === 'giorni' && !!histU, 8000); await sleep(300);
    eq('Storico/Giorni: riga 2 col periodo', ctl2().map(tag2), ['hvVar', 'hvView', 'hvRange', 'histbtn']);
    log(sameRow(ctl2()) && stacked(ctl2(), 'hvChart'), 'Storico/Giorni: riga 2 su una riga, fra la prima e il grafico', JSON.stringify(ctl2().map(e => Math.round(mid(e)))));
    log(R(hb).left >= Math.max(...ctl2().filter(e => e !== hb).map(e => R(e).right)), 'Storico ×: in fondo alla riga', '');
    if(!phone) log(gap('hvChart') <= 75, 'Storico/Giorni: grafico a ' + gap('hvChart') + ' px (al massimo 75)', gap('hvChart'));
    if(phone){ actsOk('telefono, Storico', ['hvCsv', 'copylink']); noOverflow('telefono, Storico'); }
    hb.click(); await until(() => !histMode && !!el('chart').querySelector('canvas'), 8000); await sleep(300);
    log(!histMode && !vis(el('histview')) && [...el('vars').children].some(vis) && vis(document.querySelector('button[data-mode="week"]')) && !/×/.test(hb.innerText),
        '"Storico ×" esce dallo Storico: tornano variabili e modi', hb.innerText);
    await open(P); await until(() => vis(el('histbtn')), 5000);
    el('histbtn').click(); await until(() => histMode, 8000); await sleep(800);
    M.storico234 = gap('hvChart');                                    // Padova non e' nel campione: barra vera, grafico vuoto
    if(!phone) log(M.storico234 <= 75, 'Storico (Padova): grafico a ' + M.storico234 + ' px dalla barra delle schede (al massimo 75)', M.storico234);
    await setHistMode(false);

    // telefono: Arba (12 variabili) e la stazione dal nome piu' lungo
    if(phone){
      await open(A);
      const c = ctl2(), sc = scroller();
      log(c.length >= 15 && sameRow(c) && stacked(c, 'chart'), 'telefono: riga 2 su una riga sola (' + c.length + ' comandi), fra la prima e il grafico', JSON.stringify([...new Set(c.map(e => Math.round(mid(e))))]));
      log(!!sc && sc.scrollWidth > sc.clientWidth + 20, 'telefono: la riga 2 scorre di lato', sc ? sc.scrollWidth + ' / ' + sc.clientWidth : 'nessuna riga che scorre');
      if(sc){
        const last = c[c.length - 1];
        sc.scrollLeft = sc.scrollWidth; await sleep(150);
        const r = R(last), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        log(r.left >= -0.5 && r.right <= innerWidth + 0.5 && !!h && last.contains(h), 'telefono: scorrendo si arriva all\'ultimo comando', tag2(last) + ' ' + JSON.stringify([r.left, r.right]));
        sc.scrollLeft = 0; await sleep(100);
      }
      actsOk('telefono, Arba', ['refresh', 'download', 'exportpng', 'copylink']);
      noOverflow('telefono, Arba');
      M.telefono = gap('chart');
      const long = allFeatures.map(f => f.properties).filter(p => (p.variables || []).some(v => varCat(v) === currentPage))
                              .reduce((a, p) => prettyName(p.name || p.scode).length > prettyName(a.name || a.scode).length ? p : a);
      await open(long);
      actsOk('telefono, nome lungo (' + prettyName(long.name) + ')', ['refresh', 'download', 'exportpng', 'copylink']);
      noOverflow('telefono, nome lungo');
      log(stacked(ctl2(), 'chart'), 'telefono, nome lungo: riga 2 fra la prima e il grafico', '');
      log(name.scrollWidth <= name.clientWidth + 1, 'telefono, nome lungo: nome intero (va a capo, non tagliato)', JSON.stringify([name.scrollWidth, name.clientWidth]));
      log(vis(meta) && R(meta).left >= -0.5 && R(meta).right <= innerWidth + 0.5, 'telefono, nome lungo: codice e ultimo dato dentro lo schermo',
          JSON.stringify([R(meta).left, R(meta).right, innerWidth]));
    }
    showMapView();
    eq('errori JS', window.__errs, []);
    finish('MISURE ' + JSON.stringify(M));
  }

  const suite = new URLSearchParams(location.search).get('suite') || 'radar';
  ready().then(() => ({ cursor:suiteCursor, radar:suiteRadar, hash:suiteHash, layout:suiteLayout, resilience:suiteResilience, prodotti:suiteProdotti,
            dock:suiteDock, buffer:suiteBuffer, oralegale:suiteOraLegale, search:suiteSearch, hover:suiteHover,
            hoverradar:suiteHoverRadar, stazione:suiteStazione, storico:suiteStorico, schede:suiteSchede })[suite]())
         .catch(e => { log(false, 'eccezione', e && e.stack || e); finish(); });
})();
