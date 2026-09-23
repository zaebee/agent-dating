import { readJudged, readManifest, readReviews } from "./corpus.js";
import { deriveD1 } from "./derive-d1.js";
import { deriveD2, refusalD2 } from "./derive-d2.js";
import { joinJudged } from "./join.js";
import { appendOverlay } from "./overlay.js";
import { pairReviews } from "./pair.js";
import type { Observation } from "./records.js";
import { loadRegistry, requireAxis } from "./registry.js";
import { subjectOf } from "./subject.js";

export function main(argv: readonly string[]): number {
  const manifestPath = argv[0];
  const outIndex = argv.indexOf("--out");
  const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  if (!manifestPath || !out) {
    process.stderr.write("usage: bun src/cli.ts <manifest.json> --out <overlay.jsonl>\n");
    return 2;
  }

  const axis = "context.graph";
  const observedAt = new Date().toISOString();
  const spec = requireAxis(loadRegistry("registry/axes.json"), axis);
  const manifest = readManifest(manifestPath);
  const reviews = readReviews(manifest);

  const records: Observation[] = [];

  const d1 = deriveD1(pairReviews(reviews, spec), spec, {
    metric: "uncertain_rate",
    direction: "lower-better",
    judgeId: "skeptic",
    observedAt,
  });
  if (d1) records.push(d1);

  records.push(...deriveD2(reviews, axis, observedAt));

  const { joined, refusals } = joinJudged(readJudged(manifest), reviews);
  const first = reviews[0];
  const anySubject = first ? subjectOf(first) : "0x";
  for (const r of refusals) records.push(refusalD2(r, anySubject, axis, observedAt));

  appendOverlay(out, records);
  process.stdout.write(
    `${records.length} records -> ${out}\n` +
      `  D1: ${d1 ? `${d1.pairing.pairs} pairs, ${d1.pairing.informative_pairs} informative, admissible=${d1.admissible}` : "none"}\n` +
      `  judged joined: ${joined.length}, refused: ${refusals.length}\n`,
  );
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
