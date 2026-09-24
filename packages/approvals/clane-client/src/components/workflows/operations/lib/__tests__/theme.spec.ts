import { stateTone, toneClass, dsStatus } from "../theme";
import { money } from "../money";

describe("stateTone", () => {
  it("maps every task state once", () => {
    expect(stateTone("done")).toBe("done");
    expect(stateTone("in_progress")).toBe("working");
    expect(stateTone("review")).toBe("working");
    expect(stateTone("needs_human")).toBe("waiting");
    expect(stateTone("failed")).toBe("stuck");
    expect(stateTone("blocked")).toBe("working");
    expect(stateTone("ready")).toBe("info");
    expect(stateTone("draft")).toBe("info");
    expect(stateTone("cancelled")).toBe("neutral");
    expect(stateTone("whatever")).toBe("neutral");
  });
  it("toneClass prefixes", () => {
    expect(toneClass("stuck")).toBe("tone-stuck");
  });
});

describe("money", () => {
  it("formats with two decimals and currency", () => {
    expect(money(5520, "EUR")).toBe("5,520.00 EUR");
  });
  it("handles strings and nulls", () => {
    expect(money("24.5")).toBe("24.50");
    expect(money(null)).toBe("-");
    expect(money("x")).toBe("-");
  });
});

describe("dsStatus", () => {
  it("maps task states onto the shared StatusDot palette", () => {
    expect(dsStatus("needs_human")).toBe("needsYou");
    expect(dsStatus("in_progress")).toBe("running");
    expect(dsStatus("failed")).toBe("failed");
    expect(dsStatus("done")).toBe("done");
    expect(dsStatus("cancelled")).toBe("var(--text-faint)");
  });
});
