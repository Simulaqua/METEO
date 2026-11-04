#!/bin/bash
# Esegue una pagina di site/_radar_test/ in Chrome headless (server sulla 8772) e stampa l'esito ("RISULTATO: n/n").
#   tests/web/run.sh test.html     tests/web/run.sh "it_live.html?suite=radar"
#   tests/web/run.sh "w.html?w=375&h=812&src=it_live.html%3Fsuite%3Dlayout"
PAGE="${1:-test.html}"; SEP='?'; [[ "$PAGE" == *\?* ]] && SEP='&'
PROF=$(mktemp -d /tmp/chrome-prof-radar.XXXX)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-first-run \
  --user-data-dir="$PROF" --window-size=1000,800 --virtual-time-budget=120000 --dump-dom \
  "http://localhost:8772/_radar_test/$PAGE${SEP}t=$(date +%s)" 2>/dev/null \
  | python3 -c "import sys,re,html; d=sys.stdin.read(); m=re.search(r'<pre id=\"out\"[^>]*>(.*?)</pre>', d, re.S); print(html.unescape(m.group(1)) if m else d[-1500:])"
rm -rf "$PROF"
