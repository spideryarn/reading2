**Verdict: build with changes.** The publication hook is suitable, but the fixture exclusion, High-powered guarantee, and opt-out handover are inaccurate as written.

Reviewed commit `b29a4c166` against the current source. No files changed; no tests, Postgres commands, or network commands ran.

1. **F1 — P1, ESTABLISHED: the fixture loader satisfies the proposed trigger.**

   The plan calls the fixture loader a job-less publication. It actually inserts a synthetic running job, opens its draft, and calls `publishRevision({ …, job })`: [load-article.ts:389](/home/greg/code/spideryarn2/.claude/worktrees/post-import-modes-on-server/tests/helpers/load-article.ts:389), [load-article.ts:484](/home/greg/code/spideryarn2/.claude/worktrees/post-import-modes-on-server/tests/helpers/load-article.ts:484). On its first full load, every part of the proposed condition is true. Cleanup deletes only the synthetic parent; the seven successors survive.

   Expected regressions include:

   - `tests/helpers-load-article.test.ts:295`: explicitly expects no jobs after loading.
   - `tests/jobs-walk.test.ts`: `scratchArticleInPg` loads through this helper before queueing test jobs. Exclusive jobs such as `[fetch, extract, blocks]` then remain blocked behind undriven automatic jobs.
   - The “advancing a job” group in `tests/jobs.test.ts`: the same fixture setup leaves predecessors blocking its fetch/extract jobs.
   - `tests/claim-session-postgres.test.ts:1139`: its first real fixture ingest would queue successors, preventing the subsequent exclusive re-extraction from claiming.

   The named labels-successor and reset suites mostly publish initial fixtures **without** jobs, so those initial publications remain unaffected. Client assertions about completion posting modes are intentionally invalidated by the plan.

   **Smallest plan change:** add an explicit import-eligibility condition alongside “first full publication,” using the fenced job’s provenance. Existing `reservesName` can distinguish newly importing jobs from this fixture job; retain the minimal-upgrade branch and explicitly exclude resets. Test failed-import retries and administrator imports—`ingestEventId` alone is insufficient because administrators reserve nothing. Decide separately whether CLI/eval imports count; `opts.job` does not identify a human front door.

2. **F2 — P1, ESTABLISHED: waiting behind labels does not replace awaiting the High-powered switch.**

   Today, [AddPage.tsx:174](/home/greg/code/spideryarn2/.claude/worktrees/post-import-modes-on-server/src/web/AddPage.tsx:174) queues modes only after `highPower.settle()` resolves. That promise waits for an outstanding switch request: [add-high-power.ts:142](/home/greg/code/spideryarn2/.claude/worktrees/post-import-modes-on-server/src/web/add-high-power.ts:142).

   The proposed replacement permits this sequence: the reader ticks High-powered during import; its request remains pending; publication queues modes; labels finishes; a mode starts and reads the still-null `high_power_since`. Removing the caller’s `then` removes the existing barrier. Labels’ measured duration places no bound on the switch request’s duration, and labels can also fail or be cancelled quickly.

   `readStepPower` **does** run for each step, before freshness checking and execution ([jobs.ts:1035](/home/greg/code/spideryarn2/.claude/worktrees/post-import-modes-on-server/src/jobs.ts:1035)). Consequently, a switch **committed before that read** is respected. It cannot respect an outstanding request.

   **Smallest plan change:** replace the timing argument with an explicit ordering mechanism for pending High-powered intent, and add a test that holds the switch request unresolved while labels ends. If the intended guarantee covers only committed switches, say that explicitly and acknowledge the weaker behavior.

3. **F3 — P1, ESTABLISHED: “nobody’s opt-out is lost” is false during rollout.**

   An already-open old client knows only the browser key, read by [auto-modes.ts:202](/home/greg/code/spideryarn2/.claude/worktrees/post-import-modes-on-server/src/web/auto-modes.ts:202). With that key set to `off`, it makes no mode requests and sends no reader-setting PATCH. The additive migration leaves the server setting null—meaning **on**—so the new server queues modes anyway.

   Putting handover only on AddPage also misses updated clients importing through a hover card or pressing *Read this* before visiting that page. Deleting the key after merely sending the PATCH would additionally lose the preference on a failed request.

   **Smallest plan change:** put handover in the authenticated application startup path, await successful persistence before admitting new imports, and delete the key only after confirmation. Explicitly address already-open old clients: the server cannot discover their private browser preference. A client-first rollout/reload strategy or an accepted compatibility limitation must replace the unconditional promise.

4. **F4 — P2, ESTABLISHED: deduplication requires identical requests, not merely the same target step and profile.**

   [workKeyFor:81](/home/greg/code/spideryarn2/.claude/worktrees/post-import-modes-on-server/src/store/jobs.ts:81) hashes the **whole ordered step list**, force flags, profile, upload/source identity, and applicable extras. The successor and ordinary unforced single-step press do match when all these inputs match.

   Skim is the counterexample to the broader wording: the automatic job contains `[quotes, ideas, skim]`, while [useSkim.ts:194](/home/greg/code/spideryarn2/.claude/worktrees/post-import-modes-on-server/src/web/useSkim.ts:194) omits prerequisites already present. Those keys differ even with the same profile. Forced presses also differ.

   The old-client guarantee needs another qualification: *Save and open* can save a purpose **after publication**, so its later requests resolve a different profile from the server snapshot. Ideas includes the profile in its freshness stamp (`src/pipeline.ts:3707`), so this can cause another paid Ideas generation, rather than merely an extra skipped row.

   **Smallest plan change:** say “identical unforced request and rendered profile, while the holder remains active,” and record Skim’s narrower requests and post-publication profile changes as exceptions. Carry the predecessor plan’s Skim qualification forward.

5. **F5 — P1, REASONED: the labels ordering claim overlooks a deduplicated holder’s timestamp.**

   For **newly inserted** labels and modes in the same transaction, `after: 1, 2, …` establishes the promised ordering. But `enqueueSuccessorIn` can return `alreadyQueued` without changing the holder’s timestamp. Reader-posted jobs use the application clock (`src/jobs.ts:3459`); successors use transaction `now()`.

   A labels job queued during import by an instance whose clock is ahead can therefore sort **after** the new mode successors. [blockedByAnother:804](/home/greg/code/spideryarn2/.claude/worktrees/post-import-modes-on-server/src/store/pg-jobs.ts:804) blocks on older queued jobs and all running jobs; an exclusive queued job behind the candidate does not block it. The timestamp-skew premise makes this reasoned rather than observed.

   **Smallest plan change:** order modes after the actual labels holder when deduplication occurs, or enforce an explicit labels dependency. Add a test with an existing queued labels holder whose timestamp is later than publication.

The five requested claims therefore resolve as follows:

| Claim | Assessment |
|---|---|
| First-full condition is computable from existing state | **Yes.** `lockArticle` holds the pre-publication pointer and processing state; `upgradedFromMinimal` already exists. Its asserted exclusions are incomplete—F1. |
| Successor key equals a reader press | **Yes for identical request inputs; not universally**—F4. |
| Modes cannot claim before labels ends | **Yes for newly inserted, correctly ordered successors; not unconditional**—F5. |
| Each step reads current article power | **Yes**, but this does not await pending switch intent—F2. |
| Successors reserve and charge nothing | **Correct for ingest quota.** Their insert sets `ingestEventId: null`, `reservesName: false`, and `urlKey: null`. Model spending remains attributed through `collectSpend` to the job and step (`src/jobs.ts:1141`). |
| Existing first-publication tests avoid wholesale disruption | **No under the written trigger**, chiefly because the shared fixture loader is job-backed—F1. |

I found no RLS obstacle to the profile read. Ownership is enforced in application queries; the publication already locks the owner’s article. Read `reader_profiles` through the supplied transaction using that article’s `ownerId`, and take purpose from the locked article row.

There is also an additional publication failure surface: any automatic successor insertion that ultimately throws will roll back the publication and its settlement. `enqueueSuccessorIn` deliberately throws after two unclassified conflicts. Keeping that atomic behavior is coherent, but the plan should acknowledge it and test a failure on a **later mode successor**, proving that the pointer, earlier successors, and billing settlement all roll back.

Finally, queueing is durable, but execution still needs a driver. Successors start no pump; production’s pump is disabled under Vercel. With every browser closed, they wait until an authenticated client drives them. The plan should distinguish that from server execution without a browser.

**Build with changes**, with F1–F3 resolved before implementation.