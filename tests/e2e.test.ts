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
