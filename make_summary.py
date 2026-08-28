#!/usr/bin/env python3
"""從 comparison.json 產生小體積摘要，供 LINE 推播與查詢使用。"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
SRC = BASE / "client" / "public" / "data" / "comparison.json"
OUT = BASE / "client" / "public" / "data" / "summary.json"

TOP_N = 15          # 價差最大列幾筆
MAX_PCT = 40        # 價差超過此 % 視為疑似配對錯誤，另外歸類
PLATFORMS = ["coolpc", "pchome", "momo"]
LABELS = {"coolpc": "原價屋", "pchome": "PChome", "momo": "momo"}


def main():
    d = json.loads(SRC.read_text(encoding="utf-8"))
    stats = d["stats"]
    matched = d["matched"]

    # 我方較貴的品項（欣亞不是最低價）
    worse = []
    for m in matched:
        sp = m.get("sinya_price") or 0
        if sp <= 0:
            continue
        best_p, best_k = None, None
        for k in PLATFORMS:
            p = m.get(f"{k}_price") or 0
            if p > 0 and (best_p is None or p < best_p):
                best_p, best_k = p, k
        if best_p is None or best_p >= sp:
            continue
        worse.append({
            "name": m.get("sinya_name") or m.get("name", ""),
            "cat": m.get("category", ""),
            "sinya": sp,
            "rival": LABELS[best_k],
            "rival_price": best_p,
            "diff": sp - best_p,
            "pct": round((sp - best_p) / sp * 100, 1),
            "url": m.get("sinya_url", ""),
        })
    suspect = [w for w in worse if w["pct"] >= MAX_PCT]
    worse = [w for w in worse if w["pct"] < MAX_PCT]
    worse.sort(key=lambda x: -x["diff"])
    suspect.sort(key=lambda x: -x["pct"])

    # 上架率：以配對成功的欣亞品項為分母
    total = stats.get("matched_total") or len(matched)
    listing = {}
    for k in PLATFORMS:
        n = sum(1 for m in matched if (m.get(f"{k}_price") or 0) > 0)
        listing[k] = {"label": LABELS[k], "listed": n,
                      "rate": round(n / total * 100, 1) if total else 0}

    summary = {
        "update_time": stats.get("update_time"),
        "totals": {
            "sinya": stats.get("sinya_total"),
            "coolpc": stats.get("coolpc_total"),
            "pchome": stats.get("pchome_total"),
            "momo": stats.get("momo_total"),
            "matched": total,
        },
        "cheapest": {
            "sinya": stats.get("sinya_cheaper"),
            "coolpc": stats.get("coolpc_cheaper"),
            "pchome": stats.get("pchome_cheaper"),
            "momo": stats.get("momo_cheaper"),
            "same": stats.get("same_price"),
        },
        "avg_price_diff": round(stats.get("avg_price_diff") or 0),
        "worse_count": len(worse),
        "worse_top": worse[:TOP_N],
        "suspect_count": len(suspect),
        "suspect_top": suspect[:10],
        "listing": listing,
    }

    OUT.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"寫入 {OUT}（{OUT.stat().st_size / 1024:.1f} KB）")
    print(f"我方較貴 {len(worse)} 項，最大價差 ${worse[0]['diff'] if worse else 0}")


if __name__ == "__main__":
    main()
