#!/bin/bash
# 價格比對爬蟲 — 定時執行腳本
# 用法: crontab -e → 加入以下行（每 6 小時執行一次）
# 0 */6 * * * /home/ubuntu/price_comparison_crawler/crawler/run_crawl.sh >> /home/ubuntu/price_comparison_crawler/crawler/crawl.log 2>&1

cd /home/ubuntu/price_comparison_crawler
python3 crawler/crawl.py >> crawler/crawl.log 2>&1

# 如果 WebDev 專案正在運行，重新啟動以載入新資料
# (靜態 JSON 檔案會在下次頁面載入時自動更新，不需要重啟)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 爬蟲完成" >> crawler/crawl.log
