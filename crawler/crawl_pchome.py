"""
PCHOME 24h 爬蟲模組 — 透過搜尋 API 爬取 3C 零件商品
API: https://ecshweb.pchome.com.tw/search/v3.3/all/results?q={keyword}&page={page}&sort=sale/dc
"""

import json
import re
import time
import urllib.request
import urllib.parse
from datetime import datetime

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

PCHOME_SEARCH_API = "https://ecshweb.pchome.com.tw/search/v3.3/all/results"
PCHOME_PROD_URL = "https://24h.pchome.com.tw/prod/"
PCHOME_IMG_BASE = "https://cs-d.ecshopcdn.com.tw"

# 3C 零件搜尋關鍵字（以欣亞 DIY 分類為基準）
PCHOME_KEYWORDS = [
    "CPU 處理器",
    "主機板",
    "記憶體 RAM",
    "顯示卡 VGA",
    "SSD 固態硬碟",
    "HDD 硬碟",
    "電源供應器",
    "電腦機殼",
    "機殼風扇",
    "CPU 散熱器",
    "水冷散熱器",
    "螢幕 顯示器",
    "鍵盤",
    "滑鼠",
    "耳機",
    "喇叭",
    "隨身碟 記憶卡",
    "網路設備 NAS",
    "網路線 轉接頭",
    "光碟機",
    "視訊攝影機",
    "筆電",
    "桌機 套裝電腦",
    "電競椅",
    "作業系統 軟體",
]


def fetch_url(url, retries=3):
    """Fetch URL and return JSON data."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "zh-TW,zh;q=0.9",
    }
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
                return json.loads(raw.decode("utf-8", errors="replace"))
        except Exception as e:
            if attempt < retries - 1:
                wait = (attempt + 1) * 3
                print(f"  [PCHOME RETRY {attempt+1}/{retries}] {e}, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"  [PCHOME ERROR] {e}")
                return None


def crawl_pchome(max_keywords=None, max_pages_per_keyword=5):
    """
    Crawl PCHOME 24h by search keywords.
    Returns list of product dicts with standardized fields.
    """
    print("=== PCHOME 24h 爬蟲開始 ===")
    products = []
    seen_ids = set()

    keywords = PCHOME_KEYWORDS
    if max_keywords:
        keywords = keywords[:max_keywords]

    for kw in keywords:
        print(f"  PCHOME 搜尋 [{kw}] ...", end=" ", flush=True)
        kw_count = 0

        for page in range(1, max_pages_per_keyword + 1):
            url = f"{PCHOME_SEARCH_API}?q={urllib.parse.quote(kw)}&page={page}&sort=sale/dc"
            data = fetch_url(url)
            if not data or not data.get("prods"):
                break

            for p in data["prods"]:
                prod_id = p.get("Id", "")
                if not prod_id or prod_id in seen_ids:
                    continue

                name = (p.get("name") or "").strip()
                price = p.get("price", 0)
                origin_price = p.get("originPrice", 0)
                if not name or price == 0:
                    continue

                pic = p.get("picB") or p.get("picS") or ""
                if pic and pic.startswith("/"):
                    pic = f"{PCHOME_IMG_BASE}{pic}"

                products.append({
                    "source": "pchome",
                    "id": prod_id,
                    "name": name,
                    "subtitle": (p.get("describe") or "").strip(),
                    "price": int(price) if price else 0,
                    "original_price": int(origin_price) if origin_price else None,
                    "url": f"{PCHOME_PROD_URL}{prod_id}",
                    "image": pic,
                    "category": kw,
                })
                seen_ids.add(prod_id)
                kw_count += 1

            time.sleep(0.5)  # polite delay

            total_pages = data.get("totalPage", 1)
            if page >= total_pages:
                break

        print(f"{kw_count} 件 (累計 {len(products)})")
        time.sleep(0.8)

    print(f"=== PCHOME 24h 完成: {len(products)} 件 ===\n")
    return products


if __name__ == "__main__":
    prods = crawl_pchome(max_keywords=2, max_pages_per_keyword=2)
    for p in prods[:5]:
        print(f"  {p['name'][:50]} | ${p['price']} | {p['url']}")
