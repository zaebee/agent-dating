# context-graph-v2 — pre-registration

The first measurement meant to produce an admissible version-2 D1 on real data,
and the first real use of the run provenance code. The corpus behind the profile
spec yields none: on `context.graph` it has 6 strict pairs, 2 informative, against a
gate-2 floor of 5.

**This file and `selection.json` are committed before any run of this experiment,
and nothing in either changes after the first run.** Everything below is fixed now
so that neither the result nor the budget can shape which runs count.

## What is fixed

**Tasks.** The 15 pull requests in `selection.json`, chosen by the rule recorded
there: the plan's reproducible graph-slice PRs without a fetch error — 19 of them —
sorted by url, shuffled with a fixed seed, first 15. The plan file's sha256 is
recorded, so the population can be checked against the file it was drawn from.

**Size.** 15 tasks × 2 arms = 30 runs. Fifteen is a planning estimate: on the
corpus about a third of pairs were informative, and five are needed. It is a
commitment, not a target — if the pairs come out less informative than that, the
observation is inadmissible, and that is the result.

**Subject.** Finder `gemini-2.5-flash`, skeptic `gemini-3.5-flash`, both through
the gemini provider; slice `graph`; profile `core`; arms `graph` and `ablated`.
This is the configuration of the corpus's ablated arm, so the result is comparable
with what exists.

## Stopping rules

1. **No additions and no replacements.** A task that fails stays failed. It is not
   swapped for another PR, because choosing the substitute is a choice made after
   seeing a failure.
2. **One run per intent.** A failed run is recorded as a failed `R`. Re-running a
   task needs a new intent, and the audit shows it as such.
3. **No peeking.** The metric is not derived, and no pair is inspected for its
   result, until every one of the 30 intents is discharged — completed or failed.
   Running in stages as the budget allows is fine. Looking between stages is not:
   stopping when the numbers look good is selection.
4. **The result is reported whatever it is**, admissible or not, through the gates
   of the profile spec §5.5 as they stand today. Gate 2's floor is 5 and is not
   revised for this experiment.

## Two layers of pre-registration

- **The experiment** — which tasks and how many — is fixed by this commit. It stops
  a result from choosing its own sample size.
- **Each run** is fixed by its intent, announced after `prepare` and before
  `review`. It stops a runner from re-running and keeping the best.

The audit connects the two: every task in `selection.json` must end with two
discharged intents, and anything else is a visible gap.

## Why intents are not announced yet

The plan was to `prepare` all 15 tasks now, for free, and announce all 30 intents
at once. That does not work with how the graph is stored, and it is recorded here
rather than worked around.

- **There is one graph per repository.** `ensure_graph` in codegraph-brain ingests
  into `<repo>.db`, "replacing any previous graph", so 15 graphs cannot be held at
  once. Preparing everything now means re-preparing each task at review time.
- **A re-prepared graph may not match the announced digest.** Whether ingest is
  deterministic is the run provenance spec's open question in §4.4. A byte digest
  of a SQLite file is likely unstable even when the content is identical. And `R`
  copies `graph_digest` from its intent rather than re-measuring it, so a mismatch
  would pass silently.
- **`prepare` changes another project's working state.** It switches checkouts and
  replaces graph databases in codegraph-brain's `.martian-workspace`, which the
  existing corpus was built from.

So intents are announced **per task, immediately before its review**: `prepare`
task k, compute its digest, announce both intents, review both arms. Membership and
size are already fixed above, so announcing late does not reopen them.

## Decisions open before the first run

- Whether the runs use codegraph-brain's shared workspace or an isolated one.
- Whether `graph_digest` becomes a logical digest of the graph's content, and
  whether ingest is deterministic. That can be tested for free on one task, twice,
  in an isolated location.
- Guardian now writes a `temperature_source` field that the corpus rows did not
  have. The version-2 path does not classify row fields, but the version-1 registry
  would refuse such rows until the field is registered.
