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
