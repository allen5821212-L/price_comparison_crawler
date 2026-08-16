#!/usr/bin/env python3
"""One-time backfill from the legacy static comparison files into dynamic storage."""

import json
from pathlib import Path

from dynamic_store import import_legacy_price_history, persist_crawl_result


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "client" / "public" / "data"


def load_json(path: Path, fallback):
    if not path.exists():
        return fallback
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def main():
    comparison = load_json(DATA_DIR / "comparison.json", {})
    if not comparison.get("matched"):
        raise RuntimeError("comparison.json has no matched products to migrate")

    categories = [{"name": name} for name in comparison.get("sinya_categories", [])]
    run_id = persist_crawl_result(
        stats=comparison.get("stats", {}),
        categories=categories,
        sinya_products=comparison.get("sinya_products", []),
        coolpc_products=comparison.get("coolpc_products", []),
        pchome_products=comparison.get("pchome_products", []),
        momo_products=comparison.get("momo_products", []),
        matches=comparison.get("matched", []),
    )
    history_rows = import_legacy_price_history(load_json(DATA_DIR / "price_history.json", []))
    print(f"已遷移動態比價批次 {run_id}；價格歷史寫入 {history_rows} 筆")


if __name__ == "__main__":
    main()
