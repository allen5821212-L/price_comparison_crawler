/**
 * PriceHistoryDialog — 價格歷史趨勢圖
 *
 * 從動態資料庫 API 載入價格歷史，以 SVG 繪製折線圖展示商品價格變化趨勢。
 * 支援搜尋商品名稱，顯示欣亞與原價屋兩條價格線。
 */

import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface PriceSnapshot {
  sinya_name: string;
  coolpc_name: string;
  sinya_price: number;
  coolpc_price: number;
  price_diff: number;
}

interface HistoryDay {
  date: string;
  matched: PriceSnapshot[];
}

interface PriceHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProduct?: string | null;
}

export function PriceHistoryDialog({ open, onOpenChange, initialProduct }: PriceHistoryDialogProps) {
  const historyQuery = trpc.comparison.history.useQuery(undefined, { enabled: open });
  const history = (historyQuery.data ?? []) as HistoryDay[];
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

  useEffect(() => {
    if (open && initialProduct) {
      setSearch(initialProduct);
      setSelectedProduct(initialProduct);
    }
  }, [initialProduct, open]);

  // Build product list from latest snapshot
  const productList = useMemo(() => {
    if (history.length === 0) return [];
    const latest = history[history.length - 1];
    return latest.matched
      .map((m) => ({
        sinya_name: m.sinya_name,
        coolpc_name: m.coolpc_name,
        display: m.sinya_name.length > 40 ? m.sinya_name.substring(0, 40) + "..." : m.sinya_name,
      }))
      .filter((p, i, arr) => arr.findIndex((x) => x.sinya_name === p.sinya_name) === i)
      .sort((a, b) => a.display.localeCompare(b.display, "zh-TW"));
  }, [history]);

  const filteredProducts = useMemo(() => {
    if (!search) return productList.slice(0, 50);
    return productList
      .filter((p) => p.sinya_name.toLowerCase().includes(search.toLowerCase()))
      .slice(0, 50);
  }, [productList, search]);

  // Get price trend for selected product
  const trendData = useMemo(() => {
    if (!selectedProduct || history.length === 0) return [];
    return history
      .map((day) => {
        const match = day.matched.find((m) => m.sinya_name === selectedProduct);
        if (!match) return null;
        return {
          date: day.date,
          sinya_price: match.sinya_price,
          coolpc_price: match.coolpc_price,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  }, [selectedProduct, history]);

  // SVG chart dimensions
  const chartW = 600;
  const chartH = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const plotW = chartW - padding.left - padding.right;
  const plotH = chartH - padding.top - padding.bottom;

  // Calculate scales
  const { minY, maxY, xScale, yScale } = useMemo((): { minY: number; maxY: number; xScale: number; yScale: number } => {
    if (trendData.length === 0) return { minY: 0, maxY: 0, xScale: 0, yScale: 0 };
    const allPrices = trendData.flatMap((d) => [d.sinya_price, d.coolpc_price]);
    const minP = Math.min(...allPrices);
    const maxP = Math.max(...allPrices);
    const range = maxP - minP || 1;
    const lo = minP - range * 0.1;
    const hi = maxP + range * 0.1;
    return {
      minY: lo,
      maxY: hi,
      xScale: trendData.length > 1 ? plotW / (trendData.length - 1) : 0,
      yScale: plotH / (hi - lo || 1),
    };
  }, [trendData]);

  // Build SVG path for a price series
  const buildPath = (prices: number[]) => {
    if (prices.length === 0) return "";
    return prices
      .map((p, i) => {
        const x = padding.left + i * xScale;
        const y = padding.top + plotH - (p - minY) * yScale;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  };

  const sinyaPath = buildPath(trendData.map((d) => d.sinya_price));
  const coolpcPath = buildPath(trendData.map((d) => d.coolpc_price));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>價格歷史趨勢圖</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 items-center mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="搜尋商品名稱..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {history.length} 天歷史
          </span>
        </div>

        <div className="flex gap-4 flex-1 overflow-hidden">
          {/* Product list */}
          <div className="w-64 overflow-y-auto border rounded-md">
            {filteredProducts.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {history.length === 0 ? "尚無歷史資料" : "找不到商品"}
              </p>
            ) : (
              filteredProducts.map((p) => (
                <button
                  key={p.sinya_name}
                  onClick={() => setSelectedProduct(p.sinya_name)}
                  className={`block w-full text-left px-3 py-2 text-sm border-b transition-colors ${
                    selectedProduct === p.sinya_name
                      ? "bg-primary/10 text-primary font-medium"
                      : "hover:bg-muted/50"
                  }`}
                >
                  {p.display}
                </button>
              ))
            )}
          </div>

          {/* Chart area */}
          <div className="flex-1 flex flex-col">
            {selectedProduct && trendData.length > 0 ? (
              <>
                <div className="flex gap-4 mb-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-0.5 bg-blue-500" />
                    欣亞
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-0.5 bg-orange-500" />
                    原價屋
                  </span>
                </div>
                <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-auto">
                  {/* Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                    const y = padding.top + plotH * t;
                    const val = Math.round(maxY - (maxY - minY) * t);
                    return (
                      <g key={t}>
                        <line
                          x1={padding.left}
                          y1={y}
                          x2={padding.left + plotW}
                          y2={y}
                          stroke="currentColor"
                          strokeOpacity={0.1}
                        />
                        <text
                          x={padding.left - 8}
                          y={y + 4}
                          textAnchor="end"
                          className="fill-muted-foreground text-[10px]"
                        >
                          ${val.toLocaleString()}
                        </text>
                      </g>
                    );
                  })}
                  {/* X axis labels */}
                  {trendData.map((d, i) => {
                    if (trendData.length > 10 && i % Math.ceil(trendData.length / 6) !== 0) return null;
                    const x = padding.left + i * xScale;
                    return (
                      <text
                        key={d.date}
                        x={x}
                        y={chartH - 8}
                        textAnchor="middle"
                        className="fill-muted-foreground text-[10px]"
                      >
                        {d.date.substring(5)}
                      </text>
                    );
                  })}
                  {/* Sinya price line */}
                  <path d={sinyaPath} fill="none" stroke="#3b82f6" strokeWidth={2} />
                  {trendData.map((d, i) => {
                    const x = padding.left + i * xScale;
                    const y = padding.top + plotH - (d.sinya_price - minY) * yScale;
                    return <circle key={`s${i}`} cx={x} cy={y} r={3} fill="#3b82f6" />;
                  })}
                  {/* CoolPC price line */}
                  <path d={coolpcPath} fill="none" stroke="#f97316" strokeWidth={2} />
                  {trendData.map((d, i) => {
                    const x = padding.left + i * xScale;
                    const y = padding.top + plotH - (d.coolpc_price - minY) * yScale;
                    return <circle key={`c${i}`} cx={x} cy={y} r={3} fill="#f97316" />;
                  })}
                </svg>
                <div className="mt-2 text-xs text-muted-foreground">
                  {trendData.length} 筆記錄 | 最新價差: NT$
                  {trendData[trendData.length - 1].sinya_price - trendData[trendData.length - 1].coolpc_price}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                {selectedProduct ? "此商品尚無足夠歷史資料" : "請從左側選擇商品查看價格趨勢"}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
