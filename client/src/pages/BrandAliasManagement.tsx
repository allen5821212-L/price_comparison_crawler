import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, BadgeCheck, Plus, ShieldAlert, Tags } from "lucide-react";
import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function BrandAliasManagement() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [alias, setAlias] = useState("");
  const [canonicalName, setCanonicalName] = useState("");
  const [query, setQuery] = useState("");
  const aliasesQuery = trpc.brandAliases.listForAdmin.useQuery(undefined, { enabled: user?.role === "admin" });
  const saveAlias = trpc.brandAliases.save.useMutation({
    onSuccess: () => {
      setAlias("");
      setCanonicalName("");
      toast.success("品牌別名已儲存；下次爬蟲將載入此映射。");
      void utils.brandAliases.listForAdmin.invalidate();
    },
    onError: error => toast.error(error.message || "無法儲存品牌別名。"),
  });
  const setActive = trpc.brandAliases.setActive.useMutation({
    onSuccess: (_result, input) => {
      toast.success(input.active ? "品牌別名已啟用。" : "品牌別名已停用。 ");
      void utils.brandAliases.listForAdmin.invalidate();
    },
    onError: error => toast.error(error.message || "無法更新品牌別名狀態。"),
  });
  const aliases = aliasesQuery.data ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return aliases.filter(item => !needle || `${item.alias} ${item.canonicalName}`.toLowerCase().includes(needle));
  }, [aliases, query]);

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="flex items-center gap-2 text-primary"><Tags className="size-4" /><span className="text-sm font-medium">比對字典</span></div><h1 className="mt-1 text-2xl font-bold tracking-tight">品牌別名管理</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">將通路的英文、中文或縮寫品牌名稱指向同一標準名稱，避免同品牌商品被硬阻斷誤判為跨品牌。</p></div>
          <Button variant="outline" asChild><Link href="/rules"><ArrowLeft className="mr-2 size-4" />返回同步規則</Link></Button>
        </header>

        {user && user.role !== "admin" ? <Card className="border-destructive/30 p-8 text-center"><ShieldAlert className="mx-auto mb-3 size-7 text-destructive" /><h2 className="font-semibold">此頁限管理員使用</h2><p className="mt-1 text-sm text-muted-foreground">僅管理員可維護提供給爬蟲的品牌別名。</p></Card> : <>
          <section className="grid gap-3 sm:grid-cols-2"><Card className="p-4"><p className="text-xs text-muted-foreground">管理別名總數</p><p className="mt-1 text-2xl font-bold tabular-nums">{aliases.length}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">目前啟用</p><p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{aliases.filter(item => item.active).length}</p></Card></section>
          <Card className="p-4"><div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"><Input value={alias} onChange={event => setAlias(event.target.value)} maxLength={128} placeholder="通路別名，例如 COOLER MASTER" /><Input value={canonicalName} onChange={event => setCanonicalName(event.target.value)} maxLength={128} placeholder="標準品牌，例如 酷碼" /><Button onClick={() => saveAlias.mutate({ alias, canonicalName })} disabled={!alias.trim() || !canonicalName.trim() || saveAlias.isPending}><Plus className="mr-2 size-4" />新增或更新</Button></div><p className="mt-2 text-xs text-muted-foreground">同一別名會更新標準品牌並重新啟用；停用項目保留歷史但不會在下次爬蟲匯出。</p></Card>
          <Card className="overflow-hidden"><div className="border-b border-border p-4"><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋別名或標準品牌" /></div>{aliasesQuery.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>通路別名</TableHead><TableHead>標準品牌</TableHead><TableHead>狀態</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{filtered.length === 0 ? <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground">尚無符合條件的品牌別名。</TableCell></TableRow> : filtered.map(item => <TableRow key={item.id} className={!item.active ? "opacity-60" : ""}><TableCell className="font-medium">{item.alias}</TableCell><TableCell><Badge variant="outline" className="border-primary/30 text-primary"><BadgeCheck className="mr-1 size-3" />{item.canonicalName}</Badge></TableCell><TableCell>{item.active ? "啟用" : "停用"}</TableCell><TableCell className="text-right"><Switch checked={item.active} disabled={setActive.isPending} onCheckedChange={active => setActive.mutate({ id: item.id, active })} /></TableCell></TableRow>)}</TableBody></Table></div>}</Card>
        </>}
      </div>
    </DashboardLayout>
  );
}
