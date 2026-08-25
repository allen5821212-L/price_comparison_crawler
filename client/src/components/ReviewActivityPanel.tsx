import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { MessageSquareText, Send, UserRoundCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Assignee = { id: number; name: string | null; email: string | null };

export function buildReviewHandoffInput(sourceKey: string, fingerprint: string, assigneeUserId: number, hours: number, message: string) {
  return {
    sourceKey,
    fingerprint,
    assigneeUserId,
    dueAt: new Date(Date.now() + hours * 60 * 60 * 1000),
    message: message.trim(),
  };
}

export function ReviewActivityPanel({
  sourceKey,
  fingerprint,
  assignees,
  onChanged,
}: {
  sourceKey: string;
  fingerprint: string;
  assignees: Assignee[];
  onChanged: () => void;
}) {
  const [comment, setComment] = useState("");
  const [handoffMessage, setHandoffMessage] = useState("");
  const [handoffAssignee, setHandoffAssignee] = useState("");
  const [handoffHours, setHandoffHours] = useState(24);
  const activity = trpc.comparison.reviewActivity.useQuery({ sourceKey, fingerprint });
  const addComment = trpc.comparison.addReviewComment.useMutation({
    onSuccess: () => {
      setComment("");
      toast.success("已新增審核評論。");
      void activity.refetch();
    },
    onError: error => toast.error(error.message || "無法新增評論。"),
  });
  const handoff = trpc.comparison.handoffReview.useMutation({
    onSuccess: () => {
      setHandoffMessage("");
      setHandoffAssignee("");
      toast.success("已完成審核交接並更新期限。");
      void activity.refetch();
      onChanged();
    },
    onError: error => toast.error(error.message || "無法交接此審核工作。"),
  });

  const assigneeName = (id: number | null) => {
    if (!id) return "未指派";
    const assignee = assignees.find(item => item.id === id);
    return assignee?.name || assignee?.email || `管理員 #${id}`;
  };

  return (
    <details className="mt-3 rounded-lg border border-border bg-muted/10 p-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground"><MessageSquareText className="size-3.5 text-primary" />評論與交接紀錄</summary>
      <div className="mt-3 space-y-3">
        <div className="flex gap-2"><Input value={comment} onChange={event => setComment(event.target.value)} maxLength={2000} placeholder="留下規格確認、處理進度或交接備註…" className="h-9 text-sm" /><Button size="sm" onClick={() => comment.trim() && addComment.mutate({ sourceKey, fingerprint, message: comment })} disabled={!comment.trim() || addComment.isPending}><Send className="size-3.5" /></Button></div>
        <div className="grid gap-2 rounded-md bg-background/60 p-2 sm:grid-cols-[1fr_100px_1fr_auto]"><select value={handoffAssignee} onChange={event => setHandoffAssignee(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-xs"><option value="">交接處理人員</option>{assignees.map(assignee => <option key={assignee.id} value={assignee.id}>{assignee.name || assignee.email || `管理員 #${assignee.id}`}</option>)}</select><select value={handoffHours} onChange={event => setHandoffHours(Number(event.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-xs"><option value={4}>4 小時</option><option value={24}>24 小時</option><option value={72}>3 天</option></select><Input value={handoffMessage} onChange={event => setHandoffMessage(event.target.value)} maxLength={2000} placeholder="交接說明（選填）" className="h-9 text-xs" /><Button size="sm" variant="outline" onClick={() => handoffAssignee && handoff.mutate(buildReviewHandoffInput(sourceKey, fingerprint, Number(handoffAssignee), handoffHours, handoffMessage))} disabled={!handoffAssignee || handoff.isPending}><UserRoundCheck className="mr-1 size-3.5" />交接</Button></div>
        <div className="space-y-2">{activity.isLoading ? <p className="text-xs text-muted-foreground">載入紀錄中…</p> : activity.data?.length === 0 ? <p className="text-xs text-muted-foreground">尚無評論或交接紀錄。</p> : activity.data?.map(entry => <div key={entry.id} className="border-l-2 border-primary/30 pl-3 text-xs"><p className="font-medium">{entry.type === "handoff" ? `交接：${assigneeName(entry.fromUserId)} → ${assigneeName(entry.toUserId)}` : `評論：${assigneeName(entry.authorUserId)}`}</p>{entry.message && <p className="mt-1 text-muted-foreground">{entry.message}</p>}<p className="mt-1 text-[11px] text-muted-foreground">{new Date(entry.createdAt).toLocaleString("zh-TW")}</p></div>)}</div>
      </div>
    </details>
  );
}
