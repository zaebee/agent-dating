/**
 * A declared convention, not a derived threshold.
 *
 * No honest statistical floor is available: deriving one needs a distributional
 * assumption about per-pair differences that a corpus yielding two informative
 * pairs cannot support. Five is small enough that an early axis can clear it and
 * large enough that a handful of reruns is not a profile. Revisable upward by
 * the matching-engine spec and never downward.
 */
export const GATE2_FLOOR = 5;

export interface Verdict {
  readonly admissible: boolean;
  readonly because: readonly string[];
}

/**
 * Gate 1: the spread must not span zero — the resource helped and hurt the same
 * subject on the same axis, and the mean summarises a disagreement rather than
 * measuring anything. Touching zero at one end is not spanning it: a set of
 * same-signed differences and ties still has one direction.
 *
 * Gate 2: ties carry no directional evidence, so the count excludes them.
 *
 * No leave-one-out gate. Under gate 1 every informative pair shares a sign, so
 * dropping one leaves the sign intact whenever there are at least two — and the
 * floor is five, so such a test could never fire. A gate that rejects nothing is
 * worse than no gate, because a reader takes it for protection.
 */
export function admissibility(spread: readonly [number, number], informativePairs: number): Verdict {
  const because: string[] = [];
  const [lo, hi] = spread;
  if (lo < 0 && hi > 0) because.push(`spread [${lo}, ${hi}] spans zero: the resource both helped and hurt`);
  if (informativePairs < GATE2_FLOOR) because.push(`informative_pairs ${informativePairs} < ${GATE2_FLOOR}`);
  return { admissible: because.length === 0, because };
}
