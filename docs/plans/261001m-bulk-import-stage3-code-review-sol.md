## Findings

1. **P1 — retry racing a re-drop could create two papers.** [src/minimal-paper.ts:112](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/minimal-paper.ts:112)  
   A minimal retry committed its reservation before inserting the replacement job. During that gap, the duplicate query saw only the failed original job and admitted a fresh upload of the same bytes. I changed it to recognize the unsettled retry reservation via the original upload/job slug. Added a deterministic regression that pauses precisely in that gap at [tests/minimal-paper.test.ts:639](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/minimal-paper.test.ts:639).

2. **P2 — the metadata stage was not runnable independently.** [src/jobs.ts:3222](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/jobs.ts:3222)  
   `enqueue({slug, steps:["metadata"]})` was rejected for everyone, contrary to the standalone-stage convention. I added a narrow verified-administrator exception. Ordinary readers still receive the guard, including on minimal papers. The exception is tested at [tests/minimal-paper.test.ts:495](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/minimal-paper.test.ts:495) and documented in [ingest-queue.md:470](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/project/ingest-queue.md:470).

3. **P2 — `isMinimalJob` accepted malformed step lists.** [src/minimal-paper.ts:70](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/minimal-paper.ts:70)  
   `["metadata"]`, `["metadata","metadata"]`, and reversed steps were classified as minimal jobs. They could create doomed minimal drafts without running fetch. It now requires exactly `["fetch","metadata"]`; mutation cases are pinned at [tests/minimal-paper.test.ts:364](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/minimal-paper.test.ts:364).

No P0 findings. I found no remaining free-processing route, publication bypass, cross-owner `NOT_PROCESSED` leak, published-revision tree assumption, or migration inconsistency.

## Verification

- `paper-metadata.test.ts` and `messages.test.ts`: **51/51 passed**.
- Root, web, and fleet typechecks passed. Test typecheck has one unrelated existing error: `tests/chat-empty-reads-from-the-top.test.tsx:126` is missing `canStartOver`.
- The requested combined Vitest command could not start the private-Postgres lane: sandbox networking/Docker access failed with `EPERM` on `127.0.0.1:54362`. Consequently, the new database race tests were typechecked but not executed here.
- Targeted Biome checks and `git diff --check` passed for the changed files.

## Open decisions

- Keeping `refuseMinimalUploadAtTheDoor` in `minimal-paper.ts` is reasonable: it is one use-case gate combining the cheap quota forecheck and content duplicate check; the authoritative admission remains under the billing lock.
- `answerALostClaim` should eventually be shared by the ordinary upload path too. The duplicated branches currently agree, so this is cleanup rather than a correctness blocker.
- `STEP_BUDGET_MS.metadata = 90s` is appropriate for a 60-second model deadline plus PDF/Readability work and persistence.
- Optional `LibraryEntry.processing` is correct for cached shelf rows written before the field existed; absence safely means full.

**Verdict: Stage 3 is sound after these fixes; no remaining correctness blocker found.**