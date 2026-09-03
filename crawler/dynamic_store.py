"""Transactional persistence for the dynamic four-platform comparison site."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import date, timedelta
from typing import Any, Iterable
from urllib.parse import parse_qs, unquote, urlparse

import pymysql
from price_guard import assess_price, state_fingerprint


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
    """Return the same stable Sinya key used by the React comparison page.

    The page falls back to ``sinyaId(sinya_name)`` when a payload does not
    contain ``source_key``.  Favorites must use that exact key so the crawler
    can find them again when it records a new lowest price.  JavaScript hashes
    UTF-16 code units with signed 32-bit arithmetic, so reproduce that behavior
    instead of using a URL hash that the page cannot derive.
    """
    name = str(match.get("sinya_name") or "")
    hash_value = 0
    utf16 = name.encode("utf-16-le", "surrogatepass")
    for offset in range(0, len(utf16), 2):
        code_unit = int.from_bytes(utf16[offset:offset + 2], "little")
        hash_value = ((hash_value << 5) - hash_value + code_unit) & 0xFFFFFFFF
        if hash_value >= 0x80000000:
            hash_value -= 0x100000000
    return f"sinya_{abs(hash_value)}"


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
            int(product.get("persist_price", product.get("price", 0)) or 0),
            product.get("original_price"),
            bool(product.get("is_suspect_price")),
            _text(product.get("state_fingerprint"), 64),
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


def _match_state_fingerprint(match: dict[str, Any]) -> str:
    return state_fingerprint({
        "observed_price": "|".join(str(int(match.get(key) or 0)) for key in ("sinya_price", "coolpc_price", "pchome_price", "momo_price")),
        "stock_status": "|".join(str(match.get(key) or "") for key in ("sinya_name", "coolpc_name", "pchome_name", "momo_name")),
        "promo_info": match.get("cheaper", ""),
    })


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
            _match_state_fingerprint(match),
            False,
        )


def prepare_products_for_matching(products_by_platform: dict[str, list[dict[str, Any]]]) -> tuple[dict[str, list[dict[str, Any]]], bool]:
    """Annotate raw observations, preserve the last reliable price, and detect no-op crawls."""
    connection = _database_connection()
    try:
        existing: dict[tuple[str, str], tuple[int, str | None]] = {}
        with connection.cursor() as cursor:
            for platform, products in products_by_platform.items():
                external_ids = [str(product.get("id") or "") for product in products if product.get("id")]
                for offset in range(0, len(external_ids), 500):
                    chunk = external_ids[offset:offset + 500]
                    if not chunk:
                        continue
                    placeholders = ",".join(["%s"] * len(chunk))
                    cursor.execute(
                        f"SELECT external_id, price, state_fingerprint FROM comparison_products WHERE platform=%s AND external_id IN ({placeholders})",
                        (platform, *chunk),
                    )
                    for external_id, price, fingerprint in cursor.fetchall():
                        existing[(platform, str(external_id))] = (int(price or 0), fingerprint)

        prepared: dict[str, list[dict[str, Any]]] = {}
        unchanged = True
        expected_count = 0
        for platform, products in products_by_platform.items():
            current: list[dict[str, Any]] = []
            for product in products:
                external_id = str(product.get("id") or "")
                if not external_id or not product.get("name"):
                    continue
                expected_count += 1
                previous_price, previous_fingerprint = existing.get((platform, external_id), (0, None))
                observation = dict(product)
                observed_price = int(observation.get("price") or 0)
                assessment = assess_price(observed_price, previous_price)
                observation["observed_price"] = observed_price
                observation["is_suspect_price"] = assessment.is_suspect
                observation["suspect_price_reason"] = assessment.reason
                observation["state_fingerprint"] = state_fingerprint(observation)
                observation["persist_price"] = previous_price if assessment.is_suspect and previous_price > 0 else (0 if assessment.is_suspect else observed_price)
                # Never feed suspect price to matching or minimum-price calculations.
                if assessment.is_suspect:
                    observation["price"] = 0
                if not previous_fingerprint or previous_fingerprint != observation["state_fingerprint"]:
                    unchanged = False
                current.append(observation)
            prepared[platform] = current
        if len(existing) != expected_count:
            unchanged = False
        return prepared, unchanged
    finally:
        connection.close()


def touch_catalog_checks(products_by_platform: dict[str, list[dict[str, Any]]]) -> None:
    """Record a successful unchanged crawl without generating a run, match, or history write."""
    connection = _database_connection()
    try:
        with connection.cursor() as cursor:
            for platform, products in products_by_platform.items():
                ids = [str(product.get("id") or "") for product in products if product.get("id")]
                for offset in range(0, len(ids), 500):
                    chunk = ids[offset:offset + 500]
                    if chunk:
                        placeholders = ",".join(["%s"] * len(chunk))
                        cursor.execute(
                            f"UPDATE comparison_products SET last_checked_at=NOW() WHERE platform=%s AND external_id IN ({placeholders})",
                            (platform, *chunk),
                        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _record_price_notifications(cursor: Any, matches: Iterable[dict[str, Any]], run_id: int) -> None:
    """Update favorite baselines and create one notification when a tracked lowest price improves."""
    latest_prices: dict[str, int] = {}
    for match in matches:
        prices = [int(match.get(key) or 0) for key in ("sinya_price", "coolpc_price", "pchome_price", "momo_price")]
        available = [price for price in prices if price > 0]
        if available:
            latest_prices[_source_key(match)] = min(available)
    if not latest_prices:
        return

    placeholders = ",".join(["%s"] * len(latest_prices))
    cursor.execute(
        f"""SELECT id, source_key, sinya_name, target_price, last_known_price
            FROM product_favorites
            WHERE active=1 AND source_key IN ({placeholders})""",
        tuple(latest_prices.keys()),
    )
    for favorite_id, source_key, sinya_name, target_price, previous_price in cursor.fetchall():
        current_price = latest_prices.get(source_key)
        if not current_price:
            continue
        prior = int(previous_price) if previous_price is not None else None
        target = int(target_price) if target_price is not None else None
        notification_type = None
        title = ""
        message = ""
        if target is not None and current_price <= target and (prior is None or prior > target):
            notification_type = "target_reached"
            title = "收藏商品已達目標價"
            message = f"{sinya_name} 的最低價目前為 NT${current_price:,}，已達您設定的 NT${target:,}。"
        elif prior is not None and current_price < prior:
            notification_type = "price_drop"
            title = "收藏商品降價"
            message = f"{sinya_name} 的最低價由 NT${prior:,} 降至 NT${current_price:,}。"
        if notification_type:
            cursor.execute(
                """INSERT INTO price_notifications
                   (favorite_id, comparison_run_id, type, previous_price, current_price, title, message)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (favorite_id, run_id, notification_type, prior, current_price, title, message),
            )
        cursor.execute(
            "UPDATE product_favorites SET last_known_price=%s WHERE id=%s",
            (current_price, favorite_id),
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
                  (platform, external_id, name, subtitle, price, original_price, is_suspect_price, state_fingerprint, url, image, category, last_seen_run_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  name=VALUES(name), subtitle=VALUES(subtitle), price=VALUES(price),
                  original_price=VALUES(original_price), url=VALUES(url), image=VALUES(image),
                  category=VALUES(category), is_suspect_price=VALUES(is_suspect_price),
                  state_fingerprint=VALUES(state_fingerprint), last_seen_run_id=VALUES(last_seen_run_id),
                  last_checked_at=NOW()
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
            cursor.execute("SELECT source_key, state_fingerprint FROM comparison_price_history WHERE snapshot_date=%s", (snapshot_date,))
            existing_history = {str(source_key): fingerprint for source_key, fingerprint in cursor.fetchall()}
            history_rows = [row for row in _history_rows(matches, snapshot_date) if existing_history.get(str(row[1])) != row[11]]
            if history_rows:
                cursor.executemany(
                    """
                    INSERT INTO comparison_price_history
                      (snapshot_date, source_key, sinya_name, coolpc_name, pchome_name, momo_name,
                       sinya_price, coolpc_price, pchome_price, momo_price, price_diff, state_fingerprint, is_suspect_price)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                      sinya_name=VALUES(sinya_name), coolpc_name=VALUES(coolpc_name), pchome_name=VALUES(pchome_name), momo_name=VALUES(momo_name),
                      sinya_price=VALUES(sinya_price), coolpc_price=VALUES(coolpc_price), pchome_price=VALUES(pchome_price), momo_price=VALUES(momo_price),
                      price_diff=VALUES(price_diff), state_fingerprint=VALUES(state_fingerprint), is_suspect_price=VALUES(is_suspect_price)
                    """,
                    history_rows,
                )
            _record_price_notifications(cursor, matches, run_id)
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
