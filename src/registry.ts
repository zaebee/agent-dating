import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Per-axis declaration of what the rows of a pair are allowed to contain.
 *
 * Field classification is a checked-in decision, not an inference, because the
 * alternative failed inside the spec that introduced it: a pair keyed on less
 * than everything that varied published a number attributable to nothing.
 */
const AxisSchema = z.object({
  resource_field: z.string().min(1),
  resources: z.array(z.string().min(1)).min(2),
  identifying: z.array(z.string().min(1)).min(1),
  incidental: z.array(z.string()),
});

export interface AxisSpec {
  readonly axis: string;
  readonly resource_field: string;
  readonly resources: readonly string[];
  readonly identifying: readonly string[];
  readonly incidental: readonly string[];
}

export type FieldClass = "identifying" | "resource" | "incidental";

export function loadRegistry(path: string): Map<string, AxisSpec> {
  const raw = z.record(z.string(), AxisSchema).parse(JSON.parse(readFileSync(path, "utf8")));
  const out = new Map<string, AxisSpec>();
  for (const [axis, spec] of Object.entries(raw)) out.set(axis, { axis, ...spec });
  return out;
}

/**
 * Resolve an axis name exactly.
 *
 * Not lowercased and not trimmed. `../hivemark/src/genome.ts` refuses padded
 * model names rather than repairing them, because a repair lets a broken value
 * go on to do something else somewhere that does not repair it; an axis name is
 * an identifier for the same reason a model name is.
 */
export function requireAxis(reg: Map<string, AxisSpec>, axis: string): AxisSpec {
  const hit = reg.get(axis);
  if (hit) return hit;
  if (axis !== axis.trim()) {
    throw new Error(
      `axis ${JSON.stringify(axis)} has surrounding whitespace — it would be a second axis, ` +
        `distinct from ${JSON.stringify(axis.trim())} in every listing a human reads`,
    );
  }
  const near = [...reg.keys()].find((k) => k.toLowerCase() === axis.toLowerCase());
  if (near) {
    throw new Error(`axis ${JSON.stringify(axis)} is not in the axis registry — did you mean ${JSON.stringify(near)}?`);
  }
  throw new Error(`axis ${JSON.stringify(axis)} is not in the axis registry`);
}

export function requireResource(spec: AxisSpec, value: string): string {
  if (spec.resources.includes(value)) return value;
  throw new Error(
    `${JSON.stringify(value)} is not a resource value on axis ${spec.axis}; declared: ${spec.resources.join(", ")}`,
  );
}

/**
 * Classify one row field, or refuse.
 *
 * `corpus.json` in ../hivemark fails the load on a `.jsonl` listed in neither
 * `include` nor `exclude`, because silent omission is the direction that costs
 * a permanent record. This is that rule, transposed from files to fields.
 */
export function classify(spec: AxisSpec, field: string): FieldClass {
  if (spec.identifying.includes(field)) return "identifying";
  if (field === spec.resource_field) return "resource";
  if (spec.incidental.includes(field)) return "incidental";
  throw new Error(
    `unclassified field ${JSON.stringify(field)} on axis ${spec.axis}: add it to identifying or ` +
      `incidental in registry/axes.json. An unclassified field may be one that varied across a ` +
      `pair, which would make the observation confounded.`,
  );
}
