import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { graphDigest } from "../src/runs.js";

const dir = mkdtempSync(join(tmpdir(), "graph-digest-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Row = readonly (string | number | null)[];

interface Graph {
  readonly nodes: readonly Row[];
  readonly edges: readonly Row[];
  readonly state: readonly (readonly [string, string])[];
}

const graph: Graph = {
  nodes: [
    ["apps.web.page", "FILE", "page", "apps/web/page.ts", 1, 9, 0.9],
    ["packages.lib.util", "FILE", "util", "packages/lib/util.ts", 1, 3, 1],
  ],
  edges: [["e1", "apps.web.page", "packages.lib.util", "IMPORTS", 1]],
  state: [
    ["root", "/home/alice/work/cal.com"],
    ["ingested_at", "1790000000.25"],
    ["workspace_packages", '{"@x.lib": "packages.lib"}'],
  ],
};

let n = 0;
/** A codegraph-brain-shaped graph database, rows inserted in the order given. */
function write(g: Graph, opts: { reversed?: boolean; nodeColumns?: string } = {}): string {
  const path = join(dir, `g${n++}.db`);
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE nodes (${opts.nodeColumns ?? "id TEXT PRIMARY KEY, type TEXT, name TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, confidence_score REAL"});
    CREATE TABLE edges (id TEXT PRIMARY KEY, source TEXT, target TEXT, type TEXT, weight REAL);
    CREATE TABLE files_state (file_path TEXT PRIMARY KEY, hash TEXT);
    CREATE TABLE ingest_state (key TEXT PRIMARY KEY, value TEXT);
  `);
  const order = <T>(xs: readonly T[]): T[] => (opts.reversed ? [...xs].reverse() : [...xs]);
  const insert = (table: string, rows: readonly Row[]) => {
    for (const r of order(rows)) {
      db.prepare(`INSERT INTO ${table} VALUES (${r.map(() => "?").join(",")})`).run(...r);
    }
  };
  insert("nodes", g.nodes);
  insert("edges", g.edges);
  insert("files_state", [["apps/web/page.ts", "h1"]]);
  insert("ingest_state", g.state);
  db.close();
  return path;
}

const withState = (key: string, value: string): Graph => ({
  ...graph,
  state: graph.state.map(([k, v]) => [k, k === key ? value : v] as const),
});

describe("graphDigest of a SQLite graph", () => {
  const base = graphDigest(write(graph));

  it("digests the content, in the same format as any other artefact", () => {
    expect(base).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("does not depend on the order rows were written in, which changes the file's bytes", () => {
    expect(graphDigest(write(graph, { reversed: true }))).toBe(base);
  });

  it("does not depend on where the repository was checked out", () => {
    expect(graphDigest(write(withState("root", "/tmp/elsewhere/cal.com")))).toBe(base);
  });

  it("does not depend on the modification times of the ingested files", () => {
    expect(graphDigest(write(withState("ingested_at", "1790009999.5")))).toBe(base);
  });

  it("changes when the workspace packages imports were resolved against change", () => {
    expect(graphDigest(write(withState("workspace_packages", '{"@y.lib": "packages.lib"}')))).not.toBe(base);
  });

  it("changes when a node changes", () => {
    const changed = { ...graph, nodes: [graph.nodes[0] as Row, ["packages.lib.util", "FILE", "util", "packages/lib/util.ts", 1, 4, 1]] };
    expect(graphDigest(write(changed))).not.toBe(base);
  });

  it("changes when an edge is dropped", () => {
    expect(graphDigest(write({ ...graph, edges: [] }))).not.toBe(base);
  });

  it("tells a column's name apart from its value", () => {
    const renamed =
      "id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, confidence_score REAL";
    expect(graphDigest(write(graph, { nodeColumns: renamed }))).not.toBe(base);
  });

  it("refuses a graph with no nodes, which is a failed ingest and not a graph", () => {
    expect(() => graphDigest(write({ ...graph, nodes: [], edges: [] }))).toThrow(/no nodes/);
  });
});
