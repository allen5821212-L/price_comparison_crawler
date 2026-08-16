import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

const SEEN_KEY = "price-alert-seen-ids";

function seenIds(): Set<number> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

/** Delivers newly persisted alerts to the signed-in user without exposing another user's favorites. */
export function PriceAlertListener() {
  const { user } = useAuth();
  const hydrated = useRef(false);
  const alerts = trpc.favorites.notifications.useQuery(undefined, {
    enabled: Boolean(user),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!alerts.data) return;
    const seen = seenIds();
    const unread = alerts.data.filter(alert => !alert.readAt);
    if (!hydrated.current) {
      unread.forEach(alert => seen.add(alert.id));
      sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-300)));
      hydrated.current = true;
      return;
    }
    unread.filter(alert => !seen.has(alert.id)).forEach(alert => {
      seen.add(alert.id);
      toast(alert.title, {
        description: alert.message || undefined,
        action: { label: "查看", onClick: () => { window.location.href = "/favorites"; } },
      });
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(alert.title, { body: alert.message || "收藏商品有新的價格異動。" });
      }
    });
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-300)));
  }, [alerts.data]);

  return null;
}
