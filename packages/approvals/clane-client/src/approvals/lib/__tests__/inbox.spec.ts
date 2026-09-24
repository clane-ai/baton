import { groupItems, tilesOf, waitingText, summaryLine, flagLabel, nextText, stripProcess } from "../inbox";
import type { InboxItem, InboxKind, InboxSummary } from "../../data/types";

const base: Omit<InboxItem, "key" | "kind" | "waiting_since" | "summary"> = { id: "", state: "needs_human", role: "operator", title: "", workflow_run: null, run_name: null, deadline: null, overdue: false, next: [], attempts: 0, max_attempts: 3, cost_usd: 0, budget_usd: null };
const sum = (p: Partial<InboxSummary>): InboxSummary => ({ document: null, counterparty: null, amount: null, currency: null, flags: [], produced_by: null, produced_at: null, ...p });
const item = (k: InboxKind, extra: Partial<InboxItem> = {}): InboxItem => ({ ...base, key: "K", kind: k, waiting_since: "2026-09-24T09:00:00Z", summary: null, ...extra });

describe("groupItems", () => {
  it("groups by kind, approvals first", () => {
    const g = groupItems([item("parked"), item("approval"), item("question")]);
    expect(g.approvals.length).toBe(1);
    expect(g.parked.length).toBe(1);
    expect(g.questions.length).toBe(1);
  });
  it("orders each group oldest first", () => {
    const g = groupItems([item("approval", { key: "B", waiting_since: "2026-09-24T09:10:00Z" }), item("approval", { key: "A", waiting_since: "2026-09-24T09:00:00Z" })]);
    expect(g.approvals.map((i) => i.key)).toEqual(["A", "B"]);
  });
});

describe("tilesOf", () => {
  it("sums amounts per currency for approvals and counts parked, questions, overdue", () => {
    const t = tilesOf([
      item("approval", { summary: sum({ document: "a", amount: 100, currency: "EUR" }) }),
      item("approval", { summary: sum({ document: "b", amount: 5, currency: "USD" }) }),
      item("parked", { overdue: true }),
      item("question"),
    ]);
    expect(t.waiting).toBe(2);
    expect(t.waitingAmount).toEqual({ EUR: 100, USD: 5 });
    expect(t.parked).toBe(1);
    expect(t.questions).toBe(1);
    expect(t.overdue).toBe(1);
  });
});

describe("waitingText", () => {
  const n = Date.parse("2026-09-24T10:00:00Z");
  it("scales from seconds to days", () => {
    expect(waitingText("2026-09-24T09:59:26Z", n)).toBe("34 s");
    expect(waitingText("2026-09-24T09:48:00Z", n)).toBe("12 min");
    expect(waitingText("2026-09-24T06:50:00Z", n)).toBe("3 h 10 min");
    expect(waitingText("2026-09-24T07:00:00Z", n)).toBe("3 h");
    expect(waitingText("2026-09-22T10:00:00Z", n)).toBe("2 d");
  });
  it("is empty for a bad date", () => {
    expect(waitingText("nope", n)).toBe("");
  });
});

describe("summaryLine", () => {
  it("joins document, counterparty and amount, skipping what is missing", () => {
    expect(summaryLine(item("approval", { summary: sum({ document: "PO-2026-101", counterparty: "Nordlicht Computing GmbH", amount: 5520, currency: "EUR" }) }))).toBe("PO-2026-101 · Nordlicht Computing GmbH · 5,520.00 EUR");
    expect(summaryLine(item("approval", { summary: sum({ document: "PO-1" }) }))).toBe("PO-1");
    expect(summaryLine(item("approval"))).toBe("");
  });
});

describe("flagLabel", () => {
  it("names the known flags with a tone and falls back to the flag text", () => {
    expect(flagLabel("vendor_not_approved")).toEqual({ text: "vendor not approved", tone: "stuck" });
    expect(flagLabel("level_director")).toEqual({ text: "director level", tone: "stuck" });
    expect(flagLabel("short_delivery")).toEqual({ text: "short delivery", tone: "working" });
    expect(flagLabel("odd_thing")).toEqual({ text: "odd thing", tone: "neutral" });
  });
  it("names the engine v15 codes", () => {
    expect(flagLabel("over_budget")).toEqual({ text: "over budget", tone: "stuck" });
    expect(flagLabel("missing")).toEqual({ text: "items missing", tone: "stuck" });
    expect(flagLabel("incomplete")).toEqual({ text: "incomplete delivery", tone: "working" });
    expect(flagLabel("payment_rejected")).toEqual({ text: "payment rejected", tone: "stuck" });
    expect(flagLabel("changes_requested")).toEqual({ text: "changes requested", tone: "working" });
    expect(flagLabel("blocker")).toEqual({ text: "blocker found", tone: "stuck" });
    expect(flagLabel("major")).toEqual({ text: "major finding", tone: "working" });
    expect(flagLabel("tests_failed")).toEqual({ text: "tests failed", tone: "stuck" });
  });
});

describe("nextText", () => {
  it("reads as one sentence", () => {
    expect(nextText([{ key: "a", title: "Send PO to supplier", when: "once approved" }, { key: "b", title: "Rework note", when: "if rejected" }])).toBe("Next: Send PO to supplier once approved; Rework note if rejected");
    expect(nextText([])).toBe("");
  });
  it("turns gateway outcome ids into words", () => {
    expect(nextText([{ key: "a", title: "Send PO to supplier", when: "yes" }, { key: "b", title: "Rework note", when: "no" }])).toBe("Next: Send PO to supplier if approved; Rework note if rejected");
    expect(nextText([{ key: "a", title: "Schedule payment", when: "ok" }, { key: "b", title: "Dispute the invoice", when: "bad" }])).toBe("Next: Schedule payment if ok; Dispute the invoice if bad");
    expect(nextText([{ key: "a", title: "Book goods receipt", when: null }])).toBe("Next: Book goods receipt");
  });
});

describe("outcomeSide", () => {
  it("tells approval outcomes from rejection outcomes", async () => {
    const { outcomeSide } = await import("../inbox");
    expect(outcomeSide("yes")).toBe("approve");
    expect(outcomeSide("approve")).toBe("approve");
    expect(outcomeSide("no")).toBe("reject");
    expect(outcomeSide("request_changes")).toBe("reject");
    expect(outcomeSide("ok")).toBe(null);
    expect(outcomeSide(null)).toBe(null);
  });
});

describe("stripProcess", () => {
  it("drops the process prefix from a step title", () => {
    expect(stripProcess("Procure to pay: Approve purchase order")).toBe("Approve purchase order");
    expect(stripProcess("No prefix")).toBe("No prefix");
  });
});
