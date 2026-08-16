/**
 * ManualMatchDialog — 手動配對面板（四平台 + 鍵盤導航 + 預覽）
 *
 * 1. 上方固定顯示我方商品完整名稱與價格
 * 2. 平台分頁切換：原價屋 / PCHOME / momo
 * 3. 搜尋框即時搜尋，預設帶入我方商品的型號關鍵字
 * 4. 結果清單清單顯示品名／價格／相似度，點擊即選定
 * 5. 鍵盤導航：↑↓ 瀏覽、Enter 確認、Esc 關閉
 * 6. 搜尋結果預覽：點擊「比較」展開規格比較
 * 7. 提供「此商品對手站沒有」按鈕與手動輸入品名
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Check, X, PackageX, Edit3, ChevronDown, ChevronUp } from "lucide-react";

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

type Platform = "coolpc" | "pchome" | "momo";

interface ManualMatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sinyaProduct: {
    name: string;
    price: number;
    url: string;
    image: string;
  } | null;
  coolpcProducts: CoolpcProduct[];
  pchomeProducts?: CoolpcProduct[];
  momoProducts?: CoolpcProduct[];
  onConfirm: (their_id: string, their_name: string, platform?: Platform) => void;
  onReject: (their_id: string, their_name: string) => void;
  onNoMatch: () => void;
  onManualSave?: (their_name: string, their_price?: number) => void;
  rejectedIds?: Set<string>;
}

/** Extract model keywords from a product name for default search */
function extractKeywords(name: string): string {
  let s = name.replace(/【[^】]*】/g, " ");
  s = s.split(/[/〈(（]/)[0];
  const matches = s.match(/[A-Za-z0-9]{3,}/g);
  if (matches && matches.length > 0) {
    return matches.slice(0, 3).join(" ");
  }
  return s.trim().split(/\s+/).slice(0, 3).join(" ");
}

/** Simple string similarity for display */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  let common = 0;
  const tokensA = new Set(la.match(/[A-Za-z0-9]{3,}/g) || []);
  const tokensB = new Set(lb.match(/[A-Za-z0-9]{3,}/g) || []);
  tokensA.forEach((t) => {
    if (tokensB.has(t)) common++;
  });
  return tokensA.size > 0 ? common / Math.max(tokensA.size, tokensB.size) : 0;
}

type SpecStatus = "match" | "diff" | "missing";

interface SpecRow {
  label: string;
  ours: string[];
  theirs: string[];
  status: SpecStatus;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)));
}

function findMatches(text: string, pattern: RegExp): string[] {
  return Array.from(text.matchAll(pattern), (match) => match[0]);
}

/**
 * 從各平台常見的品名與副標題中萃取可識別的型號及硬體規格。
 * 規則故意採保守方式：無法可靠判讀時顯示「未偵測到」，不將其誤判為差異。
 */
function extractSpecRows(oursName: string, theirsName: string, theirsSubtitle = ""): SpecRow[] {
  const oursText = oursName.toUpperCase();
  const theirsText = `${theirsName} ${theirsSubtitle}`.toUpperCase();

  const modelCodes = (text: string) => unique([
    ...findMatches(text, /\b(?=[A-Z0-9-]{4,}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g),
    ...findMatches(text, /\b(?:ROG|TUF|STRIX|ISKUR|KATANA|THINKPAD|ELITEBOOK|IDEAPAD|NITRO|PREDATOR|PRIME|MORTAR|GAMING)\s+[A-Z0-9-]+(?:\s+[A-Z0-9-]+)?\b/g),
  ]);

  const capacity = (text: string) => unique(
    findMatches(text, /\b\d+(?:\.\d+)?\s?(?:TB|GB|G)\b/g)
  );

  const size = (text: string) => unique(
    [
      ...findMatches(text, /\b\d+(?:\.\d+)?\s?(?:INCH|MM|CM)\b/g),
      ...findMatches(text, /\d+(?:\.\d+)?\s?吋/g),
    ]
  );

  const frequency = (text: string) => unique(
    findMatches(text, /\b\d+(?:\.\d+)?\s?(?:HZ|MHZ|GHZ)\b/g)
  );

  const power = (text: string) => unique(
    findMatches(text, /\b\d+\s?W\b/g)
  );

  const standards = (text: string) => unique(
    [
      ...findMatches(text, /\bDDR[345]\b/g),
      ...findMatches(text, /\bPCIE?\s?[3456](?:\.0)?\b/g),
      ...findMatches(text, /\bWI-?FI\s?[5-7](?:E)?\b/g),
      ...findMatches(text, /\bUSB\s?(?:3\.2|4|C)\b/g),
      ...findMatches(text, /\b(?:MINI-ITX|M-ATX|ATX)\b/g),
      ...findMatches(text, /\bRTX\s?\d{4}[A-Z]*\b/g),
      ...findMatches(text, /\bRX\s?\d{4}[A-Z]*\b/g),
      ...findMatches(text, /\bRYZEN\s?[3579]\s?\d{4}[A-Z]*\b/g),
      ...findMatches(text, /\bI[3579]-?\d{4,5}[A-Z]*\b/g),
    ]
  );

  const cpu = (text: string) => unique([
    ...findMatches(text, /\b(?:AMD\s+)?(?:RYZEN\s*[3579]|R[3579])\s?\d{4,5}[A-Z0-9]*\b/g),
    ...findMatches(text, /\b(?:INTEL\s+)?(?:CORE\s+)?I[3579]-?\d{4,5}[A-Z0-9]*\b/g),
    ...findMatches(text, /\b(?:INTEL\s+)?CORE\s+ULTRA\s+[3579]\s+\d{3,4}[A-Z0-9]*\b/g),
  ]);

  const gpu = (text: string) => unique([
    ...findMatches(text, /\bRTX\s?\d{4}\s?(?:TI|SUPER)?\b/g),
    ...findMatches(text, /\bRX\s?\d{4}\s?(?:XT|XTX)?\b/g),
    ...findMatches(text, /\bARC\s?[A-Z]\d{3,4}\b/g),
  ]);

  const chipset = (text: string) => unique([
    ...findMatches(text, /\b(?:X|B|A|Z|H|W)\d{3,4}E?\b/g),
    ...findMatches(text, /\b(?:TRX|WRX)\d{2,3}\b/g),
  ]);

  const socket = (text: string) => unique([
    ...findMatches(text, /\bAM[45]\b/g),
    ...findMatches(text, /\bLGA\s?1[7-9]\d{2}\b/g),
  ]);

  const compare = (label: string, ours: string[], theirs: string[]): SpecRow => {
    if (ours.length === 0 || theirs.length === 0) return { label, ours, theirs, status: "missing" };
    const oursKey = [...ours].sort().join("|");
    const theirsKey = [...theirs].sort().join("|");
    return { label, ours, theirs, status: oursKey === theirsKey ? "match" : "diff" };
  };

  return [
    compare("型號 / 系列", modelCodes(oursText), modelCodes(theirsText)),
    compare("CPU", cpu(oursText), cpu(theirsText)),
    compare("GPU", gpu(oursText), gpu(theirsText)),
    compare("主機板晶片組", chipset(oursText), chipset(theirsText)),
    compare("CPU 插槽", socket(oursText), socket(theirsText)),
    compare("容量 / 記憶體", capacity(oursText), capacity(theirsText)),
    compare("尺寸", size(oursText), size(theirsText)),
    compare("頻率", frequency(oursText), frequency(theirsText)),
    compare("功率", power(oursText), power(theirsText)),
    compare("版本 / 介面", standards(oursText), standards(theirsText)),
  ];
}

const PLATFORM_LABELS: Record<Platform, string> = {
  coolpc: "原價屋",
  pchome: "PCHOME",
  momo: "momo",
};

const PLATFORM_COLORS: Record<Platform, string> = {
  coolpc: "text-orange-600 border-orange-300 bg-orange-50",
  pchome: "text-blue-600 border-blue-300 bg-blue-50",
  momo: "text-purple-600 border-purple-300 bg-purple-50",
};

export function ManualMatchDialog({
  open,
  onOpenChange,
  sinyaProduct,
  coolpcProducts,
  pchomeProducts = [],
  momoProducts = [],
  onConfirm,
  onReject,
  onNoMatch,
  onManualSave,
  rejectedIds = new Set(),
}: ManualMatchDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activePlatform, setActivePlatform] = useState<Platform>("coolpc");
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showOnlySpecDiff, setShowOnlySpecDiff] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Set default search query when dialog opens
  useEffect(() => {
    if (open && sinyaProduct) {
      setSearchQuery(extractKeywords(sinyaProduct.name));
      setActivePlatform("coolpc");
      setSelectedIndex(0);
      setExpandedId(null);
      setShowOnlySpecDiff(false);
    }
  }, [open, sinyaProduct]);

  // Get products for the active platform
  const platformProducts = useMemo(() => {
    switch (activePlatform) {
      case "coolpc": return coolpcProducts;
      case "pchome": return pchomeProducts;
      case "momo": return momoProducts;
    }
  }, [activePlatform, coolpcProducts, pchomeProducts, momoProducts]);

  // Filter products by search query
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);

    const results = platformProducts
      .filter((p) => {
        const name = p.name.toLowerCase();
        return tokens.every((t) => name.includes(t));
      })
      .map((p) => ({
        ...p,
        sim: similarity(sinyaProduct?.name || "", p.name),
        specRows: sinyaProduct ? extractSpecRows(sinyaProduct.name, p.name, p.subtitle) : [],
      }))
      .map((p) => ({
        ...p,
        hasSpecDiff: p.specRows.some((row) => row.status === "diff"),
      }));

    return (showOnlySpecDiff ? results.filter((p) => p.hasSpecDiff) : results)
      .sort((a, b) => {
        if (b.sim !== a.sim) return b.sim - a.sim;
        const priceA = sinyaProduct ? Math.abs(a.price - sinyaProduct.price) : 0;
        const priceB = sinyaProduct ? Math.abs(b.price - sinyaProduct.price) : 0;
        return priceA - priceB;
      })
      .slice(0, 50);
  }, [searchQuery, platformProducts, sinyaProduct, showOnlySpecDiff]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
    setExpandedId(null);
  }, [searchResults.length, activePlatform]);

  // Scroll selected item into view
  useEffect(() => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const selected = container.children[selectedIndex] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showManualInput) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = searchResults[selectedIndex];
      if (selected) {
        const id = `${activePlatform}_${selected.id}`;
        onConfirm(id, selected.name, activePlatform);
        onOpenChange(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  }, [searchResults, selectedIndex, activePlatform, onConfirm, onOpenChange, showManualInput]);

  if (!sinyaProduct) return null;

  // Count results per platform
  const platformCounts = {
    coolpc: coolpcProducts.length,
    pchome: pchomeProducts.length,
    momo: momoProducts.length,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="size-4" />
            手動配對
          </DialogTitle>
        </DialogHeader>

        {/* Fixed reference: Sinya product */}
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-start gap-3">
            {sinyaProduct.image && (
              <img
                src={sinyaProduct.image}
                alt=""
                className="size-12 shrink-0 rounded-md border border-border object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">
                {sinyaProduct.name}
              </p>
              <p className="mt-1 font-mono text-sm text-primary">
                NT${sinyaProduct.price.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* Platform tabs */}
        <div className="flex items-center gap-1 border-b border-border pb-1">
          {(["coolpc", "pchome", "momo"] as Platform[]).map((p) => (
            <button
              key={p}
              onClick={() => setActivePlatform(p)}
              className={`px-3 py-1.5 text-sm font-medium rounded-t-md transition-colors ${
                activePlatform === p
                  ? PLATFORM_COLORS[p] + " border-b-2"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
              }`}
            >
              {PLATFORM_LABELS[p]}
              <span className="ml-1 text-xs opacity-60">({platformCounts[p].toLocaleString()})</span>
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder={`搜尋${PLATFORM_LABELS[activePlatform]}商品...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            autoFocus
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showOnlySpecDiff}
            onChange={(e) => setShowOnlySpecDiff(e.target.checked)}
            className="size-3.5 rounded border-input accent-amber-500"
          />
          僅顯示有規格差異的商品
        </label>

        {/* Results */}
        <ScrollArea className="flex-1 min-h-0 max-h-[40vh]">
          <div className="space-y-1" ref={scrollRef}>
            {searchResults.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {searchQuery.trim() ? `沒有符合的${PLATFORM_LABELS[activePlatform]}商品` : "輸入關鍵字開始搜尋"}
              </p>
            ) : (
              searchResults.map((p, idx) => {
                const id = `${activePlatform}_${p.id}`;
                const isRejected = rejectedIds.has(id);
                const isSelected = idx === selectedIndex;
                const isExpanded = expandedId === id;
                const specRows = isExpanded ? p.specRows : [];
                const detectedSpecRows = specRows.filter((row) => row.ours.length > 0 || row.theirs.length > 0);
                const diffCount = detectedSpecRows.filter((row) => row.status === "diff").length;
                return (
                  <div key={id}>
                    <div
                      className={`group flex items-center gap-3 rounded-lg border p-2 transition-all cursor-pointer ${
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:border-primary/50 hover:bg-primary/5"
                      } ${isRejected ? "opacity-40" : ""}`}
                      onClick={() => {
                        onConfirm(id, p.name, activePlatform);
                        onOpenChange(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      {p.image && (
                        <img
                          src={p.image}
                          alt=""
                          className="size-10 shrink-0 rounded border border-border object-cover"
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-primary">
                            NT${p.price.toLocaleString()}
                          </span>
                          {p.original_price && p.original_price > p.price && (
                            <span className="font-mono text-xs text-muted-foreground line-through">
                              NT${p.original_price.toLocaleString()}
                            </span>
                          )}
                          {p.sim > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {(p.sim * 100).toFixed(0)}% 相似
                            </Badge>
                          )}
                          {isRejected && (
                            <Badge variant="outline" className="text-xs text-destructive">
                              已排除
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:bg-muted/50"
                          onClick={() => setExpandedId(isExpanded ? null : id)}
                          title="比較規格"
                        >
                          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </Button>
                        <Button
                          size="sm"
                          className={`bg-green-600 text-white hover:bg-green-700 transition-opacity ${
                            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                          onClick={() => {
                            onConfirm(id, p.name, activePlatform);
                            onOpenChange(false);
                          }}
                          title="確認配對正確"
                        >
                          <Check className="size-4" />
                          選擇
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 transition-opacity opacity-0 group-hover:opacity-100"
                          onClick={() => {
                            onReject(id, p.name);
                          }}
                          title="標記為錯誤配對"
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </div>
                    {/* Preview comparison panel */}
                    {isExpanded && (
                      <div className="ml-4 mb-1 rounded-lg border border-border bg-muted/20 p-3 text-xs space-y-2">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="font-semibold text-muted-foreground mb-1">欣亞商品</p>
                            <p className="font-medium">{sinyaProduct.name}</p>
                            <p className="font-mono text-primary mt-1">NT${sinyaProduct.price.toLocaleString()}</p>
                            {sinyaProduct.url && (
                              <a href={sinyaProduct.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline mt-1 inline-block">
                                前往欣亞商品頁 →
                              </a>
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-muted-foreground mb-1">{PLATFORM_LABELS[activePlatform]}商品</p>
                            <p className="font-medium">{p.name}</p>
                            <p className="font-mono text-primary mt-1">NT${p.price.toLocaleString()}</p>
                            {p.url && (
                              <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline mt-1 inline-block">
                                前往{PLATFORM_LABELS[activePlatform]}商品頁 →
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="border-t border-border pt-2">
                          <p className="text-muted-foreground">
                            價差：NT${Math.abs(sinyaProduct.price - p.price).toLocaleString()}
                            {sinyaProduct.price < p.price ? "（欣亞較便宜）" : sinyaProduct.price > p.price ? `（${PLATFORM_LABELS[activePlatform]}較便宜）` : "（價格相同）"}
                          </p>
                          {p.subtitle && <p className="text-muted-foreground mt-1">規格：{p.subtitle}</p>}
                        </div>
                        <div className="border-t border-border pt-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="font-semibold text-foreground">自動萃取型號與規格</p>
                            {detectedSpecRows.length === 0 ? (
                              <Badge variant="outline" className="text-xs text-muted-foreground">未偵測到可比較規格</Badge>
                            ) : diffCount > 0 ? (
                              <Badge className="text-xs bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400">
                                偵測到 {diffCount} 項差異
                              </Badge>
                            ) : (
                              <Badge className="text-xs bg-green-500/15 text-green-700 hover:bg-green-500/20 dark:text-green-400">
                                已萃取規格相同
                              </Badge>
                            )}
                          </div>
                          {detectedSpecRows.length > 0 && (
                            <div className="overflow-hidden rounded-md border border-border">
                              <div className="grid grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)] bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                                <div className="px-2 py-1.5">欄位</div>
                                <div className="border-l border-border px-2 py-1.5">欣亞</div>
                                <div className="border-l border-border px-2 py-1.5">{PLATFORM_LABELS[activePlatform]}</div>
                              </div>
                              {detectedSpecRows.map((row) => (
                                <div key={row.label} className="grid grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)] border-t border-border text-[11px]">
                                  <div className="flex items-center gap-1 px-2 py-1.5 font-medium text-muted-foreground">
                                    <span className={`size-1.5 shrink-0 rounded-full ${row.status === "match" ? "bg-green-500" : row.status === "diff" ? "bg-amber-500" : "bg-muted-foreground/40"}`} />
                                    {row.label}
                                  </div>
                                  <div className={`border-l border-border px-2 py-1.5 break-words ${row.status === "diff" ? "bg-amber-500/5 text-amber-800 dark:text-amber-300" : ""}`}>
                                    {row.ours.length > 0 ? row.ours.join("、") : "未偵測到"}
                                  </div>
                                  <div className={`border-l border-border px-2 py-1.5 break-words ${row.status === "diff" ? "bg-amber-500/5 text-amber-800 dark:text-amber-300" : ""}`}>
                                    {row.theirs.length > 0 ? row.theirs.join("、") : "未偵測到"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <p className="mt-2 text-[11px] text-muted-foreground">綠點為相同，黃點為偵測到的規格差異；未偵測到不代表規格相同。</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        {/* Keyboard hint */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground px-1">
          <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1">↑↓</kbd> 瀏覽</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1">Enter</kbd> 確認</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1">Esc</kbd> 關閉</span>
        </div>

        {/* Manual name input section */}
        {showManualInput && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <p className="text-sm font-medium">手動輸入比對品名</p>
            <Input
              placeholder="輸入商品名稱..."
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="價格（選填，例如 9999）"
              type="number"
              value={manualPrice}
              onChange={(e) => setManualPrice(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!manualName.trim()}
                onClick={() => {
                  if (onManualSave) {
                    const price = manualPrice.trim() ? parseInt(manualPrice, 10) : undefined;
                    onManualSave(manualName.trim(), price);
                  }
                  setShowManualInput(false);
                  setManualName("");
                  setManualPrice("");
                  onOpenChange(false);
                }}
              >
                <Check className="size-4" />
                存檔
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowManualInput(false);
                  setManualName("");
                  setManualPrice("");
                }}
              >
                取消
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onNoMatch();
                onOpenChange(false);
              }}
            >
              <PackageX className="size-4" />
              此商品對手站沒有
            </Button>
            {!showManualInput && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowManualInput(true)}
              >
                <Edit3 className="size-4" />
                手動輸入品名
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
