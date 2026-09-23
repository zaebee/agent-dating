import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.js";
import { D1Schema, D2Schema, D3Schema, type Observation } from "./records.js";

/**
 * Append-only, and nothing is ever deleted.
 *
 * A retention policy would discard exactly the records a raised gate-2 floor
 * must re-evaluate and the exploration queue reads to know a question has been
 * asked. Growth is bounded by funded runs, which are expensive by construction.
 */
export function appendOverlay(path: string, records: readonly Observation[]): void {
  if (records.length === 0) return;
  appendFileSync(path, `${records.map((r) => canonicalJson(r)).join("\n")}\n`, "utf8");
}

export function readOverlay(path: string): Observation[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((line, i) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (err) {
        throw new Error(`${path}:${i + 1} is not JSON: ${(err as Error).message}`);
      }
      const kind = (raw as { kind?: unknown }).kind;
      const schema = kind === "D1" ? D1Schema : kind === "D2" ? D2Schema : kind === "D3" ? D3Schema : null;
      if (!schema) throw new Error(`${path}:${i + 1} unknown kind ${JSON.stringify(kind)}`);
      return schema.parse(raw) as Observation;
    });
}
