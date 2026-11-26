#!/usr/bin/env bash
# publish_history.sh - storico lungo: history.py riassume l'archivio in valori giornalieri di ogni
# grandezza, e li pubblica sul branch 'history' (letto dal sito via raw). Una volta al giorno (cron).
# Push a pezzi, come i dati di publish.sh: il repo resta in history_out/.git fra un giro e l'altro e git
# invia solo i file cambiati, come delta. 'history' resta un commit orfano (il repository non cresce);
# il branch tecnico 'history-inc' ha lo stesso albero e per genitore il 'history' precedente, cosi' git
# trova le basi dei delta. Repo assente o non nostro: si ricrea (push completo).
# Uscita locale: history_out/ (file pubblicati) e history_cache/ (aggregati gia' calcolati), fuori
# da site/: publish.sh non le vede.
set -euo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE"

# stesso repo di publish.sh
REMOTE="git@github.com:Simulaqua/METEO.git"
OUT="$BASE/history_out"

# priorita' minima: legge tutto l'archivio solo la prima volta, poi pochi giorni per notte
nice -n 19 ionice -c3 python3 history.py --out "$OUT" --cache "$BASE/history_cache"

mkdir -p .tracking
HASH="$(find "$OUT" -type f -name '*.json' -not -name 'index.json' -not -path '*/.git/*' | sort |
        xargs cat 2>/dev/null | sha1sum | cut -d' ' -f1)"
if [ "$HASH" = "$(cat .tracking/last_history_hash 2>/dev/null || true)" ]; then
  # riuscito anche senza push: status.py legge l'ora di modifica come ultimo giro ('Warning - storico off')
  touch .tracking/last_history_hash
  echo "STORICO invariato: nessun push."
  exit 0
fi

HGIT="$OUT/.git"
hgit() { git --git-dir="$HGIT" --work-tree="$OUT" "$@"; }
if [ "$(hgit config --get meteo.historyrepo 2>/dev/null)" != 1 ]; then
  rm -rf "$HGIT"
  git init -q "$OUT"
  hgit config core.logAllRefUpdates false            # niente reflog: i vecchi snapshot si potano subito
  hgit config gc.auto 0
  hgit config user.name publish
  hgit config user.email cron@localhost
  hgit config remote.origin.fetch '+refs/heads/history:refs/remotes/origin/history'
  hgit config meteo.historyrepo 1
fi
hgit config remote.origin.url "$REMOTE"
rm -f "$HGIT"/*.lock                                   # di un giro ucciso: sotto flock nessun altro lo usa
hgit add -A
tree="$(hgit write-tree)"
msg="history $(date -u +%Y-%m-%dT%H:%M:%SZ)"
new="$(hgit commit-tree "$tree" -m "$msg")"
set -- "$new:refs/heads/history"
if prev="$(hgit rev-parse -q --verify 'refs/remotes/origin/history^{commit}')"; then
  set -- "$@" "$(hgit commit-tree "$tree" -p "$prev" -m "$msg"):refs/heads/history-inc"
fi
hgit push -q -f origin "$@"
if [ "$(hgit rev-parse -q --verify refs/remotes/origin/history)" != "$new" ]; then
  echo "ERRORE: branch 'history' non aggiornato" >&2
  exit 1
fi
hgit prune --expire=now
echo "$HASH" > .tracking/last_history_hash
echo "STORICO aggiornato sul branch 'history'."
