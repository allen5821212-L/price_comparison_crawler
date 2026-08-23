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
from multiprocessing import Pipe, Process

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

PCHOME_SEARCH_API = "https://ecshweb.pchome.com.tw/search/v3.3/all/results"
PCHOME_PROD_URL = "https://24h.pchome.com.tw/prod/"
PCHOME_IMG_BASE = "https://cs-d.ecshopcdn.com.tw"
PCHOME_PAGE_HARD_TIMEOUT_SECONDS = 35

# 3C 零件搜尋關鍵字 — 使用更精確的品牌+品類關鍵字提升商品覆蓋率
PCHOME_KEYWORDS = [
    # CPU
    "Intel CPU 處理器",
    "AMD Ryzen CPU",
    # 主機板
    "ASUS 主機板",
    "MSI 主機板",
    "GIGABYTE 主機板",
    "ASRock 主機板",
    # 記憶體
    "DDR5 記憶體",
    "DDR4 記憶體",
    # 顯示卡
    "RTX 顯示卡",
    "RX 顯示卡",
    "ASUS 顯示卡",
    "MSI 顯示卡",
    "GIGABYTE 顯示卡",
    # SSD
    "M.2 SSD 固態硬碟",
    "SATA SSD 固態硬碟",
    # HDD
    "HDD 硬碟 3.5",
    "HDD 硬碟 2.5",
    # 電源供應器
    "電源供應器 80PLUS",
    "POWER 供應器 模組化",
    # 機殼
    "電腦機殼 ATX",
    "電腦機殼 M-ATX",
    "電腦機殼 ITX",
    # 散熱
    "CPU 散熱器 塔式",
    "水冷散熱器 240",
    "水冷散熱器 360",
    "機殼風扇 ARGB",
    # 螢幕
    "電競螢幕 144Hz",
    "螢幕 4K 顯示器",
    "曲面螢幕",
    # 鍵盤
    "機械鍵盤",
    "電競鍵盤",
    # 滑鼠
    "電競滑鼠",
    "無線滑鼠",
    # 耳機
    "電競耳機",
    "藍牙耳機",
    # 喇叭
    "藍牙喇叭",
    "電腦喇叭",
    # 隨身碟/記憶卡
    "SSD 隨身硬碟",
    "microSD 記憶卡",
    # 網路
    "NAS 網路儲存",
    "WiFi 路由器",
    "網路交換器",
    # 線材
    "HDMI 線",
    "DP 線 DisplayPort",
    "USB Type-C 線",
    # 光碟機
    "外接光碟機",
    "DVD 燒錄器",
    # 視訊
    "視訊攝影機 webcam",
    # 筆電
    "ASUS 筆電 電競",
    "MSI 筆電 電競",
    "Lenovo 筆電",
    "Acer 筆電",
    "HP 筆電",
    # 桌機
    "套裝電腦 桌機",
    # 電競椅
    "電競椅 電腦椅",
    # 軟體
    "Windows 作業系統",
    # 散熱膏
    "散熱膏",
    # 機殼配件
    "顯卡支架 支撐架",
    # UPS
    "UPS 不斷電系統",
    # 延長線
    "延長線 防雷擊",
]


def _fetch_pchome_page_worker(url, headers, connection):
    """Fetch and decode one response outside the parent process's failure domain."""
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=PCHOME_PAGE_HARD_TIMEOUT_SECONDS - 5) as resp:
            raw = resp.read()
        connection.send(("ok", json.loads(raw.decode("utf-8", errors="replace"))))
    except Exception as error:
        connection.send(("error", str(error)))
    finally:
        connection.close()


def fetch_url(url, retries=3):
    """Fetch one PCHOME page with a killable wall-clock guard for stalled streams."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "zh-TW,zh;q=0.9",
    }
    for attempt in range(retries):
        receive_connection, send_connection = Pipe(duplex=False)
        worker = Process(
            target=_fetch_pchome_page_worker,
            args=(url, headers, send_connection),
            daemon=True,
        )
        worker.start()
        send_connection.close()
        try:
            if receive_connection.poll(PCHOME_PAGE_HARD_TIMEOUT_SECONDS):
                status, payload = receive_connection.recv()
                worker.join(timeout=3)
                if status == "ok":
                    return payload
                error = payload
            else:
                worker.terminate()
                worker.join(timeout=3)
                error = f"頁面超過 {PCHOME_PAGE_HARD_TIMEOUT_SECONDS} 秒未完成"
        finally:
            receive_connection.close()
            if worker.is_alive():
                worker.terminate()
                worker.join(timeout=3)

        if error:
            if attempt < retries - 1:
                wait = (attempt + 1) * 3
                print(f"  [PCHOME RETRY {attempt+1}/{retries}] {error}, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"  [PCHOME ERROR] {error}; 跳過此頁避免阻塞完整更新")
                return None

    return None


def crawl_pchome(max_keywords=None, max_pages_per_keyword=10):
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

            time.sleep(0.4)  # polite delay

            total_pages = data.get("totalPage", 1)
            if page >= total_pages:
                break

        print(f"{kw_count} 件 (累計 {len(products)})")
        time.sleep(0.6)

    print(f"=== PCHOME 24h 完成: {len(products)} 件 ===\n")
    return products


if __name__ == "__main__":
    prods = crawl_pchome(max_keywords=2, max_pages_per_keyword=2)
    for p in prods[:5]:
        print(f"  {p['name'][:50]} | ${p['price']} | {p['url']}")
