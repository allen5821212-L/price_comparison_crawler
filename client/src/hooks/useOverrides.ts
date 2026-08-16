/**
 * useOverrides — 手動配對管理（localStorage 儲存）
 *
 * 依照《配對修正與手動配對規格_附錄》第二部分實作。
 * 三種動作：confirm（確認配對正確）、reject（配對錯誤）、no_match（無對應商品）。
 * 人工紀錄優先於自動配對，且不因每日重新爬資料而消失。
 */

import { useState, useEffect, useCallback } from "react";

export interface OverrideEntry {
  ours_id: string;
  ours_name: string;
  their_id?: string;
  their_name?: string;
  platform?: "coolpc" | "pchome" | "momo" | "manual";
  action: "confirm" | "reject" | "no_match";
  note?: string;
  by: string;
  at: string;
}

interface OverridesData {
  version: number;
  updated_at: string;
  overrides: OverrideEntry[];
}

const STORAGE_KEY = "price_comparison_overrides";

function loadFromStorage(): OverridesData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, updated_at: new Date().toISOString(), overrides: [] };
    return JSON.parse(raw) as OverridesData;
  } catch {
    return { version: 1, updated_at: new Date().toISOString(), overrides: [] };
  }
}

function saveToStorage(data: OverridesData) {
  data.updated_at = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function useOverrides() {
  const [overrides, setOverrides] = useState<OverridesData>(loadFromStorage);

  // Sync from storage on mount and when other tabs change
  useEffect(() => {
    const handler = () => setOverrides(loadFromStorage());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  /** Unique key for a pair: ours_id + their_id */
  const pairKey = (ours_id: string, their_id?: string) =>
    their_id ? `${ours_id}::${their_id}` : ours_id;

  /** Add or update an override entry (dedup by ours_id + their_id) */
  const setOverride = useCallback(
    (entry: Omit<OverrideEntry, "by" | "at">) => {
      setOverrides((prev) => {
        const data = { ...prev, overrides: [...prev.overrides] };
        // 每個欣亞商品只能有一個確認配對；排除紀錄則可保留多筆。
        const filtered = data.overrides.filter((o) => {
          if (o.ours_id !== entry.ours_id) return true;
          if (entry.action === "confirm") {
            return o.action !== "confirm" && o.action !== "no_match";
          }
          if (entry.action === "no_match") {
            return o.action !== "no_match" && o.action !== "confirm";
          }
          return !(o.action === "reject" && o.their_id === entry.their_id);
        });
        // Add new entry
        filtered.push({
          ...entry,
          by: "user",
          at: new Date().toISOString(),
        });
        data.overrides = filtered;
        saveToStorage(data);
        return data;
      });
    },
    []
  );

  /** Confirm a match is correct */
  const confirmMatch = useCallback(
    (
      ours_id: string,
      ours_name: string,
      their_id: string,
      their_name: string,
      platform: "coolpc" | "pchome" | "momo" = "coolpc"
    ) => {
      setOverride({ ours_id, ours_name, their_id, their_name, platform, action: "confirm" });
    },
    [setOverride]
  );

  /** Reject a match as incorrect */
  const rejectMatch = useCallback(
    (ours_id: string, ours_name: string, their_id: string, their_name: string, note?: string) => {
      setOverride({ ours_id, ours_name, their_id, their_name, action: "reject", note });
    },
    [setOverride]
  );

  /** Mark a product as having no match on the other site */
  const markNoMatch = useCallback(
    (ours_id: string, ours_name: string, note?: string) => {
      setOverride({ ours_id, ours_name, action: "no_match", note });
    },
    [setOverride]
  );

  /** Manually enter a product name for comparison (not from CoolPC database) */
  const manualMatch = useCallback(
    (ours_id: string, ours_name: string, their_name: string, their_price?: number) => {
      const customId = `manual_${their_name.replace(/\s+/g, "_").substring(0, 30)}`;
      setOverride({
        ours_id,
        ours_name,
        their_id: customId,
        their_name,
        platform: "manual",
        action: "confirm",
        note: their_price ? `手動輸入品名，價格: NT$${their_price}` : "手動輸入品名",
      });
    },
    [setOverride]
  );

  /** Get override for a specific sinya product (by ours_id) */
  const getOverride = useCallback(
    (ours_id: string): OverrideEntry | undefined => {
      return overrides.overrides.find((o) => o.ours_id === ours_id);
    },
    [overrides]
  );

  /** Check if a specific pair has been rejected */
  const isRejected = useCallback(
    (ours_id: string, their_id: string): boolean => {
      return overrides.overrides.some(
        (o) =>
          o.ours_id === ours_id &&
          o.their_id === their_id &&
          o.action === "reject"
      );
    },
    [overrides]
  );

  /** Check if a product has been confirmed */
  const getConfirmed = useCallback(
    (ours_id: string): OverrideEntry | undefined => {
      return overrides.overrides.find(
        (o) => o.ours_id === ours_id && o.action === "confirm"
      );
    },
    [overrides]
  );

  /** Check if a product is marked as no_match */
  const isNoMatch = useCallback(
    (ours_id: string): boolean => {
      return overrides.overrides.some(
        (o) => o.ours_id === ours_id && o.action === "no_match"
      );
    },
    [overrides]
  );

  /** Get statistics */
  const stats = {
    confirmed: overrides.overrides.filter((o) => o.action === "confirm").length,
    rejected: overrides.overrides.filter((o) => o.action === "reject").length,
    noMatch: overrides.overrides.filter((o) => o.action === "no_match").length,
    total: overrides.overrides.length,
  };

  /** Export overrides as JSON file */
  const exportOverrides = useCallback(() => {
    const blob = new Blob([JSON.stringify(overrides, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "overrides.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [overrides]);

  /** Import overrides from JSON file */
  const importOverrides = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as OverridesData;
        if (data.overrides && Array.isArray(data.overrides)) {
          saveToStorage(data);
          setOverrides(data);
        }
      } catch {
        // ignore invalid JSON
      }
    };
    reader.readAsText(file);
  }, []);

  /** Batch confirm multiple matches at once */
  const batchConfirm = useCallback(
    (entries: { ours_id: string; ours_name: string; their_id: string; their_name: string }[]) => {
      const snapshot = overrides.overrides;
      setOverrides((prev) => {
        const data = { ...prev, overrides: [...prev.overrides] };
        for (const entry of entries) {
          // Remove existing entries for this ours_id
          const filtered = data.overrides.filter(
            (o) => !(o.ours_id === entry.ours_id && o.action === "confirm")
          );
          data.overrides = filtered;
          data.overrides.push({
            ...entry,
            action: "confirm",
            by: "user",
            at: new Date().toISOString(),
          });
        }
        saveToStorage(data);
        return data;
      });
      return snapshot;
    },
    [overrides]
  );

  /** Batch reject multiple matches at once, returns previous state for undo */
  const batchReject = useCallback(
    (entries: { ours_id: string; ours_name: string; their_id: string; their_name: string }[], note?: string) => {
      const snapshot = overrides.overrides;
      setOverrides((prev) => {
        const data = { ...prev, overrides: [...prev.overrides] };
        for (const entry of entries) {
          const filtered = data.overrides.filter(
            (o) => !(o.ours_id === entry.ours_id && o.their_id === entry.their_id && o.action === "reject")
          );
          data.overrides = filtered;
          data.overrides.push({
            ...entry,
            action: "reject",
            note: note || "批次排除",
            by: "user",
            at: new Date().toISOString(),
          });
        }
        saveToStorage(data);
        return data;
      });
      return snapshot;
    },
    [overrides]
  );

  /** Restore overrides to a previous snapshot (undo) */
  const restoreSnapshot = useCallback(
    (snapshot: OverrideEntry[]) => {
      setOverrides((prev) => {
        const data = { ...prev, overrides: snapshot };
        saveToStorage(data);
        return data;
      });
    },
    []
  );

  /** Clear all overrides (confirm/reject/no_match) */
  const clearAllOverrides = useCallback(() => {
    const snapshot = overrides.overrides;
    const data = { version: 1, updated_at: new Date().toISOString(), overrides: [] };
    saveToStorage(data);
    setOverrides(data);
    return snapshot;
  }, [overrides]);

  /** Clear overrides by action type */
  const clearOverridesByType = useCallback(
    (actionType: "confirm" | "reject" | "no_match") => {
      const snapshot = overrides.overrides;
      const remaining = overrides.overrides.filter((o) => o.action !== actionType);
      const data = { version: 1, updated_at: new Date().toISOString(), overrides: remaining };
      saveToStorage(data);
      setOverrides(data);
      return snapshot;
    },
    [overrides]
  );

  return {
    overrides: overrides.overrides,
    stats,
    confirmMatch,
    rejectMatch,
    markNoMatch,
    manualMatch,
    batchConfirm,
    batchReject,
    restoreSnapshot,
    clearAllOverrides,
    clearOverridesByType,
    getOverride,
    isRejected,
    getConfirmed,
    isNoMatch,
    exportOverrides,
    importOverrides,
  };
}
