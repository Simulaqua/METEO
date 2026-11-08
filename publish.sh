#!/usr/bin/env bash
# ===========================================================================================
# publish.sh - rigenera i dati e pubblica su GitHub, separando DATI e PAGINA:
#   - DATI  -> branch 'data'      (letto dal sito via raw.githubusercontent.com, NIENTE deploy Pages)
#   - PAGINA-> branch 'gh-pages'  (GitHub Pages) pushata SOLO quando la pagina o gli avvisi cambiano
# Cosi' puoi lanciarlo anche ogni 10 min: i dati si aggiornano (~5 min di cache raw) senza
# innescare deploy di Pages ad ogni run. Change-detection: salta i push se nulla e' cambiato.
# ===========================================================================================
set -euo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE"

# SSH con la deploy key del Pi (~/.ssh/meteo_github): non scade
REMOTE="git@github.com:Simulaqua/METEO.git"
# slug 'utente/repo' e URL raw del branch dati (per riscrivere DATA_BASE nella pagina)
SLUG="$(printf '%s' "$REMOTE" | sed -E 's#(git@github.com:|https?://github.com/)##; s#\.git$##')"
RAW_BASE="https://raw.githubusercontent.com/$SLUG/data"
# avvisi GitHub (workflow), pubblicati su gh-pages in .github/workflows/ con il loro nome
WATCHDOGS=(watchdog.yml watchdog_backup.yml watchdog_storico.yml)

mkdir -p "$BASE/.tracking"

# 1) rigenera i dati web (CSV rolling 7gg + geojson + units) per tutte le regioni
python3 export_web.py -r all --site-dir site

# 1b) stato per il banner "dati fermi" della pagina e per gli avvisi -> site/STATUS/status.json
python3 status.py || echo "ATTENZIONE: status.json non aggiornato"

# ---------------------------------------------------------------------------
# 2) DATI -> branch 'data' (solo se cambiati). Non innesca deploy Pages.
#    Push INCREMENTALE: il repo resta in site/.git fra un run e l'altro, cosi' git sa cosa c'e' gia' su
#    GitHub e invia solo i file cambiati, come delta sulla versione precedente (col repo rifatto da zero
#    ad ogni run partivano ~52 MB ogni 10 min). 'data' resta UN commit orfano: la storia su GitHub non
#    cresce. git 2.20 cerca le basi dei delta solo nel commit GENITORE, da qui due accorgimenti:
#    - branch tecnico 'data-inc' = stesso albero, genitore = il 'data' precedente (un commit orfano da
#      solo rispedirebbe tutto);
#    - .delta/ = gli stessi file (stessi blob: zero spazio in piu') con i nomi di delta_names.py, che
#      dice perche' servono.
#    Repo assente/non nostro, o 3 errori di fila -> si ricrea: un push completo, come prima.
# ---------------------------------------------------------------------------
# tutti i file dati (cartelle regione) esclusi i file della pagina (profondita' 1) ed eventuale .git
DATA_HASH="$(find site -mindepth 2 -type f -not -path '*/.git/*' 2>/dev/null | sort \
             | xargs cat 2>/dev/null | sha1sum | cut -d' ' -f1)"
DATA_GIT="$BASE/site/.git"
dgit() { git --git-dir="$DATA_GIT" --work-tree="$BASE/site" "$@" 9>&-; }   # 9>&-: il lock resta al publish
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
  # come il vecchio 'git add */': solo le cartelle di primo livello (niente file della pagina)
  mkdir -p "$DATA_GIT/info" && printf '/*\n!/*/\n/.*\n*.tmp\n' > "$DATA_GIT/info/exclude" || return 1
  dgit add -A || return 1
  tree="$(dgit write-tree)" || return 1
  [ -n "$(dgit ls-tree "$tree")" ] || { echo "ERRORE: nessuna cartella dati in site/"; return 1; }
  delta="$(dgit ls-files -s -z | python3 "$BASE/delta_names.py" "$DATA_GIT/delta-map" | dgit mktree)" || return 1
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
       echo "DATI aggiornati sul branch 'data' ($DATA_INFO)." ;;
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
# 3) PAGINA -> branch 'gh-pages' (solo se la pagina o gli avvisi sono cambiati). Innesca il deploy
#    Pages. Riscrive DATA_BASE con l'URL raw del branch 'data' e da' a ogni file della pagina un
#    ?v=<impronta>: Pages tiene HTML e JS in cache 10 min, cosi' una pagina nuova non gira mai con
#    file vecchi. Una pagina che cita un file locale che non va su gh-pages non si pubblica.
# ---------------------------------------------------------------------------
# i file della pagina sono quelli che index.html carica, scritti src="nome.js" o href="nome.css"
# (gli URL dei CDN e favicon.ico?v=2 no). I commenti di una riga non contano; in un commento di
# index.html mai src= o href=: uno su piu' righe, o con un >, si leggerebbe come markup.
# LC_ALL=C e grep -a: un byte rovinato in index.html non deve far perdere file a grep.
# Se ne manca uno la pagina non si pubblica: i dati sono gia' partiti, si riprova al prossimo giro
PAGE_FILES="$(LC_ALL=C sed 's/<!--[^>]*-->//g' site/index.html \
              | LC_ALL=C grep -aoE '(src|href)="[a-z][a-z0-9_-]*\.(js|css)"' \
              | awk -F'"' '{ print "site/" $2 }' || true)"
for f in $PAGE_FILES; do
  if [ ! -f "$f" ]; then
    echo "ERRORE: index.html carica ${f#site/}, che non c'e' in site/: pagina non pubblicata."
    exit 1
  fi
done
# l'hash comprende i file della pagina e gli avvisi: una loro modifica deve arrivare su gh-pages anche
# se index.html non cambia. Una riga "nome sha1" per file: anche un testo passato dalla fine di un file
# all'inizio del successivo cambia l'hash
PAGE_HASH="$(for f in site/index.html $PAGE_FILES "${WATCHDOGS[@]}"; do
               [ -f "$f" ] && printf '%s %s\n' "$f" "$(sha1sum < "$f" | cut -d' ' -f1)" || true
             done | sha1sum | cut -d' ' -f1)"
if [ "$PAGE_HASH" != "$(cat .tracking/last_page_hash 2>/dev/null || true)" ]; then
  TMP="$(mktemp -d)"
  # i file vanno su gh-pages come sono; in index.html ognuno prende ?v= con i primi 8 caratteri del
  # suo sha1, nella stessa passata di DATA_BASE
  rewrite=(-e "s#const DATA_BASE = .*#const DATA_BASE = '$RAW_BASE';#")
  for f in $PAGE_FILES; do
    name="${f#site/}"
    v="$(sha1sum "$f" | cut -c1-8)"
    rewrite+=(-e "s#(src|href)=\"${name%.*}\\.${name##*.}\"#\\1=\"${name}?v=${v}\"#g")
    cp "$f" "$TMP/$name"
  done
  LC_ALL=C sed -E "${rewrite[@]}" site/index.html > "$TMP/index.html"
  # gli avvisi devono vivere sul branch DEFAULT (gh-pages) per girare a orario; siccome il branch
  # viene rigenerato da zero ad ogni push, vanno rimessi ogni volta
  mkdir -p "$TMP/.github/workflows"
  for f in "${WATCHDOGS[@]}"; do
    if [ -f "$BASE/$f" ]; then cp "$BASE/$f" "$TMP/.github/workflows/$f"; fi
  done
  # dominio personalizzato (meteo.simulaqua.it): gh-pages viene rigenerato da zero, senza questo
  # file il dominio si stacca ad ogni push della pagina
  echo "meteo.simulaqua.it" > "$TMP/CNAME"
  # favicon trasparente (via la goccia anche dalle cache-icone piu' testarde)
  [ -f "$BASE/favicon_site.ico" ] && cp "$BASE/favicon_site.ico" "$TMP/favicon.ico"
  # prima del push: ogni file locale che la pagina cita deve essere fra quelli pronti per gh-pages.
  # Contano tutti gli src= e href= (maiuscole o minuscole; virgolette doppie, semplici o nessuna), non
  # URL, #, data:, mailto:, javascript: e tel:; ?..., #... e un ./ iniziale si tolgono. Cosi' si ferma
  # anche un file scritto in una forma che PAGE_FILES non legge (./x.js, js/x.js, 'x.js', X.js,
  # x.js?v=1), che sul sito mancherebbe. Niente push e niente last_page_hash: si riprova al prossimo giro
  LOCAL_REFS="$(LC_ALL=C sed 's/<!--[^>]*-->//g' "$TMP/index.html" \
                | LC_ALL=C grep -aoiE "(src|href)[[:space:]]*=[[:space:]]*(\"[^\"]*\"|'[^']*'|[^[:space:]\"'>]+)" \
                | LC_ALL=C sed -E "s/^[^=]*=[[:space:]]*//; s/^[\"'](.*)[\"']\$/\\1/" \
                | LC_ALL=C grep -aviE '^(https?:|//|#|data:|mailto:|javascript:|tel:)' || true)"
  while IFS= read -r ref; do
    file="${ref%%[?#]*}"; file="${file#./}"
    if [ -n "$file" ] && [ ! -e "$TMP/$file" ]; then
      rm -rf "$TMP"
      echo "ERRORE: index.html cita $ref, che non si pubblica: pagina non pubblicata."
      exit 1
    fi
  done <<< "$LOCAL_REFS"
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
