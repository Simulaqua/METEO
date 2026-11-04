#!/usr/bin/env bash
# ===========================================================================================
# deploy.sh - sincronizza il progetto dal Mac al Raspberry Pi e finalizza il deploy.
#   - copia SOLO il codice (esclude data-parsed/data-downloaded/logs/.git/cache)
#   - reinstalla il crontab
#   - lancia le prime raccolte (aria + PC: PC_FVG costruisce la cache sensori)
# I dati sul Pi NON vengono toccati; il sito va online da solo al successivo publish.sh (cron).
#
# Uso:   ./deploy.sh [host-ssh]
#   es.  ./deploy.sh manuel01      (raspberry01.local: solo rete di casa)
# Se ometti l'argomento usa PI_HOST qui sotto: pitail = Tailscale, funziona anche da remoto.
# ===========================================================================================
set -euo pipefail

PI_HOST="${1:-pitail}"                       # alias di ~/.ssh/config, oppure passalo come argomento
PI_BASE="/home/manuel/METEO"                 # deve combaciare con BASE nel crontab
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "== Deploy verso $PI_HOST:$PI_BASE =="

# 1) sincronizza il codice (niente dati/log/git/cache): --update non sovrascrive file piu' recenti sul Pi
#   - i dati (data-parsed/downloaded, logs, .tracking, cache sensori) NON si toccano: restano quelli del Pi
#   - site/<REGIONE>/ (export dati) NON si copia: lo rigenera export_web sul Pi; si copia SOLO site/index.html
#   - niente --update: per il CODICE vince sempre il Mac (deploy prevedibile)
rsync -av \
  --exclude 'data-parsed'  --exclude 'data-downloaded' \
  --exclude 'logs'         --exclude '.git' \
  --exclude '.tracking'    --exclude '__pycache__' \
  --exclude 'sensors_map.json' \
  --exclude 'site/*/' \
  "$SRC_DIR"/  "$PI_HOST:$PI_BASE/"

# 2) sul Pi: reinstalla il crontab + prime raccolte dei nuovi layer
ssh "$PI_HOST" bash -s <<PIEOF
set -e
cd "$PI_BASE"
echo "-- aggiorno SOLO il blocco METEO del crontab (le altre tue righe restano intatte)"
# rimuove un eventuale vecchio blocco fra i marcatori e riappende quello nuovo; preserva il resto
# cat -s: le righe vuote non si accumulano a ogni deploy
( crontab -l 2>/dev/null | sed '/# >>> METEO/,/# <<< METEO/d' | cat -s; echo; cat crontab_regioni.txt ) | crontab -
echo "-- verifico python e flock"
which python3; which flock || echo "ATTENZIONE: flock mancante (installa util-linux)"
echo "-- prima raccolta QUALITA' ARIA"
python3 dati_aria.py -r all
echo "-- prima raccolta IDROMETRIA PC (PC_FVG cache sensori ~1-2 min; include PC_PIE Po/Piemonte)"
python3 dati_pc.py -r all
echo "-- prima raccolta GRANDI LAGHI (laghi.net)"
python3 dati_laghi.py || echo "ATTENZIONE: prima raccolta laghi fallita (riprovera' il cron)"
echo "-- prima raccolta INVASI ARTIFICIALI (Romagna Acque: Ridracoli + Conca)"
python3 dati_invasi.py -r all || echo "ATTENZIONE: prima raccolta invasi fallita (riprovera' il cron)"
echo "-- prima raccolta LIGURIA (ARPAL/OMIRL)"
python3 dati_liguria.py || echo "ATTENZIONE: prima raccolta Liguria fallita (riprovera' il cron)"
echo "-- prima raccolta MAREE/METEO-MARINO (Venezia + ARPAE ER + OGS Trieste)"
python3 dati_mare.py -r VEN,ER,FVG || echo "ATTENZIONE: prima raccolta maree fallita (riprovera' il cron)"
echo "-- rigenero l'export web (tutte le regioni + nuovi layer + grandezze derivate/indici)"
python3 export_web.py -r all --site-dir site >/dev/null
echo "-- calcolo la climatologia iniziale (legge l'archivio; puo' richiedere qualche minuto)"
python3 climatology.py -r all --site-dir site >/dev/null 2>&1 || echo "ATTENZIONE: climatologia iniziale fallita (riprovera' il cron)"
echo "-- fatto. Il prossimo publish.sh (cron) pubblichera' aria e idrometria."
PIEOF

echo "== Deploy completato. Controlla col comando: ssh $PI_HOST '~/METEO/check_size.sh' =="
