// One-sentence verdicts built from an artefact's own policy fields, in the approver's words.
import type { Tone } from "./theme";
import { money } from "./money";

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type PolicySummary = { tone: Tone; text: string };

export function policySummary(kind: string, content: unknown): PolicySummary | null {
  const a = o(content);
  if (kind === "purchase_order") {
    const pc = o(a.policy_check);
    const level = String(pc.approver_level ?? "");
    const amt = money(a.total, a.currency);
    const vendorOk = pc.vendor_approved !== false;
    if (!vendorOk) {
      const byAmount = level === "none" || !level ? "no approver needed by amount" : `${level} level by amount`;
      return { tone: "stuck", text: `Vendor not approved. Reject until the vendor is onboarded. ${amt}, ${byAmount}.` };
    }
    if (level === "director" || level === "cfo") {
      return { tone: "stuck", text: `Needs a ${level === "cfo" ? "CFO" : "director"}. ${amt} is above manager level; reject with "escalate" unless you hold that authority. Vendor approved.` };
    }
    const lvl = level === "none" || !level ? "No approver needed by amount" : `${cap(level)} level`;
    const budget = pc.within_budget === false ? " Over budget." : "";
    return { tone: pc.within_budget === false ? "working" : "done", text: `Ready to approve. ${lvl}, vendor approved, ${amt}.${budget}` };
  }
  if (kind === "invoice_match") {
    const variances = Array.isArray(a.variances) ? a.variances.length : 0;
    if (a.status === "matched") return { tone: "done", text: `Matched. ${money(a.amount_payable, a.currency)} payable.` };
    return { tone: "stuck", text: `Mismatched. Nothing payable until resolved. ${count(variances, "variance", "variances")}.` };
  }
  if (kind === "goods_receipt") {
    const d = Array.isArray(a.discrepancies) ? a.discrepancies.length : 0;
    if (a.complete === true) return { tone: "done", text: "Received in full and in good condition." };
    return { tone: "working", text: `Incomplete. ${count(d, "discrepancy", "discrepancies")}.` };
  }
  return null;
}
