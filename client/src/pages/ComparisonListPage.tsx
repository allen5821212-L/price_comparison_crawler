import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, ListFilter, RefreshCw, Search } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { getCompletedRunIdToRefresh } from "@/lib/comparisonSync";

type SortKey = "price_diff" | "price_diff_abs" | "best_price" | "score" | "name";
type ComparisonRow = {
  name: string;
  sinya_name: string;
  coolpc_name: string;
  pchome_name?: string;
  momo_name?: string;
  sinya_price: number;
  coolpc_price: number;
  pchome_price?: number;
  momo_price?: number;
  price_diff: number;
  cheaper: "sinya" | "coolpc" | "pchome" | "momo" | "tie";
  category: string;
  score: number;
  spec_diff?: unknown[];
  sinya_url?: string;
  coolpc_url?: string;
  pchome_url?: string;
  momo_url?: string;
};

const platformLabels = {
  sinya: "欣亞",
  coolpc: "原價屋",
  pchome: "PChome",
  momo: "momo",
  tie: "同價",
} as const;

function price(value: number | undefined) {
  if (!value) return "—";
  return `NT$${value.toLocaleString("zh-TW")}`;
}

function relativeDiff(row: ComparisonRow) {
  const prefix = row.price_diff > 0 ? "+" : "";
  return `${prefix}${price(Math.abs(row.price_diff))}`;
}

function getLowestPrice(row: ComparisonRow) {
  return Math.min(...[row.sinya_price, row.coolpc_price, row.pchome_price, row.momo_price].filter((value): value is number => Boolean(value)));
}

function ProductName({ row }: { row: ComparisonRow }) {
  return (
    <div className="min-w-0">
      <p className="line-clamp-2 break-words font-semibold leading-5 text-foreground">{row.sinya_name || row.name}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="truncate">{row.category}</span>
        {row.spec_diff && row.spec_diff.length > 0 && <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">規格差異</Badge>}
      </div>
    </div>
  );
}

function PriceLink({ value, url, label, lowest }: { value: number | undefined; url?: string; label: string; lowest: boolean }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const content = <span className={lowest ? "font-bold text-emerald-600 dark:text-emerald-400" : "font-medium"}>{price(value)}</span>;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-sm hover:underline" aria-label={`開啟 ${label} 商品頁`}>
      {content}<ExternalLink className="size-3 text-muted-foreground" />
    </a>
  ) : content;
}

function MatchBadge({ row }: { row: ComparisonRow }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant="secondary" className="whitespace-nowrap">{platformLabels[row.cheaper]}最低</Badge>
      <span className="font-mono text-xs text-muted-foreground">相似度 {(row.score * 100).toFixed(0)}%</span>
    </div>
  );
}

export default function ComparisonListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | undefined>();
  const [sort, setSort] = useState<SortKey>("price_diff_abs");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const observedCompletedRunId = useRef<number | null>(null);

  const queryInput = useMemo(() => ({
    page,
    pageSize: 25,
    search: search.trim() || undefined,
    category,
    sort,
    order,
  }), [category, order, page, search, sort]);
  const comparisonQuery = trpc.comparison.latest.useQuery(queryInput, {
    refetchOnWindowFocus: true,
  });
  const comparisonStatusQuery = trpc.comparison.status.useQuery(undefined, {
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const completedRun = comparisonStatusQuery.data?.latestCompletedRun;
    const nextRunId = getCompletedRunIdToRefresh(observedCompletedRunId.current, completedRun);
    if (observedCompletedRunId.current === null) {
      observedCompletedRunId.current = completedRun?.status === "completed" ? completedRun.id : null;
      return;
    }
    if (nextRunId === null) return;
    observedCompletedRunId.current = nextRunId;
    void comparisonQuery.refetch();
  }, [comparisonQuery, comparisonStatusQuery.data?.latestCompletedRun]);

  const rows = (comparisonQuery.data?.matched ?? []) as ComparisonRow[];
  const pagination = comparisonQuery.data?.pagination;
  const categories = comparisonQuery.data?.sinya_categories ?? [];
  const activeRun = comparisonQuery.data?.run;
  const statusLabel = comparisonQuery.isFetching ? "正在同步最新資料" : activeRun ? `已同步完成批次 #${activeRun.id}` : "等待可用資料";

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-card/85 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" asChild className="shrink-0"><Link href="/" aria-label="返回上架率儀表板"><ArrowLeft className="size-4" /></Link></Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold">商品比價列表</h1>
              <p className="truncate text-xs text-muted-foreground">最新完成批次的四平台價格與配對結果</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={comparisonQuery.isFetching ? "secondary" : "outline"} className="hidden gap-1.5 sm:inline-flex">
              <RefreshCw className={`size-3 ${comparisonQuery.isFetching ? "animate-spin" : ""}`} />{statusLabel}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => comparisonQuery.refetch()} disabled={comparisonQuery.isFetching}>
              <RefreshCw className={`mr-1.5 size-3.5 ${comparisonQuery.isFetching ? "animate-spin" : ""}`} />重新載入
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-6 md:py-8">
        <section className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary"><ListFilter className="size-4" />即時比價結果</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {comparisonQuery.data ? `共 ${pagination?.total.toLocaleString("zh-TW")} 組配對；資料更新於 ${comparisonQuery.data.stats.update_time}` : "正在讀取最新完成批次…"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground sm:hidden">{statusLabel}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 md:w-[660px]">
            <div className="relative sm:col-span-1"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><Input value={search} onChange={event => updateSearch(event.target.value)} placeholder="搜尋品名或型號" className="pl-9" /></div>
            <select aria-label="欣亞分類" value={category ?? "all"} onChange={event => { setCategory(event.target.value === "all" ? undefined : event.target.value); setPage(1); }} className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="all">全部分類</option>
              {categories.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <div className="flex gap-2">
              <select aria-label="排序方式" value={sort} onChange={event => { setSort(event.target.value as SortKey); setPage(1); }} className="min-w-0 flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="price_diff_abs">價差最大</option>
                <option value="best_price">最低價</option>
                <option value="score">相似度</option>
                <option value="name">品名</option>
              </select>
              <Button variant="outline" size="sm" className="h-10 px-3" onClick={() => { setOrder(current => current === "asc" ? "desc" : "asc"); setPage(1); }}>{order === "asc" ? "升冪" : "降冪"}</Button>
            </div>
          </div>
        </section>

        {comparisonQuery.error ? (
          <Card className="border-destructive/40 bg-destructive/5 p-6"><p className="font-semibold">無法載入商品比價資料</p><p className="mt-1 text-sm text-muted-foreground">{comparisonQuery.error.message}</p><Button className="mt-4" onClick={() => comparisonQuery.refetch()}>再試一次</Button></Card>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {comparisonQuery.isLoading && Array.from({ length: 5 }).map((_, index) => <Card key={index} className="p-4"><Skeleton className="h-5 w-4/5" /><Skeleton className="mt-3 h-20 w-full" /></Card>)}
              {!comparisonQuery.isLoading && rows.map(row => {
                const lowest = getLowestPrice(row);
                return <Card key={`${row.name}-${row.sinya_price}`} className="p-4 shadow-sm"><ProductName row={row} /><div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><div><p className="text-xs text-muted-foreground">欣亞</p><PriceLink value={row.sinya_price} url={row.sinya_url} label="欣亞" lowest={row.sinya_price === lowest} /></div><div><p className="text-xs text-muted-foreground">原價屋</p><PriceLink value={row.coolpc_price} url={row.coolpc_url} label="原價屋" lowest={row.coolpc_price === lowest} /></div><div><p className="text-xs text-muted-foreground">PChome</p><PriceLink value={row.pchome_price} url={row.pchome_url} label="PChome" lowest={row.pchome_price === lowest} /></div><div><p className="text-xs text-muted-foreground">momo</p><PriceLink value={row.momo_price} url={row.momo_url} label="momo" lowest={row.momo_price === lowest} /></div></div><div className="mt-4 flex items-center justify-between border-t border-border pt-3"><MatchBadge row={row} /><span className="font-mono text-sm text-muted-foreground">價差 {relativeDiff(row)}</span></div></Card>;
              })}
            </div>

            <Card className="hidden overflow-hidden shadow-sm md:block"><div className="overflow-x-auto"><Table className="table-fixed min-w-[1080px]"><TableHeader><TableRow><TableHead className="w-[34%]">商品名稱</TableHead><TableHead className="w-[10%]">欣亞</TableHead><TableHead className="w-[10%]">原價屋</TableHead><TableHead className="w-[10%]">PChome</TableHead><TableHead className="w-[10%]">momo</TableHead><TableHead className="w-[11%]">配對結果</TableHead><TableHead className="w-[15%] text-right">價差</TableHead></TableRow></TableHeader><TableBody>{comparisonQuery.isLoading && Array.from({ length: 8 }).map((_, index) => <TableRow key={index}><TableCell><Skeleton className="h-8 w-72" /></TableCell>{Array.from({ length: 6 }).map((__, cellIndex) => <TableCell key={cellIndex}><Skeleton className="h-5 w-16" /></TableCell>)}</TableRow>)}{!comparisonQuery.isLoading && rows.map(row => { const lowest = getLowestPrice(row); return <TableRow key={`${row.name}-${row.sinya_price}`}><TableCell><ProductName row={row} /></TableCell><TableCell><PriceLink value={row.sinya_price} url={row.sinya_url} label="欣亞" lowest={row.sinya_price === lowest} /></TableCell><TableCell><PriceLink value={row.coolpc_price} url={row.coolpc_url} label="原價屋" lowest={row.coolpc_price === lowest} /></TableCell><TableCell><PriceLink value={row.pchome_price} url={row.pchome_url} label="PChome" lowest={row.pchome_price === lowest} /></TableCell><TableCell><PriceLink value={row.momo_price} url={row.momo_url} label="momo" lowest={row.momo_price === lowest} /></TableCell><TableCell><MatchBadge row={row} /></TableCell><TableCell className="text-right font-mono text-sm">{relativeDiff(row)}</TableCell></TableRow>; })}{!comparisonQuery.isLoading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-12 text-center text-muted-foreground">找不到符合條件的商品。</TableCell></TableRow>}</TableBody></Table></div></Card>
          </>
        )}

        {pagination && <nav aria-label="比價列表分頁" className="mt-6 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">第 {pagination.page} / {pagination.totalPages} 頁</p><div className="flex gap-2"><Button variant="outline" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={pagination.page <= 1}>上一頁</Button><Button variant="outline" onClick={() => setPage(current => Math.min(pagination.totalPages, current + 1))} disabled={pagination.page >= pagination.totalPages}>下一頁</Button></div></nav>}
      </main>
    </div>
  );
}
