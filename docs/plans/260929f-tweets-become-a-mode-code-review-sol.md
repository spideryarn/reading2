1. **must-fix — fixed**: populated threads could extend below the fixed-height band with no scrolling container. Added the flex scroller at [Tweets.tsx:156](/home/greg/code/spideryarn2/.claude/worktrees/tweets-as-mode/src/web/Tweets.tsx:156). The test [tweets-press-starts-it.test.tsx:276](/home/greg/code/spideryarn2/.claude/worktrees/tweets-as-mode/tests/tweets-press-starts-it.test.tsx:276) went red first, then passed.

2. **must-fix — fixed**: `navigate()` ignored the current hash when deciding an old Tweets URL was already canonical, so navigating to a hashless legacy link could retain a stale hash. Fixed at [router.ts:1228](/home/greg/code/spideryarn2/.claude/worktrees/tweets-as-mode/src/web/router.ts:1228). The regression test [router.test.ts:459](/home/greg/code/spideryarn2/.claude/worktrees/tweets-as-mode/tests/router.test.ts:459) went red first, then passed.

3. **should-fix — reported**: the new-mode checklist requires every band’s surface shape to be pinned at [mode.md:89](/home/greg/code/spideryarn2/.claude/worktrees/tweets-as-mode/docs/project/mode.md:89), but the shape suite ends without any Tweets owner or visitor fixture at [mode-surface-changes-no-markup.test.tsx:2041](/home/greg/code/spideryarn2/.claude/worktrees/tweets-as-mode/tests/mode-surface-changes-no-markup.test.tsx:2041). Proposed change: add populated owner, populated visitor, and empty/loading Tweets shapes. This is reported because the omission itself has no behavioral red-first reproduction.

4. **should-fix — reported**: the move left present-tense architecture documentation claiming Tweets remains a third page/view, including [router.ts:18](/home/greg/code/spideryarn2/.claude/worktrees/tweets-as-mode/src/web/router.ts:18), [ArticlePage.tsx:2](/home/greg/code/spideryarn2/.claude/worktrees/tweets-as-mode/src/web/article/ArticlePage.tsx:2), [library.md:67](/home/greg/code/spideryarn2/.claude/worktrees/tweets-as-mode/docs/project/library.md:67), and [web-client.md:21](/home/greg/code/spideryarn2/.claude/worktrees/tweets-as-mode/docs/project/web-client.md:21). Proposed change: sweep current-tense “three views” and “metadata and tweets pages” references while preserving explicitly historical passages. The important project docs require an approved before/after edit set.

Verification:

- Router: 83 passed.
- Tweets arrival/panel: 11 passed.
- Pipeline stamp/store contract: 67 passed.
- Projection/fingerprint contract: 43 passed.
- Public-reader network trace: 68 passed.
- Earlier focused Tweets, generation, layout, and router run: 152 passed.
- Touched-file lint passed.
- `npm run typecheck` was prevented from opening tsx’s IPC socket by sandbox `EPERM`; running the identical script via `node --import tsx scripts/typecheck.ts` passed all 2,332 files.
- The Postgres-only `store-tweets-stale` test could not start because the sandbox denied its local TCP connection. Static and unit coverage for the same hash paths passed.
- Visitor controls and block-link accessibility look correct: visitors receive no provenance/regeneration controls, and each passage uses the shared real-anchor `BlockRef` with its full ID as the accessible name.

Verdict: two must-fix defects repaired; otherwise sound, with two documented follow-ups and the Postgres-only check still needing an environment that permits the local database connection.