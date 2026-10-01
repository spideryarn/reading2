Verdict: **rethink**. Batch selection is a useful primitive, but this design does not yet provide idempotency, cross-tab concurrency control, or reliable completion tracking. Its chosen shipment is also only a quota-sized convenience, not yet the “thousands of near-free papers” stepping stone Greg requested.

## Findings

### F1 — P0 — Established: dedupe is racy and can charge twice

`POST /api/uploads/known` is only a read-before-write check. Two tabs can both receive “unknown”, mint distinct uploads, and successfully import the same bytes twice. Each successful job takes a separate slot.

Evidence: [plan:101](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:101), [upload-records.ts:71](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/upload-records.ts:71), [ingest-queue.md:1062](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/docs/project/ingest-queue.md:1062), [routes.ts:9331](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/routes.ts:9331).

This violates the requested idempotency and is incorrect charging under the supplied severity definition. The batch path needs an atomic server-side owner+hash claim or collapse at admission. `/known` can remain as a UX optimisation, but cannot be the guarantee. The intentional single-upload behaviour can remain unchanged through a separate batch-grant route or explicit dedupe flag.

### F2 — P1 — Established: the “two of six” limit is only per tab

A module singleton is per browser realm, not per reader. Two tabs run four batch imports; three tabs can fill all six. A batch can also overlap the existing single-upload engine because its `ONE_UPLOAD_AT_A_TIME` check only sees its own snapshot.

Evidence: [plan:115](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:115), [plan:185](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:185), [jobs.ts:455](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/jobs.ts:455), [uploadEngine.ts:408](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/web/uploadEngine.ts:408).

If protecting the shared queue is a requirement, it needs a server-side per-owner batch/ingest limit covering every tab and the single-upload path. Otherwise the plan must withdraw its fairness claim.

### F3 — P1 — Reasoned: terminal-state observation is not designed

The batch starts another file “when the import finishes”, but the existing completion feed announces only `done`, not `error` or `cancelled`. In addition, job polling stops while the tab is hidden; `/advance` receives the terminal `Job` but currently discards it except for `done: true`. A batch watching the job-engine snapshot can therefore stall after its first two files when the user changes tabs, or forever when an import fails.

Evidence: [plan:105](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:105), [jobEngine.ts:429](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/web/jobEngine.ts:429), [jobEngine.ts:488](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/web/jobEngine.ts:488), [jobEngine.ts:650](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/web/jobEngine.ts:650), [types.ts:2931](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/types.ts:2931).

The plan needs an explicit `waitForTerminal(jobId)`/terminal-event seam and tests for `done`, `error`, `cancelled`, hidden-tab completion, and a terminal row disappearing through retention. Ordinary in-app navigation is otherwise fine: an App-bound singleton survives it.

### F4 — P1 — Established: “importing” is not a well-defined upload state

Uploads have `pending`, `claimed`, `verified`, `rejected`, and `expired` states, while the job separately has active and terminal states. The proposed response compresses these into `"article" | "importing"`.

A `pending` record may represent an active PUT, an abandoned grant with no bytes, or fully arrived bytes not yet queued. A `verified` upload may belong to a later-failed ingest. Treating all of either state as “importing” can make re-dropping skip a file indefinitely; excluding pending records restores the F1 race.

Evidence: [plan:110](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:110), [schema.ts:2009](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/db/schema.ts:2009), [upload-records.ts:102](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/upload-records.ts:102), [routes.ts:5387](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/routes.ts:5387).

The intended policy should be explicit:

- Owned article: yes, including archived. I would match any owned **published revision**, not failed drafts.
- Active ingest: yes, only with a linked `queued`/`running` job.
- Pending transfer: a distinct state, not “already in”; it needs polling/takeover/expiry semantics.
- Rejected, expired, cancelled, or terminal-error job: not known; optionally return a retryable failure separately.
- Another owner: always absent.

### F5 — P1 — Established: default auto-modes defeat the backpressure and create a large spend fan-out

The batch inherits a setting that defaults on. Each completed paper queues six jobs; five are posted together, and compatible mode jobs can run concurrently. The next ingest also starts immediately. Thus one batch can fill the global six-job cap even without multiple tabs, and a 200-file batch can enqueue roughly 1,200 extra jobs.

Evidence: [plan:121](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:121), [auto-modes.ts:139](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/web/auto-modes.ts:139), [auto-modes.ts:161](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/web/auto-modes.ts:161), [auto-modes.test.tsx:91](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/tests/auto-modes.test.tsx:91), [pg-jobs.ts:757](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/store/pg-jobs.ts:757).

Batch auto-modes should default off and require a deliberate batch-wide choice with a clear paid-work warning. If enabled, their jobs must participate in the batch’s backpressure rather than being an unbounded side fan-out.

### F6 — P1 — Reasoned: the minimal upgrade path is not yet a valid admission/storage design

The product shape—a separate to-read record rather than a malformed article—is sound. The implementation description is not complete enough to establish security or quota correctness.

Today bytes become content-addressed only inside `acquireUpload`, after an admitted ingest has claimed the upload. Once a minimal pipeline has claimed and verified that upload, the existing `{uploadId}` route cannot reuse it: a verified record with no job/article falls into the 409 path. Using `{slug, steps}` instead would be the free re-run bypass the plan correctly warns against.

Evidence: [plan:155](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:155), [pipeline.ts:1612](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/pipeline.ts:1612), [pipeline.ts:1628](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/pipeline.ts:1628), [routes.ts:5393](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/routes.ts:5393), [security-map.md:95](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/docs/project/security-map.md:95).

The eventual route should accept only an opaque minimal-paper ID, verify ownership, rebuild the storage key from that owned row, reserve through `withIngestSlot`, and atomically prevent two upgrades. It must never accept a client-supplied hash/path. DOI is safe as text; if rendered as an `href`, model output needs URL validation. Abstracts later fed into profiles/prompts remain untrusted document content and need fencing.

### F7 — P1 — Established/reasoned: the client path hashes every file twice and is unbounded

The plan first hashes every file for `/known`, then says the engine reuses `requestGrant`, which always hashes the whole file again. `sha256Hex` materialises the complete file in memory. At the stated maximum, 200 × 50 MB is 10 GB of data per pass; a parallel preflight can exhaust browser memory, while even bounded execution reads up to 20 GB twice.

Evidence: [plan:101](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:101), [plan:139](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md:139), [upload.ts:61](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/web/upload.ts:61), [upload.ts:258](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/web/upload.ts:258).

Compute once, retain the digest with each queue item, pass it into grant creation, and bound hashing concurrency. Until measured, 200 should not be treated as a demonstrated browser-safe cap.

### F8 — P2 — Established: neither hash lookup has a supporting index

`article_revisions.raw_sha256` is an unindexed column. Uploads have only `(owner_id, minted_at)`, not owner+hash. The plan’s “indexed-enough query” claim is therefore false at the scale it is targeting.

Evidence: [schema.ts:621](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/db/schema.ts:621), [schema.ts:1126](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/db/schema.ts:1126), [schema.ts:2027](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/db/schema.ts:2027).

Add a partial `raw_sha256` index and an owner+claimed-hash partial index for whichever upload states the final state machine actually queries, then inspect `EXPLAIN`.

## Answers to the broader questions

The raw hash itself is sound: for both uploaded PDFs and HTML, `raw_sha256` is computed over the bytes received from the browser before HTML decoding. HTML’s `raw_source_sha256` may differ after re-encoding, but that is not the proposed column. Evidence: [pipeline.ts:1581](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/pipeline.ts:1581), [pipeline.ts:1641](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/pipeline.ts:1641), [artifacts-pg.ts:1085](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/src/store/artifacts-pg.ts:1085).

An owner-scoped hash query does not inherently leak another reader’s holdings. The essential tests are another owner with the same hash for both articles and every upload state, plus unauthenticated access. No hash or cross-owner source pointer should be returned.

On scope: building “minimal, but still charging it a slot” is not a better stepping stone; the plan is right about its lack of reader value. But the full-import batch is also not “most of the way” to thousands—the reusable parts are file selection, atomic owner/hash registration, storage, and status UI, while the full-ingest completion scheduler is specialised work.

The better sequence is:

1. Get Greg’s explicit decision on whether the cheap-model metadata call is slot-free and on the protective minimal-paper ceiling.
2. Build an owner-scoped minimal-paper/source registry with atomic hash idempotency and an admitted upgrade route.
3. Put the PDF batch UI over that.
4. Add batch full-import and optional modes afterwards.

PDF-only is the cleaner initial boundary. HTML works technically, including hash equality, but it does not advance the minimal-paper metadata spike and adds another product/test branch.

Finally, the spike numbers are plausible—the no-model counts reproduce—but the cheap-model script only prints one run and commits neither scored results nor token totals. Its 13/13 claims are manual observations, three files lack expected metadata, and prompt-injection resistance is based on one stochastic attempt. That is adequate exploratory evidence, not yet a production acceptance test. Evidence: [cheap-model-spike.mts:7](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/evals/pdf/minimal-metadata/cheap-model-spike.mts:7), [cheap-model-spike.mts:29](/home/greg/code/spideryarn2/.claude/worktrees/fb-bulk-import-minimal/evals/pdf/minimal-metadata/cheap-model-spike.mts:29).