import { genomeOf } from "hivemark/src/genome.js";
import { identityId } from "hivemark/src/identity.js";
import type { ReviewRow } from "./corpus.js";

/**
 * The hivemark identity a review row belongs to.
 *
 * Imported, never reimplemented. `genomeOf` refuses padded model names because
 * a trailing space mints a second identity "permanently once a birth is
 * announced"; a copy of that logic here would drift, and a drifted copy splits
 * one reviewer into two subjects with no way to notice. The cost of the import
 * is a `file:` dependency on a sibling repository, which is cheaper than the
 * failure it prevents.
 */
export function subjectOf(row: ReviewRow): string {
  // hivemark's ReviewRecord is structurally what corpus.ts already validated.
  return identityId(genomeOf(row as never));
}
