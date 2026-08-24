import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

type ReviewAlertSnapshot = { highRiskTotal: number; criticalTotal: number };

export function buildReviewAlert(previous: ReviewAlertSnapshot, current: ReviewAlertSnapshot) {
  const newCritical = Math.max(0, current.criticalTotal - previous.criticalTotal);
  const newHighRisk = Math.max(0, current.highRiskTotal - previous.highRiskTotal);
  if (newCritical > 0) return { title: "新增需優先確認的配對", message: `有 ${newCritical} 件新的緊急風險配對，請優先處理。` };
  if (newHighRisk > 0) return { title: "高風險配對數量增加", message: `有 ${newHighRisk} 件新的高風險配對，請安排人工確認。` };
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

  useEffect(() => {
    if (!summary.data) return;
    const current = { highRiskTotal: summary.data.highRiskTotal, criticalTotal: summary.data.criticalTotal };
    if (previous.current === null) {
      previous.current = current;
      return;
    }
    const alert = buildReviewAlert(previous.current, current);
    previous.current = current;
    if (!alert) return;

    toast.warning(alert.title, {
      description: alert.message,
      action: { label: "查看佇列", onClick: () => { window.location.href = "/review-queue"; } },
    });
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(alert.title, { body: alert.message });
    }
  }, [summary.data]);

  return null;
}
