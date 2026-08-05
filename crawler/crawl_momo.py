"""
momo 購物網爬蟲模組 — 透過搜尋頁面解析 Next.js __next_f 資料
URL: https://www.momoshop.com.tw/search/searchShop.jsp?keyword={kw}&searchType=1&curPage={page}
"""

import re
import time
import urllib.request
import urllib.parse

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

MOMO_SEARCH_URL = "https://www.momoshop.com.tw/search/searchShop.jsp"
MOMO_GOODS_URL = "https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code="

# 3C 零件搜尋關鍵字 — 使用更精確的品牌+品類關鍵字提升商品覆蓋率
MOMO_KEYWORDS = [
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
    "SATA SSD",
    # HDD
    "HDD 硬碟",
    # 電源供應器
    "電源供應器 80PLUS",
    # 機殼
    "電腦機殼 ATX",
    "電腦機殼 ITX",
    # 散熱
    "CPU散熱器 塔式",
    "水冷散熱器",
    "機殼風扇 ARGB",
    # 螢幕
    "電競螢幕 144Hz",
    "螢幕 4K",
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
    # 線材
    "HDMI 線",
    "DP 線",
    "USB Type-C 線",
    # 光碟機
    "外接光碟機",
    # 視訊
    "視訊攝影機",
    # 筆電
    "ASUS 筆電 電競",
    "MSI 筆電 電競",
    "Lenovo 筆電",
    "Acer 筆電",
    "HP 筆電",
    # 桌機
    "套裝電腦",
    # 電競椅
    "電競椅",
    # 軟體
    "Windows 作業系統",
    # 散熱膏
    "散熱膏",
    # UPS
    "UPS 不斷電系統",
    # 延長線
    "延長線",
]


def fetch_url(url, retries=3):
    """Fetch URL and return HTML content."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "zh-TW,zh;q=0.9",
    }
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            if attempt < retries - 1:
                wait = (attempt + 1) * 3
                print(f"  [momo RETRY {attempt+1}/{retries}] {e}, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"  [momo ERROR] {e}")
                return ""


def parse_momo_products(html):
    """Parse product data from momo search results page (Next.js __next_f blocks)."""
    products = []

    # Find __next_f blocks containing product data
    next_f_blocks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.DOTALL)

    for block in next_f_blocks:
        if "goodsUrl" not in block:
            continue

        # Unescape the JS string
        try:
            unescaped = block.encode().decode("unicode_escape")
        except Exception:
            continue

        # Extract product entries using regex
        names = re.findall(r'goodsName":"([^"]+)"', unescaped)
        codes = re.findall(r'i_code=(\d+)', unescaped)
        prices = re.findall(r'goodsPrice":"([^"]+)"', unescaped)
        orig_prices = re.findall(r'goodsPriceOri":"([^"]+)"', unescaped)
        urls = re.findall(r'goodsUrl":"([^"]+)"', unescaped)
        brands = re.findall(r'brandName":"([^"]+)"', unescaped)

        for i in range(len(names)):
            try:
                name = names[i].encode("latin1").decode("utf-8")
            except Exception:
                name = names[i]

            # Parse price: "$$46,999" → 46999
            price_str = prices[i] if i < len(prices) else ""
            price = 0
            if price_str:
                nums = re.findall(r"[\d,]+", price_str)
                if nums:
                    price = int(nums[0].replace(",", ""))

            # Parse original price
            orig_str = orig_prices[i] if i < len(orig_prices) else ""
            orig_price = None
            if orig_str:
                nums = re.findall(r"[\d,]+", orig_str)
                if nums:
                    orig_price = int(nums[0].replace(",", ""))

            code = codes[i] if i < len(codes) else ""
            if not code or not name or price == 0:
                continue

            try:
                brand = brands[i].encode("latin1").decode("utf-8") if i < len(brands) else ""
            except Exception:
                brand = brands[i] if i < len(brands) else ""

            products.append({
                "source": "momo",
                "id": f"momo_{code}",
                "name": name,
                "subtitle": brand,
                "price": price,
                "original_price": orig_price,
                "url": f"{MOMO_GOODS_URL}{code}",
                "image": "",
                "category": "",
            })

    return products


def crawl_momo(max_keywords=None, max_pages_per_keyword=5):
    """
    Crawl momo shopping by search keywords.
    Returns list of product dicts with standardized fields.
    """
    print("=== momo 購物網 爬蟲開始 ===")
    products = []
    seen_ids = set()

    keywords = MOMO_KEYWORDS
    if max_keywords:
        keywords = keywords[:max_keywords]

    for kw in keywords:
        print(f"  momo 搜尋 [{kw}] ...", end=" ", flush=True)
        kw_count = 0

        for page in range(1, max_pages_per_keyword + 1):
            url = f"{MOMO_SEARCH_URL}?keyword={urllib.parse.quote(kw)}&searchType=1&curPage={page}"
            html = fetch_url(url)
            if not html:
                break

            page_products = parse_momo_products(html)
            if not page_products:
                break

            for p in page_products:
                if p["id"] in seen_ids:
                    continue
                p["category"] = kw
                products.append(p)
                seen_ids.add(p["id"])
                kw_count += 1

            time.sleep(0.8)  # polite delay

        print(f"{kw_count} 件 (累計 {len(products)})")
        time.sleep(1.0)

    print(f"=== momo 購物網 完成: {len(products)} 件 ===\n")
    return products


if __name__ == "__main__":
    prods = crawl_momo(max_keywords=2, max_pages_per_keyword=2)
    for p in prods[:5]:
        print(f"  {p['name'][:50]} | ${p['price']} | {p['url']}")
