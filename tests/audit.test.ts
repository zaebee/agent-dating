import { describe, expect, it } from "vitest";
import { auditIntents, isClean } from "../src/audit.js";
import { sealRun } from "../src/runs.js";
import { ablatedRow, graphRow, recorded } from "./helpers/fixtures.js";

const g = recorded("alice", graphRow);
const a = recorded("alice", ablatedRow);

const variant = (over: Partial<Parameters<typeof sealRun>[0]>) => {
  const { run_id: _id, ...body } = g.run;
  return sealRun({ ...body, ...over });
};

describe("auditIntents", () => {
  it("is clean when every intent has exactly one faithful run", () => {
    expect(isClean(auditIntents([g.intent, a.intent], [g.run, a.run]))).toBe(true);
  });

  it("lists an intent that no run discharged", () => {
    const audit = auditIntents([g.intent, a.intent], [g.run]);
    expect(audit.unfulfilled.map((i) => i.intent_id)).toEqual([a.intent.intent_id]);
    expect(isClean(audit)).toBe(false);
  });

  it("lists a run citing an intent nobody announced", () => {
    expect(auditIntents([], [g.run]).orphans.map((r) => r.run_id)).toEqual([g.run.run_id]);
  });

  it("lists an intent discharged twice", () => {
    const again = variant({ observed_at: "2026-09-23T12:00:00+00:00" });
    expect(auditIntents([g.intent], [g.run, again]).overdischarged).toEqual([
      { intent_id: g.intent.intent_id, runs: [g.run.run_id, again.run_id].sort() },
    ]);
  });

  it("names the condition a run changed from its announcement", () => {
    const swapped = variant({ conditions: { ...g.run.conditions, finder_model: "m2" } });
    const audit = auditIntents([g.intent], [swapped]);
    expect(audit.mismatched[0]?.problems).toEqual(['conditions.finder_model: announced "m1", ran "m2"']);
  });

  it("flags a run observed before its intent was announced", () => {
    const early = variant({ observed_at: "2026-08-12T08:00:00+00:00" });
    expect(auditIntents([g.intent], [early]).mismatched[0]?.problems.join()).toMatch(/not a pre-registration/);
  });
});
