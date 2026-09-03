import DashboardLayout from "@/components/DashboardLayout";
import { ManualMatchDialog } from "@/components/ManualMatchDialog";
import { ReviewActivityPanel } from "@/components/ReviewActivityPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { downloadCsv, toCsv } from "@/lib/csvExport";
import { buildReviewHealthDiagnosticCsvRows } from "@/lib/reviewHealthDiagnosticCsv";
import { buildWeeklyQualityCsvRows } from "@/lib/reviewQualityCsv";
import { trpc } from "@/lib/trpc";
import { Activity, AlertTriangle, BarChart3, BellRing, ChevronLeft, ChevronRight, CircleCheck, ClipboardCheck, Clock3, Download, HeartPulse, RefreshCw, Search, ShieldAlert, SlidersHorizontal, UserRoundCheck, UsersRound } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ReviewPlatform = "coolpc" | "pchome" | "momo";
type ReviewSeverity = "all" | "medium" | "high" | "critical";

type ManualReviewSource = {
  name: string;
  price: number;
  platform: ReviewPlatform;
  sourceKey: string;
  fingerprint: string;
};

type QueueReviewTarget = {
  platform: ReviewPlatform;
  name: string;
};

const PLATFORM_LABELS: Record<ReviewPlatform, string> = {
  coolpc: "原價屋",
  pchome: "PChome 24h",
  momo: "momo 購物網",
};

const SEVERITY_STYLE: Record<Exclude<ReviewSeverity, "all">, string> = {
  medium: "border-amber-400/35 bg-amber-500/10 text-amber-500",
  high: "border-orange-400/35 bg-orange-500/10 text-orange-500",
  critical: "border-red-400/35 bg-red-500/10 text-red-500",
};

const SEVERITY_LABEL: Record<Exclude<ReviewSeverity, "all">, string> = {
  medium: "中度風險",
  high: "高度風險",
  critical: "需優先確認",
};

function formatPrice(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDueAt(value: Date | string) {
  return new Date(value).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" });
}

/** The existing candidate can be confirmed as a stable platform-specific crawler rule. */
export function buildQueueConfirmationInput(sinyaName: string, target: QueueReviewTarget) {
  return { sinyaName, platform: target.platform, targetName: target.name };
}

export function buildQueueSkipInput(sourceKey: string, fingerprint: string) {
  return { sourceKey, fingerprint };
}

export function shouldLoadQualityReport(role: string | undefined, qualityEnabled: boolean) {
  return role === "admin" && qualityEnabled;
}

type HealthStatusFilter = "all" | "healthy" | "degraded";

export function buildHealthHistoryInput(status: HealthStatusFilter, startDate: string, endDate: string) {
  return {
    limit: 100,
    status: status === "all" ? undefined : status,
    startAt: startDate ? new Date(`${startDate}T00:00:00`) : undefined,
    endAt: endDate ? new Date(`${endDate}T23:59:59.999`) : undefined,
  };
}

export default function MatchReviewQueuePage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState<ReviewSeverity>("all");
  const [platform, setPlatform] = useState<ReviewPlatform | "all">("all");
  const [search, setSearch] = useState("");
  const [manualSource, setManualSource] = useState<ManualReviewSource | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignmentHours, setAssignmentHours] = useState<Record<number, number>>({});
  const [notificationThresholds, setNotificationThresholds] = useState({ mediumThreshold: 0, highThreshold: 1, criticalThreshold: 1 });
  const [escalationSettings, setEscalationSettings] = useState({ active: true, escalationRecipientUserId: null as number | null, escalateAfterMinutes: 60, reminderIntervalMinutes: 30 });
  const [bulkAssigneeUserId, setBulkAssigneeUserId] = useState("");
  const [bulkHours, setBulkHours] = useState(24);
  const [qualityEnabled, setQualityEnabled] = useState(false);
  const [degradationThresholdMinutes, setDegradationThresholdMinutes] = useState(15);
  const [healthStatusFilter, setHealthStatusFilter] = useState<HealthStatusFilter>("all");
  const [healthStartDate, setHealthStartDate] = useState("");
  const [healthEndDate, setHealthEndDate] = useState("");
  const healthHistoryInput = useMemo(
    () => buildHealthHistoryInput(healthStatusFilter, healthStartDate, healthEndDate),
    [healthStatusFilter, healthStartDate, healthEndDate],
  );
  const queueQuery = trpc.comparison.reviewQueue.useQuery({
    page,
    pageSize: 20,
    severity: severity === "all" ? undefined : severity,
    platform: platform === "all" ? undefined : platform,
    search: search.trim() || undefined,
  }, { enabled: user?.role === "admin", refetchOnWindowFocus: true });
  const reviewSummaryQuery = trpc.comparison.reviewSummary.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const assigneesQuery = trpc.comparison.reviewAssignees.useQuery(undefined, { enabled: user?.role === "admin" });
  const notificationSettingsQuery = trpc.comparison.reviewNotificationSettings.useQuery(undefined, { enabled: user?.role === "admin" });
  const escalationSettingsQuery = trpc.comparison.reviewEscalationSettings.useQuery(undefined, { enabled: user?.role === "admin" });
  const qualityReportQuery = trpc.comparison.weeklyQualityReport.useQuery(undefined, {
    enabled: shouldLoadQualityReport(user?.role, qualityEnabled),
    staleTime: 60_000,
  });
  const reviewHealthQuery = trpc.comparison.reviewHealth.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const reviewHealthHistoryQuery = trpc.comparison.reviewHealthHistory.useQuery(healthHistoryInput, {
    enabled: user?.role === "admin",
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const healthMonitorSettingsQuery = trpc.comparison.reviewHealthMonitorSettings.useQuery(undefined, { enabled: user?.role === "admin" });
  const degradationAlertStatsQuery = trpc.comparison.reviewDegradationAlertStats.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const healthDiagnosticsQuery = trpc.comparison.reviewDegradationDiagnostics.useQuery({
    startAt: healthHistoryInput.startAt,
    endAt: healthHistoryInput.endAt,
  }, { enabled: false });
  const assignReview = trpc.comparison.assignReview.useMutation({
    onSuccess: () => {
      toast.success("已指派處理人員並設定審核期限。");
      void utils.comparison.reviewQueue.invalidate();
    },
    onError: error => toast.error(error.message || "無法儲存審核指派。"),
  });
  const resolveReview = trpc.comparison.resolveReview.useMutation({
    onSuccess: () => {
      toast.success("已完成此審核工作。候選將不再出現在待審核佇列。");
      void utils.comparison.reviewQueue.invalidate();
      void utils.comparison.reviewSummary.invalidate();
    },
    onError: error => toast.error(error.message || "無法完成此審核工作。"),
  });
  const updateNotificationSettings = trpc.comparison.updateReviewNotificationSettings.useMutation({
    onSuccess: () => {
      toast.success("已更新個人風險通知門檻。");
      void utils.comparison.reviewNotificationSettings.invalidate();
    },
    onError: error => toast.error(error.message || "無法更新通知門檻。"),
  });
  const updateEscalationSettings = trpc.comparison.updateReviewEscalationSettings.useMutation({
    onSuccess: () => {
      toast.success("已更新逾期升級規則與提醒頻率。提醒會在你開啟系統期間生效。");
      void utils.comparison.reviewEscalationSettings.invalidate();
    },
    onError: error => toast.error(error.message || "無法更新逾期升級規則。"),
  });
  const bulkReassign = trpc.comparison.bulkReassignOverdueReviews.useMutation({
    onSuccess: result => {
      toast.success(result.count > 0 ? `已重新指派 ${result.count} 件逾期審核工作。` : "目前沒有逾期的審核工作。");
      void utils.comparison.reviewQueue.invalidate();
      setBulkAssigneeUserId("");
    },
    onError: error => toast.error(error.message || "無法批次重新指派逾期案件。"),
  });
  const saveMatch = trpc.matchRules.confirm.useMutation({
    onSuccess: (_result, input) => {
      toast.success(`已儲存 ${PLATFORM_LABELS[input.platform]} 的精準規則；下次爬蟲會優先套用。`);
      void utils.matchRules.listForAdmin.invalidate();
      void utils.comparison.reviewQueue.invalidate();
      void utils.comparison.reviewSummary.invalidate();
      setDialogOpen(false);
    },
    onError: error => toast.error(error.message || "無法儲存修正，請稍後再試。"),
  });
  const skipReview = trpc.comparison.skipReview.useMutation({
    onSuccess: () => {
      toast.success("已略過此候選組合；若候選品名或規格訊號改變，系統會重新送審。");
      void utils.comparison.reviewQueue.invalidate();
      void utils.comparison.reviewSummary.invalidate();
    },
    onError: error => toast.error(error.message || "無法略過此待審核項目。"),
  });
  const updateHealthMonitorSettings = trpc.comparison.updateReviewHealthMonitorSettings.useMutation({
    onSuccess: () => {
      toast.success("已更新持續降級提醒門檻。");
      void utils.comparison.reviewHealthMonitorSettings.invalidate();
    },
    onError: error => toast.error(error.message || "無法更新健康監控設定。"),
  });

  useEffect(() => setPage(1), [severity, platform, search]);
  useEffect(() => {
    if (notificationSettingsQuery.data) {
      setNotificationThresholds({
        mediumThreshold: notificationSettingsQuery.data.mediumThreshold,
        highThreshold: notificationSettingsQuery.data.highThreshold,
        criticalThreshold: notificationSettingsQuery.data.criticalThreshold,
      });
    }
  }, [notificationSettingsQuery.data]);
  useEffect(() => {
    if (escalationSettingsQuery.data) {
      setEscalationSettings({
        active: escalationSettingsQuery.data.active,
        escalationRecipientUserId: escalationSettingsQuery.data.escalationRecipientUserId,
        escalateAfterMinutes: escalationSettingsQuery.data.escalateAfterMinutes,
        reminderIntervalMinutes: escalationSettingsQuery.data.reminderIntervalMinutes,
      });
    }
  }, [escalationSettingsQuery.data]);
  useEffect(() => {
    if (healthMonitorSettingsQuery.data) setDegradationThresholdMinutes(healthMonitorSettingsQuery.data.degradationThresholdMinutes);
  }, [healthMonitorSettingsQuery.data]);

  const openManualReview = (name: string, price: number, targetPlatform: ReviewPlatform, sourceKey: string, fingerprint: string) => {
    setManualSource({ name, price, platform: targetPlatform, sourceKey, fingerprint });
    setDialogOpen(true);
  };

  const assignItem = (item: { id: number; sourceKey: string; fingerprint: string }, assigneeUserId: number) => {
    const hours = assignmentHours[item.id] ?? 24;
    assignReview.mutate({ sourceKey: item.sourceKey, fingerprint: item.fingerprint, assigneeUserId, dueAt: new Date(Date.now() + hours * 60 * 60 * 1000) });
  };

  const exportQualityReport = () => {
    if (!qualityReportQuery.data) return;
    downloadCsv(`配對品質報表_${qualityReportQuery.data.startDate}_${qualityReportQuery.data.endDate}.csv`, toCsv(buildWeeklyQualityCsvRows(qualityReportQuery.data)));
  };

  const exportHealthDiagnostics = async () => {
    const result = await healthDiagnosticsQuery.refetch();
    if (!result.data) {
      toast.error(result.error?.message || "無法產生重大降級診斷紀錄。");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`審核API重大降級診斷_${stamp}.csv`, toCsv(buildReviewHealthDiagnosticCsvRows(result.data)));
    toast.success("已匯出重大降級診斷紀錄。");
  };

  const bulkReassignOverdue = () => {
    if (!bulkAssigneeUserId) return;
    bulkReassign.mutate({
      assigneeUserId: Number(bulkAssigneeUserId),
      dueAt: new Date(Date.now() + bulkHours * 60 * 60 * 1000),
      message: "逾期案件批次重新指派",
    });
  };

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <section className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-primary"><ClipboardCheck className="size-4" /><span className="text-sm font-medium">人工審核工作台</span></div>
            <h1 className="text-2xl font-bold tracking-tight">待審核配對佇列</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              系統會從最新完成批次挑出規格差異、低信心或跨平台價格落差過大的配對。請開啟精準搜尋後選取正確候選，讓後續爬蟲優先採用已確認規則。
            </p>
          </div>
          <Button variant="outline" onClick={() => { void queueQuery.refetch(); void reviewSummaryQuery.refetch(); if (qualityEnabled) void qualityReportQuery.refetch(); void reviewHealthQuery.refetch(); void reviewHealthHistoryQuery.refetch(); }} disabled={queueQuery.isFetching || user?.role !== "admin"}><RefreshCw className={`mr-2 size-4 ${queueQuery.isFetching ? "animate-spin" : ""}`} />重新檢查佇列</Button>
        </section>

        {user?.role !== "admin" ? (
          <Card className="border-amber-500/30 bg-amber-500/5 p-6"><div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-500" /><div><p className="font-semibold">此佇列限管理員審核</p><p className="mt-1 text-sm text-muted-foreground">請以管理員帳號登入後，確認或改配每個系統標記的可疑品項。</p></div></div></Card>
        ) : (
          <>
            {reviewSummaryQuery.data && <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card className="p-4 shadow-sm"><p className="text-xs font-medium text-muted-foreground">待審核總數</p><p className="mt-1 text-2xl font-bold tabular-nums">{reviewSummaryQuery.data.total.toLocaleString()}</p></Card><Card className="border-destructive/35 bg-destructive/5 p-4 shadow-sm"><p className="text-xs font-medium text-destructive">需優先確認</p><p className="mt-1 text-2xl font-bold tabular-nums text-destructive">{reviewSummaryQuery.data.criticalTotal.toLocaleString()}</p><Button variant="ghost" size="sm" className="mt-2 h-auto px-0 text-xs text-destructive hover:bg-transparent hover:text-destructive" onClick={() => setSeverity("critical")}>只看緊急風險</Button></Card><Card className="p-4 shadow-sm"><p className="text-xs font-medium text-muted-foreground">高度風險</p><p className="mt-1 text-2xl font-bold tabular-nums">{reviewSummaryQuery.data.highTotal.toLocaleString()}</p></Card><Card className="p-4 shadow-sm"><p className="text-xs font-medium text-muted-foreground">中度風險</p><p className="mt-1 text-2xl font-bold tabular-nums">{reviewSummaryQuery.data.mediumTotal.toLocaleString()}</p></Card></section>}
            <Card className="p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><HeartPulse className="size-4 text-primary" /><div><p className="text-sm font-semibold">審核 API 健康狀態</p><p className="text-xs text-muted-foreground">每五分鐘檢查待審核、評論活動與週品質報表讀取依賴。</p></div></div><Button variant="outline" size="sm" onClick={() => reviewHealthQuery.refetch()} disabled={reviewHealthQuery.isFetching}>{reviewHealthQuery.isFetching ? <RefreshCw className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}重新檢查</Button></div>
              {reviewHealthQuery.isLoading && <div className="mt-4 grid gap-2 md:grid-cols-3" aria-label="審核 API 健康檢查載入中">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16" />)}</div>}
              {reviewHealthQuery.isError && <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium text-destructive">健康檢查暫時無法完成</p><p className="mt-1 text-xs text-muted-foreground">{reviewHealthQuery.error.message}</p></div>}
              {reviewHealthQuery.data && <div className="mt-4 grid gap-2 md:grid-cols-3">{reviewHealthQuery.data.checks.map(check => <div key={check.id} className={`rounded-lg border p-3 ${check.status === "healthy" ? "border-emerald-500/25 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}`}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{check.label}</span><Badge variant="outline" className={check.status === "healthy" ? "border-emerald-500/35 text-emerald-600" : "border-destructive/35 text-destructive"}>{check.status === "healthy" ? <><CircleCheck className="mr-1 size-3" />正常</> : "需注意"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{check.durationMs} ms{check.message ? ` · ${check.message}` : ""}</p></div>)}</div>}
              {healthMonitorSettingsQuery.data && <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium">持續降級提醒</p><p className="mt-1 text-xs text-muted-foreground">每 5 分鐘記錄檢查；同一 API 連續降級達門檻後建立管理員提醒。</p></div><div className="flex items-end gap-2"><label className="text-xs text-muted-foreground">門檻（分鐘）<Input type="number" min={5} max={1440} value={degradationThresholdMinutes} onChange={event => setDegradationThresholdMinutes(Math.max(5, Number(event.target.value)))} className="mt-1 h-9 w-28" /></label><Button size="sm" onClick={() => updateHealthMonitorSettings.mutate({ active: healthMonitorSettingsQuery.data.active, degradationThresholdMinutes })} disabled={updateHealthMonitorSettings.isPending}>儲存</Button></div></div>}
            </Card>
            <section className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
              <Card className="p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">健康歷程篩選</p>
                    <p className="mt-1 text-xs text-muted-foreground">日期範圍與狀態會立即套用至時間軸；重大降級診斷匯出沿用日期區間。</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setHealthStatusFilter("all");
                      setHealthStartDate("");
                      setHealthEndDate("");
                    }}
                    disabled={healthStatusFilter === "all" && !healthStartDate && !healthEndDate}
                  >
                    清除篩選
                  </Button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="健康歷程篩選條件">
                  <label className="text-xs text-muted-foreground">開始日期<Input type="date" value={healthStartDate} onChange={event => setHealthStartDate(event.target.value)} className="mt-1 h-9" /></label>
                  <label className="text-xs text-muted-foreground">結束日期<Input type="date" value={healthEndDate} onChange={event => setHealthEndDate(event.target.value)} className="mt-1 h-9" /></label>
                  <label className="text-xs text-muted-foreground">狀態<select value={healthStatusFilter} onChange={event => setHealthStatusFilter(event.target.value as HealthStatusFilter)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"><option value="all">全部狀態</option><option value="degraded">僅降級</option><option value="healthy">僅正常</option></select></label>
                </div>
              </Card>
              <Card className="p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><BellRing className="size-4 text-primary" /><div><p className="text-sm font-semibold">持續降級提醒統計</p><p className="mt-1 text-xs text-muted-foreground">送達代表系統已在管理員工作台顯示站內提醒；已讀不等同問題已處置。</p></div></div></div>
                {degradationAlertStatsQuery.isLoading && <div className="mt-4 grid grid-cols-3 gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
                {degradationAlertStatsQuery.isError && <p className="mt-4 text-sm text-destructive">提醒統計暫時無法載入。</p>}
                {degradationAlertStatsQuery.data && <><div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-md bg-muted/60 p-2"><p className="text-xs text-muted-foreground">已建立</p><p className="mt-1 font-semibold tabular-nums">{degradationAlertStatsQuery.data.total}</p></div><div className="rounded-md bg-emerald-500/5 p-2"><p className="text-xs text-muted-foreground">已送達</p><p className="mt-1 font-semibold tabular-nums">{degradationAlertStatsQuery.data.delivered}</p></div><div className="rounded-md bg-primary/5 p-2"><p className="text-xs text-muted-foreground">已讀</p><p className="mt-1 font-semibold tabular-nums">{degradationAlertStatsQuery.data.read}</p></div></div><p className="mt-2 text-xs text-muted-foreground">未讀 {degradationAlertStatsQuery.data.unread} 則 · 共 {degradationAlertStatsQuery.data.distinctIncidents} 個事件</p><Button className="mt-3 w-full" size="sm" variant="outline" onClick={() => void exportHealthDiagnostics()} disabled={healthDiagnosticsQuery.isFetching}>{healthDiagnosticsQuery.isFetching ? <RefreshCw className="mr-1.5 size-3.5 animate-spin" /> : <Download className="mr-1.5 size-3.5" />}匯出重大降級診斷 CSV</Button></>}
              </Card>
            </section>
            <Card className="p-5 shadow-sm"><div className="flex items-center gap-2"><Activity className="size-4 text-primary" /><div><p className="text-sm font-semibold">健康狀態歷程</p><p className="text-xs text-muted-foreground">最近 24 筆排程健康檢查；紅色標記代表異常時間軸事件。</p></div></div>{reviewHealthHistoryQuery.isLoading && <div className="mt-4 space-y-2" aria-label="健康歷程載入中">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-10" />)}</div>}{reviewHealthHistoryQuery.isError && <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"><p className="text-sm text-destructive">健康歷程暫時無法載入</p><Button size="sm" variant="outline" onClick={() => reviewHealthHistoryQuery.refetch()}>再試一次</Button></div>}{reviewHealthHistoryQuery.data && <div className="mt-4 max-h-56 space-y-2 overflow-y-auto pr-1">{reviewHealthHistoryQuery.data.length === 0 ? <p className="text-sm text-muted-foreground">監控排程尚未產生健康歷程。</p> : reviewHealthHistoryQuery.data.map(event => <div key={event.id} className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${event.status === "healthy" ? "border-emerald-500/20 bg-emerald-500/5" : "border-destructive/25 bg-destructive/5"}`}><div className="min-w-0"><p className="text-sm font-medium">{event.checkLabel}</p><p className="mt-1 truncate text-xs text-muted-foreground">{event.message || "檢查正常"}</p></div><div className="shrink-0 text-right"><Badge variant="outline" className={event.status === "healthy" ? "border-emerald-500/35 text-emerald-600" : "border-destructive/35 text-destructive"}>{event.status === "healthy" ? "正常" : "降級"}</Badge><p className="mt-1 text-xs text-muted-foreground">{formatDueAt(event.observedAt)} · {event.durationMs} ms</p></div></div>)}</div>}</Card>
            {!qualityEnabled && <Card className="p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">最近七日配對品質</p><p className="mt-1 text-xs text-muted-foreground">品質圖表與風險排行會在需要時才查詢，避免影響待審核工作台的首屏速度。</p></div><Button onClick={() => setQualityEnabled(true)}><BarChart3 className="mr-2 size-4" />載入週品質報表</Button></div></Card>}
            {qualityReportQuery.isLoading && <section className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]" aria-label="週品質報表載入中"><Card className="p-5 shadow-sm"><Skeleton className="h-5 w-40" /><Skeleton className="mt-2 h-3 w-72" /><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-14" />)}</div></Card><Card className="p-5 shadow-sm"><Skeleton className="h-5 w-28" /><div className="mt-4 grid grid-cols-3 gap-2">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16" />)}</div></Card></section>}
            {qualityReportQuery.isError && <Card className="border-destructive/35 p-5 shadow-sm"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="font-semibold">週品質報表暫時無法載入</p><p className="mt-1 text-sm text-muted-foreground">{qualityReportQuery.error.message}</p></div><Button onClick={() => qualityReportQuery.refetch()} disabled={qualityReportQuery.isFetching}>{qualityReportQuery.isFetching && <RefreshCw className="mr-2 size-4 animate-spin" />}再試一次</Button></div></Card>}
            {qualityReportQuery.data && <section className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
              <Card className="p-5 shadow-sm"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-sm font-semibold text-primary">最近七日配對品質</p><p className="mt-1 text-xs text-muted-foreground">{qualityReportQuery.data.startDate} 至 {qualityReportQuery.data.endDate} · 高信心且未偵測規格差異的自動配對占比。</p></div><div className="flex items-center gap-2"><Badge variant="secondary" className="text-xs">{qualityReportQuery.data.cache.hit ? `快取 · ${Math.max(1, Math.ceil(qualityReportQuery.data.cache.ageMs / 1000))} 秒前` : "已即時更新"}</Badge><Button variant="outline" size="sm" onClick={exportQualityReport}><Download className="mr-1.5 size-3.5" />下載 CSV</Button></div></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">品質指標</p><p className="mt-1 text-xl font-bold tabular-nums">{qualityReportQuery.data.summary.autoQualityRate}%</p></div><div><p className="text-xs text-muted-foreground">配對總數</p><p className="mt-1 text-xl font-bold tabular-nums">{qualityReportQuery.data.summary.totalMatches.toLocaleString()}</p></div><div><p className="text-xs text-muted-foreground">低信心</p><p className="mt-1 text-xl font-bold tabular-nums">{qualityReportQuery.data.summary.lowConfidenceMatches.toLocaleString()}</p></div><div><p className="text-xs text-muted-foreground">規格差異</p><p className="mt-1 text-xl font-bold tabular-nums">{qualityReportQuery.data.summary.specDiffMatches.toLocaleString()}</p></div></div><p className="mt-4 text-xs text-muted-foreground">此為自動配對品質代理指標，並非人工驗證後的準確率。</p></Card>
              <Card className="p-5 shadow-sm"><div className="flex items-center gap-2"><AlertTriangle className="size-4 text-primary" /><p className="text-sm font-semibold">個人通知門檻</p></div><p className="mt-1 text-xs text-muted-foreground">數量達到門檻且新增案件時顯示提醒；設定 0 即停用該級別。</p><div className="mt-4 grid grid-cols-3 gap-2"><label className="text-xs text-muted-foreground">中度<Input type="number" min={0} value={notificationThresholds.mediumThreshold} onChange={event => setNotificationThresholds(current => ({ ...current, mediumThreshold: Math.max(0, Number(event.target.value)) }))} className="mt-1 h-9" /></label><label className="text-xs text-muted-foreground">高度<Input type="number" min={0} value={notificationThresholds.highThreshold} onChange={event => setNotificationThresholds(current => ({ ...current, highThreshold: Math.max(0, Number(event.target.value)) }))} className="mt-1 h-9" /></label><label className="text-xs text-muted-foreground">緊急<Input type="number" min={0} value={notificationThresholds.criticalThreshold} onChange={event => setNotificationThresholds(current => ({ ...current, criticalThreshold: Math.max(0, Number(event.target.value)) }))} className="mt-1 h-9" /></label></div><Button className="mt-4 w-full" size="sm" onClick={() => updateNotificationSettings.mutate(notificationThresholds)} disabled={updateNotificationSettings.isPending}>儲存通知門檻</Button></Card>
            </section>}
            {qualityReportQuery.data && <section className="grid gap-3 xl:grid-cols-[1.25fr_0.75fr]">
              <Card className="p-5 shadow-sm"><div className="flex items-center gap-2"><BarChart3 className="size-4 text-primary" /><div><p className="text-sm font-semibold">每日品質趨勢</p><p className="text-xs text-muted-foreground">品質指標與低信心配對數的七日變化。</p></div></div><div className="mt-4 h-56"><ResponsiveContainer width="100%" height="100%"><LineChart data={qualityReportQuery.data.days}><CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} fontSize={11} /><YAxis yAxisId="rate" domain={[0, 100]} fontSize={11} /><YAxis yAxisId="count" orientation="right" fontSize={11} /><Tooltip formatter={(value, name) => [name === "autoQualityRate" ? `${value}%` : value, name === "autoQualityRate" ? "品質指標" : "低信心配對"]} labelFormatter={label => `日期：${label}`} /><Line yAxisId="rate" type="monotone" dataKey="autoQualityRate" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} /><Line yAxisId="count" type="monotone" dataKey="lowConfidenceMatches" stroke="#f59e0b" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></Card>
              <Card className="p-5 shadow-sm"><div className="flex items-center gap-2"><AlertTriangle className="size-4 text-destructive" /><div><p className="text-sm font-semibold">風險來源排行</p><p className="text-xs text-muted-foreground">依欣亞分類統計低信心或規格差異的配對數。</p></div></div><div className="mt-4 space-y-3">{qualityReportQuery.data.riskSources.length === 0 ? <p className="text-sm text-muted-foreground">近七日尚無可排行的風險來源。</p> : qualityReportQuery.data.riskSources.slice(0, 5).map(source => <div key={source.category}><div className="flex items-center justify-between gap-3 text-xs"><span className="truncate font-medium">{source.category}</span><span className="shrink-0 tabular-nums text-muted-foreground">{source.riskMatches} 件 · {source.riskRate}%</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-destructive/75" style={{ width: `${Math.min(100, source.riskRate)}%` }} /></div></div>)}</div></Card>
            </section>}
            <Card className="border-amber-500/25 p-4 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2"><UsersRound className="size-4 text-amber-500" /><p className="text-sm font-semibold">逾期案件批次重新指派</p></div><p className="mt-1 text-xs text-muted-foreground">將所有已逾期、尚未完成的審核工作交給指定管理員，並寫入交接紀錄。</p></div><div className="flex flex-wrap gap-2"><select value={bulkAssigneeUserId} onChange={event => setBulkAssigneeUserId(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-xs"><option value="">選擇接手人員</option>{assigneesQuery.data?.map(assignee => <option key={assignee.id} value={assignee.id}>{assignee.name || assignee.email || `管理員 #${assignee.id}`}</option>)}</select><select value={bulkHours} onChange={event => setBulkHours(Number(event.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-xs"><option value={4}>新期限 4 小時</option><option value={24}>新期限 24 小時</option><option value={72}>新期限 3 天</option></select><Button size="sm" onClick={bulkReassignOverdue} disabled={!bulkAssigneeUserId || bulkReassign.isPending}>批次重新指派</Button></div></div></Card>
            <Card className="border-primary/25 p-4 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2"><BellRing className="size-4 text-primary" /><p className="text-sm font-semibold">逾期升級提醒</p></div><p className="mt-1 max-w-2xl text-xs text-muted-foreground">可指定由哪位管理員接收逾期提醒。提醒僅在接收者開啟系統時按設定頻率檢查，並顯示站內／已授權瀏覽器通知。</p></div><div className="flex flex-wrap items-end gap-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={escalationSettings.active} onChange={event => setEscalationSettings(current => ({ ...current, active: event.target.checked }))} />啟用</label><label className="text-xs text-muted-foreground">接收管理員<select value={escalationSettings.escalationRecipientUserId ?? ""} onChange={event => setEscalationSettings(current => ({ ...current, escalationRecipientUserId: event.target.value ? Number(event.target.value) : null }))} className="mt-1 h-9 w-36 rounded-md border border-input bg-background px-2 text-xs"><option value="">原處理人</option>{assigneesQuery.data?.map(assignee => <option key={assignee.id} value={assignee.id}>{assignee.name || assignee.email || `管理員 #${assignee.id}`}</option>)}</select></label><label className="text-xs text-muted-foreground">逾期後升級（分鐘）<Input type="number" min={5} max={10080} value={escalationSettings.escalateAfterMinutes} onChange={event => setEscalationSettings(current => ({ ...current, escalateAfterMinutes: Math.max(5, Number(event.target.value)) }))} className="mt-1 h-9 w-32" /></label><label className="text-xs text-muted-foreground">提醒頻率（分鐘）<Input type="number" min={5} max={1440} value={escalationSettings.reminderIntervalMinutes} onChange={event => setEscalationSettings(current => ({ ...current, reminderIntervalMinutes: Math.max(5, Number(event.target.value)) }))} className="mt-1 h-9 w-32" /></label><Button size="sm" onClick={() => updateEscalationSettings.mutate(escalationSettings)} disabled={updateEscalationSettings.isPending}>儲存升級規則</Button></div></div></Card>
            <Card className="p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} className="pl-9" placeholder="搜尋欣亞品名、分類或候選商品…" /></div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <label className="sr-only" htmlFor="review-severity">風險等級</label>
                  <select id="review-severity" value={severity} onChange={event => setSeverity(event.target.value as ReviewSeverity)} className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="all">所有風險</option><option value="critical">需優先確認</option><option value="high">高度風險</option><option value="medium">中度風險</option></select>
                  <label className="sr-only" htmlFor="review-platform">目標平台</label>
                  <select id="review-platform" value={platform} onChange={event => setPlatform(event.target.value as ReviewPlatform | "all")} className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="all">所有平台</option><option value="coolpc">原價屋</option><option value="pchome">PChome 24h</option><option value="momo">momo</option></select>
                </div>
              </div>
              {queueQuery.data?.run && <p className="mt-3 text-xs text-muted-foreground">依完成批次 #{queueQuery.data.run.id} 產生 · 共 {queueQuery.data.total.toLocaleString()} 件待審核</p>}
            </Card>

            {queueQuery.isLoading ? <div className="space-y-3">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-44 w-full" />)}</div> : queueQuery.isError ? <Card className="border-destructive/35 p-8 text-center"><AlertTriangle className="mx-auto mb-3 size-6 text-destructive" /><p className="font-semibold">無法載入待審核佇列</p><p className="mt-1 text-sm text-muted-foreground">{queueQuery.error.message}</p></Card> : queueQuery.data?.items.length === 0 ? <Card className="p-12 text-center"><ClipboardCheck className="mx-auto mb-3 size-8 text-emerald-500" /><h2 className="font-semibold">目前沒有需要人工確認的配對</h2><p className="mt-1 text-sm text-muted-foreground">最新批次中沒有觸發規格差異、低信心或異常價格落差的配對。</p></Card> : <div className="space-y-3">{queueQuery.data?.items.map(item => (
              <Card key={item.id} className="overflow-hidden border-border shadow-sm">
                <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={SEVERITY_STYLE[item.severity]}><AlertTriangle className="mr-1 size-3" />{SEVERITY_LABEL[item.severity]}</Badge><Badge variant="secondary">風險 {item.riskScore}</Badge><span className="text-xs text-muted-foreground">配對信心 {formatPercent(item.score)} · 價格落差 {formatPercent(item.priceSpread)}</span></div>
                    <h2 className="mt-3 font-semibold leading-6">{item.sinyaName}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">欣亞 · {item.category} · {formatPrice(item.sinyaPrice)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">{item.reasons.map(reason => <span key={reason} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{reason}</span>)}</div>
                    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">{item.assignment ? <div className="min-w-0"><p className="flex items-center gap-1 text-xs font-medium"><UserRoundCheck className="size-3.5 text-primary" />處理人：{item.assignment.assigneeName}</p><p className={`mt-1 flex items-center gap-1 text-xs ${item.assignment.isOverdue ? "text-destructive" : "text-muted-foreground"}`}><Clock3 className="size-3.5" />{item.assignment.isOverdue ? "已逾期" : "到期"}：{formatDueAt(item.assignment.dueAt)}</p></div> : <p className="text-xs text-muted-foreground">尚未指派處理人員與審核時限。</p>}<div className="flex flex-wrap gap-2"><label className="text-xs text-muted-foreground">期限<select value={assignmentHours[item.id] ?? 24} onChange={event => setAssignmentHours(current => ({ ...current, [item.id]: Number(event.target.value) }))} className="ml-1 h-8 rounded-md border border-input bg-background px-2 text-xs"><option value={4}>4 小時</option><option value={24}>24 小時</option><option value={72}>3 天</option></select></label><select defaultValue="" onChange={event => { const assigneeUserId = Number(event.target.value); if (assigneeUserId) assignItem(item, assigneeUserId); }} className="h-8 rounded-md border border-input bg-background px-2 text-xs" disabled={assignReview.isPending}><option value="">{item.assignment ? "重新指派" : "指派處理人員"}</option>{assigneesQuery.data?.map(assignee => <option key={assignee.id} value={assignee.id}>{assignee.name || assignee.email || `管理員 #${assignee.id}`}</option>)}</select>{item.assignment && <Button size="sm" variant="ghost" onClick={() => resolveReview.mutate({ sourceKey: item.sourceKey, fingerprint: item.fingerprint })} disabled={resolveReview.isPending}>完成工作</Button>}</div></div></div>
                    <Button className="mt-3" size="sm" variant="ghost" onClick={() => skipReview.mutate(buildQueueSkipInput(item.sourceKey, item.fingerprint))} disabled={skipReview.isPending || saveMatch.isPending}>稍後處理</Button>
                    <ReviewActivityPanel sourceKey={item.sourceKey} fingerprint={item.fingerprint} assignees={assigneesQuery.data ?? []} onChanged={() => { void utils.comparison.reviewQueue.invalidate(); }} />
                  </div>
                  <div className="w-full space-y-2 lg:max-w-lg">{item.targets.map(target => <div key={target.platform} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-xs font-medium text-primary">{PLATFORM_LABELS[target.platform]}</p><p className="mt-1 line-clamp-2 text-sm font-medium">{target.name}</p><p className="mt-1 text-xs text-muted-foreground">{formatPrice(target.price)}</p></div><div className="flex shrink-0 gap-2"><Button size="sm" onClick={() => saveMatch.mutate(buildQueueConfirmationInput(item.sinyaName, target), { onSuccess: () => resolveReview.mutate({ sourceKey: item.sourceKey, fingerprint: item.fingerprint }) })} disabled={saveMatch.isPending}>採納配對</Button><Button size="sm" variant="outline" onClick={() => openManualReview(item.sinyaName, item.sinyaPrice, target.platform, item.sourceKey, item.fingerprint)} disabled={saveMatch.isPending}><SlidersHorizontal className="mr-1.5 size-3.5" />改配</Button></div></div>)}</div>
                </div>
              </Card>
            ))}</div>}

            {queueQuery.data && queueQuery.data.totalPages > 1 && <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">第 {queueQuery.data.page} / {queueQuery.data.totalPages} 頁</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={queueQuery.data.page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}><ChevronLeft className="mr-1 size-3.5" />上一頁</Button><Button size="sm" variant="outline" disabled={queueQuery.data.page >= queueQuery.data.totalPages} onClick={() => setPage(current => current + 1)}>下一頁<ChevronRight className="ml-1 size-3.5" /></Button></div></div>}
          </>
        )}
      </div>

      <ManualMatchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialPlatform={manualSource?.platform ?? "coolpc"}
        sinyaProduct={manualSource ? { name: manualSource.name, price: manualSource.price, url: "", image: "" } : null}
        onConfirm={(targetId, targetName, targetPlatform = "coolpc") => {
          if (!manualSource) return;
          saveMatch.mutate({ sinyaName: manualSource.name, platform: targetPlatform, targetId, targetName }, { onSuccess: () => resolveReview.mutate({ sourceKey: manualSource.sourceKey, fingerprint: manualSource.fingerprint }) });
        }}
        onReject={() => toast.info("已略過該候選。請繼續搜尋並選擇正確的商品。")}
        onNoMatch={() => toast.info("未建立規則，避免把暫時找不到的商品誤判為永久無對應。")}
      />
    </DashboardLayout>
  );
}
