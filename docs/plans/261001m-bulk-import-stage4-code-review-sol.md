No P0 findings. I found and fixed eight issues.

1. **P1 — terminal watchers could lose or leak their polling timer.** An ordinary subscriber unmount could cancel a timer still needed by a watcher; registering a watcher did not replace an existing slow idle timer; unsubscribing could leave a needless poll. Fixed timer ownership and busy cadence in [jobEngine.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/jobEngine.ts:854) and [jobEngine.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/jobEngine.ts:949). Tests cover `/advance`, list reconciliation, post-registration “vanished”, session fencing, unmount, and unsubscribe.

2. **P1 — Retry could exceed the three-file concurrency cap.** Retry previously called the worker directly after its slot had already been reused. Retries now enter a priority queue governed by the same three slots, held until terminal state: [batchUpload.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/batchUpload.ts:304).

3. **P1 — 401 and 402 races could let the batch continue.** A final 401 now pauses the entire batch at the failed phase and resumes after authentication; a job-engine 401 also prevents further files starting. A quota 402 now aborts pre-grant requests so late grant responses cannot begin uploads: [batchUpload.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/batchUpload.ts:249), [batchUpload.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/batchUpload.ts:326), [useJobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/useJobs.ts:248).

4. **P1 — automatic modes and Read this had terminal/session gaps.** The button now watches its submitted job directly, so a terminal `/advance` response or trimmed list cannot leave it spinning. The unread page retains the submitted job ID, and automatic modes are fenced before and during their sequence and run only after Read this succeeds: [ReadThis.tsx](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/ReadThis.tsx:61), [read-this.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/read-this.ts:38), [UnreadPaperPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/article/UnreadPaperPage.tsx:72).

5. **P1 — the client’s minimal-job predicate accepted the wrong shapes.** It now requires exactly ordered `["fetch", "metadata"]`. A contract test imports the server constant and fails if either copy drifts: [read-this.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/read-this.ts:98), [minimal-paper-ui.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/minimal-paper-ui.test.tsx:148).

6. **P1 — an unread 409 could accept malformed or mismatched paper data.** The response is now shape-checked and must match the requested slug; other 409s remain errors. DOI links also reject unsafe, query-bearing, non-ASCII, or oversized values: [access.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/article/access.ts:523), [UnreadPaperPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/article/UnreadPaperPage.tsx:38).

7. **P2 — deduplication incorrectly persisted across separate drops.** Dedupe is now scoped to one picker/drop gesture. Hashing remains serial, reads one file at a time, and caches each digest across retries: [batchUpload.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/batchUpload.ts:200).

8. **P2 — `[pay-minimal]` bypassed the shared quota-link contract.** Added it to `QuotaCode`/`QUOTA_CODES`, taught `QuotaNotice` its pricing destination, and replaced BatchPanel’s custom link. `[pay-reading]` remains excluded because it describes an already-running paper rather than quota: [messages.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/messages.ts:5222), [QuotaNotice.tsx](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/QuotaNotice.tsx:89), [BatchPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/BatchPanel.tsx:172).

I also hardened long titles, authors, abstracts, facts, and error messages against overflow at 390px. Markup inspection confirms the minimal page omits Rebuild, sharing, and High-powered controls; HTML papers get no source link; PDF papers do. Single-file upload retains its existing full-import path, while every batch queue request remains minimal. Opening a minimal paper performs no import request until Read this is pressed.

Tests and checks:

- Requested suite plus related quota/session tests: **153/153 passed across 9 files**.
- Final focused UI/batch rerun: **47/47 passed**.
- Web TypeScript project: passed.
- `git diff --check`: passed.
- Biome: no errors; two non-blocking cognitive-complexity advisories remain in the batch worker.
- Full alternative typecheck passed web, tools, root, and coverage, but the tests project has one unrelated fixture error at [chat-empty-reads-from-the-top.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/chat-empty-reads-from-the-top.test.tsx:126): missing `canStartOver`.
- Full `npm test` could not acquire its database lane because sandbox networking/Docker access returned `EPERM`.
- No commits or index changes made.

**Verdict: Stage 4 is ready after these fixes; no scoped P0/P1 issue remains.**