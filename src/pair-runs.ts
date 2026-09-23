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
    // Completed runs only. A run that failed at `ingest` on the graph arm has no
    // graph to digest, and it never pairs, so its digest reaches no measurement —
    // refusing it would block recording the very failure §6.1 requires be kept.
    if (withheld === undefined || !r.outcome.ok) continue;
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
