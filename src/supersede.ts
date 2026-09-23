import { observationId } from "./canonical.js";
import type { D1 } from "./records.js";

/**
 * Which stored observations a later one has superseded.
 *
 * Recomputed from the records rather than written as a flag, which is
 * ../hivemark/src/supersede.ts's design: "Signing only the newest would bake one
 * scoring policy into a permanent record and make re-scoring under another
 * impossible. Since the distinction is recomputable by any reader, nothing is
 * lost by publishing both and marking which is which."
 *
 * Here the policy is the gate-2 floor, which is revisable upward — so a raise
 * must re-evaluate retained records, and nothing may have been deleted for
 * being inadmissible under the old one.
 */
export function supersededIds(records: readonly D1[]): Set<string> {
  const out = new Set<string>();
  const group = (r: D1): string =>
    [r.subject, r.axis, r.metric.name, r.judge.id, r.judge.goldens_version, r.schema_version].join("|");

  const groups = new Map<string, D1[]>();
  for (const r of records) {
    const g = group(r);
    const members = groups.get(g);
    if (members) members.push(r);
    else groups.set(g, [r]);
  }

  for (const members of groups.values()) {
    for (const a of members) {
      const aSet = new Set(a.pairing.instances);
      const beaten = members.some((b) => {
        if (b === a) return false;
        if (Date.parse(b.observed_at) <= Date.parse(a.observed_at)) return false;
        const bSet = new Set(b.pairing.instances);
        if (bSet.size < aSet.size) return false;
        return [...aSet].every((i) => bSet.has(i));
      });
      if (beaten) out.add(observationId(a));
    }
  }
  return out;
}
