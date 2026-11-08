// storico.js: lo Storico, aggregati dal ramo history

// ------------------------------------------------------------------------------------------------
// STORICO LUNGO ("Storico" nella scheda stazione): aggregati giornalieri di pioggia e temperatura da tutto
// l'archivio, scritti una volta al giorno da history.py sul ramo 'history' del repository:
//   <REGIONE>/<STAZIONE>.json = {d0:'YYYYMMDD', p:[mm], hp:[ore], tn:[], tx:[], tm:[], ht:[ore]}  (un elemento per
//   giorno SOLARE da d0; null = nessun dato). "ore" = ore del giorno con almeno una misura: un giorno e' completo
//   con >= 20 ore, un mese e' completo se e' intero e il 90% dei giorni e' completo (il resto e' piu' chiaro o tratteggiato).
// ------------------------------------------------------------------------------------------------
const HIST_FALLBACK = 'https://cdn.jsdelivr.net/gh/Simulaqua/METEO@history';
async function fhist(path){
  try {
    const r = await fetch(HIST_BASE + '/' + path);
    if(r.ok || !HIST_BASE.startsWith('http')) return r;
  } catch(e){ if(!HIST_BASE.startsWith('http')) throw e; }
  return fetch(HIST_FALLBACK + '/' + path);
}
const MESI_BR = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
// si apre su Giorni con tutto il periodo; histWin = finestra dopo uno zoom (sulla stessa stazione resta fra le viste),
// hvHint = suggerimento dello zoom ancora da mostrare (fino al primo zoom)
let histMode = false, histVar = 'PREC', histView = 'giorni', histRange = 0, histU = null, histData = null, histWin = null, hvHint = true;
const histCache = {};
let _histIndexP = null;                    // index.json del ramo 'history' (una richiesta per sessione; null = assente)
function histIndex(){
  if(!_histIndexP) _histIndexP = fhist('index.json').then(r => r.ok ? r.json() : null).catch(() => null);
  return _histIndexP;
}
const histSafe = c => String(c).replace(/[^A-Za-z0-9_.-]/g, '_');
const stationHistVars = st => ['PREC', 'TEMP'].filter(v => ((st && st.variables) || []).includes(v));
const fmt1 = v => (Math.round(v * 10) / 10).toFixed(1);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function prepHist(j){
  const d0 = Date.UTC(+j.d0.slice(0, 4), +j.d0.slice(4, 6) - 1, +j.d0.slice(6, 8)) / 1000;
  const n = Math.max((j.p || []).length, (j.tm || []).length);
  const x = new Array(n);
  for(let i = 0; i < n; i++) x[i] = d0 + 86400 * i;
  const col = a => (a && a.length === n) ? a : new Array(n).fill(null);
  return { x, n, p:col(j.p), hp:col(j.hp), tn:col(j.tn), tx:col(j.tx), tm:col(j.tm), ht:col(j.ht), hasP:!!j.p, hasT:!!(j.tm || j.tn) };
}
async function histLoad(st){
  const key = st._region + '|' + st.scode, c = histCache[key];
  if(c && Date.now() - c.t < 3600e3) return c.h;
  let h = null;
  try { const r = await fhist(st._region + '/' + histSafe(st.scode) + '.json'); if(r.ok) h = prepHist(await r.json()); } catch(e){}
  histCache[key] = { t: Date.now(), h };
  return h;
}

// aggregati mensili di v ('PREC' | 'TEMP'): [{y, m, x, val, mn, mx, have, span, dim, full}]
function histMonths(h, v){
  const isP = v === 'PREC', val = isP ? h.p : h.tm, hrs = isP ? h.hp : h.ht;
  let i0 = -1;
  for(let i = 0; i < h.n; i++){ if(val[i] != null){ i0 = i; break; } }
  if(i0 < 0) return [];
  const out = []; let cur = null;
  for(let i = i0; i < h.n; i++){
    const d = new Date(h.x[i] * 1000), y = d.getUTCFullYear(), m = d.getUTCMonth();
    if(!cur || cur.y !== y || cur.m !== m){
      cur = { y, m, x:Date.UTC(y, m, 1) / 1000, sum:0, tsum:0, mn:null, mx:null, have:0, span:0, any:0 };
      out.push(cur);
    }
    cur.span++;
    if(isP){ if(h.p[i] != null){ cur.sum += h.p[i]; cur.any++; } }
    else {
      if(h.tn[i] != null){ cur.mn = cur.mn == null ? h.tn[i] : Math.min(cur.mn, h.tn[i]); cur.any++; }
      if(h.tx[i] != null) cur.mx = cur.mx == null ? h.tx[i] : Math.max(cur.mx, h.tx[i]);
    }
    if(val[i] != null && hrs[i] >= 20){ cur.have++; if(!isP) cur.tsum += h.tm[i]; }
  }
  out.forEach(c => {
    c.dim = daysInMonth(c.y, c.m);
    c.full = c.span === c.dim && c.have >= 0.9 * c.dim;
    c.val = isP ? (c.any ? Math.round(c.sum * 10) / 10 : null) : (c.have ? Math.round(c.tsum / c.have * 10) / 10 : null);
  });
  return out;
}

// tabella mesi x anni: una riga per mese e in fondo il totale (pioggia, mm interi) o la media delle medie (temperatura), una
// colonna per anno dal piu' vecchio; mese mancante = cella vuota. Dietro ogni numero una barra: pioggia lunga quanto il
// valore sul mese piu' piovoso della tabella, temperatura dal mese piu' freddo al piu' caldo. Incompleto = piu' chiaro,
// il perche' al passaggio (title)
function hvTableHtml(months, v){
  const isP = v === 'PREC', by = {}, vals = [];
  months.forEach(c => { if(c.val != null){ by[c.y + '-' + c.m] = c; vals.push(c.val); } });
  const years = [...new Set(months.map(c => c.y))], lo = Math.min(...vals), hi = Math.max(...vals);
  const bar = x => isP ? (hi > 0 ? x / hi : 0) : (hi > lo ? (x - lo) / (hi - lo) : 1);
  const cell = (x, why, w) => {
    const cls = [w != null && 'b', why && 'part'].filter(Boolean).join(' ');
    return '<td' + (cls ? ' class="' + cls + '"' : '') + (why ? ' title="incompleto: ' + why + '"' : '') +
           (w != null ? ' style="--w:' + (100 * w).toFixed(1) + '%"' : '') + '>' + (isP ? Math.round(x) : fmt1(x)) + '</td>';
  };
  const row = (head, cells, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th>' + head + '</th>' + cells.join('') + '</tr>';
  let html = '<table class="' + (isP ? 'rain' : 'warm') + '" style="--ny:' + years.length + '"><thead>' +
             row(isP ? 'mm' : '°C', years.map(y => '<th>' + y + '</th>')) + '</thead><tbody>';
  MESI_BR.forEach((name, m) => {
    html += row(name, years.map(y => { const c = by[y + '-' + m];
      return c ? cell(c.val, c.full ? '' : c.have + ' giorni completi su ' + c.dim, bar(c.val)) : '<td></td>'; }));
  });
  html += row(isP ? 'tot' : 'media', years.map(y => {
    const ms = MESI_BR.map((_, m) => by[y + '-' + m]).filter(Boolean), nf = ms.filter(c => c.full).length, s = ms.reduce((a, c) => a + c.val, 0);
    return ms.length ? cell(isP ? s : s / ms.length, nf < 12 ? nf + ' mesi completi su 12' : '') : '<td></td>';
  }), 'tot');
  return html + '</tbody></table>';
}

function hvW(){ return Math.max(260, el('hvChart').clientWidth || (el('panel').clientWidth - 32)); }
function hvH(){ return (window.matchMedia && matchMedia('(max-width:720px)').matches) ? 250 : 330; }
const hvBars = () => uPlot.paths.bars({ size:[0.75, 60] });
const hvMonLabel = ts => MESI_BR[new Date(ts * 1000).getUTCMonth()] + ' ' + new Date(ts * 1000).getUTCFullYear();
const hvDayLabel = ts => { const d = new Date(ts * 1000); return d.getUTCDate() + ' ' + MESI_BR[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };

// niente legenda di uPlot: chiave, riquadro al passaggio e nomi degli anni li aggiunge hvDecorate (in alto 20 px per la chiave).
// Giorni: niente selezione col trascinamento ne' doppio clic di uPlot (trascinare sposta il periodo, il doppio clic lo
// riporta a tutto: hvZoom)
function hvBase(extra, days){
  return Object.assign({
    width:hvW(), height:hvH(), tzDate:TZ_UTC, legend:{ show:false }, padding:[20, 12, 0, 0],
    cursor:days ? { y:false, drag:{ x:false, y:false }, bind:{ mousedown:() => null, mouseup:() => null, dblclick:() => null } }
                : { y:false, drag:{ x:true, y:false } },
    hooks:{ setCursor:[hvCursor], draw:[hvPlaceYears, hvHintFit] }
  }, extra);
}
// etichette dell'asse del tempo in italiano: mesi (gen, feb...) o giorni (5 mar), con l'anno sotto quando cambia
function hvTimeVals(u, ticks){
  const monthly = ticks.length > 1 && ticks[1] - ticks[0] >= 27 * 86400;
  let prevY = null;
  return ticks.map(t => {
    const d = new Date(t * 1000), y = d.getUTCFullYear();
    const lab = monthly ? MESI_BR[d.getUTCMonth()] : d.getUTCDate() + ' ' + MESI_BR[d.getUTCMonth()];
    const out = (prevY === null || y !== prevY) ? lab + '\n' + y : lab;
    prevY = y;
    return out;
  });
}
// asse dei valori col punto decimale e senza separatore delle migliaia (uPlot seguirebbe la lingua del browser: "1.000", "2,5")
const hvYAxis = label => ({ grid:{ stroke:GRID() }, stroke:AXTX(), size:58, label, labelSize:22,
                            values:(u, sp) => sp.map(v => String(Math.round(v * 1000) / 1000)) });
// tacche del tempo mai piu' fitte di un giorno (lo zoom arriva a 3 giorni): giorni, mesi (30 giorni per uPlot), anni
const HV_INCRS = [1, 2, 3, 4, 5, 7, 10, 15].map(n => n * 86400).concat([1, 2, 3, 4, 6].map(n => n * 30 * 86400), [1, 2, 5, 10].map(n => n * 365 * 86400));
const hvAxes = unit => [ { grid:{ stroke:GRID() }, stroke:AXTX(), values:hvTimeVals, incrs:HV_INCRS }, hvYAxis(unit) ];
// Mesi e Giorni (days). Pioggia: barre, le incomplete piu' chiare. Temperatura: banda chiara fra minima e massima, media in linea
const hvRainOpts = days => hvBase({
  scales:{ x:{ time:true }, y:{ range:(u, mn, mx) => [0, Math.max(mx * 1.08, 1)] } }, axes:hvAxes('mm'),
  series:[ {}, { stroke:'#2b6cb0', fill:'#2b6cb0cc', width:1, paths:hvBars(), points:{ show:false } },
               { stroke:'#8fb3da', fill:'#8fb3da88', width:1, paths:hvBars(), points:{ show:false } } ] }, days);
const hvTempOpts = (w, days) => hvBase({
  scales:{ x:{ time:true } }, axes:hvAxes('°C'), bands:[ { series:[1, 2], fill:'rgba(229,62,62,.12)' } ],
  series:[ {}, { stroke:'#e53e3e', width:1, points:{ show:false } }, { stroke:'#2b6cb0', width:1, points:{ show:false } },
               { stroke:AXTX(), width:w, points:{ show:false } } ] }, days);
// segno della chiave e dell'etichetta: rettangolino (barre, banda) o trattino (linee; sottile = anno incompleto)
const hvSw = (c, line, thin) => '<span class="sw' + (line ? ' ln' : '') + (thin ? ' thin' : '') + '" style="' +
                                (line ? 'border-color:' : 'background:') + c + '"></span>';
const hvRainKey = () => [hvSw('#2b6cb0cc') + 'mm', hvSw('#8fb3da88') + 'incompleto'];
const hvTempKey = () => [hvSw('rgba(229,62,62,.25)') + 'min–max', hvSw(AXTX(), true) + 'media'];
// riquadro al passaggio: in alto il mese o il giorno, sotto i valori ("291 mm"; "media 23.8 °C" e "min 15.8 · max 35.6"),
// in fondo "incompleto" se lo e'
const hvTempLines = (m, mn, mx) => { const r = [mn, mx].map((v, k) => v == null ? '' : (k ? 'max ' : 'min ') + fmt1(v)).filter(Boolean).join(' · ');
  return [m == null ? '' : 'media ' + fmt1(m) + ' °C', r && m == null ? r + ' °C' : r].filter(Boolean); };
const hvTip = (lab, lines, part) => '<b>' + lab + '</b>' + (lines.length ? lines : ['nessun dato']).map(s => '<div>' + s + '</div>').join('') +
                                    (part && lines.length ? '<div class="part">incompleto</div>' : '');

// ---- vista "Mesi": totali mensili (pioggia) o banda min-max e media mensile (temperatura) ----
function hvMonthsView(h, v){
  const months = histMonths(h, v), isP = v === 'PREC';
  if(!months.length) return { msg:'Nessun dato' };
  const x = months.map(c => c.x);
  const read = i => { const c = months[i];
    return hvTip(hvMonLabel(c.x), isP ? (c.val == null ? [] : [Math.round(c.val) + ' mm']) : hvTempLines(c.val, c.mn, c.mx), !c.full); };
  if(isP) return { opts:hvRainOpts(), data:[x, months.map(c => c.full ? c.val : null), months.map(c => c.full ? null : c.val)], read, key:hvRainKey() };
  return { opts:hvTempOpts(2), data:[x, months.map(c => c.mx), months.map(c => c.mn), months.map(c => c.val)], read, key:hvTempKey() };
}

// ---- vista "Anni": una linea per anno (pioggia: cumulata dal 1 gennaio; temperatura: media mensile), un colore per anno
// dal piu' recente: blu (e piu' spessa), ambra, verde acqua, viola, rosso, magenta, verde; gli incompleti piu' sottili; il nome
// dell'anno in fondo alla linea, del suo colore. Tavolozza provata (OKLab): fra due qualsiasi dei primi sei anni distanza >= 16
// e >= 8.6 anche per i daltonici (protanopia, deuteranopia), contrasto >= 3.4 sul fondo chiaro e >= 3.5 su quello scuro;
// oltre il settimo anno indietro grigio ----
const HV_YEARS = { light:['#2b6cb0', '#c37806', '#089772', '#8567fa', '#d01c25', '#a30a78', '#326402'],
                   dark: ['#5296e0', '#cc7d1c', '#089772', '#7453e5', '#d42229', '#e44fb1', '#3f7b04'] };
const hvYearColor = age => { const dark = document.body.classList.contains('dark'), p = HV_YEARS[dark ? 'dark' : 'light'];
  return age < p.length ? p[age] : (dark ? '#8fa1b5' : '#6b7a8d'); };
function hvYearsView(h, v){
  const isP = v === 'PREC', val = isP ? h.p : h.tm, hrs = isP ? h.hp : h.ht;
  const yrs = {};                                                  // anno -> accumulatori
  for(let i = 0; i < h.n; i++){
    const d = new Date(h.x[i] * 1000), y = d.getUTCFullYear(), mo = d.getUTCMonth();
    const Y = yrs[y] || (yrs[y] = { y, arr:new Array(isP ? 366 : 12).fill(null), run:0, tsum:new Array(12).fill(0), tcnt:new Array(12).fill(0),
                                    have:0, first:-1, last:-1 });
    const doy = Math.round((Date.UTC(y, mo, d.getUTCDate()) - Date.UTC(y, 0, 1)) / 86400000);
    if(val[i] == null) continue;
    if(Y.first < 0) Y.first = doy;
    Y.last = doy;
    if(hrs[i] >= 20) Y.have++;
    if(isP){ Y.run += h.p[i]; Y.arr[doy] = Math.round(Y.run * 10) / 10; }
    else if(hrs[i] >= 20){ Y.tsum[mo] += h.tm[i]; Y.tcnt[mo]++; }
  }
  const list = Object.values(yrs).filter(Y => Y.first >= 0).sort((a, b) => a.y - b.y);
  if(!list.length) return { msg:'Nessun dato' };
  if(isP){                                                         // giorni senza dato dentro l'anno: la cumulata resta piatta
    list.forEach(Y => { let prev = null; for(let i = Y.first; i <= Y.last; i++){ if(Y.arr[i] == null) Y.arr[i] = prev; else prev = Y.arr[i]; } });
  } else {
    list.forEach(Y => { for(let m = 0; m < 12; m++) Y.arr[m] = Y.tcnt[m] >= 10 ? Math.round(Y.tsum[m] / Y.tcnt[m] * 10) / 10 : null; });
  }
  const nx = isP ? 366 : 12, MS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const x = Array.from({ length:nx }, (_, i) => i), n = list.length;
  const dayLab = i => { const t = new Date(Date.UTC(2023, 0, 1 + Math.min(i, 364))); return t.getUTCDate() + ' ' + MESI_BR[t.getUTCMonth()]; };
  const lines = list.map((Y, k) => ({ Y, color:hvYearColor(n - 1 - k),
    // incompleto (piu' sottile) = anno che non copre l'inizio (dati da dopo il 10 gennaio) o con meno del 90% dei giorni completi
    part:Y.first > 10 || Y.have < 0.9 * (Y.last - Y.first + 1) }));
  const ends = [];                                                 // l'ultimo punto di ogni linea, per il nome dell'anno
  lines.forEach(o => { let j = nx - 1; while(j >= 0 && o.Y.arr[j] == null) j--; if(j >= 0) ends.push({ name:String(o.Y.y), color:o.color, x:j, y:o.Y.arr[j] }); });
  const read = i => hvTip(isP ? dayLab(i) : MESI_BR[i], lines.filter(o => o.Y.arr[i] != null).reverse().map(o =>        // dal piu' recente
    '<span' + (o.part ? ' class="part"' : '') + '>' + hvSw(o.color, true, o.part) + o.Y.y + ' ' + (isP ? Math.round(o.Y.arr[i]) + ' mm' : fmt1(o.Y.arr[i]) + ' °C') + '</span>'));
  const opts = hvBase({
    padding:[20, 44, 0, 0],                                        // a destra il posto per il nome degli anni
    scales:{ x:{ time:false, range:isP ? [0, 365] : [-0.3, 11.3] }, y:{ range:(u, mn, mx) => isP ? [0, Math.max(mx * 1.06, 1)] : [mn - 1, mx + 1] } },
    // spessore: ultimo anno 2.6, gli altri 1.6; incompleto 0.6 in meno (l'ultimo resta il piu' spesso)
    series:[{}].concat(lines.map((o, k) => ({ label:String(o.Y.y), stroke:o.color, width:(k < n - 1 ? 1.6 : 2.6) - (o.part ? 0.6 : 0),
                                              spanGaps:false, points:{ show:!isP, size:3 } }))),
    // un mese si' e uno no quando non ci stanno tutti (telefono: meno di 26 px a mese, tolti asse dei valori e margine destro)
    axes:[ { grid:{ stroke:GRID() }, stroke:AXTX(), splits:() => isP ? MS : x,
             values:(u, sp) => sp.map((i, k) => (u.width - 58 - 44) / 12 < 26 && k % 2 ? '' : MESI_BR[isP ? MS.indexOf(i) : i]) },
           hvYAxis(isP ? 'mm da inizio anno' : '°C (media mensile)') ]
  });
  return { opts, data:[x, ...lines.map(o => o.Y.arr)], read, ends, key:lines.some(o => o.part) ? [hvSw('var(--muted)', true, true) + 'incompleto'] : [] };
}

// ---- vista "Giorni": serie giornaliera (pioggia: barre; temperatura: banda min-max + media), tutto il periodo o lo zoom ----
function hvDaysView(h, v){
  const isP = v === 'PREC';
  const read = i => hvTip(hvDayLabel(h.x[i]), isP ? (h.p[i] == null ? [] : [fmt1(h.p[i]) + ' mm']) : hvTempLines(h.tm[i], h.tn[i], h.tx[i]),
                          !((isP ? h.hp[i] : h.ht[i]) >= 20));
  if(isP) return { opts:hvRainOpts(true), data:[h.x, h.p.map((p, i) => (p != null && h.hp[i] >= 20) ? p : null), h.p.map((p, i) => (p != null && h.hp[i] < 20) ? p : null)],
                   read, key:hvRainKey(), days:true };
  return { opts:hvTempOpts(1.6, true), data:[h.x, h.tx, h.tn, h.tm], read, key:hvTempKey(), days:true };
}

// chiave in alto a destra, riquadro coi valori dove sta il puntatore (mouse; sul telefono tocco e trascinamento) e nomi
// degli anni in fondo alle linee
function hvDecorate(u, r){
  const wrap = u.over.parentNode, add = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; wrap.appendChild(d); return d; };
  if(r.key.length) u._key = add('hv-key', r.key.map(s => '<span>' + s + '</span>').join(''));
  if(r.days && hvHint) u._hint = add('hv-hint', matchMedia('(pointer: coarse)').matches ? 'due dita: zoom' : 'rotellina: zoom · trascina: sposta');
  u._ends = (r.ends || []).map(e => { const d = add('hv-yl', e.name); d.style.color = e.color; return Object.assign({ el:d }, e); });
  u._read = r.read;
  u._tip = document.createElement('div'); u._tip.className = 'ctip hv-tip'; u.over.appendChild(u._tip);
  // tocco e penna: il riquadro compare dove si tocca e segue il dito che scorre di lato (in verticale scorre la pagina; nei
  // Giorni il dito sposta anche il periodo, e con due dita il riquadro non c'e'); col mouse lo sposta gia' uPlot
  u.over.style.touchAction = 'pan-y';
  const at = e => { const b = u.over.getBoundingClientRect(); u.setCursor({ left:e.clientX - b.left, top:e.clientY - b.top }); };
  u.over.addEventListener('pointerdown', at);
  u.over.addEventListener('pointermove', e => { if(e.pointerType !== 'mouse' && !u._pinch) at(e); });
  if(r.days) hvZoom(u);
}
// suggerimento dello zoom a sinistra sopra i dati; se toccherebbe la chiave non si mostra
function hvHintFit(u){
  const h = u._hint;
  if(!h) return;
  h.hidden = false;
  h.style.left = u.over.offsetLeft + 'px';
  if(u._key && h.offsetLeft + h.offsetWidth > u._key.offsetLeft - 8) h.hidden = true;
}

// ---- Giorni: zoom sul tempo ----
// Rotellina (e pizzico del trackpad, che arriva come rotellina con Ctrl; in Safari come "gesture") attorno al puntatore,
// trackpad di lato sposta; trascinare col mouse sposta; doppio clic o doppio tocco: tutto il periodo. Sul telefono due dita
// allargano o stringono, un dito di lato sposta (in verticale scorre la pagina). Mai oltre tutto il periodo, mai sotto 3
// giorni. La finestra vera e' u._win: uPlot applica setScale al giro dopo e due eventi ravvicinati la leggerebbero vecchia.
// Gli ascoltatori stanno sul grafico (u.over) e se ne vanno con lui (destroy a ogni cambio di vista)
const HV_MINW = 3 * 86400;
const hvKey = st => st ? st._region + '|' + st.scode : '';
const hvFull = h => ({ min:h.x[0] - 43200, max:h.x[h.n - 1] + 43200 });          // mezza giornata ai lati: le barre intere
function hvRangeWin(h, r){                                                     // gli ultimi r giorni (30, 90, 365); 0 = tutto
  const last = h.x[h.n - 1], lo = r ? Math.max(h.x[0], last - (r - 1) * 86400) : h.x[0];
  return { min:lo - 43200, max:last + 43200 };
}
const hvWinFor = h => (histWin && histWin.key === hvKey(currentStation)) ? histWin : hvRangeWin(h, histRange);
// porta la finestra a [min, max] dentro tutto il periodo (larga almeno 3 giorni); user = zoom fatto a mano. Dice se e' cambiata
function hvSetWin(u, min, max, user){
  const f = hvFull(histData), fw = f.max - f.min, w = Math.min(fw, Math.max(Math.min(HV_MINW, fw), max - min));
  min = Math.max(f.min, Math.min(min, f.max - w));
  const old = u._win, changed = !old || Math.abs(old.min - min) > 1 || Math.abs(old.max - (min + w)) > 1;
  u._win = { min, max:min + w };
  if(changed) u.setScale('x', { min, max:min + w });
  if(user && changed){
    histWin = fw - w < 1 ? null : { min, max:min + w, key:hvKey(currentStation) };
    if(!histWin) histRange = 0;                                // tornati a tutto il periodo: e' "Tutto"
    if(u._hint){ u._hint.remove(); u._hint = null; hvHint = false; }       // il suggerimento serve fino al primo zoom
  }
  hvRangeLit();
  return changed;
}
const hvReset = u => { const f = hvFull(histData); histRange = 0; histWin = null; hvSetWin(u, f.min, f.max, false); };
// acceso il periodo la cui finestra e' quella visibile (prima quello scelto); dopo uno zoom libero nessuno
function hvRangeLit(){
  const h = histData;
  if(!h) return;
  const w = (histU && histU._win) || hvWinFor(h), near = (a, b) => Math.abs(a.min - b.min) < 60 && Math.abs(a.max - b.max) < 60;
  const on = [histRange, 30, 90, 365, 0].find(r => near(hvRangeWin(h, r), w));
  [...el('hvRange').children].forEach(b => b.classList.toggle('on', +b.dataset.r === on));
}
function hvZoom(u){
  // larghezza vera dei dati (con i decimali: sul telefono un pixel vale anche due giorni)
  const o = u.over, W = () => o.getBoundingClientRect().width || 1, win = () => u._win, lx = e => e.clientX - o.getBoundingClientRect().left;
  const clampW = w => { const f = hvFull(histData), fw = f.max - f.min; return Math.min(fw, Math.max(Math.min(HV_MINW, fw), w)); };
  const val = x => win().min + x / W() * (win().max - win().min);               // istante sotto il pixel x dei dati
  const zoomAt = (x, k) => { const v = val(x), w = clampW((win().max - win().min) * k), mn = v - x / W() * w; return hvSetWin(u, mn, mn + w, true); };
  const shift = px => { const s = win(), d = px / W() * (s.max - s.min); return hvSetWin(u, s.min + d, s.max + d, true); };
  let gest = null;                                                             // pizzico di Safari sul Mac
  // un gesto della rotellina (scatti a meno di 300 ms l'uno dall'altro) resta di chi l'ha preso: il grafico se ha zoomato o
  // spostato, se no la pagina. Cosi' ai limiti (tutto il periodo in giu', 3 giorni in su) un gesto nuovo fa scorrere la pagina,
  // la coda di uno zoom non finisce nella pagina e un gesto partito scorrendo la pagina non zooma se torna indietro
  let lastChart = -1e9, lastPage = -1e9;
  o.classList.add('hv-pan');
  o.addEventListener('wheel', e => {
    if(!e.cancelable) return;                     // la pagina sta gia' scorrendo (Chrome: il resto del gesto non si annulla)
    if(gest && e.ctrlKey){ e.preventDefault(); return; }
    const t = e.timeStamp, inGesture = t - Math.max(lastChart, lastPage) < 300;
    if(!e.ctrlKey && inGesture && lastPage > lastChart){ lastPage = t; return; }       // gesto della pagina: resta alla pagina
    const keep = () => { e.preventDefault(); lastChart = t; };
    const px = e.deltaMode === 1 ? 16 : e.deltaMode ? W() : 1, dy = e.deltaY;
    if(!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(dy)){ shift(e.deltaX * px); keep(); return; }   // di lato: sposta (e niente "indietro" del browser)
    // in su stringe, in giu' allarga, come d3-zoom: 2^(pixel * 0.002), righe * 0.05, pizzico x10. La rotellina del mouse sul Mac
    // manda scatti da 4.000244140625 px, troppo lenti cosi': almeno 0.2 a scatto
    let z = dy * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002) * (e.ctrlKey ? 10 : 1);
    const q = dy / 4.000244140625;
    if(!e.ctrlKey && !e.deltaMode && dy && Math.abs(q - Math.round(q)) < 1e-6) z = Math.sign(dy) * Math.max(0.2, Math.abs(z));
    // il pizzico (Ctrl) resta sempre al grafico: mai lo zoom della pagina
    if(zoomAt(lx(e), Math.pow(2, Math.max(-1, Math.min(1, z)))) || e.ctrlKey || inGesture) keep();
    else lastPage = t;
  }, { passive:false });
  // mouse: trascinare sposta (il riquadro lo muove uPlot). Dita: una sposta, due allargano o stringono attorno al loro centro
  // (e spostano), doppio tocco = tutto il periodo
  const pts = new Map();                                                       // pointerId -> { x, y, x0, y0, t, multi }
  let drag = null, lastTap = null;
  const two = () => { const [a, b] = [...pts.values()]; return { d:Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), m:(a.x + b.x) / 2 - o.getBoundingClientRect().left }; };
  const endDrag = id => { if(drag && (id == null || drag.id === id)){ drag = null; o.classList.remove('hv-grab'); } };
  o.addEventListener('pointerdown', e => {
    if(e.pointerType === 'mouse'){
      if(e.button !== 0) return;
      drag = { id:e.pointerId, x:e.clientX, w:win() };
      try { o.setPointerCapture(e.pointerId); } catch(err){}                   // segue anche fuori dal grafico, finche' non si lascia
      o.classList.add('hv-grab');
      return;
    }
    pts.set(e.pointerId, { x:e.clientX, y:e.clientY, x0:e.clientX, y0:e.clientY, t:e.timeStamp, multi:pts.size > 0 });
    if(pts.size === 2){
      pts.forEach(p => { p.multi = true; });
      const g = two(); u._pinch = { d:g.d, w:win(), v:val(g.m) }; drag = null;
      u.setCursor({ left:-10, top:-10 });                                       // niente riquadro mentre si allarga
    } else if(pts.size === 1) drag = { id:e.pointerId, x:e.clientX, w:win() };
  });
  o.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    if(p){ p.x = e.clientX; p.y = e.clientY; }
    if(u._pinch && pts.size >= 2){
      const g = two(), P = u._pinch, w = clampW((P.w.max - P.w.min) * P.d / g.d), mn = P.v - g.m / W() * w;
      hvSetWin(u, mn, mn + w, true);
    } else if(drag && e.pointerId === drag.id){
      const s = drag.w, d = (e.clientX - drag.x) / W() * (s.max - s.min);
      hvSetWin(u, s.min - d, s.max - d, true);
    }
  });
  const up = e => {
    endDrag(e.pointerId);
    const p = pts.get(e.pointerId);
    if(!p) return;
    pts.delete(e.pointerId);
    if(e.type === 'pointerup' && !p.multi && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 10 && e.timeStamp - p.t < 300){     // un tocco
      if(lastTap && e.timeStamp - lastTap.t < 350 && Math.abs(e.clientX - lastTap.x) < 30){ lastTap = null; hvReset(u); }
      else lastTap = { t:e.timeStamp, x:e.clientX };
    }
    if(pts.size === 1){ const [id, q] = [...pts.entries()][0]; u._pinch = null; drag = { id, x:q.x, w:win() }; }   // resta un dito: sposta da li'
    else if(!pts.size) u._pinch = null;
  };
  o.addEventListener('pointerup', up);
  o.addEventListener('pointercancel', up);
  o.addEventListener('lostpointercapture', e => { if(e.pointerType === 'mouse') endDrag(e.pointerId); });
  o.addEventListener('dblclick', () => hvReset(u));
  // Safari: il pizzico del trackpad arriva come "gesture" (scale) e non come rotellina; sull'iPhone le dita le seguono gia' i pointer
  o.addEventListener('gesturestart', e => { e.preventDefault(); gest = pts.size ? null : { w:win(), x:e.clientX != null ? lx(e) : W() / 2 }; if(gest) gest.v = val(gest.x); });
  o.addEventListener('gesturechange', e => { e.preventDefault();
    if(!gest || pts.size || !(e.scale > 0)) return;
    const w = clampW((gest.w.max - gest.w.min) / e.scale), mn = gest.v - gest.x / W() * w; hvSetWin(u, mn, mn + w, true); });
  o.addEventListener('gestureend', e => { e.preventDefault(); gest = null; });
}
// il riquadro sta in alto, accanto alla linea del cursore (dall'altra parte vicino al bordo destro): non copre il dito
function hvCursor(u){
  const tip = u._tip, i = u.cursor.idx, l = u.cursor.left;
  if(!tip) return;
  if(i == null || l == null || l < 0){ tip.style.display = 'none'; return; }
  tip.innerHTML = u._read(i);
  tip.style.display = 'block';
  const W = u.over.clientWidth, w = tip.offsetWidth;
  const x = l + 10 + w <= W - 2 ? l + 10 : Math.max(2, Math.min(l - 10 - w, W - w - 2));
  tip.style.transform = 'translate(' + Math.round(x) + 'px,2px)';
}
// nomi degli anni a destra dell'ultimo punto. Due vicini che si toccherebbero vanno uno sotto l'altro; se i piu' bassi
// uscirebbero dal fondo del grafico, il gruppo risale
function hvPlaceYears(u){
  if(!u._ends) return;
  const H = 13, top = u.over.offsetTop, bottom = top + u.over.clientHeight - H, near = (p, q) => Math.abs(p.x - q.x) < 36;
  const ps = u._ends.map(e => ({ el:e.el, x:u.over.offsetLeft + u.valToPos(e.x, 'x') + 5, y:top + u.valToPos(e.y, 'y') - H / 2 }))
                    .sort((a, b) => a.y - b.y);
  ps.forEach((p, k) => ps.slice(0, k).forEach(q => { if(near(p, q) && p.y < q.y + H) p.y = q.y + H; }));
  for(let k = ps.length - 1; k >= 0; k--){
    const p = ps[k];
    p.y = Math.min(p.y, bottom);
    ps.slice(k + 1).forEach(q => { if(near(p, q) && p.y > q.y - H) p.y = q.y - H; });
  }
  ps.forEach(p => { p.el.style.transform = 'translate(' + Math.round(p.x) + 'px,' + Math.round(p.y) + 'px)'; });
}

// Giorni: la finestra dello zoom se c'e' (stessa stazione), se no il periodo scelto (all'inizio "Tutto")
function hvApplyRange(){
  if(!histU || histView !== 'giorni' || !histData) return;
  const w = hvWinFor(histData);
  hvSetWin(histU, w.min, w.max, false);
}
function hvSync(h){
  const hv = stationHistVars(currentStation);
  [...el('hvVar').children].forEach(b => {
    b.style.display = (b.dataset.v === 'PREC' ? (h.hasP && hv.includes('PREC')) : (h.hasT && hv.includes('TEMP'))) ? '' : 'none';
    b.classList.toggle('on', b.dataset.v === histVar);
  });
  [...el('hvView').children].forEach(b => b.classList.toggle('on', b.dataset.w === histView));
  el('hvRange').style.display = histView === 'giorni' ? '' : 'none';
  el('hvChart').style.display = histView === 'tabella' ? 'none' : '';
  hvRangeLit();
}
async function renderHist(){
  const st = currentStation;
  if(!st || !histMode) return;
  hvNoteSet(null, 'Carico lo storico…');
  const h = await histLoad(st);
  if(st !== currentStation || !histMode) return;
  if(histU){ histU.destroy(); histU = null; }
  el('hvChart').innerHTML = ''; el('hvTable').innerHTML = '';
  if(!h){ hvNoteSet(null, 'Storico non disponibile per questa stazione (si aggiorna ogni notte).'); return; }
  histData = h;
  if(histWin && histWin.key !== hvKey(st)) histWin = null;      // lo zoom vale per la sua stazione
  if(histVar === 'PREC' && !h.hasP && h.hasT) histVar = 'TEMP';
  if(histVar === 'TEMP' && !h.hasT && h.hasP) histVar = 'PREC';
  hvSync(h);
  if(histView === 'tabella'){
    const months = histMonths(h, histVar);
    el('hvTable').innerHTML = months.length ? hvTableHtml(months, histVar) : '<div class="hint">Nessun dato</div>';
  } else {
    const r = histView === 'anni' ? hvYearsView(h, histVar) : (histView === 'giorni' ? hvDaysView(h, histVar) : hvMonthsView(h, histVar));
    if(!r.opts){ el('hvChart').innerHTML = '<div class="hint">' + r.msg + '</div>'; hvNoteSet(null, ''); return; }
    histU = new uPlot(r.opts, r.data, el('hvChart'));
    hvDecorate(histU, r);
    if(r.days) hvApplyRange();
  }
  hvNoteSet(h);
  updateHash();
}
// riga sotto la vista: "Dati dal ... al ..." e la "i" che apre il metodo; senza dati solo il messaggio
function hvNoteSet(h, msg){
  const d = ts => { const t = new Date(ts * 1000); return pad(t.getUTCDate()) + '/' + pad(t.getUTCMonth() + 1) + '/' + t.getUTCFullYear(); };
  el('hvDates').textContent = h ? 'Dati dal ' + d(h.x[0]) + ' al ' + d(h.x[h.n - 1]) : msg;
  el('hvInfoBtn').hidden = !h;
  if(!h) hvInfo(false);
}
function hvInfo(open){ el('hvInfoBtn').setAttribute('aria-expanded', String(open)); el('hvInfo').hidden = !open; }
function exitHist(){
  if(!histMode) return;
  histMode = false;
  document.body.classList.remove('hist-mode');
  const b = el('histbtn'); b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
  if(histU){ histU.destroy(); histU = null; }
  hvInfo(false);                                           // la prossima volta il metodo parte chiuso
  histWin = null;                                          // e i Giorni senza lo zoom di prima
}
async function setHistMode(on, v, w){
  if(!on){
    exitHist();
    if(currentStation && currentVar){ syncVarButtons(); renderChart(currentVar); }
    updateHash();
    return;
  }
  if(!currentStation) return;
  const hv = stationHistVars(currentStation);
  if(!hv.length){ toast('Nessuno storico per questa stazione'); return; }
  exitStack();
  document.body.classList.remove('rose-mode');
  histVar = hv.includes(v) ? v : (hv.includes(currentVar) ? currentVar : hv[0]);
  currentVar = histVar;                                    // la pillola della variabile resta coerente
  if(w) histView = w;
  histMode = true;
  document.body.classList.add('hist-mode');
  const b = el('histbtn'); b.classList.add('active'); b.setAttribute('aria-pressed', 'true');
  syncVarButtons();
  await renderHist();
}
function exportHistCSV(){
  const h = histData; if(!h || !currentStation) return;
  const rows = ['data;pioggia_mm;ore_pioggia;tmin;tmax;tmedia;ore_temp'];
  const c = v => v == null ? '' : v;
  for(let i = 0; i < h.n; i++){
    if(h.p[i] == null && h.tm[i] == null && h.tn[i] == null) continue;
    rows.push([new Date(h.x[i] * 1000).toISOString().slice(0, 10), c(h.p[i]), c(h.hp[i]), c(h.tn[i]), c(h.tx[i]), c(h.tm[i]), c(h.ht[i])].join(';'));
  }
  const blob = new Blob([rows.join('\n') + '\n'], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'storico_' + prettyName(currentStation.name || currentStation.scode).replace(/[^\w-]+/g, '_') + '_' + currentStation._region + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function buildHistControls(){
  el('histbtn').addEventListener('click', () => setHistMode(!histMode));
  el('hvVar').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; histVar = b.dataset.v; currentVar = histVar; syncVarButtons(); renderHist(); });
  el('hvView').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; histView = b.dataset.w; renderHist(); });
  el('hvRange').addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; histRange = +b.dataset.r; histWin = null; hvApplyRange(); hvRangeLit(); });
  el('hvCsv').addEventListener('click', exportHistCSV);
  el('hvInfoBtn').addEventListener('click', () => hvInfo(el('hvInfo').hidden));
  el('hvInfoBtn').addEventListener('keydown', e => { if(e.key === 'Escape') hvInfo(false); });
}
