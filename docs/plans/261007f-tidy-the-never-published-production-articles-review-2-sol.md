**Safe after these changes**, smallest first: refuse omitted audit/session rows (D2); support restoring an explicit subset after a partial run (D3); bind backups to their source target and intended set (D4); lock identities and checkpoints before the final proof (D1). **I would not run the current script.**

Reviewed all nine listed commits and the plan’s new sections at `7dec41326`. No files changed; no database access or tests run.

**D1 — P1: the article lock does not freeze everything the proof and backup inspect.**

Path: [refusalUnderTheLock](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:550), [checkpoint writes](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/src/store/checkpoints-pg.ts:95), and [reading-time inserts](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/src/store/pg-reading-time.ts:40).

Two concrete interleavings remain:

- After `dumpRows` reads checkpoints, another connection updates an existing checkpoint’s `last_used_at` or value. Updating those columns does not require either parent lock. It can commit before the delete, which then removes newer work absent from the backup.
- After `proveEligible` finds no reading time, `pgReadingTimeStore.add` inserts a row. Its foreign key locks the **block identity**, not the article. Those identities are currently unlocked. The insert can commit before deletion, then disappear through the identity’s cascade. The backup and restore contain no reading-time rows.

The plan’s “nothing can slip in” claim therefore remains false.

**Smallest change:** inside the hook, lock the target’s block identities and existing checkpoints `FOR UPDATE`, **before** running the proof and comparison. Hold those locks through deletion. Add controlled concurrency tests for both interleavings.

**D2 — P1: omitted surviving relationships make eligibility and restoration incomplete.**

Path: [reader-table list](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:139), [backup tables](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:387).

Neither query refuses attached `article_share_link_events`, `article_visibility_changes`, or `realtime_sessions`; the backup records none of their links. Production’s supplied schema shows all three use `ON DELETE SET NULL`.

There is a concrete share-history path: [create](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/src/store/pg-share-link.ts:121) accepts a full article without requiring a published revision; [turnOff](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/src/store/pg-share-link.ts:154) clears **both** token columns. Neither changes `updated_at`. Creating and then disabling a link after the backup can leave the article row identical to its backup while adding two audit rows. The final proof passes, their links are nulled, and restore does not repair them. Thus checking `share_token_at` does not enforce “shared now or ever.”

The supplied production counts were zero, so this is an enforcement gap—not evidence of an already omitted populated table.

**Smallest change:** make both queries refuse attached rows in these three tables. That preserves the narrow backup format. Add a create-then-disable test and zero-row protections for the other two tables.

**D3 — P2: the supplied restore command cannot undo a partially completed delete.**

Path: [restoreBackup’s presence refusal](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:493).

One backup covers all 13; deletion commits each separately. If article 1 is deleted and article 2 refuses—or the process stops—the original backup contains both missing and surviving articles. `--restore` refuses because **any** backed-up article remains. The demonstrated round trip covers only complete deletion.

**Smallest change:** support an explicit restore subset using `--ids`, require it to be a subset of the backup, and filter article rows, identities, checkpoints and ledger links consistently. Retain refusal for selected articles already present. Test interruption followed by restoring only completed deletions.

**D4 — P2: restore has no backup-to-target or intended-set check.**

Path: [readBackup](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:461), [restore branch](/var/tmp/spideryarn-worktrees/sweep7-never-published-tidy/scripts/never-published-tidy.ts:746).

Restore correctly requires `--prod` for a remote target. But a valid backup from another database or run is accepted whenever its article UUIDs are absent and database constraints permit insertion. Its header `ids` is not checked against its article rows; child/link references are not checked against that set. Ledger relinking checks only call UUID and `article_id IS NULL`.

Consequently, a wrong file can insert unintended production articles or relink existing unlinked calls. Transactional rollback protects detected failures, not a wrong file whose counts happen to match.

**Smallest change:** record and verify a non-secret source-target identity, validate the manifest and row references, and pin the intended production restore set. Reject mismatches before writing.

The remaining checks look sound:

- The closure preserves a deliberate refusal. Drizzle rolls back before the store guard scrubs and rethrows the error; the guard does not merely log it.
- Ordinary reader deletion has the same path when no hook is supplied.
- Timestamp formatting differences between connections produce unequal JSON strings and **refuse deletion**. They do not admit a changed row.
- R2 checks the same URL passed to the connection; the shared helper also rejects `host`/`hostaddr` overrides. R3 enforces seven days before connection and again in `checkDeletion`.
- R4’s protected columns and clocks match between queries for valid schema rows. D2 concerns history absent from **both**.
- R6 now exercises `main`. Its inspected tests do not cover D1–D4.
- Apart from D1/D2, the supplied production attachment inventory supports the backup’s scope; restore inserts every column of its three backed-up tables and relinks the recorded calls.

After these fixes, retain all plan conditions: the reviewed script, production index independently verified, after **2026-10-08 18:31 UTC**, exactly the listed 13 UUIDs with fresh clean proofs, verified private backup, and execution by the Overseer with Greg’s knowledge. The supplied evidence says the index is **not yet present**.