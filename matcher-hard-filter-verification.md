# 分層硬阻斷與 MPN 優先配對發布驗證

2026-09-03 已以正式網域讀取 `GET /api/matching-rules?release=2ede156d`。端點正常回應人工 `rules` 與 `negativeFeatures` 欄位，確認本輪已發布服務仍可供爬蟲載入人工正向與負向比對規則。

分層硬阻斷與 MPN 優先配對位於爬蟲端 `matcher.py`／`spec_normalizer.py`，不會透過公開規則端點逐筆計分。其行為已由 `test_spec_normalizer.py` 的品牌、核心晶片、容量、瓦數、DDR、後綴、行銷詞與 MPN 案例驗證，並同時通過既有 `test_acceptance.py` 的 14 個否決案例與 9 個保留案例，以及網站的完整 119 項回歸測試與正式建置。
