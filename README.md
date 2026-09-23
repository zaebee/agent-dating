# agent-dating

Matching agents by **measured deficit** rather than self-declared capability.

Agent registries — A2A Agent Cards, agent directories, the marketplaces built on
them — are catalogues of what an agent says it can do. That statement costs
nothing to make, so it carries no information, and ranking is then patched on
afterwards with reputation and payment-graph heuristics.

This asks a different question, which has no catalogue at all: **what is this
agent missing, and who measurably supplies it?** Not "who does code review" but
"whose review demonstrably improves when a graph of the codebase is attached",
and "where does this agent return no verdict at all, such that a second party is
structurally required".

That cannot be self-declared either. It has to be measured as a delta under
withholding — which is ablation, an instrument
[hivemark](https://github.com/zaebee/hivemark) already implements.

## The honest result, first

Run against the corpus it was built for, this produces **no admissible
observation at all**.

```
65 records
  D1: 1  — 6 pairs, 2 informative, delta +0.2593, spread [0, 1], admissible=false
  D2: 64 — 18 per-category across 3 subjects, plus 46 from refused joins
```

Two candidate measurements exist and each fails a different gate: one has a
spread running the full width of the metric in both directions, the other has
two informative pairs against a floor of five. A design built around a single
compatibility number would have published "+0.08 graph affinity" and it would
have survived, because a number reads as settled when nothing beside it shows
the width.

That is the system working. It is built to be able to say *not established*.

## Three kinds of deficit

A deficit belongs to a **pair** — a subject and a withheld resource — never to
an agent alone. "The graph yields +k findings" is not "this reviewer is blind
without a graph".

| | what it is | where it comes from | what it is worth |
|---|---|---|---|
| **D1** | measured blind spot | an ablation pair scored by an independent judge | measured, falsifiable |
| **D2** | undecidable region | `uncertain` verdicts with their grounds quoted | observed |
| **D3** | declared want | the agent wrote it | self-asserted, costs nothing |

D3 is kept deliberately — "I want a divergent partner at temperature ≥ 1.2" is a
legitimate thing to publish and cannot be measured today. It is a first-class
record, always flagged, and it never outranks a measurement and never promotes
into one.

## Running it

Requires [bun](https://bun.sh) and a sibling checkout of
[hivemark](https://github.com/zaebee/hivemark), from which identity is imported
rather than recomputed.

```sh
bun install
bun run derive corpus.json --out overlay.jsonl
bun run test
```

`corpus.json` names the review and judge files to read. Nothing is written back
to the corpus or to hivemark; this is a reader.

## What it refuses to do

The refusals are the design, so they are worth stating plainly.

- **An ambiguous join is refused, never resolved by picking.** 46 of 117 judged
  rows do not say whose work was judged, and the honest answer to that is
  *undecidable*, which the schema has somewhere to put.
- **An unclassified field fails the load.** Every field of a paired row is
  declared identifying, resource, or incidental in `registry/axes.json`. A field
  in none of the three stops the run, because it may be one that varied across a
  pair. It caught `temperature` on the first run.
- **Absent is never empty.** A missing field and a blank one are different
  failures with different messages, in the records, in the corpus reader, and
  inside pair keys.
- **Nothing aggregates across axes or metrics.** There is no deficit score, no
  vector norm, no completeness percentage. The ordering function takes exactly
  one `(axis, metric)` pair, so a global score is not forbidden — it is
  inexpressible.
- **Nothing is deleted.** Observations that fail a gate are stored with the gate
  that rejected them, because the floor is revisable upward and a raise must
  re-evaluate retained records.

## Scope

This is sub-project 1 of 4. What is built here is the profile: the schema, the
derivation, and the admissibility rules —
[spec](docs/superpowers/specs/2026-09-23-deficit-profile-design.md) §4 and §5.

Not built, each its own spec: the **matching engine** that turns profiles into
proposals ordered by information gain, the **run harness** that executes a funded
proposal, and the **market** those proposals clear in.

One thing the design already commits to and this repository cannot enforce:
**admissible does not imply honest.** A supplier who systematically degrades the
withheld arm manufactures observations that pass both gates. The defences are
that the supplier does not judge, that every instance is recomputable by anyone,
and that runs cost money — and making those actual belongs to the specs above.

## Reading order

- [Design spec](docs/superpowers/specs/2026-09-23-deficit-profile-design.md) —
  what a deficit is, how it is derived, what makes it admissible, and two places
  where the spec was wrong and says so.
- [Implementation plan](docs/superpowers/plans/2026-09-23-deficit-profile.md) —
  twelve tasks, each with its own test cycle.

## Related

- [hivemark](https://github.com/zaebee/hivemark) — cumulative track records for
  code-review agents. Identity, the ablation instrument, and the corpus.
- [p-e](https://github.com/zaebee/p-e) — a provenance layer whose records name
  what they do *not* establish. The source of this project's I-8 discipline.
- [codegraph-brain](https://github.com/zaebee/codegraph-brain) — the reviewer the
  corpus records.

MIT.
