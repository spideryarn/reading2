# Stop during the last step keeps and publishes

Status as of 2026-10-07: built, red first, mutation-checked, reviewed by GPT Sol, its fixes C1–C4
applied and checked against Postgres, gates green, pushed to `dev`. See
[Review status](#review-status).

## Goal

A reader presses Stop while an import's last step is still running, and the step then returns its
product anyway. Until today the outcome depended on which server answered the Stop:

| The Stop reached | Job | Draft |
|---|---|---|
| another instance (the row's `cancelling` flag only) | `done` | published |
| the claimant's own instance (the in-process abort fired) | `cancelled` | failed: the finished article discarded |

Same press, two outcomes. [261007b § Left open](261007b-seventh-sweep-job-queue-tier-0.md#left-open-for-greg)
pinned both and put the question to Greg, through the umbrella's
[For Greg, question 1](261006m-seventh-codebase-sweep-depth-umbrella.md#-for-greg-as-revised-this-list-replaces-the-one-above).

## The decision

> re Stop, yes, probably best to err on the side of caution, and keep & publish
>
> — Greg, 2026-10-07, relayed by the Overseer

So **a Stop that lands while the last step is finishing keeps and publishes the article, whichever
instance it reached.** The option put to him was always keep (the text is done; missing images can
be re-run) or always discard.

## Scope, exactly

Changed: the claimant's own instance, last step, product returned. It now ends as the other
instance's row always did: `done`, product committed, draft published.

Not changed, and each pinned by a control against Postgres:

- **A Stop during an earlier step.** Stop still means do no more: the later steps do not run, the
  job ends `cancelled`, and the draft (holding what the earlier steps made) is failed. This was
  already so on both instances; it is characterised, not changed.
- **A Stop the step obeys** (it throws on the abort, so there is no product). `cancelled`, draft
  failed, as before.
- **Our own deadline.** C3's rule stands: a product that arrives after our deadline is not
  committed, and the job pauses with its draft (`pauseForDeadline`). The existing case in
  `tests/jobs-walk.test.ts` covers it.
- **Both signals.** They abort one `AbortController`, and an abort's reason is fixed by whichever
  fired first, so that is the precedence:
  - deadline first, then Stop: the late product is not committed; the pause answers `cancelled`
    because `cancelling` is on the row ("Stop wins" at the pause, which is the precedence
    [ingest-queue.md](../project/ingest-queue.md) already states). Nothing is published.
  - Stop first, then our deadline: the reason is the Stop's, so the Stop's rule applies and the
    article is kept.

### How the two signals are told apart

By the abort's **reason**, as before: `overran()` in `walkClaim` is
`controller.signal.reason instanceof DeadlineReached`. `transitionAfter` asks it first and throws
the deadline (nothing committed); only then does it look at what is left. A mutation that told
them apart by the clock instead (`aborted && now ≥ deadlineAt`) turns the Stop-first case red.

## What was built

1. **`transitionAfter`** (`src/jobs.ts`): works out the next step before looking at the signal. A
   local Stop with steps still to run ends `cancelled` as before; with none left it falls through to
   the ordinary `done` ending. The walk logs the kept case at `info`, because the job row says only
   `done`.
2. **`assets` marks a manifest made under an abort as not current** (`src/pipeline.ts` §
   `STEPS.assets`, `STOPPED_PART_WAY` in `src/collect-assets.ts`). Below.
3. **`illustrated` throws on a Stop between plates** rather than return a half-painted set. Below.
4. Comments that described the old local ending corrected: `runStep`'s commit note, `finishIn`
   (`src/store/pg-jobs.ts`), and `settleIn`'s caller in `src/store/pg-session.ts`, which still
   listed an `interrupted` ending `transitionAfter` stopped producing with C3.

No column, no migration, no new status, no new step, no client change, no reader-facing sentence.

### Is `done` the right word for a job the reader stopped?

Yes, and it is the word the other instance already wrote. The article is on the shelf and there is
nothing left to do; `cancelled` would put a Retry on a job with no work and say something false
about a thing the reader can see (`finishIn`'s own argument). **The Stop is recorded**, for an
operator, not for the reader: `jobs.cancel_requested_at` is written by `requestCancel` on both
instances and is not cleared when `cancelling` is, so a `done` row with `cancel_requested_at`
before `finished_at` is a stopped-and-kept import. The claimant's instance also logs
*"stop pressed during the last step, which finished: kept and published"*; the other instance logs
nothing for it.

## The image step: kept, not current

**The hazard** (U17, raised by both reviews). `assets` answers an abort by returning. Every image it
had not fetched is recorded `failed: "network"` (the caller's cancellation falls through to
`network` in `collectAssets` § `reasonFor`), and a PDF figure it had not reached `out-of-time`. The
manifest carried the real `sourceHash`, so it was current, and an ordinary re-run would skip the
step and never fetch them.

**The mechanism, and it is the existing one.** `assets` is a stamped step: `stepIsDone` compares the
manifest's `sourceHash` and `version` against `assetsInputHash(blocks)` and `ASSETS_VERSION`, and a
stamp that does not match is not current. So when `ctx.signal.aborted` after both halves have
returned, the step writes `sourceHash: "stopped-part-way"`, a value the hash can never produce. The
manifest is kept and served (stored images are ours, failed ones hot-link the publisher as any
failed entry does), and the next run of the step that is not forced does it again. The Metadata
page's stage list (`src/store/pg.ts`, the `assets` arm) reads the same field and will call it not
current, which is true. No column, no status. The other options looked at:

- *Does the freshness decider already retry `network` failures?* No. A stamped step's doneness is
  the stamp alone (`stepIsDone` never reaches `isDone`).
- *Commit without finishing the run row* (`interrupted` would then say not done). Needs a new kind
  of commit in `pgStoreSession`; not taken.
- *Commit without the step's stamp.* The stamp **is** the manifest's `sourceHash`
  (`STAMP_SOURCE.assets`), so this is the option taken, spelled as a value rather than an absent
  field because `Assets.sourceHash` is a required string.

**A manifest made after our own deadline never reaches the store**, so the marker only ever lands
from a Stop.

**What a reader sees, and how they recover.** A web article reads normally; the images not fetched
are hot-linked from the publisher, which is the privacy and link-rot cost the step exists to
avoid. A PDF's unreached figures are caption-only. Recovery: *Refresh from source* and *Start again*
force `fetch` / `extract`, and `cascadeForce` forces `assets` with them, so both re-fetch whatever
the stamp says. `assets` is not on the Metadata page's re-run list (`src/rerun-steps.ts`). What the
marker adds is that an unforced job that includes `assets` also redoes it; the path to one from the
UI (pasting an address the shelf already holds, which `enqueue` adopts) was read in the code, not
driven in a browser.

## Which steps can be last, and which can return part of a product

**Any step can be last**: every mode job is a single step, an import ends at `assets`, a minimal
paper's job is `["fetch", "metadata"]`, and the publication successors are `["structure"]` and
`["labels"]`. So the question is which steps *return* after an abort rather than throw.

Found by grepping every step module for abort-tolerant code (`signal.aborted` followed by a
`break`, `return` or a partial result, and catches that do not rethrow on an abort), then reading
each hit. That is a sweep by pattern, not a line-by-line read of 23 steps:

| Step | After an abort it | Done here |
|---|---|---|
| `assets` | returns, with unfetched images `network` and unreached PDF figures `out-of-time` | marked not current (above) |
| `illustrated` | returns: `drawPlates` stops and sets `IllustratedRun.cancelled`, and the step ignored the flag, storing and returning the plates drawn so far, stamped current | **throws the abort instead** when the signal fired, so a stopped painting ends `cancelled` and the last good one stays, exactly as before. Without this, the change above would have published a half-painted set over it. |
| `metadata`, `extract` | returns, without the registry facts (journal, DOI, a date) of any candidate identifier not yet asked: `withRegistryFacts` breaks on `signal.aborted` | **left**: below |
| `structure` | throws (`runSlices`' `done` rethrows on an abort) | nothing |
| `labels` | throws (`if (signal.aborted) throw again`) | nothing |
| `citations`, `debate` | their registry attachment takes no signal, so it runs to completion: the product is whole, not partial | nothing |
| the rest | a model call throws on an abort (`src/ai-call.ts`) | nothing |

## Mutations

Each put in, the named suites run, and taken out (`grep MUTATION` empty afterwards).

| Mutation | Red |
|---|---|
| M1: a local Stop always ends `cancelled` (the old rule) | 3: local Stop on the last step (Postgres and offline), Stop-then-deadline |
| M2: no `cancelled` branch for a local Stop with steps left | **none**: the walk's next progress write reads `cancelling` and ends the job `cancelled` with the same draft outcome, so the branch is defence in depth and no case can see it. Since GPT Sol's C4, 1: an offline case that counts the next step's preparation |
| M3: a local Stop always ends `done` | 2: the earlier-step controls (Postgres and offline) |
| M4: our deadline not told apart (`overran()` throw removed) | 7: the existing deadline cases, and deadline-then-Stop |
| M5: the signals told apart by the clock, not the reason | 1: Stop-then-deadline |
| M6: a Stop the step obeyed ends `done` | 4, including the obeyed-Stop control |
| M7: `assets` keeps the real hash after an abort | 1: the manifest-under-a-Stop case |
| M8: `illustrated` returns its half set | 1: the half-painted case |

## What changed in the tests

- `tests/jobs-walk.test.ts` § *Stop during a last step that finishes anyway*: the two pinned cases
  flipped (local now `done` and published, and both assert the draft pointer cleared and
  `cancel_requested_at` kept), plus five controls. *lets a Stop from a reloaded copy … reach the
  running step* asserted `cancelled` from a step that ignored the signal; its fake step now obeys
  the signal, which is what the case is about.
- `tests/jobs-tier0-offline.test.ts`: the local row flipped, and an earlier-step control.
- `tests/assets-stopped-is-not-current.test.ts` (new, offline): the real step, a control and a
  stopped run, asked through `stepIsDone`.
- `tests/illustrated-step-registration.test.ts`: a Stop while the first plate is drawn.

## Gates

After merging `origin/dev` (2026-10-07):

- `npm run typecheck`: 4 projects, all 3374 source files covered, no errors.
- `tests/jobs-walk.test.ts` 42 passed (Postgres lane); `tests/jobs-tier0-offline.test.ts` passed;
  with `store-migration-registry`, `doc-links`, the new assets test, the illustrated step test and
  three neighbours: 9 files, 166 tests, 166 passed.
- The job, queue, claim, session, retry, billing, pipeline-step and job-card suites by file, in
  three more runs: 18 files / 198 tests, 18 / 278, 18 / 443; all passed.
- Biome on the ten touched source and test files: one error, one warning and seven complexity
  notices, all present at `HEAD` before the change (checked for `src/pipeline.ts` by linting the
  pre-change file).
- Not run: the full `npm test`.

## Review status

GPT Sol reviewed `f81555bc7` ([prompt](261007f-stop-during-the-last-step-keeps-and-publishes-code-review-prompt.md),
[answer](261007f-stop-during-the-last-step-keeps-and-publishes-code-review-sol.md)). Verdict:
**ship with these fixes applied**. Sol's sandbox had no Postgres, so its fixes were then read as a
proposal: each one hand-reverted, its regression seen red, and the file restored byte for byte
(checked by hash). Root cause and class:
[postmortem](../postmortems/261007f-cancellation-checked-before-asynchronous-preparation-finishes.md).

| | Finding | What happened |
|---|---|---|
| C1 | A Stop before the last step's work starts (during the preflight reads with a failed starting note, or while `beginStep` opens the marker) still ran the step and published | **Fixed**: `runStep` checks the signal before and after `beginStep`. Without both checks, the two offline cases end `done`. The check before `beginStep` had no red of its own (the later check also catches a preflight Stop, one marker later), so the preflight case now also asserts no marker was opened; red without that check. Sol's Postgres case (Stop while the marker opens: `metadata` never runs, job `cancelled`, draft pointer cleared, draft revision `failed`) passes, and goes red without the check after `beginStep` |
| C2 | A provider-timeout partial Illustrated set, with a Stop landing during image storage or the runner's ledger and preview settlement, could replace the last good painting | **Fixed**: the step checks the signal after storage, and returns `StepProduct.discardOnAbort` for a cancelled set, which `runStep` checks after `shown.settle()`, just before the commit decision. Each half red without it: the storage case resolves instead of rejecting, the product lacks the flag, and the offline settlement case ends `done` |
| C3 | The early Illustrated throw added in `f81555bc7` dropped a plate already paid for | **Fixed**: the throw moved after storage. Red when moved back (`storePlateImage` called 0 times, not 1) |
| C4 | M2 was a test gap, not a dead branch: without the local-Stop branch the next step's preparation starts, though the job still ends `cancelled` | **Covered**: an offline case counts the power reads. Red under M2 (2 reads, not 1) |
| C5 | A remote Stop during an earlier step can be missed across failed progress reads | **Left**, below |
| C6 | A retried `assets` run rebuilds the manifest | **Left**, below |
| C7 | The card never says the Stop came too late | **Left**: the first item below |

**Is `discardOnAbort` the smallest seam?** Yes. The condition (a partial set, kept only while the
signal is live) belongs to the step, and the last await it must survive (`collectSpend`'s drain and
`shown.settle()`) belongs to the runner, so something has to cross from one to the other. It is
one optional field on `StepProduct`, one producer (`STEPS.illustrated`), one consumer (`runStep`),
and no store, session or transition code sees it. A runner-wide "aborted after `run` returned ⇒
discard" would undo the keep rule this plan exists for, since a whole product is meant to be kept.

Postgres: `tests/jobs-walk.test.ts` 43 of 43 passed in the `private-postgres` lane, Sol's new case
included.

## Left

- **The reader is not told their Stop was overridden.** The card shows *Stopping…* and *"Stopping
  after the current step…"* until the job ends, then the ordinary finished state (*Done — read
  it* on the add page; the card leaves the box eight seconds later). Nothing says the Stop came too
  late. Not false, but silent; a sentence would be a reader-facing change, out of scope. GPT Sol's
  C7 says the same: *"Stopping after the current step…"* is ambiguous, and *Done — read it*
  accurately describes the published result. Any wording is for Greg to choose.
- **A remote Stop during an earlier step can be missed** (Sol's C5). A Stop that reaches another
  instance is seen only through this instance's progress writes, so when the boundary note and the
  next starting note both fail, there is no local abort and later steps can run, and the last one
  can then publish. Predates this change; fixing it is a change to how the row is read, not to the
  keep rule.
- **A retried `assets` run rebuilds the manifest** (Sol's C6). A run after a stopped one starts from
  nothing, so an image the stopped run did fetch and the retry fails to fetch ends up `failed`,
  hot-linked, rather than kept. Existing collection behaviour, not changed here.
- **The Illustrated plates paid for before a Stop are stored blobs, not a checkpoint.** They stay in
  the blob store, but no later run resumes from them: the next painting starts again and pays
  again.
- **`metadata` and `extract` can publish without registry facts** after a Stop that lands during the
  registry lookup (only the identifiers not yet asked are lost; a lookup in flight completes). Low
  value and rare; the facts are filled only by a re-extraction or `src/backfill-registry-facts.ts`.
  Not marked: neither step's stamp has a field that would carry it without a version or a new
  value.
- **Images missing after a stopped import are re-fetched only by a run that includes `assets`.**
  The reader's ways to one are *Refresh from source* and *Start again*, both of which also re-run
  the expensive steps. A cheaper door (an `assets` row on the Metadata re-run list) is a product
  call.
- **`IllustratedRun.cancelled` is also set by a provider `TimeoutError`** with the signal not
  fired (`wasAborted`), and that path still returns the plates drawn so far, as before. Not a Stop,
  not changed.
