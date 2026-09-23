import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.js";
import { D1Schema, D1V2Schema, D2Schema, D3Schema, type Observation } from "./records.js";
import { RunIntentSchema, RunRecordSchema, type RunIntent, type RunRecord } from "./runs.js";

export type OverlayRecord = Observation | RunIntent | RunRecord;

/**
 * Append-only, and nothing is ever deleted.
 *
 * A retention policy would discard exactly the records a raised gate-2 floor
 * must re-evaluate and the exploration queue reads to know a question has been
 * asked. Growth is bounded by funded runs, which are expensive by construction.
 */
export function appendOverlay(path: string, records: readonly OverlayRecord[]): void {
  if (records.length === 0) return;
  appendFileSync(path, `${records.map((r) => canonicalJson(r)).join("\n")}\n`, "utf8");
}

export function readOverlay(path: string): OverlayRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((line, i): OverlayRecord => {
      const where = `${path}:${i + 1}`;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (err) {
        throw new Error(`${where} is not JSON: ${(err as Error).message}`);
      }
      const head = (typeof raw === "object" && raw !== null ? raw : {}) as { kind?: unknown; schema_version?: unknown };
      switch (head.kind) {
        case "D1":
          if (head.schema_version === 1) return D1Schema.parse(raw);
          if (head.schema_version === 2) return D1V2Schema.parse(raw);
          throw new Error(`${where} D1 with unknown schema_version ${JSON.stringify(head.schema_version)}`);
        case "D2":
          return D2Schema.parse(raw);
        case "D3":
          return D3Schema.parse(raw);
        case "I":
          return RunIntentSchema.parse(raw);
        case "R":
          return RunRecordSchema.parse(raw);
        default:
          throw new Error(`${where} unknown kind ${JSON.stringify(head.kind)}`);
      }
    });
}
