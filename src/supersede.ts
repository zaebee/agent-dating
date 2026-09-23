import { observationId } from "./canonical.js";
import type { D1, D1V2 } from "./records.js";

type AnyD1 = D1 | D1V2;

const instanceKey = (i: string | readonly [string, string]): string => (typeof i === "string" ? i : `${i[0]}|${i[1]}`);

/** Version 1 has no contributors; the empty string keeps it in groups of its own. */
const contributorsOf = (r: AnyD1): string => ("contributors" in r ? r.contributors.join(",") : "");

/**
 * Which stored observations a later one has superseded.
 *
 * Recomputed from the records rather than written as a flag, which is
 * ../hivemark/src/supersede.ts's design: "Signing only the newest would bake one
 * scoring policy into a permanent record and make re-scoring under another
 * impossible. Since the distinction is recomputable by any reader, nothing is
 * lost by publishing both and marking which is which."
 *
 * Supersession never crosses a contributor set. A joint citing an honest
 * supplier's runs plus fabricated ones is a later superset of that supplier's
 * observation; letting it supersede would suppress the honest record — the
 * mirror attack the explicit joint exists to prevent, readmitted here.
 */
export function supersededIds(records: readonly AnyD1[]): Set<string> {
  const out = new Set<string>();
  const group = (r: AnyD1): string =>
    [r.subject, r.axis, r.metric.name, r.judge.id, r.judge.goldens_version, r.schema_version, contributorsOf(r)].join("|");

  const groups = new Map<string, AnyD1[]>();
  for (const r of records) {
    const g = group(r);
    const members = groups.get(g);
    if (members) members.push(r);
    else groups.set(g, [r]);
  }

  const keysOf = (r: AnyD1): Set<string> =>
    new Set((r.pairing.instances as readonly (string | readonly [string, string])[]).map(instanceKey));

  for (const members of groups.values()) {
    for (const a of members) {
      const aSet = keysOf(a);
      const beaten = members.some((b) => {
        if (b === a) return false;
        if (Date.parse(b.observed_at) <= Date.parse(a.observed_at)) return false;
        const bSet = keysOf(b);
        if (bSet.size < aSet.size) return false;
        return [...aSet].every((i) => bSet.has(i));
      });
      if (beaten) out.add(observationId(a));
    }
  }
  return out;
}
