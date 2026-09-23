import type { ReviewRow } from "./corpus.js";
import type { Refusal } from "./join.js";
import { CATEGORIES, D2Schema, RECORD_SCHEMA_VERSION, type Category, type D2 } from "./records.js";
import { subjectOf } from "./subject.js";

const NOTE_LIMIT = 400;

/**
 * One D2 per (subject, axis, category), for every category the schema defines.
 *
 * Emitting only categories with undecidables would make an untouched category
 * read as a strength, and `unestablished` cannot carry that distinction on its
 * own: a category that produced no findings produces no record to carry
 * anything. `verdicts.total` separates the two — 0 is "never came up", and
 * positive with no undecidables is "came up, all ruled".
 */
export function deriveD2(rows: readonly ReviewRow[], axis: string, observedAt: string): D2[] {
  const bySubject = new Map<string, ReviewRow[]>();
  for (const row of rows) {
    const s = subjectOf(row);
    bySubject.set(s, [...(bySubject.get(s) ?? []), row]);
  }

  const out: D2[] = [];
  for (const [subject, subjectRows] of [...bySubject].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const category of CATEGORIES) {
      out.push(D2Schema.parse(one(subject, axis, category, subjectRows, observedAt)));
    }
  }
  return out;
}

function one(subject: string, axis: string, category: Category, rows: readonly ReviewRow[], observedAt: string) {
  const findings = rows.flatMap((r) =>
    r.findings
      .filter((f) => f.category === category)
      .map((f) => ({ f, ref: `${r.url}@${r.head_sha}` })),
  );
  const ruled = findings.filter(
    ({ f }) => f.verdict === "confirmed" || f.verdict === "refuted" || f.verdict === "uncertain",
  );
  const undecided = ruled.filter(({ f }) => f.verdict === "uncertain");

  // Quoted, never synthesised. The first note in a stable order, so two readers
  // of the same corpus cite the same one.
  const notes = undecided
    .map(({ f }) => (f.skeptic_note ?? "").trim())
    .filter((n) => n.length > 0)
    .sort();
  const quoted = notes[0];

  if (undecided.length > 0 && quoted === undefined) {
    throw new Error(
      `${subject} ${category}: ${undecided.length} undecidable finding(s) and no skeptic_note to quote; ` +
        `grounds are quoted, never invented`,
    );
  }

  const grounds =
    ruled.length === 0
      ? `category ${category} never came up in this corpus; the zero is an absence of findings, not an absence of a blind spot`
      : undecided.length === 0
        ? `category ${category} came up ${ruled.length} time(s) and was all ruled`
        : (quoted as string).slice(0, NOTE_LIMIT);

  return {
    schema_version: RECORD_SCHEMA_VERSION,
    subject,
    axis,
    kind: "D2" as const,
    self_asserted: false as const,
    observed_at: observedAt,
    unestablished:
      ruled.length === 0
        ? "this category produced no ruled findings here; whether the subject can rule it is unknown, not answered"
        : `grounds quote one of ${undecided.length} note(s); findings with no verdict are excluded entirely, since an absent judge is not an inability to judge`,
    category,
    verdicts: {
      undecidable: undecided.length,
      total: ruled.length,
      refs: [...new Set(undecided.map((u) => u.ref))].sort(),
    },
    grounds,
    resolvable_by: "more-evidence" as const,
  };
}

/**
 * A refused join is undecidable, not absent.
 *
 * The honest answer to "whose work was judged?" when the corpus does not say is
 * that it cannot be ruled, and `more-evidence` names what would settle it: a
 * judged row carrying the finder.
 *
 * Filed under `logic` because the schema requires a defined category and a
 * refused join has none. A known wart, recorded in the plan; a category-free D2
 * kind belongs to the matching-engine spec if refusals ever need their own
 * listing.
 */
export function refusalD2(r: Refusal, subject: string, axis: string, observedAt: string): D2 {
  return D2Schema.parse({
    schema_version: RECORD_SCHEMA_VERSION,
    subject,
    axis,
    kind: "D2" as const,
    self_asserted: false as const,
    observed_at: observedAt,
    unestablished:
      "establishes nothing about the subject's ability; it records that this corpus cannot attribute one judged row",
    category: "logic" as const,
    verdicts: { undecidable: 0, total: 0, refs: [`${r.url}|had_graph=${r.had_graph}`] },
    grounds: `${r.grounds}; candidates: ${r.candidates.join(", ") || "none"}`,
    resolvable_by: "more-evidence" as const,
  });
}
