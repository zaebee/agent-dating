import { dischargeProblems } from "./record.js";
import type { RunIntent, RunRecord } from "./runs.js";

export interface Audit {
  /** Announced and never run — the gap intents exist to make visible. */
  readonly unfulfilled: readonly RunIntent[];
  /** Run under an intent nobody announced. */
  readonly orphans: readonly RunRecord[];
  /** One announcement, several runs: announce once, run many, keep the best. */
  readonly overdischarged: readonly { readonly intent_id: string; readonly runs: readonly string[] }[];
  /** Run under conditions other than the announcement, or before it. */
  readonly mismatched: readonly { readonly run_id: string; readonly problems: readonly string[] }[];
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Compare what was announced with what was run.
 *
 * Collects rather than throws: an audit that stopped at the first problem would
 * hide every problem after it. Output is sorted so two readers produce the same
 * report. This has teeth only against a runner who announces at all — one who
 * never does breaks nothing here and simply does not appear.
 */
export function auditIntents(intents: readonly RunIntent[], runs: readonly RunRecord[]): Audit {
  const intentsById = new Map(intents.map((i) => [i.intent_id, i]));
  const runsByIntent = new Map<string, RunRecord[]>();
  for (const r of runs) {
    const list = runsByIntent.get(r.intent_id);
    if (list) list.push(r);
    else runsByIntent.set(r.intent_id, [r]);
  }

  return {
    unfulfilled: intents
      .filter((i) => !runsByIntent.has(i.intent_id))
      .sort((a, b) => byString(a.intent_id, b.intent_id)),
    orphans: runs.filter((r) => !intentsById.has(r.intent_id)).sort((a, b) => byString(a.run_id, b.run_id)),
    overdischarged: [...runsByIntent]
      .filter(([id, rs]) => intentsById.has(id) && rs.length > 1)
      .map(([intent_id, rs]) => ({ intent_id, runs: rs.map((r) => r.run_id).sort(byString) }))
      .sort((a, b) => byString(a.intent_id, b.intent_id)),
    mismatched: runs
      .flatMap((r) => {
        const intent = intentsById.get(r.intent_id);
        if (!intent) return [];
        const problems = dischargeProblems(intent, r);
        return problems.length > 0 ? [{ run_id: r.run_id, problems }] : [];
      })
      .sort((a, b) => byString(a.run_id, b.run_id)),
  };
}

export const isClean = (a: Audit): boolean =>
  a.unfulfilled.length === 0 && a.orphans.length === 0 && a.overdischarged.length === 0 && a.mismatched.length === 0;
