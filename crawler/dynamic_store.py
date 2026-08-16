"""Transactional persistence for the dynamic four-platform comparison site."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import date, timedelta
from typing import Any, Iterable
from urllib.parse import parse_qs, unquote, urlparse

import pymysql


PLATFORMS = ("sinya", "coolpc", "pchome", "momo")


def _database_connection():
    """Open the project's MySQL/TiDB connection without logging its credential."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is unavailable; dynamic persistence cannot start")

    parsed = urlparse(database_url)
    if parsed.scheme not in {"mysql", "mysql2"}:
        raise RuntimeError("DATABASE_URL must use a mysql-compatible scheme")

    query = parse_qs(parsed.query)
    ssl = None
    if "ssl" in query or "tls" in query:
        # TiDB/MySQL managed endpoints require TLS. PyMySQL uses the host trust store
        # when an empty SSL configuration is supplied.
        ssl = {}

    return pymysql.connect(
        host=parsed.hostname,
        port=parsed.port or 3306,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        database=parsed.path.lstrip("/"),
        charset="utf8mb4",
        autocommit=False,
        ssl=ssl,
        cursorclass=pymysql.cursors.Cursor,
    )


def _text(value: Any, limit: int | None = None) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text[:limit] if limit else text


def _source_key(match: dict[str, Any]) -> str:
    # The product URL distinguishes separately listed products with identical titles.
    # Legacy history has no URL, so it falls back to the title and paired CoolPC name.
    source = str(match.get("sinya_url") or "")
    if not source:
        source = "|".join([
            str(match.get("sinya_name", "")),
            str(match.get("coolpc_name", "")),
        ])
    return hashlib.sha256(source.encode("utf-8")).hexdigest()[:64]


def _product_rows(products: Iterable[dict[str, Any]], platform: str, run_id: int):
    for product in products:
        external_id = _text(product.get("id"), 255)
        name = _text(product.get("name"), 1024)
        if not external_id or not name:
            continue
        yield (
            platform,
            external_id,
            name,
            _text(product.get("subtitle")),
            int(product.get("price") or 0),
            product.get("original_price"),
            _text(product.get("url")),
            _text(product.get("image")),
            _text(product.get("category"), 512),
            run_id,
        )


def _match_rows(matches: Iterable[dict[str, Any]], run_id: int):
    for match in matches:
        sinya_name = _text(match.get("sinya_name"), 1024)
        if not sinya_name:
            continue
        cheaper = match.get("cheaper")
        if cheaper not in {"sinya", "coolpc", "pchome", "momo", "tie"}:
            cheaper = "tie"
        spec_diff = match.get("spec_diff") or []
        yield (
            run_id,
            _source_key(match),
            sinya_name,
            _text(match.get("coolpc_name"), 1024),
            _text(match.get("pchome_name"), 1024),
            _text(match.get("momo_name"), 1024),
            _text(match.get("category"), 512),
            int(match.get("sinya_price") or 0),
            int(match.get("coolpc_price") or 0),
            int(match.get("pchome_price") or 0) or None,
            int(match.get("momo_price") or 0) or None,
            int(match.get("price_diff") or 0),
            cheaper,
            float(match.get("score") or 0),
            bool(spec_diff),
            json.dumps(match, ensure_ascii=False, separators=(",", ":")),
        )


def _history_rows(matches: Iterable[dict[str, Any]], snapshot_date: date):
    for match in matches:
        sinya_name = _text(match.get("sinya_name"), 1024)
        if not sinya_name:
            continue
        yield (
            snapshot_date,
            _source_key(match),
            sinya_name,
            _text(match.get("coolpc_name"), 1024),
            _text(match.get("pchome_name"), 1024),
            _text(match.get("momo_name"), 1024),
            int(match.get("sinya_price") or 0),
            int(match.get("coolpc_price") or 0),
            int(match.get("pchome_price") or 0) or None,
            int(match.get("momo_price") or 0) or None,
            int(match.get("price_diff") or 0),
        )


def persist_crawl_result(
    *,
    stats: dict[str, Any],
    categories: list[dict[str, Any]],
    sinya_products: list[dict[str, Any]],
    coolpc_products: list[dict[str, Any]],
    pchome_products: list[dict[str, Any]],
    momo_products: list[dict[str, Any]],
    matches: list[dict[str, Any]],
) -> int:
    """Persist a complete crawl atomically and return its completed run identifier."""
    connection = _database_connection()
    run_id: int | None = None
    try:
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO comparison_runs (status) VALUES ('running')")
            run_id = int(cursor.lastrowid)
        connection.commit()

        category_names = [str(category.get("name", "")) for category in categories if category.get("name")]
        with connection.cursor() as cursor:
            product_sql = """
                INSERT INTO comparison_products
                  (platform, external_id, name, subtitle, price, original_price, url, image, category, last_seen_run_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  name=VALUES(name), subtitle=VALUES(subtitle), price=VALUES(price),
                  original_price=VALUES(original_price), url=VALUES(url), image=VALUES(image),
                  category=VALUES(category), last_seen_run_id=VALUES(last_seen_run_id)
            """
            for platform, products in (
                ("sinya", sinya_products),
                ("coolpc", coolpc_products),
                ("pchome", pchome_products),
                ("momo", momo_products),
            ):
                rows = list(_product_rows(products, platform, run_id))
                if rows:
                    cursor.executemany(product_sql, rows)

            match_sql = """
                INSERT INTO comparison_matches
                  (run_id, source_key, sinya_name, coolpc_name, pchome_name, momo_name, category,
                   sinya_price, coolpc_price, pchome_price, momo_price, price_diff, cheaper, score,
                   has_spec_diff, payload)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            rows = list(_match_rows(matches, run_id))
            if rows:
                cursor.executemany(match_sql, rows)

            snapshot_date = date.today()
            cursor.execute("DELETE FROM comparison_price_history WHERE snapshot_date=%s", (snapshot_date,))
            history_rows = list(_history_rows(matches, snapshot_date))
            if history_rows:
                cursor.executemany(
                    """
                    INSERT INTO comparison_price_history
                      (snapshot_date, source_key, sinya_name, coolpc_name, pchome_name, momo_name,
                       sinya_price, coolpc_price, pchome_price, momo_price, price_diff)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    history_rows,
                )
            cursor.execute(
                "DELETE FROM comparison_price_history WHERE snapshot_date < %s",
                (snapshot_date - timedelta(days=90),),
            )
            cursor.execute(
                """
                UPDATE comparison_runs
                SET status='completed', sinya_total=%s, coolpc_total=%s, pchome_total=%s, momo_total=%s,
                    matched_total=%s, sinya_cheaper=%s, coolpc_cheaper=%s, pchome_cheaper=%s,
                    momo_cheaper=%s, same_price=%s, avg_price_diff=%s, sinya_categories=%s, finished_at=NOW()
                WHERE id=%s
                """,
                (
                    int(stats.get("sinya_total") or 0),
                    int(stats.get("coolpc_total") or 0),
                    int(stats.get("pchome_total") or 0),
                    int(stats.get("momo_total") or 0),
                    int(stats.get("matched_total") or 0),
                    int(stats.get("sinya_cheaper") or 0),
                    int(stats.get("coolpc_cheaper") or 0),
                    int(stats.get("pchome_cheaper") or 0),
                    int(stats.get("momo_cheaper") or 0),
                    int(stats.get("same_price") or 0),
                    float(stats.get("avg_price_diff") or 0),
                    json.dumps(category_names, ensure_ascii=False),
                    run_id,
                ),
            )
        connection.commit()
        return run_id
    except Exception as error:
        connection.rollback()
        if run_id:
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE comparison_runs SET status='failed', error_message=%s, finished_at=NOW() WHERE id=%s",
                    (_text(error, 4096), run_id),
                )
            connection.commit()
        raise
    finally:
        connection.close()


def import_legacy_price_history(history_days: list[dict[str, Any]]) -> int:
    """Backfill the existing two-platform JSON snapshots into the dynamic history table."""
    connection = _database_connection()
    imported = 0
    try:
        with connection.cursor() as cursor:
            for day in history_days:
                try:
                    snapshot_date = date.fromisoformat(str(day.get("date", "")))
                except ValueError:
                    continue
                rows = []
                for match in day.get("matched", []):
                    sinya_name = _text(match.get("sinya_name"), 1024)
                    if not sinya_name:
                        continue
                    source_key = hashlib.sha256(
                        f"{sinya_name}|{match.get('coolpc_name', '')}".encode("utf-8")
                    ).hexdigest()[:64]
                    rows.append((
                        snapshot_date,
                        source_key,
                        sinya_name,
                        _text(match.get("coolpc_name"), 1024),
                        _text(match.get("pchome_name"), 1024),
                        _text(match.get("momo_name"), 1024),
                        int(match.get("sinya_price") or 0),
                        int(match.get("coolpc_price") or 0),
                        int(match.get("pchome_price") or 0) or None,
                        int(match.get("momo_price") or 0) or None,
                        int(match.get("price_diff") or 0),
                    ))
                if rows:
                    cursor.executemany(
                        """
                        INSERT INTO comparison_price_history
                          (snapshot_date, source_key, sinya_name, coolpc_name, pchome_name, momo_name,
                           sinya_price, coolpc_price, pchome_price, momo_price, price_diff)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                          sinya_name=VALUES(sinya_name), coolpc_name=VALUES(coolpc_name),
                          pchome_name=VALUES(pchome_name), momo_name=VALUES(momo_name),
                          sinya_price=VALUES(sinya_price), coolpc_price=VALUES(coolpc_price),
                          pchome_price=VALUES(pchome_price), momo_price=VALUES(momo_price),
                          price_diff=VALUES(price_diff)
                        """,
                        rows,
                    )
                    imported += len(rows)
        connection.commit()
        return imported
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
