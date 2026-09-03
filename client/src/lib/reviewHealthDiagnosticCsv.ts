type DiagnosticIncident = {
  incidentKey: string;
  checkId: string;
  title: string;
  message: string;
  createdAt: Date | string;
  recipientCount: number;
  deliveredCount: number;
  readCount: number;
  recipients: string[];
};

type DiagnosticEvidence = {
  checkId: string;
  checkLabel: string;
  status: "healthy" | "degraded";
  durationMs: number;
  message: string | null;
  observedAt: Date | string;
};

export type ReviewHealthDiagnostics = {
  generatedAt: Date | string;
  filters: { startAt: Date | string | null; endAt: Date | string | null };
  incidents: DiagnosticIncident[];
  evidence: DiagnosticEvidence[];
};

/** Creates a human-readable CSV containing only persistent, alert-producing degradation evidence. */
export function buildReviewHealthDiagnosticCsvRows(diagnostics: ReviewHealthDiagnostics) {
  const rows: Array<Array<string | number>> = [
    ["審核 API 重大降級診斷紀錄"],
    ["產生時間", new Date(diagnostics.generatedAt).toLocaleString("zh-TW")],
    ["篩選開始", diagnostics.filters.startAt ? new Date(diagnostics.filters.startAt).toLocaleString("zh-TW") : "不限"],
    ["篩選結束", diagnostics.filters.endAt ? new Date(diagnostics.filters.endAt).toLocaleString("zh-TW") : "不限"],
    [],
    ["重大降級事件"],
    ["事件鍵", "檢查項目", "提醒標題", "原因", "首次提醒", "接收管理員數", "已顯示站內提醒", "已讀", "接收者"],
  ];
  for (const incident of diagnostics.incidents) {
    rows.push([
      incident.incidentKey,
      incident.checkId,
      incident.title,
      incident.message,
      new Date(incident.createdAt).toLocaleString("zh-TW"),
      incident.recipientCount,
      incident.deliveredCount,
      incident.readCount,
      incident.recipients.join("、"),
    ]);
  }
  rows.push([], ["降級探針歷程"], ["檢查項目", "名稱", "狀態", "延遲（ms）", "訊息", "觀測時間"]);
  for (const event of diagnostics.evidence) {
    rows.push([
      event.checkId,
      event.checkLabel,
      event.status === "degraded" ? "降級" : "正常",
      event.durationMs,
      event.message || "",
      new Date(event.observedAt).toLocaleString("zh-TW"),
    ]);
  }
  rows.push([], ["說明", "「已顯示站內提醒」代表管理員工作台已呈現提醒；瀏覽器或作業系統通知的實際送達不在此統計範圍。"]);
  return rows;
}
