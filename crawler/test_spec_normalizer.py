"""Regression tests for hard hardware-spec matching guardrails."""

import unittest

from matcher import compute_score, extract_brands, match_products_v2, register_brand_aliases, veto
from spec_normalizer import extract_mpn_codes, extract_spec_features, normalize_match_text


class SpecNormalizerTests(unittest.TestCase):
    def test_marketing_words_are_removed_before_similarity(self):
        text = normalize_match_text("【狂降 限搭機】 RTX 4060 Ti 現貨 促銷 福利品")
        self.assertIn("RTX 4060 TI", text)
        self.assertNotIn("狂降", text)
        self.assertNotIn("現貨", text)
        self.assertNotIn("限搭機", text)
        self.assertNotIn("促銷", text)

    def test_capacity_mismatch_is_hard_blocked(self):
        blocked, reason = veto("Samsung 990 Pro 1TB SSD", "Samsung 990 Pro 2TB SSD")
        self.assertTrue(blocked)
        self.assertIn("容量", reason)

    def test_ddr_and_pcie_generations_are_hard_blocked(self):
        self.assertTrue(veto("Kingston DDR4 32GB", "Kingston DDR5 32GB")[0])
        self.assertTrue(veto("SSD PCIe 4.0 1TB", "SSD PCIe 5.0 1TB")[0])

    def test_key_suffix_mismatch_is_hard_blocked_before_fuzzy_score(self):
        score, details = compute_score("ASUS RTX 4060 Ti OC", "ASUS RTX 4060")
        self.assertEqual(score, 0.0)
        self.assertIn("關鍵後綴", details["hardFilter"])

    def test_extracts_canonical_capacity_and_suffix(self):
        specs = extract_spec_features("RX 7900 XTX 24 GB")
        self.assertEqual(specs.capacities, frozenset({"24G"}))
        self.assertEqual(specs.suffixes, frozenset({"XTX"}))

    def test_brand_chip_wattage_and_ddr_conflicts_are_hard_blocked(self):
        cases = [
            ("ASUS RTX 5070 12G", "MSI RTX 5070 12G", "品牌"),
            ("ASUS RTX 5070 12G", "ASUS RTX 5060 12G", "核心晶片"),
            ("海韻 Focus GX 750W", "海韻 Focus GX 850W", "功率"),
            ("Kingston DDR4 32GB", "Kingston DDR5 32GB", "世代"),
        ]
        for left, right, expected in cases:
            score, details = compute_score(left, right)
            self.assertEqual(score, 0.0)
            self.assertIn(expected, details["hardFilter"])

    def test_core_chip_aliases_do_not_create_false_conflicts(self):
        self.assertFalse(veto("AMD Ryzen 7 9800X3D", "AMD R7 9800X3D")[0])
        self.assertFalse(veto("Intel Core Ultra 7 265K", "Intel Ultra 7 265K")[0])

    def test_exact_mpn_is_full_score_after_hard_filter(self):
        self.assertEqual(extract_mpn_codes("華碩 V3607VJ-0031K210H 現貨"), frozenset({"V3607VJ0031K210H"}))
        score, details = compute_score(
            "華碩 V3607VJ-0031K210H 狂降筆電",
            "ASUS V3607VJ-0031K210H 限搭機",
        )
        self.assertEqual(score, 1.0)
        self.assertEqual(details["exactMpn"], ["V3607VJ0031K210H"])

    def test_match_payload_retains_hard_filter_evidence_and_mpn_hit(self):
        matched, _rejected, _review, _price_review = match_products_v2(
            [{"id": "source-1", "name": "ASUS V3607VJ-0031K210H RTX 4060 8G", "price": 30000, "category": "筆電"}],
            [
                {"id": "target-1", "name": "華碩 V3607VJ-0031K210H RTX 4060 8G", "price": 29500, "category": "筆電"},
                {"id": "target-2", "name": "華碩 V3607VJ-0031K210H RTX 4060 Ti 8G", "price": 31000, "category": "筆電"},
            ],
        )
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["exact_mpn"], ["V3607VJ0031K210H"])
        self.assertTrue(any("關鍵後綴" in reason for reason in matched[0]["hard_filter_reasons"]))

    def test_registered_brand_alias_is_available_to_hard_filter(self):
        self.assertEqual(register_brand_aliases([{"alias": "DemoBrand-TW", "canonicalName": "DemoBrand"}]), 1)
        self.assertIn("DemoBrand", extract_brands("DEmobrand-tw X100"))


if __name__ == "__main__":
    unittest.main()
