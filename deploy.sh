#!/usr/bin/env bash
# deploy.sh - sincronizza il progetto dal Mac al Raspberry Pi e reinstalla il crontab.
#   - copia solo il codice: le esclusioni sono in deploy_exclude.txt
#   - sostituisce solo il blocco METEO del crontab, le altre righe del Pi restano
# I dati sul Pi non vengono toccati.
#
# Uso:   ./deploy.sh [host-ssh]
#   es.  ./deploy.sh manuel01      (raspberry01.local: solo rete di casa)
# Senza argomento usa PI_HOST: pitail = Tailscale, funziona anche da remoto.
set -euo pipefail

PI_HOST="${1:-pitail}"                       # alias di ~/.ssh/config
PI_BASE="/home/manuel/METEO"                 # deve combaciare con BASE nel crontab
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "== Deploy verso $PI_HOST:$PI_BASE =="

# 1) sincronizza il codice
rsync -av --exclude-from "$SRC_DIR/deploy_exclude.txt" \
  "$SRC_DIR"/  "$PI_HOST:$PI_BASE/"

# 2) sul Pi: reinstalla il crontab
ssh "$PI_HOST" bash -s <<PIEOF
set -e
cd "$PI_BASE"
echo "-- aggiorno SOLO il blocco METEO del crontab (le altre tue righe restano intatte)"
# rimuove un eventuale vecchio blocco fra i marcatori e riappende quello nuovo; preserva il resto
# cat -s: le righe vuote non si accumulano a ogni deploy
( crontab -l 2>/dev/null | sed '/# >>> METEO/,/# <<< METEO/d' | cat -s; echo; cat crontab_regioni.txt ) | crontab -
echo "-- verifico python e flock"
which python3; which flock || echo "ATTENZIONE: flock mancante (installa util-linux)"
PIEOF

echo "== Deploy completato. Controlla col comando: ssh $PI_HOST '~/METEO/check_size.sh' =="
