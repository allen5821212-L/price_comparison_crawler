// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualMatchDialog } from "./ManualMatchDialog";

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  useDialogComposition: () => undefined,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const trpcMocks = vi.hoisted(() => ({
  useQuery: vi.fn(() => ({
    data: [{
      source: "coolpc",
      id: "candidate-1",
      name: "ASUS B850M 黑色 DDR4 主機板",
      subtitle: "DDR4",
      price: 3690,
      original_price: null,
      url: "https://example.com/candidate-1",
      image: "",
      category: "主機板",
    }],
    isFetching: false,
  })),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    comparison: {
      searchProducts: { useQuery: trpcMocks.useQuery },
    },
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("ManualMatchDialog", () => {
  it("opens with a candidate and sends the exact candidate details when the reviewer rejects it", async () => {
    const onReject = vi.fn();
    const user = userEvent.setup();

    render(
      <ManualMatchDialog
        open
        onOpenChange={vi.fn()}
        sinyaProduct={{ name: "ASUS B850M 白色 DDR5 主機板", price: 4290, url: "", image: "" }}
        onConfirm={vi.fn()}
        onReject={onReject}
        onNoMatch={vi.fn()}
        initialPlatform="coolpc"
      />,
    );

    await user.click(await screen.findByTitle("標記為錯誤配對"));

    expect(onReject).toHaveBeenCalledWith(
      "coolpc_candidate-1",
      "ASUS B850M 黑色 DDR4 主機板",
      "coolpc",
    );
    expect(trpcMocks.useQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ platform: "coolpc", limit: 50 }),
      expect.objectContaining({ enabled: true }),
    );
  });
});
