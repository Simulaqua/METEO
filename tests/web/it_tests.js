// Prove integrate della pagina vera (copiata da build_it.py in it_local.html / it_live.html, NON pubblicate).
// Suite scelta con ?suite=cursor|radar|hash. Esito in #out ("RISULTATO: n/n"; la suite cursor stampa anche
// una riga JSON da confrontare prima/dopo il refactoring del Cursore).
(() => {
  // ogni esito va subito in #out, nascosto fino alla fine (non deve coprire la pagina): se la prova si ferma,
  // run.sh lo legge lo stesso e si sa dove
  const res = [], log = (ok, name, info) => {
    res.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ': ' + info));
    const o = document.getElementById('out');
    if(o){ o.style.display = 'none'; o.textContent = res.join('\n') + '\n(in corso)'; }
  };
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
    const o = document.getElementById('out');
    o.style.display = '';
    o.textContent = (extra ? extra + '\n' : '') + res.join('\n') + '\nRISULTATO: ' + ok + '/' + res.length;
  };
  // clic DOM vero nel punto della mappa (passa dal renderer canvas dei puntini, come un dito)
  function clickAt(latlng){
    const p = map.latLngToContainerPoint(latlng), r = map.getContainer().getBoundingClientRect();
    const x = r.left + p.x, y = r.top + p.y, t = document.elementFromPoint(x, y);
    ['mousedown', 'mouseup', 'click'].forEach(type =>
      t.dispatchEvent(new MouseEvent(type, { clientX:x, clientY:y, bubbles:true, cancelable:true, view:window })));
  }
  // scelta dal menu delle variabili, come la fa chi usa la pagina (RADAR accende o spegne il radar)
  async function pickVarMenu(v){
    el('varPill').click(); await sleep(50);
    const b = el('pillMenu').querySelector('[data-v="' + v + '"]');
    if(b) b.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' }));
    await sleep(50);
  }
  // nomi scritti sopra gli assi del grafico della stazione
  const axisNames = () => chart ? chart.axes.flatMap(a => (a.names || []).map(n => n.text)) : [];
  // controlli in alto a destra sulla mappa, dall'alto (sul telefono lo zoom c'e' ma e' nascosto)
  const rightCol = () => [...document.querySelectorAll('.leaflet-top.leaflet-right > .leaflet-control')].map(c =>
    c.classList.contains('leaflet-control-zoom') ? 'zoom' : c.classList.contains('leaflet-control-layers') ? 'sfondo'
    : c.contains(el('mcRadar')) ? 'radar' : c.className);
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

  // il CSV dal menu Esporta, come lo sceglie chi usa la pagina
  async function exportCsv(){
    el('expBtn').click(); await sleep(60);
    el('expMenu').querySelector('[data-act="csv"]').click(); await sleep(200);
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
    const btn = el('varPill');
    log(varMenuItems().some(it => it.v === 'RADAR'), 'voce Radar nel menu delle variabili', 'assente');
    const rawIdx = await (await fetch('https://raw.githubusercontent.com/Simulaqua/METEO/radar/index.json', { cache:'no-store' })).json();
    const fr = rawIdx.products.SRI.frames, age = Math.round((Date.now() / 1000 - fr[fr.length - 1]) / 60);
    setMapVar('TEMP');                                 // variabile di partenza da ripristinare
    await until(() => filterVar === 'TEMP');
    await pickVarMenu('RADAR');
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
    // i puntini seguono il radar fino all'ultima ora delle stazioni, anche se non e' ancora completa: ogni
    // stazione col suo valore appena arriva, grigia finche' manca
    await until(() => snap.T.length);
    {
      const keep = { T:snap.T, k0:snap.k0, kmax:snap.kmax };
      Object.assign(snap, { T:[0, 3600, 7200, 10800], k0:0, kmax:1 });
      const got = [snapIndexAt(5000), snapIndexAt(10800), snapIndexAt(99999)];
      Object.assign(snap, keep);
      eq('ora delle stazioni per un istante del radar, oltre l\'ultima ora completa', got, [1, 3, 3]);
    }
    const civR = Radar.source.civ(Radar.source.max());
    eq('all\'ultimo fotogramma: l\'ultima ora delle stazioni non dopo il radar', snap.k,
       snap.T.reduce((a, t, j) => j >= snap.k0 && t <= civR ? j : a, -1));
    log(staT() === fmtFrame(snap.T[snap.k]).slice(-5), 'etichetta = ora usata dai puntini', staT() + ' k=' + snap.k);
    log(el('colorbar').textContent.includes('Pioggia adesso') && el('colorbar').textContent.includes('mm/h') &&
        el('colorbar').contains(el('mcStations')), 'legenda unica radar/stazioni', el('colorbar').textContent);
    eq('a destra: zoom, sfondo e Radar', rightCol(), ['zoom', 'sfondo', 'radar']);
    eq('pillola: Radar', [btn.textContent.trim(), btn.classList.contains('on')], ['Radar', true]);
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
    log(Radar.state === 'zoom' && btn.classList.contains('dim') && /zoom 10/.test(btn.title) && el('mcRadar').classList.contains('dim'),
        'zoom 11: nascosto, pillola e pulsante Radar attenuati',
        Radar.state + ' ' + btn.title);
    map.setZoom(8); await sleep(300);
    log(Radar.state !== 'zoom' && !btn.classList.contains('dim'), 'zoom 8: di nuovo visibile', Radar.state);
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
    const ref = markerRefs.find(r => {                    // un puntino che si vede: non sotto la plancia o la barra
      if(!map.getBounds().contains(r.m.getLatLng())) return false;
      const p = map.latLngToContainerPoint(r.m.getLatLng()), t = document.elementFromPoint(rect.left + p.x, rect.top + p.y);
      return !!t && t.tagName === 'CANVAS';
    });
    clickAt(ref.m.getLatLng()); await sleep(400);
    log(!document.querySelector('.leaflet-popup') && selectedKey && selectedKey !== before && Radar.on, 'tocco su puntino = stazione',
        'popup ' + !!document.querySelector('.leaflet-popup') + ', stazione ' + selectedKey + ', radar ' + Radar.on);
    // chiudi la stazione: col selettore ristretto alle sue variabili i passi dopo dipenderebbero da quale puntino si e' toccato
    el('stationFilter').value = ''; el('stationFilter').dispatchEvent(new Event('change'));
    await until(() => !selectedKey);
    // la x chiude la barra, il radar resta acceso e torna all'ultimo
    el('tsClose').click(); await sleep(200);
    log(!snap.on && Radar.on, 'x chiude la barra, radar resta acceso', snap.on + ' ' + Radar.on);
    el('dkTime').click(); await until(() => snap.on && tsSrc === Radar.source);
    eq('Cursore riaperto in modo radar', tsSrc === Radar.source, true);
    // un'altra variabile spegne il radar; la barra (aperta dal radar) si chiude
    setMapVar('UMID'); await until(() => !Radar.on);
    log(!Radar.on && !snap.on && tsSrc === snapSource, 'altra variabile spegne il radar e chiude la barra', Radar.on + ' ' + snap.on);
    // acceso e spento dal pulsante: torna la variabile di prima
    await pickVarMenu('RADAR'); await until(() => Radar.on && filterVar === 'PREC1');
    await pickVarMenu('RADAR'); await until(() => !Radar.on && filterVar === 'UMID');
    log(filterVar === 'UMID', 'spento: torna la variabile di prima',
        'filterVar "' + filterVar + '", pagina ' + currentPage + ', UMID nel selettore ' + [...el('varFilter').options].some(o => o.value === 'UMID') +
        ', avviso "' + el('toast').textContent + '", prevVar "' + radarUi.prevVar + '", busy ' + radarUi.busy + ', snap.on ' + snap.on);
    // Cursore delle stazioni aperto prima del radar: spento il radar si torna ai 7 giorni
    setMapVar('PREC24'); await until(() => filterVar === 'PREC24');
    await openSlider(); await until(() => snap.on && snap.var === 'PREC24');
    await pickVarMenu('RADAR'); await until(() => Radar.on && tsSrc === Radar.source);
    await pickVarMenu('RADAR'); await until(() => !Radar.on && filterVar === 'PREC24' && snap.on && snap.var === 'PREC24');
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
    const noradar = new URLSearchParams(location.search).get('noradar');
    if(noradar){ setMapVar('PREC24'); await until(() => filterVar === 'PREC24'); }           // confronto: solo stazioni
    else { await pickVarMenu('RADAR'); await until(() => Radar.on && snap.on, 20000); }
    await sleep(800);
    const dock = el('dock'), phone = innerWidth <= 720;
    log(!!dock, 'plancia', 'assente');
    if(!dock) return finish();
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
    function check(tag){
      const sels = { zoom:'.leaflet-control-zoom', sfondo:'.leaflet-control-layers', radar:'.mapctl', plancia:'#dock',
                     barra:'#topbar' };
      const R = {};
      for(const k in sels){
        const e = document.querySelector(sels[k]);
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
    log(noradar || Radar.on, 'radar acceso', '');
    eq('a destra: zoom, sfondo e Radar', rightCol(), ['zoom', 'sfondo', 'radar']);
    {                                                         // in alto una scheda sola: ricerca e pulsanti dentro
      const tb = el('topbar').getBoundingClientRect(), box = r => [r.left, r.top, r.right, r.bottom].map(Math.round);
      const q = el('stationQ').getBoundingClientRect(), pr = el('pillRow').getBoundingClientRect();
      log(getComputedStyle(el('topbar')).backgroundColor !== 'rgba(0, 0, 0, 0)' && inside(q, tb) && inside(pr, tb),
          'barra in alto: una scheda con ricerca e pulsanti', JSON.stringify([box(tb), box(q), box(pr)]));
    }
    log(vis(el('dkTime')) && dock.contains(el('dkTime')) && el('dkTime').getAttribute('aria-pressed') === String(snap.on),
        '«Ora» nella plancia', el('dkTime') && el('dkTime').outerHTML.slice(0, 80));
    if(!phone){
      check('');
      log(!vis(el('dkToggle')) && !dock.classList.contains('min'), 'desktop: plancia sempre aperta', dock.className);
    } else {
      log(!vis(document.querySelector('.leaflet-control-zoom')), 'telefono: niente +/−', '');
      const pa = el('varPill').getBoundingClientRect(), pb = el('regPill').getBoundingClientRect();
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
    log(!vis(el('colorbar')) && vis(el('dkTime')) && vis(document.querySelector('.leaflet-control-attribution')),
        'nessuna variabile: «Ora» e crediti', dock.className);
    el('dkTime').click(); await until(() => snap.on && snap.T.length, 20000);    // il Cursore sceglie la pioggia
    log(snap.on && isRain(filterVar) && el('dkTime').getAttribute('aria-pressed') === 'true', '«Ora» apre il Cursore',
        filterVar + ' ' + snap.on);
    el('dkTime').click(); await sleep(200);
    log(!snap.on && el('dkTime').getAttribute('aria-pressed') === 'false', '«Ora» lo richiude', snap.on);
    {                              // Radar a vista a destra sotto zoom e sfondo: un clic lo accende, un altro lo spegne
      const rb = el('mcRadar');
      log(vis(rb) && !dock.contains(rb) && rightCol().join() === 'zoom,sfondo,radar' && rb.textContent.includes('Radar'),
          'pulsante Radar a vista a destra, sotto lo sfondo', rb && rb.outerHTML.slice(0, 60));
      const v0 = filterVar;
      rb.click(); await until(() => Radar.on && snap.on, 20000);
      log(Radar.on && rb.getAttribute('aria-pressed') === 'true', 'Radar: un clic lo accende', Radar.state);
      rb.click(); await until(() => !Radar.on, 10000);
      log(!Radar.on && rb.getAttribute('aria-pressed') === 'false' && filterVar === v0, 'Radar: un altro clic lo spegne', filterVar);
    }
    await pickVarMenu('PREC'); await until(() => filterVar === 'PREC');
    log(el('varPill').classList.contains('on') && el('varPill').textContent.includes(varLabel('PREC')), 'pioggia dal menu',
        el('varPill').textContent);
    log(vis(el('colorbar')) && el('dkProd').textContent.includes(varLabel(filterVar)), 'legenda col nome della variabile', el('colorbar').textContent);
    el('dkProd').click(); await sleep(100);
    const items = [...document.querySelectorAll('#prodMenu [data-v]')];
    eq('menu: oggi e finestre di pioggia', items.map(b => b.dataset.v), ['PREC'].concat(RAIN_VARS));
    eq('menu: etichette', items.map(b => b.textContent), ['oggi', '1 h', '3 h', '6 h', '12 h', '24 h', '48 h']);
    const pick = document.querySelector('#prodMenu [data-v="PREC6"]');
    if(pick) pick.click();
    await until(() => filterVar === 'PREC6');
    eq('scelta 6 h', filterVar, 'PREC6');
    log(!vis(el('prodMenu')), 'menu chiuso dopo la scelta', '');
    setMapVar('TEMP'); await until(() => filterVar === 'TEMP');
    log(el('colorbar').textContent.includes(varLabel('TEMP')), 'temperatura: legenda', el('colorbar').textContent);
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
    log(varMenuItems().some(it => it.v === 'RADAR'), 'voce Radar nel menu', '');
    const v0 = filterVar;
    await pickVarMenu('RADAR'); await sleep(300);
    log(el('toast').textContent.includes('Radar non disponibile') && filterVar === v0, 'clic: avviso e nient\'altro', el('toast').textContent);
    el('toast').textContent = ''; el('mcRadar').click(); await sleep(300);
    log(el('toast').textContent.includes('Radar non disponibile') && el('mcRadar').classList.contains('dim'),
        'pulsante Radar: grigio e avviso', el('toast').textContent);
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
    await pickVarMenu('RADAR');
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
    await pickVarMenu('RADAR'); await until(() => Radar.on && Radar.product);
    eq('prodotto ricordato', Radar.product.key, 'VMI');
    eq('errori JS', window.__errs, []);
    finish();
  }

  // caricamento del radar: il play aspetta il fotogramma non ancora scaricato; sul cursore la striscia del gia' scaricato
  async function suiteBuffer(){
    await pickVarMenu('RADAR');
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
    eq('asse: a mezzanotte (CEST e CET) l\'ora 0, il giorno sta sotto', [hourTxt(U(10, 24, 22, 0)), hourTxt(U(10, 25, 23, 0))], ['0', '0']);
    eq('asse: le 2 della seconda volta', hourTxt(U(10, 25, 1, 0)), '2');
    {                                                  // il 25/10 dura 25 ore: il suo nome sta a meta' delle sue 25
      const sp = daySplits(null, 0, U(10, 24, 22, 0), U(10, 26, 23, 0));
      eq('asse: un giorno sotto ciascun giorno, anche quello di 25 ore', sp, [(U(10, 24, 22, 0) + U(10, 25, 23, 0)) / 2,
         (U(10, 25, 23, 0) + U(10, 26, 23, 0)) / 2]);
    }
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

    const m = mainModel({ _table: t, scode: 'T', _region: 'VEN' }, ['TEMP'], 'week');
    log(m.data[0].every((x, i) => i === 0 || x > m.data[0][i - 1]), 'grafico: tempo sempre crescente', JSON.stringify(m.data[0]));
    eq('grafico: valori nell\'ordine giusto', m.data[1], temps);

    const mids = [], fake = { scales: { x: { min: U(10, 24, 12, 0), max: U(10, 26, 12, 0) } }, valToPos: v => v, width: 1,
                              bbox: { left: 0, top: 0, width: 10, height: 10 }, _ll: [45.4, 11.9],
                              ctx: { canvas: { width: 1 }, save(){}, restore(){}, beginPath(){}, rect(){}, clip(){}, fillRect(){},
                                     lineTo(){}, stroke(){}, moveTo(x){ mids.push(x - 0.5); } } };
    nightBands(fake);
    eq('linee della mezzanotte italiana: il 25/10 dura 25 ore', mids, [U(10, 24, 22, 0), U(10, 25, 23, 0)]);

    // etichette civili scritte dal browser (Europe/Rome), indipendenti dal codice della pagina
    const civLab = s => new Date(s * 1000).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 16).replace(' ', 'T');
    const rows = []; for(let s = U(10, 24, 10, 0); s <= U(10, 26, 11, 0); s += 3600) rows.push(civLab(s) + ',' + ((s / 3600) % 7));
    const m2 = mainModel({ _table: parseCSV('datetime,TEMP\n' + rows.join('\n')), scode: 'T', _region: 'VEN' }, ['TEMP'], 'week');
    const host = document.createElement('div'); document.body.appendChild(host);
    const u = new uPlot(mainOpts(m2, { w: 900, h: 300 }), m2.data, host);
    await sleep(50);                                                   // uPlot disegna (e calcola le etichette) dopo un microtask
    const labs = (u.axes[1]._values || []).filter(Boolean);
    log(labs.some(t => / 25$/.test(t)) && labs.some(t => / 26$/.test(t)), 'asse: sotto le ore i giorni 25 e 26', JSON.stringify(labs));
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
    eq('pillole: niente pagina, la variabile basta', [...['regPill', 'varPill', 'srcinfo', 'noteBtn', 'moreBtn']
       .map(id => vis(el(id))), !!el('pgPill')], [true, true, true, true, true, false]);
    {                                                                // Note: la "i" fra Fonti e ⋯, un clic e si leggono
      const b = el('noteBtn'), row = [...el('pillRow').children].map(e => e.id);
      eq('Note: chip "i" fra Fonti e ⋯', [b.textContent.trim(), b.getAttribute('aria-label'), row.indexOf('noteBtn') - row.indexOf('srcinfo'),
                                          row.indexOf('moreBtn') - row.indexOf('noteBtn')], ['i', 'Note', 1, 1]);
      eq('menu ⋯: tema e azzera (niente Note, sfondi a destra)', [...el('moreMenu').querySelectorAll('button')]
         .map(x => x.textContent.trim()), ['Tema scuro', 'Azzera i filtri']);
      b.click(); await sleep(50);
      const n = el('notepanel'), r = n.getBoundingClientRect();
      eq('Note: un clic le apre', [getComputedStyle(n).display, b.getAttribute('aria-expanded')], ['block', 'true']);
      eq('Note: a voci', [...n.querySelectorAll('dt')].map(x => x.textContent.trim()), ['Progetto', 'Dati', 'Elaborazioni', 'Allerte']);
      log(r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, 'Note: dentro lo schermo',
          JSON.stringify([r.left, r.right, r.bottom].map(Math.round)));
      b.click(); await sleep(50);
      eq('Note: un secondo clic le chiude', [getComputedStyle(n).display, b.getAttribute('aria-expanded')], ['none', 'false']);
    }
    {                                                                // computer: pillole sulla riga della ricerca (piu' mappa); telefono: sotto
      const q = el('stationQ').getBoundingClientRect(), p = el('pillRow').getBoundingClientRect(), mid = r => (r.top + r.bottom) / 2;
      const box = r => [r.left, r.top, r.right, r.bottom].map(Math.round);
      if(innerWidth >= 900) log(Math.abs(mid(q) - mid(p)) <= 3 && p.left >= q.right && el('topbar').getBoundingClientRect().height <= 46,
                                'computer: pillole sulla riga della ricerca', JSON.stringify([box(q), box(p)]));
      const cut = id => { const sp = el(id).querySelector('span'); return sp.scrollWidth - sp.clientWidth; };
      if(innerWidth >= 1000) eq('computer: nomi interi e ricerca larga 280 px',
                                [cut('varPill'), cut('regPill'), Math.round(document.querySelector('.tb-q').getBoundingClientRect().width)],
                                [0, 0, 280]);
      else if(innerWidth <= 720) log(p.top >= q.bottom, 'telefono: pillole sotto la ricerca', JSON.stringify([box(q), box(p)]));
      eq('pulsanti interi, nessuno schiacciato', ['noteBtn', 'moreBtn'].map(id => el(id).getBoundingClientRect().width >= 30),
         [true, true]);
    }
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
    const allVars = items().map(b => b.dataset.v);
    const heads = [...el('pillMenu').querySelectorAll('.pm-h')].map(h => h.textContent);
    eq('menu variabili: un solo elenco a gruppi per tema',
       ['Temperatura e umidità', 'Pioggia e neve', 'Vento'].map(h => heads.indexOf(h) >= 0), [true, true, true]);
    log(heads.indexOf('Temperatura e umidità') < heads.indexOf('Vento') && allVars[allVars.length - 1] === 'RADAR',
        'menu variabili: gruppi in ordine, Radar in fondo', JSON.stringify([heads, allVars.slice(-2)]));
    {
      const h0 = el('pillMenu').querySelector('.pm-h'), it0 = el('pillMenu').querySelector('[data-v="TEMP"]'), cs = getComputedStyle(h0);
      log(cs.color !== getComputedStyle(it0).color && +cs.fontWeight >= 700 && cs.textTransform === 'uppercase' && cs.borderTopWidth !== '0px',
          'menu variabili: titoli dei gruppi in evidenza', JSON.stringify([cs.color, cs.fontWeight, cs.textTransform, cs.borderTopWidth]));
    }
    log(allVars[0] === '' && ['TEMP', 'TAPP', 'PREC24', 'RADAR'].every(v => allVars.includes(v)),
        'menu variabili: misure, derivate, indici e radar insieme', JSON.stringify(allVars.slice(0, 14)));
    items().find(b => b.dataset.v === 'TEMP').click(); await until(() => filterVar === 'TEMP');
    log(el('varPill').textContent.includes(varLabel('TEMP')) && el('varPill').classList.contains('on'), 'variabile scelta', el('varPill').textContent);
    el('varPill').click(); await sleep(50);                          // la scelta non accorcia il suo stesso elenco
    eq('menu variabili: dopo una scelta l\'elenco resta intero', [items().map(b => b.dataset.v), items().every(vis)],
       [allVars, true]);
    items().find(b => b.dataset.v === 'TAPP').click();               // una derivata: la pagina segue da sola
    await until(() => filterVar === 'TAPP');
    eq('derivata dal menu: pagina e pillola', [currentPage, el('varPill').textContent.trim()],
       ['derivate', varLabel('TAPP')]);
    {                                         // nomi lunghi: tutti i pulsanti restano nella scheda (anche sul tablet)
      const T = el('topbar').getBoundingClientRect();
      const out = [...el('pillRow').children].filter(vis).filter(c => { const r = c.getBoundingClientRect();
        return r.left < T.left - 0.5 || r.right > T.right + 0.5; });
      eq('barra: i pulsanti stanno nella scheda a ' + innerWidth + ' px', out.map(c => c.id || c.className), []);
    }
    {                                         // senza variabile tutte le stazioni, qualunque pagina sia rimasta
      const keep = [currentPage, filterVar];
      filterVar = '';
      currentPage = 'dirette';
      const all = stationsForList().length;
      currentPage = 'indici';
      const left = stationsForList().length;
      [currentPage, filterVar] = keep;
      eq('senza variabile: tutte le stazioni, anche con la pagina rimasta indietro', left, all);
    }
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
    const regs = [...el('region').options].map(o => o.value), rk = regs.indexOf('FVG');
    el('regPill').focus(); el('regPill').click(); await sleep(50);
    log(el('pillMenu').contains(fa()) && fa().dataset.v === 'FVG', 'menu: il fuoco va sulla voce scelta', fa() && (fa().dataset.v || fa().id || fa().tagName));
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true }));
    eq('menu: freccia giù', fa().dataset.v, regs[rk + 1]);
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowUp', bubbles:true }));
    eq('menu: freccia su', fa().dataset.v, 'FVG');
    fa().click(); await sleep(50);
    log(!vis(el('pillMenu')) && fa() === el('regPill'), 'menu: dopo la scelta il fuoco torna sulla pillola', fa() && (fa().id || fa().tagName));
    el('regPill').click(); await sleep(50);
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', bubbles:true, cancelable:true }));
    log(!vis(el('pillMenu')) && fa() === el('regPill'), 'menu: Tab lo chiude e riparte dalla pillola', fa() && (fa().id || fa().tagName));
    log([...el('pillMenu').querySelectorAll('[data-v]'), ...el('moreMenu').querySelectorAll('button')].every(b => b.tabIndex === -1),
        'menu: le voci si raggiungono con le frecce, Tab esce subito', '');
    el('moreBtn').click(); await sleep(50);
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', shiftKey:true, bubbles:true, cancelable:true }));
    log(!vis(el('moreMenu')) && fa() === el('moreBtn'), 'menu ⋯: Maiusc+Tab lo chiude e torna su ⋯', fa() && (fa().id || fa().tagName));
    el('regPill').click(); await sleep(50);
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'/', bubbles:true, cancelable:true }));
    log(!vis(el('pillMenu')) && fa() === el('stationQ'), '"/" da un menu aperto: chiude e va alla ricerca', fa() && (fa().id || fa().tagName));
    el('stationQ').blur();
    eq('pillole con nome accessibile', ['regPill', 'varPill'].map(id => (el(id).getAttribute('aria-label') || '').split(':')[0]), ['Regione', 'Variabile']);
    el('moreBtn').click(); await sleep(50);
    const dark0 = document.body.classList.contains('dark'); el('themeBtn').click();
    log(document.body.classList.contains('dark') !== dark0, '⋯ → tema', ''); el('moreBtn').click(); el('themeBtn').click();
    {                                                 // sfondo: a destra sotto lo zoom, non nel menu ⋯; ricordato
      const lay = document.querySelector('.leaflet-control-layers');
      const bg = n => [...(lay ? lay.querySelectorAll('label') : [])].find(l => l.textContent.trim() === n);
      log(!!bg('Satellite') && !el('moreMenu').textContent.includes('Sfondo'), 'sfondo a destra, non nel menu ⋯',
          el('moreMenu').textContent.trim());
      if(bg('Satellite')){
        bg('Satellite').querySelector('input').click(); await sleep(100);
        let saved = null; try { saved = localStorage.getItem('basemap'); } catch(e){}
        log(saved === 'Satellite' && [...document.querySelectorAll('.leaflet-tile-pane img')].some(i => /World_Imagery/.test(i.src)),
            'sfondo Satellite, ricordato', saved);
        bg('Mappa').querySelector('input').click(); await sleep(100);
      }
    }
    el('moreBtn').click(); el('resetBtn').click(); await until(() => el('region').value === 'ALL' && !filterVar, 20000);
    eq('⋯ → azzera i filtri', [el('regPill').textContent.trim(), el('varPill').textContent.trim()],
       [PHONE.matches ? 'Tutte' : 'Tutte le regioni', 'Tutte le variabili']);
    await ready();
    el('varPill').click(); await sleep(50);                                 // elenco lungo: campo per filtrare, senza accenti
    const flt = el('pillMenu').querySelector('.pm-filter');
    log(!!flt && items().length > 12, 'menu lungo: filtro', items().length);
    if(flt){
      flt.value = 'umidita'; flt.dispatchEvent(new Event('input')); await sleep(30);
      const shown = items().filter(vis).map(b => b.dataset.v);
      log(shown.includes('UMID') && !shown.includes('TEMP'), 'filtro: "umidita" trova Umidità', JSON.stringify(shown));
      eq('filtro: solo i gruppi con voci', [...el('pillMenu').querySelectorAll('.pm-h')].filter(vis).map(h => h.textContent),
         ['Temperatura e umidità']);
    }
    items().find(b => b.dataset.v === '').click();
    await until(() => !filterVar && currentPage === 'dirette');
    eq('«Tutte le variabili» torna alle misure dirette', [filterVar, currentPage], ['', 'dirette']);
    setMapVar('PREC24'); await until(() => filterVar === 'PREC24');                         // scelta da un'altra parte
    eq('la pillola segue la variabile', el('varPill').textContent.trim(), varLabel('PREC24'));
    setMapVar(''); await until(() => !filterVar);
    history.replaceState(null, '', '#FVG/A280/TAPP'); await applyHash();
    eq('link a una derivata: la mappa resta alle misure dirette', currentPage, 'dirette');

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
    {                  // tornati alla mappa con la stazione aperta il menu resta intero e ogni voce si sceglie
      const all = new Set(allFeatures.flatMap(f => f.properties.variables || []));
      const menu = varMenuItems().filter(it => it.v && it.v !== 'RADAR');
      eq('menu intero anche con una stazione aperta', [!!selectedKey, menu.length], [true, all.size]);
      const v = [...all].find(x => varCat(x) === 'dirette' && !(currentStation.variables || []).includes(x));
      pickMapVar(v); await until(() => filterVar === v, 3000);
      eq('voce che la stazione non ha: scelta', filterVar, v);
      pickMapVar(''); await until(() => !filterVar);
    }
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
    {                                                 // freccia del vento: la sigla e' la provenienza, la freccia va dove va il vento
      const probe = html => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden';
        d.innerHTML = html; document.body.appendChild(d);
        const w = d.querySelector('.wdir'), ar = w && w.querySelector('.wd-ar'), m = ar && getComputedStyle(ar).transform;
        const ang = m && m !== 'none' ? Math.round((Math.atan2(+m.slice(7).split(',')[1], +m.slice(7).split(',')[0]) * 180 / Math.PI + 360) % 360) : 0;
        const r = [w && w.firstChild.textContent, ang, w && w.title, w && w.getAttribute('aria-label'), ar && ar.textContent.trim().length > 0, d.textContent];
        d.remove(); return r; };
      eq('freccia: helper unico', typeof windDirHtml, 'function');
      if(typeof windDirHtml === 'function'){
        eq('freccia: 0 gradi = da N, giu', probe(windDirHtml(0)).slice(0, 4), ['N', 0, 'vento da N', 'vento da N']);
        eq('freccia: 90 gradi = da E, a sinistra', probe(windDirHtml(90)).slice(0, 4), ['E', 90, 'vento da E', 'vento da E']);
        eq('freccia: 225 gradi = da SO, in alto a destra', probe(windDirHtml(225)).slice(0, 4), ['SO', 225, 'vento da SO', 'vento da SO']);
        eq('freccia: gradi esatti, non il settore', probe(windDirHtml(100)).slice(0, 3), ['E', 100, 'vento da E']);
        eq('freccia: -45 e 360+45', [probe(windDirHtml(-45))[0], probe(windDirHtml(405))[0], probe(windDirHtml(-45))[1]], ['NO', 'NE', 315]);
        log(probe(windDirHtml(135))[4], 'freccia: un segno visibile', '');
      }
      const kv = K.find(k => k.v === 'VVENTO'), host = document.createElement('div'); host.innerHTML = cardHtml(cardModel(P));
      const w = host.querySelector('.hc-keys .wdir');
      log(!!w && w.firstChild.textContent === 'SE' && w.title === 'vento da SE' && /^12 /.test(host.querySelector('.hc-keys b').parentNode.nextSibling.querySelector('b').textContent), 'freccia: nella scheda (vento 12, da SE)', host.querySelector('.hc-keys') && host.querySelector('.hc-keys').innerHTML);
      log(!!kv && !/undefined|\[object/.test(kv.text), 'freccia: testo semplice intatto', kv && kv.text);
      const xs = Array.from({ length:12 }, (_, i) => 1794700000 + i * 600), save = currentStation;     // 12 osservazioni da E
      const cs = { header:['datetime', 'DVENTO', 'VVENTO'], x:xs, cols:{ DVENTO:Array(12).fill(90), VVENTO:Array(12).fill(3) } };
      currentStation = { _table: cs }; updateWindRose();
      const g = el('windrose').querySelector('svg g'), ln = g && g.querySelector('line'), tt = g ? g.querySelector('title').textContent : '';
      currentStation = save; updateWindRose();
      log(!!ln && / da E;/.test(tt) && +ln.getAttribute('x2') > +ln.getAttribute('x1') + 10 && Math.abs(+ln.getAttribute('y2') - +ln.getAttribute('y1')) < 1,
          'rosa dei venti: freccia del vento medio verso la provenienza (E), "da E" al passaggio', tt + ' ' + (ln && ln.outerHTML));
    }
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
      { const t = document.createElement('div'); let bad = 0, n = 0;
        markerRefs.forEach(r => { t.innerHTML = cardHtml(cardModel(r.p)); t.querySelectorAll('.wdir').forEach(w => { n++; if(w.title !== 'vento da ' + w.firstChild.textContent || !w.querySelector('.wd-ar')) bad++; }); });
        log(bad === 0 && n > 0, 'freccia: ogni direzione ha il suo "vento da"', n + ' viste, ' + bad + ' storte'); }
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
      const pg = el('regPill').getBoundingClientRect(), [x, y] = scr(A);
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
    {                                                  // direzione del vento al cursore: sigla e freccia ruotata, "vento da"
      const W = allFeatures.map(f => f.properties).find(p => (p.variables || []).includes('DVENTO') && hasVal(p.latest || {}, 'DVENTO'));
      log(!!W, 'stazione con direzione del vento trovata', '');
      if(W){
        await selectStation(W); await until(() => currentStation === W); await sleep(800); drawVar('DVENTO');
        await until(() => chart && chart._labs, 6000);
        const k = chart.data[1].findIndex(v => v != null);
        chart.setCursor({ left: chart.valToPos(chart.data[0][k], 'x'), top: 20 }); await sleep(150);
        const w = chart._labs.querySelector('.wdir'), deg = chart.data[1][k], n = _dirName(deg);
        log(!!w && w.firstChild.textContent === n && w.title === 'vento da ' + n && w.getAttribute('aria-label') === w.title,
            'direzione al cursore: sigla, "vento da"', chart._labs.innerHTML.slice(0, 300));
        showMapView();
      }
    }
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
    await pickVarMenu('RADAR'); await until(() => Radar.on && snap.on && el('dkProd') && snap.var === 'PREC1', 20000);
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

  async function suiteStazione(){                     // apertura, riga delle variabili, "+" e assi, Impilate, Altro, link, cursore, PNG
    const has = (p, v) => (p.variables || []).includes(v), phone = innerWidth <= 720;
    const pick = test => (allFeatures.find(f => test(f.properties)) || {}).properties;
    const A = pick(p => ['TEMP', 'UMID', 'PREC', 'PRESS', 'TDEW'].every(v => has(p, v)));
    const A2 = pick(p => has(p, 'TEMP') && has(p, 'UMID') && p !== A);
    const B = pick(p => !has(p, 'TEMP') && has(p, 'PREC'));
    const C = pick(p => !has(p, 'TEMP') && !has(p, 'PREC') && has(p, 'LIVIDRO'));
    const D = pick(p => !has(p, 'TEMP') && !has(p, 'PREC') && !has(p, 'LIVIDRO') && (p.variables || []).some(v => varCat(v) === 'dirette'));
    log(A && A2 && B && C && D, 'stazioni di prova trovate', JSON.stringify([!!A, !!A2, !!B, !!C, !!D]));
    if(!(A && A2 && B && C && D)) return finish();
    const open = async p => { await selectStation(p); await until(() => currentStation === p); await sleep(200); return currentVar; };
    const row = () => [...el('vars').querySelectorAll('.vn')].map(e => e.dataset.var);
    const mainNow = () => stationVars.filter(v => isMainVar(v, stationVars)).sort(byVarOrder);
    const rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)).join(', ') + ')';
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    setMapVar(''); await until(() => filterVar === '');
    eq('si apre sulla temperatura', await open(A), 'TEMP');
    eq('senza temperatura: la precipitazione', await open(B), 'PREC');
    eq('senza temperatura né precipitazione: il livello idrometrico', await open(C), 'LIVIDRO');
    const d = await open(D);
    eq('altrimenti la prima della riga', d, mainNow()[0]);
    await open(A); drawVar('UMID');
    eq('la variabile della stazione di prima non passa alla successiva', await open(A2), 'TEMP');
    setMapVar('UMID'); await until(() => filterVar === 'UMID');
    eq('la variabile scelta sulla mappa vince', await open(A), 'UMID');
    setMapVar(''); await until(() => filterVar === '');

    // testa: il nome e il valore attuale della variabile scelta, come sulla mappa (fermo: i valori al cursore li
    // scrive il grafico), a sinistra accanto al nome; niente valore se e' in ritardo; la fonte sta a piè pagina
    await open(A);
    {
      const src = (SOURCES[A._region] || {}).name, nowTxt = () => [el('stNowVal').textContent, el('stNowWhen').textContent];
      log(!document.getElementById('stationWhere') && !(src && el('ptitle').innerText.includes(src)),
          'testa: niente regione e fonte (sono a piè pagina)', el('ptitle').innerText);
      const late = isLate(A, 'TEMP', nowRome()), [v0, w0] = nowTxt();
      log(late ? !vis(el('stNow')) : vis(el('stNow')) && /\d/.test(v0) && v0.includes('°C') && /^(alle \d\d:\d\d|\d\d\/\d\d \d\d:\d\d)$/.test(w0),
          'testa: il valore attuale con unità e ora (niente se in ritardo)', late + ' ' + v0 + ' | ' + w0);
      if(!phone){
        const nr = el('stationName').getBoundingClientRect(), vr = el('stNow').getBoundingClientRect();
        log(late || (vr.left >= nr.right && vr.right < el('pact').getBoundingClientRect().left - 60),
            'testa: il valore a sinistra, accanto al nome, lontano dai pulsanti', JSON.stringify([nr.right, vr.left, vr.right]));
      }
      const ov = chart.over, R = ov.getBoundingClientRect();
      ov.dispatchEvent(new MouseEvent('mousemove', { clientX:R.left + R.width * 0.3, clientY:R.top + R.height / 2, bubbles:true }));
      await sleep(100);
      eq('testa: il valore resta quello attuale col cursore', nowTxt(), [v0, w0]);
      ov.dispatchEvent(new MouseEvent('mouseleave', { bubbles:true })); await sleep(50);
      drawVar('PREC'); await sleep(300);                                      // la pioggia: quella di oggi, come sulla mappa
      log(isLate(A, 'PREC', nowRome()) || /mm oggi$/.test(nowTxt()[0]), 'testa: la pioggia di oggi', nowTxt().join(' | '));
      drawVar('TEMP'); await sleep(300);
      delete A2._table; delete A2._tableAt;                       // serie da scaricare: il nome cambia prima del grafico
      const pending = selectStation(A2);
      log(!vis(el('stNow')), 'testa: aprendo un\'altra stazione il valore di prima sparisce subito', el('stNowVal').textContent);
      await pending; await until(() => currentStation === A2);
    }
    // Confronta: la × accanto al confronto acceso lo toglie; anche la voce scelta, cliccata di nuovo
    await open(A); await pickMode('day3'); await sleep(200);
    await pickMode('compare'); await sleep(300);
    log(vis(el('cmpOff')) && el('cmpBtn').textContent.includes('Confronto'), 'Confronta acceso: c\'è la × per toglierlo', '');
    el('cmpOff').click(); await until(() => chartMode === 'day3', 4000);
    eq('×: si torna al periodo di prima', [chartMode, vis(el('cmpOff'))], ['day3', false]);
    await pickMode('compare'); await sleep(300);
    el('cmpBtn').click(); await sleep(60);
    el('cmpMenu').querySelector('[data-mode="compare"]').click(); await until(() => chartMode === 'day3', 4000);
    eq('Confronta: la voce scelta, cliccata di nuovo, lo toglie', chartMode, 'day3');
    await pickMode('week'); await sleep(200);

    // riga: le misure principali in ordine fisico, la scelta col trattino del suo colore; derivate e indici in "Altro"
    await open(A);
    eq('riga: le principali in ordine fisico', row(), mainNow());
    eq('riga: si comincia da temperatura, umidità, pioggia', row().slice(0, 3), ['TEMP', 'UMID', 'PREC']);
    log(row().every(v => varCat(v) === 'dirette'), 'riga: niente derivate né indici', JSON.stringify(row()));
    const key = el('vars').querySelector('.vn.on .key');
    log(!!key && key.style.background === rgb(varColor('TEMP')) && !el('vars').querySelector('.vn.on .vp'),
        'riga: la scelta col trattino del suo colore, senza "+"', key ? key.style.background : 'nessun trattino');
    eq('periodi: Oggi, 24 h, 3 g, 7 g', [...document.querySelectorAll('#modes .mode[data-mode]')].map(b => [b.dataset.mode, b.textContent]),
       [['mn', 'Oggi'], ['day', '24 h'], ['day3', '3 g'], ['week', '7 g']]);
    log(!el('chartstats') && chart._labs && chart._labs.hidden, 'a riposo: nessun numero sopra o sotto il grafico', '');

    // "+": piu' variabili; un asse per unita' di misura, il primo a sinistra, gli altri a destra del colore della variabile
    const ys = () => chart.axes.filter(a => a.scale && a.scale !== 'x' && a.scale !== 'cum');
    el('vars').querySelector('.vp[data-var="UMID"]').click(); await sleep(300);
    el('vars').querySelector('.vp[data-var="PRESS"]').click(); await sleep(300);
    eq('"+": tre variabili', selVars(), ['TEMP', 'UMID', 'PRESS']);
    eq('"+": un asse per variabile, il primo a sinistra', ys().map(a => [a.scale, a.side]), [['y', 3], ['y1', 1], ['y2', 1]]);
    log(ys()[1].stroke(chart, 2) === varColor('UMID', true) && ys()[2].stroke(chart, 3) === varColor('PRESS', true),
        'assi a destra del colore della loro variabile', JSON.stringify(ys().map((a, i) => a.stroke(chart, i + 1))));
    log(/\/V:UMID,PRESS$/.test(location.hash), 'link: le variabili aggiunte', location.hash);
    addVar('TDEW'); await sleep(300);
    const sTd = chart.series.find(s => s.label === varLabel('TDEW'));
    log(!!sTd && sTd.scale === 'y' && ys().length === 3, 'rugiada sull\'asse della temperatura (°C): tre assi per quattro variabili',
        JSON.stringify([sTd && sTd.scale, ys().length]));
    log(ys()[0].stroke(chart, 1) === AXTX(), 'asse con due variabili: colore neutro', ys()[0].stroke(chart, 1));
    el('vars').querySelector('.vp[data-var="UMID"]').click(); await sleep(300);
    eq('"×" toglie', selVars(), ['TEMP', 'PRESS', 'TDEW']);
    for(const v of mainNow().filter(v => !selVars().includes(v))) addVar(v);
    await sleep(300);
    eq('al massimo ' + maxVars() + ' variabili', selVars().length, maxVars());
    const h = location.hash, want = [h.split('/')[2]].concat(h.split('V:')[1].split(',').map(decodeURIComponent));
    drawVar('TEMP'); await sleep(200);
    history.replaceState(null, '', h); await applyHash(); await sleep(500);
    eq('link: riapre le stesse variabili', selVars(), want);

    // cursore: il valore accanto a ogni punto, l'ora in alto; fuori dal grafico niente
    drawVar('TEMP'); addVar('UMID'); await sleep(300);
    const k = chart.data[0].findIndex((x, i) => chart.data[1][i] != null && chart.data[2][i] != null);
    chart.setCursor({ left: chart.valToPos(chart.data[0][k], 'x'), top: 10 }); await sleep(100);
    const labs = [...chart._labs.querySelectorAll('.cl-v')].map(e => e.textContent);
    log(!chart._labs.hidden && labs.length === 2 && labs.some(t => / °C$/.test(t)) && labs.some(t => / %$/.test(t)),
        'cursore: un valore per variabile, con l\'unità', JSON.stringify(labs));
    log(/^\d\d\/\d\d \d\d:\d\d/.test(chart._labs.querySelector('.cl-t').textContent), 'cursore: l\'ora in alto', chart._labs.querySelector('.cl-t').textContent);
    chart.setCursor({ left: -10, top: -10 }); await sleep(50);
    log(chart._labs.hidden, 'cursore fuori dal grafico: niente numeri', '');

    // Impilate: con due o piu' variabili, una fascia ciascuna del suo colore; resta scelta come preferenza
    log(!!el('stackbtn'), 'Impilate: c\'è con due variabili', '');
    el('stackbtn').click(); await until(() => stackObj); await sleep(300);
    eq('Impilate: una fascia per variabile', stackObj && stackObj.panels.map(p => p.v), selVars());
    log(stackObj && stackObj.panels.every(p => p.u.series[1].stroke(p.u, 1) === varColor(p.v)), 'Impilate: ogni fascia del colore della sua variabile', '');
    log(/\/S:TEMP,UMID$/.test(location.hash), 'Impilate: nel link', location.hash);
    {                                                    // le fasce si dividono l'altezza del grafico
      const wrap = el('chartwrap').getBoundingClientRect(), last = stackObj.panels[stackObj.panels.length - 1].u.root.getBoundingClientRect();
      log(phone || wrap.bottom - last.bottom <= 30, 'Impilate: due fasce riempiono l\'altezza', JSON.stringify([wrap.bottom, last.bottom]));
    }
    {                             // al cursore il valore accanto alla linea del tempo in ogni fascia, l'ora sopra la prima
      const ps = stackObj.panels, X = Math.round(ps[0].u.over.clientWidth * 0.5);
      ps.forEach(p => p.u.setCursor({ left:X, top:10 })); await sleep(100);
      const at = ps.map(p => { const l = p.u._labs && p.u._labs.querySelector('.cl-v'); return l ? Math.round(parseFloat(l.style.left)) : null; });
      log(at.every(x => x != null && Math.abs(x - X) <= 1), 'Impilate: il valore accanto alla linea del tempo, in ogni fascia', JSON.stringify([X, at]));
      log(!!ps[0].u._labs && !!ps[0].u._labs.querySelector('.cl-t') && !ps.slice(1).some(p => p.u._labs && p.u._labs.querySelector('.cl-t')),
          'Impilate: l\'ora una volta sola, sopra la prima fascia', '');
      eq('Impilate: niente valori in fondo a destra', el('chart').querySelectorAll('.stk-v, .stk-time').length, 0);
    }
    el('stackbtn').click(); await sleep(200);
    log(!stackObj && !!chart && stackMode === false, 'Impilate: un altro clic lo spegne', '');
    drawVar('TEMP'); await sleep(200);                   // una variabile sola: il pulsante resta e impila le principali
    log(vis(el('stackbtn')) && el('stackbtn').getAttribute('aria-pressed') === 'false', 'Impilate a vista anche con una variabile', '');
    el('stackbtn').click(); await until(() => stackObj); await sleep(300);
    log(stackObj && stackObj.panels.length >= 2 && stackObj.panels[0].v === 'TEMP' &&
        stackObj.panels.every(p => isMainVar(p.v, stationVars)), 'Impilate con una variabile: le principali una sotto l\'altra',
        JSON.stringify(stackObj && stackObj.panels.map(p => p.v)));
    el('stackbtn').click(); await sleep(200);
    eq('Impilate spento: torna il grafico di prima', [!!stackObj, !!chart, selVars()], [false, true, ['TEMP']]);
    el('stackbtn').click(); await until(() => stackObj); await sleep(200);
    const chip = el('vars').querySelector('.vb[data-var="UMID"]');
    if(chip) chip.click(); await sleep(300);
    log(!stackObj && !stackMode && selVars().join() === 'UMID', 'Impilate: scegliendo una variabile si torna al grafico singolo',
        JSON.stringify([!!stackObj, stackMode, selVars()]));
    drawVar('TEMP'); await sleep(200);

    // Altro: misure secondarie, derivate, indici; la scelta entra nella riga e ne esce lasciandola
    drawVar('TEMP'); await sleep(200);
    el('altBtn').click(); await sleep(150);
    const items = [...el('altMenu').querySelectorAll('[data-var]')].map(b => b.dataset.var);
    log(!el('altMenu').hidden && items.includes('TDEW') && items.some(v => varCat(v) === 'indici') && !items.some(v => row().includes(v)),
        'Altro: derivate e indici, nessuna della riga', JSON.stringify(items));
    el('altMenu').querySelector('[data-var="TDEW"]').click(); await sleep(300);
    log(currentVar === 'TDEW' && row().includes('TDEW') && el('altMenu').hidden, 'Altro: la scelta si vede e entra nella riga', JSON.stringify(row()));
    drawVar('TEMP'); await sleep(200);
    log(!row().includes('TDEW'), 'Altro: lasciata, esce dalla riga', JSON.stringify(row()));

    // dalla revisione: niente doppioni, Impilate e variabili intatte dopo un confronto, fuoco, Altro lungo, climatologia
    const A28 = (allFeatures.find(f => f.properties._region === 'FVG' && f.properties.scode === 'A280') || {}).properties;
    log(!!A28, 'Arba (FVG/A280) trovata', '');
    if(A28){
      await open(A28); drawVar(WARROW); addVar('TEMP'); await sleep(200);
      await pickMode('compare'); await sleep(300);
      log(chartMode === 'compare' && !!chart && chart.series.length > 3, 'Vento: il confronto dei giorni è sulla velocità', chart && chart.series.length);
      await pickMode('week'); await sleep(300);
      eq('confronto e ritorno: le stesse variabili, nessun doppione', selVars(), [WARROW, 'TEMP']);
      drawVar('TEMP'); await sleep(200);
      el('altBtn').focus(); el('altBtn').click(); await sleep(150);
      const am = el('altMenu'), ai = [...am.querySelectorAll('button')], last = ai[ai.length - 1];
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'End', bubbles:true })); await sleep(100);
      const lr = last.getBoundingClientRect(), mr = am.getBoundingClientRect(), hit = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
      log(document.activeElement === last && lr.bottom <= mr.bottom + 1 && hit && last.contains(hit),
          'Altro lungo (' + ai.length + ' voci): anche l\'ultima si vede e si tocca', JSON.stringify([Math.round(lr.bottom), Math.round(mr.bottom), am.scrollHeight, am.clientHeight]));
      last.click(); await sleep(300);
      log(document.activeElement === el('altBtn'), 'Altro: dopo la scelta il fuoco torna su "Altro"', document.activeElement && (document.activeElement.id || document.activeElement.className));
    }
    await open(A);
    const fp = el('vars').querySelector('.vp[data-var="UMID"]'); fp.focus(); fp.click(); await sleep(200);
    const fa1 = document.activeElement;
    log(fa1 && fa1.classList.contains('vp') && fa1.dataset.var === 'UMID' && fa1.textContent === '×', '"+": il fuoco resta sul suo comando, ora "×"', fa1 && fa1.outerHTML.slice(0, 80));
    const fn = el('vars').querySelector('.vb[data-var="PREC"]'); fn.focus(); fn.click(); await sleep(200);
    const fa2 = document.activeElement;
    log(fa2 && fa2.classList.contains('vb') && fa2.dataset.var === 'PREC', 'clic su un nome: il fuoco resta sul nome', fa2 && fa2.outerHTML.slice(0, 80));
    drawVar('TEMP'); addVar('UMID'); await sleep(200);
    el('stackbtn').click(); await until(() => stackObj); await sleep(200);
    await pickMode('compare'); await sleep(300); await pickMode('week'); await until(() => stackObj, 4000);
    log(!!stackObj && stackMode && selVars().join() === 'TEMP,UMID', 'Impilate resta dopo un confronto', JSON.stringify([stackMode, selVars()]));
    setStackMode(false); await sleep(200);
    eq('periodi: aria-pressed sul periodo scelto', [...document.querySelectorAll('#modes .mode')].map(b => b.getAttribute('aria-pressed')),
       ['false', 'false', 'false', 'true']);
    log(/Temperatura/.test(el('chartsum').textContent) && /Umidità/.test(el('chartsum').textContent),
        'riassunto per chi usa un lettore di schermo', el('chartsum').textContent);
    {
      const k = chart.data[0].findIndex((x, i) => chart.data[1][i] != null && chart.data[2][i] != null);
      chart.setCursor({ left: chart.valToPos(chart.data[0][k], 'x'), top: 10 }); await sleep(100);
      const keys = [...chart._labs.querySelectorAll('.cl-v .k')].map(e => e.style.background);
      log(keys.length === 2 && keys.includes(rgb(varColor('TEMP'))) && keys.includes(rgb(varColor('UMID'))), 'cursore: ogni valore col trattino della sua linea', JSON.stringify(keys));
    }
    {                                                  // cinque valori in basso: nessuno esce dal grafico
      const fake = { _labs: document.createElement('div'), cursor: { idx: 0, left: 50, idxs: null }, over: { clientWidth: 400, clientHeight: 300 },
                     series: [{}].concat([1, 2, 3, 4, 5].map(() => ({ show: true, scale: 'y' }))), data: [[1794700000], [1], [2], [3], [4], [5]],
                     valToPos: () => 296, scales: {}, _unit: 'x' };
      cursorLabels(fake);
      const tops = [...fake._labs.querySelectorAll('.cl-v')].map(e => parseFloat(e.style.top));
      log(tops.length === 5 && tops.every(t => t >= 0 && t <= 300 - 16), 'cursore: valori fitti in basso restano dentro il grafico', JSON.stringify(tops));
    }
    {                         // i valori in colonna in alto accanto alla linea del tempo, mai all'altezza della curva
      const mk = y => ({ _labs: document.createElement('div'), cursor: { idx: 0, left: 50, idxs: null }, over: { clientWidth: 400, clientHeight: 300 },
                         series: [{}].concat([1, 2, 3].map(() => ({ show: true, scale: 'y' }))), data: [[1794700000], [1], [2], [3]],
                         valToPos: () => y, scales: {}, _unit: 'x' });
      const tops = y => { const f = mk(y); cursorLabels(f); return [...f._labs.querySelectorAll('.cl-v')].map(e => parseFloat(e.style.top)); };
      const a = tops(296), b = tops(20);
      log(a.length === 3 && JSON.stringify(a) === JSON.stringify(b) && a[0] <= 24 && a.every((t, k) => !k || t - a[k - 1] === 16),
          'cursore: valori in colonna in alto, mai all\'altezza della curva', JSON.stringify([a, b]));
    }
    {                                                  // indici: niente tabelle, nulla sopra il grafico
      const G = stationVars.find(v => v === 'PREC3') || stationVars.find(v => varCat(v) === 'indici');
      if(G){
        drawVar(G); await sleep(1500);
        const cw = el('chartwrap').getBoundingClientRect(), cv = el('chart').querySelector('canvas').getBoundingClientRect();
        const over = [...el('panel').children].filter(e => e !== el('chartwrap') && vis(e) && e.id !== 'chartsum').filter(e => {
          const r = e.getBoundingClientRect(); return r.top < cv.bottom - 1 && r.bottom > cv.top + 1; });
        log(!document.getElementById('climabox') && !over.length && cv.bottom <= cw.bottom + 1,
            'indici (' + G + '): nessuna tabella, nulla sopra il grafico', JSON.stringify(over.map(e => e.id || e.className)));
      }
    }
    {
      await open(C); await sleep(200);
      const k = chart.data[0].findIndex((x, i) => chart.data[1][i] != null);
      chart.setCursor({ left: chart.valToPos(chart.data[0][k], 'x'), top: 10 }); await sleep(100);
      const t = (chart._labs.querySelector('.cl-v') || {}).textContent || '';
      log(/^-?\d+\.\d\d /.test(t), 'livelli: al centimetro (due decimali) anche al cursore', t);
    }

    // pioggia: linee cumulate giornaliere (da zero a ogni mezzanotte; il primo giorno dal valore vero) e modo Oggi
    await open(B);
    const mode = async m => {
      document.querySelector('#modes [data-mode="' + m + '"]').click();
      await until(() => chartMode === m && chart && chart._m); await sleep(300);
    };
    const midOf = ts => civMidnight(civDay(ts));
    const T = currentStation._table, P = T.cols.PREC || [];
    for(const m of ['week', 'day3', 'day']){
      await mode(m);
      const dl = chart._m.daily || [];
      log(dl.length >= 1, m + ': linee giornaliere', dl.length);
      if(!dl.length) continue;
      log(dl.slice(1).every(s => s.y[0] === 0 && s.x[0] === midOf(s.x[0] + 1)), m + ': ogni giorno da zero a mezzanotte',
          JSON.stringify(dl.slice(1, 3).map(s => [s.x[0], s.y[0]])));
      log(dl.every(s => s.y.every((v, i) => !i || v >= s.y[i - 1] - 1e-9)), m + ': ogni linea sale soltanto', '');
      const s0 = dl[0], mid0 = midOf(s0.x[1] - 1);
      let vero = 0;
      T.x.forEach((x, i) => { if(x > mid0 && x <= s0.x[0] && P[i] != null) vero += P[i]; });
      eq(m + ': il primo giorno parte dal valore vero', s0.y[0], Math.round(vero * 100) / 100);
      const top = Math.max(...dl.flatMap(s => s.y.filter((v, i) => s.x[i] >= chart.scales.x.min && s.x[i] <= chart.scales.x.max)));
      log(chart.scales.cum.max - chart.scales.cum.min >= top - 1e-9, m + ": l'asse destro contiene le linee giornaliere",
          JSON.stringify([chart.scales.cum.min, chart.scales.cum.max, top]));
    }
    await mode('mn');
    log(chart._m.daily == null, 'Oggi: niente linee giornaliere (coinciderebbero con la cumulata)', '');
    eq('Oggi: dalla mezzanotte', chart.scales.x.min, midOf(Date.now() / 1000));
    await mode('week');

    // "Vento": velocita' con le frecce della direzione, nella riga al posto di velocita' e direzione
    const WV = pick(p => has(p, 'DVENTO') && has(p, 'VVENTO') && has(p, 'PRESS'));
    log(!!WV, 'stazione con direzione e velocità del vento', '');
    if(WV){
      await open(WV); await sleep(400);
      log(row().includes(WARROW) && !row().includes('VVENTO') && !row().includes('DVENTO') && !!el('vars').querySelector('.vp[data-var="' + WARROW + '"]'),
          'Vento: nella riga al posto di velocità e direzione, col "+"', JSON.stringify(row()));
      drawVar(WARROW);
      await until(() => chart && chart._m && chart._m.wind); await sleep(300);
      const ar = chart._m.wind.arrows;
      log(ar.length > 0 && ar.every(a => a.s > 0 && a.d >= 0 && a.d < 360), 'Vento 7 g: frecce sulla velocità', ar.length);
      log(chart.scales.y.min === 0, 'Vento: asse della velocità da zero', chart.scales.y.min);
      log(ar.every(a => (a.x % HOUR) === HOUR / 2), 'Vento 7 g: una freccia all\'ora, a metà ora', '');
      await mode('day');
      const ar24 = chart._m.wind.arrows;
      log(ar24.length > 0 && ar24.every(a => currentStation._table.x.includes(a.x)), 'Vento 24 h: una freccia per lettura', ar24.length);
      const kw = chart._m.wind.dirs.findIndex((d, i) => d != null && chart.data[1][i] != null);
      if(kw >= 0){
        chart.setCursor({ left: chart.valToPos(chart.data[0][kw], 'x'), top: 20 }); await sleep(200);
        log(/(m\/s|km\/h) <span class="wdir"/.test(chart._labs.innerHTML), 'Vento: al cursore la velocità e da dove viene', chart._labs.textContent);
      }
      addVar('PRESS'); await sleep(300);
      log(chart._m.wind && chart._m.wind.i === 1 && chart.series.length >= 3, 'Vento con la pressione: frecce sulla sua linea', '');
      await mode('week');
      // la rosa segue il periodo
      const obs = () => +((/(\d+) osservazioni/.exec(el('windrose').innerHTML) || [])[1] || 0);
      drawVar(WROSE); await sleep(300);
      const n7 = obs();
      await mode('day'); await sleep(200);
      const n1 = obs();
      log(n7 > 0 && n1 > 0 && n1 < n7, 'Rosa: segue il periodo (24 h meno di 7 g)', JSON.stringify([n7, n1]));
      await mode('week');
    }

    // PNG di ogni vista: immagine grande, intera
    const pngs = [], real = window.deliverPNG;
    window.deliverPNG = async (b, f) => { pngs.push({ f, kb: Math.round(b.size / 1024), type: b.type }); };
    const png = async tag => {
      const n = pngs.length;
      await exportPNG(); await until(() => pngs.length > n, 8000);
      const p = pngs[n];
      log(!!p && p.kb > 40 && p.type === 'image/png' && /\.png$/.test(p.f), 'PNG: ' + tag, JSON.stringify(p || null));
    };
    await open(A); await png('una variabile');
    {                                  // legenda in alto accanto al titolo: il grafico prende tutta la larghezza
      const out = await chartPNG(), b = out ? new Uint8Array(await out.blob.arrayBuffer()) : [];
      const width = b.length > 24 ? ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) : null;   // IHDR
      eq('PNG: legenda in alto, niente colonna bianca a destra', width, (12 + 1500 + 12) * PNG_R);
    }
    {                                  // evento di pioggia: nel PNG sopra la sua linea solo il totale
      const cv = document.createElement('canvas'), ctx = cv.getContext('2d'), texts = [], ft = ctx.fillText.bind(ctx);
      cv.width = 400; cv.height = 200;
      ctx.fillText = (t, x, y) => { texts.push(t); ft(t, x, y); };
      const u = { ctx, width:400, bbox:{ left:20, top:30, width:360, height:150 }, valToPos:v => 20 + v };
      drawEvents([{ a:10, b:100, mm:9 }], '#2b6cb0', true, 'mm')(u);
      eq('PNG: sopra l\'evento solo il totale', texts, ['9 mm']);
      texts.length = 0;
      drawEvents([{ a:10, b:100, mm:9 }], '#2b6cb0', false, 'mm')(u);
      eq('schermo: l\'evento senza scritte (il totale al passaggio)', texts, []);
    }
    addVar('UMID'); addVar('PRESS'); await sleep(300); await png('tre variabili');
    el('stackbtn').click(); await until(() => stackObj); await sleep(300); await png('Impilate');
    el('stackbtn').click(); await sleep(200);
    drawVar('TEMP'); await sleep(200);
    pickMode('compare'); await until(() => chartMode === 'compare' && chart && chart._hi, 8000); await sleep(300); await png('Confronto 7 giorni');
    await mode('week');
    if(WV){ await open(WV); drawVar(WROSE); await sleep(300); await png('Rosa dei venti'); drawVar(WARROW); await sleep(200); }
    window.deliverPNG = real;
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
    // colori "rgb(r, g, b)": distanza OKLab (x100, come la regola della tavolozza: >= 15 = si distinguono), croma (< 0.10 = grigio),
    // contrasto WCAG sullo sfondo
    const rgbOf = c => (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const linC = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const oklab = c => { const [r, g, b] = rgbOf(c).map(linC);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
            s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]; };
    const dE = (a, b) => { const p = oklab(a), q = oklab(b); return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
    const chroma = c => { const p = oklab(c); return Math.hypot(p[1], p[2]); };
    const lumC = c => { const [r, g, b] = rgbOf(c).map(linC); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrastC = (a, b) => { const x = lumC(a), y = lumC(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    // Giorni: tutto il periodo = dal primo all'ultimo giorno del file, mezza giornata di margine ai lati (le barre intere)
    const nAll = Math.max(raw.p.length, (raw.tm || []).length), first = d0 / 1000, last = first + 86400 * (nAll - 1);
    const FULL = { min:first - 43200, max:last + 43200 };
    const litR = () => [...el('hvRange').querySelectorAll('.on')].map(b => b.dataset.r);

    // Tabella: una riga per mese (gen..dic) e in fondo tot/media, una colonna per anno (dal piu' vecchio); pioggia in mm
    // interi, temperatura con un decimale; mese mancante = cella vuota; incompleto = piu' chiaro col perche' (title);
    // pioggia: dietro ogni numero una barra (valore / mese piu' piovoso); temperatura: casella del colore dello scarto dalla
    // media di quel mese fra gli anni, con la chiave "piu' freddo ... piu' caldo" sopra
    const tbl = () => el('hvTable').querySelector('table');
    const cell = (y, m) => {                                         // m = 0..11 i mesi, 12 la riga del totale/media
      const t = tbl(), k = t ? [...t.rows[0].cells].findIndex(c => c.textContent.trim() === String(y)) : -1, tr = t && t.tBodies[0] && t.tBodies[0].rows[m];
      return k > 0 && tr ? tr.cells[k] : null;
    };
    const barW = td => getComputedStyle(td).backgroundImage === 'none' ? null : 100 * parseFloat(td.style.getPropertyValue('--f'));
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
      // pioggia: barra prima del numero; temperatura: niente barra, colore dello scarto dalla media del mese (classe hv-k0..6)
      const kOf = td => { const k = [...td.classList].find(c => /^hv-k\d$/.test(c)); return k ? +k.slice(4) : null; };
      const bad = [];
      for(const y of years) for(let m = 0; m < 12; m++){
        const c = E[y + '-' + m], td = cell(y, m), tag = (m + 1) + '/' + y;
        if(!td){ bad.push(tag + ' assente'); continue; }
        if(!c || c.val == null){ if(td.textContent !== '' || barW(td) != null || kOf(td) != null) bad.push(tag + ' non vuota: "' + td.textContent + '"'); continue; }
        const w = barW(td), mark = isP ? Math.abs(w - wantW(c.val)) <= 0.6 : w == null && kOf(td) === tClass(y, m);
        if(td.textContent !== num(c.val) || td.classList.contains('part') === c.full || td.title !== (c.full ? '' : why(c)) || !mark)
          bad.push(tag + ' ' + td.textContent + (td.classList.contains('part') ? ' [part]' : '') + (isP ? ' barra ' + w + ' (atteso ' + num(c.val) + ' barra ' +
                   wantW(c.val).toFixed(1) + ')' : ' colore ' + kOf(td) + ' (atteso ' + tClass(y, m) + ')'));
      }
      eq(name + ': ogni mese (valore, più chiaro col perché, ' + (isP ? 'barra' : 'colore') + '; vuoto se manca)', bad.slice(0, 6), []);
      for(const y of years){                                         // riga in fondo: totale (pioggia) o media delle medie (temperatura), in grassetto
        const ms = ok.filter(c => c.y === y), s = ms.reduce((a, c) => a + c.val, 0), nf = ms.filter(c => c.full).length, td = cell(y, 12);
        eq(name + ': ' + (isP ? 'tot ' : 'media ') + y + ' (valore, più chiaro, perché, grassetto)',
           td && [td.textContent, td.classList.contains('part'), td.title, +getComputedStyle(td).fontWeight >= 600],
           [num(isP ? s : s / ms.length), nf < 12, nf < 12 ? 'incompleto: ' + nf + ' mesi completi su 12' : '', true]);
      }
      if(!t || !t.tBodies[0]) return;
      const months = [...t.tBodies[0].rows].slice(0, 12).flatMap(r => [...r.cells].slice(1)).filter(td => td.textContent !== '');
      const part = months.filter(td => td.classList.contains('part')), fullc = months.filter(td => !td.classList.contains('part'));
      if(isP){
        const MUTED = colorOf('var(--muted)'), bg = td => getComputedStyle(td).backgroundImage;
        log(part.length > 0 && fullc.length > 0 && part.every(td => getComputedStyle(td).color === MUTED) && fullc.every(td => getComputedStyle(td).color !== MUTED),
            name + ': incompleti in grigio, completi no', JSON.stringify([MUTED, part.length && getComputedStyle(part[0]).color, fullc.length && getComputedStyle(fullc[0]).color]));
        const fb = [...new Set(fullc.map(bg))], pb = [...new Set(part.map(bg))];
        log(fb.length === 1 && pb.length === 1 && fb[0] !== 'none' && pb[0] !== 'none' && fb[0] !== pb[0], name + ': barra colorata se completo, grigia se incompleto', JSON.stringify([fb, pb]));
        if(fullc.length){
          document.body.classList.add('dark'); const dark = bg(fullc[0]); document.body.classList.remove('dark');
          log(dark !== 'none' && dark !== fb[0], name + ': barre col tema scuro', JSON.stringify([fb[0], dark]));
        }
      } else {
        const op = td => +getComputedStyle(td).opacity, bgc = td => getComputedStyle(td).backgroundColor, at = td => {
          const r = td.parentNode, m = [...r.parentNode.rows].indexOf(r), y = +t.rows[0].cells[[...r.cells].indexOf(td)].textContent; return [y, m]; };
        log(part.length > 0 && fullc.length > 0 && part.every(td => op(td) < 1) && fullc.every(td => op(td) === 1), name + ': incompleti più chiari, completi no',
            JSON.stringify([part.length && op(part[0]), fullc.length && op(fullc[0])]));
        const dev = td => { const [y, m] = at(td), v = tMean(y, m), s = tStat(m); return v == null || !s ? null : v - s.mean; };
        const warm = td => { const [r, , b] = rgbOf(bgc(td)); return r - b; };
        eq(name + ': rosso se più caldo della media del mese, blu se più freddo',
           months.filter(td => { const d = dev(td); return d != null && Math.abs(d) >= 0.5 && Math.sign(warm(td)) !== Math.sign(d); }).map(td => at(td).join('-')), []);
        const k = el('hvTable').querySelector('.hv-dev'), sw = k ? [...k.querySelectorAll('.sw')] : [], dist = td => dE(bgc(td), bgc(sw[3]));
        let worse = 0; const ac = months.filter(td => dev(td) != null);
        ac.forEach(a => ac.forEach(b => { if(Math.sign(dev(a)) === Math.sign(dev(b)) && Math.abs(dev(a)) > Math.abs(dev(b)) + 0.05 && Math.abs(dev(b)) < 3 && dist(a) < dist(b) - 0.5) worse++; }));
        eq(name + ': più lontano dalla media, colore più carico', sw.length === 7 ? worse : 'chiave senza i sette colori', 0);
        eq(name + ': numeri leggibili sul colore (contrasto almeno 4.5)', fullc.filter(td => contrastC(getComputedStyle(td).color, bgc(td)) < 4.5)
           .map(td => at(td).join('-') + ' ' + contrastC(getComputedStyle(td).color, bgc(td)).toFixed(2)), []);
        eq(name + ': chiave', k ? k.innerText.replace(/\s+/g, ' ').trim() : null, 'più freddo più caldo');
        log(vis(k) && R(k).bottom <= R(t).top + 1 && Math.abs(R(k).right - R(t).right) <= 2, name + ': chiave sopra la tabella, a destra', k && JSON.stringify([R(k).right, R(t).right]));
        const c0 = fullc.find(td => kOf(td) != null), bg0 = c0 && bgc(c0);
        document.body.classList.add('dark'); const dark = c0 && bgc(c0); document.body.classList.remove('dark');
        log(!!c0 && dark !== bg0, name + ': colori col tema scuro', JSON.stringify([bg0, dark]));
      }
      const c1 = t.tBodies[0].rows[0].cells;
      log(c1.length > 1 && getComputedStyle(c1[1]).textAlign === 'right' && getComputedStyle(t.rows[0].cells[1]).textAlign === 'right' &&
          /tabular-nums/.test(getComputedStyle(c1[1]).fontVariantNumeric), name + ': numeri a destra, cifre della stessa larghezza', '');
      log(getComputedStyle(c1[0]).position === 'sticky' && getComputedStyle(t.rows[0].cells[0]).position === 'sticky', name + ': colonna dei mesi ferma se la tabella scorre', getComputedStyle(c1[0]).position);
      const pn = el('panel'), ps = getComputedStyle(pn), x0 = R(pn).left + parseFloat(ps.paddingLeft),
            avail = pn.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight), tw = R(t).width;
      const need = 48 + (t.rows[0].cells.length - 1) * 96;                       // 96 px per anno: con molti anni riempie la scheda, poi scorre
      if(!PHONE.matches && avail > need) log(Math.abs(tw - need) <= 1 && Math.abs(R(t).left - x0) <= 1, name + ': tabella larga quanto servono gli anni, a sinistra', JSON.stringify([R(t).left, tw, x0, avail, need]));
      else log(Math.abs(tw - avail) <= 1 && Math.abs(R(t).left - x0) <= 1, name + ': tabella larga quanto lo schermo', JSON.stringify([R(t).left, tw, x0, avail]));
    };

    // grafici: niente chiave sopra il grafico (i nomi sono nell'etichetta dove sta il puntatore; mouse, al tocco sul telefono)
    const noKey = name => eq(name + ': niente chiave né suggerimenti sul grafico',
                             [...el('hvChart').querySelectorAll('.hv-key, .hv-hint')].map(e => e.textContent), []);
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
    // Anni: nessuna legenda, il nome dell'anno in fondo alla sua linea, del colore della linea; un colore ben distinto per
    // anno (l'ultimo blu e il piu' spesso), linee piene, gli incompleti piu' sottili
    const yearCols = () => histU.series.slice(1).map((s, k) => colorOf(typeof s.stroke === 'function' ? s.stroke(histU, k + 1) : s.stroke));
    const okColors = (name, cols, yrs) => {
      const bg = getComputedStyle(document.body).backgroundColor, pairs = [];
      cols.forEach((a, i) => cols.slice(i + 1).forEach((b, j) => pairs.push([yrs[i] + '/' + yrs[i + 1 + j], +dE(a, b).toFixed(1)])));
      log(cols.length >= 2 && pairs.every(p => p[1] >= 15) && cols.every(c => chroma(c) >= 0.1), name + ': un colore ben distinto per anno (niente grigi)',
          JSON.stringify([cols, pairs, cols.map(c => +chroma(c).toFixed(3))]));
      log(cols.every(c => contrastC(c, bg) >= 3), name + ': linee leggibili sullo sfondo (contrasto almeno 3)', JSON.stringify([bg, cols.map(c => +contrastC(c, bg).toFixed(2))]));
    };
    const okYears = (name, isP) => {
      const S = histU.series.slice(1), n = S.length, yrs = S.map(s => String(s.label)), cols = yearCols();
      okColors(name, cols, yrs);
      const lv = rgbOf(cols[n - 1]);
      log(lv.length === 3 && lv[2] - lv[0] >= 60 && S.every((s, k) => k === n - 1 || s.width < S[n - 1].width),
          name + ': ultimo anno blu e il più spesso', JSON.stringify(S.map((s, k) => [s.label, cols[k], s.width])));
      eq(name + ': linee piene, niente tratteggi', S.filter(s => s.dash && s.dash.length).map(s => s.label), []);
      const part = partYears(isP).map(String), older = S.slice(0, n - 1);
      const thin = older.filter(s => part.includes(String(s.label))).map(s => s.width), full = older.filter(s => !part.includes(String(s.label))).map(s => s.width);
      log(thin.length > 0 && new Set(thin).size === 1 && new Set(full).size <= 1 && thin[0] < Math.min(S[n - 1].width, ...full),
          name + ': anni incompleti più sottili (' + part.join(', ') + ')', JSON.stringify(S.map(s => [s.label, s.width])));
      // gli anni in una riga sopra il grafico, ognuno del colore della sua linea; nessun nome sulle linee
      const o = histU.over, w = o.parentNode, key = w.querySelector('.hv-yk'), labs = key ? [...key.children] : [];
      eq(name + ': gli anni in alto, ognuno del colore della sua linea', labs.map(l => [l.textContent.trim(), getComputedStyle(l).color]),
         yrs.map((y, k) => [y, cols[k]]));
      log(!!key && vis(key) && R(key).bottom <= R(o).top + 0.5 && R(key).right <= R(w).right + 0.5 && R(key).left >= R(w).left,
          name + ': la riga degli anni sopra il grafico, non dentro', key ? JSON.stringify([R(key).top, R(key).bottom, R(o).top]) : 'manca');
      eq(name + ': nessun nome sulle linee', [...w.children].filter(e => e !== key && vis(e) && /^\d{4}$/.test(e.textContent.trim())).length, 0);
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
      log(vis(box) && b.getAttribute('aria-expanded') === 'true' && ['giorno solare (UTC+1)', 'giorno completo = almeno 20 ore con dato', 'più chiaro = incompleto',
          'più sottile = anno incompleto', 'elaborazioni non ufficiali dei dati grezzi delle fonti'].every(s => box.innerText.includes(s)) && !/tratteggi/.test(box.innerText),
          name + ': "i" mostra il metodo (più chiaro, più sottile; niente tratteggio)', box.innerText);
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
    log(vis(el('histbtn')) === stationHistVars(N).length > 0, 'senza pioggia ne temperatura: pulsante solo con livello o portata',
        JSON.stringify(N.variables));
    await open(V);
    log(vis(el('histbtn')), 'Valdagno (PREC+TEMP): pulsante visibile', '');
    for(const v of ['UMID', 'PREC24', 'TEMP']){                                    // il pulsante non dipende dalla variabile aperta
      if(has(V, v) && el('vars').querySelector('[data-var="' + v + '"]')){ drawVar(v); await sleep(100);
        log(vis(el('histbtn')), 'pulsante visibile con ' + v + ' aperta', ''); }
    }
    // viste in ordine Giorni, Mesi, Anni, Tabella; dal pulsante (senza vista nel link) lo Storico si apre su Giorni, tutto il periodo
    eq('viste in ordine: Giorni, Mesi, Anni, Tabella', [...el('hvView').children].map(b => b.dataset.w + ' ' + b.textContent.trim()),
       ['giorni Giorni', 'mesi Mesi', 'anni Anni', 'tabella Tabella']);
    el('histbtn').click(); await until(() => histMode && !!histU && histU.scales.x.min != null, 8000); await sleep(300);
    {
      const sx = histU && histU.scales.x;
      eq('dal pulsante lo Storico si apre su Giorni', histView, 'giorni');
      log(!!sx && Math.abs(sx.min - FULL.min) < 3600 && Math.abs(sx.max - FULL.max) < 3600, 'Giorni si apre su tutto il periodo (dal primo all\'ultimo giorno)',
          sx && JSON.stringify([(sx.min - FULL.min) / 3600, (sx.max - FULL.max) / 3600]));
      eq('Giorni su tutto il periodo: acceso "Tutto"', litR(), ['0']);
      noKey('Giorni, apertura');
      noOverflow('Giorni, apertura');
    }
    await setHistMode(false);
    await setHistMode(true, 'PREC', 'mesi');      // con lo Storico aperto, una stazione senza pioggia/temperatura lo chiude, se non ha livello o portata
    await open(N);
    {
      const nv = stationHistVars(N);
      log(nv.length ? histMode && histVar === nv[0] : !histMode && !vis(el('histview')) && !vis(el('histbtn')),
          'stazione senza PREC/TEMP: Storico ' + (nv.length ? 'su ' + nv[0] : 'chiuso'), histMode + ' ' + histVar);
      if(histMode) await setHistMode(false);
    }
    await open(V);
    // viste
    const EP = expMonths(true), ET = expMonths(false);
    // temperatura negli anni: medie mensili con almeno 10 giorni completi; media, minimo e massimo dove ci sono almeno due anni
    const TY = [...new Set(Object.values(ET).map(c => c.y))];
    const tMean = (y, m) => { let t = 0, n = 0; raw.tm.forEach((x, i) => { const d = dayOf(i); if(d.getUTCFullYear() === y && d.getUTCMonth() === m && x != null && raw.ht[i] >= 20){ t += x; n++; } });
      return n >= 10 ? r1(t / n) : null; };
    const tStat = m => { const v = TY.map(y => tMean(y, m)).filter(x => x != null);
      return v.length < 2 ? null : { mean:r1(v.reduce((a, x) => a + x, 0) / v.length), lo:Math.min(...v), hi:Math.max(...v) }; };
    const tYears = TY.filter(y => MESI.some((_, m) => tMean(y, m) != null)), tLast = tYears[tYears.length - 1];
    const sgn = d => (r1(d) > 0 ? '+' : '') + f1(d), withDev = (v, s) => f1(v) + ' °C' + (s ? ' (' + sgn(v - s.mean) + ')' : '');
    // classe di colore dello scarto dalla media del mese: 3 entro mezzo grado, poi 1, 2 e oltre 2.5 gradi verso il blu o il rosso
    const tClass = (y, m) => { const v = tMean(y, m), s = tStat(m); if(v == null || !s) return null;
      const d = r1(v - s.mean), a = Math.abs(d); return 3 + Math.sign(d) * (a < 0.5 ? 0 : a < 1.5 ? 1 : a < 2.5 ? 2 : 3); };
    await setHistMode(true, 'PREC', 'mesi');
    log(histMode && vis(el('histview')) && el('histbtn').classList.contains('active'), 'Storico aperto', '');
    eq('vista iniziale', [histVar, histView], ['PREC', 'mesi']);
    okView('Pioggia/Mesi');
    log(!!histU && histU.series.some(s => s.scale === 'cum') === true, 'Pioggia/Mesi: cumulata sull\'asse destro', histU && histU.series.map(s => s.scale).join(','));
    noKey('Pioggia/Mesi');
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
    log(inside(el('hvVar')) && inside(el('hvView')) && inside(el('expBtn')), 'comandi dentro lo schermo', '');
    histView = 'anni'; await renderHist(); okView('Pioggia/Anni');
    log(!el('hvChart').querySelector('.hv-yrs'), 'Pioggia/Anni: niente scelta dell\'anno', '');
    log(!!histU && histU.series.some(s => s.scale === 'cum') === false, 'Pioggia/Anni: cumulata sull\'asse destro assente', histU && histU.series.map(s => s.scale).join(','));
    {                                                                // cumulata: a fine 2025 il totale dell'anno; al passaggio la cumulata di ogni anno
      const yrs = [...new Set(Object.values(EP).map(c => c.y))], k = yrs.indexOf(2025) + 1;
      const tot = r1(raw.p.reduce((a, x, i) => a + (dayOf(i).getUTCFullYear() === 2025 && x != null ? x : 0), 0));
      eq('Pioggia/Anni: cumulata del 2025 al 31/12', [histU.data[k][364], histU.series[k].label], [tot, '2025']);
      let ax = null; try { ax = [histU.axes[1].values(histU, [0, 500, 1000, 1500], 1, 50, 500),
                                 histU.axes[1].values(histU, [-0.5, 0, 0.5, 1], 1, 50, 0.5)]; } catch(e){ ax = String(e); }
      eq('Pioggia/Anni: asse col punto, senza migliaia, gli stessi decimali su ogni tacca', ax,
         [['0', '500', '1000', '1500'], ['-0.5', '0.0', '0.5', '1.0']]);
      okYears('Pioggia/Anni', true);
      noKey('Pioggia/Anni');
      const t = await tipAt(300, null), i = histU.cursor.idx, lab = new Date(Date.UTC(2023, 0, 1 + i));
      const cum = y => { let run = 0, first = -1, lastd = -1;                 // come il grafico: cumulata dal 1 gennaio, null fuori dai dati dell'anno
        raw.p.forEach((x, j) => { const d = dayOf(j); if(x == null || d.getUTCFullYear() !== y) return; const doy = doyOf(d);
          if(first < 0) first = doy; lastd = doy; if(doy <= i) run += x; });
        return first < 0 || i < first || i > lastd ? null : r1(run); };
      const want = [lab.getUTCDate() + ' ' + MESI[lab.getUTCMonth()], ...yrs.slice().reverse().filter(y => cum(y) != null).map(y => y + ' ' + Math.round(cum(y)) + ' mm')];
      log(Math.abs(i - 300) <= 3, 'Pioggia/Anni: puntatore sul giorno 300', i);
      eq('Pioggia/Anni: etichetta al passaggio (ogni anno)', tipText(t), want.join(' | '));
      log(tipIn(t), 'Pioggia/Anni: etichetta dentro il grafico e lo schermo', '');
      { const cols = yearCols(), byY = {}; histU.series.slice(1).forEach((s, k) => { byY[String(s.label)] = cols[k]; });
        eq('Pioggia/Anni: nel riquadro ogni anno col segno del colore della sua linea', t ? [...t.querySelectorAll('.sw')].map(s => getComputedStyle(s).borderTopColor) : null,
           yrs.slice().reverse().filter(y => cum(y) != null).map(y => byY[String(y)])); }
      eq('Pioggia/Anni: niente trattini nella chiave e nel riquadro', [...el('histview').querySelectorAll('.sw')].filter(s => vis(s) && getComputedStyle(s).borderTopStyle === 'dashed').length, 0);
      noOverflow('Pioggia/Anni');
      document.body.classList.add('dark'); await renderHist(); await sleep(100);       // tema scuro (il pulsante del tema ridisegna lo Storico cosi')
      {
        const yrsD = histU.series.slice(1).map(s => String(s.label)), colsD = yearCols(), o = histU.over;
        const key = o.parentNode.querySelector('.hv-yk'), labs = key ? [...key.children] : [];
        okColors('Pioggia/Anni, tema scuro', colsD, yrsD);
        eq('Pioggia/Anni, tema scuro: gli anni in alto, ognuno del colore della sua linea',
           labs.map(l => [l.textContent.trim(), getComputedStyle(l).color]), yrsD.map((y, k) => [y, colsD[k]]));
      }
      document.body.classList.remove('dark'); await renderHist(); await sleep(100);
    }
    histView = 'giorni'; await renderHist(); okView('Pioggia/Giorni');
    log(!!histU && histU.series.some(s => s.scale === 'cum') === true, 'Pioggia/Giorni: cumulata sull\'asse destro', histU && histU.series.map(s => s.scale).join(','));
    noKey('Pioggia/Giorni');
    log(vis(el('hvRange')) && inside(el('hvRange')), 'Giorni: scelta del periodo visibile e dentro lo schermo', '');
    for(const [r, days] of [[30, 30], [90, 90], [365, 365], [0, raw.p.length]]){
      el('hvRange').querySelector('[data-r="' + r + '"]').click(); await sleep(150);
      const sx = histU.scales.x, span = Math.round((sx.max - sx.min) / 86400);
      log(Math.abs(span - days) <= 1 && el('hvRange').querySelector('.on').dataset.r === String(r), 'Giorni ' + (r || 'Tutto'), 'span ' + span + ' giorni, atteso ' + days);
    }
    el('hvRange').querySelector('[data-r="30"]').click(); await sleep(150);
    { const i = dayWith(true); await okTip('Pioggia/Giorni, ' + dayOf(i).toISOString().slice(0, 10), d0 / 1000 + 86400 * i, dayTxt(true, i)); }
    await tipEdges('Pioggia/Giorni');
    // Giorni: zoom sul tempo. Rotellina attorno al puntatore, trascinare sposta, doppio clic torna a tutto il periodo; mai
    // oltre tutto il periodo ne' sotto 3 giorni; acceso solo il periodo che corrisponde alla finestra. Telefono: due dita,
    // un dito di lato, doppio tocco; in verticale il dito scorre la pagina
    {
      const MINW = 3 * 86400, W = s => s.max - s.min;
      const S = () => ({ min:histU.scales.x.min, max:histU.scales.x.max });
      const near = (a, b, tol) => Math.abs(a.min - b.min) <= tol && Math.abs(a.max - b.max) <= tol;
      // i clientX degli eventi sono pixel interi: si misura nel punto vero dell'evento
      const pt = fx => { const r = R(histU.over); return [Math.round(r.left + r.width * fx), Math.round(r.top + r.height / 2)]; };
      const valX = x => { const s = S(), r = R(histU.over); return s.min + (x - r.left) / r.width * W(s); };
      const wheel = async (fx, dy, more) => { const [x, y] = pt(fx);
        const ev = new WheelEvent('wheel', Object.assign({ deltaY:dy, deltaMode:0, clientX:x, clientY:y, bubbles:true, cancelable:true }, more || {}));
        histU.over.dispatchEvent(ev); await sleep(60); return ev; };
      const ptr = (type, id, kind, x, y) => histU.over.dispatchEvent(new PointerEvent(type, { pointerId:id, pointerType:kind, isPrimary:true, button:0,
        buttons:type === 'pointerup' ? 0 : 1, clientX:x, clientY:y, bubbles:true, cancelable:true }));
      const days = s => JSON.stringify([s.min, s.max].map(v => +((v - FULL.min) / 86400).toFixed(2)));
      el('hvRange').querySelector('[data-r="0"]').click(); await sleep(150);
      log(near(S(), FULL, 60) && litR().join() === '0', 'Giorni: "Tutto" = tutto il periodo', days(S()));
      {                                                              // rotellina in su a 3/4 del grafico
        const s0 = S(), [x75] = pt(0.75), v = valX(x75), ev = await wheel(0.75, -300), s1 = S();
        log(W(s1) < W(s0) * 0.8 && W(s1) >= MINW, 'Giorni: rotellina in su, zoom (periodo più stretto)', JSON.stringify([W(s0) / 86400, W(s1) / 86400]));
        log(W(s1) < W(s0) * 0.8 && Math.abs(valX(x75) - v) < 3600, 'Giorni: zoom attorno al puntatore (sotto il puntatore lo stesso giorno)', (valX(x75) - v) / 3600 + ' h');
        log(ev.defaultPrevented, 'Giorni: la rotellina sul grafico zooma e non fa scorrere la pagina', '');
        eq('Giorni: dopo lo zoom nessun periodo acceso', litR(), []);
        noOverflow('Pioggia/Giorni, dopo lo zoom');
      }
      {                                                              // trascinare col mouse: stessa larghezza, spostata di quanto si trascina (un decimo del grafico)
        const [x, y] = pt(0.5), s = S(), px = Math.round(R(histU.over).width / 10), dt = px / R(histU.over).width * W(s);
        ptr('pointerdown', 1, 'mouse', x, y); ptr('pointermove', 1, 'mouse', x + px / 2, y); ptr('pointermove', 1, 'mouse', x + px, y); ptr('pointerup', 1, 'mouse', x + px, y);
        await sleep(60);
        const s2 = S();
        log(Math.abs(W(s2) - W(s)) < 60 && Math.abs((s.min - s2.min) - dt) < 3600, 'Giorni: trascinando a destra si va indietro nel tempo, stessa larghezza',
            JSON.stringify([(s.min - s2.min) / 86400, dt / 86400, W(s) / 86400, W(s2) / 86400]));
        ptr('pointerdown', 1, 'mouse', x, y); ptr('pointermove', 1, 'mouse', x + 5000, y); ptr('pointerup', 1, 'mouse', x + 5000, y); await sleep(60);
        const s3 = S();
        log(Math.abs(s3.min - FULL.min) < 60 && Math.abs(W(s3) - W(s)) < 60, 'Giorni: trascinando oltre l\'inizio ci si ferma al primo giorno', days(s3));
        const [xa, ya] = pt(0.5);
        histU.over.dispatchEvent(new MouseEvent('dblclick', { clientX:xa, clientY:ya, button:0, bubbles:true, cancelable:true })); await sleep(80);
        log(near(S(), FULL, 60), 'Giorni: doppio clic, di nuovo tutto il periodo', days(S()));
        eq('Giorni: dopo il doppio clic acceso "Tutto"', litR(), ['0']);
      }
      {                                                              // limiti: mai sotto 3 giorni, mai oltre tutto il periodo. Ai limiti la
                                                                     // rotellina resta al grafico solo nella coda dello stesso gesto (meno di
                                                                     // 300 ms dall'ultimo scatto tenuto); un gesto nuovo fa scorrere la pagina
        for(let i = 0; i < 25; i++) await wheel(0.5, -500);
        log(Math.abs(W(S()) - MINW) < 60, 'Giorni: zoom al massimo = 3 giorni', W(S()) / 86400);
        const ev = await wheel(0.5, -500);
        log(ev.defaultPrevented && Math.abs(W(S()) - MINW) < 60, 'Giorni: a 3 giorni, subito dopo uno scatto di zoom, la rotellina in su resta al grafico (coda del gesto)', W(S()) / 86400);
        await sleep(400);
        const evp = await wheel(0.5, -500);
        log(!evp.defaultPrevented && Math.abs(W(S()) - MINW) < 60, 'Giorni: a 3 giorni, dopo una pausa, la rotellina in su fa scorrere la pagina', W(S()) / 86400);
        await sleep(400);
        for(let i = 0; i < 25; i++) await wheel(0.3, 500);
        log(near(S(), FULL, 60), 'Giorni: zoom indietro al massimo = tutto il periodo, non oltre', days(S()));
        eq('Giorni: tornati a tutto il periodo si riaccende "Tutto"', litR(), ['0']);
        const evt = await wheel(0.5, 100);
        log(evt.defaultPrevented && near(S(), FULL, 60), 'Giorni: su tutto il periodo, subito dopo lo zoom, la rotellina in giù resta al grafico (coda del gesto)', '');
        await sleep(400);
        const ev2 = await wheel(0.5, 100);
        log(!ev2.defaultPrevented && near(S(), FULL, 60), 'Giorni: su tutto il periodo, dopo una pausa, la rotellina in giù fa scorrere la pagina', '');
        const ev2b = await wheel(0.5, -100);                                  // lo stesso gesto torna indietro: resta alla pagina, niente zoom
        log(!ev2b.defaultPrevented && near(S(), FULL, 60), 'Giorni: un gesto partito scorrendo la pagina e tornato indietro non zooma', days(S()));
        await sleep(400);
        { const s5 = S(), [xn, yn] = pt(0.5);                                 // Chrome: il resto di un gesto lasciato alla pagina non e' annullabile
          histU.over.dispatchEvent(new WheelEvent('wheel', { deltaY:-300, deltaMode:0, clientX:xn, clientY:yn, bubbles:true, cancelable:false })); await sleep(60);
          log(near(S(), s5, 60), 'Giorni: una rotellina non annullabile (pagina che sta già scorrendo) non zooma', days(S())); }
        const ev3 = await wheel(0.5, 30, { ctrlKey:true });                   // pizzico del trackpad (rotellina con Ctrl): mai lo zoom della pagina
        log(ev3.defaultPrevented, 'Giorni: il pizzico del trackpad resta al grafico', '');
        const s4 = S(); await wheel(0.4, -20, { ctrlKey:true });
        log(W(S()) < W(s4) * 0.9, 'Giorni: pizzico del trackpad (Ctrl + rotellina) che allarga: zoom', JSON.stringify([W(s4) / 86400, W(S()) / 86400]));
      }
      {                                                              // i periodi restano scorciatoie
        el('hvRange').querySelector('[data-r="90"]').click(); await sleep(120);
        log(near(S(), { min:last - 89 * 86400 - 43200, max:FULL.max }, 60) && litR().join() === '90', 'Giorni: "90 g" = gli ultimi 90 giorni, acceso', days(S()));
        await wheel(0.5, -100);
        eq('Giorni: zoom dopo "90 g": nessun periodo acceso', litR(), []);
        el('hvRange').querySelector('[data-r="0"]').click(); await sleep(120);
      }
      {                                                              // telefono: due dita, un dito di lato, doppio tocco
        const r = R(histU.over), y = Math.round(r.top + r.height / 2), X = f => Math.round(r.left + r.width * f), s = S();
        const a0 = X(0.4), b0 = X(0.6), a1 = X(0.3), b1 = X(0.7), vm = valX((a0 + b0) / 2);
        ptr('pointerdown', 11, 'touch', a0, y); ptr('pointerdown', 12, 'touch', b0, y); await sleep(20);
        ptr('pointermove', 11, 'touch', a1, y); ptr('pointermove', 12, 'touch', b1, y); await sleep(20);
        ptr('pointerup', 11, 'touch', a1, y); ptr('pointerup', 12, 'touch', b1, y); await sleep(80);
        const s2 = S(), want = W(s) * (b0 - a0) / (b1 - a1);          // dita da (b0 - a0) a (b1 - a1): circa x2
        log(Math.abs(W(s2) - want) < 3600 && Math.abs(valX((a1 + b1) / 2) - vm) < 3600, 'Giorni: due dita che si allargano, zoom x2 attorno al centro',
            JSON.stringify([W(s) / 86400, W(s2) / 86400, want / 86400, (valX((a1 + b1) / 2) - vm) / 3600]));
        const c0 = X(0.5), c1 = X(0.65);
        ptr('pointerdown', 13, 'touch', c0, y); ptr('pointermove', 13, 'touch', X(0.575), y); ptr('pointermove', 13, 'touch', c1, y);
        ptr('pointerup', 13, 'touch', c1, y); await sleep(80);
        const s3 = S(), dt = (c1 - c0) / r.width * W(s2);
        log(Math.abs(W(s3) - W(s2)) < 60 && Math.abs((s2.min - s3.min) - dt) < 3600, 'Giorni: un dito di lato sposta il periodo',
            JSON.stringify([(s2.min - s3.min) / 86400, dt / 86400]));
        const tip = histU.over.querySelector('.ctip');
        log(vis(tip) && /\d{4}/.test(tipText(tip)), 'Giorni: al tocco il riquadro del giorno', tipText(tip));
        for(const k of [0, 1]){ ptr('pointerdown', 14 + k, 'touch', X(0.5), y); ptr('pointerup', 14 + k, 'touch', X(0.5), y); await sleep(60); }
        log(near(S(), FULL, 60), 'Giorni: doppio tocco, di nuovo tutto il periodo', days(S()));
        log(getComputedStyle(histU.over).touchAction === 'pan-y', 'Giorni: in verticale il dito fa scorrere la pagina (touch-action pan-y)', getComputedStyle(histU.over).touchAction);
        noOverflow('Pioggia/Giorni, dopo il pizzico');
      }
      for(const w of ['mesi', 'giorni', 'anni', 'giorni']){              // ridisegni: gli ascoltatori non si sommano
        el('hvView').querySelector('[data-w="' + w + '"]').click(); await until(() => histView === w && !!histU, 8000); await sleep(200);
      }
      { const s = S(); await wheel(0.5, -100); const k = W(S()) / W(s);
        log(k > 0.83 && k < 0.91, 'Giorni: dopo quattro cambi di vista uno scatto di rotellina zooma una volta sola', k.toFixed(3)); }
      {                                                              // lo zoom resta passando per Mesi; chiuso e riaperto lo Storico, di nuovo tutto il periodo
        const s = S();
        for(const w of ['mesi', 'giorni']){ el('hvView').querySelector('[data-w="' + w + '"]').click(); await until(() => histView === w && !!histU, 8000); await sleep(200); }
        log(W(s) < W(FULL) * 0.95 && near(S(), s, 60) && litR().length === 0, 'Giorni: lo zoom resta dopo un giro in Mesi', days(S()));
        await setHistMode(false); await setHistMode(true, 'PREC', 'giorni'); await until(() => !!histU && histU.scales.x.min != null, 8000); await sleep(200);
        log(near(S(), FULL, 60) && litR().join() === '0', 'Giorni: chiuso e riaperto lo Storico, di nuovo tutto il periodo', days(S()));
      }
      el('hvRange').querySelector('[data-r="0"]').click(); await sleep(120);
    }
    histVar = 'TEMP'; currentVar = 'TEMP'; histView = 'mesi'; await renderHist(); okView('Temperatura/Mesi');
    log(!!histU && histU.series.some(s => s.scale === 'cum') === false, 'Temperatura/Mesi: cumulata sull\'asse destro assente', histU && histU.series.map(s => s.scale).join(','));
    noKey('Temperatura/Mesi');
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
    noOverflow('Temperatura/Tabella');
    histView = 'mesi'; await renderHist();
    // Anni della temperatura: l'anno scelto sulla fascia fra il minimo e il massimo degli anni, con la loro media; sotto, leggere e
    // dello stesso colore, le linee di tutti gli anni
    histView = 'anni'; await renderHist(); okView('Temperatura/Anni');
    {
      eq('Temperatura/Anni: le viste restano Giorni, Mesi, Anni, Tabella, nessun pulsante in piu\'', [[...el('hvView').children].filter(vis).map(b => b.dataset.w), el('hvYrs')],
         [['giorni', 'mesi', 'anni', 'tabella'], null]);
      // serie: sotto le linee leggere di tutti gli anni, poi la fascia (massimo, minimo), la media e l'anno scelto
      const S = () => histU.series, N = () => S().length, D = k => histU.data[k], yearsData = () => tYears.map((y, k) => D(k + 1));
      eq('Temperatura/Anni: serie (anni leggeri; fascia: massimo e minimo; media; anno)', S().slice(1).map(s => String(s.label)),
         [...tYears.map(String), 'max', 'min', 'media', String(tLast)]);
      eq('Temperatura/Anni: si apre sull\'ultimo anno (' + tLast + '), medie mensili', D(N() - 1), MESI.map((_, m) => tMean(tLast, m)));
      eq('Temperatura/Anni: una linea leggera per anno, medie mensili', yearsData(), tYears.map(y => MESI.map((_, m) => tMean(y, m))));
      eq('Temperatura/Anni: fascia fra il massimo e il minimo degli anni', [D(N() - 4), D(N() - 3)],
         [MESI.map((_, m) => tStat(m) && tStat(m).hi), MESI.map((_, m) => tStat(m) && tStat(m).lo)]);
      eq('Temperatura/Anni: media degli anni, mese per mese', D(N() - 2), MESI.map((_, m) => tStat(m) && tStat(m).mean));
      log((histU.bands || []).length === 1 && histU.bands[0].series.join() === (N() - 4) + ',' + (N() - 3) && !!histU.bands[0].fill,
          'Temperatura/Anni: fascia colorata fra massimo e minimo', JSON.stringify(histU.bands));
      const cs = S().map((s, k) => k ? colorOf(typeof s.stroke === 'function' ? s.stroke(histU, k) : s.stroke) : null), yc = rgbOf(cs[N() - 1]);
      log(yc[2] - yc[0] >= 60 && S()[N() - 1].width > Math.max(...S().slice(1, N() - 1).map(s => s.width)) && chroma(cs[N() - 2]) < 0.1,
          'Temperatura/Anni: anno in blu e più spesso, media grigia', JSON.stringify([cs, S().map(s => s.width)]));
      log(!!(S()[N() - 2].dash || []).length && !(S()[N() - 1].dash || []).length, 'Temperatura/Anni: media tratteggiata, anno a linea piena', '');
      const alpha = c => { const v = String(c).match(/[\d.]+/g) || []; return v.length > 3 ? +v[3] : 1; }, faint = cs.slice(1, tYears.length + 1);
      log(new Set(faint).size === 1 && alpha(faint[0]) <= 0.4 && S().slice(1, tYears.length + 1).every(s => s.width <= 1 && !(s.dash || []).length),
          'Temperatura/Anni: linee degli anni leggere, sottili, tutte dello stesso colore', JSON.stringify([faint, S().slice(1, tYears.length + 1).map(s => s.width)]));
      noKey('Temperatura/Anni');
      const yp = el('hvChart').querySelector('.hv-yrs'), ypb = yp ? [...yp.querySelectorAll('button')] : [];
      eq('Temperatura/Anni: sopra il grafico un pulsante per anno, acceso l\'ultimo', [ypb.map(b => b.textContent.trim()), ypb.filter(b => b.classList.contains('on')).map(b => b.textContent.trim())],
         [tYears.map(String), [String(tLast)]]);
      log(vis(yp) && R(yp).bottom <= R(histU.over).top - 10 && ypb.length > 0 && inside(ypb[ypb.length - 1]), 'Temperatura/Anni: anni sopra il grafico, dentro lo schermo',
          yp && JSON.stringify([R(yp).bottom, R(histU.over).top]));
      const labs = () => [...histU.over.parentNode.children].filter(e => vis(e) && /^\d{4}$/.test(e.textContent.trim()));
      eq('Temperatura/Anni: niente nomi sul grafico (l\'anno lo dice il pulsante acceso)', labs().map(l => l.textContent.trim()), []);
      const tipFor = (y, m) => { const v = tMean(y, m), s = tStat(m);
        return [MESI[m], ...(v != null ? [y + ' ' + withDev(v, s)] : []),
                ...(s ? ['media ' + f1(s.mean) + ' °C', 'min ' + f1(s.lo) + ' · max ' + f1(s.hi)] : []),
                ...(v != null && !ET[y + '-' + m].full ? ['incompleto'] : [])].join(' | '); };
      await okTip('Temperatura/Anni, agosto', 7, tipFor(tLast, 7));
      const t = el('hvChart').querySelector('.ctip');
      eq('Temperatura/Anni: nel riquadro i segni di anno, media (tratteggio) e fascia (pieno)', t ? [...t.querySelectorAll('.sw')].map(s => getComputedStyle(s).borderTopStyle) : null,
         ['solid', 'dashed', 'none']);
      const y0 = [histU.scales.y.min, histU.scales.y.max], prev = tYears[tYears.length - 2];
      ypb.find(b => b.textContent.trim() === String(prev)).click(); await until(() => histU && String(S()[N() - 1].label) === String(prev), 5000); await sleep(200);
      eq('Temperatura/Anni: clic su ' + prev + ': il suo anno in primo piano, le linee leggere restano', [histYear, String(S()[N() - 1].label), D(N() - 1), yearsData()],
         [prev, String(prev), MESI.map((_, m) => tMean(prev, m)), tYears.map(y => MESI.map((_, m) => tMean(y, m)))]);
      eq('Temperatura/Anni: cambiando anno l\'asse resta fermo', [histU.scales.y.min, histU.scales.y.max], y0);
      eq('Temperatura/Anni: acceso ' + prev, [...el('hvChart').querySelectorAll('.hv-yrs .on')].map(b => b.textContent.trim()), [String(prev)]);
      await okTip('Temperatura/Anni ' + prev + ', settembre (incompleto)', 8, tipFor(prev, 8));
      await tipEdges('Temperatura/Anni');
      noOverflow('Temperatura/Anni');
      document.body.classList.add('dark'); await renderHist(); await sleep(100);
      { const c = colorOf(S()[N() - 1].stroke), f = colorOf(S()[1].stroke);
        log(c !== cs[N() - 1] && contrastC(c, colorOf('var(--bg)')) >= 3 && f !== cs[1], 'Temperatura/Anni, tema scuro: anno leggibile, linee degli anni chiare',
            JSON.stringify([c, cs[N() - 1], f])); }
      document.body.classList.remove('dark'); await renderHist(); await sleep(100);
    }
    {                                                                // un anno solo: la sua linea, niente fascia, media ne' anni da scegliere
      const key = V._region + '|' + V.scode, keep = histCache[key], i0 = raw.tm.findIndex((x, i) => x != null && dayOf(i).getUTCFullYear() === tLast);
      const one = Object.assign({}, raw, { d0:dayOf(i0).toISOString().slice(0, 10).replace(/-/g, '') });
      ['p', 'hp', 'tn', 'tx', 'tm', 'ht'].forEach(k => { if(raw[k]) one[k] = raw[k].slice(i0); });
      histCache[key] = { t:Date.now(), h:prepHist(one) };
      await renderHist();
      eq('un anno solo: niente anni da scegliere, niente chiave, una linea leggera sotto la sua', [!!el('hvChart').querySelector('.hv-yrs'), !!el('hvChart').querySelector('.hv-key'),
         histU && histU.series.length, histU && histU.data[histU.series.length - 2].every(v => v == null)], [false, false, 6, true]);
      histCache[key] = keep; await renderHist();
    }
    histYear = null;
    histView = 'giorni'; await renderHist(); okView('Temperatura/Giorni');
    noKey('Temperatura/Giorni');
    for(const r of [30, 90, 365, 0]){ el('hvRange').querySelector('[data-r="' + r + '"]').click(); await sleep(100); }
    log(!!el('hvChart').querySelector('canvas') && !el('hvChart').querySelector('.hint'), 'Temperatura/Giorni: tutti i periodi senza errori', '');
    el('hvRange').querySelector('[data-r="30"]').click(); await sleep(150);
    { const i = dayWith(false); await okTip('Temperatura/Giorni, ' + dayOf(i).toISOString().slice(0, 10), d0 / 1000 + 86400 * i, dayTxt(false, i)); }
    // i pulsanti veri (clic DOM) cambiano vista e variabile
    el('hvView').querySelector('[data-w="mesi"]').click(); await sleep(300);
    el('hvVar').querySelector('[data-v="PREC"]').click(); await sleep(300);
    eq('clic su Mesi e Pioggia', [histView, histVar, currentVar], ['mesi', 'PREC', 'PREC']);

    // CSV: una riga per giorno
    // il testo si prende quando nasce il Blob: leggerlo dopo (blob.text()) non lo segue il tempo virtuale di Chrome headless,
    // l'orologio poteva saltare al giro del radar (120 s) e run.sh finiva il suo tempo senza risultato
    let csv = null, csvText = null; const oc = URL.createObjectURL, oclick = HTMLAnchorElement.prototype.click, OB = window.Blob;
    window.Blob = function(parts, o){ csvText = (parts || []).join(''); return new OB(parts, o); };
    URL.createObjectURL = b => { csv = b; return 'blob:test'; };
    HTMLAnchorElement.prototype.click = function(){ if(this.download) csv = csv || true; else oclick.call(this); };
    await exportCsv();
    URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = oclick; window.Blob = OB;
    const lines = csv && csvText != null ? csvText.trim().split('\n') : [];
    const days = lines.slice(1).map(l => l.split(';')[0]);
    eq('CSV: intestazione', lines[0], 'data;pioggia_mm;ore_pioggia;tmin;tmax;tmedia;ore_temp');
    eq('CSV: una riga per giorno con dati', lines.length - 1, nrow);
    log(new Set(days).size === days.length && days.every((d, i) => i === 0 || d > days[i - 1]) && days[0] === '2024-10-23', 'CSV: giorni distinti e in ordine', days.slice(0, 3).join(','));
    log(lines.slice(1).every(l => l.split(';').length === 7), 'CSV: sette colonne', '');
    const k = raw.p.findIndex((x, i) => x != null && raw.hp[i] != null && raw.tn[i] != null && raw.tx[i] != null && raw.tn[i] !== raw.tx[i] && raw.tm[i] != null && raw.ht[i] != null);
    const ds = dayOf(k).toISOString().slice(0, 10), row = (lines.find(l => l.startsWith(ds + ';')) || '').split(';');
    eq('CSV: ' + ds + ' uguale al file (pioggia, ore, tmin, tmax, tmedia, ore)', row.slice(1).map(Number), [raw.p[k], raw.hp[k], raw.tn[k], raw.tx[k], raw.tm[k], raw.ht[k]]);
    log(+row[3] < +row[4], 'CSV: tmin < tmax', row.join(';'));

    // PNG di ogni vista dello Storico (grafico ridisegnato grande; Tabella disegnata)
    {
      const pngs = [], real = window.deliverPNG;
      window.deliverPNG = async (b, f) => { pngs.push({ f, kb: Math.round(b.size / 1024) }); };
      for(const [v, w] of [['PREC', 'giorni'], ['PREC', 'mesi'], ['PREC', 'anni'], ['PREC', 'tabella'], ['TEMP', 'mesi'], ['TEMP', 'anni'], ['TEMP', 'tabella']]){
        histVar = currentVar = v; histView = w; await renderHist(); await sleep(200);
        const n = pngs.length;
        await exportPNG(); await until(() => pngs.length > n, 8000);
        const g = pngs[n];
        log(!!g && g.kb > (w === 'tabella' ? 20 : 40) && g.f === pngBase() + '_storico_' + v + '_' + w + '.png',
            'PNG Storico ' + v + '/' + w, JSON.stringify(g || null));
      }
      window.deliverPNG = real;
      histView = 'mesi'; histVar = currentVar = 'PREC'; await renderHist();
    }

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

  // Scheda della stazione: riga 1 nome e azioni; riga 2 le variabili e, a destra, periodi, Storico e Confronta (sul
  // telefono i tempi hanno una riga loro, sopra le variabili); poi il grafico.
  // Desktop (w.html 1024x768): grafico entro 75 px dalla barra delle schede. Telefono (w.html 320/375/430, FVG/A280 con
  // molte variabili): niente scorre di lato, tutto va a capo e resta dentro lo schermo, le azioni restano visibili.
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
    const acts = () => ['refresh', 'expBtn'].filter(id => vis(el(id)));
    const tools = () => [...document.querySelectorAll('#modes .mode, #pviews .mode')].filter(vis);
    const names = () => [...el('vars').querySelectorAll('button')].filter(vis);
    const below = (es, top) => es.every(e => R(e).top >= top - 1);
    const actsOk = (tag, want) => {                                  // dentro lo schermo e non coperte
      const bad = want.filter(id => { const e = el(id); if(!vis(e)) return true;
        const r = R(e), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.left < -0.5 || r.right > innerWidth + 0.5 || !(h && e.contains(h)); });
      eq(tag + ': azioni visibili e intere', bad, []);
    };
    const noScroller = tag => {
      const sc = [...el('panel').querySelectorAll('#phead *, #pbar, #pbar *')].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowX));
      eq(tag + ': niente righe che scorrono di lato', sc.map(e => e.id || e.className), []);
    };
    const M = { w:innerWidth, h:innerHeight };
    setMapVar(''); await until(() => filterVar === '');

    // riga 1 e riga 2 (Padova: tre variabili)
    await open(P); await until(() => vis(el('histbtn')), 5000);
    const name = el('stationName');
    log(/^234\b/.test(name.title) && !vis(el('stationMeta')), 'riga 1: codice e ultimo dato nel titolo del nome, niente scritte accanto', name.title);
    eq('riga 1: azioni', acts(), ['refresh', 'expBtn']);
    log(sameRow([name, ...acts().map(el)]), 'riga 1: il nome e le azioni', JSON.stringify([name, ...acts().map(el)].map(e => Math.round(mid(e)))));
    if(phone){
      const nv = el('stNow');
      log(vis(nv) && R(nv).top >= R(name).bottom - 1 && R(nv).right <= innerWidth + 0.5 && R(name).width >= 60,
          'telefono: il valore sotto il nome, dentro lo schermo', JSON.stringify([R(nv).top, R(name).bottom, R(nv).right, R(name).width]));
    }
    eq('periodi, Storico, Confronta', tools().map(b => b.dataset.mode || b.id), ['mn', 'day', 'day3', 'week', 'histbtn', 'cmpBtn']);
    const n2 = names(), tl = tools();
    log(n2.length >= 3 && below([...n2, ...tl], R(name).bottom) && [...n2, ...tl].every(e => R(e).bottom <= R(el('chart')).top + 1),
        'variabili e tempi fra il nome e il grafico', JSON.stringify([...n2, ...tl].map(e => Math.round(mid(e)))));
    if(!phone){
      log(sameRow([n2[0], ...tl]), 'riga 2: le variabili e, sulla stessa riga, periodi, Storico e Confronta',
          JSON.stringify([n2[0], ...tl].map(e => Math.round(mid(e)))));
      eq('riga 2: i tempi a destra, allineati alle azioni', Math.round(Math.max(...tl.map(e => R(e).right))), Math.round(R(el('expBtn')).right));
    } else log(below(n2, Math.max(...tl.map(e => R(e).bottom))), 'telefono: periodi e viste su una riga, poi le variabili',
               JSON.stringify([...tl, ...n2].map(e => Math.round(mid(e)))));
    {                                                   // ogni comando ha il suo bordo: si vede dove cliccare
      const boxes = [el('modes'), ...document.querySelectorAll('#pviews .mode, #pact .act, #vars .vn, #altBtn, #stackbtn')].filter(vis);
      log(boxes.length > 8 && boxes.every(e => getComputedStyle(e).borderTopWidth !== '0px'), 'comandi con il bordo (chip e gruppi a segmenti)',
          JSON.stringify(boxes.filter(e => getComputedStyle(e).borderTopWidth === '0px').map(e => e.id || e.className)));
      const on = el('vars').querySelector('.vn.on');
      log(!!on && getComputedStyle(on).borderTopColor === on.style.getPropertyValue('--c').replace(/#(..)(..)(..)/, (m, a, b, c) =>
          'rgb(' + [a, b, c].map(h => parseInt(h, 16)).join(', ') + ')'), 'chip scelta: bordo del colore della variabile', on ? getComputedStyle(on).borderTopColor : '');
    }
    M.normale = gap('chart');
    if(!phone) log(M.normale <= 75, 'normale: grafico a ' + M.normale + ' px dalla barra delle schede (al massimo 75)', M.normale);
    noScroller('normale');

    // "Confronta": un comando, un menu con i tre confronti
    const cb = el('cmpBtn'), cm = el('cmpMenu');
    const item = m => cm.querySelector('[data-mode="' + m + '"]');
    const esc = () => fa().dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
    const openCmp = async () => { cb.focus(); cb.click(); await sleep(60); };
    log(!vis(cm) && cb.getAttribute('aria-haspopup') === 'menu' && cb.getAttribute('aria-expanded') === 'false' && cb.textContent.trim() === 'Confronta',
        'Confronta: chiuso all\'inizio', cb.outerHTML.slice(0, 120));
    await openCmp();
    log(vis(cm) && cb.getAttribute('aria-expanded') === 'true', 'Confronta: si apre', '');
    eq('Confronta: le quattro voci', [...cm.querySelectorAll('[data-mode]')].map(b => [b.dataset.mode, b.textContent.trim()]),
       [['compare', '7 giorni'], ['compare30', '30 giorni'], ['tabs', 'Schede'], ['near', 'Vicine']]);
    {
      const r = R(cm), b = R(item('tabs')), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      log(cm.contains(hit) && r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
          'Confronta: menu sopra il grafico e dentro lo schermo', JSON.stringify([r.left, r.right, r.bottom, hit && (hit.id || hit.className || hit.tagName)]));
    }
    log(cm.contains(fa()) && fa().dataset.mode === 'compare', 'Confronta: il fuoco entra sulla prima voce', fa() && (fa().dataset.mode || fa().id || fa().tagName));
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true }));
    eq('Confronta: freccia giù', fa().dataset.mode, 'compare30');
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'End', bubbles:true }));
    eq('Confronta: Fine', fa().dataset.mode, 'near');
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowUp', bubbles:true }));
    eq('Confronta: freccia su', fa().dataset.mode, 'tabs');
    esc(); await sleep(60);
    log(!vis(cm) && fa() === cb && cb.getAttribute('aria-expanded') === 'false', 'Confronta: Esc chiude e il fuoco torna al comando', fa() && (fa().id || fa().tagName));
    await openCmp();
    fa().dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', bubbles:true, cancelable:true }));
    log(!vis(cm) && fa() === cb, 'Confronta: Tab chiude', fa() && (fa().id || fa().tagName));
    await openCmp();
    name.click(); await sleep(60);
    log(!vis(cm), 'Confronta: clic fuori chiude', '');
    for(const [m, lab] of [['compare', 'Confronto 7 g'], ['compare30', 'Confronto 30 g']]){
      await openCmp(); item(m).click();
      await until(() => chartMode === m && !!el('chart').querySelector('canvas'), 8000); await sleep(300);
      const lit = [...document.querySelectorAll('#modes .mode')].filter(b => b.classList.contains('active'));
      log(chartMode === m && !vis(cm) && cb.classList.contains('active') && cb.textContent.includes(lab) && !lit.length,
          'Confronta: ' + lab + ' scelto, acceso sul comando', [chartMode, vis(cm), cb.className, cb.textContent, lit.length].join(' | '));
      log(!!chart && chart.series.length > 3 && !el('vars').querySelector('.vp'), 'Confronta: ' + lab + ': giorni sovrapposti, niente "+"', chart && chart.series.length);
      await openCmp();
      eq('Confronta: ' + lab + ' segnato nel menu', [...cm.querySelectorAll('[data-mode]')].map(b => b.classList.contains('on')), [m === 'compare', m === 'compare30', false, false]);
      esc(); await sleep(60);
    }
    document.querySelector('#modes [data-mode="week"]').click(); await until(() => chartMode === 'week'); await sleep(200);
    log(!cb.classList.contains('active') && cb.textContent.trim() === 'Confronta' && document.querySelector('#modes [data-mode="week"]').classList.contains('active'),
        'Confronta: 7 g lo spegne', cb.className + ' ' + cb.textContent);

    // Confronto schede: niente Confronta e Storico; CSV delle serie confrontate e PNG
    await open(A); await open(V); await open(P);
    await openCmp(); item('tabs').click();
    await until(() => document.body.classList.contains('view-compare') && !!chart, 8000); await sleep(300);
    log(document.body.classList.contains('view-compare') && !vis(cm) && el('stationName').textContent === 'Confronto schede',
        'Confronta: "Confronto schede" apre la scheda Confronto', '');
    eq('Confronto schede: niente Confronta né Storico', [vis(cb), vis(el('histbtn'))], [false, false]);
    eq('Confronto schede: azioni', acts(), ['expBtn']);
    {                                                   // la legenda delle stazioni accanto al grafico, mai sotto le linee
      const a = R(chart.root.querySelector('canvas')), b = R(el('chartlegend'));
      const cross = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      log(vis(el('chartlegend')) && !cross, 'Confronto schede: la legenda non sta sotto le linee',
          JSON.stringify([a.left, a.right, a.bottom, b.left, b.top].map(Math.round)));
    }
    {
      let text = null; const OB = window.Blob, oc = HTMLAnchorElement.prototype.click;
      window.Blob = function(parts, o){ text = (parts || []).join(''); return new OB(parts, o); };
      HTMLAnchorElement.prototype.click = function(){ if(!this.download) oc.call(this); };
      await exportCsv();
      window.Blob = OB; HTMLAnchorElement.prototype.click = oc;
      const lines = text ? text.trim().split('\n') : [];
      log(lines.length > 10 && /^datetime,".+",".+"/.test(lines[0]) && lines.slice(1).every(l => /^\d{4}-\d\d-\d\dT\d\d:\d\d,/.test(l)),
          'Confronto schede: CSV con una colonna per stazione', lines.slice(0, 2).join(' | '));
    }
    {
      let got = null; const real = window.deliverPNG;
      window.deliverPNG = async (b, f) => { got = { f, kb: Math.round(b.size / 1024) }; };
      await exportPNG(); await until(() => got, 8000);
      window.deliverPNG = real;
      log(!!got && got.kb > 40 && /^confronto_schede_/.test(got.f), 'Confronto schede: PNG', JSON.stringify(got));
    }
    {                                                   // solo le variabili con dati in almeno due schede
      const has = (t, v) => !!t.props._table && (t.props._table.cols[v] || []).some(x => x != null);
      const n = v => openTabs.filter(t => has(t, v)).length;
      const vars = [...new Set(openTabs.flatMap(t => t.props.variables || []))];
      const offered = [...el('vars').querySelectorAll('.vn')].map(e => e.dataset.var);
      if(vis(el('altBtn'))){
        el('altBtn').click(); await sleep(60);
        offered.push(...[...el('altMenu').querySelectorAll('[data-var]')].map(b => b.dataset.var));
        altClose(); await sleep(60);
      }
      log(openTabs.length >= 3 && vars.some(v => n(v) === 1) && vars.some(v => n(v) === 2),
          'Confronto schede: tre schede, variabili in una sola e in due',
          JSON.stringify([openTabs.length, vars.map(v => v + ':' + n(v))]));
      eq('Confronto schede: chips e "Altro" solo con le variabili di almeno due schede',
         offered.slice().sort(), vars.filter(v => n(v) >= 2).sort());
    }
    {                                                   // come nella scheda: in vista le principali, il resto in "Altro"
      const all = compareVars.slice(), main = all.filter(v => isMainVar(v, all)), rest = all.filter(v => !isMainVar(v, all));
      const chips = () => [...el('vars').querySelectorAll('.vn')].map(e => e.dataset.var);
      log(rest.length > 0, 'Confronto schede: le schede hanno anche misure secondarie', JSON.stringify(rest));
      eq('Confronto schede: in vista le misure principali', chips(), main);
      log(vis(el('altBtn')), 'Confronto schede: il resto in "Altro"', '');
      if(vis(el('altBtn'))){
        el('altBtn').click(); await sleep(60);
        const items = [...el('altMenu').querySelectorAll('[data-var]')].map(b => b.dataset.var), v = items[0];
        eq('Confronto schede: "Altro" elenca le altre', items.slice().sort(), rest.slice().sort());
        el('altMenu').querySelector('[data-var="' + v + '"]').click();
        await until(() => compareVar === v, 8000); await sleep(300);
        const on = el('vars').querySelector('.vn.on');
        log(compareVar === v && el('altMenu').hidden && chips().includes(v) && !!on && on.dataset.var === v,
            'Confronto schede: scelta da "Altro", confrontata e nella riga', JSON.stringify([compareVar, chips()]));
        el('vars').querySelector('.vn[data-var="' + main[0] + '"] .vb').click(); await sleep(300);
        eq('Confronto schede: tornando a una principale, l\'altra lascia la riga', chips(), main);
      }
    }
    closeCompare(); await sleep(100);

    // Storico: "Storico" acceso fra le viste; nella riga 2 la sua barra; un periodo ne esce
    await open(V); await until(() => vis(el('histbtn')), 5000);
    const hb = el('histbtn');
    hb.click(); await until(() => histMode && !!histU, 8000); await sleep(300);
    log(histMode && hb.classList.contains('active') && hb.getAttribute('aria-pressed') === 'true' && hb.textContent.trim() === 'Storico',
        'Storico: acceso fra le viste', hb.outerHTML.slice(0, 120));
    log(![...el('vars').children].some(vis) && ['hvVar', 'hvView', 'hvRange'].every(id => vis(el(id))), 'Storico: nella riga 2 la sua barra', '');
    if(!phone) log(sameRow([el('hvVar'), ...tools()]), 'Storico: la sua barra e i tempi sulla stessa riga',
                   JSON.stringify([el('hvVar'), ...tools()].map(e => Math.round(mid(e)))));
    eq('Storico: azioni', acts(), ['expBtn']);
    log(![...document.querySelectorAll('#modes .mode')].some(b => b.classList.contains('active')), 'Storico: nessun periodo acceso', '');
    M.storico = gap('hvChart');
    if(!phone) log(M.storico <= 75, 'Storico (Valdagno): grafico a ' + M.storico + ' px dalla barra delle schede (al massimo 75)', M.storico);
    {
      const hb = histU && histU.root.getBoundingClientRect(), nb = el('hvNote').getBoundingClientRect(), pb = el('panel').getBoundingClientRect();
      M.storicoAlto = hb ? Math.round(hb.height) : 0;
      if(!phone) log(!!hb && pb.bottom - nb.bottom < 80 && hb.height > 330, 'Storico: il grafico riempie la scheda come gli altri',
                     JSON.stringify([Math.round(hb && hb.height), Math.round(pb.bottom - nb.bottom)]));
      else log(!!hb && Math.abs(hb.height - Math.max(220, Math.round(innerHeight * 0.46))) < 40, 'telefono: Storico alto come il grafico delle misure',
               JSON.stringify([Math.round(hb && hb.height), innerHeight]));
    }
    el('hvView').querySelector('[data-w="mesi"]').click(); await until(() => histView === 'mesi' && !!histU, 8000); await sleep(300);
    log(!vis(el('hvRange')), 'Storico/Mesi: niente periodo dei giorni', '');
    if(phone){ actsOk('telefono, Storico', ['expBtn']); noOverflow('telefono, Storico'); }
    document.querySelector('#modes [data-mode="day3"]').click(); await until(() => !histMode && !!el('chart').querySelector('canvas'), 8000); await sleep(300);
    log(!histMode && chartMode === 'day3' && !hb.classList.contains('active') && [...el('vars').children].some(vis),
        'un periodo esce dallo Storico: tornano le variabili', '');
    hb.click(); await until(() => histMode, 8000); await sleep(300);
    hb.click(); await until(() => !histMode && !!el('chart').querySelector('canvas'), 8000); await sleep(200);
    log(!histMode && !vis(el('histview')), 'Storico: un secondo clic ne esce', '');
    document.querySelector('#modes [data-mode="week"]').click(); await sleep(200);

    // telefono: Arba (12 variabili) e la stazione dal nome piu' lungo
    if(phone){
      await open(A);
      const n = names(), last = n[n.length - 1];
      log(n.length >= 7 && below(n, Math.max(...tools().map(e => R(e).bottom))) && n.every(e => R(e).right <= innerWidth + 0.5 && R(e).bottom <= R(el('chart')).top + 1),
          'telefono, Arba: ' + n.length + ' comandi nella riga 2, a capo e dentro lo schermo', JSON.stringify([...new Set(n.map(e => Math.round(mid(e))))]));
      const h = last && document.elementFromPoint(R(last).left + R(last).width / 2, R(last).top + R(last).height / 2);
      log(!!h && last.contains(h), 'telefono, Arba: l\'ultimo comando si tocca', last ? last.textContent : '');
      log(n.every(e => R(e).height >= 28), 'telefono: comandi alti almeno 28 px', JSON.stringify(n.map(e => Math.round(R(e).height))));
      actsOk('telefono, Arba', ['refresh', 'expBtn']);
      noOverflow('telefono, Arba');
      noScroller('telefono, Arba');
      M.telefono = gap('chart');
      const long = allFeatures.map(f => f.properties).filter(p => (p.variables || []).some(v => varCat(v) === 'dirette'))
                              .reduce((a, p) => prettyName(p.name || p.scode).length > prettyName(a.name || a.scode).length ? p : a);
      await open(long);
      actsOk('telefono, nome lungo (' + prettyName(long.name) + ')', ['refresh', 'expBtn']);
      noOverflow('telefono, nome lungo');
      log(name.scrollWidth <= name.clientWidth + 1, 'telefono, nome lungo: nome intero (va a capo, non tagliato)', JSON.stringify([name.scrollWidth, name.clientWidth]));
    } else {                                            // tante variabili: a capo a sinistra, i tempi restano in alto a destra
      await open(A);
      const n = names(), tl = tools(), left = Math.min(...tl.map(e => R(e).left));
      log(n.length >= 7 && sameRow([n[0], ...tl]) && n.every(e => R(e).right <= left - 8),
          'Arba: le variabili vanno a capo a sinistra, i tempi restano in alto a destra',
          JSON.stringify([Math.round(left), ...new Set(n.map(e => Math.round(mid(e))))]));
      noOverflow('Arba');
    }
    showMapView();
    eq('errori JS', window.__errs, []);
    finish('MISURE ' + JSON.stringify(M));
  }

  // niente scritte che non servono, numeri solo al cursore, difetti chiusi (Teolo: vento e Storico dal 2022;
  // Chiampo a Chiampo: un livello che varia di pochi centimetri)
  async function suitePulizia(){
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    const R = e => e.getBoundingClientRect();
    const st = (reg, sc) => (allFeatures.find(f => f.properties._region === reg && f.properties.scode === sc) || {}).properties;
    const T = st('VEN', '170'), L = st('VEN', '679');
    log(T && L, 'stazioni di prova trovate', JSON.stringify([!!T, !!L]));
    if(!(T && L)) return finish();
    const open = async p => {
      await selectStation(p);
      await until(() => currentStation === p && !!el('chart').querySelector('canvas'), 8000);
      await sleep(300);
    };
    const decs = s => (String(s).split('.')[1] || '').length;
    const sameDecs = vals => {
      const v = vals.filter(s => s !== '' && s != null);
      return v.length > 1 && v.every(s => !/,/.test(s) && decs(s) === decs(v[0]));
    };
    const yVals = u => u.axes.filter(a => a.scale && a.scale !== 'x' && a._values && a._show !== false).map(a => a._values);
    const lastOf = (u, i) => { const d = u.data[i]; for(let j = d.length - 1; j >= 0; j--) if(d[j] != null) return j; return -1; };
    const labs = u => u._labs && !u._labs.hidden ? [...u._labs.querySelectorAll('.cl-v')].map(e => e.textContent.trim()) : [];

    eq('titolo della pagina come il nome in alto', document.title, 'Simulaqua Meteo');
    setMapVar(''); await until(() => filterVar === '');

    // Fonti: verde quando una fonte va al suo passo normale, rosso solo quando e' ferma davvero
    {
      const now = nowRome(), ago = h => new Date(now - h * 3600e3).toISOString().slice(0, 16);
      const S = (reg, h, old, n) => srcState(reg, { latest:ago(h), n:n || 100, old:old || 0 }, now);
      eq('Fonti: ARPAE aria (una volta al giorno) dopo 17 h è verde', S('AQ_ER', 17), 'g');
      eq('Fonti: ARPAE meteo dopo 2 h è verde', S('ER', 2), 'g');
      eq('Fonti: OSMER dopo 2 h è verde', S('FVG', 2), 'g');
      eq('Fonti: Piemonte dopo 5 h è verde', S('PIE', 5), 'g');
      eq('Fonti: Bolzano con un terzo delle stazioni a passo lento è verde', S('BZ', 0.5, 76, 226), 'g');
      eq('Fonti: Veneto fermo da 10 h è rosso', S('VEN', 10), 'r');
      eq('Fonti: ARPAE aria ferma da 5 giorni è rossa', S('AQ_ER', 120), 'r');
      await until(() => _lastStatus, 10000);
      renderSrcPanel();
      const tx = el('srcpanel').textContent;
      log(!/staz\. indietro|dati mancanti/.test(tx), 'Fonti: niente conteggi di stazioni indietro', tx.slice(-120));
    }

    // tacche: passi 1, 2, 5 e gli stessi decimali su tutto l'asse
    eq('tacche: stessi decimali, col punto', tickTexts(null, [175.8, 175.85, 175.9, 175.95, 176]),
       ['175.80', '175.85', '175.90', '175.95', '176.00']);
    eq('tacche: interi senza decimali né migliaia', tickTexts(null, [1000, 1500, 2000]), ['1000', '1500', '2000']);
    log(TICK_STEPS.every(s => [1, 2, 5].some(k => Math.abs(s / Math.pow(10, Math.floor(Math.log10(s) + 1e-9)) - k) < 1e-9)),
        'tacche: passi 1, 2, 5 (niente 2.5)', '');
    await open(L);
    log(yVals(chart).length > 0 && yVals(chart).every(sameDecs), 'livello: tacche con gli stessi decimali', JSON.stringify(yVals(chart)));

    // scheda: il fondo dice la fonte e basta; il menu Confronta senza "Confronto" ripetuto
    await open(T);
    const src = el('source').textContent.trim();
    log(!/Ora italiana/.test(src) && /Dati non validati\.$/.test(src), 'fondo: la fonte e "Dati non validati."', src);
    eq('Confronta: 7 giorni, 30 giorni, Schede, Vicine', [...el('cmpMenu').querySelectorAll('[data-mode]')].map(b => b.textContent.trim()),
       ['7 giorni', '30 giorni', 'Schede', 'Vicine']);

    for(const vs of [['TEMP'], ['TEMP', 'PREC'], ['PREC'], [WARROW]]){
      drawVar(vs[0]); vs.slice(1).forEach(addVar); await sleep(300);
      const z = chart.over.querySelector('.zoomall');
      log(!!z && z.style.display === 'none', 'grafico ' + vs.join('+') + ': "Tutto" nascosto finché non si fa zoom',
          JSON.stringify([chart.scales.x.min, chart.scales.x.max, chart._m && chart._m.win]));
    }
    drawVar('TEMP'); await sleep(200);

    // Impilate: "Tutto" solo dopo uno zoom; tacche coi decimali uguali
    setStackMode(true, ['TEMP', 'UMID', 'PREC']);
    await until(() => stackObj && stackObj.panels.length === 3, 8000); await sleep(300);
    const za = () => stackObj.panels[0].u.over.querySelector('.zoomall');
    log(!!za() && za().style.display === 'none', 'Impilate: "Tutto" nascosto finché non si fa zoom',
        JSON.stringify(stackObj.panels.map(p => [p.v, p.u.scales.x.min - stackObj.win[0], p.u.scales.x.max - stackObj.win[1]])));
    log(stackObj.panels.every(p => yVals(p.u).every(sameDecs)), 'Impilate: tacche con gli stessi decimali e col punto',
        JSON.stringify(stackObj.panels.map(p => yVals(p.u))));
    {
      const w = stackObj.win, u0 = stackObj.panels[0].u;
      u0.setScale('x', { min:w[0] + 86400, max:w[1] - 86400 }); await sleep(100);
      log(za().style.display === '', 'Impilate: "Tutto" dopo lo zoom', za().style.display);
      za().click(); await sleep(100);
      log(za().style.display === 'none' && Math.abs(u0.scales.x.min - w[0]) < 2, 'Impilate: "Tutto" torna a tutto il periodo',
          JSON.stringify([u0.scales.x.min, w[0]]));
    }
    setStackMode(false); await sleep(300);

    // rosa dei venti grande come il grafico, coi testi della stessa misura
    drawVar('TEMP'); await sleep(300);
    const hChart = R(el('chart')).height;
    drawVar(WROSE); await sleep(400);
    {
      const svg = el('windrose').querySelector('svg'), txt = svg ? [...svg.querySelectorAll('text')].map(t => R(t).height) : [];
      log(!!svg && R(svg).height >= hChart * 0.8, 'rosa dei venti alta come il grafico',
          JSON.stringify([svg && Math.round(R(svg).height), Math.round(hChart)]));
      log(txt.length > 4 && Math.max(...txt) <= 18, 'rosa dei venti: scritte piccole come quelle dei grafici', JSON.stringify(txt.map(Math.round)));
    }
    drawVar('TEMP'); await sleep(300);

    // Confronto 7 e 30 giorni: al cursore l'ora, oggi e il giorno piu' vicino; accanto al grafico nessun numero
    for(const mode of ['compare', 'compare30']){
      await pickMode(mode);
      await until(() => chartMode === mode && chart && chart.series.length > 3, 12000); await sleep(300);
      const iT = chart.series.findIndex(s => s.label === 'Oggi'), jT = iT > 0 ? lastOf(chart, iT) : -1;
      if(jT >= 0) chart.setCursor({ left:chart.valToPos(chart.data[0][jT], 'x'), top:20 });
      await sleep(100);
      const l = labs(chart), tag = mode === 'compare' ? 'Confronto 7 giorni' : 'Confronto 30 giorni';
      log(l.length === 2 && /^Oggi /.test(l.find(s => /^Oggi/.test(s)) || '') && l.some(s => /^\d\d\/\d\d /.test(s)),
          tag + ': al cursore oggi e il giorno più vicino', JSON.stringify(l));
      log(!!chart._labs && /\d\d:\d\d/.test(chart._labs.querySelector('.cl-t') ? chart._labs.querySelector('.cl-t').textContent : ''),
          tag + ': al cursore l\'ora', chart._labs ? chart._labs.innerHTML.slice(0, 80) : 'niente');
      eq(tag + ': accanto al grafico nessun elenco', el('chartlegend').textContent.trim(), '');
    }
    await pickMode('week'); await sleep(300);
    pickMode('tabs'); await sleep(800);
    eq('Confronto schede senza variabili in comune: una riga', el('status').textContent,
       'Nessuna variabile in comune.');
    closeTab(tabKeyOf(L)); await sleep(800);
    eq('Confronto schede con una scheda sola: una riga', el('status').textContent,
       'Servono almeno due schede.');
    await open(T);

    // Storico: sui grafici niente suggerimenti né chiavi (i nomi sono nel riquadro al passaggio)
    for(const [v, w] of [['PREC', 'giorni'], ['PREC', 'mesi'], ['PREC', 'anni'], ['TEMP', 'giorni'], ['TEMP', 'mesi'], ['TEMP', 'anni']]){
      await setHistMode(true, v, w);
      await until(() => histMode && histVar === v && histView === w && !!histU, 12000); await sleep(300);
      const bad = [...el('hvChart').querySelectorAll('.hv-hint, .hv-key')].filter(vis).map(e => e.textContent);
      eq('Storico ' + v + '/' + w + ': niente scritte sul grafico', bad, []);
    }
    histU.setCursor({ left:histU.valToPos(6, 'x'), top:10 }); await sleep(150);
    log(/min -?\d+\.\d · max -?\d+\.\d/.test(histU._tip.textContent), 'Storico, anni della temperatura: la fascia nel riquadro al passaggio',
        histU._tip.textContent);
    await setHistMode(true, 'PREC', 'tabella');
    await until(() => histView === 'tabella' && !!el('hvTable').querySelector('td.b'), 12000); await sleep(300);
    {
      const cv = document.createElement('canvas').getContext('2d');
      const covers = td => {                        // la barra arriva sotto il numero?
        const cs = getComputedStyle(td), f = parseFloat(td.style.getPropertyValue('--f')), px = k => parseFloat(cs[k]) || 0;
        cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        const r = R(td), cw = r.width - px('paddingLeft') - px('paddingRight') - px('borderLeftWidth') - px('borderRightWidth');
        const end = r.left + px('borderLeftWidth') + px('paddingLeft') + (cw - 4 * cv.measureText('0').width) * f;
        const rg = document.createRange();
        rg.selectNodeContents(td);
        return isNaN(f) || end > rg.getBoundingClientRect().left - 2;
      };
      const tds = [...el('hvTable').querySelectorAll('td.b')], bad = tds.filter(covers).map(td => td.textContent);
      log(tds.length > 10 && !bad.length, 'Storico, tabella della pioggia: le barre non coprono i numeri', JSON.stringify(bad.slice(0, 8)));
    }
    await setHistMode(false); await sleep(200);
    showMapView();
    eq('errori JS', window.__errs, []);
    finish();
  }

  // Climatologia: climogramma in "Altro" dai dati dello Storico (campione vero: Valdagno, VEN/79)
  async function suiteClima(){
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    const R = e => e.getBoundingClientRect(), phone = innerWidth <= 720;
    const st = (reg, sc) => (allFeatures.find(f => f.properties._region === reg && f.properties.scode === sc) || {}).properties;
    const V = st('VEN', '79');
    const N = (allFeatures.find(f => !['TEMP', 'PREC'].some(v => (f.properties.variables || []).includes(v))) || {}).properties;
    log(V && N, 'stazioni di prova trovate', JSON.stringify([!!V, !!N]));
    if(!(V && N)) return finish();
    const open = async p => {
      await selectStation(p);
      await until(() => currentStation === p && !!el('chart').querySelector('canvas'), 8000);
      await sleep(300);
    };
    const acts = () => ['refresh', 'expBtn'].filter(id => vis(el(id)));
    // atteso, calcolato qui dal file: mesi completi (interi e col 90% dei giorni con almeno 20 ore), media fra gli anni
    const raw = await (await fetch('./_radar_test/_HIST/VEN/79.json')).json();
    const want = (() => {
      const d0 = Date.UTC(+raw.d0.slice(0, 4), +raw.d0.slice(4, 6) - 1, +raw.d0.slice(6, 8)), n = raw.p.length;
      const r1 = v => Math.round(v * 10) / 10, first = a => a.findIndex(v => v != null);
      const months = (i0, cb) => {
        const M = {};
        for(let i = i0; i < n; i++){
          const d = new Date(d0 + i * 864e5), k = d.getUTCFullYear() + '-' + d.getUTCMonth();
          const o = M[k] || (M[k] = { m:d.getUTCMonth(), dim:new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(),
                                       span:0, have:0, s:0, x:0, nx:0, t:0, nt:0 });
          o.span++;
          cb(o, i);
        }
        return Object.values(M).filter(o => o.span === o.dim && o.have >= 0.9 * o.dim);
      };
      const T = months(first(raw.tm), (o, i) => {
        if(raw.tm[i] == null || !(raw.ht[i] >= 20)) return;
        o.have++; o.s += raw.tm[i];
        if(raw.tx[i] != null){ o.x += raw.tx[i]; o.nx++; }
        if(raw.tn[i] != null){ o.t += raw.tn[i]; o.nt++; }
      });
      const P = months(first(raw.p), (o, i) => {
        if(raw.p[i] == null) return;
        o.s += raw.p[i];
        if(raw.hp[i] >= 20) o.have++;
      });
      const avg = a => a.length ? r1(a.reduce((s, v) => s + v, 0) / a.length) : null, by = (A, m) => A.filter(o => o.m === m);
      return [...Array(12).keys()].map(m => ({
        tm:avg(by(T, m).map(o => r1(o.s / o.have))), tx:avg(by(T, m).filter(o => o.nx).map(o => o.x / o.nx)),
        tn:avg(by(T, m).filter(o => o.nt).map(o => o.t / o.nt)), p:avg(by(P, m).map(o => r1(o.s))),
        nt:by(T, m).length, np:by(P, m).length
      }));
    })();
    const near = (a, b) => a == null ? b == null : b != null && Math.abs(a - b) < 0.1001;
    const col = lab => { const i = climaU.series.findIndex(s => s.label === lab); return i > 0 ? climaU.data[i] : null; };

    await open(V);
    el('altBtn').click(); await sleep(100);
    const item = el('altMenu').querySelector('[data-var="CLIMATOLOGIA"]');
    eq('Altro: la Climatologia, in fondo', item ? [item.textContent.trim(), item === el('altMenu').lastElementChild] : null, ['Climatologia', true]);
    item.click();
    await until(() => climaU && document.body.classList.contains('clima-mode'), 10000); await sleep(300);
    log(!vis(el('chartwrap')) && vis(el('climaview')) && vis(climaU.root), 'Climatologia al posto del grafico', '');
    eq('link della vista', location.hash, '#VEN/79/CLIMATOLOGIA');
    const bad = [['Pioggia (mm)', 'p'], ['Temperatura massima (°C)', 'tx'], ['Temperatura minima (°C)', 'tn'], ['Temperatura media (°C)', 'tm']]
      .flatMap(([lab, k]) => { const c = col(lab); return want.map((w, m) => !c || !near(c[m], w[k]) ? lab + ' ' + (m + 1) + ': ' + (c && c[m]) + ' atteso ' + w[k] : null); })
      .filter(Boolean);
    eq('medie dei soli mesi completi, uguali a quelle calcolate dal file', bad.slice(0, 6), []);
    log(want.some(w => w.nt >= 2) && want.some(w => w.tm == null || w.nt < 2), 'campione: mesi con più anni e mesi con meno', JSON.stringify(want.map(w => w.nt)));
    eq('anni per mese (temperatura, pioggia)', climaStats(await histLoad(V)).map(o => [o.nt, o.np]),
       want.map(w => [w.nt, w.np]));
    log(climaU._labs && climaU._labs.hidden && !el('climaview').querySelector('.hv-key, .hv-hint'), 'a riposo nessun numero né scritta sul grafico', '');
    log(![...document.querySelectorAll('#modes .mode')].some(b => b.classList.contains('active')), 'nessun periodo acceso', '');
    eq('azioni: solo Esporta', acts(), ['expBtn']);
    {
      const m = want.findIndex(w => w.tx != null && w.p != null);
      climaU.setCursor({ left:climaU.valToPos(m, 'x'), top:20 }); await sleep(120);
      const labs = [...climaU._labs.querySelectorAll('.cl-v')].map(e => e.textContent.trim()).sort();
      const w = want[m], yrs = [...new Set([w.nt, w.np].filter(Boolean))].sort((a, b) => a - b);
      eq('al cursore: il mese e quanti anni', climaU._labs.querySelector('.cl-t').textContent,
         MESI_BR[m] + ' · ' + yrs.join('–') + (Math.max(...yrs) === 1 ? ' anno' : ' anni'));
      eq('al cursore: massima, media, minima e pioggia', labs,
         [w.tx, w.tm, w.tn].map(v => v.toFixed(1) + ' °C').concat(Math.round(w.p) + ' mm').sort());
    }
    {                                                           // alta come il grafico delle misure
      const hc = R(climaU.root).height;
      drawVar('TEMP'); await sleep(300);
      const hm = R(el('chart')).height;
      drawVar('CLIMATOLOGIA'); await until(() => climaU, 8000); await sleep(300);
      log(Math.abs(hc - hm) < 40 && Math.abs(R(climaU.root).height - hc) < 2, 'grande come il grafico delle misure', JSON.stringify([hc, hm]));
    }
    {                                                           // CSV: una riga per mese
      let csvText = null; const OB = window.Blob, oclick = HTMLAnchorElement.prototype.click, oc = URL.createObjectURL;
      window.Blob = function(parts, o){ csvText = (parts || []).join(''); return new OB(parts, o); };
      URL.createObjectURL = () => 'blob:test';
      HTMLAnchorElement.prototype.click = function(){ if(!this.download) oclick.call(this); };
      await exportCsv();
      window.Blob = OB; HTMLAnchorElement.prototype.click = oclick; URL.createObjectURL = oc;
      const lines = csvText ? csvText.trim().split('\n') : [];
      eq('CSV: intestazione e dodici mesi', [lines[0], lines.length], ['mese;anni_temperatura;tmin;tmedia;tmax;anni_pioggia;pioggia_mm', 13]);
      const w = want[7], c = v => v == null ? '' : String(v);
      eq('CSV: agosto', (lines[8] || '').split(';').map((s, k) => k === 0 ? s : s === '' ? '' : String(+s)),
         ['ago', String(w.nt), c(w.tn), c(w.tm), c(w.tx), String(w.np), c(w.p)]);
    }
    {                                                           // PNG
      const pngs = [], real = window.deliverPNG;
      window.deliverPNG = async (b, f) => { pngs.push({ f, kb:Math.round(b.size / 1024), type:b.type }); };
      await exportPNG(); await until(() => pngs.length, 8000);
      window.deliverPNG = real;
      const p = pngs[0];
      log(!!p && p.kb > 30 && p.type === 'image/png' && /_climatologia\.png$/.test(p.f), 'PNG della climatologia', JSON.stringify(p || null));
    }
    el('themeBtn').click(); await sleep(300);
    log(!!climaU && document.body.classList.contains('dark'), 'tema scuro: si ridisegna', '');
    el('themeBtn').click(); await sleep(300);
    if(phone) noOverflow('telefono, Climatologia');
    document.querySelector('#modes [data-mode="day3"]').click(); await sleep(400);
    log(!document.body.classList.contains('clima-mode') && chartMode === 'day3' && currentVar !== 'CLIMATOLOGIA' && !!chart,
        'un periodo torna al grafico', JSON.stringify([currentVar, chartMode]));
    document.querySelector('#modes [data-mode="week"]').click(); await sleep(200);
    history.replaceState(null, '', '#VEN/79/CLIMATOLOGIA'); await applyHash();
    await until(() => climaU && document.body.classList.contains('clima-mode'), 8000);
    log(document.body.classList.contains('clima-mode') && currentVar === 'CLIMATOLOGIA', 'il link apre la Climatologia', location.hash);
    // solo pioggia o solo temperatura: un asse solo, a sinistra
    {
      const s = want.map(w => Object.assign({}, w, { tm:null, tx:null, tn:null, nt:0 }));
      const o = climaOpts(s, { w:600, h:300 }), ys = o.axes.slice(1);
      eq('solo pioggia: le barre sull\'asse di sinistra', [o.series.length, ys.map(a => [a.scale, a.side || 3])], [2, [['mm', 3]]]);
      const t = want.map(w => Object.assign({}, w, { p:null, np:0 })), ot = climaOpts(t, { w:600, h:300 });
      eq('solo temperatura: niente barre né asse dei mm', [ot.series.length, ot.axes.slice(1).map(a => a.scale)], [4, ['y']]);
    }
    await open(N);
    log(!stationVars.includes('CLIMATOLOGIA') && !document.body.classList.contains('clima-mode'), 'senza pioggia né temperatura: niente Climatologia', '');
    showMapView();
    eq('errori JS', window.__errs, []);
    finish();
  }

  // Rifinitura A della scheda: carattere, nome con la "i", Esporta, linee, nomi a fine linea, unita', tempo, notte
  async function suiteRifinitura(){
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    const R = e => e.getBoundingClientRect(), mid = e => (R(e).top + R(e).bottom) / 2, phone = innerWidth <= 720;
    const st = (reg, sc) => (allFeatures.find(f => f.properties._region === reg && f.properties.scode === sc) || {}).properties;
    const T = st('VEN', '170');
    log(!!T, 'stazione di prova trovata', '');
    if(!T) return finish();
    const open = async p => {
      await selectStation(p);
      await until(() => currentStation === p && !!el('chart').querySelector('canvas'), 8000);
      await sleep(300);
    };
    const menu = () => [...el('expMenu').querySelectorAll('[data-act]')].filter(vis);
    const pick = async act => { el('expBtn').click(); await sleep(60); menu().find(b => b.dataset.act === act).click(); await sleep(60); };
    const blobText = async act => {                    // il testo del Blob nel momento in cui nasce (vedi la prova del CSV dello Storico)
      let text = null; const OB = window.Blob, oc = URL.createObjectURL, ok = HTMLAnchorElement.prototype.click;
      window.Blob = function(parts, o){ text = (parts || []).join(''); return new OB(parts, o); };
      URL.createObjectURL = () => 'blob:test';
      HTMLAnchorElement.prototype.click = function(){ if(!this.download) ok.call(this); };
      await pick(act); await sleep(200);
      window.Blob = OB; URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = ok;
      return text;
    };

    if(document.fonts) await document.fonts.load('12px "IBM Plex Sans"');
    log(/^"?IBM Plex Sans"?/.test(getComputedStyle(document.body).fontFamily) && document.fonts.check('12px "IBM Plex Sans"'),
        'carattere IBM Plex Sans, caricato', getComputedStyle(document.body).fontFamily);
    Object.assign(T, { quota:155, comune:'TEOLO', prov:'PD' });         // come nel geojson col nuovo export
    setMapVar(''); await until(() => filterVar === '');
    await open(T);

    // nome grande, la "i" accanto: la scheda della stazione con un clic
    const nm = el('stationName'), ib = el('stInfo'), card = el('stCard');
    log(parseFloat(getComputedStyle(nm).fontSize) >= (phone ? 20 : 23), 'nome della stazione grande', getComputedStyle(nm).fontSize);
    log(vis(ib) && ib.textContent.trim() === 'i' && R(ib).left - R(nm).right < 16 && R(ib).left >= R(nm).right - 1 &&
        Math.abs(mid(ib) - mid(nm)) < 7, '"i" accanto al nome', JSON.stringify([R(nm).right, R(ib).left, mid(nm), mid(ib)].map(Math.round)));
    ib.click(); await sleep(60);
    eq('"i": un clic apre la scheda della stazione', [vis(card), ib.getAttribute('aria-expanded')], [true, 'true']);
    const rows = [...card.querySelectorAll('dt')].map(d => [d.textContent.trim(), d.nextElementSibling.textContent.trim()]);
    eq('"i": le voci', rows.map(r => r[0]), ['Dove', 'Rete', 'Coordinate', 'Codice', 'Misure', 'Ultimo dato']);
    eq('"i": dove e rete', rows.slice(0, 2).map(r => r[1]), ['Teolo (PD), 155 m', 'ARPA Veneto']);
    log(/^45\.343 N, 11\.677 E$/.test((rows[2] || [])[1]) && (rows[3] || [])[1] === '170', '"i": coordinate e codice', JSON.stringify(rows.slice(2, 4)));
    log(/^temperatura, umidità, pioggia/.test((rows[4] || [])[1]) && /^\d\d\/\d\d alle \d\d:\d\d$/.test((rows[5] || [])[1]),
        '"i": misure e ultimo dato', JSON.stringify(rows.slice(4)));
    { const r = R(card); log(r.left >= -0.5 && r.right <= innerWidth + 0.5, '"i": dentro lo schermo', JSON.stringify([r.left, r.right].map(Math.round))); }
    document.body.click(); await sleep(60);
    eq('"i": un clic fuori la chiude', [vis(card), ib.getAttribute('aria-expanded')], [false, 'false']);
    ib.click(); await sleep(60);
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' })); await sleep(60);
    log(!vis(card), '"i": Esc la chiude', '');

    // Esporta: un pulsante solo, con CSV, PNG e link; il CSV e' quello della vista
    eq('azioni: Aggiorna ed Esporta', [...el('pact').children].filter(vis).map(e => e.id), ['refresh', 'expBtn']);
    el('expBtn').click(); await sleep(60);
    eq('Esporta: tre voci', menu().map(b => b.textContent.trim()), ['Dati (CSV)', 'Immagine (PNG)', 'Copia il link']);
    el('expBtn').click(); await sleep(60);
    log(!vis(el('expMenu')), 'Esporta: un secondo clic chiude', '');
    {
      const got = []; const ok = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function(){ got.push([this.getAttribute('href'), this.download]); };
      await pick('csv');
      HTMLAnchorElement.prototype.click = ok;
      log(got.length === 1 && /\/VEN\/series\/170\.csv$/.test(got[0][0]) && got[0][1] === 'Teolo_VEN.csv', 'Esporta, CSV: la serie della stazione', JSON.stringify(got));
      const pngs = [], real = window.deliverPNG;
      window.deliverPNG = async (b, f) => { pngs.push(f); };
      await pick('png'); await until(() => pngs.length, 8000);
      window.deliverPNG = real;
      log(pngs.length === 1 && /\.png$/.test(pngs[0]), 'Esporta, PNG', JSON.stringify(pngs));
    }
    await setHistMode(true, 'PREC', 'mesi'); await until(() => histMode && !!histU, 10000); await sleep(300);
    eq('Storico: azioni', [...el('pact').children].filter(vis).map(e => e.id), ['expBtn']);
    log(/^data;pioggia_mm/.test(await blobText('csv') || ''), 'Esporta nello Storico: il CSV giornaliero', '');
    await setHistMode(false); await sleep(300);

    // linee a 2 px senza pallini (il pallino solo al cursore); con due o piu' variabili il nome sta sopra il suo
    // asse, accanto all'unita', mai dentro il grafico
    drawVar('TEMP'); addVar('UMID'); await sleep(300);
    const dots = (s, i) => typeof s.points.show === 'function' ? s.points.show(chart, i) : s.points.show;   // uPlot ne fa una funzione
    const lines = chart.series.map((s, i) => [s, i]).filter(([s, i]) => i && s.kind === 'line');
    log(lines.length === 2 && lines.every(([s, i]) => s.width === 2 && !dots(s, i)), 'linee a 2 px senza pallini',
        JSON.stringify(lines.map(([s, i]) => [s.width, dots(s, i)])));
    const ys = () => chart.axes.filter(a => a.scale && a.scale !== 'x');
    eq('nomi sopra i loro assi, niente in fondo alle linee', [ys().map(a => (a.names || []).map(n => n.text)), typeof endLabels],
       [[['Temperatura'], ['Umidità']], 'undefined']);
    // unita' in orizzontale sopra il loro asse, del colore della variabile quando l'asse e' suo
    eq('unità sopra gli assi, niente scritte ruotate', ys().map(a => [a.label || null, a.unit]), [[null, '°C'], [null, '%']]);
    drawVar('TEMP'); await sleep(300);
    eq('una linea sola: sopra l\'asse solo l\'unità', ys().map(a => a.names || null), [null]);
    // tempo su due righe: le ore, sotto i giorni
    const xs = chart.axes.filter(a => a.scale === 'x');
    eq('asse del tempo su due righe', xs.length, 2);
    log((xs[0]._values || []).length > 0 && xs[0]._values.every(t => t === '' || /^\d{1,2}$/.test(t)), 'prima riga: le ore',
        JSON.stringify((xs[0]._values || []).slice(0, 10)));
    log((xs[1]._values || []).length >= 6 && xs[1]._values.every(t => /^((dom|lun|mar|mer|gio|ven|sab) )?\d{1,2}$/.test(t)),
        'seconda riga: i giorni', JSON.stringify(xs[1]._values));
    // notte vera: dal tramonto all'alba della stazione
    const sun = sunTimes(Date.UTC(2026, 10, 17) / 1000, 45.34272761, 11.67713457);
    log(Math.abs(sun[0] - Date.UTC(2026, 10, 17, 6, 13) / 1000) < 300 && Math.abs(sun[1] - Date.UTC(2026, 10, 17, 15, 43) / 1000) < 300,
        'alba e tramonto di Teolo il 17/11', JSON.stringify(sun.map(t => new Date(t * 1000).toISOString().slice(11, 16))));
    log((chart.hooks.drawClear || []).includes(nightBands), 'la notte dietro il grafico', '');

    {                                                  // colori dell'interfaccia (quelli dei dati restano i loro)
      const rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';
      const act = document.querySelector('#modes .mode.active'), bg = () => getComputedStyle(act).backgroundColor;
      eq('colore principale: il periodo scelto', [bg(), getComputedStyle(act).color], [rgb('#264E5D'), rgb('#FFFFFF')]);
      eq('puntini delle stazioni senza variabile: secondario, bordo principale', [DOT_COLOR, DOT_LINE].map(c => c.toUpperCase()),
         ['#6795A1', '#264E5D']);
      document.body.classList.add('dark');
      eq('tema scuro: il periodo scelto col secondario', bg(), rgb('#6795A1'));
      document.body.classList.remove('dark');
    }
    // telefono: nome e azioni su una riga; periodi, Storico e Confronta su un'altra (a 375 px)
    if(phone){
      const same = es => Math.max(...es.map(mid)) - Math.min(...es.map(mid)) <= 6;
      log(same([nm, el('refresh'), el('expBtn')]), 'telefono: nome e azioni sulla stessa riga', '');
      const row2 = [...document.querySelectorAll('#modes .mode'), el('histbtn'), el('cmpBtn')].filter(vis);
      if(innerWidth >= 370) log(same(row2), 'telefono: periodi, Storico e Confronta su una riga', JSON.stringify(row2.map(e => Math.round(mid(e)))));
      noOverflow('telefono, rifinitura');
    }
    showMapView();
    eq('errori JS', window.__errs, []);
    finish();
  }

  // Nuove funzioni della scheda: radar alla stazione, Vicine, evento di pioggia, bilancio idrico, neve
  // fresca, giorni di PM10. I dati che il Pi non pubblica ancora sono costruiti qui sulla serie vera.
  async function suiteNuove(){
    const vis = e => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
    const st = (reg, sc) => (allFeatures.find(f => f.properties._region === reg && f.properties.scode === sc)
                             || {}).properties;
    const P = st('VEN', '234');                                     // Padova: pioggia, temperatura
    log(!!P, 'stazione di prova trovata', '');
    if(!P) return finish();
    const open = async (p, v) => {
      await selectStation(p);
      await until(() => currentStation === p && !!el('chart').querySelector('canvas'), 8000);
      if(v && currentVar !== v) drawVar(v);
      await sleep(300);
    };
    const realPoints = Radar.points;
    window.__errs = [];
    const radarItem = async () => {
      if(el('altMenu').hidden) el('altBtn').click();
      await sleep(100);
      return el('altMenu').querySelector('[data-opt="radar"]');
    };

    // radar: spento all'inizio, senza nemmeno chiederlo; si accende da «Altro» e resta acceso
    const asked = [];
    Radar.points = async reg => { asked.push(reg); return null; };
    P._radar = undefined; P._tableAt = 0;
    await open(P, 'PREC');
    eq('radar: spento all\'inizio, niente richiesta', asked, []);
    log(!chart._m.iRadar && !axisNames().includes('Radar'),
        'radar: spento all\'inizio, niente barre', '');
    let item = await radarItem();
    log(!!item && item.getAttribute('aria-checked') === 'false' && item.textContent.trim() === 'Radar',
        'radar: voce «Radar» in «Altro», spenta', item ? item.outerHTML : '');
    altClose();
    const ys = P._table.cols.PREC, last = P._table.x.filter((x, i) => x != null && ys[i] != null).pop();
    // 0.1 mm ogni 5 minuti dalle 6 ore prima dell'ultima lettura a 2 ore dopo (stazione in ritardo)
    const T = [];
    for(let x = Math.floor(last / 300) * 300 - 6 * HOUR + 300; x <= last + 2 * HOUR; x += 300) T.push(x);
    const fake = { t:T, s:{ [P.scode]:T.map(() => 0.1) } };
    Radar.points = async reg => reg === P._region ? fake : null;
    P._radar = undefined;
    (await radarItem()).click();
    await until(() => chart && chart._m && chart._m.iRadar, 3000);
    let stored = null;
    try { stored = localStorage.getItem('stRadar'); } catch(e){}
    log(showRadar && !!chart._m.iRadar && stored === '1',
        'radar: acceso da «Altro», barre e scelta ricordata', JSON.stringify([showRadar, stored]));
    item = await radarItem();
    log(!!item && item.getAttribute('aria-checked') === 'true' && item.classList.contains('on'),
        'radar: voce segnata quando è acceso', item ? item.outerHTML : '');
    altClose();
    const radarVals = () => {
      const iR = chart && chart._m && chart._m.iRadar;
      return iR ? chart.data[iR].map((v, j) => v == null ? null : [chart.data[0][j], v]).filter(Boolean) : [];
    };
    for(const [mode, tag] of [['day3', '3 g'], ['day', '24 h']]){
      await pickMode(mode); await sleep(200);
      P._radar = undefined;
      await loadRadarPoints(P); await sleep(400);
      const m = chart._m, R = radarVals(), slot = m.radar ? m.radar.slot : 0;
      log(!!m.iRadar && chart.series[m.iRadar].label === 'Radar', tag + ': c\'è la serie del radar', '');
      if(m.iRadar){                                    // un altro colore, se no sembra la continuazione del pluviometro
        const sr = chart.series[m.iRadar], stroke = typeof sr.stroke === 'function' ? sr.stroke(chart, m.iRadar) : sr.stroke;
        log(stroke === varColor('RADAR') && varColor('RADAR') !== varColor('PREC'), tag + ': il radar in arancio, non nel blu della pioggia',
            JSON.stringify([stroke, varColor('PREC')]));
      }
      const per = Math.round(10 * slot / 300) / 100;               // 0.1 mm per fotogramma dell'intervallo
      log(R.length > 2 && R.slice(0, -1).every(([, v]) => Math.abs(v - per) < 1e-9),
          tag + ': intervalli completi = somma dei 5 minuti', JSON.stringify([per, R.slice(0, 3)]));
      log(R.length && R[R.length - 1][1] <= per + 1e-9, tag + ': l\'ultimo intervallo può essere a metà',
          JSON.stringify(R.slice(-2)));
      const end = R.length ? R[R.length - 1][0] : 0;
      log(end > last, tag + ': il radar va oltre l\'ultima lettura della stazione', JSON.stringify([end, last]));
      log(axisNames().includes('Radar'), tag + ': «Radar» sopra l\'asse della pioggia', JSON.stringify(axisNames()));
      if(R.length){
        const [x] = R[1] || R[0];
        chart.setCursor({ left:chart.valToPos(x + (m.radar.align === 1 ? slot / 2 : -slot / 2), 'x'), top:20 });
        await sleep(100);
        const txt = chart._labs ? chart._labs.textContent : '';
        log(/Radar \d+\.?\d* mm/.test(txt), tag + ': al cursore «Radar … mm»', txt);
      }
      if(mode === 'day3' && R.length)
        log(chart.scales.x.max >= R[R.length - 1][0] + slot - 1, tag + ': l\'ultima barra del radar per intero',
            JSON.stringify([chart.scales.x.max, R[R.length - 1][0] + slot]));
      if(mode === 'day3' && R.length){                 // dopo l'ultima lettura: in alto l'ora dell'intervallo
        chart.setCursor({ left:chart.valToPos(R[R.length - 1][0] + slot / 2, 'x'), top:20 }); await sleep(100);
        const top = chart._labs && chart._labs.querySelector('.cl-t');
        log(!!top && /–/.test(top.textContent), tag + ': sopra una barra di solo radar l\'intervallo', top && top.textContent);
      }
      noOverflow('radar ' + tag);
    }
    // spento da «Altro»: via le barre, la scelta resta
    (await radarItem()).click(); await sleep(300);
    try { stored = localStorage.getItem('stRadar'); } catch(e){}
    log(!showRadar && !chart._m.iRadar && !axisNames().includes('Radar') && stored === '0',
        'radar: spento da «Altro», niente barre', JSON.stringify([showRadar, stored]));
    // senza file del radar: il grafico di oggi, senza errori
    setRadar(true);
    Radar.points = async () => null;
    P._radar = undefined;
    await loadRadarPoints(P);
    renderChart('PREC'); await sleep(300);
    log(!chart._m.iRadar && !axisNames().includes('Radar'), 'senza radar: niente serie né chiave', '');
    setRadar(false);
    Radar.points = realPoints;
    P._radar = undefined;
    // la voce c'è solo con la pioggia
    await open(P, 'TEMP');
    item = await radarItem();
    log(!item, 'radar: niente voce fuori dalla pioggia', item ? item.outerHTML : '');
    altClose();

    // Vicine: voce in Confronta; la stazione e fino a 3 vicine entro 25 km, dalla più vicina
    await open(P, 'TEMP');
    await pickMode('week');
    const items = [...el('cmpMenu').querySelectorAll('[data-mode]')].map(b => b.dataset.mode + ':' + b.textContent.trim());
    eq('Vicine: ultima voce del menu Confronta', items[items.length - 1], 'near:Vicine');
    await pickMode('near');
    await until(() => chartMode === 'near' && !!chart && !!chart._near, 15000); await sleep(300);
    const nb = (chart && chart._near) || [];
    log(nb.length >= 2 && nb.length <= 4 && nb[0].props === P, 'Vicine: la stazione e fino a 3 vicine',
        JSON.stringify(nb.map(o => o.props.name)));
    log(nb.slice(1).every((o, k) => o.km <= 25 && (k === 0 || o.km >= nb[k].km)), 'Vicine: entro 25 km, dalla più vicina',
        JSON.stringify(nb.map(o => o.km)));
    log(nb.slice(1).every(o => o.props.quota == null || Math.abs(o.props.quota - P.quota) <= 300),
        'Vicine: per la temperatura quota entro 300 m', JSON.stringify(nb.map(o => o.props.quota)));
    const lrows = [...el('chartlegend').querySelectorAll('.lg-row')].map(r => r.textContent.trim());
    log(lrows.length === nb.length && lrows.slice(1).every(t => /\d+(\.\d)? km, \d+ m$/.test(t)),
        'Vicine: accanto al nome distanza e quota', JSON.stringify(lrows));
    log(el('cmpBtn').classList.contains('active') && el('cmpBtn').textContent.trim() === 'Vicine',
        'Vicine: acceso su Confronta', el('cmpBtn').textContent);
    log(!el('vars').querySelector('.vp'), 'Vicine: una variabile alla volta, niente «+»', '');
    {
      let text = null; const OB = window.Blob, oc = HTMLAnchorElement.prototype.click;
      window.Blob = function(parts, o){ text = (parts || []).join(''); return new OB(parts, o); };
      HTMLAnchorElement.prototype.click = function(){ if(!this.download) oc.call(this); };
      exportData(); await sleep(100);
      window.Blob = OB; HTMLAnchorElement.prototype.click = oc;
      const head = text ? text.split('\n')[0].split(',') : [];
      eq('Vicine: CSV con una colonna per stazione', head.length, nb.length + 1);
    }
    {
      const got = await chartPNG();
      log(!!got && /vicine/.test(got.fname), 'Vicine: PNG', got && got.fname);
    }
    // Vicine, pioggia: una fascia per stazione con la stessa scala, sopra il nome e il totale, barre piene senza
    // bordo; al cursore il valore accanto alla linea del tempo in ogni fascia
    await open(P, 'PREC'); await pickMode('near');
    await until(() => chartMode === 'near' && !!stackObj && !!stackObj.near, 15000); await sleep(300);
    {
      const ps = stackObj ? stackObj.panels : [], nr = (stackObj && stackObj.near) || [];
      const heads = [...el('chart').querySelectorAll('.stk-h')].map(h => h.textContent.replace(/\s+/g, ' ').trim());
      log(!chart && ps.length >= 2 && ps.length === nr.length, 'Vicine pioggia: una fascia per stazione',
          JSON.stringify([!!chart, ps.length, nr.length]));
      log(heads.length === nr.length && heads.every((h, k) => h.startsWith(prettyName(nr[k].props.name || nr[k].props.scode))
          && /\d mm/.test(h)), 'Vicine pioggia: sopra ogni fascia il nome e il totale', JSON.stringify(heads));
      const tops = ps.map(p => p.u.scales.y.max);
      log(tops.length >= 2 && tops.every(t => t === tops[0]), 'Vicine pioggia: la stessa scala per tutte', JSON.stringify(tops));
      log(ps.every(p => p.u.series[1].width === 0), 'Vicine pioggia: barre senza bordo', JSON.stringify(ps.map(p => p.u.series[1].width)));
      log(ps.length >= 2 && ps.every(p => p.u.series.length === 3 && p.u.series[2].label === 'Cumulata'),
          'Vicine pioggia: in ogni fascia la cumulata', JSON.stringify(ps.map(p => p.u.series.map(s => s.label))));
      const spans = () => ps.map(p => Math.round((p.u.scales.cum.max - p.u.scales.cum.min) * 100));
      log(spans().length >= 2 && spans().every(s => s === spans()[0]), 'Vicine pioggia: la cumulata con la stessa scala',
          JSON.stringify(spans()));
      if(ps[0]){
        const w = stackObj.win, full = spans()[0], fit = () => {   // la salita piu' alta nel tratto visibile
          const r = cumY(() => cumRise(ps, ps[0].u.scales.x)).range(ps[0].u, 0, 0);
          return Math.round(r[1] * 100);
        };
        ps[0].u.setScale('x', { min:w[1] - 24 * 3600, max:w[1] }); await sleep(100);
        log(spans().every(s => s === fit()) && ps.every(p => p.u.scales.x.min === w[1] - 24 * 3600),
            'Vicine pioggia: con lo zoom la stessa scala, sulla salita visibile', JSON.stringify([spans(), fit()]));
        ps[0].u.setScale('x', { min:w[0], max:w[1] }); await sleep(100);
        log(spans().every(s => s === full), 'Vicine pioggia: «Tutto» torna alla scala di prima', JSON.stringify([spans(), full]));
      }
      log(!vis(el('chartlegend')), 'Vicine pioggia: i nomi solo sopra le fasce', '');
      const X = ps[0] ? Math.round(ps[0].u.over.clientWidth * 0.6) : 0;
      ps.forEach(p => p.u.setCursor({ left:X, top:10 })); await sleep(100);
      const at = ps.map(p => {
        const j = p.u.cursor.idx, v = j != null ? p.u.data[1][j] : null, l = p.u._labs && p.u._labs.querySelector('.cl-v');
        return v == null ? 'vuoto' : (l ? Math.round(parseFloat(l.style.left)) : null);
      });
      log(at.some(x => typeof x === 'number') && at.every(x => x === 'vuoto' || (x != null && Math.abs(x - X) <= 1)),
          'Vicine pioggia: il valore accanto alla linea del tempo', JSON.stringify([X, at]));
      let text = null; const OB = window.Blob, oc = HTMLAnchorElement.prototype.click;
      window.Blob = function(parts, o){ text = (parts || []).join(''); return new OB(parts, o); };
      HTMLAnchorElement.prototype.click = function(){ if(!this.download) oc.call(this); };
      exportData(); await sleep(100);
      window.Blob = OB; HTMLAnchorElement.prototype.click = oc;
      eq('Vicine pioggia: CSV con una colonna per stazione', text ? text.split('\n')[0].split(',').length : 0, nr.length + 1);
      const got = typeof stackPNG === 'function' ? await stackPNG() : null;
      log(!!got && /vicine/.test(got.fname), 'Vicine pioggia: PNG', got && got.fname);
      log(stackObj.withSource === true, 'Vicine pioggia: nel PNG la fonte', '');
      const cm = chartMode;                                // Confronto schede: il periodo nel nome, niente fonte
      chartMode = 'week'; renderCompareSet('PREC', 'mm', nr, '');
      log(!!stackObj && stackObj.withSource === false && stackObj.fname === 'confronto_schede_PREC_week.png',
          'Confronto schede pioggia: periodo nel nome del PNG, niente fonte', stackObj && stackObj.fname);
      chartMode = cm; clearChart();
    }
    {                    // dalla revisione: fasce coi dati finti (finestre mobili, stazione senza dati, Oggi dopo
                         // mezzanotte), legenda del PNG su piu' righe, PNG di 8 fasce entro il limite di Safari
      const H = 3600, t0 = Math.floor(Date.now() / 1000 / H) * H - 10 * H, xs = Array.from({ length:10 }, (_, i) => t0 + (i + 1) * H);
      const mk = (name, ys, v, x = xs) => ({ props:{ name, scode:name, _table:{ x, header:['ora', v], cols:{ [v]:ys } } }, sub:'' });
      const C = ['#2b6cb0', '#e53e3e'], cfg = (list, src, mode) => ({ list, src, unit:'mm', mode, colors:C });
      const r24 = stationPanels(cfg([mk('A', xs.map(() => 13), 'PREC24'), mk('B', xs.map(() => 5), 'PREC24')], 'PREC24', 'week'), true);
      eq('revisione: pioggia 24 h, niente somma delle finestre mobili', r24.panels.map(p => p.head.extra), ['mm', 'mm']);
      eq('cumulata: niente con le finestre mobili', [r24.panels.map(p => p.cum), r24.rgut], [[false, false], 0]);
      const rc = stationPanels(cfg([mk('A', xs.map(() => 1), 'PREC'), mk('B', xs.map(() => 3), 'PREC')], 'PREC', 'week'), true);
      eq('cumulata: in ogni fascia, spazio a destra per l\'asse', [rc.panels.map(p => p.cum), rc.rgut], [[true, true], STACK_RGUT]);
      const half = [rc.win[0], rc.win[0] + (rc.win[1] - rc.win[0]) / 2];
      const sp = rc.panels[0].cumSpan({ scales:{ x:{ min:null, max:null } } }, half);
      log(sp > 0 && sp < 30, 'cumulata: nel PNG la salita del tratto mostrato', JSON.stringify(sp));
      const tot = p => Math.round(p.rs.y.reduce((a, y) => a + (y || 0), 0) * 100) / 100;
      log(rc.panels.every(p => tot(p) > 0 && p.data[2].filter(y => y != null).pop() === tot(p)),
          'cumulata: arriva al totale della fascia', JSON.stringify(rc.panels.map(p => [p.data[2].filter(y => y != null).pop(), tot(p)])));
      const r1 = stationPanels(cfg([mk('A', xs.map(() => 1), 'PREC'), mk('B', xs.map(() => null), 'PREC')], 'PREC', 'week'), true);
      log(/^\d/.test(r1.panels[0].head.extra) && r1.panels[1].head.extra === 'n.d.', 'revisione: senza dati nel periodo «n.d.», non 0 mm',
          JSON.stringify(r1.panels.map(p => p.head.extra)));
      const o = stackPanelOpts(r1.panels[1], { w:300, h:100, last:true, win:r1.win, hooks:{} });
      eq('revisione: fascia vuota, l\'asse del tempo resta il periodo', o.scales.x.range({ data:[[]] }, null, null), r1.win);
      const old = xs.map(x => x - 2 * DAY_S);
      const rM = stationPanels(cfg([mk('A', old.map(() => 1), 'PREC', old), mk('B', old.map(() => 1), 'PREC', old)], 'PREC', 'mn'), false);
      log(!!rM && rM.win[1] - rM.win[0] >= H, 'revisione: Oggi senza letture di oggi, finestra non rovesciata', rM && JSON.stringify(rM.win));
      const mc = document.createElement('canvas').getContext('2d');
      const many = [{}].concat(Array.from({ length:30 }, (_, i) => ({ label:'giorno ' + (i + 1), kind:'line', stroke:'#888' })));
      const lay = pngLegendRow(mc, many, 0, 0, false, 1500);
      log(lay.rows > 1 && lay.w <= 1500, 'revisione: legenda del PNG su più righe', JSON.stringify(lay));
      const s8 = stackPngSize(8);
      log(s8.W * s8.H * PNG_R * PNG_R <= 16777216, 'revisione: PNG di 8 fasce entro il limite di Safari', JSON.stringify(s8));
    }
    const W = allFeatures.map(f => f.properties).find(p => (p.variables || []).includes('LIVIDRO')
                                                       && (p.variables || []).includes('PREC'));
    if(W){
      await open(W, 'PREC'); await pickMode('near'); await sleep(800);
      const row = [...el('vars').querySelectorAll('.vn')].map(e => e.dataset.var);
      log(!row.includes('LIVIDRO'), 'Vicine: niente livelli nella riga', JSON.stringify(row));
      await pickMode('week');
    } else log(true, 'Vicine: nessuna stazione con livello e pioggia (prova saltata)', '');
    {
      const far = await nearStations(Object.assign({}, P, { _lat:40.0, _lon:19.5 }), 'TEMP');
      eq('Vicine: lontano da tutte, nessuna', far.length, 0);
      await open(P, 'TEMP');
      const lat = P._lat;
      P._lat = 40.0;
      await pickMode('near'); await sleep(800);
      eq('Vicine: senza vicine, la frase', el('status').textContent, 'Nessuna stazione vicina con questa misura.');
      P._lat = lat;
    }
    await pickMode('day3');
    log(chartMode === 'day3' && !el('cmpBtn').classList.contains('active'), 'Vicine: un periodo ne esce', '');

    // Evento di pioggia: piogge separate da meno di 6 ore asciutte, almeno 2 mm
    {
      const X = [...Array(48).keys()].map(k => 1800000000 + k * 1800), Y = X.map(() => 0);
      [4, 5, 6, 7, 8, 9].forEach(k => { Y[k] = 1; });               // 6 mm
      [20, 21].forEach(k => { Y[k] = 0.5; });                       // dopo 5 h asciutte: stesso evento
      Y[36] = 1.5;                                                  // dopo 7 h: evento nuovo...
      [44, 45].forEach(k => { Y[k] = 1.2; });                       // ...che con questi arriva a 3.9 mm
      eq('Evento: separati da 6 ore asciutte, almeno 2 mm', rainEvents(X, Y, 1800),
         [{ a:X[3], b:X[21], mm:7 }, { a:X[35], b:X[45], mm:3.9 }]);
      Y[36] = 0; Y[44] = Y[45] = 0.9;
      eq('Evento: sotto i 2 mm non c\'è', rainEvents(X, Y, 1800).length, 1);
    }
    {
      await open(P, 'PREC'); await pickMode('day');
      const tb = P._table, keep = tb.cols.PREC.slice(), n = tb.x.length;
      const end = tb.x.filter(x => x != null).pop(), idx = [];
      for(let i = n - 1; i >= 0 && idx.length < 30; i--)
        if(tb.x[i] != null && tb.x[i] <= end - 3 * HOUR) idx.push(i);
      tb.cols.PREC = tb.cols.PREC.map((v, i) => v == null ? v : 0);
      idx.slice(0, 10).forEach(i => { tb.cols.PREC[i] = 1; });     // 10 letture da 1 mm
      renderChart('PREC'); await sleep(300);
      const ev = chart._m.events || [];
      log(ev.length === 1 && Math.abs(ev[0].mm - 10) < 1e-9, 'Evento: trovato nella serie',
          JSON.stringify(ev));
      log((chart._evDrawn || []).length === 1, 'Evento: la linea in cima al grafico',
          JSON.stringify(chart._evDrawn));
      if(ev.length){
        chart.setCursor({ left:chart.valToPos((ev[0].a + ev[0].b) / 2, 'x'), top:40 }); await sleep(100);
        const txt = chart._labs ? chart._labs.textContent : '';
        log(/Evento 10 mm in \d+ h/.test(txt), 'Evento: al cursore il totale e la durata', txt);
      }
      tb.cols.PREC = tb.cols.PREC.map(v => v == null ? v : 0);
      renderChart('PREC'); await sleep(200);
      eq('Evento: senza pioggia nessuna linea', (chart._evDrawn || []).length, 0);
      tb.cols.PREC = keep;
      renderChart('PREC'); await sleep(200);
    }

    // Bilancio idrico: 30 giorni interi (fino a ieri), 1 mm di pioggia e 2 mm di ET0 al giorno; due giorni senza ET0
    const today = civDay(Date.now() / 1000), t30 = { header:['datetime', 'PREC', 'ET0'], x:[], cols:{ PREC:[], ET0:[] } };
    for(let d = 0; d < 30; d++){
      const D = civMidnight(today - 30 + d);
      for(let h = 1; h <= 24; h++){
        t30.x.push(D + h * HOUR);
        t30.cols.PREC.push(h === 6 || h === 18 ? 0.5 : 0);
        t30.cols.ET0.push(h === 12 && d !== 3 && d !== 4 ? 2 : null);
      }
    }
    {
      const b = waterBalance(t30);
      eq('Bilancio: giorni validi, uno senza ET0 non conta', b && b.valid, 28);
      eq('Bilancio: cumulate alla fine', b && [b.p[b.p.length - 1], b.e[b.e.length - 1]], [28, 56]);
      const few = { header:t30.header, x:t30.x, cols:{ PREC:t30.cols.PREC, ET0:t30.cols.ET0.map((v, i) => i < 24 * 11 ? null : v) } };
      eq('Bilancio: meno di 20 giorni validi, niente', waterBalance(few), null);
    }
    await open(P, 'PREC');
    log(stationVars.includes(WBIL) && varCat(WBIL) === 'indici', 'Bilancio: in «Altro», fra gli indici', JSON.stringify(stationVars));
    P._table30 = t30;
    drawVar(WBIL);
    await until(() => chart && chart._bil, 8000); await sleep(300);
    log(!!chart && chart.series.length === 3 && chart.series[1].label === 'Pioggia' && chart.series[2].label === 'Evapotraspirazione',
        'Bilancio: pioggia ed evapotraspirazione cumulate', chart && JSON.stringify(chart.series.map(s => s.label)));
    eq('Bilancio: i due nomi sopra l\'asse, non in fondo alle linee', axisNames(), ['Pioggia', 'Evapotraspirazione']);
    log(![...document.querySelectorAll('#modes .mode')].some(b => b.classList.contains('active')), 'Bilancio: senza periodo', '');
    {
      const j = chart.data[0].length - 1;
      chart.setCursor({ left:chart.valToPos(chart.data[0][j], 'x') - 2, top:30 }); await sleep(100);
      const txt = chart._labs ? chart._labs.textContent : '';
      log(/Bilancio -28(\.0)? mm/.test(txt), 'Bilancio: al cursore il bilancio', txt);
    }
    {
      let text = null; const OB = window.Blob, oc = HTMLAnchorElement.prototype.click;
      window.Blob = function(parts, o){ text = (parts || []).join(''); return new OB(parts, o); };
      HTMLAnchorElement.prototype.click = function(){ if(!this.download) oc.call(this); };
      exportData(); await sleep(100);
      window.Blob = OB; HTMLAnchorElement.prototype.click = oc;
      log(!!text && text.split('\n')[0].startsWith('giorno;pioggia_mm;et0_mm'), 'Bilancio: CSV', text && text.split('\n')[0]);
    }
    P._table30 = { header:t30.header, x:t30.x, cols:{ PREC:t30.cols.PREC, ET0:t30.cols.ET0.map(() => null) } };
    drawVar('PREC'); drawVar(WBIL); await sleep(500);
    eq('Bilancio: dati insufficienti, la frase', el('status').textContent, 'Dati insufficienti per il bilancio.');
    P._table30 = null;
    drawVar('PREC'); await pickMode('week');

    // Neve fresca: mattina (mediana 6-10) meno la mattina prima; sotto 2 cm conta 0, le altezze negative 0
    {
      const d0 = civDay(Date.now() / 1000) - 6, ts = { header:['datetime', 'LIVNEVE'], x:[], cols:{ LIVNEVE:[] } };
      const morning = [20, 21, 35, null, 40, 30], put = (d, h, v) => { ts.x.push(civToUtc((d0 + d) * DAY_S + h * HOUR)); ts.cols.LIVNEVE.push(v); };
      morning.forEach((m, d) => {
        for(let h = 0; h < 24; h++){
          if(h >= 6 && h < 10){ if(m != null) put(d, h, m + (h === 7 ? 1 : 0)); }
          else put(d, h, h === 14 ? 90 : (h === 22 ? -3 : (m || 0)));       // picco e negativi fuori dalla mattina
        }
      });
      const fs = freshSnow(ts);
      eq('Neve fresca: un giorno per giorno civile', fs.x, [0, 1, 2, 3, 4, 5].map(k => civMidnight(d0 + k)));
      eq('Neve fresca: soglia, mattina mancante, scioglimento', fs.y, [null, 0, 14, null, null, 0]);
    }
    {
      const S = allFeatures.map(f => f.properties).find(p => (p.variables || []).includes('LIVNEVE') && p._region === 'VEN');
      if(S){
        await open(S);
        log(stationVars.includes(SNOWNEW) && varCat(SNOWNEW) === 'derivate', 'Neve fresca: in «Altro», fra le derivate', '');
        drawVar(SNOWNEW); await sleep(400);
        const s = chart && chart._m && chart._m.ss[0];
        log(!!s && s.kind === 'bars' && s.rs.slot === DAY_S, 'Neve fresca: una barra al giorno', s && JSON.stringify([s.kind, s.rs.slot]));
        eq('Neve fresca: in cm', s && s.unit, 'cm');
      } else log(true, 'Neve fresca: nessuna stazione con la neve in Veneto (prova saltata)', '');
    }

    // PM10: la striscia dell'anno sotto il grafico e i giorni oltre il limite (file del Pi finto)
    {
      const A = allFeatures.map(f => f.properties).find(p => p._region === 'AQ_VEN' && (p.variables || []).includes('PM10'));
      log(!!A, 'PM10: stazione dell\'aria trovata', '');
      if(A){
        const y = new Date().getFullYear(), jan1 = Date.UTC(y, 0, 1) / 1000;
        const today = Math.floor((Date.now() / 1000 - jan1) / DAY_S), from = Math.floor((Date.UTC(y, 6, 8) / 1000 - jan1) / DAY_S);
        const arr = [...Array(today + 1).keys()].map(i => i < from ? null : (i % 7 === 0 && i < from + 23 * 7 ? 60 : 30));
        const n = arr.filter(v => v > 50).length;
        const realYear = window.loadPm10Year;
        window.loadPm10Year = async reg => reg === A._region ? { anno:y, soglia:50, ammessi:35, s:{ [A.scode]:arr } } : null;
        await open(A, 'PM10');
        await until(() => vis(el('pm10year')), 5000); await sleep(200);
        const box = el('pm10year'), txt = () => box.querySelector('.py-txt').textContent;
        log(vis(box), 'PM10: la striscia sotto il grafico', '');
        eq('PM10: la frase', txt(), n + ' giorni oltre il limite, ammessi 35, dall\'8 luglio');
        eq('PM10: un trattino pieno per giorno oltre il limite', box.querySelectorAll('rect.over').length, n);
        eq('PM10: i mesi', [...box.querySelectorAll('.py-m')].map(e => e.textContent), ['gen', 'apr', 'lug', 'ott']);
        {
          const sv = box.querySelector('svg'), r = sv.getBoundingClientRect(), days = sv.viewBox.baseVal.width;
          const i = arr.findIndex(v => v > 50), x = r.left + (i + 0.5) / days * r.width;
          sv.dispatchEvent(new PointerEvent('pointermove', { clientX:x, clientY:r.top + 4, bubbles:true }));
          await sleep(50);
          log(/^\d\d\/\d\d: 60 µg\/m³$/.test(txt()), 'PM10: al passaggio giorno e media', txt());
          sv.dispatchEvent(new PointerEvent('pointerleave', { bubbles:true }));
          await sleep(50);
          log(/oltre il limite/.test(txt()), 'PM10: fuori dalla striscia torna la frase', txt());
        }
        noOverflow('PM10');
        const other = stationVars.find(v => v !== 'PM10' && isMainVar(v, stationVars));
        if(other){ drawVar(other); await sleep(300); log(!vis(box), 'PM10: con un\'altra misura la striscia sparisce', other); }
        // nella scheda Confronto la striscia non resta sotto il grafico delle schede
        openCompareTab();
        await until(() => document.body.classList.contains('view-compare'), 5000); await sleep(400);
        log(!vis(box), 'PM10: niente striscia nel Confronto schede', '');
        closeCompare(); await sleep(200);
        window.loadPm10Year = realYear;
      }
    }

    // Correzioni della revisione
    {
      // due stazioni aperte in fretta: resta l'ultima, con i suoi nomi e il suo link
      const C = st('VEN', '100'), B = P;
      if(C){
        const real = Radar.points;
        setRadar(true);
        Radar.points = () => new Promise(r => setTimeout(() => r(null), 1000));   // il radar di C tarda
        C._table = null; C._tableAt = 0; C._radar = undefined;
        B._tableAt = Date.now(); B._radar = null;
        const slow = selectStation(C);
        await sleep(50);
        await selectStation(B); await slow; await sleep(400);
        Radar.points = real;
        setRadar(false);
        log(currentStation === B && el('stationName').title.startsWith(B.scode) && location.hash.includes('/' + B.scode + '/'),
            'revisione: aprendo due stazioni in fretta resta l\'ultima', JSON.stringify([el('stationName').title, location.hash]));
      }
      // Vicine e poi un idrometro: le Vicine non valgono, si torna al periodo
      await open(P, 'TEMP'); await pickMode('near'); await sleep(600);
      const Wt = allFeatures.map(f => f.properties).find(p => (p.variables || []).length && p.variables.every(v => WATER_VARS.has(v)));
      if(Wt){
        await open(Wt);
        log(chartMode !== 'near', 'revisione: Vicine e poi un idrometro, si torna al periodo', JSON.stringify([chartMode, currentVar]));
      } else log(true, 'revisione: nessun idrometro puro (prova saltata)', '');
      // Vicine, poi Storico: Esporta da' il CSV dello Storico
      await open(P, 'TEMP'); await pickMode('near'); await sleep(600);
      await setHistMode(true, 'TEMP', 'giorni'); await until(() => histMode && !!histU, 8000); await sleep(300);
      {
        let name = null; const real = window.saveBlob;
        window.saveBlob = (b, f) => { name = f; };
        exportData(); await sleep(100);
        window.saveBlob = real;
        log(!!name && !/vicine/.test(name), 'revisione: dallo Storico Esporta da\' lo Storico', name);
      }
      await setHistMode(false); await pickMode('week');
      // i 30 giorni restano della stazione che li ha chiesti
      {
        const A30 = P, B30 = st('VEN', '79');
        A30._table30 = null; if(B30) B30._table30 = null;
        const p30 = ensureTable30();
        currentStation = B30 || currentStation;
        await p30;
        currentStation = A30;
        log(!!A30._table30 && !(B30 && B30._table30), 'revisione: i 30 giorni restano della stazione giusta', '');
      }
      // un messaggio non resta sotto il grafico dopo
      await open(P, 'TEMP');
      const lat = P._lat; P._lat = 40.0;
      await pickMode('near'); await sleep(600);
      P._lat = lat;
      await pickMode('week'); await sleep(200);
      eq('revisione: il messaggio delle Vicine non resta', el('status').textContent, '');
      // il radar si riprende con la serie; niente radar per chi non ha la pioggia
      {
        const real = Radar.points, asked = [];
        setRadar(true);
        Radar.points = async reg => { asked.push(reg); return fake; };
        P._radar = { t:[1], v:[0.5] }; P._tableAt = 0;
        await open(P, 'PREC');
        log(!!P._radar && P._radar.t.length === fake.t.length, 'revisione: il radar si riprende con la serie', P._radar && P._radar.t.length);
        const N = allFeatures.map(f => f.properties).find(p => p._region === 'AQ_VEN');
        asked.length = 0;
        if(N){ N._tableAt = 0; N._radar = undefined; await open(N); }
        eq('revisione: niente radar per una stazione senza pioggia', asked, []);
        Radar.points = real; P._radar = undefined;
        setRadar(false);
      }
      // radar di una stazione ferma da giorni: niente barre lontane dai suoi dati
      {
        const rs = { x:[T[0] - 3 * DAY_S], y:[0], hourly:true, step:HOUR, align:1 };
        eq('revisione: stazione ferma, niente radar', radarBars({ t:T, v:T.map(() => 0.1) }, rs, T[0] - 3 * DAY_S + HOUR), null);
      }
      // neve fresca: Aggiorna la tiene, nei confronti non c'e'
      const S = allFeatures.map(f => f.properties).find(p => (p.variables || []).includes('LIVNEVE') && p._region === 'VEN');
      if(S){
        await open(S); drawVar(SNOWNEW); await sleep(300);
        await refreshStation(); await sleep(300);
        eq('revisione: Aggiorna sulla neve fresca resta sulla neve fresca', currentVar, SNOWNEW);
        await pickMode('compare'); await sleep(300);
        log(![...el('vars').querySelectorAll('.vn')].some(e => e.dataset.var === SNOWNEW) && !nearOk(SNOWNEW),
            'revisione: niente neve fresca nei confronti', '');
        await pickMode('week');
      }
      // «Oggi» da mezzanotte anche quando la prima lettura del giorno arriva dopo (qui alle 01:00)
      {
        await open(P, 'TEMP');
        const tb = P._table, keepT = tb.cols.TEMP, mid = civMidnight(civDay(Date.now() / 1000));
        tb.cols.TEMP = keepT.map((v, i) => tb.x[i] >= mid && tb.x[i] < mid + HOUR ? null : v);
        await pickMode('mn'); await sleep(300);
        eq('difetti vecchi: Oggi parte da mezzanotte', chart.scales.x.min, mid);
        tb.cols.TEMP = keepT;
        await pickMode('week');
      }
      // dati giornalieri (polveri) in 24 h e Oggi: almeno gli ultimi due valori, coi punti
      {
        const L = allFeatures.map(f => f.properties).find(p => p._region === 'AQ_LOM' && (p.variables || []).includes('PM10'));
        if(L){
          await open(L, 'PM10');
          for(const md of ['day', 'mn']){
            await pickMode(md); await sleep(300);
            const vals = chart.data[1].filter(v => v != null).length, s = chart.series[1];
            const dots = typeof s.points.show === 'function' ? s.points.show(chart, 1) : s.points.show;
            log(vals >= 2 && !!dots, 'difetti vecchi: PM10 giornaliero in ' + md + ' non e\' vuoto', JSON.stringify([vals, !!dots]));
          }
          await pickMode('week');
        }
        await open(P, 'TEMP'); await pickMode('day'); await sleep(300);
        const span = chart.scales.x.max - chart.scales.x.min;
        log(span <= DAY_S + 2 * HOUR, 'difetti vecchi: le misure orarie in 24 h restano su 24 ore', span);
        await pickMode('week');
      }
      // bilancio: il giorno in corso non conta
      {
        const tt = { header:t30.header, x:t30.x.slice(), cols:{ PREC:t30.cols.PREC.slice(), ET0:t30.cols.ET0.slice() } };
        const D = civMidnight(today);
        for(let h = 1; h <= 24; h++){ tt.x.push(D + h * HOUR); tt.cols.PREC.push(1); tt.cols.ET0.push(h === 12 ? 2 : null); }
        eq('revisione: il bilancio non conta il giorno in corso', waterBalance(tt).valid, 28);
      }
    }

    await pickMode('week');
    showMapView();
    eq('errori JS', window.__errs, []);
    finish();
  }

  // Mappa: valori confrontabili, ritardi in grigio, etichette. Stazioni finte, cosi' non dipende dai dati del giorno
  async function suiteValori(){
    window.__errs = [];
    const H = 3600e3, NOW = nowRome(), iso = ms => new Date(ms).toISOString().slice(0, 16);
    const fake = (reg, sc, lat, lon, latest, extra) => ({ type:'Feature', geometry:{ type:'Point', coordinates:[lon, lat] },
      properties:Object.assign({ scode:sc, name:'Prova ' + sc, variables:Object.keys(latest), latest,
                                 latest_time:iso(NOW - H), series:'series/' + sc + '.csv', _region:reg, _lat:lat, _lon:lon },
                               extra || {}) });
    const UNITS = { VEN:{ VVENTO:'m/s', RADSOL:'W/m²', LIVIDRO:'m', PREC:'mm', TEMP:'°C', UMID:'%', LIVNEVE:'cm' },
                    FVG:{ VVENTO:'km/h', RADSOL:'KJ/m^2', TEMP:'°C' }, LIG:{ VVENTO:'m/s', RADSOL:'W/m2', TEMP:'°C' },
                    PC_FVG:{ RADSOL:'W/m²' },
                    LOM:{ LIVIDRO:'cm', TEMP:'°C' }, AQ_LOM:{ PM10:'µg/m³', O3:'µg/m³', EAQI:'' },
                    PC_TN:{ PORTATA:'m3/s' }, MAR_VEN:{ MAREA:'m' }, MAR_ER:{ MAREA:'m', TEMPACQUA:'°C' },
                    LAGHI:{ LIVLAGO:'m' }, AQ_ER:{ EAQI:'' } };
    Object.assign(UNITS.VEN, { PORTATA:'mc/s', PRESS:'hPa', DVENTO:'gradi' });
    UNITS.BZ = { PORTATA:'m³/s', FREATICA:'m', TEMPACQUA:'°C', SOLEGG:'s', PRESS:'hPa' };
    UNITS.LIG.SOLEGG = 'min';
    UNITS.PC_FVG.LIVLAGO = 'm';
    const loadedUnits = JSON.stringify(unitsByRegion);                  // quelle vere, lette dalla pagina
    const scene = async (features, v) => {
      if(snap.on) closeSlider();
      allFeatures = features;
      unitsByRegion = UNITS;
      selectedKey = '';
      refreshFilters();
      setMapVar(v);
      await sleep(150);
    };
    const fill = sc => { const r = markerRefs.find(x => x.p.scode === sc); return r ? r.m.options.fillColor : null; };

    // Cursore sui dati veri, prima delle stazioni finte: pioggia di oggi = somma delle ore dopo mezzanotte (alle
    // 00:00 vale 0), raffica massima di oggi = massimo delle massime orarie (cresce durante il giorno)
    for(const [v, src] of [['PREC', 'PREC1'], ['VVENTOMAX', 'VVENTOMAX']]){
      setMapVar(v); await sleep(300);
      if(!snap.on) await openSlider(); else await snapOpenFor(v);
      await until(() => snap.var === v && snap.T.length > 0, 20000);
      const r0 = snap.var === v && Object.keys(snap.data)[0], d0 = r0 && snap.data[r0];
      const raw = r0 ? await (await fdata(r0 + '/snap/' + src + '.json')).json() : null;
      let bad = [], n = 0;
      if(raw) for(const sc in d0.s) d0.s[sc].forEach((x, i) => {
        const t = d0.t[i], start = t - t % 86400, own = raw.s[sc] || [];
        const hrs = raw.t.map((tt, j) => tt > start && tt <= t ? own[j] : null).filter(y => y != null);
        if(x == null) return;
        n++;
        const want = v === 'PREC' ? (t === start ? 0 : Math.round(hrs.reduce((a, y) => a + y, 0) * 10) / 10)
                                  : Math.round(Math.max(...hrs) * 10) / 10;
        if(Math.abs(x - want) > 0.051) bad.push([sc, t, x, want]);
      });
      log(snap.var === v && n > 0 && !bad.length, 'Cursore: ' + v + ' da mezzanotte, dai fotogrammi di ' + src + ' (' + r0 + ')',
          JSON.stringify([snap.var, n, bad.slice(0, 3)]));
    }
    if(snap.var === 'VVENTOMAX'){
      const r0 = Object.keys(snap.data)[0], P0 = allFeatures.map(f => f.properties)
        .find(p => p._region === r0 && snap.data[r0].s[p.scode] && snap.data[r0].s[p.scode].some(x => x != null));
      const S0 = P0 ? await cardSeries(P0, 'VVENTOMAX', false) : null;
      const raw = P0 ? (await (await fdata(r0 + '/snap/VVENTOMAX.json')).json()).s[P0.scode].slice(-25) : null;
      eq('Cursore: nella scheda la raffica di ogni ora, non la massima di oggi', S0 && S0.vals, raw);
    }
    // etichette col Cursore: a ogni fotogramma numeri nuovi, nessuna etichetta vecchia
    const labs = () => [...document.querySelectorAll('.vl')];
    const texts = () => labs().map(e => e.dataset.k + '=' + e.textContent).sort().join(' ');
    const sw = el('mcValues'), shown = id => !!el(id) && getComputedStyle(el(id)).display !== 'none';
    if(PHONE.matches){ dockMin(false); await sleep(300); }               // sul telefono la plancia parte chiusa
    log(!!sw && shown('dkVal'), 'interruttore Valori nella plancia', '');
    const valuesOn = () => typeof showValues !== 'undefined' && showValues;
    if(sw && !valuesOn()) sw.click();
    await sleep(300);
    if(snap.on){
      setFrame(snap.kmax); await sleep(200);
      const a1 = texts(), n1 = labs().length;
      setFrame(snap.kmax - 8); await sleep(200);
      log(n1 > 0 && texts() !== a1, 'Cursore con le etichette: cambiano col fotogramma', JSON.stringify([n1, labs().length]));
    }
    closeSlider();
    // radar: "Stazioni" spento non lascia etichette; un prodotto senza puntini nasconde l'interruttore
    await radarOn();
    await until(() => Radar.on, 15000);
    log(Radar.on, 'radar acceso', Radar.state);
    if(Radar.on){
      const nOn = labs().length;
      radarUi.stations = false; renderMarkers(); await sleep(200);
      log(nOn > 0 && labs().length === 0, 'radar: Stazioni spento, nessuna etichetta', JSON.stringify([nOn, labs().length]));
      radarUi.stations = true;
      radarSetProduct('VMI'); await sleep(300);
      log(!!el('dkVal') && !shown('dkVal'), 'radar: prodotto senza puntini, niente interruttore', '');
      radarOff(true); await sleep(300);
    }
    if(valuesOn()) sw.click();                                           // le prove dei puntini, senza etichette

    // vento: FVG in km/h e VEN in m/s sulla stessa scala, con "Tutte"
    await scene([fake('FVG', 'F1', 46.0, 13.2, { VVENTO:'36' }), fake('VEN', 'V1', 45.4, 11.9, { VVENTO:'10' }),
                 fake('LIG', 'L1', 44.4, 8.9, { VVENTO:'2' })], 'VVENTO');
    log(fill('F1') === fill('V1') && fill('F1') !== fill('L1') && ![DOT_COLOR, NEUTRAL_COLOR].includes(fill('F1')),
        'vento: 36 km/h e 10 m/s stesso colore, con Tutte', JSON.stringify([fill('F1'), fill('V1'), fill('L1')]));
    // colori: ogni grandezza la sua scala; classi fisse dove il valore conta da solo
    const rgbOf = c => c && c[0] === '#' ? [1, 3, 5].map(i => parseInt(c.substr(i, 2), 16))
                                         : String(c).match(/\d+/g).map(Number);
    const lum = c => { const [r, g, b] = rgbOf(c); return 0.299 * r + 0.587 * g + 0.114 * b; };
    const stepLabels = () => [...el('dkScale').querySelectorAll('.sc-full i')].map(e => e.textContent);
    await scene([fake('VEN', 'K1', 45.4, 11.9, { TEMP:'12' }), fake('VEN', 'K2', 45.5, 11.8, { TEMP:'0' })], 'TEMP');
    const t12 = fill('K1');
    await scene([fake('VEN', 'K1', 45.4, 11.9, { TEMP:'12' }), fake('VEN', 'K2', 45.5, 11.8, { TEMP:'30' })], 'TEMP');
    log(!!t12 && t12 === fill('K1') && t12 !== fill('K2'), 'temperatura: 12 °C sempre dello stesso colore',
        JSON.stringify([t12, fill('K1'), fill('K2')]));
    eq('temperatura: scala fissa da −20 a 40, scritte ogni 10 gradi', stepLabels(),
       ['−20', '−10', '0', '10', '20', '30', '40']);
    await scene([0, 3, 30, 150].map((x, i) => fake('VEN', 'S' + i, 45.4 + i / 10, 11.9, { LIVNEVE:String(x) })),
                'LIVNEVE');
    const sn = [0, 1, 2, 3].map(i => fill('S' + i)), blue = c => { const [r, g, b] = rgbOf(c); return b > r && b >= g; };
    log(sn[0] === '#e3e9f0' && sn.slice(1).every(blue) && lum(sn[1]) > lum(sn[2]) && lum(sn[2]) > lum(sn[3]),
        'neve: assente grigia, poi blu sempre più scuri', JSON.stringify(sn));
    await scene([fake('FVG', 'F5', 46.0, 13.2, { VVENTO:'20' }), fake('FVG', 'F6', 46.1, 13.3, { VVENTO:'50' })],
                'VVENTO');
    eq('vento: col solo Friuli soglie in km/h', [el('dkUnit').textContent, stepLabels()],
       ['km/h', ['4', '11', '18', '29', '40', '50', '61', '76']]);
    await scene([fake('VEN', 'U1', 45.4, 11.9, { UMID:'25' }), fake('VEN', 'U2', 45.5, 11.8, { UMID:'97' })], 'UMID');
    eq('umidità: dal secco (giallino) al saturo (blu scuro)', [fill('U1'), fill('U2')], ['#edf8b1', '#081d58']);
    await scene([fake('VEN', 'R5', 45.4, 11.9, { RADSOL:'0' }), fake('VEN', 'R6', 45.5, 11.8, { RADSOL:'650' })],
                'RADSOL');
    eq('radiazione: di notte grigia, poi dal giallo al bruno', [fill('R5'), fill('R6')], ['#e3e9f0', '#993404']);
    await scene([fake('VEN', 'P5', 45.4, 11.9, { PSLM:'1013' }), fake('VEN', 'P6', 45.5, 11.8, { PSLM:'990' }),
                 fake('VEN', 'P7', 45.6, 11.7, { PSLM:'1035' })], 'PSLM');
    eq('pressione al mare: 1013 grigio al centro, bassa viola, alta arancio', [fill('P5'), fill('P6'), fill('P7')],
       ['#e3e9f0', '#542788', '#b35806']);
    // le altre sfumano fra minimo e massimo nella tinta della grandezza, non nell'arcobaleno comune
    await scene([fake('ACQ_VEN', 'W5', 45.4, 12.3, { CLOROFILLA:'1' }),
                 fake('ACQ_VEN', 'W6', 45.3, 12.4, { CLOROFILLA:'9' })], 'CLOROFILLA');
    const chl = fill('W6');
    await scene([fake('BZ', 'W7', 46.5, 11.3, { SOLIDI:'1' }), fake('BZ', 'W8', 46.6, 11.4, { SOLIDI:'9' })], 'SOLIDI');
    log(!!chl && chl !== fill('W8') && rgbOf(chl)[1] > rgbOf(chl)[0], 'sfumature: clorofilla verde, solidi d\'altra tinta',
        JSON.stringify([chl, fill('W8')]));
    // radiazione: i kJ/m² orari di FVG in W/m², e due grafie dei W/m²
    const rad = [fake('FVG', 'F2', 46.0, 13.2, { RADSOL:'1800' }), fake('LIG', 'L2', 44.4, 8.9, { RADSOL:'300' }),
                 fake('VEN', 'V2', 45.4, 11.9, { RADSOL:'300' })];
    await scene(rad, 'RADSOL');
    const refR = typeof refUnitFor === 'function' ? refUnitFor('RADSOL', rad) : null;
    eq('radiazione: unità di riferimento W/m²', refR, 'W/m²');
    eq('radiazione: 1800 kJ/m² in un\'ora = 500 W/m²',
       typeof mapValue === 'function' ? mapValue(rad[0].properties, 'RADSOL', refR) : null, 500);
    log(!!fill('L2') && fill('L2') === fill('V2') && fill('L2') !== DOT_COLOR, 'radiazione: W/m2 e W/m² stesso colore',
        JSON.stringify([fill('L2'), fill('V2')]));
    // Friuli: 64 stazioni OSMER in kJ/m² e 65 della Protezione Civile in W/m², quasi alla pari: il riferimento resta W/m²
    const fvg = [fake('FVG', 'K1', 46.0, 13.2, { RADSOL:'500' }), fake('FVG', 'K2', 46.1, 13.3, { RADSOL:'600' }),
                 fake('PC_FVG', 'K3', 46.2, 13.4, { RADSOL:'150' })];
    eq('radiazione: riferimento sempre W/m²', refUnitFor('RADSOL', fvg), 'W/m²');
    // pioggia di oggi
    await scene([fake('VEN', 'V3', 45.4, 11.9, { PREC:'0.2' }, { rif:{ PREC:8 } }),
                 fake('VEN', 'V4', 45.5, 11.8, { PREC:'0' }, { rif:{ PREC:0 } })], 'PREC');
    eq('pioggia: colore della classe di oggi', fill('V3'), classColor('PREC24', 8));
    eq('pioggia: nome nella plancia', el('dkName').textContent, 'Precipitazione · oggi');
    // aria: classi europee, ai confini
    await scene([fake('AQ_LOM', 'A1', 45.5, 9.2, { PM10:'38' }, { rif:{ PM10:40 } }),
                 fake('AQ_LOM', 'A2', 45.6, 9.3, { PM10:'38' }, { rif:{ PM10:41 } })], 'PM10');
    eq('aria: PM10 40 discreta, 41 moderata', [fill('A1'), fill('A2')], ['#50ccaa', '#f0e641']);
    eq('aria: nome nella plancia', el('dkName').textContent, 'Polveri PM10 · ieri');
    await scene([fake('AQ_LOM', 'A3', 45.5, 9.2, { O3:'90' }, { rif:{ O3:131 } })], 'O3');
    eq('aria: ozono 131 scarsa', fill('A3'), '#ff5050');
    // livello: variazione in cm, da m (VEN) e da cm (LOM)
    await scene([fake('VEN', 'V5', 45.4, 11.9, { LIVIDRO:'1.2' }, { rif:{ LIVIDRO:0.12 } }),
                 fake('LOM', 'M1', 45.5, 9.2, { LIVIDRO:'120' }, { rif:{ LIVIDRO:25 } }),
                 fake('VEN', 'V6', 45.5, 11.8, { LIVIDRO:'0.8' }, { rif:{ LIVIDRO:-0.03 } })], 'LIVIDRO');
    eq('livello: +12, +25, −3 cm', [fill('V5'), fill('M1'), fill('V6')], ['#fdae61', '#f46d43', '#ffffbf']);
    map.setView([45.45, 11.85], 11); await sleep(300);
    const vt = [...document.querySelectorAll('.leaflet-tooltip.vlab')].map(e => e.textContent);
    log(vt.includes('+12') && vt.includes('−3'), 'livello: scritte da zoom 11 col segno', JSON.stringify(vt));
    // le altre variabili tengono le scritte di prima (la pressione col suo decimale)
    await scene([fake('VEN', 'Q1', 45.4, 11.9, { TEMP:'12' }), fake('VEN', 'Q2', 45.5, 11.8, { TEMP:'7.5' })], 'TEMP');
    map.setView([45.45, 11.85], 11); await sleep(300);
    eq('puntini: scritte da zoom 11 come prima', [...document.querySelectorAll('.leaflet-tooltip.vlab')]
       .map(e => e.textContent).sort(), ['12', '7.5']);
    // neve: i negativi del sensore contano zero
    const snow = fake('VEN', 'V7', 45.4, 11.9, { LIVNEVE:'-13.8' });
    eq('neve: −13.8 conta 0', typeof mapValue === 'function' ? mapValue(snow.properties, 'LIVNEVE', 'cm') : null, 0);

    // unita': una grafia sola in tutta la pagina
    const nu = typeof normUnit === 'function' ? normUnit : null;
    eq('unità: m³/s, W/m², kJ/m² e gradi in una grafia',
       nu && ['mc/s', 'm3/s', 'm^3/s', 'W/mq', 'KJ/m^2', 'gradi', '°N', 'gN'].map(nu),
       ['m³/s', 'm³/s', 'm³/s', 'W/m²', 'kJ/m²', '°', '°', '°']);
    log(!/mc\/s|m3\/s|\^/.test(loadedUnits) && /m³\/s/.test(loadedUnits),
        'unità: quelle lette dalla pagina già pulite', loadedUnits.slice(0, 200));
    // nessuna variabile nascosta con "Tutte": portata in classi fisse, comunque la scriva la fonte
    await scene([fake('VEN', 'Q1', 45.4, 11.9, { PORTATA:'3.2' }),
                 fake('PC_TN', 'Q2', 46.1, 11.1, { PORTATA:'150' }),
                 fake('BZ', 'Q3', 46.5, 11.3, { PORTATA:'1200' })], 'PORTATA');
    const FC = typeof FLOW_COLORS !== 'undefined' ? FLOW_COLORS : [];
    eq('portata: 3.2, 150, 1200 m³/s nelle loro classi, con Tutte', [fill('Q1'), fill('Q2'), fill('Q3')],
       [FC[1], FC[5], FC[7]]);
    eq('portata: unità nella plancia', el('dkUnit').textContent, 'm³/s');
    // marea: in cm sullo zero di Punta della Salute, con le soglie di Venezia; l'Emilia-Romagna misura dallo zero
    // IGM 1942, 23.56 cm piu' in alto; il Tagliamento non dice da quale zero: vuoto
    await scene([fake('MAR_VEN', 'T1', 45.4, 12.3, { MAREA:'0.77' }),
                 fake('MAR_VEN', 'T2', 45.3, 12.3, { MAREA:'1.15' }),
                 fake('MAR_ER', 'T3', 44.7, 12.2, { MAREA:'0.41' }),
                 fake('MAR_FVG', 'T4', 45.67, 13.07, { MAREA:'0.93' })], 'MAREA');
    eq('marea: 77, 115 e 41+23.56 cm', [fill('T1'), fill('T2'), fill('T3')],
       typeof TIDE_COLORS !== 'undefined' ? [TIDE_COLORS[2], TIDE_COLORS[4], TIDE_COLORS[2]] : null);
    const t3 = markerRefs.find(r => r.p.scode === 'T3'), t4 = markerRefs.find(r => r.p.scode === 'T4');
    eq('marea: Emilia-Romagna sullo zero di Venezia, scritta in cm', [t3 && labelText('MAREA', t3.nv),
       el('dkUnit').textContent, el('dkName').textContent], ['65', 'cm', 'Livello marea · zero Punta della Salute']);
    eq('marea: zero non dichiarato, vuoto', [fill('T4'), t4 && t4.m.options.fillOpacity], [NEUTRAL_COLOR, 0]);
    eq('marea: nella scheda lo stesso numero', (stationMainValue(t3.p) || {}).text, '65 cm');
    // laghi e falda: variazione in 24 ore, in ritardo solo dopo un giorno
    await scene([fake('LAGHI', 'G1', 45.9, 8.6, { LIVLAGO:'0.087' }, { rif:{ LIVLAGO:0.048 } }),
                 fake('PC_FVG', 'G2', 46.2, 12.6, { LIVLAGO:'307.31' }, { rif:{ LIVLAGO:-0.03 } })],
                'LIVLAGO');
    eq('lago: +5 e −3 cm in 24 ore', [fill('G1'), fill('G2')], [LEVEL_COLORS[3], LEVEL_COLORS[1]]);
    eq('lago: nome, scritta col segno e scheda',
       [el('dkName').textContent, labelText('LIVLAGO', 4.8),
        (cardModel(allFeatures[0].properties).delta || {}).text],
       ['Livello lago · in 24 ore', '+5', '↑ 5 cm in 24 ore']);
    const well = (sc, lat, x, d, lag) => fake('BZ', sc, lat, 11.3, { FREATICA:x },
                                              { rif:{ FREATICA:d }, lag:{ FREATICA:lag } });
    await scene([well('W1', 46.5, '7.76', -0.25, 900), well('W2', 46.6, '5.1', 0.01, 1800)], 'FREATICA');
    eq('falda: indietro di 15 ore colorata, di 30 in ritardo', [fill('W1'), fill('W2')],
       [LEVEL_COLORS[0], NEUTRAL_COLOR]);
    // colore e scritta dallo stesso numero: +1.6 cm si scrive +2 e ha il colore di +2 (anche il fiume, a +5)
    await scene([fake('LAGHI', 'G3', 45.9, 8.6, { LIVLAGO:'0.1' }, { rif:{ LIVLAGO:0.016 } })], 'LIVLAGO');
    eq('lago: +1.6 cm come +2', [labelText('LIVLAGO', 1.6), fill('G3')], ['+2', LEVEL_COLORS[3]]);
    await scene([fake('VEN', 'G4', 45.4, 11.9, { LIVIDRO:'1' }, { rif:{ LIVIDRO:0.046 } })], 'LIVIDRO');
    eq('livello: +4.6 cm come +5', [labelText('LIVIDRO', 4.6), fill('G4')], ['+5', LEVEL_COLORS[3]]);
    // le altre misure confrontabili si colorano anche con Tutte
    await scene([fake('BZ', 'E1', 46.5, 11.3, { TEMPACQUA:'6' }),
                 fake('MAR_ER', 'E2', 44.7, 12.2, { TEMPACQUA:'15' })], 'TEMPACQUA');
    log(![DOT_COLOR, NEUTRAL_COLOR].includes(fill('E1')) && fill('E1') !== fill('E2'),
        'acqua: temperatura con Tutte', JSON.stringify([fill('E1'), fill('E2')]));
    await scene([fake('AQ_LOM', 'E3', 45.5, 9.2, { EAQI:'2' }),
                 fake('AQ_ER', 'E4', 44.5, 11.3, { EAQI:'4' })], 'EAQI');
    eq('aria: indice europeo con Tutte', [fill('E3'), fill('E4')], [eaqiColor(2), eaqiColor(4)]);
    // non si colorano: la pressione della stazione (dipende dalla quota), misure su intervalli diversi
    await scene([fake('VEN', 'N1', 45.4, 11.9, { PRESS:'1010' }),
                 fake('BZ', 'N2', 46.5, 11.3, { PRESS:'950' })], 'PRESS');
    eq('pressione: con Tutte non si colora', [fill('N1'), fill('N2')], [DOT_COLOR, DOT_COLOR]);
    await scene([fake('BZ', 'N3', 46.5, 11.3, { SOLEGG:'600' }),
                 fake('LIG', 'N4', 44.4, 8.9, { SOLEGG:'10' })], 'SOLEGG');
    eq('soleggiamento: intervalli diversi non si confrontano', [fill('N3'), fill('N4')],
       [DOT_COLOR, DOT_COLOR]);

    // ritardi: oltre 3 ore dall'ultima lettura della variabile, grigio chiaro e fuori dalla scala
    await scene([fake('VEN', 'T1', 45.4, 11.9, { TEMP:'40' }, { latest_time:iso(NOW - 4 * H) }),
                 fake('VEN', 'T2', 45.5, 11.8, { TEMP:'12' }, { lag:{ TEMP:150 } }),
                 fake('VEN', 'T3', 45.6, 11.7, { TEMP:'10' }), fake('VEN', 'T4', 45.7, 11.6, { TEMP:'5' })], 'TEMP');
    eq('ritardo: grigio chiaro', NEUTRAL_COLOR, '#cfd6dd');
    eq('ritardo: 4 h fa, e 1 h fa con la temperatura indietro di 150 min, grigie', [fill('T1'), fill('T2')],
       [NEUTRAL_COLOR, NEUTRAL_COLOR]);
    log(![NEUTRAL_COLOR, DOT_COLOR].includes(fill('T3')), 'ritardo: 1 h fa colorata', fill('T3'));
    const o1 = (markerRefs.find(r => r.p.scode === 'T1') || { m:{ options:{} } }).m.options;
    eq('ritardo: cerchio vuoto col bordo grigio (non si confonde con 0 mm)', [o1.fillOpacity, o1.color], [0, '#8795a3']);
    await scene([fake('VEN', 'T5', 45.4, 11.9, { QSPEC:'40' }, { latest_time:iso(NOW - 4 * H) }),
                 fake('VEN', 'T6', 45.6, 11.7, { QSPEC:'10' }), fake('VEN', 'T7', 45.7, 11.6, { QSPEC:'5' })], 'QSPEC');
    eq('ritardo: la scala va da 5 a 10, senza le grigie', [...el('dkScale').querySelectorAll('.sc-ends span')]
       .map(e => e.textContent), ['5.0', '10.0']);
    await scene([fake('AQ_LOM', 'P1', 45.5, 9.2, { PM10:'30' }, { rif:{ PM10:30 }, latest_time:iso(NOW - 30 * H) })],
                'PM10');
    eq('ritardo: il PM10 di ieri non e\' mai in ritardo', fill('P1'), '#50ccaa');
    if(typeof aqDay !== 'undefined'){       // il giorno dei valori di ieri scritto dall'export, per regione
      aqDay.AQ_LOM = iso(NOW - 48 * H).slice(0, 10); renderMarkers();
      eq('ieri: valori dell\'altro ieri (copia vecchia) non valgono', fill('P1'), NEUTRAL_COLOR);
      aqDay.AQ_LOM = iso(NOW - 24 * H).slice(0, 10); renderMarkers();
      eq('ieri: valori di ieri valgono', fill('P1'), '#50ccaa');
    } else log(false, 'ieri: giorno di riferimento per regione', '');
    // tutte in ritardo (la Lombardia da sola, la mattina): la plancia resta, con il nome, «in ritardo» e Valori
    await scene([fake('LOM', 'Z1', 45.5, 9.2, { TEMP:'7' }, { latest_time:iso(NOW - 8 * H) }),
                 fake('LOM', 'Z2', 45.6, 9.3, { TEMP:'6' }, { latest_time:iso(NOW - 8 * H) })], 'TEMP');
    const vis2 = id => !!el(id) && getComputedStyle(el(id)).display !== 'none';
    log(vis2('colorbar') && el('dkName').textContent === 'Temperatura aria' && (PHONE.matches || vis2('dkNd')) &&
        vis2('dkVal'), 'tutte in ritardo: la plancia resta', JSON.stringify([vis2('colorbar'), el('dkName').textContent,
                                                                            vis2('dkNd'), vis2('dkVal')]));
    // dati vecchi, senza rif ne' lag (riserva di jsDelivr): grigio per le variabili col riferimento, nessun errore
    await scene([fake('VEN', 'O1', 45.4, 11.9, { PREC:'0.4' }), fake('VEN', 'O2', 45.5, 11.8, { PREC:'0' })], 'PREC');
    eq('dati vecchi: pioggia senza rif in grigio', [fill('O1'), fill('O2')], [NEUTRAL_COLOR, NEUTRAL_COLOR]);
    eq('legenda: in ritardo', el('dkNd').textContent, 'in ritardo');

    // la somma e il massimo da mezzanotte (esclusa), con almeno il 70% delle ore
    const M = Date.UTC(2026, 10, 19) / 1000, TT = [M - 7200, M - 3600, M, M + 3600, M + 7200, M + 10800];
    const dr = (a, agg) => typeof dayRunning === 'function' ? dayRunning(TT, a, agg) : null;
    eq('da mezzanotte: somma', dr([1, 1, 1, 1, 1, 1], 'sum'), [null, null, 0, 1, 2, 3]);
    eq('da mezzanotte: massimo', dr([1, 1, 1, 1, 3, 1], 'max'), [null, null, null, 1, 3, 3]);
    eq('da mezzanotte: un\'ora su tre non basta', dr([1, 1, 1, null, null, 1], 'sum'), [null, null, 0, null, null, null]);
    eq('da mezzanotte: stazione spenta, niente zero', dr([null, null, null, null, null, null], 'sum'),
       [null, null, null, null, null, null]);
    const TD = [M - 3600, M, M + 3600, M + 3 * 3600];                    // ora legale: le 02:00 civili non ci sono
    eq('da mezzanotte: il giorno dell\'ora legale conta i fotogrammi',
       typeof dayRunning === 'function' ? dayRunning(TD, [1, 1, 1, 1], 'sum') : null, [null, 0, 1, 2]);
    // il menu della pioggia: "oggi" prima delle finestre, porta alla Precipitazione delle misure dirette
    await scene([fake('VEN', 'R1', 45.4, 11.9, { PREC:'0.2', PREC24:4 }, { rif:{ PREC:3 } })], 'PREC24');
    openProdMenu();
    const first = el('prodMenu').querySelector('button');
    eq('menu della pioggia: primo pulsante', first && first.textContent, 'oggi');
    if(first){ first.click(); await sleep(200); }
    eq('menu della pioggia: oggi = Precipitazione delle misure dirette',
       [filterVar, currentPage, el('varPill').textContent.trim()], ['PREC', 'dirette', varLabel('PREC')]);

    // etichette: 60 stazioni fitte, una ogni nove in ritardo
    const many = [];
    for(let i = 0; i < 60; i++) many.push(fake('VEN', 'E' + i, 45.2 + (i % 10) * 0.05, 11.5 + Math.floor(i / 10) * 0.08,
                                               { TEMP:String(5 + i / 7) }, i % 9 ? {} : { latest_time:iso(NOW - 5 * H) }));
    await scene(many, 'TEMP');
    if(!valuesOn() && el('mcValues')) el('mcValues').click();
    let ls = null;
    try { ls = localStorage.getItem('mapValues'); } catch(e){}
    map.setView([45.45, 11.7], 9); await sleep(400);
    log(labs().length > 0 && ls === '1', 'Valori: etichette accese e ricordate', JSON.stringify([labs().length, ls]));
    const pairs = () => {
      const R = labs().map(e => e.getBoundingClientRect());
      let n = 0;
      for(let i = 0; i < R.length; i++) for(let j = i + 1; j < R.length; j++)
        if(R[i].left < R[j].right && R[j].left < R[i].right && R[i].top < R[j].bottom && R[j].top < R[i].bottom) n++;
      return n;
    };
    for(const z of [7, 9, 11]){
      map.setView([45.45, 11.7], z); await sleep(400);
      log(labs().length > 0 && pairs() === 0, 'etichette: nessuna sovrapposta a zoom ' + z, JSON.stringify([labs().length, pairs()]));
    }
    map.setView([45.45, 11.7], 11); await sleep(400);
    const under = markerRefs.filter(r => r.under);
    log(under.length > 0 && under.length === labs().length && under.every(r => r.m.options.opacity === 0),
        'etichette: il puntino sotto si nasconde', JSON.stringify([under.length, labs().length]));
    log(labs().some(e => e.classList.contains('late')), 'etichette: in ritardo grigie', '');
    const lateLab = labs().find(e => e.classList.contains('late'));
    eq('etichette: in ritardo vuote, col bordo grigio', lateLab ? [getComputedStyle(lateLab).backgroundColor,
       getComputedStyle(lateLab).borderTopColor] : null, ['rgb(255, 255, 255)', 'rgb(135, 149, 163)']);
    const fits = e => {                         // larghezza del testo vero (Range) contro lo spazio fra i bordi
      const r = document.createRange(), cs = getComputedStyle(e);
      r.selectNodeContents(e);
      return r.getBoundingClientRect().width <= e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 0.25;
    };
    eq('etichette: il numero sta dentro', labs().filter(e => !fits(e)).map(e => e.textContent).slice(0, 4), []);
    {                                     // l'ora di Roma si legge una volta per disegno, non per stazione
      const orig = Date.prototype.toLocaleString;
      let n = 0;
      Date.prototype.toLocaleString = function(){ n++; return orig.apply(this, arguments); };
      try { renderMarkers(); } finally { Date.prototype.toLocaleString = orig; }
      log(n <= 2, 'ritardo: l\'ora di adesso letta una volta per disegno', n);
    }
    eq('etichette: testi', typeof labelText === 'function'
       ? [labelText('TEMP', 8.84), labelText('UMID', 93.4), labelText('LIVIDRO', 12.4), labelText('LIVIDRO', -5),
          labelText('TEMP', -0.04)] : null, ['8.8', '93', '+12', '−5', '0.0']);
    {                                     // a ogni zoom le etichette si costruiscono una volta sola
      let added = 0;
      const mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
        if(n.querySelector && n.querySelector('.vl')) added++;
      })));
      mo.observe(map.getPanes().markerPane, { childList:true });
      map.setZoom(map.getZoom() - 1); await sleep(500);
      mo.disconnect();
      eq('etichette: una volta sola a ogni zoom', added, labs().length);
      map.setZoom(map.getZoom() + 1); await sleep(400);
    }
    {                                     // la scheda al passaggio non copre l'etichetta
      const L1 = labs().filter(e => !e.classList.contains('late')).sort((a, b) => b.offsetWidth - a.offsetWidth)[0];
      const R1 = L1 && markerRefs.find(r => r.p._region + '|' + r.p.scode === L1.dataset.k);
      if(R1){
        lastPointer = 'mouse'; showCard(R1.p, R1.m); await sleep(250);
        const a = L1.getBoundingClientRect(), c = el('hoverCard').getBoundingClientRect();
        log(!(a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom), 'scheda: non copre l\'etichetta',
            JSON.stringify([Math.round(a.right), Math.round(c.left)]));
        hideCard();
      }
    }
    {
      const L2 = labs().filter(e => !e.classList.contains('late')).pop();
      const R2 = L2 && markerRefs.find(r => r.p._region + '|' + r.p.scode === L2.dataset.k);
      log(!!R2, 'tocco: una stazione con l\'etichetta', '');
      if(R2){
        eq('tocco: prima nessun bordo', document.querySelectorAll('.vl.sel').length, 0);
        openSheet(R2.p, R2.m); await sleep(200);
        const sel2 = document.querySelector('.vl.sel');
        eq('tocco: l\'etichetta della stazione toccata ha il bordo', sel2 && sel2.dataset.k, L2.dataset.k);
        closeSheet(); await sleep(150);
        eq('tocco: chiuso il foglio, nessun bordo', document.querySelectorAll('.vl.sel').length, 0);
      }
    }
    // clic su un'etichetta: apre la stazione, come il puntino; al ritorno la sua etichetta e' selezionata
    const lab0 = labs().find(e => !e.classList.contains('late'));
    if(lab0){
      lastPointer = 'mouse';
      const rr = lab0.getBoundingClientRect(), k0 = lab0.dataset.k;
      lab0.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, clientX:rr.left + 4, clientY:rr.top + 4 }));
      await until(() => currentStation && currentStation._region + '|' + currentStation.scode === k0, 5000);
      eq('etichette: il clic apre la stazione', currentStation && currentStation._region + '|' + currentStation.scode, k0);
      showMapView(); renderMarkers(); await sleep(400);
      const sel = document.querySelector('.vl.sel');
      eq('etichette: la stazione selezionata ha il bordo', sel && sel.dataset.k, k0);
      log(!!sel && fits(sel), 'etichette: selezionata, il numero sta dentro', sel && sel.textContent);
      selectedKey = ''; renderMarkers(); await sleep(200);
      eq('etichette: deselezionata, nessun bordo', document.querySelectorAll('.vl.sel').length, 0);
    }
    else log(false, 'etichette: una non in ritardo', '');
    // scheda al passaggio: il valore della mappa col riferimento, l'ora della variabile, il livello che sale
    await scene([fake('VEN', 'C1', 45.4, 11.9, { PREC:'0.2', TEMP:'7' }, { rif:{ PREC:8 }, lag:{ PREC:120 } }),
                 fake('VEN', 'C2', 45.5, 11.8, { LIVIDRO:'1.2' }, { rif:{ LIVIDRO:0.12 } })], 'PREC');
    const C1 = allFeatures[0].properties, C2 = allFeatures[1].properties, mk = p => markerRefs.find(r => r.p === p);
    lastPointer = 'mouse';
    showCard(C1, mk(C1).m); await sleep(200);
    const q = s => (el('hoverCard').querySelector(s) || {}).textContent;
    eq('scheda: pioggia di oggi', q('.hc-val'), '8.0 mm oggi');
    const tv = new Date(isoCivil(C1.latest_time) - 120 * 60000), hm = pad(tv.getUTCHours()) + ':' + pad(tv.getUTCMinutes());
    log((q('.hc-time') || '').startsWith(hm), 'scheda: l\'ora della pioggia, non della stazione', JSON.stringify([q('.hc-time'), hm]));
    hideCard();
    setMapVar(''); setMapVar('LIVIDRO'); await sleep(200);
    if(mk(C2)){ showCard(C2, mk(C2).m); await sleep(200); }
    eq('scheda: livello, quanto è salito in 3 ore', q('.hc-delta'), '↑ 12 cm in 3 ore');
    hideCard();
    // ricerca: il suggerimento ha il valore della mappa
    setMapVar(''); setMapVar('PREC'); await sleep(200);
    el('stationQ').value = 'Prova C1';
    el('stationQ').dispatchEvent(new Event('input', { bubbles:true })); await sleep(200);
    const sv = (el('searchList').querySelector('.sr-v') || {}).textContent;
    eq('ricerca: valore della mappa', sv, '8.0 mm oggi');
    el('stationQ').value = '';
    el('stationQ').dispatchEvent(new Event('input', { bubbles:true }));

    // telefono: l'interruttore si vede con la plancia aperta e niente esce dallo schermo
    if(PHONE.matches){
      dockMin(false); await sleep(300);
      const r = el('dkVal') ? el('dkVal').getBoundingClientRect() : { width:0 };
      log(r.width > 0 && r.right <= innerWidth + 0.5 && document.documentElement.scrollWidth <= innerWidth,
          'telefono: interruttore nello schermo a ' + innerWidth + ' px', JSON.stringify([r.left, r.right, innerWidth]));
    }

    eq('errori JS', window.__errs, []);
    finish();
  }

  async function suiteAggiorna(){                     // aggiornamento automatico: mappa, scheda aperta, Cursore, pagina nascosta
    window.__errs = [];
    const P = allFeatures.map(f => f.properties).find(p => p._region === 'VEN' && (p.variables || []).includes('TEMP'));
    log(!!P, 'stazione di prova trovata', '');
    if(!P) return finish();
    eq('ogni 2 minuti', LIVE_MS, 120000);
    // file finti: una richiesta che finisce con una chiave di fake ha il suo testo (o la risposta della sua funzione,
    // anche in ritardo), il resto va al server; asked = richieste fatte, con la loro cache
    const realFetch = window.fetch, realRender = renderMarkers, fake = {}, asked = [];
    window.fetch = (u, o) => {
      const s = String(u).split('?')[0];
      asked.push({ u:s, c:o && o.cache });
      const k = Object.keys(fake).find(k => s.endsWith('/' + k));
      if(!k) return realFetch(u, o);
      return Promise.resolve(typeof fake[k] === 'function' ? fake[k]() : new Response(fake[k], { status:200 }));
    };
    const later = (ms, path) => async () => { await sleep(ms); return realFetch(path); };
    const askedFor = re => asked.some(a => re.test(a.u));
    let nRender = 0;
    renderMarkers = function(){ nRender++; return realRender.apply(this, arguments); };
    const geo = JSON.parse(await (await realFetch('VEN/stations.geojson')).text());
    const feat = geo.features.find(f => f.properties.scode === P.scode);
    const bump = () => {
      const p = feat.properties;
      p.latest.TEMP = Math.round((Number(p.latest.TEMP) + 1.3) * 10) / 10;
      fake['VEN/stations.geojson'] = JSON.stringify(geo);
      return p.latest.TEMP;
    };
    const addRow = csv => {                           // una lettura in piu', 10 minuti dopo l'ultima
      const rows = csv.trimEnd().split('\n'), last = rows[rows.length - 1].split(',');
      last[0] = new Date(Date.parse(last[0] + ':00Z') + 600000).toISOString().slice(0, 16);
      return rows.concat(last.join(',')).join('\n') + '\n';
    };
    const newer = p => {
      const k = p._region + '/' + p.series;
      fake[k] = addRow(typeof fake[k] === 'string' ? fake[k] : p._csv);
    };

    // MAPPA
    nRender = 0;
    eq('mappa: file uguali, niente ridisegno', [await refreshStations(), nRender], [false, 0]);
    map.setView([45.4, 11.9], 9); await sleep(300);
    const c0 = map.getCenter(), z0 = map.getZoom(), n0 = allFeatures.length;
    const mref = markerRefs.find(r => r.p === P);
    if(mref) showCard(P, mref.m);
    const t1 = bump();
    nRender = 0;
    const r1 = await refreshStations();
    const P2 = allFeatures.find(f => f.properties._region === 'VEN' && f.properties.scode === P.scode).properties;
    log(r1 === true && nRender >= 1, 'mappa: file cambiato, puntini ridisegnati', JSON.stringify([r1, nRender]));
    log(P2 === P && Number(P.latest.TEMP) === t1, 'mappa: stessa stazione, valore nuovo',
        JSON.stringify([P2 === P, P.latest.TEMP, t1]));
    eq('mappa: stesse stazioni', allFeatures.length, n0);
    log(map.getZoom() === z0 && map.getCenter().distanceTo(c0) < 1, 'mappa: la vista resta', '');
    log(!!mref && cardP === P && !el('hoverCard').hidden, 'mappa: la scheda al passaggio resta',
        JSON.stringify([!!mref, !!cardP]));
    hideCard();
    eq('mappa: di nuovo uguale, niente ridisegno', await refreshStations(), false);

    // SCHEDA
    await selectStation(P); await until(() => currentStation === P && !!chart, 8000);
    if(currentVar !== 'TEMP'){ drawVar('TEMP'); await sleep(200); }
    const f0 = chart._full(), SPAN = 6 * 3600, c1 = chart;
    chart.setScale('x', { min:f0[1] - SPAN, max:f0[1] });
    await liveStation();
    log(chart === c1, 'scheda: serie uguale, grafico non ridisegnato', '');
    newer(P);
    await liveStation();
    const f1 = chart && chart._full(), s1 = chart && chart.scales.x;
    log(!!chart && chart !== c1, 'scheda: lettura nuova, grafico ridisegnato', '');
    log(!!f1 && f1[1] > f0[1] && Math.abs(s1.max - f1[1]) < 1 && Math.abs(s1.max - s1.min - SPAN) < 1,
        'scheda: stesso zoom, che segue l\'ultimo dato', JSON.stringify([f0, f1, s1 && [s1.min, s1.max]]));
    newer(P);
    expOpen(); await sleep(50);
    const c2 = chart;
    await liveStation();
    log(chart === c2, 'scheda: menu aperto, niente ridisegno', '');
    expClose(); await sleep(50);
    await liveStation();
    log(!!chart && chart !== c2, 'scheda: menu chiuso, ridisegno', '');
    {                                                 // il «passaggio» rimasto dopo un tocco sul telefono non blocca
      const mm = window.matchMedia, mt = Element.prototype.matches;
      Element.prototype.matches = function(s){ return s === ':hover' ? true : mt.call(this, s); };
      _touchAt = 0;
      window.matchMedia = q => /hover/.test(q) ? { matches:false } : mm.call(window, q);
      const phone = chartInUse();
      window.matchMedia = q => /hover/.test(q) ? { matches:true } : mm.call(window, q);
      const desk = chartInUse();
      window.matchMedia = mm; Element.prototype.matches = mt;
      eq('in uso: il puntatore sopra conta solo col mouse', [phone, desk], [false, true]);
    }
    {                                                 // a meta' aggiornamento si apre lo Storico: niente ridisegno
      const k = 'VEN/' + P.series, txt = addRow(fake[k]), c3 = chart;
      fake[k] = async () => { await sleep(300); return new Response(txt); };
      const pr = liveStation(); await sleep(60); histMode = true; await pr; histMode = false;
      fake[k] = txt;
      log(chart === c3, 'scheda: lo Storico aperto nel frattempo non viene coperto', '');
    }
    {                                                 // rete: la serie a 30 giorni e le barre del radar restano
      const k30 = 'VEN/series30/' + P.scode + '.csv', old30 = parseCSV('datetime,TEMP\n2026-10-01T00:00,1\n');
      P._table30 = old30;
      newer(P);
      await freshTable(P);
      fake[k30] = () => new Response('', { status:500 });
      const ok = await ensureTable30();
      delete fake[k30];
      log(ok === true && P._table30 === old30, 'rete: senza la serie a 30 giorni nuova resta quella di prima',
          JSON.stringify([ok, P._table30 === old30]));
      P._table30 = null;
      const rp = Radar.points;
      P._radar = { t:[1], v:[1] };
      Radar.points = async () => null;
      const ch = await freshRadar(P);
      Radar.points = rp;
      log(ch === false && !!P._radar && P._radar.v[0] === 1, 'rete: senza risposta del radar restano le barre',
          JSON.stringify(ch));
      P._radar = undefined;
    }
    {                                                 // confronto 30 giorni zoomato; a meta' aggiornamento si sceglie
                                                      // 7 g: lo zoom di prima non passa al grafico nuovo
      const k30 = 'VEN/series30/' + P.scode + '.csv';
      await pickMode('compare30'); await until(() => chartMode === 'compare30' && !!chart, 8000);
      if(chart){
        const f = chart._full();
        chart.setScale('x', { min:f[0] + (f[1] - f[0]) / 2, max:f[1] });
        newer(P);
        fake[k30] = later(300, k30);
        const pr = liveStation(); await sleep(80); await pickMode('week'); await pr;
        delete fake[k30];
        log(chartMode === 'week' && !zoomState(), 'scheda: un periodo scelto a metà aggiornamento non prende lo zoom',
            JSON.stringify([chartMode, zoomState()]));
      } else log(false, 'scheda: confronto 30 giorni non disponibile', '');
      await pickMode('week');
    }
    {                                                 // grafico senza «Tutto» (bilancio idrico): lo zoom si tiene lo stesso
      const keep = chart, calls = [];
      chart = { data:[[0, 100, 200, 300]], scales:{ x:{ min:100, max:200 } }, setScale:(k, o) => calls.push([k, o.min, o.max]) };
      const z = zoomState();
      chart.data = [[0, 100, 200, 300, 400]];
      restoreZoom(z);
      chart = keep;
      eq('zoom senza «Tutto»: si rimette uguale', [!!z, calls], [true, [['x', 100, 200]]]);
    }
    const Pd = allFeatures.map(f => f.properties).find(p => p._region === 'VEN' && p.scode === '234');
    if(PHONE.matches && Pd){                          // telefono: l'aggiornamento non riporta la scheda in cima
      await selectStation(Pd); await until(() => currentStation === Pd && !!chart, 8000);
      drawVar('PREC'); await pickMode('near'); await until(() => !!stackObj && !!stackObj.near, 15000); await sleep(300);
      const pn = el('panel');
      pn.scrollTop = 150; await sleep(50);
      const top = pn.scrollTop;
      newer(Pd);
      await liveStation(); await sleep(100);
      log(top > 0 && Math.abs(pn.scrollTop - top) <= 2, 'telefono: l\'aggiornamento non riporta la scheda in cima',
          JSON.stringify([top, pn.scrollTop]));
      await pickMode('week');
    } else log(true, 'scorrimento della scheda: solo sul telefono (prova saltata)', '');

    // CURSORE
    showMapView(); await sleep(100);
    setMapVar('TEMP'); await sleep(100);
    await openSlider(); await until(() => snap.on && snap.T.length > 0, 8000);
    setFrame(snapSource.max());
    asked.length = 0;
    bump(); await refreshStations();
    log(snap.on && tsK === snapSource.max(), 'Cursore: resta all\'ultimo fotogramma', JSON.stringify([tsK, snapSource.max()]));
    log(asked.some(a => /VEN\/snap\/TEMP\.json$/.test(a.u) && a.c === 'no-cache'), 'Cursore: fotogrammi ricontrollati sul server',
        JSON.stringify(asked.filter(a => /snap/.test(a.u)).slice(0, 2)));
    setFrame(snapSource.max() - 5);
    const tb = snap.T[tsK];
    bump(); await refreshStations();
    eq('Cursore: resta alla stessa ora', snap.T[tsK], tb);
    {                                                 // fotogrammi in ritardo: intanto si sposta il Cursore e cambia il
                                                      // messaggio; restano quelli scelti dopo
      fake['VEN/snap/TEMP.json'] = later(300, 'VEN/snap/TEMP.json');
      setFrame(snapSource.max()); setStatus('prima');
      bump();
      const pr = refreshStations(); await sleep(80);
      setFrame(snapSource.max() - 3); setStatus('dopo');
      const td = snap.T[tsK];
      await pr;
      delete fake['VEN/snap/TEMP.json'];
      eq('Cursore: spostato durante l\'aggiornamento, resta dove l\'ho messo', snap.T[tsK], td);
      eq('messaggio: resta il più recente', el('status').textContent, 'dopo');
      setStatus('');
    }
    closeSlider();

    // PAGINA NASCOSTA
    Object.defineProperty(document, 'hidden', { configurable:true, get:() => true });
    asked.length = 0;
    await liveTick();
    eq('pagina nascosta: nessuna richiesta', asked.length, 0);
    delete document.hidden;
    _liveAt = 0;
    document.dispatchEvent(new Event('visibilitychange'));
    await until(() => askedFor(/stations\.geojson$/), 5000);
    log(askedFor(/status\.json$/) && askedFor(/stations\.geojson$/), 'tornando sulla pagina: ricontrollo subito',
        JSON.stringify(asked.slice(0, 3)));
    await until(() => !_liveRun, 10000);

    window.fetch = realFetch;
    renderMarkers = realRender;
    eq('errori JS', window.__errs, []);
    finish();
  }

  const suite = new URLSearchParams(location.search).get('suite') || 'radar';
  ready().then(() => ({ cursor:suiteCursor, radar:suiteRadar, hash:suiteHash, layout:suiteLayout, resilience:suiteResilience, prodotti:suiteProdotti,
            dock:suiteDock, buffer:suiteBuffer, oralegale:suiteOraLegale, search:suiteSearch, hover:suiteHover,
            hoverradar:suiteHoverRadar, stazione:suiteStazione, storico:suiteStorico, schede:suiteSchede,
            pulizia:suitePulizia, clima:suiteClima, rifinitura:suiteRifinitura, nuove:suiteNuove,
            valori:suiteValori, aggiorna:suiteAggiorna })[suite]())
         .catch(e => { log(false, 'eccezione', e && e.stack || e); finish(); });
})();
