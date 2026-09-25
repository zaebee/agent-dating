import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { byCodeUnit, canonicalJson } from "./canonical.js";

const SQLITE_HEADER = "SQLite format 3\u0000";

/**
 * `ingest_state` rows that describe the ingest rather than the graph.
 * codegraph-brain writes `root` as the absolute path of the checkout and
 * `ingested_at` as the largest mtime among the ingested files. Neither changes
 * what a query returns, and both differ between two ingests of one commit in
 * two places. Every other key is digested, `workspace_packages` included: it is
 * what TypeScript imports were resolved against.
 */
const INGEST_BOOKKEEPING: Readonly<Record<string, { readonly column: string; readonly values: readonly string[] }>> = {
  ingest_state: { column: "key", values: ["ingested_at", "root"] },
};

export function isSqlite(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(SQLITE_HEADER.length);
    const read = readSync(fd, head, 0, head.length, 0);
    return read === head.length && head.toString("latin1") === SQLITE_HEADER;
  } finally {
    closeSync(fd);
  }
}

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** JSON has no bytes; a blob is spelled so it cannot be mistaken for a string. */
const cell = (v: unknown): unknown =>
  v instanceof Uint8Array ? { blob: Buffer.from(v).toString("hex") } : v;

/**
 * Digest of a graph database by what it holds, not by its bytes.
 *
 * SQLite's pages depend on insertion order, free space and vacuuming, so two
 * databases with the same rows need not share a byte. This reads every table,
 * sorted by name, as its column names followed by its rows sorted by every
 * column, and leaves out only the bookkeeping named above. A graph with no
 * nodes is refused: an empty ingest is a failed ingest, not a graph.
 */
export function sqliteGraphDigest(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => String(r.name))
      .sort(byCodeUnit);
    if (!tables.includes("nodes") || Number(db.prepare("SELECT count(*) AS n FROM nodes").get()?.n) === 0) {
      throw new Error(`graph ${path} has no nodes; an empty ingest is a failed ingest, not a graph`);
    }
    const hash = createHash("sha256");
    for (const table of tables) {
      const columns = db
        .prepare(`PRAGMA table_info(${quoted(table)})`)
        .all()
        .map((c) => String(c.name));
      hash.update(`${canonicalJson({ table, columns })}\n`);
      const skip = INGEST_BOOKKEEPING[table];
      const where = skip ? ` WHERE ${quoted(skip.column)} NOT IN (${skip.values.map(() => "?").join(",")})` : "";
      const order = columns.map((_, i) => i + 1).join(",");
      const rows = db.prepare(`SELECT * FROM ${quoted(table)}${where} ORDER BY ${order}`).iterate(...(skip?.values ?? []));
      for (const row of rows) {
        hash.update(`${canonicalJson(columns.map((c) => cell((row as Record<string, unknown>)[c])))}\n`);
      }
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    db.close();
  }
}
