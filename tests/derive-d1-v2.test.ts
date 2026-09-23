import { describe, expect, it } from "vitest";
import { deriveD1V2 } from "../src/derive-d1-v2.js";
import { pairRuns } from "../src/pair-runs.js";
import { loadRegistry, requireAxis } from "../src/registry.js";
import { DECLARED_NOT_VERIFIED } from "../src/runs.js";
import { ablatedRow, graphRow, recorded, rows } from "./helpers/fixtures.js";

const spec = requireAxis(loadRegistry("registry/axes.json"), "context.graph");
const g = recorded("alice", graphRow);
const a = recorded("alice", ablatedRow);
const opts = { metric: "uncertain_rate", direction: "lower-better" as const, judgeId: "skeptic", observedAt: "2026-09-23T12:00:00+00:00" };

describe("deriveD1V2", () => {
  const d1 = deriveD1V2(pairRuns([g.run, a.run], rows, spec), spec, opts);

  it("is version 2", () => {
    expect(d1?.schema_version).toBe(2);
  });

  it("cites the run pair, not the task", () => {
    expect(d1?.pairing.instances).toEqual([[g.run.run_id, a.run.run_id]]);
  });

  it("names its single contributor and carries no joint block", () => {
    expect(d1?.contributors).toEqual(["alice"]);
    expect(d1?.joint).toBeUndefined();
  });

  it("measures exactly as version 1 does", () => {
    expect(d1?.metric.delta).toBe(1);
    expect(d1?.metric.spread).toEqual([1, 1]);
    expect(d1?.admissible).toBe(false);
  });

  it("names what the runner declared and nobody verified", () => {
    expect(d1?.unestablished).toContain(DECLARED_NOT_VERIFIED.join(", "));
  });
});

describe("deriveD1V2 and pre-registration", () => {
  const set = pairRuns([g.run, a.run], rows, spec);

  it("says how many of its runs had no announced intent", () => {
    const d1 = deriveD1V2(set, spec, opts, [g.intent]);
    expect(d1?.unestablished).toMatch(/1 of 2 paired run\(s\) had no announced intent/);
  });

  it("says how many differ from their announcement", () => {
    const announcedElsewhere = { ...g.intent, runner: "mallory" };
    const d1 = deriveD1V2(set, spec, opts, [announcedElsewhere, a.intent]);
    expect(d1?.unestablished).toMatch(/1 differ from their announcement/);
  });

  it("says so when pre-registration was not checked at all", () => {
    expect(deriveD1V2(set, spec, opts)?.unestablished).toMatch(/pre-registration not checked/);
  });
});
