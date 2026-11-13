// grafici.js: grafici uPlot (rosa dei venti, grafico principale e confronti, pila "Impilato", PNG).
// Gli ascoltatori sono in buildChartControls(), chiamata dall'avvio (comune.js).

// ---- ROSA DEI VENTI + VENTO MEDIO VETTORIALE (dalla _table: DVENTO direzione, VVENTO velocita') ----
const _WR_CLASSES = [
  {lo:0.5, hi:2,        c:'#c7e9b4', l:'0.5–2'},
  {lo:2,   hi:4,        c:'#7fcdbb', l:'2–4'},
  {lo:4,   hi:6,        c:'#41b6c4', l:'4–6'},
  {lo:6,   hi:9,        c:'#1d91c0', l:'6–9'},
  {lo:9,   hi:Infinity, c:'#225ea8', l:'≥9'}
];
function windObsCount(t){
  const d = t && t.cols['DVENTO'], s = t && t.cols['VVENTO'];
  if(!d || !s) return 0;
  let n = 0;
  for(let i=0;i<d.length;i++){
    if(d[i]!=null && s[i]!=null && !isNaN(d[i]) && !isNaN(s[i])) n++;
  }
  return n;
}
function updateWindRose(){
  const box = el('windrose');
  const t = currentStation && currentStation._table;
  const dirs = t && t.cols['DVENTO'], sps = t && t.cols['VVENTO'];
  if(!dirs || !sps){ box.innerHTML = ''; return; }
  // conteggi per (16 settori x classe di velocita'), piu' somme vettoriale e scalare
  const grid = Array.from({length:16}, () => new Array(_WR_CLASSES.length).fill(0));
  let n = 0, calm = 0, su = 0, sv = 0, ss = 0;
  for(let i=0;i<dirs.length;i++){
    const d = dirs[i], s = sps[i];
    if(d == null || s == null || isNaN(d) || isNaN(s)) continue;
    n++;
    ss += s;
    const rad = d * Math.PI / 180;
    su += -s * Math.sin(rad);
    sv += -s * Math.cos(rad);          // vettore "verso cui" spira il vento
    if(s < 0.5){ calm++; continue; }
    const sec = Math.round(((d % 360) + 360) % 360 / 22.5) % 16;
    let ci = _WR_CLASSES.findIndex(c => s >= c.lo && s < c.hi);
    if(ci < 0) ci = _WR_CLASSES.length - 1;
    grid[sec][ci]++;
  }
  if(n < 10){
    box.innerHTML = '<div class="hint">Dati di vento insufficienti per la rosa.</div>';
    return;
  }
  let maxPct = 0;
  const secPct = grid.map(cl => {
    const tot = cl.reduce((a,b)=>a+b,0)/n*100;
    if(tot>maxPct) maxPct=tot;
    return tot;
  });
  const cx = 130, cy = 118, R = 92, calmR = 12;
  const step = maxPct <= 10 ? 2 : (maxPct <= 25 ? 5 : 10);
  const gridMax = Math.max(step, Math.ceil(maxPct / step) * step);
  const rOf = pct => calmR + (R - calmR) * pct / gridMax;
  const P = (r, thDeg) => {
    const a = thDeg * Math.PI/180;
    return [(cx + r*Math.sin(a)).toFixed(1), (cy - r*Math.cos(a)).toFixed(1)];
  };
  let svg = '';
  for(let g=step; g<=gridMax; g+=step){
    const r = rOf(g).toFixed(1);
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#d7dee6"/>`;
    svg += `<text x="${cx+2}" y="${(cy - r + 3).toFixed(1)}" font-size="8" fill="#9aa5b1">${g}%</text>`;
  }
  ['N','E','S','O'].forEach((lab,k) => {
    const [x,y] = P(R+11, k*90);
    svg += `<text x="${x}" y="${y}" font-size="11" font-weight="600" fill="#5a6b7b" text-anchor="middle" dominant-baseline="middle">${lab}</text>`;
  });
  const HALF = 10;                       // mezza ampiezza del settore in gradi (22.5 pieno: resta un gap)
  for(let sec=0; sec<16; sec++){
    const th = sec * 22.5, t1 = th - HALF, t2 = th + HALF;
    let acc = 0;
    for(let ci=0; ci<_WR_CLASSES.length; ci++){
      const cnt = grid[sec][ci];
      if(!cnt) continue;
      const p0 = acc/n*100, p1 = (acc+cnt)/n*100;
      acc += cnt;
      const ri = rOf(p0), ro = rOf(p1);
      const [ax,ay] = P(ri,t1), [bx,by] = P(ro,t1), [dcx,dcy] = P(ro,t2), [ex,ey] = P(ri,t2);
      svg += `<path d="M${ax},${ay} L${bx},${by} A${ro.toFixed(1)},${ro.toFixed(1)} 0 0 1 ${dcx},${dcy} `
           + `L${ex},${ey} A${ri.toFixed(1)},${ri.toFixed(1)} 0 0 0 ${ax},${ay} Z" `
           + `fill="${_WR_CLASSES[ci].c}" stroke="#fff" stroke-width="0.4"/>`;
    }
  }
  svg += `<circle cx="${cx}" cy="${cy}" r="${calmR}" fill="#eef2f6" stroke="#d7dee6"/>`
       + `<text x="${cx}" y="${cy+3}" font-size="8" fill="#7a8794" text-anchor="middle">calme</text>`;
  // vento medio vettoriale: freccia dal centro verso la provenienza (come i petali)
  const vspeed = Math.hypot(su, sv) / n, sspeed = ss / n;
  const fromDeg = (Math.atan2(-su, -sv) * 180/Math.PI + 360) % 360;
  if(vspeed > 0.1){
    const [hx,hy] = P(R*0.62, fromDeg);
    svg += `<line x1="${cx}" y1="${cy}" x2="${hx}" y2="${hy}" stroke="#c05621" stroke-width="2"/>`
         + `<circle cx="${hx}" cy="${hy}" r="2.5" fill="#c05621"/>`;
  }
  const legend = _WR_CLASSES.map(c =>
    `<span style="white-space:nowrap"><i style="display:inline-block;width:9px;height:9px;background:${c.c};border:1px solid #bbb;vertical-align:-1px"></i> ${c.l}</span>`
  ).join(' ');
  box.innerHTML =
    `<div class="wr-title">Rosa dei venti <span class="wr-sub">· ${n} osservazioni</span></div>` +
    `<svg viewBox="0 0 260 250" width="100%" style="max-width:300px;display:block;margin:0 auto">${svg}</svg>` +
    `<div class="wr-legend">m/s: ${legend}</div>` +
    `<div class="wr-mean">Vento medio (vettoriale): <b>${vspeed.toFixed(1)} m/s</b> da <b>${windDirHtml(fromDeg)}</b>` +
      ` · media scalare ${sspeed.toFixed(1)} m/s · calme ${(calm/n*100).toFixed(0)}%</div>`;
}

// CONFRONTO SCHEDE: stessa variabile, una serie per ogni stazione aperta in scheda
function renderCompareTabs(label, unit){
  if(unit === undefined){
    const t0 = openTabs.find(t => (unitsByRegion[t.props._region] || {})[label]);
    unit = t0 ? (unitsByRegion[t0.props._region] || {})[label] : '';
  }
  clearChart();
  el('chartstats').textContent = '';
  const tabs = openTabs.filter(t =>
    t.props._table && (t.props._table.cols[label] || []).some(v => v != null));
  if(tabs.length < 2){
    el('chartlegend').innerHTML = '';
    setStatus('Apri in schede almeno 2 stazioni che misurano ' + varLabel(label) + ', poi torna qui.');
    return;
  }
  setStatus('');
  // unita' miste (livelli in cm e in m): tutto in m, con lo zero idrometrico dove c'e'
  const normOf = t => {
    const off = varOffset(label, t.props);
    const um = (unitsByRegion[t.props._region] || {})[label];
    const sc = off ? varScale(label, t.props) : (um === 'cm' ? 0.01 : 1);
    return { off: off || 0, sc };
  };
  const anyCm = tabs.some(t => (unitsByRegion[t.props._region] || {})[label] === 'cm');
  const anyOff = tabs.some(t => varOffset(label, t.props));
  const uLab = anyOff ? 'm s.m.m.' : (anyCm ? 'm' : unit);
  const COLS = ['#2b6cb0','#e53e3e','#2f9e44','#f59f00','#7048e8','#0ca678','#d6336c','#845ef7'];
  const rain = isRainVar(label), dir = isDirVar(label), specs = [];
  let data, full = null;
  if(rain){
    let lo = Infinity, hi = -Infinity;
    tabs.forEach(t => {
      const tb = t.props._table, e = tableEnd(tb, [label]);
      tb.x.forEach(x => { if(x != null && !isNaN(x) && x < lo) lo = x; });
      if(e != null && e > hi) hi = e;
    });
    const from = modeStart(chartMode, lo, hi), to = hi;
    data = uPlot.join(tabs.map((t, k) => {
      const rs = rainSeries(
        t.props._table.x, t.props._table.cols[label] || [], label, from, to, !rawMode(chartMode));
      specs.push({
        label: prettyName(t.props.name || t.props.scode), color: COLS[k % COLS.length],
        kind: 'bars', alpha: 0.45,
        align: rs.align, slot: rs.slot, slotTxt: rs.hourly ? (label === 'PREC' ? 'range' : 'end') : ''
      });
      return [rs.x, rs.y];
    }));
    const X = data[0];
    // fino all'ultima lettura: l'ultima ora resta visibile
    if(X.length) full = [X[0], Math.max(X[X.length - 1], to)];
  } else {
    const xset = new Set();
    tabs.forEach(t => {
      const tb = t.props._table, c = tb.cols[label] || [];
      for(let i=0;i<tb.x.length;i++) if(tb.x[i] != null && c[i] != null) xset.add(tb.x[i]);
    });
    let xs = [...xset].sort((a,b) => a-b);
    if(chartMode !== 'week' && xs.length){
      const from = modeStart(chartMode, xs[0], xs[xs.length - 1]);
      xs = xs.filter(x => x >= from);
    }
    const idx = new Map(xs.map((v,i) => [v,i]));
    data = [xs];
    tabs.forEach((t, k) => {
      const tb = t.props._table, c = tb.cols[label] || [], n = normOf(t);
      const arr = new Array(xs.length).fill(null);
      for(let i=0;i<tb.x.length;i++){
        if(tb.x[i] == null || c[i] == null || !idx.has(tb.x[i])) continue;
        arr[idx.get(tb.x[i])] = Math.round((c[i] * n.sc + n.off) * 1000) / 1000;
      }
      specs.push({
        label: prettyName(t.props.name || t.props.scode), color: COLS[k % COLS.length],
        kind: dir ? 'dots' : 'line', ptSize: 4
      });
      data.push(arr);
    });
    if(xs.length) full = [xs[0], xs[xs.length - 1]];
  }
  const series = [{ value: (u, ts) => ts==null ? '--' : fmtFull(ts) }].concat(specs.map(d => mkSeries(d)));
  const yAx = { grid:{stroke:GRID()}, size:58, label: uLab, labelSize:26, labelGap:4, stroke:AXTX() };
  const axes = [
    { grid:{stroke:GRID()}, stroke:AXTX(), values: (u, ticks) => ticks.map(fmtAxis) },
    dir ? dirAxis(yAx) : yAx
  ];
  const opts = {
    width: chartWidth(), height: chartHeight(), tzDate: TZ_CIV, legend: { show:false },
    scales: {
      x: {
        time:true,
        range: (u, a, b) => (full && a <= full[0] + 1 && b >= data[0][data[0].length - 1] - 1) ? full : [a, b]
      },
      y: yScaleFor(label)
    },
    series, axes, cursor: { drag:{ x:true, y:false }, dataIdx: cursorDataIdx, points:{ show: hoverPt } },
    hooks: { drawClear: [ dayBands ] },
  };
  chart = new uPlot(opts, data, el('chart'));
  addZoomUI(chart, () => full, HOUR);
  el('chartlegend').style.display = '';
  el('chartlegend').innerHTML = series.slice(1).map((sr, k) =>
    '<div class="lg-row"><span class="lg-sw" style="background:' + COLS[k % COLS.length] + '"></span>'
    + sr.label + '</div>').join('');
}

// ------------------------------------------------------------------------------------------------
// GRAFICO (uPlot)
// ------------------------------------------------------------------------------------------------
function clearChart(){
  if(chart){ chart.destroy(); chart = null; }
  if(stackObj){ stackObj.destroy(); stackObj = null; }
  el('chart').innerHTML='';
  el('chartstats').textContent = '';
}

// Larghezza = colonna del grafico (la legenda uPlot e' spenta, la nostra sta a destra). Altezza = solo
// #chart, non #chartwrap: su mobile la legenda va sotto e il wrap e' in colonna.
function chartWidth(){ return Math.max(220, el('chart').clientWidth || (el('chartwrap').clientWidth - 128)); }
function chartHeight(){ return Math.max(180, el('chart').clientHeight || el('chartwrap').clientHeight); }

// giorno+ora compatti per il readout ('19/07 14:30'); fmtDayTimeC prende l'ora civile "come UTC"
function fmtDayTimeC(c){
  const d = new Date(c*1000);
  return pad(d.getUTCDate())+'/'+pad(d.getUTCMonth()+1)+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());
}
function fmtDayTime(ts){ return fmtDayTimeC(civT(ts)); }
const isCompareMode = () => (chartMode === 'compare' || chartMode === 'compare30' || chartMode === 'tabs');
const GRID = () => document.body.classList.contains('dark') ? '#223146' : '#eef2f7';
const AXTX = () => document.body.classList.contains('dark') ? '#c7d3e0' : '#1c2733';

function renderLegend(u){
  const box = el('chartlegend');
  box.innerHTML = '';
  box._idle = null;
  box._rows = null;
  if(chartMode === 'compare30') return;                     // 30 giorni: niente elenco (troppi giorni)
  if(!isCompareMode()){
    // variabile singola: valori e ora in un'etichetta accanto al cursore (legendCursor)
    u._tip = document.createElement('div');
    u._tip.className = 'ctip';
    u.over.appendChild(u._tip);
    return;
  }
  const rows = [];
  for(let i = 1; i < u.series.length; i++){
    const s = u.series[i];
    const stroke = (typeof s.stroke === 'function') ? s.stroke(u, i) : s.stroke;
    const div = document.createElement('div');
    div.className = 'lg';
    div.innerHTML = `<span class="sw" style="background:${stroke||'#888'}"></span>`
                  + `<span class="nm">${s.label || ''}</span><span class="vl"></span>`;
    box.appendChild(div);
    rows.push(div.querySelector('.vl'));
  }
  box._rows = rows;
}
// Valori sotto il cursore. Indice per serie (cursor.idxs): per le barre quella sotto il cursore, per le altre
// il punto valido piu' vicino (serie con orari diversi sono allineate con dei vuoti).
function legendCursor(u){
  if(u !== chart) return;
  const box = el('chartlegend'), idxs = u.cursor.idxs, gi = u.cursor.idx;
  const at = i => (idxs && idxs[i] !== undefined) ? idxs[i] : gi;
  const val = i => {
    const j = at(i), d = u.data[i], v = (j != null && d) ? d[j] : null;
    return (v == null || v === '') ? null : v;
  };
  if(u._tip){
    const tip = u._tip, m = u._m || {}, un = x => x ? ' ' + escHtml(x) : '';
    if(gi == null || u.cursor.left == null || u.cursor.left < 0){ tip.style.display = 'none'; return; }
    const parts = [], v = val(1);
    if(v != null) parts.push('<b class="c1">' + v + un(m.unit1) + '</b>');
    const dw = m.wind && m.wind.dirs[at(1)];
    if(dw != null) parts.push('<span>da ' + windDirHtml(dw) + '</span>');
    if(m.iV2){
      const v2 = val(m.iV2);
      if(v2 != null) parts.push('<b class="c2">' + v2 + un(m.unit2) + '</b>');
    }
    if(m.iCum){
      const c = val(m.iCum);
      if(c != null) parts.push(
        '<span class="c3">tot ' + fmtNum(round2(c - (u.scales.cum.min || 0))) + un(m.unit1) + '</span>');
    }
    const j = at(1),
          tt = (j != null && u.data[0][j] != null) ? slotTimeTxt(u, 1, j)
             : (u.data[0][gi] != null ? fmtDayTime(u.data[0][gi]) : '');
    tip.innerHTML = (parts.length ? parts.join('<i> · </i>') : '<span class="t">nessun dato</span>') +
                    '<div class="t">' + tt + '</div>';
    placeTip(u, tip);
    return;
  }
  if(box._rows){
    for(let i = 1; i < u.series.length; i++){
      // cursore fuori dal grafico: valori "a riposo" se ci sono (pioggia: totale del giorno)
      const v = (gi == null && box._idle) ? box._idle[i-1] : val(i);
      if(box._rows[i-1]) box._rows[i-1].textContent = v == null ? '' : v;
    }
  }
}
// Etichetta in basso a destra del puntatore, dall'altra parte vicino ai bordi; sul telefono SOPRA il punto
// toccato, cosi' il dito non la copre.
function placeTip(u, tip){
  tip.style.display = 'block';
  const l = u.cursor.left, t = u.cursor.top, W = u.over.clientWidth, H = u.over.clientHeight;
  const w = tip.offsetWidth, h = tip.offsetHeight, touch = matchMedia('(pointer:coarse)').matches;
  let x = l + 14, y = touch ? t - h - 40 : t + 16;
  if(x + w > W - 2) x = l - 14 - w;
  if(x < 2) x = Math.min(2, W - w - 2);
  if(y + h > H - 2) y = t - h - 14;
  if(y < 2) y = touch ? Math.min(t + 40, H - h - 2) : 2;
  tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
}

// Asse X: etichetta solo sull'ora tonda (a mezzanotte la data GG/MM): niente "11 11 11 12" con finestre
// strette.
function fmtAxis(ts){
  const d = new Date(civT(ts)*1000);
  if(d.getUTCMinutes() !== 0) return '';
  return d.getUTCHours()===0 ? pad(d.getUTCDate())+'/'+pad(d.getUTCMonth()+1) : String(d.getUTCHours());
}
function fmtFull(ts){
  const d = new Date(civT(ts)*1000);
  return pad(d.getUTCDate())+'/'+pad(d.getUTCMonth()+1)+'/'+d.getUTCFullYear()+' ' +
         pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());
}
// Modo "Confronto": x = secondi da mezzanotte, trattati come epoch 1970 (ora del giorno)
function fmtTod(sec){
  const d = new Date(sec*1000);
  return d.getUTCMinutes()===0 ? String(d.getUTCHours()) : '';
}
function hhmm(sec){
  const d = new Date(sec*1000);
  return pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());
}
function dayLabel(dayIdx){
  const d = new Date(dayIdx*86400*1000);
  return pad(d.getUTCDate())+'/'+pad(d.getUTCMonth()+1);
}
// Tick di uPlot: TZ_CIV per gli istanti veri delle stazioni (tick alla mezzanotte italiana, come le bande dei
// giorni); TZ_UTC dove x e' gia' un'ora "come UTC" (ora del giorno nel Confronto, giorni dello Storico).
const TZ_UTC = ts => uPlot.tzDate(new Date(ts*1000), 'Etc/UTC');
const TZ_CIV = ts => uPlot.tzDate(new Date(civT(ts)*1000), 'Etc/UTC');

function dayBands(u){
  const s = u.scales.x;
  if(s.min == null) return;
  const DAY = 86400, ctx = u.ctx, mid = d => civToUtc(d * DAY);       // mezzanotte italiana del giorno d
  ctx.save();
  ctx.fillStyle = 'rgba(30,45,60,0.045)';
  for(let d = Math.floor(civT(s.min) / DAY); mid(d) < s.max; d++){
    if((((d % 2) + 2) % 2) === 0) continue;
    const x0 = Math.max(mid(d), s.min), x1 = Math.min(mid(d + 1), s.max);
    const px0 = u.valToPos(x0, 'x', true), px1 = u.valToPos(x1, 'x', true);
    ctx.fillRect(px0, u.bbox.top, px1 - px0, u.bbox.height);
  }
  ctx.restore();
}

// LIVIDRO -> quota assoluta (m s.m.m.): il livello e' sommato allo zero idrometrico (zero_idro, dal PDF
// ARPAV) della stazione; vale solo per LIVIDRO e dove lo zero esiste.
function varOffset(v, st){ return (v === 'LIVIDRO' && st && st.zero_idro != null) ? st.zero_idro : 0; }
// Fattore per portare il valore grezzo in metri prima di sommare lo zero: LOM e BZ pubblicano il livello in
// cm (le altre reti in m). units = unita' della regione della stazione (default: quella della stazione
// aperta).
function varScale(v, st, units){
  units = units || currentUnits;
  return (varOffset(v, st) && units[v] === 'cm') ? 0.01 : 1;
}
function varUnit(v, st, units){
  units = units || currentUnits;
  return (v === 'LIVIDRO' && st && st.zero_idro != null) ? 'm s.m.m.' : (units[v] || '');
}
function applyOff(arr, off, scale){
  if(!off) return arr;
  scale = scale || 1;
  return arr.map(y => y == null ? null : Math.round((y * scale + off) * 1000) / 1000);
}

// ------------------------------------------------------------------------------------------------
// PIOGGIA, VENTO, ZOOM NEI GRAFICI
// - Pioggia: sempre barre. Nei 7 e 3 giorni barre ORARIE (somma delle letture; per le cumulate 1-48 h il
//   valore a fine ora), nelle 24 h le letture originali. La lettura al tempo t vale per (t - passo, t].
//   Dove mancano i dati: fascia tratteggiata ("nessun dato" non deve sembrare "zero pioggia"). Pioggia da
//   sola: curva cumulata sull'asse destro, che con lo zoom riparte da zero al bordo sinistro.
// - Direzione del vento: puntini su asse N E S O (la linea saltava fra 359° e 0°).
// - Zoom: trascinamento col mouse, pizzico a due dita sul telefono; "Tutto" torna all'intero periodo.
// ------------------------------------------------------------------------------------------------
const HOUR = 3600, DAY_S = 86400;
// giorno civile italiano dell'istante ts (numero del giorno) e la sua mezzanotte come istante UTC
const civDay = ts => Math.floor(civT(ts) / DAY_S);
const civMidnight = day => civToUtc(day * DAY_S);
// inizio della finestra: MN = mezzanotte di oggi; 24 h e 3 g = a ritroso dalla fine dei dati; 7 g = tutto
function modeStart(mode, lo, hi){
  if(mode === 'mn') return civMidnight(civDay(Date.now() / 1000));
  const span = mode === 'day3' ? 3 * DAY_S : (mode === 'day' ? DAY_S : 0);
  return span ? hi - span : lo;
}
// 24 h e MN: letture originali; 7 e 3 giorni: barre orarie
const rawMode = mode => mode === 'day' || mode === 'mn';
const SECT8 = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const round2 = v => Math.round(v * 100) / 100;
const CUMC = () => document.body.classList.contains('dark') ? '#90cdf4' : '#1a365d';

function withAlpha(c, a){
  if(/^#[0-9a-f]{6}$/i.test(c)) return c + Math.round(a * 255).toString(16).padStart(2, '0');
  const m = /^rgb\((.+)\)$/.exec(c || '');
  return m ? 'rgba(' + m[1] + ',' + a + ')' : c;
}
// barre: align 1 = la barra parte dall'x (x = inizio ora), -1 = finisce all'x (x = ora della lettura)
const rainBars = align => uPlot.paths.bars({ size:[0.9, 60], align: align || 0 });
// asse Y della pioggia da 0, con un po' di margine sopra la barra piu' alta
const rainY = () => ({
  range:(u, mn, mx) => [0, mx > 0 ? Math.max(1, uPlot.rangeNum(0, mx, 0.1, true)[1]) : 1]
});
const dirY = () => ({ range:() => [0, 360] });
const yScaleFor = v => isRainVar(v) ? rainY() : (isDirVar(v) ? dirY() : {});
function dirAxis(a){
  a.splits = () => [0, 90, 180, 270, 360];
  a.values = (u, ticks) => ticks.map(t => ['N', 'E', 'S', 'O', 'N'][Math.round(t / 90)] || '');
  return a;
}
// Serie uPlot da d = {label, color, kind:'line'|'bars'|'dots'|'cum', align, slot, slotTxt, scale, alpha,
// width, pts, ptSize, ptSizeHi, spanGaps}. hi = versione ad alta risoluzione per il PNG. kind, barAlign,
// barSlot e slotTxt restano sulla serie: li usano cursore, legenda e PNG.
function mkSeries(d, hi){
  const s = {
    label: d.label, stroke: d.color, width: d.width || (hi ? 2.5 : 1.5), spanGaps: !!d.spanGaps,
    kind: d.kind || 'line'
  };
  if(d.scale) s.scale = d.scale;
  if(d.kind === 'bars'){
    s.fill = withAlpha(d.color, d.alpha == null ? 0.6 : d.alpha);
    s.points = { show:false };
    s.paths = rainBars(d.align);
    s.barAlign = d.align || 0;
    s.barSlot = d.slot || 0;
    s.slotTxt = d.slotTxt || '';
  } else if(d.kind === 'dots'){
    s.paths = () => null;
    s.points = { show:true, size: hi ? 7 : 4, width:0, fill: d.color, stroke: d.color };
  } else if(d.kind === 'cum'){
    s.width = hi ? 3 : 2;
    s.spanGaps = true;
    s.points = { show:false };
  } else s.points = { show: d.pts == null ? true : d.pts, size: hi ? (d.ptSizeHi || 8) : (d.ptSize || 5) };
  return s;
}
// punto del cursore: niente pallino sulle barre, normale su linee e puntini
function hoverPt(u, si){
  const s = u.series[si];
  if(s.kind === 'bars') return null;
  const pt = document.createElement('div'), sz = (s.points && +s.points.size) || 5;
  pt.style.width = pt.style.height = sz + 'px';
  pt.style.marginLeft = pt.style.marginTop = (-sz / 2) + 'px';
  return pt;
}
// Indice da leggere sotto il cursore per la serie si. Barre: quella che COPRE il cursore (da x a x+passo se
// allineata a sinistra, da x-passo a x se a destra). Altre: il punto valido piu' vicino (salta i vuoti
// lasciati dall'allineamento di serie con orari diversi).
function cursorDataIdx(u, si, ci, xv){
  if(si === 0 || ci == null) return ci;
  const xs = u.data[0], ys = u.data[si], n = xs.length, s = u.series[si], al = s.barAlign;
  if(s.kind === 'bars' && (al === 1 || al === -1)){
    const sl = s.barSlot || Infinity;
    let j = ci;
    if(al === 1){
      while(j + 1 < n && xs[j + 1] <= xv) j++;
      while(j >= 0 && (xs[j] > xv || ys[j] === undefined)) j--;
      return (j >= 0 && xv - xs[j] <= sl) ? j : null;
    }
    while(j > 0 && xs[j - 1] >= xv) j--;
    while(j < n && (xs[j] < xv || ys[j] === undefined)) j++;
    return (j < n && xs[j] - xv <= sl) ? j : null;
  }
  if(ys[ci] !== undefined) return ci;
  let l = ci - 1, r = ci + 1;
  while(l >= 0 && ys[l] === undefined) l--;
  while(r < n && ys[r] === undefined) r++;
  if(l < 0) return r < n ? r : null;
  if(r >= n) return l;
  return (xv - xs[l] <= xs[r] - xv) ? l : r;
}
// Istante della barra/punto j della serie si, per la legenda: barre orarie di pioggia = intervallo
// (21/10 09:00–10:00), cumulate orarie = fine dell'ora, il resto = ora della lettura.
function slotTimeTxt(u, si, j){
  const x = u.data[0][j], s = u.series[si];
  if(x == null) return '';
  // fine ora in ora civile di quell'ora (03:00 CEST, non 02:00 CET)
  const end = civT(x + HOUR - 1) + 1;
  if(s.slotTxt === 'range') return fmtDayTime(x) + '–' + hhmm(end);
  if(s.slotTxt === 'end') return fmtDayTimeC(end);
  return fmtDayTime(x);
}
function gapBands(gaps, hi){
  return u => {
    const s = u.scales.x;
    if(!gaps || !gaps.length || s.min == null) return;
    const ctx = u.ctx, k = ctx.canvas.width / Math.max(1, u.width),
          dark = !hi && document.body.classList.contains('dark');
    const n = Math.max(6, Math.round(7 * k)), c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.strokeStyle = dark ? 'rgba(160,175,195,0.45)' : 'rgba(110,122,138,0.42)';
    g.lineWidth = Math.max(1, 0.9 * k);
    g.beginPath();
    g.moveTo(0, n);
    g.lineTo(n, 0);
    g.moveTo(-1, 1);
    g.lineTo(1, -1);
    g.moveTo(n - 1, n + 1);
    g.lineTo(n + 1, n - 1);
    g.stroke();
    const pat = ctx.createPattern(c, 'repeat');
    ctx.save();
    for(const [a, b] of gaps){
      if(b <= s.min || a >= s.max) continue;
      const p0 = u.valToPos(Math.max(a, s.min), 'x', true),
            p1 = u.valToPos(Math.min(b, s.max), 'x', true);
      const w = Math.max(1, p1 - p0);
      ctx.fillStyle = dark ? 'rgba(150,165,185,0.08)' : 'rgba(110,122,138,0.06)';
      ctx.fillRect(p0, u.bbox.top, w, u.bbox.height);
      ctx.fillStyle = pat;
      ctx.fillRect(p0, u.bbox.top, w, u.bbox.height);
    }
    ctx.restore();
  };
}

function validPts(xs, ys, from, to){
  const X = [], Y = [];
  for(let i = 0; i < xs.length; i++){
    const x = xs[i], y = ys[i];
    if(x == null || isNaN(x) || y == null || isNaN(y) || x < from || x > to) continue;
    X.push(x);
    Y.push(y);
  }
  return { x: X, y: Y };
}
function medianStep(xs){
  const d = [];
  for(let i = 1; i < xs.length; i++){
    const dd = xs[i] - xs[i - 1];
    if(dd > 0) d.push(dd);
  }
  if(!d.length) return 0;
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}
// Serie a linea/puntini: solo le letture valide della grandezza; un null spezza la linea solo dove manca
// davvero un dato (buco > 2,5 passi tipici e > 1 h). Le righe della tabella di ALTRE grandezze (cadenze
// diverse, indici giornalieri) non devono ridurre la linea a puntini.
function lineSeries(xs, ys, from, to){
  const p = validPts(xs, ys, from, to), n = p.x.length;
  if(n < 2) return p;
  const thr = Math.max(2.5 * medianStep(p.x), HOUR), X = [p.x[0]], Y = [p.y[0]];
  for(let i = 1; i < n; i++){
    if(p.x[i] - p.x[i - 1] > thr){
      X.push(Math.round((p.x[i] + p.x[i - 1]) / 2));
      Y.push(null);
    }
    X.push(p.x[i]);
    Y.push(p.y[i]);
  }
  return { x: X, y: Y };
}
function addGap(g, a, b){
  if(b <= a) return;
  const L = g[g.length - 1];
  if(L && a <= L[1]) L[1] = Math.max(L[1], b); else g.push([a, b]);
}
// Ore: la lettura al tempo t va nell'ora che contiene t - 1 s (valore all'inizio ora). sum = somma le letture
// (pioggia per intervallo); altrimenti l'ultima dell'ora (cumulate mobili: valore a fine ora).
function hourSlots(xs, ys, sum){
  const m = new Map();
  for(let i = 0; i < xs.length; i++){
    const h = Math.floor((xs[i] - 1) / HOUR) * HOUR;
    m.set(h, sum ? (m.get(h) || 0) + ys[i] : ys[i]);
  }
  return m;
}
// Serie di pioggia (v = PREC o cumulata PREC1-48) nella finestra [from, to]. hourly = barre orarie, solo se
// le letture sono piu' fitte di un'ora. -> { x, y, align, slot (durata barra, s), hourly, step, gaps }
function rainSeries(xs, ys, v, from, to, hourly){
  const p = validPts(xs, ys, from, to), step = medianStep(p.x), gaps = [];
  if(hourly && step && step < HOUR){
    const m = hourSlots(p.x, p.y, v === 'PREC'), X = [], Y = [];
    const h0 = Math.floor((from - 1) / HOUR) * HOUR, h1 = Math.floor((to - 1) / HOUR) * HOUR;
    for(let h = h0; h <= h1; h += HOUR){
      const val = m.get(h);
      X.push(h);
      Y.push(val == null ? null : round2(val));
      if(val == null) addGap(gaps, Math.max(h, from), Math.min(h + HOUR, to));
    }
    return { x: X, y: Y, align: 1, slot: HOUR, hourly: true, step, gaps };
  }
  // letture originali: la barra finisce all'ora della lettura; buco = oltre max(1,5 passi, 1 h) senza letture
  const X = p.x, Y = p.y, n = X.length, thr = Math.max(1.5 * step, HOUR);
  if(!n) addGap(gaps, from, to);
  else {
    if(X[0] - from > thr) addGap(gaps, from, X[0] - step);
    for(let i = 1; i < n; i++) if(X[i] - X[i - 1] > thr) addGap(gaps, X[i - 1], X[i] - step);
    if(to - X[n - 1] > thr) addGap(gaps, X[n - 1], to);
  }
  return { x: X, y: Y, align: -1, slot: step || HOUR, hourly: false, step, gaps };
}
// pioggia cumulata dall'inizio della finestra (solo PREC): sale dentro ogni barra; ultimo punto a fine
// finestra
function rainCum(rs, to){
  const X = [], Y = [], n = rs.x.length;
  let c = 0;
  if(!n) return null;
  if(rs.hourly){
    for(let i = 0; i < n; i++){
      X.push(rs.x[i]);
      Y.push(round2(c));
      c += rs.y[i] || 0;
    }
    X.push(Math.min(rs.x[n - 1] + HOUR, to));
    Y.push(round2(c));
  } else {
    if(rs.step > 0){
      X.push(rs.x[0] - rs.step);
      Y.push(0);
    }
    for(let i = 0; i < n; i++){
      c += rs.y[i] || 0;
      X.push(rs.x[i]);
      Y.push(round2(c));
    }
  }
  return { x: X, y: Y };
}
// Pioggia cumulata di ogni giorno civile: un tratto per giorno, da zero a mezzanotte, con gli stessi gradini
// della cumulata totale. Il primo giorno, tagliato dal bordo, parte dal valore vero: conta anche le letture
// fra la sua mezzanotte e l'inizio della finestra. Ogni intervallo (a, b] e' del giorno che contiene b - 1 s.
function rainDaily(xs, ys, rs, to){
  const n = rs.x.length, segs = [];
  let seg = null, day = null, c = 0;
  for(let i = 0; i < n; i++){
    const b = rs.hourly ? Math.min(rs.x[i] + HOUR, to) : rs.x[i];
    const d = civDay(b - 1);
    if(d !== day){
      const mid = civMidnight(d);
      c = 0;
      if(seg) seg = { x: [mid], y: [0] };
      else {
        const a = rs.hourly ? rs.x[i] : b - (rs.step || HOUR);
        for(let k = 0; k < xs.length; k++){
          if(xs[k] > mid && xs[k] <= a && ys[k] != null) c += ys[k];
        }
        seg = { x: [Math.max(a, mid)], y: [round2(c)] };
      }
      segs.push(seg);
      day = d;
    }
    c += rs.y[i] || 0;
    seg.x.push(b);
    seg.y.push(round2(c));
  }
  return segs.length ? segs : null;
}
// Linee giornaliere: sull'asse destro come la cumulata, che pero' riparte dal bordo sinistro visibile; per
// questo si disegnano a mano, spostate del minimo della scala, tratteggiate e piu' sottili.
function drawDaily(daily, color, hi){
  return u => {
    const sc = u.scales.cum;
    if(sc.min == null) return;
    const ctx = u.ctx, bb = u.bbox, pr = devicePixelRatio || 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bb.left, bb.top, bb.width, bb.height);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = (hi ? 2 : 1.25) * pr;
    ctx.setLineDash([6 * pr, 4 * pr]);
    daily.forEach(s => {
      ctx.beginPath();
      s.x.forEach((x, i) => {
        const px = u.valToPos(x, 'x', true), py = u.valToPos(sc.min + s.y[i], 'cum', true);
        if(i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.stroke();
    });
    ctx.restore();
  };
}
// uPlot misura l'asse destro sulla sola cumulata: se una linea giornaliera visibile sale piu' in alto, si
// allarga la scala
function dailyTop(u, daily){
  const sx = u.scales.x;
  let top = 0;
  daily.forEach(s => s.x.forEach((x, i) => {
    if((sx.min == null || (x >= sx.min && x <= sx.max)) && s.y[i] > top) top = s.y[i];
  }));
  return top;
}
// dopo uno zoom la scala e' stata calcolata col vecchio intervallo: si ricontrolla
function fitDailyCum(u, daily){
  const sc = u.scales.cum, top = dailyTop(u, daily);
  if(sc.min == null || top <= sc.max - sc.min) return;
  const r = cumY(() => top).range(u, sc.min, sc.max);
  u.setScale('cum', { min: r[0], max: r[1] });
}
// Frecce del vento: dove va (provenienza + 180°) e quanto forte. Nelle 24 h e in MN una per lettura; su 3 e
// 7 giorni una per ora, con la velocita' media e la direzione media vettoriale dell'ora, a meta' ora. Con la
// calma (velocita' 0) la direzione non vale: niente freccia.
function windArrows(xs, sp, dir, from, to, hourly){
  const out = [], hours = new Map();
  for(let i = 0; i < xs.length; i++){
    const x = xs[i], s = sp[i], d = dir[i];
    if(x == null || x < from || x > to || s == null || d == null || !(s > 0)) continue;
    if(!hourly){
      out.push({ x, s, d });
      continue;
    }
    const h = Math.floor((x - 1) / HOUR) * HOUR, r = d * Math.PI / 180;
    const a = hours.get(h) || { n: 0, s: 0, e: 0, nn: 0 };
    a.n++;
    a.s += s;
    a.e += s * Math.sin(r);
    a.nn += s * Math.cos(r);
    hours.set(h, a);
  }
  hours.forEach((a, h) => out.push({
    x: h + HOUR / 2, s: a.s / a.n, d: (Math.atan2(a.e, a.nn) * 180 / Math.PI + 360) % 360
  }));
  return out.sort((p, q) => p.x - q.x);
}
function drawArrows(arrows, color, hi, dense){
  return u => {
    const ctx = u.ctx, bb = u.bbox, pr = devicePixelRatio || 1, sx = u.scales.x;
    const n = (hi ? (dense ? 8 : 11) : (dense ? 4.5 : 6.5)) * pr;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bb.left, bb.top, bb.width, bb.height);
    ctx.clip();
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = (hi ? 2.2 : 1.4) * pr;
    ctx.lineCap = 'round';
    arrows.forEach(a => {
      if(a.x < sx.min || a.x > sx.max) return;
      ctx.save();
      ctx.translate(u.valToPos(a.x, 'x', true), u.valToPos(a.s, 'y', true));
      ctx.rotate((a.d + 180) * Math.PI / 180);
      ctx.beginPath();
      ctx.moveTo(0, n);
      ctx.lineTo(0, -n);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -n - pr);
      ctx.lineTo(-n * 0.55, -n * 0.25);
      ctx.lineTo(n * 0.55, -n * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();
  };
}
function addDailyHooks(hooks, daily, color, hi){
  const add = (k, f) => { hooks[k] = (hooks[k] || []).concat(f); };
  add('draw', drawDaily(daily, color, hi));
  add('ready', u => fitDailyCum(u, daily));
  add('setScale', (u, key) => { if(key === 'x') fitDailyCum(u, daily); });
  return hooks;
}
function niceStep(x){
  const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
// Scala della cumulata: dal valore al bordo sinistro visibile a un numero tondo sopra (con lo zoom riparte da
// 0).
const cumY = extra => ({ range:(u, mn, mx) => {
  if(mn == null) return [0, 1];
  const sp = Math.max(mx - mn, extra ? extra(u) : 0, 1), st = niceStep(sp / 4);
  return [mn, mn + Math.ceil(sp / st - 1e-9) * st];
} });
function cumAxis(hi, color){
  return Object.assign({
    scale:'cum', side:1, grid:{ show:false }, stroke: color, size: hi ? 82 : 50,
    label: 'cumulata (mm)', labelSize: hi ? 32 : 26, labelGap: hi ? 6 : 4,
    splits: (u, ai, mn, mx) => {
      const st = niceStep(Math.max(mx - mn, 1) / 4), out = [];
      for(let k = 0; mn + k * st <= mx + 1e-9; k++) out.push(mn + k * st);
      return out;
    },
    values: (u, ticks) => ticks.map(t => {
      const d = t - u.scales.cum.min;
      return String(+d.toFixed(Math.abs(d % 1) > 1e-9 ? 1 : 0));
    })
  }, hi ? { font: '20px system-ui, sans-serif', labelFont: '700 24px system-ui, sans-serif' } : {});
}

const durTxt = s => (s >= HOUR && s % HOUR === 0) ? (s / HOUR) + ' h' : Math.round(s / 60) + ' min';
function gapHours(gaps, a, b){
  let t = 0;
  (gaps || []).forEach(g => {
    const l = Math.min(g[1], b) - Math.max(g[0], a);
    if(l > 0) t += l;
  });
  return t / HOUR;
}
function prevailingDir(vals){
  const c = new Array(8).fill(0);
  vals.forEach(v => c[Math.round((((v % 360) + 360) % 360) / 45) % 8]++);
  let k = 0;
  for(let i = 1; i < 8; i++) if(c[i] > c[k]) k = i;
  return SECT8[k];
}
// Gradi del centro del settore prevalente (freccia accanto a "prevalente NE"); null se v non e' una direzione
// o non ci sono dati.
function prevailingDeg(v, xs, ys, a, b){
  if(!isDirVar(v)) return null;
  const vals = [];
  for(let i = 0; i < xs.length; i++){
    const x = xs[i], y = ys[i];
    if(x != null && y != null && !isNaN(y) && x >= a && x <= b) vals.push(y);
  }
  return vals.length ? SECT8.indexOf(prevailingDir(vals)) * 45 : null;
}
function setStats(node, txt, deg){
  if(deg == null) node.textContent = txt; else node.innerHTML = 'prevalente ' + windDirHtml(deg);
}
// Statistiche della serie (xs, ys) di v sull'intervallo [a, b] (segue lo zoom). rs = info pioggia (durata
// delle barre, buchi); unit = '' per non ripetere l'unita'.
function statsText(v, unit, xs, ys, a, b, rs){
  const vals = [];
  for(let i = 0; i < xs.length; i++){
    const x = xs[i], y = ys[i];
    if(x == null || y == null || isNaN(y) || x < a || x > b) continue;
    vals.push(y);
  }
  const un = unit ? ' ' + unit : '', gh = rs ? Math.round(gapHours(rs.gaps, a, b)) : 0;
  const gap = gh >= 1 ? ' · ' + gh + ' h senza dati' : '';
  if(!vals.length) return 'nessun dato' + gap;
  let mn = Infinity, mx = -Infinity, s = 0;
  vals.forEach(y => {
    if(y < mn) mn = y;
    if(y > mx) mx = y;
    s += y;
  });
  if(isDirVar(v)) return 'prevalente ' + prevailingDir(vals);
  if(v === 'PREC') return 'totale ' + fmtNum(round2(s)) + un + ' · max ' + fmtNum(mx) + un +
                          ' in ' + durTxt((rs && rs.slot) || HOUR) + gap;
  if(isRain(v)) return 'max ' + fmtNum(mx) + un + gap;
  return 'min ' + fmtNum(mn, v) + ' · max ' + fmtNum(mx, v) +
         ' · media ' + fmtNum(round2(s / vals.length), v) + un;
}

// ZOOM: trascinamento col mouse (gia' in uPlot); sul telefono pizzico a due dita e trascinamento orizzontale
// a un dito (solo se zoomato: in verticale la pagina scorre). Pulsante "Tutto" quando e' zoomato. full() =
// [min, max] dell'intero periodo; minSpan = intervallo minimo (s); withBtn = false: niente pulsante.
function addZoomUI(u, full, minSpan, withBtn){
  const over = u.over;
  over.style.touchAction = 'pan-y';
  let btn = null;
  if(withBtn !== false){
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'zoomall';
    btn.textContent = 'Tutto';
    btn.title = 'Mostra tutto il periodo';
    btn.style.display = 'none';
    ['mousedown', 'touchstart'].forEach(ev =>
      btn.addEventListener(ev, e => e.stopPropagation(), { passive:true }));
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const f = full();
      if(f) u.setScale('x', { min: f[0], max: f[1] });
    });
    over.appendChild(btn);
  }
  const zoomed = () => {
    const f = full(), s = u.scales.x;
    return !!f && s.min != null && (s.min > f[0] + 1 || s.max < f[1] - 1);
  };
  const sync = () => { if(btn) btn.style.display = zoomed() ? '' : 'none'; };
  (u.hooks.setScale = u.hooks.setScale || []).push((uu, key) => { if(key === 'x') sync(); });
  const setX = (mn, mx) => {
    const f = full();
    if(!f) return;
    const sp = Math.max(Math.min(mx - mn, f[1] - f[0]), Math.min(minSpan || 0, f[1] - f[0])),
          c = (mn + mx) / 2;
    mn = c - sp / 2;
    mx = c + sp / 2;
    if(mn < f[0]){ mx += f[0] - mn; mn = f[0]; }
    if(mx > f[1]){ mn -= mx - f[1]; mx = f[1]; }
    u.setScale('x', { min: Math.max(mn, f[0]), max: Math.min(mx, f[1]) });
  };
  let g = null;
  const relX = t => t.clientX - over.getBoundingClientRect().left;
  over.addEventListener('touchstart', e => {
    const s = u.scales.x;
    if(e.touches.length === 2){
      const a = relX(e.touches[0]), b = relX(e.touches[1]);
      g = { k: 2, va: u.posToVal(a, 'x'), vb: u.posToVal(b, 'x') };
    } else if(e.touches.length === 1) g = {
      k: 1, x0: e.touches[0].clientX, y0: e.touches[0].clientY, mn: s.min, mx: s.max, dir: null
    };
  }, { passive:true });
  over.addEventListener('touchmove', e => {
    if(!g) return;
    if(g.k === 2 && e.touches.length === 2){
      e.preventDefault();
      const a = relX(e.touches[0]), b = relX(e.touches[1]);
      if(Math.abs(b - a) < 12) return;
      const vpp = (g.vb - g.va) / (b - a), mn = g.va - a * vpp;
      setX(mn, mn + over.clientWidth * vpp);
    } else if(g.k === 1 && e.touches.length === 1){
      const dx = e.touches[0].clientX - g.x0, dy = e.touches[0].clientY - g.y0;
      if(!g.dir){
        if(Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      if(g.dir !== 'h' || !zoomed()) return;
      e.preventDefault();
      const sh = -dx * (g.mx - g.mn) / Math.max(1, over.clientWidth);
      setX(g.mn + sh, g.mx + sh);
    }
  }, { passive:false });
  over.addEventListener('touchend', e => {
    if(!e.touches.length || (g && g.k === 2)) g = null;
  }, { passive:true });
  sync();
}

// Fine della finestra: l'ultima riga con una misura diretta o con un valore delle variabili mostrate. Le
// righe con soli indici giornalieri (GDD/ET0 alle 12 solari) stanno "nel futuro" fino a mezzogiorno: non
// devono allungare l'asse ne' far sembrare mancanti le ultime ore di pioggia.
function tableEnd(t, vars){
  const cols = t.header.slice(1).filter(v => varCat(v) === 'dirette')
                .concat(vars.filter(v => v && t.cols[v]));
  for(let i = t.x.length - 1; i >= 0; i--){
    const x = t.x[i];
    if(x == null || isNaN(x)) continue;
    if(cols.some(v => t.cols[v] && t.cols[v][i] != null)) return x;
  }
  return null;
}

// grafico principale: 'week' (7gg), 'day3' (3gg), 'day' (24h); 'compare'/'compare30' -> renderCompare
function renderChart(label){
  clearChart();
  if(stackMode){ renderStackView(); return; }
  // La colonna a destra c'e' solo nel Confronto 7 giorni (elenco dei giorni con i valori); il confronto fra
  // schede la gestisce da se', nei 30 giorni sarebbe troppo lunga. Va decisa PRIMA di creare il grafico.
  el('chartlegend').style.display = chartMode === 'compare' ? '' : 'none';
  const unit = varUnit(label, currentStation);
  if(chartMode === 'compare' || chartMode === 'compare30'){
    const t = (chartMode === 'compare30') ? currentStation._table30 : currentStation._table;
    el('chartstats').textContent = '';
    if(t) renderCompare(t, label, unit);
    return;
  }
  if(chartMode === 'tabs'){ renderCompareTabs(label, unit); return; }
  const v2 = (currentVar2 && currentVar2 !== label) ? currentVar2 : null;   // 2ª variabile (asse dx, rossa)
  const m = mainModel(currentStation, label, v2, chartMode);
  chart = new uPlot(mainOpts(m, { w: chartWidth(), h: chartHeight() }), m.data, el('chart'));
  chart._m = m;
  chart._hi = (W, H) => mainOpts(m, { w: W, h: H, hi: true });
  renderLegend(chart);
  addZoomUI(chart, () => m.win, HOUR);
  mainStats(chart);
}
function mainModel(st, v, v2, mode){
  const t = st._table, arrows = v === WARROW;
  if(arrows){
    v = 'VVENTO';
    v2 = null;
  }
  let lo = Infinity, hi = -Infinity;
  for(const x of t.x) if(x != null && !isNaN(x)){
    if(x < lo) lo = x;
    if(x > hi) hi = x;
  }
  const end = tableEnd(t, [v, v2]);
  if(end != null) hi = end;
  const ok = lo !== Infinity && hi >= lo, from = ok ? modeStart(mode, lo, hi) : 0;
  // MN appena dopo mezzanotte, senza letture: almeno un'ora vuota
  const to = ok ? (mode === 'mn' ? Math.max(hi, from + HOUR) : hi) : 0;
  const one = vv => {
    const ys = applyOff(t.cols[vv] || [], varOffset(vv, st), varScale(vv, st));
    if(isRainVar(vv)){
      const rs = rainSeries(t.x, ys, vv, from, to, !rawMode(mode));
      return { v: vv, kind: 'bars', x: rs.x, y: rs.y, rs, ys };
    }
    const ls = lineSeries(t.x, ys, from, to);
    return { v: vv, kind: isDirVar(vv) ? 'dots' : 'line', x: ls.x, y: ls.y };
  };
  const s1 = one(v), s2 = v2 ? one(v2) : null;
  // cumulata solo con la pioggia da sola (l'asse destro e' libero)
  const cum = (!s2 && v === 'PREC') ? rainCum(s1.rs, to) : null;
  // in MN la linea del giorno coinciderebbe con la cumulata
  const daily = (cum && mode !== 'mn') ? rainDaily(t.x, s1.ys, s1.rs, to) : null;
  let wind = null;
  if(arrows){
    const dir = t.cols.DVENTO || [], at = new Map();
    t.x.forEach((x, i) => { if(x != null && dir[i] != null) at.set(x, dir[i]); });
    const sp = applyOff(t.cols.VVENTO || [], varOffset(v, st), varScale(v, st));
    wind = {
      arrows: windArrows(t.x, sp, dir, from, to, !rawMode(mode)), dense: rawMode(mode),
      dirs: s1.x.map(x => at.has(x) ? at.get(x) : null)
    };
  }
  const tabs = [[s1.x, s1.y]];
  if(s2) tabs.push([s2.x, s2.y]);
  if(cum) tabs.push([cum.x, cum.y]);
  // con orari diversi i vuoti restano "undefined"
  let data = tabs.length > 1 ? uPlot.join(tabs) : [s1.x, s1.y];
  // MN senza letture di oggi: due punti vuoti tengono l'asse del tempo da mezzanotte
  if(mode === 'mn' && !data[0].length) data = [[from, to]].concat(data.slice(1).map(() => [null, null]));
  const X = data[0];
  return {
    st, v, v2, s1, s2, cum, daily, wind, data,
    win: mode === 'mn' ? [from, to] : (X.length ? [X[0], X[X.length - 1]] : null),
    gaps: [].concat(s1.rs ? s1.rs.gaps : [], s2 && s2.rs ? s2.rs.gaps : []),
    iV2: s2 ? 2 : null, iCum: cum ? (s2 ? 3 : 2) : null,
    unit1: varUnit(v, st), unit2: v2 ? varUnit(v2, st) : ''
  };
}
// opzioni uPlot del grafico principale; o = {w, h, hi}. hi = PNG (font grandi, niente cursore)
function mainOpts(m, o){
  const hi = !!o.hi, fnt = hi ? { font: '20px system-ui, sans-serif' } : {};
  const lab = hi ? { labelFont: '700 24px system-ui, sans-serif', labelSize: 32, labelGap: 6 }
                 : { labelSize: 26, labelGap: 4 };
  const grid = hi ? '#e3e9f0' : GRID(), ax = hi ? '#33475a' : AXTX(),
        C1 = '#2b6cb0', C2 = '#e53e3e', CC = hi ? '#1a365d' : CUMC();
  const ser = (s, color, scale) => mkSeries({
    label: varLabel(s.v), color, kind: s.kind, scale,
    align: s.rs && s.rs.align, slot: s.rs && s.rs.slot,
    slotTxt: (s.rs && s.rs.hourly) ? (s.v === 'PREC' ? 'range' : 'end') : ''
  }, hi);
  const yAxis = (s, scale, color, unit, right) => {
    const a = Object.assign({
      scale, grid: right ? { show:false } : { stroke: grid }, size: hi ? 82 : 58, label: unit, stroke: color
    }, lab, fnt);
    if(right) a.side = 1;
    return isDirVar(s.v) ? dirAxis(a) : a;
  };
  const s1 = m.wind
    ? mkSeries({
        label: varLabel(m.v), color: withAlpha(C1, 0.45), scale: 'y', pts: false, width: hi ? 1.6 : 1
      }, hi)
    : ser(m.s1, C1, 'y');
  const series = [{ value: (u, ts) => ts == null ? '--' : fmtFull(ts) }, s1];
  const axes = [
    Object.assign({ grid:{ stroke: grid }, stroke: ax, values: (u, ticks) => ticks.map(fmtAxis) },
                  hi ? { size: 46 } : {}, fnt),
    yAxis(m.s1, 'y', (hi && !m.s2 && !m.cum) ? '#33475a' : C1, m.unit1, false)
  ];
  const windY = { range: (u, mn, mx) => [0, Math.max(1, (mx || 0) * 1.15)] };
  const scales = { y: m.wind ? windY : yScaleFor(m.v) };
  if(m.s2){
    series.push(ser(m.s2, C2, 'y2'));
    axes.push(yAxis(m.s2, 'y2', C2, m.unit2, true));
    scales.y2 = yScaleFor(m.v2);
  }
  if(m.cum){
    series.push(mkSeries({ label: 'Cumulata', color: CC, kind: 'cum', scale: 'cum' }, hi));
    axes.push(cumAxis(hi, CC));
    scales.cum = cumY(m.daily && (u => dailyTop(u, m.daily)));
  }
  // Un intervallo piu' stretto della finestra e' uno zoom e va accettato; il resto torna alla finestra
  // intera.
  const w = m.win;
  scales.x = {
    time:true,
    range: (u, a, b) => !w ? [a, b] : (w[0] === w[1] ? [w[0] - HOUR, w[1] + HOUR]
      : ((a > w[0] + 1 || b < w[1] - 1) ? [a, b] : [w[0], w[1]]))
  };
  const hooks = hi ? { drawClear: [dayBands, gapBands(m.gaps, true)] }
                   : { drawClear: [dayBands, gapBands(m.gaps)], setCursor: [legendCursor],
                       setScale: [(u, key) => { if(key === 'x') mainStats(u); }] };
  if(m.daily) addDailyHooks(hooks, m.daily, CC, hi);
  if(m.wind) hooks.draw = (hooks.draw || []).concat(drawArrows(m.wind.arrows, C1, hi, m.wind.dense));
  return {
    width: o.w, height: o.h, tzDate: TZ_CIV, legend: { show:false }, series, axes, scales, hooks,
    cursor: hi ? { show:false }
               : { drag:{ x:true, y:false }, dataIdx: cursorDataIdx, points:{ show: hoverPt } }
  };
}
// statistiche sotto il grafico; con la temperatura anche i record storici
function mainStats(u){
  const m = u._m;
  if(!m || u !== chart) return;            // un grafico appena sostituito non scrive piu'
  const sx = u.scales.x, a = sx.min == null ? -Infinity : sx.min, b = sx.max == null ? Infinity : sx.max;
  let txt = statsText(m.v, m.unit1, m.s1.x, m.s1.y, a, b, m.s1.rs);
  const clima = _climaCache[m.st._region], ce = clima && clima[m.st.scode];
  if(m.v === 'TEMP' && ce && ce.records){
    const r = ce.records, rb = [];
    if(r.tmax) rb.push('max ' + r.tmax.val + '°');
    if(r.tmin) rb.push('min ' + r.tmin.val + '°');
    if(rb.length) txt += '  ·  record storici: ' + rb.join(' / ');
  }
  setStats(el('chartstats'), txt, prevailingDeg(m.v, m.s1.x, m.s1.y, a, b));
}

// Modo 'Confronto': una curva grigia per ogni giorno, sovrapposte per ora del giorno; oggi in blu sopra.
// Pioggia: curva CUMULATA dalla mezzanotte (parte da 0 e arriva al totale del giorno); direzione: puntini.
function renderCompare(t, label, unit){
  const ys = applyOff(t.cols[label] || [], varOffset(label, currentStation), varScale(label, currentStation));
  const rain = label === 'PREC', dir = isDirVar(label);
  const byDay = new Map();
  if(rain){
    // la lettura al tempo t vale per (t - passo, t]: quella delle 00:00 chiude il giorno prima (ore 24)
    const p = validPts(t.x, ys, -Infinity, Infinity), run = new Map();
    for(let i = 0; i < p.x.length; i++){
      const cx = civT(p.x[i]), day = Math.floor((cx - 1) / DAY_S), c = (run.get(day) || 0) + p.y[i];
      run.set(day, c);
      if(!byDay.has(day)) byDay.set(day, new Map([[0, 0]]));
      byDay.get(day).set(cx - day * DAY_S, round2(c));
    }
  } else {
    for(let i=0;i<t.x.length;i++){
      const y = ys[i];
      if(y == null || t.x[i] == null) continue;
      const cx = civT(t.x[i]), day = Math.floor(cx / DAY_S), tod = cx - day*DAY_S;   // giorno e ora italiani
      if(!byDay.has(day)) byDay.set(day, new Map());
      byDay.get(day).set(tod, y);
    }
  }
  // Con la finestra mobile (168 h / 30 gg) il giorno piu' vecchio e' parziale (parte dall'ora attuale): si
  // tengono i giorni la cui mezzanotte cade nella finestra, cosi' ogni linea parte da mezzanotte, e SEMPRE il
  // corrente (parziale in coda per natura).
  const xv = t.x.filter(v => v != null);
  const firstFull = xv.length ? Math.ceil(civT(Math.min.apply(null, xv)) / DAY_S) : 0;
  const allDayKeys = [...byDay.keys()];
  const maxDay = allDayKeys.length ? Math.max.apply(null, allDayKeys) : 0;
  const days = allDayKeys.filter(d => d >= firstFull || d === maxDay).sort((a,b) => a-b);
  if(!days.length){
    chart = new uPlot(
      {width:chartWidth(),height:chartHeight(),legend:{show:false},series:[{},{}]}, [[],[]], el('chart'));
    renderLegend(chart);
    return;
  }
  const today = days[days.length-1];
  const nGrey = days.length - 1;
  const todSet = new Set();
  days.forEach(d => byDay.get(d).forEach((v,tod) => todSet.add(tod)));
  const X = [...todSet].sort((a,b) => a-b);
  const specs = [], data = [X];
  days.forEach((day, idx) => {
    const m = byDay.get(day), isToday = day === today;
    let color;
    if(isToday) color = '#2b6cb0';
    else {
      const frac = nGrey <= 1 ? 1 : idx / (nGrey - 1);       // 0 = piu' vecchio ... 1 = piu' recente
      const l = Math.round(206 - frac * 96);
      color = `rgb(${l},${l},${l})`;
    }
    // spanGaps: la serie di oggi (a griglia piu' rada) resta una linea continua e visibile
    specs.push({
      label: isToday ? 'Oggi' : dayLabel(day), color, isToday, spanGaps: true, pts: false,
      kind: dir ? 'dots' : 'line'
    });
    data.push(X.map(tod => m.has(tod) ? m.get(tod) : null));
  });
  const totals = rain ? days.map(d => {
    let v = 0;
    byDay.get(d).forEach(c => { if(c > v) v = c; });
    return round2(v);
  }) : null;
  const full = rain ? [0, DAY_S] : [X[0], X[X.length - 1]];
  const opts = hi => {
    const fnt = hi ? { font: '20px system-ui, sans-serif' } : {}, grid = hi ? '#e3e9f0' : GRID();
    const yAx = Object.assign({
      grid:{ stroke: grid }, size: hi ? 82 : 58, label: unit, labelSize: hi ? 32 : 26, labelGap: hi ? 6 : 4
    }, hi ? { stroke:'#33475a', labelFont:'700 24px system-ui, sans-serif' } : {}, fnt);
    return {
      width: chartWidth(), height: chartHeight(), tzDate: TZ_UTC, legend: { show:false },
      // pioggia: l'asse va da 00 a 24 e parte da 0 mm
      scales: {
        x: rain ? { time:true, range: (u, a, b) => (a <= 1 && b >= DAY_S - HOUR - 1) ? [0, DAY_S] : [a, b] }
                : { time:true },
        y: yScaleFor(label)
      },
      series: [{ value: (u, ts) => ts==null ? '--' : hhmm(ts) }].concat(specs.map(d =>
        mkSeries(Object.assign({}, d, { width: d.isToday ? (hi ? 3 : 2.5) : (hi ? 1.5 : 1.2) }), hi))),
      axes: [
        Object.assign({ grid:{ stroke: grid }, values: (u, ticks) => ticks.map(fmtTod) },
                      hi ? { stroke:'#33475a', size:46 } : {}, fnt),
        dir ? dirAxis(yAx) : yAx
      ],
      cursor: hi ? { show:false }
                 : { drag:{ x:true, y:false }, dataIdx: cursorDataIdx, points:{ show: hoverPt } },
      hooks: hi ? {} : { setCursor: [ legendCursor ] },
    };
  };
  chart = new uPlot(opts(false), data, el('chart'));
  chart._hi = (W, H) => Object.assign(opts(true), { width: W, height: H });
  renderLegend(chart);
  addZoomUI(chart, () => full, HOUR);
  if(rain){
    const box = el('chartlegend');
    if(box._rows){
      box._idle = totals;
      box._rows.forEach((r, i) => { r.textContent = totals[i]; });
    }
    let bi = 0;
    totals.forEach((v, i) => { if(v > totals[bi]) bi = i; });
    const tot = totals.reduce((a, b) => a + b, 0), un = unit ? ' ' + unit : '';
    el('chartstats').textContent = 'cumulata da mezzanotte · totale ' + fmtNum(round2(tot)) + un
      + (totals[bi] > 0
         ? ' · più piovoso ' + (days[bi] === today ? 'oggi' : dayLabel(days[bi])) +
           ' (' + fmtNum(totals[bi]) + un + ')'
         : '');
  }
}

// ------------------------------------------------------------------------------------------------
// PILA DI GRAFICI ("Impilato"): un pannello uPlot per variabile, asse del tempo condiviso, cursore e
// zoom sincronizzati. Il motore (createStack) non dipende dalla scheda stazione.
// ------------------------------------------------------------------------------------------------
const STACK_COLORS = ['#2b6cb0', '#e53e3e', '#2f9e44', '#f59f00', '#7048e8', '#0ca678'];
const STACK_MAX = 4;
let _stackSeq = 0;
const isSumVar = v => v === 'PREC';            // pioggia per intervallo: totale e cumulata (non le 1-48 h)
const STACK_RGUT = 50;                         // spazio a destra per l'asse cumulata, uguale in ogni pannello

function stackWindow(t, mode, vars){
  let mn = Infinity, mx = -Infinity;
  for(const v of t.x){
    if(v != null){
      if(v < mn) mn = v;
      if(v > mx) mx = v;
    }
  }
  if(mn === Infinity) return null;
  const end = tableEnd(t, vars || []);           // non le righe "nel futuro" dei soli indici giornalieri
  if(end != null && end >= mn) mx = end;
  if(mode === 'mn'){
    const lo = modeStart(mode);
    return [lo, Math.max(mx, lo + HOUR)];
  }
  const span = mode === 'day' ? 86400 : (mode === 'day3' ? 3*86400 : 0);
  const lo = span ? Math.max(mn, mx - span) : mn;
  return lo === mx ? [lo - 3600, mx + 3600] : [lo, mx];
}
function stackPanelH(n){
  const mob = matchMedia('(max-width:720px)').matches;
  return mob ? (n <= 2 ? 150 : 128) : (n === 1 ? 300 : (n === 2 ? 210 : 165));
}

// Opzioni uPlot di UN pannello. p = {v,label,color,kind,rs,cum,gaps,npts}; o =
// {w,h,last,win,hi,sync,hooks,rgut}. hi = versione ad alta risoluzione per il PNG (font grandi, niente
// cursore). rgut = spazio a destra per l'asse della cumulata: i pannelli senza cumulata lo lasciano vuoto,
// cosi' gli assi del tempo restano allineati.
function stackPanelOpts(p, o){
  const hi = !!o.hi;
  // niente 'font: undefined': uPlot lo prenderebbe alla lettera
  const fnt = hi ? { font: '20px system-ui, sans-serif' } : {};
  const grid = hi ? '#e3e9f0' : GRID(), ax = hi ? '#33475a' : AXTX(), CC = hi ? '#1a365d' : CUMC();
  const series = [
    { value:(u, ts) => ts == null ? '--' : fmtFull(ts) },
    mkSeries({
      label: p.label, color: p.color, kind: p.kind, align: p.rs && p.rs.align, slot: p.rs && p.rs.slot,
      slotTxt: (p.rs && p.rs.hourly) ? (p.v === 'PREC' ? 'range' : 'end') : '',
      pts: p.npts <= 400, ptSize: 3, ptSizeHi: 6
    }, hi)
  ];
  const axX = o.last
    ? Object.assign({
        grid:{stroke:grid}, stroke:ax, size: hi ? 46 : 30, values:(u, ticks) => ticks.map(fmtAxis)
      }, fnt)
    : { grid:{stroke:grid}, size:6, ticks:{show:false}, values:(u, ticks) => ticks.map(() => '') };
  const axY = Object.assign({ grid:{stroke:grid}, size: hi ? 82 : 58, stroke:p.color }, fnt);
  const axes = [ axX, isDirVar(p.v) ? dirAxis(axY) : axY ];
  const scales = {
    // Un intervallo piu' STRETTO della finestra e' uno zoom (trascinamento) e va accettato; uguale o piu'
    // ampio (dati iniziali, doppio clic) torna alla finestra intera.
    x:{ time:true, range:(u, a, b) => (a > o.win[0] + 1 || b < o.win[1] - 1) ? [a, b] : o.win },
    y: yScaleFor(p.v) };
  const rg = (o.rgut || 0) * (hi ? 82 / STACK_RGUT : 1);
  const h = hi ? { drawClear:[dayBands, gapBands(p.gaps, true)] } : o.hooks;
  if(p.cum){
    series.push(mkSeries({ label: 'Cumulata', color: CC, kind: 'cum', scale: 'cum' }, hi));
    const ca = cumAxis(hi, CC);
    ca.size = rg;
    ca.label = null;
    ca.labelSize = 0;
    axes.push(ca);
    scales.cum = cumY(p.daily && (u => dailyTop(u, p.daily)));
  }
  return {
    width:o.w, height:o.h, tzDate:TZ_CIV, legend:{ show:false },
    padding:[hi ? 10 : 6, (hi ? 14 : 8) + (p.cum ? 0 : rg), 0, 0],
    scales, series, axes,
    // cursore: solo la linea verticale (fra variabili diverse la orizzontale non ha senso); sincronizza
    // l'asse X
    cursor: hi ? { show:false } : {
      y:false, drag:{ x:true, y:false }, sync:{ key:o.sync, setSeries:false, scales:['x', null] },
      dataIdx: cursorDataIdx, points:{ show: hoverPt }
    },
    hooks: p.daily ? addDailyHooks(Object.assign({}, h), p.daily, CC, hi) : h
  };
}

// cfg = { station, table, vars:[...], mode:'week'|'day3'|'day', onRemove:fn(v) }
function createStack(host, cfg){
  const st = cfg.station, t = cfg.table, units = unitsByRegion[st._region] || {};
  const vars = cfg.vars, n = vars.length, hourly = !rawMode(cfg.mode || 'week');
  const win0 = stackWindow(t, cfg.mode || 'week', vars);
  host.innerHTML = '';
  if(!win0){
    host.innerHTML = '<div class="stk-note">Nessun dato nel periodo.</div>';
    return { panels:[], destroy(){ host.innerHTML = ''; }, resize(){} };
  }
  // con barre orarie la finestra parte dall'inizio della prima ora (la prima barra resta intera)
  const win = (hourly && vars.some(isRainVar)) ? [Math.floor((win0[0] - 1) / HOUR) * HOUR, win0[1]] : win0;
  const rgut = vars.some(isSumVar) ? STACK_RGUT : 0;
  const sync = uPlot.sync('stk' + (++_stackSeq)).key;
  const ph = stackPanelH(n), AX = 30;
  const root = document.createElement('div');
  root.className = 'stk';
  host.appendChild(root);
  const timeEl = document.createElement('div');
  timeEl.className = 'stk-time';
  root.appendChild(timeEl);
  const panels = [];
  let ready = false, zooming = false;
  const width = () => Math.max(220, root.clientWidth || host.clientWidth || 600);

  function stats(p){
    const u = p.u, a = u.scales.x.min, b = u.scales.x.max;
    let last = null;
    for(let i = 0; i < p.sx.length; i++){
      const x = p.sx[i], y = p.sy[i];
      if(x != null && y != null && !isNaN(y) && x >= a && x <= b) last = y;
    }
    p.lastTxt = last == null ? '' : fmtNum(last, p.v);
    p.statTxt = statsText(p.v, '', p.sx, p.sy, a, b, p.rs);
    p.statDeg = prevailingDeg(p.v, p.sx, p.sy, a, b);
    setStats(p.hs, p.statTxt, p.statDeg);
    if(p.cum){
      const c = document.createElement('span');
      c.className = 'stk-cum';
      c.innerHTML = '<i></i>cumulata';
      c.querySelector('i').style.background = CUMC();
      p.hs.appendChild(c);
    }
    if(p.hv.classList.contains('idle') || !p.hv.textContent) {
      p.hv.textContent = p.lastTxt;
      p.hv.classList.add('idle');
    }
  }
  function onCursor(u){
    const p = panels.find(q => q.u === u);
    if(!p) return;
    const ix = u.cursor.idxs, j = (ix && ix[1] !== undefined) ? ix[1] : u.cursor.idx,
          y = j != null ? u.data[1][j] : null;
    if(y != null){
      p.hv.textContent = fmtNum(y, p.v);
      p.hv.classList.remove('idle');
    } else {
      p.hv.textContent = p.lastTxt;
      p.hv.classList.add('idle');
    }
    if(p === panels[0]) timeEl.textContent = (j != null && u.data[0][j] != null) ? slotTimeTxt(u, 1, j) : '';
  }
  function onScale(u, key){
    if(key !== 'x' || !ready || zooming) return;
    zooming = true;
    const sx = u.scales.x;
    panels.forEach(q => {
      if(q.u !== u && (q.u.scales.x.min !== sx.min || q.u.scales.x.max !== sx.max))
        q.u.setScale('x', { min:sx.min, max:sx.max });
    });
    zooming = false;
    panels.forEach(stats);
  }

  vars.forEach((v, i) => {
    const color = STACK_COLORS[i % STACK_COLORS.length], last = i === n - 1;
    const ys = applyOff(t.cols[v] || [], varOffset(v, st), varScale(v, st, units));
    let npts = 0;
    for(let k = 0; k < ys.length; k++) if(ys[k] != null && t.x[k] >= win[0] && t.x[k] <= win[1]) npts++;
    const unit = varUnit(v, st, units);
    const p = {
      v, label: varLabel(v), unit, color, kind: isRainVar(v) ? 'bars' : (isDirVar(v) ? 'dots' : 'line'),
      isSum: isSumVar(v), npts, lastTxt:'', statTxt:'', gaps: [], cum: false
    };
    if(isRainVar(v)){            // pioggia: barre orarie (7 e 3 giorni), buchi tratteggiati, cumulata PREC
      p.rs = rainSeries(t.x, ys, v, win0[0], win0[1], hourly);
      p.gaps = p.rs.gaps;
      p.sx = p.rs.x;
      p.sy = p.rs.y;
      const cum = p.isSum ? rainCum(p.rs, win0[1]) : null;
      p.cum = !!cum;
      p.daily = (cum && cfg.mode !== 'mn') ? rainDaily(t.x, ys, p.rs, win0[1]) : null;
      p.data = cum ? uPlot.join([[p.rs.x, p.rs.y], [cum.x, cum.y]]) : [p.rs.x, p.rs.y];
    } else {
      const ls = lineSeries(t.x, ys, win[0], win[1]);
      p.sx = ls.x;
      p.sy = ls.y;
      p.data = [ls.x, ls.y];
    }
    const box = document.createElement('div');
    box.className = 'stk-p';
    box.innerHTML = '<div class="stk-h"><i class="sw"></i><b></b><span class="un"></span><span class="stk-v idle"></span>'
                  + '<span class="stk-s"></span><button class="stk-x" title="Rimuovi">×</button></div>'
                  + '<div class="stk-c"></div>';
    box.querySelector('.sw').style.background = color;
    box.querySelector('b').textContent = p.label;
    box.querySelector('.un').textContent = unit ? '(' + unit + ')' : '';
    p.hv = box.querySelector('.stk-v');
    p.hs = box.querySelector('.stk-s');
    box.querySelector('.stk-x').onclick = () => cfg.onRemove(v);
    root.appendChild(box);
    const opts = stackPanelOpts(p, {
      w:width(), h: ph + (last ? AX : 0), last, win, sync, rgut,
      hooks:{ drawClear:[dayBands, gapBands(p.gaps)], setCursor:[onCursor], setScale:[onScale] }
    });
    p.u = new uPlot(opts, p.data, box.querySelector('.stk-c'));
    addZoomUI(p.u, () => win, HOUR, i === 0);       // pizzico su qualunque pannello; "Tutto" sul primo
    panels.push(p);
  });
  ready = true;
  panels.forEach(stats);
  return {
    panels, win, rgut,
    resize(){
      const w = width();
      panels.forEach((p, i) => p.u.setSize({ width:w, height: ph + (i === n - 1 ? AX : 0) }));
    },
    destroy(){ panels.forEach(p => p.u.destroy()); host.innerHTML = ''; }
  };
}

async function exportStackPNG(){
  const so = stackObj;
  if(!so || !so.panels.length || !currentStation) return;
  const btn = el('exportpng'), lbl = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;
  try {
    const R = 2, W_PLOT = 1500, PH = 300, AXH = 46, HEAD = 44, PAD_TOP = 84, PAD_BOT = 18, PAD_L = 12;
    const n = so.panels.length, totW = PAD_L + W_PLOT, totH = PAD_TOP + n * (HEAD + PH) + AXH + PAD_BOT;
    const cv = document.createElement('canvas');
    cv.width = totW * R;
    cv.height = totH * R;
    const ctx = cv.getContext('2d');
    ctx.scale(R, R);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totW, totH);
    const name = prettyName(currentStation.name || currentStation.scode);
    const MODE_TXT = { week:'Ultimi 7 giorni', day3:'Ultimi 3 giorni', day:'Ultime 24 ore' };
    const src = SOURCES[currentStation._region];
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f2233';
    ctx.font = '700 32px system-ui, sans-serif';
    ctx.fillText(name, PAD_L, 44);
    ctx.fillStyle = '#5a6b7a';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText((MODE_TXT[chartMode] || '') + (src ? '  ·  Fonte: ' + src.name : '') +
                 '  ·  Orari in ora locale italiana (CET/CEST)', PAD_L, 70);
    const sx = so.panels[0].u.scales.x, win = [sx.min, sx.max];
    let y = PAD_TOP;
    for(let i = 0; i < n; i++){
      const p = so.panels[i], last = i === n - 1;
      ctx.fillStyle = p.color;
      ctx.fillRect(PAD_L + 6, y + 20, 22, 4);
      ctx.fillStyle = '#0f2233';
      ctx.font = '700 22px system-ui, sans-serif';
      const title = p.label + (p.unit ? ' (' + p.unit + ')' : '');
      ctx.fillText(title, PAD_L + 38, y + 28);
      const tw = ctx.measureText(title).width;
      ctx.fillStyle = '#5a6b7a';
      ctx.font = '17px system-ui, sans-serif';
      ctx.fillText(p.statTxt, PAD_L + 38 + tw + 18, y + 28);
      const stw = ctx.measureText(p.statTxt).width;
      if(p.statDeg != null){                                // freccia ↓ ruotata (giu' = vento da N)
        ctx.save();
        ctx.translate(PAD_L + 38 + tw + 18 + stw + 12, y + 22);
        ctx.rotate(p.statDeg * Math.PI / 180);
        ctx.textAlign = 'center';
        ctx.fillText('↓', 0, 6);
        ctx.restore();
      }
      if(p.cum){
        const sx0 = PAD_L + 38 + tw + 18 + stw + (p.statDeg != null ? 34 : 22);
        ctx.fillStyle = '#1a365d';
        ctx.fillRect(sx0, y + 20, 22, 4);
        ctx.fillStyle = '#5a6b7a';
        ctx.fillText('cumulata (asse destro)', sx0 + 30, y + 28);
      }
      y += HEAD;
      const h = PH + (last ? AXH : 0);
      const host = document.createElement('div');
      host.style.cssText =
        'position:fixed;left:-99999px;top:0;background:#fff;width:' + W_PLOT + 'px;height:' + h + 'px';
      document.body.appendChild(host);
      const u = new uPlot(
        Object.assign(stackPanelOpts(p, { w:W_PLOT, h, last, win, hi:true, rgut:so.rgut }), { pxRatio:R }),
        p.data, host);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      ctx.drawImage(u.ctx.canvas, PAD_L, y, W_PLOT, h);
      u.destroy();
      host.remove();
      y += h;
    }
    const fname = name.replace(/[^\w-]+/g,'_') + '_' + currentStation._region + '_impilato_' + chartMode +
                  '.png';
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    btn.textContent = lbl;
    btn.disabled = false;
    await deliverPNG(blob, fname);
  } catch(e){
    setStatus('Export del grafico non riuscito (' + e + ').');
    toast('PNG non riuscito');
  } finally {
    btn.textContent = lbl;
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------------------------------------
// CONSEGNA DEL PNG (l'utente deve capire dove finisce il file)
// ------------------------------------------------------------------------------------------------

let _pngUrl = null;
function showPngSheet(blob, fname, file){
  closePngSheet();
  _pngUrl = URL.createObjectURL(blob);
  el('pngimg').src = _pngUrl;
  const canShare = !!(file && navigator.canShare && navigator.canShare({ files:[file] }));
  el('pngshare').style.display = canShare ? '' : 'none';
  el('pngshare').onclick = async () => {
    try { await navigator.share({ files:[file], title:fname }); } catch(e){}
  };
  el('pngsheet').classList.add('show');
}
function closePngSheet(){
  el('pngsheet').classList.remove('show');
  if(_pngUrl){
    URL.revokeObjectURL(_pngUrl);
    _pngUrl = null;
    el('pngimg').removeAttribute('src');
  }
}

// Telefono/tablet: foglio di condivisione del sistema (Foto, File, AirDrop...); se il browser non lo concede
// (gesto scaduto o non supportato) si mostra l'anteprima "tieni premuto -> Salva".
// Desktop: download normale + avviso col nome del file.
async function deliverPNG(blob, fname){
  if(!blob) throw new Error('immagine non generata');
  const touch = matchMedia('(pointer:coarse)').matches;
  const file = (typeof File === 'function') ? new File([blob], fname, { type:'image/png' }) : null;
  if(touch){
    if(file && navigator.canShare && navigator.canShare({ files:[file] })){
      try { await navigator.share({ files:[file], title:fname }); return; }
      catch(e){ if(e && e.name === 'AbortError') return; }
    }
    showPngSheet(blob, fname, file);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('PNG salvato in Download: ' + fname);
}

// ------------------------------------------------------------------------------------------------
// EXPORT PNG del grafico mostrato (alta risoluzione, font grandi, legenda in colonna a destra)
// ------------------------------------------------------------------------------------------------
async function exportChartPNG(){
  if(stackMode){ return exportStackPNG(); }
  if(!chart || !chart._hi || !currentStation){ return; }
  const btn = el('exportpng'), lbl = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;
  try {
    const W_PLOT = 1500, H_PLOT = 780, W_LEG = 320, PAD_TOP = 84, PAD_BOT = 18, PAD_L = 12, R = 2;
    const unit = varUnit(currentVar, currentStation);   // LIVIDRO -> 'm s.m.m.' se c'è lo zero
    // 2ª variabile attiva (asse destro, rossa): compare nel titolo
    const v2png = (chart._m && chart._m.v2) || null;
    const unit2 = v2png ? varUnit(v2png, currentStation) : '';
    // stessa vista dello schermo (barre orarie, cumulata, buchi, puntini) ad alta risoluzione e sulla stessa
    // finestra X, zoom compreso
    const xr = (chart.scales.x.min != null) ? [chart.scales.x.min, chart.scales.x.max] : null;
    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;left:-99999px;top:0;background:#fff;width:' + W_PLOT + 'px;height:' + H_PLOT + 'px';
    document.body.appendChild(host);
    const opts = Object.assign(chart._hi(W_PLOT, H_PLOT), { pxRatio: R });
    if(xr) opts.scales.x.range = () => xr;
    const series = opts.series;
    const u = new uPlot(opts, chart.data, host);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const totW = PAD_L + W_PLOT + W_LEG, totH = PAD_TOP + H_PLOT + PAD_BOT;
    const cv = document.createElement('canvas');
    cv.width = totW * R;
    cv.height = totH * R;
    const ctx = cv.getContext('2d');
    ctx.scale(R, R);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totW, totH);

    const title = prettyName(currentStation.name || currentStation.scode) +
                  ' — ' + varLabel(currentVar) + (unit ? ' (' + unit + ')' : '') +
                  (v2png ? '  +  ' + varLabel(v2png) + (unit2 ? ' (' + unit2 + ')' : '') : '');
    const MODE_TXT = {
      week:'Ultimi 7 giorni', day3:'Ultimi 3 giorni', day:'Ultime 24 ore', tabs:'Confronto schede',
      compare:'Confronto 7 giorni', compare30:'Confronto 30 giorni'
    };
    const modeTxt = (MODE_TXT[chartMode] || '') +
      ((currentVar === 'PREC' && (chartMode === 'compare' || chartMode === 'compare30'))
        ? ', pioggia cumulata dalla mezzanotte' : '');
    const src = SOURCES[currentStation._region];
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#0f2233';
    ctx.font = '700 32px system-ui, sans-serif';
    ctx.fillText(title, PAD_L, 44);
    ctx.fillStyle = '#5a6b7a';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(modeTxt + (src ? '  ·  Fonte: ' + src.name : '') +
                 '  ·  Orari in ora locale italiana (CET/CEST)', PAD_L, 70);

    ctx.drawImage(u.ctx.canvas, PAD_L, PAD_TOP, W_PLOT, H_PLOT);

    let lx = PAD_L + W_PLOT + 26, ly = PAD_TOP + 6;
    ctx.fillStyle = '#0f2233';
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillText('Legenda', lx, ly);
    ly += 30;
    ctx.font = '17px system-ui, sans-serif';
    for(let i = 1; i < series.length; i++){
      const s = series[i];
      if(!s.label) continue;
      if(ly > totH - 24){
        ctx.fillStyle = '#5a6b7a';
        ctx.fillText('…', lx, ly);
        break;
      }
      if(s.kind === 'bars'){
        ctx.fillStyle = s.fill;
        ctx.fillRect(lx + 6, ly - 15, 18, 18);
      }
      else if(s.kind === 'dots'){
        ctx.fillStyle = s.stroke;
        ctx.beginPath();
        ctx.arc(lx + 15, ly - 6, 6, 0, 2 * Math.PI);
        ctx.fill();
      }
      else {
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(lx, ly - 6);
        ctx.lineTo(lx + 30, ly - 6);
        ctx.stroke();
      }
      ctx.fillStyle = '#22303c';
      ctx.fillText(s.label, lx + 40, ly);
      ly += 28;
    }

    u.destroy();
    host.remove();

    const fname = prettyName(currentStation.name || currentStation.scode).replace(/[^\w-]+/g,'_') +
                  '_' + currentStation._region + '_' + currentVar + '_' + chartMode + '.png';
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    btn.textContent = lbl;                  // pulsante libero prima del foglio di condivisione
    btn.disabled = false;
    await deliverPNG(blob, fname);
  } catch(e){
    setStatus('Export del grafico non riuscito (' + e + ').');
    toast('PNG non riuscito');
  } finally {
    btn.textContent = lbl;
    btn.disabled = false;
  }
}

function buildChartControls(){
  new ResizeObserver(() => {
    if(chart) chart.setSize({ width: chartWidth(), height: chartHeight() });
    if(stackObj) stackObj.resize();
    if(histMode && histU) histU.setSize({ width: histWidth(), height: histHeight() });
  }).observe(el('panel'));
  el('exportpng').addEventListener('click', exportChartPNG);
  el('pngclose').addEventListener('click', closePngSheet);
  el('pngsheet').addEventListener('click', e => { if(e.target === el('pngsheet')) closePngSheet(); });
}
