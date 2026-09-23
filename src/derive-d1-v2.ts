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
