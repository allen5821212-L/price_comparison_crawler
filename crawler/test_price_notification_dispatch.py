import unittest
from unittest.mock import patch

import crawler_worker


class FakeCursor:
    def __init__(self):
        self.executions = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, params=None):
        self.executions.append((" ".join(query.split()), params))

    def fetchall(self):
        return [("收藏商品降價", "測試商品的最低價由 NT$10,000 降至 NT$9,000。")]


class FakeConnection:
    def __init__(self):
        self.cursor_obj = FakeCursor()
        self.committed = False
        self.closed = False

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.committed = True

    def close(self):
        self.closed = True


class PriceNotificationDispatchTests(unittest.TestCase):
    def test_dispatches_owner_alert_and_records_event_for_new_favorite_notifications(self):
        connection = FakeConnection()
        sent = []
        with patch.object(crawler_worker, "_database_connection", return_value=connection), patch.object(
            crawler_worker, "notify_owner", side_effect=lambda title, content: sent.append((title, content))
        ):
            crawler_worker.dispatch_price_drop_notifications(job_id=11, comparison_run_id=99)

        self.assertEqual(len(sent), 1)
        self.assertIn("1 項收藏商品", sent[0][0])
        self.assertIn("NT$9,000", sent[0][1])
        self.assertTrue(connection.committed)
        self.assertTrue(connection.closed)
        self.assertTrue(any("crawler_events" in statement for statement, _ in connection.cursor_obj.executions))


if __name__ == "__main__":
    unittest.main()
