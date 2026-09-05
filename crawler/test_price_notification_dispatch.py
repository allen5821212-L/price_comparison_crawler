import unittest
from unittest.mock import patch

import crawler_worker
from dynamic_store import _prune_completed_run_data


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


class RetentionCleanupTests(unittest.TestCase):
    def test_prunes_matches_and_products_in_bounded_batches(self):
        class RetentionCursor:
            def __init__(self):
                self.rowcounts = iter([5000, 7, 3])
                self.executions = []
                self.rowcount = 0

            def execute(self, statement, params):
                self.executions.append((statement, params))
                self.rowcount = next(self.rowcounts)

        cursor = RetentionCursor()

        self.assertEqual(_prune_completed_run_data(cursor), (5007, 3))
        self.assertEqual(len(cursor.executions), 3)
        self.assertTrue(all(params == (5000,) for _, params in cursor.executions))
        self.assertIn("DELETE FROM comparison_matches", cursor.executions[0][0])
        self.assertIn("status='completed'", cursor.executions[0][0])
        self.assertIn("LIMIT 30", cursor.executions[0][0])
        self.assertIn("DELETE FROM comparison_products", cursor.executions[2][0])
        self.assertIn("last_seen_run_id IS NULL", cursor.executions[2][0])


if __name__ == "__main__":
    unittest.main()
