import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const trpcMocks = vi.hoisted(() => {
  const queryCalls: Array<{ name: string; enabled: boolean | undefined }> = [];
  const queryResult = { data: undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
  const query = (name: string) => ({ useQuery: (_input?: unknown, options?: { enabled?: boolean }) => {
    queryCalls.push({ name, enabled: options?.enabled });
    return queryResult;
  } });
  const mutation = { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) };
  return { queryCalls, query, mutation };
});

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    comparison: {
      coolpcCoverage: trpcMocks.query("comparison.coolpcCoverage"),
      coolpcUnlisted: trpcMocks.query("comparison.coolpcUnlisted"),
      sinyaCoverage: trpcMocks.query("comparison.sinyaCoverage"),
      sinyaUnlisted: trpcMocks.query("comparison.sinyaUnlisted"),
      sinyaUnlistedExport: trpcMocks.query("comparison.sinyaUnlistedExport"),
    },
    crawler: {
      coolpcRecrawlReminders: trpcMocks.query("crawler.coolpcRecrawlReminders"),
      coolpcRecrawlPresets: trpcMocks.query("crawler.coolpcRecrawlPresets"),
      coolpcRecrawlPresetHistory: trpcMocks.query("crawler.coolpcRecrawlPresetHistory"),
      exportCoolpcRecrawlPresets: trpcMocks.query("crawler.exportCoolpcRecrawlPresets"),
      coolpcRecrawlPresetTemplates: trpcMocks.query("crawler.coolpcRecrawlPresetTemplates"),
      coolpcRecrawlPresetTemplateByToken: trpcMocks.query("crawler.coolpcRecrawlPresetTemplateByToken"),
      saveCoolpcRecrawlReminder: trpcMocks.mutation,
      setCoolpcRecrawlReminderActive: trpcMocks.mutation,
      acknowledgeCoolpcRecrawlReminder: trpcMocks.mutation,
      enqueue: trpcMocks.mutation,
      enqueueCategories: trpcMocks.mutation,
      saveCoolpcRecrawlPreset: trpcMocks.mutation,
      deleteCoolpcRecrawlPreset: trpcMocks.mutation,
      previewCoolpcRecrawlPresetImport: trpcMocks.mutation,
      importCoolpcRecrawlPresets: trpcMocks.mutation,
      applyCoolpcRecrawlPreset: trpcMocks.mutation,
      setCoolpcRecrawlPresetPinned: trpcMocks.mutation,
      reorderCoolpcRecrawlPresets: trpcMocks.mutation,
      enqueueCoolpcRecrawlPreset: trpcMocks.mutation,
      publishCoolpcRecrawlPresetTemplate: trpcMocks.mutation,
      revokeCoolpcRecrawlPresetTemplate: trpcMocks.mutation,
      copyCoolpcRecrawlPresetTemplate: trpcMocks.mutation,
      setCoolpcRecrawlPresetTemplateMode: trpcMocks.mutation,
      addCoolpcRecrawlPresetTemplateCollaborator: trpcMocks.mutation,
      removeCoolpcRecrawlPresetTemplateCollaborator: trpcMocks.mutation,
      updateCoolpcRecrawlPresetTemplateCategories: trpcMocks.mutation,
    },
    useUtils: () => ({ crawler: { coolpcRecrawlReminders: { invalidate: vi.fn() }, jobs: { invalidate: vi.fn() }, events: { invalidate: vi.fn() } } }),
  },
}));

import CoolpcCoveragePage from "./CoolpcCoveragePage";
import CoolpcOnlyPage from "./CoolpcOnlyPage";

describe("CoolPC administrator query gates", () => {
  beforeEach(() => trpcMocks.queryCalls.splice(0));

  it("does not enable coverage or gap queries for an unauthenticated visitor", () => {
    renderToStaticMarkup(<CoolpcCoveragePage />);
    expect(trpcMocks.queryCalls).toEqual([
      { name: "comparison.coolpcCoverage", enabled: false },
      { name: "comparison.coolpcUnlisted", enabled: false },
    ]);
  });

  it("does not enable sensitive recrawl, coverage, or gap queries for an unauthenticated visitor", () => {
    renderToStaticMarkup(<CoolpcOnlyPage />);
    const guardedQueries = trpcMocks.queryCalls.filter(call => call.name !== "comparison.sinyaUnlistedExport" && call.name !== "crawler.exportCoolpcRecrawlPresets");
    expect(guardedQueries).toHaveLength(7);
    expect(guardedQueries.every(call => call.enabled === false)).toBe(true);
    expect(trpcMocks.queryCalls.find(call => call.name === "comparison.sinyaUnlistedExport")?.enabled).toBe(false);
    expect(trpcMocks.queryCalls.find(call => call.name === "crawler.exportCoolpcRecrawlPresets")?.enabled).toBe(false);
  });
});
