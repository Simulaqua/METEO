// clima.js: la Climatologia della stazione, un climogramma dai dati giornalieri dello Storico. Per ogni mese
// minima, media e massima (medie dei giorni completi) e pioggia, mediate fra gli anni dei soli mesi completi:
// le regole dello Storico, giorno completo con almeno 20 ore e mese intero col 90% dei giorni completi.
// I valori si leggono al cursore. L'ascoltatore del CSV e' in buildClimaControls(), chiamata dall'avvio.

let climaU = null, climaData = null, _climaSeq = 0;

// [{tn, tm, tx, p, nt, np}] da gennaio a dicembre; nt e np = anni con il mese completo (temperatura, pioggia)
function climaStats(h){
  const days = {};                     // massime e minime dei giorni completi, per mese di ogni anno
  for(let i = 0; i < h.n; i++){
    if(h.tm[i] == null || !(h.ht[i] >= 20)) continue;
    const d = new Date(h.x[i] * 1000), k = d.getUTCFullYear() + '-' + d.getUTCMonth();
    const o = days[k] || (days[k] = { x:0, nx:0, n:0, nn:0 });
    if(h.tx[i] != null){ o.x += h.tx[i]; o.nx++; }
    if(h.tn[i] != null){ o.n += h.tn[i]; o.nn++; }
  }
  const per = MESI_BR.map(() => ({ tm:[], tx:[], tn:[], p:[] }));
  if(h.hasT) histMonths(h, 'TEMP').filter(c => c.full).forEach(c => {
    const o = per[c.m], e = days[c.y + '-' + c.m];
    o.tm.push(c.val);
    if(e && e.nx) o.tx.push(e.x / e.nx);
    if(e && e.nn) o.tn.push(e.n / e.nn);
  });
  if(h.hasP) histMonths(h, 'PREC').filter(c => c.full && c.val != null).forEach(c => per[c.m].p.push(c.val));
  const mean = a => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length * 10) / 10 : null;
  return per.map(o => ({
    tn:mean(o.tn), tm:mean(o.tm), tx:mean(o.tx), p:mean(o.p), nt:o.tm.length, np:o.p.length
  }));
}
const climaHas = s => ({ t:s.some(o => o.tm != null), p:s.some(o => o.p != null) });
// "4 anni", "1 anno"; "2–3 anni" se temperatura e pioggia ne hanno un numero diverso
function climaYears(o){
  const n = [...new Set([o.nt, o.np].filter(Boolean))].sort((a, b) => a - b);
  return n.length ? n.join('–') + (n[n.length - 1] === 1 ? ' anno' : ' anni') : '';
}

// Opzioni uPlot; o = {w, h, hi}, hi = PNG (font grandi, niente cursore). Pioggia a barre, fascia fra minima e
// massima, media piu' spessa. Gradi a sinistra e millimetri a destra, col colore della pioggia; con una sola
// delle due grandezze il suo asse sta a sinistra.
function climaOpts(s, o){
  const hi = !!o.hi, has = climaHas(s), narrow = !hi && o.w < 520;
  const fnt = hi ? { font:'20px system-ui, sans-serif' } : {};
  const lab = hi ? { labelFont:'700 24px system-ui, sans-serif', labelSize:32, labelGap:6 }
                 : { labelSize:narrow ? 16 : 26, labelGap:narrow ? 2 : 4 };
  const grid = hi ? '#e3e9f0' : GRID(), ax = hi ? '#33475a' : AXTX(), size = hi ? 82 : narrow ? 38 : 54;
  const months = MESI_BR.map((_, m) => m);
  const axes = [Object.assign({
    grid:{ show:false }, stroke:ax, size:hi ? 46 : 30, splits:() => months,
    // sul telefono un mese si' e uno no, se non ci stanno tutti
    values:(u, sp) => sp.map((m, k) => (u.width - 2 * size) / 12 < 26 && k % 2 ? '' : MESI_BR[m])
  }, fnt)];
  const yAxis = (scale, label, stroke, right) => Object.assign({
    scale, label, stroke, side:right ? 1 : 3, grid:right ? { show:false } : { stroke:grid }, size,
    space:hi ? 70 : 44, incrs:TICK_STEPS, values:tickTexts
  }, lab, fnt);
  if(has.t) axes.push(yAxis('y', '°C', ax, false));
  if(has.p) axes.push(yAxis('mm', 'mm', has.t ? varColor('PREC', true, hi) : ax, has.t));
  const rain = varColor('PREC', false, hi), red = '#e34948', blue = '#2b6cb0', ink = hi ? '#22303c' : AXTX();
  const series = [{}], bands = [];
  if(has.p) series.push({
    label:'Pioggia (mm)', kind:'bars', scale:'mm', stroke:rain, fill:withAlpha(rain, 0.28), width:1,
    paths:uPlot.paths.bars({ size:[0.55, 64] }), points:{ show:false }
  });
  if(has.t){
    const line = (label, color, width) => mkSeries({ label, color, width, kind:'line' }, hi);
    series.push(line('Temperatura massima (°C)', red), line('Temperatura minima (°C)', blue),
                line('Temperatura media (°C)', ink, hi ? 3.5 : 2));
    bands.push({ series:[series.length - 3, series.length - 2], fill:withAlpha(red, 0.1) });
  }
  const scales = { x:{ time:false, range:[-0.5, 11.5] } };
  if(has.p) scales.mm = rainY();
  return {
    width:o.w, height:o.h, legend:{ show:false }, padding:[hi ? 16 : 12, has.p && has.t ? 0 : 12, 0, 0],
    scales, axes, series, bands,
    cursor:hi ? { show:false } : { y:false, drag:{ x:false, y:false }, points:{ show:hoverPt } },
    hooks:hi ? {} : { setCursor:[u => { if(u._labs) cursorLabels(u); }] }
  };
}
function climaSeries(s){
  const has = climaHas(s), out = [s.map((_, m) => m)];
  if(has.p) out.push(s.map(o => o.p));
  if(has.t) out.push(s.map(o => o.tx), s.map(o => o.tn), s.map(o => o.tm));
  return out;
}

// La vista: prende il posto del grafico (body.clima-mode), alta come lui
async function renderClima(){
  const st = currentStation, box = el('climaview'), seq = ++_climaSeq;
  if(climaU){ climaU.destroy(); climaU = null; }
  climaData = null;
  box.innerHTML = '';
  el('chartsum').textContent = '';
  if(!st) return;
  const h = await histLoad(st);
  if(seq !== _climaSeq || currentStation !== st || currentVar !== WCLIMA) return;
  const s = h && climaStats(h);
  if(!s || !s.some(o => o.tm != null || o.p != null)){
    const why = h ? 'Ancora nessun mese completo.' : 'Climatologia non disponibile.';
    box.innerHTML = '<div class="hint">' + why + '</div>';
    return;
  }
  climaData = { h, s };
  const u = climaU = new uPlot(climaOpts(s, { w:box.clientWidth, h:box.clientHeight }), climaSeries(s), box);
  u._fmt = (i, v) => u.series[i].scale === 'mm' ? Math.round(v) + ' mm' : fmt1(v) + ' °C';
  u._top = m => MESI_BR[m] + (climaYears(s[m]) ? ' · ' + climaYears(s[m]) : '');
  addLabels(u);
  el('chartsum').textContent = 'Climatologia. ' + s.map((o, m) => {
    const t = o.tm == null ? [] : [[o.tn, o.tm, o.tx].filter(v => v != null).map(fmt1).join(', ') + ' °C'];
    const all = t.concat(o.p == null ? [] : [Math.round(o.p) + ' mm']);
    return all.length ? MESI_BR[m] + ': ' + all.join(', ') : '';
  }).filter(Boolean).join('; ') + '.';
}

function exportClimaCSV(){
  if(!climaData || !currentStation) return;
  const c = v => v == null ? '' : v;
  const rows = ['mese;anni_temperatura;tmin;tmedia;tmax;anni_pioggia;pioggia_mm']
    .concat(climaData.s.map((o, m) => [MESI_BR[m], o.nt, c(o.tn), c(o.tm), c(o.tx), o.np, c(o.p)].join(';')));
  saveBlob(new Blob([rows.join('\n') + '\n'], { type:'text/csv;charset=utf-8' }),
           'climatologia_' + pngBase() + '.csv');
}

// PNG: il climogramma grande, su bianco, con la legenda (nell'immagine non c'e' il cursore)
async function climaPNG(){
  if(!climaData || !currentStation) return null;
  const { h, s } = climaData, W = 1500, H = 760, W_LEG = 340, TOP = 84, L = 12;
  const opts = hvLight(() => climaOpts(s, { w:W, h:H, hi:true }));
  const plot = await offPlot(opts, climaSeries(s), W, H);
  const { cv, ctx } = pngCanvas(L + W + W_LEG, TOP + H + 18);
  const day = ts => new Date(ts * 1000).toISOString().slice(0, 10).split('-').reverse().join('/');
  pngHead(ctx, prettyName(currentStation.name || currentStation.scode) + ' — Climatologia',
          'Medie dei mesi completi, dati dal ' + day(h.x[0]) + ' al ' + day(h.x[h.n - 1]), true,
          'Giorno solare (UTC+1)');
  ctx.drawImage(plot.u.ctx.canvas, L, TOP, W, H);
  plot.done();
  pngLegend(ctx, opts.series, L + W + 26, TOP + 30, TOP + H);
  return { blob:toPng(cv), fname:pngBase() + '_climatologia.png' };
}

function buildClimaControls(){
  el('climaCsv').addEventListener('click', exportClimaCSV);
}
