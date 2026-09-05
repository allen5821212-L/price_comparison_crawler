// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const historyForProductCalls = vi.hoisted(() => [] as Array<{ sourceKey: string; days: number; enabled: boolean }>);

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));
vi.mock("@/components/ui/input", () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    comparison: {
      historyProducts: { useQuery: () => ({ data: [{ sourceKey: "sinya_1", sinyaName: "Samsung 870 EVO 4TB" }], isLoading: false }) },
      historyForProduct: { useQuery: (input: { sourceKey: string; days: number }, options: { enabled: boolean }) => {
        historyForProductCalls.push({ ...input, enabled: options.enabled });
        return { data: options.enabled ? [{ date: "2026-09-05", sinyaPrice: 8990, coolpcPrice: 8790 }] : [], isLoading: false };
      } },
    },
  },
}));

import { PriceHistoryDialog } from "./PriceHistoryDialog";

describe("PriceHistoryDialog", () => {
  beforeEach(() => historyForProductCalls.splice(0));

  it("waits for a product selection before requesting its price history", () => {
    render(<PriceHistoryDialog open onOpenChange={vi.fn()} />);

    expect(historyForProductCalls.at(-1)).toEqual({ sourceKey: "", days: 30, enabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Samsung 870 EVO 4TB" }));
    expect(historyForProductCalls.at(-1)).toEqual({ sourceKey: "sinya_1", days: 30, enabled: true });
  });
});
