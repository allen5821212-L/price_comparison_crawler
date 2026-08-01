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
    Extract a canonical model identifier from a product name.
    Normalizes naming differences between Sinya and CoolPC.
    Returns a list of canonical model tokens that can be matched across sites.
    """
    # Strip HTML tags and noise — replace with SPACE (not empty) to prevent number concatenation
    clean = re.sub(r"<[^>]+>", " ", name)
    clean = re.sub(r"【[^】]*】", " ", clean)
    clean = re.sub(r"\[[^\]]*\]", " ", clean)
    clean = re.sub(r"\([^)]*\)", " ", clean)
    clean = re.sub(r"~[^~]*~", " ", clean)
    # Normalize whitespace
    clean = re.sub(r"\s+", " ", clean).upper().strip()

    models = set()

    # ── CPU models ──
    # Intel Core Ultra 5 225F / 225 / 245K / 245KF / 250K Plus / 285K
    for m in re.finditer(r'CORE\s*ULTRA\s*\d+\s*(\d{3,4}[A-Z]*)', clean):
        models.add("IU" + m.group(1))
    # Intel Core i5-12400F / i9-14900K / i5-14400
    for m in re.finditer(r'(?:CORE\s*)?I(\d)-?(\d{4,5}[A-Z]*)', clean):
        models.add("I" + m.group(1) + m.group(2))
    # Intel Xeon W5-2465X / W7-3465X
    for m in re.finditer(r'XEON\s*W(\d)-(\d{4,5}[A-Z]*)', clean):
        models.add("XEONW" + m.group(1) + m.group(2))
    # AMD Ryzen5 7500F / Ryzen7 7800X3D / Ryzen9 9950X
    for m in re.finditer(r'RYZEN\s*(\d)\s*(\d{4}[A-Z0-9]*)', clean):
        models.add("R" + m.group(1) + m.group(2))
    # AMD R5 5600X / R7 7800X3D / R9 9950X / R5 3400G
    for m in re.finditer(r'\bR(\d)\s*(\d{4}[A-Z0-9]*)', clean):
        models.add("R" + m.group(1) + m.group(2))
    # AMD Athlon / Phenom (rare but handle)
    for m in re.finditer(r'ATHLON\s*(\d{4}[A-Z]*)', clean):
        models.add("ATHLON" + m.group(1))

    # ── GPU models ──
    # RTX 5070 / RTX 5080 / RTX 4060 Ti / RTX 5070 Ti
    for m in re.finditer(r'RTX\s*(\d{3,4}[A-Z\s]*)', clean):
        models.add("RTX" + m.group(1).replace(" ", ""))
    # GTX 1660 / GTX 1650
    for m in re.finditer(r'GTX\s*(\d{3,4}[A-Z]*)', clean):
        models.add("GTX" + m.group(1))
    # RX 7600 / RX 9060 XT / RX 9070
    for m in re.finditer(r'\bRX\s*(\d{4}[A-Z\s]*)', clean):
        models.add("RX" + m.group(1).replace(" ", ""))
    # Arc A750 / A770
    for m in re.finditer(r'\bARC\s*A(\d{3})', clean):
        models.add("ARCA" + m.group(1))

    # ── Motherboard models ──
    # B850-PLUS / B760M / Z890 / X870 / H610 / B860
    for m in re.finditer(r'\b([ABH])?(\d{3})M?[-\s]?([A-Z0-9]*)', clean):
        chipset = (m.group(1) or "") + m.group(2)
        suffix = m.group(3) or ""
        if chipset and len(chipset) >= 2 and suffix:
            full = chipset + suffix
            if len(full) >= 4:
                models.add("MB" + full)

    # ── RAM models ──
    # DDR5-5200 / DDR5-6000 / DDR4-3200 / D5-5600
    for m in re.finditer(r'DDR?\s*5[-\s]?(\d{4})', clean):
        models.add("DDR5" + m.group(1))
    for m in re.finditer(r'DDR?\s*4[-\s]?(\d{4})', clean):
        models.add("DDR4" + m.group(1))
    for m in re.finditer(r'\bD5[-\s]?(\d{4})', clean):
        models.add("DDR5" + m.group(1))
    for m in re.finditer(r'\bD4[-\s]?(\d{4})', clean):
        models.add("DDR4" + m.group(1))

    # ── SSD/HDD models ── (REMOVED: too generic, causes false matches)
    # SSD capacity: 1TB / 2TB / 500GB — these are too generic for matching

    # ── PSU models ── (REMOVED: too generic, causes false matches)
    # 850W / 750W / 1000W — these are too generic for matching

    # ── Monitor models ── (REMOVED: too generic, causes false matches)
    # 27" / 32" / 24" sizes — these are too generic for matching

    # ── Fallback: generic alphanumeric model patterns ──
    # Long alphanumeric sequences that might be model numbers
    # Must be at least 5 chars to avoid matching generic numbers like "5000"
    for m in re.finditer(r'\b([A-Z]{2,}\d{3,}[A-Z0-9]*)', clean):
        token = m.group(1)
        if len(token) >= 5 and token not in models:
            # Filter out very generic tokens
            generic = {"RTX5000", "GTX5000", "DDR5000", "SSD5000"}
            if token not in generic:
                models.add(token)

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
        "威剛", "ADATA", "金士頓", "KIOXIA", "鎧俠", "INNO3D", "映眾",
        "ZOTAC", "索泰", "EVGA", "PNY", "麗臺", "LEADTEK",
        "狼蛛", "AULA", "ANACOMDA", "巨蟒", "亞奇雷", "AGI",
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
    """Match products between Sinya and CoolPC using strict model-based matching.

    Key design principles:
    1. Only match when there is a SPECIFIC model number in common (not generic tokens)
    2. Brand must match (if both have brand info)
    3. Category must be compatible
    4. Price ratio must be within 2:1
    5. No fuzzy matching — only exact model token match
    6. Combo/bundle products are matched separately from standalone products
    """
    print("=== 商品比對開始 ===")
    matched = []
    sinya_matched = set()
    coolpc_matched = set()

    # Filter out non-products
    sinya_valid = {}
    for i, p in enumerate(sinya_products):
        if is_non_product(p["name"], p["price"]):
            continue
        sinya_valid[i] = p

    coolpc_valid = {}
    for i, p in enumerate(coolpc_products):
        if is_non_product(p["name"], p["price"]):
            continue
        coolpc_valid[i] = p

    print(f"  有效商品: 欣亞 {len(sinya_valid)} / 原價屋 {len(coolpc_valid)}")

    # Category compatibility map
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

    def categories_compatible(cat1, cat2):
        if not cat1 or not cat2:
            return True
        if cat1 == cat2:
            return True
        return (cat1, cat2) in compat_set

    def price_ratio_ok(price1, price2):
        if price1 <= 0 or price2 <= 0:
            return False
        ratio = max(price1, price2) / min(price1, price2)
        return ratio <= 2.0  # Stricter: 2:1 max

    # ── Build model index using ONLY specific model tokens ──
    # Separate standalone vs combo products
    coolpc_standalone_index = {}  # model_token → [ci, ...]
    coolpc_combo_index = {}
    sinya_standalone_index = {}
    sinya_combo_index = {}

    for ci, cp in coolpc_valid.items():
        is_combo = is_combo_or_bundle(cp["name"])
        models = extract_canonical_model(cp["name"])
        idx = coolpc_combo_index if is_combo else coolpc_standalone_index
        for m in models:
            idx.setdefault(m, []).append(ci)

    for si, sp in sinya_valid.items():
        is_combo = is_combo_or_bundle(sp["name"])
        models = extract_canonical_model(sp["name"])
        idx = sinya_combo_index if is_combo else sinya_standalone_index
        for m in models:
            idx.setdefault(m, []).append(si)

    # ── Phase 1: Standalone vs Standalone (exact model match) ──
    for model, sinya_entries in sinya_standalone_index.items():
        if model not in coolpc_standalone_index:
            continue
        for si in sinya_entries:
            if si in sinya_matched:
                continue
            for ci in coolpc_standalone_index[model]:
                if ci in coolpc_matched:
                    continue
                sp = sinya_products[si]
                cp = coolpc_products[ci]
                if not categories_compatible(sp.get("category", ""), cp.get("category", "")):
                    continue
                sp_brand = extract_brand(sp["name"])
                cp_brand = extract_brand(cp["name"])
                if sp_brand and cp_brand and sp_brand != cp_brand:
                    continue
                if not price_ratio_ok(sp["price"], cp["price"]):
                    continue
                price_diff = sp["price"] - cp["price"]
                cheaper = "sinya" if sp["price"] < cp["price"] else ("coolpc" if cp["price"] < sp["price"] else "tie")
                matched.append({
                    "name": sp["name"], "sinya_name": sp["name"], "coolpc_name": cp["name"],
                    "sinya_price": sp["price"], "coolpc_price": cp["price"],
                    "price_diff": price_diff, "cheaper": cheaper,
                    "sinya_url": sp["url"], "coolpc_url": cp["url"],
                    "sinya_image": sp["image"], "coolpc_image": cp["image"],
                    "category": sp["category"] or cp["category"],
                })
                sinya_matched.add(si)
                coolpc_matched.add(ci)
                break

    phase1_count = len(matched)
    print(f"  Phase 1 (單品精確比對): {phase1_count} 組")

    # ── Phase 2: Standalone vs Combo (exact model match) ──
    for model, sinya_entries in sinya_standalone_index.items():
        if model not in coolpc_combo_index:
            continue
        for si in sinya_entries:
            if si in sinya_matched:
                continue
            for ci in coolpc_combo_index[model]:
                if ci in coolpc_matched:
                    continue
                sp = sinya_products[si]
                cp = coolpc_products[ci]
                if not categories_compatible(sp.get("category", ""), cp.get("category", "")):
                    continue
                sp_brand = extract_brand(sp["name"])
                cp_brand = extract_brand(cp["name"])
                if sp_brand and cp_brand and sp_brand != cp_brand:
                    continue
                if not price_ratio_ok(sp["price"], cp["price"]):
                    continue
                price_diff = sp["price"] - cp["price"]
                cheaper = "sinya" if sp["price"] < cp["price"] else ("coolpc" if cp["price"] < sp["price"] else "tie")
                matched.append({
                    "name": sp["name"], "sinya_name": sp["name"], "coolpc_name": cp["name"],
                    "sinya_price": sp["price"], "coolpc_price": cp["price"],
                    "price_diff": price_diff, "cheaper": cheaper,
                    "sinya_url": sp["url"], "coolpc_url": cp["url"],
                    "sinya_image": sp["image"], "coolpc_image": cp["image"],
                    "category": sp["category"] or cp["category"],
                })
                sinya_matched.add(si)
                coolpc_matched.add(ci)
                break

    phase2_count = len(matched) - phase1_count
    print(f"  Phase 2 (單品 vs 組合包): {phase2_count} 組")

    # ── Phase 3: Combo vs Combo (exact model match) ──
    for model, sinya_entries in sinya_combo_index.items():
        if model not in coolpc_combo_index:
            continue
        for si in sinya_entries:
            if si in sinya_matched:
                continue
            for ci in coolpc_combo_index[model]:
                if ci in coolpc_matched:
                    continue
                sp = sinya_products[si]
                cp = coolpc_products[ci]
                if not categories_compatible(sp.get("category", ""), cp.get("category", "")):
                    continue
                sp_brand = extract_brand(sp["name"])
                cp_brand = extract_brand(cp["name"])
                if sp_brand and cp_brand and sp_brand != cp_brand:
                    continue
                if not price_ratio_ok(sp["price"], cp["price"]):
                    continue
                price_diff = sp["price"] - cp["price"]
                cheaper = "sinya" if sp["price"] < cp["price"] else ("coolpc" if cp["price"] < sp["price"] else "tie")
                matched.append({
                    "name": sp["name"], "sinya_name": sp["name"], "coolpc_name": cp["name"],
                    "sinya_price": sp["price"], "coolpc_price": cp["price"],
                    "price_diff": price_diff, "cheaper": cheaper,
                    "sinya_url": sp["url"], "coolpc_url": cp["url"],
                    "sinya_image": sp["image"], "coolpc_image": cp["image"],
                    "category": sp["category"] or cp["category"],
                })
                sinya_matched.add(si)
                coolpc_matched.add(ci)
                break

    phase3_count = len(matched) - phase1_count - phase2_count
    print(f"  Phase 3 (組合包比對): {phase3_count} 組")

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

    # Save all data — include the official Sinya DIY category list (in order)
    sinya_categories = [c["name"] for c in categories] if categories else []

    all_data = {
        "stats": stats,
        "matched": matched,
        "sinya_products": sinya_products,
        "coolpc_products": coolpc_products,
        "sinya_categories": sinya_categories,
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
