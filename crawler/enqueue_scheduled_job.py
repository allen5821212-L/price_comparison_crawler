#!/usr/bin/env python3
"""Create the next scheduled full crawl only when no job is already active."""

from dynamic_store import _database_connection


def main() -> None:
    connection = _database_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM crawler_jobs WHERE status IN ('queued', 'running')")
            active = int(cursor.fetchone()[0])
            if active:
                print(f"skip scheduled crawl: {active} worker job(s) already active")
                return
            cursor.execute("INSERT INTO crawler_jobs (scope, `trigger`, status) VALUES ('full', 'scheduled', 'queued')")
            job_id = int(cursor.lastrowid)
            cursor.execute(
                """INSERT INTO crawler_events (job_id, level, event_type, title, message)
                   VALUES (%s, 'info', 'scheduled_enqueued', '例行爬蟲已排入佇列', '持續執行器將執行完整四平台更新。')""",
                (job_id,),
            )
            connection.commit()
            print(f"scheduled crawler job #{job_id} queued")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
