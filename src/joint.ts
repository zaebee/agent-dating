import { byCodeUnit, canonicalJson, observationId } from "./canonical.js";
import type { ReviewRow } from "./corpus.js";
import { measure, type Measured } from "./derive-d1.js";
import { deriveD1V2 } from "./derive-d1-v2.js";
import { configKey, pairRuns, rowFor, RUN_PAIR_KEY, taskKey, type RunPair } from "./pair-runs.js";
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

/** Add `value` to the set stored under `key`, creating the set on first use. */
function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

/** Whether the contributors who ran the same task saw the same graph. */
function agreement(pairs: readonly RunPair[], shared: ReadonlySet<string>): Agreement {
  const perTask = new Map<string, Set<string | null>>();
  for (const p of pairs) {
    const k = taskKey(p.present);
    if (!shared.has(k)) continue;
    addTo(perTask, k, p.present.conditions.graph_digest);
  }
  const all = [...perTask.values()].flatMap((s) => [...s]);
  if (all.every((d) => d === null)) return "withheld-both";
  return [...perTask.values()].every((s) => s.size === 1) ? "identical" : "divergent";
}

const pairsOf = (d: D1V2): string[] => d.pairing.instances.map(([p, a]) => `${p}|${a}`).sort(byCodeUnit);

/**
 * Re-derive a source from its own cited runs and refuse it if it states anything
 * else.
 *
 * A source is a record anyone can publish, and its schema cannot check its pairs
 * against runs. Trusted as written, a supplier could swap the arms of one pair or
 * relabel its runner and turn a recorded disagreement into agreement. Re-deriving
 * with the same `pairRuns` and `deriveD1V2` that produced honest sources applies
 * every rule they do — one runner, one configuration, arms where the registry says,
 * the graph rule, one completed run per task per arm — and then compares.
 */
function verifySource(
  source: D1V2,
  byId: ReadonlyMap<string, RunRecord>,
  rows: readonly ReviewRow[],
  spec: AxisSpec,
): void {
  const id = observationId(source);
  const cited = [...new Set(source.pairing.instances.flat())].map((runId) => {
    const run = byId.get(runId);
    if (!run) throw new Error(`run ${runId} is cited by a source and was not supplied`);
    return run;
  });
  let again: D1V2 | null;
  try {
    again = deriveD1V2(pairRuns(cited, rows, spec), spec, {
      metric: source.metric.name,
      direction: source.metric.direction,
      judgeId: source.judge.id,
      observedAt: source.observed_at,
    });
  } catch (err) {
    throw new Error(`source ${id} does not re-derive from its runs: ${(err as Error).message}`);
  }
  if (!again) throw new Error(`source ${id} does not re-derive from its runs: they pair into nothing`);
  const differ = (label: string, stated: unknown, derived: unknown) => {
    if (canonicalJson(stated) !== canonicalJson(derived)) {
      throw new Error(
        `source ${id} does not re-derive from its runs: ${label} states ${JSON.stringify(stated)}, its runs give ${JSON.stringify(derived)}`,
      );
    }
  };
  differ("contributors", source.contributors, again.contributors);
  differ("pairing.instances", pairsOf(source), pairsOf(again));
  differ("pairing.informative_pairs", source.pairing.informative_pairs, again.pairing.informative_pairs);
  differ("subject", source.subject, again.subject);
  differ("resource", source.resource, again.resource);
  differ("metric", source.metric, again.metric);
  differ("judge", source.judge, again.judge);
  differ("admissible", source.admissible, again.admissible);
}

function sameOrThrow(label: string, a: unknown, b: unknown): void {
  if (canonicalJson(a) !== canonicalJson(b)) {
    throw new Error(`sources disagree on ${label}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
}

/** Refuse sources that cannot be pooled at all, before any run is read. */
function checkSources(sources: readonly D1V2[], spec: AxisSpec): { first: D1V2; contributors: string[] } {
  const first = sources[0];
  if (first === undefined || sources.length < 2) throw new Error("a joint needs at least two sources");
  const nested = sources.find((s) => s.joint);
  if (nested) {
    throw new Error(
      `source ${observationId(nested)} is itself a joint; joints are built from single-runner observations so ` +
        `no run is weighted twice by nesting`,
    );
  }
  const contributors = [...new Set(sources.flatMap((s) => s.contributors))].sort(byCodeUnit);
  if (contributors.length < 2) {
    throw new Error(
      `sources come from ${contributors.length} runner(s); a joint needs at least two distinct runners — one ` +
        `runner's larger run set is a later observation, not a joint`,
    );
  }
  if (first.axis !== spec.axis) {
    throw new Error(
      `sources are on axis ${JSON.stringify(first.axis)}, not ${JSON.stringify(spec.axis)}; a joint built under ` +
        `another axis's registry would be labelled with a resource it never withheld`,
    );
  }
  for (const s of sources) {
    sameOrThrow("subject", first.subject, s.subject);
    sameOrThrow("axis", first.axis, s.axis);
    sameOrThrow("resource", first.resource, s.resource);
    sameOrThrow("metric.name", first.metric.name, s.metric.name);
    sameOrThrow("metric.direction", first.metric.direction, s.metric.direction);
    sameOrThrow("judge", first.judge, s.judge);
  }
  return { first, contributors };
}

/** Every distinct run pair the sources cite, each counted once, with its rows. */
function collectPairs(
  sources: readonly D1V2[],
  byId: ReadonlyMap<string, RunRecord>,
  rows: readonly ReviewRow[],
): RunPair[] {
  const seen = new Set<string>();
  const pairs: RunPair[] = [];
  for (const [presentId, absentId] of sources.flatMap((s) => s.pairing.instances)) {
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
  return pairs;
}

/**
 * §6.1 across the pooled runs, not only within each source: one runner's two
 * sources may each pair a different completed run of the same task and arm, and
 * pooling both is the selection §6.1 refuses inside one observation.
 */
function refuseRepeatedRuns(pairs: readonly RunPair[]): void {
  const completed = new Map<string, Set<string>>();
  for (const r of pairs.flatMap((p) => [p.present, p.absent])) {
    addTo(completed, `${r.runner} ${taskKey(r)} ${r.arm}`, r.run_id);
  }
  for (const [k, ids] of completed) {
    if (ids.size > 1) {
      const listed = [...ids].sort(byCodeUnit).join(", ");
      throw new Error(
        `more than one completed run for ${k} across the sources (${listed}); which to pool is a choice, and a choice here is where selection hides`,
      );
    }
  }
}

function refuseMixedConfigs(pairs: readonly RunPair[]): void {
  const configs = new Set(pairs.flatMap((p) => [configKey(p.present.conditions), configKey(p.absent.conditions)]));
  if (configs.size > 1) {
    throw new Error(`cited runs span ${configs.size} configurations; only graph_digest may differ between pooled runs`);
  }
}

/** Tasks run by more than one contributor; refused when there are none. */
function sharedTasks(pairs: readonly RunPair[]): Set<string> {
  const runnersByTask = new Map<string, Set<string>>();
  for (const p of pairs) addTo(runnersByTask, taskKey(p.present), p.present.runner);
  const shared = new Set([...runnersByTask].filter(([, rs]) => rs.size > 1).map(([k]) => k));
  if (shared.size === 0) {
    throw new Error("no task was run by more than one contributor; a joint that re-runs nothing checks nothing");
  }
  return shared;
}

/** Tasks on which one run found the resource helped and another that it hurt. */
function contestedTasks(kept: readonly Measured<RunPair>[]): number {
  const signs = new Map<string, Set<number>>();
  for (const k of kept) addTo(signs, taskKey(k.pair.present), Math.sign(k.diff));
  return [...signs.values()].filter((s) => s.has(1) && s.has(-1)).length;
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
  const { first, contributors } = checkSources(sources, spec);

  const byId = new Map(runs.map((r) => [r.run_id, r]));
  for (const s of new Map(sources.map((src) => [observationId(src), src])).values()) {
    verifySource(s, byId, rows, spec);
  }
  const pairs = collectPairs(sources, byId, rows);
  refuseRepeatedRuns(pairs);
  refuseMixedConfigs(pairs);
  const shared = sharedTasks(pairs);

  const m = measure(pairs, (p: RunPair) => ({ present: p.presentRow, absent: p.absentRow }), first.metric.name, first.metric.direction);
  if (!m) throw new Error("no pair in the joint has a defined metric");

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
      cites: [...new Set(sources.map((s) => observationId(s)))].sort(byCodeUnit),
      graph_agreement: agreement(pairs, shared),
      contested_tasks: contestedTasks(m.kept),
    },
  });
}
