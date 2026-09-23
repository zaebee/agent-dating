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
