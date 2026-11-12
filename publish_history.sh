#!/usr/bin/env bash
# publish_history.sh - storico lungo: history.py riassume l'archivio in valori giornalieri di pioggia
# e temperatura, e li pubblica sul branch 'history' (letto dal sito via raw). Una volta al giorno
# (cron). Il branch e' orfano e ricreato ad ogni push (force): il repository non cresce.
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
HASH="$(find "$OUT" -type f -name '*.json' -not -name 'index.json' | sort | xargs cat 2>/dev/null | sha1sum | cut -d' ' -f1)"
if [ "$HASH" = "$(cat .tracking/last_history_hash 2>/dev/null || true)" ]; then
  # riuscito anche senza push: status.py legge l'ora di modifica come ultimo giro ('Warning - storico off')
  touch .tracking/last_history_hash
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
