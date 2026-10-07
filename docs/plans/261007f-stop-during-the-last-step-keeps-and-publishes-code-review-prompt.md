# Code review (write-capable): Stop during the last step keeps and publishes

You are reviewing, and may fix, one committed change: commit `f81555bc7` on branch
`worktree-sweep7-stop-keeps-and-publishes` (`a5c087fbf` is a merge of `origin/dev`, `0482d6520`
records gates). The plan: `docs/plans/261007f-stop-during-the-last-step-keeps-and-publishes.md`.
Context: `docs/plans/261007b-seventh-sweep-job-queue-tier-0.md` (cluster C3; you reviewed it twice:
the forced-step receipt, the deadline rule) and `docs/project/ingest-queue.md`.

**The decision, the product owner's** (relayed verbatim by the Overseer, 2026-10-07): *"re Stop,
yes, probably best to err on the side of caution, and keep & publish"*: a Stop that lands while an
import's last step is finishing keeps and publishes the article, whichever server instance the Stop
reached. Everything else in the change is the orchestrator's and the builder's.

**What it does.** `transitionAfter` (`src/jobs.ts`): if OUR deadline fired, throw (nothing
committed, the job pauses: C3's rule); else a local Stop with steps still to run ends `cancelled`;
else fall through to the ordinary `done` ending (product committed, article published). Two steps
can return a partial product after an abort, and each got a change:
- `assets`: when aborted, the manifest is still written but stamped `sourceHash: "stopped-part-way"`
  (`STOPPED_PART_WAY` in `src/collect-assets.ts`, set in `src/pipeline.ts` § `STEPS.assets`), a
  value that can never match, so the step reads as not current and any later unforced run redoes it.
- `illustrated`: it returned the plates drawn so far, stamped current, ignoring its own
  `IllustratedRun.cancelled`; it now THROWS when the run was cancelled and the signal fired, keeping
  the last good painting (the old outcome).

**Try to break it.**

1. **The scope.** Stop during an EARLIER step must still mean "do no more" on both instances. Stop
   with a step that obeys the signal (throws) must still end `cancelled`. Our deadline alone must
   still pause without committing. Deadline-then-Stop and Stop-then-deadline: check the precedence
   is what `pauseForDeadline` and the abort reason say, and that the reason is fixed by whichever
   fires first (`overran()` checks `reason instanceof DeadlineReached`). Find an interleaving where a
   product that arrived after OUR deadline is committed, or where a Stop pressed before the last
   step began lets the last step run.
2. **The `assets` sentinel.** Every reader of a manifest's `sourceHash`: the freshness decider,
   the public reader, export, the Metadata stage list, image serving, any cache keyed on it. Does
   any treat an unknown hash as an error, refuse to serve the manifest, or overwrite it in a way
   that loses the images that DID arrive? Does a later unforced run actually redo the step (who
   triggers one: does any ordinary reader action run `assets` again, or only Refresh from source /
   Start again)? Is a sentinel in a hash field the smallest honest mechanism, or does an existing
   field already mean "partial"?
3. **`illustrated` now throws when cancelled and the signal fired.** Is that reachable on paths
   other than Stop (the builder notes the `cancelled` flag is also set by a provider timeout with
   the signal NOT fired, which still returns the partial set as before)? Does throwing change what a
   reader sees for an ordinary Stop of an Illustrated run (is the last good painting really kept;
   is anything paid for lost)?
4. **Other steps that can be last** (`metadata`, `extract` publish without registry facts after an
   abort; `citations`, `debate` ignore the signal): is anything published that a reader would read
   as complete and wrong? Report; fix only if it is inside this change.
5. **One mutation turned nothing red** (M2: removing the local cancel branch for a Stop with steps
   still to run is invisible because the next progress write reads `cancelling`). Is that branch
   then dead, or defence in depth worth a test that isolates it?
6. **What the reader sees:** the card says "Stopping after the current step…", then "Done — read
   it". Nothing tells the reader their Stop came too late. Is any shown text false? Report; do not
   write new wording.

Postgres-backed tests cannot run in your sandbox (no network): do not report them as failing; say
which could pass against a plausible wrong implementation. Offline tests you can run:
`npx vitest run tests/jobs-tier0-offline.test.ts tests/assets-stopped-is-not-current.test.ts
tests/illustrated-step-registration.test.ts`. No `npm test`.

**Fix what is inside this change**, narrowly, red-first; write any Postgres test and mark it unrun.
**Report, do not fix, anything wider.** No new reader-facing sentence; do not change the step
budgets; do not commit; do not attribute any further decision to the owner.

**Reply format.** Findings C1, C2, …; P0 (an import lost, a broken or half-finished article
published as complete, a double spend) / P1 / P2 / P3; the input; reproduced or reasoned; fixed or
not (and the test). Then files changed, what you ran, and a verdict (ship / ship with these fixes
applied / do not ship).
