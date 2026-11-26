// stato.js: lo stato del sito da STATUS/status.json (banner "dati fermi" e pannello Fonti con i semafori) e
// l'aggiornamento automatico dei dati. Ascoltatori e avvio in buildStatusControls(), chiamata da comune.js.

// ---- WATCHDOG "dati fermi" ---------------------------------------------------------------------
// STATUS/status.json (scritto dal publish) ha il timestamp della misura piu' recente fra tutte le
// regioni: oltre STALE_HOURS compare il banner rosso. Se il file manca (sviluppo locale) tace.
const STALE_HOURS = 3;
// timestamp civili italiani -> epoch nello stesso riferimento (nowRome porta l'ora di adesso a Roma)
const isoCivil = s => Date.parse((s.length === 16 ? s + ':00' : s) + 'Z');
const nowRome = () =>
  Date.parse(new Date().toLocaleString('sv-SE', {timeZone:'Europe/Rome'}).replace(' ','T') + 'Z');
const _ageTxt = min => min < 90 ? Math.max(0, Math.round(min)) + ' min fa'
                     : min < 48*60 ? Math.round(min/60) + ' h fa'
                     : Math.round(min/1440) + ' g fa';

// Freschezza ATTESA per fonte, in ore: passo dei dati piu' il ritardo normale della sorgente
// (LOM e Piemonte pubblicano con 4-5 h di ritardo, ARPAE e OSMER con 1-2 h: non e' un guasto).
// AQ_TN: il feed "last" di APPA Trento mostra un giorno, pubblicato lun-ven tra le 08 e le 10
// (il giorno prima): dato di 9-35 h nei feriali, fino a ~83 h nel weekend (venerdi' e sabato non
// compaiono mai). Con 36 e' verde nei feriali, giallo nel weekend, rosso solo oltre 108 h.
// AQ_ER: ARPAE aggiorna una volta al giorno, fino alla mezzanotte appena passata.
const SRC_EXPECT = { VEN:1.5, LOM:6, ER:2.5, TN:1, BZ:1, FVG:2.5,
  AQ_VEN:4, AQ_TN:36, AQ_BZ:4, AQ_ER:32, AQ_LOM:6,
  PC_FVG:2.5, PC_TN:3, PC_PO:4, PC_PIE:6, PIE:6,
  MAR_VEN:1, MAR_ER:1, MAR_FVG:3, ACQ_VEN:3, LAGHI:2, INV_ER:3, LIG:3 };

// semaforo di una fonte: 'g' al suo passo | 'y' in ritardo | 'r' ferma. Le stazioni rimaste indietro non
// contano: in molte reti alcune trasmettono solo ogni qualche ora o una volta al giorno.
function srcState(reg, info, nowIt){
  const exp = SRC_EXPECT[reg] || 2;
  const ageH = (nowIt - isoCivil(info.latest)) / 3600000;
  if(ageH > Math.max(3 * exp, 6)) return 'r';
  return ageH > exp ? 'y' : 'g';
}

let _lastStatus = null;
async function checkStale(){
  const b = el('stalebanner');
  try {
    const r = await freshData('STATUS/status.json');
    if(!r.ok) throw 0;
    const s = _lastStatus = await r.json();
    const ageMin = (nowRome() - isoCivil(s.latest)) / 60000;
    if(ageMin > STALE_HOURS * 60){
      const txt = ageMin >= 48*60 ? Math.round(ageMin/1440) + ' giorni' : Math.round(ageMin/60) + ' ore';
      b.textContent = '⚠ Dati non aggiornati da ' + txt +
                    ' (ultimo dato: ' + s.latest.replace('T',' ') + ')';
      b.style.display = 'block';
    } else b.style.display = 'none';
    updateSrcUI();
  } catch(e){ b.style.display = 'none'; }   // status assente o illeggibile: niente banner
}

// il pallino accanto alla "i" mostra lo stato peggiore fra le fonti
const TL_COLOR = { g:'#2f9e44', y:'#f0a800', r:'#d33' };
function updateSrcUI(){
  const dot = el('srcdot');
  const regs = _lastStatus && _lastStatus.regions;
  if(!regs){ dot.style.background = '#9aa5b1'; return; }
  const nowIt = nowRome();
  let worst = 'g';
  for(const reg in regs){
    const st = srcState(reg, regs[reg], nowIt);
    if(st === 'r'){ worst = 'r'; break; }
    if(st === 'y') worst = 'y';
  }
  dot.style.background = TL_COLOR[worst];
  const p = el('srcpanel');
  if(p.style.display === 'block') renderSrcPanel();
}

function renderSrcPanel(){
  const p = el('srcpanel');
  const regs = _lastStatus && _lastStatus.regions;
  let html = '<h4>Stato delle fonti</h4>';
  if(!regs){
    html += '<div class="src-note">Stato non disponibile.</div>';
  } else {
    const nowIt = nowRome();
    REGIONS_ALL.forEach(reg => {
      const info = regs[reg];
      if(!info) return;
      const st = srcState(reg, info, nowIt);
      const age = _ageTxt((nowIt - isoCivil(info.latest)) / 60000);
      const src = SOURCES[reg] || {};
      const name = src.name || reg;
      const durl = src.data || src.url;             // la pagina dei dati, se no il sito
      const label = durl
        ? '<a href="' + durl + '" target="_blank" rel="noopener" title="Apri i dati della fonte">' +
          name + '</a>'
        : name;
      html += '<div class="src-row"><span class="tl tl-' + st + '"></span>'
            + '<span class="src-name">' + label + '</span>'
            + '<span class="src-age">' + age + '</span></div>';
    });
    const light = c => '<span class="tl tl-' + c +
                       '" style="display:inline-block;vertical-align:-1px"></span>';
    html += '<div class="src-note">' + light('g') + ' aggiornata &nbsp;' + light('y') + ' in ritardo &nbsp;'
          + light('r') + ' ferma</div>';
  }

  p.innerHTML = html;
}

function buildStatusControls(){
  el('srcinfo').addEventListener('click', (e) => {
    e.stopPropagation();                           // menu, ricerca e Note si chiudono qui
    closeMenu();
    closeSearch();
    showNotes(false);
    const p = el('srcpanel');
    if(p.style.display === 'block'){ p.style.display = 'none'; return; }
    renderSrcPanel();
    p.style.display = 'block';
    if(!_lastStatus) checkStale();          // primo clic prima del fetch: carica e ridisegna
  });
  document.addEventListener('click', (e) => {
    const p = el('srcpanel');
    if(p.style.display === 'block' && !p.contains(e.target)) p.style.display = 'none';
  });

  checkStale();
  startLive();
}

// AGGIORNAMENTO AUTOMATICO: il Pi pubblica ogni 10 minuti e GitHub tiene i file in cache fino a 5. Con la
// pagina in vista, ogni 2 minuti si ricontrollano stato, stazioni (mappa.js) e scheda aperta (stazione.js):
// un file non cambiato costa una risposta vuota. Tornando sulla pagina o in rete si ricontrolla subito.
const LIVE_MS = 2 * 60 * 1000;
let _liveAt = Date.now(), _liveRun = null;
function liveTick(){
  if(document.hidden || _liveRun) return _liveRun;
  _liveAt = Date.now();
  _liveRun = (async () => {
    try {
      await checkStale();
      await refreshStations();
      await liveStation();
    } catch(e){}
    _liveRun = null;
  })();
  return _liveRun;
}
function startLive(){
  setInterval(liveTick, LIVE_MS);
  const back = () => { if(Date.now() - _liveAt > LIVE_MS / 2) liveTick(); };
  document.addEventListener('visibilitychange', () => { if(!document.hidden) back(); });
  addEventListener('online', back);
  addEventListener('pageshow', e => { if(e.persisted) back(); });
}
