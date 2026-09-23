# Run Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every run as an announced intent and a sealed outcome, derive version-2 observations whose instances are run pairs, build joint observations across runners explicitly, and make abandoned or altered runs visible.

**Architecture:** Two new record kinds, `I` (intent) and `R` (run), content-addressed and stored in the existing append-only overlay beside D1/D2/D3. A version-2 D1 cites run pairs instead of tasks and names its contributors. Joint observations are built by an explicit call that pools single-runner observations, never averages tasks, and records graph agreement and contested tasks. An audit compares intents to runs. Publication to p-e and anchoring are **not** built here — they belong to `../p-e` and `../hivemark`.

**Tech Stack:** TypeScript 5.9 (strict, `noUncheckedIndexedAccess`), bun 1.3, vitest 3.2, zod 3.25 — unchanged from the existing repository.

**Spec:** `docs/superpowers/specs/2026-09-23-run-provenance-design.md`, read together with `docs/superpowers/specs/2026-09-23-deficit-profile-design.md`, which it amends.

## Global Constraints

- `schema_version: 2` for `I`, `R` and version-2 D1. Version-1 records are never migrated and never compared or pooled with version 2 (profile spec invariant 5).
- `Conditions` fields exactly: `review_fingerprint`, `finder_model`, `finder_provider`, `skeptic_model`, `skeptic_provider`, `temperature`, `slice` (`all` | `graph` | `diff-only`), `profile`, `guardian_sha`, `graph_digest`.
- `declared_not_verified` on every run is `["finder_model", "finder_provider", "skeptic_model", "skeptic_provider", "temperature"]`, sorted.
- Failure kinds exactly: `prepare`, `ingest`, `model-error`, `parse`, `timeout`.
- `graph_agreement` exactly: `identical`, `divergent`, `withheld-both`.
- Tasks are never averaged inside a joint observation (spec §5.2).
- Refuse, never repair. Absent is never empty.
- An intent is announced **after** `prepare` and **before** `review`, because it must carry `graph_digest` and the graph exists only once `prepare` has run.
- Publication of intents to p-e and weekly anchoring are out of scope and appear in no task.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **A reviews row edited after its run was recorded** — a person re-runs derivation on a file someone touched. Expected: refused with "findings changed since run …", never measured on the new findings. Pinned in Task 4.
2. **One run cited by more than one source of a joint** — the same observation passed twice, or two observations sharing a pair. Expected: the pair counts once. Pinned in Task 5.
3. **A run recorded under conditions other than its intent announced** — a different model, a different graph. Expected: the audit lists it under `mismatched` with the differing field named. Pinned in Task 6.
4. **A graph artefact directory walked in a different order or with changed mtimes** — the same graph on another machine. Expected: the same `graph_digest`. Pinned in Task 1.
5. **A run observed before its intent was announced** — the "pre-registration" was written after the fact. Expected: refused at record time, and flagged by the audit when written by another tool. Pinned in Tasks 3 and 6.

## Spec gaps this plan fills

Found while planning; each is resolved in a named task and written back into the spec in Task 7.

- **Supersession must not cross contributor sets.** The spec's §3 says the existing rule "works unchanged". It does not: a joint covering an honest supplier's runs plus fabricated ones is a later superset and would supersede the honest observation — the mirror attack §5 exists to prevent, readmitted through supersession. Task 7.
- **Every version-2 D1 names its contributors**, not only joints, because supersession must group by them. The three joint-only fields move under a `joint` block, so "all or none" holds by construction rather than by a refinement. Task 2.
- **A joint with no task run by more than one contributor is refused.** It re-runs nothing and so checks nothing, and `graph_agreement` would be vacuous. Task 5.
- **An observation holds at most one completed run per task per arm.** Which of two completed runs to pair is a choice, and a choice at that point is where selection hides. Task 4.
- **The registry names the arm that withholds the graph** (`graph_withheld_on`), so the rule "the withholding arm carries no `graph_digest`" is declared per axis rather than hardcoded for `context.graph`. Task 4.
- **Finding objects pass through unstripped**, so `findings_digest` is computable by anyone from the raw review line, not only by this repository's reader. Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/runs.ts` | `Conditions`, `I` and `R` schemas; sealing; `findingsDigest`, `graphDigest` |
| `src/records.ts` | Adds `D1V2Schema`; shares D1 checks between versions; exports `required`, `timestampOf` |
| `src/overlay.ts` | Stores and reads `I`, `R`, and both D1 versions |
| `src/record.ts` | Builds an intent; turns a review row into a run; the discharge checks |
| `src/derive-d1.ts` | Extracts `measure`, shared by both derivations |
| `src/pair-runs.ts` | Pairs one runner's runs; `rowFor` with the findings-digest check |
| `src/derive-d1-v2.ts` | Version-2 D1 from a run pair set |
| `src/joint.ts` | `buildJoint` |
| `src/audit.ts` | Intents against runs |
| `src/supersede.ts` | Groups by contributors; handles run-pair instances |
| `src/cli-runs.ts` | `intent`, `run`, `fail`, `derive`, `joint`, `audit` |
| `tests/helpers/fixtures.ts` | Shared fixture: two arms of one task, recorded as a given runner |

---

### Task 1: Run records, sealing and digests

**Files:**
- Create: `src/runs.ts`
- Modify: `src/records.ts` (export `required`; turn `timestamp` into `timestampOf(field)`)
- Modify: `src/corpus.ts` (`FindingSchema` becomes passthrough)
- Test: `tests/runs.test.ts`

**Interfaces:**
- Consumes: `canonicalJson` from `src/canonical.ts`.
- Produces: `RUN_SCHEMA_VERSION = 2`; `ConditionsSchema`, `type Conditions`, `type ConditionKey`; `DECLARED_NOT_VERIFIED: readonly ConditionKey[]`; `TaskSchema`, `type Task`; `FAILURES`, `type FailureKind`; `RunIntentSchema`, `RunRecordSchema`, `type RunIntent`, `type RunRecord`; `sealIntent(body): RunIntent`; `sealRun(body): RunRecord`; `digest(data): string`; `findingsDigest(findings: readonly unknown[]): string`; `graphDigest(path: string): string`. From `records.ts`: `required(field)`, `timestampOf(field)`.

- [ ] **Step 1: Export the two helpers from `records.ts`**

In `src/records.ts`, replace the private `required` and `timestamp` definitions:

```ts
/** Present, non-empty, and the two failures are distinguishable. */
export const required = (field: string) =>
  z
    .string({ required_error: `${field} is absent; it is required and has no default` })
    .refine((s) => s.trim().length > 0, {
      message: `${field} is present but empty, which is a different failure from absent`,
    });

/** ISO-8601 with an explicit offset, validated as ../hivemark/src/schema.ts validates reviewed_at. */
export const timestampOf = (field: string) =>
  z
    .string()
    .refine((s) => /([+-]\d{2}:\d{2}|Z)$/.test(s), { message: `${field} carries no UTC offset` })
    .refine((s) => Number.isFinite(Date.parse(s)), { message: `${field} is not a parseable timestamp` });
```

and in `EnvelopeShape` change `observed_at: timestamp,` to `observed_at: timestampOf("observed_at"),`.

- [ ] **Step 2: Make findings pass through in `corpus.ts`**

In `src/corpus.ts`, change the closing `});` of `FindingSchema` to `}).passthrough();` and put this comment above `const FindingSchema`:

```ts
/**
 * Passthrough, so a finding read here is the finding as written.
 *
 * `findings_digest` on a run is recomputed by anyone holding the review line.
 * A reader that stripped keys it did not recognise would digest something the
 * producer never wrote, and two readers with different schemas would disagree
 * about whether a run's findings changed.
 */
```

- [ ] **Step 3: Write the failing test**

`tests/runs.test.ts`:

```ts
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
```

- [ ] **Step 4: Run it to verify it fails**

Run: `bun run test tests/runs.test.ts`
Expected: FAIL — `Failed to load url ../src/runs.js`.

- [ ] **Step 5: Implement `src/runs.ts`**

```ts
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJson } from "./canonical.js";
import { required, timestampOf } from "./records.js";

export const RUN_SCHEMA_VERSION = 2;

export const digest = (data: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(data).digest("hex")}`;

/**
 * What a second party needs to assemble the same inputs.
 *
 * Strict: an unknown key is refused rather than hashed in, because a condition
 * nobody here models is one nobody here can hold equal.
 */
export const ConditionsSchema = z
  .object({
    review_fingerprint: z.string().min(1),
    finder_model: z.string().min(1),
    finder_provider: z.string().min(1),
    skeptic_model: z.string().min(1).nullable(),
    skeptic_provider: z.string().min(1).nullable(),
    temperature: z.number().nullable(),
    slice: z.enum(["all", "graph", "diff-only"]),
    profile: z.string().min(1),
    guardian_sha: z.string().min(1),
    /** Null iff the arm withholds the graph. Detects divergence; claims no determinism. */
    graph_digest: z.string().min(1).nullable(),
  })
  .strict();
export type Conditions = z.infer<typeof ConditionsSchema>;
export type ConditionKey = keyof Conditions;

/**
 * Stated by the runner and unprovable by the record: the models arrive through
 * environment variables, not flags. A list rather than prose, so a consumer can
 * filter on it. Sorted, because it is hashed.
 */
export const DECLARED_NOT_VERIFIED: readonly ConditionKey[] = [
  "finder_model",
  "finder_provider",
  "skeptic_model",
  "skeptic_provider",
  "temperature",
];

export const TaskSchema = z
  .object({ url: z.string().min(1), head_sha: z.string().min(1), project: z.string().min(1) })
  .strict();
export type Task = z.infer<typeof TaskSchema>;

export const FAILURES = ["prepare", "ingest", "model-error", "parse", "timeout"] as const;
export type FailureKind = (typeof FAILURES)[number];

const OutcomeSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      findings_digest: z.string().min(1),
      findings_count: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ ok: z.literal(false), failure: z.enum(FAILURES), detail: required("detail") }).strict(),
]);

const IntentBody = z
  .object({
    schema_version: z.literal(RUN_SCHEMA_VERSION),
    kind: z.literal("I"),
    announced_at: timestampOf("announced_at"),
    runner: z.string().min(1),
    task: TaskSchema,
    arm: z.string().min(1),
    conditions: ConditionsSchema,
    unestablished: required("unestablished"),
  })
  .strict();

const RunBody = z
  .object({
    schema_version: z.literal(RUN_SCHEMA_VERSION),
    kind: z.literal("R"),
    intent_id: z.string().min(1),
    observed_at: timestampOf("observed_at"),
    runner: z.string().min(1),
    task: TaskSchema,
    arm: z.string().min(1),
    conditions: ConditionsSchema,
    outcome: OutcomeSchema,
    declared_not_verified: z.array(ConditionsSchema.keyof()),
    unestablished: required("unestablished"),
  })
  .strict();

const sealedId = (body: unknown): string => digest(canonicalJson(body));

const idMismatch = (field: string, got: string, expected: string) =>
  `${field} ${got} does not match its contents (expected ${expected}); the record was altered after sealing`;

/** No outcome in the hash: an intent exists before its outcome does. */
export const RunIntentSchema = IntentBody.extend({ intent_id: z.string().min(1) })
  .strict()
  .superRefine(({ intent_id, ...body }, ctx) => {
    const expected = sealedId(body);
    if (intent_id !== expected) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: idMismatch("intent_id", intent_id, expected) });
    }
  });

/**
 * The outcome is in the hash, so one runner cannot publish two runs under one
 * id with different results — `claimHash` in ../hivemark/src/claims.ts hashes
 * the finding with the review that produced it for the same reason.
 */
export const RunRecordSchema = RunBody.extend({ run_id: z.string().min(1) })
  .strict()
  .superRefine(({ run_id, ...body }, ctx) => {
    const expected = sealedId(body);
    if (run_id !== expected) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: idMismatch("run_id", run_id, expected) });
    }
    const d = body.declared_not_verified;
    const canonical = [...new Set(d)].sort();
    if (d.join() !== canonical.join()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "declared_not_verified must be sorted and free of duplicates, so the same set always hashes the same",
      });
    }
  });

export type RunIntent = z.infer<typeof RunIntentSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;

export function sealIntent(body: z.input<typeof IntentBody>): RunIntent {
  const parsed = IntentBody.parse(body);
  return RunIntentSchema.parse({ ...parsed, intent_id: sealedId(parsed) });
}

export function sealRun(body: z.input<typeof RunBody>): RunRecord {
  const parsed = RunBody.parse(body);
  return RunRecordSchema.parse({ ...parsed, run_id: sealedId(parsed) });
}

/** Over findings exactly as written; corpus.ts passes unknown keys through for this. */
export const findingsDigest = (findings: readonly unknown[]): string => digest(canonicalJson(findings));

function filesUnder(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(join(dir, entry.name), rel);
    if (entry.isFile()) return [rel];
    throw new Error(
      `${join(dir, entry.name)} is neither a file nor a directory; a graph artefact is refused rather than partly read`,
    );
  });
}

/**
 * Digest of a graph artefact: a file by its bytes, a directory by its sorted
 * relative paths and their contents. Modification times are never read, so the
 * same graph copied to another machine digests the same.
 */
export function graphDigest(path: string): string {
  const st = statSync(path);
  if (st.isFile()) return digest(readFileSync(path));
  if (!st.isDirectory()) throw new Error(`${path} is neither a file nor a directory`);
  const files = filesUnder(path).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (files.length === 0) {
    throw new Error(`graph artefact ${path} is empty; an empty ingest is a failed ingest, not a graph`);
  }
  return digest(files.map((rel) => `${rel}\u0000${digest(readFileSync(join(path, rel)))}`).join("\n"));
}
```

- [ ] **Step 6: Run the suite and typecheck**

Run: `bun run test; echo "test exit=$?"; bun run typecheck; echo "typecheck exit=$?"`
Expected: both exit 0. `tests/runs.test.ts` passes 19 tests, and every pre-existing test still passes.

- [ ] **Step 7: Commit**

```bash
git add src/runs.ts src/records.ts src/corpus.ts tests/runs.test.ts
git commit -m "feat: sealed run intents and run records, with findings and graph digests" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Version-2 D1 and the overlay

**Files:**
- Modify: `src/records.ts` (full replacement below)
- Modify: `src/overlay.ts` (full replacement below)
- Test: `tests/records-v2.test.ts`, extend `tests/overlay.test.ts`

**Interfaces:**
- Consumes: `RunIntentSchema`, `RunRecordSchema`, `type RunIntent`, `type RunRecord` (Task 1).
- Produces: `D1V2Schema`, `type D1V2`; `Observation = D1 | D1V2 | D2 | D3`; `type OverlayRecord = Observation | RunIntent | RunRecord`; `appendOverlay(path, records: readonly OverlayRecord[])`; `readOverlay(path): OverlayRecord[]`.

- [ ] **Step 1: Write the failing test**

`tests/records-v2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { D1Schema, D1V2Schema } from "../src/records.js";

const v2 = {
  schema_version: 2,
  subject: "0xabc",
  axis: "context.graph",
  observed_at: "2026-09-23T12:00:00+00:00",
  unestablished: "u",
  kind: "D1",
  self_asserted: false,
  resource: { present: "graph", absent: "ablated" },
  pairing: { key: ["task.url"], pairs: 1, informative_pairs: 1, instances: [["sha256:a", "sha256:b"]] },
  metric: { name: "uncertain_rate", direction: "lower-better", with: 0, without: 1, delta: 1, spread: [1, 1] },
  judge: { id: "skeptic", goldens_version: null, self: false },
  admissible: false,
  inadmissible_because: ["informative_pairs 1 < 5"],
  contributors: ["alice"],
};

const joint = { cites: ["sha256:o1", "sha256:o2"], graph_agreement: "identical", contested_tasks: 0 };

describe("D1V2Schema", () => {
  it("accepts a single-runner observation", () => {
    expect(D1V2Schema.parse(v2).contributors).toEqual(["alice"]);
  });

  it("accepts a joint with two contributors", () => {
    expect(D1V2Schema.parse({ ...v2, contributors: ["alice", "bob"], joint }).joint?.contested_tasks).toBe(0);
  });

  it("refuses two contributors without a joint block", () => {
    expect(JSON.stringify(D1V2Schema.safeParse({ ...v2, contributors: ["alice", "bob"] }))).toMatch(/no joint block/);
  });

  it("refuses a joint block on one contributor", () => {
    expect(JSON.stringify(D1V2Schema.safeParse({ ...v2, joint }))).toMatch(/single-contributor/);
  });

  it("refuses unsorted contributors", () => {
    expect(D1V2Schema.safeParse({ ...v2, contributors: ["bob", "alice"], joint }).success).toBe(false);
  });

  it("refuses a run pair listed twice", () => {
    const twice = { ...v2.pairing, pairs: 2, instances: [["sha256:a", "sha256:b"], ["sha256:a", "sha256:b"]] };
    expect(JSON.stringify(D1V2Schema.safeParse({ ...v2, pairing: twice }))).toMatch(/appears twice/);
  });

  it("keeps the version-1 checks", () => {
    const short = { ...v2.pairing, pairs: 2 };
    expect(JSON.stringify(D1V2Schema.safeParse({ ...v2, pairing: short }))).toMatch(/pairs 2 but 1 instance/);
  });

  it("refuses task strings as instances, which is version 1's shape", () => {
    expect(D1V2Schema.safeParse({ ...v2, pairing: { ...v2.pairing, instances: ["u@h1"] } }).success).toBe(false);
  });
});

describe("D1Schema", () => {
  it("refuses run pairs as instances, which is version 2's shape", () => {
    expect(D1Schema.safeParse({ ...v2, schema_version: 1, contributors: undefined }).success).toBe(false);
  });
});
```

Append to `tests/overlay.test.ts`, below the existing `describe`, and add `import { sealIntent, sealRun } from "../src/runs.js";` to its imports:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/records-v2.test.ts tests/overlay.test.ts`
Expected: FAIL — `D1V2Schema` is not exported.

- [ ] **Step 3: Replace `src/records.ts`**

```ts
import { z } from "zod";
import { round4 } from "./canonical.js";

/**
 * Integer, not semver. Bump when any record kind's field set changes.
 *
 * A minor component would assert that non-breaking changes to an evidential
 * record exist, and they do not: a reader ignoring a new field reads a
 * different claim than the writer made. `GENOME_SCHEMA_VERSION` in
 * ../hivemark/src/genome.ts is an integer for the same reason.
 */
export const RECORD_SCHEMA_VERSION = 1;

/** Metrics computed from verdicts, which have no reference set to version. */
export const VERDICT_DERIVED_METRICS = new Set(["uncertain_rate"]);

/** Mirrors the finding categories in ../hivemark/src/schema.ts. */
export const CATEGORIES = ["logic", "contract", "tests", "types", "ontology", "security"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Present, non-empty, and the two failures are distinguishable. */
export const required = (field: string) =>
  z
    .string({ required_error: `${field} is absent; it is required and has no default` })
    .refine((s) => s.trim().length > 0, {
      message: `${field} is present but empty, which is a different failure from absent`,
    });

/** ISO-8601 with an explicit offset, validated as ../hivemark/src/schema.ts validates reviewed_at. */
export const timestampOf = (field: string) =>
  z
    .string()
    .refine((s) => /([+-]\d{2}:\d{2}|Z)$/.test(s), { message: `${field} carries no UTC offset` })
    .refine((s) => Number.isFinite(Date.parse(s)), { message: `${field} is not a parseable timestamp` });

const rounded = (field: string) =>
  z.number().refine((n) => n === round4(n), { message: `${field} is not rounded to 4 decimals` });

const envelope = (version: 1 | 2) => ({
  schema_version: z.literal(version),
  subject: z.string().min(1),
  axis: z.string().min(1),
  observed_at: timestampOf("observed_at"),
  unestablished: required("unestablished"),
});

const EnvelopeShape = envelope(RECORD_SCHEMA_VERSION);

const d1Common = {
  kind: z.literal("D1"),
  self_asserted: z.literal(false),
  resource: z.object({ present: z.string().min(1), absent: z.string().min(1) }),
  metric: z.object({
    name: z.string().min(1),
    direction: z.enum(["higher-better", "lower-better"]),
    with: rounded("with"),
    without: rounded("without"),
    delta: rounded("delta"),
    spread: z.tuple([rounded("spread[0]"), rounded("spread[1]")]),
  }),
  judge: z.object({
    id: z.string().min(1),
    goldens_version: z.string().min(1).nullable(),
    self: z.boolean(),
  }),
  admissible: z.boolean(),
  inadmissible_because: z.array(z.string().min(1)),
};

const pairingCommon = {
  key: z.array(z.string().min(1)).min(1),
  pairs: z.number().int().nonnegative(),
  informative_pairs: z.number().int().nonnegative(),
};

interface D1Checkable {
  readonly pairing: { readonly pairs: number; readonly informative_pairs: number; readonly instances: readonly unknown[] };
  readonly metric: { readonly name: string; readonly spread: readonly [number, number] };
  readonly judge: { readonly goldens_version: string | null };
  readonly admissible: boolean;
  readonly inadmissible_because: readonly string[];
}

/** The checks both D1 versions share. */
function checkD1(r: D1Checkable, ctx: z.RefinementCtx): void {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (r.pairing.instances.length !== r.pairing.pairs) {
    issue(
      `pairs ${r.pairing.pairs} but ${r.pairing.instances.length} instances; no truncation is ` +
        `permitted, a reader must be able to recompute every pair`,
    );
  }
  if (r.pairing.informative_pairs > r.pairing.pairs) {
    issue(`informative_pairs ${r.pairing.informative_pairs} exceeds pairs ${r.pairing.pairs}`);
  }
  if (r.metric.spread[0] > r.metric.spread[1]) issue("spread is not [min, max]");
  if (VERDICT_DERIVED_METRICS.has(r.metric.name) && r.judge.goldens_version !== null) {
    issue(`${r.metric.name} is verdict-derived and has no reference set; goldens_version must be null`);
  }
  if (r.admissible && r.inadmissible_because.length > 0) {
    issue(`admissible record carries ${r.inadmissible_because.length} reasons for inadmissibility`);
  }
  if (!r.admissible && r.inadmissible_because.length === 0) issue("inadmissible record names no gate");
}

export const D1Schema = z
  .object({
    ...EnvelopeShape,
    ...d1Common,
    pairing: z.object({ ...pairingCommon, instances: z.array(z.string().min(1)) }),
  })
  .superRefine(checkD1);

const isSortedUnique = (xs: readonly string[]): boolean =>
  xs.every((x, i) => i === 0 || (xs[i - 1] as string) < x);

/**
 * Version 2: an instance is a pair of run ids, and every observation names the
 * runners it came from.
 *
 * Contributors are on every version-2 D1, not only joints, because supersession
 * groups by them — without that grouping a joint would supersede the honest
 * observation it cites, which is the mirror attack readmitted. The joint-only
 * fields sit in one block, so "all or none" holds by construction.
 */
export const D1V2Schema = z
  .object({
    ...envelope(2),
    ...d1Common,
    pairing: z.object({
      ...pairingCommon,
      instances: z.array(z.tuple([z.string().min(1), z.string().min(1)])),
    }),
    contributors: z.array(z.string().min(1)).min(1),
    joint: z
      .object({
        cites: z.array(z.string().min(1)).min(2),
        graph_agreement: z.enum(["identical", "divergent", "withheld-both"]),
        contested_tasks: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .superRefine((r, ctx) => {
    checkD1(r, ctx);
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (!isSortedUnique(r.contributors)) issue("contributors must be sorted and free of duplicates");
    const isJoint = r.contributors.length > 1;
    if (isJoint && !r.joint) {
      issue(`${r.contributors.length} contributors but no joint block; pooling runners is an explicit act and must say so`);
    }
    if (!isJoint && r.joint) issue("joint block on a single-contributor observation; a joint pools more than one runner");
    const keys = r.pairing.instances.map(([a, b]) => `${a}|${b}`);
    if (new Set(keys).size !== keys.length) issue("a run pair appears twice; a pair is counted once");
    if (r.joint && !isSortedUnique(r.joint.cites)) issue("joint.cites must be sorted and free of duplicates");
    if (r.joint && r.joint.contested_tasks > r.pairing.pairs) {
      issue(`contested_tasks ${r.joint.contested_tasks} exceeds pairs ${r.pairing.pairs}`);
    }
  });

export const D2Schema = z
  .object({
    ...EnvelopeShape,
    kind: z.literal("D2"),
    self_asserted: z.literal(false),
    category: z.enum(CATEGORIES),
    verdicts: z.object({
      undecidable: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      refs: z.array(z.string().min(1)),
    }),
    grounds: required("grounds"),
    resolvable_by: z.enum(["independent-party", "more-evidence", "unknown"]),
  })
  .superRefine((r, ctx) => {
    if (r.verdicts.undecidable > r.verdicts.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `undecidable ${r.verdicts.undecidable} exceeds total ${r.verdicts.total}`,
      });
    }
  });

export const D3Schema = z.object({
  ...EnvelopeShape,
  kind: z.literal("D3"),
  self_asserted: z.literal(true),
  want: required("want"),
});

export type D1 = z.infer<typeof D1Schema>;
export type D1V2 = z.infer<typeof D1V2Schema>;
export type D2 = z.infer<typeof D2Schema>;
export type D3 = z.infer<typeof D3Schema>;
export type Observation = D1 | D1V2 | D2 | D3;
```

- [ ] **Step 4: Replace `src/overlay.ts`**

```ts
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.js";
import { D1Schema, D1V2Schema, D2Schema, D3Schema, type Observation } from "./records.js";
import { RunIntentSchema, RunRecordSchema, type RunIntent, type RunRecord } from "./runs.js";

export type OverlayRecord = Observation | RunIntent | RunRecord;

/**
 * Append-only, and nothing is ever deleted.
 *
 * A retention policy would discard exactly the records a raised gate-2 floor
 * must re-evaluate and the exploration queue reads to know a question has been
 * asked. Growth is bounded by funded runs, which are expensive by construction.
 */
export function appendOverlay(path: string, records: readonly OverlayRecord[]): void {
  if (records.length === 0) return;
  appendFileSync(path, `${records.map((r) => canonicalJson(r)).join("\n")}\n`, "utf8");
}

export function readOverlay(path: string): OverlayRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((line, i): OverlayRecord => {
      const where = `${path}:${i + 1}`;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (err) {
        throw new Error(`${where} is not JSON: ${(err as Error).message}`);
      }
      const head = (typeof raw === "object" && raw !== null ? raw : {}) as { kind?: unknown; schema_version?: unknown };
      switch (head.kind) {
        case "D1":
          if (head.schema_version === 1) return D1Schema.parse(raw);
          if (head.schema_version === 2) return D1V2Schema.parse(raw);
          throw new Error(`${where} D1 with unknown schema_version ${JSON.stringify(head.schema_version)}`);
        case "D2":
          return D2Schema.parse(raw);
        case "D3":
          return D3Schema.parse(raw);
        case "I":
          return RunIntentSchema.parse(raw);
        case "R":
          return RunRecordSchema.parse(raw);
        default:
          throw new Error(`${where} unknown kind ${JSON.stringify(head.kind)}`);
      }
    });
}
```

- [ ] **Step 5: Run the suite and typecheck**

Run: `bun run test; echo "test exit=$?"; bun run typecheck; echo "typecheck exit=$?"`
Expected: both exit 0. The pre-existing `records.test.ts`, `overlay.test.ts` and `e2e.test.ts` still pass unchanged — they are the regression check on the refactor.

- [ ] **Step 6: Commit**

```bash
git add src/records.ts src/overlay.ts tests/records-v2.test.ts tests/overlay.test.ts
git commit -m "feat: version-2 D1 citing run pairs, and an overlay that stores runs" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Recording intents and runs

**Files:**
- Create: `src/record.ts`
- Create: `tests/helpers/fixtures.ts`
- Test: `tests/record.test.ts`

**Interfaces:**
- Consumes: `sealIntent`, `sealRun`, `findingsDigest`, `DECLARED_NOT_VERIFIED`, `type Conditions`, `type ConditionKey`, `type FailureKind`, `type RunIntent`, `type RunRecord`, `type Task` (Task 1); `type ReviewRow` (`src/corpus.ts`); `canonicalJson`.
- Produces: `interface IntentInput { runner; task; arm; conditions; announcedAt }`; `intentFor(i: IntentInput): RunIntent`; `rowProblems(intent: RunIntent, row: ReviewRow): string[]`; `dischargeProblems(intent: RunIntent, run: RunRecord): string[]`; `runFor(intent, row, observedAt): RunRecord`; `failedRunFor(intent, failure, detail, observedAt): RunRecord`. Test helpers: `rows`, `graphRow`, `ablatedRow`, `conditionsFor(graph: boolean)`, `T0`, `T1`, `recorded(runner, row, opts?)`.

- [ ] **Step 1: Write the shared test fixture**

`tests/helpers/fixtures.ts`:

```ts
import { readManifest, readReviews, type Finding, type ReviewRow } from "../../src/corpus.js";
import { intentFor, runFor } from "../../src/record.js";
import type { Conditions, RunIntent, RunRecord } from "../../src/runs.js";

export const rows: readonly ReviewRow[] = readReviews(readManifest("tests/fixtures/mini.json"));
export const graphRow = rows[0] as ReviewRow;
export const ablatedRow = rows[1] as ReviewRow;

export const T0 = "2026-09-23T10:00:00+00:00";
export const T1 = "2026-09-23T11:00:00+00:00";

/** The fixture rows' conditions; the graph arm carries a digest, the ablated arm none. */
export const conditionsFor = (graph: boolean, graphDigest = "sha256:g1"): Conditions => ({
  review_fingerprint: "fp",
  finder_model: "m1",
  finder_provider: "v",
  skeptic_model: "s1",
  skeptic_provider: "v",
  temperature: null,
  slice: "graph",
  profile: "core",
  guardian_sha: "g",
  graph_digest: graph ? graphDigest : null,
});

/** A copy of a row whose findings all carry one verdict. */
export const withVerdict = (row: ReviewRow, verdict: Finding["verdict"]): ReviewRow => ({
  ...row,
  findings: row.findings.map((f) => ({ ...f, verdict })),
});

/** Announce and record one run of `row` as `runner`. */
export function recorded(
  runner: string,
  row: ReviewRow,
  opts: { graphDigest?: string; at?: string } = {},
): { intent: RunIntent; run: RunRecord } {
  const arm = row.arm as string;
  const intent = intentFor({
    runner,
    task: { url: row.url, head_sha: row.head_sha, project: row.project },
    arm,
    conditions: conditionsFor(arm === "graph", opts.graphDigest),
    announcedAt: T0,
  });
  return { intent, run: runFor(intent, row, opts.at ?? T1) };
}
```

- [ ] **Step 2: Write the failing test**

`tests/record.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dischargeProblems, failedRunFor, intentFor, rowProblems, runFor } from "../src/record.js";
import { findingsDigest, sealRun } from "../src/runs.js";
import { ablatedRow, conditionsFor, graphRow, recorded, T0 } from "./helpers/fixtures.js";

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
    expect(() => runFor(intent, graphRow, "2026-09-23T09:00:00+00:00")).toThrow(/before it was announced/);
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run test tests/record.test.ts`
Expected: FAIL — `Failed to load url ../src/record.js`.

- [ ] **Step 4: Implement `src/record.ts`**

```ts
import { canonicalJson } from "./canonical.js";
import type { ReviewRow } from "./corpus.js";
import {
  DECLARED_NOT_VERIFIED,
  findingsDigest,
  sealIntent,
  sealRun,
  type ConditionKey,
  type Conditions,
  type FailureKind,
  type RunIntent,
  type RunRecord,
  type Task,
} from "./runs.js";

export interface IntentInput {
  readonly runner: string;
  readonly task: Task;
  readonly arm: string;
  readonly conditions: Conditions;
  readonly announcedAt: string;
}

const INTENT_UNESTABLISHED =
  "announces a run before it is performed; establishes nothing about its outcome, and binds its author " +
  "only once anchored outside the author's custody";

const RUN_UNESTABLISHED =
  "records the conditions a run was given and what it produced; does not establish that the declared " +
  "models answered (see declared_not_verified), nor that the graph artefact would be rebuilt identically";

export function intentFor(i: IntentInput): RunIntent {
  return sealIntent({
    schema_version: 2,
    kind: "I",
    announced_at: i.announcedAt,
    runner: i.runner,
    task: i.task,
    arm: i.arm,
    conditions: i.conditions,
    unestablished: INTENT_UNESTABLISHED,
  });
}

/**
 * Where a review row shows something other than what the intent announced.
 *
 * `slice` and `profile` are not compared: they are runner parameters the row
 * does not record. An absent `skeptic_provider` and null are the same, as
 * `genomeOf` treats them. An absent `temperature` maps to null, because
 * `Conditions` has no way to say "absent" other than null.
 */
export function rowProblems(intent: RunIntent, row: ReviewRow): string[] {
  const problems: string[] = [];
  const cmp = (field: string, announced: unknown, ran: unknown) => {
    if (announced !== ran) problems.push(`${field}: announced ${JSON.stringify(announced)}, ran ${JSON.stringify(ran)}`);
  };
  const c = intent.conditions;
  const raw = row as Record<string, unknown>;
  cmp("task.url", intent.task.url, row.url);
  cmp("task.head_sha", intent.task.head_sha, row.head_sha);
  cmp("task.project", intent.task.project, row.project);
  if (row.arm === undefined) {
    problems.push("row carries no arm; a recorded run must have been planned as one arm or the other");
  } else {
    cmp("arm", intent.arm, row.arm);
  }
  cmp("review_fingerprint", c.review_fingerprint, row.review_fingerprint);
  cmp("finder_model", c.finder_model, row.finder_model);
  cmp("finder_provider", c.finder_provider, row.finder_provider);
  cmp("skeptic_model", c.skeptic_model, row.skeptic_model);
  cmp("skeptic_provider", c.skeptic_provider, row.skeptic_provider ?? null);
  cmp("temperature", c.temperature, raw.temperature === undefined ? null : raw.temperature);
  cmp("guardian_sha", c.guardian_sha, row.guardian_sha);
  return problems;
}

/** Where a run differs from the intent it claims to discharge. */
export function dischargeProblems(intent: RunIntent, run: RunRecord): string[] {
  const problems: string[] = [];
  if (run.intent_id !== intent.intent_id) problems.push(`cites ${run.intent_id}, not ${intent.intent_id}`);
  if (run.runner !== intent.runner) problems.push(`runner: announced "${intent.runner}", ran "${run.runner}"`);
  if (canonicalJson(run.task) !== canonicalJson(intent.task)) problems.push("task differs from the one announced");
  if (run.arm !== intent.arm) problems.push(`arm: announced "${intent.arm}", ran "${run.arm}"`);
  for (const k of Object.keys(intent.conditions) as ConditionKey[]) {
    if (run.conditions[k] !== intent.conditions[k]) {
      problems.push(
        `conditions.${k}: announced ${JSON.stringify(intent.conditions[k])}, ran ${JSON.stringify(run.conditions[k])}`,
      );
    }
  }
  if (Date.parse(run.observed_at) < Date.parse(intent.announced_at)) {
    problems.push(
      `observed at ${run.observed_at}, before it was announced at ${intent.announced_at}; that is not a pre-registration`,
    );
  }
  return problems;
}

function sealed(intent: RunIntent, outcome: RunRecord["outcome"], observedAt: string): RunRecord {
  const run = sealRun({
    schema_version: 2,
    kind: "R",
    intent_id: intent.intent_id,
    observed_at: observedAt,
    runner: intent.runner,
    task: intent.task,
    arm: intent.arm,
    conditions: intent.conditions,
    outcome,
    declared_not_verified: [...DECLARED_NOT_VERIFIED],
    unestablished: RUN_UNESTABLISHED,
  });
  const problems = dischargeProblems(intent, run);
  if (problems.length > 0) {
    throw new Error(`run cannot discharge intent ${intent.intent_id}:\n  ${problems.join("\n  ")}`);
  }
  return run;
}

/** The run a review row records, refused if the row is not what was announced. */
export function runFor(intent: RunIntent, row: ReviewRow, observedAt: string): RunRecord {
  const problems = rowProblems(intent, row);
  if (problems.length > 0) {
    throw new Error(`row does not match intent ${intent.intent_id}:\n  ${problems.join("\n  ")}`);
  }
  const outcome: RunRecord["outcome"] =
    (row as Record<string, unknown>).parse_failed === true
      ? { ok: false, failure: "parse", detail: "the producer reported parse_failed for this review" }
      : { ok: true, findings_digest: findingsDigest(row.findings), findings_count: row.findings.length };
  return sealed(intent, outcome, observedAt);
}

/** A run that produced no review row. Recorded, because omitting it is survivorship bias. */
export function failedRunFor(intent: RunIntent, failure: FailureKind, detail: string, observedAt: string): RunRecord {
  return sealed(intent, { ok: false, failure, detail }, observedAt);
}
```

- [ ] **Step 5: Run the suite and typecheck**

Run: `bun run test; echo "test exit=$?"; bun run typecheck; echo "typecheck exit=$?"`
Expected: both exit 0; `tests/record.test.ts` passes 13 tests.

- [ ] **Step 6: Commit**

```bash
git add src/record.ts tests/helpers/fixtures.ts tests/record.test.ts
git commit -m "feat: record intents and runs, refusing rows that differ from the announcement" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Pairing runs and deriving a version-2 D1

**Files:**
- Modify: `src/derive-d1.ts` (extract `measure`; full replacement below)
- Modify: `src/registry.ts`, `registry/axes.json` (`graph_withheld_on`)
- Create: `src/pair-runs.ts`, `src/derive-d1-v2.ts`
- Test: `tests/pair-runs.test.ts`, `tests/derive-d1-v2.test.ts`

**Interfaces:**
- Consumes: `type RunRecord`, `ConditionsSchema`, `findingsDigest`, `DECLARED_NOT_VERIFIED`, `type Conditions` (Task 1); `D1V2Schema`, `type D1V2` (Task 2); `recorded`, `graphRow`, `ablatedRow`, `rows`, `withVerdict` (Task 3 helpers).
- Produces: `measure<T>(pairs, rowsOf, metricName, direction): Measurement<T> | null`, `interface Measured<T>`, `interface Measurement<T>`; `AxisSpec.graph_withheld_on?: string`; `type Config`; `configOf(c): Config`; `configKey(c): string`; `taskKey(run): string`; `interface RunPair { present; absent; presentRow; absentRow }`; `interface RunPairSet { runner; config; pairs; failed; unpaired }`; `rowFor(run, rows): ReviewRow`; `pairRuns(runs, rows, spec): RunPairSet`; `RUN_PAIR_KEY: readonly string[]`; `deriveD1V2(set, spec, opts: DeriveOptions): D1V2 | null`.

- [ ] **Step 1: Add `graph_withheld_on` to the registry**

In `src/registry.ts`, add to `AxisSchema` after `incidental`:

```ts
  /** The arm that withholds the graph, whose runs carry no graph_digest. Absent: no graph rule on this axis. */
  graph_withheld_on: z.string().min(1).optional(),
```

and to `AxisSpec`:

```ts
  readonly graph_withheld_on?: string;
```

In `registry/axes.json`, add `"graph_withheld_on": "ablated",` after `"resources": ["graph", "ablated"],`.

- [ ] **Step 2: Replace `src/derive-d1.ts` with a version that extracts `measure`**

```ts
import { admissibility } from "./admissibility.js";
import { round4 } from "./canonical.js";
import type { ReviewRow } from "./corpus.js";
import { UNCERTAIN_RATE, uncertainRate } from "./metrics/uncertain-rate.js";
import type { Pair, PairSet } from "./pair.js";
import { D1Schema, RECORD_SCHEMA_VERSION, VERDICT_DERIVED_METRICS, type D1 } from "./records.js";
import { requireResource, type AxisSpec } from "./registry.js";
import { subjectOf } from "./subject.js";

export interface DeriveOptions {
  readonly metric: string;
  readonly direction: "higher-better" | "lower-better";
  readonly judgeId: string;
  readonly observedAt: string;
}

const METRICS: Record<string, (row: ReviewRow) => number | null> = {
  [UNCERTAIN_RATE]: uncertainRate,
};

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface Measured<T> {
  readonly pair: T;
  readonly withValue: number;
  readonly withoutValue: number;
  readonly diff: number;
}

export interface Measurement<T> {
  readonly kept: readonly Measured<T>[];
  readonly dropped: number;
  readonly spread: [number, number];
  readonly informative: number;
  readonly with: number;
  readonly without: number;
  readonly delta: number;
  readonly admissible: boolean;
  readonly because: string[];
}

/**
 * Per-pair differences, sign-normalised, with the gates applied.
 *
 * Computed per review and then differenced — never pooled and then differenced.
 * The arms differ sharply in findings per review, so a pooled difference would
 * be dominated by the arm that talks more, and both gates run on these
 * differences. Shared by both D1 versions and by joint observations, so the
 * three cannot drift apart.
 */
export function measure<T>(
  pairs: readonly T[],
  rowsOf: (pair: T) => { present: ReviewRow; absent: ReviewRow },
  metricName: string,
  direction: "higher-better" | "lower-better",
): Measurement<T> | null {
  const metric = METRICS[metricName];
  if (!metric) throw new Error(`no implementation for metric ${JSON.stringify(metricName)}`);
  // `lower-better` means a fall is an improvement, so the raw difference is
  // multiplied by -1 exactly once, here, and never re-applied downstream.
  const sign = direction === "lower-better" ? -1 : 1;

  const kept: Measured<T>[] = [];
  let dropped = 0;
  for (const pair of pairs) {
    const { present, absent } = rowsOf(pair);
    const a = metric(present);
    const b = metric(absent);
    if (a === null || b === null) {
      dropped += 1;
      continue;
    }
    kept.push({ pair, withValue: a, withoutValue: b, diff: round4((a - b) * sign) });
  }
  if (kept.length === 0) return null;

  const diffs = kept.map((k) => k.diff);
  const sorted = [...diffs].sort((x, y) => x - y);
  const spread: [number, number] = [sorted[0] as number, sorted[sorted.length - 1] as number];
  const informative = diffs.filter((d) => d !== 0).length;
  const verdict = admissibility(spread, informative);
  return {
    kept,
    dropped,
    spread,
    informative,
    with: round4(mean(kept.map((k) => k.withValue))),
    without: round4(mean(kept.map((k) => k.withoutValue))),
    delta: round4(mean(diffs)),
    admissible: verdict.admissible,
    because: [...verdict.because],
  };
}

/** One version-1 D1 over a pair set, or null when nothing survives. */
export function deriveD1(set: PairSet, spec: AxisSpec, opts: DeriveOptions): D1 | null {
  const present = requireResource(spec, spec.resources[0] as string);
  const absent = requireResource(spec, spec.resources[1] as string);
  const m = measure(set.pairs, (p: Pair) => ({ present: p.present, absent: p.absent }), opts.metric, opts.direction);
  if (!m) return null;
  const first = m.kept[0] as Measured<Pair>;

  return D1Schema.parse({
    schema_version: RECORD_SCHEMA_VERSION,
    subject: subjectOf(first.pair.present),
    axis: spec.axis,
    kind: "D1" as const,
    self_asserted: false as const,
    observed_at: opts.observedAt,
    unestablished:
      `dropped ${m.dropped} pair(s) whose metric was undefined, and ${set.unplanned} row(s) with no ` +
      `arm at all; says nothing about identities absent from this corpus, nor about any axis but ${spec.axis}`,
    resource: { present, absent },
    pairing: {
      key: [...set.key],
      pairs: m.kept.length,
      informative_pairs: m.informative,
      instances: m.kept.map((k) => k.pair.instance),
    },
    metric: {
      name: opts.metric,
      direction: opts.direction,
      with: m.with,
      without: m.without,
      delta: m.delta,
      spread: m.spread,
    },
    judge: {
      id: opts.judgeId,
      goldens_version: VERDICT_DERIVED_METRICS.has(opts.metric) ? null : "unversioned",
      self: false,
    },
    admissible: m.admissible,
    inadmissible_because: m.because,
  });
}
```

- [ ] **Step 3: Run the existing suite as the regression check on the refactor**

Run: `bun run test; echo "test exit=$?"; bun run typecheck; echo "typecheck exit=$?"`
Expected: both exit 0. `tests/derive-d1.test.ts` and `tests/e2e.test.ts` pass unchanged; the e2e still reports 6 pairs, 2 informative, delta 0.2593.

- [ ] **Step 4: Write the failing tests**

`tests/pair-runs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pairRuns, rowFor } from "../src/pair-runs.js";
import { failedRunFor } from "../src/record.js";
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
```

`tests/derive-d1-v2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveD1V2 } from "../src/derive-d1-v2.js";
import { pairRuns } from "../src/pair-runs.js";
import { loadRegistry, requireAxis } from "../src/registry.js";
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
    expect(d1?.unestablished).toMatch(/finder_model, finder_provider, skeptic_model, skeptic_provider, temperature/);
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `bun run test tests/pair-runs.test.ts tests/derive-d1-v2.test.ts`
Expected: FAIL — `Failed to load url ../src/pair-runs.js`.

- [ ] **Step 6: Implement `src/pair-runs.ts`**

```ts
import { canonicalJson } from "./canonical.js";
import type { ReviewRow } from "./corpus.js";
import type { AxisSpec } from "./registry.js";
import { ConditionsSchema, findingsDigest, type Conditions, type RunRecord } from "./runs.js";

export type Config = Omit<Conditions, "graph_digest">;

export const configOf = ({ graph_digest: _graph, ...rest }: Conditions): Config => rest;
export const configKey = (c: Conditions): string => canonicalJson(configOf(c));
export const taskKey = (run: RunRecord): string => `${run.task.url}@${run.task.head_sha}`;

/** What a version-2 pair holds equal. `graph_digest` is not in it: it follows the arm. */
export const RUN_PAIR_KEY: readonly string[] = [
  "task.url",
  "task.head_sha",
  "task.project",
  "runner",
  ...Object.keys(ConditionsSchema.shape)
    .filter((k) => k !== "graph_digest")
    .map((k) => `conditions.${k}`),
];

export interface RunPair {
  readonly present: RunRecord;
  readonly absent: RunRecord;
  readonly presentRow: ReviewRow;
  readonly absentRow: ReviewRow;
}

export interface RunPairSet {
  readonly runner: string;
  readonly config: Config;
  readonly pairs: readonly RunPair[];
  /** Runs whose outcome was a failure. */
  readonly failed: number;
  /** Tasks with a completed run on one arm only. */
  readonly unpaired: number;
}

/**
 * The review row a completed run recorded, matched by content.
 *
 * Several rows may share the task and arm — two runners' rows in one file — so
 * the match is on `findings_digest`. If rows share the task and arm and none
 * matches the digest, the file changed after the run was recorded, and the run
 * is refused rather than measured on findings it never produced.
 */
export function rowFor(run: RunRecord, rows: readonly ReviewRow[]): ReviewRow {
  const outcome = run.outcome;
  if (!outcome.ok) throw new Error(`run ${run.run_id} failed (${outcome.failure}) and has no row`);
  const candidates = rows.filter(
    (r) => r.url === run.task.url && r.head_sha === run.task.head_sha && r.arm === run.arm,
  );
  if (candidates.length === 0) {
    throw new Error(`no review row supplied for run ${run.run_id} (${taskKey(run)}, arm ${run.arm})`);
  }
  const hit = candidates.find((r) => findingsDigest(r.findings) === outcome.findings_digest);
  if (!hit) {
    throw new Error(
      `findings changed since run ${run.run_id} was recorded: ${candidates.length} row(s) match its task and ` +
        `arm and none matches its findings_digest ${outcome.findings_digest}; refused rather than measured on ` +
        `findings the run never produced`,
    );
  }
  return hit;
}

/** One runner's runs under one configuration, paired by task. */
export function pairRuns(runs: readonly RunRecord[], rows: readonly ReviewRow[], spec: AxisSpec): RunPairSet {
  const first = runs[0];
  if (first === undefined) throw new Error("no runs to pair");

  const runners = [...new Set(runs.map((r) => r.runner))].sort();
  if (runners.length > 1) {
    throw new Error(
      `runs from ${runners.length} runners (${runners.join(", ")}); one observation is one runner's, and ` +
        `pooling runners is buildJoint's explicit act`,
    );
  }
  const configs = new Set(runs.map((r) => configKey(r.conditions)));
  if (configs.size > 1) throw new Error(`runs under ${configs.size} configurations; one observation is one configuration`);

  const present = spec.resources[0];
  const absent = spec.resources[1];
  if (present === undefined || absent === undefined) {
    throw new Error(`axis ${spec.axis} declares fewer than two resource values`);
  }

  for (const r of runs) {
    if (r.arm !== present && r.arm !== absent) {
      throw new Error(`run ${r.run_id} is on arm ${r.arm}, which is neither ${present} nor ${absent}`);
    }
    const withheld = spec.graph_withheld_on;
    if (withheld === undefined) continue;
    if (r.arm === withheld && r.conditions.graph_digest !== null) {
      throw new Error(`run ${r.run_id} is on the ${withheld} arm yet carries a graph_digest; that arm has no graph`);
    }
    if (r.arm !== withheld && r.conditions.graph_digest === null) {
      throw new Error(`run ${r.run_id} is on the ${r.arm} arm with no graph_digest`);
    }
  }

  let failed = 0;
  const byTask = new Map<string, { present?: RunRecord; absent?: RunRecord }>();
  for (const r of runs) {
    if (!r.outcome.ok) {
      failed += 1;
      continue;
    }
    const k = taskKey(r);
    const slot = byTask.get(k) ?? {};
    const side = r.arm === present ? "present" : "absent";
    if (slot[side]) {
      throw new Error(
        `two completed runs of ${k} on arm ${r.arm} by ${r.runner}; which to pair is a choice, and a choice ` +
          `here is where selection hides — record them in separate observations`,
      );
    }
    slot[side] = r;
    byTask.set(k, slot);
  }

  const pairs: RunPair[] = [];
  let unpaired = 0;
  for (const k of [...byTask.keys()].sort()) {
    const slot = byTask.get(k);
    if (!slot?.present || !slot.absent) {
      unpaired += 1;
      continue;
    }
    pairs.push({
      present: slot.present,
      absent: slot.absent,
      presentRow: rowFor(slot.present, rows),
      absentRow: rowFor(slot.absent, rows),
    });
  }

  return { runner: runners[0] as string, config: configOf(first.conditions), pairs, failed, unpaired };
}
```

- [ ] **Step 7: Implement `src/derive-d1-v2.ts`**

```ts
import { measure, type DeriveOptions, type Measured } from "./derive-d1.js";
import { RUN_PAIR_KEY, type RunPair, type RunPairSet } from "./pair-runs.js";
import { D1V2Schema, VERDICT_DERIVED_METRICS, type D1V2 } from "./records.js";
import { requireResource, type AxisSpec } from "./registry.js";
import { DECLARED_NOT_VERIFIED } from "./runs.js";
import { subjectOf } from "./subject.js";

/** One version-2 D1 over one runner's run pairs, or null when nothing survives. */
export function deriveD1V2(set: RunPairSet, spec: AxisSpec, opts: DeriveOptions): D1V2 | null {
  const present = requireResource(spec, spec.resources[0] as string);
  const absent = requireResource(spec, spec.resources[1] as string);
  const m = measure(set.pairs, (p: RunPair) => ({ present: p.presentRow, absent: p.absentRow }), opts.metric, opts.direction);
  if (!m) return null;
  const first = m.kept[0] as Measured<RunPair>;

  return D1V2Schema.parse({
    schema_version: 2,
    subject: subjectOf(first.pair.presentRow),
    axis: spec.axis,
    kind: "D1",
    self_asserted: false,
    observed_at: opts.observedAt,
    unestablished:
      `${set.failed} failed run(s) and ${set.unpaired} task(s) with one arm only were not paired, and ` +
      `${m.dropped} pair(s) had an undefined metric; ${DECLARED_NOT_VERIFIED.join(", ")} are declared by ` +
      `the runner and not verified`,
    resource: { present, absent },
    pairing: {
      key: [...RUN_PAIR_KEY],
      pairs: m.kept.length,
      informative_pairs: m.informative,
      instances: m.kept.map((k) => [k.pair.present.run_id, k.pair.absent.run_id]),
    },
    metric: { name: opts.metric, direction: opts.direction, with: m.with, without: m.without, delta: m.delta, spread: m.spread },
    judge: {
      id: opts.judgeId,
      goldens_version: VERDICT_DERIVED_METRICS.has(opts.metric) ? null : "unversioned",
      self: false,
    },
    admissible: m.admissible,
    inadmissible_because: m.because,
    contributors: [set.runner],
  });
}
```

- [ ] **Step 8: Run the suite and typecheck**

Run: `bun run test; echo "test exit=$?"; bun run typecheck; echo "typecheck exit=$?"`
Expected: both exit 0; `pair-runs.test.ts` passes 8, `derive-d1-v2.test.ts` passes 5.

- [ ] **Step 9: Commit**

```bash
git add src/derive-d1.ts src/registry.ts registry/axes.json src/pair-runs.ts src/derive-d1-v2.ts tests/pair-runs.test.ts tests/derive-d1-v2.test.ts
git commit -m "feat: pair one runner's runs and derive a version-2 D1" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Joint observations

**Files:**
- Create: `src/joint.ts`
- Test: `tests/joint.test.ts`

**Interfaces:**
- Consumes: `measure` (Task 4); `rowFor`, `configKey`, `taskKey`, `RUN_PAIR_KEY`, `type RunPair` (Task 4); `D1V2Schema`, `type D1V2` (Task 2); `type RunRecord` (Task 1); `canonicalJson`, `observationId`; `deriveD1V2`, `pairRuns`, `recorded`, `withVerdict` in tests.
- Produces: `interface JointInput { sources; runs; rows; spec; observedAt }`; `buildJoint(input: JointInput): D1V2`.

- [ ] **Step 1: Write the failing test**

`tests/joint.test.ts`:

```ts
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

  it("refuses a source whose runs were not supplied", () => {
    expect(() =>
      buildJoint({ sources: [alice.obs, bobAgrees.obs], runs: alice.runs, rows: alice.rows, spec, observedAt: at }),
    ).toThrow(/was not supplied/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/joint.test.ts`
Expected: FAIL — `Failed to load url ../src/joint.js`.

- [ ] **Step 3: Implement `src/joint.ts`**

```ts
import { canonicalJson, observationId } from "./canonical.js";
import type { ReviewRow } from "./corpus.js";
import { measure } from "./derive-d1.js";
import { configKey, rowFor, RUN_PAIR_KEY, taskKey, type RunPair } from "./pair-runs.js";
import { D1V2Schema, type D1V2 } from "./records.js";
import type { AxisSpec } from "./registry.js";
import type { RunRecord } from "./runs.js";

export interface JointInput {
  readonly sources: readonly D1V2[];
  readonly runs: readonly RunRecord[];
  readonly rows: readonly ReviewRow[];
  readonly spec: AxisSpec;
  readonly observedAt: string;
}

type Agreement = "identical" | "divergent" | "withheld-both";

/** Whether the contributors who ran the same task saw the same graph. */
function agreement(pairs: readonly RunPair[], shared: ReadonlySet<string>): Agreement {
  const perTask = new Map<string, Set<string | null>>();
  for (const p of pairs) {
    const k = taskKey(p.present);
    if (!shared.has(k)) continue;
    const digests = perTask.get(k);
    if (digests) digests.add(p.present.conditions.graph_digest);
    else perTask.set(k, new Set([p.present.conditions.graph_digest]));
  }
  const all = [...perTask.values()].flatMap((s) => [...s]);
  if (all.every((d) => d === null)) return "withheld-both";
  return [...perTask.values()].every((s) => s.size === 1) ? "identical" : "divergent";
}

/**
 * Pool single-runner observations into one, explicitly.
 *
 * Nothing pools automatically: if foreign pairs merged by themselves, anyone
 * could suppress an honest observation by fabricating opposite-signed pairs.
 * Here the sources stand untouched and a dispute becomes a third record.
 *
 * Tasks are not averaged. A supplier's +1 and a verifier's -1 on one task
 * average to a tie, which would lower informative_pairs instead of tripping
 * gate 1 — deleting the disagreement this record exists to show. A task run by
 * more contributors therefore weighs more, which the profile spec's §5.1 would
 * forbid for a magnitude and which does not obstruct detecting disagreement.
 */
export function buildJoint(input: JointInput): D1V2 {
  const { sources, runs, rows, spec, observedAt } = input;
  const first = sources[0];
  if (first === undefined || sources.length < 2) throw new Error("a joint needs at least two sources");

  for (const s of sources) {
    if (s.joint) {
      throw new Error(
        `source ${observationId(s)} is itself a joint; joints are built from single-runner observations so ` +
          `no run is weighted twice by nesting`,
      );
    }
  }
  const contributors = [...new Set(sources.flatMap((s) => s.contributors))].sort();
  if (contributors.length < 2) {
    throw new Error(
      `sources come from ${contributors.length} runner(s); a joint needs at least two distinct runners — one ` +
        `runner's larger run set is a later observation, not a joint`,
    );
  }
  for (const s of sources) {
    const same = (label: string, a: unknown, b: unknown) => {
      if (canonicalJson(a) !== canonicalJson(b)) {
        throw new Error(`sources disagree on ${label}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      }
    };
    same("subject", first.subject, s.subject);
    same("axis", first.axis, s.axis);
    same("resource", first.resource, s.resource);
    same("metric.name", first.metric.name, s.metric.name);
    same("metric.direction", first.metric.direction, s.metric.direction);
    same("judge", first.judge, s.judge);
  }

  const byId = new Map(runs.map((r) => [r.run_id, r]));
  const seen = new Set<string>();
  const pairs: RunPair[] = [];
  for (const s of sources) {
    for (const [presentId, absentId] of s.pairing.instances) {
      const key = `${presentId}|${absentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const present = byId.get(presentId);
      const absent = byId.get(absentId);
      if (!present || !absent) {
        throw new Error(`run ${present ? absentId : presentId} is cited by a source and was not supplied`);
      }
      pairs.push({ present, absent, presentRow: rowFor(present, rows), absentRow: rowFor(absent, rows) });
    }
  }

  const configs = new Set(pairs.flatMap((p) => [configKey(p.present.conditions), configKey(p.absent.conditions)]));
  if (configs.size > 1) {
    throw new Error(`cited runs span ${configs.size} configurations; only graph_digest may differ between pooled runs`);
  }

  const runnersByTask = new Map<string, Set<string>>();
  for (const p of pairs) {
    const k = taskKey(p.present);
    const set = runnersByTask.get(k);
    if (set) set.add(p.present.runner);
    else runnersByTask.set(k, new Set([p.present.runner]));
  }
  const shared = new Set([...runnersByTask].filter(([, rs]) => rs.size > 1).map(([k]) => k));
  if (shared.size === 0) {
    throw new Error("no task was run by more than one contributor; a joint that re-runs nothing checks nothing");
  }

  const m = measure(pairs, (p: RunPair) => ({ present: p.presentRow, absent: p.absentRow }), first.metric.name, first.metric.direction);
  if (!m) throw new Error("no pair in the joint has a defined metric");

  const signs = new Map<string, { pos: boolean; neg: boolean }>();
  for (const k of m.kept) {
    const t = taskKey(k.pair.present);
    const s = signs.get(t) ?? { pos: false, neg: false };
    if (k.diff > 0) s.pos = true;
    if (k.diff < 0) s.neg = true;
    signs.set(t, s);
  }
  const contested = [...signs.values()].filter((s) => s.pos && s.neg).length;

  return D1V2Schema.parse({
    schema_version: 2,
    subject: first.subject,
    axis: first.axis,
    kind: "D1",
    self_asserted: false,
    observed_at: observedAt,
    unestablished:
      `pools ${contributors.length} runners over ${shared.size} shared task(s); a disagreement records that ` +
      `they did not agree, not which of them is right; tasks are not averaged, so a task run by more ` +
      `contributors weighs more`,
    resource: first.resource,
    pairing: {
      key: RUN_PAIR_KEY.filter((k) => k !== "runner"),
      pairs: m.kept.length,
      informative_pairs: m.informative,
      instances: m.kept.map((k) => [k.pair.present.run_id, k.pair.absent.run_id]),
    },
    metric: {
      name: first.metric.name,
      direction: first.metric.direction,
      with: m.with,
      without: m.without,
      delta: m.delta,
      spread: m.spread,
    },
    judge: first.judge,
    admissible: m.admissible,
    inadmissible_because: m.because,
    contributors,
    joint: {
      cites: [...new Set(sources.map((s) => observationId(s)))].sort(),
      graph_agreement: agreement(pairs, shared),
      contested_tasks: contested,
    },
  });
}
```

- [ ] **Step 4: Run the suite and typecheck**

Run: `bun run test; echo "test exit=$?"; bun run typecheck; echo "typecheck exit=$?"`
Expected: both exit 0; `joint.test.ts` passes 9.

- [ ] **Step 5: Commit**

```bash
git add src/joint.ts tests/joint.test.ts
git commit -m "feat: joint observations built explicitly, never averaging a task" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Auditing intents against runs

**Files:**
- Create: `src/audit.ts`
- Test: `tests/audit.test.ts`

**Interfaces:**
- Consumes: `dischargeProblems` (Task 3); `sealRun`, `type RunIntent`, `type RunRecord` (Task 1); `recorded`, `graphRow`, `ablatedRow` (Task 3 helpers).
- Produces: `interface Audit { unfulfilled; orphans; overdischarged; mismatched }`; `auditIntents(intents, runs): Audit`; `isClean(a: Audit): boolean`.

- [ ] **Step 1: Write the failing test**

`tests/audit.test.ts`:

```ts
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
    const early = variant({ observed_at: "2026-09-23T09:00:00+00:00" });
    expect(auditIntents([g.intent], [early]).mismatched[0]?.problems.join()).toMatch(/not a pre-registration/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/audit.test.ts`
Expected: FAIL — `Failed to load url ../src/audit.js`.

- [ ] **Step 3: Implement `src/audit.ts`**

```ts
import { dischargeProblems } from "./record.js";
import type { RunIntent, RunRecord } from "./runs.js";

export interface Audit {
  /** Announced and never run — the gap intents exist to make visible. */
  readonly unfulfilled: readonly RunIntent[];
  /** Run under an intent nobody announced. */
  readonly orphans: readonly RunRecord[];
  /** One announcement, several runs: announce once, run many, keep the best. */
  readonly overdischarged: readonly { readonly intent_id: string; readonly runs: readonly string[] }[];
  /** Run under conditions other than the announcement, or before it. */
  readonly mismatched: readonly { readonly run_id: string; readonly problems: readonly string[] }[];
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Compare what was announced with what was run.
 *
 * Collects rather than throws: an audit that stopped at the first problem would
 * hide every problem after it. Output is sorted so two readers produce the same
 * report. This has teeth only against a runner who announces at all — one who
 * never does breaks nothing here and simply does not appear.
 */
export function auditIntents(intents: readonly RunIntent[], runs: readonly RunRecord[]): Audit {
  const intentsById = new Map(intents.map((i) => [i.intent_id, i]));
  const runsByIntent = new Map<string, RunRecord[]>();
  for (const r of runs) {
    const list = runsByIntent.get(r.intent_id);
    if (list) list.push(r);
    else runsByIntent.set(r.intent_id, [r]);
  }

  return {
    unfulfilled: intents
      .filter((i) => !runsByIntent.has(i.intent_id))
      .sort((a, b) => byString(a.intent_id, b.intent_id)),
    orphans: runs.filter((r) => !intentsById.has(r.intent_id)).sort((a, b) => byString(a.run_id, b.run_id)),
    overdischarged: [...runsByIntent]
      .filter(([id, rs]) => intentsById.has(id) && rs.length > 1)
      .map(([intent_id, rs]) => ({ intent_id, runs: rs.map((r) => r.run_id).sort(byString) }))
      .sort((a, b) => byString(a.intent_id, b.intent_id)),
    mismatched: runs
      .flatMap((r) => {
        const intent = intentsById.get(r.intent_id);
        if (!intent) return [];
        const problems = dischargeProblems(intent, r);
        return problems.length > 0 ? [{ run_id: r.run_id, problems }] : [];
      })
      .sort((a, b) => byString(a.run_id, b.run_id)),
  };
}

export const isClean = (a: Audit): boolean =>
  a.unfulfilled.length === 0 && a.orphans.length === 0 && a.overdischarged.length === 0 && a.mismatched.length === 0;
```

- [ ] **Step 4: Run the suite and typecheck**

Run: `bun run test; echo "test exit=$?"; bun run typecheck; echo "typecheck exit=$?"`
Expected: both exit 0; `audit.test.ts` passes 6.

- [ ] **Step 5: Commit**

```bash
git add src/audit.ts tests/audit.test.ts
git commit -m "feat: audit intents against runs, naming gaps rather than stopping at the first" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Supersession across versions and contributors, and the spec amendment

**Files:**
- Modify: `src/supersede.ts` (full replacement below)
- Modify: `docs/superpowers/specs/2026-09-23-run-provenance-design.md`
- Test: extend `tests/supersede.test.ts`

**Interfaces:**
- Consumes: `type D1`, `type D1V2` (Task 2); `buildJoint`, `deriveD1V2`, `pairRuns`, `recorded` in tests.
- Produces: `supersededIds(records: readonly (D1 | D1V2)[]): Set<string>`.

- [ ] **Step 1: Write the failing test**

Append to `tests/supersede.test.ts`, and add these imports to it:

```ts
import { deriveD1V2 } from "../src/derive-d1-v2.js";
import { buildJoint } from "../src/joint.js";
import { pairRuns } from "../src/pair-runs.js";
import type { D1V2 } from "../src/records.js";
import { loadRegistry, requireAxis } from "../src/registry.js";
import { ablatedRow, graphRow, recorded } from "./helpers/fixtures.js";
```

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/supersede.test.ts`
Expected: FAIL on "lets one runner's larger, later observation supersede its smaller one" — the current code puts tuple instances in a `Set`, which compares arrays by reference, so no version-2 observation is ever a superset of another. The joint test **passes at this step, by that same accident**, not because the mirror attack is prevented; Step 3 fixes both for the right reason. `bun run typecheck` also fails here, since `supersededIds` accepts `D1[]` only.

- [ ] **Step 3: Replace `src/supersede.ts`**

```ts
import { observationId } from "./canonical.js";
import type { D1, D1V2 } from "./records.js";

type AnyD1 = D1 | D1V2;

const instanceKey = (i: string | readonly [string, string]): string => (typeof i === "string" ? i : `${i[0]}|${i[1]}`);

/** Version 1 has no contributors; the empty string keeps it in groups of its own. */
const contributorsOf = (r: AnyD1): string => ("contributors" in r ? r.contributors.join(",") : "");

/**
 * Which stored observations a later one has superseded.
 *
 * Recomputed from the records rather than written as a flag, which is
 * ../hivemark/src/supersede.ts's design: "Signing only the newest would bake one
 * scoring policy into a permanent record and make re-scoring under another
 * impossible. Since the distinction is recomputable by any reader, nothing is
 * lost by publishing both and marking which is which."
 *
 * Supersession never crosses a contributor set. A joint citing an honest
 * supplier's runs plus fabricated ones is a later superset of that supplier's
 * observation; letting it supersede would suppress the honest record — the
 * mirror attack the explicit joint exists to prevent, readmitted here.
 */
export function supersededIds(records: readonly AnyD1[]): Set<string> {
  const out = new Set<string>();
  const group = (r: AnyD1): string =>
    [r.subject, r.axis, r.metric.name, r.judge.id, r.judge.goldens_version, r.schema_version, contributorsOf(r)].join("|");

  const groups = new Map<string, AnyD1[]>();
  for (const r of records) {
    const g = group(r);
    const members = groups.get(g);
    if (members) members.push(r);
    else groups.set(g, [r]);
  }

  const keysOf = (r: AnyD1): Set<string> =>
    new Set((r.pairing.instances as readonly (string | readonly [string, string])[]).map(instanceKey));

  for (const members of groups.values()) {
    for (const a of members) {
      const aSet = keysOf(a);
      const beaten = members.some((b) => {
        if (b === a) return false;
        if (Date.parse(b.observed_at) <= Date.parse(a.observed_at)) return false;
        const bSet = keysOf(b);
        if (bSet.size < aSet.size) return false;
        return [...aSet].every((i) => bSet.has(i));
      });
      if (beaten) out.add(observationId(a));
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the suite and typecheck**

Run: `bun run test; echo "test exit=$?"; bun run typecheck; echo "typecheck exit=$?"`
Expected: both exit 0; the six pre-existing supersession tests and the three new ones pass.

- [ ] **Step 5: Amend the spec**

Read `docs/superpowers/specs/2026-09-23-run-provenance-design.md` first. Then make these four edits.

Change `**Status:** v1. Approved in brainstorming, not implemented.` to:

```markdown
**Status:** v1.1. Approved in brainstorming, amended by planning.

**What changed in v1.1.** Planning found that §3's claim — supersession "works
unchanged" — readmitted the mirror attack §5 defends against: a joint covering an
honest supplier's runs plus fabricated ones is a later superset and would
supersede the honest observation. Supersession now never crosses a contributor
set (§3). To make that possible every version-2 D1 names its contributors, and
the joint-only fields sit in one block (§5). Three gaps were also closed: a joint
in which no task was run by two contributors is refused (§5.1), an observation
holds at most one completed run per task per arm (§6.1), and intents are
announced after `prepare` and before `review` (§4.1).
```

Replace the §3 paragraph

```markdown
With instances identifying runs, a re-run genuinely adds instances, a joint
observation covering both is a superset, and the existing supersession rule
works unchanged.
```

with

```markdown
With instances identifying runs, a re-run genuinely adds instances. A runner's
own later, larger observation is a superset of its earlier one and supersedes it
under the existing rule.

**Supersession never crosses a contributor set**, and this is not a detail. A
joint observation covering an honest supplier's runs plus fabricated ones is also
a later superset, and under an unrestricted rule it would supersede the honest
record — suppressing it, which is the mirror attack §5 exists to prevent,
readmitted through supersession. Observations are grouped by their contributors
before supersession is computed, so a joint supersedes only an earlier joint of
the same runners.
```

Replace the §5 opening

```markdown
A joint observation is a D1 carrying four additional fields. It is not a new
record kind.

```ts
contributors: string[];    // runner ids, sorted
cites: string[];           // observation ids it draws from
graph_agreement: "identical" | "divergent" | "withheld-both";
contested_tasks: number;   // tasks where two runs disagree in sign
```
```

with

```markdown
Every version-2 D1 names its `contributors` — one runner for an ordinary
observation, two or more for a joint — because §3's supersession groups by them.
A joint additionally carries one block. It is not a new record kind.

```ts
contributors: string[];    // runner ids, sorted; on every version-2 D1
joint?: {                  // present iff contributors.length > 1
  cites: string[];         // observation ids it draws from, sorted
  graph_agreement: "identical" | "divergent" | "withheld-both";
  contested_tasks: number; // tasks where two runs disagree in sign
};
```

Nesting makes "all or none" hold by construction rather than by a check.
```

Append to the end of §5.1 (after the paragraph ending "where a consumer decides what it is worth."):

```markdown

A joint in which **no task was run by more than one contributor is refused**. It
re-runs nothing and so checks nothing, and `graph_agreement` over zero shared
tasks would report "identical" about a comparison that never happened.
```

Append to §4.1, after the `RunIntent` code block:

```markdown
**An intent is announced after `prepare` and before `review`.** It must carry
`graph_digest`, and the graph exists only once `prepare` has built it. Announcing
before `prepare` would leave the one condition this axis is about undeclared.
Re-running `prepare` to degrade the *present* arm's graph would shrink the delta,
which is against a manipulating supplier's interest; the withheld arm has no
graph to degrade.
```

Append to §6.1, after its last paragraph:

```markdown

An observation holds **at most one completed run per task per arm per runner**.
When a runner has two, which to pair with the other arm is a choice, and a choice
at that point is where selection hides. They are refused together and must be
recorded in separate observations.
```

- [ ] **Step 6: Verify the spec still has no dangling references**

Run: `grep -n "TBD\|TODO" docs/superpowers/specs/2026-09-23-run-provenance-design.md; echo "none above = clean"`
Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add src/supersede.ts tests/supersede.test.ts docs/superpowers/specs/2026-09-23-run-provenance-design.md
git commit -m "fix: supersession never crosses a contributor set; amend spec to v1.1" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The runs CLI

**Files:**
- Create: `src/cli-runs.ts`
- Modify: `package.json` (add `"runs": "bun src/cli-runs.ts"` to `scripts`)
- Test: `tests/runs-e2e.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: `main(argv: readonly string[]): number` — exit 0 on success, 1 when `audit` finds a gap, 2 on a refusal or usage error.

- [ ] **Step 1: Write the failing end-to-end test**

`tests/runs-e2e.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { observationId } from "../src/canonical.js";
import { main } from "../src/cli-runs.js";
import { readOverlay } from "../src/overlay.js";
import type { D1V2 } from "../src/records.js";
import type { RunIntent } from "../src/runs.js";
import { ablatedRow, conditionsFor, graphRow, withVerdict } from "./helpers/fixtures.js";

const dir = mkdtempSync(join(tmpdir(), "runs-e2e-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const at = (f: string) => join(dir, f);
const overlay = at("overlay.jsonl");
const jsonl = (rows: object[]) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

// alice's reviews show the graph helping; bob's, on the same task, the opposite.
const bobGraph = withVerdict(graphRow, "uncertain");
const bobAblated = withVerdict(ablatedRow, "confirmed");
writeFileSync(at("alice.jsonl"), jsonl([graphRow, ablatedRow]));
writeFileSync(at("bob.jsonl"), jsonl([bobGraph, bobAblated]));
writeFileSync(at("both.jsonl"), jsonl([graphRow, ablatedRow, bobGraph, bobAblated]));
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/runs-e2e.test.ts`
Expected: FAIL — `Failed to load url ../src/cli-runs.js`.

- [ ] **Step 3: Implement `src/cli-runs.ts`**

```ts
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { auditIntents, isClean } from "./audit.js";
import { observationId } from "./canonical.js";
import { readReviews, type Manifest, type ReviewRow } from "./corpus.js";
import { deriveD1V2 } from "./derive-d1-v2.js";
import { buildJoint } from "./joint.js";
import { appendOverlay, readOverlay, type OverlayRecord } from "./overlay.js";
import { pairRuns } from "./pair-runs.js";
import { failedRunFor, intentFor, runFor } from "./record.js";
import type { D1V2 } from "./records.js";
import { loadRegistry, requireAxis } from "./registry.js";
import { ConditionsSchema, FAILURES, type FailureKind, type RunIntent, type RunRecord } from "./runs.js";

const AXIS = "context.graph";
const USAGE = [
  "usage: bun src/cli-runs.ts <command> --flag value ...",
  "  intent --runner --url --head --project --arm --conditions <file.json> --overlay",
  "  run    --intent --reviews <file.jsonl> --overlay",
  "  fail   --intent --failure <prepare|ingest|model-error|parse|timeout> --detail --overlay",
  "  derive --runner --reviews <file.jsonl> --overlay",
  "  joint  --sources <id,id,...> --reviews <file.jsonl> --overlay",
  "  audit  --overlay",
].join("\n");

/** Every flag is required, none may repeat, and nothing is positional. */
function flags(argv: readonly string[], allowed: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i] as string;
    const value = argv[i + 1];
    if (!name.startsWith("--")) throw new Error(`expected a flag, got ${JSON.stringify(name)}`);
    const key = name.slice(2);
    if (!allowed.includes(key)) {
      throw new Error(`unknown flag --${key}; this command takes ${allowed.map((a) => `--${a}`).join(" ")}`);
    }
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
    if (out.has(key)) throw new Error(`--${key} given twice`);
    out.set(key, value);
  }
  for (const a of allowed) if (!out.has(a)) throw new Error(`missing --${a}`);
  return out;
}

const get = (f: Map<string, string>, k: string): string => f.get(k) as string;
const now = (): string => new Date().toISOString();

const reviewsAt = (path: string): readonly ReviewRow[] => {
  const manifest: Manifest = { dir: dirname(path), base: ".", reviews: [basename(path)], judged: [] };
  return readReviews(manifest);
};

const intents = (recs: readonly OverlayRecord[]): RunIntent[] => recs.filter((r): r is RunIntent => r.kind === "I");
const runs = (recs: readonly OverlayRecord[]): RunRecord[] => recs.filter((r): r is RunRecord => r.kind === "R");
const v2s = (recs: readonly OverlayRecord[]): D1V2[] =>
  recs.filter((r): r is D1V2 => r.kind === "D1" && r.schema_version === 2);

function intentById(overlay: string, id: string): RunIntent {
  const hit = intents(readOverlay(overlay)).find((i) => i.intent_id === id);
  if (!hit) throw new Error(`no intent ${id} in ${overlay}`);
  return hit;
}

function commands(sub: string | undefined, rest: readonly string[]): number {
  const spec = requireAxis(loadRegistry("registry/axes.json"), AXIS);
  switch (sub) {
    case "intent": {
      const f = flags(rest, ["runner", "url", "head", "project", "arm", "conditions", "overlay"]);
      const intent = intentFor({
        runner: get(f, "runner"),
        task: { url: get(f, "url"), head_sha: get(f, "head"), project: get(f, "project") },
        arm: get(f, "arm"),
        conditions: ConditionsSchema.parse(JSON.parse(readFileSync(get(f, "conditions"), "utf8"))),
        announcedAt: now(),
      });
      appendOverlay(get(f, "overlay"), [intent]);
      process.stdout.write(`${intent.intent_id}\n`);
      return 0;
    }
    case "run": {
      const f = flags(rest, ["intent", "reviews", "overlay"]);
      const intent = intentById(get(f, "overlay"), get(f, "intent"));
      const matching = reviewsAt(get(f, "reviews")).filter(
        (r) => r.url === intent.task.url && r.head_sha === intent.task.head_sha && r.arm === intent.arm,
      );
      // Exactly one. Two rows for the announced task and arm means the file holds
      // someone else's run too, and picking one is the refused join again.
      if (matching.length !== 1) {
        throw new Error(
          `${matching.length} rows in ${get(f, "reviews")} match ${intent.task.url}@${intent.task.head_sha} on ` +
            `arm ${intent.arm}; supply the file this run produced, which holds exactly one`,
        );
      }
      const run = runFor(intent, matching[0] as ReviewRow, now());
      appendOverlay(get(f, "overlay"), [run]);
      process.stdout.write(`${run.run_id}\n`);
      return 0;
    }
    case "fail": {
      const f = flags(rest, ["intent", "failure", "detail", "overlay"]);
      const failure = get(f, "failure");
      if (!(FAILURES as readonly string[]).includes(failure)) {
        throw new Error(`--failure must be one of ${FAILURES.join(", ")}`);
      }
      const run = failedRunFor(intentById(get(f, "overlay"), get(f, "intent")), failure as FailureKind, get(f, "detail"), now());
      appendOverlay(get(f, "overlay"), [run]);
      process.stdout.write(`${run.run_id}\n`);
      return 0;
    }
    case "derive": {
      const f = flags(rest, ["runner", "reviews", "overlay"]);
      const own = runs(readOverlay(get(f, "overlay"))).filter((r) => r.runner === get(f, "runner"));
      const set = pairRuns(own, reviewsAt(get(f, "reviews")), spec);
      const d1 = deriveD1V2(set, spec, { metric: "uncertain_rate", direction: "lower-better", judgeId: "skeptic", observedAt: now() });
      if (!d1) throw new Error("no pair survived; nothing to record");
      appendOverlay(get(f, "overlay"), [d1]);
      process.stdout.write(
        `${observationId(d1)}\n  ${d1.pairing.pairs} pairs, ${d1.pairing.informative_pairs} informative, admissible=${d1.admissible}\n`,
      );
      return 0;
    }
    case "joint": {
      const f = flags(rest, ["sources", "reviews", "overlay"]);
      const recs = readOverlay(get(f, "overlay"));
      const byId = new Map(v2s(recs).map((d) => [observationId(d), d]));
      const sources = get(f, "sources")
        .split(",")
        .map((id) => {
          const hit = byId.get(id);
          if (!hit) throw new Error(`no version-2 observation ${id} in ${get(f, "overlay")}`);
          return hit;
        });
      const joint = buildJoint({ sources, runs: runs(recs), rows: reviewsAt(get(f, "reviews")), spec, observedAt: now() });
      appendOverlay(get(f, "overlay"), [joint]);
      process.stdout.write(
        `${observationId(joint)}\n  ${joint.contributors.join(" + ")}: contested_tasks=${joint.joint?.contested_tasks}, ` +
          `graph_agreement=${joint.joint?.graph_agreement}, admissible=${joint.admissible}\n`,
      );
      return 0;
    }
    case "audit": {
      const f = flags(rest, ["overlay"]);
      const recs = readOverlay(get(f, "overlay"));
      const audit = auditIntents(intents(recs), runs(recs));
      process.stdout.write(
        `${JSON.stringify(
          {
            unfulfilled: audit.unfulfilled.map((i) => i.intent_id),
            orphans: audit.orphans.map((r) => r.run_id),
            overdischarged: audit.overdischarged,
            mismatched: audit.mismatched,
          },
          null,
          2,
        )}\n`,
      );
      return isClean(audit) ? 0 : 1;
    }
    default:
      throw new Error(`unknown command ${JSON.stringify(sub)}`);
  }
}

export function main(argv: readonly string[]): number {
  try {
    return commands(argv[0], argv.slice(1));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n${USAGE}\n`);
    return 2;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
```

- [ ] **Step 4: Add the script to `package.json`**

In `"scripts"`, after `"derive": "bun src/cli.ts"`, add `, "runs": "bun src/cli-runs.ts"`.

- [ ] **Step 5: Run the suite and typecheck**

Run: `bun run test; echo "test exit=$?"; bun run typecheck; echo "typecheck exit=$?"`
Expected: both exit 0; `runs-e2e.test.ts` passes 10.

- [ ] **Step 6: Confirm the version-1 path is untouched**

Run: `bun run derive corpus.json --out /tmp/v1-check.jsonl && rm -f /tmp/v1-check.jsonl`
Expected: `65 records`, `D1: 6 pairs, 2 informative, admissible=false`, `judged joined: 71, refused: 46` — identical to before this plan.

- [ ] **Step 7: Commit**

```bash
git add src/cli-runs.ts package.json tests/runs-e2e.test.ts
git commit -m "feat: runs CLI — announce, record, derive, join, audit" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

**Spec coverage.** §2 conditions-not-results → Tasks 4–5 (a re-run is another measurement, compared by the gates). §3 instance-is-a-run, schema version 2 → Tasks 2, 4; supersession correction → Task 7. §4.1–4.3 records and conditions → Task 1. §4.4 `graph_digest` → Task 1 (digest), Task 4 (per-axis rule), Task 5 (agreement). §4.5 `declared_not_verified` → Tasks 1, 3. §4.6 outcome in `run_id` → Task 1. §5 joint → Task 5; §5.1 pooling rule → Task 5; §5.2 no averaging → Task 5. §6.1 every attempt recorded → Tasks 3, 8 (`fail`). §6.2 visible gap → Task 6. §6.3 limit → stated in `audit.ts`. §7 publication and anchoring → **not built**, by the Global Constraints: they are `../p-e`'s deposit and `../hivemark`'s anchor.

**Not validated against real data.** Nothing in the corpus was recorded with intents, so no real version-2 observation can exist yet, and this plan asserts no corpus figures. Its only real-data check is Task 8 Step 6: the version-1 path still reproduces the profile spec's numbers exactly. The first real validation is the first funded run.

**Type consistency.** `measure` (Task 4) is the one implementation used by `deriveD1`, `deriveD1V2` and `buildJoint`. `RunPair` and `rowFor` (Task 4) are shared by pairing and joints. `dischargeProblems` (Task 3) is shared by recording and auditing. `recorded`, `withVerdict`, `conditionsFor` (Task 3) are the only fixture builders.
