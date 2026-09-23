import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted, array order kept. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * Four decimals, and never negative zero.
 *
 * Gate 1 and gate 2 both turn on these values, and a gate that depends on the
 * sixteenth bit of a float is not reproducible across readers. `-0` is
 * collapsed because a tie must have exactly one spelling: `informative_pairs`
 * counts differences that are non-zero after rounding, and `Object.is(-0, 0)`
 * is false.
 */
export function round4(n: number): number {
  const r = Math.round(n * 1e4) / 1e4;
  return r === 0 ? 0 : r;
}

export function observationId(record: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(record)).digest("hex")}`;
}
