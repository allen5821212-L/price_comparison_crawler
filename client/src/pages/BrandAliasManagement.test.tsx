import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const noop = vi.fn();

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, openId: "admin", role: "admin" } }),
}));

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ brandAliases: { listForAdmin: { invalidate: noop } } }),
    brandAliases: {
      listForAdmin: { useQuery: () => ({ data: [{ id: 7, alias: "COOLER MASTER", canonicalName: "酷碼", active: true }], isLoading: false }) },
      save: { useMutation: () => ({ mutate: noop, isPending: false }) },
      setActive: { useMutation: () => ({ mutate: noop, isPending: false }) },
    },
  },
}));

vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import BrandAliasManagement from "./BrandAliasManagement";

describe("BrandAliasManagement", () => {
  it("renders the administrator alias editor and active crawler mapping", () => {
    const html = renderToStaticMarkup(<BrandAliasManagement />);
    expect(html).toContain("品牌別名管理");
    expect(html).toContain("新增或更新");
    expect(html).toContain("COOLER MASTER");
    expect(html).toContain("酷碼");
    expect(html).toContain("下次爬蟲匯出");
  });
});
