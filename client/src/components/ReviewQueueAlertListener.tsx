import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

type ReviewAlertSnapshot = { mediumTotal: number; highTotal: number; criticalTotal: number };
type ReviewNotificationThresholds = { mediumThreshold: number; highThreshold: number; criticalThreshold: number };

export function buildReviewAlert(previous: ReviewAlertSnapshot, current: ReviewAlertSnapshot, thresholds: ReviewNotificationThresholds) {
  const candidates = [
    { key: "critical" as const, label: "緊急風險", threshold: thresholds.criticalThreshold, current: current.criticalTotal, previous: previous.criticalTotal },
    { key: "high" as const, label: "高度風險", threshold: thresholds.highThreshold, current: current.highTotal, previous: previous.highTotal },
    { key: "medium" as const, label: "中度風險", threshold: thresholds.mediumThreshold, current: current.mediumTotal, previous: previous.mediumTotal },
  ];
  const alert = candidates.find(candidate => candidate.threshold > 0 && candidate.current >= candidate.threshold && candidate.current > candidate.previous);
  if (alert) return { title: `${alert.label}配對數量增加`, message: `目前共有 ${alert.current} 件${alert.label}配對，已達你設定的 ${alert.threshold} 件提醒門檻。` };
  return null;
}

export function buildOverdueEscalationAlert(total: number, escalateAfterMinutes: number) {
  if (total <= 0) return null;
  return {
    title: "有逾期審核案件需要處理",
    message: `你有 ${total} 件審核工作已超過 ${escalateAfterMinutes} 分鐘的升級時限。`,
  };
}

export function shouldEmitOverdueEscalation(lastNotifiedAt: number, now: number, total: number, active: boolean, reminderIntervalMinutes: number) {
  return active && total > 0 && now - lastNotifiedAt >= Math.max(5 * 60_000, reminderIntervalMinutes * 60_000);
}

/** Polls the compact admin summary in the browser; no server-side timer is required. */
export function ReviewQueueAlertListener() {
  const { user } = useAuth();
  const previous = useRef<ReviewAlertSnapshot | null>(null);
  const mentionedIds = useRef<Set<number>>(new Set());
  const lastEscalationNotifiedAt = useRef(0);
  const summary = trpc.comparison.reviewSummary.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const settings = trpc.comparison.reviewNotificationSettings.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchOnWindowFocus: true,
  });
  const escalationSettings = trpc.comparison.reviewEscalationSettings.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchOnWindowFocus: true,
  });
  const overdueEscalations = trpc.comparison.myOverdueReviewEscalations.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: Math.max(5 * 60_000, (escalationSettings.data?.reminderIntervalMinutes ?? 30) * 60_000),
    refetchOnWindowFocus: true,
  });
  const unreadMentions = trpc.comparison.unreadReviewMentions.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const markMentionsRead = trpc.comparison.markReviewMentionsRead.useMutation({
    onSuccess: () => void unreadMentions.refetch(),
  });

  useEffect(() => {
    if (!summary.data || !settings.data) return;
    const current = { mediumTotal: summary.data.mediumTotal, highTotal: summary.data.highTotal, criticalTotal: summary.data.criticalTotal };
    if (previous.current === null) {
      previous.current = current;
      return;
    }
    const alert = buildReviewAlert(previous.current, current, settings.data);
    previous.current = current;
    if (!alert) return;

    toast.warning(alert.title, {
      description: alert.message,
      action: { label: "查看佇列", onClick: () => { window.location.href = "/review-queue"; } },
    });
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(alert.title, { body: alert.message });
    }
  }, [settings.data, summary.data]);

  useEffect(() => {
    const unseen = (unreadMentions.data ?? []).filter(mention => !mentionedIds.current.has(mention.id));
    if (unseen.length === 0) return;
    unseen.forEach(mention => mentionedIds.current.add(mention.id));
    const first = unseen[0];
    const title = unseen.length > 1 ? `你有 ${unseen.length} 則新的審核提及` : "你被提及於審核評論";
    const message = first?.message || "請查看待審核配對工作台的評論與交接紀錄。";
    toast.info(title, { description: message, action: { label: "查看工作", onClick: () => { window.location.href = "/review-queue"; } } });
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body: message });
    markMentionsRead.mutate({ mentionIds: unseen.map(mention => mention.id) });
  }, [markMentionsRead, unreadMentions.data]);

  useEffect(() => {
    const data = overdueEscalations.data;
    if (!data?.active) return;
    const now = Date.now();
    if (!shouldEmitOverdueEscalation(lastEscalationNotifiedAt.current, now, data.total, data.active, data.reminderIntervalMinutes)) return;
    const alert = buildOverdueEscalationAlert(data.total, data.items[0]?.escalateAfterMinutes ?? 0);
    if (!alert) return;
    lastEscalationNotifiedAt.current = now;
    toast.warning(alert.title, { description: alert.message, action: { label: "前往處理", onClick: () => { window.location.href = "/review-queue"; } } });
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(alert.title, { body: alert.message });
  }, [overdueEscalations.data]);

  return null;
}
