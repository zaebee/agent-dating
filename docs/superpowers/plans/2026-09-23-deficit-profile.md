# Deficit Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given hivemark's review corpus, produce an append-only overlay of D1/D2/D3 deficit observations, each either admissible or carrying the reason it is not.

**Architecture:** A pure reader. Nothing here writes to `../hivemark` or `../ownima/codegraph-brain`. A checked-in axis registry declares, per axis, which row fields are identifying, which carries the resource, and which are incidental; every other field fails the load. Review rows are paired strictly, metrics are computed per review and differenced per pair, the sign is normalised once in derivation, and two gates decide admissibility. Records are immutable — later runs emit new observations, and supersession is recomputed by readers.

**Tech Stack:** TypeScript 5.9 (strict, `noUncheckedIndexedAccess`), bun 1.3, vitest 3.2, zod 3.25. ESM throughout with `.js` specifiers. Matches `../hivemark` exactly, because this repository reads its types.

**Spec:** `docs/superpowers/specs/2026-09-23-deficit-profile-design.md`

## Global Constraints

- **Scope is §4 and §5 of the spec only.** Ranking (§7) is the matching-engine spec and no task here implements a queue, a score, or an ordering.
- **Refuse, never repair.** Every validation failure throws with the offending value in the message. No silent defaults, no trimming, no coercion.
- **Absent ≠ empty.** A missing field and an empty string are different failures with different messages.
- **Identity is never recomputed here.** `subject` comes from `hivemark`'s `genomeOf` + `identityId`. A local reimplementation that drifted would split one reviewer into two subjects.
- **Floats are rounded to 4 decimals before storage and compared only after rounding** (spec invariant 4).
- **Gate-2 floor is 5 informative pairs** (spec §5.5). It is a declared convention, revisable upward only.
- **Verdict-derived metrics:** `uncertain_rate` is the only one. Its `judge.goldens_version` must be `null`; a non-null value is refused.
- **Finding categories:** `logic`, `contract`, `tests`, `types`, `ontology`, `security` — mirroring `../hivemark/src/schema.ts`.
- **Corpus base:** `../ownima/codegraph-brain/benchmarks`, reached through a manifest, never hardcoded in a module.

---

## File Structure

| File | Responsibility |
|---|---|
| `registry/axes.json` | The axis registry: per axis, resource field and values, field classification |
| `src/registry.ts` | Load the registry; normalise a key; classify a field |
| `src/canonical.ts` | `canonicalJson`, `round4`, `observationId` |
| `src/records.ts` | Envelope / D1 / D2 / D3 types and zod schemas with the eight invariants |
| `src/corpus.ts` | Manifest-driven reader for review rows and judged rows |
| `src/subject.ts` | Review row → hivemark `identity_id` |
| `src/pair.ts` | Strict pairing of review rows; field-classification enforcement |
| `src/join.ts` | Judged rows → review rows; ambiguity refusal |
| `src/metrics/uncertain-rate.ts` | The one verdict-derived metric |
| `src/derive-d1.ts` | Steps 1–5 of spec §5.2, including sign normalisation |
| `src/admissibility.ts` | Gates 1 and 2 |
| `src/derive-d2.ts` | Per-category D2s and refusal D2s |
| `src/supersede.ts` | Recompute supersession from stored records |
| `src/overlay.ts` | Append-only JSONL store |
| `src/cli.ts` | `bun src/cli.ts <manifest> --out <overlay.jsonl>` |

---

### Task 1: Scaffolding and the axis registry

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `registry/axes.json`, `src/registry.ts`
- Test: `tests/registry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AxisSpec`, `loadRegistry(path: string): Map<string, AxisSpec>`, `requireAxis(reg: Map<string, AxisSpec>, axis: string): AxisSpec`, `requireResource(spec: AxisSpec, value: string): string`, `classify(spec: AxisSpec, field: string): FieldClass`, `type FieldClass = "identifying" | "resource" | "incidental"`.

- [ ] **Step 1: Create the project files**

`package.json`:
```json
{
  "name": "agent-dating",
  "version": "0.1.0",
  "description": "Deficit profiles for code-review agents, derived from hivemark's corpus.",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "derive": "bun src/cli.ts"
  },
  "license": "MIT",
  "dependencies": {
    "hivemark": "file:../hivemark",
    "zod": "3.25.76"
  },
  "devDependencies": {
    "@types/node": "22.20.1",
    "typescript": "5.9.3",
    "vitest": "3.2.7"
  },
  "packageManager": "bun@1.3.14"
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src", "tests", "registry"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
```

`.gitignore`:
```
node_modules
*.jsonl
```

Then run `bun install`.

- [ ] **Step 2: Write the registry file**

`registry/axes.json`. `identifying` are fields that must be equal across a pair and must appear in `pairing.key`; `resource_field` must differ; `incidental` may differ and is ignored. Any other field in a row fails the load (spec invariant 2).

```json
{
  "context.graph": {
    "resource_field": "arm",
    "resources": ["graph", "ablated"],
    "identifying": [
      "url",
      "head_sha",
      "finder_model",
      "skeptic_model",
      "finder_provider",
      "skeptic_provider",
      "project",
      "review_fingerprint"
    ],
    "incidental": [
      "base_sha",
      "guardian_sha",
      "reviewed_at",
      "pr_slice",
      "had_graph",
      "parse_failed",
      "prompt_tokens",
      "completion_tokens",
      "duration_s",
      "error",
      "review_fingerprint_source",
      "findings"
    ]
  }
}
```

- [ ] **Step 3: Write the failing test**

`tests/registry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { classify, loadRegistry, requireAxis, requireResource } from "../src/registry.js";

const reg = loadRegistry("registry/axes.json");

describe("loadRegistry", () => {
  it("loads the declared axes", () => {
    expect([...reg.keys()]).toContain("context.graph");
  });
});

describe("requireAxis", () => {
  it("returns the spec for a registered axis", () => {
    expect(requireAxis(reg, "context.graph").resource_field).toBe("arm");
  });

  it("refuses an unregistered axis", () => {
    expect(() => requireAxis(reg, "context.memory")).toThrow(/not in the axis registry/);
  });

  it("refuses a case variant and names the registered spelling", () => {
    expect(() => requireAxis(reg, "Context.Graph")).toThrow(/did you mean "context\.graph"/);
  });

  it("refuses surrounding whitespace rather than trimming it", () => {
    expect(() => requireAxis(reg, "context.graph ")).toThrow(/surrounding whitespace/);
  });
});

describe("requireResource", () => {
  const spec = requireAxis(reg, "context.graph");

  it("accepts a declared resource value", () => {
    expect(requireResource(spec, "ablated")).toBe("ablated");
  });

  it("refuses an undeclared one", () => {
    expect(() => requireResource(spec, "")).toThrow(/not a resource value/);
  });
});

describe("classify", () => {
  const spec = requireAxis(reg, "context.graph");

  it("classifies the three declared kinds", () => {
    expect(classify(spec, "head_sha")).toBe("identifying");
    expect(classify(spec, "arm")).toBe("resource");
    expect(classify(spec, "duration_s")).toBe("incidental");
  });

  it("throws on an unclassified field rather than guessing", () => {
    expect(() => classify(spec, "temperature")).toThrow(/unclassified field "temperature"/);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun run test tests/registry.test.ts`
Expected: FAIL — `Cannot find module '../src/registry.js'`

- [ ] **Step 5: Implement the registry**

`src/registry.ts`:
```ts
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
  if (near) throw new Error(`axis ${JSON.stringify(axis)} is not in the axis registry — did you mean ${JSON.stringify(near)}?`);
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun run test tests/registry.test.ts && bun run typecheck`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore bun.lock registry/axes.json src/registry.ts tests/registry.test.ts
git commit -m "feat: axis registry with mechanical field classification"
```

---

### Task 2: Canonical helpers and record schemas

**Files:**
- Create: `src/canonical.ts`, `src/records.ts`
- Test: `tests/canonical.test.ts`, `tests/records.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `canonicalJson(v: unknown): string`, `round4(n: number): number`, `observationId(rec: unknown): string`; types `Envelope`, `D1`, `D2`, `D3`, `Observation = D1 | D2 | D3`; schemas `D1Schema`, `D2Schema`, `D3Schema`; constants `RECORD_SCHEMA_VERSION`, `VERDICT_DERIVED_METRICS`, `CATEGORIES`.

- [ ] **Step 1: Write the failing test for canonical helpers**

`tests/canonical.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { canonicalJson, observationId, round4 } from "../src/canonical.js";

describe("canonicalJson", () => {
  it("orders keys so the same record hashes the same", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("orders nested keys too", () => {
    expect(canonicalJson({ x: { b: 1, a: 2 } })).toBe('{"x":{"a":2,"b":1}}');
  });

  it("preserves array order, which is meaningful", () => {
    expect(canonicalJson([2, 1])).toBe("[2,1]");
  });
});

describe("round4", () => {
  it("rounds to four decimals", () => {
    expect(round4(0.25925925)).toBe(0.2593);
  });

  it("collapses float noise to zero", () => {
    expect(round4(1e-5)).toBe(0);
  });

  it("returns negative zero as zero so a tie has one spelling", () => {
    expect(Object.is(round4(-1e-9), 0)).toBe(true);
  });
});

describe("observationId", () => {
  it("is stable across key order", () => {
    expect(observationId({ b: 1, a: 2 })).toBe(observationId({ a: 2, b: 1 }));
  });

  it("differs when a value differs", () => {
    expect(observationId({ a: 1 })).not.toBe(observationId({ a: 2 }));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/canonical.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the canonical helpers**

`src/canonical.ts`:
```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test tests/canonical.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing test for record schemas**

`tests/records.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { D1Schema, D2Schema, D3Schema, RECORD_SCHEMA_VERSION } from "../src/records.js";

const envelope = {
  schema_version: RECORD_SCHEMA_VERSION,
  subject: "0xabc",
  axis: "context.graph",
  self_asserted: false,
  observed_at: "2026-09-23T10:00:00+00:00",
  unestablished: "the ablated arm covers one finder model only",
};

const d1 = {
  ...envelope,
  kind: "D1" as const,
  resource: { present: "graph", absent: "ablated" },
  pairing: { key: ["url", "head_sha", "finder_model"], pairs: 2, informative_pairs: 1, instances: ["u@a", "u@b"] },
  metric: {
    name: "uncertain_rate",
    direction: "lower-better" as const,
    with: 0.0763,
    without: 0.1746,
    delta: 0.2593,
    spread: [0, 1] as [number, number],
  },
  judge: { id: "gemini-2.5-flash", goldens_version: null, self: false },
  admissible: false,
  inadmissible_because: ["informative_pairs 1 < 5"],
};

describe("D1Schema", () => {
  it("accepts a well-formed record", () => {
    expect(D1Schema.parse(d1).kind).toBe("D1");
  });

  it("refuses an absent unestablished", () => {
    const { unestablished: _drop, ...rest } = d1;
    expect(D1Schema.safeParse(rest).success).toBe(false);
  });

  it("refuses an empty unestablished, which is not the same failure", () => {
    const r = D1Schema.safeParse({ ...d1, unestablished: "  " });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).toMatch(/empty/);
  });

  it("refuses a timestamp with no offset", () => {
    expect(D1Schema.safeParse({ ...d1, observed_at: "2026-09-23T10:00:00" }).success).toBe(false);
  });

  it("refuses an unparseable timestamp", () => {
    expect(D1Schema.safeParse({ ...d1, observed_at: "soon" }).success).toBe(false);
  });

  it("refuses instances that disagree with pairs", () => {
    const r = D1Schema.safeParse({ ...d1, pairing: { ...d1.pairing, instances: ["u@a"] } });
    expect(JSON.stringify(r)).toMatch(/pairs 2 but 1 instance/);
  });

  it("refuses informative_pairs above pairs", () => {
    const r = D1Schema.safeParse({ ...d1, pairing: { ...d1.pairing, informative_pairs: 3 } });
    expect(JSON.stringify(r)).toMatch(/informative_pairs 3 exceeds pairs 2/);
  });

  it("refuses an unrounded float", () => {
    const r = D1Schema.safeParse({ ...d1, metric: { ...d1.metric, delta: 0.25925 } });
    expect(JSON.stringify(r)).toMatch(/not rounded to 4 decimals/);
  });

  it("refuses goldens_version on a verdict-derived metric", () => {
    const r = D1Schema.safeParse({ ...d1, judge: { ...d1.judge, goldens_version: "v3" } });
    expect(JSON.stringify(r)).toMatch(/verdict-derived/);
  });

  it("refuses self_asserted true", () => {
    expect(D1Schema.safeParse({ ...d1, self_asserted: true }).success).toBe(false);
  });

  it("refuses a non-empty reason on an admissible record", () => {
    const r = D1Schema.safeParse({ ...d1, admissible: true });
    expect(JSON.stringify(r)).toMatch(/admissible record carries/);
  });
});

describe("D2Schema", () => {
  const d2 = {
    ...envelope,
    kind: "D2" as const,
    category: "logic",
    verdicts: { undecidable: 49, total: 672, refs: ["u@a"] },
    grounds: "the definition was not in the provided diff hunks",
    resolvable_by: "more-evidence" as const,
  };

  it("accepts a well-formed record", () => {
    expect(D2Schema.parse(d2).resolvable_by).toBe("more-evidence");
  });

  it("accepts total 0, which means the category never came up", () => {
    expect(D2Schema.parse({ ...d2, verdicts: { undecidable: 0, total: 0, refs: [] }, grounds: "category not observed" }).verdicts.total).toBe(0);
  });

  it("refuses undecidable above total", () => {
    expect(D2Schema.safeParse({ ...d2, verdicts: { undecidable: 700, total: 672, refs: [] } }).success).toBe(false);
  });

  it("refuses empty grounds", () => {
    expect(D2Schema.safeParse({ ...d2, grounds: " " }).success).toBe(false);
  });

  it("refuses an undefined category", () => {
    expect(D2Schema.safeParse({ ...d2, category: "style" }).success).toBe(false);
  });
});

describe("D3Schema", () => {
  it("requires self_asserted true", () => {
    const d3 = { ...envelope, kind: "D3" as const, self_asserted: true, want: "an adversarial skeptic" };
    expect(D3Schema.parse(d3).want).toBe("an adversarial skeptic");
    expect(D3Schema.safeParse({ ...d3, self_asserted: false }).success).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `bun run test tests/records.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the record schemas**

`src/records.ts`:
```ts
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
    .refine((s) => s.trim().length > 0, { message: `${field} is present but empty, which is a different failure from absent` });

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
        message: `pairs ${r.pairing.pairs} but ${r.pairing.instances.length} instances; no truncation is permitted, a reader must be able to recompute every pair`,
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
```

- [ ] **Step 8: Run it to verify it passes**

Run: `bun run test && bun run typecheck`
Expected: PASS, all tests.

- [ ] **Step 9: Commit**

```bash
git add src/canonical.ts src/records.ts tests/canonical.test.ts tests/records.test.ts
git commit -m "feat: record schemas enforcing the eight invariants"
```

---

### Task 3: Corpus reader

**Files:**
- Create: `src/corpus.ts`, `corpus.json`
- Test: `tests/corpus.test.ts`, `tests/fixtures/mini/reviews.jsonl`, `tests/fixtures/mini/judged.jsonl`, `tests/fixtures/mini.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `readManifest(path: string): Manifest`, `readReviews(m: Manifest): ReviewRow[]`, `readJudged(m: Manifest): JudgedRow[]`; types `ReviewRow`, `JudgedRow`, `Finding`, `Manifest`.

- [ ] **Step 1: Write the manifest**

`corpus.json`:
```json
{
  "base": "../ownima/codegraph-brain/benchmarks",
  "reviews": [
    "martian-reviews.jsonl",
    "martian-repeat-reviews.jsonl",
    "martian-p3-run1.jsonl",
    "martian-p3-run2.jsonl",
    "martian-p3-run3.jsonl"
  ],
  "judged": [
    "martian-judged.jsonl",
    "martian-repeat-judged.jsonl",
    "martian-p3-judged-run1.jsonl"
  ]
}
```

- [ ] **Step 2: Write the fixtures**

`tests/fixtures/mini.json`:
```json
{ "base": "mini", "reviews": ["reviews.jsonl"], "judged": ["judged.jsonl"] }
```

`tests/fixtures/mini/reviews.jsonl` (one line per record, shown wrapped):
```jsonl
{"url":"https://x/pull/1","project":"p","base_sha":"a","head_sha":"h1","guardian_sha":"g","reviewed_at":"2026-08-12T10:00:00+00:00","finder_model":"m1","skeptic_model":"s1","finder_provider":"v","skeptic_provider":"v","had_graph":true,"arm":"graph","pr_slice":"graph","review_fingerprint":"fp","parse_failed":false,"findings":[{"file":"f","severity":"major","category":"logic","title":"t","evidence":"e","problem":"p","fix":"x","confidence":80,"verdict":"confirmed"}]}
{"url":"https://x/pull/1","project":"p","base_sha":"a","head_sha":"h1","guardian_sha":"g","reviewed_at":"2026-08-12T10:01:00+00:00","finder_model":"m1","skeptic_model":"s1","finder_provider":"v","skeptic_provider":"v","had_graph":false,"arm":"ablated","pr_slice":"graph","review_fingerprint":"fp","parse_failed":false,"findings":[{"file":"f","severity":"major","category":"logic","title":"t","evidence":"e","problem":"p","fix":"x","confidence":80,"verdict":"uncertain","skeptic_note":"not in the provided diff hunks"}]}
```

`tests/fixtures/mini/judged.jsonl`:
```jsonl
{"url":"https://x/pull/1","project":"p","pr_slice":"graph","had_graph":true,"profile":"core","judge_model":"j1","n_goldens":3,"n_candidates":1,"tp":1,"fp":0,"fn":2,"precision":1.0,"recall":0.3333333333333333,"judge_failures":0,"decisions":[1,0,0],"judged_at":"2026-08-12T12:27:18+00:00"}
```

- [ ] **Step 3: Write the failing test**

`tests/corpus.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readJudged, readManifest, readReviews } from "../src/corpus.js";

const m = readManifest("tests/fixtures/mini.json");

describe("readReviews", () => {
  it("reads every listed file", () => {
    expect(readReviews(m)).toHaveLength(2);
  });

  it("keeps arm as written, including the empty string", () => {
    expect(readReviews(m).map((r) => r.arm)).toEqual(["graph", "ablated"]);
  });

  it("refuses a row without a url rather than skipping it", () => {
    expect(() => readReviews({ ...m, reviews: ["../malformed.jsonl"] })).toThrow();
  });
});

describe("readJudged", () => {
  it("reads the judged rows", () => {
    const j = readJudged(m);
    expect(j).toHaveLength(1);
    expect(j[0]?.recall).toBeCloseTo(0.3333, 4);
  });
});

describe("readManifest", () => {
  it("refuses a manifest naming no review files", () => {
    expect(() => readManifest("tests/fixtures/mini/reviews.jsonl")).toThrow();
  });
});
```

Also create `tests/fixtures/malformed.jsonl` with one line: `{"project":"p"}`

- [ ] **Step 4: Run it to verify it fails**

Run: `bun run test tests/corpus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the reader**

`src/corpus.ts`:
```ts
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
 * `arm` is required and may be the empty string.
 *
 * The empty string is a real value in this corpus and means "nobody planned
 * this run either way". Defaulting it would turn an unplanned run into a
 * controlled one, which is the confound §5.2 step 3 exists to prevent.
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
  arm: z.string(),
  pr_slice: z.string(),
  review_fingerprint: z.string(),
  findings: z.array(FindingSchema).default([]),
});

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
export type ReviewRow = z.infer<typeof ReviewSchema>;
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

function rows<T>(m: Manifest, files: readonly string[], schema: z.ZodType<T>): T[] {
  const out: T[] = [];
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

export const readReviews = (m: Manifest): ReviewRow[] => rows(m, m.reviews, ReviewSchema);
export const readJudged = (m: Manifest): JudgedRow[] => rows(m, m.judged, JudgedSchema);
```

- [ ] **Step 6: Run it to verify it passes**

Run: `bun run test tests/corpus.test.ts && bun run typecheck`
Expected: PASS, 5 tests.

- [ ] **Step 7: Verify against the real corpus**

Run: `bun -e 'import {readManifest,readReviews,readJudged} from "./src/corpus.js"; const m=readManifest("corpus.json"); console.log(readReviews(m).length, readJudged(m).length)'`
Expected: `115 117`

- [ ] **Step 8: Commit**

```bash
git add corpus.json src/corpus.ts tests/corpus.test.ts tests/fixtures
git commit -m "feat: manifest-driven corpus reader that refuses malformed rows"
```

---

### Task 4: Subject resolution

**Files:**
- Create: `src/subject.ts`
- Test: `tests/subject.test.ts`

**Interfaces:**
- Consumes: `ReviewRow` from Task 3.
- Produces: `subjectOf(row: ReviewRow): string`.

- [ ] **Step 1: Write the failing test**

`tests/subject.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readManifest, readReviews } from "../src/corpus.js";
import { subjectOf } from "../src/subject.js";

const rows = readReviews(readManifest("tests/fixtures/mini.json"));

describe("subjectOf", () => {
  it("returns a 0x-prefixed identity hash", () => {
    expect(subjectOf(rows[0]!)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("gives the two arms different subjects, because context_mode is genomic", () => {
    expect(subjectOf(rows[0]!)).not.toBe(subjectOf(rows[1]!));
  });

  it("is stable for the same row", () => {
    expect(subjectOf(rows[0]!)).toBe(subjectOf(rows[0]!));
  });
});
```

> The second test encodes a fact worth knowing before writing derivation code:
> `context_mode` is part of hivemark's genome, so the two arms of a pair are
> **different identities**. `subject` on a D1 is therefore the identity of the
> `present` arm — the configuration whose deficit is being described — and Task
> 7 sets it that way.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/subject.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement subject resolution**

`src/subject.ts`:
```ts
import { genomeOf } from "hivemark/src/genome.js";
import { identityId } from "hivemark/src/identity.js";
import type { ReviewRow } from "./corpus.js";

/**
 * The hivemark identity a review row belongs to.
 *
 * Imported, never reimplemented. `genomeOf` refuses padded model names because
 * a trailing space mints a second identity "permanently once a birth is
 * announced"; a copy of that logic here would drift, and a drifted copy splits
 * one reviewer into two subjects with no way to notice. The cost of the import
 * is a `file:` dependency on a sibling repository, which is cheaper than the
 * failure it prevents.
 */
export function subjectOf(row: ReviewRow): string {
  // hivemark's ReviewRecord is structurally what corpus.ts already validated.
  return identityId(genomeOf(row as never));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test tests/subject.test.ts && bun run typecheck`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/subject.ts tests/subject.test.ts
git commit -m "feat: resolve subject via hivemark rather than reimplementing genome"
```

---

### Task 5: Strict pairing with field-classification enforcement

**Files:**
- Create: `src/pair.ts`
- Test: `tests/pair.test.ts`

**Interfaces:**
- Consumes: `AxisSpec`, `classify` (Task 1); `ReviewRow` (Task 3).
- Produces: `pairReviews(rows: readonly ReviewRow[], spec: AxisSpec): PairSet`; types `Pair`, `PairSet`.

- [ ] **Step 1: Write the failing test**

`tests/pair.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ReviewRow } from "../src/corpus.js";
import { readManifest, readReviews } from "../src/corpus.js";
import { pairReviews } from "../src/pair.js";
import { loadRegistry, requireAxis } from "../src/registry.js";

const spec = requireAxis(loadRegistry("registry/axes.json"), "context.graph");
const rows = readReviews(readManifest("tests/fixtures/mini.json"));

describe("pairReviews", () => {
  it("pairs the two arms of one review", () => {
    const set = pairReviews(rows, spec);
    expect(set.pairs).toHaveLength(1);
    expect(set.pairs[0]?.present.arm).toBe("graph");
    expect(set.pairs[0]?.absent.arm).toBe("ablated");
  });

  it("reports the key it held equal", () => {
    expect(pairReviews(rows, spec).key).toEqual(spec.identifying);
  });

  it("drops a row whose arm is the empty string", () => {
    const unplanned: ReviewRow = { ...rows[0]!, arm: "", head_sha: "h2" };
    const set = pairReviews([...rows, unplanned], spec);
    expect(set.pairs).toHaveLength(1);
    expect(set.unplanned).toBe(1);
  });

  it("refuses a row carrying a field the registry does not classify", () => {
    const odd = { ...rows[0]!, temperature: 1.2 } as ReviewRow;
    expect(() => pairReviews([odd], spec)).toThrow(/unclassified field "temperature"/);
  });

  it("makes no pair when only one arm exists", () => {
    expect(pairReviews([rows[0]!], spec).pairs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/pair.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement pairing**

`src/pair.ts`:
```ts
import type { ReviewRow } from "./corpus.js";
import { classify, type AxisSpec } from "./registry.js";

export interface Pair {
  readonly instance: string;
  readonly present: ReviewRow;
  readonly absent: ReviewRow;
}

export interface PairSet {
  readonly key: readonly string[];
  readonly pairs: readonly Pair[];
  /** Rows whose arm was the empty string, counted rather than silently dropped. */
  readonly unplanned: number;
}

/**
 * Pair the two arms of one axis, holding every identifying field equal.
 *
 * The classification pass runs over every field of every row before any pairing
 * happens. That ordering is the point: an unclassified field may be one that
 * varied across a pair, and discovering it after the pairs are built means the
 * confound is already inside the numbers.
 */
export function pairReviews(rows: readonly ReviewRow[], spec: AxisSpec): PairSet {
  for (const row of rows) for (const field of Object.keys(row)) classify(spec, field);

  const present = spec.resources[0];
  const absent = spec.resources[1];
  if (present === undefined || absent === undefined) throw new Error(`axis ${spec.axis} declares fewer than two resource values`);

  const keyOf = (row: ReviewRow): string =>
    spec.identifying.map((f) => JSON.stringify((row as Record<string, unknown>)[f])).join("|");

  const byArm = new Map<string, Map<string, ReviewRow>>();
  let unplanned = 0;
  for (const row of rows) {
    const arm = (row as Record<string, unknown>)[spec.resource_field];
    if (arm === "") {
      unplanned += 1;
      continue;
    }
    if (arm !== present && arm !== absent) continue;
    const bucket = byArm.get(arm) ?? new Map<string, ReviewRow>();
    bucket.set(keyOf(row), row);
    byArm.set(arm, bucket);
  }

  const pairs: Pair[] = [];
  const withArm = byArm.get(present) ?? new Map();
  const withoutArm = byArm.get(absent) ?? new Map();
  for (const [key, a] of withArm) {
    const b = withoutArm.get(key);
    if (b) pairs.push({ instance: `${a.url}@${a.head_sha}`, present: a, absent: b });
  }

  return { key: spec.identifying, pairs, unplanned };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test tests/pair.test.ts && bun run typecheck`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify against the real corpus**

Run:
```bash
bun -e 'import {readManifest,readReviews} from "./src/corpus.js"; import {pairReviews} from "./src/pair.js"; import {loadRegistry,requireAxis} from "./src/registry.js"; const s=requireAxis(loadRegistry("registry/axes.json"),"context.graph"); const p=pairReviews(readReviews(readManifest("corpus.json")),s); console.log(p.pairs.length, p.unplanned)'
```
Expected: `6` pairs. If the classification pass throws on a real field, add it to `incidental` in `registry/axes.json` and commit that with this task — the throw is the registry doing its job.

- [ ] **Step 6: Commit**

```bash
git add src/pair.ts tests/pair.test.ts registry/axes.json
git commit -m "feat: strict pairing that refuses unclassified fields"
```

---

### Task 6: Judged join and its refusal

**Files:**
- Create: `src/join.ts`
- Test: `tests/join.test.ts`

**Interfaces:**
- Consumes: `ReviewRow`, `JudgedRow` (Task 3).
- Produces: `joinJudged(judged: readonly JudgedRow[], reviews: readonly ReviewRow[]): JoinResult`; types `Joined`, `Refusal`, `JoinResult`.

- [ ] **Step 1: Write the failing test**

`tests/join.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ReviewRow } from "../src/corpus.js";
import { readJudged, readManifest, readReviews } from "../src/corpus.js";
import { joinJudged } from "../src/join.js";

const m = readManifest("tests/fixtures/mini.json");
const reviews = readReviews(m);
const judged = readJudged(m);

describe("joinJudged", () => {
  it("joins a judged row to the single finder that produced it", () => {
    const r = joinJudged(judged, reviews);
    expect(r.joined).toHaveLength(1);
    expect(r.joined[0]?.finder_model).toBe("m1");
    expect(r.refusals).toHaveLength(0);
  });

  it("refuses rather than picking when two finders share a bucket", () => {
    const second: ReviewRow = { ...reviews[0]!, finder_model: "m2" };
    const r = joinJudged(judged, [...reviews, second]);
    expect(r.joined).toHaveLength(0);
    expect(r.refusals).toHaveLength(1);
    expect(r.refusals[0]?.grounds).toMatch(/does not name the finder/);
    expect(r.refusals[0]?.candidates).toEqual(["m1", "m2"]);
  });

  it("is deterministic: the same input yields identical refusals", () => {
    const second: ReviewRow = { ...reviews[0]!, finder_model: "m2" };
    const a = joinJudged(judged, [...reviews, second]);
    const b = joinJudged(judged, [...reviews, second]);
    expect(JSON.stringify(a.refusals)).toBe(JSON.stringify(b.refusals));
  });

  it("refuses a judged row with no matching review", () => {
    const orphan = { ...judged[0]!, url: "https://x/pull/999" };
    const r = joinJudged([orphan], reviews);
    expect(r.refusals[0]?.grounds).toMatch(/no review row/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/join.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the join**

`src/join.ts`:
```ts
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
      refusals.push({ url: j.url, had_graph: j.had_graph, grounds: "no review row matches this judged row", candidates: [] });
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test tests/join.test.ts && bun run typecheck`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify against the real corpus**

Run:
```bash
bun -e 'import {readManifest,readReviews,readJudged} from "./src/corpus.js"; import {joinJudged} from "./src/join.js"; const m=readManifest("corpus.json"); const r=joinJudged(readJudged(m),readReviews(m)); console.log("joined",r.joined.length,"refused",r.refusals.length)'
```
Expected: `joined 71 refused 46`

- [ ] **Step 6: Commit**

```bash
git add src/join.ts tests/join.test.ts
git commit -m "feat: judged join that refuses ambiguity deterministically"
```

---

### Task 7: The uncertain_rate metric

**Files:**
- Create: `src/metrics/uncertain-rate.ts`
- Test: `tests/uncertain-rate.test.ts`

**Interfaces:**
- Consumes: `ReviewRow`, `Finding` (Task 3).
- Produces: `UNCERTAIN_RATE: "uncertain_rate"`, `uncertainRate(row: ReviewRow): number | null`.

- [ ] **Step 1: Write the failing test**

`tests/uncertain-rate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Finding, ReviewRow } from "../src/corpus.js";
import { readManifest, readReviews } from "../src/corpus.js";
import { uncertainRate } from "../src/metrics/uncertain-rate.js";

const base = readReviews(readManifest("tests/fixtures/mini.json"))[0]!;
const f = (verdict: Finding["verdict"]): Finding => ({
  file: "f",
  severity: "major",
  category: "logic",
  title: "t",
  evidence: "e",
  problem: "p",
  fix: "x",
  confidence: 80,
  verdict,
});
const row = (findings: Finding[]): ReviewRow => ({ ...base, findings });

describe("uncertainRate", () => {
  it("is uncertain over ruled findings", () => {
    expect(uncertainRate(row([f("uncertain"), f("confirmed"), f("refuted"), f("confirmed")]))).toBe(0.25);
  });

  it("excludes null verdicts from both numerator and denominator", () => {
    expect(uncertainRate(row([f("uncertain"), f("confirmed"), f(null)]))).toBe(0.5);
  });

  it("returns null when nothing was ruled, rather than zero", () => {
    expect(uncertainRate(row([f(null)]))).toBeNull();
  });

  it("returns null for a review with no findings", () => {
    expect(uncertainRate(row([]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/uncertain-rate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the metric**

`src/metrics/uncertain-rate.ts`:
```ts
import type { ReviewRow } from "../corpus.js";

export const UNCERTAIN_RATE = "uncertain_rate" as const;

/**
 * Share of ruled findings the skeptic could not rule.
 *
 * A null verdict means the skeptic did not rule, and ../hivemark/src/claims.ts
 * is explicit that "that absence must never be read as confirmation". The
 * symmetric rule applies here: it must not be read as an inability to rule
 * either, so it leaves both numerator and denominator.
 *
 * Null, not zero, when nothing was ruled. Zero would say "this review left
 * nothing unruled", which is a claim; null says the review supports no rate,
 * and the caller drops the pair and records the drop.
 */
export function uncertainRate(row: ReviewRow): number | null {
  const ruled = row.findings.filter((f) => f.verdict === "confirmed" || f.verdict === "refuted" || f.verdict === "uncertain");
  if (ruled.length === 0) return null;
  return ruled.filter((f) => f.verdict === "uncertain").length / ruled.length;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test tests/uncertain-rate.test.ts && bun run typecheck`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/uncertain-rate.ts tests/uncertain-rate.test.ts
git commit -m "feat: uncertain_rate over ruled findings only"
```

---

### Task 8: Admissibility gates

**Files:**
- Create: `src/admissibility.ts`
- Test: `tests/admissibility.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GATE2_FLOOR = 5`, `admissibility(spread: readonly [number, number], informativePairs: number): Verdict`; type `Verdict = { admissible: boolean; because: string[] }`.

- [ ] **Step 1: Write the failing test**

`tests/admissibility.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { admissibility, GATE2_FLOOR } from "../src/admissibility.js";

describe("admissibility", () => {
  it("admits a spread clear of zero with enough informative pairs", () => {
    expect(admissibility([0.1, 0.9], 5)).toEqual({ admissible: true, because: [] });
  });

  it("rejects a spread that spans zero", () => {
    const v = admissibility([-0.5, 0.5], 10);
    expect(v.admissible).toBe(false);
    expect(v.because[0]).toMatch(/spread \[-0.5, 0.5\] spans zero/);
  });

  it("rejects too few informative pairs", () => {
    const v = admissibility([0, 1], 2);
    expect(v.admissible).toBe(false);
    expect(v.because[0]).toMatch(/informative_pairs 2 < 5/);
  });

  it("reports both gates when both fail", () => {
    expect(admissibility([-1, 1], 0).because).toHaveLength(2);
  });

  it("treats a spread touching zero at one end as clear of it", () => {
    expect(admissibility([0, 1], GATE2_FLOOR).admissible).toBe(true);
  });

  it("admits an all-negative spread; direction is already normalised", () => {
    expect(admissibility([-0.9, -0.1], 5).admissible).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/admissibility.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the gates**

`src/admissibility.ts`:
```ts
/**
 * A declared convention, not a derived threshold.
 *
 * No honest statistical floor is available: deriving one needs a distributional
 * assumption about per-pair differences that a corpus yielding two informative
 * pairs cannot support. Five is small enough that an early axis can clear it and
 * large enough that a handful of reruns is not a profile. Revisable upward by
 * the matching-engine spec and never downward.
 */
export const GATE2_FLOOR = 5;

export interface Verdict {
  readonly admissible: boolean;
  readonly because: readonly string[];
}

/**
 * Gate 1: the spread must not span zero — the resource helped and hurt the same
 * subject on the same axis, and the mean summarises a disagreement rather than
 * measuring anything. Touching zero at one end is not spanning it: a set of
 * same-signed differences and ties still has one direction.
 *
 * Gate 2: ties carry no directional evidence, so the count excludes them.
 *
 * No leave-one-out gate. Under gate 1 every informative pair shares a sign, so
 * dropping one leaves the sign intact whenever there are at least two — and the
 * floor is five, so such a test could never fire. A gate that rejects nothing is
 * worse than no gate, because a reader takes it for protection.
 */
export function admissibility(spread: readonly [number, number], informativePairs: number): Verdict {
  const because: string[] = [];
  const [lo, hi] = spread;
  if (lo < 0 && hi > 0) because.push(`spread [${lo}, ${hi}] spans zero: the resource both helped and hurt`);
  if (informativePairs < GATE2_FLOOR) because.push(`informative_pairs ${informativePairs} < ${GATE2_FLOOR}`);
  return { admissible: because.length === 0, because };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test tests/admissibility.test.ts && bun run typecheck`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/admissibility.ts tests/admissibility.test.ts
git commit -m "feat: two admissibility gates on evidence, not ranking"
```

---

### Task 9: D1 derivation

**Files:**
- Create: `src/derive-d1.ts`
- Test: `tests/derive-d1.test.ts`

**Interfaces:**
- Consumes: `PairSet` (Task 5), `subjectOf` (Task 4), `uncertainRate`/`UNCERTAIN_RATE` (Task 7), `admissibility` (Task 8), `round4` (Task 2), `D1Schema`/`RECORD_SCHEMA_VERSION` (Task 2), `AxisSpec` (Task 1).
- Produces: `deriveD1(set: PairSet, spec: AxisSpec, opts: DeriveOptions): D1 | null`; type `DeriveOptions = { metric: string; direction: "higher-better" | "lower-better"; judgeId: string; observedAt: string }`.

- [ ] **Step 1: Write the failing test**

`tests/derive-d1.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readManifest, readReviews } from "../src/corpus.js";
import { deriveD1 } from "../src/derive-d1.js";
import { pairReviews } from "../src/pair.js";
import { loadRegistry, requireAxis } from "../src/registry.js";
import { subjectOf } from "../src/subject.js";

const spec = requireAxis(loadRegistry("registry/axes.json"), "context.graph");
const rows = readReviews(readManifest("tests/fixtures/mini.json"));
const opts = {
  metric: "uncertain_rate",
  direction: "lower-better" as const,
  judgeId: "s1",
  observedAt: "2026-09-23T00:00:00+00:00",
};

describe("deriveD1", () => {
  const d1 = deriveD1(pairReviews(rows, spec), spec, opts);

  it("produces a record that validates", () => {
    expect(d1?.kind).toBe("D1");
  });

  it("takes subject from the present arm", () => {
    expect(d1?.subject).toBe(subjectOf(rows[0]!));
  });

  it("normalises the sign so positive means the resource helped", () => {
    // graph 0/1 unruled, ablated 1/1 — raw graph-minus-ablated is -1, and the
    // metric is lower-better, so the stored delta is +1.
    expect(d1?.metric.delta).toBe(1);
    expect(d1?.metric.spread).toEqual([1, 1]);
  });

  it("sets goldens_version null for a verdict-derived metric", () => {
    expect(d1?.judge.goldens_version).toBeNull();
  });

  it("records one instance per pair", () => {
    expect(d1?.pairing.instances).toEqual(["https://x/pull/1@h1"]);
    expect(d1?.pairing.pairs).toBe(1);
  });

  it("is inadmissible on gate 2 with one informative pair", () => {
    expect(d1?.admissible).toBe(false);
    expect(d1?.inadmissible_because.join()).toMatch(/informative_pairs 1 < 5/);
  });

  it("names the pairs it dropped in unestablished", () => {
    expect(d1?.unestablished).toMatch(/dropped 0 pair/);
  });

  it("returns null when no pair survives", () => {
    expect(deriveD1({ key: spec.identifying, pairs: [], unplanned: 0 }, spec, opts)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/derive-d1.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement derivation**

`src/derive-d1.ts`:
```ts
import { admissibility } from "./admissibility.js";
import { round4 } from "./canonical.js";
import { UNCERTAIN_RATE, uncertainRate } from "./metrics/uncertain-rate.js";
import type { Pair, PairSet } from "./pair.js";
import { D1Schema, RECORD_SCHEMA_VERSION, VERDICT_DERIVED_METRICS, type D1 } from "./records.js";
import { requireResource, type AxisSpec } from "./registry.js";
import { subjectOf } from "./subject.js";

export interface DeriveOptions {
  readonly metric: string;
  readonly direction: "higher-better" | "lower-better";
  readonly judgeId: string;
  readonly observedAt: string;
}

const METRICS: Record<string, (row: Pair["present"]) => number | null> = {
  [UNCERTAIN_RATE]: uncertainRate,
};

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * One D1 over a pair set, or null when nothing survives.
 *
 * The per-pair difference is computed per review and then differenced — never
 * pooled and then differenced. The arms differ sharply in findings per review,
 * so a pooled difference would be dominated by the arm that talks more, and
 * both gates run on these differences, so pooling would change which
 * observations are admissible.
 */
export function deriveD1(set: PairSet, spec: AxisSpec, opts: DeriveOptions): D1 | null {
  const metric = METRICS[opts.metric];
  if (!metric) throw new Error(`no implementation for metric ${JSON.stringify(opts.metric)}`);

  const present = requireResource(spec, spec.resources[0] as string);
  const absent = requireResource(spec, spec.resources[1] as string);

  const kept: { pair: Pair; withValue: number; withoutValue: number; diff: number }[] = [];
  let dropped = 0;
  // `lower-better` means a fall is an improvement, so the raw difference is
  // multiplied by -1 exactly once, here, and never re-applied downstream.
  const sign = opts.direction === "lower-better" ? -1 : 1;

  for (const pair of set.pairs) {
    const a = metric(pair.present);
    const b = metric(pair.absent);
    if (a === null || b === null) {
      dropped += 1;
      continue;
    }
    kept.push({ pair, withValue: a, withoutValue: b, diff: round4((a - b) * sign) });
  }

  if (kept.length === 0) return null;

  const diffs = kept.map((k) => k.diff);
  const sorted = [...diffs].sort((x, y) => x - y);
  const spread: [number, number] = [sorted[0] as number, sorted[sorted.length - 1] as number];
  const informative = diffs.filter((d) => d !== 0).length;
  const verdict = admissibility(spread, informative);

  const first = kept[0] as (typeof kept)[number];
  const record = {
    schema_version: RECORD_SCHEMA_VERSION,
    subject: subjectOf(first.pair.present),
    axis: spec.axis,
    kind: "D1" as const,
    self_asserted: false as const,
    observed_at: opts.observedAt,
    unestablished:
      `dropped ${dropped} pair(s) whose metric was undefined, and ${set.unplanned} row(s) with an ` +
      `unplanned arm; says nothing about identities absent from this corpus, nor about any axis but ${spec.axis}`,
    resource: { present, absent },
    pairing: {
      key: [...set.key],
      pairs: kept.length,
      informative_pairs: informative,
      instances: kept.map((k) => k.pair.instance),
    },
    metric: {
      name: opts.metric,
      direction: opts.direction,
      with: round4(mean(kept.map((k) => k.withValue))),
      without: round4(mean(kept.map((k) => k.withoutValue))),
      delta: round4(mean(diffs)),
      spread,
    },
    judge: {
      id: opts.judgeId,
      goldens_version: VERDICT_DERIVED_METRICS.has(opts.metric) ? null : "unversioned",
      self: false,
    },
    admissible: verdict.admissible,
    inadmissible_because: [...verdict.because],
  };

  return D1Schema.parse(record);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test tests/derive-d1.test.ts && bun run typecheck`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify the spec's §5.6 figures**

Run:
```bash
bun -e 'import {readManifest,readReviews} from "./src/corpus.js"; import {pairReviews} from "./src/pair.js"; import {deriveD1} from "./src/derive-d1.js"; import {loadRegistry,requireAxis} from "./src/registry.js"; const s=requireAxis(loadRegistry("registry/axes.json"),"context.graph"); const d=deriveD1(pairReviews(readReviews(readManifest("corpus.json")),s),s,{metric:"uncertain_rate",direction:"lower-better",judgeId:"skeptic",observedAt:new Date().toISOString()}); console.log(JSON.stringify({pairs:d?.pairing.pairs,informative:d?.pairing.informative_pairs,delta:d?.metric.delta,spread:d?.metric.spread,admissible:d?.admissible,because:d?.inadmissible_because},null,1))'
```
Expected, matching spec §5.6: `pairs 6`, `informative 2`, `delta 0.2593`, `spread [0, 1]`, `admissible false`, because `informative_pairs 2 < 5`.

If the figures differ, **stop and report** rather than adjusting the code to match: the spec's numbers were computed independently, and a disagreement means one of the two is wrong and must be found.

- [ ] **Step 6: Commit**

```bash
git add src/derive-d1.ts tests/derive-d1.test.ts
git commit -m "feat: D1 derivation reproducing the spec's corpus figures"
```

---

### Task 10: D2 derivation

**Files:**
- Create: `src/derive-d2.ts`
- Test: `tests/derive-d2.test.ts`

**Interfaces:**
- Consumes: `ReviewRow` (Task 3), `Refusal` (Task 6), `subjectOf` (Task 4), `CATEGORIES`/`D2Schema` (Task 2).
- Produces: `deriveD2(rows: readonly ReviewRow[], axis: string, observedAt: string): D2[]`, `refusalD2(r: Refusal, subject: string, axis: string, observedAt: string): D2`.

- [ ] **Step 1: Write the failing test**

`tests/derive-d2.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readManifest, readReviews } from "../src/corpus.js";
import { deriveD2, refusalD2 } from "../src/derive-d2.js";
import { CATEGORIES } from "../src/records.js";

const rows = readReviews(readManifest("tests/fixtures/mini.json"));
const at = "2026-09-23T00:00:00+00:00";

describe("deriveD2", () => {
  const out = deriveD2(rows, "context.graph", at);

  it("emits one record per category per subject, not only where undecidables exist", () => {
    const subjects = new Set(out.map((d) => d.subject));
    expect(out).toHaveLength(subjects.size * CATEGORIES.length);
  });

  it("marks a category that never came up with total 0", () => {
    const security = out.find((d) => d.category === "security");
    expect(security?.verdicts.total).toBe(0);
    expect(security?.grounds).toMatch(/never came up/);
  });

  it("quotes the skeptic note as grounds rather than synthesising one", () => {
    const logic = out.find((d) => d.category === "logic" && d.verdicts.undecidable > 0);
    expect(logic?.grounds).toBe("not in the provided diff hunks");
  });

  it("marks a category that came up and was fully ruled", () => {
    const logic = out.filter((d) => d.category === "logic").find((d) => d.verdicts.total > 0 && d.verdicts.undecidable === 0);
    expect(logic?.grounds).toMatch(/all ruled/);
  });

  it("classifies every ground on this corpus as more-evidence", () => {
    expect(new Set(out.filter((d) => d.verdicts.undecidable > 0).map((d) => d.resolvable_by))).toEqual(new Set(["more-evidence"]));
  });
});

describe("refusalD2", () => {
  it("turns a refused join into an undecidable record", () => {
    const d = refusalD2(
      { url: "https://x/pull/1", had_graph: true, grounds: "judged row does not name the finder", candidates: ["m1", "m2"] },
      "0xabc",
      "context.graph",
      at,
    );
    expect(d.resolvable_by).toBe("more-evidence");
    expect(d.verdicts.total).toBe(0);
    expect(d.grounds).toMatch(/does not name the finder/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/derive-d2.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement D2 derivation**

`src/derive-d2.ts`:
```ts
import type { ReviewRow } from "./corpus.js";
import type { Refusal } from "./join.js";
import { CATEGORIES, D2Schema, RECORD_SCHEMA_VERSION, type Category, type D2 } from "./records.js";
import { subjectOf } from "./subject.js";

const NOTE_LIMIT = 400;

/**
 * One D2 per (subject, axis, category), for every category the schema defines.
 *
 * Emitting only categories with undecidables would make an untouched category
 * read as a strength, and `unestablished` cannot carry that distinction on its
 * own: a category that produced no findings produces no record to carry
 * anything. `verdicts.total` separates the two — 0 is "never came up", and
 * positive with no undecidables is "came up, all ruled".
 */
export function deriveD2(rows: readonly ReviewRow[], axis: string, observedAt: string): D2[] {
  const bySubject = new Map<string, ReviewRow[]>();
  for (const row of rows) {
    const s = subjectOf(row);
    bySubject.set(s, [...(bySubject.get(s) ?? []), row]);
  }

  const out: D2[] = [];
  for (const [subject, subjectRows] of [...bySubject].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const category of CATEGORIES) {
      out.push(D2Schema.parse(one(subject, axis, category, subjectRows, observedAt)));
    }
  }
  return out;
}

function one(subject: string, axis: string, category: Category, rows: readonly ReviewRow[], observedAt: string) {
  const findings = rows.flatMap((r) =>
    r.findings.filter((f) => f.category === category).map((f) => ({ f, ref: `${r.url}@${r.head_sha}` })),
  );
  const ruled = findings.filter(({ f }) => f.verdict === "confirmed" || f.verdict === "refuted" || f.verdict === "uncertain");
  const undecided = ruled.filter(({ f }) => f.verdict === "uncertain");

  // Quoted, never synthesised. The first note in a stable order, so two readers
  // of the same corpus cite the same one.
  const notes = undecided
    .map(({ f }) => (f.skeptic_note ?? "").trim())
    .filter((n) => n.length > 0)
    .sort();
  const quoted = notes[0];

  const grounds =
    ruled.length === 0
      ? `category ${category} never came up in this corpus; the zero is an absence of findings, not an absence of a blind spot`
      : undecided.length === 0
        ? `category ${category} came up ${ruled.length} time(s) and was all ruled`
        : (quoted ?? "").slice(0, NOTE_LIMIT);

  if (undecided.length > 0 && !quoted) {
    throw new Error(
      `${subject} ${category}: ${undecided.length} undecidable finding(s) and no skeptic_note to quote; ` +
        `grounds are quoted, never invented`,
    );
  }

  return {
    schema_version: RECORD_SCHEMA_VERSION,
    subject,
    axis,
    kind: "D2" as const,
    self_asserted: false as const,
    observed_at: observedAt,
    unestablished:
      ruled.length === 0
        ? "this category produced no ruled findings here; whether the subject can rule it is unknown, not answered"
        : `grounds quote one of ${undecided.length} note(s); findings with no verdict are excluded entirely, since an absent judge is not an inability to judge`,
    category,
    verdicts: { undecidable: undecided.length, total: ruled.length, refs: [...new Set(undecided.map((u) => u.ref))].sort() },
    grounds,
    resolvable_by: "more-evidence" as const,
  };
}

/**
 * A refused join is undecidable, not absent.
 *
 * The honest answer to "whose work was judged?" when the corpus does not say is
 * that it cannot be ruled, and `more-evidence` names what would settle it: a
 * judged row carrying the finder.
 */
export function refusalD2(r: Refusal, subject: string, axis: string, observedAt: string): D2 {
  return D2Schema.parse({
    schema_version: RECORD_SCHEMA_VERSION,
    subject,
    axis,
    kind: "D2" as const,
    self_asserted: false as const,
    observed_at: observedAt,
    unestablished: `establishes nothing about the subject's ability; it records that this corpus cannot attribute one judged row`,
    category: "logic" as const,
    verdicts: { undecidable: 0, total: 0, refs: [`${r.url}|had_graph=${r.had_graph}`] },
    grounds: `${r.grounds}; candidates: ${r.candidates.join(", ") || "none"}`,
    resolvable_by: "more-evidence" as const,
  });
}
```

> `refusalD2` files under `category: "logic"` because the schema requires a
> defined category and a refused join has none. That is a known wart; the
> matching-engine spec is where a category-free D2 kind would be introduced if
> refusals ever need their own listing.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test tests/derive-d2.test.ts && bun run typecheck`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify against the real corpus**

Run:
```bash
bun -e 'import {readManifest,readReviews} from "./src/corpus.js"; import {deriveD2} from "./src/derive-d2.js"; const d=deriveD2(readReviews(readManifest("corpus.json")),"context.graph",new Date().toISOString()); const t={}; for(const r of d){t[r.category]=(t[r.category]||{u:0,n:0}); t[r.category].u+=r.verdicts.undecidable; t[r.category].n+=r.verdicts.total;} console.log(t)'
```
Expected, matching spec §5.4 totals: logic 672/49, tests 91/12, contract 90/13, types 71/14, ontology 5/0, security 3/1.

- [ ] **Step 6: Commit**

```bash
git add src/derive-d2.ts tests/derive-d2.test.ts
git commit -m "feat: D2 per category, with grounds quoted not invented"
```

---

### Task 11: Supersession

**Files:**
- Create: `src/supersede.ts`
- Test: `tests/supersede.test.ts`

**Interfaces:**
- Consumes: `D1` (Task 2), `observationId` (Task 2).
- Produces: `supersededIds(records: readonly D1[]): Set<string>`.

- [ ] **Step 1: Write the failing test**

`tests/supersede.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { observationId } from "../src/canonical.js";
import type { D1 } from "../src/records.js";
import { supersededIds } from "../src/supersede.js";

const d1 = (instances: string[], observed_at: string): D1 =>
  ({
    schema_version: 1,
    subject: "0xabc",
    axis: "context.graph",
    kind: "D1",
    self_asserted: false,
    observed_at,
    unestablished: "u",
    resource: { present: "graph", absent: "ablated" },
    pairing: { key: ["url"], pairs: instances.length, informative_pairs: 0, instances },
    metric: { name: "uncertain_rate", direction: "lower-better", with: 0, without: 0, delta: 0, spread: [0, 0] },
    judge: { id: "s", goldens_version: null, self: false },
    admissible: false,
    inadmissible_because: ["informative_pairs 0 < 5"],
  }) as D1;

describe("supersededIds", () => {
  const older = d1(["a", "b"], "2026-09-01T00:00:00+00:00");
  const newer = d1(["a", "b", "c"], "2026-09-02T00:00:00+00:00");

  it("supersedes an earlier record whose instances are a subset", () => {
    expect(supersededIds([older, newer])).toEqual(new Set([observationId(older)]));
  });

  it("is order-independent, being recomputed rather than stored", () => {
    expect(supersededIds([newer, older])).toEqual(supersededIds([older, newer]));
  });

  it("does not supersede on an overlapping but non-subset set", () => {
    expect(supersededIds([d1(["a", "x"], "2026-09-01T00:00:00+00:00"), newer]).size).toBe(0);
  });

  it("does not supersede across a different subject", () => {
    const other = { ...newer, subject: "0xdef" } as D1;
    expect(supersededIds([older, other]).size).toBe(0);
  });

  it("does not supersede across goldens versions", () => {
    const rescored = { ...newer, judge: { ...newer.judge, goldens_version: "v2" } } as D1;
    expect(supersededIds([older, rescored]).size).toBe(0);
  });

  it("does not supersede a later record by an earlier one", () => {
    expect(supersededIds([d1(["a", "b", "c"], "2026-09-01T00:00:00+00:00"), d1(["a", "b"], "2026-09-02T00:00:00+00:00")]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/supersede.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement supersession**

`src/supersede.ts`:
```ts
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
  const group = (r: D1) => `${r.subject}|${r.axis}|${r.metric.name}|${r.judge.id}|${r.judge.goldens_version}|${r.schema_version}`;

  const groups = new Map<string, D1[]>();
  for (const r of records) groups.set(group(r), [...(groups.get(group(r)) ?? []), r]);

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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test tests/supersede.test.ts && bun run typecheck`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/supersede.ts tests/supersede.test.ts
git commit -m "feat: supersession recomputed by readers, not stored"
```

---

### Task 12: Overlay store and CLI

**Files:**
- Create: `src/overlay.ts`, `src/cli.ts`
- Test: `tests/overlay.test.ts`, `tests/e2e.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `appendOverlay(path: string, records: readonly Observation[]): void`, `readOverlay(path: string): Observation[]`, `main(argv: string[]): number`.

- [ ] **Step 1: Write the failing test for the store**

`tests/overlay.test.ts`:
```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { D3 } from "../src/records.js";
import { appendOverlay, readOverlay } from "../src/overlay.js";

const dir = mkdtempSync(join(tmpdir(), "overlay-"));
const path = join(dir, "overlay.jsonl");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const d3: D3 = {
  schema_version: 1,
  subject: "0xabc",
  axis: "context.graph",
  kind: "D3",
  self_asserted: true,
  observed_at: "2026-09-23T00:00:00+00:00",
  unestablished: "a want, not a measurement",
  want: "an adversarial skeptic",
};

describe("overlay", () => {
  it("appends rather than replacing", () => {
    appendOverlay(path, [d3]);
    appendOverlay(path, [{ ...d3, want: "long-term memory" }]);
    expect(readOverlay(path)).toHaveLength(2);
  });

  it("round-trips a record unchanged", () => {
    expect(readOverlay(path)[0]).toEqual(d3);
  });

  it("refuses a record that does not validate on read", () => {
    appendOverlay(path, [{ ...d3, self_asserted: false } as unknown as D3]);
    expect(() => readOverlay(path)).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test tests/overlay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

`src/overlay.ts`:
```ts
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.js";
import { D1Schema, D2Schema, D3Schema, type Observation } from "./records.js";

/**
 * Append-only, and nothing is ever deleted.
 *
 * A retention policy would discard exactly the records a raised gate-2 floor
 * must re-evaluate and the exploration queue reads to know a question has been
 * asked. Growth is bounded by funded runs, which are expensive by construction.
 */
export function appendOverlay(path: string, records: readonly Observation[]): void {
  if (records.length === 0) return;
  appendFileSync(path, `${records.map(canonicalJson).join("\n")}\n`, "utf8");
}

export function readOverlay(path: string): Observation[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((line, i) => {
      const raw: unknown = JSON.parse(line);
      const kind = (raw as { kind?: unknown }).kind;
      const schema = kind === "D1" ? D1Schema : kind === "D2" ? D2Schema : kind === "D3" ? D3Schema : null;
      if (!schema) throw new Error(`${path}:${i + 1} unknown kind ${JSON.stringify(kind)}`);
      return schema.parse(raw) as Observation;
    });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test tests/overlay.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Implement the CLI**

`src/cli.ts`:
```ts
import { readJudged, readManifest, readReviews } from "./corpus.js";
import { deriveD1 } from "./derive-d1.js";
import { deriveD2, refusalD2 } from "./derive-d2.js";
import { joinJudged } from "./join.js";
import { appendOverlay } from "./overlay.js";
import { pairReviews } from "./pair.js";
import type { Observation } from "./records.js";
import { loadRegistry, requireAxis } from "./registry.js";
import { subjectOf } from "./subject.js";

export function main(argv: readonly string[]): number {
  const manifestPath = argv[0];
  const outIndex = argv.indexOf("--out");
  const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  if (!manifestPath || !out) {
    process.stderr.write("usage: bun src/cli.ts <manifest.json> --out <overlay.jsonl>\n");
    return 2;
  }

  const axis = "context.graph";
  const observedAt = new Date().toISOString();
  const spec = requireAxis(loadRegistry("registry/axes.json"), axis);
  const manifest = readManifest(manifestPath);
  const reviews = readReviews(manifest);

  const records: Observation[] = [];

  const d1 = deriveD1(pairReviews(reviews, spec), spec, {
    metric: "uncertain_rate",
    direction: "lower-better",
    judgeId: "skeptic",
    observedAt,
  });
  if (d1) records.push(d1);

  records.push(...deriveD2(reviews, axis, observedAt));

  const { joined, refusals } = joinJudged(readJudged(manifest), reviews);
  const anySubject = reviews[0] ? subjectOf(reviews[0]) : "0x";
  for (const r of refusals) records.push(refusalD2(r, anySubject, axis, observedAt));

  appendOverlay(out, records);
  process.stdout.write(
    `${records.length} records -> ${out}\n` +
      `  D1: ${d1 ? `${d1.pairing.pairs} pairs, ${d1.pairing.informative_pairs} informative, admissible=${d1.admissible}` : "none"}\n` +
      `  judged joined: ${joined.length}, refused: ${refusals.length}\n`,
  );
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
```

- [ ] **Step 6: Write the end-to-end test**

`tests/e2e.test.ts`:
```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { readOverlay } from "../src/overlay.js";

const dir = mkdtempSync(join(tmpdir(), "e2e-"));
const out = join(dir, "overlay.jsonl");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("cli over the real corpus", () => {
  it("exits zero", () => {
    expect(main(["corpus.json", "--out", out])).toBe(0);
  });

  const records = () => readOverlay(out);

  it("derives exactly one D1, and it is inadmissible on gate 2", () => {
    const d1 = records().filter((r) => r.kind === "D1");
    expect(d1).toHaveLength(1);
    const only = d1[0];
    if (only?.kind !== "D1") throw new Error("expected a D1");
    expect(only.pairing.pairs).toBe(6);
    expect(only.pairing.informative_pairs).toBe(2);
    expect(only.metric.delta).toBe(0.2593);
    expect(only.metric.spread).toEqual([0, 1]);
    expect(only.admissible).toBe(false);
    expect(only.inadmissible_because.join()).toMatch(/informative_pairs 2 < 5/);
  });

  it("emits one refusal D2 per ambiguous judged row", () => {
    const refusals = records().filter((r) => r.kind === "D2" && r.grounds.includes("does not name the finder"));
    expect(refusals).toHaveLength(46);
  });

  it("supports no admissible D1 at all, which is the spec's stated result", () => {
    expect(records().filter((r) => r.kind === "D1" && r.admissible)).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run the whole suite**

Run: `bun run test && bun run typecheck`
Expected: PASS. If the e2e figures disagree with the spec, **stop and report** rather than editing the expectations.

- [ ] **Step 8: Commit**

```bash
git add src/overlay.ts src/cli.ts tests/overlay.test.ts tests/e2e.test.ts
git commit -m "feat: append-only overlay and CLI reproducing the spec's result"
```

---

## Self-Review Notes

**Spec coverage.** §4.1 envelope → Task 2. §4.2 D1 → Tasks 2, 9. §4.3 D2 → Tasks 2, 10. §4.4 D3 → Task 2 (schema only; nothing derives a D3, since D3 is written by an agent, not computed — the writing path belongs to the matching engine). §4.5 invariants 1–2 → Task 1; 3–8 → Task 2. §5.1 metric choice → Task 7. §5.2 steps 1–5 → Tasks 5, 9. §5.3 refused join → Task 6. §5.4 D2 → Task 10. §5.5 gates → Task 8. §5.6 figures → Tasks 9, 12 as executable assertions. §5.7 supersession → Task 11. §6 distance, §7 ranking, §8 publication → **not implemented here**; §6 and §7 are the matching-engine spec and §8 needs the p-e writer, which is the run-harness spec.

**Known gap, deliberate.** `refusalD2` files under `category: "logic"` because `D2Schema` requires a defined category and a refused join has none. Noted at Task 10 rather than papered over.
