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
// La rosa segue il periodo scelto (Oggi, 24 h, 3 g, 7 g) e prende il posto del grafico, grande come lui.
function updateWindRose(){
  const box = el('windrose');
  const t = currentStation && currentStation._table;
  const dirs = t && t.cols['DVENTO'], sps = t && t.cols['VVENTO'];
  box._rose = null;
  if(!dirs || !sps){ box.innerHTML = ''; return; }
  let lo = Infinity, hi = tableEnd(t, ['DVENTO', 'VVENTO']);
  t.x.forEach(x => { if(x != null && x < lo) lo = x; });
  const from = (hi == null || isCompareMode()) ? -Infinity : modeStart(chartMode, lo, hi);
  // conteggi per (16 settori x classe di velocita'), piu' somme vettoriale e scalare
  const grid = Array.from({length:16}, () => new Array(_WR_CLASSES.length).fill(0));
  let n = 0, calm = 0, su = 0, sv = 0, ss = 0;
  for(let i=0;i<dirs.length;i++){
    const d = dirs[i], s = sps[i];
    if(d == null || s == null || isNaN(d) || isNaN(s) || t.x[i] < from) continue;
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
    box.innerHTML = '<div class="hint">Pochi dati di vento.</div>';
    return;
  }
  const r = box._rose = { grid, n, calm, su, sv, ss };
  const legend = _WR_CLASSES.map(c => `<span><i style="background:${c.c}"></i> ${c.l}</span>`).join(' ');
  box.innerHTML = `<div class="wr-plot"></div><div class="wr-legend">m/s ${legend}</div>`;
  const plot = box.firstChild, side = Math.min(plot.clientWidth, plot.clientHeight || plot.clientWidth);
  plot.innerHTML = roseSvg(r, Math.max(160, side), 1);
  el('chartsum').textContent = 'Rosa dei venti. ' + roseMean(r).text + '.';
}
// vento medio vettoriale (da dove spira) e scalare
function roseMean(r){
  const v = Math.hypot(r.su, r.sv) / r.n, from = (Math.atan2(-r.su, -r.sv) * 180 / Math.PI + 360) % 360;
  return { v, from, text:`Vento medio ${v.toFixed(1)} m/s da ${_dirName(from)}; media scalare ` +
           `${(r.ss / r.n).toFixed(1)} m/s; calme ${(r.calm / r.n * 100).toFixed(0)}%; ${r.n} osservazioni` };
}
// Rosa in un quadrato di S px; k ingrandisce scritte e tratti (PNG). I colori sono quelli del tema chiaro: il
// tema scuro li cambia da stile.css (classi wr-*), l'immagine resta chiara.
function roseSvg(r, S, k){
  const { grid, n } = r, c = S / 2, R = c - 20 * k, calmR = Math.max(12 * k, R * 0.12);
  const maxPct = Math.max(...grid.map(cl => cl.reduce((a, b) => a + b, 0) / n * 100));
  const step = maxPct <= 10 ? 2 : (maxPct <= 25 ? 5 : 10);
  const gridMax = Math.max(step, Math.ceil(maxPct / step) * step);
  const rOf = pct => calmR + (R - calmR) * pct / gridMax;
  const P = (rr, deg) => {
    const a = deg * Math.PI / 180;
    return [(c + rr * Math.sin(a)).toFixed(1), (c - rr * Math.cos(a)).toFixed(1)];
  };
  const fs = px => (px * k).toFixed(1);
  let svg = '';
  for(let g = step; g <= gridMax; g += step){
    const rr = rOf(g);
    svg += `<circle class="wr-ring" cx="${c}" cy="${c}" r="${rr.toFixed(1)}" fill="none" stroke="#d7dee6"/>` +
           `<text class="wr-t" x="${(c + 3 * k).toFixed(1)}" y="${(c - rr + 4 * k).toFixed(1)}" ` +
           `font-size="${fs(10)}" fill="#8a96a3">${g}%</text>`;
  }
  ['N', 'E', 'S', 'O'].forEach((lab, q) => {
    const [x, y] = P(R + 11 * k, q * 90);
    svg += `<text class="wr-c" x="${x}" y="${y}" font-size="${fs(12)}" font-weight="600" fill="#5a6b7b" ` +
           `text-anchor="middle" dominant-baseline="middle">${lab}</text>`;
  });
  const HALF = 10;                       // mezza ampiezza del settore in gradi (22.5 pieno: resta un gap)
  for(let sec = 0; sec < 16; sec++){
    const th = sec * 22.5, t1 = th - HALF, t2 = th + HALF;
    let acc = 0;
    for(let ci = 0; ci < _WR_CLASSES.length; ci++){
      const cnt = grid[sec][ci];
      if(!cnt) continue;
      const ri = rOf(acc / n * 100), ro = rOf((acc + cnt) / n * 100);
      acc += cnt;
      const [ax, ay] = P(ri, t1), [bx, by] = P(ro, t1), [dx, dy] = P(ro, t2), [ex, ey] = P(ri, t2);
      const o = ro.toFixed(1), i = ri.toFixed(1);
      svg += `<path class="wr-p" d="M${ax},${ay} L${bx},${by} A${o},${o} 0 0 1 ${dx},${dy} ` +
             `L${ex},${ey} A${i},${i} 0 0 0 ${ax},${ay} Z" ` +
             `fill="${_WR_CLASSES[ci].c}" stroke="#fff" stroke-width="${fs(0.6)}"/>`;
    }
  }
  svg += `<circle class="wr-calm" cx="${c}" cy="${c}" r="${calmR.toFixed(1)}" ` +
         `fill="#eef2f6" stroke="#d7dee6"/>` +
         `<text class="wr-t" x="${c}" y="${(c + 3 * k).toFixed(1)}" font-size="${fs(9)}" fill="#7a8794" ` +
         `text-anchor="middle">calme</text>`;
  // vento medio vettoriale: freccia dal centro verso la provenienza (come i petali); i numeri al passaggio
  const m = roseMean(r);
  if(m.v > 0.1){
    const [hx, hy] = P(R * 0.62, m.from);
    svg += `<g><title>${m.text}</title>` +
           `<line x1="${c}" y1="${c}" x2="${hx}" y2="${hy}" stroke="#c05621" stroke-width="${fs(2)}"/>` +
           `<circle cx="${hx}" cy="${hy}" r="${fs(2.5)}" fill="#c05621"/></g>`;
  }
  return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" ` +
         `font-family='${FONT.replace(/"/g, '')}'>${svg}</svg>`;
}

// CONFRONTO SCHEDE: stessa variabile, una serie per ogni stazione aperta in scheda
function renderCompareTabs(label, unit){
  renderCompareSet(label, unit, openTabs, 'Servono almeno due schede con ' + varLabel(label) + '.');
}
// VICINE: la stazione e le vicine (stazione.js), come il Confronto schede; sotto il nome distanza e quota
let _nearSeq = 0;
async function renderNear(label, unit){
  const st = currentStation, seq = ++_nearSeq;
  clearChart();
  el('chartlegend').innerHTML = '';
  setStatus('Cerco le stazioni vicine…');
  const near = await nearStations(st, label);
  if(seq !== _nearSeq || currentStation !== st || chartMode !== 'near') return;
  setStatus('');
  const list = [{ props:st, km:0, sub:'' }].concat(near.map(o => Object.assign(o, {
    sub:fmtKm(o.km) + (o.props.quota != null ? ', ' + o.props.quota + ' m' : '')
  })));
  renderCompareSet(label, unit, list, 'Nessuna stazione vicina con questa misura.');
  if(chart) chart._near = list;
  else if(stackObj) stackObj.near = list;
}
// Stessa variabile, una serie per stazione: list = [{props, sub}], why = la frase se meno di due hanno dati
function renderCompareSet(label, unit, list, why){
  if(unit === undefined){
    const t0 = list.find(t => (unitsByRegion[t.props._region] || {})[label]);
    unit = t0 ? (unitsByRegion[t0.props._region] || {})[label] : '';
  }
  clearChart();
  const tabs = list.filter(t => tabHas(t, label));
  if(tabs.length < 2){
    el('chartlegend').innerHTML = '';
    setStatus(why);
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
  if(rain){                    // pioggia: una fascia per stazione con la stessa scala, i nomi sopra le fasce
    document.body.classList.add('strips');
    el('chartlegend').style.display = 'none';
    stackObj = createStack(el('chart'), { list:tabs, src:label, unit:uLab, mode:chartMode, colors:COLS });
    const ps = stackObj.panels, near = chartMode === 'near';
    stackObj.table = { labels: ps.map(p => p.label), data: uPlot.join(ps.map(p => [p.rs.x, p.rs.y])) };
    stackObj.title = (near ? prettyName(currentStation.name || currentStation.scode) + ' e vicine'
                           : 'Confronto schede') + ' — ' + varLabel(label);
    stackObj.fname = near ? pngBase() + '_vicine_' + label + '.png'
                          : 'confronto_schede_' + label + '_' + chartMode + '.png';
    stackObj.withSource = near;                       // le schede possono essere di reti diverse
    return;
  }
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
  const data = [xs];
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
  const full = xs.length ? [xs[0], xs[xs.length - 1]] : null;
  const opts = (hi, W, H) => {
    const fnt = { font: cssFont(hi ? 20 : 12) }, grid = hi ? '#e3e9f0' : GRID(), ax = hi ? '#33475a' : AXTX();
    const yAx = Object.assign({
      grid:{ stroke: grid }, size: hi ? 82 : 58, unit: uLab, unitSize: hi ? 20 : 12, stroke: ax,
      incrs: TICK_STEPS, values: tickTexts
    }, fnt);
    return {
      width: W, height: H, tzDate: TZ_CIV, legend: { show:false },
      scales: {
        x: {
          time:true,
          range: (u, a, b) => (full && a <= full[0] + 1 && b >= data[0][data[0].length - 1] - 1)
            ? full : [a, b]
        },
        y: yScaleFor(label)
      },
      series: [{ value: (u, ts) => ts==null ? '--' : fmtFull(ts) }].concat(specs.map(d => mkSeries(d, hi))),
      axes: timeAxes(hi, ax, true).concat(dir ? dirAxis(yAx) : yAx),
      padding: [hi ? 44 : 24, null, null, null],
      cursor: hi ? { show:false }
                 : { y:false, drag:{ x:true, y:false }, dataIdx: cursorDataIdx, points:{ show: hoverPt } },
      hooks: hi ? { drawClear: [nightBandsHi], draw: [drawUnits] }
                : { drawClear: [nightBands], draw: [drawUnits], setCursor: [legendCursor] }
    };
  };
  // i nomi delle stazioni prima del grafico: il grafico prende la larghezza che la colonna gli lascia
  el('chartlegend').style.display = '';
  el('chartlegend').innerHTML = specs.map((d, k) => {
    const sub = tabs[k].sub;
    return '<div class="lg-row' + (sub ? ' two' : '') + '"><span class="lg-sw" style="background:'
      + COLS[k % COLS.length] + '"></span><span>' + escHtml(d.label)
      + (sub ? '<span class="lg-sub">' + escHtml(sub) + '</span>' : '') + '</span></div>';
  }).join('');
  chart = new uPlot(opts(false, chartWidth(), chartHeight()), data, el('chart'));
  chart._hi = (W, H) => opts(true, W, H);
  chart._unit = uLab;
  chart._src = label;
  chart._dir = dir;
  addLabels(chart);
  addZoomUI(chart, () => full, HOUR);
}

// ------------------------------------------------------------------------------------------------
// GRAFICO (uPlot)
// ------------------------------------------------------------------------------------------------
function clearChart(){
  if(chart){ chart.destroy(); chart = null; }
  if(stackObj){ stackObj.destroy(); stackObj = null; }
  document.body.classList.remove('strips');
  el('chart').innerHTML='';
  el('chartsum').textContent = '';
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
const isCompareMode = () => ['compare', 'compare30', 'tabs', 'near'].includes(chartMode);
const GRID = () => document.body.classList.contains('dark') ? '#223146' : '#eef2f7';
const AXTX = () => document.body.classList.contains('dark') ? '#c7d3e0' : '#1c2733';

// valori al cursore accanto ai punti (cursorLabels); la colonna a destra la usa solo il Confronto schede
function renderLegend(u){
  el('chartlegend').innerHTML = '';
  addLabels(u);
}
function legendCursor(u){
  if(u === chart && u._labs) cursorLabels(u);
}
function addLabels(u){
  u._labs = document.createElement('div');
  u._labs.className = 'clabs';
  u._labs.hidden = true;
  u.over.appendChild(u._labs);
}
const numTxt = (v, src) => CM_VARS.has(src) ? (+v).toFixed(2) : String(+(+v).toFixed(2));
// Tacche dei valori: passi 1, 2, 5 (col 2.5 i decimali cambierebbero da una tacca all'altra), tutte con gli
// stessi decimali, col punto e senza migliaia (uPlot userebbe la lingua del browser: "1.000", "2,5")
const TICK_STEPS = [-3, -2, -1, 0, 1, 2, 3, 4, 5]
  .flatMap(e => [1, 2, 5].map(k => +(k * Math.pow(10, e)).toPrecision(1)));
const stepDecimals = step => {
  let d = 0;
  while(d < 3 && Math.abs(step * Math.pow(10, d) - Math.round(step * Math.pow(10, d))) > 1e-4) d++;
  return d;
};
function tickTexts(u, splits, axis, space, incr){
  const step = incr || (splits.length > 1 ? Math.abs(splits[1] - splits[0]) : 1), d = stepDecimals(step);
  return splits.map(v => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(d));
}
const unitTxt = un => un ? ' ' + escHtml(un) : '';
// Confronto per giorni: oggi e il giorno col punto piu' vicino al puntatore (trenta valori non si leggono)
function dayPair(u, at){
  const today = u.series.findIndex(s => s.label === 'Oggi');
  let best = -1, dist = Infinity;
  for(let i = 1; i < u.series.length; i++){
    const j = at(i), v = j != null ? u.data[i][j] : null;
    if(i === today || v == null) continue;
    const d = Math.abs(u.valToPos(v, u.series[i].scale) - u.cursor.top);
    if(d < dist){ dist = d; best = i; }
  }
  return [today, best];
}
// Al cursore: l'ora in alto e sotto, in colonna accanto alla linea del tempo, il valore di ogni serie col
// trattino del suo colore; mai all'altezza della curva, che coprirebbe. A destra della linea (a sinistra
// vicino al bordo destro); niente riquadro.
function cursorLabels(u){
  const box = u._labs, gi = u.cursor.idx, left = u.cursor.left;
  if(gi == null || left == null || left < 0){ box.hidden = true; return; }
  const m = u._m, idxs = u.cursor.idxs, at = i => (idxs && idxs[i] !== undefined) ? idxs[i] : gi;
  const W = u.over.clientWidth, H = u.over.clientHeight, tags = [], only = u._days ? dayPair(u, at) : null;
  for(let i = 1; i < u.series.length; i++){
    const j = at(i), v = (j != null && u.data[i]) ? u.data[i][j] : null;
    if(v == null || v === '' || !u.series[i].show || (only && !only.includes(i))) continue;
    const s = m && m.ss[i - 1], sr = u.series[i];
    const c = s ? varColor(s.v) : (typeof sr.stroke === 'function' ? sr.stroke(u, i) : sr.stroke);
    let html;
    if(u._fmt) html = u._fmt(i, v, j);
    else if(m && i === m.iCum)
      html = 'tot ' + fmtNum(round2(v - (u.scales.cum.min || 0))) + unitTxt(m.s1.unit);
    else if(m && (i === m.iHalf || i === m.iRadar))
      html = (i === m.iRadar ? 'Radar ' : '') + numTxt(v, 'PREC') + unitTxt(m.s1.unit);
    else if(s ? isDirVar(s.src) : u._dir) html = windDirHtml(v);
    else {
      html = numTxt(v, s ? s.src : u._src) + unitTxt(s ? s.unit : u._unit);
      const d = m && m.wind && i === m.wind.i ? m.wind.dirs[j] : null;
      if(d != null) html += ' ' + windDirHtml(d);
    }
    if(html == null) continue;
    if(only) html = sr.label + ' ' + html;
    tags.push('<i class="k" style="background:' + c + '"></i>' + html);
  }
  // in cima alla colonna: dentro un evento di pioggia il suo totale, poi la riga in piu' della vista
  // (bilancio), poi i valori
  const evs = m && m.events, xv = evs && evs.length ? u.posToVal(left, 'x') : null;
  const ev = xv == null ? null : evs.find(e => xv >= e.a && xv <= e.b), extra = u._extra && u._extra(gi);
  const key = c => '<i class="k" style="background:' + c + '"></i>';
  const evTag = ev && key(varColor(m.s1.v)) + eventTxt(ev, m.s1.unit);
  const col = [evTag, extra].filter(Boolean).concat(tags);
  // l'ora dell'intervallo della prima serie; dopo l'ultima lettura, quello del radar
  const j1 = at(1), x1 = j1 != null ? u.data[0][j1] : null, jr = m && m.iRadar ? at(m.iRadar) : null;
  const tt = u._top ? u._top(gi) : u._days ? (u.data[0][gi] != null ? hhmm(u.data[0][gi]) : '')
           : x1 != null ? slotTimeTxt(u, 1, j1) : jr != null ? slotTimeTxt(u, m.iRadar, jr)
           : (u.data[0][gi] != null ? fmtDayTime(u.data[0][gi]) : '');
  const side = left < W * 0.7 ? '' : ' l', tx = Math.min(Math.max(left, 48), W - 48);
  const top0 = tt ? 18 : 2;
  box.innerHTML = (tt ? `<span class="cl-t" style="left:${tx}px">${tt}</span>` : '') + col.map((h, k) =>
    `<span class="cl-v${side}" style="left:${left}px;top:${Math.min(top0 + 16 * k, H - 16)}px">${h}</span>`)
    .join('');
  box.hidden = false;
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

// Alba e tramonto (sole a -0.833 gradi, formule della NOAA) del giorno che comincia a day (00:00 UTC), in UTC
function sunTimes(day, lat, lon){
  const y0 = Date.UTC(new Date(day * 1000).getUTCFullYear(), 0, 1) / 1000, r = Math.PI / 180;
  const g = 2 * Math.PI / 365 * Math.floor((day - y0) / DAY_S);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
                        - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
             + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const c = Math.cos(90.833 * r) / (Math.cos(lat * r) * Math.cos(decl)) - Math.tan(lat * r) * Math.tan(decl);
  const ha = Math.acos(Math.max(-1, Math.min(1, c))) / r;
  return [day + (720 - 4 * (lon + ha) - eqt) * 60, day + (720 - 4 * (lon - ha) - eqt) * 60];
}
// Dietro i dati: la notte dal tramonto all'alba nel luogo della stazione (u._ll, se no quella aperta) e una
// linea a ogni mezzanotte italiana. hi = PNG, sempre chiaro.
function nightBands(u, hi){
  const s = u.scales.x;
  if(s.min == null) return;
  const ctx = u.ctx, { left, top, width, height } = u.bbox, x = v => u.valToPos(v, 'x', true);
  const pr = ctx.canvas.width / Math.max(1, u.width), st = currentStation;
  const ll = u._ll || (st && st._lat != null ? [st._lat, st._lon] : null);
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  if(ll){
    const dark = hi !== true && document.body.classList.contains('dark');
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.3)' : 'rgba(58,86,140,0.075)';
    for(let d = Math.floor(s.min / DAY_S) - 1; d * DAY_S < s.max; d++){
      const set = sunTimes(d * DAY_S, ll[0], ll[1])[1], rise = sunTimes((d + 1) * DAY_S, ll[0], ll[1])[0];
      if(rise > s.min && set < s.max) ctx.fillRect(x(set), top, x(rise) - x(set), height);
    }
  }
  ctx.strokeStyle = hi === true ? '#e3e9f0' : GRID();
  ctx.lineWidth = pr;
  for(let d = Math.floor(civT(s.min) / DAY_S) + 1; civToUtc(d * DAY_S) < s.max; d++){
    const xm = Math.round(x(civToUtc(d * DAY_S))) + 0.5;
    ctx.beginPath();
    ctx.moveTo(xm, top);
    ctx.lineTo(xm, top + height);
    ctx.stroke();
  }
  ctx.restore();
}
const nightBandsHi = u => nightBands(u, true);

// Asse del tempo su due righe: sopra le ore (la mezzanotte e' 0), sotto il giorno al
// centro della parte visibile ("mar 17", sotto i 52 px al giorno solo "17"); show = false: niente scritte.
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
function hourTxt(ts){
  const d = new Date(civT(ts) * 1000);
  return d.getUTCMinutes() !== 0 ? '' : String(d.getUTCHours());
}
function daySplits(u, ai, mn, mx){
  const out = [];
  for(let d = Math.floor(civT(mn) / DAY_S); civToUtc(d * DAY_S) < mx; d++){
    const a = Math.max(mn, civToUtc(d * DAY_S)), b = Math.min(mx, civToUtc((d + 1) * DAY_S));
    if(b - a >= (mx - mn) * 0.08) out.push((a + b) / 2);
  }
  return out;
}
function dayTxt(u, splits){
  const days = Math.max(1, (u.scales.x.max - u.scales.x.min) / DAY_S);
  const wide = (u.over.clientWidth || u.width) / days >= 52;
  return splits.map(v => {
    const d = new Date(civT(v) * 1000);
    return (wide ? GIORNI[d.getUTCDay()] + ' ' : '') + d.getUTCDate();
  });
}
// Ore ogni 1, 2, 3, 6 o 12 (6, 12, 18 e non 8, 16); se fra due tacche non ci sono 40 px nemmeno a 12 ore,
// niente ore: bastano i giorni
const HOUR_INCRS = [1, 2, 3, 6, 12, 24, 168, 8760].map(h => h * 3600);
const hoursOnly = (u, sp, ai, space, incr) => incr >= DAY_S ? sp.map(() => null) : sp;
// Sui 30 giorni del bilancio i giorni sono troppi per un nome ciascuno: una data ogni qualche giorno
function dateAxis(hi, stroke){
  return {
    scale:'x', side:2, stroke, font:cssFont(hi ? 20 : 12), size:hi ? 40 : 24, gap:hi ? 6 : 3,
    space:hi ? 90 : 48, incrs:[1, 2, 5, 7, 10, 15].map(n => n * DAY_S), grid:{ show:false },
    ticks:{ show:true, size:hi ? 8 : 4 },
    values:(u, ts) => ts.map(t => {
      if(t == null) return '';
      const d = new Date(civT(t) * 1000);
      return d.getUTCDate() + '/' + (d.getUTCMonth() + 1);
    })
  };
}
function timeAxes(hi, stroke, show){
  return [
    { scale:'x', side:2, stroke, font:cssFont(hi ? 20 : 12), size:show ? (hi ? 34 : 20) : 6, gap:hi ? 6 : 3,
      space:40, incrs:HOUR_INCRS, filter:hoursOnly, grid:{ show:false },
      ticks:{ show, size:hi ? 8 : 4, filter:hoursOnly },
      values:(u, ts) => ts.map(t => show && t != null ? hourTxt(t) : '') },
    { scale:'x', side:2, stroke, font:cssFont(hi ? 20 : 12, 600), size:hi ? 32 : 18, gap:0, show,
      grid:{ show:false }, ticks:{ show:false }, splits:daySplits, values:dayTxt }
  ];
}

// Sopra ogni asse, in orizzontale (a.unitSize px), il suo nome: le variabili che porta (a.names, ognuna nel
// suo colore) e l'unita' nel colore dell'asse. Centrato sull'asse e dentro il grafico; due vicini non si
// accavallano (chi tocca quello alla sua destra si sposta a sinistra).
function drawUnits(u){
  const ctx = u.ctx, pr = ctx.canvas.width / Math.max(1, u.width), W = ctx.canvas.width, tags = [];
  ctx.save();
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';                 // uPlot lascia quello dell'ultimo asse disegnato
  u.axes.forEach((a, i) => {
    if(!(a.unit || a.names) || !a.show || !a._show || a._pos == null) return;
    const font = cssFont((a.unitSize || 12) * pr, 600), parts = [];
    const ac = typeof a.stroke === 'function' ? a.stroke(u, i) : a.stroke;
    (a.names || []).forEach((n, k) => {
      if(k) parts.push({ t:' · ', c:ac });
      parts.push({ t:n.text, c:n.color });
    });
    if(a.unit) parts.push({ t:(parts.length ? ' ' : '') + a.unit, c:ac });
    ctx.font = font;
    parts.forEach(p => { p.w = ctx.measureText(p.t).width; });
    const w = parts.reduce((s, p) => s + p.w, 0);
    const c = (a.side === 1 ? a._pos + a._size / 2 : a._pos - a._size / 2) * pr;   // centro dell'asse
    tags.push({ font, parts, w, x:Math.max(2 * pr, Math.min(W - 2 * pr - w, c - w / 2)) });
  });
  tags.sort((p, q) => p.x - q.x);
  for(let k = tags.length - 2; k >= 0; k--)
    tags[k].x = Math.max(2 * pr, Math.min(tags[k].x, tags[k + 1].x - 10 * pr - tags[k].w));
  u._unitBoxes = tags.map(t => [t.x, t.x + t.w]);           // drawEvents li evita
  tags.forEach(t => {
    ctx.font = t.font;
    let x = t.x;
    t.parts.forEach(p => {
      ctx.fillStyle = p.c;
      ctx.fillText(p.t, x, u.bbox.top - 7 * pr);
      x += p.w;
    });
  });
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
  if(v === SNOWNEW) v = 'LIVNEVE';
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
const round2 = v => Math.round(v * 100) / 100;
const CUMC = () => document.body.classList.contains('dark') ? '#90cdf4' : '#1a365d';

function withAlpha(c, a){
  if(/^#[0-9a-f]{6}$/i.test(c)) return c + Math.round(a * 255).toString(16).padStart(2, '0');
  const m = /^rgb\((.+)\)$/.exec(c || '');
  return m ? 'rgba(' + m[1] + ',' + a + ')' : c;
}
// barre: align 1 = la barra parte dall'x (x = inizio ora), -1 = finisce all'x (x = ora della lettura)
const rainBars = align => uPlot.paths.bars({ size:[0.9, 60], align: align || 0 });
// Dove c'e' anche il radar l'intervallo si divide: a sinistra il pluviometro, a destra il radar. x = inizio
// dell'intervallo (align 1) o fine (align -1).
const halfBars = (align, slot, right) => {
  const shift = (right ? 0.5 : 0.05) * slot - (align === -1 ? slot : 0);
  return uPlot.paths.bars({
    size:[0.45, 28], align:1,
    disp: {
      x0: { unit:1, values:u => u.data[0].map(x => x == null ? null : x + shift) },
      size: { unit:1, values:() => [0.45 * slot] }
    }
  });
};
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
    label: d.label, stroke: d.color, width: d.width || (hi ? 3 : 2), spanGaps: !!d.spanGaps,
    kind: d.kind || 'line'
  };
  if(d.scale) s.scale = d.scale;
  if(d.kind === 'bars' || d.kind === 'radar'){
    // radar: barra vuota col bordo; il fondo appena tinto resta se la barra e' troppo stretta per il bordo
    const radar = d.kind === 'radar';
    s.kind = 'bars';
    s.radar = radar;
    s.fill = withAlpha(d.color, radar ? 0.22 : (d.alpha == null ? 0.6 : d.alpha));
    if(radar) s.width = hi ? 2 : 1.5;
    if(d.solid){ s.fill = d.color; s.width = 0; }      // fasce per stazione: barre piene, nessun bordo
    s.points = { show:false };
    s.paths = d.half ? halfBars(d.align, d.slot, d.half === 'right') : rainBars(d.align);
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
  } else s.points = { show: !!d.pts, size: hi ? (d.ptSizeHi || 8) : (d.ptSize || 5) };
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
  if(s.slotTxt === 'day'){
    const d = new Date(civT(x) * 1000);
    return GIORNI[d.getUTCDay()] + ' ' + pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1);
  }
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
// Pioggia del radar negli stessi intervalli delle barre del pluviometro (pts = {t, v}: mm dei 5 minuti che
// finiscono a t); dopo l'ultima lettura (to) si continua col passo della stazione, al massimo per 6 ore: una
// stazione ferma da giorni non ha il radar in fondo. Un intervallo vale con tutti i suoi fotogrammi;
// l'ultimo, come l'ultima barra del pluviometro, anche a meta'.
const RADAR_STEP = 300, RADAR_AHEAD = 6 * HOUR;
function radarBars(pts, rs, to){
  const T = pts.t, V = pts.v, n = T.length, slot = rs.hourly ? HOUR : rs.step;
  if(!n || !slot || slot % RADAR_STEP) return null;
  const starts = rs.x.filter(x => x != null).map(x => rs.hourly ? x : x - slot);
  for(let a = starts.length ? starts[starts.length - 1] + slot : T[0] - RADAR_STEP; a < T[n - 1]; a += slot)
    starts.push(a);
  const X = [], Y = [], need = slot / RADAR_STEP;
  let k = 0;
  for(const a of starts){
    if(a < T[0] - RADAR_STEP || a >= T[n - 1] || a > to + RADAR_AHEAD) continue;
    while(k < n && T[k] <= a) k++;
    let sum = 0, cnt = 0;
    for(let j = k; j < n && T[j] <= a + slot; j++) if(V[j] != null){ sum += V[j]; cnt++; }
    if(cnt === need || (cnt && a + slot >= T[n - 1])){
      X.push(rs.hourly ? a : a + slot);
      Y.push(round2(sum));
    }
  }
  return X.length ? { x:X, y:Y, slot, align:rs.align } : null;
}
// Neve fresca stimata, giorno civile per giorno: la mattina (mediana delle letture fra le 6 e le 10) meno
// quella del giorno prima. Sotto i 2 cm conta 0 (il sensore oscilla di 1-2 cm), le altezze negative 0;
// senza una delle due mattine il giorno resta vuoto. -> {x: mezzanotte del giorno, y: cm | null}
const SNOW_MIN = 2;
function freshSnow(t){
  const H = t.cols.LIVNEVE || [], morning = new Map();
  for(let i = 0; i < t.x.length; i++){
    if(t.x[i] == null || H[i] == null) continue;
    const c = civT(t.x[i]), hour = Math.floor((c % DAY_S) / HOUR), d = Math.floor(c / DAY_S);
    if(hour < 6 || hour >= 10) continue;
    if(!morning.has(d)) morning.set(d, []);
    morning.get(d).push(Math.max(0, H[i]));
  }
  const median = a => {
    const s = a.slice().sort((p, q) => p - q), k = s.length >> 1;
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  };
  const xs = t.x.filter(x => x != null), x = [], y = [];
  if(!xs.length) return { x, y };
  for(let d = civDay(xs[0]); d <= civDay(xs[xs.length - 1]); d++){
    const a = morning.get(d), b = morning.get(d - 1), diff = a && b ? median(a) - median(b) : null;
    x.push(civMidnight(d));
    y.push(diff == null ? null : (diff >= SNOW_MIN ? Math.round(diff * 10) / 10 : 0));
  }
  return { x, y };
}
// Evento di pioggia: letture con pioggia separate da meno di 6 ore asciutte, almeno 2 mm in tutto. La lettura
// a x copre (x - step, x]. -> [{a: inizio, b: fine, mm}]
const EVENT_DRY = 6 * HOUR, EVENT_MM = 2;
function rainEvents(xs, ys, step){
  const out = [];
  let ev = null;
  for(let i = 0; i < xs.length; i++){
    const x = xs[i], v = ys[i];
    if(x == null || !(v > 0)) continue;
    if(ev && x - step - ev.b < EVENT_DRY){
      ev.b = x;
      ev.mm += v;
    } else {
      if(ev && ev.mm >= EVENT_MM) out.push(ev);
      ev = { a:x - step, b:x, mm:v };
    }
  }
  if(ev && ev.mm >= EVENT_MM) out.push(ev);
  return out.map(e => ({ a:e.a, b:e.b, mm:round2(e.mm) }));
}
const eventTxt = (e, unit) => {
  const h = (e.b - e.a) / HOUR;
  return 'Evento ' + numTxt(e.mm, 'PREC') + unitTxt(unit) + ' in '
       + (h >= 1 ? Math.round(h) + ' h' : Math.round(h * 60) + ' min');
};
// la linea di ogni evento in cima all'area del grafico, coi trattini ai capi (u._evDrawn = gli eventi visti);
// nel PNG, dove il cursore non c'e', sopra la linea il totale dell'evento
function drawEvents(events, color, hi, unit){
  return u => {
    const ctx = u.ctx, pr = ctx.canvas.width / Math.max(1, u.width), { left, top, width } = u.bbox;
    const y = top + (hi ? 8 : 5) * pr, tick = (hi ? 5 : 3) * pr, drawn = [], tags = [];
    ctx.save();
    ctx.strokeStyle = withAlpha(color, 0.8);
    ctx.lineWidth = (hi ? 3 : 2) * pr;
    ctx.beginPath();
    events.forEach(e => {
      const x1 = Math.max(left, u.valToPos(e.a, 'x', true));
      const x2 = Math.min(left + width, u.valToPos(e.b, 'x', true));
      if(x2 <= x1) return;
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      if(x1 > left){ ctx.moveTo(x1, y - tick); ctx.lineTo(x1, y + tick); }
      if(x2 < left + width){ ctx.moveTo(x2, y - tick); ctx.lineTo(x2, y + tick); }
      drawn.push([e.a, e.b]);
      tags.push({ x:(x1 + x2) / 2, t:numTxt(e.mm, 'PREC') + (unit ? ' ' + unit : '') });
    });
    ctx.stroke();
    if(hi){
      ctx.font = cssFont(17 * pr, 600);
      ctx.fillStyle = color;
      ctx.textBaseline = 'bottom';
      tags.forEach(g => {
        const w = ctx.measureText(g.t).width, fit = x => Math.max(left, Math.min(left + width - w, x));
        let x = fit(g.x - w / 2);
        (u._unitBoxes || []).forEach(([a, b]) => {           // non sopra le scritte degli assi
          if(x < b + 8 * pr && x + w > a - 8 * pr) x = fit(a > g.x ? a - 8 * pr - w : b + 8 * pr);
        });
        ctx.fillText(g.t, x, y - tick - 2 * pr);
      });
    }
    ctx.restore();
    u._evDrawn = drawn;
  };
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
    const ctx = u.ctx, bb = u.bbox, pr = ctx.canvas.width / Math.max(1, u.width);
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
// dopo uno zoom la scala e' stata calcolata col vecchio intervallo: si ricontrolla, a zoom applicato (uPlot
// non accetta un cambio di scala chiesto mentre ne applica un altro)
function fitDailyCum(u, daily){
  if(!u.root.isConnected) return;
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
function drawArrows(arrows, color, hi, dense, scale){
  return u => {
    const ctx = u.ctx, bb = u.bbox, pr = ctx.canvas.width / Math.max(1, u.width), sx = u.scales.x;
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
      ctx.translate(u.valToPos(a.x, 'x', true), u.valToPos(a.s, scale || 'y', true));
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
  add('setScale', (u, key) => { if(key === 'x') queueMicrotask(() => fitDailyCum(u, daily)); });
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
    unit: 'cumulata', unitSize: hi ? 20 : 12,
    splits: (u, ai, mn, mx) => {
      const st = niceStep(Math.max(mx - mn, 1) / 4), out = [];
      for(let k = 0; mn + k * st <= mx + 1e-9; k++) out.push(mn + k * st);
      return out;
    },
    values: (u, ticks) => {
      const d = stepDecimals(ticks.length > 1 ? ticks[1] - ticks[0] : 1);
      return ticks.map(t => Math.max(0, t - u.scales.cum.min).toFixed(d));
    }
  }, { font: cssFont(hi ? 20 : 12) });
}

// ZOOM: trascinamento col mouse (gia' in uPlot); sul telefono pizzico a due dita e trascinamento orizzontale
// a un dito (solo se zoomato: in verticale la pagina scorre). Pulsante "Tutto" quando e' zoomato. full() =
// [min, max] dell'intero periodo; minSpan = intervallo minimo (s); withBtn = false: niente pulsante.
function addZoomUI(u, full, minSpan, withBtn){
  const over = u.over;
  u._full = full;
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
// Zoom del grafico mostrato (o delle fasce), da rimettere dopo un ridisegno coi dati nuovi: null senza zoom.
// Se arrivava all'ultimo dato, dopo il ridisegno segue i dati nuovi con la stessa ampiezza.
const shownPlot = () => chart || (stackObj && stackObj.panels[0] && stackObj.panels[0].u) || null;
// l'intero periodo: quello del pulsante «Tutto» o, nei grafici senza (bilancio), quello dei dati
const plotFull = u => u._full ? u._full()
  : (u.data && u.data[0].length ? [u.data[0][0], u.data[0][u.data[0].length - 1]] : null);
function zoomState(){
  const u = shownPlot(), f = u && plotFull(u), s = u && u.scales.x;
  if(!f || s.min == null || !(s.min > f[0] + 1 || s.max < f[1] - 1)) return null;
  return { min:s.min, max:s.max, end:s.max >= f[1] - 1 };
}
function restoreZoom(z){
  const u = z && shownPlot(), f = u && plotFull(u);
  if(!f) return;
  const mx = z.end ? f[1] : Math.min(z.max, f[1]), mn = Math.max(f[0], mx - (z.max - z.min));
  if(mx > mn) u.setScale('x', { min:mn, max:mx });
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

// PM10: i giorni dell'anno con la media oltre il limite (pm10_anno.json del Pi), sotto il grafico
const pm10Years = new Map();
async function loadPm10Year(region){
  const hit = pm10Years.get(region);
  if(hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.p;
  const p = fdata(region + '/pm10_anno.json').then(r => r.ok ? r.json() : null).catch(() => null);
  pm10Years.set(region, { at:Date.now(), p });
  return p;
}
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre',
              'ottobre', 'novembre', 'dicembre'];
const dalTxt = d => {                    // "dal 3 luglio", "dall'8 luglio", "dal 1° luglio"
  const n = d.getUTCDate();
  return (n === 8 || n === 11 ? 'dall\'' + n : 'dal ' + (n === 1 ? '1°' : n)) + ' ' + MESI[d.getUTCMonth()];
};
let _pmSeq = 0;
async function showPm10Year(){
  const box = el('pm10year'), st = currentStation, seq = ++_pmSeq;
  if(!st || currentVar !== 'PM10' || !st._region.startsWith('AQ_') || isCompareMode() || histMode
     || document.body.classList.contains('view-compare')){
    box.hidden = true;
    return;
  }
  const y = await loadPm10Year(st._region), arr = y && y.s && y.s[st.scode];
  if(seq !== _pmSeq) return;
  if(!arr || !arr.some(v => v != null)){ box.hidden = true; return; }
  const year = y.anno, days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 864e5;
  const over = v => v != null && v > y.soglia, dayOf = i => new Date(Date.UTC(year, 0, 1 + i));
  const first = arr.findIndex(v => v != null), n = arr.filter(over).length, c = varColor('PM10');
  const unit = varUnit('PM10', st) || 'µg/m³';
  const sentence = (n ? n + (n === 1 ? ' giorno' : ' giorni') : 'Nessun giorno') + ' oltre il limite, '
                 + 'ammessi ' + y.ammessi + (first > 0 ? ', ' + dalTxt(dayOf(first)) : '');
  const rects = arr.map((v, i) => v == null ? ''
    : '<rect' + (over(v) ? ' class="over"' : ' fill-opacity="0.22"') + ' x="' + i + '" width="1" height="10"'
      + ' fill="' + c + '"/>').join('');
  const months = [0, 3, 6, 9].map(m => '<span class="py-m" style="left:'
    + (100 * (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 864e5 / days).toFixed(2) + '%">'
    + MESI[m].slice(0, 3) + '</span>').join('');
  box.innerHTML = '<span class="py-year">' + year + '</span><svg viewBox="0 0 ' + days
    + ' 10" preserveAspectRatio="none" role="img" aria-label="' + escHtml(sentence) + '">'
    + '<rect class="py-track" width="' + days + '" height="10"/>' + rects + '</svg>'
    + '<span></span><div class="py-months">' + months + '</div><div class="py-txt" title="Limite: media del '
    + 'giorno oltre ' + y.soglia + ' ' + unit + ', al massimo ' + y.ammessi + ' giorni l\'anno">'
    + escHtml(sentence) + '</div>';
  const sv = box.querySelector('svg'), tx = box.querySelector('.py-txt');
  sv.addEventListener('pointermove', e => {
    const r = sv.getBoundingClientRect(), i = Math.floor((e.clientX - r.left) / r.width * days), v = arr[i];
    if(v == null){ tx.textContent = sentence; return; }
    const d = dayOf(i);
    tx.textContent = pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + ': ' + v + ' ' + unit;
  });
  sv.addEventListener('pointerleave', () => { tx.textContent = sentence; });
  box.hidden = false;
}

// grafico principale: 'week' (7 g), 'day3' (3 g), 'day' (24 h), 'mn' (da mezzanotte), con le variabili
// scelte; 'compare'/'compare30' -> renderCompare (una variabile)
function renderChart(label){
  clearChart();
  setStatus('');                         // il messaggio di una vista (niente vicine...) non resta
  showPm10Year();
  const stk = stacked();
  document.body.classList.toggle('stacked', stk);
  if(stk){ renderStackView(); return; }
  // La colonna a destra (i nomi delle stazioni) c'e' solo nel Confronto schede, che la apre da se': va chiusa
  // PRIMA di creare il grafico, che ne prende la larghezza.
  el('chartlegend').style.display = 'none';
  if(label === WBIL) return renderBilancio();
  const cv = label === WARROW ? 'VVENTO' : label, unit = varUnit(cv, currentStation);   // Vento: la velocita'
  if(chartMode === 'compare' || chartMode === 'compare30'){
    const t = (chartMode === 'compare30') ? currentStation._table30 : currentStation._table;
    if(t) renderCompare(t, cv, unit);
    return;
  }
  if(chartMode === 'tabs'){ renderCompareTabs(cv, unit); return; }
  if(chartMode === 'near') return renderNear(cv, unit);
  const m = mainModel(currentStation, selVars(), chartMode);
  chart = new uPlot(mainOpts(m, { w: chartWidth(), h: chartHeight() }), m.data, el('chart'));
  chart._m = m;
  chart._hi = (W, H) => mainOpts(m, { w: W, h: H, hi: true });
  renderLegend(chart);
  addZoomUI(chart, () => m.win, HOUR);
  el('chartsum').textContent = chartSummary(m);
}
// BILANCIO IDRICO, giorno civile per giorno: pioggia del giorno (valida se le letture coprono almeno 20
// ore) ed ET0 (una al giorno). Un giorno senza l'una o l'altra non entra in nessuna delle due cumulate, che
// restano piatte: il bilancio non pende da una parte. null con meno di 20 giorni validi.
const BIL_HOURS = 20, BIL_DAYS = 20;
function waterBalance(t){
  const P = t.cols.PREC || [], E = t.cols.ET0 || [], byDay = new Map(), today = civDay(Date.now() / 1000);
  for(let i = 0; i < t.x.length; i++){
    const x = t.x[i];
    if(x == null) continue;
    const d = civDay(x - 1);
    if(d >= today) continue;                   // il giorno in corso non e' finito: pioggia ed ET0 a meta'
    let o = byDay.get(d);
    if(!o) byDay.set(d, o = { p:0, hours:new Set(), e:null });
    if(P[i] != null){
      o.p += P[i];
      o.hours.add(Math.floor((x - 1) / HOUR));
    }
    if(E[i] != null) o.e = E[i];
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  if(!days.length) return null;
  const x = [civMidnight(days[0])], p = [0], e = [0], rows = [];
  let cp = 0, ce = 0, valid = 0;
  days.forEach(d => {
    const o = byDay.get(d), rain = o.hours.size >= BIL_HOURS ? round2(o.p) : null;
    const ok = rain != null && o.e != null;
    if(ok){
      cp += rain;
      ce += o.e;
      valid++;
    }
    x.push(civMidnight(d + 1));
    p.push(round2(cp));
    e.push(round2(ce));
    rows.push({ d, p:rain, e:o.e, ok });
  });
  return valid >= BIL_DAYS ? { x, p, e, valid, rows } : null;
}
// La vista: due linee cumulate da zero; al cursore le due e il bilancio
let _bilSeq = 0;
async function renderBilancio(){
  const st = currentStation, seq = ++_bilSeq;
  clearChart();
  el('chartlegend').innerHTML = '';
  if(!(await ensureTable30()) || seq !== _bilSeq || currentStation !== st || currentVar !== WBIL) return;
  const b = waterBalance(st._table30);
  if(!b){ setStatus('Dati insufficienti per il bilancio.'); return; }
  setStatus('');
  const opts = (hi, W, H) => {
    const fnt = { font:cssFont(hi ? 20 : 12) }, grid = hi ? '#e3e9f0' : GRID(), ax = hi ? '#33475a' : AXTX();
    const cP = varColor('PREC', false, hi), cE = varColor('ET0', false, hi);
    return {
      width:W, height:H, tzDate:TZ_CIV, legend:{ show:false },
      scales:{ x:{ time:true }, y:{ range:(u, mn, mx) => [0, Math.max(1, mx * 1.08)] } },
      series:[{ value:(u, ts) => ts == null ? '--' : fmtFull(ts) },
              mkSeries({ label:'Pioggia', color:cP }, hi),
              mkSeries({ label:'Evapotraspirazione', color:cE }, hi)],
      axes:[dateAxis(hi, ax), Object.assign({
        grid:{ stroke:grid }, size:hi ? 82 : 58, unit:'mm', unitSize:hi ? 20 : 12, stroke:ax,
        names:hi ? null : [{ text:'Pioggia', color:cP }, { text:'Evapotraspirazione', color:cE }],
        incrs:TICK_STEPS, values:tickTexts
      }, fnt)],
      padding:[hi ? 44 : 24, null, null, null],
      cursor:hi ? { show:false }
                : { y:false, drag:{ x:true, y:false }, dataIdx:cursorDataIdx, points:{ show:hoverPt } },
      hooks:hi ? { draw:[drawUnits] } : { draw:[drawUnits], setCursor:[legendCursor] }
    };
  };
  chart = new uPlot(opts(false, chartWidth(), chartHeight()), [b.x, b.p, b.e], el('chart'));
  chart._hi = (W, H) => opts(true, W, H);
  chart._bil = b;
  chart._fmt = (i, v) => fmtNum(v) + ' mm';
  chart._top = gi => {
    const d = new Date(civT(b.x[gi] - 1) * 1000);
    return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1);
  };
  chart._extra = gi => 'Bilancio ' + fmtNum(round2(b.p[gi] - b.e[gi])) + ' mm';
  addLabels(chart);
  const n = b.p.length - 1;
  el('chartsum').textContent = 'Bilancio idrico degli ultimi 30 giorni: pioggia ' + fmtNum(b.p[n]) +
    ' mm, evapotraspirazione ' + fmtNum(b.e[n]) + ' mm.';
}
function exportBilancioCSV(){
  const b = chart && chart._bil;
  if(!b || !currentStation) return;
  const c = v => v == null ? '' : v;
  const rows = ['giorno;pioggia_mm;et0_mm;nel_bilancio;pioggia_cumulata;et0_cumulata;bilancio']
    .concat(b.rows.map((r, k) => [new Date(r.d * DAY_S * 1000).toISOString().slice(0, 10), c(r.p), c(r.e),
                                  r.ok ? 'si' : 'no', b.p[k + 1], b.e[k + 1], round2(b.p[k + 1] - b.e[k + 1])]
      .join(';')));
  saveBlob(new Blob([rows.join('\n') + '\n'], { type:'text/csv;charset=utf-8' }),
           'bilancio_' + pngBase() + '.csv');
}

// per chi usa un lettore di schermo: l'ultimo valore di ogni variabile e la sua ora
function chartSummary(m){
  return m.ss.map(s => {
    let i = s.y.length - 1;
    while(i >= 0 && s.y[i] == null) i--;
    if(i < 0) return varLabel(s.v) + ': nessun dato';
    return varLabel(s.v) + ': ' + numTxt(s.y[i], s.src) + (s.unit ? ' ' + s.unit : '') + ' alle ' +
           fmtDayTime(s.x[i]);
  }).join('; ') + '.';
}
// Una serie per variabile (vars[0] sull'asse sinistro). Il "Vento" e' la velocita' con le frecce della
// direzione; la cumulata della pioggia c'e' solo con la pioggia da sola.
function mainModel(st, vars, mode){
  const t = st._table, src = v => v === WARROW ? 'VVENTO' : v;
  let lo = Infinity, hi = -Infinity;
  for(const x of t.x) if(x != null && !isNaN(x)){
    if(x < lo) lo = x;
    if(x > hi) hi = x;
  }
  const end = tableEnd(t, vars.map(src));
  if(end != null) hi = end;
  const ok = lo !== Infinity && hi >= lo;
  let from = ok ? modeStart(mode, lo, hi) : 0;
  // Dati giornalieri (le polveri): in 24 h e Oggi il periodo parte almeno dal penultimo valore, coi punti; se
  // no il grafico resterebbe vuoto
  const dailyVars = new Set();
  if(ok && rawMode(mode)) vars.map(src).forEach(c => {
    const col = t.cols[c] || [], xs = t.x.filter((x, i) => x != null && col[i] != null);
    if(xs.length < 2 || medianStep(xs) < 12 * HOUR) return;
    dailyVars.add(c);
    if(xs.filter(x => x >= from).length < 2) from = Math.min(from, xs[xs.length - 2]);
  });
  // MN appena dopo mezzanotte, senza letture: almeno un'ora vuota
  const to = ok ? (mode === 'mn' ? Math.max(hi, from + HOUR) : hi) : 0;
  const ss = vars.map(v => {
    const c = src(v), ys = applyOff(t.cols[c] || [], varOffset(c, st), varScale(c, st));
    const s = { v, src: c, unit: varUnit(c, st) };
    if(c === SNOWNEW){                   // una barra sulla sua giornata civile
      const fs = freshSnow(t), keep = fs.x.map(x => x >= from && x < to);
      const x = fs.x.filter((_, j) => keep[j]), y = fs.y.filter((_, j) => keep[j]);
      return Object.assign(s, { kind:'bars', x, y,
                                rs:{ x, y, align:1, slot:DAY_S, hourly:false, step:DAY_S, gaps:[] } });
    }
    if(isRainVar(c)){
      const rs = rainSeries(t.x, ys, c, from, to, !rawMode(mode));
      return Object.assign(s, { kind: 'bars', x: rs.x, y: rs.y, rs, ys });
    }
    const ls = lineSeries(t.x, ys, from, to);
    return Object.assign(s, { kind: isDirVar(c) ? 'dots' : 'line', x: ls.x, y: ls.y, pts: dailyVars.has(c) });
  });
  const s1 = ss[0];
  const cum = (ss.length === 1 && s1.src === 'PREC') ? rainCum(s1.rs, to) : null;
  // in MN la linea del giorno coinciderebbe con la cumulata
  const daily = (cum && mode !== 'mn') ? rainDaily(t.x, s1.ys, s1.rs, to) : null;
  // il radar nel punto della stazione: nei suoi intervalli la barra del pluviometro passa nella serie a meta'
  const radar = (showRadar && s1 && s1.src === 'PREC' && st._radar) ? radarBars(st._radar, s1.rs, to) : null;
  const inRadar = new Set(radar ? radar.x : []);
  const tabs = ss.map(s => [s.x, s.y]);
  if(radar) tabs[0] = [s1.x, s1.y.map((y, j) => inRadar.has(s1.x[j]) ? null : y)];
  if(cum) tabs.push([cum.x, cum.y]);
  if(radar){
    const j = s1.x.map((x, k) => k).filter(k => inRadar.has(s1.x[k]));
    tabs.push([j.map(k => s1.x[k]), j.map(k => s1.y[k])], [radar.x, radar.y]);
  }
  // con orari diversi i vuoti restano "undefined"
  let data = tabs.length > 1 ? uPlot.join(tabs) : [s1.x, s1.y];
  // MN senza letture di oggi: due punti vuoti tengono l'asse del tempo da mezzanotte
  if(mode === 'mn' && !data[0].length) data = [[from, to]].concat(data.slice(1).map(() => [null, null]));
  const X = data[0];
  let wind = null;
  const wi = vars.indexOf(WARROW);
  if(wi >= 0){
    const dir = t.cols.DVENTO || [], at = new Map();
    t.x.forEach((x, i) => { if(x != null && dir[i] != null) at.set(x, dir[i]); });
    const sp = applyOff(t.cols.VVENTO || [], varOffset('VVENTO', st), varScale('VVENTO', st));
    wind = {
      i: wi + 1, arrows: windArrows(t.x, sp, dir, from, to, !rawMode(mode)), dense: rawMode(mode),
      dirs: X.map(x => at.has(x) ? at.get(x) : null)
    };
  }
  // la neve fresca da sola ha solo le mezzanotti: la finestra e' il periodo (oggi fino all'ultima lettura)
  const win = (mode === 'mn' || s1.src === SNOWNEW) ? [from, to]
            : (X.length ? [X[0], X[X.length - 1]] : null);
  // l'ultima barra del radar per intero, anche oltre l'ultima lettura della stazione
  if(radar && win)
    win[1] = Math.max(win[1], radar.x[radar.x.length - 1] + (radar.align === 1 ? radar.slot : 0));
  const iCum = cum ? ss.length + 1 : null, iHalf = radar ? ss.length + (cum ? 2 : 1) : null;
  // su tutta la serie: un evento cominciato prima della finestra conta per intero
  const events = (s1 && s1.src === 'PREC') ? rainEvents(t.x, s1.ys, s1.rs.step || HOUR) : null;
  return {
    st, vars, ss, s1, cum, daily, wind, data, win, radar, events, radarSrc: st._radar,
    gaps: [].concat(...ss.map(s => s.rs ? s.rs.gaps : [])),
    iCum, iHalf, iRadar: radar ? iHalf + 1 : null
  };
}
// Un asse per unita' di misura (temperatura e rugiada sullo stesso): il primo a sinistra, gli altri a destra.
function mainAxes(m){
  const groups = [];
  m.ss.forEach(s => {
    const dir = isDirVar(s.src);
    let g = groups.find(a => a.unit === s.unit && a.dir === dir);
    if(!g){
      g = { unit: s.unit, dir, key: groups.length ? 'y' + groups.length : 'y', ss: [] };
      groups.push(g);
    }
    g.ss.push(s);
    s.scale = g.key;
  });
  return groups;
}
const windY = () => ({ range: (u, mn, mx) => [0, Math.max(1, (mx || 0) * 1.15)] });
// opzioni uPlot del grafico principale; o = {w, h, hi}. hi = PNG (su bianco, font grandi, niente cursore).
// Con piu' assi ognuno ha il colore della sua variabile; neutro se ne porta piu' d'una.
function mainOpts(m, o){
  // schermo stretto (telefono): assi piu' sottili, il grafico resta largo anche con tre variabili
  const hi = !!o.hi, narrow = !hi && o.w < 520, fnt = { font: cssFont(hi ? 20 : 12) };
  const grid = hi ? '#e3e9f0' : GRID(), ax = hi ? '#33475a' : AXTX(), CC = hi ? '#1a365d' : CUMC();
  const col = (v, text) => varColor(v, text, hi);
  const groups = mainAxes(m), many = groups.length > 1;
  const series = [{ value: (u, ts) => ts == null ? '--' : fmtFull(ts) }];
  m.ss.forEach(s => {
    const c = col(s.v), w = s.v === WARROW;
    series.push(mkSeries({
      label: varLabel(s.v) + (hi && s.unit ? ' (' + s.unit + ')' : ''), color: w ? withAlpha(c, 0.45) : c,
      kind: s.kind, scale: s.scale, align: s.rs && s.rs.align, slot: s.rs && s.rs.slot,
      slotTxt: s.src === SNOWNEW ? 'day' : (s.rs && s.rs.hourly) ? (s.src === 'PREC' ? 'range' : 'end') : '',
      width: w ? (hi ? 1.6 : 1) : 0, pts: s.pts
    }, hi));
  });
  const axes = timeAxes(hi, ax, true);
  const scales = {};
  // con piu' serie il nome di ognuna sta sopra il suo asse (il radar con la pioggia); nel PNG c'e' la legenda
  const named = !hi && (m.ss.length > 1 || !!m.radar);
  groups.forEach((g, k) => {
    const one = g.ss.length === 1 ? g.ss[0].v : null;
    const names = g.ss.map(s => ({ text:varShort(s.v), color:col(s.v) }))
      .concat(m.radar && g.key === m.s1.scale ? [{ text:'Radar', color:col('RADAR') }] : []);
    const a = Object.assign({
      scale: g.key, grid: k ? { show:false } : { stroke: grid }, unit: g.unit, unitSize: hi ? 20 : 12,
      names: named ? names : null,
      size: hi ? 82 : narrow ? 38 : 54, stroke: many && one ? col(one, true) : ax, space: hi ? 70 : 44,
      incrs: TICK_STEPS, values: tickTexts
    }, fnt);
    if(k) a.side = 1;
    axes.push(g.dir ? dirAxis(a) : a);
    scales[g.key] = g.ss.some(s => isRainVar(s.src) || s.src === SNOWNEW) ? rainY() : g.dir ? dirY()
                  : g.ss.some(s => s.v === WARROW) ? windY() : {};
  });
  if(m.cum){
    series.push(mkSeries({ label: 'Cumulata', color: CC, kind: 'cum', scale: 'cum' }, hi));
    axes.push(cumAxis(hi, CC));
    scales.cum = cumY(m.daily && (u => dailyTop(u, m.daily)));
  }
  if(m.radar){
    // la meta' del pluviometro senza nome (nel PNG non si ripete nella legenda)
    const r = m.radar, slotTxt = m.s1.rs.hourly ? 'range' : '';
    const d = { scale:m.s1.scale, align:r.align, slot:r.slot, slotTxt };
    series.push(mkSeries(Object.assign({ label:'', kind:'bars', half:'left', color:col(m.s1.v) }, d), hi),
                mkSeries(Object.assign({ label:'Radar', kind:'radar', half:'right', color:col('RADAR') }, d),
                         hi));
  }
  // Un intervallo dentro la finestra e piu' stretto e' uno zoom e va accettato; il resto (anche dati che
  // sporgono, come l'inizio della cumulata prima di mezzanotte) torna alla finestra intera. La prima
  // richiesta di uPlot e' l'estensione dei dati: non e' uno zoom anche quando i dati partono dopo la
  // finestra (la prima lettura di Oggi dopo mezzanotte) o finiscono prima (l'ultima barra del radar).
  const w = m.win, X = m.data[0], dataSpan = (a, b) => X.length && a === X[0] && b === X[X.length - 1];
  const zoom = (a, b) => !dataSpan(a, b) && a >= w[0] - 1 && b <= w[1] + 1 && (a > w[0] + 1 || b < w[1] - 1);
  scales.x = {
    time:true,
    range: (u, a, b) => !w ? [a, b]
      : (w[0] === w[1] ? [w[0] - HOUR, w[1] + HOUR] : (zoom(a, b) ? [a, b] : [w[0], w[1]]))
  };
  const hooks = hi ? { drawClear: [nightBandsHi, gapBands(m.gaps, true)] }
                   : { drawClear: [nightBands, gapBands(m.gaps)], setCursor: [legendCursor] };
  if(m.daily) addDailyHooks(hooks, m.daily, CC, hi);
  if(m.wind) hooks.draw = (hooks.draw || []).concat(
    drawArrows(m.wind.arrows, col(WARROW), hi, m.wind.dense, m.ss[m.wind.i - 1].scale));
  hooks.draw = (hooks.draw || []).concat(drawUnits);
  if(m.events && m.events.length) hooks.draw.push(drawEvents(m.events, col(m.s1.v), hi, m.s1.unit));
  return {
    width: o.w, height: o.h, tzDate: TZ_CIV, legend: { show:false }, series, axes, scales, hooks,
    padding: [hi ? 44 : 24, null, null, null],
    cursor: hi ? { show:false }
               : { y:false, drag:{ x:true, y:false }, dataIdx: cursorDataIdx, points:{ show: hoverPt } }
  };
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
      label: isToday ? 'Oggi' : dayLabel(day), color, isToday, spanGaps: true,
      kind: dir ? 'dots' : 'line'
    });
    data.push(X.map(tod => m.has(tod) ? m.get(tod) : null));
  });
  const full = rain ? [0, DAY_S] : [X[0], X[X.length - 1]];
  const opts = hi => {
    const fnt = { font: cssFont(hi ? 20 : 12) }, grid = hi ? '#e3e9f0' : GRID();
    const yAx = Object.assign({
      grid:{ stroke: grid }, size: hi ? 82 : 58, unit, unitSize: hi ? 20 : 12,
      incrs: TICK_STEPS, values: tickTexts
    }, hi ? { stroke:'#33475a' } : {}, fnt);
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
      padding: [hi ? 44 : 24, null, null, null],
      cursor: hi ? { show:false }
                 : { y:false, drag:{ x:true, y:false }, dataIdx: cursorDataIdx, points:{ show: hoverPt } },
      hooks: hi ? { draw: [drawUnits] } : { draw: [drawUnits], setCursor: [ legendCursor ] },
    };
  };
  chart = new uPlot(opts(false), data, el('chart'));
  chart._hi = (W, H) => Object.assign(opts(true), { width: W, height: H });
  Object.assign(chart, { _days: true, _unit: unit, _src: label, _dir: dir });
  renderLegend(chart);
  addZoomUI(chart, () => full, HOUR);
}

// ------------------------------------------------------------------------------------------------
// PILA DI GRAFICI ("Impilate"): un pannello uPlot per variabile, asse del tempo condiviso, cursore e
// zoom sincronizzati. Il motore (createStack) non dipende dalla scheda stazione.
// ------------------------------------------------------------------------------------------------
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

// Opzioni uPlot di UN pannello. p = {v, src, label, kind, rs, cum, gaps, npts, wind}; una fascia per stazione
// porta anche color (al posto di quello della variabile), solid (barre piene senza bordo) e ymax (la scala di
// tutte le fasce). o = {w,h,last,win,hi,sync,hooks,rgut}. hi = versione ad alta risoluzione per il PNG (font
// grandi, niente cursore). rgut = spazio a destra per l'asse della cumulata: i pannelli senza cumulata lo
// lasciano vuoto, cosi' gli assi del tempo restano allineati.
function stackPanelOpts(p, o){
  const hi = !!o.hi;
  // niente 'font: undefined': uPlot lo prenderebbe alla lettera
  const fnt = { font: cssFont(hi ? 20 : 12) };
  const grid = hi ? '#e3e9f0' : GRID(), ax = hi ? '#33475a' : AXTX(), CC = hi ? '#1a365d' : CUMC();
  const color = p.color || varColor(p.v, false, hi);
  const series = [
    { value:(u, ts) => ts == null ? '--' : fmtFull(ts) },
    mkSeries({
      label: p.label, color: p.wind ? withAlpha(color, 0.45) : color, kind: p.kind, solid: p.solid,
      align: p.rs && p.rs.align, slot: p.rs && p.rs.slot,
      slotTxt: (p.rs && p.rs.hourly) ? (p.src === 'PREC' ? 'range' : 'end') : '',
      ptSize: 3, ptSizeHi: 6
    }, hi)
  ];
  const axX = timeAxes(hi, ax, o.last);
  const axY = Object.assign({
    grid:{stroke:grid}, size: hi ? 82 : 58, stroke: p.color ? ax : varColor(p.v, true, hi),
    incrs: TICK_STEPS, values: tickTexts
  }, fnt);
  const axes = axX.concat(isDirVar(p.src) ? dirAxis(axY) : axY);
  const scales = {
    // Un intervallo piu' STRETTO della finestra e' uno zoom e va accettato; quello dei dati (uPlot lo
    // ripassa a ogni ridisegno) no: i dati possono cominciare dopo l'inizio della finestra.
    x:{ time:true, range:(u, a, b) => {
      if(a == null || b == null) return o.win;                  // fascia senza dati nel periodo
      const d = u.data[0], data = d.length > 0 && a === d[0] && b === d[d.length - 1];
      return !data && (a > o.win[0] + 1 || b < o.win[1] - 1) ? [a, b] : o.win;
    } },
    y: p.ymax ? { range:() => [0, p.ymax] } : p.wind ? windY() : yScaleFor(p.src) };
  const rg = (o.rgut || 0) * (hi ? 82 / STACK_RGUT : 1);
  const h = Object.assign({}, hi ? { drawClear:[nightBandsHi, gapBands(p.gaps, true)] } : o.hooks);
  if(p.wind) h.draw = (h.draw || []).concat(drawArrows(p.wind.arrows, color, hi, p.wind.dense));
  if(p.cum){
    series.push(mkSeries({ label: 'Cumulata', color: CC, kind: 'cum', scale: 'cum' }, hi));
    const ca = cumAxis(hi, CC);
    ca.size = rg;
    ca.unit = '';                             // il nome e l'unita' sono nella testata della fascia
    axes.push(ca);
    const span = p.cumSpan && (u => p.cumSpan(u, o.win));
    scales.cum = cumY(span || (p.daily && (u => dailyTop(u, p.daily))));
    if(span) h.setScale = (h.setScale || []).concat((u, key) => {
      if(key === 'x') queueMicrotask(() => fitCumSpan(u, span));
    });
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
    hooks: p.daily ? addDailyHooks(h, p.daily, CC, hi) : h
  };
}

// Una fascia per variabile della stazione: { panels, win, rgut }, null se nel periodo non c'e' nulla
function varPanels(cfg, hourly){
  const st = cfg.station, t = cfg.table, units = unitsByRegion[st._region] || {}, mode = cfg.mode || 'week';
  const srcOf = v => v === WARROW ? 'VVENTO' : v;
  const win0 = cfg.win || stackWindow(t, mode, cfg.vars.map(srcOf));
  if(!win0) return null;
  // senza il periodo della curva singola, con barre orarie la finestra parte dall'inizio della prima ora
  const win = (!cfg.win && hourly && cfg.vars.map(srcOf).some(isRainVar))
    ? [Math.floor((win0[0] - 1) / HOUR) * HOUR, win0[1]] : win0;
  const panels = cfg.vars.map(v => {
    const src = srcOf(v);
    const ys = applyOff(t.cols[src] || [], varOffset(src, st), varScale(src, st, units));
    let npts = 0;
    for(let k = 0; k < ys.length; k++) if(ys[k] != null && t.x[k] >= win[0] && t.x[k] <= win[1]) npts++;
    const unit = varUnit(src, st, units);
    const p = {
      v, src, label: varLabel(v), unit, kind: isRainVar(src) ? 'bars' : (isDirVar(src) ? 'dots' : 'line'),
      npts, gaps: [], cum: false, head: { color: varColor(v), name: varShort(v), extra: unit }
    };
    if(isRainVar(src)){            // pioggia: barre orarie (7 e 3 giorni), buchi tratteggiati, cumulata PREC
      p.rs = rainSeries(t.x, ys, src, win0[0], win0[1], hourly);
      p.gaps = p.rs.gaps;
      const cum = isSumVar(src) ? rainCum(p.rs, win0[1]) : null;
      p.cum = !!cum;
      p.daily = (cum && mode !== 'mn') ? rainDaily(t.x, ys, p.rs, win0[1]) : null;
      p.data = cum ? uPlot.join([[p.rs.x, p.rs.y], [cum.x, cum.y]]) : [p.rs.x, p.rs.y];
    } else {
      const ls = lineSeries(t.x, ys, win[0], win[1]);
      p.data = [ls.x, ls.y];
    }
    if(v === WARROW){
      const dir = t.cols.DVENTO || [], at = new Map();
      t.x.forEach((x, k) => { if(x != null && dir[k] != null) at.set(x, dir[k]); });
      p.wind = { arrows: windArrows(t.x, ys, dir, win0[0], win0[1], hourly), dense: !hourly,
                 dirs: p.data[0].map(x => at.has(x) ? at.get(x) : null) };
    }
    return p;
  });
  return { panels, win, rgut: cfg.vars.some(isSumVar) ? STACK_RGUT : 0 };
}
// Una fascia per stazione (Vicine, Confronto schede), stessa misura e stessa scala: barre affiancate in un
// grafico solo si coprirebbero. Sopra il nome, il totale del periodo e (vicine) distanza e quota. Con la
// pioggia per intervallo anche la cumulata, ampia uguale in ogni fascia.
// cfg = { list:[{props, sub}], src, unit, mode, colors }
function stationPanels(cfg, hourly){
  const src = cfg.src, un = cfg.unit ? ' ' + cfg.unit : '', sum = isSumVar(src);
  let lo = Infinity, hi = -Infinity;
  cfg.list.forEach(t => {
    const tb = t.props._table, e = tableEnd(tb, [src]);
    tb.x.forEach(x => { if(x != null && x < lo) lo = x; });
    if(e != null && e > hi) hi = e;
  });
  if(lo === Infinity || hi === -Infinity) return null;
  const from = modeStart(cfg.mode, lo, hi);
  const win = [hourly ? Math.floor((from - 1) / HOUR) * HOUR : from, Math.max(hi, from + HOUR)];
  const panels = cfg.list.map((t, k) => {
    const tb = t.props._table, rs = rainSeries(tb.x, tb.cols[src] || [], src, from, hi, hourly);
    const name = prettyName(t.props.name || t.props.scode), color = cfg.colors[k % cfg.colors.length];
    const any = rs.y.some(y => y != null);
    // il totale solo per la pioggia per intervallo: le finestre 1-48 h sommate conterebbero piu' volte
    const total = () => fmtNum(round2(rs.y.reduce((a, y) => a + (y || 0), 0))) + un;
    const extra = !any ? 'n.d.' : sum ? total() : cfg.unit || '';
    const cum = sum && any ? rainCum(rs, win[1]) : null;
    return {
      v: src, src, label: name, unit: cfg.unit, kind: 'bars', rs, gaps: rs.gaps, cum: !!cum,
      npts: rs.y.filter(y => y != null).length, color, solid: true,
      data: cum ? uPlot.join([[rs.x, rs.y], [cum.x, cum.y]]) : [rs.x, rs.y],
      head: { color, name, extra, sub: t.sub }, pngTitle: name + (extra ? ' (' + extra + ')' : '')
    };
  });
  const top = Math.max(0, ...panels.map(p => Math.max(0, ...p.rs.y.filter(y => y != null))));
  const ymax = top > 0 ? Math.max(1, uPlot.rangeNum(0, top, 0.1, true)[1]) : 1;
  panels.forEach(p => {
    p.ymax = ymax;
    // finche' il grafico non ha la sua scala (il PNG) vale la finestra disegnata
    if(p.cum) p.cumSpan = (u, win) =>
      cumRise(panels, u.scales.x.min != null ? u.scales.x : { min:win[0], max:win[1] });
  });
  return { panels, win, rgut: sum ? STACK_RGUT : 0 };
}
// La salita piu' alta delle cumulate nel tratto visibile: con questa ampiezza sull'asse destro di ogni fascia
// (ognuna dal suo valore al bordo sinistro) le stazioni si confrontano a occhio
function cumRise(panels, sx){
  let top = 0;
  panels.forEach(p => {
    if(!p.cum) return;
    const xs = p.data[0], cs = p.data[2];
    let a = null, b = null;
    for(let i = 0; i < xs.length; i++){
      if(cs[i] == null || (sx.min != null && (xs[i] < sx.min || xs[i] > sx.max))) continue;
      if(a == null) a = cs[i];
      b = cs[i];
    }
    if(a != null) top = Math.max(top, b - a);
  });
  return top;
}
// uPlot calcola l'asse destro con l'intervallo di prima dello zoom: si rifa' con quello nuovo, a zoom fatto
function fitCumSpan(u, span){
  if(!u.root.isConnected) return;
  const xs = u.data[0], cs = u.data[2], sx = u.scales.x, sc = u.scales.cum;
  let a = null;
  for(let i = 0; i < xs.length && a == null; i++)
    if(cs[i] != null && xs[i] >= sx.min && xs[i] <= sx.max) a = cs[i];
  if(a == null) return;
  const r = cumY(span).range(u, a, a);
  if(r[0] !== sc.min || r[1] !== sc.max) u.setScale('cum', { min:r[0], max:r[1] });
}
// Valore al cursore di una fascia, accanto alla sua linea: la misura (col vento anche la direzione); la
// cumulata no, si legge sul suo asse
const panelValue = p => (i, v, j) => {
  if(i > 1) return null;
  if(isDirVar(p.src)) return windDirHtml(v);
  const d = p.wind && p.wind.dirs[j];
  return numTxt(v, p.src) + unitTxt(p.unit) + (d != null ? ' ' + windDirHtml(d) : '');
};

// cfg = { station, table, vars:[...], mode:'week'|'day3'|'day'|'mn' }: una fascia per variabile; con
// cfg.list una fascia per stazione (stationPanels). Al cursore il valore sta accanto alla linea del tempo
// in ogni fascia, l'ora sopra la prima.
function createStack(host, cfg){
  const hourly = !rawMode(cfg.mode || 'week');
  const built = cfg.list ? stationPanels(cfg, hourly) : varPanels(cfg, hourly);
  host.innerHTML = '';
  if(!built){
    host.innerHTML = '<div class="stk-note">Nessun dato nel periodo.</div>';
    return { panels:[], destroy(){ host.innerHTML = ''; }, resize(){} };
  }
  const { win, rgut } = built, n = built.panels.length;
  const sync = uPlot.sync('stk' + (++_stackSeq)).key;
  let ph = stackPanelH(n);
  const AX = 30;
  const root = document.createElement('div');
  root.className = 'stk';
  host.appendChild(root);
  const panels = [];
  let ready = false, zooming = false;
  const width = () => Math.max(220, root.clientWidth || host.clientWidth || 600);

  function onScale(u, key){
    if(key !== 'x' || !ready || zooming) return;
    zooming = true;
    const sx = u.scales.x;
    panels.forEach(q => {
      if(q.u !== u && (q.u.scales.x.min !== sx.min || q.u.scales.x.max !== sx.max))
        q.u.setScale('x', { min:sx.min, max:sx.max });
    });
    zooming = false;
  }

  built.panels.forEach((p, i) => {
    const last = i === n - 1, box = document.createElement('div');
    box.className = 'stk-p';
    box.innerHTML = '<div class="stk-h"><i class="sw"></i><b></b><span class="un"></span></div>'
                  + '<div class="stk-c"></div>';
    box.querySelector('.sw').style.background = p.head.color;
    box.querySelector('b').textContent = p.head.name;
    box.querySelector('.un').textContent = p.head.extra;
    if(p.head.sub){
      const s = document.createElement('span');
      s.className = 'sub';
      s.textContent = p.head.sub;
      box.querySelector('.stk-h').appendChild(s);
    }
    root.appendChild(box);
    const opts = stackPanelOpts(p, {
      w:width(), h: ph + (last ? AX : 0), last, win, sync, rgut,
      hooks:{ drawClear:[nightBands, gapBands(p.gaps)], setScale:[onScale],
              setCursor:[u => { if(u._labs) cursorLabels(u); }] }
    });
    p.u = new uPlot(opts, p.data, box.querySelector('.stk-c'));
    addLabels(p.u);
    Object.assign(p.u, { _src:p.src, _unit:p.unit, _fmt:panelValue(p), _top:i ? () => '' : null });
    addZoomUI(p.u, () => win, HOUR, i === 0);       // pizzico su qualunque pannello; "Tutto" sul primo
    panels.push(p);
  });
  ready = true;
  // computer: le fasce si dividono l'altezza del grafico; sotto i 110 px restano di 110 e la scheda scorre.
  // Si misurano solo le testate: uPlot da' la sua altezza ai grafici piu' tardi
  const wrap = el('chartwrap');
  function fit(){
    wrap.style.minHeight = '';
    if(matchMedia('(max-width:720px)').matches) return;
    const heads = [...root.querySelectorAll('.stk-h')].reduce((a, e) => a + e.offsetHeight, 0);
    const fixed = heads + 2 * n + AX;                                  // 2 = spazio fra le fasce (.stk)
    const h = Math.max(110, Math.floor((host.clientHeight - fixed) / n));
    if(h !== ph){
      ph = h;
      panels.forEach((p, i) => p.u.setSize({ width:width(), height: ph + (i === n - 1 ? AX : 0) }));
    }
    if(fixed + n * ph > host.clientHeight) wrap.style.minHeight = (fixed + n * ph) + 'px';
  }
  fit();
  return {
    panels, win, rgut,
    resize(){
      const w = width();
      panels.forEach((p, i) => p.u.setSize({ width:w, height: ph + (i === n - 1 ? AX : 0) }));
      fit();
    },
    destroy(){ panels.forEach(p => p.u.destroy()); host.innerHTML = ''; wrap.style.minHeight = ''; }
  };
}

// ------------------------------------------------------------------------------------------------
// IMMAGINI PNG di ogni vista (alta risoluzione, su bianco, titolo e fonte in alto)
// ------------------------------------------------------------------------------------------------
const PNG_R = 2;
const MODE_TXT = { week:'Ultimi 7 giorni', day3:'Ultimi 3 giorni', day:'Ultime 24 ore', mn:'Da mezzanotte',
                   compare:'Confronto 7 giorni', compare30:'Confronto 30 giorni', near:'Ultimi 7 giorni' };
function pngCanvas(W, H){
  const cv = document.createElement('canvas');
  cv.width = W * PNG_R;
  cv.height = H * PNG_R;
  const ctx = cv.getContext('2d');
  ctx.scale(PNG_R, PNG_R);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  return { cv, ctx };
}
function pngSubtitle(what, withSource, when){
  const src = withSource && currentStation && SOURCES[currentStation._region];
  return [what, src ? 'Fonte: ' + src.name : '', when || 'Ora italiana'].filter(Boolean).join('  ·  ');
}
function pngHead(ctx, title, what, withSource, when){
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#0f2233';
  ctx.font = cssFont(32, 700);
  ctx.fillText(title, 12, 44);
  ctx.fillStyle = '#5a6b7a';
  ctx.font = cssFont(16);
  ctx.fillText(pngSubtitle(what, withSource, when), 12, 70);
}
// Tela con titolo e legenda in alto: la legenda in riga a destra del titolo se ci sta, se no in righe sue
// sotto; niente colonna a lato, il grafico prende tutta la larghezza. top = dove comincia il grafico.
function pngFrame(W, plotH, head, series){
  const mc = document.createElement('canvas').getContext('2d');
  mc.font = cssFont(32, 700);
  const tw = mc.measureText(head.title).width;
  mc.font = cssFont(16);
  const hw = Math.max(tw, mc.measureText(pngSubtitle(head.what, head.withSource, head.when)).width);
  const one = pngLegendRow(mc, series, 0, 0, false), beside = 12 + hw + 40 + one.w <= W - 12;
  const rows = beside ? 1 : pngLegendRow(mc, series, 0, 0, false, W - 24).rows;
  const top = beside ? 84 : 118 + (rows - 1) * 28, { cv, ctx } = pngCanvas(W, top + plotH + 18);
  pngHead(ctx, head.title, head.what, head.withSource, head.when);
  if(beside) pngLegendRow(ctx, series, W - 12 - one.w, 44, true);
  else pngLegendRow(ctx, series, 12, 102, true, W - 24);
  return { cv, ctx, top };
}
const pngBase = () => prettyName(currentStation.name || currentStation.scode).replace(/[^\w-]+/g, '_') +
                      '_' + currentStation._region;
// codifica subito (toBlob aspetta un momento libero della pagina, che puo' non arrivare)
function toPng(cv){
  const bin = atob(cv.toDataURL('image/png').split(',')[1]), a = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type:'image/png' });
}
// grafico uPlot fuori schermo alla risoluzione delle immagini, atteso fino a disegno finito (niente
// fotogrammi: la pagina puo' non disegnarne, come in Chrome senza schermo); done() lo toglie
async function offPlot(opts, data, W, H){
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;background:#fff;width:' + W + 'px;height:' +
                       H + 'px';
  document.body.appendChild(host);
  let drawn;
  const ready = new Promise(r => { drawn = r; });
  const hooks = Object.assign({}, opts.hooks);
  hooks.draw = (hooks.draw || []).concat(() => drawn());
  const u = new uPlot(Object.assign(opts, { pxRatio: PNG_R, hooks }), data, host);
  await Promise.race([ready, new Promise(r => setTimeout(r, 1500))]);
  return { u, done(){ u.destroy(); host.remove(); } };
}

// legenda in righe: segno della serie (barra, puntino o linea) e nome, a capo oltre maxW; dopo tre righe "…".
// Con draw = false misura soltanto. Restituisce { w, rows } (w = la riga piu' larga).
function pngLegendRow(ctx, series, x, y, draw, maxW = Infinity){
  const x0 = x, ROWS = 3, LH = 28;
  let rows = 1, w = 0;
  ctx.font = cssFont(17);
  ctx.textBaseline = 'alphabetic';
  for(let i = 1; i < series.length; i++){
    const s = series[i];
    if(!s.label) continue;
    const iw = 40 + ctx.measureText(s.label).width;
    if(x > x0 && x + 28 + iw - x0 > maxW){
      if(rows === ROWS){
        if(draw){
          ctx.fillStyle = '#5a6b7a';
          ctx.fillText('…', x + 12, y);
        }
        break;
      }
      rows++;
      x = x0;
      y += LH;
    } else if(x > x0) x += 28;
    if(draw){
      if(s.kind === 'bars'){
        ctx.fillStyle = s.fill;
        ctx.fillRect(x + 6, y - 15, 18, 18);
        if(s.radar){
          ctx.strokeStyle = s.stroke;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 7, y - 14, 16, 16);
        }
      } else if(s.kind === 'dots'){
        ctx.fillStyle = s.stroke;
        ctx.beginPath();
        ctx.arc(x + 15, y - 6, 6, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 30, y - 6);
        ctx.stroke();
      }
      ctx.fillStyle = '#22303c';
      ctx.fillText(s.label, x + 40, y);
    }
    x += iw;
    w = Math.max(w, x - x0);
  }
  return { w, rows };
}
// grafico mostrato (una o piu' variabili, confronti, Confronto schede), legenda in alto
async function chartPNG(){
  const tabs = document.body.classList.contains('view-compare');
  if(!chart || !chart._hi || (!tabs && !currentStation)) return null;
  const W_PLOT = 1500, H_PLOT = 780, L = 12;
  const opts = chart._hi(W_PLOT, H_PLOT), series = opts.series;
  // stessa finestra dello schermo, zoom compreso
  if(chart.scales.x.min != null){
    const xr = [chart.scales.x.min, chart.scales.x.max];
    opts.scales.x.range = () => xr;
  }
  const plot = await offPlot(opts, chart.data, W_PLOT, H_PLOT);
  const m = chart._m, withUnit = (v, un) => varLabel(v) + (un ? ' (' + un + ')' : '');
  let title, what = MODE_TXT[chartMode] || '';
  const near = !tabs && chartMode === 'near';
  if(tabs) title = 'Confronto schede — ' + withUnit(compareVar, chart._unit);
  else if(near)
    title = 'Vicine di ' + prettyName(currentStation.name || currentStation.scode) + ' — '
          + withUnit(currentVar, chart._unit);
  else {
    const name = prettyName(currentStation.name || currentStation.scode);
    const un = varUnit(currentVar === WARROW ? 'VVENTO' : currentVar, currentStation);
    title = name + ' — ' + (m && m.ss.length > 1 ? m.ss.map(s => varShort(s.v)).join(', ')
                                              : withUnit(currentVar, un));
    if(currentVar === 'PREC' && (chartMode === 'compare' || chartMode === 'compare30'))
      what += ', pioggia cumulata dalla mezzanotte';
    if(currentVar === WBIL) what = 'Ultimi 30 giorni, cumulate';
  }
  const { cv, ctx, top } = pngFrame(L + W_PLOT + 12, H_PLOT, { title, what, withSource: !tabs }, series);
  ctx.drawImage(plot.u.ctx.canvas, L, top, W_PLOT, H_PLOT);
  plot.done();
  const fname = tabs ? 'confronto_schede_' + compareVar + '_' + chartMode + '.png'
              : near ? pngBase() + '_vicine_' + currentVar + '.png'
              : currentVar === WBIL ? pngBase() + '_bilancio.png'
              : pngBase() + '_' + (m ? m.vars.join('-') : currentVar) + '_' + chartMode + '.png';
  return { blob: toPng(cv), fname };
}

// Misure del PNG a fasce: con tante fasce (otto schede) piu' basse, cosi' la tela resta sotto i 16.7 Mpx
// che Safari accetta
const stackPngSize = n => {
  const PH = Math.min(300, Math.floor(2000 / n));
  return { PH, W: 12 + 1500, H: 84 + n * (44 + PH) + 46 + 18 };
};
// Impilate e fasce per stazione: un pannello sotto l'altro, ognuno col suo nome
async function stackPNG(){
  const so = stackObj;
  if(!so || !so.panels.length || !currentStation) return null;
  const W_PLOT = 1500, AXH = 46, HEAD = 44, TOP = 84, L = 12, n = so.panels.length;
  const { PH, W, H } = stackPngSize(n);
  const { cv, ctx } = pngCanvas(W, H);
  pngHead(ctx, so.title || prettyName(currentStation.name || currentStation.scode), MODE_TXT[chartMode] || '',
          so.withSource !== false);
  const sx = so.panels[0].u.scales.x, win = sx.min != null ? [sx.min, sx.max] : so.win;
  let y = TOP;
  for(let i = 0; i < n; i++){
    const p = so.panels[i], last = i === n - 1;
    ctx.fillStyle = p.color || varColor(p.v, false, true);
    ctx.fillRect(L + 6, y + 20, 22, 4);
    ctx.fillStyle = '#0f2233';
    ctx.font = cssFont(22, 700);
    ctx.fillText(p.pngTitle || p.label + (p.unit ? ' (' + p.unit + ')' : ''), L + 38, y + 28);
    y += HEAD;
    const h = PH + (last ? AXH : 0);
    const opts = stackPanelOpts(p, { w:W_PLOT, h, last, win, hi:true, rgut:so.rgut });
    const plot = await offPlot(opts, p.data, W_PLOT, h);
    ctx.drawImage(plot.u.ctx.canvas, L, y, W_PLOT, h);
    plot.done();
    y += h;
  }
  return { blob: toPng(cv), fname: so.fname || pngBase() + '_impilate_' + chartMode + '.png' };
}

// Rosa dei venti: lo stesso disegno della pagina, piu' grande, con la legenda delle velocita'
async function rosePNG(){
  const r = el('windrose')._rose;
  if(!r || !currentStation) return null;
  const W = 1000, SW = 760, SH = SW, TOP = 90, H = TOP + SH + 70;
  const { cv, ctx } = pngCanvas(W, H);
  pngHead(ctx, prettyName(currentStation.name || currentStation.scode) + ' — Rosa dei venti',
          MODE_TXT[chartMode] || '', true);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' +
            encodeURIComponent(roseSvg(r, SW * PNG_R, 1.9 * PNG_R)        // nitida sulla tela doppia
              .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
  await img.decode();
  ctx.drawImage(img, (W - SW) / 2, TOP, SW, SH);
  ctx.font = cssFont(18);
  const items = _WR_CLASSES.map(k => ({ k, w: 22 + ctx.measureText(k.l).width + 24 }));
  let x = (W - (44 + items.reduce((a, it) => a + it.w, 0))) / 2;
  const y = TOP + SH + 44;
  ctx.fillStyle = '#5a6b7a';
  ctx.fillText('m/s', x, y);
  x += 44;
  items.forEach(it => {
    ctx.fillStyle = it.k.c;
    ctx.fillRect(x, y - 14, 16, 16);
    ctx.fillStyle = '#22303c';
    ctx.fillText(it.k.l, x + 22, y);
    x += it.w;
  });
  return { blob: toPng(cv), fname: pngBase() + '_rosa_' + chartMode + '.png' };
}

// Pulsante PNG: l'immagine della vista mostrata
async function exportPNG(){
  const btn = el('expBtn');
  if(btn.getAttribute('aria-busy') === 'true') return;
  btn.setAttribute('aria-busy', 'true');
  try {
    const out = histMode ? await histPNG()
              : document.body.classList.contains('rose-mode') ? await rosePNG()
              : document.body.classList.contains('clima-mode') ? await climaPNG()
              : stackObj ? await stackPNG() : await chartPNG();
    if(!out) return;
    btn.removeAttribute('aria-busy');       // pulsante libero prima del foglio di condivisione
    await deliverPNG(out.blob, out.fname);
  } catch(e){
    setStatus('Immagine non riuscita (' + e + ').');
    toast('PNG non riuscito');
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

// CSV del Confronto schede e delle Vicine: una colonna per stazione (dal grafico o dalle fasce della
// pioggia), sugli istanti del grafico (ora italiana)
function exportCompareCSV(fname){
  const t = chart ? { labels: chart.series.slice(1).map(s => s.label), data: chart.data }
                  : stackObj && stackObj.table;
  if(!t) return;
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const rows = [['datetime'].concat(t.labels.map(q)).join(',')];
  t.data[0].forEach((x, i) => {
    const vals = t.data.slice(1).map(d => d[i] == null ? '' : d[i]);
    if(vals.some(v => v !== ''))
      rows.push([new Date(civT(x) * 1000).toISOString().slice(0, 16)].concat(vals).join(','));
  });
  saveBlob(new Blob([rows.join('\n') + '\n'], { type:'text/csv;charset=utf-8' }), fname);
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
  saveBlob(blob, fname);
  toast('PNG salvato in Download: ' + fname);
}

function buildChartControls(){
  new ResizeObserver(() => {
    if(chart) chart.setSize({ width: chartWidth(), height: chartHeight() });
    if(stackObj) stackObj.resize();
    if(histMode && histU) histU.setSize({ width: histWidth(), height: histHeight() });
  }).observe(el('panel'));
  el('pngclose').addEventListener('click', closePngSheet);
  el('pngsheet').addEventListener('click', e => { if(e.target === el('pngsheet')) closePngSheet(); });
}
