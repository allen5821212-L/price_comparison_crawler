import { useState, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  ShoppingCart,
  BarChart3,
  Package,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

interface MatchedProduct {
  name: string;
  sinya_name: string;
  coolpc_name: string;
  sinya_price: number;
  coolpc_price: number;
  price_diff: number;
  cheaper: "sinya" | "coolpc" | "tie";
  sinya_url: string;
  coolpc_url: string;
  sinya_image: string;
  coolpc_image: string;
  category: string;
}

interface Stats {
  update_time: string;
  sinya_total: number;
  coolpc_total: number;
  matched_total: number;
  sinya_cheaper: number;
  coolpc_cheaper: number;
  same_price: number;
  avg_price_diff: number;
}

interface CoolpcProduct {
  source: string;
  id: number;
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
  matched: MatchedProduct[];
  sinya_products: Array<Record<string, unknown>>;
  coolpc_products: CoolpcProduct[];
  sinya_categories: string[];
}

type SortField = "price_diff" | "sinya_price" | "coolpc_price" | "name";
type SortOrder = "asc" | "desc";
type CheaperFilter = "all" | "sinya" | "coolpc" | "tie";

function formatPrice(price: number): string {
  return `NT$${price.toLocaleString()}`;
}

function formatPriceDiff(diff: number): string {
  if (diff > 0) return `+${formatPrice(diff)}`;
  if (diff < 0) return `-${formatPrice(Math.abs(diff))}`;
  return "NT$0";
}

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [coolpcCategoryFilter, setCoolpcCategoryFilter] = useState("all");
  const [cheaperFilter, setCheaperFilter] = useState<CheaperFilter>("all");
  const [sortField, setSortField] = useState<SortField>("price_diff");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/data/comparison.json");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as ComparisonData;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入資料失敗");
    } finally {
      setLoading(false);
    }
  };

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
    if (!data || !data.coolpc_products) return [];
    const counts: Record<string, number> = {};
    data.coolpc_products.forEach((p) => {
      if (p.category) counts[p.category] = (counts[p.category] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [data]);

  const filteredAndSorted = useMemo(() => {
    if (!data) return [];
    let result = [...data.matched];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.sinya_name.toLowerCase().includes(q) ||
          m.coolpc_name.toLowerCase().includes(q)
      );
    }

    // Sinya category filter
    if (categoryFilter !== "all") {
      result = result.filter((m) => m.category === categoryFilter);
    }

    // CoolPC category filter — check if the matched coolpc product belongs to the selected coolpc category
    if (coolpcCategoryFilter !== "all") {
      const coolpcProductMap = new Map<string, string>();
      if (data) {
        data.coolpc_products.forEach((p) => {
          coolpcProductMap.set(p.name, p.category);
        });
      }
      result = result.filter((m) => {
        const cpCat = coolpcProductMap.get(m.coolpc_name);
        return cpCat === coolpcCategoryFilter;
      });
    }

    // Cheaper filter
    if (cheaperFilter !== "all") {
      result = result.filter((m) => m.cheaper === cheaperFilter);
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "price_diff":
          cmp = a.price_diff - b.price_diff;
          break;
        case "sinya_price":
          cmp = a.sinya_price - b.sinya_price;
          break;
        case "coolpc_price":
          cmp = a.coolpc_price - b.coolpc_price;
          break;
        case "name":
          cmp = a.name.localeCompare(b.name, "zh-TW");
          break;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return result;
  }, [data, searchQuery, categoryFilter, cheaperFilter, sortField, sortOrder]);

  const totalPages = Math.ceil(filteredAndSorted.length / itemsPerPage);
  const paginatedItems = filteredAndSorted.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryFilter, coolpcCategoryFilter, cheaperFilter, sortField, sortOrder]);

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

  return (
    <div className="min-h-screen bg-background">
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
              自動爬取欣亞數位與原價屋的全站商品，即時比對同一型號的價格差異，
              幫你在買電腦零件時省下最多錢。
            </p>
            {data && (
              <p className="mt-3 text-sm text-muted-foreground">
                最後更新：
                <span className="font-mono font-medium text-foreground">
                  {data.stats.update_time}
                </span>
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Stats Cards ── */}
      <section className="container py-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
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
            icon={<Minus className="size-4" />}
            label="價格相同"
            value={data ? data.stats.same_price : null}
            color="text-muted-foreground"
            loading={loading}
          />
        </div>
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
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full md:w-52">
              <SelectValue placeholder="欣亞分類" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分類</SelectItem>
              {categories.map((cat) => {
                const count = categoryCounts[cat] || 0;
                return (
                  <SelectItem key={cat} value={cat}>
                    {cat} {count > 0 ? `(${count})` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Select value={coolpcCategoryFilter} onValueChange={setCoolpcCategoryFilter}>
            <SelectTrigger className="w-full md:w-52">
              <SelectValue placeholder="原價屋分類" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">原價屋全部分類</SelectItem>
              {coolpcCategories.map((cat) => (
                <SelectItem key={cat.name} value={cat.name}>
                  {cat.name} ({cat.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={cheaperFilter}
            onValueChange={(v) => setCheaperFilter(v as CheaperFilter)}
          >
            <SelectTrigger className="w-full md:w-44">
              <SelectValue placeholder="價格比較" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="sinya">欣亞較便宜</SelectItem>
              <SelectItem value="coolpc">原價屋較便宜</SelectItem>
              <SelectItem value="tie">價格相同</SelectItem>
            </SelectContent>
          </Select>
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
                共 {filteredAndSorted.length} 筆結果，第 {currentPage}/
                {totalPages || 1} 頁
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-[35%]">
                      <button
                        onClick={() => handleSort("name")}
                        className="flex items-center gap-1.5 font-semibold hover:text-foreground"
                      >
                        商品名稱 {getSortIcon("name")}
                      </button>
                    </TableHead>
                    <TableHead className="w-[12%]">分類</TableHead>
                    <TableHead className="text-right">
                      <button
                        onClick={() => handleSort("sinya_price")}
                        className="flex items-center justify-end gap-1.5 font-semibold hover:text-foreground"
                      >
                        欣亞價格 {getSortIcon("sinya_price")}
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button
                        onClick={() => handleSort("coolpc_price")}
                        className="flex items-center justify-end gap-1.5 font-semibold hover:text-foreground"
                      >
                        原價屋價格 {getSortIcon("coolpc_price")}
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button
                        onClick={() => handleSort("price_diff")}
                        className="flex items-center justify-end gap-1.5 font-semibold hover:text-foreground"
                      >
                        價差 {getSortIcon("price_diff")}
                      </button>
                    </TableHead>
                    <TableHead className="text-center">較便宜</TableHead>
                    <TableHead className="text-center">連結</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedItems.map((item, idx) => (
                    <TableRow
                      key={`${item.sinya_name}-${idx}`}
                      className="transition-colors hover:bg-muted/30"
                    >
                      <TableCell>
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
                            <p className="truncate text-sm font-medium">
                              {item.name}
                            </p>
                            {item.sinya_name !== item.coolpc_name && (
                              <p className="truncate text-xs text-muted-foreground">
                                {item.coolpc_name}
                              </p>
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
                        {item.cheaper === "tie" && (
                          <Badge variant="secondary">相同</Badge>
                        )}
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
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
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
