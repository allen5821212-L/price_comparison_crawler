#!/usr/bin/env python3
"""
價格比對爬蟲 — 欣亞數位 vs 原價屋
以欣亞 DIY 官方分類為基準，逐分類爬取商品，再與原價屋比對。
"""

import json
import re
import time
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "client" / "public" / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# ──────────────────────────────────────────────
#  HTTP utility
# ──────────────────────────────────────────────

def fetch_url(url, method="GET", data=None, encoding="utf-8", retries=3):
    """Fetch a URL and return decoded content. Retries on failure."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/json,*/*",
        "Accept-Language": "zh-TW,zh;q=0.9",
    }
    if method == "POST" and data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        headers["X-Requested-With"] = "XMLHttpRequest"
        data = urllib.parse.urlencode(data).encode("utf-8")

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=45) as resp:
                raw = resp.read()
                if encoding == "big5":
                    return raw.decode("big5", errors="replace")
                return raw.decode("utf-8", errors="replace")
        except Exception as e:
            if attempt < retries - 1:
                wait = (attempt + 1) * 5
                print(f"  [RETRY {attempt+1}/{retries}] {url} → {e}, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"  [ERROR] fetch_url failed after {retries} retries: {url} → {e}")
                return ""
    return ""


# ──────────────────────────────────────────────
#  Sinya crawler (欣亞數位) — 使用官方 DIY 分類 API
# ──────────────────────────────────────────────

SINYA_DIY_CART_API = "https://www.sinya.com.tw/diy/diyCartList"
SINYA_SHOW_SEARCH_API = "https://www.sinya.com.tw/diy/show_search"


def fetch_sinya_categories():
    """從欣亞 DIY 估價系統取得官方全部分類清單。"""
    print("=== 欣亞數位 分類清單取得 ===")
    html = fetch_url(SINYA_DIY_CART_API, method="POST", data={})
    if not html:
        print("  [ERROR] 無法取得分類清單")
        return []

    try:
        data = json.loads(html)
    except json.JSONDecodeError:
        print("  [ERROR] 分類清單 JSON 解析失敗")
        return []

    categories = []
    for item in data.get("subTitles", []):
        cat_id = item.get("id", "")
        cat_name = item.get("name", "")
        cat_all = item.get("all", 0)
        if cat_id and cat_name:
            categories.append({
                "id": cat_id,
                "name": cat_name,
                "product_count": int(cat_all) if cat_all else 0,
            })

    print(f"  取得 {len(categories)} 個分類:")
    for cat in categories:
        print(f"    id={cat['id']:>3}  {cat['name']:<30}  ({cat['product_count']} 件)")
    print()
    return categories


def crawl_sinya_by_category(categories=None, max_cats=None):
    """以欣亞官方 DIY 分類為基準，逐分類爬取商品。"""
    print("=== 欣亞數位 爬蟲開始 (DIY 分類模式) ===")

    if categories is None:
        categories = fetch_sinya_categories()

    if not categories:
        print("  [ERROR] 無分類資料，無法爬取")
        return []

    if max_cats:
        categories = categories[:max_cats]

    products = []
    seen_ids = set()

    for cat in categories:
        cat_id = cat["id"]
        cat_name = cat["name"]
        expected = cat["product_count"]
        print(f"  欣亞 [{cat_id}] {cat_name} (預期 {expected} 件) ...", end=" ", flush=True)

        # 使用 show_search API 取得該分類所有商品
        search_data = {
            "id": cat_id,
            "search[keyword]": "",
            "search[brand_id]": "",
            "search[price_id]": "",
            "search[brand_name]": "廠牌",
            "search[price_name]": "價格區間",
            "search[maxPrice]": "100000",
            "search[price1]": "0",
            "search[price2]": "0",
            "search[priceStep]": "1000",
        }

        html = fetch_url(SINYA_SHOW_SEARCH_API, method="POST", data=search_data)
        if not html:
            print("FAIL (empty)")
            continue

        try:
            data = json.loads(html)
        except json.JSONDecodeError:
            print("FAIL (invalid JSON)")
            continue

        search_prods = data.get("searchProds", [])
        count = 0

        for p in search_prods:
            prod_id = p.get("prod_id", "")
            if not prod_id or prod_id in seen_ids:
                continue

            # Skip placeholder products (price = 0 and no real name)
            sort_price = p.get("sortPrice", 0)
            prod_name = (p.get("prod_name") or "").strip()
            if sort_price == 0 and ("限量優惠" in prod_name or not prod_name):
                continue

            price = int(sort_price) if sort_price else 0
            image = p.get("image", "")
            if image and image.startswith("/"):
                image = f"https://www.sinya.com.tw{image}"

            products.append({
                "source": "sinya",
                "id": prod_id,
                "name": prod_name,
                "subtitle": "",
                "price": price,
                "original_price": None,
                "url": f"https://www.sinya.com.tw/prod/{prod_id}",
                "image": image,
                "category": cat_name,
            })
            seen_ids.add(prod_id)
            count += 1

        print(f"{count} 件 (累計 {len(products)})")
        time.sleep(0.8)  # polite delay

    print(f"=== 欣亞數位 完成: {len(products)} 件 ===\n")
    return products


def parse_price(price_str):
    """Parse price string like '$1,590元' → 1590"""
    if not price_str:
        return 0
    nums = re.findall(r"[\d,]+", price_str)
    if nums:
        return int(nums[0].replace(",", ""))
    return 0


# ──────────────────────────────────────────────
#  CoolPC crawler (原價屋)
# ──────────────────────────────────────────────

COOLPC_CATEGORIES = {
    1: "品牌小主機、AIO｜VR虛擬",
    2: "筆電｜平板｜穿戴配件",
    3: "酷！PC 套裝產線",
    4: "處理器 CPU",
    5: "主機板 MB",
    6: "記憶體 RAM",
    7: "固態硬碟 M.2｜SSD",
    8: "傳統內接硬碟 HDD",
    9: "隨身碟｜隨身硬碟｜記憶卡",
    10: "散熱器｜散熱墊｜散熱膏",
    11: "封閉式｜開放式水冷",
    12: "顯示卡 VGA",
    13: "螢幕｜投影機｜壁掛",
    14: "CASE 機殼(+電源)",
    15: "電源供應器",
    16: "機殼風扇｜機殼配件",
    17: "鍵盤+鼠｜搖桿｜桌+椅",
    18: "滑鼠｜鼠墊｜數位板",
    19: "IP分享器｜網卡｜網通設備",
    20: "網路NAS｜網路IPCAM",
    21: "音效卡｜電視卡(盒)｜影音",
    22: "喇叭｜耳機｜麥克風",
    23: "燒錄器 CD/DVD/BD",
    24: "USB週邊｜硬碟座｜讀卡機",
    25: "行車紀錄器｜USB視訊鏡頭",
    26: "UPS不斷電｜印表機｜掃描",
    27: "介面擴充卡｜專業Raid卡",
    28: "網路、傳輸線、轉頭｜KVM",
    29: "OS+應用軟體｜禮物卡",
    30: "福利品出清",
}

def crawl_coolpc(max_cats=None):
    """Crawl CoolPC eachview pages. Returns list of product dicts."""
    print("=== 原價屋 爬蟲開始 ===")
    products = []

    cats = list(COOLPC_CATEGORIES.items())
    if max_cats:
        cats = cats[:max_cats]

    for igrp, cat_name in cats:
        url = f"https://www.coolpc.com.tw/eachview.php?IGrp={igrp}"
        print(f"  原價屋 [{igrp}] {cat_name} ...", end=" ", flush=True)
        html = fetch_url(url, encoding="big5")
        if not html:
            print("FAIL")
            continue

        blocks = re.findall(r"<span[^>]*>(.*?)</span>", html, re.DOTALL)
        count = 0
        for block in blocks:
            name_match = re.search(r'<div class=t>(.*?)</div>', block)
            price_match = re.search(r'NT(\d+)\s*&', block)
            img_match = re.search(r"<img src='([^']+)'", block)

            if not name_match or not price_match:
                continue

            name = name_match.group(1).strip()
            price = int(price_match.group(1))
            img = img_match.group(1) if img_match else ""
            if img.startswith("/"):
                img = f"https://www.coolpc.com.tw{img}"

            products.append({
                "source": "coolpc",
                "id": f"coolpc_{igrp}_{count}",
                "name": name,
                "subtitle": "",
                "price": price,
                "original_price": None,
                "url": f"https://www.coolpc.com.tw/evaluate.php?IGrp={igrp}",
                "image": img,
                "category": cat_name,
            })
            count += 1

        print(f"{count} 件")
        time.sleep(1)  # polite delay between categories

    print(f"=== 原價屋 完成: {len(products)} 件 ===\n")
    return products


# ──────────────────────────────────────────────
#  Product matching
# ──────────────────────────────────────────────

def normalize_name(name):
    """Normalize product name for matching."""
    name = re.sub(r"【[^】]*】", "", name)
    name = re.sub(r"\[[^\]]*\]", "", name)
    name = re.sub(r"^(活動|精選|新品|獨家|限定|蝦皮|即刻|歡迎|【|★|➤|➥|✦|▶|▼|◆|◇|☆|★)", "", name)
    name = re.sub(r"(白|黑|紅|藍|綠|灰|紫|粉|銀|金|煙燻灰|透明|紫色|白色版|黑色版)$", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name.upper().replace(" ", "")


def extract_model_numbers(name):
    """Extract key model numbers from a product name."""
    patterns = [
        r'[A-Za-z]+\d+[-\s]?\d+[A-Z]*',
        r'RTX\s*\d{3,4}[A-Z]*',
        r'GTX\s*\d{3,4}[A-Z]*',
        r'\d{4}[A-Z]{2,}\d*',
        r'[A-Z]{2,}[-\s]?\d{3,4}',
    ]
    models = []
    for p in patterns:
        matches = re.findall(p, name, re.IGNORECASE)
        for m in matches:
            models.append(m.upper().replace(" ", "").replace("-", ""))
    return models


def extract_brand(name):
    """Extract brand name from product name."""
    brands = [
        "Intel", "AMD", "ASUS", "華碩", "ROG", "MSI", "微星", "Gigabyte", "技嘉",
        "ASRock", "華擎", "Corsair", "海盜船", "Kingston", "金士頓", "Crucial",
        "美光", "Samsung", "三星", "WD", "威寶", "Seagate", "希捷", "Toshiba",
        "東芝", "NVIDIA", "Cooler", "酷碼", "CoolerMaster", "Logitech", "羅技",
        "Razer", "SteelSeries", "HyperX", "darkFlash", "Phanteks", "追風者",
        "全漢", "FSP", "海韻", "Seasonic", "振華", "SuperFlower", "be quiet",
        "BenQ", "LG", "AOC", "Acer", "宏碲", "Dell", "戴爾", "HP", "Lenovo",
        "聯想", "Apple", "蘋果", "Sony", "索尼", "JBL", "Edifier", "漫步者",
    ]
    name_upper = name.upper()
    for brand in brands:
        if brand.upper() in name_upper:
            return brand.upper()
    return ""


def match_products(sinya_products, coolpc_products):
    """Match products between Sinya and CoolPC by model number similarity."""
    print("=== 商品比對開始 ===")
    matched = []
    sinya_matched = set()
    coolpc_matched = set()

    # Build index by model numbers
    coolpc_model_index = {}
    for i, p in enumerate(coolpc_products):
        models = extract_model_numbers(p["name"])
        for m in models:
            if len(m) >= 4:
                coolpc_model_index.setdefault(m, []).append(i)

    sinya_model_index = {}
    for i, p in enumerate(sinya_products):
        models = extract_model_numbers(p["name"])
        for m in models:
            if len(m) >= 4:
                sinya_model_index.setdefault(m, []).append(i)

    # Match by exact model number
    for model, sinya_indices in sinya_model_index.items():
        if model in coolpc_model_index:
            for si in sinya_indices:
                if si in sinya_matched:
                    continue
                for ci in coolpc_model_index[model]:
                    if ci in coolpc_matched:
                        continue
                    sp = sinya_products[si]
                    cp = coolpc_products[ci]
                    sp_brand = extract_brand(sp["name"])
                    cp_brand = extract_brand(cp["name"])
                    if sp_brand and cp_brand and sp_brand != cp_brand:
                        continue
                    price_diff = sp["price"] - cp["price"]
                    cheaper = "sinya" if sp["price"] < cp["price"] else ("coolpc" if cp["price"] < sp["price"] else "tie")
                    matched.append({
                        "name": sp["name"],
                        "sinya_name": sp["name"],
                        "coolpc_name": cp["name"],
                        "sinya_price": sp["price"],
                        "coolpc_price": cp["price"],
                        "price_diff": price_diff,
                        "cheaper": cheaper,
                        "sinya_url": sp["url"],
                        "coolpc_url": cp["url"],
                        "sinya_image": sp["image"],
                        "coolpc_image": cp["image"],
                        "category": sp["category"] or cp["category"],
                    })
                    sinya_matched.add(si)
                    coolpc_matched.add(ci)
                    break

    # Try partial model matching for unmatched products
    coolpc_by_model = {}
    for ci, cp in enumerate(coolpc_products):
        if ci in coolpc_matched:
            continue
        models = extract_model_numbers(cp["name"])
        for m in models:
            if len(m) >= 4:
                coolpc_by_model.setdefault(m, []).append(ci)

    for si, sp in enumerate(sinya_products):
        if si in sinya_matched:
            continue
        sp_models = extract_model_numbers(sp["name"])
        for m in sp_models:
            if len(m) >= 4 and m in coolpc_by_model:
                for ci in coolpc_by_model[m]:
                    if ci in coolpc_matched:
                        continue
                    cp = coolpc_products[ci]
                    sp_brand = extract_brand(sp["name"])
                    cp_brand = extract_brand(cp["name"])
                    if sp_brand and cp_brand and sp_brand != cp_brand:
                        continue
                    price_diff = sp["price"] - cp["price"]
                    cheaper = "sinya" if sp["price"] < cp["price"] else ("coolpc" if cp["price"] < sp["price"] else "tie")
                    matched.append({
                        "name": sp["name"],
                        "sinya_name": sp["name"],
                        "coolpc_name": cp["name"],
                        "sinya_price": sp["price"],
                        "coolpc_price": cp["price"],
                        "price_diff": price_diff,
                        "cheaper": cheaper,
                        "sinya_url": sp["url"],
                        "coolpc_url": cp["url"],
                        "sinya_image": sp["image"],
                        "coolpc_image": cp["image"],
                        "category": sp["category"] or cp["category"],
                    })
                    sinya_matched.add(si)
                    coolpc_matched.add(ci)
                    break

    print(f"  比對成功: {len(matched)} 組")
    print(f"  欣亞未比對: {len(sinya_products) - len(sinya_matched)} 件")
    print(f"  原價屋未比對: {len(coolpc_products) - len(coolpc_matched)} 件")
    print(f"=== 商品比對完成 ===\n")
    return matched


# ──────────────────────────────────────────────
#  Main
# ──────────────────────────────────────────────

def main(max_cats=None):
    print(f"爬蟲啟動 — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # Step 1: 取得欣亞官方分類清單
    categories = fetch_sinya_categories()

    # Step 2: 以欣亞分類為基準爬取商品
    sinya_products = crawl_sinya_by_category(categories=categories, max_cats=max_cats)

    # Step 3: 爬取原價屋商品
    coolpc_products = crawl_coolpc(max_cats=max_cats)

    # Step 4: 比對商品
    matched = match_products(sinya_products, coolpc_products)

    # Generate statistics
    stats = {
        "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "sinya_total": len(sinya_products),
        "coolpc_total": len(coolpc_products),
        "matched_total": len(matched),
        "sinya_cheaper": sum(1 for m in matched if m["cheaper"] == "sinya"),
        "coolpc_cheaper": sum(1 for m in matched if m["cheaper"] == "coolpc"),
        "same_price": sum(1 for m in matched if m["cheaper"] == "tie"),
        "avg_price_diff": sum(abs(m["price_diff"]) for m in matched) / max(len(matched), 1),
    }

    # Save all data
    all_data = {
        "stats": stats,
        "matched": matched,
        "sinya_products": sinya_products,
        "coolpc_products": coolpc_products,
    }

    output_file = OUTPUT_DIR / "comparison.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(all_data, f, ensure_ascii=False, separators=(',', ':'))

    print(f"資料已儲存至 {output_file}")
    print(f"\n統計摘要:")
    print(f"  欣亞商品數: {stats['sinya_total']}")
    print(f"  原價屋商品數: {stats['coolpc_total']}")
    print(f"  比對成功: {stats['matched_total']}")
    print(f"  欣亞較便宜: {stats['sinya_cheaper']}")
    print(f"  原價屋較便宜: {stats['coolpc_cheaper']}")
    print(f"  價格相同: {stats['same_price']}")
    print(f"  平均價差: NT${stats['avg_price_diff']:.0f}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="欣亞 vs 原價屋 價格比對爬蟲")
    parser.add_argument("--max-cats", type=int, default=None, help="Max categories (for testing)")
    args = parser.parse_args()
    main(max_cats=args.max_cats)
