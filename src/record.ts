import { canonicalJson } from "./canonical.js";
import type { ReviewRow } from "./corpus.js";
import {
  DECLARED_NOT_VERIFIED,
  findingsDigest,
  RUN_SCHEMA_VERSION,
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
    schema_version: RUN_SCHEMA_VERSION,
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
 * `profile` and `features` are not compared: the row records neither. `slice` is compared
 * against `pr_slice` only when the run was restricted to one slice — `pr_slice`
 * is the pull request's classification, so an ablated run of a graph-slice PR
 * still reads `graph`, and a run over `all` slices sees every value. `had_graph`
 * must agree with whether a graph was declared: a graph-arm run whose ingest
 * silently failed is the confound this axis measures. An absent
 * `skeptic_provider` and null are the same, as `genomeOf` treats them. An absent
 * `temperature` maps to null, because `Conditions` has no way to say "absent"
 * other than null.
 *
 * `reviewed_at` is when the review actually ran. A review that ran before the
 * intent was announced is not pre-registered, whatever `observed_at` says —
 * `observed_at` is only when the run was recorded.
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
  cmp("had_graph", c.graph_digest !== null, row.had_graph);
  if (c.slice !== "all") cmp("slice", c.slice, row.pr_slice);
  if (Date.parse(row.reviewed_at) < Date.parse(intent.announced_at)) {
    problems.push(
      `reviewed at ${row.reviewed_at}, before it was announced at ${intent.announced_at}; that is not a pre-registration`,
    );
  }
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
    // Canonical JSON, not !==: `features` is an array, and the intent and the run
    // hold different instances of equal arrays.
    if (canonicalJson(run.conditions[k]) !== canonicalJson(intent.conditions[k])) {
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
    schema_version: RUN_SCHEMA_VERSION,
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
