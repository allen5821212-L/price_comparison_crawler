"""Regression tests for raw crawler price sanity checks and state fingerprints."""

import unittest

from price_guard import assess_price, state_fingerprint


class PriceGuardTests(unittest.TestCase):
    def test_filters_absolute_placeholder_prices(self):
        self.assertTrue(assess_price(99_999).is_suspect)
        self.assertTrue(assess_price(10).is_suspect)
        self.assertFalse(assess_price(11).is_suspect)

    def test_flags_extreme_daily_movements(self):
        self.assertTrue(assess_price(300, 1_000).is_suspect)
        self.assertTrue(assess_price(2_600, 1_000).is_suspect)
        self.assertFalse(assess_price(1_300, 1_000).is_suspect)

    def test_fingerprint_only_changes_when_state_changes(self):
        baseline = {"price": 1_000, "stock_status": "in_stock", "promo_info": ""}
        self.assertEqual(state_fingerprint(baseline), state_fingerprint({**baseline, "subtitle": "ignored"}))
        self.assertNotEqual(state_fingerprint(baseline), state_fingerprint({**baseline, "name": "renamed"}))
        self.assertNotEqual(state_fingerprint(baseline), state_fingerprint({**baseline, "price": 1_001}))


if __name__ == "__main__":
    unittest.main()
