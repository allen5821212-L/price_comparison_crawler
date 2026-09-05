import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { BarChart3, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, PackageX, RefreshCw } from "lucide-react";
import React, { useState } from "react";

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export const LOW_COVERAGE_THRESHOLD = 0.5;

export function isLowCoverage(value: number) {
  return value < LOW_COVERAGE_THRESHOLD;
}

function formatPrice(value: number) {
  return `NT$${value.toLocaleString()}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function CoverageQueryErrorPanel({
  title,
  error,
  fallback,
  onRetry,
}: {
  title: string;
  error: unknown;
  fallback: string;
  onRetry: () => void;
}) {
  return <div className="p-10 text-center"><PackageX className="mx-auto mb-3 size-6 text-destructive" /><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{errorMessage(error, fallback)}</p><Button className="mt-4" size="sm" variant="outline" onClick={onRetry}><RefreshCw className="mr-2 size-3.5" />重新嘗試</Button></div>;
}

export default function CoolpcCoveragePage() {
  const { user } = useAuth();
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const coverageQuery = trpc.comparison.coolpcCoverage.useQuery(undefined, { enabled: user?.role === "admin" });
  const unlistedQuery = trpc.comparison.coolpcUnlisted.useQuery({
    category: category === "all" ? undefined : category,
    page,
    pageSize: 25,
  }, { enabled: user?.role === "admin" });
  const coverage = coverageQuery.data;
  const unlisted = unlistedQuery.data;

  const chooseCategory = (value: string) => {
    setCategory(value);
    setPage(1);
    document.getElementById("coolpc-unlisted")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <DashboardLayout><div className="mx-auto w-full max-w-7xl space-y-6">
    <section className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-primary"><BarChart3 className="size-4" /><span className="text-sm font-medium">目錄覆蓋率</span></div>
        <h1 className="text-2xl font-bold tracking-tight">欣亞 × 原價屋上架分析</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">以最新完成爬蟲批次為準，僅將已通過保守配對規則的欣亞－原價屋品項視為「原價屋已上架」。未配對品項會保留在缺口清單，方便後續檢視。</p>
      </div>
      <div className="flex flex-wrap gap-2"><Button asChild variant="default"><a href="#coolpc-unlisted"><PackageX className="mr-2 size-4" />查看原價屋未上架商品</a></Button><Button variant="outline" onClick={() => { void coverageQuery.refetch(); void unlistedQuery.refetch(); }} disabled={coverageQuery.isFetching || unlistedQuery.isFetching}>
        <RefreshCw className={coverageQuery.isFetching || unlistedQuery.isFetching ? "mr-2 size-4 animate-spin" : "mr-2 size-4"} />重新整理分析
      </Button></div>
    </section>

    {coverageQuery.isLoading ? <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28" />)}</div> : coverageQuery.isError ? <Card className="border-destructive/35"><CoverageQueryErrorPanel title="無法載入上架覆蓋率" error={coverageQuery.error} fallback="請檢查資料庫連線或稍後再試。" onRetry={() => void coverageQuery.refetch()} /></Card> : !coverage ? <Card className="p-10 text-center"><PackageX className="mx-auto mb-3 size-7 text-muted-foreground" /><h2 className="font-semibold">尚無可分析的完成批次</h2><p className="mt-1 text-sm text-muted-foreground">請先完成一次四平台爬蟲更新後再查看上架覆蓋率。</p></Card> : <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted-foreground">原價屋全站上架率</p><p className="mt-1 text-3xl font-bold text-primary">{percent(coverage.coverageRate)}</p><p className="mt-1 text-xs text-muted-foreground">以欣亞 {coverage.sinyaTotal.toLocaleString()} 件為分母</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">原價屋已上架</p><p className="mt-1 text-3xl font-bold text-emerald-500">{coverage.coolpcListed.toLocaleString()} 件</p><p className="mt-1 text-xs text-muted-foreground">已通過欣亞－原價屋配對</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">欣亞有售、原價屋未上架</p><p className="mt-1 text-3xl font-bold text-amber-500">{coverage.coolpcUnlisted.toLocaleString()} 件</p><a className="mt-2 inline-flex text-xs font-medium text-primary hover:underline" href="#coolpc-unlisted">直接查看未上架品名 →</a></Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border p-4"><h2 className="font-semibold">各分類原價屋上架率</h2><p className="mt-1 text-xs text-muted-foreground">點選「查看未上架」會帶出該分類中欣亞有售、但目前尚未得到原價屋確認對應的產品品名。</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">欣亞分類</th><th className="px-4 py-3 text-right font-medium">欣亞商品</th><th className="px-4 py-3 text-right font-medium">原價屋已上架</th><th className="px-4 py-3 min-w-56 font-medium">上架率</th><th className="px-4 py-3 text-right font-medium">未上架</th></tr></thead><tbody className="divide-y divide-border">{coverage.categories.map(item => {
          const lowCoverage = isLowCoverage(item.coverageRate);
          return <tr className={category === item.category ? "bg-primary/5" : ""} key={item.category}><td className="px-4 py-3 font-medium">{item.category}</td><td className="px-4 py-3 text-right tabular-nums">{item.sinyaTotal.toLocaleString()}</td><td className="px-4 py-3 text-right tabular-nums text-emerald-500">{item.coolpcListed.toLocaleString()}</td><td className="px-4 py-3"><div className="flex items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-[width] duration-300 ${lowCoverage ? "bg-red-500" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(100, item.coverageRate * 100))}%` }} /></div><span className={`w-12 text-right tabular-nums ${lowCoverage ? "font-semibold text-red-500" : ""}`}>{percent(item.coverageRate)}</span></div></td><td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" className="h-8 text-amber-600 hover:text-amber-500" onClick={() => chooseCategory(item.category)}>{item.coolpcUnlisted.toLocaleString()} 件 <ChevronRight className="ml-1 size-3.5" /></Button></td></tr>;
        })}</tbody></table></div>
      </Card>

      <Card id="coolpc-unlisted" className="scroll-mt-6 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">欣亞有售、原價屋未上架商品</h2><Badge variant="outline" className="border-amber-400/40 bg-amber-500/10 text-amber-600">原價屋缺口</Badge></div><p className="mt-1 text-xs text-muted-foreground">{unlisted ? `共 ${unlisted.total.toLocaleString()} 件` : "讀取中"}；這些是欣亞已上架、但目前尚未取得原價屋確認對應的商品。</p></div><Select value={category} onValueChange={chooseCategory}><SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="篩選欣亞分類" /></SelectTrigger><SelectContent><SelectItem value="all">全部欣亞分類</SelectItem>{coverage.categories.map(item => <SelectItem key={item.category} value={item.category}>{item.category}（{item.coolpcUnlisted.toLocaleString()}）</SelectItem>)}</SelectContent></Select></div>
        {unlistedQuery.isLoading ? <div className="space-y-3 p-4">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div> : unlistedQuery.isError ? <CoverageQueryErrorPanel title="無法載入未上架商品清單" error={unlistedQuery.error} fallback="請稍後重新嘗試。" onRetry={() => void unlistedQuery.refetch()} /> : !unlisted || unlisted.items.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">此分類目前沒有未上架品項。</p> : <div className="divide-y divide-border">{unlisted.items.map(item => <div className="flex items-center gap-3 p-4" key={item.externalId}><div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">{item.image ? <img src={item.image} alt="" className="size-full object-cover" /> : <PackageX className="size-4 text-muted-foreground" />}</div><div className="min-w-0 flex-1"><p className="truncate font-medium" title={item.name}>{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.category} · 欣亞價格 {formatPrice(item.price)}</p></div><Badge variant="outline" className="shrink-0 border-amber-400/40 bg-amber-500/10 text-amber-600">原價屋未上架</Badge>{item.url ? <Button size="icon" variant="ghost" className="size-8 shrink-0" asChild><a href={item.url} target="_blank" rel="noreferrer" aria-label={`開啟欣亞商品：${item.name}`}><ExternalLink className="size-4" /></a></Button> : null}</div>)}</div>}
        {unlisted && unlisted.totalPages > 1 ? <div className="flex items-center justify-between border-t border-border p-3"><span className="text-xs text-muted-foreground">第 {unlisted.page} / {unlisted.totalPages} 頁</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={unlisted.page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}><ChevronLeft className="mr-1 size-3.5" />上一頁</Button><Button size="sm" variant="outline" disabled={unlisted.page >= unlisted.totalPages} onClick={() => setPage(current => Math.min(unlisted.totalPages, current + 1))}>下一頁<ChevronRight className="ml-1 size-3.5" /></Button></div></div> : null}
      </Card>
      <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />本分析採用目前比對引擎已確認的欣亞－原價屋對應；未上架表示尚未取得確認對應，並不宣稱原價屋絕對沒有同款商品。</p>
    </>}
  </div></DashboardLayout>;
}
