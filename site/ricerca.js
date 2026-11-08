// ricerca.js: la barra in alto (filtri a cascata, pillole e menu, ricerca delle stazioni, Note e Tema).
// Gli ascoltatori sono in buildSearchControls(), chiamata dall'avvio (comune.js).

// ------------------------------------------------------------------------------------------------
// FILTRI A CASCATA (regione -> stazione -> variabile)
// ------------------------------------------------------------------------------------------------
const featKey  = f => f.properties._region + '|' + f.properties.scode;
const featName = f => prettyName(f.properties.name || f.properties.scode);
const selectedFeature = () => selectedKey ? allFeatures.find(f => featKey(f) === selectedKey) : null;

// stazioni da mostrare in elenco/mappa: filtrate per variabile (se selezionata)
function stationsForList(){
  return allFeatures.filter(f => {
    const vars = f.properties.variables || [];
    let ok = vars.some(v => varCat(v) === currentPage);            // stazioni con variabili della pagina attiva
    if(!ok && currentPage === 'indici')                           // pagina indici: includi anche chi ha climatologia
      ok = vars.includes('TEMP') || vars.includes('PREC');
    if(!ok) return false;
    return !filterVar || vars.includes(filterVar);
  });
}

function refreshFilters(){
  // valida il filtro variabile contro l'insieme globale
  const allVars = new Set();
  allFeatures.forEach(f => (f.properties.variables || []).forEach(v => allVars.add(v)));
  if(filterVar && !allVars.has(filterVar)) filterVar = '';
  buildStationFilter();
  buildVarFilter();
}

// elenco stazioni: se c'è una variabile selezionata solo quelle con quella variabile; ordine alfabetico
function buildStationFilter(){
  const list = stationsForList().slice().sort((a,b) => featName(a).localeCompare(featName(b)));
  const sel = el('stationFilter');
  sel.innerHTML = '<option value="">Tutte le stazioni</option>';
  list.forEach(f => {
    const o = document.createElement('option'); o.value = featKey(f); o.textContent = featName(f); sel.appendChild(o);
  });
  sel.value = (selectedKey && list.some(f => featKey(f) === selectedKey)) ? selectedKey : '';
}

// elenco variabili: se c'è una stazione selezionata solo le sue; altrimenti l'unione delle stazioni in elenco
function buildVarFilter(){
  const set = new Set();
  const sf = selectedFeature();
  const add = v => { if(varCat(v) === currentPage) set.add(v); };   // solo variabili della pagina attiva
  if(sf) (sf.properties.variables || []).forEach(add);
  else stationsForList().forEach(f => (f.properties.variables || []).forEach(add));
  const sel = el('varFilter');
  sel.innerHTML = '<option value="">Tutte le variabili</option>';
  [...set].sort((a,b) => natLabel(varLabel(a), varLabel(b))).forEach(v => {
    const o = document.createElement('option'); o.value = v; o.textContent = varLabel(v); sel.appendChild(o);
  });
  if(filterVar && !set.has(filterVar)) filterVar = '';
  sel.value = filterVar;
}

function _syncThemeBtn(){ el('themeBtn').textContent = document.body.classList.contains('dark') ? 'Tema chiaro' : 'Tema scuro'; }

// ---- PILLOLE della barra in alto: menu costruiti dalle tendine nascoste (#pages, #region, #varFilter) -----------
// La scelta passa dalle tendine (click/change come prima), cosi' la logica dei filtri resta una sola.
let menuAnchor = null;                                   // pillola del menu aperto
// minuscole, senza accenti, punteggiatura -> spazio (filtri dei menu e ricerca delle stazioni)
function normTxt(s){
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
         .replace(/[^a-z0-9]+/g, ' ').trim();
}
// sotto la pillola e dentro lo schermo; sul telefono largo quanto lo schermo meno 16 px
function placeMenu(m, anchor){
  const r = anchor.getBoundingClientRect(), top = Math.round(r.bottom + 6);
  m.style.top = top + 'px';
  m.style.maxHeight = Math.max(120, innerHeight - top - 16) + 'px';
  if(PHONE.matches){ m.style.left = '8px'; m.style.right = '8px'; return; }
  m.style.right = 'auto';
  m.style.left = Math.round(Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))) + 'px';
}
function openMenu(anchor, items, onPick, opts){
  closeMenu(); closeProdMenu();
  const m = el('pillMenu'), list = document.createElement('div');
  m.innerHTML = ''; list.className = 'pm-list';
  items.forEach(it => {
    const b = document.createElement('button');
    b.dataset.v = it.v; b.textContent = it.label; b.tabIndex = -1;     // voci con le frecce, Tab esce dal menu
    b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', String(!!it.on));
    if(it.on) b.className = 'on';
    b.addEventListener('click', () => { const a = menuAnchor; closeMenu(); if(a) a.focus(); onPick(it.v); });   // il fuoco torna sulla pillola
    list.appendChild(b);
  });
  if(opts && opts.filter){                               // elenco lungo: campo per filtrare le voci
    const f = document.createElement('input');
    f.className = 'pm-filter'; f.type = 'text'; f.placeholder = 'Filtra…'; f.autocomplete = 'off'; f.spellcheck = false;
    f.setAttribute('aria-label', 'Filtra le voci');
    f.addEventListener('input', () => {
      const q = normTxt(f.value);
      [...list.children].forEach(b => { b.hidden = !!q && !normTxt(b.textContent).includes(q); });
    });
    m.appendChild(f);
  }
  m.appendChild(list);
  m.hidden = false; menuAnchor = anchor; anchor.setAttribute('aria-expanded', 'true');
  placeMenu(m, anchor);
  const cur = list.querySelector('.on') || list.firstElementChild;
  if(opts && opts.filter && !PHONE.matches) m.querySelector('.pm-filter').focus();   // telefono: niente tastiera da sola
  else if(cur) cur.focus();                              // tastiera: si parte dalla voce scelta
  if(cur) cur.scrollIntoView({ block:'nearest' });
}
// tastiera nei menu: frecce, Inizio/Fine; dal filtro freccia giu' va alle voci e Invio sceglie la prima;
// Tab chiude e riparte dalla pillola (Maiusc+Tab si ferma sulla pillola)
function menuKeys(e){
  const m = e.currentTarget, btns = [...m.querySelectorAll('button')].filter(b => !b.hidden);
  const f = m.querySelector('.pm-filter'), i = btns.indexOf(document.activeElement);
  let j = null;
  if(e.key === 'Tab'){
    const a = m.id === 'moreMenu' ? el('moreBtn') : menuAnchor;
    closeMenu();
    if(a){ a.focus(); if(e.shiftKey) e.preventDefault(); }
    return;
  }
  if(e.target === f){
    if(e.key === 'ArrowDown') j = 0;
    else if(e.key === 'Enter' && btns.length){ e.preventDefault(); btns[0].click(); return; }
  }
  else if(e.key === 'ArrowDown') j = Math.min(i + 1, btns.length - 1);
  else if(e.key === 'ArrowUp'){ if(i <= 0 && f){ e.preventDefault(); f.focus(); return; } j = Math.max(i - 1, 0); }
  else if(e.key === 'Home') j = 0;
  else if(e.key === 'End') j = btns.length - 1;
  if(j == null || !btns[j]) return;
  e.preventDefault(); btns[j].focus();
}
function closeMenu(){
  el('pillMenu').hidden = true; el('moreMenu').hidden = true; menuAnchor = null;
  document.querySelectorAll('#pillRow [aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
function syncPills(){
  const rp = el('regPill'), vp = el('varPill');
  const pg = document.querySelector('#pages .pg.active'), r = el('region'), ro = r.options[r.selectedIndex];
  const set = (b, what, txt) => { b.querySelector('span').textContent = txt; b.setAttribute('aria-label', what + ': ' + txt); };
  set(el('pgPill'), 'Pagina', pg ? pg.textContent : 'Misure dirette');
  set(rp, 'Regione', (!ro || ro.value === 'ALL') ? 'Tutte le regioni' : ro.textContent);
  rp.classList.toggle('on', !!ro && ro.value !== 'ALL');
  set(vp, 'Variabile', filterVar ? varLabel(filterVar) : 'Tutte le variabili');
  vp.classList.toggle('on', !!filterVar);
}
function pillToggle(btn, items, onPick, opts){ if(menuAnchor === btn) closeMenu(); else openMenu(btn, items(), onPick, opts); }
function setSelect(id, v){ const s = el(id); if(s.value === v) return; s.value = v; s.dispatchEvent(new Event('change')); syncPills(); }

// ---- RICERCA STAZIONE: campo in alto con suggerimenti (nome, regione, valore principale) -----------------------
// Ogni parola scritta deve essere l'inizio di una parola del nome (accenti, maiuscole e punteggiatura non contano),
// oppure la richiesta e' il codice della stazione o la sigla della regione. Ordine: nome che comincia con la
// richiesta, poi una parola che comincia, poi il resto; a parita' alfabetico. Al massimo 8.
function searchStations(q, list){
  const nq = normTxt(q);
  if(!nq) return [];
  const qw = nq.split(' '), hits = [];
  list.forEach(f => {
    const p = f.properties, nn = normTxt(p.name || p.scode), words = nn.split(' ');
    let rank = 2;
    if(nn.startsWith(nq)) rank = 0;
    else if(words.some(w => w.startsWith(nq))) rank = 1;
    else if(!qw.every(x => words.some(w => w.startsWith(x))) && normTxt(p.scode) !== nq && normTxt(p._region) !== nq) return;
    hits.push({ f, rank, nn, k: p._region + ' ' + p.scode });
  });
  hits.sort((a, b) => a.rank - b.rank || a.nn.localeCompare(b.nn) || a.k.localeCompare(b.k));   // omonimi: ordine fisso
  return hits.slice(0, 8).map(h => h.f);
}
// ultimo valore come nel tooltip: livello in quota assoluta se la stazione ha lo zero idrometrico (cm -> /100)
function latestText(p, v){
  const units = unitsByRegion[p._region] || {};
  const off = (v === 'LIVIDRO' && p.zero_idro != null) ? p.zero_idro : 0;
  const scale = (off && units[v] === 'cm') ? 0.01 : 1;
  let val = (off && p.latest[v] != null) ? Math.round((p.latest[v] * scale + off) * 1000) / 1000 : p.latest[v];
  if(val !== '' && isFinite(+val) && /\.\d{3,}/.test(String(val))) val = Math.round(val * 100) / 100;   // medie: 20.8333 -> 20.83
  const u = off ? 'm s.m.m.' : (units[v] || '');
  return val + (u ? ' ' + u : '');
}
// valore principale di una stazione: la variabile scelta se la stazione la misura ("n.d." senza un dato recente),
// altrimenti la prima fra temperatura, livello, pioggia 24 h, indice dell'aria
const MAIN_VARS = ['TEMP', 'LIVIDRO', 'PREC24', 'EAQI'];
const hasVal = (lt, v) => lt[v] != null && lt[v] !== '';             // un valore vuoto vale come assente
function stationMainValue(p){
  const lt = p.latest || {};
  if(filterVar && (hasVal(lt, filterVar) || (p.variables || []).includes(filterVar)))
    return { v: filterVar, label: varLabel(filterVar), text: hasVal(lt, filterVar) ? latestText(p, filterVar) : 'n.d.' };
  const v = MAIN_VARS.find(x => hasVal(lt, x));
  return v ? { v, label: varLabel(v), text: latestText(p, v) } : null;
}
// nome della regione come nella pillola (il gruppo che contiene la sigla: PC_FVG -> Friuli V.G.)
function regionLabel(reg){
  const o = [...el('region').options].find(o => o.value !== 'ALL' && (REGION_GROUPS[o.value] || [o.value]).includes(reg));
  return o ? o.textContent : reg;
}
// apre la stazione e vola sulla mappa (dopo selectStation: il suo panTo fermerebbe il volo)
function pickStation(f){
  const p = f.properties;
  selectStation(p);
  if(p._lat != null) map.flyTo([p._lat, p._lon], Math.max(map.getZoom(), 10), { duration:0.8 });
}
let srHits = [], srIdx = 0;                               // risultati mostrati e riga attiva
function closeSearch(){
  el('searchList').classList.remove('open');
  el('stationQ').setAttribute('aria-expanded', 'false');
  el('stationQ').removeAttribute('aria-activedescendant');
}
function markSearch(){
  [...el('searchList').querySelectorAll('[data-k]')].forEach((r, i) => {
    r.classList.toggle('act', i === srIdx); r.setAttribute('aria-selected', String(i === srIdx));
    if(i === srIdx){ el('stationQ').setAttribute('aria-activedescendant', r.id); r.scrollIntoView({ block:'nearest' }); }
  });
}
function renderSearch(){
  const q = el('stationQ'), box = el('searchList');
  if(!normTxt(q.value)){ srHits = []; closeSearch(); return; }
  closeMenu();
  srHits = searchStations(q.value, stationsForList()); srIdx = 0;
  box.innerHTML = '';
  if(!srHits.length) box.innerHTML = '<div class="sr-none">Nessuna stazione</div>';
  // omonimi nella stessa regione (es. Arba di ARPA FVG e della Protezione Civile): si aggiunge la fonte, o il codice
  const same = f => srHits.filter(x => featName(x) === featName(f) && regionLabel(x.properties._region) === regionLabel(f.properties._region));
  srHits.forEach((f, i) => {
    const p = f.properties, mv = stationMainValue(p), r = document.createElement('div'), twins = same(f);
    let where = regionLabel(p._region);
    if(twins.length > 1){
      const src = (SOURCES[p._region] || {}).name;
      where += ' · ' + (src && twins.filter(x => x.properties._region === p._region).length === 1 ? src : p.scode);
    }
    r.className = 'sr'; r.id = 'sr' + i; r.dataset.k = featKey(f); r.setAttribute('role', 'option');
    r.innerHTML = '<span class="sr-n"></span><span class="sr-r"></span><span class="sr-v"></span>';
    r.querySelector('.sr-n').textContent = featName(f);
    r.querySelector('.sr-r').textContent = where;
    if(mv){ r.querySelector('.sr-v').textContent = mv.text; r.title = mv.label + ': ' + mv.text; }
    box.appendChild(r);
  });
  box.classList.add('open'); q.setAttribute('aria-expanded', 'true');
  markSearch();
}
function chooseSearch(f){
  const q = el('stationQ');
  q.value = ''; srHits = []; closeSearch(); q.blur();
  pickStation(f);
}

function buildSearchControls(){
  el('noteBtn').addEventListener('click', (e) => {
    e.stopPropagation();                           // il clic non arriva al documento: chiudi qui gli altri pannelli
    el('srcpanel').style.display = 'none'; closeSearch();
    const n = el('notepanel');
    n.style.display = (n.style.display === 'block') ? 'none' : 'block';
  });
  document.addEventListener('click', (e) => {
    const n = el('notepanel');
    if(n.style.display === 'block' && !n.contains(e.target)) n.style.display = 'none';
  });
  // tema chiaro/scuro (persistito); al cambio ridisegna il grafico per aggiornare griglia e assi
  try { if(localStorage.getItem('theme') === 'dark'){ document.body.classList.add('dark'); } } catch(e){}
  _syncThemeBtn();
  el('themeBtn').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    try { localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light'); } catch(e){}
    _syncThemeBtn();
    if(histMode) renderHist();                              // i colori dello Storico (griglia, assi, anni) dipendono dal tema
    else if(currentStation && currentVar && currentVar !== WROSE && document.body.classList.contains('view-station'))
      renderChart(currentVar);
  });
  el('region').addEventListener('change', e => {
    const v = e.target.value;
    loadRegions(v === 'ALL' ? REGIONS_ALL : (REGION_GROUPS[v] || [v]));
  });

  // selezione stazione dal menu -> apre la stazione (o deseleziona)
  el('stationFilter').addEventListener('change', e => {
    selectedKey = e.target.value;
    const f = selectedFeature();
    if(f){ selectStation(f.properties); }
    else { clearChart(); resetPanel(); buildVarFilter(); renderMarkers(); }
  });

  // selezione variabile -> filtra le stazioni (e l'elenco)
  el('varFilter').addEventListener('change', e => {
    filterVar = e.target.value;
    if(filterVar !== radarDotsVar() && !radarUi.switching) radarOff(false);  // il radar vive con la variabile del suo prodotto
    // se la stazione aperta non ha la variabile, deselezionala
    const f = selectedFeature();
    if(f && filterVar && !(f.properties.variables || []).includes(filterVar)){
      selectedKey = ''; clearChart(); resetPanel();
    }
    buildStationFilter();
    buildVarFilter();
    renderMarkers();
    // se resta una stazione aperta e ha la variabile, mostrala nel grafico
    const f2 = selectedFeature();
    if(f2 && filterVar && f2.properties._table) drawVar(filterVar);
    snapSync();                                            // cursore aperto: ricarica per la nuova variabile (o chiudi)
  });

  el('resetBtn').addEventListener('click', () => {
    el('region').value = 'ALL';
    filterVar = ''; selectedKey = '';
    syncPills();                                   // subito, senza aspettare il caricamento
    loadRegions(REGIONS_ALL);
  });

  // 3 pagine: misure dirette / derivate / indici. Cambiano quali variabili sono selezionabili + la
  // pagina "indici" mostra anche la climatologia della stazione.
  [...document.querySelectorAll('#pages .pg')].forEach(b => b.addEventListener('click', () => {
    if(!radarUi.switching) radarOff(false);                                  // un'altra pagina spegne il radar
    currentPage = b.dataset.page;
    [...document.querySelectorAll('#pages .pg')].forEach(x => x.classList.toggle('active', x === b));
    filterVar = '';                              // la variabile potrebbe non appartenere alla nuova pagina
    document.body.classList.remove('rose-mode'); // cambio pagina: riparti dal grafico (drawVar la riattiva se serve)
    const sf = selectedFeature();
    if(sf){                                      // stazione aperta: ricostruisci per la nuova pagina
      const base = (sf.properties.variables || []).slice();
      if(currentStation && windObsCount(currentStation._table) >= 10) base.push(WROSE);   // chip rosa (gruppo derivate)
      const vars = base.filter(v => varCat(v) === currentPage).sort(natVars);
      buildVarButtons(vars); updateClimaBox();
      if(vars.length) drawVar(vars.includes(currentVar) ? currentVar : vars[0]);
      else clearChart();
    }
    buildStationFilter(); buildVarFilter(); renderMarkers();
    snapSync();
  }));
  ['pillMenu', 'moreMenu'].forEach(id => el(id).addEventListener('keydown', menuKeys));
  el('pgPill').addEventListener('click', () => pillToggle(el('pgPill'),
    () => [...document.querySelectorAll('#pages .pg')].map(b => ({ v:b.dataset.page, label:b.textContent, on:b.classList.contains('active') })),
    v => { const b = document.querySelector('#pages .pg[data-page="' + v + '"]'); if(b && !b.classList.contains('active')) b.click(); }));
  el('regPill').addEventListener('click', () => pillToggle(el('regPill'),
    () => [...el('region').options].map(o => ({ v:o.value, label:o.value === 'ALL' ? 'Tutte le regioni' : o.textContent, on:o.selected })),
    v => setSelect('region', v)));
  el('varPill').addEventListener('click', () => pillToggle(el('varPill'),
    () => [...el('varFilter').options].map(o => ({ v:o.value, label:o.textContent, on:o.value === (filterVar || '') })),
    v => setSelect('varFilter', v), { filter: el('varFilter').options.length > 12 }));
  el('moreBtn').addEventListener('click', () => {
    const mm = el('moreMenu');
    if(!mm.hidden){ closeMenu(); return; }
    closeMenu(); closeProdMenu();
    mm.hidden = false; el('moreBtn').setAttribute('aria-expanded', 'true');
    placeMenu(mm, el('moreBtn'));
    mm.querySelector('button').focus();
  });
  el('moreMenu').addEventListener('click', () => { closeMenu(); el('moreBtn').focus(); }, true);   // in cattura: "Note" ferma la propagazione
  document.addEventListener('click', e => {                   // clic fuori: si chiude
    if(e.target.closest('#pillMenu, #moreMenu, #pgPill, #regPill, #varPill, #moreBtn')) return;
    if(menuAnchor || !el('moreMenu').hidden) closeMenu();
  });
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape' || (!menuAnchor && el('moreMenu').hidden)) return;
    const a = menuAnchor || el('moreBtn'), ae = document.activeElement;
    const inMenu = el('pillMenu').contains(ae) || el('moreMenu').contains(ae);
    closeMenu();
    if(inMenu) a.focus();
  });
  window.addEventListener('resize', () => {                    // rotazione o tastiera del telefono: il menu resta al suo posto
    if(menuAnchor) placeMenu(el('pillMenu'), menuAnchor);
    else if(!el('moreMenu').hidden) placeMenu(el('moreMenu'), el('moreBtn'));
  });
  syncPills();
  el('stationQ').addEventListener('input', renderSearch);
  el('stationQ').addEventListener('focus', renderSearch);
  el('stationQ').addEventListener('keydown', e => {
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      if(!srHits.length) return;
      e.preventDefault();
      srIdx = (srIdx + (e.key === 'ArrowDown' ? 1 : -1) + srHits.length) % srHits.length;
      markSearch();
    } else if(e.key === 'Enter'){
      if(srHits[srIdx]){ e.preventDefault(); chooseSearch(srHits[srIdx]); }
    } else if(e.key === 'Escape'){
      e.preventDefault(); closeSearch(); el('stationQ').blur();
    }
  });
  el('searchList').addEventListener('pointerdown', e => e.preventDefault());   // il campo tiene il fuoco
  el('searchList').addEventListener('mousemove', e => {
    const r = e.target.closest('[data-k]'), i = r ? srHits.findIndex(f => featKey(f) === r.dataset.k) : -1;
    if(i >= 0 && i !== srIdx){ srIdx = i; markSearch(); }
  });
  el('searchList').addEventListener('click', e => {
    const r = e.target.closest('[data-k]'), f = r && srHits.find(x => featKey(x) === r.dataset.k);
    if(f) chooseSearch(f);
  });
  document.addEventListener('click', e => { if(!e.target.closest('.tb-q, #searchList')) closeSearch(); });
  // "/" e Ctrl/⌘+K portano alla ricerca, ma non mentre si scrive in un altro campo
  document.addEventListener('keydown', e => {
    const cmdK = (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K');
    if(!cmdK && !(e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey)) return;
    const a = document.activeElement;
    if(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    e.preventDefault(); closeMenu();
    if(document.body.classList.contains('view-station') || document.body.classList.contains('view-compare')) showMapView();
    el('stationQ').focus();
  });
}
