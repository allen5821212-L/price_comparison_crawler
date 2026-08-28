# 待審核配對採納修正驗證

## 使用者回報與根因

使用者在行動版待審核配對頁採納 Seagate IronWolf NAS 碟候選後，精準規則已成功寫入 `matching_feedback`，但案件仍留在佇列。資料庫核對顯示該候選沒有 `match_review_assignments` 紀錄。原實作只對既有指派列執行 `UPDATE`；未指派案件的更新影響列數為零，無法建立佇列排除所需的 `resolved` 狀態。

## 修正與正式核對

修正後，採納、略過與完成工作皆透過 upsert 寫入 `resolved` 指派紀錄。已為使用者先前採納的 Seagate 案件補建 `source_key = sinya_1139022589` 的完成紀錄。正式待審核頁面已載入完成批次 `#450001` 的 1,236 件候選，且頁面文字中不再出現 `ST2000VN003` 或該 IronWolf 商品名稱；資料庫紀錄為 `status = resolved`。

> 正式頁面：<https://pricecomp-cr-mlsxyggu.manus.space/review-queue>
