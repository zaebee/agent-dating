import { describe, expect, it } from "vitest";
import { D1Schema, D2Schema, D3Schema, RECORD_SCHEMA_VERSION } from "../src/records.js";

const envelope = {
  schema_version: RECORD_SCHEMA_VERSION,
  subject: "0xabc",
  axis: "context.graph",
  self_asserted: false,
  observed_at: "2026-09-23T10:00:00+00:00",
  unestablished: "the ablated arm covers one finder model only",
};

const d1 = {
  ...envelope,
  kind: "D1" as const,
  resource: { present: "graph", absent: "ablated" },
  pairing: { key: ["url", "head_sha", "finder_model"], pairs: 2, informative_pairs: 1, instances: ["u@a", "u@b"] },
  metric: {
    name: "uncertain_rate",
    direction: "lower-better" as const,
    with: 0.0763,
    without: 0.1746,
    delta: 0.2593,
    spread: [0, 1] as [number, number],
  },
  judge: { id: "gemini-2.5-flash", goldens_version: null, self: false },
  admissible: false,
  inadmissible_because: ["informative_pairs 1 < 5"],
};

describe("D1Schema", () => {
  it("accepts a well-formed record", () => {
    expect(D1Schema.parse(d1).kind).toBe("D1");
  });

  it("refuses an absent unestablished", () => {
    const { unestablished: _drop, ...rest } = d1;
    expect(D1Schema.safeParse(rest).success).toBe(false);
  });

  it("refuses an empty unestablished, which is not the same failure", () => {
    const r = D1Schema.safeParse({ ...d1, unestablished: "  " });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).toMatch(/empty/);
  });

  it("refuses a timestamp with no offset", () => {
    expect(D1Schema.safeParse({ ...d1, observed_at: "2026-09-23T10:00:00" }).success).toBe(false);
  });

  it("refuses an unparseable timestamp", () => {
    expect(D1Schema.safeParse({ ...d1, observed_at: "soon" }).success).toBe(false);
  });

  it("refuses instances that disagree with pairs", () => {
    const r = D1Schema.safeParse({ ...d1, pairing: { ...d1.pairing, instances: ["u@a"] } });
    expect(JSON.stringify(r)).toMatch(/pairs 2 but 1 instance/);
  });

  it("refuses informative_pairs above pairs", () => {
    const r = D1Schema.safeParse({ ...d1, pairing: { ...d1.pairing, informative_pairs: 3 } });
    expect(JSON.stringify(r)).toMatch(/informative_pairs 3 exceeds pairs 2/);
  });

  it("refuses an unrounded float", () => {
    const r = D1Schema.safeParse({ ...d1, metric: { ...d1.metric, delta: 0.25925 } });
    expect(JSON.stringify(r)).toMatch(/not rounded to 4 decimals/);
  });

  it("refuses goldens_version on a verdict-derived metric", () => {
    const r = D1Schema.safeParse({ ...d1, judge: { ...d1.judge, goldens_version: "v3" } });
    expect(JSON.stringify(r)).toMatch(/verdict-derived/);
  });

  it("refuses self_asserted true", () => {
    expect(D1Schema.safeParse({ ...d1, self_asserted: true }).success).toBe(false);
  });

  it("refuses a non-empty reason on an admissible record", () => {
    const r = D1Schema.safeParse({ ...d1, admissible: true });
    expect(JSON.stringify(r)).toMatch(/admissible record carries/);
  });
});

describe("D2Schema", () => {
  const d2 = {
    ...envelope,
    kind: "D2" as const,
    category: "logic",
    verdicts: { undecidable: 49, total: 672, refs: ["u@a"] },
    grounds: "the definition was not in the provided diff hunks",
    resolvable_by: "more-evidence" as const,
  };

  it("accepts a well-formed record", () => {
    expect(D2Schema.parse(d2).resolvable_by).toBe("more-evidence");
  });

  it("accepts total 0, which means the category never came up", () => {
    const parsed = D2Schema.parse({
      ...d2,
      verdicts: { undecidable: 0, total: 0, refs: [] },
      grounds: "category not observed",
    });
    expect(parsed.verdicts.total).toBe(0);
  });

  it("refuses undecidable above total", () => {
    expect(D2Schema.safeParse({ ...d2, verdicts: { undecidable: 700, total: 672, refs: [] } }).success).toBe(false);
  });

  it("refuses empty grounds", () => {
    expect(D2Schema.safeParse({ ...d2, grounds: " " }).success).toBe(false);
  });

  it("refuses an undefined category", () => {
    expect(D2Schema.safeParse({ ...d2, category: "style" }).success).toBe(false);
  });
});

describe("D3Schema", () => {
  it("requires self_asserted true", () => {
    const d3 = { ...envelope, kind: "D3" as const, self_asserted: true, want: "an adversarial skeptic" };
    expect(D3Schema.parse(d3).want).toBe("an adversarial skeptic");
    expect(D3Schema.safeParse({ ...d3, self_asserted: false }).success).toBe(false);
  });
});
