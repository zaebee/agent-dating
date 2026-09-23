import { describe, expect, it } from "vitest";
import { D1Schema, D1V2Schema } from "../src/records.js";

const v2 = {
  schema_version: 2,
  subject: "0xabc",
  axis: "context.graph",
  observed_at: "2026-09-23T12:00:00+00:00",
  unestablished: "u",
  kind: "D1",
  self_asserted: false,
  resource: { present: "graph", absent: "ablated" },
  pairing: { key: ["task.url"], pairs: 1, informative_pairs: 1, instances: [["sha256:a", "sha256:b"]] },
  metric: { name: "uncertain_rate", direction: "lower-better", with: 0, without: 1, delta: 1, spread: [1, 1] },
  judge: { id: "skeptic", goldens_version: null, self: false },
  admissible: false,
  inadmissible_because: ["informative_pairs 1 < 5"],
  contributors: ["alice"],
};

const joint = { cites: ["sha256:o1", "sha256:o2"], graph_agreement: "identical", contested_tasks: 0 };

describe("D1V2Schema", () => {
  it("accepts a single-runner observation", () => {
    expect(D1V2Schema.parse(v2).contributors).toEqual(["alice"]);
  });

  it("accepts a joint with two contributors", () => {
    expect(D1V2Schema.parse({ ...v2, contributors: ["alice", "bob"], joint }).joint?.contested_tasks).toBe(0);
  });

  it("refuses two contributors without a joint block", () => {
    expect(JSON.stringify(D1V2Schema.safeParse({ ...v2, contributors: ["alice", "bob"] }))).toMatch(/no joint block/);
  });

  it("refuses a joint block on one contributor", () => {
    expect(JSON.stringify(D1V2Schema.safeParse({ ...v2, joint }))).toMatch(/single-contributor/);
  });

  it("refuses unsorted contributors", () => {
    expect(D1V2Schema.safeParse({ ...v2, contributors: ["bob", "alice"], joint }).success).toBe(false);
  });

  it("refuses a run pair listed twice", () => {
    const twice = { ...v2.pairing, pairs: 2, instances: [["sha256:a", "sha256:b"], ["sha256:a", "sha256:b"]] };
    expect(JSON.stringify(D1V2Schema.safeParse({ ...v2, pairing: twice }))).toMatch(/appears twice/);
  });

  it("keeps the version-1 checks", () => {
    const short = { ...v2.pairing, pairs: 2 };
    expect(JSON.stringify(D1V2Schema.safeParse({ ...v2, pairing: short }))).toMatch(/pairs 2 but 1 instance/);
  });

  it("refuses task strings as instances, which is version 1's shape", () => {
    expect(D1V2Schema.safeParse({ ...v2, pairing: { ...v2.pairing, instances: ["u@h1"] } }).success).toBe(false);
  });
});

describe("D1Schema", () => {
  it("refuses run pairs as instances, which is version 2's shape", () => {
    expect(D1Schema.safeParse({ ...v2, schema_version: 1, contributors: undefined }).success).toBe(false);
  });
});
