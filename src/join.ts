import type { JudgedRow, ReviewRow } from "./corpus.js";

export interface Joined extends JudgedRow {
  readonly finder_model: string;
  readonly head_sha: string;
}

export interface Refusal {
  readonly url: string;
  readonly had_graph: boolean;
  readonly grounds: string;
  readonly candidates: readonly string[];
}

export interface JoinResult {
  readonly joined: readonly Joined[];
  readonly refusals: readonly Refusal[];
}

/**
 * Attach a finder to each judged row, or refuse.
 *
 * Judged rows carry neither `finder_model` nor `head_sha`, so the join runs
 * through `(url, had_graph)` — and that bucket is not always singular. Where it
 * is not, the row is refused rather than resolved by picking, which is the
 * discipline ../hivemark/src/genome.ts applies to a padded model name: a silent
 * repair lets the broken value go on to do something else somewhere that does
 * not repair it.
 *
 * Candidates are sorted so two readers of the same corpus produce byte-identical
 * refusals; an unsorted list would depend on file read order.
 */
export function joinJudged(judged: readonly JudgedRow[], reviews: readonly ReviewRow[]): JoinResult {
  const buckets = new Map<string, ReviewRow[]>();
  for (const r of reviews) {
    const k = `${r.url}|${r.had_graph}`;
    buckets.set(k, [...(buckets.get(k) ?? []), r]);
  }

  const joined: Joined[] = [];
  const refusals: Refusal[] = [];

  for (const j of judged) {
    const bucket = buckets.get(`${j.url}|${j.had_graph}`) ?? [];
    const finders = [...new Set(bucket.map((r) => r.finder_model))].sort();
    if (finders.length === 0) {
      refusals.push({
        url: j.url,
        had_graph: j.had_graph,
        grounds: "no review row matches this judged row",
        candidates: [],
      });
      continue;
    }
    if (finders.length > 1) {
      refusals.push({
        url: j.url,
        had_graph: j.had_graph,
        grounds: "judged row does not name the finder, and the bucket holds more than one",
        candidates: finders,
      });
      continue;
    }
    const shas = [...new Set(bucket.map((r) => r.head_sha))].sort();
    const sha = shas[0];
    if (shas.length > 1 || sha === undefined) {
      refusals.push({
        url: j.url,
        had_graph: j.had_graph,
        grounds: "judged row does not name the commit, and the bucket holds more than one",
        candidates: shas,
      });
      continue;
    }
    joined.push({ ...j, finder_model: finders[0] as string, head_sha: sha });
  }

  return { joined, refusals };
}
