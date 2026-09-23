import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { auditIntents, isClean } from "./audit.js";
import { observationId } from "./canonical.js";
import { readReviews, type Manifest, type ReviewRow } from "./corpus.js";
import { deriveD1V2 } from "./derive-d1-v2.js";
import { buildJoint } from "./joint.js";
import { appendOverlay, readOverlay, type OverlayRecord } from "./overlay.js";
import { pairRuns } from "./pair-runs.js";
import { failedRunFor, intentFor, runFor } from "./record.js";
import type { D1V2 } from "./records.js";
import { loadRegistry, requireAxis } from "./registry.js";
import { ConditionsSchema, FAILURES, type FailureKind, type RunIntent, type RunRecord } from "./runs.js";

const AXIS = "context.graph";
const USAGE = [
  "usage: bun src/cli-runs.ts <command> --flag value ...",
  "  intent --runner --url --head --project --arm --conditions <file.json> --overlay",
  "  run    --intent --reviews <file.jsonl> --overlay",
  "  fail   --intent --failure <prepare|ingest|model-error|parse|timeout> --detail --overlay",
  "  derive (--runner <id> | --runs <run_id,run_id,...>) --reviews <file.jsonl> --overlay",
  "  joint  --sources <id,id,...> --reviews <file.jsonl> --overlay",
  "  audit  --overlay",
].join("\n");

/** Flags in `required` must appear, `optional` may; none may repeat, and nothing is positional. */
function flags(argv: readonly string[], required: readonly string[], optional: readonly string[] = []): Map<string, string> {
  const allowed = [...required, ...optional];
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i] as string;
    const value = argv[i + 1];
    if (!name.startsWith("--")) throw new Error(`expected a flag, got ${JSON.stringify(name)}`);
    const key = name.slice(2);
    if (!allowed.includes(key)) {
      throw new Error(`unknown flag --${key}; this command takes ${allowed.map((a) => `--${a}`).join(" ")}`);
    }
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
    if (out.has(key)) throw new Error(`--${key} given twice`);
    out.set(key, value);
  }
  for (const a of required) if (!out.has(a)) throw new Error(`missing --${a}`);
  return out;
}

const get = (f: Map<string, string>, k: string): string => f.get(k) as string;
const now = (): string => new Date().toISOString();

const reviewsAt = (path: string): readonly ReviewRow[] => {
  const manifest: Manifest = { dir: dirname(path), base: ".", reviews: [basename(path)], judged: [] };
  return readReviews(manifest);
};

const intents = (recs: readonly OverlayRecord[]): RunIntent[] => recs.filter((r): r is RunIntent => r.kind === "I");
const runs = (recs: readonly OverlayRecord[]): RunRecord[] => recs.filter((r): r is RunRecord => r.kind === "R");
const v2s = (recs: readonly OverlayRecord[]): D1V2[] =>
  recs.filter((r): r is D1V2 => r.kind === "D1" && r.schema_version === 2);

function intentById(overlay: string, id: string): RunIntent {
  const hit = intents(readOverlay(overlay)).find((i) => i.intent_id === id);
  if (!hit) throw new Error(`no intent ${id} in ${overlay}`);
  return hit;
}

function commands(sub: string | undefined, rest: readonly string[]): number {
  const spec = requireAxis(loadRegistry("registry/axes.json"), AXIS);
  switch (sub) {
    case "intent": {
      const f = flags(rest, ["runner", "url", "head", "project", "arm", "conditions", "overlay"]);
      const intent = intentFor({
        runner: get(f, "runner"),
        task: { url: get(f, "url"), head_sha: get(f, "head"), project: get(f, "project") },
        arm: get(f, "arm"),
        conditions: ConditionsSchema.parse(JSON.parse(readFileSync(get(f, "conditions"), "utf8"))),
        announcedAt: now(),
      });
      appendOverlay(get(f, "overlay"), [intent]);
      process.stdout.write(`${intent.intent_id}\n`);
      return 0;
    }
    case "run": {
      const f = flags(rest, ["intent", "reviews", "overlay"]);
      const intent = intentById(get(f, "overlay"), get(f, "intent"));
      const matching = reviewsAt(get(f, "reviews")).filter(
        (r) => r.url === intent.task.url && r.head_sha === intent.task.head_sha && r.arm === intent.arm,
      );
      // Exactly one. Two rows for the announced task and arm means the file holds
      // someone else's run too, and picking one is the refused join again.
      if (matching.length !== 1) {
        throw new Error(
          `${matching.length} rows in ${get(f, "reviews")} match ${intent.task.url}@${intent.task.head_sha} on ` +
            `arm ${intent.arm}; supply the file this run produced, which holds exactly one`,
        );
      }
      const run = runFor(intent, matching[0] as ReviewRow, now());
      appendOverlay(get(f, "overlay"), [run]);
      process.stdout.write(`${run.run_id}\n`);
      return 0;
    }
    case "fail": {
      const f = flags(rest, ["intent", "failure", "detail", "overlay"]);
      const failure = get(f, "failure");
      if (!(FAILURES as readonly string[]).includes(failure)) {
        throw new Error(`--failure must be one of ${FAILURES.join(", ")}`);
      }
      const run = failedRunFor(intentById(get(f, "overlay"), get(f, "intent")), failure as FailureKind, get(f, "detail"), now());
      appendOverlay(get(f, "overlay"), [run]);
      process.stdout.write(`${run.run_id}\n`);
      return 0;
    }
    case "derive": {
      const f = flags(rest, ["reviews", "overlay"], ["runner", "runs"]);
      const recs = readOverlay(get(f, "overlay"));
      // Exactly one selector. After a legitimate re-run a runner has two completed
      // runs of one task and arm, and pairRuns refuses to choose; --runs is how a
      // person makes that choice explicitly instead of the tool making it silently.
      if (f.has("runner") === f.has("runs")) throw new Error("derive takes exactly one of --runner or --runs");
      let chosen: RunRecord[];
      if (f.has("runs")) {
        const byId = new Map(runs(recs).map((r) => [r.run_id, r]));
        chosen = get(f, "runs")
          .split(",")
          .map((id) => {
            const hit = byId.get(id);
            if (!hit) throw new Error(`no run ${id} in ${get(f, "overlay")}`);
            return hit;
          });
      } else {
        chosen = runs(recs).filter((r) => r.runner === get(f, "runner"));
      }
      const set = pairRuns(chosen, reviewsAt(get(f, "reviews")), spec);
      const d1 = deriveD1V2(
        set,
        spec,
        { metric: "uncertain_rate", direction: "lower-better", judgeId: "skeptic", observedAt: now() },
        intents(recs),
      );
      if (!d1) throw new Error("no pair survived; nothing to record");
      appendOverlay(get(f, "overlay"), [d1]);
      process.stdout.write(
        `${observationId(d1)}\n  ${d1.pairing.pairs} pairs, ${d1.pairing.informative_pairs} informative, admissible=${d1.admissible}\n`,
      );
      return 0;
    }
    case "joint": {
      const f = flags(rest, ["sources", "reviews", "overlay"]);
      const recs = readOverlay(get(f, "overlay"));
      const byId = new Map(v2s(recs).map((d) => [observationId(d), d]));
      const sources = get(f, "sources")
        .split(",")
        .map((id) => {
          const hit = byId.get(id);
          if (!hit) throw new Error(`no version-2 observation ${id} in ${get(f, "overlay")}`);
          return hit;
        });
      const joint = buildJoint({ sources, runs: runs(recs), rows: reviewsAt(get(f, "reviews")), spec, observedAt: now() });
      appendOverlay(get(f, "overlay"), [joint]);
      process.stdout.write(
        `${observationId(joint)}\n  ${joint.contributors.join(" + ")}: contested_tasks=${joint.joint?.contested_tasks}, ` +
          `graph_agreement=${joint.joint?.graph_agreement}, admissible=${joint.admissible}\n`,
      );
      return 0;
    }
    case "audit": {
      const f = flags(rest, ["overlay"]);
      const recs = readOverlay(get(f, "overlay"));
      const audit = auditIntents(intents(recs), runs(recs));
      process.stdout.write(
        `${JSON.stringify(
          {
            unfulfilled: audit.unfulfilled.map((i) => i.intent_id),
            orphans: audit.orphans.map((r) => r.run_id),
            overdischarged: audit.overdischarged,
            mismatched: audit.mismatched,
          },
          null,
          2,
        )}\n`,
      );
      return isClean(audit) ? 0 : 1;
    }
    default:
      throw new Error(`unknown command ${JSON.stringify(sub)}`);
  }
}

export function main(argv: readonly string[]): number {
  try {
    return commands(argv[0], argv.slice(1));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n${USAGE}\n`);
    return 2;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
