import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Activity, ArrowLeft, CheckCircle2, Search, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

type StatusFilter = "all" | "active" | "inactive";

const PLATFORM_LABELS = {
  coolpc: "原價屋",
  pchome: "PCHOME",
  momo: "momo",
} as const;

const PLATFORM_STYLES = {
  coolpc: "border-orange-400/30 bg-orange-500/10 text-orange-400",
  pchome: "border-blue-400/30 bg-blue-500/10 text-blue-400",
  momo: "border-purple-400/30 bg-purple-500/10 text-purple-400",
} as const;

function formatDate(value: Date | string | null) {
  if (!value) return "尚未套用";
  return new Date(value).toLocaleString("zh-TW", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default function RulesManagement() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const rulesQuery = trpc.matchRules.listForAdmin.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const toggleRule = trpc.matchRules.setActive.useMutation({
    onMutate: async input => {
      await utils.matchRules.listForAdmin.cancel();
      const previous = utils.matchRules.listForAdmin.getData();
      utils.matchRules.listForAdmin.setData(undefined, current =>
        current?.map(rule => rule.id === input.id ? { ...rule, active: input.active } : rule),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      utils.matchRules.listForAdmin.setData(undefined, context?.previous);
      toast.error("規則狀態更新失敗，已還原原本設定");
    },
    onSuccess: (_data, input) => toast.success(input.active ? "規則已啟用" : "規則已停用，不會在下次爬蟲套用"),
    onSettled: () => utils.matchRules.listForAdmin.invalidate(),
  });

  const rules = rulesQuery.data || [];
  const filteredRules = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rules.filter(rule => {
      const matchesStatus = status === "all" || (status === "active" ? rule.active : !rule.active);
      const haystack = [rule.sinyaName, rule.targetName, rule.sourceAlias, rule.targetAlias, rule.platform]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesStatus && (!needle || haystack.includes(needle));
    });
  }, [query, rules, status]);

  const activeCount = rules.filter(rule => rule.active).length;
  const totalHits = rules.reduce((sum, rule) => sum + rule.hitCount, 0);

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-primary">
              <SlidersHorizontal className="size-4" />
              <span className="text-sm font-medium">人工配對回饋</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">已同步規則管理</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              已啟用的規則會在下一次爬蟲優先套用；停用後仍保留歷史與命中紀錄，可隨時重新啟用。
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/"><ArrowLeft className="mr-2 size-4" />返回比價列表</Link>
          </Button>
        </div>

        {user && user.role !== "admin" ? (
          <Card className="border-destructive/30 p-8 text-center">
            <ShieldAlert className="mx-auto mb-3 size-7 text-destructive" />
            <h2 className="font-semibold">此頁限管理員使用</h2>
            <p className="mt-1 text-sm text-muted-foreground">僅專案管理員可啟用、停用或檢視同步規則。</p>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="p-4"><p className="text-xs text-muted-foreground">同步規則總數</p><p className="mt-1 text-2xl font-bold">{rules.length}</p></Card>
              <Card className="p-4"><p className="text-xs text-muted-foreground">目前啟用</p><p className="mt-1 text-2xl font-bold text-emerald-500">{activeCount}</p></Card>
              <Card className="p-4"><p className="text-xs text-muted-foreground">累積自動套用</p><p className="mt-1 text-2xl font-bold text-primary">{totalHits}</p></Card>
            </div>

            <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={query} onChange={event => setQuery(event.target.value)} className="pl-9" placeholder="搜尋欣亞品名、目標品名或型號別名" />
                </div>
                <Select value={status} onValueChange={value => setStatus(value as StatusFilter)}>
                  <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部狀態</SelectItem>
                    <SelectItem value="active">僅啟用</SelectItem>
                    <SelectItem value="inactive">僅停用</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {rulesQuery.isLoading ? (
                <div className="space-y-3 p-4">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>來源 / 目標商品</TableHead>
                        <TableHead>平台</TableHead>
                        <TableHead>型號別名</TableHead>
                        <TableHead className="text-right">套用次數</TableHead>
                        <TableHead>最後命中</TableHead>
                        <TableHead className="text-right">啟用</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRules.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="h-40 text-center text-muted-foreground">尚無符合目前條件的同步規則。</TableCell></TableRow>
                      ) : filteredRules.map(rule => (
                        <TableRow key={rule.id} className={!rule.active ? "opacity-55" : ""}>
                          <TableCell className="min-w-80">
                            <p className="max-w-md truncate font-medium" title={rule.sinyaName}>{rule.sinyaName}</p>
                            <p className="mt-1 max-w-md truncate text-xs text-muted-foreground" title={rule.targetName}>↳ {rule.targetName}</p>
                          </TableCell>
                          <TableCell><Badge variant="outline" className={PLATFORM_STYLES[rule.platform]}>{PLATFORM_LABELS[rule.platform]}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{rule.sourceAlias || "—"} <span className="mx-1">↔</span> {rule.targetAlias || "—"}</TableCell>
                          <TableCell className="text-right"><span className="inline-flex items-center gap-1 font-medium"><Activity className="size-3.5 text-primary" />{rule.hitCount}</span></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(rule.lastHitAt)}</TableCell>
                          <TableCell className="text-right"><div className="inline-flex items-center gap-2"><span className="text-xs text-muted-foreground">{rule.active ? "啟用" : "停用"}</span><Switch checked={rule.active} disabled={toggleRule.isPending} onCheckedChange={active => toggleRule.mutate({ id: rule.id, active })} /></div></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>

            <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5 text-emerald-500" />使用次數只在爬蟲確實找到目前商品並套用該規則時增加。</p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
