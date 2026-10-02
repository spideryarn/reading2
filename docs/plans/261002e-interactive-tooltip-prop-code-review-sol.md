1. **F7 — P1: Direct focus-out could leave the card stuck open.** Reproduced after focusing the link, leaving with the pointer, then moving focus elsewhere. Floating UI’s portal blur workaround swallowed dismissal. Evidence: [Tooltip.tsx:423](/home/greg/code/spideryarn2/.claude/worktrees/tooltip-interactive-prop/src/web/Tooltip.tsx:423). **FIXED:** supply `FloatingTree` for interactive focus management, preserving any enclosing tree. Regression passed after failing first.

2. **F8 — P1: `placed` could hold a detached trigger.** Replacing the trigger and pressing Escape during that commit dropped focus onto `<body>`. Evidence: [replacement regression:223](/home/greg/code/spideryarn2/.claude/worktrees/tooltip-interactive-prop/tests/tooltip-interactive.test.tsx:223). **FIXED:** remove the render snapshot and read Floating UI’s live DOM refs; return focus without scrolling.

3. **F9 — P2: The hover-focus test asserted too early.** It passed with `initialFocus={0}`, despite that mutation stealing focus. Evidence: [tooltip-interactive.test.tsx:182](/home/greg/code/spideryarn2/.claude/worktrees/tooltip-interactive-prop/tests/tooltip-interactive.test.tsx:182). **FIXED:** wait for queued focus work. Six behavior mutations now produce assertion failures. Added mouse-toggle, simulated touch navigation, and focus-transition coverage.

The default/spine behavior remains unchanged. Escape refocusing does not reopen the card; Floating UI blocks that focus event before invoking `changeOpen`. `click` and `reference-press` reasons are not emitted by the configured hooks.

Requested tests: **28/28 passed**. Lint passed. `npm run typecheck` hit sandbox IPC restrictions; the same script passed via `node --import tsx`, checking all four projects. Full `npm test` was blocked by local database access.

Edited only `Tooltip.tsx` and the two test files. No commits or git-state changes.

**Verdict: PASS after fixes; the planned browser geometry and real-touch validation remains.**