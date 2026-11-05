# Prove nel browser del radar (site/radar.js e agganci in index.html)

    python3 tests/web/setup.py            # crea site/_radar_test/ (pagine di prova + fotogrammi finti)
    # servire site/ sulla porta 8772 (configurazione "site" di .claude/launch.json)
    tests/web/run.sh test.html            # radar.js da solo
    tests/web/run.sh "it_live.html?suite=radar"      # pagina vera con dati e radar veri
    tests/web/run.sh "it_local.html?suite=cursor"    # Cursore delle stazioni (riga JSON da confrontare)
    tests/web/run.sh "it_local.html?suite=hash"      # link condivisibili
    tests/web/run.sh "it_noradar.html?suite=resilience"   # pagina senza radar.js
    tests/web/run.sh "it_prod.html?suite=prodotti"   # menu dei prodotti (radar locale: SRI, VMI, TEMP)
    tests/web/run.sh "it_live.html?suite=dock"       # plancia del radar
    tests/web/run.sh "it_live.html?suite=buffer"     # caricamento del radar
    tests/web/run.sh "it_local.html?suite=oralegale" # ora legale nei grafici delle stazioni (ora doppia di ottobre)
    tests/web/run.sh "it_local.html?suite=search"    # barra in alto: ricerca, pillole, menu, ⋯
    tests/web/run.sh "it_local.html?suite=hover"     # scheda al passaggio (mouse) e foglio basso (tocco)
    tests/web/run.sh "w.html?w=375&h=812&src=it_local.html%3Fsuite%3Dhover"   # la stessa a 375 px
    tests/web/run.sh "w.html?w=667&h=375&src=it_local.html%3Fsuite%3Dhover"   # telefono in orizzontale (anche 812x375)
    tests/web/run.sh "it_prod.html?suite=hoverradar"  # scheda col radar locale (SRI coi puntini, VMI senza)
    tests/web/run.sh "it_local.html?suite=stazione"   # variabile con cui si apre una stazione
    tests/web/run.sh "w.html?w=375&h=812&src=it_live.html%3Fsuite%3Dlayout"   # ingombri a 375 px
    python3 tests/web/setup.py --clean    # toglie site/_radar_test/

Serve Chrome (headless). Le suite sono in it_tests.js; ogni pagina stampa "RISULTATO: n/n".
setup.py importa dati_radar (numpy + Pillow): sul Mac usare /usr/bin/python3.
