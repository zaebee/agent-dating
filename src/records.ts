import { z } from "zod";
import { round4 } from "./canonical.js";

/**
 * Integer, not semver. Bump when any record kind's field set changes.
 *
 * A minor component would assert that non-breaking changes to an evidential
 * record exist, and they do not: a reader ignoring a new field reads a
 * different claim than the writer made. `GENOME_SCHEMA_VERSION` in
 * ../hivemark/src/genome.ts is an integer for the same reason.
 */
export const RECORD_SCHEMA_VERSION = 1;

/** Metrics computed from verdicts, which have no reference set to version. */
export const VERDICT_DERIVED_METRICS = new Set(["uncertain_rate"]);

/** Mirrors the finding categories in ../hivemark/src/schema.ts. */
export const CATEGORIES = ["logic", "contract", "tests", "types", "ontology", "security"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Present, non-empty, and the two failures are distinguishable. */
export const required = (field: string) =>
  z
    .string({ required_error: `${field} is absent; it is required and has no default` })
    .refine((s) => s.trim().length > 0, {
      message: `${field} is present but empty, which is a different failure from absent`,
    });

/** ISO-8601 with an explicit offset, validated as ../hivemark/src/schema.ts validates reviewed_at. */
export const timestampOf = (field: string) =>
  z
    .string()
    .refine((s) => /([+-]\d{2}:\d{2}|Z)$/.test(s), { message: `${field} carries no UTC offset` })
    .refine((s) => Number.isFinite(Date.parse(s)), { message: `${field} is not a parseable timestamp` });

const rounded = (field: string) =>
  z.number().refine((n) => n === round4(n), { message: `${field} is not rounded to 4 decimals` });

const envelope = (version: 1 | 2) => ({
  schema_version: z.literal(version),
  subject: z.string().min(1),
  axis: z.string().min(1),
  observed_at: timestampOf("observed_at"),
  unestablished: required("unestablished"),
});

const EnvelopeShape = envelope(RECORD_SCHEMA_VERSION);

const d1Common = {
  kind: z.literal("D1"),
  self_asserted: z.literal(false),
  resource: z.object({ present: z.string().min(1), absent: z.string().min(1) }),
  metric: z.object({
    name: z.string().min(1),
    direction: z.enum(["higher-better", "lower-better"]),
    with: rounded("with"),
    without: rounded("without"),
    delta: rounded("delta"),
    spread: z.tuple([rounded("spread[0]"), rounded("spread[1]")]),
  }),
  judge: z.object({
    id: z.string().min(1),
    goldens_version: z.string().min(1).nullable(),
    self: z.boolean(),
  }),
  admissible: z.boolean(),
  inadmissible_because: z.array(z.string().min(1)),
};

const pairingCommon = {
  key: z.array(z.string().min(1)).min(1),
  pairs: z.number().int().nonnegative(),
  informative_pairs: z.number().int().nonnegative(),
};

interface D1Checkable {
  readonly pairing: { readonly pairs: number; readonly informative_pairs: number; readonly instances: readonly unknown[] };
  readonly metric: { readonly name: string; readonly spread: readonly [number, number] };
  readonly judge: { readonly goldens_version: string | null };
  readonly admissible: boolean;
  readonly inadmissible_because: readonly string[];
}

/** The checks both D1 versions share. */
function checkD1(r: D1Checkable, ctx: z.RefinementCtx): void {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (r.pairing.instances.length !== r.pairing.pairs) {
    issue(
      `pairs ${r.pairing.pairs} but ${r.pairing.instances.length} instances; no truncation is ` +
        `permitted, a reader must be able to recompute every pair`,
    );
  }
  if (r.pairing.informative_pairs > r.pairing.pairs) {
    issue(`informative_pairs ${r.pairing.informative_pairs} exceeds pairs ${r.pairing.pairs}`);
  }
  if (r.metric.spread[0] > r.metric.spread[1]) issue("spread is not [min, max]");
  if (VERDICT_DERIVED_METRICS.has(r.metric.name) && r.judge.goldens_version !== null) {
    issue(`${r.metric.name} is verdict-derived and has no reference set; goldens_version must be null`);
  }
  if (r.admissible && r.inadmissible_because.length > 0) {
    issue(`admissible record carries ${r.inadmissible_because.length} reasons for inadmissibility`);
  }
  if (!r.admissible && r.inadmissible_because.length === 0) issue("inadmissible record names no gate");
}

export const D1Schema = z
  .object({
    ...EnvelopeShape,
    ...d1Common,
    pairing: z.object({ ...pairingCommon, instances: z.array(z.string().min(1)) }),
  })
  .superRefine(checkD1);

const isSortedUnique = (xs: readonly string[]): boolean =>
  xs.every((x, i) => i === 0 || (xs[i - 1] as string) < x);

/**
 * Version 2: an instance is a pair of run ids, and every observation names the
 * runners it came from.
 *
 * Contributors are on every version-2 D1, not only joints, because supersession
 * groups by them — without that grouping a joint would supersede the honest
 * observation it cites, which is the mirror attack readmitted. The joint-only
 * fields sit in one block, so "all or none" holds by construction.
 */
export const D1V2Schema = z
  .object({
    ...envelope(2),
    ...d1Common,
    pairing: z.object({
      ...pairingCommon,
      instances: z.array(z.tuple([z.string().min(1), z.string().min(1)])),
    }),
    contributors: z.array(z.string().min(1)).min(1),
    joint: z
      .object({
        cites: z.array(z.string().min(1)).min(2),
        graph_agreement: z.enum(["identical", "divergent", "withheld-both"]),
        contested_tasks: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .superRefine((r, ctx) => {
    checkD1(r, ctx);
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (!isSortedUnique(r.contributors)) issue("contributors must be sorted and free of duplicates");
    const isJoint = r.contributors.length > 1;
    if (isJoint && !r.joint) {
      issue(`${r.contributors.length} contributors but no joint block; pooling runners is an explicit act and must say so`);
    }
    if (!isJoint && r.joint) issue("joint block on a single-contributor observation; a joint pools more than one runner");
    const keys = r.pairing.instances.map(([a, b]) => `${a}|${b}`);
    if (new Set(keys).size !== keys.length) issue("a run pair appears twice; a pair is counted once");
    if (r.joint && !isSortedUnique(r.joint.cites)) issue("joint.cites must be sorted and free of duplicates");
    if (r.joint && r.joint.contested_tasks > r.pairing.pairs) {
      issue(`contested_tasks ${r.joint.contested_tasks} exceeds pairs ${r.pairing.pairs}`);
    }
  });

export const D2Schema = z
  .object({
    ...EnvelopeShape,
    kind: z.literal("D2"),
    self_asserted: z.literal(false),
    category: z.enum(CATEGORIES),
    verdicts: z.object({
      undecidable: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      refs: z.array(z.string().min(1)),
    }),
    grounds: required("grounds"),
    resolvable_by: z.enum(["independent-party", "more-evidence", "unknown"]),
  })
  .superRefine((r, ctx) => {
    if (r.verdicts.undecidable > r.verdicts.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `undecidable ${r.verdicts.undecidable} exceeds total ${r.verdicts.total}`,
      });
    }
  });

export const D3Schema = z.object({
  ...EnvelopeShape,
  kind: z.literal("D3"),
  self_asserted: z.literal(true),
  want: required("want"),
});

export type D1 = z.infer<typeof D1Schema>;
export type D1V2 = z.infer<typeof D1V2Schema>;
export type D2 = z.infer<typeof D2Schema>;
export type D3 = z.infer<typeof D3Schema>;
export type Observation = D1 | D1V2 | D2 | D3;
