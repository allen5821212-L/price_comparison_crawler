"""PCHOME 搜尋頁子程序逾時隔離的回歸測試。"""

import os
import sys
import time
import unittest
from unittest.mock import patch


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crawl_pchome


def slow_fetch_worker(_url, _headers, _connection):
    """模擬持續串流而無法自行返回的來源回應。"""
    time.sleep(5)


def successful_fetch_worker(_url, _headers, connection):
    """模擬正常 PCHOME API 回應。"""
    connection.send(("ok", {"prods": [{"Id": "TEST001", "name": "測試商品"}]}))
    connection.close()


class PchomePageTimeoutTests(unittest.TestCase):
    def test_successful_page_returns_decoded_payload(self):
        with patch.object(crawl_pchome, "_fetch_pchome_page_worker", successful_fetch_worker):
            result = crawl_pchome.fetch_url("https://example.invalid/ok", retries=1)

        self.assertEqual(result, {"prods": [{"Id": "TEST001", "name": "測試商品"}]})

    def test_slow_page_is_terminated_at_wall_clock_limit(self):
        with patch.object(crawl_pchome, "PCHOME_PAGE_HARD_TIMEOUT_SECONDS", 0.2), patch.object(
            crawl_pchome, "_fetch_pchome_page_worker", slow_fetch_worker
        ):
            started = time.monotonic()
            result = crawl_pchome.fetch_url("https://example.invalid/stalled", retries=1)
            elapsed = time.monotonic() - started

        self.assertIsNone(result)
        self.assertLess(elapsed, 1.5, f"PCHOME 頁面逾時隔離花費 {elapsed:.2f}s，未在合理時間內返回")


if __name__ == "__main__":
    unittest.main(verbosity=2)
