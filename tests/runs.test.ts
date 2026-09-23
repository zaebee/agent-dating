import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readManifest, readReviews } from "../src/corpus.js";
import {
  DECLARED_NOT_VERIFIED,
  findingsDigest,
  graphDigest,
  RunIntentSchema,
  RunRecordSchema,
  sealIntent,
  sealRun,
  type Conditions,
} from "../src/runs.js";

const dir = mkdtempSync(join(tmpdir(), "runs-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const conditions: Conditions = {
  review_fingerprint: "fp",
  finder_model: "m1",
  finder_provider: "v",
  skeptic_model: "s1",
  skeptic_provider: "v",
  temperature: null,
  slice: "graph",
  profile: "core",
  guardian_sha: "g",
  graph_digest: "sha256:g1",
};

const intentBody = {
  schema_version: 2 as const,
  kind: "I" as const,
  announced_at: "2026-09-23T10:00:00+00:00",
  runner: "alice",
  task: { url: "https://x/pull/1", head_sha: "h1", project: "p" },
  arm: "graph",
  conditions,
  unestablished: "announces a run",
};

const runBody = (intent_id: string) => ({
  schema_version: 2 as const,
  kind: "R" as const,
  intent_id,
  observed_at: "2026-09-23T11:00:00+00:00",
  runner: "alice",
  task: intentBody.task,
  arm: "graph",
  conditions,
  outcome: { ok: true as const, findings_digest: "sha256:f", findings_count: 1 },
  declared_not_verified: [...DECLARED_NOT_VERIFIED],
  unestablished: "records a run",
});

describe("sealIntent", () => {
  const intent = sealIntent(intentBody);

  it("produces a record its own schema accepts", () => {
    expect(RunIntentSchema.parse(intent).intent_id).toBe(intent.intent_id);
  });

  it("refuses a record altered after sealing", () => {
    const r = RunIntentSchema.safeParse({ ...intent, arm: "ablated" });
    expect(JSON.stringify(r)).toMatch(/does not match its contents/);
  });

  it("is independent of key order", () => {
    const reordered = { ...intentBody, conditions: { ...conditions }, task: { project: "p", head_sha: "h1", url: "https://x/pull/1" } };
    expect(sealIntent(reordered).intent_id).toBe(intent.intent_id);
  });

  it("changes when any condition changes", () => {
    expect(sealIntent({ ...intentBody, conditions: { ...conditions, temperature: 0.7 } }).intent_id).not.toBe(intent.intent_id);
  });

  it("refuses an unknown condition rather than hashing it in", () => {
    expect(() => sealIntent({ ...intentBody, conditions: { ...conditions, seed: 1 } as Conditions })).toThrow();
  });

  it("refuses an announcement with no offset", () => {
    expect(() => sealIntent({ ...intentBody, announced_at: "2026-09-23T10:00:00" })).toThrow(/announced_at carries no UTC offset/);
  });
});

describe("sealRun", () => {
  const run = sealRun(runBody("sha256:i"));

  it("produces a record its own schema accepts", () => {
    expect(RunRecordSchema.parse(run).run_id).toBe(run.run_id);
  });

  it("hashes the outcome, so two outcomes cannot share an id", () => {
    const other = sealRun({ ...runBody("sha256:i"), outcome: { ok: true as const, findings_digest: "sha256:other", findings_count: 1 } });
    expect(other.run_id).not.toBe(run.run_id);
  });

  it("records a failure with its kind and detail", () => {
    const failed = sealRun({ ...runBody("sha256:i"), outcome: { ok: false as const, failure: "timeout" as const, detail: "900s" } });
    expect(failed.outcome.ok).toBe(false);
  });

  it("refuses a failure with an empty detail", () => {
    expect(() => sealRun({ ...runBody("sha256:i"), outcome: { ok: false as const, failure: "timeout" as const, detail: " " } })).toThrow(/detail is present but empty/);
  });

  it("refuses an unsorted declared_not_verified", () => {
    expect(() => sealRun({ ...runBody("sha256:i"), declared_not_verified: ["temperature", "finder_model"] })).toThrow(/sorted/);
  });
});

describe("findingsDigest", () => {
  it("ignores object key order", () => {
    expect(findingsDigest([{ a: 1, b: 2 }])).toBe(findingsDigest([{ b: 2, a: 1 }]));
  });

  it("respects array order", () => {
    expect(findingsDigest([1, 2])).not.toBe(findingsDigest([2, 1]));
  });

  it("digests a finding exactly as written, including keys this reader does not model", () => {
    const line = JSON.parse(readFileSync("tests/fixtures/mini/reviews.jsonl", "utf8").split("\n")[0] as string);
    line.findings[0].rule_id = "R-1";
    writeFileSync(join(dir, "r.jsonl"), `${JSON.stringify(line)}\n`);
    writeFileSync(join(dir, "m.json"), JSON.stringify({ base: ".", reviews: ["r.jsonl"], judged: [] }));
    const parsed = readReviews(readManifest(join(dir, "m.json")))[0];
    expect(findingsDigest(parsed?.findings ?? [])).toBe(findingsDigest(line.findings));
  });
});

describe("graphDigest", () => {
  const build = (name: string, order: string[]) => {
    const root = join(dir, name);
    mkdirSync(join(root, "sub"), { recursive: true });
    const content: Record<string, string> = { "a.json": "A", "sub/b.json": "B" };
    for (const f of order) writeFileSync(join(root, f), content[f] as string);
    return root;
  };

  it("digests a single file by its bytes", () => {
    writeFileSync(join(dir, "g.bin"), "graph");
    expect(graphDigest(join(dir, "g.bin"))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is independent of the order files were written in", () => {
    expect(graphDigest(build("g1", ["a.json", "sub/b.json"]))).toBe(graphDigest(build("g2", ["sub/b.json", "a.json"])));
  });

  it("is independent of modification times", () => {
    const root = build("g3", ["a.json", "sub/b.json"]);
    const before = graphDigest(root);
    utimesSync(join(root, "a.json"), new Date(0), new Date(0));
    expect(graphDigest(root)).toBe(before);
  });

  it("changes when content changes", () => {
    const root = build("g4", ["a.json", "sub/b.json"]);
    const before = graphDigest(root);
    writeFileSync(join(root, "a.json"), "A2");
    expect(graphDigest(root)).not.toBe(before);
  });

  it("refuses an empty artefact, which is a failed ingest and not a graph", () => {
    mkdirSync(join(dir, "empty"));
    expect(() => graphDigest(join(dir, "empty"))).toThrow(/empty/);
  });
});
