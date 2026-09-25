# Run provenance — design

**Status:** v1.3. Approved in brainstorming, amended by planning, by final review, and by pre-run investigation.

**What changed in v1.1.** Planning found that §3's claim — supersession "works
unchanged" — readmitted the mirror attack §5 defends against: a joint covering an
honest supplier's runs plus fabricated ones is a later superset and would
supersede the honest observation. Supersession now never crosses a contributor
set (§3). To make that possible every version-2 D1 names its contributors, and
the joint-only fields sit in one block (§5). Three gaps were also closed: a joint
in which no task was run by two contributors is refused (§5.1), an observation
holds at most one completed run per task per arm (§6.1), and intents are
announced after `prepare` and before `review` (§4.1).

**What changed in v1.3.** Investigating codegraph-brain before the first paid run
found that `GUARDIAN_FEATURES` decides which context sections a review gets — full
files, the outbound flow fallback, chunking — while being neither part of
`review_fingerprint` nor written to the review row (codegraph-brain#505). Two runs
with identical records could have read different prompts. `Conditions` gains
`features` (§4.3), it joins `declared_not_verified` (§4.5), and `I` and `R` move to
schema version 3 (§4.1, §4.2). No version-2 intent or run was ever written.

**What changed in v1.2.** Final review found that a joint trusted each source's
stated pairs, so a published source with its arms swapped or its runner relabelled
turned a recorded disagreement into agreement. A joint now re-derives every source
from its own runs and refuses any difference (§5.1). The pre-registration check
compared the wrong clock — `observed_at` is when a run was recorded, not when its
review ran — so a review run before its announcement was accepted; the review's own
`reviewed_at` is now checked (§6.2). `declared_not_verified` understated the
unproven set and is widened (§4.5), and a derived observation now states how many
of its runs were announced (§6.3).

**Scope:** sub-project 3 of 4, narrowed. This specifies what a run must record so
that a party other than the one who ran it can assemble the same inputs and run
it again, what a failed or abandoned run produces, and where those records are
published. It does **not** specify authorisation or funding of a proposal —
those belong to the matching engine (issue #3) and the market (issue #5), and
nothing here depends on either existing.

**Implements:** [issue #4](https://github.com/zaebee/agent-dating/issues/4),
narrowed to reproducibility by agreement before design began. The narrowing is
deliberate: a harness that executes proposals needs the proposal's shape, which
#3 owns, while the reproducibility question needs none of it.

**Companion:** [the deficit profile
design](2026-09-23-deficit-profile-design.md), whose §5.2 derives D1 from pairs
and whose §10 states the problem this document exists to attack:
**admissible does not imply honest.**

---

## 1. The problem this attacks

The profile spec's gates test whether evidence is self-consistent, never whether
it was produced in good faith. A supplier who systematically degrades the
withheld arm manufactures observations that pass both. Gate 1 is *easier* to
pass for a manipulated arm than an honest one, since consistent degradation
never crosses zero.

Three defences are named there and none is enforced by anything that exists:
the supplier does not judge, every instance is recomputable by anyone, and runs
cost money. The second is this document's business.

**Recomputable by whom, exactly, and from what?** Today a D1 names its instances
as `url@head_sha`. That identifies the *pull request* a measurement was taken
over. It does not identify the run, does not say who performed it, and does not
carry what a second party would need to perform it again.

## 2. What "reproducible" means here

**Conditions are reproduced. Results are not, and no claim is made that they
could be.**

The corpus records `temperature: 0.7` on 45 of its rows. Runs are
non-deterministic by construction, so a scheme that verified a re-run by
comparing its output to the original would verify nothing. Requiring
`temperature: 0` instead would discard the existing corpus and still not
deliver determinism, since providers drift between model versions.

So a re-run is not a check. **A re-run is another measurement**, and it is
compared to the first the way any two measurements are compared here — by the
gates, on a record that cites both (§5). Disagreement surfaces as a spread that
spans zero, which is machinery that already exists and needs nothing added.

## 3. An instance is a run

`pairing.instances` changes meaning: an entry ceases to be a task and becomes a
**pair of run identifiers**.

This is forced, not preferred. With instances identifying tasks, a second
party's re-run of the same pull request produces a second measurement of an
entry that already exists. The two are then indistinguishable, and worse,
supersession cannot fire: §5.7 of the profile spec supersedes an observation
whose instances are a *subset* of a later one's, and a re-run over the same
tasks enlarges nothing.

With instances identifying runs, a re-run genuinely adds instances. A runner's
own later, larger observation is a superset of its earlier one and supersedes it
under the existing rule.

**Supersession never crosses a contributor set**, and this is not a detail. A
joint observation covering an honest supplier's runs plus fabricated ones is also
a later superset, and under an unrestricted rule it would supersede the honest
record — suppressing it, which is the mirror attack §5 exists to prevent,
readmitted through supersession. Observations are grouped by their contributors
before supersession is computed, so a joint supersedes only an earlier joint of
the same runners.

**`schema_version` goes to 2.** By invariant 5 of the profile spec, observations
of different schema versions are never compared or pooled. The observation
already recorded stays valid and stays version 1; it is not migrated, because
migrating it would assert that its instances mean something they did not mean
when it was written.

## 4. The records

### 4.1 `I` — a run intent

Written **before** the run is performed.

```ts
interface RunIntent {
  schema_version: 3;
  kind: "I";
  /** sha256 of this record minus this field. Carries no outcome. */
  intent_id: string;
  announced_at: string;
  /** Who will execute it. */
  runner: string;

  task: { url: string; head_sha: string; project: string };
  /** A registry resource value on the axis, e.g. "graph" | "ablated". */
  arm: string;
  conditions: Conditions;

  unestablished: string;
}
```

**An intent is announced after `prepare` and before `review`.** It must carry
`graph_digest`, and the graph exists only once `prepare` has built it. Announcing
before `prepare` would leave the one condition this axis is about undeclared.
Re-running `prepare` to degrade the *present* arm's graph would shrink the delta,
which is against a manipulating supplier's interest; the withheld arm has no
graph to degrade.

### 4.2 `R` — a run

Written after, citing the intent.

```ts
interface RunRecord {
  schema_version: 3;
  kind: "R";
  /** sha256 of this whole record minus this field. */
  run_id: string;
  /** The intent this discharges. Required. */
  intent_id: string;
  observed_at: string;
  runner: string;

  task: { url: string; head_sha: string; project: string };
  arm: string;
  conditions: Conditions;

  outcome:
    | { ok: true; findings_digest: string; findings_count: number }
    | {
        ok: false;
        failure: "prepare" | "ingest" | "model-error" | "parse" | "timeout";
        detail: string;
      };

  /** Conditions this record states but cannot prove. Enumerated, not prose. */
  declared_not_verified: string[];
  unestablished: string;
}
```

### 4.3 `Conditions`

```ts
interface Conditions {
  /**
   * GUARDIAN_FEATURES, parsed, sorted: the context sections the review gets.
   * Changes the prompt; not in the fingerprint and not on the review row.
   * Required — empty means none, and absent is a different claim.
   */
  features: string[];
  /** Already digests prompts, context assembly and the selected provider. */
  review_fingerprint: string;
  finder_model: string;
  finder_provider: string;
  skeptic_model: string | null;
  skeptic_provider: string | null;
  temperature: number | null;
  slice: "all" | "graph" | "diff-only";
  profile: string;
  guardian_sha: string;
  /** Digest of the graph artefact. Null iff this arm withholds it. */
  graph_digest: string | null;
}
```

The fields are what the producer's own runner takes. `scripts/guardian_martian.py`
exposes `--slice`, `--profile`, `--no-graph` and `--pr`; the models arrive
through environment variables rather than flags, which §4.5 is about.
`review_fingerprint` already exists on every review row and is described
upstream as "the digest of the code that actually decides a review — prompts,
context assembly, the selected provider".

### 4.4 `graph_digest`, and the awkward part

**The axis under measurement is the input whose reproducibility is least
established.** The `graph` arm is produced by an ingest step. Whether ingest is
deterministic is not known here and was not established cheaply.

This record therefore **does not claim** determinism. It carries a digest so
that divergence is *detectable* even where it is not preventable. Two runs whose
conditions match except `graph_digest` did not run against the same graph, and
§5.1 neither hides that nor refuses to work with it: the pair may still be
pooled, and the divergence is recorded on the face of the joint observation,
where a consumer decides what it is worth.

**The digest is of the graph's content, and it is measured twice.** A SQLite
graph is digested by its rows, not its bytes: pages depend on insertion order
and free space, and codegraph-brain's `ingest_state` holds the checkout's
absolute path and the ingested files' largest mtime, neither of which changes
what a query returns. `cli-runs digest --graph` is the one way to compute it.
The intent carries the digest measured after `prepare`; `run --graph`
re-measures the artefact when the run is recorded, after the review, and a
different digest refuses the record. A graph rebuilt between announcement and
review is therefore caught rather than copied onto `R` unseen. It still shows
only which artefact was on disk, not what the review read, so `graph_digest`
stays in `declared_not_verified`.

**A joint re-derives every source from that source's own runs** and refuses any
difference in contributors, pairs, metric, judge or admissibility. A source is a
record anyone can publish; taken as written, one with its arms swapped would turn
a disagreement into agreement. The same rule applies across sources: one runner
may not contribute two completed runs of one task and arm to a joint.

A joint in which **no task was run by more than one contributor is refused**. It
re-runs nothing and so checks nothing, and `graph_agreement` over zero shared
tasks would report "identical" about a comparison that never happened.

Stating the limit is the point. A scheme that asserted "the graph arm is
reproducible" and shipped would be asserting the one thing nobody here has
checked.

### 4.5 `declared_not_verified`

A list, not a sentence.

The runner reads `finder_model` and `skeptic_model` from environment variables.
The record states which model answered and cannot prove it. Consumers must be
able to **filter** on which conditions a given record leaves unproven, and prose
does not filter. On the corpus as it stands the list is at least
`["features", "finder_model", "finder_provider", "graph_digest", "profile",
"skeptic_model", "skeptic_provider", "slice", "temperature"]`. `features` and
`profile` are not on the review row;
`graph_digest` is whatever the runner hashed, and nothing ties it to the graph the
review saw; `slice` goes unchecked when a run covers `all`. A list that omits a
condition implies a verification that never ran.

`unestablished` is still required on every record, carrying what the record does
not establish in the I-8 sense. The two are not redundant:
`declared_not_verified` names *conditions asserted without proof*, and
`unestablished` names *what the record as a whole does not settle*.

### 4.6 Why `run_id` includes the outcome

`run_id` hashes the entire record, outcome included, so one runner cannot
publish two runs under one id with different results. This is `claimHash` in
`../hivemark/src/claims.ts`, which hashes the finding together with the review
that produced it, "since that is what a reader would dispute".

`intent_id` deliberately does not, because an intent exists before its outcome
does. The two ids are not derivable from each other, and `R` names its
`intent_id` explicitly.

## 5. Joint observations

Every version-2 D1 names its `contributors` — one runner for an ordinary
observation, two or more for a joint — because §3's supersession groups by them.
A joint additionally carries one block. It is not a new record kind.

```ts
contributors: string[];    // runner ids, sorted; on every version-2 D1
joint?: {                  // present iff contributors.length > 1
  cites: string[];         // observation ids it draws from, sorted
  graph_agreement: "identical" | "divergent" | "withheld-both";
  contested_tasks: number; // tasks where two runs disagree in sign
};
```

Nesting makes "all or none" hold by construction rather than by a check.

**Anyone may build one, and nothing pools automatically.** This is the defence
against the mirror attack, which the issue did not name: if foreign pairs merged
into an observation by themselves, an attacker would suppress an *honest*
supplier by fabricating opposite-signed pairs. Under an explicit act the
attacker does not suppress anything — they publish their own record, with their
own runner id on it, and the sources stand untouched. A dispute becomes a third
record rather than the erasure of a second.

### 5.1 What may be pooled

Every field of `Conditions` must be equal across pooled pairs, **except
`graph_digest`**, whose agreement is recorded rather than required.

Requiring it exactly was considered and rejected. If ingest is non-deterministic,
exact matching makes a joint observation impossible to construct, and the axis is
then declared unverifiable — honest and useless. Recording the divergence keeps
verification possible and puts the caveat on the face of the record, where a
consumer decides what it is worth.

### 5.2 Tasks are not averaged

The obvious move is to collapse several runs of one task into a single
difference, so a task run three times does not weigh three times. **It must not
be done**, and the reason is the whole purpose of the section.

If a supplier reports +1 on a task and a verifier reports −1, averaging yields
0 — a **tie**. The disagreement vanishes, and instead of tripping gate 1 it
*lowers* `informative_pairs`, pushing the observation towards inadmissibility
for the wrong reason and with the wrong story.

So gate 1 runs on raw per-run differences. Opposite signs span zero, the joint
observation is inadmissible, and **that inadmissibility is the finding**: it
records that two parties did not agree, which is information rather than
failure. `contested_tasks` saves a reader from deriving it.

**This diverges from the profile spec's §5.1**, which forbids pooling precisely
because it weights by volume. The divergence is deliberate: there the purpose is
to measure a magnitude, and weighting corrupts it; here the purpose is to detect
disagreement, and a task checked three times weighing more than one checked once
does not obstruct that. Named rather than left for someone to discover.

## 6. Failure, and abandonment

### 6.1 Every attempt produces a record

An `R` is written for every run attempted, with a failure outcome where the run
failed. Silently omitting failures is **survivorship bias that the gates cannot
see**: a supplier who re-runs the withheld arm until it looks bad, and records
only those runs, produces pairs that are internally consistent, numerous enough,
and single-signed. Gate 1 and gate 2 both pass. The gates ask whether the data
agrees with itself, never whether the set is complete.

A failed arm yields no pair, which derivation already handles and already
counts — `unestablished` carries "dropped N pair(s) whose metric was undefined".
What changes is that the dropped pair now has an addressable reason.

An observation holds **at most one completed run per task per arm per runner**.
When a runner has two, which to pair with the other arm is a choice, and a choice
at that point is where selection hides. They are refused together and must be
recorded in separate observations.

### 6.2 An announced intent with no run is a visible gap

This is what intents are for. An `I` with no `R` citing it says someone declared
a run and never published what it produced. Cherry-picking stops being
invisible.

**An announcement must precede the review, not merely the record.** `observed_at`
on `R` is when the run was *recorded*, which is always after the announcement in
any honest tool and so proves nothing. The review row carries `reviewed_at`, when
the review actually ran, and a row reviewed before its intent was announced is
refused at record time. `reviewed_at` is self-asserted by the producer, so this
stops a tool from approving evidence that already shows the violation; it does not
stop a producer who forges the timestamp.

### 6.3 The limit, stated plainly

**Pre-registration has teeth only against a party who publishes intents.**

Someone who publishes none violates nothing — they are simply not participating,
and their runs look like any other. The mechanism converts "quietly keeping the
convenient runs" into "visibly not pre-registering", which is a signal a consumer
can act on, not a guarantee.

To make that signal reach a consumer, **a derived observation states it**: how many
of its paired runs had no announced intent, and how many differ from their
announcement — or, when no intents were supplied, that pre-registration was not
checked. Without it, a pre-registered measurement and one assembled from runs kept
after the fact would be indistinguishable in the record a consumer reads.

There is no unilateral solution to this. There is only cost and visibility, and
this document delivers visibility. It must be read the way §10 of the profile
spec is read: **admissible does not imply honest**, and this narrows the gap
without closing it.

## 7. Publication

### 7.1 Intents must leave the author's custody

The approach chosen in brainstorming kept run manifests out of `../p-e` on the
grounds that a manifest is not an observation. That holds for `R`. It does not
hold for `I`, for a formal reason.

Pre-registration means nothing unless the announcement survives the **author**,
because the author is the party who would want it gone. In `../p-e/SPEC.md`'s
vocabulary that is exactly **G2b** — "the binding survives the author" — and the
same table names who can break it: `nobody, without an independent party`. An
intent held only in its own author's store is a draft, not a pre-registration.

### 7.2 What p-e does not provide today

Depositing is not enough, and the spec says so itself. v1 delivers **G2a**,
survival of a crash; **G2b needs a second party and is deferred** to the
Transparency layer. The legacy relay additionally **makes no G1 claim at all** —
an id, once bound, is not asserted to never name other bytes — and `relay-0183`
is the standing instance, an id that currently holds its second occupant after
its first was deleted.

### 7.3 Teeth come from the anchor

`../hivemark` already implements the mechanism: an anchor publishes **one Merkle
root per calendar week**, so a record can be shown to have existed no later than
a given block. An intent inside an anchored root can be neither added nor
removed after the fact.

So intents are deposited and then anchored periodically. **Before the anchor an
intent is an assertion; after it, it is bound to a time.** The interval between
deposit and anchor is the window in which retraction is possible, and its length
is a stated weakness rather than an implementation detail. hivemark's period is
a week.

One rule transfers verbatim, and without it the anchor lies: a skipped period
stays a gap and is **never backfilled**, because — in hivemark's own words — "an
anchor published late would assert that its contents existed by a date that has
now passed".

### 7.4 The three streams

| record | published to | why |
|---|---|---|
| admissible observations | p-e, as the profile spec's §8 already says | unchanged |
| intents `I` | p-e, plus a periodic anchor | needs G2b, which an author cannot grant itself |
| runs `R` | the overlay only, cited by `run_id` | teeth come from the anchored intent and from content-addressing |

The last row follows from §6.2: withholding an `R` after its intent is anchored
produces exactly the visible gap intents exist to create. Anchoring `R` as well
would double the cost and add nothing.

## 8. Out of scope

- **Authorisation and funding of a proposal** — issue #3 and issue #5. Nothing
  here requires either, and the narrowing was agreed before design began.
- **Whether ingest is deterministic.** §4.4 records a digest so divergence is
  detectable and deliberately makes no claim. One test agrees on content
  (docs/experiments/context-graph-v2/determinism.md); establishing it is separate work,
  and either answer would change this document's §5.1: determinism would let
  pooling require `graph_digest` exactly, and a proof of non-determinism would
  make `graph_agreement: "divergent"` the expected case rather than a caveat.
- **Migration of the version-1 observation.** It stays as written. Invariant 5
  keeps the two versions apart, which is the whole reason that invariant exists.
- **A reputation signal over runners.** `contributors` and `runner` make
  attribution possible; what anyone infers from a runner's record is the
  matching engine's problem, and ranking by volume is what a Sybil farm
  optimises for.
