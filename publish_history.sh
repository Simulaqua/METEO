#!/usr/bin/env bash
# ===========================================================================================
# publish_history.sh - STORICO LUNGO: riassume l'archivio in valori giornalieri di pioggia e
# temperatura (history.py) e li pubblica sul branch 'history' del repo, letto dal sito via raw
# come i dati. Gira UNA volta al giorno (cron): lo storico cambia di un giorno per notte, cosi' il
# branch 'data' (ogni 10 min) resta leggero. Il branch e' orfano e ricreato ad ogni push (force):
# il repository non cresce.
# Uscita locale: history_out/ (file pubblicati) e history_cache/ (aggregati gia' calcolati, per
# rielaborare solo i giorni nuovi). Entrambe fuori da site/: publish.sh non le vede.
# ===========================================================================================
set -euo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE"

# stesso repo di publish.sh (SSH con deploy key)
REMOTE="git@github.com:Simulaqua/METEO.git"
OUT="$BASE/history_out"

# priorita' minima: legge tutto l'archivio solo la prima volta, poi pochi giorni per notte
nice -n 19 ionice -c3 python3 history.py --out "$OUT" --cache "$BASE/history_cache"

mkdir -p .tracking
HASH="$(find "$OUT" -type f -name '*.json' -not -name 'index.json' | sort | xargs cat 2>/dev/null | sha1sum | cut -d' ' -f1)"
if [ "$HASH" = "$(cat .tracking/last_history_hash 2>/dev/null || true)" ]; then
  echo "STORICO invariato: nessun push."
  exit 0
fi
( cd "$OUT"
  rm -rf .git
  git init -q
  git checkout -q -b history
  git add -A
  git -c user.email="cron@localhost" -c user.name="publish" \
      commit -qm "history $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git push -qf "$REMOTE" history
  rm -rf .git )
echo "$HASH" > .tracking/last_history_hash
echo "STORICO aggiornato sul branch 'history'."
