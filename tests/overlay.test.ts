import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appendOverlay, readOverlay } from "../src/overlay.js";
import type { D3 } from "../src/records.js";

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
