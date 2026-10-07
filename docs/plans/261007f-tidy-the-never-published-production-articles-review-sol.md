**Safe after these changes. I would allow none with the current script.** The supplied evidence supports the proposed set, but the executable does not fully enforce its safeguards.

Reviewed commit `f81253134`. No files changed; no database access or tests run.

**R1 — P0: eligibility can change before the deletion lock is acquired.**

Path: [destroyEach](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:400) → [destroy](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/src/store/pg-shelf.ts:466).

The read-only proof commits before `destroy` starts its separate transaction. `destroy` then waits for the billing lock, locks the article, and checks only live jobs and stranded reservations. It does **not** recheck publication, revisions, reader state, quietness, or the pinned article id.

A concrete loss path needs no fast import: after the proof, while deletion waits for the billing lock, `PATCH /api/library/:slug` saves a purpose or title. That route explicitly supports unpublished articles. Deletion subsequently erases the new reader state; the earlier backup lacks it.

A draft or publication committed in that interval is also unprotected once its job becomes terminal. The plan’s “milliseconds” argument is not a concurrency guarantee.

**Smallest change:** add a guarded deletion path that checks the pinned UUID and complete eligibility **after acquiring the billing and article locks, inside the deleting transaction**. Also verify that the rows being removed are represented by the backup. Add a concurrency test that writes protected state between the preliminary proof and lock acquisition.

**R2 — P1: production deletion does not require `--prod`.**

Path: [target selection](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:457).

Without `--prod`, the script trusts `.env.local` regardless of its database host. Copying production’s URL into that file, then running `--delete --ids … --backup-dir …`, can delete production rows without `--prod`. TLS validation does not prevent this.

The two database handles are otherwise aimed consistently: `loadEnvLocal()` is memoized, and assignment precedes construction of the store pool. Shell exports do not select the survey target.

**Smallest change:** before connecting, refuse a nonlocal target unless `--prod` is present, using the existing `isLocalDatabaseUrl` guard. Test the remote-in-`.env.local` case.

**R3 — P1: an ordinary option can weaken the reviewed seven-day rule.**

Path: [argument validation](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:459).

`--quiet-days 1` is accepted for deletion. With an ids file containing all 13, this admits `spya-xytyjz` before the plan’s approved timing. Neither set equality nor the cap restores the seven-day protection.

**Smallest change:** reject deletion thresholds below seven days, or remove the deletion override.

**R4 — P1: the final proof does not enforce the full quietness/state rule.**

Path: [proveEligible](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:281), versus the survey’s clock calculation.

The proof omits `articles.updated_at`, `last_opened_at`, and `ai_calls.finished_at`. A recent change that leaves settings cleared—for example, adding and then clearing a purpose after the survey—passes the final proof despite violating seven quiet days.

Both queries also omit `high_power_since` from protected reader settings. An old, otherwise empty article with that reader-selected setting can qualify.

**Smallest change:** cover every clock used by the survey in the final proof and protect `high_power_since`. Keep the independent query shape; make its protections equivalent. Moving today’s incomplete proof under the lock does not fix this omission.

**R5 — P2: retained upload slugs are reader-facing links.**

Paths: [resolveExistingUpload](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/src/routes.ts:6422) and [answerALostClaim](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/src/routes.ts:6615).

After job retention, both return the upload’s slug without checking whether its article exists or has published. `/api/jobs` returns `{article: slug}`, and the upload page treats it as completion and navigates there.

Thus old upload URLs can lead to missing articles after deletion. They already misleadingly lead to never-published articles before deletion, so this is principally an existing defect and a false reachability claim—not newly lost published content.

**Smallest change:** correct the plan’s “no route” claim. Have both fallbacks return a clear unavailable response for absent/unpublished articles while retaining upload rows and Storage mappings. Checking the source hash or original article identity also prevents a reused slug pointing at another paper.

**R6 — P2: the tests do not protect the executable’s orchestration.**

Path: [happy-path test](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/tests/never-published-tidy.test.ts:202).

The tests directly call `checkDeletion`, `writeBackup`, and `destroyEach`. Removing the ids-file check or backup call from `main` would leave these tests passing. The published test covers candidate exclusion, not a publication arriving before destruction.

**Smallest change:** test the actual CLI orchestration with controlled dependencies: missing/incorrect ids, remote target without `--prod`, backup failure, and protected-state arrival must all prevent the destructive call. Confirm that mutations removing each guard produce the intended failure.

**R7 — P2: the backup is plausible restoration material, but restoration is unproved.**

Path: [writeBackup](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:345), plan §6.

For the **unchanged supplied set**, the payload is sufficient: article rows, identities, checkpoints, and original ledger links. There is no implemented or demonstrated restore operation. R1 also means the current payload can miss subsequently created rows.

The outside-repository check is lexical: an outside directory symlink pointing into the repository bypasses it. Mode `0600` protects file access; it does not prove physical location or recoverability.

**Smallest change:** provide and exercise restore SQL/script on throwaway data, including ledger relinks; verify the written backup before deletion and check its resolved physical directory.

The other central claims check out against the migrations and supplied outputs:

- A normal re-extraction retains its published pointer. Read-while-importing’s stand-in tree is a published revision. Existing drafts and jobs prevent eligibility. Fresh URL/PDF imports do not recover these jobless candidates.
- For the unchanged 13, deletion removes **13 articles, 9,303 identities and 196 checkpoints**. It retains **332 `ai_calls`**, nulling their article ids, and retains six uploads. No omitted populated cascade appears in the supplied evidence.
- `destroy` needs no revision or title and creates no visibility audit. The freeze-price trigger has zero matching reservations here. The supplied owner already has a billing account, so its create-if-absent operation inserts nothing.
- `/admin/costs` retains the money, with article attribution changing to recorded-slug attribution. Owner totals and surviving articles’ totals remain unchanged; creation-time filtering prevents a successor inheriting the old spend.
- Interrupted runs leave completed article transactions committed. The original ids file then refuses safely; continuing requires reviewing and pinning the remaining set.

**Waiting for the index is the right call.** Verify its presence in production, rather than relying solely on a deploy having occurred. Administrator full imports bypass quota admission, so the billing lock does not universally block Greg’s imports. It does block minimal-upload admission, visibility changes, other deletes and billing operations requiring that account lock. There is no benefit here that justifies the avoidable unindexed lock time.

**Verdict: safe after these changes.** Resolve R1–R4, close the executable test gaps, and demonstrate restoration before running.

Subject to fresh production proofs, I would allow exactly:

`spya-np5eep`, `spya-ve4avb`, `spya-tx8r32`, `spya-fwp82p`, `spya-ssves7`, `spya-g4d2n9`, `spya-y3wj6a`, `spya-hwsqfk`, `spya-yn6pr0`, `spya-vj2z4v`, `spya-x5ff2s`, `spya-fdcs3c`; plus **`spya-xytyjz` only after 2026-10-08 18:31 UTC**, assuming no newer activity. For the recommended single run after that time and after index verification, all 13—and no additions.