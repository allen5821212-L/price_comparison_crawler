/**
 * ManualMatchDialog — 手動配對面板
 *
 * 依照《配對修正與手動配對規格_附錄》第二部分實作。
 * 點「🔍 手動配對」後開啟面板：
 * 1. 上方固定顯示我方商品完整名稱與價格
 * 2. 搜尋框即時搜尋對手站商品，預設帶入我方商品的型號關鍵字
 * 3. 結果清單結果清單顯示品名／價格／相似度，點擊即選定
 * 4. 提供「此商品對手站沒有」按鈕
 * 5. 選定後立即儲存並關閉面板
 */

import { useState, useMemo, useEffect } from "react";
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
import { Search, Check, X, PackageX, Edit3 } from "lucide-react";

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
  onConfirm: (their_id: string, their_name: string) => void;
  onReject: (their_id: string, their_name: string) => void;
  onNoMatch: () => void;
  onManualSave?: (their_name: string, their_price?: number) => void;
  rejectedIds?: Set<string>;
}

/** Extract model keywords from a product name for default search */
function extractKeywords(name: string): string {
  // Remove common prefixes and brackets, extract alphanumeric model codes
  let s = name.replace(/【[^】]*】/g, " ");
  s = s.split(/[/〈(（]/)[0];
  // Extract sequences of alphanumeric characters (model codes)
  const matches = s.match(/[A-Za-z0-9]{3,}/g);
  if (matches && matches.length > 0) {
    // Take the first 2-3 meaningful tokens
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

export function ManualMatchDialog({
  open,
  onOpenChange,
  sinyaProduct,
  coolpcProducts,
  onConfirm,
  onReject,
  onNoMatch,
  onManualSave,
  rejectedIds = new Set(),
}: ManualMatchDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");

  // Set default search query when dialog opens
  useEffect(() => {
    if (open && sinyaProduct) {
      setSearchQuery(extractKeywords(sinyaProduct.name));
    }
  }, [open, sinyaProduct]);

  // Filter CoolPC products by search query
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);

    return coolpcProducts
      .filter((p) => {
        const name = p.name.toLowerCase();
        return tokens.every((t) => name.includes(t));
      })
      .map((p) => ({
        ...p,
        sim: similarity(sinyaProduct?.name || "", p.name),
      }))
      .sort((a, b) => {
        // Sort by similarity desc, then by price proximity
        if (b.sim !== a.sim) return b.sim - a.sim;
        const priceA = sinyaProduct ? Math.abs(a.price - sinyaProduct.price) : 0;
        const priceB = sinyaProduct ? Math.abs(b.price - sinyaProduct.price) : 0;
        return priceA - priceB;
      })
      .slice(0, 50); // Limit results
  }, [searchQuery, coolpcProducts, sinyaProduct]);

  if (!sinyaProduct) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
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

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋原價屋商品..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            autoFocus
          />
        </div>

        {/* Results */}
        <ScrollArea className="flex-1 min-h-0 max-h-[40vh]">
          <div className="space-y-1">
            {searchResults.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {searchQuery.trim() ? "沒有符合的商品" : "輸入關鍵字開始搜尋"}
              </p>
            ) : (
              searchResults.map((p) => {
                const id = `cool_${p.id}`;
                const isRejected = rejectedIds.has(id);
                return (
                  <div
                    key={id}
                    className={`flex items-center gap-3 rounded-lg border border-border p-2 transition-colors hover:bg-muted/30 ${
                      isRejected ? "opacity-40" : ""
                    }`}
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
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-green-600 hover:bg-green-500/10"
                        onClick={() => {
                          onConfirm(id, p.name);
                          onOpenChange(false);
                        }}
                        title="確認配對正確"
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          onReject(id, p.name);
                        }}
                        title="標記為錯誤配對"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        {/* Manual name input section */}
        {showManualInput && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <p className="text-sm font-medium">手動輸入比對品名</p>
            <Input
              placeholder="輸入原價屋商品名稱..."
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
