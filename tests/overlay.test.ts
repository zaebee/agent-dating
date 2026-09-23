import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appendOverlay, readOverlay } from "../src/overlay.js";
import type { D3 } from "../src/records.js";
import { sealIntent, sealRun } from "../src/runs.js";

const dir = mkdtempSync(join(tmpdir(), "overlay-"));
const path = join(dir, "overlay.jsonl");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const d3: D3 = {
  schema_version: 1,
  subject: "0xabc",
  axis: "context.graph",
  kind: "D3",
  self_asserted: true,
  observed_at: "2026-09-23T00:00:00+00:00",
  unestablished: "a want, not a measurement",
  want: "an adversarial skeptic",
};

describe("overlay", () => {
  it("appends rather than replacing", () => {
    appendOverlay(path, [d3]);
    appendOverlay(path, [{ ...d3, want: "long-term memory" }]);
    expect(readOverlay(path)).toHaveLength(2);
  });

  it("round-trips a record unchanged", () => {
    expect(readOverlay(path)[0]).toEqual(d3);
  });

  it("names the path and line when a line is not JSON at all", () => {
    const broken = join(dir, "broken.jsonl");
    writeFileSync(broken, "{not json\n", "utf8");
    expect(() => readOverlay(broken)).toThrow(/broken\.jsonl:1 is not JSON/);
  });

  it("refuses a record that does not validate on read", () => {
    appendOverlay(path, [{ ...d3, self_asserted: false } as unknown as D3]);
    expect(() => readOverlay(path)).toThrow();
  });
});

describe("overlay with run records", () => {
  const runsPath = join(dir, "runs.jsonl");
  const conditions = {
    review_fingerprint: "fp",
    finder_model: "m1",
    finder_provider: "v",
    skeptic_model: null,
    skeptic_provider: null,
    temperature: null,
    slice: "graph" as const,
    profile: "core",
    guardian_sha: "g",
    graph_digest: null,
  };
  const intent = sealIntent({
    schema_version: 2,
    kind: "I",
    announced_at: "2026-09-23T10:00:00+00:00",
    runner: "alice",
    task: { url: "u", head_sha: "h", project: "p" },
    arm: "ablated",
    conditions,
    unestablished: "u",
  });
  const run = sealRun({
    schema_version: 2,
    kind: "R",
    intent_id: intent.intent_id,
    observed_at: "2026-09-23T11:00:00+00:00",
    runner: "alice",
    task: intent.task,
    arm: "ablated",
    conditions,
    outcome: { ok: false, failure: "ingest", detail: "no graph" },
    declared_not_verified: ["finder_model"],
    unestablished: "u",
  });

  it("round-trips intents and runs", () => {
    appendOverlay(runsPath, [intent, run]);
    expect(readOverlay(runsPath)).toEqual([intent, run]);
  });

  it("refuses a D1 of an unknown schema version", () => {
    const odd = join(dir, "odd.jsonl");
    writeFileSync(odd, `${JSON.stringify({ kind: "D1", schema_version: 9 })}\n`, "utf8");
    expect(() => readOverlay(odd)).toThrow(/unknown schema_version 9/);
  });
});
