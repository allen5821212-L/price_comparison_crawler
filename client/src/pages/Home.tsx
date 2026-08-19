import { useState, useMemo, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  TrendingDown,
  TrendingUp,
  Minus,
  ExternalLink,
  RefreshCw,
  ArrowUpDown,
  Sun,
  Moon,
  Activity,
  RadioTower,
  ShoppingCart,
  BarChart3,
  Package,
  Check,
  X,
  Search as SearchIcon,
  Upload,
  Download,
  UserCheck,
  AlertTriangle,
  CheckCheck,
  Bell,
  Heart,
  Trash2,
  SlidersHorizontal,
  ChevronDown,
  Clock3,
  Copy,
  Github,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useOverrides } from "@/hooks/useOverrides";
import { toast } from "sonner";
import { ManualMatchDialog } from "@/components/ManualMatchDialog";
import { PriceHistoryDialog } from "@/components/PriceHistoryDialog";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  buildFailureDiagnosticsMarkdown,
  buildGitHubIssueDraftUrl,
  buildGitHubIssueLoginUrl,
} from "@/lib/githubIssueDraft";

interface MatchedProduct {
  name: string;
  source_key?: string;
  sinya_name: string;
  coolpc_name: string;
  sinya_price: number;
  coolpc_price: number;
  price_diff: number;
  cheaper: "sinya" | "coolpc" | "pchome" | "momo" | "tie";
  sinya_url: string;
  coolpc_url: string;
  sinya_image: string;
  coolpc_image: string;
  category: string;
  score?: number;
  spec_diff?: string[];
  pchome_name?: string;
  pchome_price?: number;
  pchome_url?: string;
  pchome_image?: string;
  pchome_score?: number;
  momo_name?: string;
  momo_price?: number;
  momo_url?: string;
  momo_image?: string;
  momo_score?: number;
}

interface Stats {
  update_time: string;
  sinya_total: number;
  coolpc_total: number;
  pchome_total?: number;
  momo_total?: number;
  matched_total: number;
  sinya_cheaper: number;
  coolpc_cheaper: number;
  pchome_cheaper?: number;
  momo_cheaper?: number;
  same_price: number;
  avg_price_diff: number;
  pchome_matched?: number;
  momo_matched?: number;
}

interface CoolpcProduct {
  source: string;
  id: number | string;
  name: string;
  subtitle: string;
  price: number;
  original_price: number | null;
  url: string;
  image: string;
  category: string;
}

interface ComparisonData {
  stats: Stats;
  run?: {
    id: number;
    status: string;
    startedAt?: Date | string | null;
    finishedAt?: Date | string | null;
  };
  matched: MatchedProduct[];
  sinya_products: Array<Record<string, unknown>>;
  coolpc_products: CoolpcProduct[];
  pchome_products?: CoolpcProduct[];
  momo_products?: CoolpcProduct[];
  sinya_categories: string[];
  coolpc_categories?: Array<{ name: string; count: number }>;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

type SortField = "price_diff" | "sinya_price" | "coolpc_price" | "pchome_price" | "momo_price" | "name" | "score" | "price_diff_abs" | "best_price";
type SortOrder = "asc" | "desc";
type CheaperFilter = "all" | "sinya" | "coolpc" | "pchome" | "momo" | "tie";
type ScoreFilter = "all" | "high" | "medium" | "low";
type OverrideFilter = "all" | "confirmed" | "rejected" | "no_match" | "none";

function formatRelativeTime(value: Date | string | null | undefined, now: number): string {
  if (!value) return "尚無成功更新紀錄";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "時間資料暫缺";
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (elapsedSeconds < 60) return "剛剛";
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分鐘前`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} 小時前`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} 天前`;
}

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  if (totalMinutes < 1) return "少於 1 分鐘";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} 小時${minutes ? ` ${minutes} 分鐘` : ""}` : `${minutes} 分鐘`;
}

function formatEstimate(milliseconds: number | null | undefined): string {
  return milliseconds ? `約 ${formatDuration(milliseconds)}` : "等待歷史資料";
}

function formatPrice(price: number): string {
  return `NT$${price.toLocaleString()}`;
}

function formatPriceDiff(diff: number): string {
  if (diff > 0) return `+${formatPrice(diff)}`;
  if (diff < 0) return `-${formatPrice(Math.abs(diff))}`;
  return "NT$0";
}

/** Generate a stable ID for a Sinya product (hash of name) */
function sinyaId(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return `sinya_${Math.abs(hash)}`;
}

/** Generate a stable ID for a CoolPC product */
function coolpcId(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return `cool_${Math.abs(hash)}`;
}

function platformProductId(platform: "coolpc" | "pchome" | "momo", product: CoolpcProduct): string {
  return `${platform}_${product.id}`;
}

function getOverridePlatform(theirId?: string, storedPlatform?: string): "coolpc" | "pchome" | "momo" | "manual" {
  if (storedPlatform === "pchome" || storedPlatform === "momo" || storedPlatform === "manual") return storedPlatform;
  if (theirId?.startsWith("pchome_")) return "pchome";
  if (theirId?.startsWith("momo_")) return "momo";
  if (theirId?.startsWith("manual_")) return "manual";
  return "coolpc";
}

function getCheapestPlatform(sinyaPrice: number, coolpcPrice: number, pchomePrice?: number, momoPrice?: number): MatchedProduct["cheaper"] {
  const prices: Array<[MatchedProduct["cheaper"], number]> = [
    ["sinya", sinyaPrice],
    ["coolpc", coolpcPrice],
  ];
  if (pchomePrice && pchomePrice > 0) prices.push(["pchome", pchomePrice]);
  if (momoPrice && momoPrice > 0) prices.push(["momo", momoPrice]);
  const lowestPrice = Math.min(...prices.map(([, price]) => price));
  const lowestPlatforms = prices.filter(([, price]) => price === lowestPrice);
  return lowestPlatforms.length === 1 ? lowestPlatforms[0][0] : "tie";
}

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [coolpcCategoryFilter, setCoolpcCategoryFilter] = useState("all");
  const [cheaperFilter, setCheaperFilter] = useState<CheaperFilter>("all");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [overrideFilter, setOverrideFilter] = useState<OverrideFilter>("all");
  const [specDiffFilter, setSpecDiffFilter] = useState(false);
  const [sortField, setSortField] = useState<SortField>("price_diff");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;
  const comparisonQuery = trpc.comparison.latest.useQuery({
    page: currentPage,
    pageSize: itemsPerPage,
    search: searchQuery.trim() || undefined,
    category: categoryFilter === "all" ? undefined : categoryFilter,
    coolpcCategory: coolpcCategoryFilter === "all" ? undefined : coolpcCategoryFilter,
    cheaper: cheaperFilter === "all" ? undefined : cheaperFilter,
    score: scoreFilter === "all" ? undefined : scoreFilter,
    hasSpecDiff: specDiffFilter || undefined,
    sort: sortField,
    order: sortOrder,
  }, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const data = useMemo(() => {
    if (!comparisonQuery.data) return null;
    return {
      ...comparisonQuery.data,
      // Full catalogs are intentionally fetched on demand by ManualMatchDialog.
      // These empty defaults preserve the existing override and category helpers.
      sinya_products: [],
      coolpc_products: [],
      pchome_products: [],
      momo_products: [],
    } as ComparisonData;
  }, [comparisonQuery.data]);
  const loading = comparisonQuery.isLoading;
  const error = comparisonQuery.error?.message ?? null;
  const fetchData = () => comparisonQuery.refetch();
  const utils = trpc.useUtils();
  const [requestedRefreshJobId, setRequestedRefreshJobId] = useState<number | null>(null);
  const observedCrawlerJobStatuses = useRef(new Map<number, string>());
  const hasObservedCrawlerJobs = useRef(false);
  const [refreshCompletionToast, setRefreshCompletionToast] = useState<{
    jobId: number;
    scope: "full" | "category";
    categoryName?: string | null;
  } | null>(null);
  const [refreshFailureToast, setRefreshFailureToast] = useState<{
    jobId: number;
    scope: "full" | "category";
    categoryName?: string | null;
  } | null>(null);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [issueSeverity, setIssueSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [issueLabel, setIssueLabel] = useState<"crawler" | "data" | "source">("crawler");
  const diagnosticsCopiedTimer = useRef<number | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const jobsQuery = trpc.crawler.jobs.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: 15_000,
  });
  const refreshEstimatesQuery = trpc.comparison.refreshEstimates.useQuery(undefined, { refetchInterval: 300_000 });
  const issueContextQuery = trpc.crawler.issueContext.useQuery({ jobId: refreshFailureToast?.jobId ?? 0 }, {
    enabled: user?.role === "admin" && Boolean(refreshFailureToast),
  });
  const recordIssueDraft = trpc.crawler.recordIssueDraft.useMutation({
    onSuccess: () => void utils.crawler.jobs.invalidate(),
    onError: issueError => toast.error(issueError.message || "無法記錄 Issue 草稿連結"),
  });
  const enqueueRefresh = trpc.crawler.enqueue.useMutation({
    onSuccess: (result, variables) => {
      setRequestedRefreshJobId(result.id);
      void utils.crawler.jobs.invalidate();
      const scopeLabel = variables.scope === "full" ? "完整價格更新" : `${variables.categoryName} 分類更新`;
      toast.success(result.created
        ? `${scopeLabel}工作 #${result.id} 已排入佇列`
        : `${scopeLabel}工作 #${result.id} 已在${result.status === "running" ? "執行" : "佇列"}中`);
    },
    onError: requestError => toast.error(requestError.message || "無法排入價格更新工作"),
  });
  const currentCategoryName = categoryFilter === "all" ? null : categoryFilter;
  const { requestedRefreshJob, activeFullRefreshJob, activeCategoryRefreshJob } = useMemo(() => {
    const jobs = jobsQuery.data ?? [];
    const active = (status: string) => status === "queued" || status === "running";
    return {
      requestedRefreshJob: requestedRefreshJobId === null ? undefined : jobs.find(job => job.id === requestedRefreshJobId),
      activeFullRefreshJob: jobs.find(job => job.scope === "full" && active(job.status)),
      activeCategoryRefreshJob: currentCategoryName
        ? jobs.find(job => job.scope === "category" && job.categoryName === currentCategoryName && active(job.status))
        : undefined,
    };
  }, [currentCategoryName, jobsQuery.data, requestedRefreshJobId]);
  const activeRefreshJob = requestedRefreshJob ?? activeFullRefreshJob ?? activeCategoryRefreshJob;
  const isFullRefreshActive = Boolean(activeFullRefreshJob);
  const isCurrentCategoryRefreshing = Boolean(activeCategoryRefreshJob);
  const refreshEstimate = activeRefreshJob ? refreshEstimatesQuery.data?.[activeRefreshJob.scope] : undefined;
  const refreshEstimateMs = refreshEstimate?.estimateMs ?? null;
  const refreshStartedAt = activeRefreshJob?.startedAt ? new Date(activeRefreshJob.startedAt).getTime() : null;
  const refreshElapsedMs = activeRefreshJob?.status === "running" && refreshStartedAt
    ? Math.max(0, now - refreshStartedAt)
    : 0;
  const refreshProgress = activeRefreshJob?.status === "running" && refreshEstimateMs
    ? Math.min(95, Math.max(5, Math.round((refreshElapsedMs / refreshEstimateMs) * 100)))
    : 0;
  const refreshRemainingMs = refreshEstimateMs === null ? null : Math.max(0, refreshEstimateMs - refreshElapsedMs);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!requestedRefreshJobId || !activeRefreshJob || activeRefreshJob.id !== requestedRefreshJobId) return;
    if (activeRefreshJob.status === "completed") {
      setRequestedRefreshJobId(null);
    }
    if (activeRefreshJob.status === "failed" || activeRefreshJob.status === "cancelled") {
      setRequestedRefreshJobId(null);
    }
  }, [activeRefreshJob, comparisonQuery, requestedRefreshJobId]);

  useEffect(() => {
    const jobs = jobsQuery.data;
    if (!jobs) return;

    const previousStatuses = observedCrawlerJobStatuses.current;
    if (hasObservedCrawlerJobs.current) {
      const completedJob = jobs.find(job => job.status === "completed" && (
        previousStatuses.get(job.id) === "queued" || previousStatuses.get(job.id) === "running"
      ));
      if (completedJob) {
        void comparisonQuery.refetch();
        void utils.comparison.refreshEstimates.invalidate();
        setRefreshCompletionToast({
          jobId: completedJob.id,
          scope: completedJob.scope,
          categoryName: completedJob.categoryName,
        });
      }
      const failedJob = jobs.find(job => job.status === "failed" && (
        previousStatuses.get(job.id) === "queued" || previousStatuses.get(job.id) === "running"
      ));
      if (failedJob) {
        setRefreshFailureToast({
          jobId: failedJob.id,
          scope: failedJob.scope,
          categoryName: failedJob.categoryName,
        });
      }
    } else {
      const recentFailedJob = jobs.find(job => {
        if (job.status !== "failed" || !job.finishedAt) return false;
        const finishedAt = new Date(job.finishedAt).getTime();
        return Number.isFinite(finishedAt) && Date.now() - finishedAt < 30 * 60 * 1000;
      });
      if (recentFailedJob) {
        const promptKey = `crawler-failure-prompted-${recentFailedJob.id}`;
        if (!window.sessionStorage.getItem(promptKey)) {
          window.sessionStorage.setItem(promptKey, "1");
          setRefreshFailureToast({
            jobId: recentFailedJob.id,
            scope: recentFailedJob.scope,
            categoryName: recentFailedJob.categoryName,
          });
        }
      }
    }

    observedCrawlerJobStatuses.current = new Map(jobs.map(job => [job.id, job.status]));
    hasObservedCrawlerJobs.current = true;
  }, [comparisonQuery, jobsQuery.data, utils.comparison.refreshEstimates]);

  useEffect(() => {
    if (!refreshCompletionToast) return;
    const timer = window.setTimeout(() => setRefreshCompletionToast(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [refreshCompletionToast]);

  useEffect(() => {
    if (!refreshFailureToast) return;
    const timer = window.setTimeout(() => setRefreshFailureToast(null), 16_000);
    return () => window.clearTimeout(timer);
  }, [refreshFailureToast]);

  useEffect(() => {
    setDiagnosticsCopied(false);
    setIssueSeverity("medium");
    setIssueLabel("crawler");
  }, [refreshFailureToast?.jobId]);

  useEffect(() => () => {
    if (diagnosticsCopiedTimer.current) window.clearTimeout(diagnosticsCopiedTimer.current);
  }, []);

  // Manual matching
  const overrides = useOverrides();
  const confirmedRuleMutation = trpc.matchRules.confirm.useMutation({
    onSuccess: (result) => {
      const aliases = result.sourceAlias && result.targetAlias
        ? `（型號別名：${result.sourceAlias} ↔ ${result.targetAlias}）`
        : "";
      toast.success(`已同步人工確認規則，下一次爬蟲將優先套用${aliases}`);
    },
    onError: () => toast.warning("本次配對已儲存於此裝置；請以管理員身分登入後同步至自動配對引擎"),
  });
  const favoritesQuery = trpc.favorites.list.useQuery(undefined, { enabled: Boolean(user) });
  const favoriteKeys = useMemo(() => new Set((favoritesQuery.data ?? []).filter(item => item.active).map(item => item.sourceKey)), [favoritesQuery.data]);
  const saveFavorite = trpc.favorites.save.useMutation({
    onSuccess: () => {
      toast.success("已加入收藏，後續降價會顯示在通知頁面");
      void favoritesQuery.refetch();
    },
    onError: error => toast.error(error.message || "無法加入收藏"),
  });
  const matchingRulesQuery = trpc.matchRules.listForCrawler.useQuery(undefined, { enabled: false });
  const [manualMatchOpen, setManualMatchOpen] = useState(false);
  const [showPriceHistory, setShowPriceHistory] = useState(false);
  const [activeSinyaProduct, setActiveSinyaProduct] = useState<{
    name: string;
    price: number;
    url: string;
    image: string;
  } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Use the official Sinya DIY category list (in order) from the crawler.
  // Fallback: derive from matched products if the list is missing.
  const categories = useMemo(() => {
    if (!data) return [];
    if (data.sinya_categories && data.sinya_categories.length > 0) {
      return data.sinya_categories;
    }
    const cats = new Set<string>();
    data.matched.forEach((m) => {
      if (m.category) cats.add(m.category);
    });
    return Array.from(cats).sort();
  }, [data]);

  // Count matched products per Sinya category
  const categoryCounts = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    data.matched.forEach((m) => {
      if (m.category) counts[m.category] = (counts[m.category] || 0) + 1;
    });
    return counts;
  }, [data]);

  // Get CoolPC categories from coolpc_products, sorted by product count desc
  const coolpcCategories = useMemo(() => {
    if (!data) return [];
    if (data.coolpc_categories && data.coolpc_categories.length > 0) {
      return data.coolpc_categories;
    }
    const counts: Record<string, number> = {};
    data.coolpc_products.forEach((p) => {
      if (p.category) counts[p.category] = (counts[p.category] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [data]);

  // Build a map of coolpc products by name for quick lookup
  const coolpcProductMap = useMemo(() => {
    if (!data) return new Map<string, CoolpcProduct>();
    const map = new Map<string, CoolpcProduct>();
    data.coolpc_products.forEach((p) => map.set(p.name, p));
    return map;
  }, [data]);

  // Apply overrides to matched products
  const processedMatches = useMemo(() => {
    if (!data) return [];
    return data.matched
      .map((m) => {
        const sId = sinyaId(m.sinya_name);
        const cId = coolpcId(m.coolpc_name);

        // Check if this pair is rejected
        if (overrides.isRejected(sId, cId)) {
          return null;
        }

        // 已確認的人工配對可覆蓋原價屋、PCHOME 或 momo 的對應品項。
        const confirmed = overrides.getConfirmed(sId);
        if (confirmed && confirmed.their_id) {
          const platform = getOverridePlatform(confirmed.their_id, confirmed.platform);
          if (platform === "coolpc" && confirmed.their_id !== cId) {
            const confirmedProduct = data.coolpc_products.find(
              (p) => coolpcId(p.name) === confirmed.their_id || platformProductId("coolpc", p) === confirmed.their_id
            );
            if (confirmedProduct) {
              const newDiff = m.sinya_price - confirmedProduct.price;
              return {
                ...m,
                coolpc_name: confirmedProduct.name,
                coolpc_price: confirmedProduct.price,
                coolpc_url: confirmedProduct.url,
                coolpc_image: confirmedProduct.image,
                price_diff: newDiff,
                cheaper: getCheapestPlatform(m.sinya_price, confirmedProduct.price, m.pchome_price, m.momo_price),
                _confirmed: true,
              } as MatchedProduct & { _confirmed?: boolean };
            }
          }
          if (platform === "pchome") {
            const confirmedProduct = (data.pchome_products || []).find(
              (p) => platformProductId("pchome", p) === confirmed.their_id
            );
            if (confirmedProduct) {
              return {
                ...m,
                pchome_name: confirmedProduct.name,
                pchome_price: confirmedProduct.price,
                pchome_url: confirmedProduct.url,
                pchome_image: confirmedProduct.image,
                cheaper: getCheapestPlatform(m.sinya_price, m.coolpc_price, confirmedProduct.price, m.momo_price),
                _confirmed: true,
              } as MatchedProduct & { _confirmed?: boolean };
            }
          }
          if (platform === "momo") {
            const confirmedProduct = (data.momo_products || []).find(
              (p) => platformProductId("momo", p) === confirmed.their_id
            );
            if (confirmedProduct) {
              return {
                ...m,
                momo_name: confirmedProduct.name,
                momo_price: confirmedProduct.price,
                momo_url: confirmedProduct.url,
                momo_image: confirmedProduct.image,
                cheaper: getCheapestPlatform(m.sinya_price, m.coolpc_price, m.pchome_price, confirmedProduct.price),
                _confirmed: true,
              } as MatchedProduct & { _confirmed?: boolean };
            }
          }
          if (platform === "coolpc" && confirmed.their_id === cId) {
            return {
              ...m,
              _confirmed: true,
            } as MatchedProduct & { _confirmed?: boolean };
          }
        }

        // Check if marked as no_match
        if (overrides.isNoMatch(sId)) {
          return null;
        }

        return m;
      })
      .filter((m): m is MatchedProduct & { _confirmed?: boolean } => m !== null);
  }, [data, overrides]);

  // Compute counts for each filter option
  const filterCounts = useMemo(() => {
    let cheaper = { sinya: 0, coolpc: 0, pchome: 0, momo: 0, tie: 0 };
    let score = { high: 0, medium: 0, low: 0 };
    let override = { confirmed: 0, rejected: 0, no_match: 0, none: 0 };
    let specDiff = 0;

    for (const m of processedMatches) {
      // Cheaper counts
      if (m.cheaper === "sinya") cheaper.sinya++;
      else if (m.cheaper === "coolpc") cheaper.coolpc++;
      else if (m.cheaper === "pchome") cheaper.pchome++;
      else if (m.cheaper === "momo") cheaper.momo++;
      else if (m.cheaper === "tie") cheaper.tie++;

      // Score counts
      const s = m.score ?? 0;
      if (s >= 0.85) score.high++;
      else if (s >= 0.70) score.medium++;
      else score.low++;

      // Override counts
      const sId = sinyaId(m.sinya_name);
      const confirmed = overrides.getConfirmed(sId);
      const cId = coolpcId(m.coolpc_name);
      if (confirmed) override.confirmed++;
      else if (overrides.isRejected(sId, cId)) override.rejected++;
      else if (overrides.isNoMatch(sId)) override.no_match++;
      else override.none++;

      // Spec diff count
      if (m.spec_diff && m.spec_diff.length > 0) specDiff++;
    }

    return { cheaper, score, override, specDiff, total: processedMatches.length };
  }, [processedMatches, overrides]);

  const filteredAndSorted = useMemo(() => {
    let result = [...processedMatches];

    // The dynamic API already applies search, Sinya category, cheaper platform,
    // score, specification-difference filtering, sorting, and pagination.
    // CoolPC category and local override state remain browser-side because they
    // depend on the locally stored manual review queue.
    if (coolpcCategoryFilter !== "all") {
      result = result.filter((m) => {
        const cpCat = coolpcProductMap.get(m.coolpc_name)?.category;
        return cpCat === coolpcCategoryFilter;
      });
    }

    // Override status filter
    if (overrideFilter !== "all") {
      result = result.filter((m) => {
        const sId = sinyaId(m.sinya_name);
        const cId = coolpcId(m.coolpc_name);
        if (overrideFilter === "confirmed") {
          return Boolean(overrides.getConfirmed(sId));
        }
        if (overrideFilter === "rejected") {
          return overrides.isRejected(sId, cId);
        }
        if (overrideFilter === "no_match") {
          return overrides.isNoMatch(sId);
        }
        if (overrideFilter === "none") {
          return !overrides.getConfirmed(sId) && !overrides.isRejected(sId, cId) && !overrides.isNoMatch(sId);
        }
        return true;
      });
    }

    return result;
  }, [processedMatches, coolpcCategoryFilter, overrideFilter, coolpcProductMap, overrides]);

  const totalPages = data?.pagination?.totalPages ?? 1;
  const totalResults = data?.pagination?.total ?? filteredAndSorted.length;
  const paginatedItems = filteredAndSorted;

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryFilter, coolpcCategoryFilter, cheaperFilter, scoreFilter, overrideFilter, specDiffFilter, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="size-3 opacity-40" />;
    return sortOrder === "asc" ? (
      <TrendingUp className="size-3" />
    ) : (
      <TrendingDown className="size-3" />
    );
  };

  // Manual match handlers
  const handleConfirm = (sinyaName: string, sinyaPrice: number, sinyaUrl: string, sinyaImage: string) => {
    const sId = sinyaId(sinyaName);
    setActiveSinyaProduct({ name: sinyaName, price: sinyaPrice, url: sinyaUrl, image: sinyaImage });
    setManualMatchOpen(true);
  };

  const handleRejectMatch = (sinyaName: string, sinyaProductName: string, coolpcName: string) => {
    const sId = sinyaId(sinyaName);
    const cId = coolpcId(coolpcName);
    overrides.rejectMatch(sId, sinyaName, cId, coolpcName, "使用者標記為錯誤");
  };

  const handleConfirmMatch = (sinyaName: string, coolpcName: string) => {
    const sId = sinyaId(sinyaName);
    const cId = coolpcId(coolpcName);
    overrides.confirmMatch(sId, sinyaName, cId, coolpcName);
    confirmedRuleMutation.mutate({
      sinyaName,
      targetName: coolpcName,
      targetId: cId,
      platform: "coolpc",
    });
  };

  const handleOpenManualMatch = (sinyaName: string, sinyaPrice: number, sinyaUrl: string, sinyaImage: string) => {
    setActiveSinyaProduct({ name: sinyaName, price: sinyaPrice, url: sinyaUrl, image: sinyaImage });
    setManualMatchOpen(true);
  };

  // Build set of rejected their_ids for the active sinya product
  const rejectedTheirIds = useMemo(() => {
    if (!activeSinyaProduct) return new Set<string>();
    const sId = sinyaId(activeSinyaProduct.name);
    const ids = new Set<string>();
    overrides.overrides.forEach((o) => {
      if (o.ours_id === sId && o.action === "reject" && o.their_id) {
        ids.add(o.their_id);
      }
    });
    return ids;
  }, [activeSinyaProduct, overrides.overrides]);

  const exportMatchingRules = async () => {
    const result = await matchingRulesQuery.refetch();
    const rules = result.data || [];
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), rules }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "matching-rules.json";
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`已匯出 ${rules.length} 組自動配對規則`);
  };

  const copyFailureDiagnostics = async () => {
    if (!refreshFailureToast) return;
    const diagnosticText = buildFailureDiagnosticsMarkdown(buildFailureIssueDraftInput());

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(diagnosticText);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = diagnosticText;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("Clipboard copy was rejected");
      }
      setDiagnosticsCopied(true);
      if (diagnosticsCopiedTimer.current) window.clearTimeout(diagnosticsCopiedTimer.current);
      diagnosticsCopiedTimer.current = window.setTimeout(() => setDiagnosticsCopied(false), 2_000);
      toast.success("Markdown 診斷資訊已複製，可直接貼上回報問題");
    } catch {
      toast.error("無法自動複製，請改由爬蟲監控頁查看日誌");
    }
  };

  const getGitHubIssueDraftUrl = () => {
    if (!refreshFailureToast) return "https://github.com/allen5821212-L/price-comparison-crawler-issues/issues/new";
    return buildGitHubIssueLoginUrl(buildFailureIssueDraftInput());
  };

  const buildFailureIssueDraftInput = () => {
    if (!refreshFailureToast) throw new Error("沒有可回報的失敗工作");
    return {
      jobId: refreshFailureToast.jobId,
      scope: refreshFailureToast.scope,
      categoryName: refreshFailureToast.categoryName,
      origin: window.location.origin,
      reportedAt: new Date(),
      severity: issueSeverity,
      issueLabel,
      errorSummary: issueContextQuery.data?.events ?? [],
    };
  };

  return (
    <div className="min-h-screen bg-background">
      {refreshCompletionToast ? <div className="fixed inset-x-0 top-20 z-[60] px-4 sm:top-24" role="status" aria-live="polite">
        <div className="mx-auto flex max-w-xl items-start gap-3 rounded-xl border border-emerald-400/35 bg-emerald-500/15 p-4 text-emerald-50 shadow-2xl shadow-emerald-950/30 backdrop-blur-xl animate-in slide-in-from-top-2 duration-300">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
            <Check className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-emerald-100">價格資料已成功更新</p>
            <p className="mt-0.5 text-sm text-emerald-100/80">
              {refreshCompletionToast.scope === "full"
                ? "完整四平台更新已結束，最新比價資料已載入。"
                : `${refreshCompletionToast.categoryName ?? "目前分類"}更新已結束，最新比價資料已載入。`}
            </p>
            <button
              type="button"
              className="mt-2 text-sm font-medium text-emerald-200 underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              onClick={() => {
                void comparisonQuery.refetch();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              檢視最新資料
            </button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-1 -mt-1 size-8 text-emerald-100/80 hover:bg-emerald-400/15 hover:text-white"
            aria-label="關閉更新完成提示"
            onClick={() => setRefreshCompletionToast(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div> : null}
      {refreshFailureToast ? <div className="fixed inset-x-0 top-20 z-[60] px-4 sm:top-24" role="alert" aria-live="assertive">
        <div className="mx-auto flex max-w-xl items-start gap-3 rounded-xl border border-red-400/45 bg-red-500/15 p-4 text-red-50 shadow-2xl shadow-red-950/30 backdrop-blur-xl animate-in slide-in-from-top-2 duration-300">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-red-400/20 text-red-200">
            <AlertTriangle className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-red-100">價格資料更新失敗</p>
            <p className="mt-0.5 text-sm text-red-100/80">
              {refreshFailureToast.scope === "full"
                ? "完整四平台更新未能完成，請稍後重新嘗試。"
                : `${refreshFailureToast.categoryName ?? "目前分類"}更新未能完成，請稍後重新嘗試。`}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Select value={issueSeverity} onValueChange={value => setIssueSeverity(value as typeof issueSeverity)}>
                <SelectTrigger className="h-8 border-red-300/45 bg-red-950/15 text-xs text-red-50"><SelectValue placeholder="選擇嚴重程度" /></SelectTrigger>
                <SelectContent><SelectItem value="low">嚴重程度：低</SelectItem><SelectItem value="medium">嚴重程度：中</SelectItem><SelectItem value="high">嚴重程度：高</SelectItem><SelectItem value="critical">嚴重程度：緊急</SelectItem></SelectContent>
              </Select>
              <Select value={issueLabel} onValueChange={value => setIssueLabel(value as typeof issueLabel)}>
                <SelectTrigger className="h-8 border-red-300/45 bg-red-950/15 text-xs text-red-50"><SelectValue placeholder="選擇回報分類" /></SelectTrigger>
                <SelectContent><SelectItem value="crawler">標籤：爬蟲執行器</SelectItem><SelectItem value="data">標籤：資料／比對結果</SelectItem><SelectItem value="source">標籤：來源網站</SelectItem></SelectContent>
              </Select>
            </div>
            {issueContextQuery.data?.events.length ? <div className="mt-3 rounded-lg border border-red-300/25 bg-red-950/20 px-3 py-2"><p className="text-xs font-medium text-red-100">最新錯誤摘要</p><ul className="mt-1 space-y-1 text-xs text-red-100/75">{issueContextQuery.data.events.slice(0, 2).map((event, index) => <li key={`${event.title}-${index}`} className="truncate">{event.title}{event.message ? `：${event.message}` : ""}</li>)}</ul></div> : issueContextQuery.isLoading ? <p className="mt-2 text-xs text-red-100/65">正在讀取最新錯誤摘要…</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" className="gap-1.5 border-red-300/50 bg-red-950/15 text-red-100 hover:bg-red-400/15 hover:text-white" asChild>
                <a href={`/crawler?job=${refreshFailureToast.jobId}`} onClick={() => setRefreshFailureToast(null)}>
                  <Activity className="size-3.5" />
                  查看爬蟲監控日誌
                </a>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 border-red-300/50 bg-red-950/15 text-red-100 hover:bg-red-400/15 hover:text-white"
                aria-label={diagnosticsCopied ? "Markdown 診斷資訊已複製" : "複製 Markdown 診斷資訊"}
                onClick={() => void copyFailureDiagnostics()}
              >
                {diagnosticsCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {diagnosticsCopied ? "已複製" : "複製 Markdown"}
              </Button>
              <Button type="button" size="sm" variant="outline" className="gap-1.5 border-red-300/50 bg-red-950/15 text-red-100 hover:bg-red-400/15 hover:text-white" asChild>
                <a href={getGitHubIssueDraftUrl()} target="_blank" rel="noreferrer" onClick={() => {
                  const input = buildFailureIssueDraftInput();
                  recordIssueDraft.mutate({
                    jobId: input.jobId,
                    severity: input.severity,
                    issueLabel: input.issueLabel,
                    issueDraftUrl: buildGitHubIssueDraftUrl(input),
                    errorSummary: buildFailureDiagnosticsMarkdown(input),
                  });
                }}>
                  <Github className="size-3.5" />
                  建立 GitHub Issue
                </a>
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-1.5 bg-red-500 text-white hover:bg-red-400"
                disabled={enqueueRefresh.isPending}
                onClick={() => {
                  const retryInput = refreshFailureToast.scope === "full"
                    ? { scope: "full" as const }
                    : { scope: "category" as const, categoryName: refreshFailureToast.categoryName ?? currentCategoryName ?? "" };
                  if (retryInput.scope === "category" && !retryInput.categoryName) {
                    toast.error("找不到原本的分類範圍，請先選擇分類後再更新");
                    return;
                  }
                  setRefreshFailureToast(null);
                  enqueueRefresh.mutate(retryInput);
                }}
              >
                <RefreshCw className={`size-3.5 ${enqueueRefresh.isPending ? "animate-spin" : ""}`} />
                重新嘗試
              </Button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-red-100/65">
              GitHub Issue 儲存庫為私人專案，請以具備存取權限的 GitHub 帳戶登入；若無法開啟草稿，請先複製 Markdown 診斷資訊後以其他管道回報。
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-1 -mt-1 size-8 text-red-100/80 hover:bg-red-400/15 hover:text-white"
            aria-label="關閉更新失敗提示"
            onClick={() => setRefreshFailureToast(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div> : null}
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/manus-storage/logo_50c503e0.png"
              alt="Logo"
              className="size-9 rounded-lg"
            />
            <div>
              <h1 className="text-lg font-bold leading-tight">價格比對器</h1>
              <p className="text-xs text-muted-foreground">欣亞數位 vs 原價屋</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Override stats */}
            {overrides.stats.total > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="gap-1.5 text-xs">
                    <UserCheck className="size-3" />
                    {overrides.stats.total} 筆修正
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>已確認 {overrides.stats.confirmed} 組</p>
                  <p>已排除 {overrides.stats.rejected} 組</p>
                  <p>確認無對應 {overrides.stats.noMatch} 項</p>
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden gap-2 border-primary/30 text-primary hover:bg-primary/10 sm:inline-flex"
                  disabled={user?.role !== "admin" || enqueueRefresh.isPending || isFullRefreshActive}
                  onClick={() => enqueueRefresh.mutate({ scope: "full" })}
                >
                  {enqueueRefresh.isPending || activeFullRefreshJob?.status === "running"
                    ? <RefreshCw className="size-3.5 animate-spin" />
                    : <RadioTower className="size-3.5" />}
                  {activeFullRefreshJob?.status === "queued" ? "完整更新排隊中" : activeFullRefreshJob?.status === "running" ? "完整更新中" : "即時更新價格"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{user?.role === "admin" ? "排入完整四平台爬蟲；完成後會自動重載資料" : "僅管理員可排入完整價格更新"}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="-ml-2 hidden border-primary/30 text-primary hover:bg-primary/10 sm:inline-flex" aria-label="選擇價格更新範圍">
                      <ChevronDown className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>選擇價格更新範圍</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>價格更新範圍</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={user?.role !== "admin" || enqueueRefresh.isPending || isFullRefreshActive}
                  onClick={() => enqueueRefresh.mutate({ scope: "full" })}
                >
                  <RadioTower className="mr-2 size-4 text-primary" />
                  <span className="flex-1">完整四平台更新</span>
                  <span className="text-xs text-muted-foreground">{formatEstimate(refreshEstimatesQuery.data?.full.estimateMs)}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={user?.role !== "admin" || !currentCategoryName || enqueueRefresh.isPending || isFullRefreshActive || isCurrentCategoryRefreshing}
                  onClick={() => currentCategoryName && enqueueRefresh.mutate({ scope: "category", categoryName: currentCategoryName })}
                >
                  <Activity className="mr-2 size-4 text-primary" />
                  <span className="min-w-0 flex-1 truncate">更新目前分類{currentCategoryName ? `：${currentCategoryName}` : ""}</span>
                  {currentCategoryName ? <span className="text-xs text-muted-foreground">{formatEstimate(refreshEstimatesQuery.data?.category.estimateMs)}</span> : null}
                </DropdownMenuItem>
                {!currentCategoryName ? <p className="px-2 py-1.5 text-xs text-muted-foreground">請先從篩選器選擇一個欣亞分類。</p> : null}
                {isFullRefreshActive ? <p className="px-2 py-1.5 text-xs text-muted-foreground">完整更新進行中；完成後即可更新單一分類。</p> : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <a href="/rules" aria-label="管理已同步規則"><SlidersHorizontal className="size-4" /></a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>管理已同步規則</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <a href="/coverage" aria-label="欣亞與原價屋上架分析"><BarChart3 className="size-4" /></a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>欣亞與原價屋上架分析</TooltipContent>
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
                  <a href="/favorites" aria-label="收藏與通知"><Bell className="size-4" /></a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>收藏與降價通知</TooltipContent>
            </Tooltip>
            {/* Export/Import */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={overrides.exportOverrides}
                  disabled={overrides.stats.total === 0}
                >
                  <Download className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>匯出人工配對表</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-primary hover:text-primary"
                  onClick={exportMatchingRules}
                  disabled={matchingRulesQuery.isFetching}
                >
                  <Download className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>匯出已同步的自動配對規則</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => importFileRef.current?.click()}
                >
                  <Upload className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>匯入人工配對表</TooltipContent>
            </Tooltip>
            <input
              ref={importFileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) overrides.importOverrides(file);
                e.target.value = "";
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={overrides.stats.total === 0}
                >
                  <Trash2 className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>清除手動標記</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={overrides.stats.confirmed === 0}
                  onClick={() => {
                    const snapshot = overrides.clearOverridesByType("confirm");
                    toast.success(`已清除 ${overrides.stats.confirmed} 筆確認標記`, {
                      action: { label: "復原", onClick: () => { overrides.restoreSnapshot(snapshot); toast.success("已復原清除操作"); } },
                    });
                  }}
                >
                  清除確認標記 ({overrides.stats.confirmed})
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={overrides.stats.rejected === 0}
                  onClick={() => {
                    const snapshot = overrides.clearOverridesByType("reject");
                    toast.success(`已清除 ${overrides.stats.rejected} 筆排除標記`, {
                      action: { label: "復原", onClick: () => { overrides.restoreSnapshot(snapshot); toast.success("已復原清除操作"); } },
                    });
                  }}
                >
                  清除排除標記 ({overrides.stats.rejected})
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={overrides.stats.noMatch === 0}
                  onClick={() => {
                    const snapshot = overrides.clearOverridesByType("no_match");
                    toast.success(`已清除 ${overrides.stats.noMatch} 筆無符合標記`, {
                      action: { label: "復原", onClick: () => { overrides.restoreSnapshot(snapshot); toast.success("已復原清除操作"); } },
                    });
                  }}
                >
                  清除無符合標記 ({overrides.stats.noMatch})
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600"
                  disabled={overrides.stats.total === 0}
                  onClick={() => {
                    const snapshot = overrides.clearAllOverrides();
                    toast.success(`已清除 ${snapshot.length} 筆手動標記`, {
                      action: { label: "復原", onClick: () => { overrides.restoreSnapshot(snapshot); toast.success("已復原清除操作"); } },
                    });
                  }}
                >
                  清除全部標記 ({overrides.stats.total})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={fetchData}
                  disabled={loading}
                >
                  <RefreshCw
                    className={`size-4 ${loading ? "animate-spin" : ""}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>重新載入資料</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleTheme}
                >
                  {theme === "dark" ? (
                    <Sun className="size-4" />
                  ) : (
                    <Moon className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>切換主題</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      {/* ── Hero Section ── */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `url(/manus-storage/hero-bg_bc3a04de.jpg)`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/50 via-background/70 to-background" />
        <div className="container relative py-12 md:py-16">
          <div className="max-w-3xl">
            <Badge variant="secondary" className="mb-4 gap-1.5">
              <Activity className="size-3" />
              即時比對系統
            </Badge>
            <h2 className="text-3xl font-black tracking-tight md:text-4xl lg:text-5xl">
              找到最便宜的
              <span className="text-primary"> 3C 零件</span>
            </h2>
            <p className="mt-4 text-base text-muted-foreground md:text-lg">
              自動爬取欣亞數位、原價屋、PCHOME 24h 與 momo 購物網的全站商品，
              即時比對同一型號的四平台價格差異，幫你在買電腦零件時省下最多錢。
            </p>
            {data && (
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <p>最近成功更新：<span className="font-medium text-foreground">{formatRelativeTime(data.run?.finishedAt ?? data.run?.startedAt, now)}</span></p>
                  <span className="text-xs">（{data.stats.update_time}）</span>
                </div>
                {activeRefreshJob ? <div className="max-w-xl rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-foreground"><Clock3 className="size-3.5 text-primary" />{activeRefreshJob.scope === "full" ? "完整四平台更新" : `${activeRefreshJob.categoryName ?? "目前分類"} 更新`}</span>
                    <Badge variant="outline" className={activeRefreshJob.status === "running" ? "border-blue-400/30 bg-blue-500/10 text-blue-500" : "border-amber-400/30 bg-amber-500/10 text-amber-500"}>
                      {activeRefreshJob.status === "running" ? refreshEstimateMs ? `估算進度 ${refreshProgress}%` : "正在建立估算" : "等待執行器"}
                    </Badge>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${refreshProgress}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {activeRefreshJob.status === "running" && refreshEstimateMs && refreshRemainingMs !== null
                      ? `已執行約 ${formatDuration(refreshElapsedMs)}；預估尚餘約 ${formatDuration(refreshRemainingMs)}。`
                      : activeRefreshJob.status === "running"
                        ? "正在累積成功工作耗時，完成後將自動提供更準確的預估。"
                        : `將由雲端執行器依序處理；預估 ${formatEstimate(refreshEstimateMs)}。`}
                  </p>
                  {refreshEstimate ? <p className="mt-1 text-[11px] text-muted-foreground/80">
                    {refreshEstimate.source === "scope_history"
                      ? `依 ${refreshEstimate.sampleSize} 次同範圍成功更新的平均耗時估算。`
                      : refreshEstimate.source === "full_history_ratio"
                        ? `尚無分類成功紀錄，暫依 ${refreshEstimate.sampleSize} 次完整更新的平均耗時比例估算。`
                        : "目前尚無足夠的成功工作資料。"}
                  </p> : null}
                </div> : null}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Stats Cards ── */}
      <section className="container py-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-9">
          <StatCard
            icon={<Package className="size-4" />}
            label="欣亞商品數"
            value={data ? data.stats.sinya_total : null}
            color="text-primary"
            loading={loading}
          />
          <StatCard
            icon={<Package className="size-4" />}
            label="原價屋商品數"
            value={data ? data.stats.coolpc_total : null}
            color="text-primary"
            loading={loading}
          />
          <StatCard
            icon={<Package className="size-4" />}
            label="PCHOME商品數"
            value={data ? data.stats.pchome_total ?? null : null}
            color="text-primary"
            loading={loading}
          />
          <StatCard
            icon={<Package className="size-4" />}
            label="momo商品數"
            value={data ? data.stats.momo_total ?? null : null}
            color="text-primary"
            loading={loading}
          />
          <StatCard
            icon={<BarChart3 className="size-4" />}
            label="比對成功"
            value={data ? data.stats.matched_total : null}
            color="text-foreground"
            loading={loading}
          />
          <StatCard
            icon={<TrendingDown className="size-4" />}
            label="欣亞較便宜"
            value={data ? data.stats.sinya_cheaper : null}
            color="price-sinya"
            loading={loading}
          />
          <StatCard
            icon={<TrendingDown className="size-4" />}
            label="原價屋較便宜"
            value={data ? data.stats.coolpc_cheaper : null}
            color="price-coolpc"
            loading={loading}
          />
          <StatCard
            icon={<TrendingDown className="size-4" />}
            label="PCHOME較便宜"
            value={data ? data.stats.pchome_cheaper ?? null : null}
            color="text-blue-500"
            loading={loading}
          />
          <StatCard
            icon={<TrendingDown className="size-4" />}
            label="momo較便宜"
            value={data ? data.stats.momo_cheaper ?? null : null}
            color="text-purple-500"
            loading={loading}
          />
        </div>

        {/* Override stats banner */}
        {overrides.stats.total > 0 && (
          <div className="mt-4 flex items-center gap-4 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
            <UserCheck className="size-4 text-primary" />
            <span>
              已人工確認 <strong>{overrides.stats.confirmed}</strong> 組
              {" ｜ "}
              已排除錯配 <strong>{overrides.stats.rejected}</strong> 組
              {" ｜ "}
              確認無對應 <strong>{overrides.stats.noMatch}</strong> 項
            </span>
          </div>
        )}
      </section>

      {/* ── Filter Bar ── */}
      <section className="container pb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜尋商品名稱或型號..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <SearchableSelect
            value={categoryFilter}
            onValueChange={setCategoryFilter}
            placeholder="欣亞分類"
            searchPlaceholder="搜尋分類..."
            options={[
              { value: "all", label: `全部分類 (${filterCounts.total})` },
              ...categories.map((cat) => ({
                value: cat,
                label: `${cat} (${categoryCounts[cat] || 0})`,
              })),
            ]}
          />
          <SearchableSelect
            value={coolpcCategoryFilter}
            onValueChange={setCoolpcCategoryFilter}
            placeholder="原價屋分類"
            searchPlaceholder="搜尋分類..."
            options={[
              { value: "all", label: `原價屋全部分類 (${data?.stats.coolpc_total ?? 0})` },
              ...coolpcCategories.map((cat) => ({
                value: cat.name,
                label: `${cat.name} (${cat.count})`,
              })),
            ]}
          />
          <Select
            value={cheaperFilter}
            onValueChange={(v) => setCheaperFilter(v as CheaperFilter)}
          >
            <SelectTrigger className="w-full md:w-44">
              <SelectValue placeholder="價格比較" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部 ({filterCounts.total})</SelectItem>
              <SelectItem value="sinya">欣亞較便宜 ({filterCounts.cheaper.sinya})</SelectItem>
              <SelectItem value="coolpc">原價屋較便宜 ({filterCounts.cheaper.coolpc})</SelectItem>
              <SelectItem value="pchome">PCHOME較便宜 ({filterCounts.cheaper.pchome || 0})</SelectItem>
              <SelectItem value="momo">momo較便宜 ({filterCounts.cheaper.momo || 0})</SelectItem>
              <SelectItem value="tie">價格相同 ({filterCounts.cheaper.tie})</SelectItem>
            </SelectContent>
          </Select>
          <Select value={scoreFilter} onValueChange={(v) => setScoreFilter(v as ScoreFilter)}>
            <SelectTrigger className="w-full md:w-40">
              <SelectValue placeholder="相似度" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部相似度 ({filterCounts.total})</SelectItem>
              <SelectItem value="high">高 (≥0.85) ({filterCounts.score.high})</SelectItem>
              <SelectItem value="medium">中 (0.70-0.85) ({filterCounts.score.medium})</SelectItem>
              <SelectItem value="low">低 (&lt;0.70) ({filterCounts.score.low})</SelectItem>
            </SelectContent>
          </Select>
          <Select value={overrideFilter} onValueChange={(v) => setOverrideFilter(v as OverrideFilter)}>
            <SelectTrigger className="w-full md:w-44">
              <SelectValue placeholder="配對狀態" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部狀態 ({filterCounts.total})</SelectItem>
              <SelectItem value="confirmed">已確認配對 ({filterCounts.override.confirmed})</SelectItem>
              <SelectItem value="rejected">已排除配對 ({filterCounts.override.rejected})</SelectItem>
              <SelectItem value="no_match">無符合商品 ({filterCounts.override.no_match})</SelectItem>
              <SelectItem value="none">未處理 ({filterCounts.override.none})</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => setSpecDiffFilter(!specDiffFilter)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors ${
              specDiffFilter
                ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "border-input bg-transparent text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <AlertTriangle className="size-3.5" />
            規格差異{filterCounts.specDiff > 0 && (
              <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                specDiffFilter
                  ? "bg-amber-600 text-white"
                  : "bg-amber-500/20 text-amber-700 dark:text-amber-400"
              }`}>
                {filterCounts.specDiff}
              </span>
            )}
          </button>
          {specDiffFilter && filteredAndSorted.some((m) => m.spec_diff && m.spec_diff.length > 0) && (
            <>
            <button
              onClick={() => {
                const toConfirm = filteredAndSorted
                  .filter((m) => m.spec_diff && m.spec_diff.length > 0)
                  .map((m) => ({
                    ours_id: sinyaId(m.sinya_name),
                    ours_name: m.sinya_name,
                    their_id: coolpcId(m.coolpc_name),
                    their_name: m.coolpc_name,
                  }));
                const snapshot = overrides.batchConfirm(toConfirm);
                toast.success(`已批次確認 ${toConfirm.length} 組配對`, {
                  action: {
                    label: "復原",
                    onClick: () => {
                      overrides.restoreSnapshot(snapshot);
                      toast.success("已復原批次確認");
                    },
                  },
                });
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-green-500 bg-green-500/10 px-3 text-sm font-medium text-green-700 transition-colors hover:bg-green-500/20 dark:text-green-400"
            >
              <CheckCheck className="size-3.5" />
              全部確認
            </button>
            <button
              onClick={() => {
                const toReject = filteredAndSorted
                  .filter((m) => m.spec_diff && m.spec_diff.length > 0)
                  .map((m) => ({
                    ours_id: sinyaId(m.sinya_name),
                    ours_name: m.sinya_name,
                    their_id: coolpcId(m.coolpc_name),
                    their_name: m.coolpc_name,
                  }));
                const snapshot = overrides.batchReject(toReject, "規格差異批次排除");
                toast.success(`已批次排除 ${toReject.length} 組配對`, {
                  action: {
                    label: "復原",
                    onClick: () => {
                      overrides.restoreSnapshot(snapshot);
                      toast.success("已復原批次排除");
                    },
                  },
                });
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-red-500 bg-red-500/10 px-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-400"
            >
              <X className="size-3.5" />
              全部排除
            </button>
            </>
          )}
          <button
            onClick={() => {
              setSortField("best_price");
              setSortOrder("asc");
              toast.info("已切換至四平台最低價排序");
            }}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors ${
              sortField === "best_price"
                ? "border-green-500 bg-green-500/10 text-green-700 dark:text-green-400"
                : "border-input bg-transparent text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <TrendingDown className="size-3.5" />
            四平台最低價
          </button>
          <button
            onClick={() => setShowPriceHistory(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <TrendingUp className="size-3.5" />
            價格趨勢
          </button>
        </div>
      </section>

      {/* ── Comparison Table ── */}
      <section className="container pb-8">
        {error ? (
          <Card className="flex flex-col items-center justify-center gap-4 p-12">
            <p className="text-destructive">載入失敗：{error}</p>
            <Button onClick={fetchData} variant="outline">
              <RefreshCw className="size-4" /> 重新嘗試
            </Button>
          </Card>
        ) : loading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : paginatedItems.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-4 p-12">
            <Search className="size-8 text-muted-foreground" />
            <p className="text-muted-foreground">沒有符合條件的商品</p>
          </Card>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                共 {totalResults} 筆結果，第 {currentPage}/
                {totalPages || 1} 頁
              </span>
            </div>
            <div className="overflow-auto rounded-xl border border-border" style={{ maxHeight: "calc(100vh - 200px)" }}>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50 sticky top-0 z-10">
                    <TableHead className="w-[22%]">
                      <button
                        onClick={() => handleSort("name")}
                        className="flex items-center gap-1.5 font-semibold hover:text-foreground"
                      >
                        商品名稱 {getSortIcon("name")}
                      </button>
                    </TableHead>
                    <TableHead className="w-[6%]">分類</TableHead>
                    <TableHead className="w-[8%] text-right">
                      <button
                        onClick={() => handleSort("sinya_price")}
                        className="flex items-center justify-end gap-1.5 font-semibold hover:text-foreground"
                      >
                        欣亞 {getSortIcon("sinya_price")}
                      </button>
                    </TableHead>
                    <TableHead className="w-[8%] text-right">
                      <button
                        onClick={() => handleSort("coolpc_price")}
                        className="flex items-center justify-end gap-1.5 font-semibold hover:text-foreground"
                      >
                        原價屋 {getSortIcon("coolpc_price")}
                      </button>
                    </TableHead>
                    <TableHead className="w-[8%] text-right">
                      <button
                        onClick={() => handleSort("pchome_price")}
                        className="flex items-center justify-end gap-1.5 font-semibold hover:text-foreground"
                      >
                        PCHOME {getSortIcon("pchome_price")}
                      </button>
                    </TableHead>
                    <TableHead className="w-[8%] text-right">
                      <button
                        onClick={() => handleSort("momo_price")}
                        className="flex items-center justify-end gap-1.5 font-semibold hover:text-foreground"
                      >
                        momo {getSortIcon("momo_price")}
                      </button>
                    </TableHead>
                    <TableHead className="w-[7%] text-right">
                      <button
                        onClick={() => handleSort("price_diff")}
                        className="flex items-center justify-end gap-1.5 font-semibold hover:text-foreground"
                      >
                        價差 {getSortIcon("price_diff")}
                      </button>
                    </TableHead>
                    <TableHead className="w-[6%] text-center">最便宜</TableHead>
                    <TableHead className="w-[7%] text-center">
                      <button
                        onClick={() => handleSort("score")}
                        className="flex items-center justify-center gap-1.5 font-semibold hover:text-foreground"
                      >
                        相似度 {getSortIcon("score")}
                      </button>
                    </TableHead>
                    <TableHead className="w-[5%] text-center">連結</TableHead>
                    <TableHead className="w-[7%] text-center">配對</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedItems.map((item, idx) => {
                    const sId = sinyaId(item.sinya_name);
                    const cId = coolpcId(item.coolpc_name);
                    const isConfirmed = overrides.getConfirmed(sId);
                    const confirmedThisPair = Boolean(isConfirmed);
                    const confirmedPlatform = isConfirmed
                      ? getOverridePlatform(isConfirmed.their_id, isConfirmed.platform)
                      : null;

                    return (
                      <TableRow
                        key={`${item.sinya_name}-${idx}`}
                        className={`transition-colors hover:bg-muted/30 ${
                          confirmedThisPair ? "bg-green-500/5" : ""
                        }`}
                      >
                        <TableCell className="whitespace-normal">
                          <div className="flex items-start gap-3">
                            {item.sinya_image && (
                              <img
                                src={item.sinya_image}
                                alt=""
                                className="size-12 shrink-0 rounded-md border border-border object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display =
                                    "none";
                                }}
                              />
                            )}
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-sm font-medium leading-tight">
                                {item.name}
                              </p>
                              {item.sinya_name !== item.coolpc_name && (
                                <p className="line-clamp-1 text-xs text-muted-foreground leading-tight mt-0.5">
                                  {item.coolpc_name}
                                </p>
                              )}
                              {confirmedThisPair && (
                                <Badge className="mt-1 gap-1 text-xs bg-green-500/15 text-green-600 hover:bg-green-500/20">
                                  <Check className="size-2.5" />
                                  已確認{confirmedPlatform === "pchome" ? " PCHOME" : confirmedPlatform === "momo" ? " momo" : ""}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.category && (
                            <Badge variant="outline" className="text-xs">
                              {item.category}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-mono text-sm ${item.cheaper === "sinya" ? "price-cheaper price-sinya" : ""}`}
                          >
                            {formatPrice(item.sinya_price)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-mono text-sm ${item.cheaper === "coolpc" ? "price-cheaper price-coolpc" : ""}`}
                          >
                            {formatPrice(item.coolpc_price)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {item.pchome_price ? (
                            <span
                              className={`font-mono text-sm ${item.cheaper === "pchome" ? "text-blue-500 font-bold" : ""}`}
                            >
                              {formatPrice(item.pchome_price)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.momo_price ? (
                            <span
                              className={`font-mono text-sm ${item.cheaper === "momo" ? "text-purple-500 font-bold" : ""}`}
                            >
                              {formatPrice(item.momo_price)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-mono text-sm ${item.price_diff < 0 ? "price-diff-positive" : item.price_diff > 0 ? "price-diff-negative" : "text-muted-foreground"}`}
                          >
                            {formatPriceDiff(item.price_diff)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {item.cheaper === "sinya" && (
                            <Badge className="bg-primary/15 text-primary hover:bg-primary/20">
                              欣亞
                            </Badge>
                          )}
                          {item.cheaper === "coolpc" && (
                            <Badge className="bg-orange-500/15 text-orange-500 hover:bg-orange-500/20">
                              原價屋
                            </Badge>
                          )}
                          {item.cheaper === "pchome" && (
                            <Badge className="bg-blue-500/15 text-blue-500 hover:bg-blue-500/20">
                              PCHOME
                            </Badge>
                          )}
                          {item.cheaper === "momo" && (
                            <Badge className="bg-purple-500/15 text-purple-500 hover:bg-purple-500/20">
                              momo
                            </Badge>
                          )}
                          {item.cheaper === "tie" && (
                            <Badge variant="secondary">相同</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            {item.score !== undefined && (
                              <span
                                className={`font-mono text-xs ${
                                  item.score >= 0.85
                                    ? "text-green-600"
                                    : item.score >= 0.70
                                    ? "text-yellow-600"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {(item.score * 100).toFixed(0)}%
                              </span>
                            )}
                            {item.spec_diff && item.spec_diff.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                    <AlertTriangle className="size-2.5" />
                                    {item.spec_diff.length}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="space-y-1">
                                    <p className="text-xs font-semibold">規格差異</p>
                                    {item.spec_diff.map((d, i) => (
                                      <p key={i} className="text-xs text-muted-foreground">{d}</p>
                                    ))}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-2">
                            {item.sinya_url && (
                              <a
                                href={item.sinya_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:opacity-70"
                                title="欣亞購買頁"
                              >
                                <ExternalLink className="size-4" />
                              </a>
                            )}
                            {item.coolpc_url && (
                              <a
                                href={item.coolpc_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-orange-500 hover:opacity-70"
                                title="原價屋購買頁"
                              >
                                <ShoppingCart className="size-4" />
                              </a>
                            )}
                            {item.pchome_url && (
                              <a
                                href={item.pchome_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:opacity-70"
                                title="PCHOME購買頁"
                              >
                                <ExternalLink className="size-3.5" />
                              </a>
                            )}
                            {item.momo_url && (
                              <a
                                href={item.momo_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-purple-500 hover:opacity-70"
                                title="momo購買頁"
                              >
                                <ShoppingCart className="size-3.5" />
                              </a>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className={favoriteKeys.has(item.source_key ?? sinyaId(item.sinya_name)) ? "size-7 text-rose-500 hover:bg-rose-500/10" : "size-7 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"}
                                  onClick={() => {
                                    if (!user) {
                                      toast.info("登入後即可收藏商品並接收降價通知");
                                      return;
                                    }
                                    const sourceKey = item.source_key ?? sinyaId(item.sinya_name);
                                    if (favoriteKeys.has(sourceKey)) {
                                      toast.info("此商品已在收藏清單中");
                                      return;
                                    }
                                    saveFavorite.mutate({ sourceKey, sinyaName: item.sinya_name });
                                  }}
                                  title="收藏商品"
                                >
                                  <Heart className="size-3.5" fill={favoriteKeys.has(item.source_key ?? sinyaId(item.sinya_name)) ? "currentColor" : "none"} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{favoriteKeys.has(item.source_key ?? sinyaId(item.sinya_name)) ? "已收藏" : "收藏並追蹤降價"}</TooltipContent>
                            </Tooltip>
                            {/* Confirm (✓) */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7 text-green-600 hover:bg-green-500/10"
                                  onClick={() =>
                                    handleConfirmMatch(item.sinya_name, item.coolpc_name)
                                  }
                                  title="標記配對正確"
                                >
                                  <Check className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>配對正確</TooltipContent>
                            </Tooltip>
                            {/* Reject (✗) */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7 text-destructive hover:bg-destructive/10"
                                  onClick={() =>
                                    handleRejectMatch(item.sinya_name, item.name, item.coolpc_name)
                                  }
                                  title="標記配對錯誤"
                                >
                                  <X className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>配對錯誤</TooltipContent>
                            </Tooltip>
                            {/* Manual match (🔍) */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7 text-muted-foreground hover:bg-muted/50"
                                  onClick={() =>
                                    handleOpenManualMatch(
                                      item.sinya_name,
                                      item.sinya_price,
                                      item.sinya_url,
                                      item.sinya_image
                                    )
                                  }
                                  title="手動配對"
                                >
                                  <SearchIcon className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>手動配對</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  上一頁
                </Button>
                <span className="px-3 text-sm text-muted-foreground">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={currentPage === totalPages}
                >
                  下一頁
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Manual Match Dialog ── */}
      <ManualMatchDialog
        open={manualMatchOpen}
        onOpenChange={setManualMatchOpen}
        sinyaProduct={activeSinyaProduct}
        onConfirm={(their_id, their_name, platform) => {
          if (activeSinyaProduct) {
            const sId = sinyaId(activeSinyaProduct.name);
            const targetPlatform = platform || "coolpc";
            overrides.confirmMatch(sId, activeSinyaProduct.name, their_id, their_name, targetPlatform);
            confirmedRuleMutation.mutate({
              sinyaName: activeSinyaProduct.name,
              targetName: their_name,
              targetId: their_id,
              platform: targetPlatform,
            });
          }
        }}
        onReject={(their_id, their_name) => {
          if (activeSinyaProduct) {
            const sId = sinyaId(activeSinyaProduct.name);
            overrides.rejectMatch(sId, activeSinyaProduct.name, their_id, their_name, "手動標記排除");
          }
        }}
        onNoMatch={() => {
          if (activeSinyaProduct) {
            const sId = sinyaId(activeSinyaProduct.name);
            overrides.markNoMatch(sId, activeSinyaProduct.name, "使用者確認無對應");
          }
        }}
        onManualSave={(their_name, their_price) => {
          if (activeSinyaProduct) {
            const sId = sinyaId(activeSinyaProduct.name);
            overrides.manualMatch(sId, activeSinyaProduct.name, their_name, their_price);
          }
        }}
        rejectedIds={rejectedTheirIds}
      />

      <PriceHistoryDialog
        open={showPriceHistory}
        onOpenChange={setShowPriceHistory}
      />

      {/* ── Footer ── */}
      <footer className="border-t border-border py-6">
        <div className="container text-center text-sm text-muted-foreground">
          <p>
            資料來源：
            <a
              href="https://www.sinya.com.tw"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              欣亞數位
            </a>
            {" × "}
            <a
              href="https://www.coolpc.com.tw"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-500 hover:underline"
            >
              原價屋
            </a>
          </p>
          <p className="mt-1 text-xs">
            本網站僅提供價格比對參考，實際價格以各網站為準
          </p>
        </div>
      </footer>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  color: string;
  loading: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <p className={`mt-2 text-2xl font-bold font-mono ${color}`}>
          {value !== null ? value.toLocaleString() : "—"}
        </p>
      )}
    </Card>
  );
}
