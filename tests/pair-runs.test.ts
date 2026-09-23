import { describe, expect, it } from "vitest";
import { pairRuns, rowFor } from "../src/pair-runs.js";
import { failedRunFor, intentFor, type IntentInput } from "../src/record.js";
import type { RunIntent } from "../src/runs.js";

const inputOf = (i: RunIntent): IntentInput => ({
  runner: i.runner,
  task: i.task,
  arm: i.arm,
  conditions: i.conditions,
  announcedAt: i.announced_at,
});
import { loadRegistry, requireAxis } from "../src/registry.js";
import { sealRun } from "../src/runs.js";
import { ablatedRow, graphRow, recorded, rows, withVerdict } from "./helpers/fixtures.js";

const spec = requireAxis(loadRegistry("registry/axes.json"), "context.graph");
const g = recorded("alice", graphRow);
const a = recorded("alice", ablatedRow);

describe("pairRuns", () => {
  it("pairs the two arms of one task by one runner", () => {
    const set = pairRuns([g.run, a.run], rows, spec);
    expect(set.pairs).toHaveLength(1);
    expect(set.pairs[0]?.present.run_id).toBe(g.run.run_id);
    expect(set.runner).toBe("alice");
  });

  it("counts a failed run and does not pair it", () => {
    const failed = failedRunFor(a.intent, "timeout", "900s", "2026-09-23T11:00:00+00:00");
    const set = pairRuns([g.run, failed], rows, spec);
    expect(set.pairs).toHaveLength(0);
    expect(set.failed).toBe(1);
    expect(set.unpaired).toBe(1);
  });

  it("counts a graph-arm run that failed at ingest, which has no graph to digest", () => {
    const noGraph = intentFor({ ...inputOf(g.intent), conditions: { ...g.intent.conditions, graph_digest: null } });
    const failed = failedRunFor(noGraph, "ingest", "graph build crashed", "2026-08-12T11:00:00+00:00");
    const set = pairRuns([failed, a.run], rows, spec);
    expect(set.failed).toBe(1);
    expect(set.pairs).toHaveLength(0);
  });

  it("refuses runs from two runners", () => {
    expect(() => pairRuns([g.run, recorded("bob", ablatedRow).run], rows, spec)).toThrow(/2 runners/);
  });

  it("refuses runs under two configurations", () => {
    const { run_id: _id, ...body } = a.run;
    const other = sealRun({ ...body, conditions: { ...a.run.conditions, finder_model: "m2" } });
    expect(() => pairRuns([g.run, other], rows, spec)).toThrow(/2 configurations/);
  });

  it("refuses a graph-arm run with no graph_digest", () => {
    const { run_id: _id, ...body } = g.run;
    const bare = sealRun({ ...body, conditions: { ...g.run.conditions, graph_digest: null } });
    expect(() => pairRuns([bare, a.run], rows, spec)).toThrow(/no graph_digest/);
  });

  it("refuses two completed runs of one task on one arm", () => {
    const again = recorded("alice", graphRow, { at: "2026-09-23T12:00:00+00:00" });
    expect(() => pairRuns([g.run, again.run, a.run], rows, spec)).toThrow(/two completed runs/);
  });
});

describe("rowFor", () => {
  it("refuses when the row's findings changed after the run was recorded", () => {
    const edited = [withVerdict(graphRow, "uncertain"), ablatedRow];
    expect(() => rowFor(g.run, edited)).toThrow(/findings changed since run/);
  });

  it("refuses when no row for the run was supplied", () => {
    expect(() => rowFor(g.run, [ablatedRow])).toThrow(/no review row supplied/);
  });
});
