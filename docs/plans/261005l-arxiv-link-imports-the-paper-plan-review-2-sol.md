The plan still has one established P0 and one established P1. F2’s revised design is sound.

## Findings

### F11 — P0 — established: the deployment window still permits two charged ingests

(a) The plan explicitly leaves this sequence open at [the deployment-compatibility section](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md:135):

1. Before deployment, an active `/pdf/<id>` job has its original URL, `url_key`, `work_key`, and reservation.
2. After deployment, an `/abs/<id>` request is canonicalised to `/abs/<id>`.
3. The proposed unresolved in-flight comparison does not match the active `/pdf/` job.
4. `freeSlug` mints another slug.
5. The new resolved `urlKey` does not conflict with the old persisted `/pdf/` key, so [the insert](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/store/pg-jobs.ts:584) succeeds with the new reservation.
6. Both jobs can publish and settle successfully: two articles and two charges for one paper.

Calling this “today’s behaviour” does not close F1; it deliberately retains its P0 consequence.

(b) Replace the final deployment-window bullet with:

> **Deployment compatibility is part of the invariant.** Before changing `urlKey`, add a red Postgres test that seeds active `/pdf/` and `/html/` jobs with their old `url`, `url_key`, `work_key` and ingest reservation, then enqueues the equivalent canonical `/abs/` request. It must hand back the existing job and release the new reservation: one active job and one slot. Implement either an atomic migration of the active keys or a race-safe direct hand-back when `sameWork` under the current resolver identifies the old holder. Do not treat a second article during deployment as acceptable existing behaviour.

### F12 — P2 — established: retries bypass `sourceAddress` and can make a new paste loop to 409

(a) [`retryJob`](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/jobs.ts:4553) copies `old.url` directly into `enqueue`; it does not pass through any caller named in the plan’s `sourceAddress` bullet. The same is true of the URL-bearing cost/deepen eval callers.

For a failed pre-deploy `/pdf/` ingest with no published revision:

1. Retry inserts a new job whose `Job.url` remains `/pdf/`, but whose newly computed `url_key` is the resolved common arXiv key.
2. A new canonical `/abs/` paste does not see that retry through the proposed unresolved [`inFlightSlugForUrlKey`](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/jobs.ts:4322), so it mints.
3. The insert conflicts on `jobs_active_source` and returns `sourceTaken`.
4. The [`sourceTaken` repair](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/jobs.ts:3696) calls `freeSlug` again, which still cannot see the noncanonical retry.
5. This repeats until the 20-attempt 409.

No second charge lands because the new reservation is released, so this is P2 rather than P0/P1.

(b) Add after the `sourceAddress` bullet:

> **Canonicalisation is enforced at `enqueue`, not by an exhaustive caller list.** Before computing `workKey`, allocating a slug, computing the source key or constructing `Job.url`, `enqueue` applies `sourceAddress` to every supplied `request.url`. Route, UI and CLI callers may also use it for validation or display, but correctness does not depend on them remembering. Add a red test retrying a pre-deploy `/pdf/` job and then enqueueing `/abs/`; the second request must hand back the active retry rather than loop through `sourceTaken`. Cover every production and eval caller that supplies `url`.

### F13 — P1 — established: HTML activation is still permitted with fixes 4 or 6 unresolved

(a) The plan says HTML-first waits for the fixes, and the stated exception applies only to fix 7. But:

- [Fix 4](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md:302) permits the known table loss merely to be recorded.
- [Fix 6](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md:315) likewise permits an unresolved cross-reference loss to be recorded.
- [The activation step](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md:321) then unconditionally adds HTML-first.
- The rerun judges only the two PDF-winning papers, so it does not recheck the paper containing fix 4’s lost tables.

Thus the checklist can ship HTML while a known extractor-caused authored-content loss remains, beyond the one explicit fix-7 exception.

(b) Insert before the rerun:

> **Fixes 1–6 are activation gates.** If fix 4 cannot preserve the table safely, or fix 6 is caused by our extractor and cannot be repaired under the rewrite rules, do not add the HTML candidate; return the format choice for a decision. Fix 7 is the sole exception: it may be recorded and reported without blocking only when repairing it would require changing the sanitiser’s policy. Re-run every paper containing an unresolved or repaired fault, not only the two whose original overall judgement preferred PDF.

## Disposition of the previous findings

| Finding | Round-2 result |
|---|---|
| F1 | Not fixed: F11 remains P0; F12 is a non-blocking retry/caller gap. |
| F2 | Fixed. `final_url` consistently serves as the fetched document address. Shelf lookup resolves HTML/PDF through the new `urlKey`; `readMeta`/`metaFrom`, source links, citation identity, registry/backfill, and exports accept that address. Refresh reads it through `urlForSlug`, and the fetch resolver selects the paper again. The deleted database importer introduces no live mismatch. |
| F3 | Fixed: fallback and final-candidate kind contracts are explicit. |
| F4 | Fixed as the agreed wording restriction. |
| F5 | Fixed: origin, versioned import identity and versionless work identity are separated. |
| F6 | The rewrite-safety contract is fixed; its activation fallback contributes to F13. |
| F7 | The required rollback machinery is now explicit; its activation fallback contributes to F13. |
| F8 | Fixed: SVG remains publisher-hosted and outside the owned-asset allowlist. |
| F9 | The evaluation claims are now appropriately bounded. The sole fix-7 overrule is recorded, but F13 shows the checklist unintentionally extends it. |
| F10 | The first stage correctly remains PDF-only; the later activation gate is incomplete under F13. |

No files were changed. I did not run a test file: the blocking sequences follow directly from the proposed, not-yet-built control flow and persisted-key contracts.

VERDICT: build it after fixing F11,F13