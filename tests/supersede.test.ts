import { describe, expect, it } from "vitest";
import { observationId } from "../src/canonical.js";
import type { D1 } from "../src/records.js";
import { supersededIds } from "../src/supersede.js";
import { deriveD1V2 } from "../src/derive-d1-v2.js";
import { buildJoint } from "../src/joint.js";
import { pairRuns } from "../src/pair-runs.js";
import type { D1V2 } from "../src/records.js";
import { loadRegistry, requireAxis } from "../src/registry.js";
import { ablatedRow, graphRow, recorded } from "./helpers/fixtures.js";

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

describe("supersededIds with version 2", () => {
  const spec = requireAxis(loadRegistry("registry/axes.json"), "context.graph");
  const opts = (at: string) => ({ metric: "uncertain_rate", direction: "lower-better" as const, judgeId: "skeptic", observedAt: at });
  const task2 = (r: typeof graphRow) => ({ ...r, head_sha: "h2" });

  const ag = recorded("alice", graphRow);
  const aa = recorded("alice", ablatedRow);
  const ag2 = recorded("alice", task2(graphRow));
  const aa2 = recorded("alice", task2(ablatedRow));
  const rows = [graphRow, ablatedRow, task2(graphRow), task2(ablatedRow)];

  const small = deriveD1V2(pairRuns([ag.run, aa.run], rows, spec), spec, opts("2026-09-23T12:00:00+00:00")) as D1V2;
  const large = deriveD1V2(
    pairRuns([ag.run, aa.run, ag2.run, aa2.run], rows, spec),
    spec,
    opts("2026-09-23T13:00:00+00:00"),
  ) as D1V2;

  it("lets one runner's larger, later observation supersede its smaller one", () => {
    expect(supersededIds([small, large])).toEqual(new Set([observationId(small)]));
  });

  it("never lets a joint supersede an observation it cites", () => {
    const bg = recorded("bob", graphRow);
    const ba = recorded("bob", ablatedRow);
    const bob = deriveD1V2(pairRuns([bg.run, ba.run], rows, spec), spec, opts("2026-09-23T12:00:00+00:00")) as D1V2;
    const joint = buildJoint({
      sources: [small, bob],
      runs: [ag.run, aa.run, bg.run, ba.run],
      rows,
      spec,
      observedAt: "2026-09-23T14:00:00+00:00",
    });
    expect(supersededIds([small, bob, joint]).size).toBe(0);
  });

  it("never lets version 1 and version 2 supersede each other", () => {
    const v1 = { ...d1(["x"], "2026-09-01T00:00:00+00:00") };
    expect(supersededIds([v1, small]).size).toBe(0);
  });
});
