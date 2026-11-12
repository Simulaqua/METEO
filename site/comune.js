// comune.js: quello che usano tutti i file (stato, variabili, nomi, fonti, ore, lettura dei dati) e l'avvio.
// Va caricato prima di mappa.js e degli altri, che usano queste costanti.
// DATA_BASE e HIST_BASE sono in index.html.

// CDN di riserva: se un file non arriva dalla base dati (raw.githubusercontent puo' dare un 400 da
// cache), riprova da jsDelivr (stesso repo, branch data; fino a ~12 h di ritardo).
// Solo online: in locale (DATA_BASE '.') nessun fallback.
const DATA_FALLBACK = 'https://cdn.jsdelivr.net/gh/Simulaqua/METEO@data';
async function fdata(path, opts){
  try {
    const r = await fetch(DATA_BASE + '/' + path, opts);
    if (r.ok || !DATA_BASE.startsWith('http')) return r;
  } catch(e){ if (!DATA_BASE.startsWith('http')) throw e; }
  return fetch(DATA_FALLBACK + '/' + path, opts);
}

// ------------------------------------------------------------------------------------------------
// STATO
// ------------------------------------------------------------------------------------------------
let map, chart = null;
let unitsByRegion = {}, currentStation = null, currentVar = null, currentVar2 = null, currentUnits = {};
let allFeatures = [], filterVar = '', selectedKey = '';
// grafico principale: 'week' | 'day3' | 'day' | 'mn'; confronti: 'compare' | 'compare30' | 'tabs'
let chartMode = 'week';

// Ogni voce geografica del menu carica piu' cartelle-dati: meteo/idro, qualita' dell'aria (AQ_),
// idrometria Protezione Civile (PC_)... Le stazioni hanno tutte lat/lon e stanno sulla stessa mappa.
const REGION_GROUPS = {
  VEN: ['VEN','AQ_VEN','MAR_VEN','ACQ_VEN'],
  LOM: ['LOM','AQ_LOM'],
  ER:  ['ER','AQ_ER','MAR_ER','INV_ER'],
  TN:  ['TN','AQ_TN','PC_TN'],
  BZ:  ['BZ','AQ_BZ'],
  FVG: ['FVG','PC_FVG','MAR_FVG'],
  PIE: ['PIE'],
  LIG: ['LIG'],
  PO:  ['PC_PO','PC_PIE'],        // bacino del Po: AIPO (valle) + ARPA Piemonte (monte)
  LAGHI: ['LAGHI'],              // Maggiore, Como, Iseo, Idro, Garda
};
// "Tutte" senza PC_PIE: sono gli stessi idrometri gia' dentro PIE, niente doppioni.
const REGIONS_ALL = Object.values(REGION_GROUPS).flat().filter(r => r !== 'PC_PIE');

// Categoria di ogni variabile = le 3 pagine (misure dirette, derivate, indici).
const WARROW = 'FRECCEVENTO';                     // pseudo-variabile (derivate): velocita' con le frecce
const WROSE = 'ROSAVENTO';                       // pseudo-variabile (derivate): apre la rosa dei venti
const CAT_DERIVATE = new Set(['TDEW','TAPP','VPD','QSPEC','PSLM','UWND','VWND', WARROW, WROSE]);
const CAT_INDICI   = new Set(['EAQI','O3_8H','PREC1','PREC3','PREC6','PREC12','PREC24','PREC48',
                              'GDD','HDD','CDD','ET0']);

const RAIN_VARS = ['PREC1','PREC3','PREC6','PREC12','PREC24','PREC48'];
const isRain = v => RAIN_VARS.indexOf(v) >= 0;
// la pioggia (per intervallo e cumulate 1-48 h) e' sempre a barre verticali
const isRainVar = v => v === 'PREC' || isRain(v);
// la direzione del vento e' a puntini
const isDirVar = v => v === 'DVENTO' || v === 'DVENTOMAX';
function varCat(v){ return CAT_DERIVATE.has(v) ? 'derivate' : (CAT_INDICI.has(v) ? 'indici' : 'dirette'); }
let currentPage = 'dirette';

// Ordine naturale dei numeri nei nomi (1 h, 3 h, 12 h, 24 h e non 1, 12, 24, 3).
const padNum = s => String(s).replace(/\d+/g, m => m.padStart(4, '0'));
const natCode = (a, b) => {                                     // codici: ordine ASCII come l'export
  const x = padNum(a), y = padNum(b);
  return x < y ? -1 : (x > y ? 1 : 0);
};
const natLabel = (a, b) => padNum(a).localeCompare(padNum(b));
const natVars = (a, b) => ((a === WROSE) - (b === WROSE)) || ((a === WARROW) - (b === WARROW))
  || natCode(a, b);   // la rosa in coda
// Livelli (fiumi, laghi, falda, marea) sempre al centimetro, anche le quote assolute (108.99 m s.m.m.).
const CM_VARS = new Set(['LIVIDRO','LIVLAGO','FREATICA','MAREA']);
function fmtNum(v, vr){
  const a = Math.abs(v);
  const d = CM_VARS.has(vr) ? 2 : (a >= 100 ? 0 : (a >= 1 ? 1 : 2));
  return (+v).toFixed(d);
}

// nomi leggibili delle variabili (sigla comune -> nome esteso)
const VAR_LABELS = {
  TEMP:'Temperatura aria', PREC:'Precipitazione', UMID:'Umidità relativa',
  PRESS:'Pressione atmosferica', RADSOL:'Radiazione solare', SOLEGG:'Durata soleggiamento',
  VVENTO:'Velocità vento', VVENTOSCAL:'Velocità vento scalare', VVENTOMAX:'Velocità raffica',
  DVENTO:'Direzione vento', DVENTOMAX:'Direzione raffica', LIVIDRO:'Livello idrometrico',
  PORTATA:'Portata', FREATICA:'Altezza freatimetrica', TEMPACQUA:'Temperatura acqua',
  SOLIDI:'Solidi sospesi', LIVNEVE:'Altezza neve', VISIB:'Visibilità',
  BAGNATURA:'Bagnatura fogliare', PREC_TYPE:'Tipo precipitazione', CLOUDINESS:'Nuvolosità',
  // qualita' dell'aria
  PM10:'Polveri PM10', PM25:'Polveri PM2.5', NO2:'Biossido di azoto', O3:'Ozono',
  SO2:'Biossido di zolfo', CO:'Monossido di carbonio', C6H6:'Benzene',
  GAMMA:'Radioattività (dose gamma)',
  // maree / meteo-marino
  MAREA:'Livello marea', ONDE:'Altezza onde',
  // qualita' acque marino-costiere
  SALINITA:'Salinità', OSSIGENO:'Ossigeno disciolto', OSSIGENO_SAT:'Ossigeno (saturazione)',
  PH:'pH', CLOROFILLA:'Clorofilla a', CONDUCIBILITA:'Conducibilità',
  // laghi regolati
  LIVLAGO:'Livello lago', AFFLUSSO:'Afflusso', DEFLUSSO:'Deflusso', VOLINVASO:'Volume invasato',
  // grandezze DERIVATE (calcolate)
  TDEW:'Punto di rugiada', TAPP:'Temperatura percepita', VPD:'Deficit press. vapore',
  QSPEC:'Umidità specifica', PSLM:'Pressione al livello mare',
  UWND:'Vento (comp. Est)', VWND:'Vento (comp. Nord)',
  // INDICI
  EAQI:'Indice qualità aria (EAQI)', O3_8H:'Ozono (media 8h)',
  PREC1:'Pioggia 1 h', PREC3:'Pioggia 3 h', PREC6:'Pioggia 6 h', PREC12:'Pioggia 12 h',
  PREC24:'Pioggia 24 h', PREC48:'Pioggia 48 h',
  GDD:'Gradi-giorno crescita', HDD:'Gradi-giorno riscaldamento', CDD:'Gradi-giorno raffrescamento',
  ET0:'Evapotraspirazione ET₀',
  // pseudo-variabili
  FRECCEVENTO:'Vento',
  ROSAVENTO:'Rosa dei venti'
};
const varLabel = v => VAR_LABELS[v] || v;

// Alcune fonti (Bolzano) scrivono i nomi TUTTI MAIUSCOLI: si porta a Title Case all'italiana, con
// preposizioni e articoli minuscoli ("ADIGE A SALORNO" -> "Adige a Salorno").
const NAME_SMALL = new Set(['a','ad','al','allo','alla','ai','agli','alle','da','dal','dalla','dai','dagli',
  'dalle','di','del','dello','della','dei','degli','delle','in','nel','nello','nella','nei','negli','nelle',
  'e','ed','con',
  'su','sul','sulla','sui','sugli','sulle','per','il','lo','la','i','gli','le','tra','fra','presso']);
function prettyName(name){
  if(!name || name !== name.toUpperCase()) return name;
  return name.toLowerCase().split(' ').map((w, i) => {
    if(!w) return w;
    if(i > 0 && NAME_SMALL.has(w)) return w;
    return w.split('-').map(p => p ? p[0].toUpperCase() + p.slice(1) : p).join('-');
  }).join(' ');
}

// Fonte del dato per regione: url = sito istituzionale (riga "Fonte:" del pannello stazione),
// data = pagina o servizio dei dati (nomi cliccabili del pannello stato fonti).
const SOURCES = {
  VEN: { name:'ARPA Veneto',                         url:'https://www.arpa.veneto.it',
         data:'https://www.arpa.veneto.it/dati-ambientali/dati-in-diretta' },
  LOM: { name:'ARPA Lombardia',                      url:'https://www.arpalombardia.it',
         data:'https://www.dati.lombardia.it/Ambiente/Dati-sensori-meteo/647i-nhxk' },
  ER:  { name:'ARPAE Emilia-Romagna',                url:'https://allertameteo.regione.emilia-romagna.it',
         data:'https://dati.arpae.it/dataset/dati-dalle-stazioni-meteo-locali-della-rete-idrometeorologica-regionale' },
  TN:  { name:'Meteotrentino – Provincia di Trento', url:'https://www.meteotrentino.it',
         data:'http://dati.meteotrentino.it/service.asmx' },
  BZ:  { name:'Provincia Autonoma di Bolzano',       url:'https://weather.provinz.bz.it',
         data:'https://dati.retecivica.bz.it/services/meteo/v1/stations' },
  FVG: { name:'OSMER – ARPA FVG',                    url:'https://www.meteo.fvg.it',
         data:'https://www.osmer.fvg.it/archivio.php?ln=&p=dati' },
  // qualita' dell'aria
  AQ_VEN: { name:'ARPA Veneto – Qualità dell\'aria',
            url:'https://www.arpa.veneto.it/temi-ambientali/aria',
            data:'https://www2.arpa.veneto.it/aria-json/exported/aria/data.json' },
  AQ_LOM: { name:'ARPA Lombardia – Qualità dell\'aria',   url:'https://www.dati.lombardia.it',
            data:'https://www.dati.lombardia.it/Ambiente/Dati-sensori-aria/nicp-bhqi' },
  AQ_ER:  { name:'ARPAE Emilia-Romagna – Qualità dell\'aria', url:'https://dati.arpae.it',
            data:'https://dati.arpae.it/dataset/qualita-dell-aria-rete-di-monitoraggio' },
  AQ_TN:  { name:'APPA Trento – Qualità dell\'aria',      url:'https://bollettino.appa.tn.it/aria',
            data:'https://bollettino.appa.tn.it/aria/opendata/json/last/' },
  AQ_BZ:  { name:'APPA Bolzano – Qualità dell\'aria',     url:'https://appa.provincia.bz.it',
            data:'https://dati.retecivica.bz.it/services/airquality/stations' },
  AQ_FVG: { name:'ARPA FVG – Qualità dell\'aria',         url:'https://www.dati.friuliveneziagiulia.it' },
  // idrometria Protezione Civile
  PC_FVG: { name:'Protezione Civile FVG',                url:'https://monitor.protezionecivile.fvg.it' },
  PC_TN:  { name:'Ufficio Dighe – Provincia di Trento',  url:'https://www.floods.it' },
  // maree e bacino del Po
  MAR_VEN:{ name:'CPSM – Comune di Venezia (maree)',
            url:'https://www.comune.venezia.it/it/content/le-previsioni',
            data:'https://www.comune.venezia.it/it/content/centro-previsioni-e-segnalazioni-maree' },
  MAR_ER: { name:'ARPAE Emilia-Romagna – Meteo-marino',
            url:'https://allertameteo.regione.emilia-romagna.it' },
  MAR_FVG:{ name:'OGS Trieste – Meteo-marino (Golfo di Trieste)', url:'https://www.ogs.it',
            data:'https://nodc.ogs.it/erddap/index.html' },
  ACQ_VEN:{ name:'ARPA Veneto – Acque marino-costiere',
            url:'https://www.arpa.veneto.it/temi-ambientali/acqua',
            data:'https://api.arpa.veneto.it/REST/v1' },
  PC_PO:  { name:'AIPO – Agenzia Interregionale per il fiume Po', url:'https://www.agenziapo.it',
            data:'https://idrometri.agenziapo.it' },
  PC_PIE: { name:'ARPA Piemonte – Rete Meteoidrografica (bacino Po)', url:'https://www.arpa.piemonte.it',
            data:'https://utility.arpa.piemonte.it/meteoidro/' },
  PIE:    { name:'ARPA Piemonte – Rete Meteoidrografica',          url:'https://www.arpa.piemonte.it',
            data:'https://utility.arpa.piemonte.it/api_realtime/docs' },
  LIG:    { name:'ARPAL – OMIRL (Liguria)',                           url:'https://omirl.regione.liguria.it',
            data:'https://omirl.regione.liguria.it/Omirl/rest/stations/Termo' },
  INV_ER: { name:'Romagna Acque – Invasi (Ridracoli e Conca)',        url:'https://www.romagnacque.it',
            data:'https://www.romagnacque.it/acqua-in-diretta/diga-di-ridracoli/' },
  LAGHI:  { name:'laghi.net – Enti Regolatori dei Grandi Laghi',      url:'https://www.laghi.net' },
};

const el = id => document.getElementById(id);
const setStatus = m => { el('status').textContent = m || ''; };

const PHONE = matchMedia('(max-width:720px)');

const _DIR16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
const _dirName = deg => _DIR16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
// Sigla + freccia piccola. La sigla e' la PROVENIENZA (NNE = da nord-nord-est); la freccia (↓ ruotata
// dei gradi misurati) va dove VA il vento: da N punta in giu', da E a sinistra.
// Unico punto che scrive una direzione del vento in HTML.
function windDirHtml(deg){
  const d = ((+deg % 360) + 360) % 360, n = _dirName(d), t = 'vento da ' + n;
  return `<span class="wdir" role="img" aria-label="${t}" title="${t}">${n}<i class="wd-ar" aria-hidden="true" style="transform:rotate(${Math.round(d * 10) / 10}deg)">↓</i></span>`;
}

const escHtml = t => String(t).replace(/[&<>"]/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]);

// Orari 24 h. Il CSV ha l'ORA LOCALE ITALIANA come testo senza fuso; parseCSV la porta all'istante
// vero (epoch UTC), cosi' l'asse resta crescente anche quando l'ora 02:00-02:59 dell'ultima domenica
// di ottobre si ripete. Per mostrarla civT riporta l'istante all'ora civile "come UTC" e i
// formattatori leggono le cifre con getUTC*: 24 h esatte a prescindere dal fuso del browser.
const pad = n => String(n).padStart(2,'0');
// ora legale europea: dall'ultima domenica di marzo all'ultima di ottobre, alle 01:00 UTC
const _lastSun1 = (y, m) => {
  const d = new Date(Date.UTC(y, m + 1, 0, 1));
  return d.getTime() / 1000 - d.getUTCDay() * 86400;
};
const romeOffset = ts => {
  const y = new Date(ts * 1000).getUTCFullYear();
  return ts >= _lastSun1(y, 2) && ts < _lastSun1(y, 9) ? 7200 : 3600;
};
const civT = ts => ts + romeOffset(ts);
// Ora civile "come UTC" -> istante vero. Nell'ora che si ripete vale la prima volta (CEST) se viene
// dopo prev, altrimenti la seconda.
function civToUtc(c, prev){
  const a = c - 7200, b = c - 3600, okA = romeOffset(a) === 7200, okB = romeOffset(b) === 3600;
  return okA && (!okB || prev == null || a > prev) ? a : b;
}

let _toastT = null;
function toast(msg, ms){
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => t.classList.remove('show'), ms || 3500);
}

// ------------------------------------------------------------------------------------------------
// CSV -> colonne + asse x (epoch UTC in secondi, l'istante vero)
// ------------------------------------------------------------------------------------------------
function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const cols = {}; header.slice(1).forEach(h => cols[h] = []);
  const x = [];
  let prev = null;
  for(let i=1;i<lines.length;i++){
    if(!lines[i]) continue;
    const cells = lines[i].split(',');
    const t = civToUtc(Date.parse(cells[0] + 'Z') / 1000, prev);
    x.push(t);
    if(!isNaN(t)) prev = t;
    for(let j=1;j<header.length;j++){
      const raw = cells[j], nv = (raw === '' || raw === undefined) ? NaN : Number(raw);
      cols[header[j]].push(isNaN(nv) ? null : nv);       // testo non numerico (es. '>>'): buco, non NaN
    }
  }
  return { header, cols, x };
}

// ora civile "AAAA-MM-GGTHH:MM" -> secondi civili "come UTC" (null se manca o non si legge)
function civSec(s){
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s || '');
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) / 1000 : null;
}

// ------------------------------------------------------------------------------------------------
// AVVIO
// ------------------------------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  buildChartControls();
  initMap();
  buildStationControls();
  buildSearchControls();
  buildHistControls();
  buildStatusControls();
  loadRegions(REGIONS_ALL).then(() => applyHash());
});
