import { describe, expect, it } from "vitest";
import { getCompletedRunIdToRefresh } from "./Home";

describe("首頁最新資料同步", () => {
  it("僅在已觀測完成批次後出現新的完成批次時，要求重載最新商品資料", () => {
    expect(getCompletedRunIdToRefresh(null, { id: 10, status: "completed" })).toBeNull();
    expect(getCompletedRunIdToRefresh(10, { id: 10, status: "completed" })).toBeNull();
    expect(getCompletedRunIdToRefresh(10, { id: 11, status: "completed" })).toBe(11);
  });

  it("排隊中、執行中與不存在的批次不會誤觸發列表刷新", () => {
    expect(getCompletedRunIdToRefresh(10, { id: 11, status: "queued" })).toBeNull();
    expect(getCompletedRunIdToRefresh(10, { id: 11, status: "running" })).toBeNull();
    expect(getCompletedRunIdToRefresh(10, null)).toBeNull();
  });
});
