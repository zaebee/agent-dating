import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { observationId } from "../src/canonical.js";
import { main } from "../src/cli-runs.js";
import { readOverlay } from "../src/overlay.js";
import type { D1V2 } from "../src/records.js";
import type { RunIntent, RunRecord } from "../src/runs.js";
import { ablatedRow, conditionsFor, graphRow, withVerdict } from "./helpers/fixtures.js";

const dir = mkdtempSync(join(tmpdir(), "runs-e2e-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const at = (f: string) => join(dir, f);
const overlay = at("overlay.jsonl");
const jsonl = (rows: object[]) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

// alice's reviews show the graph helping; bob's, on the same task, the opposite.
const bobGraph = withVerdict(graphRow, "uncertain");
const bobAblated = withVerdict(ablatedRow, "confirmed");
/**
 * Written after the intents are announced, stamped with the time of writing —
 * the order the workflow has in reality: announce, then review, then record.
 */
function writeReviews(): void {
  const reviewedAt = new Date().toISOString();
  const stamp = (rows: object[]) => rows.map((r) => ({ ...r, reviewed_at: reviewedAt }));
  writeFileSync(at("alice.jsonl"), jsonl(stamp([graphRow, ablatedRow])));
  writeFileSync(at("bob.jsonl"), jsonl(stamp([bobGraph, bobAblated])));
  writeFileSync(at("both.jsonl"), jsonl(stamp([graphRow, ablatedRow, bobGraph, bobAblated])));
}
writeFileSync(at("graph.json"), JSON.stringify(conditionsFor(true)));
writeFileSync(at("ablated.json"), JSON.stringify(conditionsFor(false)));

const intentOf = (runner: string, arm: string): string => {
  const hit = readOverlay(overlay).find((r): r is RunIntent => r.kind === "I" && r.runner === runner && r.arm === arm);
  if (!hit) throw new Error(`no intent for ${runner}/${arm}`);
  return hit.intent_id;
};

const announce = (runner: string, arm: "graph" | "ablated") =>
  main([
    "intent",
    "--runner", runner,
    "--url", graphRow.url,
    "--head", graphRow.head_sha,
    "--project", graphRow.project,
    "--arm", arm,
    "--conditions", at(`${arm}.json`),
    "--overlay", overlay,
  ]);

const v2 = () => readOverlay(overlay).filter((r): r is D1V2 => r.kind === "D1" && r.schema_version === 2);

describe("runs CLI end to end", () => {
  it("announces four runs", () => {
    for (const runner of ["alice", "bob"]) for (const arm of ["graph", "ablated"] as const) expect(announce(runner, arm)).toBe(0);
  });

  it("records each run against its own reviews file", () => {
    writeReviews();
    for (const runner of ["alice", "bob"]) {
      for (const arm of ["graph", "ablated"]) {
        expect(main(["run", "--intent", intentOf(runner, arm), "--reviews", at(`${runner}.jsonl`), "--overlay", overlay])).toBe(0);
      }
    }
  });

  it("derives one observation per runner", () => {
    expect(main(["derive", "--runner", "alice", "--reviews", at("alice.jsonl"), "--overlay", overlay])).toBe(0);
    expect(main(["derive", "--runner", "bob", "--reviews", at("bob.jsonl"), "--overlay", overlay])).toBe(0);
    expect(v2().map((d) => d.contributors)).toEqual([["alice"], ["bob"]]);
  });

  it("states that every run it derived from was announced", () => {
    expect(v2().map((d) => d.unestablished)).toEqual([
      expect.stringMatching(/0 of 2 paired run\(s\) had no announced intent and 0 differ/),
      expect.stringMatching(/0 of 2 paired run\(s\) had no announced intent and 0 differ/),
    ]);
  });

  it("builds a joint that records the disagreement", () => {
    const sources = v2().map((d) => observationId(d)).join(",");
    expect(main(["joint", "--sources", sources, "--reviews", at("both.jsonl"), "--overlay", overlay])).toBe(0);
    const joint = v2().find((d) => d.joint);
    expect(joint?.contributors).toEqual(["alice", "bob"]);
    expect(joint?.joint?.contested_tasks).toBe(1);
    expect(joint?.admissible).toBe(false);
  });

  it("audits clean when every announcement was run", () => {
    expect(main(["audit", "--overlay", overlay])).toBe(0);
  });

  it("audits dirty once an announcement is left unrun", () => {
    expect(
      main([
        "intent",
        "--runner", "carol",
        "--url", graphRow.url,
        "--head", graphRow.head_sha,
        "--project", graphRow.project,
        "--arm", "graph",
        "--conditions", at("graph.json"),
        "--overlay", overlay,
      ]),
    ).toBe(0);
    expect(main(["audit", "--overlay", overlay])).toBe(1);
  });
});

describe("runs CLI after a re-run", () => {
  const rerunOverlay = at("rerun.jsonl");
  const announceTo = (arm: "graph" | "ablated") =>
    main([
      "intent", "--runner", "dave",
      "--url", graphRow.url, "--head", graphRow.head_sha, "--project", graphRow.project,
      "--arm", arm, "--conditions", at(`${arm}.json`), "--overlay", rerunOverlay,
    ]);
  const runIds = () => readOverlay(rerunOverlay).filter((r): r is RunRecord => r.kind === "R").map((r) => r.run_id);

  it("records two completed graph runs and one ablated run", () => {
    for (const arm of ["graph", "graph", "ablated"] as const) {
      expect(announceTo(arm)).toBe(0);
      writeReviews();
      const intent = readOverlay(rerunOverlay).filter((r): r is RunIntent => r.kind === "I").at(-1) as RunIntent;
      expect(main(["run", "--intent", intent.intent_id, "--reviews", at("alice.jsonl"), "--overlay", rerunOverlay])).toBe(0);
    }
    expect(runIds()).toHaveLength(3);
  });

  it("refuses to choose between the two graph runs itself", () => {
    expect(main(["derive", "--runner", "dave", "--reviews", at("alice.jsonl"), "--overlay", rerunOverlay])).toBe(2);
  });

  it("derives from the runs it is told to use", () => {
    const [firstGraph, , ablated] = runIds() as [string, string, string];
    expect(
      main(["derive", "--runs", `${firstGraph},${ablated}`, "--reviews", at("alice.jsonl"), "--overlay", rerunOverlay]),
    ).toBe(0);
  });

  it("refuses both selectors at once", () => {
    expect(
      main(["derive", "--runner", "dave", "--runs", "x", "--reviews", at("alice.jsonl"), "--overlay", rerunOverlay]),
    ).toBe(2);
  });
});

describe("runs CLI refusals", () => {
  it("refuses an unknown flag", () => {
    expect(main(["audit", "--overlay", overlay, "--verbose", "yes"])).toBe(2);
  });

  it("refuses a missing flag", () => {
    expect(main(["audit"])).toBe(2);
  });

  it("refuses an unknown command", () => {
    expect(main(["publish", "--overlay", overlay])).toBe(2);
  });

  it("refuses a reviews file holding two rows for the announced task and arm", () => {
    expect(main(["run", "--intent", intentOf("alice", "graph"), "--reviews", at("both.jsonl"), "--overlay", overlay])).toBe(2);
  });
});
