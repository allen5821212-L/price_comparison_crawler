import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BarChart3, ClipboardCheck, Crosshair, List, Moon, Package, RefreshCw, SlidersHorizontal, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { getCompletedRunIdToRefresh } from "@/lib/comparisonSync";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type PlatformKey = "sinya" | "coolpc" | "pchome" | "momo";
type SortMode = "coverage" | "sourceCount" | "name";

type PlatformAvailability = {
  key: PlatformKey;
  label: string;
  shortLabel: string;
  listedCount: number;
  catalogCount: number;
  listingRate: number;
};

type CategoryAvailability = {
  category: string;
  sourceCount: number;
  coolpc: { listedCount: number; listingRate: number };
  pchome: { listedCount: number; listingRate: number };
  momo: { listedCount: number; listingRate: number };
};

const platformTone: Record<PlatformKey, { text: string; track: string; fill: string }> = {
  sinya: { text: "text-primary", track: "bg-primary/15", fill: "bg-primary" },
  coolpc: { text: "text-emerald-500", track: "bg-emerald-500/15", fill: "bg-emerald-500" },
  pchome: { text: "text-sky-500", track: "bg-sky-500/15", fill: "bg-sky-500" },
  momo: { text: "text-violet-500", track: "bg-violet-500/15", fill: "bg-violet-500" },
};

function formatCount(value: number): string {
  return value.toLocaleString("zh-TW");
}

function formatRate(value: number): string {
  return `${value.toLocaleString("zh-TW", { minimumFractionDigits: value % 1 ? 1 : 0, maximumFractionDigits: 1 })}%`;
}

function averageRate(row: CategoryAvailability): number {
  return (row.coolpc.listingRate + row.pchome.listingRate + row.momo.listingRate) / 3;
}

function RateBar({ rate, platform, compact = false }: { rate: number; platform: PlatformKey; compact?: boolean }) {
  const tone = platformTone[platform];
  return (
    <div className={compact ? "min-w-28" : "min-w-36"}>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs tabular-nums">
        <span className="font-semibold text-foreground">{formatRate(rate)}</span>
      </div>
      <div
        className={`h-2 overflow-hidden rounded-full ${tone.track}`}
        role="progressbar"
        aria-label={`${platform} 上架率`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, rate)}
      >
        <div className={`h-full rounded-full ${tone.fill}`} style={{ width: `${Math.min(100, rate)}%` }} />
      </div>
    </div>
  );
}

function PlatformMetricCard({ platform, loading }: { platform: PlatformAvailability; loading: boolean }) {
  const tone = platformTone[platform.key];
  return (
    <Card className="relative overflow-hidden p-5 shadow-sm">
      <div className={`absolute inset-x-0 top-0 h-1 ${tone.fill}`} />
      {loading ? <Skeleton className="h-24 w-full" /> : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{platform.label}</p>
              <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums">
                {formatCount(platform.listedCount)}
                <span className="ml-1 text-sm font-medium text-muted-foreground">項上架</span>
              </p>
            </div>
            <Badge variant="secondary" className={`${tone.text} shrink-0 font-mono`}>
              {formatRate(platform.listingRate)}
            </Badge>
          </div>
          <div className="mt-4">
            <RateBar rate={platform.listingRate} platform={platform.key} />
            <p className="mt-2 text-xs text-muted-foreground">本次爬取 {formatCount(platform.catalogCount)} 項商品</p>
          </div>
        </>
      )}
    </Card>
  );
}

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("coverage");
  const availabilityQuery = trpc.comparison.availability.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const comparisonStatusQuery = trpc.comparison.status.useQuery(undefined, {
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  const observedCompletedRunId = useRef<number | null>(null);
  const data = availabilityQuery.data;
  const platforms = data?.platforms ?? [];
  const loading = availabilityQuery.isLoading;
  const latestCompletedRun = comparisonStatusQuery.data?.latestCompletedRun;

  useEffect(() => {
    const completedRun = comparisonStatusQuery.data?.latestCompletedRun;
    const nextRunId = getCompletedRunIdToRefresh(observedCompletedRunId.current, completedRun);

    if (observedCompletedRunId.current === null) {
      observedCompletedRunId.current = completedRun?.status === "completed" ? completedRun.id : null;
      return;
    }
    if (nextRunId === null) return;

    observedCompletedRunId.current = nextRunId;
    void availabilityQuery.refetch();
  }, [availabilityQuery, comparisonStatusQuery.data?.latestCompletedRun]);

  const categories = useMemo(() => {
    const rows = [...(data?.categories ?? [])].filter(row => row.category.toLowerCase().includes(searchQuery.trim().toLowerCase()));
    return rows.sort((left, right) => {
      if (sortMode === "sourceCount") return right.sourceCount - left.sourceCount || left.category.localeCompare(right.category, "zh-Hant");
      if (sortMode === "name") return left.category.localeCompare(right.category, "zh-Hant");
      return averageRate(right) - averageRate(left) || right.sourceCount - left.sourceCount;
    });
  }, [data?.categories, searchQuery, sortMode]);

  const syncStatusLabel = availabilityQuery.isFetching
    ? "正在同步最新資料"
    : latestCompletedRun?.id
      ? `已同步完成批次 #${latestCompletedRun.id}`
      : "等待可用資料";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-card/85 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/manus-storage/logo_50c503e0.png" alt="上架比對器" className="size-9 shrink-0 rounded-lg" />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight">上架比對器</h1>
              <p className="truncate text-xs text-muted-foreground">四平台品項覆蓋率</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={availabilityQuery.isFetching ? "secondary" : "outline"} className="hidden gap-1.5 lg:inline-flex">
              <RefreshCw className={`size-3 ${availabilityQuery.isFetching ? "animate-spin" : ""}`} />{syncStatusLabel}
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <a href="/matching" aria-label="精準比對與修正品項"><Crosshair className="size-4" /></a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>精準比對與修正品項</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <a href="/review-queue" aria-label="待審核配對佇列"><ClipboardCheck className="size-4" /></a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>待審核配對佇列</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <a href="/comparisons" aria-label="商品比價列表"><List className="size-4" /></a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>商品比價列表</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <a href="/crawler" aria-label="爬蟲監控"><Activity className="size-4" /></a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>爬蟲監控</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <a href="/rules" aria-label="配對規則"><SlidersHorizontal className="size-4" /></a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>配對規則</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => availabilityQuery.refetch()} disabled={loading} aria-label="重新載入資料">
                  <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>重新載入資料</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="切換主題">
                  {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>切換主題</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "url(/manus-storage/hero-bg_bc3a04de.jpg)", backgroundSize: "cover", backgroundPosition: "center" }} />
        <div className="absolute inset-0 bg-gradient-to-b from-background/35 via-background/75 to-background" />
        <div className="container relative py-12 md:py-16">
          <div className="max-w-3xl">
            <Badge variant="secondary" className="mb-4 gap-1.5"><BarChart3 className="size-3" /> 品項上架覆蓋分析</Badge>
            <h2 className="text-3xl font-black tracking-tight md:text-4xl lg:text-5xl">
              一眼掌握型號在各平台的<span className="text-primary">上架狀態</span>
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground md:text-lg">
              以欣亞數位商品清單為共同基準，統計原價屋、PChome 24h 與 momo 購物網可辨識的同型號上架品數與上架率；不再以價格差異作為首頁比較核心。
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant={availabilityQuery.isFetching ? "secondary" : "outline"} className="gap-1.5">
                <RefreshCw className={`size-3 ${availabilityQuery.isFetching ? "animate-spin" : ""}`} />{syncStatusLabel}
              </Badge>
            </div>
            {data && <p className="mt-4 text-sm text-muted-foreground">最後更新：<span className="font-mono font-medium text-foreground">{data.updateTime}</span></p>}
          </div>
        </div>
      </section>

      <main className="container py-8 md:py-10">
        {availabilityQuery.error ? (
          <Card className="border-destructive/40 bg-destructive/5 p-6">
            <p className="font-semibold">目前無法載入上架統計</p>
            <p className="mt-1 text-sm text-muted-foreground">{availabilityQuery.error.message}</p>
            <Button className="mt-4" onClick={() => availabilityQuery.refetch()}>再試一次</Button>
          </Card>
        ) : (
          <>
            <section aria-labelledby="platform-overview-heading">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-primary">平台總覽</p>
                  <h3 id="platform-overview-heading" className="mt-1 text-2xl font-bold tracking-tight">上架品數與覆蓋率</h3>
                </div>
                {data && <Badge variant="outline" className="gap-1.5"><Package className="size-3.5" /> 欣亞基準 {formatCount(data.sourceTotal)} 項</Badge>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {loading && Array.from({ length: 4 }).map((_, index) => <PlatformMetricCard key={index} loading platform={{ key: "sinya", label: "載入中", shortLabel: "", listedCount: 0, catalogCount: 0, listingRate: 0 }} />)}
                {!loading && platforms.map(platform => <PlatformMetricCard key={platform.key} platform={platform} loading={false} />)}
              </div>
            </section>

            {data && (
              <section className="mt-8 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
                <Card className="p-5 shadow-sm">
                  <p className="text-sm font-semibold text-primary">完整覆蓋</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums">{formatCount(data.allPlatformsListedCount)} <span className="text-base font-medium text-muted-foreground">項</span></p>
                  <p className="mt-1 text-sm text-muted-foreground">同時在原價屋、PChome 24h 與 momo 可辨識上架的欣亞商品。</p>
                </Card>
                <Card className="p-5 shadow-sm">
                  <p className="text-sm font-semibold text-primary">完整上架率</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums">{formatRate(data.allPlatformsListingRate)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">以 {formatCount(data.sourceTotal)} 項欣亞商品為分母計算。</p>
                </Card>
              </section>
            )}

            <section className="mt-10" aria-labelledby="category-coverage-heading">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-primary">分類比較</p>
                  <h3 id="category-coverage-heading" className="mt-1 text-2xl font-bold tracking-tight">各類別上架率</h3>
                  <p className="mt-1 text-sm text-muted-foreground">每個百分比皆以該分類的欣亞商品數為分母。</p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <Input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="搜尋分類..." className="sm:w-48" />
                  <select value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)} className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="coverage">依平均上架率排序</option>
                    <option value="sourceCount">依欣亞品數排序</option>
                    <option value="name">依分類名稱排序</option>
                  </select>
                </div>
              </div>

              <Card className="mt-5 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-44">欣亞分類</TableHead>
                        <TableHead className="min-w-28 text-right">欣亞品數</TableHead>
                        <TableHead className="min-w-40">原價屋</TableHead>
                        <TableHead className="min-w-40">PChome 24h</TableHead>
                        <TableHead className="min-w-40">momo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading && Array.from({ length: 6 }).map((_, index) => (
                        <TableRow key={index}><TableCell><Skeleton className="h-4 w-36" /></TableCell><TableCell><Skeleton className="ml-auto h-4 w-12" /></TableCell><TableCell><Skeleton className="h-7 w-32" /></TableCell><TableCell><Skeleton className="h-7 w-32" /></TableCell><TableCell><Skeleton className="h-7 w-32" /></TableCell></TableRow>
                      ))}
                      {!loading && categories.map(row => (
                        <TableRow key={row.category}>
                          <TableCell className="font-medium">{row.category}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{formatCount(row.sourceCount)}</TableCell>
                          <TableCell><div className="flex items-center gap-3"><span className="w-12 text-right font-mono text-sm tabular-nums">{formatCount(row.coolpc.listedCount)}</span><RateBar compact platform="coolpc" rate={row.coolpc.listingRate} /></div></TableCell>
                          <TableCell><div className="flex items-center gap-3"><span className="w-12 text-right font-mono text-sm tabular-nums">{formatCount(row.pchome.listedCount)}</span><RateBar compact platform="pchome" rate={row.pchome.listingRate} /></div></TableCell>
                          <TableCell><div className="flex items-center gap-3"><span className="w-12 text-right font-mono text-sm tabular-nums">{formatCount(row.momo.listedCount)}</span><RateBar compact platform="momo" rate={row.momo.listingRate} /></div></TableCell>
                        </TableRow>
                      ))}
                      {!loading && categories.length === 0 && <TableRow><TableCell colSpan={5} className="py-12 text-center text-muted-foreground">找不到符合的分類。</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </section>
          </>
        )}
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        <p>上架率以欣亞數位目前爬取商品作為共同分母，僅計入可辨識為同型號的跨平台上架商品。</p>
        <p className="mt-1">資料來源：欣亞數位、原價屋、PChome 24h 與 momo 購物網</p>
      </footer>
    </div>
  );
}
