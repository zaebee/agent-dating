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
