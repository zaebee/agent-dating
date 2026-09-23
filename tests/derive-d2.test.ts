import { describe, expect, it } from "vitest";
import { readManifest, readReviews } from "../src/corpus.js";
import { deriveD2, refusalD2 } from "../src/derive-d2.js";
import { CATEGORIES } from "../src/records.js";

const rows = readReviews(readManifest("tests/fixtures/mini.json"));
const at = "2026-09-23T00:00:00+00:00";

describe("deriveD2", () => {
  const out = deriveD2(rows, "context.graph", at);

  it("emits one record per category per subject, not only where undecidables exist", () => {
    const subjects = new Set(out.map((d) => d.subject));
    expect(out).toHaveLength(subjects.size * CATEGORIES.length);
  });

  it("marks a category that never came up with total 0", () => {
    const security = out.find((d) => d.category === "security");
    expect(security?.verdicts.total).toBe(0);
    expect(security?.grounds).toMatch(/never came up/);
  });

  it("quotes the skeptic note as grounds rather than synthesising one", () => {
    const logic = out.find((d) => d.category === "logic" && d.verdicts.undecidable > 0);
    expect(logic?.grounds).toBe("not in the provided diff hunks");
  });

  it("marks a category that came up and was fully ruled", () => {
    const logic = out
      .filter((d) => d.category === "logic")
      .find((d) => d.verdicts.total > 0 && d.verdicts.undecidable === 0);
    expect(logic?.grounds).toMatch(/all ruled/);
  });

  it("classifies every ground on this corpus as more-evidence", () => {
    expect(new Set(out.filter((d) => d.verdicts.undecidable > 0).map((d) => d.resolvable_by))).toEqual(
      new Set(["more-evidence"]),
    );
  });
});

describe("refusalD2", () => {
  it("turns a refused join into an undecidable record", () => {
    const d = refusalD2(
      {
        url: "https://x/pull/1",
        had_graph: true,
        grounds: "judged row does not name the finder",
        candidates: ["m1", "m2"],
      },
      "0xabc",
      "context.graph",
      at,
    );
    expect(d.resolvable_by).toBe("more-evidence");
    expect(d.verdicts.total).toBe(0);
    expect(d.grounds).toMatch(/does not name the finder/);
  });
});
