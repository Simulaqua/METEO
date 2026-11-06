# Pubblicazione (publish.sh): lo stato del sito che scrive status.py, letto dal banner della pagina e dagli avvisi
# GitHub. Il resto di publish.sh lo provano gli scenari di tests/test_rete.py (TestBash).
#   /usr/bin/python3 -m unittest tests.test_pubblica -v
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import status


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fp:
        fp.write(text)


def stations(*times):
    """Il testo di uno stations.geojson con una stazione per ogni ora dell'ultimo dato in times."""
    return json.dumps({'type': 'FeatureCollection',
                       'features': [{'type': 'Feature', 'properties': {'scode': 'S%d' % n, 'latest_time': moment}}
                                    for n, moment in enumerate(times)]})


class TestStato(unittest.TestCase):

    def test_stato_regioni_e_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            site, logs, backup = (os.path.join(folder, name) for name in ('site', 'logs', 'backup'))
            # in LAGHI la seconda stazione è indietro: più di 3 ore prima della più recente
            write(os.path.join(site, 'LAGHI', 'stations.geojson'), stations('2026-11-05T12:00', '2026-11-05T08:50'))
            write(os.path.join(site, 'MAR_ER', 'stations.geojson'), stations('2026-11-05T11:30', '2026-11-05T09:00'))
            write(os.path.join(site, 'INV_ER', 'stations.geojson'), '{rotto')
            write(os.path.join(logs, 'backup-20261104-044000.log'), 'ERRORE: vecchio -- log di ieri\n')
            write(os.path.join(logs, 'backup-20261105-044000.log'),
                  'ERRORE: a -- b\nATTENZIONE: c\nERRORE: a -- d\nfatto in 12s\n')
            for day in ('2026-11-04', '2026-11-05'):
                os.makedirs(os.path.join(backup, day))
            out = status.build_status(site, logs, backup)
        self.assertEqual(out['latest'], '2026-11-05T12:00')
        self.assertEqual(out['regions'], {'LAGHI': {'latest': '2026-11-05T12:00', 'n': 2, 'old': 1},
                                          'MAR_ER': {'latest': '2026-11-05T11:30', 'n': 2, 'old': 0}})
        self.assertEqual(out['backup'], {'last': '2026-11-05', 'warn': ['a', 'c'], 'info': 'fatto in 12s'})


if __name__ == '__main__':
    unittest.main()
