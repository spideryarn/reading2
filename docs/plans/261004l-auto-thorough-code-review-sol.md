Found and fixed one P1. No remaining P0/P1 established within the plan’s tab-only scope. Nothing committed.

- **C1 — P1, fixed, reproduced:** An earlier Enter made a later row with identical words skip the settle delay. Submission was remembered by words for the whole mount. The [new regression test](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/tests/search-auto-thorough.test.tsx:378) failed before the fix and passes now.
- **C2 — P2, partly fixed:** The cost conclusion confuses provider-call cost with search/session cost. Several settled pauses can also start several thorough searches. Corrected `search.md` and the code comment; the [plan’s conclusion](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/docs/plans/261004l-quick-search-starts-a-thorough-search-in-the-background-and-swaps-it-in.md:43) remains unchanged because it is outside the permitted files.
- **C3 — P3, fixed:** The [help sentence](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/help/help-modes.tsx:260) implied replacement whenever thorough finishes. It now distinguishes success from failure and explains the settle delay.
- **C4 — P2, left:** The [F2 deadline test](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/tests/search-auto-thorough.test.tsx:444) uses real timers with only a 100 ms margin, creating load-dependent flakiness. The [hidden-row test](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/tests/search-auto-thorough.test.tsx:486) verifies listing, URL selection and drawn hits, but does not independently establish every count/colour claim in its name.

A → B → A discarding the first paid A answer matches the plan’s explicit policy. Colour inheritance deliberately pins an automatic colour; I reproduced other automatic rows changing colour with a full palette and documented that trade-off. I found no additional wrongful deletion, duplicate payment or permanently hidden completed row beyond the declared limits.

Changed, file by file:

- [auto-thorough.ts](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/modes/search/auto-thorough.ts): submission tracking now uses row ID and words, follows renames, and removes the unsupported cost ratio.
- [SearchMode.tsx](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/modes/search/SearchMode.tsx): associates explicit submission with its actual row, preserving unchanged Enter and submissions held until loading.
- [search-auto-thorough.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/tests/search-auto-thorough.test.tsx): adds the red-first regression and delayed-loading coverage.
- [search.md](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/docs/project/search.md): corrects cost units and records colour pinning.
- [help-modes.tsx](/home/greg/code/spideryarn2/.claude/worktrees/search-auto-thorough/src/web/help/help-modes.tsx): clarifies timing and failure behaviour.

Validation: original **56 tests passed**; updated requested suite **58 passed**; doc-link checks **16 passed**; typecheck passed via `node --import tsx`. Scoped lint reported one complexity advisory. Full `npm test` stopped during database setup because the sandbox blocked local database/Docker access.

**Verdict: land after the fixes I made.**