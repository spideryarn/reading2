LAND WITH FIXES

1. **P1 — FIXED:** [src/routes.ts](/var/tmp/spideryarn-worktrees/fbs6qhzv-guide-greets-and-live/src/routes.ts:4366) accepted a stored Tutorial/Explore/Candidates thread when `kind` was omitted, allowing Realtime minting or paid GPT-Live creation before the later append rejected it. `liveKind` now validates the stored kind and returns only `SpokenKind | undefined`. Both engine route tests assert refusal before mint, journal, or creation.

2. **P2 — FIXED:** [src/web/ChatPanel.tsx](/var/tmp/spideryarn-worktrees/fbs6qhzv-guide-greets-and-live/src/web/ChatPanel.tsx:1470) could receive a slow purpose read after the reader had already typed or spoken, then retroactively display the greeting and offer to save those words as its answer. The greeting is now snapshotted only while both stored turns and the Live tail remain empty. Delayed-read tests cover typed and spoken first messages.

3. **P3 — REPORTING:** [src/routes.ts](/var/tmp/spideryarn-worktrees/fbs6qhzv-guide-greets-and-live/src/routes.ts:4822) still accepts an optional, browser-supplied `/live-tool` kind. A manually crafted authenticated request can omit it and receive the shared Chat allowlist. This is not a model/article bypass in the shipped path—the page supplies the pinned kind and the model controls only tool name/arguments—but binding it server-side would require wider session-journal/store work.

No additional defects found in reconnects, one-guide targeting, command-token seed sanitising, GuideKeepReason’s stated race handling, command-row gating, prompts, or the `normaliseProfileText` move. Same-engine and cross-engine reconnects both return through ordinary start and re-pin the kind.

Tests:

- Focused unit suites: **110 passed, 2 skipped**.
- Client imports/profile/command runner/reader-change suites: **58 passed**.
- Typecheck: **passed** for all projects; 3,577 files covered.
- Lint on touched files: **no errors**; 11 existing complexity advisories.
- `git diff --check`: **passed**.
- Database-backed route suites were attempted but could not start because local Supabase was unavailable. Their new tests typecheck but were not executed here.

The root-cause write-up is [261009i-a-late-prerequisite-guards-the-aftermath-not-the-action.md](/var/tmp/spideryarn-worktrees/fbs6qhzv-guide-greets-and-live/docs/postmortems/261009i-a-late-prerequisite-guards-the-aftermath-not-the-action.md). No commit, push, deploy, environment, or remote-database changes were made.