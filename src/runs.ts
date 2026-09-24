import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { byCodeUnit, canonicalJson } from "./canonical.js";
import { required, timestampOf } from "./records.js";

/**
 * 3: `Conditions` gained `features`. No version-2 intent or run was ever written,
 * but the field set changed, and the rule is to bump on any field-set change
 * rather than reason about who might hold the old shape.
 */
export const RUN_SCHEMA_VERSION = 3 as const;

export const digest = (data: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(data).digest("hex")}`;

/**
 * What a second party needs to assemble the same inputs.
 *
 * Strict: an unknown key is refused rather than hashed in, because a condition
 * nobody here models is one nobody here can hold equal.
 */
const isSortedUnique = (xs: readonly string[]): boolean =>
  xs.every((x, i) => i === 0 || byCodeUnit(xs[i - 1] as string, x) < 0);

export const ConditionsSchema = z
  .object({
    /**
     * GUARDIAN_FEATURES, parsed: which context sections the review gets —
     * full files, the outbound flow fallback, chunking. It changes the prompt
     * and is neither part of `review_fingerprint` nor written to the review row
     * (codegraph-brain#505), so without it two runs with identical records
     * could have read different prompts. Empty means "none", explicitly; the
     * field is required, because absent and none are different claims.
     */
    features: z
      .array(z.string().min(1))
      .refine(isSortedUnique, { message: "features must be sorted and free of duplicates, so one set always hashes the same" }),
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
 * Stated by the runner and unprovable by the record. The models and `features`
 * arrive through environment variables, not flags, and no review row records the
 * latter; `profile` is not on the review row at all;
 * `graph_digest` is whatever the runner hashed, and nothing ties it to the graph
 * the review saw; `slice` goes unchecked whenever the run covered "all". A list
 * rather than prose, so a consumer can filter on it — and a list that omits a
 * condition implies a verification that never ran. Sorted, because it is hashed.
 */
export const DECLARED_NOT_VERIFIED: readonly ConditionKey[] = [
  "features",
  "finder_model",
  "finder_provider",
  "graph_digest",
  "profile",
  "skeptic_model",
  "skeptic_provider",
  "slice",
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
    const canonical = [...new Set(d)].sort(byCodeUnit);
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
  const files = filesUnder(path).sort(byCodeUnit);
  if (files.length === 0) {
    throw new Error(`graph artefact ${path} is empty; an empty ingest is a failed ingest, not a graph`);
  }
  return digest(files.map((rel) => `${rel}\u0000${digest(readFileSync(join(path, rel)))}`).join("\n"));
}
