// stazione.js: la scheda della stazione (apertura, riga delle variabili con "+" e "Altro", periodi e
// Confronta, Impilate, schede, link). Gli ascoltatori sono in buildStationControls(), chiamata dall'avvio
// (comune.js).

function resetPanel(){
  exitHist();
  el('stationName').textContent = 'Seleziona una stazione';
  el('stationName').title = '';
  el('stationMeta').textContent = '';
  el('vars').innerHTML = '';
  el('source').innerHTML = '';
  cmpClose();
  altClose();
  el('pact').hidden = el('ptools').hidden = el('pbar').hidden = true;
  document.body.classList.remove('rose-mode');
  el('windrose').innerHTML = '';
}
const TZNOTE = 'Ora italiana, dati non validati.';

// variabile con cui si apre una stazione, se la mappa non ne ha scelta una
const OPEN_ORDER = ['TEMP', 'PREC', 'LIVIDRO'];
// tutte le variabili della stazione aperta, con le pseudo-variabili del vento
let stationVars = [];
// ultima variabile a grafico: ci si torna lasciando la rosa
let chartVar = null;
const selVars = () => [currentVar].concat(extraVars).filter(Boolean);
const maxVars = () => PHONE.matches ? 3 : 5;

// Codice e ultimo dato nel titolo del nome; accanto, solo se i dati sono fermi: oltre STALE_HOURS ore o tre
// passi della serie (i dati giornalieri, come le polveri, non sono fermi dopo 3 ore). c = ora civile.
function setMeta(code, c, table){
  let when = '', stale = false;
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
async function selectStation(props){
  snapPause();
  closeSheet();
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
    } catch(e){ setStatus('Serie non disponibile (' + e + ')'); return; }
    table = parseCSV(csv);                // {header:[datetime,VAR,...], cols:{name:[...]}, x:[epoch]}
    props._table = table;
    props._tableAt = Date.now();
  }

  setMeta(props.scode, civSec(props.latest_time), table);
  const dl = el('download');
  dl.href = `${DATA_BASE}/${region}/${props.series}`;
  dl.download = prettyName(props.name || props.scode).replace(/[^\w-]+/g,'_') + '_' + region + '.csv';
  el('pact').hidden = el('ptools').hidden = el('pbar').hidden = false;

  stationVars = ((props.variables && props.variables.length) ? props.variables : table.header.slice(1))
    .slice();
  if(windObsCount(table) >= 10) stationVars.push(WARROW, WROSE);
  extraVars = [];
  document.body.classList.remove('rose-mode');
  const hasHist = stationHistVars(props).length > 0;
  el('histbtn').style.display = 'none';   // "Storico": solo con pioggia/temperatura E storico pubblicato
  if(hasHist) histIndex().then(ix => {
    if(currentStation === props && ix && ix.regions && ix.regions[props._region])
      el('histbtn').style.display = '';
  });
  if(histMode && !hasHist) exitHist();
  // Impilate resta acceso cambiando stazione, con le variabili di prima che questa ha
  const keep = prevSel.filter(v => v !== WROSE && stationVars.includes(v));
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
function fillVarRow(){
  const box = el('vars'), all = stationVars, cmp = isCompareMode();
  const sel = cmp ? [currentVar] : selVars();
  const main = all.filter(v => isMainVar(v, all)).sort(byVarOrder);
  const shown = main.concat(sel.filter(v => v && all.includes(v) && !main.includes(v)).sort(byVarOrder));
  const plus = !cmp && !histMode && currentVar !== WROSE;
  box.innerHTML = '';
  shown.forEach(v => box.appendChild(varItem(v, sel.includes(v), plus && v !== currentVar && v !== WROSE)));
  if(all.some(v => !isMainVar(v, all)))
    box.appendChild(rowButton('altBtn', 'Altro',
      { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'altMenu' }));
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
  if(v !== WROSE) chartVar = v;
  document.body.classList.toggle('rose-mode', v === WROSE);
  buildVarRow();
  if(v === WROSE) updateWindRose();
  else renderChart(v);
  if(currentStation) updateHash();
}
// "+": aggiunge la variabile al grafico (asse a destra, del suo colore); "×" la toglie
function addVar(v){
  if(v === WROSE || isCompareMode() || histMode || !currentStation) return;
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

// "Altro": misure secondarie, derivate, indici (e la rosa), in tre gruppi
function altOpen(){
  const m = el('altMenu'), b = el('altBtn');
  if(!b) return;
  const rest = stationVars.filter(v => !isMainVar(v, stationVars)).sort(byVarOrder), sel = selVars();
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

async function ensureTabTables(){
  for(const t of openTabs){
    if(t.props._table) continue;
    try {
      const csv = await (await fdata(`${t.props._region}/${t.props.series}`)).text();
      t.props._table = parseCSV(csv);
      t.props._tableAt = Date.now();
    } catch(e){}
  }
}

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
    if(currentVar === WROSE) updateWindRose();
    else if(currentVar && (currentVar === WARROW || t.cols[currentVar])) renderChart(currentVar);
    else drawVar(t.header[1]);
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
const stacked = () => stackMode && selVars().length >= 2 && !isCompareMode() && currentVar !== WROSE;
function exitStack(){
  if(!stackMode) return;
  stackMode = false;
  document.body.classList.remove('stacked');
  if(stackObj){ stackObj.destroy(); stackObj = null; }
}
function setStackMode(on, vars){
  if(on){
    if(!currentStation) return;
    const ok = (vars || []).filter(v => v !== WROSE && stationVars.includes(v));
    if(ok.length >= 2){
      currentVar = chartVar = ok[0];
      extraVars = ok.slice(1, maxVars());
    }
    if(isCompareMode()){                          // il confronto non ha senso a fasce: torna ai 7 giorni
      chartMode = 'week';
      syncModes();
    }
    document.body.classList.remove('rose-mode');
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
// riga della scheda Confronto: le variabili delle schede aperte, una alla volta
let compareVars = [];
function buildCompareRow(){
  const box = el('vars');
  keepFocus(box, () => {
    box.innerHTML = '';
    compareVars.forEach(v => box.appendChild(varItem(v, v === compareVar, false)));
  });
}
// vista della scheda Confronto: variabili = unione delle schede aperte, una curva per stazione
async function renderCompareView(){
  exitHist();
  exitStack();
  altClose();
  document.body.classList.add('view-station', 'view-compare');
  document.body.classList.remove('rose-mode');
  el('panel').scrollTop = 0;
  el('stationName').textContent = 'Confronto schede';
  el('stationName').title = '';
  el('stationMeta').textContent = openTabs.length ? '' : 'nessuna scheda aperta';
  el('source').innerHTML = TZNOTE;
  el('pact').hidden = el('ptools').hidden = el('pbar').hidden = false;
  el('windrose').innerHTML = '';
  history.replaceState(null, '', '#confronto');
  await ensureTabTables();
  const set = new Set();
  openTabs.forEach(t => (t.props.variables || []).forEach(v => {
    if(v !== WROSE && v !== WARROW) set.add(v);
  }));
  compareVars = [...set].sort(byVarOrder);
  if(!compareVar || !set.has(compareVar)) compareVar = set.has(currentVar) ? currentVar : compareVars[0];
  buildCompareRow();
  if(['compare','compare30','tabs'].indexOf(chartMode) >= 0) chartMode = 'week';
  syncModes();
  if(compareVar) renderCompareTabs(compareVar); else clearChart();
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

// Periodi (Oggi, 24 h, 3 g, 7 g) e, nel menu "Confronta", Confronto 7 giorni / 30 giorni / schede.
// Un periodo chiude lo Storico; la rosa segue il periodo.
async function pickMode(mode){
  if(mode === 'tabs'){ openCompareTab(); return; }
  if(histMode) exitHist();
  chartMode = mode;
  if(isCompareMode() && currentVar === WROSE){       // la rosa non ha giorni da confrontare: torna al grafico
    const first = stationVars.slice().sort(byVarOrder).find(v => isMainVar(v, stationVars));
    currentVar = stationVars.includes(chartVar) ? chartVar : (first || currentVar);
    extraVars = extraVars.filter(v => v !== currentVar);
    document.body.classList.remove('rose-mode');
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
const CMP_LABEL = { compare:'Confronto 7 g', compare30:'Confronto 30 g' };
function syncModes(){
  document.querySelectorAll('#modes .mode[data-mode]').forEach(b => {
    const on = !histMode && b.dataset.mode === chartMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  el('cmpMenu').querySelectorAll('[role="menuitemradio"]').forEach(b => {
    b.classList.toggle('on', b.dataset.mode === chartMode);
    b.setAttribute('aria-checked', String(b.dataset.mode === chartMode));
  });
  const cmp = !histMode && CMP_LABEL[chartMode];
  el('cmpBtn').classList.toggle('active', !!cmp);
  el('cmpBtn').firstElementChild.textContent = cmp || 'Confronta';
  el('histbtn').classList.toggle('active', histMode);
  el('histbtn').setAttribute('aria-pressed', String(histMode));
}

// Menu sotto il comando: frecce, Inizio e Fine fra le voci; Esc e Tab chiudono tornando al comando; il clic
// fuori chiude.
function cmpOpen(){
  const m = el('cmpMenu');
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
function menuNav(menu, close){
  menu.addEventListener('keydown', e => {
    const bs = [...menu.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
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
    sp.slice(2).split(',').filter(x => x && x !== WROSE && stationVars.includes(x) && x !== currentVar)
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
      if(currentStation && document.body.classList.contains('view-station') &&
         !document.body.classList.contains('view-compare') && currentVar && currentVar !== WROSE && !histMode)
        renderChart(currentVar);
    }, 250);
  });
  el('refresh').addEventListener('click', refreshStation);
  el('copylink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); } catch(e){}
    const b = el('copylink');
    b.textContent = 'copiato ✓';
    setTimeout(() => { b.textContent = 'Link'; }, 1500);
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
    drawVar(b.dataset.var);
    if(el('altBtn')) el('altBtn').focus({ preventScroll:true });
  });
  el('cmpBtn').addEventListener('click', () => el('cmpMenu').hidden ? cmpOpen() : cmpClose());
  el('cmpMenu').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if(b){ cmpClose(true); pickMode(b.dataset.mode); }
  });
  menuNav(el('cmpMenu'), cmpClose);
  menuNav(el('altMenu'), altClose);
  document.addEventListener('click', e => {
    if(!e.target.closest('#cmpMenu, #cmpBtn')) cmpClose();
    if(!e.target.closest('#altMenu, #altBtn')) altClose();
  });
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    cmpClose(el('cmpMenu').contains(document.activeElement));
    altClose(el('altMenu').contains(document.activeElement));
  });
  // I menu sono fissi: non seguirebbero il comando se scorre il pannello
  el('panel').addEventListener('scroll', () => { cmpClose(); altClose(); }, { passive:true });
  window.addEventListener('resize', () => {
    if(!el('cmpMenu').hidden) placeMenu(el('cmpMenu'), el('cmpBtn'));
    if(!el('altMenu').hidden && el('altBtn')) placeMenu(el('altMenu'), el('altBtn'));
  });
}
