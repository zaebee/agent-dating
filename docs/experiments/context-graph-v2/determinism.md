# Is ingest deterministic? One measurement

Run provenance §4.4 left this open, and the pre-registration listed it as a
decision to settle before the first run. This is one cheap test, not a proof.

## What was done

- **Input.** cal.com at `ee38fd295fd294b9fc787eba482bde24bbfea69b` (the commit
  checked out in codegraph-brain's `.martian-workspace` at the time), exported
  twice with `git archive` into two directories at different depths:
  `…/det/a/checkout` and `…/det/elsewhere/b/checkout`.
- **Ingest.** codegraph-brain `main` at `db8c578` (after #506 and #511), the
  command Guardian's `ensure_graph` runs:
  `python -m cgis.cli ingest <checkout> --output <dir>/graph.db`. Once per
  directory, one after the other, on one machine.
- **Digests.** `sha256sum` of each file, and `bun src/cli-runs.ts digest --graph`.

## What came out

| | `a` | `elsewhere/b` |
|---|---|---|
| file sha256 | `7b9becad…0285` | `dc990ed0…ffa6` |
| logical digest | `sha256:11a614a8…262c` | `sha256:11a614a8…262c` |

Each graph: 8490 nodes, 23825 edges, 1466 tracked files, and a
`workspace_packages` entry. The two `ingest_state` rows that differ are `root`
(the checkout's absolute path) and `ingested_at` (1790351915.906001 against
1790351916.3980024, the largest mtime among the files `git archive` wrote).

## What this settles, and what it does not

- **A byte digest is unusable.** The same commit ingested twice gave two file
  hashes. A byte digest would have made every re-prepared graph look divergent.
- **The content was identical.** Every row of `nodes`, `edges`, `files_state`, and
  every `ingest_state` key other than `root` and `ingested_at`, matched.
- **Not established:** that it holds on another machine, another Python or
  tree-sitter build, another repository, or with the workspace's own checkout
  instead of an archive. One pair is one pair.

## What follows for the experiment

The pre-registration's per-task order stands: `prepare` task *k*, digest its
graph, announce both intents, review both arms. With a logical digest a
re-prepared graph can match its announcement, and `run --graph` now checks that
it does: it re-measures the graph after the review and refuses the record if the
digest differs. A refused graph-arm run is recorded with
`fail --failure ingest`, as stopping rule 2 requires, and is not re-run under the
same intent.
