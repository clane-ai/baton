import { describe, it, expect } from "vitest";
import { policySummary } from "../policy";

describe("policySummary", () => {
  it("clean purchase order", () => {
    expect(policySummary("purchase_order", { total: 5520, currency: "EUR", policy_check: { approver_level: "manager", vendor_approved: true, approval_required: true } })).toEqual({
      tone: "done",
      text: "Ready to approve. Manager level, vendor approved, 5,520.00 EUR.",
    });
  });
  it("director level needs escalation", () => {
    const s = policySummary("purchase_order", { total: 25200, currency: "EUR", policy_check: { approver_level: "director", vendor_approved: true } });
    expect(s?.tone).toBe("stuck");
    expect(s?.text).toBe("Needs a director. 25,200.00 EUR is above manager level; reject with \"escalate\" unless you hold that authority. Vendor approved.");
  });
  it("unapproved vendor", () => {
    const s = policySummary("purchase_order", { total: 1788, currency: "EUR", policy_check: { vendor_approved: false, approver_level: "none" } });
    expect(s?.tone).toBe("stuck");
    expect(s?.text).toBe("Vendor not approved. Reject until the vendor is onboarded. 1,788.00 EUR, no approver needed by amount.");
  });
  it("three-way match, mismatched and matched", () => {
    expect(policySummary("invoice_match", { status: "mismatched", amount_payable: 0, currency: "EUR", variances: ["x"] })).toEqual({ tone: "stuck", text: "Mismatched. Nothing payable until resolved. 1 variance." });
    expect(policySummary("invoice_match", { status: "matched", amount_payable: 5520, currency: "EUR", variances: [] })).toEqual({ tone: "done", text: "Matched. 5,520.00 EUR payable." });
  });
  it("goods receipt, complete and short", () => {
    expect(policySummary("goods_receipt", { complete: true, discrepancies: [] })).toEqual({ tone: "done", text: "Received in full and in good condition." });
    expect(policySummary("goods_receipt", { complete: false, discrepancies: ["a", "b"] })).toEqual({ tone: "working", text: "Incomplete. 2 discrepancies." });
  });
  it("unknown kind gives null", () => {
    expect(policySummary("handoff", {})).toBeNull();
  });
});
