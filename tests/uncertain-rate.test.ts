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
