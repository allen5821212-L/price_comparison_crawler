"""momo Next.js 解析逾時隔離的回歸測試。"""

import os
import sys
import time
import unittest
from unittest.mock import patch


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crawl_momo


def slow_parser(_html):
    """模擬無法快速返回的病態正規表示式解析。"""
    time.sleep(5)
    return []


class MomoParseTimeoutTests(unittest.TestCase):
    def test_successful_parse_returns_products(self):
        html = 'self.__next_f.push([1,"goodsUrl\\\":\\\"/goods.momo?i_code=12345\\\",goodsName\\\":\\\"測試商品\\\",goodsPrice\\\":\\\"$1,234\\\",goodsPriceOri\\\":\\\"$1,599\\\",brandName\\\":\\\"測試品牌\\\""])'

        products = crawl_momo.parse_momo_products_with_timeout(html)

        self.assertEqual(len(products), 1)
        self.assertEqual(products[0]["id"], "momo_12345")
        self.assertEqual(products[0]["name"], "測試商品")
        self.assertEqual(products[0]["price"], 1234)

    def test_slow_parse_is_terminated_at_wall_clock_limit(self):
        with patch.object(crawl_momo, "MOMO_PARSE_HARD_TIMEOUT_SECONDS", 0.2), patch.object(
            crawl_momo, "parse_momo_products", slow_parser
        ):
            started = time.monotonic()
            products = crawl_momo.parse_momo_products_with_timeout("pathological payload")
            elapsed = time.monotonic() - started

        self.assertEqual(products, [])
        self.assertLess(elapsed, 1.5, f"解析逾時隔離花費 {elapsed:.2f}s，未在合理時間內返回")


if __name__ == "__main__":
    unittest.main(verbosity=2)
