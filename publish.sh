#!/usr/bin/env bash
# ===========================================================================================
# publish.sh - rigenera i dati e pubblica su GitHub, separando DATI e PAGINA:
#   - DATI  -> branch 'data'      (letto dal sito via raw.githubusercontent.com, NIENTE deploy Pages)
#   - PAGINA-> branch 'gh-pages'  (GitHub Pages) pushata SOLO quando index.html cambia
# Cosi' puoi lanciarlo anche ogni 10 min: i dati si aggiornano (~5 min di cache raw) senza
# innescare deploy di Pages ad ogni run. Change-detection: salta i push se nulla e' cambiato.
# Requisiti: REMOTE impostato qui sotto + credenziali git salvate (credential.helper store).
# ===========================================================================================
set -euo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE"

# ============================================================================
# CONFIG: URL del tuo repo GitHub (HTTPS con PAT salvato, oppure SSH).
# Es. HTTPS:  https://github.com/utente/repo.git
#     SSH  :  git@github.com:utente/repo.git
# ============================================================================
# SSH con deploy key dedicata (~/.ssh/meteo_github sul Pi): non scade e non passa dal credential store
REMOTE="git@github.com:Simulaqua/METEO.git"

# AVVISO ESTERNO (healthchecks.io): ping ad ogni push dati riuscito. Se il battito manca oltre il
# periodo+tolleranza configurati sul servizio, arriva una mail (copre: Pi spento, rete giu', cron
# morto, push rotto, dati fermi). Stringa vuota = disattivato.
HEALTHCHECK_URL=""

# fallback: se REMOTE e' il placeholder, prova il remote 'origin' della cartella
if [ "$REMOTE" = "https://github.com/UTENTE/REPO.git" ]; then
  REMOTE="$(git config --get remote.origin.url 2>/dev/null || true)"
fi
if [ -z "$REMOTE" ]; then
  echo "ERRORE: imposta REMOTE in publish.sh (URL del repo)."
  exit 1
fi

# slug 'utente/repo' e URL raw del branch dati (per riscrivere DATA_BASE nella pagina)
SLUG="$(printf '%s' "$REMOTE" | sed -E 's#(git@github.com:|https?://github.com/)##; s#\.git$##')"
RAW_BASE="https://raw.githubusercontent.com/$SLUG/data"

mkdir -p "$BASE/.tracking"

# 1) rigenera i dati web (CSV rolling 7gg + geojson + units) per tutte le regioni
python3 export_web.py -r all --site-dir site

# 1b) indicatore di freschezza per il banner "dati fermi" della pagina: timestamp della misura piu'
#     recente fra TUTTE le regioni -> site/STATUS/status.json. Cambia solo quando i dati avanzano
#     davvero (quindi non rompe il change-detection), e copre sia pipeline rotta sia fonti ferme.
python3 - <<'PYEOF' || echo "ATTENZIONE: status.json non aggiornato"
import json, glob, os, re, datetime
out = {'latest': '', 'regions': {}}
for fn in glob.glob('site/*/stations.geojson'):
    reg = fn.split('/')[1]
    try:
        g = json.load(open(fn))
    except Exception:
        continue
    times = [t for t in ((f.get('properties', {}) or {}).get('latest_time') or ''
             for f in g.get('features', [])) if t]
    if not times:
        continue
    mx = max(times)
    if mx > out['latest']:
        out['latest'] = mx
    # stazioni "indietro": ultimo dato > 3h dietro la piu' recente della stessa fonte
    try:
        cut = (datetime.datetime.strptime(mx, '%Y-%m-%dT%H:%M')
               - datetime.timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M')
        old = sum(1 for t in times if t < cut)
    except Exception:
        old = 0
    out['regions'][reg] = {'latest': mx, 'n': len(times), 'old': old}
# stato del backup notturno su chiavetta (backup_usb.sh) per il watchdog 'Warning - backup off':
# ultima versione + ETICHETTE delle righe 'ERRORE|ATTENZIONE: <etichetta> -- <dettagli>' dell'ultimo
# log (corte, stile SMS: i dettagli restano nel log). Un errore qui non tocca il resto.
try:
    vers = sorted(glob.glob('/mnt/usb/backup/20??-??-??'))
    logs = sorted(glob.glob('logs/backup-*.log'))
    righe = [l.rstrip('\n') for l in open(logs[-1], errors='replace')] if logs else []
    tag = []
    for l in righe:
        m = re.search(r'(?:ERRORE|ATTENZIONE): (.*?)(?: -- |$)', l)
        if m and m.group(1)[:40] not in tag:
            tag.append(m.group(1)[:40])
    out['backup'] = {'last': os.path.basename(vers[-1]) if vers else '',
                     'warn': tag[:3], 'info': righe[-1][:200] if righe else ''}
except Exception as e:
    out['backup'] = {'last': '', 'warn': ['stato illeggibile'], 'info': str(e)[:200]}
if out['latest']:
    os.makedirs('site/STATUS', exist_ok=True)
    json.dump(out, open('site/STATUS/status.json', 'w'))
PYEOF

# ---------------------------------------------------------------------------
# 2) DATI -> branch 'data' (solo se cambiati). Non innesca deploy Pages.
#    Push INCREMENTALE: il repo resta in site/.git fra un run e l'altro, cosi' git sa cosa c'e' gia' su
#    GitHub e invia solo i file cambiati, come delta sulla versione precedente (col repo rifatto da zero
#    ad ogni run partivano ~52 MB ogni 10 min). 'data' resta UN commit orfano: la storia su GitHub non
#    cresce. git 2.20 cerca le basi dei delta solo nel commit GENITORE, e ne prende una sola per "name
#    hash" (~ultimi 16 caratteri del percorso), da qui due accorgimenti:
#    - branch tecnico 'data-inc' = stesso albero, genitore = il 'data' precedente (un commit orfano da
#      solo rispedirebbe tutto);
#    - .delta/ = gli stessi file con nomi corti a name hash unico (stessi blob: zero spazio in piu'),
#      senza i quali circa meta' dei byte cambiati partirebbe intera.
#    Repo assente/non nostro, o 3 errori di fila -> si ricrea: un push completo, come prima.
# ---------------------------------------------------------------------------
# tutti i file dati (cartelle regione) escluso site/index.html (profondita' 1) ed eventuale .git
DATA_HASH="$(find site -mindepth 2 -type f -not -path '*/.git/*' 2>/dev/null | sort \
             | xargs cat 2>/dev/null | sha1sum | cut -d' ' -f1)"
DATA_GIT="$BASE/site/.git"
dgit() { git --git-dir="$DATA_GIT" --work-tree="$BASE/site" "$@" 9>&-; }   # 9>&-: il lock resta al publish
# nomi di .delta/: stdin = 'git ls-files -s -z', argv[1] = mappa percorso->nome (chi c'era tiene il suo
# nome, cioe' ritrova la base del giro prima); stdout = righe per 'git mktree'
IFS= read -r -d '' DELTA_PY <<'PYEOF' || true
import hashlib, os, sys
def nh(p):                                    # = pack_name_hash() di git
    h = 0
    for c in p.encode('utf-8', 'surrogateescape'):
        if c not in b' \t\n\v\f\r':
            h = ((h >> 2) + (c << 24)) & 0xffffffff
    return h
def cand(p, k):                               # k-esimo candidato: 6 caratteri base 36
    v = int(hashlib.sha1(('%s#%d' % (p, k)).encode('utf-8', 'surrogateescape')).hexdigest(), 16)
    return ''.join('0123456789abcdefghijklmnopqrstuvwxyz'[(v // 36 ** i) % 36] for i in range(6))
old, ent, new, names = {}, [], {}, set()
try:
    for l in open(sys.argv[1], encoding='utf-8', errors='surrogateescape'):
        p, _, n = l.rstrip('\n').partition('\t')
        old[p] = n
except OSError:
    pass
for rec in sys.stdin.buffer.read().split(b'\0'):
    if rec:
        meta, p = rec.split(b'\t', 1)
        m, s = meta.split(b' ')[:2]
        ent.append((m.decode(), s.decode(), p.decode('utf-8', 'surrogateescape')))
used = {0, nh('.delta')}                      # hash gia' visti prima dei blob: radice, .delta, cartelle
for _, _, p in ent:
    d = os.path.dirname(p)
    while d:
        used.add(nh(d))
        d = os.path.dirname(d)
def take(p, n):
    h = nh('.delta/' + n)
    if n and n not in names and h not in used:
        new[p] = n
        names.add(n)
        used.add(h)
for _, _, p in ent:
    if p in old:
        take(p, old[p])
for _, _, p in ent:
    k = 0
    while p not in new:
        take(p, cand(p, k))
        k += 1
for m, s, p in ent:
    sys.stdout.write('%s blob %s\t%s\n' % (m, s, new[p]))
with open(sys.argv[1] + '.tmp', 'w', encoding='utf-8', errors='surrogateescape') as f:
    f.writelines('%s\t%s\n' % (p, new[p]) for p in sorted(new))
os.replace(sys.argv[1] + '.tmp', sys.argv[1])
PYEOF
# 0 = pubblicato, 1 = errore, 2 = saltato (un altro publish sta ancora pushando: un run dura ~8 min)
data_push() {
  local tree delta root msg new prev="" inc err sent nchg=""
  if command -v flock >/dev/null && ! flock -n 9; then return 2; fi
  if [ "$(dgit config --get meteo.datarepo 2>/dev/null)" != 1 ]; then   # assente o avanzo del vecchio metodo
    rm -rf "$DATA_GIT"
    git init -q "$BASE/site" &&
      dgit config core.logAllRefUpdates false &&     # niente reflog: i vecchi snapshot si potano subito
      dgit config gc.auto 0 &&                        # niente gc in background: pota il publish, sotto flock
      dgit config user.name publish && dgit config user.email cron@localhost &&
      dgit config remote.origin.fetch '+refs/heads/data:refs/remotes/origin/data' &&
      dgit config meteo.datarepo 1 || return 1
  fi
  dgit config remote.origin.url "$REMOTE" || return 1
  # sotto flock nessun altro usa il repo: un lock git rimasto e' di un run ucciso (es. riavvio 05:50)
  rm -f "$DATA_GIT"/*.lock; find "$DATA_GIT/refs" -name '*.lock' -type f -delete 2>/dev/null || true
  # come il vecchio 'git add */': solo le cartelle di primo livello (niente index.html & co.)
  mkdir -p "$DATA_GIT/info" && printf '/*\n!/*/\n/.*\n*.tmp\n' > "$DATA_GIT/info/exclude" || return 1
  dgit add -A || return 1
  tree="$(dgit write-tree)" || return 1
  [ -n "$(dgit ls-tree "$tree")" ] || { echo "ERRORE: nessuna cartella dati in site/"; return 1; }
  delta="$(dgit ls-files -s -z | python3 -c "$DELTA_PY" "$DATA_GIT/delta-map" | dgit mktree)" || return 1
  root="$({ dgit ls-tree "$tree"; printf '040000 tree %s\t.delta\n' "$delta"; } | dgit mktree)" || return 1
  msg="data $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  new="$(dgit commit-tree "$root" -m "$msg")" || return 1
  set -- "$new:refs/heads/data"
  if prev="$(dgit rev-parse -q --verify 'refs/remotes/origin/data^{commit}')"; then
    inc="$(dgit commit-tree "$root" -p "$prev" -m "$msg")" || return 1
    set -- "$@" "$inc:refs/heads/data-inc"
  fi
  err="$(mktemp)" || return 1
  if LC_ALL=C dgit push --progress -f origin "$@" 2>"$err"; then inc=""; else inc="rifiutato"; fi
  # riuscito = GitHub ha accettato 'data' (git aggiorna refs/remotes/origin/data solo in quel caso),
  # anche se il solo 'data-inc', tecnico, fosse stato rifiutato
  if [ "$(dgit rev-parse -q --verify refs/remotes/origin/data)" != "$new" ]; then
    tr '\r' '\n' < "$err" | grep -v '%' >&2; rm -f "$err"; return 1
  fi
  if [ -n "$inc" ]; then
    echo "ATTENZIONE: data-inc rifiutato (i dati sono pubblicati lo stesso):"
    tr '\r' '\n' < "$err" | grep -v '%' | grep -i 'error\|reject\|denied' >&2
  fi
  sent="$(tr '\r' '\n' < "$err" | sed -n 's/^Writing objects: .*), \([0-9.]* [A-Za-z]*\).*/\1/p' | tail -n 1)"
  rm -f "$err"
  [ -n "$prev" ] && nchg="$(dgit diff-tree -r --name-only "$prev" "$new" | grep -vc '^\.delta/')"
  DATA_INFO="${nchg:+$nchg file cambiati, }inviati ${sent:-?}"
}
if [ "$DATA_HASH" != "$(cat .tracking/last_data_hash 2>/dev/null || true)" ]; then
  DATA_INFO=""; rc=0
  exec 9>>"$BASE/.tracking/data_push.lock"
  data_push || rc=$?
  if [ "$rc" != 2 ] && [ -d "$DATA_GIT" ]; then
    dgit prune --expire=now || true                   # snapshot vecchi: gia' su GitHub o mai partiti
  fi
  exec 9>&-
  case "$rc" in
    0) echo "$DATA_HASH" > .tracking/last_data_hash
       rm -f .tracking/data_push_fails
       echo "DATI aggiornati sul branch 'data' ($DATA_INFO)."
       # battito verso l'avviso esterno (mai bloccante: se il ping fallisce il publish prosegue)
       [ -n "$HEALTHCHECK_URL" ] && curl -fsS -m 10 --retry 2 "$HEALTHCHECK_URL" >/dev/null 2>&1 || true ;;
    2) echo "DATI: push precedente ancora in corso, riprovo al prossimo giro." ;;
    *) n="$(cat .tracking/data_push_fails 2>/dev/null || true)"
       case "$n" in ''|*[!0-9]*) n=0 ;; esac
       n=$((n + 1)); echo "$n" > .tracking/data_push_fails
       # 3 di fila: forse e' il repo locale (es. oggetto troncato da un blackout) -> si ricrea
       if [ "$n" = 3 ]; then rm -rf "$DATA_GIT"; fi
       echo "ERRORE: push dati fallito ($n di fila)."
       exit 1 ;;
  esac
else
  echo "DATI invariati: nessun push."
fi

# ---------------------------------------------------------------------------
# 3) PAGINA -> branch 'gh-pages' (solo se index.html e' cambiato). Innesca il deploy Pages.
#    Riscrive DATA_BASE con l'URL raw del branch 'data'.
# ---------------------------------------------------------------------------
# l'hash comprende i workflow del watchdog e site/radar.js: una loro modifica deve arrivare su gh-pages
# anche se index.html non cambia (prima restavano fermi finche' non cambiava la pagina)
PAGE_HASH="$(for f in site/index.html site/radar.js watchdog_actions.yml watchdog_backup.yml; do
               [ -f "$f" ] && cat "$f" || true; done | sha1sum | cut -d' ' -f1)"
if [ "$PAGE_HASH" != "$(cat .tracking/last_page_hash 2>/dev/null || true)" ]; then
  TMP="$(mktemp -d)"
  sed -E "s#const DATA_BASE = .*#const DATA_BASE = '$RAW_BASE';#" site/index.html > "$TMP/index.html"
  # watchdog GitHub Actions: deve vivere sul branch DEFAULT (gh-pages) per girare a orario; siccome
  # il branch viene rigenerato da zero ad ogni push, il workflow va rimesso ogni volta.
  if [ -f "$BASE/watchdog_actions.yml" ]; then
    mkdir -p "$TMP/.github/workflows"
    cp "$BASE/watchdog_actions.yml" "$TMP/.github/workflows/watchdog.yml"
  fi
  if [ -f "$BASE/watchdog_backup.yml" ]; then
    mkdir -p "$TMP/.github/workflows"
    cp "$BASE/watchdog_backup.yml" "$TMP/.github/workflows/watchdog_backup.yml"
  fi
  # dominio personalizzato (meteo.simulaqua.it): gh-pages viene rigenerato da zero, senza questo
  # file il dominio si stacca ad ogni push della pagina
  echo "meteo.simulaqua.it" > "$TMP/CNAME"
  # favicon trasparente (via la goccia anche dalle cache-icone piu' testarde)
  [ -f "$BASE/favicon_site.ico" ] && cp "$BASE/favicon_site.ico" "$TMP/favicon.ico"
  # layer Radar-DPC (caricato da index.html): i fotogrammi stanno sul branch 'radar', il codice qui
  [ -f "$BASE/site/radar.js" ] && cp "$BASE/site/radar.js" "$TMP/radar.js"
  ( cd "$TMP"
    git init -q
    git checkout -q -b gh-pages
    git add -A
    # identita' = account GitHub reale: i run schedulati del workflow "agiscono" come l'ultimo autore
    # del file -> le mail di run fallito arrivano all'account (con cron@localhost non arriverebbero)
    git -c user.email="Simulaqua@users.noreply.github.com" -c user.name="Simulaqua" \
        commit -qm "page $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    git push -qf "$REMOTE" gh-pages )
  rm -rf "$TMP"
  echo "$PAGE_HASH" > .tracking/last_page_hash
  echo "PAGINA aggiornata su gh-pages (deploy Pages)."
else
  echo "PAGINA invariata: nessun deploy Pages."
fi

echo "Fatto. Repo: $REMOTE"
