# Ora legale nell'export del sito: l'archivio e' in ORA SOLARE (UTC+1 fisso) e export_web.py lo converte nell'ora
# civile italiana (l'orologio da muro). Valori attesi presi dall'orologio reale dei cambi d'ora del 2026:
#   29/03 alle 01:00 UTC = 02:00 solari: le 02:00 CET diventano 03:00 CEST
#   25/10 alle 01:00 UTC = 02:00 solari: le 03:00 CEST tornano 02:00 CET (l'ora 02:00-03:00 si ripete)
#   python3 -m unittest tests.test_export_dst -v
import datetime, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import export_web as ew


class TestOraLegaleExport(unittest.TestCase):

    def test_ottobre(self):
        self.assertEqual(ew.iso_datetime('202610250059'), '2026-10-25T01:59')   # 23:59 UTC: CEST
        self.assertEqual(ew.iso_datetime('202610250159'), '2026-10-25T02:59')   # 00:59 UTC: ancora CEST
        self.assertEqual(ew.iso_datetime('202610250200'), '2026-10-25T02:00')   # 01:00 UTC: gia' CET
        self.assertEqual(ew.iso_datetime('202610250230'), '2026-10-25T02:30')   # 01:30 UTC: CET (seconda volta delle 02:30)
        self.assertEqual(ew.iso_datetime('202610250300'), '2026-10-25T03:00')   # 02:00 UTC: CET

    def test_marzo(self):
        self.assertEqual(ew.iso_datetime('202603290159'), '2026-03-29T01:59')   # 00:59 UTC: CET
        self.assertEqual(ew.iso_datetime('202603290200'), '2026-03-29T03:00')   # 01:00 UTC: CEST

    def test_fotogrammi_del_cursore(self):
        # i fotogrammi orari del Cursore (snap) usano la stessa regola: solare 02:00 del 25/10 -> civile 02:00
        self.assertFalse(ew._ita_is_dst(datetime.datetime(2026, 10, 25, 2, 0)))
        self.assertTrue(ew._ita_is_dst(datetime.datetime(2026, 10, 25, 1, 0)))
        self.assertTrue(ew._ita_is_dst(datetime.datetime(2026, 7, 1, 12, 0)))
        self.assertFalse(ew._ita_is_dst(datetime.datetime(2026, 12, 1, 12, 0)))


if __name__ == '__main__':
    unittest.main()
