#!/usr/bin/env python3
"""
價格比對爬蟲 — 欣亞數位 vs 原價屋
以欣亞 DIY 官方分類為基準，逐分類爬取商品，再與原價屋比對。
"""

import json
import os
import re
import time
import urllib.request
import urllib.parse
import datetime as dt
from datetime import datetime
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "client" / "public" / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# The endpoint returns active rules only; database credentials are never exposed to the crawler.
MATCHING_RULES_URL = os.environ.get(
    "MATCHING_RULES_URL",
    "https://pricecomp-cr-mlsxyggu.manus.space/api/matching-rules",
)
MATCHING_RULE_USAGE_URL = os.environ.get(
    "MATCHING_RULE_USAGE_URL",
    "http://127.0.0.1:3000/api/matching-rules/usage",
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


def fetch_confirmed_matching_rules():
    """Load administrator-confirmed product mappings without blocking a normal crawl on failure."""
    try:
        raw = fetch_url(MATCHING_RULES_URL, retries=1)
        payload = json.loads(raw) if raw else {}
        rules = payload.get("rules", [])
        if isinstance(rules, list):
            print(f"  已載入人工確認規則: {len(rules)} 組")
            return rules
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        print(f"  [WARN] 無法解析人工確認規則: {error}")
    return []


def fetch_matching_policies():
    """Load positive mappings and learned negative signals from one crawler-safe endpoint request."""
    try:
        raw = fetch_url(MATCHING_RULES_URL, retries=1)
        payload = json.loads(raw) if raw else {}
        rules = payload.get("rules", [])
        negative_features = payload.get("negativeFeatures", [])
        brand_aliases = payload.get("brandAliases", [])
        if isinstance(rules, list) and isinstance(negative_features, list) and isinstance(brand_aliases, list):
            print(f"  已載入人工確認規則: {len(rules)} 組；高頻拒絕特徵: {len(negative_features)} 組；品牌別名: {len(brand_aliases)} 組")
            return rules, negative_features, brand_aliases
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        print(f"  [WARN] 無法解析比對回饋規則: {error}")
    return [], [], []


def report_matching_rule_usage(rule_ids):
    """Report applied rule IDs to the sandbox-local API. Failure never blocks a crawler run."""
    if not rule_ids:
        return
    try:
        payload = json.dumps({"ids": rule_ids}).encode("utf-8")
        req = urllib.request.Request(
            MATCHING_RULE_USAGE_URL,
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8", errors="replace"))
        print(f"  已更新人工規則使用統計: {result.get('updated', 0)} 組")
    except Exception as error:
        print(f"  [WARN] 無法更新人工規則使用統計: {error}")


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
            prod_name = strip_html_tags((p.get("prod_name") or "").strip())
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


def extract_canonical_model(name):
    """
    Extract canonical model tokens from a product name.
    
    CRITICAL: VRAM/capacity is ALWAYS included in GPU tokens to prevent
    matching products with same GPU model but different VRAM.
    Fallback generic tokens are heavily filtered to prevent false matches.
    """
    clean = re.sub(r"<[^>]+>", " ", name)
    clean = re.sub(r"【[^】]*】", " ", clean)
    clean = re.sub(r"\[[^\]]*\]", " ", clean)
    clean = re.sub(r"\([^)]*\)", " ", clean)
    clean = re.sub(r"~[^~]*~", " ", clean)
    clean = re.sub(r"\s+", " ", clean).upper().strip()
    # Also normalize dashes to spaces for better tokenization
    clean_norm = clean.replace("-", " ")

    models = set()

    # ── CPU models (with alias normalization) ──
    # Normalize: Ryzen5 → R5, Ryzen7 → R7, etc.
    cpu_norm = clean_norm
    cpu_norm = re.sub(r'\bRYZEN\s*(\d)\b', r'R\1', cpu_norm)
    cpu_norm = re.sub(r'\bCORE\s*ULTRA\s*(\d)\b', r'IU\1', cpu_norm)
    cpu_norm = re.sub(r'\bCORE\s*I(\d)\b', r'I\1', cpu_norm)
    
    for m in re.finditer(r'\bIU\d+\s*(\d{3,4}[A-Z]*)', cpu_norm):
        models.add("IU" + m.group(1))
    for m in re.finditer(r'\bIU(\d{3,4}[A-Z]*)', cpu_norm):
        models.add("IU" + m.group(1))
    for m in re.finditer(r'(?:CORE\s*)?\bI(\d)\s*(\d{4,5}[A-Z]*)', cpu_norm):
        models.add("I" + m.group(1) + m.group(2))
    for m in re.finditer(r'\bXEON\s*W(\d)\s*(\d{4,5}[A-Z]*)', cpu_norm):
        models.add("XEONW" + m.group(1) + m.group(2))
    for m in re.finditer(r'\bRYZEN\s*(\d)\s*(\d{4}[A-Z0-9]*)', cpu_norm):
        models.add("R" + m.group(1) + m.group(2))
    for m in re.finditer(r'\bR(\d)\s*(\d{4}[A-Z0-9]*)', cpu_norm):
        models.add("R" + m.group(1) + m.group(2))
    for m in re.finditer(r'\bATHLON\s*(\d{4}[A-Z]*)', cpu_norm):
        models.add("ATHLON" + m.group(1))

    # ── GPU models ──
    # Extract VRAM aggressively from multiple patterns — NORMALIZE to "NG" format
    vram = ""
    # Pattern 1: "8GB GDDR6" / "16GB GDDR" / "48GB GDDR7"
    for m in re.finditer(r'(\d+)\s*GB\s*GDDR', clean_norm):
        vram = m.group(1) + "G"
    # Pattern 1b: "16GB D6" / "8GB D7" (Sinya uses D6/D7 abbreviation)
    if not vram:
        for m in re.finditer(r'(\d+)\s*GB\s*D[567]\b', clean_norm):
            vram = m.group(1) + "G"
    # Pattern 2: "8G GDDR6"
    if not vram:
        for m in re.finditer(r'(\d+)G\s*GDDR', clean_norm):
            vram = m.group(1) + "G"
    # Pattern 3: "RTX3050 8G" or "RX9060XT 16G" (number + G after GPU model)
    if not vram:
        for m in re.finditer(r'(?:RTX|RX|GTX)\s*\d{3,4}[A-Z\s]*\s+(\d+)G\b', clean_norm):
            vram = m.group(1) + "G"
    # Pattern 5: "O6G" or "-O8G" in CoolPC names (OC + VRAM)
    if not vram:
        for m in re.finditer(r'(?:RTX|RX|GTX)\s*\d{3,4}[A-Z\s]*O?(\d+)G\b', clean_norm):
            vram = m.group(1) + "G"
    # Pattern 6: standalone "NG" near GPU model (e.g. "RTX5050 8G SHADOW")
    if not vram:
        for m in re.finditer(r'(?:RTX|RX|GTX)\s*(\d{3,4})[A-Z\s]*(\d+)G\b', clean_norm):
            vram = m.group(2) + "G"
    # Pattern 7: "16GB" right after GPU model (e.g. "RX9060XT Challenger 16GB OC")
    if not vram:
        for m in re.finditer(r'(?:RTX|RX|GTX)\s*\d{3,4}[A-Z\s]*\s+(\d+)GB\b', clean_norm):
            vram = m.group(1) + "G"

    # Generate GPU tokens — ALWAYS include VRAM if found
    # If VRAM found: only create token WITH VRAM (prevents cross-VRAM matching)
    # If VRAM NOT found: create bare token (for coverage, gpu_compatible will catch mismatches)
    for m in re.finditer(r'RTX\s*(\d{3,4}[A-Z\s]*)', clean_norm):
        raw = m.group(1).replace(" ", "")
        raw = re.sub(r'(\d)G$', r'\1', raw)
        raw = re.sub(r'O(\d+)G$', '', raw)
        token = "RTX" + raw
        if vram:
            token += "_" + vram
        models.add(token)
    for m in re.finditer(r'GTX\s*(\d{3,4}[A-Z\s]*)', clean_norm):
        raw = m.group(1).replace(" ", "")
        raw = re.sub(r'(\d)G$', r'\1', raw)
        token = "GTX" + raw
        if vram:
            token += "_" + vram
        models.add(token)
    for m in re.finditer(r'\bRX\s*(\d{4}[A-Z\s]*)', clean_norm):
        raw = m.group(1).replace(" ", "")
        raw = re.sub(r'(\d)G$', r'\1', raw)
        raw = re.sub(r'O(\d+)G$', '', raw)
        token = "RX" + raw
        if vram:
            token += "_" + vram
        models.add(token)
    for m in re.finditer(r'\bARC\s*A(\d{3})', clean_norm):
        token = "ARCA" + m.group(1)
        if vram:
            token += "_" + vram
        models.add(token)
    for m in re.finditer(r'RTX\s*PRO\s*(\d{4})', clean_norm):
        token = "RTXPRO" + m.group(1)
        if vram:
            token += "_" + vram
        models.add(token)

    # ── Motherboard models ──
    for m in re.finditer(r'\b([ABH])(\d{3})M?\s?([A-Z0-9]*)', clean_norm):
        chipset = m.group(1) + m.group(2)
        suffix = m.group(3) or ""
        if suffix and len(suffix) >= 2:
            models.add("MB" + chipset + suffix)
        else:
            models.add("MB" + chipset)

    # ── RAM models (speed + capacity, BOTH required) ──
    ram_cap = ""
    # Pattern: "16G DDR5" or "16G*2" (capacity before speed/multiplier)
    for m in re.finditer(r'(\d+)G\s*(?:DDR|D5|D4|\*\d|雙通|四通)', clean_norm):
        ram_cap = m.group(1) + "G"
    # Pattern: "DDR5-6000 16G" (speed first, then capacity after)
    if not ram_cap:
        for m in re.finditer(r'DDR\s*5\s*\d{4}\s*(\d+)G\b', clean_norm):
            ram_cap = m.group(1) + "G"
    if not ram_cap:
        for m in re.finditer(r'DDR\s*4\s*\d{4}\s*(\d+)G\b', clean_norm):
            ram_cap = m.group(1) + "G"
    # Pattern: "D5-6000 16G" (short form)
    if not ram_cap:
        for m in re.finditer(r'\bD5\s*\d{4}\s*(\d+)G\b', clean_norm):
            ram_cap = m.group(1) + "G"
    if not ram_cap:
        for m in re.finditer(r'\bD4\s*\d{4}\s*(\d+)G\b', clean_norm):
            ram_cap = m.group(1) + "G"
    # Pattern: "16GB DDR" or "16GB(雙通...)
    if not ram_cap:
        for m in re.finditer(r'(\d+)GB\s*DDR', clean_norm):
            ram_cap = m.group(1) + "G"
    if not ram_cap:
        for m in re.finditer(r'(\d+)GB\s*雙通', clean_norm):
            ram_cap = m.group(1) + "G"
    if not ram_cap:
        for m in re.finditer(r'單條(\d+)GB', clean_norm):
            ram_cap = m.group(1) + "G"
    # Pattern: "32GB(雙通16G*2)" → total capacity
    if not ram_cap:
        for m in re.finditer(r'(\d+)GB\s*\(雙通', clean_norm):
            ram_cap = m.group(1) + "G"
    if not ram_cap:
        for m in re.finditer(r'(\d+)GB\s*\(雙通', clean_norm):
            ram_cap = m.group(1) + "G"
    # Also try: "32G(16G*2)" → total is 32G
    if not ram_cap:
        for m in re.finditer(r'(\d+)G\s*\(\d+G\s*\*\s*\d+\)', clean_norm):
            ram_cap = m.group(1) + "G"
    ram_speed = ""
    for m in re.finditer(r'DDR?\s*5\s*(\d{4})', clean_norm):
        ram_speed = "D5_" + m.group(1)
    for m in re.finditer(r'DDR?\s*4\s*(\d{4})', clean_norm):
        ram_speed = "D4_" + m.group(1)
    for m in re.finditer(r'\bD5\s*(\d{4})', clean_norm):
        ram_speed = "D5_" + m.group(1)
    for m in re.finditer(r'\bD4\s*(\d{4})', clean_norm):
        ram_speed = "D4_" + m.group(1)
    # CRITICAL: Only generate RAM token if BOTH speed AND capacity are found
    # This prevents matching different capacity RAM at same speed
    if ram_speed and ram_cap:
        models.add("RAM_" + ram_speed + "_" + ram_cap)
    # Do NOT add speed-only token — it causes false matches across brands/capacities

    # ── SSD/HDD models ──
    storage_cap = ""
    for m in re.finditer(r'(\d+)\s*TB\b', clean_norm):
        storage_cap = m.group(1) + "TB"
    if not storage_cap:
        for m in re.finditer(r'(\d+)\s*GB\s*(?:SSD|M\.2|PCIe|GEN|/|SATA|吋)', clean_norm):
            storage_cap = m.group(1) + "GB"
    # Also handle "NG" format (CoolPC uses "240G" not "240GB")
    if not storage_cap:
        for m in re.finditer(r'(\d+)G\s*/\s*2\.5|(\d+)G\s*/\s*M', clean_norm):
            cap = m.group(1) or m.group(2)
            if cap:
                storage_cap = cap + "GB"
    # Normalize approximate capacities
    if storage_cap == "512GB":
        storage_cap = "500GB"
    if storage_cap == "960GB":
        storage_cap = "1TB"
    if storage_cap == "256GB":
        storage_cap = "250GB"
    if storage_cap == "128GB":
        storage_cap = "120GB"
    # SSD model patterns — expanded list
    for m in re.finditer(r'\b(990|970|980|9100|870|860|850|950|T700|T500|T300|MP700|MP600|MP500|NM790|NM770|NM760|T60|TI600|TIPLUS|990EVOP|990EVO|990PRO|BX500|A400|SU650|SU800|S330|S270|SA510|RE100|EXCERIA|VULCAN|SPATIUM|CYBER|FURY|NS100|NS200|CS|CR|GOLDS|S70|S50|S40|ST)\s*([A-Z]*)', clean_norm):
        token = "SSD_" + m.group(1) + m.group(2)
        if storage_cap:
            token += "_" + storage_cap
        models.add(token)
    for m in re.finditer(r'\b(ST\d{4,5}[A-Z]*)', clean_norm):
        token = "HDD_" + m.group(1)
        if storage_cap:
            token += "_" + storage_cap
        models.add(token)

    # ── Monitor models (exact model number only) ──
    for m in re.finditer(r'\b(PA|VG|XG|PG|VP|VA|MX|VX)\s*(\d{2,3}[A-Z]{1,5})', clean_norm):
        models.add("MON_" + m.group(1) + m.group(2))
    for m in re.finditer(r'\b(GW|EX|EW|GD|XL|EL|SW)\s*(\d{4}[A-Z]*)', clean_norm):
        models.add("MON_" + m.group(1) + m.group(2))
    for m in re.finditer(r'\b(Q\d{2}G\d|\d{2}G\d)\b', clean_norm):
        models.add("MON_" + m.group(0))
    for m in re.finditer(r'\b(\d{2}GP\d{3,4}|\d{2}GQ\d{3,4})', clean_norm):
        models.add("MON_" + m.group(0))
    # Acer ED240Q / Nitro ED240Q
    for m in re.finditer(r'\b(ED|VY|VU|VA|VE)\s*(\d{3}[A-Z]{0,2})', clean_norm):
        models.add("MON_" + m.group(1) + m.group(2))
    # ViewSonic VP2788 / XG248QSG
    for m in re.finditer(r'\b(VP|XG|VX)\s*(\d{4}[A-Z]*)', clean_norm):
        models.add("MON_" + m.group(1) + m.group(2))

    # ── PSU models (wattage) ──
    for m in re.finditer(r'\b(\d{3,4})\s*W\b', clean_norm):
        models.add("PSU_" + m.group(1) + "W")

    # ── Fallback: heavily filtered generic tokens ──
    # Only 7+ char tokens, exclude all known generic patterns
    GENERIC_EXCLUDE = {
        "RTX5000", "GTX5000", "DDR5000", "SSD5000", "PCIE500",
        "GEN5000", "HDMI500", "TYPE500", "ATX500", "HDR400", "HDR600",
        "HDR1000", "FREESYNC", "GSYNC", "ADAPTIVE", "HDMI20", "HDMI21",
        "DISPLAYPORT", "TYPEC", "USB30", "USB20", "PCIE40", "PCIE50",
        "GEN4", "GEN5", "M2SSD", "NVME", "SATA3", "DDR4", "DDR5",
        "GDDR6", "GDDR7", "GDDR5", "HDMI11", "DP14", "DP12",
        # Exclude ATX-related patterns that cause false SSD matches
        "850ATX", "750ATX", "650ATX", "550ATX", "450ATX",
        "ATX300", "ATX301", "ATX30", "ATX31",
        # Exclude wattage-only patterns
        "850W", "750W", "650W", "550W", "450W", "350W",
        "1000W", "1200W", "1300W", "1600W",
        # Exclude HDR variants that cause false monitor matches
        "HDR500", "HDR700", "HDR800", "HDR900",
    }
    for m in re.finditer(r'\b([A-Z]{2,}\d{3,}[A-Z0-9]*)', clean_norm):
        token = m.group(1)
        if len(token) >= 7 and token not in models and token not in GENERIC_EXCLUDE:
            models.add(token)

    return models


def extract_specs(name):
    """Extract key specs from product name for validation."""
    clean = re.sub(r"<[^>]+>", " ", name)
    clean = re.sub(r"【[^】]*】", " ", clean)
    clean = re.sub(r"\[[^\]]*\]", " ", clean)
    clean = re.sub(r"\([^)]*\)", " ", clean)
    clean = re.sub(r"\s+", " ", clean).upper().strip()
    clean_norm = clean.replace("-", " ")
    
    specs = {}
    
    # Storage capacity — normalize approximate values
    for m in re.finditer(r'(\d+)\s*TB\b', clean_norm):
        specs.setdefault('storage', set()).add(m.group(1) + 'TB')
    for m in re.finditer(r'(\d+)\s*GB\s*(?:SSD|M\.2|PCIe|GEN|/|SATA|吋)', clean_norm):
        specs.setdefault('storage', set()).add(m.group(1) + 'GB')
    # Also handle "NG" format (CoolPC uses "240G/2.5吋")
    for m in re.finditer(r'(\d+)G\s*/\s*(?:2\.5|M\.)', clean_norm):
        specs.setdefault('storage', set()).add(m.group(1) + 'GB')
    # Normalize storage values
    if 'storage' in specs:
        normalized = set()
        for v in specs['storage']:
            if v == '512GB': v = '500GB'
            elif v == '960GB': v = '1TB'
            elif v == '256GB': v = '250GB'
            elif v == '128GB': v = '120GB'
            normalized.add(v)
        specs['storage'] = normalized
    
    # RAM capacity — broader patterns
    for m in re.finditer(r'(\d+)G\s*(?:DDR|D5|D4|\*\d|雙通|四通)', clean_norm):
        specs.setdefault('ram_cap', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'DDR\s*5\s*\d{4}\s*(\d+)G\b', clean_norm):
        specs.setdefault('ram_cap', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'DDR\s*4\s*\d{4}\s*(\d+)G\b', clean_norm):
        specs.setdefault('ram_cap', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'\bD5\s*\d{4}\s*(\d+)G\b', clean_norm):
        specs.setdefault('ram_cap', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'\bD4\s*\d{4}\s*(\d+)G\b', clean_norm):
        specs.setdefault('ram_cap', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'(\d+)GB\s*(?:DDR|雙通|D5|D4)', clean_norm):
        specs.setdefault('ram_cap', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'(\d+)GB\s*\(雙通', clean_norm):
        specs.setdefault('ram_cap', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'(\d+)G\s*\(\d+G\s*\*\s*\d+\)', clean_norm):
        specs.setdefault('ram_cap', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'單條(\d+)GB', clean_norm):
        specs.setdefault('ram_cap', set()).add(m.group(1) + 'G')
    
    # VRAM / GPU memory — normalize to NG format
    for m in re.finditer(r'(\d+)\s*GB\s*(?:GDDR|D[567])', clean_norm):
        specs.setdefault('vram', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'(\d+)G\s*GDDR', clean_norm):
        specs.setdefault('vram', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'(?:RTX|RX|GTX)\s*\d{3,4}[A-Z\s]*\s+(\d+)G\b', clean_norm):
        specs.setdefault('vram', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'(?:RTX|RX|GTX)\s*\d{3,4}[A-Z\s]*O?(\d+)G\b', clean_norm):
        specs.setdefault('vram', set()).add(m.group(1) + 'G')
    for m in re.finditer(r'(?:RTX|RX|GTX)\s*\d{3,4}[A-Z\s]*\s+(\d+)GB\b', clean_norm):
        specs.setdefault('vram', set()).add(m.group(1) + 'G')
    
    # Monitor size
    for m in re.finditer(r'(\d{2})\s*(?:型|吋|"|INCH)', clean):
        specs.setdefault('monitor_size', set()).add(m.group(1))
    
    # CPU model (with alias normalization)
    cpu_norm = clean_norm
    cpu_norm = re.sub(r'\bRYZEN\s*(\d)\b', r'R\1', cpu_norm)
    cpu_norm = re.sub(r'\bCORE\s*ULTRA\s*(\d)\b', r'IU\1', cpu_norm)
    cpu_norm = re.sub(r'\bCORE\s*I(\d)\b', r'I\1', cpu_norm)
    for m in re.finditer(r'\bR(\d)\s*(\d{4}[A-Z0-9]*)', cpu_norm):
        specs.setdefault('cpu', set()).add('R' + m.group(1) + m.group(2))
    for m in re.finditer(r'\bI(\d)\s*(\d{4,5}[A-Z]*)', cpu_norm):
        specs.setdefault('cpu', set()).add('I' + m.group(1) + m.group(2))
    for m in re.finditer(r'\bIU\d+\s*(\d{3,4}[A-Z]*)', cpu_norm):
        specs.setdefault('cpu', set()).add('IU' + m.group(1))
    for m in re.finditer(r'\bIU(\d{3,4}[A-Z]*)', cpu_norm):
        specs.setdefault('cpu', set()).add('IU' + m.group(1))
    
    return specs


def specs_compatible(name1, name2):
    """Check if two product names have compatible specs (no conflicts)."""
    specs1 = extract_specs(name1)
    specs2 = extract_specs(name2)
    
    for key in ['storage', 'ram_cap', 'vram', 'monitor_size', 'cpu']:
        if key in specs1 and key in specs2:
            if specs1[key] and specs2[key] and not specs1[key] & specs2[key]:
                return False
    
    return True


def extract_gpu_model(name):
    """Extract GPU model including VRAM for validation (e.g. RTX3050_8G, RX9060XT_16G)."""
    clean = re.sub(r"<[^>]+>", " ", name)
    clean = re.sub(r"【[^】]*】", " ", clean)
    clean = re.sub(r"\[[^\]]*\]", " ", clean)
    clean = re.sub(r"\([^)]*\)", " ", clean)
    clean = re.sub(r"\s+", " ", clean).upper().strip().replace("-", " ")
    
    # Extract VRAM — handle all common patterns including D6/D7 abbreviations
    # NORMALIZE to "NG" format (not "NGB") for consistent comparison
    vram = ""
    # Pattern: "16GB GDDR6" / "8GB GDDR"
    for m in re.finditer(r'(\d+)\s*GB\s*GDDR', clean):
        vram = m.group(1) + "G"
    # Pattern: "16GB D6" / "8GB D7" (Sinya uses D6/D7 abbreviation)
    if not vram:
        for m in re.finditer(r'(\d+)\s*GB\s*D[567]\b', clean):
            vram = m.group(1) + "G"
    # Pattern: "8G GDDR6"
    if not vram:
        for m in re.finditer(r'(\d+)G\s*GDDR', clean):
            vram = m.group(1) + "G"
    # Pattern: "RTX3050 8G" or "RX9060XT 16G" (number + G after GPU model)
    if not vram:
        for m in re.finditer(r'(?:RTX|RX|GTX)\s*\d{3,4}[A-Z\s]*\s+(\d+)G\b', clean):
            vram = m.group(1) + "G"
    # Pattern: "O6G" or "O8G" in CoolPC names (OC + VRAM)
    if not vram:
        for m in re.finditer(r'(?:RTX|RX|GTX)\s*\d{3,4}[A-Z\s]*O?(\d+)G\b', clean):
            vram = m.group(1) + "G"
    # Pattern: "RX9060XT 8G" (no space before VRAM)
    if not vram:
        for m in re.finditer(r'(?:RTX|RX|GTX)\s*(\d{3,4})[A-Z\s]*(\d+)G\b', clean):
            vram = m.group(2) + "G"
    # Pattern: "16GB OC" (VRAM followed by OC, no GDDR)
    if not vram:
        for m in re.finditer(r'(?:RTX|RX|GTX)\s*\d{3,4}[A-Z\s]*\s+(\d+)GB\s', clean):
            vram = m.group(1) + "G"
    # Pattern: "8GB" right after GPU model number (e.g. "RX9060XT Challenger 8GB OC")
    if not vram:
        for m in re.finditer(r'(?:RTX|RX|GTX)\s*\d{3,4}[A-Z\s]*\s+(\d+)GB\b', clean):
            vram = m.group(1) + "G"
    
    # Extract GPU model — PRESERVE XT/TI suffix to differentiate RX9060 from RX9060XT
    gpu = ""
    for m in re.finditer(r'RTX\s*PRO\s*(\d{4})', clean):
        gpu = "RTXPRO" + m.group(1)
    if not gpu:
        for m in re.finditer(r'RTX\s*(\d{3,4}[A-Z]*)', clean):
            gpu = "RTX" + m.group(1)
    if not gpu:
        for m in re.finditer(r'GTX\s*(\d{3,4}[A-Z]*)', clean):
            gpu = "GTX" + m.group(1)
    if not gpu:
        for m in re.finditer(r'\bRX\s*(\d{4}[A-Z]*)', clean):
            gpu = "RX" + m.group(1)
    if not gpu:
        for m in re.finditer(r'\bARC\s*A(\d{3})', clean):
            gpu = "ARCA" + m.group(1)
    
    if gpu and vram:
        return gpu + "_" + vram
    return gpu


def gpu_compatible(name1, name2):
    """Check if two products have the same GPU model AND VRAM."""
    gpu1 = extract_gpu_model(name1)
    gpu2 = extract_gpu_model(name2)
    if gpu1 and gpu2:
        return gpu1 == gpu2
    return True  # If no GPU info, don't block match


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
        "威剛", "ADATA", "金士頓", "KIOXIA", "鎧俠", "INNO3D", "映眾",
        "ZOTAC", "索泰", "EVGA", "PNY", "麗臺", "LEADTEK",
        "狼蛛", "AULA", "ANACOMDA", "巨蟒", "亞奇雷", "AGI",
        "芝奇", "G.SKILL", "GSKILL", "藍寶石", "SAPPHIRE", "撼訊", "POWERCOLOR",
        "PowerColor", "創見", "Transcend", "ViewSonic", "優派", "Philips", "飛利浦",
        "ANTEC", "安鈦克", "MONTECH", "DEEPCOOL", "九州風神", "JONSBO",
        "ENERMAX", "保銳", "Thermaltake", "曜越", "TT", "Fractal", "分形工藝",
        "Lian Li", "聯力", "NZXT", "Phanteks", "追風者", "SilverStone", "銀欣",
        "BitFenix", "酷碼", "Cooler Master", "酷冷至尊", "DeepCool", "九州",
        "ARCTIC", "貓頭鷹", "Noctua", "貓頭鹰", "Scythe", "鐮刀", "be quiet!",
        "Enermax", "保銳科技", "Xigmatek", "銀欣科技", "BitFenix",
    ]
    name_upper = name.upper()
    for brand in brands:
        if brand.upper() in name_upper:
            return brand.upper()
    return ""


def is_combo_or_bundle(name):
    """Check if product is a combo/bundle (CPU+MB etc) that shouldn't be matched."""
    if not name:
        return False
    combo_keywords = ["+", "＋", "組裝價", "U版專案", "任搭", "搭購", "限量優惠組",
                      "套裝", "酷！PC", "仁者無敵", "魅力無窮", "裝機價",
                      "優惠促銷", "促銷", "現省", "限搭", "加購"]
    name_lower = name.lower()
    for kw in combo_keywords:
        if kw.lower() in name_lower:
            return True
    # Check for + between two different products
    if re.search(r'\+.*\+', name):
        return True
    # Check for two distinct brand names (indicates a combo of different products)
    brand_count = 0
    combo_brands = ["ANTEC", "MONTECH", "COOLER", "DEEPCOOL", "JONSBO", "XPG",
                    "DARKFLASH", "ENERMAX", "FSP", "SEASONIC", "ASUS", "MSI",
                    "GIGABYTE", "ASROCK", "CORSAIR", "KINGSTON", "ADATA"]
    name_upper = name.upper()
    for b in combo_brands:
        if b in name_upper:
            brand_count += 1
    if brand_count >= 2 and ("+" in name or "＋" in name):
        return True
    return False


def strip_html_tags(text):
    """Remove HTML tags from text."""
    if not text:
        return text
    import re as _re
    return _re.sub(r'<[^>]+>', '', text).strip()


def is_non_product(name, price):
    """Check if entry is a non-product (placeholder, accessory, add-on)."""
    if not name or price == 0:
        return True
    noise = ["---", "限量優惠", "加價購", "獨家", "狼蛛 AULA 獨家"]
    for n in noise:
        if n in name:
            return True
    return False


def match_products(sinya_products, coolpc_products):
    """Match products using the v2 spec-compliant matching engine."""
    import sys as _sys, os as _os
    _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
    from matcher import match_products_v2

    # Category compatibility map (same as before)
    CATEGORY_COMPAT = {
        ("CPU 中央處理器", "處理器 CPU"),
        ("MB 主機板", "主機板 MB"),
        ("RAM 記憶體", "記憶體 RAM"),
        ("VGA 顯示卡", "顯示卡 VGA"),
        ("SSD 固態硬碟", "固態硬碟 M.2｜SSD"),
        ("HDD 機械硬碟", "傳統內接硬碟 HDD"),
        ("電源供應器/不斷電系統", "電源供應器"),
        ("電源供應器/不斷電系統", "UPS不斷電｜印表機｜掃描"),
        ("電腦機殼", "CASE 機殼(+電源)"),
        ("機殼風扇/機殼配件/顯卡支架", "機殼風扇｜機殼配件"),
        ("空冷散熱器/散熱膏", "散熱器｜散熱墊｜散熱膏"),
        ("水冷散熱器", "封閉式｜開放式水冷"),
        ("液晶螢幕/支架", "螢幕｜投影機｜壁掛"),
        ("鍵盤", "鍵盤+鼠｜搖桿｜桌+椅"),
        ("滑鼠/滑鼠墊", "滑鼠｜鼠墊｜數位板"),
        ("滑鼠/滑鼠墊", "鍵盤+鼠｜搖桿｜桌+椅"),
        ("耳機", "喇叭｜耳機｜麥克風"),
        ("喇叭", "喇叭｜耳機｜麥克風"),
        ("外接硬碟/隨身碟/記憶卡", "隨身碟｜隨身硬碟｜記憶卡"),
        ("外接硬碟/隨身碟/記憶卡", "USB週邊｜硬碟座｜讀卡機"),
        ("網通設備/NAS", "IP分享器｜網卡｜網通設備"),
        ("網通設備/NAS", "網路NAS｜網路IPCAM"),
        ("各式線材/轉接頭/外接盒", "網路、傳輸線、轉頭｜KVM"),
        ("各式線材/轉接頭/外接盒", "USB週邊｜硬碟座｜讀卡機"),
        ("作業系統/文書軟體/遊戲點數", "OS+應用軟體｜禮物卡"),
        ("光碟燒錄機", "燒錄器 CD/DVD/BD"),
        ("視訊/網路攝影機", "行車紀錄器｜USB視訊鏡頭"),
        ("最夯遊戲推薦筆電", "筆電｜平板｜穿戴配件"),
        ("商務筆記型電腦", "筆電｜平板｜穿戴配件"),
        ("桌上型電腦", "品牌小主機、AIO｜VR虛擬"),
        ("桌上型電腦", "酷！PC 套裝產線"),
        ("Sinya 精選電腦主機", "品牌小主機、AIO｜VR虛擬"),
        ("Sinya 精選電腦主機", "酷！PC 套裝產線"),
        ("商用桌上型電腦", "品牌小主機、AIO｜VR虛擬"),
        ("商用桌上型電腦", "酷！PC 套裝產線"),
        ("電競桌椅/方向盤/手把", "鍵盤+鼠｜搖桿｜桌+椅"),
        ("直播設備", "喇叭｜耳機｜麥克風"),
        ("直播設備", "行車紀錄器｜USB視訊鏡頭"),
        ("商用防火牆/交換器/無線基地台", "IP分享器｜網卡｜網通設備"),
    }
    compat_set = set()
    for a, b in CATEGORY_COMPAT:
        compat_set.add((a, b))
        compat_set.add((b, a))

    matched, rejected, review, price_review = match_products_v2(
        sinya_products, coolpc_products, category_compat=compat_set
    )

    # Store rejected/review data for audit (limit to 500 per category to keep file size small)
    import json
    audit_data = {
        "rejected": rejected[:500],
        "review": review[:500],
        "price_review": price_review[:500],
    }
    audit_file = OUTPUT_DIR / "audit.json"
    with open(audit_file, "w", encoding="utf-8") as f:
        json.dump(audit_data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"  複核清單已儲存至 {audit_file}")

    return matched


# ──────────────────────────────────────────────
#  Main
# ──────────────────────────────────────────────

def main(max_cats=None, priority_category=None):
    print(f"爬蟲啟動 — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # Step 1: 取得欣亞官方分類清單
    categories = fetch_sinya_categories()
    if priority_category:
        requested = [category for category in categories if category.get("name") == priority_category]
        remaining = [category for category in categories if category.get("name") != priority_category]
        if requested:
            categories = requested + remaining
            print(f"=== 指定分類優先更新：{priority_category} ===\n")
        else:
            print(f"[WARN] 找不到指定分類：{priority_category}，將依預設順序完整更新")

    # Step 2: 以欣亞分類為基準爬取商品
    sinya_products = crawl_sinya_by_category(categories=categories, max_cats=max_cats)

    # Step 3: 爬取原價屋商品
    coolpc_products = crawl_coolpc(max_cats=max_cats)

    # Step 4: 爬取 PCHOME 24h 商品
    import sys as _sys2, os as _os2
    _sys2.path.insert(0, _os2.path.dirname(_os2.path.abspath(__file__)))
    from crawl_pchome import crawl_pchome
    from crawl_momo import crawl_momo
    pchome_products = crawl_pchome()
    momo_products = crawl_momo()

    # Normalize price safety and determine whether the raw catalog state changed before
    # doing the comparatively expensive matching and history write work.
    from dynamic_store import prepare_products_for_matching, touch_catalog_checks
    try:
        prepared_products, is_unchanged = prepare_products_for_matching({
            "sinya": sinya_products,
            "coolpc": coolpc_products,
            "pchome": pchome_products,
            "momo": momo_products,
        })
        sinya_products = prepared_products["sinya"]
        coolpc_products = prepared_products["coolpc"]
        pchome_products = prepared_products["pchome"]
        momo_products = prepared_products["momo"]
        suspect_count = sum(
            1 for products in prepared_products.values() for product in products if product.get("is_suspect_price")
        )
        if suspect_count:
            print(f"  價格守門：已隔離 {suspect_count} 筆可疑價格，不會進入比對或最低價計算")
        if is_unchanged:
            touch_catalog_checks(prepared_products)
            print("  增量指紋：所有商品狀態未變更，僅更新 last_checked_at，跳過配對與歷程寫入。")
            return
    except Exception as error:
        # Do not silently skip a crawl when the optimization precheck is unavailable.
        # The transactional persistence still remains the authoritative write guard.
        print(f"  [WARN] 增量指紋預檢失敗，將執行完整更新：{error}")

    # Step 5: 多平台比對商品
    from multi_matcher import match_all_platforms
    # Build category compat set (same as match_products)
    CATEGORY_COMPAT = {
        ("CPU 中央處理器", "處理器 CPU"),
        ("MB 主機板", "主機板 MB"),
        ("RAM 記憶體", "記憶體 RAM"),
        ("VGA 顯示卡", "顯示卡 VGA"),
        ("SSD 固態硬碟", "固態硬碟 M.2｜SSD"),
        ("HDD 機械硬碟", "傳統內接硬碟 HDD"),
        ("電源供應器/不斷電系統", "電源供應器"),
        ("電源供應器/不斷電系統", "UPS不斷電｜印表機｜掃描"),
        ("電腦機殼", "CASE 機殼(+電源)"),
        ("機殼風扇/機殼配件/顯卡支架", "機殼風扇｜機殼配件"),
        ("空冷散熱器/散熱膏", "散熱器｜散熱墊｜散熱膏"),
        ("水冷散熱器", "封閉式｜開放式水冷"),
        ("液晶螢幕/支架", "螢幕｜投影機｜壁掛"),
        ("鍵盤", "鍵盤+鼠｜搖桿｜桌+椅"),
        ("滑鼠/滑鼠墊", "滑鼠｜鼠墊｜數位板"),
        ("滑鼠/滑鼠墊", "鍵盤+鼠｜搖桿｜桌+椅"),
        ("耳機", "喇叭｜耳機｜麥克風"),
        ("喇叭", "喇叭｜耳機｜麥克風"),
        ("外接硬碟/隨身碟/記憶卡", "隨身碟｜隨身硬碟｜記憶卡"),
        ("外接硬碟/隨身碟/記憶卡", "USB週邊｜硬碟座｜讀卡機"),
        ("網通設備/NAS", "IP分享器｜網卡｜網通設備"),
        ("網通設備/NAS", "網路NAS｜網路IPCAM"),
        ("各式線材/轉接頭/外接盒", "網路、傳輸線、轉頭｜KVM"),
        ("各式線材/轉接頭/外接盒", "USB週邊｜硬碟座｜讀卡機"),
        ("作業系統/文書軟體/遊戲點數", "OS+應用軟體｜禮物卡"),
        ("光碟燒錄機", "燒錄器 CD/DVD/BD"),
        ("視訊/網路攝影機", "行車紀錄器｜USB視訊鏡頭"),
        ("最夯遊戲推薦筆電", "筆電｜平板｜穿戴配件"),
        ("商務筆記型電腦", "筆電｜平板｜穿戴配件"),
        ("桌上型電腦", "品牌小主機、AIO｜VR虛擬"),
        ("桌上型電腦", "酷！PC 套裝產線"),
        ("Sinya 精選電腦主機", "品牌小主機、AIO｜VR虛擬"),
        ("Sinya 精選電腦主機", "酷！PC 套裝產線"),
        ("商用桌上型電腦", "品牌小主機、AIO｜VR虛擬"),
        ("商用桌上型電腦", "酷！PC 套裝產線"),
        ("電競桌椅/方向盤/手把", "鍵盤+鼠｜搖桿｜桌+椅"),
        ("直播設備", "喇叭｜耳機｜麥克風"),
        ("直播設備", "行車紀錄器｜USB視訊鏡頭"),
        ("商用防火牆/交換器/無線基地台", "IP分享器｜網卡｜網通設備"),
    }
    compat_set = set()
    for a, b in CATEGORY_COMPAT:
        compat_set.add((a, b))
        compat_set.add((b, a))
    confirmed_rules, negative_features, brand_aliases = fetch_matching_policies()
    from matcher import register_brand_aliases
    register_brand_aliases(brand_aliases)
    from negative_features import build_negative_penalty_lookup
    matched, rejected, review, price_review = match_all_platforms(
        sinya_products, coolpc_products, pchome_products, momo_products,
        category_compat=compat_set,
        confirmed_rules=confirmed_rules,
        negative_penalty_weights=build_negative_penalty_lookup(negative_features),
    )
    applied_rule_ids = sorted({
        rule_id
        for match in matched
        for rule_id in match.pop("_applied_rule_ids", [])
        if isinstance(rule_id, int) and rule_id > 0
    })
    report_matching_rule_usage(applied_rule_ids)
    # Store audit data
    audit_data = {
        "rejected": rejected[:500],
        "review": review[:500],
        "price_review": price_review[:500],
    }
    audit_file = OUTPUT_DIR / "audit.json"
    with open(audit_file, "w", encoding="utf-8") as f:
        json.dump(audit_data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"  複核清單已儲存至 {audit_file}")

    # Generate statistics
    stats = {
        "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "sinya_total": len(sinya_products),
        "coolpc_total": len(coolpc_products),
        "pchome_total": len(pchome_products),
        "momo_total": len(momo_products),
        "matched_total": len(matched),
        "sinya_cheaper": sum(1 for m in matched if m["cheaper"] == "sinya"),
        "coolpc_cheaper": sum(1 for m in matched if m["cheaper"] == "coolpc"),
        "pchome_cheaper": sum(1 for m in matched if m["cheaper"] == "pchome"),
        "momo_cheaper": sum(1 for m in matched if m["cheaper"] == "momo"),
        "same_price": sum(1 for m in matched if m["cheaper"] == "tie"),
        "pchome_matched": sum(1 for m in matched if m.get("pchome_price", 0) > 0),
        "momo_matched": sum(1 for m in matched if m.get("momo_price", 0) > 0),
        "avg_price_diff": sum(abs(m["price_diff"]) for m in matched) / max(len(matched), 1),
    }

    # Persist dynamic data before writing the temporary compatibility files. The public API
    # always exposes the latest completed run, so a failed write cannot replace a good result.
    try:
        from dynamic_store import persist_crawl_result

        dynamic_run_id = persist_crawl_result(
            stats=stats,
            categories=categories,
            sinya_products=sinya_products,
            coolpc_products=coolpc_products,
            pchome_products=pchome_products,
            momo_products=momo_products,
            matches=matched,
        )
        print(f"動態比價資料已寫入資料庫（執行批次 {dynamic_run_id}）")
    except Exception as error:
        # Static files remain as a recovery artifact while the dynamic migration is rolling out.
        # A crawler run is still reported as failed in the database when a run record was created.
        print(f"[WARN] 動態資料庫寫入失敗，保留既有靜態備援：{error}")

    # Save all data — include the official Sinya DIY category list (in order)
    sinya_categories = [c["name"] for c in categories] if categories else []

    all_data = {
        "stats": stats,
        "matched": matched,
        "sinya_products": sinya_products,
        "coolpc_products": coolpc_products,
        "pchome_products": pchome_products,
        "momo_products": momo_products,
        "sinya_categories": sinya_categories,
    }

    output_file = OUTPUT_DIR / "comparison.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(all_data, f, ensure_ascii=False, separators=(',', ':'))

    print(f"資料已儲存至 {output_file}")

    # ── 價格歷史快照 ──
    history_file = OUTPUT_DIR / "price_history.json"
    today = dt.date.today().isoformat()

    # 載入現有歷史
    price_history = []
    if history_file.exists():
        try:
            with open(history_file, "r", encoding="utf-8") as f:
                price_history = json.load(f)
        except:
            price_history = []

    # 建立今日快照（只記錄配對成功的商品價格）
    today_snapshot = {
        "date": today,
        "matched": [
            {
                "sinya_name": m["sinya_name"],
                "coolpc_name": m["coolpc_name"],
                "sinya_price": m["sinya_price"],
                "coolpc_price": m["coolpc_price"],
                "price_diff": m["price_diff"],
            }
            for m in all_data["matched"]
        ],
    }

    # 移除今日已有的快照（避免重複），然後加入新快照
    price_history = [s for s in price_history if s.get("date") != today]
    price_history.append(today_snapshot)

    # 只保留最近 90 天的快照
    cutoff = (dt.date.today() - dt.timedelta(days=90)).isoformat()
    price_history = [s for s in price_history if s.get("date", "") >= cutoff]

    with open(history_file, "w", encoding="utf-8") as f:
        json.dump(price_history, f, ensure_ascii=False, separators=(',', ':'))
    print(f"價格歷史快照已儲存至 {history_file} ({len(price_history)} 天)")

    print(f"\n統計摘要:")
    print(f"  欣亞商品數: {stats['sinya_total']}")
    print(f"  原價屋商品數: {stats['coolpc_total']}")
    print(f"  PCHOME商品數: {stats['pchome_total']}")
    print(f"  momo商品數: {stats['momo_total']}")
    print(f"  比對成功: {stats['matched_total']}")
    print(f"  PCHOME配對: {stats['pchome_matched']}")
    print(f"  momo配對: {stats['momo_matched']}")
    print(f"  欣亞較便宜: {stats['sinya_cheaper']}")
    print(f"  原價屋較便宜: {stats['coolpc_cheaper']}")
    print(f"  PCHOME較便宜: {stats['pchome_cheaper']}")
    print(f"  momo較便宜: {stats['momo_cheaper']}")
    print(f"  價格相同: {stats['same_price']}")
    print(f"  平均價差: NT${stats['avg_price_diff']:.0f}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="欣亞 vs 原價屋 價格比對爬蟲")
    parser.add_argument("--max-cats", type=int, default=None, help="Max categories (for testing)")
    parser.add_argument("--priority-category", type=str, default=None, help="Fetch this Sinya category first while retaining a complete rebuilt catalog")
    args = parser.parse_args()
    main(max_cats=args.max_cats, priority_category=args.priority_category)
