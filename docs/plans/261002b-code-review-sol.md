Fixed the in-scope issues. The main defect was that soft-dismiss was not applied consistently to every job lookup.

### Reader audit

Three reads materially changed behavior and are now fixed:

- [`ingestProvenanceOf`](/home/greg/code/spideryarn2/.claude/worktrees/greg-answers-261002/src/store/pg-jobs.ts:248) could let Retry reserve quota for a dismissed job before returning 404.
- [`lockRetriedAttempt`](/home/greg/code/spideryarn2/.claude/worktrees/greg-answers-261002/src/store/pg-jobs.ts:341) could enqueue a retry if Dismiss raced with Retry. The previous hard delete prevented this.
- [`getIn`](/home/greg/code/spideryarn2/.claude/worktrees/greg-answers-261002/src/store/pg-jobs.ts:943), used by Claim/Advance, could expose a dismissed terminal job as `finished` rather than absent.

All now require `dismissed_at IS NULL`.

The remaining readers are correct without another filter:

- Enqueue arbitration, cancellation, pause, expiry settlement and publishing reads only consider active/queued/running attempts.
- Revision and glossary writes are protected by `liveAttempt`.
- [`jobForUpload`](/home/greg/code/spideryarn2/.claude/worktrees/greg-answers-261002/src/routes.ts:5870) uses the already-filtered job list, so upload recovery behaves as it did after deletion.
- Permanent article deletion, reservation diagnostics and billing settlement intentionally inspect or remove underlying terminal rows.

### Retention and citations

[`trimFinished`](/home/greg/code/spideryarn2/.claude/worktrees/greg-answers-261002/src/store/pg-jobs.ts:2140) remains correct. Dismissed rows consume one of the 50 history slots and are eventually deleted according to their original finish time. That can leave fewer than 50 visible jobs, but 50 is a storage bound rather than a visible-history promise. It also provides the intended temporary diagnostic window. A separate longer-lived support archive would be a wider product decision.

The citation fuse is consistently $50/62. No current code, UI copy, test or project documentation still depends on $20/25; remaining occurrences in historical plans describe the old limit. The test checks both the exact value and the $49.20–$50.00 boundary, so reverting to 25 fails meaningfully.

The four requested docs are accurate after tightening the Dismiss wording:

- [`feedback.md`](/home/greg/code/spideryarn2/.claude/worktrees/greg-answers-261002/docs/project/feedback.md:460)
- [`ingest-queue.md`](/home/greg/code/spideryarn2/.claude/worktrees/greg-answers-261002/docs/project/ingest-queue.md:2060)
- [`summaries.md`](/home/greg/code/spideryarn2/.claude/worktrees/greg-answers-261002/docs/project/summaries.md:88)
- [`citations.md`](/home/greg/code/spideryarn2/.claude/worktrees/greg-answers-261002/docs/project/bibliography.md:467)

### Findings

- **P0:** None.
- **P1:** None.
- **P2:** Soft-dismiss was incomplete across Claim/Advance, Retry arbitration and billing provenance. Added dismissal filters and regression coverage in [`store-jobs-parity.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/greg-answers-261002/tests/store-jobs-parity.test.ts:2062).
- **P3:** The billing-settlement test still treated `forget` as physical deletion, so it no longer exercised the stranded-reservation hazard. It now dismisses and then trims the row in [`billing-settlement.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/greg-answers-261002/tests/billing-settlement.test.ts:1032). Stale comments and documentation describing Dismiss as deletion were also corrected.

Checks:

- 108 non-database tests passed across citation investigation, import reporting and auto modes.
- The requested combined Vitest command could not collect tests because the sandbox cannot reach the private Docker/Postgres test database (`EPERM 127.0.0.1:54362`).
- The normal `npm run typecheck` wrapper was blocked by sandboxed `tsx` IPC; the same typecheck script run through the socket-free Node loader passed all 2,647 covered source files.
- `git diff --check` passed.
- No database command was run, and nothing was committed.

**Verdict: APPROVE after the fixes above; no unresolved wider findings.**