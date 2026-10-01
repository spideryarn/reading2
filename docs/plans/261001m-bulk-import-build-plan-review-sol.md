The core design is now viable, and the later “What Opus changed” section should control: one `Points` currency, current-window credit, `superseded_by`, kind-preserving retries, and exclusion of minimal papers from sharing. The thin-article guards also cover the AI-spending paths I found.

The remaining issues are implementation-level but material:

1. **P0 — The owner/hash claim still has an undefined “claimed, but no job” state, so F1 is not closed.**

   The plan atomically checks duplicates, claims the upload, and reserves billing—but it does not atomically create or durably identify the job ([plan:230](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:230)). There is therefore still a period after commit in which the claim has no job.

   Today that exact state is documented as unrecoverable ([routes.ts:5421](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/routes.ts:5421), [routes.ts:5501](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/routes.ts:5501)). If “whose job has not failed” excludes a missing job, a second tab imports the same bytes. If it includes a missing job, an enqueue exception or process crash poisons that hash indefinitely. Deletion makes the ambiguity worse: the upload survives with a stale slug while terminal jobs are deleted ([pg-shelf.ts:431](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/store/pg-shelf.ts:431)).

   **Change:** make `(owner, hash)` a durable canonical import claim carrying a stable reservation and job/attempt identity. Concurrent requests must adopt that identity and idempotently ensure the same job exists. A terminal failure must make that same claim retryable; deletion must stop the stale upload from counting as a live duplicate. Test:

   - two fresh uploads in two tabs;
   - an exception/crash after claim but before job insertion;
   - Retry racing a fresh re-drop;
   - delete, then re-add the same PDF.

2. **P1 — `kind` cannot distinguish an ordinary ingest from *Read this*, so retry and “one upgrade at a time” remain underspecified.**

   *Read this* deliberately reserves an ordinary `ingest` row ([plan:130](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:130)), but the retry design says the reservation’s kind decides whether to use minimal, ordinary-ingest, or upgrade admission ([plan:197](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:197)). `kind='ingest'` cannot make the latter distinction. Existing retry provenance contains only reservation ID and slug ([pg-jobs.ts:219](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/store/pg-jobs.ts:219)), and every paid retry currently goes through ordinary `withIngestSlot` ([admission.ts:289](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/billing/admission.ts:289)).

   **Change:** bind an upgrade reservation to its target article before enqueue—either by using `article_id` for that purpose or adding `target_article_id`. Add a partial uniqueness rule allowing only one unsettled ingest reservation per upgrade target. Retry provenance can then distinguish:

   - `kind=minimal` → minimal admission;
   - `kind=ingest`, no target → ordinary ingest;
   - `kind=ingest`, target article → *Read this* admission.

   The successful target-bound settlement should atomically charge the ingest, set `processing='full'`, and set the minimal row’s `superseded_by`. A zero/multiple-row match must roll the publication back. Null reservations should be accepted only after explicitly verifying the administrator exemption—not merely because generic settlement currently treats null as free ([pg-billing.ts:1281](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/store/pg-billing.ts:1281)).

   This is the simpler correct supersession model: an upgrade reservation names the article from birth; `superseded_by` proves which successful ingest paid for it. The cancel/publication fence already makes their race settle once.

3. **P1 — One currency does not mean one admission predicate; `atTheWall` and headroom need explicit meanings.**

   The ordinary-ingest equation is correct. For old usage `U=100h` and budget `B=100b`, `U+200 <= B+100` is equivalent to `h<b` because `h` and `b` are integers.

   Once minimal rows exist, however, `used >= budget` is no longer the ordinary-ingest wall. For example, with `used=budget−98`, a full ingest is refused by the new equation even though the current `atTheWall` shape says there is room ([pg-billing.ts:642](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/store/pg-billing.ts:642)). The same mismatch reaches `privateHeadroom`, `/profile`, vouchers, sharing suggestions, and admin arithmetic ([half-units.ts:119](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/billing/half-units.ts:119), [pg-vouchers.ts:236](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/store/pg-vouchers.ts:236), [admin-columns.tsx:243](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/admin-columns.tsx:243)).

   **Change:** keep one `Points` currency, but centralise separate policy helpers:

   - ordinary ingest: `used + 200 <= budget + 100`;
   - upgrade: `used + (200 − eligibleCredit) <= budget + 100`;
   - minimal: `used + 2 <= budget`;
   - high power: `used + actualCost <= budget`;
   - full-ingest headroom: `max(0, floor((budget + 100 − used) / 200))`.

   Define `/profile`’s `atLimit` as “cannot add an ordinary article,” not merely `used >= budget`. Make `sharingWouldMakeRoom` test that same predicate. The admin enforcement cell must compute points and suppress its ratio whenever minimal usage is non-zero; a separate minimal-count column alone does not fix the ratio. `describePlan` needs the same `minimal===0` guard.

4. **P1 — The terminal-state seam still describes an outcome, not a reliable contract.**

   The plan correctly names every terminal condition ([plan:248](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:248)), but the current engine:

   - records only `done`;
   - suppresses all terminal rows in its first-list baseline;
   - discards the terminal `Job` returned by `/advance` when `advanced.done` is true ([jobEngine.ts:470](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/jobEngine.ts:470), [jobEngine.ts:650](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/jobEngine.ts:650)).

   Merely broadening `recordCompletions` would still miss a job finishing while the tab is hidden, because the advance response is then the only immediate observation.

   **Change:** specify a watched-job API such as `watchTerminal(jobId, callback)` or `waitForTerminal(jobId)`. Feed it from both direct advance responses and successful job-list reconciliations. Treat absence as “vanished” only after the ID was registered and an authoritative post-registration list omitted it. Test `done`, `error`, `cancelled`, hidden-tab completion, direct-advance completion, and retention before polling.

5. **P1 — The stages contradict the controlling supersession design and split one atomic invariant across stages.**

   The accepted design replaces `superseded_at` with `superseded_by` ([plan:181](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:181)), but Stage 2 still instructs the builder to migrate `superseded_at` ([plan:285](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:285)). It also schedules supersede-on-publish before Stage 3 adds `articles.processing`, even though the controlling invariant says processing flips and supersession happen together ([plan:194](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:194)).

   **Change:** keep the extractor/eval first; make Stage 2 the Points arithmetic, ledger schema, and admission primitives; put `processing`, minimal publication, target-bound upgrade settlement, and supersession together in Stage 3. Each committed stage can then be internally true and green.

6. **P2 — F8 is only half fixed: `article_revisions.raw_sha256` remains unindexed.**

   The build names only the upload owner/hash index ([plan:234](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:234)). `raw_sha256` exists without a supporting index ([schema.ts:620](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/db/schema.ts:620), [schema.ts:1113](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/db/schema.ts:1113)).

   **Change:** add a partial `raw_sha256` index—likely including `article_id`—and inspect the actual owner-scoped duplicate query with `EXPLAIN`.

7. **P2 — Streaming SHA-256 is extra machinery and is not what the reusable upload code currently does.**

   The plan says it reuses the existing hash while hashing as a stream ([plan:241](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:241)). The existing helper is private, buffers the whole `File`, and `requestGrant` always invokes it itself ([upload.ts:61](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/upload.ts:61), [upload.ts:258](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/upload.ts:258)). Web Crypto does not provide an incremental `digest` API, so literal streaming introduces a new hashing implementation or dependency.

   **Change:** for v1, hash only when an item enters a bounded worker—preferably one hashing worker—retain the digest, and pass it into grant creation. That hashes once and never buffers the whole drop. Add incremental hashing only if measurement shows the bounded `arrayBuffer()` approach is unsuitable.

8. **P2 — Three per tab remains queue backpressure, not a per-reader limit.**

   Two tabs can still occupy all six global slots, and the separate single-upload engine can overlap the batch. The plan now states this honestly and defers a server limit ([plan:245](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:245)); the queue itself confirms there is deliberately no per-reader share ([jobs.ts:455](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/jobs.ts:455)).

   **Change:** no v1 change is required if this remains an accepted fairness limitation. Do not treat the browser number as a defence or server invariant; add a server-side owner cap if production contention makes fairness an acceptance requirement.

I found no additional AI-spending bypass once the planned central `loadArticle` 409, transactional enqueue guard, sharing/high-power/reset guards, and strict upgrade settlement are implemented. Empty blocks/tree are safe for shelf scalar derivation, while the public shelf already requires both.

*build with changes*