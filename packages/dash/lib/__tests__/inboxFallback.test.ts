import { describe, it, expect } from "vitest";
import { itemFromTask } from "../inboxFallback";

describe("itemFromTask", () => {
  it("builds an approval item from a needs_human operator task and its consumed PO", () => {
    const item = itemFromTask(
      { id: "1", key: "TSK-0919", title: "Procure to pay: Approve purchase order", role: "operator", state: "needs_human", workflow_run: "p2p-121", updated_at: "2026-09-24T09:19:04Z", deadline: "2026-09-24T09:21:39Z", attempts: 0, max_attempts: 3, cost_usd: 0, budget_usd: null } as never,
      [{ kind: "purchase_order", content: { po_number: "PO-2026-101", vendor: { name: "Nordlicht Computing GmbH" }, total: 5520, currency: "EUR", policy_check: { approver_level: "manager", vendor_approved: true } }, created_at: "2026-09-24T09:19:04Z" } as never],
      Date.parse("2026-09-24T09:25:00Z"),
    );
    expect(item.kind).toBe("approval");
    expect(item.summary?.document).toBe("PO-2026-101");
    expect(item.summary?.counterparty).toBe("Nordlicht Computing GmbH");
    expect(item.summary?.amount).toBe(5520);
    expect(item.summary?.currency).toBe("EUR");
    expect(item.overdue).toBe(true);
    expect(item.summary?.flags).toEqual([]);
  });
  it("flags an unapproved vendor and director level", () => {
    const item = itemFromTask(
      { id: "2", key: "TSK-0927", title: "x", role: "operator", state: "needs_human", workflow_run: "p2p-122", updated_at: "2026-09-24T09:37:00Z", deadline: null, attempts: 0, max_attempts: 3, cost_usd: 0, budget_usd: null } as never,
      [{ kind: "purchase_order", content: { po_number: "PO-2026-103", total: 25200, currency: "EUR", policy_check: { approver_level: "director", vendor_approved: false } }, created_at: "" } as never],
      Date.now(),
    );
    expect(item.summary?.flags).toEqual(["vendor_not_approved", "level_director"]);
    expect(item.overdue).toBe(false);
  });
  it("marks a non-operator needs_human task as parked and summarises its own artefact", () => {
    const item = itemFromTask(
      { id: "3", key: "TSK-0869", title: "Dispute", role: "ap-clerk", state: "needs_human", workflow_run: "p2p-105", updated_at: "", deadline: null, attempts: 3, max_attempts: 3, cost_usd: 0.47, budget_usd: 2 } as never,
      [{ kind: "invoice_match", content: { invoice_number: "INV-2026-105", status: "mismatched", amount_payable: 0, currency: "EUR" }, created_at: "" } as never],
      Date.now(),
    );
    expect(item.kind).toBe("parked");
    expect(item.summary?.document).toBe("INV-2026-105");
    expect(item.summary?.flags).toEqual(["mismatched"]);
  });
});

describe("shouldFallback", () => {
  it("falls back only when the engine has no inbox route or is broken, never on an auth or config error", async () => {
    const { shouldFallback } = await import("../inboxFallback");
    expect(shouldFallback(404)).toBe(true);
    expect(shouldFallback(500)).toBe(true);
    expect(shouldFallback(502)).toBe(true);
    expect(shouldFallback(401)).toBe(false);
    expect(shouldFallback(403)).toBe(false);
    expect(shouldFallback(400)).toBe(false);
    expect(shouldFallback(200)).toBe(false);
  });
});
