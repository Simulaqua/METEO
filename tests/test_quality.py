import unittest

import quality


class TestPlausibilita(unittest.TestCase):
    def test_checker_lascia_passare_i_vuoti(self):
        ok = quality.checker('TEMP')
        self.assertTrue(ok(None))
        self.assertTrue(ok(''))

    def test_checker_scarta_il_non_plausibile(self):
        ok = quality.checker('TEMP')
        for v in ('x', -999, float('nan'), 80.0, 20.0 + 1000):
            self.assertFalse(ok(v), v)
        self.assertTrue(ok(21.5))
        self.assertTrue(ok('21.5'))

    def test_checker_senza_limiti_scarta_solo_le_sentinelle(self):
        ok = quality.checker('SCONOSCIUTA')
        self.assertFalse(ok(-999))
        self.assertFalse(ok(99999))
        self.assertTrue(ok(5000))

    def test_valid_e_checker_danno_gli_stessi_risultati(self):
        for var in ('TEMP', 'UMID', 'PREC', 'SCONOSCIUTA'):
            ok = quality.checker(var)
            for v in (-999, -60, -61, 0.0, 55.0, 56.0, 105.0, 1000.0, 1001.0, 99999, float('nan')):
                self.assertEqual(ok(v), quality.valid(var, v), (var, v))

    def test_valid_rifiuta_il_vuoto(self):
        self.assertFalse(quality.valid('TEMP', None))


if __name__ == '__main__':
    unittest.main()
