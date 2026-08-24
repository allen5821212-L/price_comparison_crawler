import DashboardLayout from "@/components/DashboardLayout";
import { ManualMatchDialog } from "@/components/ManualMatchDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardCheck, RefreshCw, Search, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type ReviewPlatform = "coolpc" | "pchome" | "momo";
type ReviewSeverity = "all" | "medium" | "high" | "critical";

type ManualReviewSource = {
  name: string;
  price: number;
  platform: ReviewPlatform;
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

/** The existing candidate can be confirmed as a stable platform-specific crawler rule. */
export function buildQueueConfirmationInput(sinyaName: string, target: QueueReviewTarget) {
  return { sinyaName, platform: target.platform, targetName: target.name };
}

export function buildQueueSkipInput(sourceKey: string, fingerprint: string) {
  return { sourceKey, fingerprint };
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

  useEffect(() => setPage(1), [severity, platform, search]);

  const openManualReview = (name: string, price: number, targetPlatform: ReviewPlatform) => {
    setManualSource({ name, price, platform: targetPlatform });
    setDialogOpen(true);
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
          <Button variant="outline" onClick={() => { void queueQuery.refetch(); void reviewSummaryQuery.refetch(); }} disabled={queueQuery.isFetching || user?.role !== "admin"}><RefreshCw className={`mr-2 size-4 ${queueQuery.isFetching ? "animate-spin" : ""}`} />重新檢查佇列</Button>
        </section>

        {user?.role !== "admin" ? (
          <Card className="border-amber-500/30 bg-amber-500/5 p-6"><div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-500" /><div><p className="font-semibold">此佇列限管理員審核</p><p className="mt-1 text-sm text-muted-foreground">請以管理員帳號登入後，確認或改配每個系統標記的可疑品項。</p></div></div></Card>
        ) : (
          <>
            {reviewSummaryQuery.data && <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card className="p-4 shadow-sm"><p className="text-xs font-medium text-muted-foreground">待審核總數</p><p className="mt-1 text-2xl font-bold tabular-nums">{reviewSummaryQuery.data.total.toLocaleString()}</p></Card><Card className="border-destructive/35 bg-destructive/5 p-4 shadow-sm"><p className="text-xs font-medium text-destructive">需優先確認</p><p className="mt-1 text-2xl font-bold tabular-nums text-destructive">{reviewSummaryQuery.data.criticalTotal.toLocaleString()}</p><Button variant="ghost" size="sm" className="mt-2 h-auto px-0 text-xs text-destructive hover:bg-transparent hover:text-destructive" onClick={() => setSeverity("critical")}>只看緊急風險</Button></Card><Card className="p-4 shadow-sm"><p className="text-xs font-medium text-muted-foreground">高度風險</p><p className="mt-1 text-2xl font-bold tabular-nums">{reviewSummaryQuery.data.highTotal.toLocaleString()}</p></Card><Card className="p-4 shadow-sm"><p className="text-xs font-medium text-muted-foreground">中度風險</p><p className="mt-1 text-2xl font-bold tabular-nums">{reviewSummaryQuery.data.mediumTotal.toLocaleString()}</p></Card></section>}
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
                    <Button className="mt-3" size="sm" variant="ghost" onClick={() => skipReview.mutate(buildQueueSkipInput(item.sourceKey, item.fingerprint))} disabled={skipReview.isPending || saveMatch.isPending}>稍後處理</Button>
                  </div>
                  <div className="w-full space-y-2 lg:max-w-lg">{item.targets.map(target => <div key={target.platform} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-xs font-medium text-primary">{PLATFORM_LABELS[target.platform]}</p><p className="mt-1 line-clamp-2 text-sm font-medium">{target.name}</p><p className="mt-1 text-xs text-muted-foreground">{formatPrice(target.price)}</p></div><div className="flex shrink-0 gap-2"><Button size="sm" onClick={() => saveMatch.mutate(buildQueueConfirmationInput(item.sinyaName, target))} disabled={saveMatch.isPending}>採納配對</Button><Button size="sm" variant="outline" onClick={() => openManualReview(item.sinyaName, item.sinyaPrice, target.platform)} disabled={saveMatch.isPending}><SlidersHorizontal className="mr-1.5 size-3.5" />改配</Button></div></div>)}</div>
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
          saveMatch.mutate({ sinyaName: manualSource.name, platform: targetPlatform, targetId, targetName });
        }}
        onReject={() => toast.info("已略過該候選。請繼續搜尋並選擇正確的商品。")}
        onNoMatch={() => toast.info("未建立規則，避免把暫時找不到的商品誤判為永久無對應。")}
      />
    </DashboardLayout>
  );
}
