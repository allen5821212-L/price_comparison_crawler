# 比對治理功能管理員驗證

2026-09-03 已以管理員帳號在 `/brand-aliases` 新增通路別名 `CoolerMaster`，並對應至標準品牌 `酷碼`。介面成功顯示儲存通知、別名總數與啟用數均更新為 1；隨後已測試停用與重新啟用切換，兩次皆收到對應的成功通知。最終 `CoolerMaster → 酷碼` 維持啟用，將在後續爬蟲規則下載時被匯出。

待審核工作台已在已登入會話中載入新的「最新批次 MPN 滿分命中率」卡與硬阻斷證據資料契約。是否有可見標籤取決於最新已完成批次是否包含 MPN 滿分或被阻斷的候選，不以人為建立錯配資料驗證。

同日重新載入 `/review-queue` 後，卡片成功取得最新完成批次的真實資料：`0 / 1,989` 筆主配對由完全一致 MPN 確認，因此顯示 `0%`。最新批次早於硬阻斷 evidence payload 的寫入，現有待審核列沒有 `hard_filter_reasons` 可呈現；前端標籤與資料層解析由 `MatchReviewQueuePage.reliability.test.tsx`、`matchGovernanceData.test.ts` 以及 Python payload 測試覆蓋，避免建立測試錯配資料污染人工審核佇列。
