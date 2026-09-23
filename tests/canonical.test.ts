import { describe, expect, it } from "vitest";
import { byCodeUnit, canonicalJson, observationId, round4 } from "../src/canonical.js";

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

describe("byCodeUnit", () => {
  const xs = ["bob", "Alice", "alice", "Émile", "zoe", "_bot"];

  it("orders by UTF-16 code unit, uppercase before underscore before lowercase", () => {
    expect([...xs].sort(byCodeUnit)).toEqual(["Alice", "_bot", "alice", "bob", "zoe", "Émile"]);
  });

  it("differs from locale collation, which is the point — sorted arrays are hashed", () => {
    expect([...xs].sort(byCodeUnit)).not.toEqual([...xs].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("returns zero for equal strings", () => {
    expect(byCodeUnit("a", "a")).toBe(0);
  });
});
