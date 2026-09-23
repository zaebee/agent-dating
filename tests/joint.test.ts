import { describe, expect, it } from "vitest";
import { observationId } from "../src/canonical.js";
import type { ReviewRow } from "../src/corpus.js";
import { deriveD1V2 } from "../src/derive-d1-v2.js";
import { buildJoint } from "../src/joint.js";
import { pairRuns } from "../src/pair-runs.js";
import type { D1V2 } from "../src/records.js";
import { loadRegistry, requireAxis } from "../src/registry.js";
import type { RunRecord } from "../src/runs.js";
import { ablatedRow, graphRow, recorded, withVerdict } from "./helpers/fixtures.js";

const spec = requireAxis(loadRegistry("registry/axes.json"), "context.graph");
const opts = { metric: "uncertain_rate", direction: "lower-better" as const, judgeId: "skeptic", observedAt: "2026-09-23T12:00:00+00:00" };
const at = "2026-09-23T13:00:00+00:00";

/** One runner's two arms of one task, derived into a version-2 D1. */
function observe(runner: string, gRow: ReviewRow, aRow: ReviewRow, graphDigest?: string) {
  const g = recorded(runner, gRow, graphDigest ? { graphDigest } : {});
  const a = recorded(runner, aRow);
  const rows = [gRow, aRow];
  const obs = deriveD1V2(pairRuns([g.run, a.run], rows, spec), spec, opts) as D1V2;
  return { obs, runs: [g.run, a.run] as RunRecord[], rows };
}

// alice: graph ruled everything (0), ablated left it unruled (1) — the graph helped.
const alice = observe("alice", graphRow, ablatedRow);
// bob on the same task: the opposite.
const bobDisagrees = observe("bob", withVerdict(graphRow, "uncertain"), withVerdict(ablatedRow, "confirmed"));
const bobAgrees = observe("bob", graphRow, ablatedRow);

const joint = (...parts: ReturnType<typeof observe>[]) =>
  buildJoint({
    sources: parts.map((p) => p.obs),
    runs: parts.flatMap((p) => p.runs),
    rows: parts.flatMap((p) => p.rows),
    spec,
    observedAt: at,
  });

describe("buildJoint", () => {
  it("names both contributors, sorted, and cites both sources", () => {
    const j = joint(bobAgrees, alice);
    expect(j.contributors).toEqual(["alice", "bob"]);
    expect(j.joint?.cites).toEqual([observationId(alice.obs), observationId(bobAgrees.obs)].sort());
  });

  it("records agreement when both saw the same graph", () => {
    expect(joint(alice, bobAgrees).joint?.graph_agreement).toBe("identical");
  });

  it("records divergence when the graphs differ", () => {
    const bobOtherGraph = observe("bob", graphRow, ablatedRow, "sha256:g2");
    expect(joint(alice, bobOtherGraph).joint?.graph_agreement).toBe("divergent");
  });

  it("does not average a task, so a disagreement trips gate 1 instead of vanishing into a tie", () => {
    const j = joint(alice, bobDisagrees);
    expect(j.metric.spread).toEqual([-1, 1]);
    expect(j.joint?.contested_tasks).toBe(1);
    expect(j.admissible).toBe(false);
    expect(j.inadmissible_because.join()).toMatch(/spans zero/);
  });

  it("counts a pair once when a source is passed twice", () => {
    const j = buildJoint({
      sources: [alice.obs, alice.obs, bobAgrees.obs],
      runs: [...alice.runs, ...bobAgrees.runs],
      rows: [...alice.rows, ...bobAgrees.rows],
      spec,
      observedAt: at,
    });
    expect(j.pairing.pairs).toBe(2);
    expect(j.joint?.cites).toHaveLength(2);
  });

  it("refuses a joint in which no task was run by two contributors", () => {
    const elsewhere = observe("bob", { ...graphRow, head_sha: "h2" }, { ...ablatedRow, head_sha: "h2" });
    expect(() => joint(alice, elsewhere)).toThrow(/re-runs nothing/);
  });

  it("refuses sources from a single runner", () => {
    expect(() => joint(alice, alice)).toThrow(/at least two distinct runners/);
  });

  it("refuses a source that is itself a joint", () => {
    const j = joint(alice, bobAgrees);
    expect(() =>
      buildJoint({ sources: [j, alice.obs], runs: [...alice.runs, ...bobAgrees.runs], rows: alice.rows, spec, observedAt: at }),
    ).toThrow(/itself a joint/);
  });

  it("refuses sources recorded on an axis other than the one it is asked to join on", () => {
    expect(() =>
      buildJoint({
        sources: [alice.obs, bobAgrees.obs],
        runs: [...alice.runs, ...bobAgrees.runs],
        rows: [...alice.rows, ...bobAgrees.rows],
        spec: { ...spec, axis: "review.skeptic" },
        observedAt: at,
      }),
    ).toThrow(/axis "context.graph", not "review.skeptic"/);
  });

  it("refuses a source whose pairs swap the arms", () => {
    const [g, a] = alice.runs as [RunRecord, RunRecord];
    const forged: D1V2 = { ...alice.obs, pairing: { ...alice.obs.pairing, instances: [[a.run_id, g.run_id]] } };
    expect(() => joint({ ...alice, obs: forged }, bobDisagrees)).toThrow(/does not re-derive from its runs/);
  });

  it("refuses a source that pairs runs of two different tasks", () => {
    const a2 = recorded("alice", { ...ablatedRow, head_sha: "h2" }).run;
    const g = alice.runs[0] as RunRecord;
    const forged: D1V2 = { ...alice.obs, pairing: { ...alice.obs.pairing, instances: [[g.run_id, a2.run_id]] } };
    const part = { obs: forged, runs: [g, a2], rows: [graphRow, { ...ablatedRow, head_sha: "h2" }] };
    expect(() => joint(part, bobAgrees)).toThrow(/does not re-derive from its runs/);
  });

  it("refuses a source labelled with a runner other than the one who ran it", () => {
    const forged: D1V2 = { ...bobAgrees.obs, contributors: ["carol"] };
    expect(() => joint(alice, { ...bobAgrees, obs: forged })).toThrow(/contributors/);
  });

  it("refuses a source whose stated metric its runs do not give", () => {
    const forged: D1V2 = { ...alice.obs, metric: { ...alice.obs.metric, delta: 0.5 } };
    expect(() => joint({ ...alice, obs: forged }, bobAgrees)).toThrow(/metric/);
  });

  it("refuses two completed runs of one task and arm by one runner across sources", () => {
    const again = recorded("alice", ablatedRow, { at: "2026-08-12T12:00:00+00:00" });
    const g = alice.runs[0] as RunRecord;
    const second = deriveD1V2(pairRuns([g, again.run], [graphRow, ablatedRow], spec), spec, opts) as D1V2;
    const part = { obs: second, runs: [g, again.run], rows: [graphRow, ablatedRow] };
    expect(() => joint(alice, part, bobAgrees)).toThrow(/more than one completed run/);
  });

  it("refuses a source whose runs were not supplied", () => {
    expect(() =>
      buildJoint({ sources: [alice.obs, bobAgrees.obs], runs: alice.runs, rows: alice.rows, spec, observedAt: at }),
    ).toThrow(/was not supplied/);
  });
});
