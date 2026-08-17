import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Bell, BellRing, CheckCheck, Heart, HeartOff, Pencil, Target } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

function formatPrice(value: number | null) { return value == null ? "未設定" : `NT$${value.toLocaleString()}`; }
function formatDate(value: Date | string) { return new Date(value).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }

export default function FavoritesPage() {
  const utils = trpc.useUtils();
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [editingFavoriteId, setEditingFavoriteId] = useState<number | null>(null);
  const [targetDraft, setTargetDraft] = useState("");
  const favoritesQuery = trpc.favorites.list.useQuery();
  const notificationsQuery = trpc.favorites.notifications.useQuery();
  const toggleFavorite = trpc.favorites.setActive.useMutation({
    onSuccess: () => { void utils.favorites.list.invalidate(); toast.success("收藏狀態已更新"); },
    onError: error => toast.error(error.message || "無法更新收藏狀態"),
  });
  const markRead = trpc.favorites.markNotificationsRead.useMutation({ onSuccess: () => void utils.favorites.notifications.invalidate() });
  const saveTarget = trpc.favorites.save.useMutation({
    onSuccess: () => {
      void utils.favorites.list.invalidate();
      setEditingFavoriteId(null);
      setTargetDraft("");
      toast.success("目標通知價格已儲存");
    },
    onError: error => toast.error(error.message || "無法儲存目標通知價格"),
  });
  const favorites = favoritesQuery.data ?? [];
  const notifications = notificationsQuery.data ?? [];
  const unread = notifications.filter(item => !item.readAt);

  return <DashboardLayout><div className="mx-auto w-full max-w-6xl space-y-6">
    <section className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between"><div className="space-y-1"><div className="flex items-center gap-2 text-rose-500"><Heart className="size-4" /><span className="text-sm font-medium">個人追蹤</span></div><h1 className="text-2xl font-bold tracking-tight">收藏商品與降價通知</h1><p className="text-sm text-muted-foreground">在比價列表點選愛心即可收藏。每次完成爬蟲後，若最低價下降或達到目標價，會產生站內通知；啟用桌面通知後，登入中的瀏覽器也會即時提醒。</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={notificationPermission === "granted" || notificationPermission === "unsupported"} onClick={async () => { const result = await Notification.requestPermission(); setNotificationPermission(result); toast(result === "granted" ? "已啟用桌面降價通知" : "未授予桌面通知權限，仍會保留站內通知"); }}><BellRing className="mr-2 size-4" />{notificationPermission === "granted" ? "桌面通知已啟用" : "啟用桌面通知"}</Button><Button variant="outline" disabled={!unread.length || markRead.isPending} onClick={() => markRead.mutate({ ids: unread.map(item => item.id) })}><CheckCheck className="mr-2 size-4" />全部標為已讀</Button></div></section>
    <div className="grid gap-3 sm:grid-cols-3"><Card className="p-4"><p className="text-xs text-muted-foreground">收藏商品</p><p className="mt-1 text-2xl font-bold">{favorites.length}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">啟用追蹤</p><p className="mt-1 text-2xl font-bold text-emerald-500">{favorites.filter(item => item.active).length}</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">未讀降價通知</p><p className="mt-1 text-2xl font-bold text-primary">{unread.length}</p></Card></div>
    <Card className="overflow-hidden"><div className="border-b border-border p-4"><h2 className="font-semibold">我的收藏</h2><p className="mt-1 text-xs text-muted-foreground">設定目標價後，最低價達標時會加上「達標」通知。</p></div>{favoritesQuery.isLoading ? <div className="space-y-3 p-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div> : <div className="divide-y divide-border">{favorites.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">尚未收藏商品。請由比價列表的愛心按鈕開始追蹤。</p> : favorites.map(item => {
      const isEditing = editingFavoriteId === item.id;
      const parsedTarget = targetDraft.trim() === "" ? null : Number(targetDraft);
      const targetIsValid = parsedTarget === null || (Number.isInteger(parsedTarget) && parsedTarget > 0);
      return <div className={!item.active ? "flex flex-col gap-3 p-4 opacity-55 sm:flex-row sm:items-center" : "flex flex-col gap-3 p-4 sm:flex-row sm:items-center"} key={item.id}><Heart className="size-4 shrink-0 text-rose-500" fill={item.active ? "currentColor" : "none"} /><div className="min-w-0 flex-1"><p className="truncate font-medium" title={item.sinyaName}>{item.sinyaName}</p><p className="mt-1 text-xs text-muted-foreground">目前追蹤價格：{formatPrice(item.lastKnownPrice)} · 目標價：{formatPrice(item.targetPrice)}</p>{isEditing ? <div className="mt-3 flex flex-wrap items-center gap-2"><Input aria-label={`${item.sinyaName} 的目標通知價格`} inputMode="numeric" type="number" min="1" step="1" placeholder="留白可清除目標價" className="h-9 w-48" value={targetDraft} onChange={event => setTargetDraft(event.target.value)} /><Button size="sm" disabled={!targetIsValid || saveTarget.isPending} onClick={() => saveTarget.mutate({ sourceKey: item.sourceKey, sinyaName: item.sinyaName, targetPrice: parsedTarget })}>儲存</Button><Button size="sm" variant="ghost" disabled={saveTarget.isPending} onClick={() => { setEditingFavoriteId(null); setTargetDraft(""); }}>取消</Button></div> : null}</div><div className="flex shrink-0 flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setEditingFavoriteId(item.id); setTargetDraft(item.targetPrice?.toString() ?? ""); }}><Pencil className="mr-2 size-3.5" />設定目標價</Button><Button size="sm" variant="outline" disabled={toggleFavorite.isPending} onClick={() => toggleFavorite.mutate({ id: item.id, active: !item.active })}>{item.active ? <><HeartOff className="mr-2 size-3.5" />停止</> : <><Heart className="mr-2 size-3.5" />恢復</>}</Button></div></div>;
    })}</div>}</Card>
    <Card className="overflow-hidden"><div className="border-b border-border p-4"><h2 className="font-semibold">通知紀錄</h2></div><div className="divide-y divide-border">{notificationsQuery.isLoading ? <div className="space-y-3 p-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div> : notifications.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">尚無降價通知。</p> : notifications.map(item => <div className={!item.readAt ? "flex gap-3 bg-primary/5 p-4" : "flex gap-3 p-4"} key={item.id}>{item.type === "target_reached" ? <Target className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <BellRing className="mt-0.5 size-4 shrink-0 text-primary" />}<div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{item.title}</p><p className="mt-1 text-sm text-muted-foreground">{item.sinyaName} · {item.message}</p></div><Badge variant="outline" className="shrink-0">{item.readAt ? "已讀" : "新通知"}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{formatDate(item.createdAt)}</p></div></div>)}</div></Card>
  </div></DashboardLayout>;
}
