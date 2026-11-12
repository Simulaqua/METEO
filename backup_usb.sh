#!/usr/bin/env bash
# backup_usb.sh - backup notturno dell'archivio sulla chiavetta USB (/mnt/usb, ext4).
#   - ogni notte una versione completa in /mnt/usb/backup/AAAA-MM-GG/:
#       METEO/       il progetto, senza cio' che si rigenera o sta altrove (site/, radar_out/,
#                    history_out/, history_cache/, log, grezzi, .git)
#       arpav/       il sistema ARPAV (dati dal 2022), senza log e grezzi
#       crontab.txt  il crontab completo (anche le righe ARPAV, che non sono nel repo)
#   - i file uguali alla versione precedente sono hard link: occupano spazio una volta sola
#   - tiene le ultime KEEP versioni (30); ognuna contiene l'archivio intero, togliere la piu'
#     vecchia non cancella dati
#   - la nuova versione compare solo se la copia riesce; solo allora si tolgono le vecchie
# Protezioni:
#   - chiavetta non montata: esce senza scrivere (/mnt/usb sarebbe una cartella della SD)
#   - data non sincronizzata (il Pi non ha orologio interno): esce
#   - l'archivio di una sorgente (METEO: solo */data-parsed/; arpav: tutto) scende sotto il 90% dei
#     file della versione precedente: scrive /mnt/usb/backup/.rotazione-ferma e non toglie piu'
#     versioni vecchie finche' qualcuno non controlla e cancella quel file
#   - copia parziale (rsync 23): la versione si salva, ma quella notte non si tolgono le vecchie
#   - mai due backup insieme (flock)
# Righe d'avviso nel log: 'ERRORE|ATTENZIONE: <etichetta> -- <dettagli>'. publish.sh porta solo
# l'etichetta nell'avviso GitHub 'Warning - backup off'.
#
# Uso:        ~/METEO/backup_usb.sh   (cron 04:40, vedi crontab_regioni.txt)
# Test:       BACKUP_MNT, BACKUP_DEST, BACKUP_METEO, BACKUP_ARPAV, BACKUP_KEEP, BACKUP_DAY
#             sostituiscono i valori qui sotto.
# Ripristino: cp -a / rsync -a da /mnt/usb/backup/<giorno>/
set -uo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"
MNT="${BACKUP_MNT:-/mnt/usb}"
DEST="${BACKUP_DEST:-$MNT/backup}"
SRC_METEO="${BACKUP_METEO:-$BASE}"
SRC_ARPAV="${BACKUP_ARPAV:-/home/manuel/dati/arpav}"
KEEP="${BACKUP_KEEP:-30}"
DAY="${BACKUP_DAY:-$(date +%F)}"
STOP="$DEST/.rotazione-ferma"

log() { echo "$(date '+%F %T') $*"; }
nfile() { find "$1" -type f 2>/dev/null | wc -l; }
# file d'archivio di <versione>/<sorgente>, per il controllo anti-cancellazione
narch() { if [ "$2" = METEO ]; then find "$1/METEO" -path '*/data-parsed/*' -type f 2>/dev/null | wc -l
          else nfile "$1/$2"; fi; }

exec 9>"$BASE/.backup.lock"
if ! flock -n 9; then
    log "un altro backup e' ancora in corso: salto"
    exit 0
fi
if ! mountpoint -q "$MNT"; then
    log "ERRORE: chiavetta assente -- $MNT non montata, backup saltato"
    exit 1
fi
if ! [[ $DAY =~ ^20[2-9][0-9]-[01][0-9]-[0-3][0-9]$ ]]; then
    log "ERRORE: orologio -- data '$DAY' non valida (non ancora sincronizzata?), backup saltato"
    exit 1
fi
if ! [[ $KEEP =~ ^[1-9][0-9]*$ ]]; then
    log "ERRORE: KEEP errato -- KEEP='$KEEP', serve un numero >= 1, backup saltato"
    exit 1
fi

mkdir -p "$DEST" || exit 1
WORK="$DEST/.in-corso"
rm -rf "$WORK"                     # resto di un run interrotto
mkdir -p "$WORK" || exit 1

# Versione precedente (anche quella di oggi, se e' un secondo run): i conteggi si leggono ora,
# perche' a fine run quella di oggi viene sostituita.
PREV=$(ls -1d "$DEST"/20??-??-?? 2>/dev/null | tail -1)
PREV_METEO=""; PREV_arpav=""
[ -d "$PREV/METEO" ] && PREV_METEO=$(narch "$PREV" METEO)
[ -d "$PREV/arpav" ] && PREV_arpav=$(narch "$PREV" arpav)
log "inizio versione $DAY${PREV:+ (file uguali collegati a ${PREV##*/})}"

NEWB=0          # byte copiati davvero (gli hard link non contano), per il log
PARTIAL=0
# copy <nome> <sorgente> [esclusioni rsync]. rsync 24 = file spariti durante la copia (compressi dal
# gzip notturno): la copia vale. 23 = qualche file non copiato: versione parziale.
copy() {
    local name=$1 src=$2 rc b
    shift 2
    if [ ! -d "$src" ]; then
        log "ATTENZIONE: $name mancante -- $src non esiste, non salvato"
        return
    fi
    local link=()
    [ -n "$PREV" ] && [ -d "$PREV/$name" ] && link=(--link-dest="$PREV/$name")
    rsync -a --stats "${link[@]}" "$@" "$src/" "$WORK/$name/" > "$DEST/.stats"
    rc=$?
    if [ $rc -eq 23 ]; then
        PARTIAL=1
        log "ATTENZIONE: copia parziale -- rsync $name: alcuni file non copiati (errori qui sopra)"
    elif [ $rc -ne 0 ] && [ $rc -ne 24 ]; then
        log "ERRORE: rsync $rc -- $name: versione $DAY NON salvata"
        exit 1
    fi
    b=$(sed -n 's/^Total transferred file size: \([0-9,]*\) bytes.*/\1/p' "$DEST/.stats" | tr -d ,)
    NEWB=$((NEWB + ${b:-0}))
}

copy METEO "$SRC_METEO" \
    --exclude='/site/' --exclude='/logs/' --exclude='/*/logs/' --exclude='/*/data-downloaded/' \
    --exclude='/.git/' --exclude='/radar_out/' --exclude='/history_out/' --exclude='/history_cache/' \
    --exclude='__pycache__/' --exclude='*.lock' --exclude='*.tmp'
copy arpav "$SRC_ARPAV" --exclude='/live/logs/' --exclude='/live/data-downloaded/'
crontab -l > "$WORK/crontab.txt" 2>/dev/null
rm -f "$DEST/.stats"

rm -rf "$DEST/$DAY"                # secondo run nello stesso giorno: sostituisce la versione
mv "$WORK" "$DEST/$DAY" || exit 1

# anti-cancellazione: l'archivio di ogni sorgente deve avere almeno il 90% dei file di prima
NF=$(nfile "$DEST/$DAY")
for s in METEO arpav; do
    n=$(narch "$DEST/$DAY" "$s")
    p="PREV_$s"; p=${!p}
    if [ -n "$p" ] && [ $((n * 10)) -lt $((p * 9)) ]; then
        echo "$DAY: archivio $s sceso da $p a $n file" >> "$STOP"
    fi
done

# tiene le ultime KEEP versioni: esce la piu' vecchia (i dati restano nelle successive)
if [ -f "$STOP" ]; then
    log "ATTENZIONE: rotazione ferma -- $(tail -1 "$STOP"), nessuna versione vecchia tolta. Se era voluto: rm $STOP"
elif [ $PARTIAL -eq 1 ]; then
    log "ATTENZIONE: copia parziale -- stanotte nessuna versione vecchia tolta"
else
    ls -1d "$DEST"/20??-??-?? 2>/dev/null | head -n -"$KEEP" | while read -r old; do
        rm -rf "$old" && log "tolta la versione piu' vecchia: ${old##*/}"
    done
fi

N=$(ls -1d "$DEST"/20??-??-?? 2>/dev/null | wc -l)
FREE=$(df -h --output=avail "$MNT" | tail -1 | tr -d ' ')
USE=$(df --output=pcent "$MNT" | tail -1 | tr -dc '0-9')
log "fatto in ${SECONDS}s: versione $DAY, $(awk -v b=$NEWB 'BEGIN {printf "%.1f", b / 1048576}') MB nuovi, $NF file, $N versioni, liberi $FREE"
[ "${USE:-0}" -ge 90 ] && log "ATTENZIONE: chiavetta piena ${USE}% -- liberare spazio o ridurre KEEP"
exit 0
