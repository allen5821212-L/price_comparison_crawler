import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, ExternalLink, Github, Play, RadioTower, RefreshCw, ShieldAlert, TrendingUp } from "lucide-react";
import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(value: number | null) {
  if (!value) return "尚無樣本";
  const minutes = Math.round(value / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分` : `${minutes} 分`;
}

const JOB_STYLES = {
  queued: "border-amber-400/30 bg-amber-500/10 text-amber-500",
  running: "border-blue-400/30 bg-blue-500/10 text-blue-500",
  completed: "border-emerald-400/30 bg-emerald-500/10 text-emerald-500",
  failed: "border-red-400/30 bg-red-500/10 text-red-500",
  cancelled: "border-muted-foreground/30 bg-muted text-muted-foreground",
} as const;

const JOB_LABELS = { queued: "排隊中", running: "執行中", completed: "已完成", failed: "失敗", cancelled: "已取消" } as const;

export function CrawlerIssueReportLink({ issueReport }: { issueReport: { severity: string; issueLabel: string; issueDraftUrl: string } }) {
  return <div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-violet-400/30 bg-violet-500/10 text-violet-500">{issueReport.issueLabel} · {issueReport.severity}</Badge><a className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" href={issueReport.issueDraftUrl} target="_blank" rel="noreferrer"><Github className="size-3.5" />已建立 Issue 草稿<ExternalLink className="size-3" /></a></div>;
}

export default function CrawlerMonitor() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [category, setCategory] = useState("full");
  const jobsQuery = trpc.crawler.jobs.useQuery(undefined, { refetchInterval: 15_000 });
  const eventsQuery = trpc.crawler.events.useQuery(undefined, { refetchInterval: 15_000 });
  const analyticsQuery = trpc.crawler.categoryRecrawlAnalytics.useQuery(undefined, { refetchInterval: 30_000 });
  const categoriesQuery = trpc.comparison.latest.useQuery({ page: 1, pageSize: 10 });
  const enqueue = trpc.crawler.enqueue.useMutation({
    onSuccess: result => {
      toast.success(result.created ? `爬蟲工作 #${result.id} 已排入持續執行器` : `爬蟲工作 #${result.id} 已在${result.status === "running" ? "執行" : "佇列"}中`);
      void utils.crawler.jobs.invalidate();
      void utils.crawler.events.invalidate();
      void utils.crawler.categoryRecrawlAnalytics.invalidate();
    },
    onError: error => toast.error(error.message || "無法建立爬蟲工作"),
  });
  const markRead = trpc.crawler.markEventsRead.useMutation({ onSuccess: () => void utils.crawler.events.invalidate() });
  const jobs = jobsQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const categories = categoriesQuery.data?.sinya_categories ?? [];
  const queued = jobs.filter(job => job.status === "queued").length;
  const running = jobs.filter(job => job.status === "running").length;
  const unreadErrors = events.filter(event => event.level === "error" && !event.readAt);
  const latest = jobs[0];
  const canQueue = user?.role === "admin" && !enqueue.isPending;
  const selectedCategoryName = useMemo(() => category === "full" ? undefined : category, [category]);
  const trendData = useMemo(() => (analyticsQuery.data?.points ?? []).map(point => ({
    ...point,
    label: new Date(point.finishedAt).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  })), [analyticsQuery.data]);
  const analytics = analyticsQuery.data;

  return <DashboardLayout><div className="mx-auto w-full max-w-7xl space-y-6">
    <section className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between"><div className="space-y-1"><div className="flex items-center gap-2 text-primary"><RadioTower className="size-4" /><span className="text-sm font-medium">持續雲端執行器</span></div><h1 className="text-2xl font-bold tracking-tight">爬蟲監控與指定重跑</h1><p className="max-w-3xl text-sm text-muted-foreground">完整爬蟲每六小時執行一次。您可將單一欣亞分類排入工作佇列；同時檢視成功、警告與失敗事件。</p></div><div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><Select value={category} onValueChange={setCategory}><SelectTrigger className="sm:w-64"><SelectValue placeholder="選擇重跑範圍" /></SelectTrigger><SelectContent><SelectItem value="full">完整四平台更新</SelectItem>{categories.map(name => <SelectItem value={name} key={name}>{name}</SelectItem>)}</SelectContent></Select><Button disabled={!canQueue} onClick={() => enqueue.mutate(category === "full" ? { scope: "full" } : { scope: "category", categoryName: selectedCategoryName })}>{enqueue.isPending ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}排入重跑</Button></div></section>
    {user && user.role !== "admin" ? <Card className="border-destructive/30 p-8 text-center"><ShieldAlert className="mx-auto mb-3 size-7 text-destructive" /><h2 className="font-semibold">此頁限管理員使用</h2><p className="mt-1 text-sm text-muted-foreground">只有管理員可查看執行紀錄、告警與建立爬蟲工作。</p></Card> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card className="p-4"><p className="text-xs text-muted-foreground">排隊工作</p><p className="mt-1 text-2xl font-bold text-amber-500">{queued}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">執行中</p><p className="mt-1 text-2xl font-bold text-blue-500">{running}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">未讀失敗告警</p><p className="mt-1 text-2xl font-bold text-destructive">{unreadErrors.length}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">最近工作</p><p className="mt-1 truncate text-sm font-semibold">{latest ? `${latest.scope === "full" ? "完整更新" : latest.categoryName} · ${JOB_LABELS[latest.status]}` : "尚無資料"}</p></Card></div>
      <Card className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><TrendingUp className="size-4 text-primary" /><h2 className="font-semibold">分類補抓趨勢</h2></div><p className="mt-1 text-xs text-muted-foreground">統計最近 {analytics?.sampleSize ?? 0} 筆已結束的指定分類工作；成功率採最近 5 筆滾動計算。</p></div><Button size="sm" variant="outline" onClick={() => void utils.crawler.categoryRecrawlAnalytics.invalidate()}><RefreshCw className="mr-2 size-3.5" />重新整理</Button></div>{analyticsQuery.isLoading ? <div className="grid gap-3 p-4 md:grid-cols-2">{Array.from({ length: 2 }, (_, index) => <Skeleton key={index} className="h-64" />)}</div> : !analytics || !trendData.length ? <div className="p-10 text-center"><BarChart3 className="mx-auto mb-3 size-7 text-muted-foreground" /><p className="font-medium">尚無足夠的分類補抓資料</p><p className="mt-1 text-sm text-muted-foreground">完成指定分類補抓後，這裡會顯示實際耗時與成功率趨勢。</p></div> : <><div className="grid gap-3 border-b border-border p-4 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">平均耗時</p><p className="mt-1 font-semibold">{formatDuration(analytics.averageDurationMs)}</p></div><div><p className="text-xs text-muted-foreground">總成功率</p><p className="mt-1 font-semibold text-emerald-500">{analytics.successRate === null ? "—" : `${(analytics.successRate * 100).toFixed(1)}%`}</p></div><div><p className="text-xs text-muted-foreground">成功工作</p><p className="mt-1 font-semibold">{analytics.completedCount}</p></div><div><p className="text-xs text-muted-foreground">失敗工作</p><p className="mt-1 font-semibold text-destructive">{analytics.failedCount}</p></div></div><div className="grid gap-6 p-4 lg:grid-cols-2"><div><p className="mb-3 text-sm font-medium">單次補抓耗時</p><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 6 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={34} /><YAxis unit=" 分" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip formatter={(value: number) => [`${value} 分`, "耗時"]} labelFormatter={label => `完成：${label}`} /><Bar dataKey="durationMinutes" name="耗時" fill="var(--color-primary)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div><div><p className="mb-3 text-sm font-medium">最近 5 筆滾動成功率</p><div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 6 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={34} /><YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip formatter={(value: number) => [`${value}%`, "成功率"]} labelFormatter={label => `完成：${label}`} /><Line type="monotone" dataKey="rollingSuccessRate" name="成功率" stroke="var(--color-chart-2)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div></div></div></>}</Card>
      <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-border p-4"><div><h2 className="font-semibold">近期執行紀錄</h2><p className="text-xs text-muted-foreground">持續執行器會自行取得排隊中的工作，避免網站請求逾時。</p></div><Button size="sm" variant="outline" onClick={() => { void utils.crawler.jobs.invalidate(); void utils.crawler.events.invalidate(); void utils.crawler.categoryRecrawlAnalytics.invalidate(); }}><RefreshCw className="mr-2 size-3.5" />重新整理</Button></div>{jobsQuery.isLoading ? <div className="space-y-3 p-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div> : <div className="divide-y divide-border">{jobs.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">尚無爬蟲工作。可先將完整更新或指定分類排入佇列。</p> : jobs.map(job => <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" key={job.id}><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="font-medium">{job.scope === "full" ? "完整四平台更新" : job.categoryName}</p><Badge variant="outline" className={JOB_STYLES[job.status]}>{JOB_LABELS[job.status]}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{job.trigger === "scheduled" ? "定期排程" : "管理員手動"} · 建立於 {formatDate(job.requestedAt)}{job.finishedAt ? ` · 結束於 ${formatDate(job.finishedAt)}` : ""}</p>{job.errorMessage ? <p className="mt-1 text-xs text-destructive">{job.errorMessage}</p> : null}{job.issueReport ? <CrawlerIssueReportLink issueReport={job.issueReport} /> : null}</div><div className="text-xs text-muted-foreground sm:text-right">{job.comparisonRunId ? `比價批次 #${job.comparisonRunId}` : "等待執行器"}</div></div>)}</div>}</Card>
      <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-border p-4"><div><h2 className="font-semibold">告警與事件</h2><p className="text-xs text-muted-foreground">錯誤事件會保留訊息，供追查來源網站或執行器異常。</p></div><Button size="sm" variant="outline" disabled={!unreadErrors.length || markRead.isPending} onClick={() => markRead.mutate({ ids: unreadErrors.map(event => event.id) })}><CheckCircle2 className="mr-2 size-3.5" />全部標為已讀</Button></div><div className="divide-y divide-border">{events.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">目前沒有告警事件。</p> : events.map(event => <div className="flex gap-3 p-4" key={event.id}>{event.level === "error" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" /> : event.level === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <Activity className="mt-0.5 size-4 shrink-0 text-primary" />}<div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="font-medium">{event.title}</p><span className="shrink-0 text-xs text-muted-foreground">{formatDate(event.createdAt)}</span></div>{event.message ? <p className="mt-1 text-sm text-muted-foreground">{event.message}</p> : null}</div></div>)}</div></Card>
    </>}
  </div></DashboardLayout>;
}
