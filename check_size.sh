#!/usr/bin/env bash
# ===========================================================================================
# check_size.sh - fotografia rapida dello spazio occupato dal progetto sul Pi.
# Uso:  ~/METEO/check_size.sh
# Evidenzia le voci che DEVONO restare piccole (data-downloaded, logs) e quelle che
# crescono lentamente per scelta (data-parsed = archivio storico).
# ===========================================================================================
BASE="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE"

echo "== TOTALE progetto =="
du -sh . 2>/dev/null

echo
echo "== Per regione (top livello) =="
du -sh */ 2>/dev/null | sort -rh

echo
echo "== GREZZI temporanei (devono restare ~zero: se sono grossi c'e' un problema) =="
du -sh */data-downloaded 2>/dev/null | sort -rh
echo "  file grezzi totali: $(find */data-downloaded -type f 2>/dev/null | wc -l)"

echo
echo "== ARCHIVIO storico (cresce piano, e' voluto) =="
du -sh */data-parsed 2>/dev/null | sort -rh

echo
echo "== LOG (tetto: 14 giorni) =="
du -sh logs */logs 2>/dev/null | sort -rh

echo
echo "== SITO pubblicato (finestra 7 giorni, dimensione costante) =="
du -sh site 2>/dev/null

echo
echo "== CHIAVETTA USB (backup notturno 04:40, ultime 30 versioni) =="
if mountpoint -q /mnt/usb; then
    df -h /mnt/usb | tail -1
    last=$(ls -1d /mnt/usb/backup/20??-??-?? 2>/dev/null | tail -1)
    echo "  versioni: $(ls -1d /mnt/usb/backup/20??-??-?? 2>/dev/null | wc -l), ultima: ${last##*/}"
    [[ "${last##*/}" < "$(date -d yesterday +%F)" ]] && echo "  ATTENZIONE: nessun backup nuovo da piu' di un giorno"
    [ -f /mnt/usb/backup/.rotazione-ferma ] && echo "  ATTENZIONE: rotazione ferma -> $(tail -1 /mnt/usb/backup/.rotazione-ferma)"
else
    echo "  NON montata: il backup notturno non gira"
fi
echo "  ultimo log: $(tail -1 "$(ls -t logs/backup-*.log 2>/dev/null | head -1)" 2>/dev/null)"
