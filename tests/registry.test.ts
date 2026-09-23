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
