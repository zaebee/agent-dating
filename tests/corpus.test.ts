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
