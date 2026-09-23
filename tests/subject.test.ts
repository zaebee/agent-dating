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
