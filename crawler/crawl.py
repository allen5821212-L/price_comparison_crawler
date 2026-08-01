#!/usr/bin/env python3
"""
價格比對爬蟲 — 欣亞數位 vs 原價屋
爬取兩個網站的商品資訊，進行比對，輸出 JSON 供前端使用。
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
    if method == "POST" and data:
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
#  Sinya crawler (欣亞數位)
# ──────────────────────────────────────────────

SINYA_API = "https://www.sinya.com.tw/api/search/getdata/"

def crawl_sinya(max_pages=None):
    """Crawl Sinya via their search API. Returns list of product dicts."""
    print("=== 欣亞數位 爬蟲開始 ===")
    products = []
    page = 1
    total = None

    while True:
        url = f"{SINYA_API}?page={page}"
        print(f"  欣亞 page {page} ...", end=" ", flush=True)
        html = fetch_url(url)
        if not html:
            print("FAIL (empty response)")
            break

        try:
            data = json.loads(html)
        except json.JSONDecodeError:
            print("FAIL (invalid JSON)")
            break

        if total is None:
            total = int(data.get("result_total", 0))
            print(f"total={total}")

        results = data.get("results", [])
        if not results:
            print("no more results")
            break

        for r in results:
            price_str = r.get("new_price", "$0元")
            price = parse_price(price_str)
            old_price_str = r.get("old_price", "$0元")
            old_price = parse_price(old_price_str)

            products.append({
                "source": "sinya",
                "id": r.get("prod_id", ""),
                "name": r.get("prod_title", "").strip(),
                "subtitle": r.get("prod_subtitle", "").strip(),
                "price": price,
                "original_price": old_price if old_price != price else None,
                "url": r.get("href", ""),
                "image": f"https://www.sinya.com.tw{r.get('image', '')}" if r.get("image", "").startswith("/") else r.get("image", ""),
                "category": classify_sinya_category(r.get("prod_title", "")),
            })

        print(f"  +{len(results)} (cumulative {len(products)})")

        if len(products) >= total or len(results) == 0:
            break
        if max_pages and page >= max_pages:
            print(f"  (stopped at max_pages={max_pages})")
            break

        page += 1
        time.sleep(0.5)  # polite delay

    print(f"=== 欣亞數位 完成: {len(products)} 件 ===\n")
    return products


# Keyword-based category classification for Sinya products
SINYA_CATEGORY_KEYWORDS = [
    (r"(CPU|處理器|Intel\s+Core|Intel\s+i[3579]|AMD\s+Ryzen|R[3579]\s+\d{4}|Core\s+Ultra)", "處理器 CPU"),
    (r"(主機板|MB|B[5-8]\d\d|H[5-8]\d\d|Z\d{3}|X\d{3}|A\d{3}|PRO\s+[A-Z]|PRIME|MAG|PRO-VC|TUF\s+GAMING)", "主機板 MB"),
    (r"(DDR[345]|RAM|記憶體|DIMM|SO-DIMM|UDIMM)", "記憶體 RAM"),
    (r"(RTX|GTX|顯示卡|VGA|繪圖卡|GPU)", "顯示卡 VGA"),
    (r"(SSD|M\.2|NVMe|固態硬碟|SATA\s+SSD)", "固態硬碟 M.2｜SSD"),
    (r"(HDD|硬碟|傳統硬碟|內接硬碟)", "傳統內接硬碟 HDD"),
    (r"(螢幕|顯示器|Monitor|LCD|LED\s+Monitor|4K\s+Monitor|電競螢幕)", "螢幕｜投影機｜壁掛"),
    (r"(CASE|機殼|塔|Mid\s+Tower|ATX\s+Case|ITX\s+Case)", "CASE 機殼(+電源)"),
    (r"(電源|POWER|PSU|瓦|W\s+電源|Gold|Platinum|Bronze)", "電源供應器"),
    (r"(風扇|Fan|散熱|Cooler|水冷|Air\s+Cooler|AIO)", "散熱器｜散熱墊｜散熱膏"),
    (r"(鍵盤|Keyboard|機械鍵盤|Keychron|Cherry)", "鍵盤+鼠｜搖桿｜桌+椅"),
    (r"(滑鼠|Mouse|電競鼠|G\d+|Viper|DeathAdder)", "滑鼠｜鼠墊｜數位板"),
    (r"(喇叭|Speaker|耳機|Headset|Headphone|音效)", "喇叭｜耳機｜麥克風"),
    (r"(隨身碟|USB\s+Flash|隨身硬碟|記憶卡|SD\s+Card|MicroSD)", "隨身碟｜隨身硬碟｜記憶卡"),
    (r"(NAS|網路|Router|分享器|網卡|Switch|Hub)", "IP分享器｜網卡｜網通設備"),
    (r"(筆電|Notebook|Laptop|平板|Tablet)", "筆電｜平板｜穿戴配件"),
    (r"(印表機|Printer|掃描|Scanner|UPS)", "UPS不斷電｜印表機｜掃描"),
    (r"(線|Cable|KVM|轉頭|轉接)", "網路、傳輸線、轉頭｜KVM"),
    (r"(Windows|Office|軟體|Software|防毒)", "OS+應用軟體｜禮物卡"),
]

def classify_sinya_category(name):
    """Classify a Sinya product into a category based on its name."""
    for pattern, category in SINYA_CATEGORY_KEYWORDS:
        if re.search(pattern, name, re.IGNORECASE):
            return category
    return "其他"


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
        print(f"  原價屋 {cat_name} (IGrp={igrp}) ...", end=" ")
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
    # Remove common prefixes/suffixes
    name = re.sub(r"【[^】]*】", "", name)
    name = re.sub(r"\[[^\]]*\]", "", name)
    # Remove promotional prefixes
    name = re.sub(r"^(活動|精選|新品|獨家|限定|蝦皮|即刻|歡迎|【|★|➤|➥|✦|▶|▼|◆|◇|☆|★)", "", name)
    # Remove color/variant info at end
    name = re.sub(r"(白|黑|紅|藍|綠|灰|紫|粉|銀|金|煙燻灰|透明|紫色|白色版|黑色版)$", "", name)
    # Remove extra spaces
    name = re.sub(r"\s+", " ", name).strip()
    return name.upper().replace(" ", "")


def extract_model_numbers(name):
    """Extract key model numbers from a product name."""
    # Common patterns: Intel i5-12400F, AMD R5 7500F, RTX 4060, etc.
    patterns = [
        r'[A-Za-z]+\d+[-\s]?\d+[A-Z]*',  # e.g., i5-12400F, R57500F
        r'RTX\s*\d{3,4}[A-Z]*',  # e.g., RTX4060Ti
        r'GTX\s*\d{3,4}[A-Z]*',  # e.g., GTX1650
        r'\d{4}[A-Z]{2,}\d*',  # e.g., 12400F
        r'[A-Z]{2,}[-\s]?\d{3,4}',  # e.g., ROG-STRIX
    ]
    models = []
    for p in patterns:
        matches = re.findall(p, name, re.IGNORECASE)
        for m in matches:
            models.append(m.upper().replace(" ", "").replace("-", ""))
    return models


def name_similarity(name1, name2):
    """Calculate similarity between two product names based on model numbers."""
    models1 = set(extract_model_numbers(name1))
    models2 = set(extract_model_numbers(name2))
    
    if not models1 or not models2:
        return 0
    
    # Check for exact model match
    common = models1 & models2
    if common:
        return len(common) / max(len(models1), len(models2))
    
    # Check for partial model match
    for m1 in models1:
        for m2 in models2:
            if m1 in m2 or m2 in m1:
                return 0.5
    
    return 0


def extract_brand(name):
    """Extract brand name from product name."""
    brands = [
        "Intel", "AMD", "ASUS", "華碩", "ROG", "MSI", "微星", "Gigabyte", "技嘉",
        "ASRock", "華擎", "Corsair", "海盜船", "Kingston", "金士頓", "Crucial",
        "美光", "Samsung", "三星", "WD", "威寶", "Seagate", "希捷", "Toshiba",
        "東芝", "NVIDIA", " Cooler", "酷碼", "CoolerMaster", "Logitech", "羅技",
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
                    # Verify brand match
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

    # Try partial model matching for unmatched products (limited scope)
    # Build a reverse index: for each CoolPC product, store its model numbers
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

def main(max_sinya_pages=None, max_coolpc_cats=None):
    print(f"爬蟲啟動 — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    sinya_products = crawl_sinya(max_pages=max_sinya_pages)
    coolpc_products = crawl_coolpc(max_cats=max_coolpc_cats)

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

    # Save all data (compact format to reduce file size)
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
    parser.add_argument("--sinya-pages", type=int, default=None, help="Max Sinya pages (for testing)")
    parser.add_argument("--coolpc-cats", type=int, default=None, help="Max CoolPC categories (for testing)")
    args = parser.parse_args()
    main(max_sinya_pages=args.sinya_pages, max_coolpc_cats=args.coolpc_cats)
