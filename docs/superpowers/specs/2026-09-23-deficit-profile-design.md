# Deficit profile — design

**Status:** approved in brainstorming, not implemented.
**Scope:** sub-project 1 of 4. This specifies *the profile* and the rules that
derive it. It does not specify the matching engine's implementation, the run
harness, or the market — those are separate specs and are named in §9.

Written in English to match the neighbouring repositories (`../hivemark`,
`../p-e`, `../aura`), whose documentation this one constantly cites.

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
identity, and by never aggregating across axes (§6).

| | name | source | strength |
|---|---|---|---|
| **D1** | measured blind spot | ablation pair, independent judge | measured, falsifiable |
| **D2** | undecidable region | `uncertain` verdicts with cited grounds | observed, structural |
| **D3** | declared want | the agent wrote it | self-asserted, costs nothing |

D3 is retained deliberately. "I want a divergent partner at temperature ≥ 1.2"
is a legitimate thing to publish and cannot be measured today. It is a
first-class record, always flagged, and constrained only at ranking time (§6).

**D2 is not a weak D1.** D1 says "I do worse without X". D2 says "I return no
verdict here, on these grounds". `../p-e/SPEC.md` separates G1, G2a and G2b for
exactly this reason, and G2b — "the binding survives the author" — is answerable
by *nobody* without an independent party. A deficit of authority is not a
deficit of skill and must not be ranked against one.

## 3. Placement

The overlay lives in this repository and reads `../hivemark`'s published
artifacts as an external consumer. It writes nothing there.

Three reasons, in order of weight:

1. **hivemark's charter is narrow and stated.** Its README: "it does not review
   code, does not judge findings, and does not modify Guardian." A deficit
   overlay is a fourth thing it does not do.
2. **Identity there is content-addressed and immutable.** `variation.ts`:
   "a body that answered to confirmations would show a fixed identity as
   mutable." A deficit profile grows with every run. It therefore cannot be part
   of the genome, and keying it externally makes that structural rather than
   a convention someone later forgets.
3. **The claim is about a pair, not a subject** (§2), so it is not hivemark's
   subject matter even in principle.

The overlay is the working store. Confirmed observations are additionally
published as `../p-e` records (§7), which is where I-8, provenance and
attestation come for free. This mirrors hivemark's own split: compute locally,
attest outward.

## 4. Schema

### 4.1 Envelope

Shared by all three kinds so that provenance and ranking are uniform.

```ts
interface Envelope {
  schema_version: number;
  /** hivemark identity_id — the subject held fixed. */
  subject: string;
  /** Resource axis, e.g. "context.graph", "review.skeptic", "memory.recall". */
  axis: string;
  kind: "D1" | "D2" | "D3";
  /** true only for D3. The sole place this value may be true. */
  self_asserted: boolean;
  observed_at: string;
  /** I-8. Required, no default. See 4.5. */
  unestablished: string;
}
```

### 4.2 D1 — measured blind spot

```ts
interface D1 extends Envelope {
  kind: "D1";
  resource: { present: string; absent: string };   // "graph" / "diff-only"
  pairing: {
    /** Fields held equal. Mechanical distance-1 check. See 4.5. */
    key: string[];
    pairs: number;
    /** Refs, so a reader can recompute. */
    instances: string[];
  };
  metric: {
    name: string;                                   // "recall", "precision"
    direction: "higher-better" | "lower-better";
    with: number;
    without: number;
    delta: number;
    /** min..max of the per-pair difference. Required. See 4.5. */
    spread: [number, number];
  };
  judge: {
    id: string;
    /** true if the subject judged itself; then the record ranks as D3. */
    self: boolean;
  };
}
```

### 4.3 D2 — undecidable region

Not an ablation, and it carries no metric.

```ts
interface D2 extends Envelope {
  kind: "D2";
  verdicts: { undecidable: number; total: number; refs: string[] };
  /** Why it could not be ruled. Quoted from skeptic_note, never invented. */
  grounds: string;
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

### 4.5 Four fields that are not decoration

**`unestablished` is required with no default**, and an absent field and an
empty string do not collapse. Absent fails the build; empty is refused. This is
I-8 (`../p-e/src/checks/i8.ts`) ported directly — "the field is required by the
collection schema, so an entry that could not fill it would not build" — and the
non-collapse rule is the bug `../p-e/src/adapters/apex.ts` documents in its own
comment: `?? ""` made "the producer did not publish this" indistinguishable from
"the producer published nothing here", latent on that corpus and due to fire
silently on the first entry that omitted the field.

**`pairing.key` enumerates what was held equal.** This is the distance-1 rule
made mechanical rather than cultural. If the key does not cover everything that
varied, the observation is confounded, and a confounded observation presented as
a measurement is a lie. As a field it can be checked; as a convention it rots.

**`metric.spread` is required alongside the mean.** `ablation.ts` already
computes `lowest` and `highest`. Without spread, a delta of +2 across [−5, +12]
is indistinguishable from +2 across [+1, +3]. A bare mean *is* the compatibility
score this design refuses, so omitting spread does not simplify the schema — it
reintroduces the thing the schema exists to prevent. §5.2 is the worked case.

**`judge.self`** — a metric computed by the subject about itself has the
evidential weight of a declaration, whatever machinery produced it, and ranks
as D3.

There is no aggregate. No `deficit_score`, no vector norm, no completeness
percentage. §6.4 says why.

## 5. Derivation

### 5.1 D1, in four steps

**Step 1 — the metric comes from an independent judge, never from a finding
count.** The corpus carries `martian-judged.jsonl`: `tp`/`fp`/`fn`/`precision`/
`recall` against goldens, scored by a separate model. hivemark excludes those
files correctly (they are judge output, not reviews), but for deficit derivation
a raw finding count is unusable — it rewards verbosity. Deficit is measured on
`recall` and `precision`.

**Step 2 — pair on a key that holds everything else equal.** Required key
fields: `url`, `head_sha`, `finder_model`, `judge_model`, `profile`.

**Step 3 — read `arm`, never `context_mode`.** This is a deliberate divergence
from hivemark and is recorded as such. `genomeOf` derives `context_mode` from
`had_graph`, so a deliberately ablated run and a plain diff-only run land in one
identity; `../hivemark/docs/breeding.md` acknowledges it ("a controlled removal
and a plain diff-only run are one bee here") and is right to, because for a
*track record* the question is how the review was performed. For deficit
derivation it is fatal: the ablated arm is controlled and plain diff-only is
confounded, and averaging them produces a number attributable to nothing. The
corpus carries three `arm` values — `"graph"`, `"ablated"`, and the empty
string, which is "nobody planned this either way".

**Step 4 — emit one D1 per `(subject, axis, metric, judge)`**, carrying `pairs`
and `spread`.

### 5.2 What the corpus yields today

Measured over `../ownima/codegraph-brain/benchmarks` on 2026-09-22 — 115 review
rows, 932 findings, 117 judged rows, 5 projects:

```
finder models        2      gemini-2.5-flash, mistral-medium-latest
judge models         2      gemini-2.5-flash, mistral-medium-latest
ablated arm          19 reviews, ALL gemini-2.5-flash

paired URLs (graph vs ablated):        19
Δrecall   mean +0.078    spread [−0.500 … +0.500]
          graph better 6 · worse 4 · tied 9
```

**This is not a deficit. It is noise.** At 19 pairs, nine of them ties, and a
spread running the full width of recall in both directions, the graph does not
demonstrate that it closes a blind spot on this corpus.

That result is the design working, not the design failing. The mandatory
`pairs` and `spread` fields surface it on sight. A schema built around a single
compatibility number would have published "+0.08 graph affinity" as a fact, and
it would have survived, because a number reads as settled when nothing beside it
shows the width.

Second consequence: the ablated arm exists for one model only, so on axis
`context.graph` this corpus can speak about **exactly one identity**. Every
other profile on that axis is empty — and that is a correct emptiness, not a
zero.

### 5.3 The join that must be refused

Judged rows carry `url`, `had_graph`, `judge_model`, `profile`. They do not
carry `finder_model` or `head_sha`, so they must be joined back to the review
rows — and **19 of 64 `(url, had_graph)` buckets contain more than one finder
model**. In 30% of buckets it is not determinable whose work was judged.

**Rule: an ambiguous join is refused, not resolved by picking.** This is the
discipline `genome.ts` applies to whitespace — refuse the bad input rather than
silently repair it, because a silent repair lets the broken value go on to do
something else somewhere that does not repair it.

A refused join is not a loss. It emits a **D2** with
`grounds: "judged row does not name the finder"` and
`resolvable_by: "more-evidence"`. This is the first place the three-kind split
pays for itself: the honest answer to an ambiguous join is "undecidable", and
the schema has somewhere to put it.

### 5.4 D2

Source: claims with verdict `uncertain`, grouped by finding `category`. Over
the corpus:

```
932 findings → confirmed 760 · uncertain 89 · refuted 83
uncertain by category:  logic 49 · types 14 · contract 13 · tests 12 · security 1 · ontology 0
```

`grounds` is quoted from `skeptic_note` — carried by 111 of 115 reviews — so the
basis for non-resolution is cited, never synthesised.

Two prohibitions, both following from code in the neighbouring repositories:

**`unresolved` never becomes D2.** `../hivemark/src/claims.ts`: Guardian leaves
`verdict` null when the skeptic did not run, and "that absence must never be
read as confirmation". The symmetric rule, which this spec adds: absence of a
judge is not inability to judge. D2 means *examined and not resolved*, never
*not examined*. Latent on the present corpus — a skeptic ran on all 115 reviews
— and it fires on the first run without one.

**A zero in a category is not the absence of a blind spot.** `ontology: 0` may
mean "nothing was undecidable" or "the category never came up". These are
different, and by I-8 every D2 observation must say in `unestablished` which one
it is. Otherwise an untouched category reads as a strength.

## 6. Ranking

### 6.1 Proposals are ranked, not agents

The unit of the queue is a **proposal**: `(R, S, axis, metric, judge, tasks)`,
whose run produces one D1 observation for R on that axis. This is `proposal` in
hivemark's exact sense — it has an identity the moment it exists, it has no
claims and no track record, and it becomes an entity only by being run.

### 6.2 Two queues, which are never summed

**Exploitation queue** — the requester's interest. Ordered by measured `delta`
**within one axis and one metric**, gated on `pairs ≥ N`, with `spread` shown on
every row. Candidates holding only D3 on that axis appear in a separate section
labelled as declared-not-measured and are never interleaved with measured ones.

**Exploration queue** — the platform's interest. Ordered by uncertainty reduced
per unit cost:

- `distance == 1` is a **gate, not a weight**. Distance is measured between the
  subject's configuration as already run and the configuration the proposal
  would run: supplying S's resource must change exactly one slot, all others
  held at the values the subject's existing records carry. A proposal that
  would change the model *and* attach a skeptic is distance 2 and is excluded
  outright, because its result is unattributable to either. `breeding.md` holds
  this rule already, and it is binary — never a penalty term.
- `novelty` is maximal when no observation exists for
  `(subject, axis, metric)`; otherwise it rises with `spread` width and falls
  with `pairs`. A wide spread over 19 pairs is an invitation to add data, not a
  verdict. Its exact form is a ranking parameter and is set by the
  matching-engine spec (§9), not here.
- `cost` is computed, not guessed: review rows carry `prompt_tokens`,
  `completion_tokens` and `duration_s`.

A weighted sum of these two queues would be precisely the compatibility score
this design refuses. So there is no sum: two lists side by side, and the
requester chooses whether they are buying **an answer** or **a result**. That
choice is also the market's: filling your own deficit, you pay; acquiring
evidence in a domain where you have none, you pay; useful to both, you split.

Cold start needs no separate mechanism. A new identity holds only D3, so it is
absent from the exploitation queue — and carries maximal `novelty` in the
exploration queue, because nothing is known about it. The exploration queue *is*
the on-ramp.

### 6.3 D2 matches by filter, not by sort

For an undecidable region the question is not who improves a metric but who can
rule where the subject cannot.

> Candidate S addresses R's D2 on an axis only if S's `grounds` there are
> **incompatible** with R's. Matching grounds are excluded.

Matching grounds mean the second party is stuck in the same place, and the pair
would burn a paid run reproducing a dead end. This is `../p-e`'s I-5 — two
readers returning `UNDECIDABLE` on incompatible grounds — turned into an
executable rule. It is a filter; among survivors, order by fewest `uncertain`
per finding in that category.

### 6.4 Absent by construction

No global score. No comparison across axes. No comparison across metrics. No
"profile 78% complete", which would reward D3 spam. And no volume or popularity
signal: ranking by volume is what a Sybil farm optimises for, and defeating it
is the entire subject of TraceRank (arXiv 2510.27554).

### 6.5 The gate that stops it running away

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
a price.

## 7. Publication

A run appends its D1/D2 to the overlay. Confirmed observations are additionally
published as `../p-e` records, which supplies I-8, provenance and attestation
without this repository reimplementing any of them.

```
proposals → (funded run) → D1/D2 observations → overlay → proposals
                                  ↓
                        confirmed → published to p-e
```

One level above hivemark's own loop, `reviews → claims → track records →
proposals → reviews`.

## 8. Extension beyond code review

The evidence unit is `ReviewRecord` and the corpus is hivemark's, by decision.
Extension to other task classes is provided for by shape, not by migration:
`metric: { name, value, direction, judge }` rather than a `findingsCount` field
means a new axis is a new metric and a new judge, not a schema change.

The honest cost, stated now: **the hard part of generalising is the judge, not
the schema.** Code review has a cheap one — a skeptic pass emitting
confirmed/refuted/uncertain. "Did memory help?" has none, and one must be
devised per task class. Extension is gated on that, and on nothing in this
document.

One rule must hold from the first version or ranking rots later: **deficits on
different metrics are incomparable.** "+3 findings" cannot be ordered against
"+0.2 memory-recall". Order exists only within one axis and one metric. There
will never be a global compatibility score — the same reason `breeding.md`
refuses to show parent track records beside a proposal.

## 9. Out of scope

Named so the boundary is explicit; each is its own spec and its own cycle:

1. **Matching engine** — the implementation of §6, its storage and its query
   path.
2. **Run harness** — executing an authorised proposal and writing the result
   back.
3. **Market** — payment, escrow and dispute, over `../aura`'s
   `NegotiationService` (`Negotiate`, `OfferAccepted`/`Countered`/`Rejected`,
   `CryptoPaymentInstructions`, `dispute_token`).

`N` in §6.2 — the minimum `pairs` for a row to enter the exploitation queue — is
set by the matching-engine spec, not here, because it is a ranking parameter and
this document defines no ranking parameters.
