import { describe, expect, it } from "vitest";
import { readManifest, readReviews } from "../src/corpus.js";
import { deriveD1 } from "../src/derive-d1.js";
import { pairReviews } from "../src/pair.js";
import { loadRegistry, requireAxis } from "../src/registry.js";
import { subjectOf } from "../src/subject.js";

const spec = requireAxis(loadRegistry("registry/axes.json"), "context.graph");
const rows = readReviews(readManifest("tests/fixtures/mini.json"));
const opts = {
  metric: "uncertain_rate",
  direction: "lower-better" as const,
  judgeId: "s1",
  observedAt: "2026-09-23T00:00:00+00:00",
};

describe("deriveD1", () => {
  const d1 = deriveD1(pairReviews(rows, spec), spec, opts);

  it("produces a record that validates", () => {
    expect(d1?.kind).toBe("D1");
  });

  it("takes subject from the present arm", () => {
    expect(d1?.subject).toBe(subjectOf(rows[0]!));
  });

  it("normalises the sign so positive means the resource helped", () => {
    expect(d1?.metric.delta).toBe(1);
    expect(d1?.metric.spread).toEqual([1, 1]);
  });

  it("sets goldens_version null for a verdict-derived metric", () => {
    expect(d1?.judge.goldens_version).toBeNull();
  });

  it("records one instance per pair", () => {
    expect(d1?.pairing.instances).toEqual(["https://x/pull/1@h1"]);
    expect(d1?.pairing.pairs).toBe(1);
  });

  it("is inadmissible on gate 2 with one informative pair", () => {
    expect(d1?.admissible).toBe(false);
    expect(d1?.inadmissible_because.join()).toMatch(/informative_pairs 1 < 5/);
  });

  it("names the pairs it dropped in unestablished", () => {
    expect(d1?.unestablished).toMatch(/dropped 0 pair/);
  });

  it("returns null when no pair survives", () => {
    expect(deriveD1({ key: spec.identifying, pairs: [], unplanned: 0 }, spec, opts)).toBeNull();
  });
});
