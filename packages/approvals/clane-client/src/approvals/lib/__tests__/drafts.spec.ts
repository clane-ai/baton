import { loadDraft, saveDraft, clearDraft } from "../drafts";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe("drafts", () => {
  it("round trips per task key", () => {
    const s = mem();
    saveDraft(s, "TSK-1", "why");
    expect(loadDraft(s, "TSK-1")).toBe("why");
    expect(loadDraft(s, "TSK-2")).toBe("");
    clearDraft(s, "TSK-1");
    expect(loadDraft(s, "TSK-1")).toBe("");
  });
  it("saving an empty draft clears it", () => {
    const s = mem();
    saveDraft(s, "TSK-1", "why");
    saveDraft(s, "TSK-1", "   ");
    expect(loadDraft(s, "TSK-1")).toBe("");
  });
  it("survives a throwing store", () => {
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(loadDraft(bad, "k")).toBe("");
    expect(() => saveDraft(bad, "k", "v")).not.toThrow();
    expect(() => clearDraft(bad, "k")).not.toThrow();
  });
});
