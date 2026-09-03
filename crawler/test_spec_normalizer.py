"""Regression tests for hard hardware-spec matching guardrails."""

import unittest

from matcher import compute_score, veto
from spec_normalizer import extract_spec_features, normalize_match_text


class SpecNormalizerTests(unittest.TestCase):
    def test_marketing_words_are_removed_before_similarity(self):
        text = normalize_match_text("【狂降】 RTX 4060 Ti 現貨 含稅免運")
        self.assertIn("RTX 4060 TI", text)
        self.assertNotIn("狂降", text)
        self.assertNotIn("現貨", text)

    def test_capacity_mismatch_is_hard_blocked(self):
        blocked, reason = veto("Samsung 990 Pro 1TB SSD", "Samsung 990 Pro 2TB SSD")
        self.assertTrue(blocked)
        self.assertIn("容量", reason)

    def test_ddr_and_pcie_generations_are_hard_blocked(self):
        self.assertTrue(veto("Kingston DDR4 32GB", "Kingston DDR5 32GB")[0])
        self.assertTrue(veto("SSD PCIe 4.0 1TB", "SSD PCIe 5.0 1TB")[0])

    def test_suffix_mismatch_can_not_be_high_confidence(self):
        score, details = compute_score("ASUS RTX 4060 Ti OC", "ASUS RTX 4060")
        self.assertLessEqual(score, 0.54)
        self.assertIn("suffixConfidenceCap", details)

    def test_extracts_canonical_capacity_and_suffix(self):
        specs = extract_spec_features("RX 7900 XTX 24 GB")
        self.assertEqual(specs.capacities, frozenset({"24G"}))
        self.assertEqual(specs.suffixes, frozenset({"XTX"}))


if __name__ == "__main__":
    unittest.main()
