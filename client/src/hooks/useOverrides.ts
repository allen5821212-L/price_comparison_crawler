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
        // Remove any existing entry with the same ours_id (and their_id if provided)
        const filtered = data.overrides.filter(
          (o) =>
            !(o.ours_id === entry.ours_id &&
              (entry.action === "no_match" || o.ours_id === entry.ours_id) &&
              (entry.action !== "no_match"
                ? o.their_id === entry.their_id
                : true))
        );
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
    (ours_id: string, ours_name: string, their_id: string, their_name: string) => {
      setOverride({ ours_id, ours_name, their_id, their_name, action: "confirm" });
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
      setOverrides((prev) => {
        const data = { ...prev, overrides: [...prev.overrides] };
        for (const entry of entries) {
          // Remove existing entries for this ours_id
          const filtered = data.overrides.filter(
            (o) => !(o.ours_id === entry.ours_id && o.action === "confirm")
          );
          // Remove the ones we just filtered out
          data.overrides = filtered;
          // Add new confirm entry
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
    },
    []
  );

  return {
    overrides: overrides.overrides,
    stats,
    confirmMatch,
    rejectMatch,
    markNoMatch,
    manualMatch,
    batchConfirm,
    getOverride,
    isRejected,
    getConfirmed,
    isNoMatch,
    exportOverrides,
    importOverrides,
  };
}
