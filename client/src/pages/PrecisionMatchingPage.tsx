import DashboardLayout from "@/components/DashboardLayout";
import { ManualMatchDialog } from "@/components/ManualMatchDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, ExternalLink, ListChecks, Search, ShieldAlert, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type TargetPlatform = "coolpc" | "pchome" | "momo";

type SourceProduct = {
  id: string | number;
  name: string;
  price: number;
  url: string;
  image: string;
  category: string;
};

type ExistingRule = {
  sinyaName: string;
  targetName: string;
  targetId: string | null;
  platform: TargetPlatform;
  active: boolean;
  hitCount: number;
};

const PLATFORM_LABELS: Record<TargetPlatform, string> = {
  coolpc: "原價屋",
  pchome: "PChome 24h",
  momo: "momo 購物網",
};

const PLATFORM_STYLES: Record<TargetPlatform, string> = {
  coolpc: "border-emerald-400/35 bg-emerald-500/10 text-emerald-500",
  pchome: "border-sky-400/35 bg-sky-500/10 text-sky-500",
  momo: "border-violet-400/35 bg-violet-500/10 text-violet-500",
};

/** Builds the stable server contract used to overwrite a prior manual mapping. */
export function buildPreciseMatchInput(
  sinyaName: string,
  platform: TargetPlatform,
  targetId: string,
  targetName: string,
) {
  return { sinyaName, platform, targetId, targetName };
}

export function rulesForSource(rules: ExistingRule[], sinyaName: string) {
  return rules.filter(rule => rule.sinyaName === sinyaName && rule.active);
}

function formatPrice(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

export default function PrecisionMatchingPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [sourceQuery, setSourceQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState<SourceProduct | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const normalizedSourceQuery = sourceQuery.trim();
  const sourceSearch = trpc.comparison.searchProducts.useQuery(
    { platform: "sinya", query: normalizedSourceQuery, limit: 30 },
    { enabled: normalizedSourceQuery.length >= 2 },
  );
  const rulesQuery = trpc.matchRules.listForAdmin.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const matchingRules = (rulesQuery.data ?? []) as ExistingRule[];
  const selectedRules = useMemo(
    () => selectedSource ? rulesForSource(matchingRules, selectedSource.name) : [],
    [matchingRules, selectedSource],
  );
  const saveMatch = trpc.matchRules.confirm.useMutation({
    onSuccess: (_result, input) => {
      toast.success(`已儲存 ${PLATFORM_LABELS[input.platform]} 的精準對應；下一次爬蟲將優先採用。`);
      void utils.matchRules.listForAdmin.invalidate();
    },
    onError: error => toast.error(error.message || "無法儲存品項修正，請確認管理員權限後重試。"),
  });

  const selectSource = (product: SourceProduct) => {
    setSelectedSource(product);
    setSourceQuery(product.name);
  };

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <section className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-primary"><Sparkles className="size-4" /><span className="text-sm font-medium">人工精準校正</span></div>
            <h1 className="text-2xl font-bold tracking-tight">精準比對與修正品項</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              先選取欣亞來源商品，再於原價屋、PChome 24h 或 momo 搜尋候選項目。確認後會建立平台專屬的精準對應，覆寫同一來源商品原有的人工規則，並在下一次爬蟲時優先套用。
            </p>
          </div>
          <Button variant="outline" asChild><a href="/rules"><ListChecks className="mr-2 size-4" />查看已同步規則</a></Button>
        </section>

        {user?.role !== "admin" && (
          <Card className="border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-500" /><div><p className="font-medium">需要管理員權限才能儲存修正</p><p className="mt-1 text-sm text-muted-foreground">所有人皆可檢視結果；唯有管理員可建立會回饋給爬蟲的精準對應規則。</p></div></div>
          </Card>
        )}

        <Card className="p-5 shadow-sm">
          <label className="text-sm font-semibold" htmlFor="source-product-search">1. 搜尋欣亞來源品項</label>
          <p className="mt-1 text-xs text-muted-foreground">建議輸入型號、品牌或品名關鍵字，例如「B850M」或「RTX 5070」。</p>
          <div className="relative mt-3 max-w-2xl">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="source-product-search" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} className="pl-10" placeholder="搜尋欣亞商品名稱或型號…" />
          </div>

          {normalizedSourceQuery.length > 0 && normalizedSourceQuery.length < 2 && <p className="mt-3 text-sm text-muted-foreground">請至少輸入兩個字元以搜尋商品。</p>}
          {sourceSearch.isFetching && <div className="mt-4 space-y-2">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16 max-w-3xl" />)}</div>}
          {sourceSearch.data && (
            <div className="mt-4 divide-y rounded-lg border border-border">
              {sourceSearch.data.length === 0 ? <p className="p-5 text-sm text-muted-foreground">找不到符合的欣亞商品，請調整關鍵字。</p> : sourceSearch.data.map(product => {
                const selected = selectedSource?.id === product.id;
                return <button key={String(product.id)} type="button" onClick={() => selectSource(product)} className={`flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/45 ${selected ? "bg-primary/8 ring-1 ring-inset ring-primary/50" : ""}`}>
                  <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">{product.image ? <img src={product.image} alt="" className="size-full object-cover" /> : <Search className="size-4 text-muted-foreground" />}</div>
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{product.name}</p><p className="mt-1 text-xs text-muted-foreground">{product.category || "未分類"} · {formatPrice(product.price)}</p></div>
                  {selected && <Badge className="shrink-0 bg-primary/15 text-primary hover:bg-primary/15"><CheckCircle2 className="mr-1 size-3" />已選取</Badge>}
                </button>;
              })}
            </div>
          )}
        </Card>

        {selectedSource && (
          <Card className="border-primary/25 p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">{selectedSource.image ? <img src={selectedSource.image} alt="" className="size-full object-cover" /> : <Search className="size-5 text-muted-foreground" />}</div>
                <div className="min-w-0"><p className="text-xs font-semibold text-primary">2. 已選取來源品項</p><p className="mt-1 font-semibold leading-6">{selectedSource.name}</p><p className="mt-1 text-sm text-muted-foreground">{selectedSource.category || "未分類"} · {formatPrice(selectedSource.price)}</p>{selectedSource.url && <a className="mt-2 inline-flex items-center text-xs font-medium text-primary hover:underline" href={selectedSource.url} target="_blank" rel="noreferrer">開啟欣亞商品頁 <ExternalLink className="ml-1 size-3" /></a>}</div>
              </div>
              <Button onClick={() => setDialogOpen(true)} disabled={user?.role !== "admin" || saveMatch.isPending}><Search className="mr-2 size-4" />搜尋並修正平台對應</Button>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <p className="text-sm font-semibold">目前已儲存的精準對應</p>
              {rulesQuery.isLoading ? <Skeleton className="mt-3 h-12 w-full" /> : user?.role !== "admin" ? <p className="mt-2 text-sm text-muted-foreground">請以管理員帳號登入以檢視並修改已儲存規則。</p> : selectedRules.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">尚未建立人工規則；按下「搜尋並修正平台對應」開始確認。</p> : <div className="mt-3 grid gap-2 md:grid-cols-3">{selectedRules.map(rule => <div key={rule.platform} className="rounded-lg border border-border bg-muted/20 p-3"><Badge variant="outline" className={PLATFORM_STYLES[rule.platform]}>{PLATFORM_LABELS[rule.platform]}</Badge><p className="mt-2 line-clamp-2 text-sm font-medium">{rule.targetName}</p><p className="mt-1 text-xs text-muted-foreground">已套用 {rule.hitCount.toLocaleString()} 次</p></div>)}</div>}
            </div>
          </Card>
        )}
      </div>

      <ManualMatchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        sinyaProduct={selectedSource ? { name: selectedSource.name, price: selectedSource.price, url: selectedSource.url, image: selectedSource.image } : null}
        onConfirm={(targetId, targetName, platform = "coolpc") => {
          if (!selectedSource) return;
          saveMatch.mutate(buildPreciseMatchInput(selectedSource.name, platform, targetId, targetName));
        }}
        onReject={() => toast.info("已略過這個候選商品。請繼續搜尋並選擇正確對應。")}
        onNoMatch={() => toast.info("未找到時不會建立規則，避免將暫時缺貨誤判為長期無對應。")}
      />
    </DashboardLayout>
  );
}
