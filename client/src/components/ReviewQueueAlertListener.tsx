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

/** Polls the compact admin summary in the browser; no server-side timer is required. */
export function ReviewQueueAlertListener() {
  const { user } = useAuth();
  const previous = useRef<ReviewAlertSnapshot | null>(null);
  const summary = trpc.comparison.reviewSummary.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const settings = trpc.comparison.reviewNotificationSettings.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchOnWindowFocus: true,
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

  return null;
}
