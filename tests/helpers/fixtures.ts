import { readManifest, readReviews, type Finding, type ReviewRow } from "../../src/corpus.js";
import { intentFor, runFor } from "../../src/record.js";
import type { Conditions, RunIntent, RunRecord } from "../../src/runs.js";

export const rows: readonly ReviewRow[] = readReviews(readManifest("tests/fixtures/mini.json"));
export const graphRow = rows[0] as ReviewRow;
export const ablatedRow = rows[1] as ReviewRow;

/** Announced before the fixture rows were reviewed (10:00 and 10:01), recorded after. */
export const T0 = "2026-08-12T09:00:00+00:00";
export const T1 = "2026-08-12T11:00:00+00:00";

/** The fixture rows' conditions; the graph arm carries a digest, the ablated arm none. */
export const conditionsFor = (graph: boolean, graphDigest = "sha256:g1"): Conditions => ({
  features: [],
  review_fingerprint: "fp",
  finder_model: "m1",
  finder_provider: "v",
  skeptic_model: "s1",
  skeptic_provider: "v",
  temperature: null,
  slice: "graph",
  profile: "core",
  guardian_sha: "g",
  graph_digest: graph ? graphDigest : null,
});

/** A copy of a row whose findings all carry one verdict. */
export const withVerdict = (row: ReviewRow, verdict: Finding["verdict"]): ReviewRow => ({
  ...row,
  findings: row.findings.map((f) => ({ ...f, verdict })),
});

/** Announce and record one run of `row` as `runner`. */
export function recorded(
  runner: string,
  row: ReviewRow,
  opts: { graphDigest?: string; at?: string } = {},
): { intent: RunIntent; run: RunRecord } {
  const arm = row.arm as string;
  const intent = intentFor({
    runner,
    task: { url: row.url, head_sha: row.head_sha, project: row.project },
    arm,
    conditions: conditionsFor(arm === "graph", opts.graphDigest),
    announcedAt: T0,
  });
  return { intent, run: runFor(intent, row, opts.at ?? T1, intent.conditions.graph_digest) };
}
