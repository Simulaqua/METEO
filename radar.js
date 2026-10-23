// ------------------------------------------------------------------------------------------------
// RADAR DPC sulla mappa: i prodotti della piattaforma Radar-DPC della Protezione Civile (pioggia adesso e
// cumulate, riflettivita' anche in quota, acqua in colonna, altezza dei temporali, grandine, nuvole, temperatura),
// ultime 6 ore. I fotogrammi (PNG a palette sulla griglia Web Mercator del Nord Italia) li prepara il Pi
// (dati_radar.py) e li pubblica sul branch 'radar' con index.json: per ogni prodotto etichetta, unita', passo,
// soglie e colori della palette, variabile delle stazioni con la stessa scala, fotogrammi. Licenza CC BY-SA 4.0.
//
// Uso dalla pagina:  Radar.init({map, onState, onTime, onFrames, stationLabel, now, product})  una volta;
//   Radar.enable() / disable();  Radar.state = 'off' | 'on' | 'zoom' | 'fermo' | 'nd';
//   Radar.products() -> menu;  Radar.setProduct(chiave);  Radar.product / Radar.legend() -> prodotto scelto;
//   Radar.source = sorgente di tempo per il Cursore {min, max, label, title, apply, next, periodMs, loop}.
// ------------------------------------------------------------------------------------------------
const Radar = (() => {
  const BASE = window.RADAR_BASE_OVERRIDE || 'https://raw.githubusercontent.com/Simulaqua/METEO/radar';
  const FALLBACK = window.RADAR_FALLBACK_OVERRIDE || 'https://cdn.jsdelivr.net/gh/Simulaqua/METEO@radar';
  const MAX_ZOOM = 10;              // oltre, il dato a 1 km diventa quadrotti: il layer si nasconde
  const OPACITY = 0.75, POLL_MS = 120000, FRAME_MS = 250;
  const ATTRIB = '<a href="https://radar.protezionecivile.it" target="_blank" rel="noopener">Radar-DPC</a>'
               + ' – Protezione Civile (CC BY-SA)';
  // palette della pioggia oraria (manifest del rilascio 1, senza colori): come RAIN_STEPS.PREC1 / RAIN_COLORS
  const RAIN = { steps:[0.1, 0.5, 1, 2, 5, 10, 20, 30, 50],
                 colors:['', '#a9d6f2', '#6db3e6', '#3a8fd9', '#2a62c4', '#4b3fb8', '#8a2fb0', '#d0238c', '#e5412d', '#8e0b0b'] };
  // manifest del rilascio 1 (solo SRI, senza etichette, puntini e colori): valori del rilascio 1
  const V1 = { SRI:{ group:'Pioggia', label:'Adesso', unit:'mm/h', step:300, dots:'PREC1', colors:RAIN.colors } };
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const WD = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];

  let map = null, opt = {}, all = {}, order = [], cur = '', frames = [], k = -1, live = true, on = false, state = 'off';
  let imgs = [], front = 0, pending = null, shownT = null, timer = null;
  let wantT = null;                                            // istante scelto dall'utente (niente deriva fra prodotti)
  let waitFirst = false;                                       // precaricamento in attesa del primo fotogramma mostrato
  // chiavi "PRODOTTO/istante" (gli istanti si ripetono): mancanti, gia' chiesti al precaricamento, gia' scaricati
  const failed = new Set(), preloaded = new Set(), done = new Set();

  const z2 = n => (n < 10 ? '0' : '') + n;
  const now = () => (opt.now ? opt.now() : Date.now()) / 1000;
  // ora legale europea: dall'ultima domenica di marzo all'ultima di ottobre, alle 01:00 UTC
  const lastSunday1 = (y, m) => { const d = new Date(Date.UTC(y, m + 1, 0, 1)); return d.getTime() / 1000 - d.getUTCDay() * 86400; };
  // epoch UTC -> epoch "ora civile italiana ingenua come UTC" (stessa convenzione dei fotogrammi delle stazioni)
  function utcToCivil(sec){
    const y = new Date(sec * 1000).getUTCFullYear();
    return sec + (sec >= lastSunday1(y, 2) && sec < lastSunday1(y, 9) ? 7200 : 3600);
  }
  const fmt = civ => { const d = new Date(civ * 1000);
    return WD[d.getUTCDay()] + ' ' + z2(d.getUTCDate()) + '/' + z2(d.getUTCMonth() + 1) + ' ' + z2(d.getUTCHours()) + ':' + z2(d.getUTCMinutes()); };
  const hhmm = civ => { const d = new Date(civ * 1000); return z2(d.getUTCHours()) + ':' + z2(d.getUTCMinutes()); };
  const day = civ => { const d = new Date(civ * 1000); return WD[d.getUTCDay()].toLowerCase() + ' ' + z2(d.getUTCDate()) + '/' + z2(d.getUTCMonth() + 1); };
  const num = x => String(x).replace('.', ',');
  const P = () => all[cur] || {};
  // nome completo per popup e suggerimenti: "Pioggia 3 h", "Riflettività a 3 km", "Nuvole"
  const nameOf = p => p.group === 'Pioggia' ? 'Pioggia ' + String(p.label || '').toLowerCase() : (p.label || 'Radar');
  const fullName = () => nameOf(P());
  const steps = () => P().steps || RAIN.steps;
  const colors = () => P().colors || RAIN.colors;
  const unit = () => P().unit || 'mm/h';
  function classLabel(c){
    const st = steps(), u = ' ' + unit();
    if(c <= 0) return 'meno di ' + num(st[0]) + u;
    if(c >= st.length) return 'oltre ' + num(st[st.length - 1]) + u;
    return num(st[c - 1]) + '-' + num(st[c]) + u;
  }
  const fkey = t => cur + '/' + t;
  const frameName = t => { const d = new Date(t * 1000);
    return cur + '/' + d.getUTCFullYear() + z2(d.getUTCMonth() + 1) + z2(d.getUTCDate()) + z2(d.getUTCHours()) + z2(d.getUTCMinutes()) + '.png'; };
  const frameUrl = (t, fb) => (fb ? FALLBACK : BASE) + '/' + frameName(t);
  const abs = u => new URL(u, document.baseURI).href;
  // fermo = ultimo fotogramma piu' vecchio di 2 passi + 30 min (pioggia adesso: 40 min; cumulate, ogni 30 min con
  // ~40 min di ritardo: 90 min; temperatura oraria: 150 min)
  const stale = () => frames.length > 0 && now() - frames[frames.length - 1] > 2 * (P().step || 300) + 1800;
  const hidden = () => map.getZoom() > MAX_ZOOM;

  // riga/colonna della griglia per lat/lon (bordi esatti da index.json: la griglia e' Web Mercator, uguale per tutti)
  const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  function gridPixel(lat, lon){
    const p = P(); if(!p.bounds) return null;
    const [[s, w], [n, e]] = p.bounds, [W, H] = p.size;
    const c = Math.floor((lon - w) / (e - w) * W), r = Math.floor((mercY(n) - mercY(lat)) / (mercY(n) - mercY(s)) * H);
    return (r >= 0 && r < H && c >= 0 && c < W) ? [r, c] : null;
  }

  function setState(s){ if(s !== state){ state = s; if(opt.onState) opt.onState(s); } }
  function updateState(){ if(on) setState(hidden() ? 'zoom' : stale() ? 'fermo' : 'on'); }

  async function fetchManifest(){
    const r = await fetch(BASE + '/index.json', { cache:'no-store' });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const m = await r.json(), ps = m.products || {};
    Object.keys(V1).forEach(key => { if(ps[key]) ps[key] = Object.assign({}, V1[key], ps[key]); });
    const ord = (m.order || Object.keys(ps)).filter(key => ps[key] && Array.isArray(ps[key].frames) && ps[key].frames.length);
    if(!ord.length) throw new Error('indice vuoto');
    return { products:ps, order:ord };
  }

  // ---- doppio buffer: il fotogramma nuovo si carica nell'overlay nascosto e si scambia solo a caricamento
  // avvenuto (niente lampeggi); un fotogramma mancante si riprova da jsDelivr, poi si salta.
  function makeOverlay(){
    const o = L.imageOverlay(BLANK, P().bounds, { pane:'radarPane', opacity:0, interactive:false, crossOrigin:'anonymous' });
    o.on('load', () => onLoaded(o, true)).on('error', () => onLoaded(o, false));
    return o.addTo(map);
  }
  function onLoaded(o, ok){
    if(!on || !pending || o !== imgs[1 - front] || o.getElement().src !== abs(pending.url)) return;   // caricamento superato
    if(ok){ front = 1 - front; shownT = pending.t; done.add(fkey(shownT)); pending = null; paint(); firstShown(); return; }
    if(!pending.fb){ pending = { t:pending.t, fb:true, url:frameUrl(pending.t, true) }; o.setUrl(pending.url); return; }
    failed.add(fkey(pending.t)); pending = null; firstShown();
  }
  // all'accensione e al cambio di prodotto il primo fotogramma arriva da solo (tutta la banda per lui); poi il resto
  function firstShown(){
    if(waitFirst){ waitFirst = false; preload(); }
    if(opt.onBuffer) opt.onBuffer();
  }
  function paint(){ imgs.forEach((o, i) => o.setOpacity(!hidden() && i === front && shownT != null ? OPACITY : 0)); }
  function show(i, keepWant){
    if(!on || !frames.length) return;
    const before = k >= 0 ? frames[k] : null;
    k = Math.max(0, Math.min(frames.length - 1, i));
    live = k === frames.length - 1;
    const t = frames[k];
    if(!keepWant && t !== before) wantT = t;            // riapplicare lo stesso fotogramma non e' una scelta
    if(opt.onTime) opt.onTime(t, utcToCivil(t));
    if(t === shownT && !pending){ return; }
    pending = { t, fb:false, url:frameUrl(t, false) };
    imgs[1 - front].setUrl(pending.url);
  }
  // scalda la cache del browser per il prodotto scelto, dal piu' vecchio (l'ordine del play: il primo giro si vede
  // man mano che arriva), 4 alla volta, nessuna immagine tenuta in memoria; ogni fotogramma una volta sola (i nomi non
  // cambiano mai): a ogni giro si scarica solo quello nuovo. Finito (anche con errore) = pronto per il play.
  function preload(){
    const todo = frames.filter(t => !preloaded.has(fkey(t))), key = cur;
    const next = () => {
      const t = todo.shift(); if(t == null || !on || key !== cur) return;
      preloaded.add(key + '/' + t);
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = im.onerror = () => { done.add(key + '/' + t); if(key === cur && opt.onBuffer) opt.onBuffer(); next(); };
      im.src = frameUrl(t, false);
    };
    for(let j = 0; j < 4; j++) next();
  }

  function setFrames(m){
    const curT = k >= 0 ? frames[k] : null, before = String(order) + '|' + String(frames);
    all = m.products; order = m.order;
    if(order.indexOf(cur) < 0) cur = order[0];
    frames = all[cur].frames.slice();
    const alive = new Set(); order.forEach(key => all[key].frames.forEach(t => alive.add(key + '/' + t)));
    [failed, preloaded, done].forEach(set => set.forEach(x => { if(!alive.has(x)) set.delete(x); }));
    updateState();
    const j = curT == null ? -1 : frames.indexOf(curT);
    if(live || j < 0) show(frames.length - 1); else k = j;
    const changed = before !== String(order) + '|' + String(frames);
    if(changed && opt.onFrames) opt.onFrames();          // dopo: Radar.index e' gia' quello giusto
    return changed;
  }
  async function poll(){
    if(!on) return;
    let m;
    try { m = await fetchManifest(); } catch(e){ updateState(); return; }    // si tiene quello che c'e'
    if(on && setFrames(m) && !waitFirst) preload();
  }
  // cambio prodotto: stesso istante (fotogramma piu' vicino non successivo) o di nuovo l'ultimo se si era "dal vivo"
  function setProduct(key){
    if(!all[key] || order.indexOf(key) < 0) return false;
    if(key === cur) return true;
    const t = wantT != null ? wantT : (k >= 0 ? frames[k] : null), wasLive = live;
    cur = key; frames = all[cur].frames.slice(); shownT = null; pending = null;
    let j = frames.length - 1;
    if(!wasLive && t != null){ j = -1; frames.forEach((x, i) => { if(x <= t) j = i; }); if(j < 0) j = 0; }
    live = j === frames.length - 1;
    updateState();
    if(on){ waitFirst = true; show(j, !wasLive); if(!pending) firstShown(); } else k = j;
    return true;
  }
  const onZoom = () => { paint(); updateState(); };
  const onVisible = () => { if(document.visibilityState === 'visible') poll(); };

  // tocco su un punto vuoto: classe del prodotto li' (letta dai pixel del fotogramma mostrato)
  let canvas = null;
  function onClick(e){
    if(!on || hidden() || shownT == null) return;
    const px = gridPixel(e.latlng.lat, e.latlng.lng); if(!px) return;
    const img = imgs[front].getElement();
    canvas = canvas || document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    let rgba;
    try { rgba = ctx.getImageData(px[1], px[0], 1, 1).data; } catch(err){ return; }   // immagine non leggibile (CORS)
    const cs = colors();
    let cls = cs.indexOf('');                                                 // trasparente = classe senza colore
    if(rgba[3] > 0){
      let best = 1e9;
      cs.forEach((hx, i) => { if(!hx) return;
        const d = [1, 3, 5].reduce((a, o, j) => a + Math.pow(parseInt(hx.substr(o, 2), 16) - rgba[j], 2), 0);
        if(d < best){ best = d; cls = i; } });
    }
    L.popup({ autoPan:false }).setLatLng(e.latlng)
     .setContent('<b>Radar ' + hhmm(utcToCivil(shownT)) + '</b> · ' + fullName() + ': ' + classLabel(Math.max(cls, 0))).openOn(map);
  }

  async function enable(){
    if(on) return true;
    let m;
    try { m = await fetchManifest(); } catch(e){ setState('nd'); return false; }
    if(!map.getPane('radarPane')){
      const pane = map.createPane('radarPane');
      pane.style.zIndex = 350;                            // sopra lo sfondo (200), sotto i puntini (400)
      pane.style.pointerEvents = 'none';
      const css = document.createElement('style');
      css.textContent = '.leaflet-radar-pane img{image-rendering:pixelated}';   // pixel nitidi
      document.head.appendChild(css);
    }
    on = true; live = true; k = -1; shownT = null; pending = null; front = 0; failed.clear(); frames = []; wantT = null;
    all = m.products; order = m.order;
    cur = order.indexOf(cur) >= 0 ? cur : order.indexOf(opt.product) >= 0 ? opt.product : order[0];
    imgs = [makeOverlay(), makeOverlay()];
    if(map.attributionControl) map.attributionControl.addAttribution(ATTRIB);
    map.on('zoomend', onZoom); map.on('click', onClick);
    document.addEventListener('visibilitychange', onVisible);
    timer = setInterval(poll, POLL_MS);
    waitFirst = true;                                    // il resto parte quando si vede il primo fotogramma
    setFrames(m);
    if(!pending) firstShown();
    return true;
  }
  function disable(){
    on = false; clearInterval(timer); timer = null;
    document.removeEventListener('visibilitychange', onVisible);
    map.off('zoomend', onZoom); map.off('click', onClick);
    imgs.forEach(o => map.removeLayer(o)); imgs = [];
    if(map.attributionControl) map.attributionControl.removeAttribution(ATTRIB);
    frames = []; k = -1; shownT = null; pending = null;
    setState('off');
  }

  const source = {
    periodMs: FRAME_MS, loop: true,
    min: () => 0,
    max: () => Math.max(0, frames.length - 1),
    label(i){
      const t = frames[i]; if(t == null) return '';
      const civ = utcToCivil(t), extra = [];
      if(opt.stationLabel){ const s = opt.stationLabel(civ); if(s) extra.push(s); }
      if(failed.has(fkey(t))) extra.push('non disponibile');
      if(stale()) extra.push('radar fermo alle ' + hhmm(utcToCivil(frames[frames.length - 1])));
      return '<span>' + hhmm(civ) + '</span><small>' + [day(civ)].concat(extra).join(' · ') + '</small>';   // ora grande, sotto il giorno
    },
    civ: i => frames[i] == null ? null : utcToCivil(frames[i]),         // istante in ora civile (tacche della barra)
    title: i => frames[i] == null ? '' : 'Radar DPC · ' + fullName() + ' (' + unit() + ') · ' + fmt(utcToCivil(frames[i])),
    apply: i => show(i),
    next(i){                                              // salta i fotogrammi mancanti; in fondo ricomincia
      for(let j = i + 1; j < frames.length; j++) if(!failed.has(fkey(frames[j]))) return j;
      for(let j = 0; j <= i && j < frames.length; j++) if(!failed.has(fkey(frames[j]))) return j;
      return -1;
    },
    // fotogramma gia' scaricato (o mancante: il play lo salta): il play aspetta quelli non ancora arrivati
    ready: i => frames[i] == null || done.has(fkey(frames[i])) || failed.has(fkey(frames[i])),
    buffered(){                                           // gia' scaricato dall'inizio, nella scala della barra (0-1)
      let j = 0;
      while(j < frames.length && source.ready(j)) j++;
      return j >= frames.length || frames.length < 2 ? 1 : j / (frames.length - 1);
    },
  };

  return {
    init(o){ opt = o || {}; map = opt.map; cur = opt.product || ''; },
    enable, disable, poll, source, utcToCivil, classLabel, gridPixel, setProduct,
    products: () => order.map(key => ({ key, group:all[key].group || '', label:all[key].label || key, name:nameOf(all[key]),
                                        unit:all[key].unit || '', frames:all[key].frames.length })),
    legend: () => ({ key:cur, label:fullName(), unit:unit(), steps:steps(), colors:colors(), dots:P().dots || null }),
    get product(){ return on ? { key:cur, label:fullName(), unit:unit(), dots:P().dots || null } : null; },
    get on(){ return on; }, get state(){ return state; }, get index(){ return k; },
  };
})();
