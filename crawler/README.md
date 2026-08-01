# 價格比對爬蟲模組

## 功能概述

此模組負責爬取欣亞數位（sinya.com.tw）與原價屋（coolpc.com.tw）的全站商品資訊，進行價格比對，並輸出 JSON 供前端展示。

## 檔案結構

```
crawler/
├── crawl.py        # 主爬蟲腳本
├── run_crawl.sh    # 定時任務執行腳本
└── README.md       # 本文件
```

## 使用方式

### 手動執行

```bash
# 完整爬取（全站所有商品）
python3 crawler/crawl.py

# 限制頁數（測試用）
python3 crawler/crawl.py --sinya-pages 10 --coolpc-cats 3
```

### 定時執行

透過 crontab 設定定時任務：

```bash
crontab -e
```

加入以下設定（每 6 小時執行一次）：

```
0 */6 * * * /home/ubuntu/price_comparison_crawler/crawler/run_crawl.sh
```

## 資料來源

### 欣亞數位 (sinya.com.tw)

- API 端點：`https://www.sinya.com.tw/api/search/getdata/?page={N}`
- 每頁 20 筆商品，全站約 8,259 件
- 回傳 JSON 格式，包含 prod_id、prod_title、new_price、href、image 等欄位

### 原價屋 (coolpc.com.tw)

- 分類頁面：`https://www.coolpc.com.tw/eachview.php?IGrp={ID}`
- 共 11 個分類（CPU、主機板、記憶體、顯示卡等）
- HTML 格式（Big5 編碼），需解析 span 區塊中的商品名稱與價格

## 商品比對邏輯

1. **型號提取**：從商品名稱中提取關鍵型號（如 i5-12400F、RTX4060 等）
2. **品牌驗證**：確認兩邊商品品牌一致才進行比對
3. **精確比對**：以型號為索引進行精確匹配
4. **模糊比對**：對未匹配的商品進行相似度計算（閾值 ≥ 0.5）

## 輸出格式

爬蟲結果儲存於 `client/public/data/comparison.json`，包含：

- `stats`：統計摘要（商品數量、比對結果、平均價差等）
- `matched`：成功比對的商品列表
- `sinya_products`：欣亞原始商品資料
- `coolpc_products`：原價屋原始商品資料

## 注意事項

- 爬蟲設有 0.5~2 秒的延遲，以避免對目標網站造成過大負擔
- 原價屋使用 Big5 編碼，需特別處理
- 商品比對基於型號匹配，可能存在誤差，建議使用者點擊連結確認實際商品
