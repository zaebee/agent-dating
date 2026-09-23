import type { ReviewRow } from "./corpus.js";
import { classify, type AxisSpec } from "./registry.js";

export interface Pair {
  readonly instance: string;
  readonly present: ReviewRow;
  readonly absent: ReviewRow;
}

export interface PairSet {
  readonly key: readonly string[];
  readonly pairs: readonly Pair[];
  /** Rows carrying no arm at all, counted rather than silently dropped. */
  readonly unplanned: number;
}

/**
 * A key component that cannot collide with any JSON value.
 *
 * `JSON.stringify(undefined)` is `undefined`, which an array join renders as
 * the empty string — so an absent field and a field written `""` would produce
 * the same key. That is the collapse this project has now met three times, and
 * it would silently pair two rows that differ on an identifying field.
 */
const ABSENT = "\u0000absent";

const component = (v: unknown): string => (v === undefined ? ABSENT : (JSON.stringify(v) ?? ABSENT));

/**
 * Pair the two arms of one axis, holding every identifying field equal.
 *
 * The classification pass runs over every field of every row before any pairing
 * happens. That ordering is the point: an unclassified field may be one that
 * varied across a pair, and discovering it after the pairs are built means the
 * confound is already inside the numbers.
 */
export function pairReviews(rows: readonly ReviewRow[], spec: AxisSpec): PairSet {
  for (const row of rows) for (const field of Object.keys(row)) classify(spec, field);

  const present = spec.resources[0];
  const absent = spec.resources[1];
  if (present === undefined || absent === undefined) {
    throw new Error(`axis ${spec.axis} declares fewer than two resource values`);
  }

  const keyOf = (row: ReviewRow): string =>
    spec.identifying.map((f) => component((row as Record<string, unknown>)[f])).join("|");

  const byArm = new Map<string, Map<string, ReviewRow>>();
  let unplanned = 0;
  for (const row of rows) {
    const arm = (row as Record<string, unknown>)[spec.resource_field];
    // Absent, not blank. An unplanned run is not a controlled one, whatever its
    // had_graph says, so it never becomes either side of a pair.
    if (arm === undefined) {
      unplanned += 1;
      continue;
    }
    if (arm !== present && arm !== absent) continue;
    const bucket = byArm.get(arm) ?? new Map<string, ReviewRow>();
    bucket.set(keyOf(row), row);
    byArm.set(arm, bucket);
  }

  const pairs: Pair[] = [];
  const withArm = byArm.get(present) ?? new Map<string, ReviewRow>();
  const withoutArm = byArm.get(absent) ?? new Map<string, ReviewRow>();
  for (const [key, a] of withArm) {
    const b = withoutArm.get(key);
    if (b) pairs.push({ instance: `${a.url}@${a.head_sha}`, present: a, absent: b });
  }

  return { key: spec.identifying, pairs, unplanned };
}
