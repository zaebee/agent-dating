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

/**
 * One D1 over a pair set, or null when nothing survives.
 *
 * The per-pair difference is computed per review and then differenced — never
 * pooled and then differenced. The arms differ sharply in findings per review,
 * so a pooled difference would be dominated by the arm that talks more, and
 * both gates run on these differences, so pooling would change which
 * observations are admissible.
 */
export function deriveD1(set: PairSet, spec: AxisSpec, opts: DeriveOptions): D1 | null {
  const metric = METRICS[opts.metric];
  if (!metric) throw new Error(`no implementation for metric ${JSON.stringify(opts.metric)}`);

  const present = requireResource(spec, spec.resources[0] as string);
  const absent = requireResource(spec, spec.resources[1] as string);

  const kept: { pair: Pair; withValue: number; withoutValue: number; diff: number }[] = [];
  let dropped = 0;
  // `lower-better` means a fall is an improvement, so the raw difference is
  // multiplied by -1 exactly once, here, and never re-applied downstream.
  const sign = opts.direction === "lower-better" ? -1 : 1;

  for (const pair of set.pairs) {
    const a = metric(pair.present);
    const b = metric(pair.absent);
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

  const first = kept[0] as (typeof kept)[number];
  const record = {
    schema_version: RECORD_SCHEMA_VERSION,
    subject: subjectOf(first.pair.present),
    axis: spec.axis,
    kind: "D1" as const,
    self_asserted: false as const,
    observed_at: opts.observedAt,
    unestablished:
      `dropped ${dropped} pair(s) whose metric was undefined, and ${set.unplanned} row(s) with no ` +
      `arm at all; says nothing about identities absent from this corpus, nor about any axis but ${spec.axis}`,
    resource: { present, absent },
    pairing: {
      key: [...set.key],
      pairs: kept.length,
      informative_pairs: informative,
      instances: kept.map((k) => k.pair.instance),
    },
    metric: {
      name: opts.metric,
      direction: opts.direction,
      with: round4(mean(kept.map((k) => k.withValue))),
      without: round4(mean(kept.map((k) => k.withoutValue))),
      delta: round4(mean(diffs)),
      spread,
    },
    judge: {
      id: opts.judgeId,
      goldens_version: VERDICT_DERIVED_METRICS.has(opts.metric) ? null : "unversioned",
      self: false,
    },
    admissible: verdict.admissible,
    inadmissible_because: [...verdict.because],
  };

  return D1Schema.parse(record);
}
