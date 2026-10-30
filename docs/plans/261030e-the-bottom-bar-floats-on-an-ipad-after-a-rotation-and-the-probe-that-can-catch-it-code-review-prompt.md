Code review of the change built from docs/plans/261030e-the-bottom-bar-floats-on-an-ipad-after-a-rotation-and-the-probe-that-can-catch-it.md (read it first, including § What the plan review changed — your plan review is the -plan-review-sol.md beside it).

The tracked changes are in docs/plans/261030e-the-bottom-bar-floats-on-an-ipad-after-a-rotation-and-the-probe-that-can-catch-it-code.diff. New files, not in that diff: src/web/probe-switch.ts, the postmortem docs/postmortems/261030b-an-instrument-switched-on-by-reloading-cannot-catch-a-fault-that-reloading-clears.md, the note docs/user-feedback/261030_1707-the-bottom-bar-floats-on-an-ipad-after-rotating.md, and the question docs/user-feedback/questions/q-th6h9q.md (its rules: docs/project/feedback-reports.md § Asking Greg a question).

Evidence already gathered: tests/viewport-probe.test.tsx passes 34/34; each new case was watched red with the switch, the silent recording, the settle coalescing, or the once-only start disabled. A real-app run in Playwright WebKit with iPad emulation, signed in as admin with no ?probe, rotated and narrowed, then ran the command row: the panel showed 10 silent samples (start, orientationchange, window-resize×2, resize×2, laid-out×2, settled×2) and the mark row had floor [0,1193,1,1], root [1194,36031,0], hit inside .dock, dockT identity.

You may edit files to fix what you find inside this change (house workflow: the code reviewer fixes in-stage). Do not touch git (no add, commit, stash, reset, checkout). Run `npx vitest run tests/viewport-probe.test.tsx tests/admin-command-bar.test.tsx tests/viewport-trace.test.ts` and `npm run typecheck` after any edit. Anything wider than this change, report rather than fix.

Look especially for:
1. Hook-order or lifecycle bugs in ViewportProbe: the switch from the silent wrapper to the panel remounts the spans and the floor (refs), the samples ref must survive; the ring trimming; the `showing` ref written during render; Strict Mode; timers left behind on unmount.
2. Cost to an ordinary reader: confirm no viewport listener and nothing in the DOM without the flag, and that the admin check matches CommandBar's (isAdmin and no view-as). Any other way a reader could end up recording?
3. probe-switch.ts: the mounted counter under Strict Mode (effects run twice), startProbe's return, the reset for tests.
4. scripts/viewport-trace.ts: does accepting `settled` change any analysis result (e.g. episodes, the mark logic) in a way that matters?
5. The docs: anything overstated or wrong in the plan, postmortem, note or question; the question must be answerable from above its `Details` line alone, in plain words, with no markdown.

Report: verdict first, then numbered findings with file:line and severity, and a list of what you changed. Under 700 words.
