import type { ReviewRow } from "../corpus.js";

export const UNCERTAIN_RATE = "uncertain_rate" as const;

/**
 * Share of ruled findings the skeptic could not rule.
 *
 * A null verdict means the skeptic did not rule, and ../hivemark/src/claims.ts
 * is explicit that "that absence must never be read as confirmation". The
 * symmetric rule applies here: it must not be read as an inability to rule
 * either, so it leaves both numerator and denominator.
 *
 * Null, not zero, when nothing was ruled. Zero would say "this review left
 * nothing unruled", which is a claim; null says the review supports no rate,
 * and the caller drops the pair and records the drop.
 */
export function uncertainRate(row: ReviewRow): number | null {
  const ruled = row.findings.filter(
    (f) => f.verdict === "confirmed" || f.verdict === "refuted" || f.verdict === "uncertain",
  );
  if (ruled.length === 0) return null;
  return ruled.filter((f) => f.verdict === "uncertain").length / ruled.length;
}
