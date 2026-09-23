import { describe, expect, it } from "vitest";
import { observationId } from "../src/canonical.js";
import type { D1 } from "../src/records.js";
import { supersededIds } from "../src/supersede.js";

const d1 = (instances: string[], observed_at: string): D1 =>
  ({
    schema_version: 1,
    subject: "0xabc",
    axis: "context.graph",
    kind: "D1",
    self_asserted: false,
    observed_at,
    unestablished: "u",
    resource: { present: "graph", absent: "ablated" },
    pairing: { key: ["url"], pairs: instances.length, informative_pairs: 0, instances },
    metric: { name: "uncertain_rate", direction: "lower-better", with: 0, without: 0, delta: 0, spread: [0, 0] },
    judge: { id: "s", goldens_version: null, self: false },
    admissible: false,
    inadmissible_because: ["informative_pairs 0 < 5"],
  }) as D1;

describe("supersededIds", () => {
  const older = d1(["a", "b"], "2026-09-01T00:00:00+00:00");
  const newer = d1(["a", "b", "c"], "2026-09-02T00:00:00+00:00");

  it("supersedes an earlier record whose instances are a subset", () => {
    expect(supersededIds([older, newer])).toEqual(new Set([observationId(older)]));
  });

  it("is order-independent, being recomputed rather than stored", () => {
    expect(supersededIds([newer, older])).toEqual(supersededIds([older, newer]));
  });

  it("does not supersede on an overlapping but non-subset set", () => {
    expect(supersededIds([d1(["a", "x"], "2026-09-01T00:00:00+00:00"), newer]).size).toBe(0);
  });

  it("does not supersede across a different subject", () => {
    const other = { ...newer, subject: "0xdef" } as D1;
    expect(supersededIds([older, other]).size).toBe(0);
  });

  it("does not supersede across goldens versions", () => {
    const rescored = { ...newer, judge: { ...newer.judge, goldens_version: "v2" } } as D1;
    expect(supersededIds([older, rescored]).size).toBe(0);
  });

  it("does not supersede a later record by an earlier one", () => {
    expect(
      supersededIds([
        d1(["a", "b", "c"], "2026-09-01T00:00:00+00:00"),
        d1(["a", "b"], "2026-09-02T00:00:00+00:00"),
      ]).size,
    ).toBe(0);
  });
});
