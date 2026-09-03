"""Regression tests for evidence-based rejected-feature penalties."""

import unittest

from negative_features import build_negative_penalty_lookup, negative_penalty


class NegativeFeatureTests(unittest.TestCase):
    def test_penalty_applies_only_to_the_same_directed_platform_pair(self):
        rules = build_negative_penalty_lookup([{
            "platform": "pchome", "sourceFeature": "ddr:ddr5", "targetFeature": "ddr:ddr4", "penalty": 0.18,
        }])
        self.assertEqual(negative_penalty("記憶體 DDR5", "記憶體 DDR4", "pchome", rules), 0.18)
        self.assertEqual(negative_penalty("記憶體 DDR5", "記憶體 DDR4", "momo", rules), 0.0)
        self.assertEqual(negative_penalty("記憶體 DDR5", "記憶體 DDR5", "pchome", rules), 0.0)


if __name__ == "__main__":
    unittest.main()
