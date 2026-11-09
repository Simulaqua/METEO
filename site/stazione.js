// stazione.js: la scheda della stazione (apertura, chip, modi e Confronti, Impilato, schede, link).
// Gli ascoltatori sono in buildStationControls(), chiamata dall'avvio (comune.js).

function resetPanel(){
  exitHist();
  el('stationName').textContent = 'Seleziona una stazione';
  el('stationMeta').textContent = '';
  el('vars').innerHTML = '';
  el('source').innerHTML = '';
  cmpClose();
  el('pact').hidden = true;
  el('pbar').hidden = true;
  document.body.classList.remove('rose-mode');
  el('windrose').innerHTML = '';
}
// nota oraria (senza icona), mostrata in coda alla riga della fonte
const TZNOTE = 'Orari in ora locale italiana (CET / CEST con ora legale).';

// ------------------------------------------------------------------------------------------------
// SELEZIONE STAZIONE -> SERIE
// ------------------------------------------------------------------------------------------------
// variabile con cui si apre una stazione, se la mappa non ne ha scelta una
const OPEN_ORDER = ['TEMP', 'PREC', 'LIVIDRO'];
// Accanto al nome: "234 · ultimo dato 14:30" se e' di oggi, se no "11/10 14:30" (l'anno solo se diverso).
// c = ora civile.
function setMeta(code, c){
  let when = '';
  if(c != null){
    const d = new Date(c * 1000), n = new Date(civT(Date.now() / 1000) * 1000),
          hm = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    when = d.toISOString().slice(0, 10) === n.toISOString().slice(0, 10) ? hm
         : pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) +
           (d.getUTCFullYear() === n.getUTCFullYear() ? '' : '/' + d.getUTCFullYear()) + ' ' + hm;
  }
  el('stationMeta').textContent = code + (when ? ' · ultimo dato ' + when : '');
}
async function selectStation(props){
  snapPause();                                   // il cursore del tempo si ferma
  closeSheet();                                  // il foglio basso (ricerca, link, schede) si chiude
  currentStation = props;
  selectedKey = props._region + '|' + props.scode;
  const region = props._region;
  openStationTab(props);                         // scheda nella tab bar + vista stazione
  if(props._lat != null) map.panTo([props._lat, props._lon]);
  currentUnits = unitsByRegion[region] || {};
  el('panel').scrollTop = 0;            // su telefono: la stazione si vede dall'inizio
  el('stationName').textContent = prettyName(props.name || props.scode);
  setMeta(props.scode, civSec(props.latest_time));
  const src = SOURCES[region];
  el('source').innerHTML = (src
    ? `Fonte: ${src.name} · <a href="${src.url}" target="_blank" rel="noopener">${src.url}</a> · `
    : '') + TZNOTE + ' Dati in tempo reale non validati.';
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

  const dl = el('download');
  dl.href = `${DATA_BASE}/${region}/${props.series}`;
  dl.download = prettyName(props.name || props.scode).replace(/[^\w-]+/g,'_') + '_' + region + '.csv';
  el('pact').hidden = false;
  el('pbar').hidden = false;

  // chip delle variabili: solo quelle della pagina attiva (dirette / derivate / indici)
  const allVars = ((props.variables && props.variables.length) ? props.variables
                : table.header.slice(1)).slice();
  if(windObsCount(table) >= 10) allVars.push(WROSE);   // chip "Rosa dei venti" fra le derivate
  const vars = allVars.filter(v => varCat(v) === currentPage).sort(natVars);
  currentVar2 = null;                     // nuova stazione: via la 2ª variabile di prima
  document.body.classList.remove('rose-mode');         // e si riparte dal grafico
  buildVarButtons(vars);
  updateClimaBox();                       // climatologia (solo pagina "indici")
  const hasHist = stationHistVars(props).length > 0;
  el('histbtn').style.display = 'none';   // "Storico": solo con pioggia/temperatura E storico pubblicato
  if(hasHist) histIndex().then(ix => {
    if(currentStation === props && ix && ix.regions && ix.regions[props._region])
      el('histbtn').style.display = '';
  });
  if(histMode && !hasHist) exitHist();
  if(histMode && hasHist){                // "Storico" resta attivo sulla nuova stazione
    if(!['PREC', 'TEMP'].includes(histVar) || !stationHistVars(props).includes(histVar))
      histVar = stationHistVars(props)[0];
    currentVar = histVar;
    syncVarButtons();
    renderHist();
  } else if(stackMode){                   // "Impilato" resta attivo: l'intersezione con la nuova stazione
    const eff = effectiveStack();
    if(eff.length){
      currentVar = eff[0];
      syncVarButtons();
      renderChart(currentVar);
    }
    else { exitStack(); clearChart(); }
  } else if(vars.length){
    // la variabile scelta sulla mappa; se no temperatura, poi pioggia, poi livello; se no la prima
    const pick = (filterVar && vars.includes(filterVar)) ? filterVar
               : (OPEN_ORDER.find(v => vars.includes(v)) || vars[0]);
    drawVar(pick);
  } else {
    clearChart();                         // questa stazione non ha variabili per la pagina attiva
  }
  setStatus('');

  el('stationFilter').value = selectedKey;
  buildVarFilter();
  renderMarkers();
  updateHash();
}

function buildVarButtons(vars){
  const box = el('vars');
  box.innerHTML = '';
  vars.forEach(v => {
    const b = document.createElement('button');
    b.dataset.var = v;
    if(v === WROSE){                        // pseudo-variabile: apre la rosa dei venti (niente 2ª variabile)
      b.classList.add('vrose');
      b.innerHTML = `<span class="vnm">🧭 ${varLabel(v)}</span>`;
      b.onclick = () => drawVar(WROSE);
    } else {
      // Clic sul nome: variabile principale (blu); sul '+': 2ª variabile (rossa, asse destro).
      // Niente unita' nel nome: e' gia' sull'asse Y, nei pannelli di "Impilato" e nell'etichetta del cursore.
      b.innerHTML = `<span class="vnm">${varLabel(v)}</span>`
                  + `<span class="vadd" title="Aggiungi come 2ª variabile (asse destro)">＋</span>`;
      b.onclick = (e) => {
        if(e.target.classList.contains('vadd')) toggleVar2(v);
        else if(stackMode) toggleStackVar(v);       // Impilato: la pillola aggiunge o toglie un pannello
        else drawVar(v);
      };
    }
    box.appendChild(b);
  });
  syncVarButtons();
}

// Evidenzia le pillole (principale blu, secondaria con bordo rosso); il '+' solo dove ha senso.
function syncVarButtons(){
  const compare = isCompareMode();
  [...el('vars').children].forEach(b => {
    const v = b.dataset.var;
    if(stackMode){                                  // Impilato: attive = variabili nella pila, niente '+'
      const si = effectiveStack().indexOf(v);
      b.classList.toggle('active', si >= 0);
      b.classList.remove('active2');
      // la pillola prende il colore della sua fascia
      b.style.background = si >= 0 ? STACK_COLORS[si % STACK_COLORS.length] : '';
      b.style.borderColor = si >= 0 ? STACK_COLORS[si % STACK_COLORS.length] : '';
      const ad = b.querySelector('.vadd');
      if(ad) ad.style.display = 'none';
      return;
    }
    b.style.background = '';                                 // fuori da Impilato: stile normale
    b.style.borderColor = '';
    b.classList.toggle('active',  v === currentVar);
    b.classList.toggle('active2', !compare && v === currentVar2);
    const add = b.querySelector('.vadd');
    // il '+' non serve nei confronti (una sola variabile) ne' sulla variabile gia' principale
    if(add) add.style.display = (compare || v === currentVar) ? 'none' : '';
  });
}

function drawVar(v){
  if(histMode){
    if(v === 'PREC' || v === 'TEMP'){
      currentVar = v;
      histVar = v;
      syncVarButtons();
      renderHist();
      return;
    }
    exitHist();                               // altra variabile: si torna al grafico normale
  }
  if(v === WROSE && stackMode) exitStack();   // la rosa sostituisce il grafico: si esce da "Impilato"
  currentVar = v;
  if(stackMode){                               // Impilato: la variabile entra nella pila (max STACK_MAX)
    currentVar2 = null;
    const cur = effectiveStack();
    if(!cur.includes(v)){
      cur.push(v);
      if(cur.length > STACK_MAX) cur.shift();
    }
    stackVars = cur;
  } else if(currentVar2 === v) currentVar2 = null;   // principale e secondaria non possono coincidere
  syncVarButtons();
  if(v === WROSE){                                   // la rosa prende il posto del grafico
    document.body.classList.add('rose-mode');
    updateWindRose();
  }
  else {
    document.body.classList.remove('rose-mode');
    renderChart(v);
  }
  if(currentStation) updateHash();
}

// ---- climatologia (pagina "indici"): riassunto da <REGIONE>/climate.json ----
const _climaCache = {};
async function loadClimate(region){
  if(region in _climaCache) return _climaCache[region];
  try {
    _climaCache[region] = await (await fdata(`${region}/climate.json`, {cache:'no-store'})).json();
  }
  catch(e){ _climaCache[region] = null; }
  return _climaCache[region];
}
const _fmtMon = s => s ? s.substr(4,2) + '/' + s.substr(0,4) : '';
const _fmtDay = s => s ? s.substr(6,2) + '/' + s.substr(4,2) + '/' + s.substr(0,4) : '';
async function updateClimaBox(){
  const box = el('climabox');
  if(currentPage !== 'indici' || !currentStation){
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = '<div class="hint">Carico la climatologia…</div>';
  const clima = await loadClimate(currentStation._region);
  if(!currentStation){ return; }
  const e = clima && clima[currentStation.scode];
  if(!e){
    box.innerHTML = '<div class="hint">Climatologia non disponibile per questa stazione.</div>';
    return;
  }
  const MESI = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
  let rows = '';
  const mon = e.monthly || {};
  for(let m=1;m<=12;m++){
    const d = mon[String(m).padStart(2,'0')];
    if(!d) continue;
    rows += `<tr><td>${MESI[m-1]}</td><td>${d.tmin??'–'}</td><td>${d.tmax??'–'}</td><td>${d.tmean??'–'}</td><td>${d.prec??'–'}</td></tr>`;
  }
  let html = `<h4>Climatologia — ${_fmtMon(e.period.from)}–${_fmtMon(e.period.to)} · ${e.period.days} giorni</h4>`;
  if(rows) html += `<table><tr><th>Mese</th><th>T min</th><th>T max</th><th>T media</th><th>Pioggia</th></tr>${rows}</table>`;
  const r = e.records || {}, rb = [];
  if(r.tmax) rb.push(`T max ${r.tmax.val} °C (${_fmtDay(r.tmax.date)})`);
  if(r.tmin) rb.push(`T min ${r.tmin.val} °C (${_fmtDay(r.tmin.date)})`);
  if(r.prec_day) rb.push(`pioggia/g ${r.prec_day.val} mm (${_fmtDay(r.prec_day.date)})`);
  if(rb.length) html += `<div class="rec"><b>Record:</b> ${rb.join(' · ')}</div>`;
  const ix = e.indices || {}, IXL = {
    frost_days:'gelo', ice_days:'ghiaccio', summer_days:'estivi',
    hot_days:'caldi (>30°)', tropical_nights:'notti tropicali', rainy_days:'piovosi'
  };
  const ib = Object.keys(IXL).filter(k => ix[k] != null).map(k => `${IXL[k]} ${ix[k]}`);
  if(ib.length) html += `<div class="rec"><b>Giorni/anno:</b> ${ib.join(' · ')}</div>`;
  box.innerHTML = html;
}

// aggiunge o toglie la 2ª variabile (linea rossa, asse destro); solo nei modi a variabile singola
function toggleVar2(v){
  if(isCompareMode() || v === currentVar) return;
  currentVar2 = (currentVar2 === v) ? null : v;
  syncVarButtons();
  renderChart(currentVar);
}

// scarica le serie mancanti delle schede aperte, per il confronto fra schede
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

// ricarica i dati della stazione aperta e ridisegna il grafico
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
    const vars = t.header.slice(1);
    if(currentVar === WROSE) updateWindRose();                       // resta sulla rosa, con i dati freschi
    else drawVar(vars.includes(currentVar) ? currentVar : vars[0]);
    // Ultimo dato MISURATO: salta le righe con sole derivate/indici (GDD/ET0 alle 12:00 solari, la mattina
    // sono "nel futuro").
    let lastX = null;
    for(let i = t.x.length - 1; i >= 0 && lastX == null; i--){
      for(const v of t.header.slice(1)){
        if(varCat(v) === 'dirette' && t.cols[v][i] != null){ lastX = t.x[i]; break; }
      }
    }
    setMeta(currentStation.scode, lastX ? civT(lastX) : null);
  } catch(e){ setStatus('Aggiornamento non riuscito.'); }
  btn.innerHTML = icon;
  btn.disabled = false;
}

// ---- modo "Impilato" ----
let stackMode = false, stackVars = [], stackObj = null;
// variabili "compagne" proposte attivando Impilato con una sola variabile (max 3 pannelli iniziali)
const STACK_COMPANIONS = {
  TEMP:['UMID','PRESS'], UMID:['TEMP','PRESS'], PRESS:['TEMP','UMID'], RADSOL:['TEMP','UMID'],
  PREC:['LIVIDRO','PORTATA','TEMP'], LIVIDRO:['PREC','PORTATA'], PORTATA:['LIVIDRO','PREC'],
  VVENTO:['VVENTOMAX','TEMP'], VVENTOMAX:['VVENTO','TEMP'],
  LIVLAGO:['AFFLUSSO','DEFLUSSO'], AFFLUSSO:['LIVLAGO','DEFLUSSO'], DEFLUSSO:['LIVLAGO','AFFLUSSO'],
  MAREA:['ONDE','VVENTO','PRESS'], ONDE:['MAREA','VVENTO'],
  PM10:['PM25','NO2','O3'], PM25:['PM10','NO2'], NO2:['O3','PM10'], O3:['NO2','PM10']
};
// variabili della stazione aperta (tutte le pagine, senza la rosa dei venti)
function stationVarsAll(){
  if(!currentStation) return [];
  const t = currentStation._table;
  const base = (currentStation.variables && currentStation.variables.length)
    ? currentStation.variables
    : (t ? t.header.slice(1) : []);
  return base.filter(v => v !== WROSE && (!t || t.cols[v]));
}
// Pila effettiva = scelta dell'utente (stackVars) ∩ variabili della stazione aperta; se vuota, una sola
// variabile. Cambiando stazione la scelta non viene toccata: tornando su una stazione completa riappare.
function effectiveStack(){
  const avail = stationVarsAll();
  let v = stackVars.filter(x => avail.includes(x));
  if(!v.length && avail.length) v = [(currentVar && avail.includes(currentVar)) ? currentVar : avail[0]];
  return v;
}
function stackSuggest(v){
  const avail = stationVarsAll(), out = [v];
  (STACK_COMPANIONS[v] || []).filter(x => avail.includes(x)).forEach(x => {
    if(out.length < 3) out.push(x);
  });
  if(out.length < 2) avail.forEach(x => {
    if(out.length < 3 && !out.includes(x) && varCat(x) === varCat(v)) out.push(x);
  });
  return out;
}
function exitStack(){               // spegne il modo senza ridisegnare (lo fa chi chiama)
  if(!stackMode) return;
  stackMode = false;
  document.body.classList.remove('stacked');
  const b = el('stackbtn');
  b.classList.remove('active');
  b.setAttribute('aria-pressed', 'false');
  if(stackObj){ stackObj.destroy(); stackObj = null; }
}
function setStackMode(on, vars){
  if(on){
    if(!currentStation || !currentVar) return;
    if(isCompareMode()){                          // il confronto non ha senso a fasce: torna ai 7 giorni
      chartMode = 'week';
      syncModes();
    }
    document.body.classList.remove('rose-mode');
    const avail = stationVarsAll();
    const first = (currentVar && currentVar !== WROSE && avail.includes(currentVar)) ? currentVar : avail[0];
    if(!first) return;
    if(vars && vars.length) stackVars = vars.filter(v => avail.includes(v)).slice(0, STACK_MAX);
    else {
      stackVars = [first];
      if(currentVar2 && currentVar2 !== first && avail.includes(currentVar2)) stackVars.push(currentVar2);
      if(stackVars.length < 2) stackVars = stackSuggest(first);
    }
    if(!stackVars.length) stackVars = [first];
    currentVar = stackVars[0];
    currentVar2 = null;
    stackMode = true;
    document.body.classList.add('stacked');
    const b = el('stackbtn');
    b.classList.add('active');
    b.setAttribute('aria-pressed', 'true');
  } else exitStack();
  syncVarButtons();
  if(currentStation && currentVar) renderChart(currentVar);
  updateHash();
}
function toggleStackVar(v){
  if(v === WROSE){ drawVar(WROSE); return; }
  const cur = effectiveStack(), i = cur.indexOf(v);
  if(i >= 0){
    if(cur.length === 1){ toast('Almeno una fascia'); return; }
    cur.splice(i, 1);
  } else {
    if(cur.length >= STACK_MAX){ toast('Massimo ' + STACK_MAX + ' fasce'); return; }
    cur.push(v);
  }
  stackVars = cur;                                  // la scelta fatta qui diventa la nuova preferenza
  currentVar = stackVars[0];
  syncVarButtons();
  renderChart(currentVar);
  updateHash();
}
function renderStackView(){
  el('chartstats').textContent = '';
  el('chartlegend').innerHTML = '';
  const t = currentStation && currentStation._table;
  if(!t) return;
  const vars = effectiveStack().filter(v => t.cols[v]);
  if(!vars.length){
    el('chart').innerHTML = '<div class="stk-note">Nessuna variabile disponibile.</div>';
    return;
  }
  stackObj = createStack(el('chart'), {
    station: currentStation, table: t, vars, mode: chartMode, onRemove: v => toggleStackVar(v)
  });
}

// ---- barra delle schede: [Mappa] + una scheda per ogni stazione aperta ----
let openTabs = [];                     // [{key, props}] in ordine di apertura
const MAX_TABS = 8;
const tabKeyOf = p => p._region + '|' + p.scode;
function openStationTab(props){
  const key = tabKeyOf(props);
  const t = openTabs.find(x => x.key === key);
  if(t) t.props = props;                            // riferimento nuovo dopo il ricaricamento delle regioni
  else {
    openTabs.push({key, props});
    if(openTabs.length > MAX_TABS) openTabs.shift();  // oltre il limite chiude la piu' vecchia
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
// vista della scheda Confronto: variabili = unione delle schede aperte, una curva per stazione
async function renderCompareView(){
  exitHist();
  exitStack();                                    // il confronto fra schede e' a variabile singola
  document.body.classList.add('view-station', 'view-compare');
  document.body.classList.remove('rose-mode');
  el('panel').scrollTop = 0;
  el('stationName').textContent = 'Confronto schede';
  el('stationMeta').textContent = openTabs.length
    ? openTabs.map(t => prettyName(t.props.name || t.props.scode)).join('  ·  ')
    : 'Nessuna scheda aperta';
  el('source').innerHTML = TZNOTE + ' Dati in tempo reale non validati.';
  el('pact').hidden = false;
  el('pbar').hidden = false;
  el('windrose').innerHTML = '';
  const cbx = el('climabox');
  cbx.style.display = 'none';
  cbx.innerHTML = '';
  el('chartstats').textContent = '';
  history.replaceState(null, '', '#confronto');
  await ensureTabTables();
  const set = new Set();
  openTabs.forEach(t => (t.props.variables || []).forEach(v => {
    if(v !== WROSE) set.add(v);
  }));
  const vars = [...set].sort((a,b) => natLabel(varLabel(a), varLabel(b)));
  if(!compareVar || !set.has(compareVar)) compareVar = set.has(currentVar) ? currentVar : vars[0];
  const box = el('vars');
  box.innerHTML = '';
  vars.forEach(v => {
    const b = document.createElement('button');
    b.dataset.var = v;
    b.innerHTML = '<span class="vnm">' + varLabel(v) + '</span>';
    b.classList.toggle('active', v === compareVar);
    b.onclick = () => {
      compareVar = v;
      [...box.children].forEach(x => x.classList.toggle('active', x.dataset.var === v));
      renderCompareTabs(v);
    };
    box.appendChild(b);
  });
  if(['compare','compare30','tabs'].indexOf(chartMode) >= 0) chartMode = 'week';
  syncModes();
  if(compareVar) renderCompareTabs(compareVar); else clearChart();
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

// carica su richiesta la serie a 30 giorni (series30/) per il "Confronto 30 giorni" e la tiene in cache
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

// modi grafico: 7 g / 3 g / 24 h e, nel menu "Confronti", Confronto 7 giorni / 30 giorni / schede
async function pickMode(mode){
  if(mode === 'tabs'){ openCompareTab(); return; }   // scheda dedicata, non un modo
  chartMode = mode;
  syncModes();
  if(document.body.classList.contains('view-compare')){ renderCompareTabs(compareVar); return; }
  if(chartMode === 'compare' || chartMode === 'compare30') exitStack();   // confronti: variabile singola
  syncVarButtons();                        // nasconde il '+' nei confronti, lo mostra nei modi singoli
  if(!currentStation || !currentVar) return;
  if(chartMode === 'compare30'){
    const ok = await ensureTable30();
    if(!ok) return;
  }
  renderChart(currentVar);
}
// un confronto acceso accende "Confronti", che ne prende il nome, e la sua voce nel menu
const CMP_LABEL = { compare:'Confronto 7 g', compare30:'Confronto 30 g' };
function syncModes(){
  document.querySelectorAll('#modes .mode[data-mode]')
    .forEach(b => b.classList.toggle('active', b.dataset.mode === chartMode));
  el('cmpMenu').querySelectorAll('[role="menuitemradio"]').forEach(b => {
    b.classList.toggle('on', b.dataset.mode === chartMode);
    b.setAttribute('aria-checked', String(b.dataset.mode === chartMode));
  });
  el('cmpBtn').classList.toggle('active', !!CMP_LABEL[chartMode]);
  el('cmpBtn').firstElementChild.textContent = CMP_LABEL[chartMode] || 'Confronti';
}

// "Confronti ▾": menu sotto il pulsante; frecce, Inizio e Fine fra le voci; Esc e Tab chiudono tornando
// al pulsante; il clic fuori chiude.
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

// ---- link condivisibili: #REGIONE/CODICE/VARIABILE ----
// Aggiornato a ogni selezione; all'apertura, se c'e', riporta alla stessa vista. Separatore '/': '|' non e'
// ammesso negli URL e i client di posta e chat spezzavano il link. I link con '|' o '%7C' si aprono ancora.
function updateHash(){
  if(!currentStation) return;
  const parts = [currentStation._region, currentStation.scode, currentVar || ''];
  if(stackMode) parts.push('S:' + effectiveStack().join(','));  // 4a parte: variabili della pila
  else if(histMode) parts.push('H:' + histVar + ':' + histView);   // 4a parte: storico (variabile e vista)
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
  if(v){
    const btn = [...el('vars').children].find(b => b.dataset.var === v);
    if(btn) drawVar(v);
  }
  const sp = parts[3];                                           // "S:TEMP,UMID,PRESS" -> modo Impilato
  if(sp && sp.startsWith('S:')) setStackMode(true, sp.slice(2).split(',').filter(Boolean));
  else if(sp && sp.startsWith('H:')){                              // "H:PREC:anni" -> storico lungo
    const [, hv, hw] = sp.split(':');
    await setHistMode(true, hv, ['mesi', 'anni', 'giorni', 'tabella'].includes(hw) ? hw : undefined);
  }
  syncPills();                                                   // il link puo' cambiare la pagina
}

let _rsT = null;
function buildStationControls(){
  window.addEventListener('resize', () => {
    clearTimeout(_rsT);           // ridisegna il grafico alla nuova taglia (evita canvas troppo alti)
    _rsT = setTimeout(() => {
      if(currentStation && document.body.classList.contains('view-station') &&
         currentVar && currentVar !== WROSE)
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
  el('cmpBtn').addEventListener('click', () => el('cmpMenu').hidden ? cmpOpen() : cmpClose());
  el('cmpMenu').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if(b){ cmpClose(true); pickMode(b.dataset.mode); }
  });
  el('cmpMenu').addEventListener('keydown', e => {
    const bs = [...el('cmpMenu').querySelectorAll('button')], i = bs.indexOf(document.activeElement);
    if(e.key === 'Tab'){ cmpClose(true); if(e.shiftKey) e.preventDefault(); return; }
    const j = {
      ArrowDown:Math.min(i + 1, bs.length - 1), ArrowUp:Math.max(i - 1, 0), Home:0, End:bs.length - 1
    }[e.key];
    if(j == null) return;
    e.preventDefault();
    bs[j].focus({ preventScroll:true });
  });
  document.addEventListener('click', e => { if(!e.target.closest('#cmpMenu, #cmpBtn')) cmpClose(); });
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape') cmpClose(el('cmpMenu').contains(document.activeElement));
  });
  // Il menu e' fisso: non seguirebbe il pulsante se scorre il pannello o (telefono) la riga 2.
  // 'scroll' non risale ai genitori, quindi un ascoltatore per ciascuno.
  ['panel', 'pbar'].forEach(id => el(id).addEventListener('scroll', () => cmpClose(), { passive:true }));
  window.addEventListener('resize', () => {
    if(!el('cmpMenu').hidden) placeMenu(el('cmpMenu'), el('cmpBtn'));
  });
  el('stackbtn').addEventListener('click', () => setStackMode(!stackMode));
}
