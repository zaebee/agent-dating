import { describe, expect, it } from "vitest";
import { dischargeProblems, failedRunFor, intentFor, rowProblems, runFor } from "../src/record.js";
import { findingsDigest, sealRun } from "../src/runs.js";
import { ablatedRow, conditionsFor, graphRow, recorded, T0 } from "./helpers/fixtures.js";
import type { IntentInput } from "../src/record.js";
import type { RunIntent } from "../src/runs.js";

const inputOf = (i: RunIntent): IntentInput => ({
  runner: i.runner,
  task: i.task,
  arm: i.arm,
  conditions: i.conditions,
  announcedAt: i.announced_at,
});

describe("runFor", () => {
  const { intent, run } = recorded("alice", graphRow);

  it("cites the intent it discharges", () => {
    expect(run.intent_id).toBe(intent.intent_id);
  });

  it("digests the row's findings exactly", () => {
    expect(run.outcome).toEqual({ ok: true, findings_digest: findingsDigest(graphRow.findings), findings_count: 1 });
  });

  it("refuses a row from a different commit", () => {
    expect(() => runFor(intent, { ...graphRow, head_sha: "h9" }, "2026-09-23T11:00:00+00:00")).toThrow(/task.head_sha/);
  });

  it("refuses a row from the other arm", () => {
    expect(() => runFor(intent, ablatedRow, "2026-09-23T11:00:00+00:00")).toThrow(/arm: announced "graph", ran "ablated"/);
  });

  it("refuses a row with no arm at all", () => {
    const { arm: _drop, ...noArm } = graphRow;
    expect(() => runFor(intent, noArm, "2026-09-23T11:00:00+00:00")).toThrow(/carries no arm/);
  });

  it("refuses a run observed before its intent was announced", () => {
    expect(() => runFor(intent, graphRow, "2026-08-12T08:00:00+00:00")).toThrow(/before it was announced/);
  });

  it("refuses a row reviewed before its intent was announced", () => {
    const late = intentFor({ ...inputOf(intent), announcedAt: "2026-08-12T10:30:00+00:00" });
    expect(() => runFor(late, graphRow, "2026-08-12T11:00:00+00:00")).toThrow(/reviewed at .* before it was announced/);
  });

  it("refuses a graph-arm row whose graph was never built", () => {
    expect(() => runFor(intent, { ...graphRow, had_graph: false }, "2026-08-12T11:00:00+00:00")).toThrow(/had_graph/);
  });

  it("refuses a row from another slice when the run was restricted to one", () => {
    expect(() => runFor(intent, { ...graphRow, pr_slice: "diff-only" }, "2026-08-12T11:00:00+00:00")).toThrow(/slice/);
  });

  it("does not compare slice when the run covered every slice", () => {
    const all = intentFor({ ...inputOf(intent), conditions: { ...intent.conditions, slice: "all" } });
    expect(runFor(all, graphRow, "2026-08-12T11:00:00+00:00").outcome.ok).toBe(true);
  });

  it("records a parse failure the producer reported as a failed run", () => {
    const failed = runFor(intent, { ...graphRow, parse_failed: true }, "2026-09-23T11:00:00+00:00");
    expect(failed.outcome).toMatchObject({ ok: false, failure: "parse" });
  });
});

describe("rowProblems", () => {
  const intent = intentFor({
    runner: "alice",
    task: { url: graphRow.url, head_sha: graphRow.head_sha, project: graphRow.project },
    arm: "graph",
    conditions: { ...conditionsFor(true), skeptic_provider: "v" },
    announcedAt: T0,
  });

  it("treats an absent skeptic_provider as null, as hivemark's genome does", () => {
    const { skeptic_provider: _drop, ...row } = graphRow;
    expect(rowProblems({ ...intent, conditions: { ...intent.conditions, skeptic_provider: null } }, row)).toEqual([]);
  });

  it("names the field that differs", () => {
    expect(rowProblems(intent, { ...graphRow, finder_model: "m2" })).toEqual(['finder_model: announced "m1", ran "m2"']);
  });
});

describe("failedRunFor", () => {
  const { intent } = recorded("alice", graphRow);

  it("records the failure kind and detail", () => {
    expect(failedRunFor(intent, "ingest", "graph build crashed", "2026-09-23T11:00:00+00:00").outcome).toEqual({
      ok: false,
      failure: "ingest",
      detail: "graph build crashed",
    });
  });

  it("refuses an empty detail", () => {
    expect(() => failedRunFor(intent, "ingest", "", "2026-09-23T11:00:00+00:00")).toThrow(/detail is present but empty/);
  });
});

describe("dischargeProblems", () => {
  const { intent, run } = recorded("alice", graphRow);

  it("finds nothing wrong with a run built from its intent", () => {
    expect(dischargeProblems(intent, run)).toEqual([]);
  });

  it("names a condition the run changed", () => {
    const { run_id: _id, ...body } = run;
    const altered = sealRun({ ...body, conditions: { ...run.conditions, graph_digest: "sha256:other" } });
    expect(dischargeProblems(intent, altered)).toEqual([
      'conditions.graph_digest: announced "sha256:g1", ran "sha256:other"',
    ]);
  });
});
