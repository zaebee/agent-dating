import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const FindingSchema = z.object({
  file: z.string(),
  line: z.number().int().nullable().optional(),
  severity: z.enum(["critical", "major", "minor"]),
  category: z.enum(["logic", "contract", "tests", "types", "ontology", "security"]),
  title: z.string(),
  evidence: z.string(),
  problem: z.string(),
  fix: z.string(),
  confidence: z.number().int(),
  verdict: z.enum(["confirmed", "refuted", "uncertain"]).nullable().optional(),
  skeptic_note: z.string().nullable().optional(),
  impact_score: z.number().int().nullable().optional(),
});

/**
 * `arm` is optional, and absence is a state rather than a missing value.
 *
 * 45 of the 115 rows carry no `arm` at all and none carries an empty string:
 * the field was added to the producer partway through, so its absence means
 * "nobody planned this run either way". It is left `undefined` and never
 * defaulted — `.default("")` would make an unplanned run indistinguishable from
 * a planned one written blank, which is the `?? ""` collapse
 * ../p-e/src/adapters/apex.ts documents, and the confound §5.2 step 3 exists to
 * prevent.
 *
 * The spec said this corpus carried three `arm` values including the empty
 * string. It does not; that reading came from joining `undefined` into a string.
 */
const ReviewSchema = z.object({
  url: z.string().min(1),
  project: z.string(),
  base_sha: z.string(),
  head_sha: z.string().min(1),
  guardian_sha: z.string(),
  reviewed_at: z.string().refine((s) => Number.isFinite(Date.parse(s))),
  finder_model: z.string().min(1),
  skeptic_model: z.string().nullable(),
  finder_provider: z.string(),
  skeptic_provider: z.string().nullable().optional(),
  had_graph: z.boolean(),
  arm: z.string().optional(),
  pr_slice: z.string(),
  review_fingerprint: z.string(),
  findings: z.array(FindingSchema).default([]),
});

/**
 * Unknown keys survive, and that is load-bearing.
 *
 * zod strips them by default, which would leave `pairReviews`'s classification
 * pass looking only at fields this schema already names — so an unclassified
 * field could never be seen, and invariant 2 would be decorative. The whole
 * point of classifying is to catch a field nobody here has thought about.
 */
const ReviewRowSchema = ReviewSchema.passthrough();

const JudgedSchema = z.object({
  url: z.string().min(1),
  project: z.string(),
  had_graph: z.boolean(),
  profile: z.string(),
  judge_model: z.string().min(1),
  tp: z.number(),
  fp: z.number(),
  fn: z.number(),
  precision: z.number(),
  recall: z.number(),
});

const ManifestSchema = z.object({
  base: z.string(),
  reviews: z.array(z.string()).min(1),
  judged: z.array(z.string()),
});

export type Finding = z.infer<typeof FindingSchema>;
export type ReviewRow = z.infer<typeof ReviewRowSchema>;
export type JudgedRow = z.infer<typeof JudgedSchema>;
export interface Manifest {
  readonly dir: string;
  readonly base: string;
  readonly reviews: readonly string[];
  readonly judged: readonly string[];
}

export function readManifest(path: string): Manifest {
  const m = ManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return { dir: dirname(path), ...m };
}

// Generic over the schema, not over its output type: `findings` carries a
// `.default([])`, so the schema's input and output types differ, and
// `z.ZodType<T>` collapses them into one.
function rows<S extends z.ZodTypeAny>(m: Manifest, files: readonly string[], schema: S): z.infer<S>[] {
  const out: z.infer<S>[] = [];
  for (const file of files) {
    const path = resolve(m.dir, m.base, file);
    const text = readFileSync(path, "utf8");
    text.split("\n").forEach((line, i) => {
      if (line.trim() === "") return;
      const parsed = schema.safeParse(JSON.parse(line));
      // Refused, never skipped. A skipped row is a silently smaller corpus, and
      // every number downstream is a fraction of something the reader cannot see.
      if (!parsed.success) throw new Error(`${file}:${i + 1} ${parsed.error.message}`);
      out.push(parsed.data);
    });
  }
  return out;
}

export const readReviews = (m: Manifest): ReviewRow[] => rows(m, m.reviews, ReviewRowSchema);
export const readJudged = (m: Manifest): JudgedRow[] => rows(m, m.judged, JudgedSchema);
