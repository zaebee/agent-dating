# Deficit profile — design

**Status:** v3.5. Approved in brainstorming, revised after two rounds of external
review and once by implementation.
**Scope:** sub-project 1 of 4. This specifies *the profile*, the rules that
derive it, and the rules that decide whether a derived observation is
admissible. It does not specify the matching engine's implementation, the run
harness, or the market — those are separate specs and are named in §10.

Written in English to match the neighbouring repositories (`../hivemark`,
`../p-e`, `../aura`), whose documentation this one constantly cites.

**What changed in v2.** An external review found the noise criterion had been
deferred to the wrong document. Checking that against the corpus found two
larger problems the review had not: the published pair count was produced by a
join weaker than §5.2 mandates, and the grounds data shows the corpus's
undecidability is monolithic, which changes which metric this axis should be
measured on. Both are fixed below, and the honest result is stated in §5.6:
**this corpus supports no admissible D1 observation at all.**

**What changed in v3.** A second review round, mostly operational precision.
`uncertain_rate` now has a written formula and an explicit per-pair-not-pooled
rule (§5.1); sign normalisation is a derivation step rather than a property of a
type (§5.2 step 4); invariant 2 became a mechanical field-classification check
instead of a sentence a human must remember; supersession and the treatment of
later-added pairs are specified (§5.7). Two items were declined with reasons —
a leave-one-out stability gate, which gate 1 already implies, and a retention
policy, which would delete the records a raised floor must re-evaluate. One
claim of v2 was wrong and is corrected: `ontology` was cited as a category that
never came up, and it came up five times and was ruled every time (§5.4). The
floor of five in §5.5 is now labelled a convention rather than given a
justification that did not hold.

**What changed in v3.5.** Implementation found the corpus does not carry an
empty-string `arm`: 45 rows have no `arm` field at all. Corrected in §5.2 step 3.

---

## 1. The problem

Agent registries — A2A Agent Cards, AGNTCY's Agent Directory, and every
marketplace built on them — are catalogues of **self-declared capability**. An
agent states what it does, and a consumer searches that statement. The statement
costs nothing to make, so it carries no information, and the ranking problem is
then solved with reputation and payment-graph heuristics bolted on afterwards.

A different question has no catalogue at all: **what is this agent missing, and
who measurably supplies it?** Not "who does code review" but "whose review
demonstrably improves when an adversarial skeptic is attached", or "where does
this agent return no verdict at all, such that a second party is structurally
required".

That question cannot be answered by self-declaration, for the same reason
capability cannot: a free-text "I need a harsh critic" is a vibe. It has to be
**measured as a delta under withholding** — which is ablation, an instrument
`../hivemark/src/ablation.ts` already implements.

## 2. What a deficit is, and the three kinds

A deficit belongs to a **pair** — a subject and a withheld resource — and never
to an agent alone. `ablation.ts` states the constraint that forces this:

> This is deliberately not a track record and must never be presented as one.
> It is a claim about the graph, not about a reviewer.

"The graph yields +k findings" is not "this reviewer is blind without a graph".
The design honours that by making the resource axis part of every observation's
identity, and by never aggregating across axes (§7.5).

| | name | source | strength |
|---|---|---|---|
| **D1** | measured blind spot | ablation pair, independent judge | measured, falsifiable |
| **D2** | undecidable region | `uncertain` verdicts with cited grounds | observed |
| **D3** | declared want | the agent wrote it | self-asserted, costs nothing |

D3 is retained deliberately. "I want a divergent partner at temperature ≥ 1.2"
is a legitimate thing to publish and cannot be measured today. It is a
first-class record, always flagged, and constrained only at ranking time (§7).
**D3 never promotes.** A later measurement on the same axis creates a D1; the D3
remains its own record, unchanged, and the two are never merged.

**D2 is not a weak D1.** D1 says "I do worse without X". D2 says "I returned no
verdict here, on these grounds". `../p-e/SPEC.md` separates G1, G2a and G2b for
this reason, and G2b — "the binding survives the author" — is answerable by
*nobody* without an independent party.

But see §5.4: on the present corpus, D2 is **not** the G2b case. Every recorded
instance is a want of context, not a want of authority. The distinction is kept
in the schema because the two demand different partners, and conflating them
would route work to agents who cannot help.

## 3. Placement

The overlay lives in this repository and reads `../hivemark`'s published
artifacts as an external consumer. It writes nothing there.

1. **hivemark's charter is narrow and stated.** Its README: "it does not review
   code, does not judge findings, and does not modify Guardian." A deficit
   overlay is a fourth thing it does not do.
2. **Identity there is content-addressed and immutable.** `variation.ts`:
   "a body that answered to confirmations would show a fixed identity as
   mutable." A deficit profile grows with every run, so it cannot be part of the
   genome, and keying it externally makes that structural rather than a
   convention someone later forgets.
3. **The claim is about a pair, not a subject** (§2), so it is not hivemark's
   subject matter even in principle.

The overlay is the working store. Admissible observations are additionally
published as `../p-e` records (§8), which is where I-8, provenance and
attestation come for free. This mirrors hivemark's own split: compute locally,
attest outward.

## 4. Schema

### 4.1 Envelope

```ts
interface Envelope {
  /**
   * Integer, not semver. Bump when the field set of any record kind changes.
   * Deliberately not `major.minor`: a minor component asserts that
   * non-breaking changes to an evidential record exist, and they do not — a
   * reader that ignores a new field reads a different claim than the writer
   * made. Matches GENOME_SCHEMA_VERSION in ../hivemark/src/genome.ts, which is
   * an integer for the same reason.
   *
   * A bump does not migrate prior observations. They keep their version and
   * are never compared across versions (§4.5, invariant 5).
   */
  schema_version: number;
  /** hivemark identity_id — the subject held fixed. */
  subject: string;
  /** Registry key. See 4.5, invariant 1. */
  axis: string;
  kind: "D1" | "D2" | "D3";
  /** true only for D3. The sole place this value may be true. */
  self_asserted: boolean;
  /** ISO-8601 with an explicit offset. Validated, not trusted. See 4.5. */
  observed_at: string;
  /** I-8. Required, no default. See 4.5, invariant 6. */
  unestablished: string;
}
```

### 4.2 D1 — measured blind spot

```ts
interface D1 extends Envelope {
  kind: "D1";
  /** Both values are registry keys on this axis, as `axis` itself is. */
  resource: { present: string; absent: string };
  pairing: {
    /** Fields held equal. Mechanical distance-1 check. See 4.5, invariant 2. */
    key: string[];
    pairs: number;
    /**
     * Pairs whose difference is non-zero **after** the rounding of invariant 4.
     * Ties carry no directional evidence, and a difference of 1e-5 is a tie:
     * counting it would let float noise inflate the count gate 2 turns on.
     */
    informative_pairs: number;
    /**
     * One entry per pair, `${url}@${head_sha}`. See 4.5, invariant 3.
     *
     * Not self-sufficient for replay: it omits `finder_model` and the arm
     * labels, which live in `pairing.key` and `resource`. Replay takes the
     * whole D1 record, never this list alone. Kept narrow deliberately — the
     * list is one line per pair and repeating the key on each would invite the
     * two to disagree.
     */
    instances: string[];
  };
  metric: {
    name: string;
    direction: "higher-better" | "lower-better";
    /** Rounded to 4 decimal places before storage. See 4.5, invariant 4. */
    with: number;
    without: number;
    /**
     * Normalised: positive always means the resource helped, whatever
     * `direction` says. Derivation applies the sign (§5.2, step 5); nothing
     * downstream re-applies it. `spread` is normalised the same way, so its
     * endpoints are comparable with `delta` and gate 1 needs no special case.
     */
    delta: number;
    /** min..max of the per-pair normalised difference. Required. */
    spread: [number, number];
  };
  judge: {
    id: string;
    /**
     * Version of the reference set scored against, or null for a
     * verdict-derived metric, which has no reference set. Null is a state, not
     * a missing value: `uncertain_rate` is computed from the skeptic's own
     * verdicts, so `id` names the skeptic and there are no goldens to version.
     * A non-null value on a verdict-derived metric is refused.
     */
    goldens_version: string | null;
    /** true if the subject judged itself; the record then ranks as D3. */
    self: boolean;
  };
  /** Set by §5.5. An inadmissible observation is stored, never ranked. */
  admissible: boolean;
  /** Which gate rejected it. Empty iff admissible. */
  inadmissible_because: string[];
}
```

### 4.3 D2 — undecidable region

Not an ablation, and it carries no metric.

```ts
interface D2 extends Envelope {
  kind: "D2";
  verdicts: { undecidable: number; total: number; refs: string[] };
  /** Quoted from skeptic_note, never synthesised. See 4.5, invariant 7. */
  grounds: string;
  /**
   * Which kind of partner could resolve it — the field that decides who is
   * matched, so it is separate from the prose above and machine-checkable.
   * See §5.4 for what the corpus actually contains.
   */
  resolvable_by: "independent-party" | "more-evidence" | "unknown";
}
```

### 4.4 D3 — declared want

```ts
interface D3 extends Envelope {
  kind: "D3";
  self_asserted: true;
  want: string;
}
```

### 4.5 Invariants

Each is checked at write time. A record failing any of them is refused, not
repaired — the discipline `genome.ts` applies to whitespace, where a silent
repair "lets the same broken value go on to do something else later, somewhere
that does not repair it".

1. **`axis` and the two `resource` values resolve in the axis registry.** The
   registry is a checked-in file; adding an entry is a deliberate act with a
   review. A closed enum is not used, because §9 requires new axes. Unregistered
   or case-variant values are refused: `"context.graph"` and `"Context.Graph"`
   would otherwise be two axes, which is the failure `genome.ts` documents for
   model names, where a trailing space yields "two owner addresses, two track
   records, two birth attestations, for one reviewer".

2. **Every field of a paired row is classified, and an unclassified field fails
   the load.** Three classes, declared per axis in the registry:

   - **identifying** — must be equal across the pair and must appear in
     `pairing.key`;
   - **the resource** — must differ across the pair, and differ exactly as
     `resource.present` / `resource.absent` say;
   - **incidental** — may differ and is ignored (`duration_s`,
     `prompt_tokens`, `reviewed_at`, the findings themselves).

   A field appearing in the rows and in none of the three classes **fails the
   load**. This is `corpus.json`'s rule transposed from files to fields — "a
   new file that appears in neither `include` nor `exclude` fails the load
   rather than being silently ignored" — and it is what makes this invariant
   mechanical rather than cultural. "The key covers everything that varied" is
   a sentence a human must remember to check; "an unclassified field fails the
   load" is a check that runs.

   §5.6 records the worked case of the cultural version failing: it failed
   inside this document, in v1, in the section that states the invariant.

3. **`informative_pairs ≤ pairs` and `pairs == len(instances)`.** No
   truncation of `instances` is permitted; a reader must be able to recompute
   every pair. `instances` entries are `${url}@${head_sha}`, which is
   content-addressed on the side that matters.

4. **Floats are rounded to 4 decimal places before storage and compared only
   after rounding.** `spread` endpoints and `delta` participate in gate
   decisions (§5.5), and a gate that turns on the sixteenth bit of a float is
   not reproducible across readers.

5. **Observations of different `schema_version` are never compared or pooled**,
   and the same holds for different `judge.goldens_version` on the same axis
   and metric. A change to how `delta` or `key` is computed makes old records
   answer a different question, and so does re-scoring against a revised
   reference set; silently mixing either is the one error this design cannot
   detect afterwards — the reason `genome.ts` gives for forking every identity
   on a schema bump. Pairs scored against different goldens are not pairs.

6. **`unestablished` is required, has no default, and absent ≠ empty.** Absent
   fails the build; empty is refused. This is I-8 (`../p-e/src/checks/i8.ts`)
   ported directly — "the field is required by the collection schema, so an
   entry that could not fill it would not build" — and the non-collapse rule is
   the bug `../p-e/src/adapters/apex.ts` documents in its own comment: `?? ""`
   made "the producer did not publish this" indistinguishable from "the producer
   published nothing here", latent on that corpus and due to fire silently on
   the first entry that omitted the field.

7. **`grounds` is non-empty and quoted.** An empty or whitespace-only
   `skeptic_note` yields no D2 — the finding is skipped and counted in
   `unestablished`. On the present corpus all 89 `uncertain` findings carry a
   note (65–278 characters), so this fires on new data, not old.

8. **`observed_at` parses.** Validated with the check `../hivemark/src/schema.ts`
   applies to `reviewed_at`, and for its stated reason: an unparseable value
   reaches `Date.parse` as `NaN`, "where every comparison is false and the first
   record silently wins".

There is no aggregate. No `deficit_score`, no vector norm, no completeness
percentage. §7.5 says why, and §9 says how that is enforced rather than
requested.

## 5. Derivation

### 5.1 Choosing the metric for an axis

An axis is measured on the metric that its own D2 grounds implicate. This is a
rule, not a preference, and §5.4 is why: if the recorded reason an agent cannot
rule is "the needed code was not in the diff", then a resource that supplies
code beyond the diff should be measured on **whether it reduces non-ruling** —
not on whether it raises recall against goldens, which moves for many unrelated
reasons.

Applied to `context.graph`, the metric is `uncertain_rate`, direction
`lower-better`. Recall remains a legitimate metric on other axes; it is simply
not the one this axis's evidence points at, and on this corpus it is
unavailable anyway (§5.3).

**`uncertain_rate`, exactly.** Per review, over findings that carry a verdict:

```
ruled(r)           = { f ∈ r.findings : f.verdict ∈ {confirmed, refuted, uncertain} }
uncertain_rate(r)  = |{ f ∈ ruled(r) : f.verdict = uncertain }| / |ruled(r)|
```

Findings with a null verdict are excluded from both numerator and denominator,
because a null verdict means the skeptic did not rule and §5.4 forbids reading
that as either an answer or an inability to answer. A review where
`|ruled(r)| = 0` yields no rate and its pair is dropped with the drop recorded
in `unestablished`.

**The rate is computed per review and differenced per pair; it is never pooled
then differenced.** Pooling first weights reviews by how many findings they
happened to produce, and the arms differ sharply in exactly that — 14.1
findings per review in the graph arm against 3.3 in the ablated one (§5.6) — so
a pooled difference would be dominated by the arm that talks more. Gate 1 and
gate 2 both operate on the per-pair differences, so this is not a presentation
choice: pooling would change which observations are admissible.

### 5.2 D1, in five steps

**Step 1 — the metric comes from an independent judge, never from a raw finding
count.** A raw count rewards verbosity. Where the metric is computed from
verdicts rather than from a judge's scoring of goldens, the skeptic is the
independent party, and `judge.self` must be false.

**Step 2 — pair on a key that holds everything else equal.** Required key
fields: `url`, `head_sha`, `finder_model`, and, when the metric comes from a
scoring file, `judge_model` and `profile`. **A record missing any key field
fails the load; it is never dropped.** `corpus.json` states the principle: "A
new file that appears in neither fails the load rather than being silently
ignored — silent omission is the direction that costs a permanent record."

**Step 3 — read `arm`, never `context_mode`.** A deliberate divergence from
hivemark, and it must be carried by a test that fails if someone "fixes" it, in
the manner of `../hivemark/tests/schema.test.ts`, which compares against the
upstream JSON Schema so that "a drift upstream fails the build rather than
corrupting a track record". `genomeOf` derives `context_mode` from `had_graph`,
so a deliberately ablated run and a plain diff-only run land in one identity;
`breeding.md` acknowledges it ("a controlled removal and a plain diff-only run
are one bee here") and is right to, because for a *track record* the question is
how the review was performed. For deficit derivation it is fatal: the ablated
arm is controlled and plain diff-only is confounded.

The corpus carries two `arm` values — `"graph"` (51 rows) and `"ablated"` (19) —
and **45 rows where the field is absent entirely**, which is "nobody planned
this either way". Absent, not blank: no row carries an empty string. `arm` is
therefore optional in the reader and is never defaulted, because `.default("")`
would make an unplanned run indistinguishable from a planned one written blank.

> v2 of this document said the corpus carried three values including the empty
> string. It does not. That reading came from joining `undefined` into a string
> during the measurement — the `?? ""` collapse this document cites
> `../p-e/src/adapters/apex.ts` for, committed in the section that specifies
> invariant 6. Recorded rather than deleted, for the reason §5.6 gives for the
> other one.

**Step 4 — normalise the sign.** The per-pair difference is computed as
`with − without` and then multiplied by `−1` when `direction` is
`lower-better`, so that a positive value always means the resource helped. The
same multiplier is applied to both `spread` endpoints, which are then re-ordered
so the pair stays `[min, max]`. This happens once, in derivation; no consumer
re-applies `direction`, and none may.

For `context.graph` / `uncertain_rate` this inverts the raw figure: a raw
`graph − ablated` of `−0.2593` — the graph left less unruled — is stored as
`delta: +0.2593`.

**Step 5 — emit one D1 per `(subject, axis, metric, judge, goldens_version)`**,
carrying `pairs`, `informative_pairs` and `spread`, then evaluate §5.5.

### 5.3 The join that must be refused, and what it costs

Judged rows carry `url`, `had_graph`, `judge_model`, `profile`. They carry
neither `finder_model` nor `head_sha`, so they must be joined back to review
rows — and **19 of 64 `(url, had_graph)` buckets contain more than one finder
model**.

**Rule: an ambiguous join is refused, not resolved by picking**, and the
refusal is deterministic — identical input yields an identical D2 with identical
grounds, so two readers of the same corpus produce the same overlay.

Applying it to the corpus: **46 of 117 judged rows are refused, and zero recall
pairs survive.** Recall-based D1 on this corpus is not noisy; it is
**unavailable**. Each refused row emits a D2 with
`grounds: "judged row does not name the finder"`,
`resolvable_by: "more-evidence"`.

This is the first place the three-kind split pays for itself: the honest answer
to an ambiguous join is "undecidable", and the schema has somewhere to put it.

### 5.4 D2, and what the grounds turn out to say

Source: claims with verdict `uncertain`, grouped by finding `category`, with
`grounds` quoted from `skeptic_note`. Over the corpus:

```
932 findings → confirmed 760 · uncertain 89 · refuted 83
uncertain by category:  logic 49 · types 14 · contract 13 · tests 12 · security 1 · ontology 0
skeptic_note present on all 89; length 65 / 156 / 278 (min / median / max)
```

**The grounds are monolithic.** Every one of the 89 says a variant of the same
thing: the definition, interface, or file needed to verify the claim was not in
the provided diff. Samples, verbatim:

> "The definition of StatefulDetectorHandler is not present in the provided diff
> hunks, so we cannot verify if build_occurrence_and_event_data is indeed an
> unimplemented abstract method."

> "The claimed defect depends on the method signature of createEvent and the
> definition of the Calendar interface, neither of which are visible in the
> provided diff hunks."

Two consequences.

**A grounds taxonomy is not built.** An external review proposed embeddings with
a similarity threshold, or a taxonomy, to decide when two agents' grounds are
incompatible (§7.4). On a corpus with one ground, a taxonomy has one element and
a threshold has nothing to separate. `resolvable_by` carries the distinction
that matters today as a three-valued flag, and a taxonomy is built when a second
ground is observed — not before.

**The whole corpus's D2 is `more-evidence`, not `independent-party`.** No
recorded instance is the G2b case. This does not remove the distinction from the
schema — it is real, `../p-e` has a standing instance of it in I-5, and the two
demand different partners — but it means the matching rule in §7.4 is currently
exercised by nothing here, and must not be presented as validated.

Two prohibitions, both following from code next door:

**`unresolved` never becomes D2, and becomes nothing at all.**
`../hivemark/src/claims.ts`: Guardian leaves `verdict` null when the skeptic did
not run, and "that absence must never be read as confirmation". The symmetric
rule, which this spec adds: absence of a judge is not inability to judge. D2
means *examined and not resolved*, never *not examined*. A review with no
skeptic contributes no D2 and no D1 on any verdict-derived metric, and the
finding count it contributes is recorded in `unestablished`. Latent on the
present corpus — a skeptic ran on all 115 reviews — and it fires on the first
run without one.

**A zero in a category is not the absence of a blind spot.** `ontology: 0` may
mean "nothing was undecidable" or "the category never came up". These are
different, and an untouched category must never read as a strength.

`unestablished` is per-observation and so cannot carry this on its own — a
category that produced no findings produces no observation to carry anything.
So a D2 is emitted **per `(subject, axis, category)` for every category the
finding schema defines**, not only for those with undecidable findings, and
`verdicts.total` distinguishes the two cases: `total = 0` is "never came up",
`total > 0, undecidable = 0` is "came up, all ruled". Absence of a D2 for a
defined category means the derivation did not run, and is refused at write time.

Per category on this corpus, totals beside undecidables:

```
logic 672/49 · tests 91/12 · contract 90/13 · types 71/14 · ontology 5/0 · security 3/1
```

Both thin categories are the *second* case, not the first: `ontology` came up
five times and was ruled every time. No category has `total = 0` here, so the
"never came up" branch is specified and unexercised — stated because a reader
checking these numbers will otherwise conclude the branch is dead code.

### 5.5 Admissibility

Two gates. Both are properties of the evidence, not parameters of a ranking, so
both live here and not in the matching-engine spec. An observation failing
either is **stored with `admissible: false`** and never enters the exploitation
queue; storing it matters, because it is what tells the exploration queue this
question has already been asked (§7.3).

**Gate 1 — `spread` must not span zero.** If the per-pair difference is positive
somewhere and negative somewhere else, the resource helped and hurt the same
subject on the same axis, and the mean is a summary of a disagreement rather
than a measurement. Non-parametric, computable, and requires no distributional
assumption the corpus cannot support.

**Gate 2 — `informative_pairs ≥ 5`.** Ties carry no directional evidence, so the
count that matters excludes them.

**Five is a declared convention, not a derived threshold, and is labelled as
such rather than dressed up.** An earlier draft justified it as the point below
which "a single reversed pair flips the direction of the majority". That
reasoning is wrong: the observation is a signed mean under gate 1, not a
majority vote, and a reversed pair cannot occur at all once gate 1 holds. No
honest statistical floor is available either, because deriving one needs a
distributional assumption about per-pair differences that a corpus yielding two
informative pairs cannot support. So the floor is a convention, chosen to be
small enough that early axes can clear it and large enough that a handful of
reruns is not a profile. It is revisable upward by the matching-engine spec and
never downward, and §5.7 makes a raise re-evaluate stored observations rather
than grandfather them.

**Leave-one-out is not added, because gate 1 already implies it.** A stability
test — does the sign survive dropping any one pair — was proposed in review.
Under gate 1 every informative pair shares a sign, so dropping one leaves the
sign intact whenever `informative_pairs ≥ 2`; at a floor of 5 the test can never
fire. It would be a gate that rejects nothing, which is worse than no gate,
because a reader would take it for protection.

### 5.6 What the corpus yields today

Measured over `../ownima/codegraph-brain/benchmarks` on 2026-09-22 — 115 review
rows, 932 findings, 117 judged rows, 5 projects, 2 finder models, 2 judge
models. The ablated arm is 19 reviews, **all `gemini-2.5-flash`**, so on
`context.graph` this corpus can speak about exactly one identity; every other
profile on that axis is empty, and that is a correct emptiness, not a zero.

**On `recall` — no observation exists.** 46 of 117 judged rows are refused by
§5.3 and zero pairs survive.

> v1 of this document published "19 pairs, mean Δrecall +0.078, spread
> [−0.500, +0.500]" and called it noise. Those pairs were joined on `url` alone,
> which is weaker than the key §5.2 mandates, because the judged rows carry
> neither `head_sha` nor `finder_model`. Under this document's own rule the
> figure was inadmissible, and the error is recorded rather than deleted because
> it is the exact failure invariant 2 exists to prevent, committed inside the
> document that specifies the invariant.

**On `uncertain_rate` — one observation, inadmissible.** Keyed strictly on
`url + head_sha + finder_model`, computed from review rows directly, which carry
every key field:

```
strict pairs                         6
raw (graph − ablated)                mean −0.2593   spread [−1.000,  0.000]
stored, sign-normalised (§5.2 step 4) delta +0.2593  spread [ 0.000, +1.000]
                                     graph better 2 · worse 0 · tied 4
informative_pairs                    2
```

Gate 1 passes: the spread does not span zero, and the graph never made things
worse. Gate 2 fails: 2 informative pairs against a floor of 5.

**The arm-level rates are confounded and are not evidence.** For completeness:
55/721 = 0.0763 unruled in the graph arm against 11/63 = 0.1746 in the ablated
one. The ratio is suggestive and must not be used. The two arms cover different
URL sets, and the arms differ in findings per review by more than four times
(14.1 against 3.3), which is the weighting problem §5.1 rejects pooling for.
They are printed here because a reader who computes them independently should
find them already accounted for, not because they support anything.

**So the corpus supports no admissible D1 at all**, and the two candidates fail
on different gates — which is the argument for having both. The profile for
`gemini-2.5-flash` on `context.graph` today is: one inadmissible observation
with a direction worth pursuing, and an exploration entry saying how many more
informative pairs would settle it.

That is the design working. A schema built around a single compatibility number
would have published "+0.08 graph affinity", and it would have survived, because
a number reads as settled when nothing beside it shows the width.

### 5.7 Adding pairs later, and supersession

Observations are immutable. Running more pairs on the same
`(subject, axis, metric, judge, goldens_version)` **emits a new observation over
the enlarged instance set; it never edits the old one**, and both are kept.

An observation supersedes another when it covers a superset of its `instances`
and is later. Supersession is **recomputed by any reader from the stored records
alone** rather than written down as a flag, which is `../hivemark/src/supersede.ts`'s
design and its reasoning transfers exactly:

> Signing only the newest would bake one scoring policy into a permanent record
> and make re-scoring under another impossible. Since the distinction is
> recomputable by any reader, nothing is lost by publishing both and marking
> which is which.

Here the "scoring policy" is the gate-2 floor, which §5.5 says is revisable
upward. A raise re-evaluates every stored observation, admissible and not — so
an observation admitted under a floor of 5 can become inadmissible under 8, and
that must be a recomputation over retained records, not a migration over records
someone deleted because they were inadmissible at the time.

This is also the answer to overlay growth, raised twice in review: **nothing is
deleted, and that is load-bearing rather than lazy.** A retention policy that
discarded inadmissible observations would delete precisely the records the
exploration queue reads (§7.3) and precisely the records a raised floor must
re-evaluate. The overlay grows at the rate of funded runs, which §7.6 makes
expensive by construction.

## 6. Distance

Distance is measured between the subject's configuration **as already run** and
the configuration a proposal **would run**. Supplying a partner's resource must
change exactly one slot; every other slot is held at the value the subject's
existing records carry.

The slots are hivemark's three heritable ones, and the exclusions are its
reasoning, not new:

| slot | in distance | why |
|---|---|---|
| `finder_model` | yes | a choice about how to review |
| `skeptic_model` | yes | ditto; absent and null both mean no skeptic ran |
| `context_mode` | yes | ditto |
| `finder_provider` / `skeptic_provider` | no | "read off the finder model, so crossing them separately would produce impossible reviewers" |
| `review_fingerprint` | no | identity-forming but not heritable: "it is not a choice about how to review — it is the version of the tool that happened to be running" |

Two values differ if they differ after the registry normalisation of invariant 1.
Distance is the count of differing slots. A proposal changing a model *and*
attaching a skeptic is distance 2.

**A proposal that changes `context_mode` must be executed as an explicit
`arm`.** The slot and the field are not the same thing: `context_mode` is
derived from `had_graph` and is what the genome records, while `arm` is what the
run was planned as, and §5.2 step 3 reads `arm` precisely because the two come
apart. A run produced for a distance-1 proposal on this slot and left with the
empty `arm` — "nobody planned this either way" — is unusable as the controlled
side of a pair, whatever its `context_mode` says. The run harness must set the
arm, and derivation must refuse the pair if it did not.

## 7. Ranking

### 7.1 Proposals are ranked, not agents

The unit of the queue is a **proposal**: `(R, S, axis, metric, judge, tasks)`,
whose run produces one D1 observation for R on that axis. This is `proposal` in
hivemark's exact sense — it has an identity the moment it exists, it has no
claims and no track record, and it becomes an entity only by being run.

**A proposal requires a supplier who commits a resource.** A D3 standing alone
is not a proposal and generates no queue entry. This closes the incentive hole
an external review identified: filing D3s cannot by itself draw exploration
spend, because nothing is proposed until a second party commits something
expensive.

### 7.2 Exploitation queue

The requester's interest. Ordered by `delta` **within one axis and one metric**,
restricted to observations with `admissible: true`.

- `metric.delta` is stored already signed so that positive means the resource
  helped (§4.2), so `direction` never needs re-applying at sort time. A
  `lower-better` metric whose delta is positive means the resource lowered it.
- `spread` is displayed on every row and is **not** a sort key, primary or
  secondary. It is a gate (§5.5); making it also a tiebreak would reintroduce
  aggregation by the back door.
- Candidates holding only D3 on that axis appear in a separate section labelled
  declared-not-measured, never interleaved.
- Ties on `delta` break on `informative_pairs` descending, then `observed_at`
  ascending, then `subject` bytewise. Three keys because the first two can both
  tie, and an order that depends on which record a store happened to return
  first is not reproducible — the same reason `../hivemark/src/ablation.ts`
  refuses an arbitrary pick among reruns, "an arbitrary pick would make a
  published number depend on the order the file happened to be read in".

### 7.3 Exploration queue

The platform's interest: uncertainty reduced per unit cost.

- `distance == 1` is a **gate, not a weight** (§6). Distance ≥ 2 is excluded
  outright, because the result is unattributable. `breeding.md` holds this rule
  already and it is binary.
- `novelty` is maximal when no observation exists for
  `(subject, axis, metric)`; otherwise it rises with `spread` width and falls
  with `informative_pairs`. Inadmissible observations count here — an
  observation that failed gate 2 with 2 informative pairs lowers novelty less
  than one that passed with 40, which is what makes "this has been tried and
  did not settle" visible instead of the question recurring forever. Its exact
  form is a ranking parameter, set by the matching-engine spec (§10).
- `cost` is computed, not guessed: review rows carry `prompt_tokens`,
  `completion_tokens` and `duration_s`.

Cold start needs no separate mechanism. A new identity holds only D3, so it is
absent from the exploitation queue, and it enters exploration only when a
supplier proposes against it (§7.1).

### 7.4 D2 matches by filter, not by sort

> Candidate S addresses R's D2 on an axis only if S's `grounds` there are
> **incompatible** with R's. Matching grounds are excluded.

Matching grounds mean the second party is stuck in the same place, and the pair
would burn a paid run reproducing a dead end.

Operationally, and only as far as the evidence supports: incompatibility is
decided on `resolvable_by`, not on the prose. A `more-evidence` D2 is addressed
by a supplier who brings evidence; an `independent-party` D2 is addressed only
by a party that is not the subject. Comparison of the prose in `grounds` is
**not** implemented, because §5.4 found one ground across all 89 instances and
there is nothing yet to separate. When a second ground is observed, this section
gains a taxonomy; until then a similarity threshold would be a parameter fitted
to a single point.

**This rule is currently weak, and that is a property of the evidence, not a
reading of the text.** Every D2 the corpus yields is `more-evidence`, so the
filter admits any supplier claiming to bring evidence and excludes almost
nobody. It is written as a rule because it is the rule, but it must not be
cited as a validated mechanism: nothing here has exercised it. The first
observed `independent-party` ground is what turns it from a stated rule into a
tested one.

### 7.5 Absent by construction

No global score. No comparison across axes. No comparison across metrics. No
"profile 78% complete", which would reward D3 spam. And no volume or popularity
signal: ranking by volume is what a Sybil farm optimises for, and defeating it
is the entire subject of TraceRank (arXiv 2510.27554).

### 7.6 The gate that stops it running away

Proposals are generated automatically. **Runs are not.** From `breeding.md`:
automated selection is refused because each evaluation costs a paid LLM run.
From `../agents/gardener.md:161`: "Tyrant Queen | Code generation without tests"
sits in the anti-pattern table at penalty −4, its heaviest — a queen reproducing
faster than anything can check her offspring. The queue is a list of work items;
authorisation to run comes from something expensive: payment, or a human.

This is where the swipe lands, and it is the only swipe in the design. A swipe
is **authorising and funding a run**. It is costly by construction, which is why
it is a credible signal, which is why it is also the spam defence and the raw
material for reputation. Swiping was not discarded; it was moved to where it has
a price. Its semantics — who may swipe, whether one proposal or a batch, and
what a failed run owes — belong to the market spec (§10).

## 8. Publication

A run appends its D1/D2 to the overlay. Admissible observations are additionally
published as `../p-e` records, which supplies I-8, provenance and attestation
without this repository reimplementing any of them.

```
proposals → (funded run) → D1/D2 observations → overlay → proposals
                                  ↓
                         admissible → published to p-e
```

One level above hivemark's own loop, `reviews → claims → track records →
proposals → reviews`.

## 9. Extension beyond code review

The evidence unit is `ReviewRecord` and the corpus is hivemark's, by decision.
Extension to other task classes is provided for by shape: `metric: { name,
direction, … }` rather than a `findingsCount` field means a new axis is a new
registry entry, a new metric and a new judge — not a schema change.

The honest cost, stated now: **the hard part of generalising is the judge, not
the schema.** Code review has a cheap one — a skeptic pass emitting
confirmed/refuted/uncertain. "Did memory help?" has none, and one must be
devised per task class. Extension is gated on that, and on nothing in this
document. No worked example for such an axis appears here, deliberately: an
example judge for a task class nobody has built would be invention presented as
specification.

**Deficits on different metrics are incomparable, and this is enforced by the
shape of the interface rather than by a rule anyone must remember.** The
ordering function accepts exactly one `(axis, metric)` pair and returns an order
within it. A cross-axis query is not forbidden — it is inexpressible, so
`global_score` cannot be written without first changing the signature, which is
a reviewable act.

The limit of that enforcement, stated so nobody mistakes it for a guarantee: a
client can call the function twice and merge the two orders itself. Nothing here
prevents that, and nothing could. What the signature buys is that the merge must
be written by someone, in their own code, rather than obtained by calling an API
that offers it — the difference between a deliberate act and a default.

## 10. Out of scope

Named so the boundary is explicit; each is its own spec and its own cycle:

1. **Matching engine** — the implementation of §7, its storage, its query path,
   the exact form of `novelty`, and any raising of the §5.5 gate-2 floor.
2. **Run harness** — executing an authorised proposal and writing the result
   back, including what a failed or poisoned run produces, and setting the
   `arm` a distance-1 proposal on `context_mode` requires (§6).

   **Admissible does not imply honest, and this document cannot make it so.**
   Adversarial ablation — a supplier who systematically degrades the withheld
   arm — manufactures observations that pass both gates of §5.5 once enough
   pairs accumulate, because the gates test whether evidence is self-consistent,
   never whether it was produced in good faith. Gate 1 in particular is
   *easier* to pass for a manipulated arm than an honest one, since consistent
   degradation never crosses zero. The defence is not a gate; it is that the
   supplier does not judge (`judge.self`), that instances are recomputable by
   anyone (invariant 3), and that runs cost money (§7.6). Making that defence
   actual is the run-harness and market specs' problem, and it should be taken
   up early rather than after the first funded axis.
3. **Market** — payment, escrow, dispute and swipe semantics, over `../aura`'s
   `NegotiationService` (`Negotiate`, `OfferAccepted`/`Countered`/`Rejected`,
   `CryptoPaymentInstructions`, `dispute_token`).
