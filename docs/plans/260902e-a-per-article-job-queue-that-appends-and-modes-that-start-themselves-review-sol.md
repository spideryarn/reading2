# Verdict

**NO-SHIP as written.** The storage prerequisite is genuinely built, and the recut fixes several earlier objections. Four design gaps remain:

- Global FIFO can be poisoned by another owner’s invisible queued job.
- “Skip a cancelling predecessor” contradicts the global running mutex.
- Simultaneous first ingests of one URL can mint different slugs and evade all three indexes.
- The activation-token protocol is not precise enough to survive rapid navigation, StrictMode, and manual/automatic races.

## The prerequisite

It is built.

- [`claimSession`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/jobs.ts:1211) selects `openPgStoreSession` under Postgres.
- [`openPgStoreSession`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/store/pg-session.ts:235) opens the job’s draft from the current article revision.
- Late stages call `readArticle(ctx.slug, store)`.
- The end-to-end test really does ingest under one job, run `arc` under another, prove it read the published blocks, and prove the result was published: [`claim-session-postgres.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/tests/claim-session-postgres.test.ts:647).
- `c42c940` is an ancestor of this branch.

One stale statement remains outside the plan’s cleanup list: [`late-step-on-a-cold-instance.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/tests/late-step-on-a-cold-instance.test.ts:149) still says production does not provide this store. That is now false.

## Answers to the four open questions

1. **FIFO with no sweep:** No age sweep, but not sound as currently specified. For one owner, durable queued jobs are visible, stoppable and resumed by every owner tab. Globally, however, an owner cannot see or stop another owner’s predecessor. Prevent foreign slug-named jobs at enqueue, and add a migration/preflight rule for existing cross-owner rows. FIFO does not need `last_seen_at`; it does need invalid blockers to be impossible or explicitly removable.

2. **`reserves_name = slug was minted`:** Yes, including uploads. Uploads call `slugWithShortId` directly, so they always mint and therefore reserve. Make the distinction explicit in a discriminated slug-allocation result; do not infer it later from `url`, `upload`, or the slug string. The three-index design is still incomplete because of simultaneous URL minting and legacy-row migration.

3. **Inputs at claim time:** The real late stages do see the predecessor’s newly published revision. Their draft is opened after claim, and their stamps now cover the inputs they actually read. The plan’s Summary example is stale: `summary` is no longer a pipeline step—the free Summary band reads the existing tree ([`StepName`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/types.ts:1889), [`SummaryBand`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/App.tsx:2605)). Replace this test with re-extraction A followed by a queued `arc`, `ideas`, `timeline`, or `sketch` B, asserting B’s stored fingerprint matches A’s new revision.

4. **Delete the blocking path:** Yes, once enqueue reliably returns the requested queued job. That job already renders as “Waiting to continue.” through [`displayJob`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/job-state.ts:136), with Stop available. Keep generic HTTP failure handling; delete only `JobConflict`, `blockingJob`, the structured `blocking` payload, and blocker-specific UI. Do this only after the invisible cross-owner blocker is closed.

## Detailed review

### 1. FIFO and no sweep

The no-sweep decision remains right. A queued row consumes no running slot, and returning owners resume it. `last_seen_at` still cannot distinguish abandonment from a suspended browser.

The problem is scope. Job lists and cancellation are owner-scoped, while the proposed predecessor query is global. The API currently accepts any syntactically valid slug, and profile lookup deliberately swallows a missing owner article ([`parseJobRequest`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/routes.ts:4142), [`resolveProfileParts`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/routes.ts:4548)). Thus owner B can queue work against owner A’s known slug and leave. A’s later job sees an older global predecessor that A cannot list, drive or stop.

Require ownership of every slug-named target at enqueue. New URL/upload mints remain the exception and are governed by reservation. The migration should refuse or reconcile any existing active cross-owner duplicate slugs.

There are two more FIFO issues:

- `(created_at, id)` is deterministic, but not necessarily request order. Postgres is explicitly given the application’s millisecond timestamp, and `id` is random; two quick requests can tie and then run in random-id order. Either add an internal monotonic queue ticket and serialize enqueue against claim, or call this “deterministic order,” not FIFO.
- Enqueue does not take the claim lock. A transaction that began first but commits after a later job claims is invisible to the predecessor query. Exact FIFO therefore needs a declared linearization point.

### 2. The three indexes

The responsibilities and scopes are otherwise right:

- `jobs_one_running_per_slug`: global article mutex.
- `jobs_reserved_slug`: global name reservation.
- `jobs_active_work`: owner-scoped request deduplication.

Their overlap is expected:

- Reservation + work: two queued minted copies of the same request.
- Running + reservation: two running name claimants.
- Running + work: two running copies of one non-reserving request.
- All three: two running, reserving copies of one request.

Therefore re-reading is the correct response to `ON CONFLICT`; constraint-name dispatch is not.

The re-read predicates must exactly match the indexes:

- Matching work excludes `cancelling`.
- Active reserver includes `cancelling` until terminal.
- A same-work row must be matched by owner, slug and work key.
- A reserver must be found globally.

States that escape all three include:

- Distinct queued, non-reserving work on one slug—intended.
- Cross-owner queued, non-reserving work—unsafe unless enqueue authorization makes it impossible.
- Queued `cancelling=true` rows—schema-valid but unreachable through the current cancellation API. Consider a check that `cancelling` implies `running`.

Most importantly, truly simultaneous first ingests of one URL escape all three. Both calls can see no existing URL, then [`freeSlug`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/jobs.ts:2286) mints a different random slug for each. Since every proposed unique key includes the slug, neither insert conflicts. The plan’s claim that identical URL ingests necessarily violate both reservation and work indexes is no longer true after random short IDs.

Close that with an atomic active-source claim—probably a private normalized URL key and owner-scoped active-source uniqueness—or a transaction/advisory lock around lookup plus mint plus enqueue.

The migration also needs a real rollout:

- How `reserves_name` is initialized for existing rows.
- A preflight for cross-owner running rows before creating the global mutex.
- A safe choice for old filesystem records without the new sibling field.
- Preferably drain/refuse active Postgres jobs rather than guessing which historical rows minted their slug.

### 3. `reserves_name` and uploads

The definition is correct. Return something like `{slug, kind: "minted" | "adopted"}` from slug allocation so the caller cannot lose the fact.

The proposed “two `paper.pdf` uploads get two slugs” test is weak: random short IDs make it pass even if `reserves_name` is never persisted. Add:

- A forced/stubbed identical minted-slug collision.
- Persistence and reload of `reserves_name` in the filesystem adapter.
- Two global reservers belonging to different owners.
- A simultaneous same-URL barrier test before either enqueue is visible.

### 4. Other single-active-job assumptions

The plan found the important sites, but each needs a precise replacement:

- `activeForSlug` has no production callers now. Delete the contract and both implementations instead of inventing another ambiguous singular lookup.
- Upload repeat recovery must match `job.upload.id === uploadId`, including a terminal ingest after reload. Its current slug lookup can return an unrelated later mode job: [`jobForSlug`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/routes.ts:4275).
- `useStepJob` must choose the running matching job first, otherwise the oldest queued matching job—not whichever appears first in a newest-first list: [`useStepJob`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/useStepJob.ts:202).
- `inFlightSlugForUrlKey` needs to participate in the atomic source-claim design; merely choosing a deterministic first row does not close the simultaneous-mint race.
- The plan correctly calls out [`running-slot.ts`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/tests/helpers/running-slot.ts:91). Its mocked unit test can remain green after the live guarantee disappears, so the replacement needs a real database contention case.

### 5. Cancelling contradicts “unblocks immediately”

A queued Stop becomes terminal immediately. A live Stop leaves the job `running, cancelling=true` until its claimant releases or its lease expires ([`requestCancel`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/store/jobs-fs.ts:480)).

If FIFO skips that running predecessor, the successor still cannot become running because `jobs_one_running_per_slug` continues to cover the predecessor—as the plan correctly requires for write safety. The successor either receives a unique violation or must classify it as busy. It cannot claim immediately.

So:

- Keep a cancelling running predecessor in the effective block.
- Say the successor unblocks when cancellation becomes terminal.
- Replace test 1i.4. A queued-cancelling predecessor is an artificial state and can make the test green while the real running-cancelling path remains broken.
- Add the real sequence: claim A → Stop A → B remains waiting → A releases/settles → B claims.

### 6. Activation tokens

A boolean or single global token is insufficient. The event should include at least:

```ts
{ nonce, sessionEpoch, slug, targetMode }
```

It must be set only by the actual Dock and Sketch button handlers, not by the generic query-state setter. Current gesture seams are [`DockModes.onClick`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/Dock.tsx:955) and the Sketch chip’s [`onClick`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/DiagramPanel.tsx:1373).

Required lifecycle rules:

- A token matches exactly one owner, slug and mode.
- Clicking the already-selected mode still creates a fresh nonce and re-renders.
- Consumption is atomic, so StrictMode’s two effects cannot spend it twice.
- Retire it after the GET settles as ready, none, or error—not only after `none`.
- Slug/session changes invalidate it.
- Rapid Ideas → Quotes clicks must not overwrite and lose the Ideas intent.
- Decide explicitly whether an already-started check continues after its panel unmounts. Otherwise rapid navigation recreates the previous review’s “clicked, but never started” race.
- Back/Forward must never manufacture or revive an activation.

### 7. One-attempt guard and force

Put the guard in `jobEngine` as a session-owned set keyed by `(slug, step)`. Expose a synchronous “begin automatic attempt” operation that inserts before the POST and returns false if already present. Clear the set in the engine’s existing session teardown, so signing into another account in the same tab cannot inherit it.

The hooks also need two verbs:

- `ensure()`—unforced, for auto-run and empty/error-state manual buttons.
- `regenerate()`—forced, for a button beside an existing current artefact.

Today Ideas, Quotes, Timeline and Sketch use forced work even from their empty states; for example [`useIdeas.find`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/useIdeas.ts:144). If auto is unforced but the visible empty-state button remains forced, a click during the auto-start window has a different `work_key` and queues a second paid job. A `starting` state alone reduces that window but does not make the identity rule correct.

For first-poll reconciliation, track the exact ID returned by `start`. If that ID first appears as `done`, call the artefact reload once even though the engine globally treats its first list as history ([`recordCompletions`](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/jobEngine.ts:389)). Do not turn every historical completion into news.

### 8. Tests that can go green falsely

The proposed suite needs these corrections:

- The cancelling-predecessor test exercises an unreachable state and asserts impossible immediate progress.
- Two filenames producing random distinct slugs do not test reservation.
- A sequential double-click does not test the simultaneous URL-mint race; use separate requests/connections with a barrier.
- Reverse claims do not prove FIFO when timestamps tie or when an earlier enqueue is still uncommitted.
- “Two owners cannot run simultaneously” does not catch one owner’s invisible queued row blocking the other.
- The late-step result test must assert the actual source fingerprint/revision, not merely that an artefact exists.
- StrictMode must mount once under real `<StrictMode>`, not manually mount twice.
- URL/history tests must let the artefact GET settle and effects run; asserting no POST too early is vacuous.
- First-poll completion must begin with an unseeded real engine, return the POST receipt, make that exact job `done` on the first list, and assert one artefact reload.
- Add rapid mode switching, clicking an already-active mode, slug change during GET, GET failure followed by navigation, and auto/manual overlap.
- Visitor coverage belongs in the real public network trace for all five targets, including signed-in non-owners.

Once those four blockers and the test shapes above are written into the plan, the overall two-stage cut is sound.