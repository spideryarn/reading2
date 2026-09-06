# Get ready to deploy: the publish guard and the heartbeat flake

A [get-ready-to-deploy.md](../reusable/get-ready-to-deploy.md) sweep, run attended on 2026-09-05
from the shared primary checkout. Steps 1–4 are done; this doc covers step 5, the fixing, run the
way [engineering-manager.md](../reusable/engineering-manager.md) says.

## Where the sweep got to

- **Step 1 — commit what's uncommitted.** Nothing to commit. `git status` showed three untracked
  files and no tracked change: `.tmp-smoke.mts` (2026-09-03 10:09), `privacy-1280.png` and
  `privacy-390.png` (2026-09-02 17:17). All two to three days cold, none gitignored, none mine —
  scratch debris from earlier browser and marketing-page work. Left alone, reported at the end.
- **Step 2 — look at the merge.** `dev` was 0 ahead, 20 behind `origin/dev`; `git merge-tree` exit 0
  and `dev` an ancestor of `origin/dev`, so a fast-forward with no conflict and nothing uncommitted
  to overlap with.
- **Step 3 — pull.** `git pull --no-rebase`, 71 files, +7227/−1257. No migrations came in, so
  nothing to apply to the local database.
- **Step 4 — the checks.** `npm run check`, 28 minutes. `typecheck`, `build`, `cycles`, `chain` and
  `committed` all clean. `lint`, `knip`, `complexity` (98) and `dupes` (300) have their usual
  advisory findings. **The test gate failed**: 3 files red out of 706, 1 test failed out of 13075.

## What is red

Two distinct causes.

### A. `PublishRefused` — the tree rule against the fixture (the real one)

`tests/store-parity.test.ts` and `tests/store-roundtrip.test.ts` both fail in *setup*, before a
single assertion, publishing the `source` fixture:

```
PublishRefused: Refusing to publish "source": n0054 → n0055: covers its parent's whole range,
so one rung finer restates the same blocks instead of compressing them
(granularity-zoom.md#the-tree)
  ❯ publishRevisionIn src/store/pg-revisions.ts:1615:29
  ❯ tests/helpers/load-article.ts:483:9
```

The rule lives in [`src/tree-invariants.ts`](../../src/tree-invariants.ts) and arrived with
`c8e2cc7e` "Two rules over one tree, and a rung that said the same thing twice" (2026-09-05),
which is *pre-existing on `dev`* — it was already there before today's pull, so this is not a
merge regression and may have been red since that commit landed.

**Root cause: not a bug in committed code at all.** Both suites pin themselves to the working
`data/` directory on purpose (`tests/store-parity.test.ts:330`), enumerate `data/*` and publish each
article's stored `tree.json` verbatim — and `data/` is gitignored. `data/source/tree.json` was
generated on 2026-08-26, ten days before the rule existed, and `n0055` restates `n0054` over blocks
39–40 while calling itself "Author Biography" when block 39 is the `References` heading. The rule
caught a genuinely wrong tree.

Established three ways, independently: a scan of all 18 trees on this box (13 in `data/`, 5 in
`tests/fixtures/data-root/`) finds this one node pair and nothing else; `git log -S` gives `c8e2cc7e`
as the rule's only commit; and `git show ea9bd5c7:src/tree-invariants.ts` already contains it — so
**the suites were already red before today's pull**, and today's 20 commits are innocent.

It was invisible because `.worktreeinclude` copies only `.env.local`/`.env`, so a worktree starts
with an empty `data/` and fills it from post-rule runs, which `collapseRestatedRungs` keeps clean.
`c8e2cc7e` was green where it was written and red only in the primary.

**Fixed** by splicing `n0055` into `n0054` — the rung discarded, its two leaves lifted to stand in
its place, the parent keeping its title and gist — which is exactly what `collapseRestatedRungs`
does at build time. A re-run of `npm run hierarchy source` would also have worked and was not used:
a model call and 57 renumbered nodes to repair one rung. The original file is backed up in the
sweep's scratchpad as `orch-source-tree.json.bak`.

Verified: `npx tsx src/validate-tree.ts data/source` → `✓ structure is sound` (2 pre-existing
navLabel advisories, editorial not structural), and both suites green — **408 passed, 0 failed**.

**Nothing in the repository changed for this.** The write-up is
[260905d-a-new-tree-invariant-met-a-nine-day-old-local-artefact-and-reddened-a-gate.md](../postmortems/260905d-a-new-tree-invariant-met-a-nine-day-old-local-artefact-and-reddened-a-gate.md),
which is where the three durable fixes are ranked — including one with a plausible reader-facing
consequence that this box could not check, because production is not reachable from here.

### B. `tests/sse-heartbeat.test.ts` — a load-sensitive timing assertion

```
FAIL  unit  tests/sse-heartbeat.test.ts > heartbeat > puts bytes on the wire while there is
nothing to say
AssertionError: expected 2 to be greater than or equal to 3   (tests/sse-heartbeat.test.ts:46)
```

**Measured, 2026-09-05:** 5 runs of the file on its own, 5 passes. It fails only inside the full
parallel suite. The test opens a real socket, beats every 15ms for 120ms — eight beats' worth of
wall clock — and asserts at least three arrived. Under a saturated event loop six of the eight are
late, and the gate goes red for a reason that is not a bug.

The docstring says why the file exists: a heartbeat that silently never fires is the house's worst
bug shape, and the test drives a real socket rather than asserting a timer was scheduled. What was
arbitrary was never the `3` — it was the **120ms deadline** it was measured against. Three beats is
a fine thing to require; requiring them inside a fixed slice of wall clock is what made a live
heartbeat look dead on a loaded box.

## Stages

1. **The publish guard.** Root-cause A, write the failing test if one is missing, fix it, get GPT
   Sol on the diff. Ends with `store-parity` and `store-roundtrip` green on their own.
2. **The heartbeat flake.** Make the assertion prove the heartbeat fires without depending on the
   box being idle, and prove the rewritten test still goes red when the heartbeat is removed — a
   test that was never red proves nothing.
3. **Re-check and push.** Full `npm run check`, commit each stage's files by name, push to `dev`.

## What this deliberately does not do

Not `npm run deploy`. The sweep ends at `dev`; the deploy to `main` is a separate job.

Not the lint, knip, complexity or dupes backlogs — they are advisory by design
([code-quality-overview.md](../project/code-quality-overview.md)), and chasing them to zero is
explicitly not the ask.

## The simpler option passed over

For B, the simpler option is to delete the beat-count assertion entirely and keep only the
"ends with `event: done`" half. Rejected: that is the assertion that would have caught a heartbeat
that never fires, which is the whole reason the file exists. Dropping the deadline keeps the
evidence; deleting the count keeps only the flake-freedom.

The other simpler option, raising `120` to `600`, was also rejected: it buys a wider margin at the
same shape of bet, and the box that made two beats out of eight can make three out of forty. A
condition does not need a margin.

## The review, and finishing it — 2026-09-06

The 2026-09-05 sweep stopped here: it wrote the fix, sent it to GPT Sol, got a **REFUSE**, and then
went quiet at 18:13 without applying any of it or committing. The next scheduled sweep picked the
work up seven hours later, cold, and finished it. All three findings were checked against the code
rather than taken on trust, and all three were applied.

- **F1 (P1) — the postmortem prescribed a repair that would have caused the harm it was fixing.**
  Upheld, and it was the right call to refuse over. "A splice applied on publish" lands after every
  artefact in the revision has been stamped with the pre-splice tree's `structureHash`, so the
  repair would manufacture staleness. Rewritten in
  [the postmortem](../postmortems/260905d-a-new-tree-invariant-met-a-nine-day-old-local-artefact-and-reddened-a-gate.md)
  to say what is true: repair before any step reads the draft — a one-time migration, or
  normalisation in `beginDraftIn`.

  **Sol was also wrong about one thing, in the unsafe direction.** It said a hierarchy re-run
  "including the normal default re-extraction path" heals a bad tree. It does not: `hierarchy` has
  no `stamp` ([`pipeline.ts:2027`](../../src/pipeline.ts)), so `stepIsDone` skips it whenever tree,
  labels and blocks are present. Only a *forced* re-extraction heals. Left uncorrected, the
  postmortem would have offered "just run it again" as a workaround that silently does nothing —
  which is the same silent-success shape the heartbeat test on the other half of this sweep exists
  to catch. Checked in a subagent against `pipeline.ts`, `jobs.ts` and `step-order.ts`.

- **F2 (P3) — "reached the wire" overclaimed.** Correct: the wrapper counts immediately *before*
  calling the original `res.write`, so it proves the frame was attempted, not that it arrived.
  Reworded, and the comment now says outright which assertion proves receipt (the client counting
  pings back out of the body) and that the counter is deliberately not that assertion.

- **F3 (P3) — this plan described a change it had not made.** Correct: the text said the count was
  loosened; the implementation still requires three beats and what went was the 120ms deadline.
  Both the diagnosis and the "simpler option passed over" section now say the deadline.

### The red-proof the plan promised and never produced

Stage 2 required proving the rewritten test still fails when the heartbeat is dead, and no such run
was recorded. Done on 2026-09-06, on a box at load ~15: a temporary copy of the file with
`heartbeat` mocked to a no-op that returns a working `stop()` — the silent-success shape exactly —
**fails**, timing out at 5000ms instead of passing. The unmodified file passes, 5 tests. The
temporary file was deleted; it exists only in this paragraph.

One thing that run showed which is worth knowing: the dead-heartbeat failure also hangs `afterEach`
for its full 30s, because the server cannot close while a request is still pending. So this test
fails *slowly* — around 35s — where the old one failed instantly. That is an acceptable trade for
not going red on a busy box, but it is the reason to prefer being told about it here rather than
discovering it in a 28-minute `npm run check`.
