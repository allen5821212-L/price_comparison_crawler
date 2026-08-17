import unittest

from dynamic_store import _source_key


class FavoriteSourceKeyTests(unittest.TestCase):
    def test_matches_the_react_sinya_id_for_a_real_catalog_name(self):
        match = {
            "sinya_name": "【組裝價】技嘉 AORUS RTX 5070Ti MASTER 16G (std:2670MHz/三風扇/註冊五年保/長36cm)",
            "sinya_url": "https://www.sinya.com.tw/prod/1538801398",
        }

        self.assertEqual(_source_key(match), "sinya_1538801398")

    def test_does_not_depend_on_a_url_that_the_frontend_does_not_store(self):
        name = "三星 SAMSUNG 990 PRO 2TB/M.2 PCle Gen4"
        first = _source_key({"sinya_name": name, "sinya_url": "https://example.com/one"})
        second = _source_key({"sinya_name": name, "sinya_url": "https://example.com/two"})

        self.assertEqual(first, second)
        self.assertTrue(first.startswith("sinya_"))


if __name__ == "__main__":
    unittest.main()
