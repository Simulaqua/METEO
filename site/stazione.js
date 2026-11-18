// stazione.js: la scheda della stazione (apertura, riga delle variabili con "+" e "Altro", periodi e
// Confronta, Impilate, schede, link). Gli ascoltatori sono in buildStationControls(), chiamata dall'avvio
// (comune.js).

function resetPanel(){
  exitHist();
  el('stationName').textContent = 'Seleziona una stazione';
  el('stationName').title = '';
  el('stationMeta').textContent = '';
  el('stInfo').hidden = true;
  cardClose();
  expClose();
  el('vars').innerHTML = '';
  el('source').innerHTML = '';
  cmpClose();
  altClose();
  el('pact').hidden = el('ptools').hidden = el('pbar').hidden = true;
  document.body.classList.remove('rose-mode', 'clima-mode');
  el('windrose').innerHTML = '';
}
const TZNOTE = 'Dati non validati.';

// variabile con cui si apre una stazione, se la mappa non ne ha scelta una
const OPEN_ORDER = ['TEMP', 'PREC', 'LIVIDRO'];
// tutte le variabili della stazione aperta, con le pseudo-variabili del vento
let stationVars = [];
// ultima variabile a grafico: ci si torna lasciando la rosa
let chartVar = null;
const selVars = () => [currentVar].concat(extraVars).filter(Boolean);
const maxVars = () => PHONE.matches ? 3 : 5;
let stLast = null;                                   // ora civile dell'ultimo dato, per la "i" della stazione

// Codice e ultimo dato nel titolo del nome; accanto, solo se i dati sono fermi: oltre STALE_HOURS ore o tre
// passi della serie (i dati giornalieri, come le polveri, non sono fermi dopo 3 ore). c = ora civile.
function setMeta(code, c, table){
  let when = '', stale = false;
  stLast = c;
  if(c != null){
    const limit = Math.max(STALE_HOURS * 3600, 3 * (table ? medianStep(table.x.filter(x => x != null)) : 0));
    const now = civT(Date.now() / 1000), d = new Date(c * 1000), n = new Date(now * 1000),
          hm = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()),
          today = d.toISOString().slice(0, 10) === n.toISOString().slice(0, 10);
    when = today ? hm : pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) +
           (d.getUTCFullYear() === n.getUTCFullYear() ? '' : '/' + d.getUTCFullYear()) + ' ' + hm;
    stale = now - c > limit;
    if(stale) when = (today ? 'alle ' : 'al ') + when;
  }
  el('stationName').title = code + (when && !stale ? ', ultimo dato ' + when : '');
  el('stationMeta').textContent = stale ? 'dati fermi ' + when : '';
}
// Pioggia del radar nel punto della stazione (punti/<REG>.json del Pi), per le barre accanto al
// pluviometro. Se arriva dopo il grafico, il grafico della pioggia si ridisegna.
async function loadRadarPoints(props, fresh){
  if(typeof Radar === 'undefined' || !Radar.points) return;
  const all = await Radar.points(props._region, fresh);
  const v = all && all.s && all.s[props.scode];
  props._radar = v && v.some(x => x != null) ? { t:all.t, v } : null;
  const m = chart && chart._m;
  if(props._radar && currentStation === props && m && m.st === props && m.s1 && m.s1.src === 'PREC'
     && !m.radar && !isCompareMode() && !histMode) renderChart(currentVar);
}
async function selectStation(props){
  snapPause();
  closeSheet();
  const radarLoad = props._radar === undefined ? loadRadarPoints(props) : null;
  const prevSel = selVars();
  chartVar = null;
  el('stationName').title = '';
  currentStation = props;
  selectedKey = props._region + '|' + props.scode;
  const region = props._region;
  openStationTab(props);
  if(props._lat != null) map.panTo([props._lat, props._lon]);
  currentUnits = unitsByRegion[region] || {};
  el('panel').scrollTop = 0;            // su telefono: la stazione si vede dall'inizio
  el('stationName').textContent = prettyName(props.name || props.scode);
  el('stationMeta').textContent = '';
  const src = SOURCES[region];
  el('source').innerHTML = (src
    ? `Fonte: <a href="${src.url}" target="_blank" rel="noopener">${escHtml(src.name)}</a>. `
    : '') + TZNOTE;
  setStatus('Carico la serie…');

  let table;
  if(props._table && props._tableAt && (Date.now() - props._tableAt) < 5*60*1000){
    table = props._table;                 // cambio scheda: riusa la serie recente (< 5 min)
  } else {
    let csv;
    try {
      csv = await (await fdata(`${region}/${props.series}`)).text();
    } catch(e){ setStatus('Serie non disponibile.'); return; }
    table = parseCSV(csv);                // {header:[datetime,VAR,...], cols:{name:[...]}, x:[epoch]}
    props._table = table;
    props._tableAt = Date.now();
  }
  // il radar di solito arriva con la serie; se tarda, il grafico esce subito e si ridisegna dopo
  if(radarLoad) await Promise.race([radarLoad, new Promise(r => setTimeout(r, 1500))]);

  setMeta(props.scode, civSec(props.latest_time), table);
  el('pact').hidden = el('ptools').hidden = el('pbar').hidden = false;
  el('stInfo').hidden = false;
  cardClose();

  stationVars = ((props.variables && props.variables.length) ? props.variables : table.header.slice(1))
    .slice();
  if(windObsCount(table) >= 10) stationVars.push(WARROW, WROSE);
  if(stationVars.includes('PREC') && stationVars.includes('ET0')) stationVars.push(WBIL);
  const hasHist = stationHistVars(props).length > 0;
  if(hasHist) stationVars.push(WCLIMA);              // la Climatologia viene dai dati dello Storico
  extraVars = [];
  document.body.classList.remove('rose-mode', 'clima-mode');
  el('histbtn').style.display = 'none';   // "Storico": solo con pioggia/temperatura E storico pubblicato
  if(hasHist) histIndex().then(ix => {
    if(currentStation !== props) return;
    if(ix && ix.regions && ix.regions[props._region]) el('histbtn').style.display = '';
    else {                                          // regione senza Storico: niente Climatologia
      stationVars = stationVars.filter(v => v !== WCLIMA);
      if(currentVar !== WCLIMA) buildVarRow();
    }
  });
  if(histMode && !hasHist) exitHist();
  // Impilate resta acceso cambiando stazione, con le variabili di prima che questa ha
  const keep = prevSel.filter(v => !isView(v) && stationVars.includes(v));
  if(histMode && hasHist){
    if(!['PREC', 'TEMP'].includes(histVar) || !stationHistVars(props).includes(histVar))
      histVar = stationHistVars(props)[0];
    currentVar = histVar;
    buildVarRow();
    renderHist();
  } else if(stackMode && keep.length >= 2){
    currentVar = keep[0];
    extraVars = keep.slice(1);
    chartVar = currentVar;
    buildVarRow();
    renderChart(currentVar);
  } else {
    const main = stationVars.filter(v => isMainVar(v, stationVars)).sort(byVarOrder);
    // la variabile scelta sulla mappa; se no temperatura, poi pioggia, poi livello; se no la prima
    const pick = (filterVar && stationVars.includes(filterVar)) ? filterVar
               : (OPEN_ORDER.find(v => main.includes(v)) || main[0]
                  || stationVars.slice().sort(byVarOrder)[0]);
    if(pick) drawVar(pick);
    else { currentVar = null; buildVarRow(); clearChart(); }
  }
  setStatus('');

  el('stationFilter').value = selectedKey;
  buildVarFilter();
  renderMarkers();
  updateHash();
}

// Una chip della riga: il nome (col trattino del suo colore se e' nel grafico); "+" la aggiunge, "×" la
// toglie.
function varItem(v, on, plus){
  const item = document.createElement('span');
  item.className = 'vn' + (on ? ' on' : '') + (plus ? ' plus' : '');
  item.dataset.var = v;
  item.style.setProperty('--c', varColor(v));
  item.style.setProperty('--t', varTint(v));
  const b = document.createElement('button');
  b.className = 'vb';
  b.dataset.var = v;
  b.textContent = varShort(v);
  b.title = varLabel(v);
  b.setAttribute('aria-pressed', String(on));
  if(on){
    const k = document.createElement('i');
    k.className = 'key';
    k.style.background = varColor(v);
    b.prepend(k);
  }
  item.appendChild(b);
  if(plus){
    const p = document.createElement('button'), x = extraVars.includes(v);
    p.className = 'vp';
    p.dataset.var = v;
    p.textContent = x ? '×' : '+';
    p.setAttribute('aria-label', (x ? 'Togli ' : 'Aggiungi ') + varShort(v));
    item.appendChild(p);
  }
  return item;
}
function rowButton(id, text, extra){
  const b = document.createElement('button');
  b.id = id;
  b.textContent = text;
  Object.entries(extra || {}).forEach(([k, val]) => b.setAttribute(k, val));
  return b;
}
const altButton = () => rowButton('altBtn', 'Altro',
  { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'altMenu' });
// La riga si ricostruisce a ogni scelta: il fuoco della tastiera torna sullo stesso comando.
function keepFocus(box, build){
  const f = document.activeElement;
  const was = !box.contains(f) ? null
            : f.id ? '#' + f.id : '.' + f.className + '[data-var="' + f.dataset.var + '"]';
  build();
  const back = was && (box.querySelector(was) || box.querySelector(was.replace(/^\.vp/, '.vb')));
  if(back) back.focus({ preventScroll:true });
}
// Riga delle variabili: le misure principali in ordine fisico, piu' quelle scelte da "Altro".
// Nei confronti si guarda una variabile alla volta: niente "+".
function buildVarRow(){
  keepFocus(el('vars'), fillVarRow);
}
// variabili della riga: nelle Vicine solo quelle che valgono
const rowVars = () => chartMode === 'near' ? stationVars.filter(nearOk) : stationVars;
function fillVarRow(){
  const box = el('vars'), all = rowVars(), cmp = isCompareMode();
  const sel = cmp ? [currentVar] : selVars();
  const main = all.filter(v => isMainVar(v, all)).sort(byVarOrder);
  const shown = main.concat(sel.filter(v => v && all.includes(v) && !main.includes(v)).sort(byVarOrder));
  const plus = !cmp && !histMode && !isView(currentVar);
  box.innerHTML = '';
  shown.forEach(v => box.appendChild(varItem(v, sel.includes(v), plus && v !== currentVar && !isView(v))));
  if(all.some(v => !isMainVar(v, all))) box.appendChild(altButton());
  if(sel.length >= 2 && !cmp)
    box.appendChild(rowButton('stackbtn', 'Impilate', {
      'aria-pressed': String(stackMode), title: 'Una fascia per variabile, con cursore e zoom insieme'
    }));
}

function drawVar(v){
  if(histMode){
    if(v === 'PREC' || v === 'TEMP'){
      currentVar = v;
      histVar = v;
      buildVarRow();
      renderHist();
      return;
    }
    exitHist();
  }
  currentVar = v;
  extraVars = [];
  if(!isView(v)) chartVar = v;
  document.body.classList.toggle('rose-mode', v === WROSE);
  document.body.classList.toggle('clima-mode', v === WCLIMA);
  syncModes();
  buildVarRow();
  if(v === WROSE) updateWindRose();
  else if(v === WCLIMA) renderClima();
  else renderChart(v);
  if(currentStation) updateHash();
}
// "+": aggiunge la variabile al grafico (asse a destra, del suo colore); "×" la toglie
function addVar(v){
  if(isView(v) || isCompareMode() || histMode || !currentStation) return;
  const i = extraVars.indexOf(v);
  if(i >= 0) extraVars.splice(i, 1);
  else if(v !== currentVar){
    if(selVars().length >= maxVars()){ toast('Al massimo ' + maxVars() + ' variabili'); return; }
    extraVars.push(v);
  }
  buildVarRow();
  renderChart(currentVar);
  updateHash();
}

// "Altro": misure secondarie, derivate, indici (e la rosa), in tre gruppi; nel Confronto schede quelle
// con dati in almeno due schede
function altOpen(){
  const m = el('altMenu'), b = el('altBtn');
  if(!b) return;
  const cmp = document.body.classList.contains('view-compare');
  const all = cmp ? compareVars : rowVars(), sel = cmp ? [compareVar] : selVars();
  const rest = all.filter(v => !isMainVar(v, all)).sort(byVarOrder);
  m.innerHTML = '';
  ['dirette', 'derivate', 'indici'].map(c => rest.filter(v => varCat(v) === c)).filter(g => g.length)
    .forEach((g, k) => {
      if(k) m.appendChild(document.createElement('hr'));
      g.forEach(v => {
        const it = document.createElement('button');
        it.dataset.var = v;
        it.setAttribute('role', 'menuitemradio');
        it.setAttribute('aria-checked', String(sel.includes(v)));
        it.tabIndex = -1;
        it.textContent = varShort(v);
        it.classList.toggle('on', sel.includes(v));
        m.appendChild(it);
      });
    });
  m.hidden = false;
  b.setAttribute('aria-expanded', 'true');
  placeMenu(m, b);
  (m.querySelector('.on') || m.querySelector('button')).focus({ preventScroll:true });
}
function altClose(refocus){
  const m = el('altMenu'), b = el('altBtn');
  if(m.hidden) return;
  m.hidden = true;
  if(b){
    b.setAttribute('aria-expanded', 'false');
    if(refocus) b.focus({ preventScroll:true });
  }
}

async function ensureTable(p){
  if(p._table) return;
  try {
    p._table = parseCSV(await (await fdata(`${p._region}/${p.series}`)).text());
    p._tableAt = Date.now();
  } catch(e){}
}
async function ensureTabTables(){
  for(const t of openTabs) await ensureTable(t.props);
}
const hasData = (p, v) => !!p._table && (p._table.cols[v] || []).some(x => x != null);

// VICINE: la stazione e le piu' vicine con la stessa misura. Le grandezze di un corpo d'acqua non valgono (la
// vicina misura un'altra acqua); temperatura e pressione dipendono dalla quota.
const NEAR_KM = 25, NEAR_N = 3, NEAR_DZ = { TEMP:300, TDEW:300, TAPP:300, PRESS:50 };
const WATER_VARS = new Set(['LIVIDRO', 'PORTATA', 'FREATICA', 'TEMPACQUA', 'SOLIDI', 'LIVLAGO', 'AFFLUSSO',
  'DEFLUSSO', 'VOLINVASO', 'MAREA', 'ONDE', 'SALINITA', 'OSSIGENO', 'OSSIGENO_SAT', 'PH', 'CLOROFILLA',
  'CONDUCIBILITA']);
const nearOk = v => !!v && !isView(v) && v !== WARROW && !WATER_VARS.has(v);
function distKm(a, b){
  const r = Math.PI / 180, dLat = (b._lat - a._lat) * r, dLon = (b._lon - a._lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a._lat * r) * Math.cos(b._lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
// Fino a NEAR_N stazioni entro NEAR_KM con dati di v nella serie a 7 giorni, dalla piu' vicina. Dove la rete
// non da' la quota vale la sola distanza.
async function nearStations(props, v){
  const dz = NEAR_DZ[v];
  const sameHeight = p => dz == null || p.quota == null || props.quota == null
                          || Math.abs(p.quota - props.quota) <= dz;
  const near = allFeatures.map(f => f.properties)
    .filter(p => p !== props && p._lat != null && (p.variables || []).includes(v) && sameHeight(p))
    .map(p => ({ props:p, km:distKm(props, p) }))
    .filter(o => o.km <= NEAR_KM)
    .sort((a, b) => a.km - b.km);
  const out = [];
  for(const o of near){
    if(out.length >= NEAR_N) break;
    await ensureTable(o.props);
    if(hasData(o.props, v)) out.push(o);
  }
  return out;
}
const fmtKm = km => (km < 10 ? Math.round(km * 10) / 10 : Math.round(km)) + ' km';

async function refreshStation(){
  if(!currentStation) return;
  const region = currentStation._region;
  const btn = el('refresh');
  const icon = btn.innerHTML;
  btn.textContent = '⏳';
  btn.disabled = true;
  try {
    const csv = await (await fdata(`${region}/${currentStation.series}`, { cache:'no-store' })).text();
    const t = parseCSV(csv);
    currentStation._table = t;
    currentStation._table30 = null;                // il bilancio e i 30 giorni si riprendono freschi
    if(chartMode === 'compare30') await ensureTable30();
    await loadRadarPoints(currentStation, true);
    if(currentVar === WROSE) updateWindRose();
    else if(currentVar !== WCLIMA){                // la Climatologia non usa la serie dei 7 giorni
      if(currentVar && (currentVar === WARROW || currentVar === WBIL || t.cols[currentVar]))
        renderChart(currentVar);
      else drawVar(t.header[1]);
    }
    // Ultimo dato MISURATO: salta le righe con sole derivate/indici (GDD/ET0 alle 12:00 solari, la mattina
    // sono "nel futuro").
    let lastX = null;
    for(let i = t.x.length - 1; i >= 0 && lastX == null; i--){
      for(const v of t.header.slice(1)){
        if(varCat(v) === 'dirette' && t.cols[v][i] != null){ lastX = t.x[i]; break; }
      }
    }
    setMeta(currentStation.scode, lastX ? civT(lastX) : null, t);
  } catch(e){ setStatus('Aggiornamento non riuscito.'); }
  btn.innerHTML = icon;
  btn.disabled = false;
}

// "Impilate": una fascia per variabile scelta. Resta una preferenza: con una variabile sola il grafico e'
// unico.
let stackMode = false, stackObj = null;
const stacked = () => stackMode && selVars().length >= 2 && !isCompareMode() && !isView(currentVar);
function exitStack(){
  if(!stackMode) return;
  stackMode = false;
  document.body.classList.remove('stacked');
  if(stackObj){ stackObj.destroy(); stackObj = null; }
}
function setStackMode(on, vars){
  if(on){
    if(!currentStation) return;
    const ok = (vars || []).filter(v => !isView(v) && stationVars.includes(v));
    if(ok.length >= 2){
      currentVar = chartVar = ok[0];
      extraVars = ok.slice(1, maxVars());
    }
    if(isCompareMode()){                          // il confronto non ha senso a fasce: torna ai 7 giorni
      chartMode = 'week';
      syncModes();
    }
    document.body.classList.remove('rose-mode', 'clima-mode');
    stackMode = true;
  } else exitStack();
  buildVarRow();
  if(currentStation && currentVar) renderChart(currentVar);
  updateHash();
}
function renderStackView(){
  const t = currentStation && currentStation._table;
  if(!t) return;
  const vars = selVars().filter(v => t.cols[v === WARROW ? 'VVENTO' : v]);
  stackObj = createStack(el('chart'), { station: currentStation, table: t, vars, mode: chartMode });
}

let openTabs = [];
const MAX_TABS = 8;
const tabKeyOf = p => p._region + '|' + p.scode;
function openStationTab(props){
  const key = tabKeyOf(props);
  const t = openTabs.find(x => x.key === key);
  if(t) t.props = props;
  else {
    openTabs.push({key, props});
    if(openTabs.length > MAX_TABS) openTabs.shift();
  }
  document.body.classList.add('view-station');
  document.body.classList.remove('view-compare');
  renderTabbar(key);
}
function renderTabbar(activeKey){
  const bar = el('tabbar');
  [...bar.querySelectorAll('.tab.station')].forEach(b => b.remove());
  openTabs.forEach(t => {
    const b = document.createElement('button');
    b.className = 'tab station' + (activeKey === t.key ? ' active' : '');
    b.innerHTML = '<span class="tnm"></span><span class="x" title="Chiudi">×</span>';
    b.querySelector('.tnm').textContent = prettyName(t.props.name || t.props.scode);
    b.onclick = (e) => {
      if(e.target.classList.contains('x')) closeTab(t.key);
      else selectStation(t.props);
    };
    bar.appendChild(b);
  });
  if(compareOpen){
    const b = document.createElement('button');
    b.className = 'tab station' + (activeKey === CMP_KEY ? ' active' : '');
    b.innerHTML = '<span class="tnm">Confronto</span><span class="x" title="Chiudi">×</span>';
    b.onclick = (e) => {
      if(e.target.classList.contains('x')) closeCompare();
      else { renderTabbar(CMP_KEY); renderCompareView(); }
    };
    bar.appendChild(b);
  }
  el('tabMap').classList.toggle('active', !activeKey);
}
let compareOpen = false, compareVar = null;
const CMP_KEY = '__cmp__';
function openCompareTab(){
  compareOpen = true;
  renderTabbar(CMP_KEY);
  renderCompareView();
}
function closeCompare(){
  compareOpen = false;
  if(document.body.classList.contains('view-compare')) showMapView();
  else renderTabbar(
    document.body.classList.contains('view-station') && currentStation ? tabKeyOf(currentStation) : null
  );
}
// riga della scheda Confronto: una variabile alla volta; come nella scheda le misure principali e quella
// scelta, il resto in "Altro"
let compareVars = [];
function buildCompareRow(){
  const box = el('vars'), all = compareVars, main = all.filter(v => isMainVar(v, all));
  const shown = main.concat(compareVar && !main.includes(compareVar) ? [compareVar] : []);
  keepFocus(box, () => {
    box.innerHTML = '';
    shown.forEach(v => box.appendChild(varItem(v, v === compareVar, false)));
    if(all.some(v => !isMainVar(v, all))) box.appendChild(altButton());
  });
}
// una scheda entra nel confronto di v se la sua tabella ha almeno un valore di v
const tabHas = (t, v) => hasData(t.props, v);
// vista della scheda Confronto: le variabili con dati in almeno due schede aperte, una curva per stazione
async function renderCompareView(){
  exitHist();
  exitStack();
  altClose();
  document.body.classList.add('view-station', 'view-compare');
  document.body.classList.remove('rose-mode', 'clima-mode');
  el('panel').scrollTop = 0;
  el('stationName').textContent = 'Confronto schede';
  el('stationName').title = '';
  el('stInfo').hidden = true;
  cardClose();
  el('stationMeta').textContent = openTabs.length ? '' : 'nessuna scheda aperta';
  el('source').innerHTML = TZNOTE;
  el('pact').hidden = el('ptools').hidden = el('pbar').hidden = false;
  el('windrose').innerHTML = '';
  history.replaceState(null, '', '#confronto');
  await ensureTabTables();
  const vars = new Set(openTabs.flatMap(t => t.props.variables || []));
  compareVars = [...vars].filter(v => openTabs.filter(t => tabHas(t, v)).length >= 2).sort(byVarOrder);
  if(!compareVars.includes(compareVar))
    compareVar = compareVars.includes(currentVar) ? currentVar : compareVars[0] || null;
  buildCompareRow();
  if(['compare','compare30','tabs','near'].indexOf(chartMode) >= 0) chartMode = 'week';
  syncModes();
  if(compareVar) renderCompareTabs(compareVar);
  else {
    clearChart();
    el('chartlegend').innerHTML = '';
    const why = openTabs.length < 2 ? 'Servono almeno due schede.' : 'Nessuna variabile in comune.';
    setStatus(openTabs.length ? why : '');
  }
}
function pickCompareVar(v){
  compareVar = v;
  buildCompareRow();
  renderCompareTabs(v);
}
function showMapView(){
  document.body.classList.remove('view-station', 'view-compare');
  renderTabbar(null);
  history.replaceState(null, '', location.pathname + location.search);
  setTimeout(() => map.invalidateSize(), 40);
}
function closeTab(key){
  openTabs = openTabs.filter(t => t.key !== key);
  if(document.body.classList.contains('view-compare')){
    renderTabbar(CMP_KEY);
    renderCompareView();
    return;
  }
  if(currentStation && tabKeyOf(currentStation) === key) showMapView();
  else renderTabbar(
    currentStation && document.body.classList.contains('view-station') ? tabKeyOf(currentStation) : null
  );
}

async function ensureTable30(){
  if(!currentStation) return false;
  if(currentStation._table30) return true;
  setStatus('Carico gli ultimi 30 giorni…');
  try {
    const region = currentStation._region;
    const csv = await (await fdata(`${region}/series30/${currentStation.scode}.csv`,
                                   {cache:'no-store'})).text();
    currentStation._table30 = parseCSV(csv);
    setStatus('');
    return true;
  } catch(e){ setStatus('Serie a 30 giorni non ancora disponibile.'); return false; }
}

// Periodi (Oggi, 24 h, 3 g, 7 g) e, nel menu "Confronta", Confronto 7 giorni / 30 giorni / schede / Vicine.
// Un periodo chiude lo Storico e la Climatologia; la rosa segue il periodo.
async function pickMode(mode){
  if(mode === 'tabs'){ openCompareTab(); return; }
  if(histMode) exitHist();
  chartMode = mode;
  // la rosa non ha giorni da confrontare, la Climatologia nessun periodo: torna al grafico
  if(currentVar === WCLIMA || currentVar === WBIL || (isCompareMode() && currentVar === WROSE)){
    const first = stationVars.slice().sort(byVarOrder).find(v => isMainVar(v, stationVars));
    currentVar = stationVars.includes(chartVar) ? chartVar : (first || currentVar);
    extraVars = extraVars.filter(v => v !== currentVar);
    document.body.classList.remove('rose-mode', 'clima-mode');
  }
  if(mode === 'near' && !nearOk(currentVar)){
    const ok = rowVars();
    currentVar = ok.filter(v => isMainVar(v, ok)).sort(byVarOrder)[0] || ok[0] || currentVar;
  }
  syncModes();
  if(document.body.classList.contains('view-compare')){ renderCompareTabs(compareVar); return; }
  buildVarRow();
  if(!currentStation || !currentVar) return;
  if(chartMode === 'compare30' && !(await ensureTable30())) return;
  if(currentVar === WROSE) updateWindRose();
  else renderChart(currentVar);
  updateHash();
}
// periodo acceso (sottolineato); un confronto acceso accende "Confronta", che ne prende il nome
const CMP_LABEL = { compare:'Confronto 7 g', compare30:'Confronto 30 g', near:'Vicine' };
function syncModes(){
  const free = histMode || currentVar === WCLIMA || currentVar === WBIL;     // viste senza periodo
  document.querySelectorAll('#modes .mode[data-mode]').forEach(b => {
    const on = !free && b.dataset.mode === chartMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  el('cmpMenu').querySelectorAll('[role="menuitemradio"]').forEach(b => {
    b.classList.toggle('on', b.dataset.mode === chartMode);
    b.setAttribute('aria-checked', String(b.dataset.mode === chartMode));
  });
  const cmp = !free && CMP_LABEL[chartMode];
  el('cmpBtn').classList.toggle('active', !!cmp);
  el('cmpBtn').firstElementChild.textContent = cmp || 'Confronta';
  el('histbtn').classList.toggle('active', histMode);
  el('histbtn').setAttribute('aria-pressed', String(histMode));
}

// Menu sotto il comando: frecce, Inizio e Fine fra le voci; Esc e Tab chiudono tornando al comando; il clic
// fuori chiude.
function cmpOpen(){
  const m = el('cmpMenu');
  m.querySelector('[data-mode="near"]').hidden = !stationVars.some(nearOk);
  m.hidden = false;
  el('cmpBtn').setAttribute('aria-expanded', 'true');
  placeMenu(m, el('cmpBtn'));
  (m.querySelector('.on') || m.querySelector('button')).focus({ preventScroll:true });
}
function cmpClose(refocus){
  const m = el('cmpMenu');
  if(m.hidden) return;
  m.hidden = true;
  el('cmpBtn').setAttribute('aria-expanded', 'false');
  if(refocus) el('cmpBtn').focus({ preventScroll:true });
}
// La "i" della stazione: dove sta (se la fonte lo dice), rete, coordinate, codice, misure, ultimo dato
function stationCard(){
  const p = currentStation, rows = [];
  const prov = p.prov ? ' (' + p.prov + ')' : '';
  const town = p.comune ? prettyName(p.comune) + prov : p.prov ? 'provincia di ' + p.prov : '';
  const where = [town, p.quota != null ? p.quota + ' m' : ''].filter(Boolean).join(', ');
  if(where) rows.push(['Dove', where]);
  rows.push(['Rete', (SOURCES[p._region] || {}).name || p._region]);
  if(p._lat != null) rows.push(['Coordinate', p._lat.toFixed(3) + ' N, ' + p._lon.toFixed(3) + ' E']);
  rows.push(['Codice', p.scode]);
  const main = stationVars.filter(v => isMainVar(v, stationVars)).sort(byVarOrder)
                          .map(v => varShort(v).toLowerCase());
  if(main.length) rows.push(['Misure', main.join(', ')]);
  if(stLast != null){
    const d = new Date(stLast * 1000);
    rows.push(['Ultimo dato', pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + ' alle ' +
               pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes())]);
  }
  return '<h4>' + escHtml(prettyName(p.name || p.scode)) + '</h4><dl>' +
         rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + escHtml(v) + '</dd>').join('') + '</dl>';
}
function cardOpen(){
  if(!currentStation) return;
  el('stCard').innerHTML = stationCard();
  el('stCard').hidden = false;
  el('stInfo').setAttribute('aria-expanded', 'true');
}
function cardClose(){
  el('stCard').hidden = true;
  el('stInfo').setAttribute('aria-expanded', 'false');
}

// Esporta: i dati della vista mostrata (la serie, lo Storico, la Climatologia o le schede confrontate),
// l'immagine o il link
function expOpen(){
  const m = el('expMenu');
  m.hidden = false;
  el('expBtn').setAttribute('aria-expanded', 'true');
  placeMenu(m, el('expBtn'));
  m.querySelector('button').focus({ preventScroll:true });
}
function expClose(refocus){
  const m = el('expMenu');
  if(m.hidden) return;
  m.hidden = true;
  el('expBtn').setAttribute('aria-expanded', 'false');
  if(refocus) el('expBtn').focus({ preventScroll:true });
}
function exportData(){
  if(document.body.classList.contains('view-compare'))
    exportCompareCSV('confronto_schede_' + compareVar + '.csv');
  else if(chartMode === 'near' && chart && chart._near)
    exportCompareCSV(pngBase() + '_vicine_' + currentVar + '.csv');
  else if(histMode) exportHistCSV();
  else if(currentVar === WCLIMA) exportClimaCSV();
  else if(currentVar === WBIL) exportBilancioCSV();
  else if(currentStation){
    const p = currentStation, a = document.createElement('a');
    a.href = `${DATA_BASE}/${p._region}/${p.series}`;
    a.download = prettyName(p.name || p.scode).replace(/[^\w-]+/g, '_') + '_' + p._region + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
async function copyLink(){
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Link copiato');
  } catch(e){ toast('Link non copiato'); }
}

function menuNav(menu, close){
  menu.addEventListener('keydown', e => {
    const bs = [...menu.querySelectorAll('button:not([hidden])')], i = bs.indexOf(document.activeElement);
    if(e.key === 'Tab'){ close(true); if(e.shiftKey) e.preventDefault(); return; }
    const j = {
      ArrowDown:Math.min(i + 1, bs.length - 1), ArrowUp:Math.max(i - 1, 0), Home:0, End:bs.length - 1
    }[e.key];
    if(j == null) return;
    e.preventDefault();
    bs[j].focus({ preventScroll:true });
    bs[j].scrollIntoView({ block:'nearest' });
  });
}

// ---- link condivisibili: #REGIONE/CODICE/VARIABILE[/V:aggiunte | /S:impilate | /H:VAR:VISTA] ----
// Aggiornato a ogni scelta; all'apertura, se c'e', riporta alla stessa vista. Separatore '/': '|' non e'
// ammesso negli URL e i client di posta e chat spezzavano il link. I link con '|' o '%7C' si aprono ancora.
function updateHash(){
  if(!currentStation) return;
  const parts = [currentStation._region, currentStation.scode, currentVar || ''];
  if(histMode) parts.push('H:' + histVar + ':' + histView);
  else if(stacked()) parts.push('S:' + selVars().join(','));
  else if(extraVars.length && !isCompareMode()) parts.push('V:' + extraVars.join(','));
  const enc = p => encodeURIComponent(p).replace(/%3A/gi, ':').replace(/%2C/gi, ',');   // ':' e ',' leggibili
  history.replaceState(null, '', '#' + parts.map(enc).join('/'));
}
async function applyHash(){
  const parts = location.hash.slice(1).replace(/%7C/gi, '|').split(/[\/|]/).map(decodeURIComponent);
  if(parts.length < 2 || !parts[0]) return;
  const [reg, sc, v] = parts;
  // i link agli idrometri del Piemonte con regione PC_PIE aprono la stessa stazione in PIE
  const f = allFeatures.find(x => x.properties._region === reg && x.properties.scode === sc)
         || (reg === 'PC_PIE'
             ? allFeatures.find(x => x.properties._region === 'PIE' && x.properties.scode === sc)
             : null);
  if(!f) return;
  if(v && varCat(v) !== currentPage){
    currentPage = varCat(v);
    [...document.querySelectorAll('#pages .pg')]
      .forEach(x => x.classList.toggle('active', x.dataset.page === currentPage));
  }
  await selectStation(f.properties);
  if(v && stationVars.includes(v)) drawVar(v);
  const sp = parts[3];
  if(sp && sp.startsWith('S:')) setStackMode(true, sp.slice(2).split(',').filter(Boolean));
  else if(sp && sp.startsWith('V:')){                            // "V:UMID,PRESS" -> variabili aggiunte
    sp.slice(2).split(',').filter(x => x && !isView(x) && stationVars.includes(x) && x !== currentVar)
      .slice(0, maxVars() - 1).forEach(x => extraVars.push(x));
    buildVarRow();
    renderChart(currentVar);
    updateHash();
  } else if(sp && sp.startsWith('H:')){                            // "H:PREC:anni" -> Storico
    const [, hv, hw] = sp.split(':');
    await setHistMode(true, hv, ['mesi', 'anni', 'giorni', 'tabella'].includes(hw) ? hw : undefined);
  }
  syncPills();
}

let _rsT = null;
function buildStationControls(){
  window.addEventListener('resize', () => {
    clearTimeout(_rsT);           // ridisegna il grafico alla nuova taglia (evita canvas troppo alti)
    _rsT = setTimeout(() => {
      if(!currentStation || !currentVar || histMode || !document.body.classList.contains('view-station') ||
         document.body.classList.contains('view-compare')) return;
      if(currentVar === WROSE) updateWindRose();
      else if(currentVar === WCLIMA) renderClima();
      else renderChart(currentVar);
    }, 250);
  });
  el('refresh').addEventListener('click', refreshStation);
  el('stInfo').addEventListener('click', () => el('stCard').hidden ? cardOpen() : cardClose());
  el('expBtn').addEventListener('click', () => el('expMenu').hidden ? expOpen() : expClose());
  el('expMenu').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if(!b) return;
    expClose(true);
    ({ csv:exportData, png:exportPNG, link:copyLink })[b.dataset.act]();
  });
  el('tabMap').addEventListener('click', showMapView);
  document.querySelectorAll('#modes .mode[data-mode]')
    .forEach(b => b.addEventListener('click', () => pickMode(b.dataset.mode)));
  el('vars').addEventListener('click', e => {
    const b = e.target.closest('button');
    if(!b) return;
    if(b.id === 'altBtn'){ el('altMenu').hidden ? altOpen() : altClose(); return; }
    if(b.id === 'stackbtn'){ setStackMode(!stackMode); return; }
    const v = b.dataset.var;
    if(!v) return;
    if(document.body.classList.contains('view-compare')) pickCompareVar(v);
    else if(b.classList.contains('vp')) addVar(v);
    else drawVar(v);
  });
  el('altMenu').addEventListener('click', e => {
    const b = e.target.closest('[data-var]');
    if(!b) return;
    altClose();
    if(document.body.classList.contains('view-compare')) pickCompareVar(b.dataset.var);
    else drawVar(b.dataset.var);
    if(el('altBtn')) el('altBtn').focus({ preventScroll:true });
  });
  el('cmpBtn').addEventListener('click', () => el('cmpMenu').hidden ? cmpOpen() : cmpClose());
  el('cmpMenu').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if(b){ cmpClose(true); pickMode(b.dataset.mode); }
  });
  menuNav(el('cmpMenu'), cmpClose);
  menuNav(el('altMenu'), altClose);
  menuNav(el('expMenu'), expClose);
  document.addEventListener('click', e => {
    if(!e.target.closest('#cmpMenu, #cmpBtn')) cmpClose();
    if(!e.target.closest('#altMenu, #altBtn')) altClose();
    if(!e.target.closest('#expMenu, #expBtn')) expClose();
    if(!e.target.closest('#stCard, #stInfo')) cardClose();
  });
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    cmpClose(el('cmpMenu').contains(document.activeElement));
    altClose(el('altMenu').contains(document.activeElement));
    expClose(el('expMenu').contains(document.activeElement));
    if(!el('stCard').hidden){ cardClose(); el('stInfo').focus({ preventScroll:true }); }
  });
  // I menu sono fissi: non seguirebbero il comando se scorre il pannello
  el('panel').addEventListener('scroll', () => { cmpClose(); altClose(); expClose(); }, { passive:true });
  window.addEventListener('resize', () => {
    if(!el('cmpMenu').hidden) placeMenu(el('cmpMenu'), el('cmpBtn'));
    if(!el('altMenu').hidden && el('altBtn')) placeMenu(el('altMenu'), el('altBtn'));
    if(!el('expMenu').hidden) placeMenu(el('expMenu'), el('expBtn'));
  });
}
