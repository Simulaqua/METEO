// storico.js: lo Storico (aggregati giornalieri del ramo history): viste Giorni/Mesi/Anni/Tabella, zoom, CSV.
// Gli ascoltatori sono in buildHistControls(), chiamata dall'avvio (comune.js).

// ------------------------------------------------------------------------------------------------
// Aggregati giornalieri di pioggia, temperatura, livelli di fiumi e laghi e portate, scritti ogni giorno da
// history.py sul ramo 'history': <REGIONE>/<STAZIONE>.json = {d0:'YYYYMMDD', p:[mm], hp:[ore], tn:[], tx:[],
// tm:[], ht:[ore], ...} con le chiavi di HIST_KEYS.
// Un elemento per giorno SOLARE da d0; null = nessun dato. "ore" = ore del giorno con almeno una misura.
// Giorno completo con >= 20 ore; mese completo se intero e con il 90% dei giorni completi.
// ------------------------------------------------------------------------------------------------
const HIST_FALLBACK = 'https://cdn.jsdelivr.net/gh/Simulaqua/METEO@history';
async function fhist(path){
  try {
    const r = await fetch(HIST_BASE + '/' + path);
    if(r.ok || !HIST_BASE.startsWith('http')) return r;
  } catch(e){
    if(!HIST_BASE.startsWith('http')) throw e;
  }
  return fetch(HIST_FALLBACK + '/' + path);
}
const MESI_BR = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
// histWin = finestra dopo uno zoom (resta fra le viste della stessa stazione);
// histYear = anno in primo piano negli Anni della temperatura (null = l'ultimo)
let histMode = false, histVar = 'PREC', histView = 'giorni', histRange = 0,
    histU = null, histData = null, histWin = null, histYear = null;
const histCache = {};
let _histIndexP = null;
function histIndex(){
  if(!_histIndexP) _histIndexP = fhist('index.json').then(r => r.ok ? r.json() : null).catch(() => null);
  return _histIndexP;
}
const histSafe = c => String(c).replace(/[^A-Za-z0-9_.-]/g, '_');
// variabile -> chiavi nel file: per la pioggia somma e ore, per le altre minima, massima, media e ore
const HIST_KEYS = {
  PREC:['p', 'hp'], TEMP:['tn', 'tx', 'tm', 'ht'], LIVIDRO:['ln', 'lx', 'lm', 'hl'],
  LIVLAGO:['gn', 'gx', 'gm', 'hg'], PORTATA:['qn', 'qx', 'qm', 'hq']
};
const HIST_VARS = Object.keys(HIST_KEYS);
const HIST_NAME = {
  PREC:'pioggia', TEMP:'temperatura', LIVIDRO:'livello', LIVLAGO:'livello', PORTATA:'portata'
};
const stationHistVars = st => HIST_VARS.filter(v => ((st && st.variables) || []).includes(v));
const fmt1 = v => (Math.round(v * 10) / 10).toFixed(1);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function prepHist(j){
  const d0 = Date.UTC(+j.d0.slice(0, 4), +j.d0.slice(4, 6) - 1, +j.d0.slice(6, 8)) / 1000;
  const keys = Object.values(HIST_KEYS).flat();
  const n = Math.max(...keys.map(k => (j[k] || []).length));
  const x = new Array(n);
  for(let i = 0; i < n; i++) x[i] = d0 + 86400 * i;
  const col = a => (a && a.length === n) ? a : new Array(n).fill(null);
  const h = { x, n, has:{} };
  keys.forEach(k => { h[k] = col(j[k]); });
  HIST_VARS.forEach(v => { h.has[v] = HIST_KEYS[v].slice(0, -1).some(k => !!j[k]); });
  h.hasP = h.has.PREC;
  h.hasT = h.has.TEMP;
  return h;
}
// Minima, massima, media e ore del giorno di v (non la pioggia) nelle unita' dei grafici della stazione: il
// livello sullo zero idrometrico (m s.m.m.) dove lo zero c'e', come nelle misure
function hvCols(h, v){
  const [kn, kx, km, kh] = HIST_KEYS[v], off = varOffset(v, currentStation), sc = varScale(v, currentStation);
  const key = v + '|' + off + '|' + sc, memo = h._cols || (h._cols = {});
  return memo[key] || (memo[key] = {
    mn:applyOff(h[kn], off, sc), mx:applyOff(h[kx], off, sc), me:applyOff(h[km], off, sc), hr:h[kh]
  });
}
const HV_UNIT0 = { PREC:'mm', TEMP:'°C', LIVIDRO:'m', LIVLAGO:'m', PORTATA:'m³/s' };
const hvUnit = v => (v === 'PREC' || v === 'TEMP') ? HV_UNIT0[v]
  : normUnit(varUnit(v, currentStation)) || HV_UNIT0[v];
const hvFmt = (v, x) => v === 'TEMP' ? fmt1(x) : fmtNum(x, v);
// medie arrotondate: al decimo per pioggia e temperatura, al millesimo per livelli e portate
const hvRound = (v, x) => {
  const f = (v === 'PREC' || v === 'TEMP') ? 10 : 1000;
  return Math.round(x * f) / f;
};
async function histLoad(st){
  const key = st._region + '|' + st.scode, c = histCache[key];
  if(c && Date.now() - c.t < 3600e3) return c.h;
  let h = null;
  try {
    const r = await fhist(st._region + '/' + histSafe(st.scode) + '.json');
    if(r.ok) h = prepHist(await r.json());
  } catch(e){}
  histCache[key] = { t: Date.now(), h };
  return h;
}

// aggregati mensili di v: [{y, m, x, val, mn, mx, have, span, dim, full}]
function histMonths(h, v){
  const isP = v === 'PREC', c = isP ? null : hvCols(h, v);
  const val = isP ? h.p : c.me, hrs = isP ? h.hp : c.hr;
  let i0 = -1;
  for(let i = 0; i < h.n; i++){
    if(val[i] != null){ i0 = i; break; }
  }
  if(i0 < 0) return [];
  const out = [];
  let cur = null;
  for(let i = i0; i < h.n; i++){
    const d = new Date(h.x[i] * 1000), y = d.getUTCFullYear(), m = d.getUTCMonth();
    if(!cur || cur.y !== y || cur.m !== m){
      cur = { y, m, x:Date.UTC(y, m, 1) / 1000, sum:0, tsum:0, mn:null, mx:null, have:0, span:0, any:0 };
      out.push(cur);
    }
    cur.span++;
    if(isP){
      if(h.p[i] != null){ cur.sum += h.p[i]; cur.any++; }
    }
    else {
      if(c.mn[i] != null){
        cur.mn = cur.mn == null ? c.mn[i] : Math.min(cur.mn, c.mn[i]);
        cur.any++;
      }
      if(c.mx[i] != null) cur.mx = cur.mx == null ? c.mx[i] : Math.max(cur.mx, c.mx[i]);
    }
    if(val[i] != null && hrs[i] >= 20){
      cur.have++;
      if(!isP) cur.tsum += val[i];
    }
  }
  out.forEach(o => {
    o.dim = daysInMonth(o.y, o.m);
    o.full = o.span === o.dim && o.have >= 0.9 * o.dim;
    o.val = isP
      ? (o.any ? Math.round(o.sum * 10) / 10 : null)
      : (o.have ? hvRound(v, o.tsum / o.have) : null);
  });
  return out;
}

// Tabella mesi x anni: una riga per mese, in fondo il totale (pioggia, mm interi) o la media delle medie
// (le altre); una colonna per anno dal piu' vecchio. Pioggia: a sinistra del numero una barra in
// proporzione al mese piu' piovoso. Le altre: la casella ha il colore dello scarto dalla media di quel
// mese fra gli anni, con la chiave sopra (temperatura in gradi, livelli e portate in proporzione a quanto
// variano di solito in quel mese). Incompleto = piu' chiaro, col perche'.
function hvTableHtml(months, v){
  const isP = v === 'PREC', isT = v === 'TEMP', by = {}, vals = [];
  months.forEach(c => {
    if(c.val != null){ by[c.y + '-' + c.m] = c; vals.push(c.val); }
  });
  const years = [...new Set(months.map(c => c.y))], hi = Math.max(...vals);
  const stat = isP ? null : hvMonthStats(months, v).stat;
  const look = c => {
    if(isP) return { cls:'b', css:'--f:' + (hi > 0 ? c.val / hi : 0).toFixed(3) };
    const s = stat[c.m];
    if(!(c.have >= 10 && s)) return { cls:'' };
    return { cls:isT ? 'hv-k' + hvDevClass(Math.round((c.val - s.mean) * 10) / 10)
                     : 'hv-w' + hvZClass(s.sd ? (c.val - s.mean) / s.sd : 0) };
  };
  const cell = (x, why, lk) => {
    const cls = [lk && lk.cls, why && 'part'].filter(Boolean).join(' ');
    return '<td' + (cls ? ' class="' + cls + '"' : '') + (why ? ' title="incompleto: ' + why + '"' : '') +
           (lk && lk.css ? ' style="' + lk.css + '"' : '') + '>' + (isP ? Math.round(x) : hvFmt(v, x)) +
           '</td>';
  };
  const row = (head, cells, cls) =>
    '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th>' + head + '</th>' + cells.join('') + '</tr>';
  let html = (isP ? '' : isT ? hvDevKey(years.length) : hvDevKey(years.length, 'w')) +
             '<table class="' + (isP ? 'rain' : 'warm') + '" style="--ny:' + years.length + '"><thead>' +
             row(hvUnit(v), years.map(y => '<th>' + y + '</th>')) + '</thead><tbody>';
  MESI_BR.forEach((name, m) => {
    html += row(name, years.map(y => {
      const c = by[y + '-' + m];
      return c ? cell(c.val, c.full ? '' : c.have + ' giorni completi su ' + c.dim, look(c)) : '<td></td>';
    }));
  });
  html += row(isP ? 'tot' : 'media', years.map(y => {
    const ms = MESI_BR.map((_, m) => by[y + '-' + m]).filter(Boolean),
          nf = ms.filter(c => c.full).length, s = ms.reduce((a, c) => a + c.val, 0);
    return ms.length
      ? cell(isP ? s : s / ms.length, nf < 12 ? nf + ' mesi completi su 12' : '')
      : '<td></td>';
  }), 'tot');
  return html + '</tbody></table>';
}

function histWidth(){ return Math.max(260, el('hvChart').clientWidth || (el('panel').clientWidth - 32)); }
// Alto quanto il grafico delle misure: tutto lo spazio della scheda (telefono: il 46% dello schermo). Con
// tante righe di anni e la finestra bassa il grafico si accorcia invece di uscire dal suo spazio.
function histHeight(){
  if(PHONE.matches) return Math.max(220, Math.round(innerHeight * 0.46));
  const c = el('hvChart'), yrs = c.querySelector('.hv-yrs');
  return Math.max(yrs ? 160 : 240, c.clientHeight - (yrs ? yrs.offsetHeight + 6 : 0));
}
const hvBars = () => uPlot.paths.bars({ size:[0.75, 60] });
const hvMonLabel = ts =>
  MESI_BR[new Date(ts * 1000).getUTCMonth()] + ' ' + new Date(ts * 1000).getUTCFullYear();
const hvDayLabel = ts => {
  const d = new Date(ts * 1000);
  return d.getUTCDate() + ' ' + MESI_BR[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
};

// Niente legenda: i nomi sono nel riquadro al passaggio e, per gli anni della pioggia, in una riga sopra il
// grafico (hvDecorate); la chiave c'e' solo nel PNG, dove il riquadro non c'e'.
// Giorni: niente selezione col trascinamento ne' doppio clic di uPlot (li gestisce hvZoom).
function hvBase(extra, days){
  return Object.assign({
    width:histWidth(), height:histHeight(), tzDate:TZ_UTC, legend:{ show:false }, padding:[24, 12, 0, 0],
    cursor:days
      ? {
          y:false, drag:{ x:false, y:false },
          bind:{ mousedown:() => null, mouseup:() => null, dblclick:() => null }
        }
      : { y:false, drag:{ x:true, y:false } },
    hooks:{ setCursor:[hvCursor], draw:[drawUnits] }
  }, extra);
}
// etichette dell'asse del tempo: mesi (gen, feb...) o giorni (5 mar), con l'anno sotto quando cambia
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
const hvYAxis = unit => ({
  grid:{ stroke:GRID() }, stroke:AXTX(), font:cssFont(12), size:58, unit, incrs:TICK_STEPS, values:tickTexts
});
// Tacche del tempo mai piu' fitte di un giorno (lo zoom arriva a 3 giorni): giorni, mesi (30 giorni), anni
const HV_INCRS = [1, 2, 3, 4, 5, 7, 10, 15].map(n => n * 86400)
  .concat([1, 2, 3, 4, 6].map(n => n * 30 * 86400), [1, 2, 5, 10].map(n => n * 365 * 86400));
const hvAxes = unit => [
  { grid:{ stroke:GRID() }, stroke:AXTX(), font:cssFont(12), values:hvTimeVals, incrs:HV_INCRS },
  hvYAxis(unit)
];
// Mesi e Giorni (days). Pioggia: barre, le incomplete piu' chiare, e la cumulata del periodo mostrato
// sull'asse destro (riparte da zero al bordo sinistro anche con lo zoom, come nei grafici delle stazioni).
// Temperatura: banda min-max, media in linea.
const hvRainOpts = days => hvBase({
  scales:{ x:{ time:true }, y:{ range:(u, mn, mx) => [0, Math.max(mx * 1.08, 1)] }, cum:cumY() },
  axes:hvAxes('mm').concat(cumAxis(false, CUMC())),
  series:[
    {},
    { stroke:'#2b6cb0', fill:'#2b6cb0cc', width:1, paths:hvBars(), points:{ show:false } },
    { stroke:'#8fb3da', fill:'#8fb3da88', width:1, paths:hvBars(), points:{ show:false } },
    { stroke:CUMC(), width:2, scale:'cum', points:{ show:false } }
  ]
}, days);
// un giorno o un mese senza dato interrompe la cumulata, che poi riprende dal valore raggiunto
function hvCum(vals){
  let c = 0;
  return vals.map(v => {
    if(v == null) return null;
    c += v;
    return Math.round(c * 10) / 10;
  });
}
// Fascia fra minima e massima, media in linea. Temperatura: bordi rosso e blu; livelli in blu, portate nel
// loro arancio.
function hvBandColors(v){
  if(v === 'TEMP')
    return { hi:'#e53e3e', lo:'#2b6cb0', fill:'rgba(229,62,62,.12)', key:'rgba(229,62,62,.25)' };
  const c = v === 'PORTATA' ? VAR_COLORS.PORTATA : hvYearColor(0);
  return { hi:c, lo:c, fill:c + '29', key:c + '55' };
}
const hvBandOpts = (v, w, days) => {
  const c = hvBandColors(v);
  return hvBase({
    scales:{ x:{ time:true } }, axes:hvAxes(hvUnit(v)), bands:[ { series:[1, 2], fill:c.fill } ],
    series:[
      {},
      { stroke:c.hi, width:1, points:{ show:false } },
      { stroke:c.lo, width:1, points:{ show:false } },
      { stroke:AXTX(), width:w, points:{ show:false } }
    ]
  }, days);
};
// segno della chiave: riquadro pieno o linea; cls 'thin' (anno incompleto) o 'dash' (media)
const hvSw = (c, line, cls) =>
  '<span class="sw' + (line ? ' ln' : '') + (cls ? ' ' + cls : '') + '" style="' +
  (line ? 'border-color:' : 'background:') + c + '"></span>';
const hvRainKey = () => [hvSw('#2b6cb0cc') + 'mm', hvSw('#8fb3da88') + 'incompleto'];
const hvBandKey = v => [hvSw(hvBandColors(v).key) + 'min–max', hvSw(AXTX(), true) + 'media'];
// Riquadro al passaggio: in alto il mese o il giorno, sotto i valori ("291 mm"; "media 23.8 °C" e
// "min 15.8 · max 35.6"), in fondo "incompleto" se lo e'
const hvLines = (v, m, mn, mx) => {
  const u = ' ' + hvUnit(v);
  const r = [mn, mx].map((x, k) => x == null ? '' : (k ? 'max ' : 'min ') + hvFmt(v, x))
    .filter(Boolean).join(' · ');
  return [m == null ? '' : 'media ' + hvFmt(v, m) + u, r && m == null ? r + u : r].filter(Boolean);
};
const hvTip = (lab, lines, part) =>
  '<b>' + lab + '</b>' + (lines.length ? lines : ['nessun dato']).map(s => '<div>' + s + '</div>').join('') +
  (part && lines.length ? '<div class="part">incompleto</div>' : '');

// ---- vista "Mesi": totali mensili (pioggia) o banda min-max e media mensile (le altre) ----
function hvMonthsView(h, v){
  const months = histMonths(h, v), isP = v === 'PREC';
  if(!months.length) return { msg:'Nessun dato' };
  const x = months.map(c => c.x);
  const read = i => {
    const c = months[i];
    return hvTip(
      hvMonLabel(c.x),
      isP ? (c.val == null ? [] : [Math.round(c.val) + ' mm']) : hvLines(v, c.val, c.mn, c.mx),
      !c.full
    );
  };
  if(isP) return {
    opts:hvRainOpts(),
    data:[
      x, months.map(c => c.full ? c.val : null), months.map(c => c.full ? null : c.val),
      hvCum(months.map(c => c.val))
    ],
    read, key:hvRainKey()
  };
  return {
    opts:hvBandOpts(v, 2),
    data:[x, months.map(c => c.mx), months.map(c => c.mn), months.map(c => c.val)],
    read, key:hvBandKey(v)
  };
}

// mesi sull'asse: uno si' e uno no se non ci stanno tutti (telefono: meno di 26 px a mese)
const hvMonthAxis = (splits, right) => ({
  grid:{ stroke:GRID() }, stroke:AXTX(), font:cssFont(12), splits:() => splits,
  values:(u, sp) => sp.map((i, k) =>
    (u.width - 58 - right) / 12 < 26 && k % 2 ? '' : MESI_BR[splits.indexOf(i)])
});

// ---- vista "Anni", pioggia: la cumulata dal 1 gennaio, una linea per anno ----
// Un colore per anno dal piu' recente: blu (piu' spessa), ambra, verde acqua, viola, rosso, magenta, verde;
// gli incompleti piu' sottili; il nome dell'anno in fondo alla linea. Tavolozza provata (OKLab): fra due
// qualsiasi dei primi sei anni distanza >= 16 (>= 8.6 per protanopia e deuteranopia), contrasto >= 3.4
// sul fondo chiaro e >= 3.5 su quello scuro; oltre il settimo anno indietro, grigio.
const HV_YEARS = {
  light:['#2b6cb0', '#c37806', '#089772', '#8567fa', '#d01c25', '#a30a78', '#326402'],
  dark: ['#5296e0', '#cc7d1c', '#089772', '#7453e5', '#d42229', '#e44fb1', '#3f7b04']
};
const hvYearColor = age => {
  const dark = document.body.classList.contains('dark'), p = HV_YEARS[dark ? 'dark' : 'light'];
  return age < p.length ? p[age] : (dark ? '#8fa1b5' : '#6b7a8d');
};
function hvRainYearsView(h){
  const yrs = {};
  for(let i = 0; i < h.n; i++){
    const d = new Date(h.x[i] * 1000), y = d.getUTCFullYear();
    const Y = yrs[y] || (yrs[y] = { y, arr:new Array(366).fill(null), run:0, have:0, first:-1, last:-1 });
    const doy = Math.round((Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 1)) / 86400000);
    if(h.p[i] == null) continue;
    if(Y.first < 0) Y.first = doy;
    Y.last = doy;
    if(h.hp[i] >= 20) Y.have++;
    Y.run += h.p[i];
    Y.arr[doy] = Math.round(Y.run * 10) / 10;
  }
  const list = Object.values(yrs).filter(Y => Y.first >= 0).sort((a, b) => a.y - b.y);
  if(!list.length) return { msg:'Nessun dato' };
  list.forEach(Y => {                            // giorni senza dato: la cumulata resta piatta
    let prev = null;
    for(let i = Y.first; i <= Y.last; i++){
      if(Y.arr[i] == null) Y.arr[i] = prev;
      else prev = Y.arr[i];
    }
  });
  const MS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const x = Array.from({ length:366 }, (_, i) => i), n = list.length;
  const dayLab = i => {
    const t = new Date(Date.UTC(2023, 0, 1 + Math.min(i, 364)));
    return t.getUTCDate() + ' ' + MESI_BR[t.getUTCMonth()];
  };
  const lines = list.map((Y, k) => ({
    Y, color:hvYearColor(n - 1 - k),
    // incompleto (piu' sottile): dati da dopo il 10 gennaio o meno del 90% dei giorni completi
    part:Y.first > 10 || Y.have < 0.9 * (Y.last - Y.first + 1)
  }));
  const read = i => hvTip(
    dayLab(i),
    lines.filter(o => o.Y.arr[i] != null).reverse().map(o =>          // dal piu' recente
      '<span' + (o.part ? ' class="part"' : '') + '>' + hvSw(o.color, true, o.part && 'thin') + o.Y.y + ' ' +
      Math.round(o.Y.arr[i]) + ' mm</span>')
  );
  const opts = hvBase({
    scales:{ x:{ time:false, range:[0, 365] }, y:{ range:(u, mn, mx) => [0, Math.max(mx * 1.06, 1)] } },
    // spessore: ultimo anno 2.6, gli altri 1.6; incompleto 0.6 in meno (l'ultimo resta il piu' spesso)
    series:[{}].concat(lines.map((o, k) => ({
      label:String(o.Y.y), stroke:o.color, width:(k < n - 1 ? 1.6 : 2.6) - (o.part ? 0.6 : 0),
      spanGaps:false, points:{ show:false }
    }))),
    axes:[hvMonthAxis(MS, 44), hvYAxis('mm da inizio anno')]
  });
  // gli anni in una riga sopra il grafico (nel PNG nella chiave), mai in fondo alle linee
  const yearKey = lines.map(o => ({ name:String(o.Y.y), color:o.color }));
  return {
    opts, data:[x, ...lines.map(o => o.Y.arr)], read, yearKey,
    key:yearKey.map(y => hvSw(y.color, true) + y.name)
      .concat(lines.some(o => o.part) ? [hvSw('var(--muted)', true, 'thin') + 'incompleto'] : [])
  };
}

// Negli anni: medie mensili di ogni anno (almeno 10 giorni completi) e, mese per mese, media, minimo,
// massimo e scarto tipo fra gli anni dove ce ne sono almeno due
function hvMonthStats(months, v){
  const by = {};
  months.forEach(c => {
    if(c.have < 10) return;
    const Y = by[c.y] || (by[c.y] = { y:c.y, val:new Array(12).fill(null), mon:[] });
    Y.val[c.m] = c.val;
    Y.mon[c.m] = c;
  });
  const years = Object.values(by).sort((a, b) => a.y - b.y);
  const stat = MESI_BR.map((_, m) => {
    const a = years.map(Y => Y.val[m]).filter(x => x != null);
    if(a.length < 2) return null;
    const avg = a.reduce((s, x) => s + x, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, x) => s + (x - avg) * (x - avg), 0) / (a.length - 1));
    return { mean:hvRound(v, avg), sd, lo:Math.min(...a), hi:Math.max(...a) };
  });
  return { years, stat };
}
// classe del colore dello scarto dalla media del mese (stile.css): hv-k3 entro mezzo grado, poi uno, due e
// piu' di due gradi e mezzo, verso il blu (hv-k2..k0) o verso il rosso (hv-k4..k6)
const hvDevClass = d => {
  const a = Math.abs(d);
  return 3 + Math.sign(d) * (a < 0.5 ? 0 : a < 1.5 ? 1 : a < 2.5 ? 2 : 3);
};
// livelli e portate: lo scarto in scarti tipo di quel mese (hv-w3 nella norma, hv-w0 molto piu' basso,
// hv-w6 molto piu' alto)
const hvZClass = z => {
  const a = Math.abs(z);
  return 3 + Math.sign(z) * (a < 0.3 ? 0 : a < 0.8 ? 1 : a < 1.5 ? 2 : 3);
};
const hvDevKey = (ny, w) => '<div class="hv-dev" style="--ny:' + ny + '"><span>' +
  (w ? 'più basso' : 'più freddo') + '</span><span>' +
  [0, 1, 2, 3, 4, 5, 6].map(k => '<span class="sw hv-' + (w ? 'w' : 'k') + k + '"></span>').join('') +
  '</span><span>' + (w ? 'più alto' : 'più caldo') + '</span></div>';
// "26.7 °C (+1.8)": la media del mese e lo scarto dalla media degli anni
const hvDev = (v, x, s) => {
  const t = hvFmt(v, x) + ' ' + hvUnit(v);
  if(!s) return t;
  const d = hvRound(v, x - s.mean);
  return t + ' (' + (d > 0 ? '+' : '') + hvFmt(v, d) + ')';
};
const hvBg = () => getComputedStyle(el('panel')).backgroundColor;

// ---- vista "Anni" (non la pioggia): l'anno scelto sulla fascia fra minimo e massimo degli anni, con la
// media; sotto, leggere e dello stesso colore, le linee di tutti gli anni ----
function hvCurveView(h, v){
  const { years, stat } = hvMonthStats(histMonths(h, v), v);
  if(!years.length) return { msg:'Nessun dato' };
  const Y = years.find(o => o.y === histYear) || years[years.length - 1];
  const dark = document.body.classList.contains('dark'), color = HV_YEARS[dark ? 'dark' : 'light'][0];
  const band = k => (dark ? 'rgba(199,211,224,' : 'rgba(28,39,51,') + (dark ? 0.14 : 0.1) * k + ')';
  const faint = dark ? 'rgba(199,211,224,.35)' : 'rgba(28,39,51,.3)';
  const all = years.flatMap(o => o.val).filter(x => x != null), x = MESI_BR.map((_, i) => i);
  const smooth = uPlot.paths.spline(), of = k => stat.map(s => s && s[k]), n = years.length;
  const line = (label, stroke, width, more) =>
    Object.assign({ label, stroke, width, paths:smooth, points:{ show:false } }, more);
  const u = ' ' + hvUnit(v);
  const read = i => {
    const s = stat[i], y = Y.val[i], lines = [];
    if(y != null) lines.push(hvSw(color, true) + Y.y + ' ' + hvDev(v, y, s));
    if(s) lines.push(hvSw(AXTX(), true, 'dash') + 'media ' + hvFmt(v, s.mean) + u,
                     hvSw(band(2)) + 'min ' + hvFmt(v, s.lo) + ' · max ' + hvFmt(v, s.hi));
    return hvTip(MESI_BR[i], lines, y != null && !Y.mon[i].full);
  };
  const lo = Math.min(...all), hi = Math.max(...all), pad = v === 'TEMP' ? 1 : (hi - lo) * 0.08 || 0.1;
  const opts = hvBase({
    scales:{                                                       // asse fermo cambiando anno
      x:{ time:false, range:[-0.3, 11.3] }, y:{ range:[lo - pad, hi + pad] }
    },
    bands:[{ series:[n + 1, n + 2], fill:band(1) }],
    series:[{}].concat(
      years.map(o => line(String(o.y), faint, 1)),
      line('max', band(1), 1), line('min', band(1), 1), line('media', AXTX(), 1.5, { dash:[5, 4] }),
      line(String(Y.y), color, 2.6, { points:{ show:true, size:7, width:1.5, fill:color, stroke:hvBg() } })
    ),
    axes:[hvMonthAxis(x, 12), hvYAxis(hvUnit(v) + ' (media mensile)')]
  });
  return {
    opts, data:[x, ...years.map(o => o.val), of('hi'), of('lo'), of('mean'), Y.val], read,
    key:stat.some(Boolean) ? [hvSw(band(2)) + 'min–max', hvSw(AXTX(), true, 'dash') + 'media'] : [],
    years:n > 1 ? years.map(o => o.y) : null, year:Y.y
  };
}
// anni sopra il grafico: un clic porta l'anno in primo piano
function hvYearPicker(years, year){
  const d = document.createElement('div');
  d.className = 'hv-seg hv-yrs';
  d.innerHTML = years.map(y =>
    '<button' + (y === year ? ' class="on"' : '') + ' data-y="' + y + '">' + y + '</button>').join('');
  d.addEventListener('click', e => {
    const b = e.target.closest('button');
    if(!b) return;
    histYear = +b.dataset.y;
    renderHist();
  });
  return d;
}

// ---- vista "Giorni": serie giornaliera (pioggia: barre; le altre: banda min-max + media) ----
function hvDaysView(h, v){
  const isP = v === 'PREC', c = isP ? null : hvCols(h, v);
  const read = i => hvTip(
    hvDayLabel(h.x[i]),
    isP ? (h.p[i] == null ? [] : [fmt1(h.p[i]) + ' mm']) : hvLines(v, c.me[i], c.mn[i], c.mx[i]),
    !((isP ? h.hp[i] : c.hr[i]) >= 20)
  );
  if(isP) return {
    opts:hvRainOpts(true),
    data:[
      h.x,
      h.p.map((p, i) => (p != null && h.hp[i] >= 20) ? p : null),
      h.p.map((p, i) => (p != null && h.hp[i] < 20) ? p : null),
      hvCum(h.p)
    ],
    read, key:hvRainKey(), days:true
  };
  return { opts:hvBandOpts(v, 1.6, true), data:[h.x, c.mx, c.mn, c.me], read, key:hvBandKey(v), days:true };
}

// riquadro coi valori dove sta il puntatore (mouse; sul telefono tocco e trascinamento) e, sopra il grafico,
// la riga degli anni
function hvDecorate(u, r){
  if(r.yearKey){
    const k = document.createElement('div');
    k.className = 'hv-yk';
    r.yearKey.forEach(y => {
      const s = document.createElement('span');
      s.textContent = y.name;
      s.style.color = y.color;
      k.appendChild(s);
    });
    u.over.parentNode.appendChild(k);
  }
  u._read = r.read;
  u._tip = document.createElement('div');
  u._tip.className = 'ctip hv-tip';
  u.over.appendChild(u._tip);
  // Tocco e penna: il riquadro compare dove si tocca e segue il dito che scorre di lato (in verticale scorre
  // la pagina; nei Giorni il dito sposta anche il periodo e con due dita il riquadro non c'e'). Col mouse
  // lo sposta gia' uPlot.
  u.over.style.touchAction = 'pan-y';
  const at = e => {
    const b = u.over.getBoundingClientRect();
    u.setCursor({ left:e.clientX - b.left, top:e.clientY - b.top });
  };
  u.over.addEventListener('pointerdown', at);
  u.over.addEventListener('pointermove', e => {
    if(e.pointerType !== 'mouse' && !u._pinch) at(e);
  });
  if(r.days) hvZoom(u);
}

// ---- Giorni: zoom sul tempo ----
// Rotellina (il pizzico del trackpad arriva come rotellina con Ctrl; in Safari come "gesture") attorno al
// puntatore; trackpad di lato e trascinamento col mouse spostano; doppio clic o tocco: tutto il periodo.
// Telefono: due dita allargano o stringono, un dito di lato sposta (in verticale scorre la pagina).
// Mai oltre tutto il periodo, mai sotto 3 giorni. La finestra vera e' u._win: uPlot applica setScale al giro
// dopo e due eventi ravvicinati la leggerebbero vecchia.
// Gli ascoltatori stanno su u.over e se ne vanno con il grafico (destroy a ogni cambio di vista).
const HV_MINW = 3 * 86400;
const hvKey = st => st ? st._region + '|' + st.scode : '';
// primo e ultimo giorno con un dato della variabile mostrata (le altre della stazione possono partire prima)
function hvSpan(h){
  const k = histVar === 'PREC' ? 'p' : HIST_KEYS[histVar][2], a = h[k], memo = h._span || (h._span = {});
  if(memo[k]) return memo[k];
  let i0 = 0, i1 = h.n - 1;
  while(i0 < i1 && a[i0] == null) i0++;
  while(i1 > i0 && a[i1] == null) i1--;
  return (memo[k] = { first:h.x[i0], last:h.x[i1] });
}
const hvFull = h => ({ min:hvSpan(h).first - 43200, max:hvSpan(h).last + 43200 }); // mezza giornata ai lati
function hvRangeWin(h, r){
  const { first, last } = hvSpan(h), lo = r ? Math.max(first, last - (r - 1) * 86400) : first;
  return { min:lo - 43200, max:last + 43200 };
}
const hvWinFor = h => (histWin && histWin.key === hvKey(currentStation)) ? histWin : hvRangeWin(h, histRange);
// Porta la finestra a [min, max] dentro tutto il periodo (larga almeno 3 giorni); user = zoom fatto a mano.
// Dice se e' cambiata.
function hvSetWin(u, min, max, user){
  const f = hvFull(histData), fw = f.max - f.min,
        w = Math.min(fw, Math.max(Math.min(HV_MINW, fw), max - min));
  min = Math.max(f.min, Math.min(min, f.max - w));
  const old = u._win, changed = !old || Math.abs(old.min - min) > 1 || Math.abs(old.max - (min + w)) > 1;
  u._win = { min, max:min + w };
  if(changed) u.setScale('x', { min, max:min + w });
  if(user && changed){
    histWin = fw - w < 1 ? null : { min, max:min + w, key:hvKey(currentStation) };
    if(!histWin) histRange = 0;                                // tornati a tutto il periodo: e' "Tutto"
  }
  hvRangeLit();
  return changed;
}
const hvReset = u => {
  const f = hvFull(histData);
  histRange = 0;
  histWin = null;
  hvSetWin(u, f.min, f.max, false);
};
// acceso il periodo la cui finestra e' quella visibile (prima quello scelto); dopo uno zoom libero nessuno
function hvRangeLit(){
  const h = histData;
  if(!h) return;
  const w = (histU && histU._win) || hvWinFor(h),
        near = (a, b) => Math.abs(a.min - b.min) < 60 && Math.abs(a.max - b.max) < 60;
  const on = [histRange, 30, 90, 365, 0].find(r => near(hvRangeWin(h, r), w));
  [...el('hvRange').children].forEach(b => b.classList.toggle('on', +b.dataset.r === on));
}
function hvZoom(u){
  // larghezza vera dei dati (con i decimali: sul telefono un pixel vale anche due giorni)
  const o = u.over, W = () => o.getBoundingClientRect().width || 1, win = () => u._win,
        lx = e => e.clientX - o.getBoundingClientRect().left;
  const clampW = w => {
    const f = hvFull(histData), fw = f.max - f.min;
    return Math.min(fw, Math.max(Math.min(HV_MINW, fw), w));
  };
  const val = x => win().min + x / W() * (win().max - win().min);
  const zoomAt = (x, k) => {
    const v = val(x), w = clampW((win().max - win().min) * k), mn = v - x / W() * w;
    return hvSetWin(u, mn, mn + w, true);
  };
  const shift = px => {
    const s = win(), d = px / W() * (s.max - s.min);
    return hvSetWin(u, s.min + d, s.max + d, true);
  };
  let gest = null;
  // Un gesto della rotellina (scatti a meno di 300 ms l'uno dall'altro) resta di chi l'ha preso: il grafico
  // se ha zoomato o spostato, se no la pagina. Cosi' ai limiti (tutto il periodo in giu', 3 giorni in su) un
  // gesto nuovo fa scorrere la pagina, la coda di uno zoom non finisce nella pagina e un gesto partito
  // scorrendo la pagina non zooma se torna indietro.
  let lastChart = -1e9, lastPage = -1e9;
  o.classList.add('hv-pan');
  o.addEventListener('wheel', e => {
    if(!e.cancelable) return;                     // la pagina scorre gia' (Chrome: non si annulla piu')
    if(gest && e.ctrlKey){ e.preventDefault(); return; }
    const t = e.timeStamp, inGesture = t - Math.max(lastChart, lastPage) < 300;
    if(!e.ctrlKey && inGesture && lastPage > lastChart){ lastPage = t; return; }
    const keep = () => { e.preventDefault(); lastChart = t; };
    const px = e.deltaMode === 1 ? 16 : e.deltaMode ? W() : 1, dy = e.deltaY;
    if(!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(dy)){     // di lato: sposta, senza "indietro" del browser
      shift(e.deltaX * px);
      keep();
      return;
    }
    // In su stringe, in giu' allarga, come d3-zoom: 2^(pixel * 0.002), righe * 0.05, pizzico x10.
    // La rotellina del mouse sul Mac manda scatti da 4.000244140625 px, troppo lenti: almeno 0.2 a scatto.
    let z = dy * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002) * (e.ctrlKey ? 10 : 1);
    const q = dy / 4.000244140625;
    if(!e.ctrlKey && !e.deltaMode && dy && Math.abs(q - Math.round(q)) < 1e-6)
      z = Math.sign(dy) * Math.max(0.2, Math.abs(z));
    if(zoomAt(lx(e), Math.pow(2, Math.max(-1, Math.min(1, z)))) || e.ctrlKey || inGesture) keep();
    else lastPage = t;
  }, { passive:false });
  // Mouse: trascinare sposta (il riquadro lo muove uPlot). Dita: una sposta, due allargano o stringono
  // attorno al loro centro (e spostano), doppio tocco = tutto il periodo.
  const pts = new Map();                                       // pointerId -> { x, y, x0, y0, t, multi }
  let drag = null, lastTap = null;
  const two = () => {
    const [a, b] = [...pts.values()];
    return {
      d:Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)),
      m:(a.x + b.x) / 2 - o.getBoundingClientRect().left
    };
  };
  const endDrag = id => {
    if(drag && (id == null || drag.id === id)){
      drag = null;
      o.classList.remove('hv-grab');
    }
  };
  o.addEventListener('pointerdown', e => {
    if(e.pointerType === 'mouse'){
      if(e.button !== 0) return;
      drag = { id:e.pointerId, x:e.clientX, w:win() };
      try { o.setPointerCapture(e.pointerId); } catch(err){}   // segue anche fuori dal grafico
      o.classList.add('hv-grab');
      return;
    }
    pts.set(e.pointerId, {
      x:e.clientX, y:e.clientY, x0:e.clientX, y0:e.clientY, t:e.timeStamp, multi:pts.size > 0
    });
    if(pts.size === 2){
      pts.forEach(p => { p.multi = true; });
      const g = two();
      u._pinch = { d:g.d, w:win(), v:val(g.m) };
      drag = null;
      u.setCursor({ left:-10, top:-10 });
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
    if(e.type === 'pointerup' && !p.multi &&
       Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 10 && e.timeStamp - p.t < 300){
      if(lastTap && e.timeStamp - lastTap.t < 350 && Math.abs(e.clientX - lastTap.x) < 30){
        lastTap = null;
        hvReset(u);
      }
      else lastTap = { t:e.timeStamp, x:e.clientX };
    }
    if(pts.size === 1){
      const [id, q] = [...pts.entries()][0];
      u._pinch = null;
      drag = { id, x:q.x, w:win() };
    }
    else if(!pts.size) u._pinch = null;
  };
  o.addEventListener('pointerup', up);
  o.addEventListener('pointercancel', up);
  o.addEventListener('lostpointercapture', e => { if(e.pointerType === 'mouse') endDrag(e.pointerId); });
  o.addEventListener('dblclick', () => hvReset(u));
  // Safari: il pizzico del trackpad arriva come "gesture" (scale), non come rotellina; sull'iPhone le dita
  // le seguono gia' i pointer
  o.addEventListener('gesturestart', e => {
    e.preventDefault();
    gest = pts.size ? null : { w:win(), x:e.clientX != null ? lx(e) : W() / 2 };
    if(gest) gest.v = val(gest.x);
  });
  o.addEventListener('gesturechange', e => {
    e.preventDefault();
    if(!gest || pts.size || !(e.scale > 0)) return;
    const w = clampW((gest.w.max - gest.w.min) / e.scale), mn = gest.v - gest.x / W() * w;
    hvSetWin(u, mn, mn + w, true);
  });
  o.addEventListener('gestureend', e => { e.preventDefault(); gest = null; });
}
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
// Giorni: la finestra dello zoom se c'e' (stessa stazione), se no il periodo scelto (all'inizio "Tutto")
function hvApplyRange(){
  if(!histU || histView !== 'giorni' || !histData) return;
  const w = hvWinFor(histData);
  hvSetWin(histU, w.min, w.max, false);
}
function hvSync(h){
  const hv = stationHistVars(currentStation);
  [...el('hvVar').children].forEach(b => {
    b.style.display = (h.has[b.dataset.v] && hv.includes(b.dataset.v)) ? '' : 'none';
    b.classList.toggle('on', b.dataset.v === histVar);
  });
  [...el('hvView').children].forEach(b => b.classList.toggle('on', b.dataset.w === histView));
  el('hvRange').style.display = histView === 'giorni' ? '' : 'none';
  el('hvChart').style.display = histView === 'tabella' ? 'none' : '';
  hvRangeLit();
}
const hvView = h => histView === 'anni'
  ? (histVar === 'PREC' ? hvRainYearsView(h) : hvCurveView(h, histVar))
  : histView === 'giorni' ? hvDaysView(h, histVar) : hvMonthsView(h, histVar);
async function renderHist(){
  const st = currentStation;
  if(!st || !histMode) return;
  hvNoteSet(null, 'Carico lo storico…');
  const h = await histLoad(st);
  if(st !== currentStation || !histMode) return;
  if(histU){ histU.destroy(); histU = null; }
  el('hvChart').innerHTML = '';
  el('hvTable').innerHTML = '';
  if(!h){
    hvNoteSet(null, 'Storico non disponibile.');
    return;
  }
  histData = h;
  if(histWin && histWin.key !== hvKey(st)) histWin = null;
  if(!h.has[histVar]) histVar = stationHistVars(st).find(v => h.has[v]) || histVar;
  hvSync(h);
  if(histView === 'tabella'){
    const months = histMonths(h, histVar);
    el('hvTable').innerHTML = months.length
      ? hvTableHtml(months, histVar)
      : '<div class="hint">Nessun dato</div>';
  } else {
    const r = hvView(h);
    if(r.msg){
      el('hvChart').innerHTML = '<div class="hint">' + r.msg + '</div>';
      hvNoteSet(null, '');
      return;
    }
    if(r.years) el('hvChart').prepend(hvYearPicker(r.years, r.year));
    r.opts.height = histHeight();                     // con gli anni sopra, il grafico e' piu' basso
    histU = new uPlot(r.opts, r.data, el('hvChart'));
    hvDecorate(histU, r);
    if(r.days) hvApplyRange();
  }
  hvNoteSet(h);
  updateHash();
}
function hvNoteSet(h, msg){
  const d = ts => {
    const t = new Date(ts * 1000);
    return pad(t.getUTCDate()) + '/' + pad(t.getUTCMonth() + 1) + '/' + t.getUTCFullYear();
  };
  el('hvDates').textContent = h ? 'Dati dal ' + d(hvSpan(h).first) + ' al ' + d(hvSpan(h).last) : msg;
  el('hvInfoBtn').hidden = !h;
  if(!h) hvInfo(false);
}
function hvInfo(open){
  el('hvInfoBtn').setAttribute('aria-expanded', String(open));
  el('hvInfo').hidden = !open;
}
function exitHist(){
  if(!histMode) return;
  histMode = false;
  document.body.classList.remove('hist-mode');
  if(histU){ histU.destroy(); histU = null; }
  hvInfo(false);
  histWin = null;
  syncModes();
}
async function setHistMode(on, v, w){
  if(!on){
    exitHist();
    if(currentStation && currentVar){ buildVarRow(); renderChart(currentVar); }
    updateHash();
    return;
  }
  if(!currentStation) return;
  const hv = stationHistVars(currentStation);
  if(!hv.length){ toast('Nessuno storico per questa stazione'); return; }
  exitStack();
  document.body.classList.remove('rose-mode', 'clima-mode');
  histVar = hv.includes(v) ? v : (hv.includes(currentVar) ? currentVar : hv[0]);
  currentVar = histVar;
  extraVars = [];
  if(w) histView = w;
  histMode = true;
  document.body.classList.add('hist-mode');
  altClose();
  syncModes();
  buildVarRow();
  await renderHist();
}
// pioggia e temperatura sempre; livelli e portate se la stazione li ha, nelle unita' dei grafici
const HV_CSV = { LIVIDRO:'livello', LIVLAGO:'lago', PORTATA:'portata' };
function exportHistCSV(){
  const h = histData;
  if(!h || !currentStation) return;
  const head = ['data;pioggia_mm;ore_pioggia;tmin;tmax;tmedia;ore_temp'];
  const cols = [h.p, h.hp, h.tn, h.tx, h.tm, h.ht];
  Object.keys(HV_CSV).filter(v => h.has[v]).forEach(v => {
    const c = hvCols(h, v), u = ' [' + hvUnit(v) + ']', n = HV_CSV[v];
    head.push(n + '_min' + u, n + '_max' + u, n + '_media' + u, 'ore_' + n);
    cols.push(c.mn, c.mx, c.me, c.hr);
  });
  const rows = [head.join(';')], c = v => v == null ? '' : v;
  const seen = [h.p, h.tn, h.tm].concat(cols.slice(6));          // un giorno entra se ha almeno un valore
  for(let i = 0; i < h.n; i++){
    if(seen.every(a => a[i] == null)) continue;
    rows.push([new Date(h.x[i] * 1000).toISOString().slice(0, 10)].concat(cols.map(a => c(a[i]))).join(';'));
  }
  saveBlob(new Blob([rows.join('\n') + '\n'], { type:'text/csv;charset=utf-8' }),
           'storico_' + pngBase() + '.csv');
}
// ---- PNG dello Storico: il grafico ridisegnato grande, o la Tabella disegnata cella per cella. L'immagine
// e' su bianco: viste e colori si leggono col tema chiaro (tolto e rimesso senza che lo schermo si
// ridisegni) ----
const HV_VIEW_TXT = { giorni:'giorni', mesi:'mesi', anni:'anni', tabella:'tabella' };
function hvLight(fn){
  const dark = document.body.classList.contains('dark');
  if(dark) document.body.classList.remove('dark');
  try { return fn(); } finally { if(dark) document.body.classList.add('dark'); }
}
async function histPNG(){
  const h = histData, st = currentStation;
  if(!h || !st) return null;
  const d = ts => new Date(ts * 1000).toISOString().slice(0, 10).split('-').reverse().join('/');
  const title = prettyName(st.name || st.scode) + ' — Storico ' + HIST_NAME[histVar] + ', ' +
                HV_VIEW_TXT[histView];
  const what = 'Dati dal ' + d(hvSpan(h).first) + ' al ' + d(hvSpan(h).last);
  const cv = histView === 'tabella' ? hvLight(() => hvTableCanvas(title, what))
                                    : await hvChartCanvas(h, title, what);
  if(!cv) return null;
  return { blob: toPng(cv), fname: pngBase() + '_storico_' + histVar + '_' + histView + '.png' };
}
async function hvChartCanvas(h, title, what){
  const r = hvLight(() => {
    const v = hvView(h);
    if(!v.msg){
      v.keyEl = document.createElement('div');
      v.keyEl.innerHTML = v.key.map(s => '<span>' + s + '</span>').join('');
    }
    return v;
  });
  if(r.msg) return null;
  const W = 1500, H = 640, TOP = 124, L = 12, o = r.opts;
  Object.assign(o, { width:W, height:H, hooks:{ draw:[drawUnits] }, cursor:{ show:false } });
  o.padding = [44, o.padding[1] * 2, 0, 0];
  o.axes.forEach(a => Object.assign(a, { font:cssFont(20), unitSize:20, size:(a.size || 50) * 1.5 }));
  if(histView === 'giorni' && histU && histU.scales.x.min != null){
    const xr = [histU.scales.x.min, histU.scales.x.max];
    o.scales.x.range = () => xr;
  }
  if(histView === 'anni' && histVar !== 'PREC') title += ' (' + r.year + ')';
  const plot = await offPlot(o, r.data, W, H);
  const { cv, ctx } = pngCanvas(L + W + 12, TOP + H + 20);
  pngHead(ctx, title, what, true, 'Giorno solare (UTC+1)');
  hvDrawKey(ctx, r.keyEl, L, 104);
  ctx.drawImage(plot.u.ctx.canvas, L, TOP, W, H);
  plot.done();
  return cv;
}
// chiave della vista: segno (riquadro o linea, sottile o tratteggiata) e testo, in riga
function hvDrawKey(ctx, keyEl, x, y){
  ctx.font = cssFont(17);
  ctx.textBaseline = 'middle';
  [...keyEl.children].forEach(span => {
    const sw = span.querySelector('.sw'), text = span.textContent.trim();
    let c = sw ? (sw.style.background || sw.style.borderColor) : '';
    if(!c || c.startsWith('var(')) c = '#6b7a8d';
    if(sw && sw.classList.contains('ln')){
      ctx.strokeStyle = c;
      ctx.lineWidth = sw.classList.contains('thin') ? 1.5 : 3;
      ctx.setLineDash(sw.classList.contains('dash') ? [8, 5] : []);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 26, y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if(sw){
      ctx.fillStyle = c;
      ctx.fillRect(x, y - 8, 22, 16);
    }
    ctx.fillStyle = '#22303c';
    ctx.fillText(text, x + 34, y);
    x += 34 + ctx.measureText(text).width + 28;
  });
  ctx.textBaseline = 'alphabetic';
}
// Tabella: ogni casella col suo fondo, la barra della pioggia, i bordi e il numero, 1.6 volte piu' grande
function hvTableCanvas(title, what){
  const box = el('hvTable'), table = box.querySelector('table');
  if(!table) return null;
  const sl = box.scrollLeft, Z = 1.6, L = 12, TOP = 96, key = box.querySelector('.hv-dev');
  box.scrollLeft = 0;                          // la prima colonna e' fissa: senza scorrere sta al suo posto
  try {
    const tr = table.getBoundingClientRect(), kr = key && key.getBoundingClientRect();
    const KH = kr ? kr.height * Z + 14 : 0;
    const W = Math.max(tr.width * Z, kr ? kr.width * Z : 0, 640) + 2 * L;
    const { cv, ctx } = pngCanvas(W, TOP + KH + tr.height * Z + 20);
    pngHead(ctx, title, what, true, 'Giorno solare (UTC+1)');
    if(kr) key.querySelectorAll('*').forEach(e => {
      if(!e.children.length) hvDrawBox(ctx, e, kr, L, TOP, Z);
    });
    table.querySelectorAll('th, td').forEach(c => hvDrawBox(ctx, c, tr, L, TOP + KH, Z));
    return cv;
  } finally { box.scrollLeft = sl; }
}
function hvDrawBox(ctx, c, base, ox, oy, Z){
  const r = c.getBoundingClientRect(), cs = getComputedStyle(c), px = k => (parseFloat(cs[k]) || 0) * Z;
  const x = ox + (r.left - base.left) * Z, y = oy + (r.top - base.top) * Z, w = r.width * Z, h = r.height * Z;
  const b = { t:px('borderTopWidth'), r:px('borderRightWidth'), b:px('borderBottomWidth'),
              l:px('borderLeftWidth') };
  const visible = col => col && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(col);
  ctx.save();
  ctx.globalAlpha = +cs.opacity;
  if(visible(cs.backgroundColor)){
    ctx.fillStyle = cs.backgroundColor;
    ctx.fillRect(x + b.l, y + b.t, w - b.l - b.r, h - b.t - b.b);
  }
  const f = c.style.getPropertyValue('--f');
  if(f){                                       // barra della pioggia, a sinistra del numero (stile.css: 4ch)
    const pl = px('paddingLeft'), pr = px('paddingRight'), pt = px('paddingTop'), pb = px('paddingBottom');
    ctx.font = cs.fontWeight + ' ' + parseFloat(cs.fontSize) * Z + 'px ' + cs.fontFamily;
    ctx.fillStyle = cs.getPropertyValue('--hvc').trim();
    ctx.fillRect(x + b.l + pl, y + b.t + pt,
                 Math.max(0, (w - b.l - b.r - pl - pr - 4 * ctx.measureText('0').width) * parseFloat(f)),
                 h - b.t - b.b - pt - pb);
  }
  if(b.b && cs.borderBottomStyle !== 'none' && visible(cs.borderBottomColor)){
    ctx.fillStyle = cs.borderBottomColor;
    ctx.fillRect(x, y + h - b.b, w, b.b);
  }
  if(b.t && cs.borderTopStyle !== 'none' && visible(cs.borderTopColor)){
    ctx.fillStyle = cs.borderTopColor;
    ctx.fillRect(x, y, w, b.t);
  }
  const txt = c.children.length ? '' : c.textContent.trim();
  if(txt){
    const right = cs.textAlign === 'right' || cs.textAlign === 'end';
    ctx.fillStyle = cs.color;
    ctx.font = cs.fontWeight + ' ' + parseFloat(cs.fontSize) * Z + 'px ' + cs.fontFamily;
    ctx.textBaseline = 'middle';
    ctx.textAlign = right ? 'right' : 'left';
    ctx.fillText(txt, right ? x + w - b.r - px('paddingRight') : x + b.l + px('paddingLeft'), y + h / 2);
  }
  ctx.restore();
}
function buildHistControls(){
  el('histbtn').addEventListener('click', () => setHistMode(!histMode));
  el('histOff').addEventListener('click', () => setHistMode(false));
  el('hvVar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if(!b) return;
    histVar = b.dataset.v;
    currentVar = histVar;
    renderHist();
  });
  el('hvView').addEventListener('click', e => {
    const b = e.target.closest('button');
    if(!b) return;
    histView = b.dataset.w;
    renderHist();
  });
  el('hvRange').addEventListener('click', e => {
    const b = e.target.closest('button');
    if(!b) return;
    histRange = +b.dataset.r;
    histWin = null;
    hvApplyRange();
    hvRangeLit();
  });
  el('hvInfoBtn').addEventListener('click', () => hvInfo(el('hvInfo').hidden));
  el('hvInfoBtn').addEventListener('keydown', e => { if(e.key === 'Escape') hvInfo(false); });
}
