#!/usr/bin/env python3
"""Persistent worker that claims crawler jobs from MySQL and records lifecycle events."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from dynamic_store import _database_connection

PROJECT_DIR = Path(__file__).resolve().parent.parent
CRAWLER_PATH = PROJECT_DIR / "crawler" / "crawl.py"
POLL_SECONDS = int(os.environ.get("CRAWLER_WORKER_POLL_SECONDS", "20"))
CRAWLER_JOB_TIMEOUT_SECONDS = int(os.environ.get("CRAWLER_JOB_TIMEOUT_SECONDS", str(8 * 60 * 60)))
OWNER_NOTIFICATION_ENDPOINT = "webdevtoken.v1.WebDevService/SendNotification"


def event(cursor: Any, job_id: int | None, level: str, event_type: str, title: str, message: str = "") -> None:
    cursor.execute(
        """INSERT INTO crawler_events (job_id, level, event_type, title, message)
           VALUES (%s, %s, %s, %s, %s)""",
        (job_id, level, event_type, title[:512], message[:16000] or None),
    )


def claim_next_job() -> dict[str, Any] | None:
    connection = _database_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("START TRANSACTION")
            cursor.execute(
                """SELECT id, scope, `trigger`, category_id, category_name
                   FROM crawler_jobs WHERE status='queued'
                   ORDER BY requested_at, id LIMIT 1 FOR UPDATE"""
            )
            row = cursor.fetchone()
            if not row:
                connection.rollback()
                return None
            job = dict(zip(["id", "scope", "trigger", "category_id", "category_name"], row))
            cursor.execute(
                """UPDATE crawler_jobs SET status='running', executor=%s, started_at=NOW()
                   WHERE id=%s""",
                (os.environ.get("HOSTNAME", "persistent-crawler"), job["id"]),
            )
            scope_label = "完整四平台更新" if job["scope"] == "full" else f"指定分類優先更新：{job['category_name']}"
            event(cursor, job["id"], "info", "job_started", "爬蟲工作開始", scope_label)
            connection.commit()
            return job
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def notify_owner(title: str, content: str) -> None:
    """Best-effort owner alert; database events remain the durable source of truth."""
    base = os.environ.get("BUILT_IN_FORGE_API_URL", "").rstrip("/")
    token = os.environ.get("BUILT_IN_FORGE_API_KEY", "")
    if not base or not token:
        return
    try:
        import urllib.request

        request = urllib.request.Request(
            f"{base}/{OWNER_NOTIFICATION_ENDPOINT}",
            data=json.dumps({"title": title[:1200], "content": content[:20000]}).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Connect-Protocol-Version": "1",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15):
            pass
    except Exception as error:
        print(f"[WARN] owner notification failed: {error}", flush=True)


def dispatch_price_drop_notifications(job_id: int, comparison_run_id: int) -> None:
    """Send one concise owner alert for all new favorite price notifications from a crawl run."""
    connection = _database_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT pn.title, pn.message
                   FROM price_notifications pn
                   WHERE pn.comparison_run_id=%s
                   ORDER BY pn.id DESC LIMIT 10""",
                (comparison_run_id,),
            )
            notifications = cursor.fetchall()
            if not notifications:
                return
            lines = [f"• {title}: {message}" for title, message in notifications]
            extra = "" if len(notifications) < 10 else "\n（僅顯示前 10 則，完整內容請至收藏與通知頁面查看。）"
            notify_owner(
                f"價格比對：{len(notifications)} 項收藏商品有新降價",
                "\n".join(lines) + extra,
            )
            event(cursor, job_id, "success", "price_notifications_dispatched", "已派送收藏降價通知", f"已發送 {len(notifications)} 則收藏降價／達標通知。")
            connection.commit()
    except Exception as error:
        try:
            with connection.cursor() as cursor:
                event(cursor, job_id, "warning", "price_notification_dispatch_failed", "收藏降價通知派送失敗", str(error))
                connection.commit()
        except Exception:
            pass
    finally:
        connection.close()


def finish_job(job: dict[str, Any], succeeded: bool, summary: str, comparison_run_id: int | None = None) -> None:
    connection = _database_connection()
    try:
        with connection.cursor() as cursor:
            if succeeded:
                cursor.execute(
                    """UPDATE crawler_jobs SET status='completed', summary=%s, comparison_run_id=%s, finished_at=NOW()
                       WHERE id=%s""",
                    (summary[:16000], comparison_run_id, job["id"]),
                )
                event(cursor, job["id"], "success", "job_completed", "爬蟲工作完成", summary)
            else:
                cursor.execute(
                    """UPDATE crawler_jobs SET status='failed', error_message=%s, finished_at=NOW()
                       WHERE id=%s""",
                    (summary[:16000], job["id"]),
                )
                event(cursor, job["id"], "error", "job_failed", "爬蟲工作失敗", summary)
            connection.commit()
    finally:
        connection.close()


def latest_completed_run_id() -> int | None:
    connection = _database_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM comparison_runs WHERE status='completed' ORDER BY id DESC LIMIT 1")
            row = cursor.fetchone()
            return int(row[0]) if row else None
    finally:
        connection.close()


def execute(job: dict[str, Any]) -> None:
    command = [sys.executable, str(CRAWLER_PATH)]
    # A complete rebuild preserves all current public categories; category jobs put the requested
    # Sinya category first so its fresh data is collected before the remainder of the catalog.
    category_note = ""
    if job["scope"] == "category" and job.get("category_name"):
        command.extend(["--priority-category", str(job["category_name"])])
        category_note = f"（優先分類：{job['category_name']}；之後安全重建完整索引）"
    print(f"[JOB {job['id']}] starting {' '.join(command)} {category_note}", flush=True)
    try:
        result = subprocess.run(
            command,
            cwd=str(PROJECT_DIR),
            text=True,
            capture_output=True,
            env=os.environ.copy(),
            timeout=CRAWLER_JOB_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout or ""
        stderr = error.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", errors="replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", errors="replace")
        combined = "\n".join(part for part in (stdout, stderr) if part).strip()
        tail = combined[-12000:] if combined else "爬蟲逾時前未產生日誌"
        summary = f"工作超過 {CRAWLER_JOB_TIMEOUT_SECONDS // 3600} 小時總時限，已安全終止以避免阻塞後續更新。\n{category_note}\n{tail}"
        finish_job(job, False, summary)
        notify_owner("價格比對爬蟲逾時", f"工作 #{job['id']} 超過 {CRAWLER_JOB_TIMEOUT_SECONDS // 3600} 小時總時限，已標記失敗並釋放後續更新佇列。")
        return
    combined = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
    tail = combined[-12000:] if combined else "爬蟲未產生日誌"
    if result.returncode == 0:
        run_id = latest_completed_run_id()
        finish_job(job, True, f"{category_note}\n{tail}", run_id)
        if run_id:
            dispatch_price_drop_notifications(job["id"], run_id)
    else:
        finish_job(job, False, f"退出碼 {result.returncode}\n{tail}")
        notify_owner("價格比對爬蟲失敗", f"工作 #{job['id']} 失敗。\n{tail[-1800:]}")


def run_forever() -> None:
    print(f"persistent crawler worker started; polling every {POLL_SECONDS}s", flush=True)
    while True:
        try:
            job = claim_next_job()
            if job:
                execute(job)
                continue
        except Exception as error:
            print(f"[ERROR] worker loop: {error}", flush=True)
            notify_owner("價格比對爬蟲執行器異常", str(error))
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    run_forever()
