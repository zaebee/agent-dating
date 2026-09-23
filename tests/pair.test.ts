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

  it("drops a row carrying no arm at all", () => {
    const { arm: _drop, ...noArm } = rows[0]!;
    const unplanned = { ...noArm, head_sha: "h2" } as ReviewRow;
    const set = pairReviews([...rows, unplanned], spec);
    expect(set.pairs).toHaveLength(1);
    expect(set.unplanned).toBe(1);
  });

  it("refuses a row carrying a field the registry does not classify", () => {
    const odd = { ...rows[0]!, seed: 42 } as ReviewRow;
    expect(() => pairReviews([odd], spec)).toThrow(/unclassified field "seed"/);
  });

  it("does not pair rows whose identifying field is absent on one side only", () => {
    const withTemp = { ...rows[0]!, temperature: 0.7 } as ReviewRow;
    expect(pairReviews([withTemp, rows[1]!], spec).pairs).toHaveLength(0);
  });

  it("makes no pair when only one arm exists", () => {
    expect(pairReviews([rows[0]!], spec).pairs).toHaveLength(0);
  });
});
