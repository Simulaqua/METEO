#!/usr/bin/env bash
# ===========================================================================================
# watchdog_mac.sh - guardiano LATO MAC del sistema METEO (niente servizi esterni).
# Controlla DALL'ESTERNO (GitHub, branch data) l'eta' dell'ultimo dato pubblicato: se supera
# la soglia, notifica macOS con suono. Cosi' l'avviso funziona anche se il Pi e' spento o la
# sua rete e' giu' (il Pi non deve "chiamare" nessuno).
# Lanciato da launchd ogni 30 min: ~/Library/LaunchAgents/com.meteo.watchdog.plist
# Test manuale:   ./watchdog_mac.sh            (silenzioso se tutto ok)
#                 THRESH_MIN=0 ./watchdog_mac.sh   (forza la notifica, per prova)
# ===========================================================================================
THRESH_MIN="${THRESH_MIN:-180}"     # soglia in minuti (default 3 ore)
URL="https://raw.githubusercontent.com/Simulaqua/METEO/data/STATUS/status.json"
LOG="$HOME/.meteo_watchdog.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

J=$(curl -fsS -m 20 "$URL?cb=$(date +%s)" 2>/dev/null)
if [ -z "$J" ]; then
    # Mac offline o GitHub giu': niente notifica (sarebbe rumore), solo log.
    echo "$(ts) WARN: status.json non raggiungibile" >> "$LOG"
    exit 0
fi

AGE_MIN=$(printf '%s' "$J" | /usr/bin/python3 -c '
import json, sys, datetime, zoneinfo
try:
    latest = json.load(sys.stdin)["latest"]
    lat = datetime.datetime.strptime(latest, "%Y-%m-%dT%H:%M")
    now = datetime.datetime.now(zoneinfo.ZoneInfo("Europe/Rome")).replace(tzinfo=None)
    print(int((now - lat).total_seconds() // 60))
except Exception:
    print(-1)
')

if [ "$AGE_MIN" -lt 0 ]; then
    echo "$(ts) WARN: status.json illeggibile" >> "$LOG"
    exit 0
fi

echo "$(ts) ok: ultimo dato $AGE_MIN min fa (soglia $THRESH_MIN)" >> "$LOG"

if [ "$AGE_MIN" -gt "$THRESH_MIN" ]; then
    H=$(( AGE_MIN / 60 ))
    /usr/bin/osascript -e "display notification \"Ultimo dato pubblicato ${H} ore fa (${AGE_MIN} min). Controlla Pi / rete / publish.\" with title \"⚠ METEO fermo\" sound name \"Basso\"" 2>/dev/null
fi
exit 0
