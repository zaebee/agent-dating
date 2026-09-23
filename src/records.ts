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
const required = (field: string) =>
  z
    .string({ required_error: `${field} is absent; it is required and has no default` })
    .refine((s) => s.trim().length > 0, {
      message: `${field} is present but empty, which is a different failure from absent`,
    });

/** ISO-8601 with an explicit offset, validated as ../hivemark/src/schema.ts validates reviewed_at. */
const timestamp = z
  .string()
  .refine((s) => /([+-]\d{2}:\d{2}|Z)$/.test(s), { message: "observed_at carries no UTC offset" })
  .refine((s) => Number.isFinite(Date.parse(s)), { message: "observed_at is not a parseable timestamp" });

const rounded = (field: string) =>
  z.number().refine((n) => n === round4(n), { message: `${field} is not rounded to 4 decimals` });

const EnvelopeShape = {
  schema_version: z.literal(RECORD_SCHEMA_VERSION),
  subject: z.string().min(1),
  axis: z.string().min(1),
  observed_at: timestamp,
  unestablished: required("unestablished"),
};

export const D1Schema = z
  .object({
    ...EnvelopeShape,
    kind: z.literal("D1"),
    self_asserted: z.literal(false),
    resource: z.object({ present: z.string().min(1), absent: z.string().min(1) }),
    pairing: z.object({
      key: z.array(z.string().min(1)).min(1),
      pairs: z.number().int().nonnegative(),
      informative_pairs: z.number().int().nonnegative(),
      instances: z.array(z.string().min(1)),
    }),
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
  })
  .superRefine((r, ctx) => {
    if (r.pairing.instances.length !== r.pairing.pairs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `pairs ${r.pairing.pairs} but ${r.pairing.instances.length} instances; no truncation is ` +
          `permitted, a reader must be able to recompute every pair`,
      });
    }
    if (r.pairing.informative_pairs > r.pairing.pairs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `informative_pairs ${r.pairing.informative_pairs} exceeds pairs ${r.pairing.pairs}`,
      });
    }
    if (r.metric.spread[0] > r.metric.spread[1]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "spread is not [min, max]" });
    }
    if (VERDICT_DERIVED_METRICS.has(r.metric.name) && r.judge.goldens_version !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${r.metric.name} is verdict-derived and has no reference set; goldens_version must be null`,
      });
    }
    if (r.admissible && r.inadmissible_because.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `admissible record carries ${r.inadmissible_because.length} reasons for inadmissibility`,
      });
    }
    if (!r.admissible && r.inadmissible_because.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "inadmissible record names no gate" });
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
export type D2 = z.infer<typeof D2Schema>;
export type D3 = z.infer<typeof D3Schema>;
export type Observation = D1 | D2 | D3;
