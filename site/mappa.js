// mappa.js: la mappa: sfondi, puntini e colori, legenda e plancia, Cursore, pulsanti, radar, schede.
// Gli ascoltatori sono in initMap() e buildMapControls(), chiamate all'avvio (comune.js).

const DOT_COLOR   = '#6795A1', DOT_LINE = '#264E5D';      // senza variabile: secondario, bordo principale
const NEUTRAL_COLOR = '#cfd6dd';               // valore mancante o in ritardo (il puntino resta cliccabile)

// Direzioni e categorie non hanno colori: si filtra la stazione ma i puntini restano uniformi
const NO_COLORMAP = new Set([...DIR_VARS, 'PREC_TYPE']);
const canColormap = v => !!v && !NO_COLORMAP.has(v);

// Livelli di fiumi, laghi e falda: ogni stazione ha il suo zero, quindi la mappa ne colora la variazione
// (l'export la scrive in rif) sulle ore che dice LEVEL_HOURS; laghi e falda si muovono piano
const LEVEL_HOURS = { LIVIDRO:3, LIVLAGO:24, FREATICA:24 };
// Riferimento del valore sulla mappa quando non e' l'ultimo letto: pioggia e raffica da mezzanotte, l'aria
// sul giorno che tutte le fonti hanno pubblicato, i livelli come variazione
const MAP_REF = { PREC:'oggi', VVENTOMAX:'max oggi', PM10:'ieri', PM25:'ieri', O3:'max ieri', NO2:'max ieri',
                  LIVIDRO:'in 3 ore', LIVLAGO:'in 24 ore', FREATICA:'in 24 ore' };
// Una stazione la cui ultima lettura della variabile ha piu' di LATE_H ore e' grigia e non entra nella
// scala (lo stesso numero sta in export_web.py); una variazione di 24 ore vale per un giorno. I valori di
// ieri e le derivate giornaliere non sono mai in ritardo.
const LATE_H = 3;
const MAP_DAILY = new Set(['PM10','PM25','O3','NO2','GDD','HDD','CDD','ET0']);
// Ora dell'ultima lettura di v (ms, ora civile letta come UTC); lag = minuti di ritardo sull'ultima misura
const varTime = (p, v) => isoCivil(p.latest_time) - 60000 * ((p.lag || {})[v] || 0);
// Il giorno dei valori "di ieri" di ogni regione, come lo scrive l'export: quelli di un altro giorno (una
// copia vecchia della riserva di jsDelivr, o l'ora fra mezzanotte e l'una d'estate) non sono di ieri
const aqDay = {};
function isLate(p, v, now){
  const t = now || nowRome();
  if(MAP_REF[v] && MAP_DAILY.has(v)){
    const day = aqDay[p._region];
    return !!day && isFinite(t) && day !== new Date(t - 86400000).toISOString().slice(0, 10);
  }
  return !MAP_DAILY.has(v) && t - varTime(p, v) > Math.max(LATE_H, LEVEL_HOURS[v] || 0) * 3600000;
}
// Con "Tutte" una variabile si colora se le stazioni hanno la stessa unita' o una che si converte; la
// pressione della stazione no, perche' dipende dalla quota
const ALTITUDE_BOUND = new Set(['PRESS']);
function comparable(v, list){
  if(ALTITUDE_BOUND.has(v)) return false;
  const ref = refUnitFor(v, list);
  return list.every(f => {
    const u = unitOf(f.properties._region, v);
    return !u || u === ref || (u + '>' + ref) in UNIT_CONV;
  });
}
// Puntino in ritardo o senza valore: cerchio vuoto col bordo grigio, da non confondere con la pioggia "0 mm"
const EMPTY_LINE = '#8795a3';
const varTimeIso = (p, v) => (p.lag || {})[v] ? new Date(varTime(p, v)).toISOString().slice(0, 16)
                                              : p.latest_time;

// COLORI: ogni grandezza ha la sua scala. Classi fisse dove il valore conta da solo (lo stesso colore e' lo
// stesso valore in ogni ora e regione, anche col Cursore); per le altre una sfumatura fra minimo e massimo
// delle stazioni mostrate, nella tinta della grandezza. "Niente" (neve assente, notte, calma) ha il grigio
// chiaro della pioggia 0, che sta anche al centro delle scale a due tinte: nessun puntino valido e' bianco
// come un cerchio vuoto.
const NONE = '#e3e9f0';
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
function rampAt(stops, t){
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
  const a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]), c = k => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}
// Temperatura (anche dell'acqua, di rugiada e percepita): classi di 2 °C da -20 a 40, dal viola al rosso
const TEMP_RAMP = ['#30123b', '#466be3', '#28aae1', '#1ae4b6', '#5ffb71',
                   '#c0e539', '#faaf2a', '#f55c18', '#7a0403'];
const TEMP_STEPS = Array.from({ length:31 }, (_, i) => 2 * i - 20);
const TEMP_COLORS = [-21, ...TEMP_STEPS.map(s => s + 1)].map(m => rampAt(TEMP_RAMP, (m + 20) / 60));
// Vento: le classi della scala Beaufort, in m/s o in km/h come la mappa
const WIND_STEPS = { 'm/s':[1, 3, 5, 8, 11, 14, 17, 21], 'km/h':[4, 11, 18, 29, 40, 50, 61, 76] };
// Classi fisse: soglie (per unita' se le fonti ne usano piu' d'una) e un colore in piu' delle soglie
const CLASS_SCALES = {
  UMID:      { steps:[40, 50, 60, 70, 80, 90, 95],
               colors:['#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494',
                       '#081d58'] },
  LIVNEVE:   { steps:[1, 5, 10, 20, 50, 100, 200],
               colors:[NONE, '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b', '#3f007d'] },
  VVENTO:    { steps:WIND_STEPS,
               colors:[NONE, '#fcc5c0', '#fa9fb5', '#f768a1', '#dd3497', '#ae017e', '#7a0177', '#49006a',
                       '#2b0040'] },
  VVENTOMAX: { steps:WIND_STEPS,
               colors:[NONE, '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704',
                       '#4a1600'] },
  RADSOL:    { steps:[1, 100, 200, 300, 400, 500, 600, 800],
               colors:[NONE, '#fff7bc', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404',
                       '#662506'] },
  ONDE:      { steps:[0.1, 0.5, 1.25, 2.5, 4, 6],
               colors:[NONE, '#a6bddb', '#67a9cf', '#3690c0', '#02818a', '#016c59', '#014636'] },
  VISIB:     { steps:{ m:[1000, 2000, 5000, 10000] },
               colors:['#38434f', '#5f6a76', '#8a95a1', '#b6bfc9', '#d2d9e0'] },
  PSLM:      { steps:[995, 1000, 1005, 1010, 1016, 1020, 1025, 1030], every:10,
               colors:['#542788', '#8073ac', '#b2abd2', '#d8daeb', NONE, '#fee0b6', '#fdb863', '#e08214',
                       '#b35806'] },
  UWND:      { steps:[-10, -5, -2, 2, 5, 10],
               colors:['#2166ac', '#4393c3', '#92c5de', NONE, '#f4a582', '#d6604d', '#b2182b'] }
};
const TEMP_LIKE = ['TEMP', 'TEMPACQUA', 'TDEW', 'TAPP']
  .concat(MORE_VARS.filter(v => /^(TEMP|TSUOLO|TNEVE)/.test(v)));
TEMP_LIKE.forEach(v => { CLASS_SCALES[v] = { steps:TEMP_STEPS, colors:TEMP_COLORS, every:10 }; });
['VVENTOSCAL', 'VVENTO2', 'VVENTOVETT', 'VVENTOVETT2'].forEach(v => {
  CLASS_SCALES[v] = CLASS_SCALES.VVENTO;
});
['VVENTOMAX2', 'VVENTOMAX1S'].forEach(v => { CLASS_SCALES[v] = CLASS_SCALES.VVENTOMAX; });
CLASS_SCALES.VWND = CLASS_SCALES.UWND;
// Sfumature fra minimo e massimo, dal chiaro (poco) allo scuro (tanto), nella tinta dei grafici
const RAMPS = {
  slate:['#dfe4ea', '#c5cdd6', '#a9b3be', '#8d98a5', '#727e8c', '#596573', '#414c59', '#2b3540'],
  gold:['#fff7bc', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404', '#662506'],
  green:['#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
  brown:['#efe3cf', '#e0c9a6', '#cfad7e', '#b98f5c', '#a07342', '#855b30', '#694522', '#4d3117'],
  teal:['#ccece6', '#99d8c9', '#66c2a4', '#41ae76', '#238b45', '#006d2c', '#00441b'],
  sea:['#ccebc5', '#a8ddb5', '#7bccc4', '#4eb3d3', '#2b8cbe', '#0868ac', '#084081'],
  blue:['#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
  orange:['#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704'],
  red:['#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'],
  violet:['#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d']
};
const VAR_RAMP = {
  SOLEGG:'gold', BAGNATURA:'green', CLOROFILLA:'green', C6H6:'green', SOLIDI:'brown', O3_8H:'teal',
  ET0:'teal', SALINITA:'sea', QSPEC:'sea', OSSIGENO:'blue', OSSIGENO_SAT:'blue', HDD:'blue', VPD:'orange',
  CONDUCIBILITA:'orange', GDD:'orange', VVENTOMAX:'orange', CDD:'red', PH:'violet', VOLINVASO:'violet',
  VVENTO:'violet', VVENTOSCAL:'violet'
};
[['USUOLO', 'teal'], ['VELACQUA', 'blue'], ['TORBIDITA', 'brown'], ['RADRIFL', 'gold']].forEach(([p, r]) =>
  MORE_VARS.filter(v => v.startsWith(p)).forEach(v => { VAR_RAMP[v] = r; }));
const rampOf = v => RAMPS[VAR_RAMP[v]] || RAMPS.slate;
const EAQI_BANDS = [
  {v:1, c:'#50f0e6', l:'Buona'},        {v:2, c:'#50ccaa', l:'Discreta'},
  {v:3, c:'#f0e641', l:'Moderata'},     {v:4, c:'#ff5050', l:'Scarsa'},
  {v:5, c:'#960032', l:'Molto scarsa'}, {v:6, c:'#7d2181', l:'Estrem. scarsa'}
];
const EAQI_COLORS = EAQI_BANDS.map(b => b.c);
function eaqiColor(v){ return EAQI_COLORS[Math.max(1, Math.min(6, Math.round(v))) - 1]; }
const isEaqi = v => v === 'EAQI';
// Classi europee della qualita' dell'aria per sostanza (limiti superiori, colori di EAQI_BANDS)
const AQ_STEPS = { PM10:[20,40,50,100,150], PM25:[10,20,25,50,75], O3:[50,100,130,240,380],
                   NO2:[40,90,120,230,340], SO2:[100,200,350,500,750] };
// Livello: cm in 3 ore; cala in blu, sale in rosso. Il giallino "stabile" non e' il grigio dei ritardi.
// Laghi e falda: cm in 24 ore, coi colori del livello
const LEVEL_STEPS = [-20, -5, 5, 20, 50, 100];
const SLOW_STEPS = [-10, -2, 2, 10, 20, 40];
const LEVEL_COLORS = ['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#f46d43','#d73027','#a50026'];
const levelSteps = v => v === 'LIVIDRO' ? LEVEL_STEPS : SLOW_STEPS;
// Portata (anche afflusso e deflusso dei laghi), m³/s: classi a passi crescenti, dal torrente al Po
const FLOW_VARS = new Set(['PORTATA','AFFLUSSO','DEFLUSSO']);
const FLOW_STEPS = [1, 5, 20, 50, 100, 300, 1000];
const FLOW_COLORS = ['#e3eef9','#c6dbef','#9ecae1','#6baed6','#4292c6','#2171b5','#08519c','#08306b'];
// Marea in cm sullo zero di Punta della Salute, con le soglie di Venezia: 80 sostenuta, 110 molto sostenuta,
// 140 eccezionale. L'Emilia-Romagna misura dallo zero IGM 1942, 23.56 cm piu' in alto (Comune di Venezia,
// riferimenti altimetrici); il Tagliamento (OGS) non dice da quale zero e resta vuoto.
const TIDE_STEPS = [0, 50, 80, 110, 140];
const TIDE_COLORS = ['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#f46d43','#a50026'];
// I mareografi della Protezione civile del Friuli dichiarano lo zero IGM 1942, come l'Emilia-Romagna.
const TIDE_ZERO = { MAR_VEN:0, MAR_ER:23.56, PC_FVG:23.56 };
// Accanto al nome nella plancia: il riferimento del valore o lo zero a cui e' riportato
const mapName = v => varLabel(v) +
  (MAP_REF[v] ? ' · ' + MAP_REF[v] : v === 'MAREA' ? ' · zero Punta della Salute' : '');
// Pioggia: classi a soglie fisse (mm) per finestra di accumulo; i colori non dipendono dai dati,
// cosi' due momenti (o i fotogrammi del Cursore) si leggono allo stesso modo
const RAIN_COLORS = ['#e3e9f0','#a9d6f2','#6db3e6','#3a8fd9','#2a62c4',
                     '#4b3fb8','#8a2fb0','#d0238c','#e5412d','#8e0b0b'];
const RAIN_STEPS = {
  PREC1:[0.1,0.5,1,2,5,10,20,30,50],        PREC3:[0.1,1,2,5,10,20,40,60,80],
  PREC6:[0.2,1,3,6,12,25,50,75,100],        PREC12:[0.2,2,5,10,20,40,70,100,150],
  PREC24:[0.2,2,5,10,25,50,100,150,200],    PREC48:[0.2,5,10,25,50,100,150,200,300]
};
RAIN_STEPS.PREC = RAIN_STEPS.PREC24;                  // "Precipitazione": la pioggia di oggi
// Classi fisse di v nell'unita' u (null: sfumatura fra minimo e massimo). La soglia apre la classe sopra;
// l'aria segue la regola europea (la chiude sotto) e i livelli contano i centimetri scritti, col segno
function classScale(v, u){
  if(isRainVar(v)) return { steps:RAIN_STEPS[v], colors:RAIN_COLORS };
  if(AQ_STEPS[v]) return { steps:AQ_STEPS[v], colors:EAQI_COLORS, below:true };
  if(LEVEL_HOURS[v]) return { steps:levelSteps(v), colors:LEVEL_COLORS, round:true, sign:true };
  if(FLOW_VARS.has(v)) return { steps:FLOW_STEPS, colors:FLOW_COLORS };
  if(v === 'MAREA') return { steps:TIDE_STEPS, colors:TIDE_COLORS };
  const s = CLASS_SCALES[v], steps = s && (Array.isArray(s.steps) ? s.steps : s.steps[u]);
  return steps ? { steps, colors:s.colors, every:s.every } : null;
}
function classColor(v, x, u){
  const s = classScale(v, u);
  if(!s) return null;
  if(s.round) x = Math.round(x);
  return s.colors[s.steps.filter(t => s.below ? x > t : x >= t).length];
}
// Variabili con fotogrammi orari (l'export li scrive in <REGIONE>/snap/<VAR>.json)
const SNAP_VARS = new Set(['TEMP','UMID','PRESS','VVENTO','VVENTOMAX','PREC1','PREC3','PREC6','PREC12',
                           'PREC24','PREC48','PREC']);
// Pioggia e raffica di oggi nel Cursore: dai fotogrammi orari che ci sono gia' (la pioggia da quelli di 1 h)
const SNAP_FILE = { PREC:'PREC1' };
const MAP_RUNNING = { PREC:'sum', VVENTOMAX:'max' };
// Per ogni fotogramma la somma o il massimo delle ore dopo l'ultima mezzanotte civile (esclusa: l'epoch e'
// l'ora civile letta come UTC); null con meno del 70% delle ore, come le somme dell'export
function dayRunning(t, arr, agg){
  return t.map((tk, k) => {
    const start = tk - tk % 86400;
    let n = 0, frames = 0, acc = agg === 'sum' ? 0 : -Infinity;
    for(let j = k; j >= 0 && t[j] > start; j--){
      frames++;
      if(arr[j] == null) continue;
      n++;
      acc = agg === 'sum' ? acc + arr[j] : Math.max(acc, arr[j]);
    }
    if(!frames)                                  // mezzanotte: zero solo con un valore nelle 3 ore prima
      return agg === 'sum' && [1, 2, 3].some(d => arr[k - d] != null) ? 0 : null;
    // ore attese: i fotogrammi del giorno se la serie lo copre tutto (col cambio d'ora sono 23 o 25)
    const expected = t[0] <= start ? frames : (tk - start) / 3600;
    return n < 0.7 * expected ? null : Math.round(acc * 10) / 10;
  });
}
const snap = { on:false, var:'', unit:'', T:[], data:{}, shift:{}, mul:{}, cov:[], covMax:1,
               k:0, k0:0, kmax:0, playing:false, timer:null, speed:1, vmin:0, vmax:1, token:0 };
function unitForVar(v){
  for(const r in unitsByRegion){
    if(unitsByRegion[r] && unitsByRegion[r][v]) return unitsByRegion[r][v];
  }
  return '';
}
// Stessa grandezza con unita' diverse fra fonti (vento FVG in km/h, il resto in m/s): sulla mappa tutto
// all'unita' piu' diffusa fra le stazioni mostrate, cosi' la scala dei colori e' coerente. La radiazione di
// FVG e' l'energia dell'ora in kJ/m²; livelli e marea vanno in cm.
const UNIT_CONV = { 'km/h>m/s': 1/3.6, 'm/s>km/h': 3.6, 'kJ/m²>W/m²': 1/3.6, 'm>cm': 100 };
const unitFactor = (from, to) => (!from || !to || from === to) ? 1 : (UNIT_CONV[from + '>' + to] || 1);
const unitOf = (region, v) => normUnit((unitsByRegion[region] || {})[v]);
function refUnitFor(v, list){
  if(CM_VARS.has(v)) return 'cm';
  if(v === 'RADSOL') return 'W/m²';                // in Friuli le due fonti sono quasi alla pari
  const cnt = {};
  list.forEach(f => {
    const u = unitOf(f.properties._region, v);
    if(u) cnt[u] = (cnt[u] || 0) + 1;
  });
  let best = '', n = 0;
  for(const u in cnt) if(cnt[u] > n){ n = cnt[u]; best = u; }
  return best;
}
// Il valore che colora la stazione: il riferimento della variabile (rif) o l'ultimo letto, nell'unita' refU
function mapValue(p, v, refU){
  const src = MAP_REF[v] ? (p.rif || {})[v] : (p.latest || {})[v];
  const x = src == null ? NaN : parseFloat(src);
  if(isNaN(x)) return null;
  if(v === 'RADSOL' && x * unitFactor(unitOf(p._region, v), 'W/m²') > 1400) return null;    // guasto
  const fct = unitFactor(unitOf(p._region, v), refU), nv = fct === 1 ? x : Math.round(x * fct * 10) / 10;
  if(v === 'MAREA'){
    const zero = TIDE_ZERO[p._region];
    return zero == null ? null : Math.round((nv + zero) * 10) / 10;
  }
  return v === 'LIVNEVE' && nv < 0 ? 0 : nv;                       // neve: rumore del sensore attorno a zero
}

const svgIcon = d => '<svg viewBox="0 0 24 24">' + d + '</svg>';
const ICON = {
  play: svgIcon('<path d="M7 4v16l13 -8z"/>'),
  pause: svgIcon('<path d="M6 5h4v14h-4z"/><path d="M14 5h4v14h-4z"/>'),
  up: svgIcon('<path d="M6 15l6 -6l6 6"/>'),
  down: svgIcon('<path d="M6 9l6 6l6 -6"/>'),
  radar: svgIcon(
    '<path d="M21 12h-8a1 1 0 1 0 -1 1v8a9 9 0 0 0 9 -9"/><path d="M16 9a5 5 0 1 0 -7 7"/>' +
    '<path d="M20.5 9a9 9 0 1 0 -11.5 11.5"/>'),
};

// Se radar.js non arriva un sostituto inerte tiene in piedi la pagina: la voce Radar dice che non c'e'
if(typeof Radar === 'undefined') window.Radar = { on:false, state:'nd', index:-1, source:null,
  init(){}, enable: async () => false, disable(){}, poll(){}, gridPixel: () => null,
  setProduct: () => false, products: () => [], legend: () => ({ steps:[], colors:[] }), product:null };

// ------------------------------------------------------------------------------------------------
// MAPPA
// ------------------------------------------------------------------------------------------------
let markersLayer;                 // strato dei puntini (lo crea initMap, lo ridisegna renderMarkers)
function initMap(){
  // Renderer canvas con 'tolerance': allarga l'area di tap attorno al puntino senza ingrandirlo
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  map = L.map('map', {
    scrollWheelZoom:true, zoomAnimation:false, zoomSnap:0.5, wheelPxPerZoomLevel:120,
    renderer: L.canvas({ tolerance: isTouch ? 16 : 6 })
  }).setView([46.0, 12.0], 8);
  new ResizeObserver(() => map.invalidateSize()).observe(el('map'));
  const esri = (service, maxZoom, attribution = 'Tiles © Esri') => L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/' + service + '/MapServer/tile/{z}/{y}/{x}',
    { maxZoom, attribution });
  const BASEMAPS = {
    'Mappa': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 18, attribution: '© OpenStreetMap' }),
    'Satellite': esri('World_Imagery', 18),
    'Satellite + etichette': L.layerGroup([ esri('World_Imagery', 18),
      esri('Reference/World_Boundaries_and_Places', 18) ]),
    'Rilievi': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { maxZoom: 17, attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)' }),
    'Mappa scura': L.layerGroup([ esri('Canvas/World_Dark_Gray_Base', 16),
      esri('Canvas/World_Dark_Gray_Reference', 16, '') ])
  };
  let baseChoice = 'Mappa';
  try { const b = localStorage.getItem('basemap'); if (BASEMAPS[b]) baseChoice = b; } catch(e){}
  BASEMAPS[baseChoice].addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  labelsLayer = L.layerGroup().addTo(map);
  let zoomed = false;                       // dopo uno zoom le etichette le ha gia' rifatte renderMarkers
  map.on('zoomend', () => { if(allFeatures.length){ renderMarkers(); zoomed = true; } });
  map.on('moveend', () => { if(zoomed) zoomed = false; else renderLabels(); });
  // I crediti (obbligatori per licenza) stanno nella plancia, senza il prefisso "Leaflet"
  map.attributionControl.setPrefix(false);
  el('dkCredits').appendChild(map.attributionControl.getContainer());
  // A destra, dall'alto: zoom, sfondi (la scelta resta nel browser) e Radar col suo nome, da trovare subito
  map.zoomControl.setPosition('topright');
  L.control.layers(BASEMAPS, null, { position:'topright' }).addTo(map);
  map.on('baselayerchange', e => {
    try { localStorage.setItem('basemap', e.name); } catch(err){}
    dockLayout();                                        // i crediti dello sfondo cambiano l'altezza
  });
  const radarCtl = L.control({ position:'topright' });
  radarCtl.onAdd = () => {
    const d = L.DomUtil.create('div', 'mapctl');
    d.innerHTML = '<button id="mcRadar" aria-pressed="false">' + ICON.radar + '<span>Radar</span></button>';
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.disableScrollPropagation(d);
    return d;
  };
  radarCtl.addTo(map);
  placeCorners();
  if(PHONE.addEventListener) PHONE.addEventListener('change', placeCorners);
  new ResizeObserver(placeCorners).observe(el('topbar'));
  buildMapControls();
  let radarProd = 'SRI';
  try { radarProd = localStorage.getItem('radarProd') || 'SRI'; } catch(e){}
  Radar.init({ map, onState: syncMapControls, onTime: radarTime, onFrames: radarFrames, product: radarProd,
               onBuffer: () => { if(snap.on && tsSrc === Radar.source) tsBuffer(); } });
  ['pointerdown', 'pointermove'].forEach(t => map.getContainer().addEventListener(t,
    e => { lastPointer = e.pointerType || 'mouse'; }, true));
  map.on('move', positionCard);
  window.addEventListener('resize', sheetFit);
  el('sheetClose').addEventListener('click', closeSheet);
  el('sheetOpen').addEventListener('click', () => {
    const p = sheetP;
    closeSheet();
    if(p) selectStation(p);
  });
  el('sheet').addEventListener('pointerdown', e => {
    shY0 = e.target.closest('.sh-grab') ? e.clientY : null;
  });
  el('sheet').addEventListener('pointerup', e => {
    if(shY0 != null && e.clientY - shY0 > 40) closeSheet();
    shY0 = null;
  });
  map.on('click', () => { if(sheetP) closeSheet(); });
}

async function loadRegions(regions){
  _needFit = true;                 // nuova selezione: rifitta la mappa una volta
  snapPause();
  clearChart();
  resetPanel();
  setStatus('Carico le stazioni…');

  allFeatures = [];
  await Promise.all(regions.map(async region => {
    try {
      const units = await (await fdata(`${region}/units.json`)).json();
      unitsByRegion[region] = Object.fromEntries(Object.entries(units).map(([v, u]) => [v, normUnit(u)]));
    } catch(e){ unitsByRegion[region] = {}; }
    let geo;
    try { geo = await (await fdata(`${region}/stations.geojson`)).json(); }
    catch(e){ return; }
    aqDay[region] = geo.ieri || '';
    (geo.features || []).forEach(f => {
      f.properties._region = region;
      f.properties._lon = f.geometry.coordinates[0];
      f.properties._lat = f.geometry.coordinates[1];
      allFeatures.push(f);
    });
  }));
  selectedKey = '';
  refreshFilters();
  renderMarkers();
  snapSync();
}

let _needFit = true;              // fitBounds SOLO dopo un (ri)caricamento dati, mai sullo zoom
let markerRefs = [];
// Scheda al passaggio: stazione e puntino mostrati, attesa in corso, ultimo puntatore (mouse/touch/pen).
// cardSeq e sheetSeq contano i disegni: un andamento arrivato tardi per un disegno vecchio si scarta
let cardP = null, cardM = null, cardTimer = null, lastPointer = 'mouse', cardSeq = 0;
let sheetP = null, sheetRing = null, sheetSeq = 0;
function renderMarkers(){
  hideCard();
  markersLayer.clearLayers();
  markerRefs = [];
  const bounds = [];
  const all = stationsForList();
  const list = (Radar.on && !radarUi.stations) ? [] : all;                    // radar: "Stazioni" spento
  // Colori con UNA regione, o con tutte se la variabile si confronta (comparable). Colora col valore di
  // riferimento (mapValue); in ritardo = grigio.
  const singleRegion = el('region').value !== 'ALL';
  const cmVar = canColormap(filterVar) && (singleRegion || comparable(filterVar, list)) ? filterVar : null;
  const slide = !!(snap.on && cmVar && snap.var === cmVar);
  let vmin = null, vmax = null;
  const refU = cmVar ? refUnitFor(cmVar, list) : '', unit = slide ? snap.unit : refU;
  const valFor = p => !cmVar ? null : slide ? snapVal(p) : mapValue(p, cmVar, refU);
  const now = nowRome();
  const late = p => !!cmVar && !slide && isLate(p, cmVar, now);     // col Cursore valgono i fotogrammi
  if(cmVar && classScale(cmVar, unit)){ vmin = 0; vmax = 0; }    // classi fisse, niente min-max
  else if(cmVar && slide){ vmin = snap.vmin; vmax = snap.vmax; }
  else if(cmVar){
    list.forEach(f => {
      const nv = valFor(f.properties);
      if(nv != null && !late(f.properties)){
        vmin = (vmin==null)?nv:Math.min(vmin,nv);
        vmax = (vmax==null)?nv:Math.max(vmax,nv);
      }
    });
  }
  list.forEach(f => {
    const p = f.properties;
    const isSel = featKey(f) === selectedKey;
    let fill = DOT_COLOR, stroke = DOT_LINE;
    const nv = valFor(p), stale = cmVar && nv != null && late(p);
    if(cmVar){
      if(nv == null || stale) fill = NEUTRAL_COLOR;
      else if(radarDotColor(cmVar, nv)) fill = radarDotColor(cmVar, nv);    // stessa palette del radar
      else if(isEaqi(cmVar)) fill = eaqiColor(nv);
      else fill = classColor(cmVar, nv, unit) || (vmin == null ? NEUTRAL_COLOR
                  : rampAt(rampOf(cmVar), vmax > vmin ? (nv - vmin) / (vmax - vmin) : 0.5));
      stroke = '#33475a';
    }
    const z = map.getZoom();
    const rBase = z <= 7 ? 3 : (z <= 9 ? 4 : 6);
    const look = dotLook(!!cmVar && (nv == null || stale), isSel, cmVar ? 0.9 : 0.75, stroke);
    const m = L.circleMarker([p._lat, p._lon], Object.assign({
      radius: isSel ? rBase + 2 : rBase, fillColor: fill,
      bubblingMouseEvents: false              // il tocco apre la stazione, non il popup del radar
    }, look));
    if(!slide && cmVar && nv != null && map.getZoom() >= 11 && !showValues)
      m.bindTooltip(LEVEL_HOURS[cmVar] ? labelText(cmVar, nv) : String(nv),         // i livelli col segno
                    { permanent:true, direction:'right', className:'vlab', offset:[7,0] });
    m.on('mouseover', () => cardHover(p, m));
    m.on('mouseout', cardLeave);
    m.on('click', () => {
      if(lastPointer === 'mouse'){ hideCard(); selectStation(p); } else openSheet(p, m);
    });
    m.addTo(markersLayer);
    markerRefs.push({ m, p, nv: cmVar ? nv : null, fill, late: !!stale, look, sel: isSel });
    bounds.push([p._lat, p._lon]);
  });
  labelsVar = cmVar || '';
  renderLabels();
  if(bounds.length && _needFit && !selectedKey){
    _needFit = false;
    map.invalidateSize();
    map.fitBounds(bounds, { padding:[30,30] });
  }
  el('stationQ').placeholder = 'Cerca fra ' + all.length + ' stazioni…';
  if(sheetP){                      // foglio aperto: resta; si chiude se la stazione esce dall'elenco
    const r = markerRefs.find(x => x.p === sheetP);
    if(r){ sheetRing.setRadius(r.m.getRadius() + 5); drawSheet(); } else closeSheet();
  }
  updateColorbar(cmVar, vmin, vmax, unit);
  syncMapControls();
  setStatus('');
}

function repaintSnap(){
  if(!(snap.on && markerRefs.length)) return;
  const v = snap.var;
  markerRefs.forEach(r => {
    const nv = snapVal(r.p);
    let fill = NEUTRAL_COLOR;
    if(nv != null){
      const t = snap.vmax > snap.vmin ? (nv - snap.vmin) / (snap.vmax - snap.vmin) : 0.5;
      fill = radarDotColor(v, nv) || classColor(v, nv, snap.unit) || rampAt(rampOf(v), t);
    }
    r.look = dotLook(nv == null, r.sel, 0.9, '#33475a');
    r.m.setStyle(Object.assign({ fillColor: fill }, r.look));
    Object.assign(r, { nv, fill, late: false, under: false });
  });
  renderLabels();
}
// Bordo e riempimento di un puntino: vuoto (in ritardo o senza valore), selezionato o normale
function dotLook(empty, sel, fillOpacity, stroke){
  return { opacity: 1, fillOpacity: empty ? 0 : fillOpacity,
           color: sel ? '#c05621' : empty ? EMPTY_LINE : stroke, weight: sel ? 2 : empty ? 1.5 : 1 };
}

// ---- ETICHETTE (interruttore "Valori" nella plancia): il numero sul colore del valore al posto del puntino,
// solo dove non si toccano; le altre stazioni restano puntini e zoomando le etichette aumentano
let showValues = false, labelsLayer = null, labelsVar = '';
try { showValues = localStorage.getItem('mapValues') === '1'; } catch(e){}
const LABEL_H = 16, LABEL_GAP = 2, LABEL_PAD = 10;
const LABEL_DEC = { TEMP:1, PREC:1, VVENTO:1, VVENTOMAX:1, UMID:0, LIVNEVE:0, RADSOL:0, PM10:0, PM25:0, O3:0,
                    NO2:0, MAREA:0 };
// Dove le etichette non stanno tutte vincono le stazioni aggiornate, poi i valori alti (piu' pioggia, piu'
// vento: piu' conta), la variazione forte dei livelli o, per le altre, i valori lontani dalla mediana
const LABEL_HIGH = new Set(['PREC','VVENTO','VVENTOMAX','LIVNEVE','RADSOL','PM10','PM25','O3','NO2','EAQI',
                            'PORTATA','AFFLUSSO','DEFLUSSO','MAREA']);
const _labelCtx = document.createElement('canvas').getContext('2d');
function labelText(v, x){
  if(LEVEL_HOURS[v]){
    const n = Math.round(x);
    return n > 0 ? '+' + n : n < 0 ? '−' + -n : '0';
  }
  const d = isRain(v) ? 1 : LABEL_DEC[v];
  const txt = d == null ? fmtNum(x, v) : x.toFixed(d);
  return +txt === 0 ? txt.replace('-', '') : txt;
}
function renderLabels(){
  if(!labelsLayer) return;
  labelsLayer.clearLayers();
  markerRefs.forEach(r => {
    if(r.under){ r.m.setStyle(r.look); r.under = false; }
  });
  const v = labelsVar;
  if(!showValues || !v) return;
  const fresh = markerRefs.filter(r => r.nv != null && !r.late).map(r => r.nv).sort((a, b) => a - b);
  const med = fresh.length ? fresh[fresh.length >> 1] : 0;
  const weight = r => LEVEL_HOURS[v] ? Math.abs(r.nv)
                    : LABEL_HIGH.has(v) || isRain(v) ? r.nv : Math.abs(r.nv - med);
  const order = markerRefs.filter(r => r.nv != null)
                          .sort((a, b) => (a.late - b.late) || (weight(b) - weight(a)));
  const size = map.getSize(), boxes = [];
  _labelCtx.font = cssFont(11, 600);
  order.forEach(r => {
    const pt = map.latLngToContainerPoint(r.m.getLatLng());
    if(pt.x < -40 || pt.y < -40 || pt.x > size.x + 40 || pt.y > size.y + 40) return;
    const txt = labelText(v, r.nv), w = Math.ceil(_labelCtx.measureText(txt).width) + LABEL_PAD;
    const b = { x0:pt.x - w / 2, x1:pt.x + w / 2, y0:pt.y - LABEL_H / 2, y1:pt.y + LABEL_H / 2 };
    if(boxes.some(o => b.x0 < o.x1 + LABEL_GAP && o.x0 < b.x1 + LABEL_GAP &&
                       b.y0 < o.y1 + LABEL_GAP && o.y0 < b.y1 + LABEL_GAP)) return;
    boxes.push(b);
    const key = r.p._region + '|' + r.p.scode;
    const cls = 'vl' + (r.late ? ' late' : '') + (key === selectedKey || r.p === sheetP ? ' sel' : '');
    const paint = r.late ? '' : 'background:' + r.fill + ';color:' + inkOn(r.fill) + ';';
    const lm = L.marker(r.m.getLatLng(), { keyboard:false, icon:L.divIcon({
      className:'', iconSize:[w, LABEL_H], iconAnchor:[w / 2, LABEL_H / 2],
      html:'<div class="' + cls + '" data-k="' + escHtml(key) + '" style="' + paint + 'width:' + w + 'px">' +
           txt + '</div>' }) });
    lm.on('mouseover', () => cardHover(r.p, r.m));
    lm.on('mouseout', cardLeave);
    lm.on('click', () => {
      if(lastPointer === 'mouse'){ hideCard(); selectStation(r.p); } else openSheet(r.p, r.m);
    });
    lm.addTo(labelsLayer);
    r.m.setStyle({ opacity:0, fillOpacity:0 });
    r.under = true;
    r.lw = w;
  });
}
function syncValuesSwitch(){
  const b = el('mcValues');
  b.classList.toggle('on', showValues);
  b.setAttribute('aria-checked', String(showValues));
}

// LEGENDA nella plancia: nome del prodotto o della variabile (col radar e con la pioggia apre il menu), scala
// piena (valori sotto, sui bordi delle classi) e compatta (valori dentro i colori: plancia chiusa sul
// telefono), puntino grigio = dato non disponibile, interruttore Stazioni (solo col radar).
// Punto decimale, come nei grafici.
const inkOn = c => {
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(c), n = m ? 0 : parseInt(c.slice(1), 16);
  const [r, g, b] = m ? [+m[1], +m[2], +m[3]] : [n >> 16, n >> 8 & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#0c3557' : '#fff';
};
// Classi a soglie: colors[i] sta fra steps[i-1] e steps[i] (la prima e' "meno della prima soglia"). Con tante
// classi (temperatura) la scala piena scrive una soglia ogni k, o i multipli di every, e la compatta solo gli
// estremi; sign mette il "+" alle soglie positive (variazioni dei livelli)
function scaleSteps(colors, steps, every, sign){
  const k = Math.ceil(colors.length / 10);
  const txt = x => (sign && x > 0 ? '+' : '') + String(x).replace('-', '−');
  const shown = i => i < steps.length && (every ? steps[i] % every === 0 : i % k === 0);
  const full = colors.map((c, i) => '<span style="background:' + c + '">' +
                          (shown(i) ? '<i>' + txt(steps[i]) + '</i>' : '') + '</span>').join('');
  if(colors.length > 12){
    const w = 100 / colors.length;
    return '<div class="sc-full sc-steps">' + full + '</div>' +
      scaleRange('background:linear-gradient(to right,' +
        colors.map((c, i) => c + ' ' + (i * w).toFixed(2) + '% ' +
                             ((i + 1) * w).toFixed(2) + '%').join(',') + ')',
        txt(steps[0]), txt(steps[steps.length - 1]), true);
  }
  const mini = colors.map((c, i) => '<span style="background:' + c + ';color:' + inkOn(c) + '">' +
                          (i ? txt(steps[i - 1]) : '') + '</span>').join('');
  return '<div class="sc-full sc-steps">' + full + '</div><div class="sc-mini">' + mini + '</div>';
}
function scaleRange(bg, lo, hi, miniOnly){
  return (miniOnly ? '' : '<div class="sc-full sc-cont"><div class="sc-grad" style="' + bg + '"></div>' +
          '<div class="sc-ends"><span>' + lo + '</span><span>' + hi + '</span></div></div>') +
         '<div class="sc-mini sc-mc"><b>' + lo + '</b><i style="' + bg + '"></i><b>' + hi + '</b></div>';
}
function updateColorbar(varName, vmin, vmax, unitOverride){
  const cb = el('colorbar');
  let name = '', unit = '', scale = '', menu = false, nd = true;
  if(Radar.on){                                               // trasparente = grigio pioggia 0
    const lg = Radar.legend();
    name = lg.label;
    unit = lg.unit;
    menu = true;
    scale = scaleSteps(lg.colors.map(c => c || RAIN_COLORS[0]), lg.steps);
    nd = !!(radarUi.stations && radarDotsVar());
  } else if(varName && vmin != null){
    name = mapName(varName);
    unit = unitOverride || unitForVar(varName);
    const cs = classScale(varName, unit);
    if(isEaqi(varName)){
      name = 'Qualità aria (EAQI)';
      unit = '';
      scale = scaleRange('background:linear-gradient(to right,' + EAQI_BANDS.map((b, i) =>
                b.c + ' ' + (i * 100 / 6).toFixed(2) + '% ' +
                ((i + 1) * 100 / 6).toFixed(2) + '%').join(',') + ')',
                EAQI_BANDS[0].l, EAQI_BANDS[5].l);
    } else if(cs){
      if(isRainVar(varName)){
        unit = 'mm';
        menu = true;
      }
      else if(LEVEL_HOURS[varName] || varName === 'MAREA') unit = 'cm';
      else if(FLOW_VARS.has(varName)) unit = unit || 'm³/s';
      scale = scaleSteps(cs.colors, cs.steps, cs.every, cs.sign);
    } else
      scale = scaleRange('background:linear-gradient(to right,' + rampOf(varName).join(',') + ')',
                         fmtNum(vmin), fmtNum(vmax));
  } else if(varName){                                 // tutte in ritardo: nome e "in ritardo", senza scala
    name = mapName(varName);
    unit = unitOverride || unitForVar(varName);
  }
  cb.style.display = name ? '' : 'none';
  if(!name) return;
  el('dkName').textContent = name;
  el('dkUnit').textContent = unit;
  el('dkProd').classList.toggle('no-menu', !menu);
  el('dkScale').innerHTML = scale;
  el('dkNd').style.display = nd ? '' : 'none';
  el('dkSta').style.display = Radar.on ? '' : 'none';
  el('dkVal').style.display = (Radar.on ? radarUi.stations && radarDotsVar() : varName) ? '' : 'none';
}

// ------------------------------------------------------------------------------------------------
// CURSORE DEL TEMPO (mappa): scorre le ultime 168 ore a passo orario. L'export scrive i fotogrammi in
// <REGIONE>/snap/<VAR>.json = {t:[epoch civile], u:unita', s:{stazione:[valore|null, ...]}}; si caricano
// alla prima apertura di ciascuna variabile (le piogge 1-48 h sono accumuli mobili che finiscono in t).
// ------------------------------------------------------------------------------------------------
const WD_IT = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
function fmtFrame(sec){
  const d = new Date(sec * 1000), z = n => (n < 10 ? '0' : '') + n;
  return WD_IT[d.getUTCDay()] + ' ' + z(d.getUTCDate()) + '/' + z(d.getUTCMonth() + 1) + ' ' +
         z(d.getUTCHours()) + ':' + z(d.getUTCMinutes());
}
// Valore al fotogramma corrente, gia' nell'unita' di riferimento (null = nessun dato entro la tolleranza)
function snapVal(p){
  const d = snap.data[p._region];
  if(!d) return null;
  const arr = d.s[p.scode];
  if(!arr) return null;
  const i = snap.k - (snap.shift[p._region] || 0);
  if(i < 0 || i >= arr.length) return null;
  const x = arr[i];
  if(x == null) return null;
  const m = snap.mul[p._region];
  return m === 1 ? x : Math.round(x * m * 10) / 10;
}
// Il Cursore vale per variabili con fotogrammi E confrontabili sulla mappa: con tutte le regioni non la
// pressione della stazione
const snapCapable = v => !!v && SNAP_VARS.has(v) && canColormap(v) &&
                         (!ALTITUDE_BOUND.has(v) || el('region').value !== 'ALL');

// Carica i fotogrammi di v per le regioni sulla mappa: true = caricati, false = nessun dato, null = superata
async function snapLoad(v){
  const token = ++snap.token;
  const regs = [...new Set(allFeatures.filter(f => (f.properties.variables || []).includes(v))
                                      .map(f => f.properties._region))];
  const got = await Promise.all(regs.map(async r => {
    try {
      const x = await fdata(r + '/snap/' + (SNAP_FILE[v] || v) + '.json');
      if(!x.ok) return null;
      const d = await x.json();
      const agg = MAP_RUNNING[v];
      if(agg && d.t && d.s) for(const sc in d.s) d.s[sc] = dayRunning(d.t, d.s[sc], agg);
      return [r, d];
    } catch(e){ return null; }
  }));
  if(token !== snap.token || !snap.on) return null;
  const data = {};
  let end = 0;
  got.forEach(g => {
    if(g && g[1] && g[1].t && g[1].t.length && g[1].s){
      data[g[0]] = g[1];
      end = Math.max(end, g[1].t[g[1].t.length - 1]);
    }
  });
  const rs = Object.keys(data);
  if(!rs.length) return false;
  // Unita' diverse fra regioni (vento FVG in km/h): tutto all'unita' piu' diffusa, per numero di stazioni
  const ucnt = {}, mul = {};
  rs.forEach(r => {
    const u = data[r].u || '', n = Object.keys(data[r].s).length;
    ucnt[u] = (ucnt[u] || 0) + n;
  });
  let unit = '', un = 0;
  for(const u in ucnt) if(ucnt[u] > un){ un = ucnt[u]; unit = u; }
  rs.forEach(r => { mul[r] = unitFactor(data[r].u || '', unit); });
  // Asse comune = quello che finisce piu' tardi; una regione esportata un'ora prima resta allineata (scarto)
  let T = null;
  rs.forEach(r => {
    const t = data[r].t;
    if(t[t.length - 1] === end && (!T || t.length > T.length)) T = t;
  });
  const shift = {};
  rs.forEach(r => {
    const t = data[r].t;
    shift[r] = Math.round((end - t[t.length - 1]) / 3600);
  });
  // Copertura di un fotogramma = stazioni sulla mappa con un valore. Serve a (1) fermare il Cursore
  // all'ultimo fotogramma "completo" (una regione in ritardo non lo fa sembrare vuoto), (2) saltare i buchi
  // in riproduzione, (3) fissare la scala dei colori su tutta la finestra.
  const list = stationsForList(), n = T.length, cov = new Array(n).fill(0), vals = [];
  list.forEach(f => {
    const p = f.properties, d = data[p._region];
    if(!d) return;
    const arr = d.s[p.scode];
    if(!arr) return;
    const sh = shift[p._region] || 0, m = mul[p._region];
    for(let k = 0; k < n; k++){
      const i = k - sh;
      if(i >= 0 && i < arr.length && arr[i] != null){
        cov[k]++;
        vals.push(arr[i] * m);
      }
    }
  });
  const mx = Math.max.apply(null, cov);
  if(!(mx > 0)) return false;
  let kmax = n - 1, k0 = 0;
  while(kmax > 0 && cov[kmax] < 0.75 * mx) kmax--;
  while(k0 < kmax && cov[k0] < 0.5 * mx) k0++;
  if(!classScale(v, unit)){                                    // scala fissa: 2°-98° percentile
    vals.sort((a, b) => a - b);
    const q = f => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(f * (vals.length - 1))))];
    snap.vmin = q(0.02);
    snap.vmax = q(0.98);
    if(!(snap.vmax > snap.vmin)) snap.vmax = snap.vmin + 1;
  }
  snap.var = v;
  snap.unit = unit;
  snap.data = data;
  snap.T = T;
  snap.shift = shift;
  snap.mul = mul;
  snap.cov = cov;
  snap.covMax = mx;
  snap.k0 = k0;
  snap.kmax = kmax;
  return true;
}

// Sul telefono la barra in alto prende tutta la larghezza: sfondi e Radar scendono sotto di lei
function placeCorners(){
  const tb = el('topbar'), top = PHONE.matches ? tb.offsetTop + tb.offsetHeight + 'px' : '';
  map.getContainer().querySelectorAll('.leaflet-top').forEach(c => { c.style.top = top; });
}
// PLANCIA: altezza in --dockh (il menu del prodotto si apre sopra); su desktop il menu segue il suo pulsante
function dockLayout(){
  const d = el('dock'), m = el('prodMenu');
  document.documentElement.style.setProperty('--dockh', d.offsetHeight + 'px');
  if(m.classList.contains('open') && !PHONE.matches){
    const b = el('dkProd').getBoundingClientRect(), v = el('views').getBoundingClientRect();
    m.style.left = Math.max(12, Math.min(b.left - v.left, v.width - m.offsetWidth - 12)) + 'px';
  } else m.style.left = '';
}
// Righe presenti: tempo (Cursore aperto) e legenda (variabile o radar); senza nessuna restano i soli crediti
function dockSync(){
  const d = el('dock');
  const time = el('tsbar').style.display !== 'none', leg = el('colorbar').style.display !== 'none';
  d.classList.toggle('no-time', !time);
  d.classList.toggle('only-credits', !time && !leg);
  dockLayout();
}
// Telefono: la plancia si chiude (restano play, ora, cursore, nome e scala compatta, crediti); parte chiusa e
// la scelta resta nel browser. Su desktop e' sempre aperta.
let dockMinPref = true;
try { const s = localStorage.getItem('dockMin'); if(s !== null) dockMinPref = s === '1'; } catch(e){}
function dockMin(on){
  if(on !== undefined){
    dockMinPref = on;
    try { localStorage.setItem('dockMin', on ? '1' : '0'); } catch(e){}
  }
  const d = el('dock'), t = el('dkToggle'), min = PHONE.matches && dockMinPref;
  d.classList.toggle('min', min);
  t.innerHTML = min ? ICON.up : ICON.down;
  t.setAttribute('aria-expanded', String(!min));
  t.setAttribute('aria-label', min ? 'Apri la plancia' : 'Chiudi la plancia');
  dockLayout();
}
const fmtHM = sec => fmtFrame(sec).slice(-5);                              // "14:00"
const fmtDay = sec => fmtFrame(sec).slice(0, -6).toLowerCase();             // "ven 23/10"
// Striscia del gia' scaricato sul cursore (radar): dall'inizio al primo fotogramma mancante; a scaricamento
// finito sparisce (coincide col tratto pieno)
function tsBuffer(){
  const r = el('tsRange'), f = tsSrc.buffered ? tsSrc.buffered() : 1;
  r.style.setProperty('--b', f < 1 ? f.toFixed(4) : r.style.getPropertyValue('--p') || '1');
}
// Tacche sotto il cursore: ore piene (radar, 6 h) o mezzanotti (stazioni, 7 giorni), alla posizione del loro
// fotogramma; si ridisegnano solo se cambia la scala
let tsTickSig = '';
function tsTicks(){
  const s = tsSrc;
  const a = s.min(), b = s.max(), sig = [s === snapSource, a, b, s.civ(a), s.civ(b)].join();
  if(sig === tsTickSig) return;
  tsTickSig = sig;
  const hours = s !== snapSource, z = n => (n < 10 ? '0' : '') + n;
  let h = '';
  for(let k = a; b > a && k <= b; k++){
    const t = s.civ(k);
    if(t == null || t % (hours ? 3600 : 86400)) continue;
    const d = new Date(t * 1000);
    h += '<b style="left:calc(7px + (100% - 14px) * ' + ((k - a) / (b - a)).toFixed(4) + ')">' +
         (hours ? z(d.getUTCHours()) + '<i>:00</i>'
                : WD_IT[d.getUTCDay()].toLowerCase() + '<i> ' + d.getUTCDate() + '</i>') + '</b>';
  }
  el('tsTicks').innerHTML = h;
}
// La barra scorre una "sorgente di tempo": le stazioni (fotogrammi orari, qui sotto) oppure il radar
// (Radar.source in radar.js). Ogni sorgente da': min()/max() degli indici, label(k)/title(k) per
// l'etichetta, apply(k) per ridisegnare la mappa, next(k) per la riproduzione (-1 = fine), periodMs, loop.
const snapSource = {
  periodMs: 700, loop: false,
  min: () => snap.k0,
  max: () => snap.T.length ? snap.kmax : -1,                             // -1 = nessun fotogramma caricato
  label(k){
    const pc = Math.round(100 * snap.cov[k] / snap.covMax);
    return '<span>' + fmtHM(snap.T[k]) + '</span><small>' + fmtDay(snap.T[k]) +
           (pc < 95 ? ' · ' + pc + '% stazioni' : '') + '</small>';
  },
  title: k => 'Stazioni con dato: ' + snap.cov[k] + ' su ' + snap.covMax,
  civ: k => snap.T[k],
  apply(k){ snap.k = k; repaintSnap(); },
  next(k){
    while(++k <= snap.kmax && snap.cov[k] < 0.5 * snap.covMax);
    return k > snap.kmax ? -1 : k;
  },
};
let tsSrc = snapSource, tsK = 0;
function setFrame(k){
  const s = tsSrc;
  k = Math.max(s.min(), Math.min(s.max(), k | 0));
  tsK = k;
  const r = el('tsRange');
  r.min = s.min();
  r.max = s.max();
  r.value = k;
  // --p = tratto pieno fino al cursore
  r.style.setProperty('--p', s.max() > s.min() ? ((k - s.min()) / (s.max() - s.min())).toFixed(4) : 1);
  s.apply(k);
  if(cardP) renderCard();
  if(sheetP) drawSheet();
  el('tsLab').innerHTML = s.label(k);
  el('tsLab').title = s.title(k);
  tsTicks();
  tsBuffer();
}
function snapPause(){
  snap.playing = false;
  clearInterval(snap.timer);
  snap.timer = null;
  const b = el('tsPlay');
  b.innerHTML = ICON.play;
  b.setAttribute('aria-label', 'Riproduci');
}
function snapStep(){
  const k = tsSrc.next(tsK);
  if(k < 0){ snapPause(); return; }
  if(tsSrc.ready && !tsSrc.ready(k)) return;                              // radar: fotogramma non scaricato
  setFrame(k);
}
function snapPlay(){
  if(!snap.on || tsSrc.max() < tsSrc.min()) return;
  if(!tsSrc.loop && tsK >= tsSrc.max()) setFrame(tsSrc.min());
  snap.playing = true;
  const b = el('tsPlay');
  b.innerHTML = ICON.pause;
  b.setAttribute('aria-label', 'Pausa');
  clearInterval(snap.timer);
  snap.timer = setInterval(snapStep, tsSrc.periodMs / snap.speed);
}

async function snapOpenFor(v){
  snapPause();
  setStatus('Carico il cursore…');
  const ok = await snapLoad(v);
  if(ok === null || !snap.on) return;
  if(!ok && tsSrc === snapSource){                                        // col radar la barra va anche senza
    if(snap.var !== v){ closeSlider(); toast('Cursore non disponibile per ' + varLabel(v)); }
    return;
  }
  setFrame(tsSrc === Radar.source ? Radar.index : tsSrc.max());
  renderMarkers();
}
// Dopo un cambio di variabile, pagina o regione: ricarica se la variabile e' ancora valida, altrimenti chiude
function snapSync(){
  if(!snap.on) return;
  if(snapCapable(filterVar)) snapOpenFor(filterVar);
  else if(tsSrc === Radar.source) setFrame(Radar.index);
  else closeSlider();
}
function showBar(){
  snap.on = true;
  el('tsbar').style.display = 'flex';
  document.body.classList.add('ts-on');
  syncMapControls();
}
async function openSlider(){
  if(snap.on){ closeSlider(); return; }
  if(Radar.on){
    radarUi.openedBar = true;
    showBar();
    await snapOpenFor('PREC1');
    return;
  }
  let v = filterVar;
  if(!v || !SNAP_VARS.has(v)){
    if(v) toast('Cursore: ' + varLabel(lastRainVar()));
    v = lastRainVar();
    setMapVar(v);
  }
  else if(!snapCapable(v)){ toast('Scegli prima una regione'); return; }
  if(!snapCapable(filterVar)) return;
  showBar();
  await snapOpenFor(filterVar);
}
function closeSlider(){
  snapPause();
  snap.on = false;
  snap.token++;
  snap.var = '';
  snap.data = {};
  snap.T = [];
  el('tsbar').style.display = 'none';
  document.body.classList.remove('ts-on');
  if(tsSrc === Radar.source) Radar.source.apply(Radar.source.max());     // radar acceso: torna "dal vivo"
  renderMarkers();
}

function lastRainVar(){
  let v = 'PREC24';
  try { const s = localStorage.getItem('rainVar'); if(isRainVar(s)) v = s; } catch(e){}
  return v;
}
let mapPrevPage = 'dirette';
function setMapVar(v){
  if(v){
    if(currentPage !== varCat(v)){
      if(currentPage !== 'indici') mapPrevPage = currentPage;
      document.querySelector('#pages .pg[data-page="' + varCat(v) + '"]').click();
    }
    if(isRainVar(v)){ try { localStorage.setItem('rainVar', v); } catch(e){} }
  } else if(currentPage === 'indici' && mapPrevPage !== 'indici'){
    document.querySelector('#pages .pg[data-page="' + mapPrevPage + '"]').click();
  }
  const sel = el('varFilter');
  if(!v || [...sel.options].some(o => o.value === v)){
    sel.value = v;
    sel.dispatchEvent(new Event('change'));
  } else toast('Nessuna stazione con ' + varLabel(v));
}
// MENU DEL PRODOTTO (sopra la plancia): col radar i suoi prodotti a gruppi (finestre di pioggia e quote come
// segmenti), con la pioggia delle stazioni le finestre 1-48 h; per le altre variabili nessun menu
const PM_ORDER = ['Pioggia', 'Riflettività', 'Temporali', 'Altro'];
const pmGroup = p => p.key === 'VMI' || /^CAPPI\d+$/.test(p.key) ? 'Riflettività'
                   : ['VIL', 'ETM', 'POH'].includes(p.key) ? 'Temporali' : p.group || 'Altro';
const pmLabel = (g, p) => g === 'Pioggia' ? String(p.label).toLowerCase()
                        : g === 'Riflettività' ? (p.key === 'VMI' ? 'max' : p.key.slice(5))
                        : p.key === 'ETM' ? 'Altezza' : p.label;
function prodMenuHtml(){
  if(Radar.on){
    const by = {}, cur = Radar.product && Radar.product.key;
    Radar.products().forEach(p => {
      const g = pmGroup(p);
      (by[g] = by[g] || []).push(p);
    });
    const rank = g => PM_ORDER.indexOf(g) < 0 ? 99 : PM_ORDER.indexOf(g);
    return Object.keys(by).sort((a, b) => rank(a) - rank(b)).map(g =>
      '<div class="pm-g" data-g="' + g + '"><div class="pm-t">' +
      (g === 'Riflettività' ? 'Riflettività · quota in km' : g) + '</div>' +
      '<div class="' + (g === 'Pioggia' || g === 'Riflettività' ? 'pm-seg' : 'pm-chips') + '">' +
      by[g].map(p => '<button data-key="' + p.key + '"' + (p.key === cur ? ' class="on"' : '') +
                     ' title="' + p.name + ' (' + p.unit + ')">' +
                     pmLabel(g, p) + '</button>').join('') + '</div></div>').join('');
  }
  if(isRainVar(filterVar))
    return '<div class="pm-g" data-g="Pioggia"><div class="pm-t">Pioggia caduta</div><div class="pm-seg">' +
           ['PREC'].concat(RAIN_VARS).map(v =>
             '<button data-v="' + v + '"' + (v === filterVar ? ' class="on"' : '') + '>' +
             (v === 'PREC' ? 'oggi' : v.slice(4) + ' h') + '</button>').join('') +
           '</div></div>';
  return '';
}
const prodMenuOpen = () => el('prodMenu').classList.contains('open');
function openProdMenu(){
  const m = el('prodMenu'), html = prodMenuHtml();
  if(!html){ closeProdMenu(); return; }
  m.innerHTML = html;
  m.classList.add('open');
  el('dkProd').setAttribute('aria-expanded', 'true');
  dockLayout();
}
function closeProdMenu(){
  el('prodMenu').classList.remove('open');
  el('dkProd').setAttribute('aria-expanded', 'false');
}
function buildMapControls(){
  el('dkTime').addEventListener('click', openSlider);
  el('mcRadar').addEventListener('click', () => Radar.on ? radarOff(true) : radarOn());
  el('mcValues').addEventListener('click', () => {
    showValues = !showValues;
    try { localStorage.setItem('mapValues', showValues ? '1' : '0'); } catch(e){}
    syncValuesSwitch();
    renderMarkers();
  });
  syncValuesSwitch();
  el('mcStations').addEventListener('click', () => {
    radarUi.stations = !radarUi.stations;
    renderMarkers();
    if(snap.on) setFrame(tsK);
  });
  el('dkProd').addEventListener('click', () => prodMenuOpen() ? closeProdMenu() : openProdMenu());
  el('prodMenu').addEventListener('click', e => {
    const b = e.target.closest('button');
    if(!b) return;
    closeProdMenu();
    if(b.dataset.key) radarSetProduct(b.dataset.key);
    else if(b.dataset.v) setMapVar(b.dataset.v);
  });
  document.addEventListener('pointerdown', e => {
    if(prodMenuOpen() && !e.target.closest('#prodMenu, #dkProd')) closeProdMenu();
  });
  document.addEventListener('keydown', e => { if(e.key === 'Escape') closeProdMenu(); });
  // Plancia del telefono: freccia, oppure trascinamento in su/giu' (tocco sulla linguetta = apri/chiudi)
  const dock = el('dock');
  el('dkToggle').addEventListener('click', () => dockMin(!dock.classList.contains('min')));
  let y0 = null;
  dock.addEventListener('pointerdown', e => {
    y0 = PHONE.matches && !e.target.closest('button, input, a') ? e.clientY : null;
  });
  dock.addEventListener('pointerup', e => {
    if(y0 == null) return;
    const dy = e.clientY - y0;
    y0 = null;
    if(dy < -18) dockMin(false); else if(dy > 18) dockMin(true);
    else if(e.target.closest('.dk-grab')) dockMin(!dock.classList.contains('min'));
  });
  if(PHONE.addEventListener) PHONE.addEventListener('change', () => dockMin());
  dockMin();
  el('tsPlay').addEventListener('click', () => snap.playing ? snapPause() : snapPlay());
  el('tsPrev').addEventListener('click', () => { snapPause(); setFrame(tsK - 1); });
  el('tsNext').addEventListener('click', () => { snapPause(); setFrame(tsK + 1); });
  el('tsRange').addEventListener('input', e => { snapPause(); setFrame(+e.target.value); });
  el('tsSpeed').addEventListener('click', () => {
    const sp = [1, 2, 4, 8], i = sp.indexOf(snap.speed);
    snap.speed = sp[(i + 1) % sp.length];
    el('tsSpeed').textContent = snap.speed + '×';
    if(snap.playing) snapPlay();
  });
  el('tsClose').addEventListener('click', closeSlider);
  new ResizeObserver(dockLayout).observe(dock);
  window.addEventListener('resize', dockLayout);
  syncMapControls();
}
function syncMapControls(){
  el('dkTime').setAttribute('aria-pressed', String(snap.on));
  const rb = el('mcRadar'), st = Radar.state;                    // grigio se non si vede o non c'e'
  rb.setAttribute('aria-pressed', String(Radar.on));
  rb.classList.toggle('dim', st === 'nd' || (Radar.on && st === 'zoom'));
  rb.title = RADAR_STATE[st] || 'Radar della Protezione Civile: ultime 6 ore';
  const sw = el('mcStations');
  sw.classList.toggle('on', radarUi.stations);
  sw.setAttribute('aria-checked', String(radarUi.stations));
  if(prodMenuOpen()) openProdMenu();
  dockSync();
  syncPills();
}

// ---- RADAR DPC (radar.js) -----------------------------------------------------------------------
// Acceso: nella plancia il pulsante del prodotto (menu dei prodotti del DPC) e l'interruttore "Stazioni"; la
// barra del tempo scorre il prodotto scelto (ultime 6 ore). I puntini seguono il prodotto quando le stazioni
// misurano la stessa cosa (pioggia 1-48 h, temperatura: stessa palette), altrimenti sono neutri; "Stazioni"
// spento li nasconde. Un'altra variabile o pagina spegne il radar; spento dal pulsante torna la variabile di
// prima, e la barra torna alle stazioni se era aperta per loro.
const radarUi = { prevVar:'', openedBar:false, switching:false, busy:false, stations:true };
const radarDotsVar = () => (Radar.on && Radar.product && Radar.product.dots) || '';
const radarDotsOn = () => radarUi.stations && !!radarDotsVar() && snap.var === radarDotsVar();
// Ultimo fotogramma orario delle stazioni non successivo all'istante del radar (stessa ora civile "ingenua"),
// anche oltre l'ultima ora completa: ogni stazione mostra il suo valore appena arriva, grigia finche' manca
// (le fonti arrivano con ritardi diversi)
function snapIndexAt(civ){
  let i = -1;
  for(let j = snap.k0; j < snap.T.length && snap.T[j] <= civ; j++) i = j;
  return i;
}
// A ogni fotogramma del radar: puntini all'ora delle stazioni corrispondente, scritta accanto a "Stazioni"
function radarTime(utc, civ){
  const i = snap.on && snap.T.length && radarDotsOn() ? snapIndexAt(civ) : -1;
  if(i >= 0 && i !== snap.k){ snap.k = i; repaintSnap(); }
  el('mcStaTime').textContent = i >= 0 ? fmtHM(snap.T[i]) : '';
}
function radarFrames(){
  if(prodMenuOpen()) openProdMenu();
  if(snap.on && tsSrc === Radar.source) setFrame(Radar.index);
}
// Puntini accoppiati non di pioggia (temperatura): colore della classe del prodotto (una sola legenda)
function radarDotColor(v, nv){
  if(!Radar.on || v !== radarDotsVar() || isRain(v)) return null;
  const lg = Radar.legend();
  let c = 0;
  while(c < lg.steps.length && nv >= lg.steps[c]) c++;
  return lg.colors[c] || NEUTRAL_COLOR;
}
// I puntini passano alla variabile del prodotto (o a nessuna); la barra, se aperta, resta all'istante scelto
function radarCouple(){
  const v = radarDotsVar(), before = filterVar;
  radarUi.switching = true;
  try { if(filterVar !== v) setMapVar(v); } finally { radarUi.switching = false; }
  if(snap.on && filterVar === before) setFrame(Radar.index);
  renderMarkers();
}
function radarSetProduct(key){
  if(!Radar.setProduct(key)) return;
  try { localStorage.setItem('radarProd', key); } catch(e){}
  radarCouple();
}
async function radarOn(){
  if(radarUi.busy) return;
  radarUi.busy = true;
  try {
    if(!(await Radar.enable())){ toast('Radar non disponibile'); syncMapControls(); return; }
    radarUi.prevVar = filterVar;
    radarUi.openedBar = !snap.on;
    tsSrc = Radar.source;
    const v = radarDotsVar();
    radarUi.switching = true;                              // il cambio di pagina/variabile e' nostro
    try { if(filterVar !== v) setMapVar(v); } finally { radarUi.switching = false; }
    if(!snap.on){
      showBar();
      if(v) await snapOpenFor(v);
      else { setFrame(Radar.index); dockLayout(); }
    }
    else if(snap.var === v) setFrame(Radar.index);
    renderMarkers();
  } finally { radarUi.busy = false; }
}
// restore = spento dal pulsante (torna la variabile di prima); false = spento da un'altra scelta dell'utente
function radarOff(restore){
  if(!Radar.on) return;
  const radarBar = snap.on && tsSrc === Radar.source;
  Radar.disable();
  tsSrc = snapSource;
  if(radarBar && radarUi.openedBar) closeSlider();
  if(restore){
    if(radarUi.prevVar !== filterVar) setMapVar(radarUi.prevVar);
    else { if(snap.on) snapOpenFor(filterVar); renderMarkers(); }
  }
  syncMapControls();
}

function ageText(latestTime, nowMs){
  const c = civSec(latestTime);
  if(c == null) return '';
  const min = Math.floor((nowMs / 1000 - civToUtc(c)) / 60);
  return min < 1 ? 'adesso' : min < 60 ? min + ' min fa'
       : min < 2880 ? Math.floor(min / 60) + ' h fa' : Math.floor(min / 1440) + ' g fa';
}
// "12:00, 10 min fa" (oggi) o "30/10 12:10, 3 g fa"
function timeText(latestTime, nowMs){
  const c = civSec(latestTime);
  if(c == null) return '';
  const d = new Date(c * 1000), n = new Date(civT(nowMs / 1000) * 1000);
  const today = d.toISOString().slice(0, 10) === n.toISOString().slice(0, 10);
  return (today ? '' : pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + ' ') +
         pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ', ' + ageText(latestTime, nowMs);
}
// I tre valori chiave dall'ultimo dato, in quest'ordine (meteo: pioggia, vento, umidita'; idrometro:
// portata...; aria: PM10, NO2, O3)
const KEY_LABELS = { PREC24:'Pioggia 24 h', VVENTO:'Vento', UMID:'Umidità', TEMP:'Temperatura',
                     LIVIDRO:'Livello', PORTATA:'Portata', TEMPACQUA:'Acqua', MAREA:'Marea', ONDE:'Onde',
                     PM10:'PM10', NO2:'NO₂', O3:'O₃', PRESS:'Pressione', LIVNEVE:'Neve' };
const KEY_VARS = Object.keys(KEY_LABELS);
function keyValues(p, main){
  const lt = p.latest || {};
  return KEY_VARS.filter(v => v !== main && hasVal(lt, v)).slice(0, 3).map(v => {
    let text = latestText(p, v), html = null;
    if(v === 'VVENTO' && hasVal(lt, 'DVENTO') && !isNaN(+lt.DVENTO)){
      html = escHtml(text) + ' ' + windDirHtml(+lt.DVENTO);
      text += ' ' + _dirName(+lt.DVENTO);
    }
    return { v, label: KEY_LABELS[v], text, html };
  });
}
// I puntini mostrano un fotogramma (Cursore, o radar con le stazioni sulla stessa variabile: come "slide" in
// renderMarkers)
const cardFrame = () => !!(snap.on && snap.T.length && snap.var === filterVar && snapCapable(filterVar));
function cardModel(p){
  let main = stationMainValue(p), time = timeText(varTimeIso(p, main && main.v), Date.now()), keys = null;
  let delta = null;
  const hours = main && LEVEL_HOURS[main.v];
  const dz = hours && !cardFrame() ? Math.round(mapValue(p, main.v, 'cm')) : 0;
  if(dz) delta = { text:(dz > 0 ? '↑ ' : '↓ ') + Math.abs(dz) + ' cm in ' + hours + ' ore',
                   cls:dz > 0 ? 'up' : 'dn' };
  if(cardFrame()){                                       // valore al fotogramma; niente valori chiave
    const x = snapVal(p);
    main = { v: snap.var, label: varLabel(snap.var),
             text: x == null ? 'n.d.' : x + (snap.unit ? ' ' + snap.unit : '') };
    time = fmtFrame(snap.T[snap.k]);
    keys = [];
  }
  const src = SOURCES[p._region];
  return { name: prettyName(p.name || p.scode),
           where: regionLabel(p._region) + (src ? ' · ' + src.name : ''),
           time, main, delta, keys: keys || keyValues(p, main && main.v) };
}
// Andamento delle ultime 24 h dai file orari del Cursore (<REG>/snap/<VAR>.json): scaricati alla prima
// scheda, poi restano in memoria
const _cardSnap = {};
function snapFile(reg, v){
  const k = reg + '/' + v;
  if(!(k in _cardSnap))
    _cardSnap[k] = fdata(reg + '/snap/' + v + '.json').then(r => r.ok ? r.json() : null).catch(() => null);
  return _cardSnap[k];
}
// 25 ore della stazione: le ultime, nell'unita' del file; col fotogramma (frame) quelle che finiscono all'ora
// del puntino, nell'unita' dei puntini
async function cardSeries(p, v, frame){
  if(!SNAP_VARS.has(v)) return null;
  const r = p._region, mem = snap.on && snap.var === v && !MAP_RUNNING[v] && snap.data[r],
        m = mem ? snap.mul[r] : 1, u0 = snap.unit;
  const t = frame && snap.data[r] ? snap.data[r].t[snap.k - (snap.shift[r] || 0)] : null;
  const d = mem || await snapFile(r, v), arr = d && d.s && d.s[p.scode];
  if(!arr) return null;
  if(!frame) return { vals: arr.slice(-25), u: d.u || '' };
  const j = t == null || !d.t ? -1 : d.t.indexOf(t);
  return j < 0 ? null : {
    vals: arr.slice(Math.max(0, j - 24), j + 1)
             .map(x => x == null || m === 1 ? x : Math.round(x * m * 10) / 10),
    u: mem ? u0 : (d.u || '')
  };
}
const n2 = x => String(Math.round(x * 100) / 100);
// SVG 236x34: linea spezzata dove mancano dati, o barre (pioggia oraria, lo zero e' un trattino);
// '' con meno di due valori
function sparkSvg(vals, bars){
  const xs = vals.filter(x => x != null);
  if(xs.length < 2) return '';
  const W = 236, H = 34, n = vals.length, lo = bars ? 0 : Math.min(...xs), sp = (Math.max(...xs) - lo) || 1;
  const Y = x => H - 2 - (x - lo) / sp * (H - 4), f = x => x.toFixed(1);
  let s = '';
  if(bars) vals.forEach((x, i) => {
    if(x != null) s += '<rect x="' + f((i + 0.15) * W / n) + '" y="' + f(Math.min(Y(x), H - 3)) +
                       '" width="' + f(0.7 * W / n) + '" height="' + f(Math.max(H - 2 - Y(x), 1)) + '"/>';
  });
  else {
    let run = [];
    const flush = () => {
      if(run.length > 1) s += '<path class="ar" d="M' + run[0].split(',')[0] + ',' + H + 'L' + run.join('L') +
                              'L' + run[run.length - 1].split(',')[0] + ',' + H + 'Z"/>' +
                              '<polyline points="' + run.join(' ') + '"/>';
      run = [];
    };
    vals.forEach((x, i) => { if(x == null) flush(); else run.push(f(i * W / (n - 1)) + ',' + f(Y(x))); });
    flush();
  }
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
         s + '</svg>';
}
// Andamento, min/max e variazione nella scheda (o nel foglio) quando arriva il file orario, se mostra ancora
// la stessa stazione
async function fillTrend(box, p, mainV, still){
  if(!mainV) return false;
  const rain = isRainVar(mainV), frame = cardFrame(), S = await cardSeries(p, rain ? 'PREC1' : mainV, frame);
  if(!S || !still()) return false;
  const vals = S.vals.slice(-24), xs = vals.filter(x => x != null), q = s => box.querySelector(s);
  q('.hc-spark').innerHTML = sparkSvg(vals, rain);
  q('.hc-spark').classList.toggle('warm', mainV === 'TEMP');
  if(xs.length < 2) return true;
  q('.hc-span').textContent = '24 h';
  if(rain){
    q('.hc-mm').textContent = 'max ' + n2(Math.max(...xs)) + (S.u ? ' ' + S.u : '') + ' in 1 h';
    return true;
  }
  q('.hc-mm').textContent = 'min ' + n2(Math.min(...xs)) + ' · max ' + n2(Math.max(...xs));
  let i = S.vals.length - 1;                             // ultima coppia di ore consecutive con dato
  while(i > 0 && (S.vals[i] == null || S.vals[i - 1] == null)) i--;
  const d = i > 0 ? Math.round((S.vals[i] - S.vals[i - 1]) * 10) / 10 : 0;
  if(!frame && d){
    q('.hc-delta').textContent = (d > 0 ? '↑ ' : '↓ ') + Math.abs(d).toFixed(1) + ' in 1 h';
    q('.hc-delta').classList.add(d > 0 ? 'up' : 'dn');
  }
  return true;
}
// Disegno della scheda (anche nel foglio basso): nome; regione · fonte · ora; valore con la variazione;
// andamento con "24 h" e min/max sotto; valori chiave. Il nome della variabile solo se il valore non ha
// unita' (indice, n.d.)
function cardHtml(M){
  const e = escHtml, bare = M.main && !/\s/.test(M.main.text);
  return '<div class="hc-name">' + e(M.name) + '</div>' +
         '<div class="hc-where">' + e(M.where) +
           (M.time ? ' · <span class="hc-time">' + e(M.time) + '</span>' : '') + '</div>' +
         (M.main ? '<div class="hc-main"><span class="hc-val">' + e(M.main.text) +
                   '</span><span class="hc-delta' + (M.delta ? ' ' + M.delta.cls : '') + '">' +
                   (M.delta ? e(M.delta.text) : '') + '</span>' +
                   (bare ? '<span class="hc-lab">' + e(M.main.label) + '</span>' : '') + '</div>' : '') +
         '<div class="hc-spark"></div>' +
         '<div class="hc-cap"><span class="hc-span"></span><span class="hc-mm"></span></div>' +
         '<div class="hc-keys">' +
           M.keys.map(k => '<div><span>' + e(k.label) + '</span><b>' +
                           (k.html || e(k.text)) + '</b></div>').join('') +
         '</div>';
}
// Ostacoli che la scheda non deve coprire: ricerca, pillole, menu e pannelli aperti, pulsanti della mappa,
// plancia
const CARD_OBST = '#topbar, #searchList, #pillMenu, #moreMenu, #srcpanel, #notepanel, ' +
  '.leaflet-top .leaflet-control, #dock, #prodMenu';
function cardObstacles(){
  return [...document.querySelectorAll(CARD_OBST)]
    .filter(o => o.getClientRects().length && o.offsetWidth)
    .map(o => o.getBoundingClientRect());
}
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
                          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
// A destra del puntino, poi a sinistra, sotto, sopra (centrata o allineata a un lato, per gli schermi
// stretti), dentro la mappa; se coprono tutti qualcosa (la colonna a destra arriva al Radar), gli stessi
// scostati quanto basta. Vince il primo posto libero, se no quello che copre meno
function placeCard(c, x, y, gx){
  const V = el('views').getBoundingClientRect(), w = c.offsetWidth, h = c.offsetHeight, G = 12, M = 8,
        obs = cardObstacles();
  const box = (x0, y0) => {
    const l = Math.max(V.left + M, Math.min(x0, V.right - M - w)),
          t = Math.max(V.top + M, Math.min(y0, V.bottom - M - h));
    return { left:l, top:t, right:l + w, bottom:t + h };
  };
  const onDot = R => x > R.left - 6 && x < R.right + 6 && y > R.top - 6 && y < R.bottom + 6;
  function* places(){
    const base = [[x + gx, y - h / 2], [x - gx - w, y - h / 2],
                  [x - w / 2, y + G], [x + G - w, y + G], [x - G, y + G],
                  [x - w / 2, y - G - h], [x + G - w, y - G - h], [x - G, y - G - h]].map(p => box(...p));
    yield* base;
    for(const R of base) for(const o of obs) if(overlap(R, o)){
      yield box(o.left - M - w, R.top); yield box(o.right + M, R.top);
      yield box(R.left, o.bottom + M); yield box(R.left, o.top - M - h);
    }
  }
  let best = null, bestA = Infinity;
  for(const R of places()){
    const a = obs.reduce((s, o) => s + overlap(R, o), 0) + (onDot(R) ? w * h : 0);     // mai sul puntino
    if(a < bestA){ bestA = a; best = R; }
    if(a === 0) break;
  }
  c.style.left = (best.left - V.left) + 'px';
  c.style.top = (best.top - V.top) + 'px';
}
// Rimette la scheda accanto al suo puntino (anche mentre la mappa si sposta); fuori dalla mappa o sotto la
// barra, i pulsanti o la plancia sparisce
function positionCard(){
  if(!cardP || !cardM) return;
  const pt = map.latLngToContainerPoint(cardM.getLatLng()), mr = map.getContainer().getBoundingClientRect(),
        c = el('hoverCard');
  const x = mr.left + pt.x, y = mr.top + pt.y;
  if(x < mr.left || x > mr.right || y < mr.top || y > mr.bottom ||
     cardObstacles().some(o => x >= o.left && x <= o.right && y >= o.top && y <= o.bottom)){
    hideCard();
    return;
  }
  c.style.visibility = 'hidden';
  c.hidden = false;
  const lab = markerRefs.find(r => r.m === cardM && r.under);          // con l'etichetta: oltre il suo bordo
  placeCard(c, x, y, lab ? Math.max(12, lab.lw / 2 + 6) : 12);
  c.style.visibility = '';
}
// Ridisegna la scheda aperta (al passaggio e a ogni fotogramma del Cursore); l'andamento arriva dopo
function renderCard(){
  if(!cardP || !cardM) return;
  const c = el('hoverCard'), p = cardP, M = cardModel(p), tok = ++cardSeq;
  c.innerHTML = cardHtml(M);
  positionCard();
  fillTrend(c, p, M.main && M.main.v, () => cardP === p && tok === cardSeq)
    .then(ok => { if(ok) positionCard(); });
}
function showCard(p, m){ cardP = p; cardM = m; renderCard(); }
function hideCard(){
  clearTimeout(cardTimer);
  cardP = cardM = null;
  el('hoverCard').hidden = true;
}
// Solo col mouse, dopo 80 ms; un altro puntino annulla l'attesa; uscendo sparisce (60 ms: niente sfarfallio
// fra puntini vicini)
function cardHover(p, m){
  if(lastPointer !== 'mouse') return;
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => showCard(p, m), 80);
}
function cardLeave(){ clearTimeout(cardTimer); cardTimer = setTimeout(hideCard, 60); }

// ---- FOGLIO BASSO (tocco su un puntino): stessa scheda, "Apri la scheda", anello sulla stazione ----
function drawSheet(){
  const p = sheetP;
  if(!p) return;
  const M = cardModel(p), box = el('sheet'), tok = ++sheetSeq;
  box.querySelector('.sh-body').innerHTML = cardHtml(M);
  sheetFit();
  fillTrend(box, p, M.main && M.main.v, () => sheetP === p && tok === sheetSeq);
}
// Sempre sotto la barra in alto: sugli schermi bassi (telefono in orizzontale) si accorcia e scorre
function sheetFit(){
  if(!sheetP) return;
  const s = el('sheet'), v = el('views').getBoundingClientRect(), t = el('topbar').getBoundingClientRect();
  s.style.maxHeight = Math.max(160, v.bottom - parseFloat(getComputedStyle(s).bottom) - t.bottom - 8) + 'px';
}
// Col foglio aperto la plancia si nasconde: i crediti (obbligatori) passano nel foglio e poi tornano
function mapCredits(){ return map.attributionControl.getContainer(); }
function openSheet(p, m){
  hideCard();
  sheetP = p;
  if(sheetRing) map.removeLayer(sheetRing);
  sheetRing = L.circleMarker([p._lat, p._lon], {
    radius:(m ? m.getRadius() : 4) + 5, color:'#c05621', weight:2.5, fill:false, interactive:false
  }).addTo(map);
  el('sheet').hidden = false;
  document.body.classList.add('sheet-open');
  el('sheet').querySelector('.sh-cred').appendChild(mapCredits());
  drawSheet();
  renderLabels();
}
function closeSheet(){
  sheetP = null;
  if(sheetRing) map.removeLayer(sheetRing);
  el('sheet').hidden = true;
  document.body.classList.remove('sheet-open');
  if(el('sheet').contains(mapCredits())) el('dkCredits').appendChild(mapCredits());
  renderLabels();
}
let shY0 = null;                                         // trascinamento in giu' dalla linguetta: chiude
