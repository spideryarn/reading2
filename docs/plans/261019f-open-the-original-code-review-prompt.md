Code review of commit d0b2bacc1 in this worktree (`git show d0b2bacc1`), which implements
docs/plans/261019f-open-the-original-from-the-command-bar.md — read the plan first, including its
"What the plan review changed" section; your earlier plan review is
docs/plans/261019f-open-the-original-plan-review-sol.md.

Greg's report: he typed "original" into the command bar and found nothing that opens the original.

Look hardest at:
1. `originalRow` / `hasGesture` in src/web/CommandBar.tsx — is every path that can call this row's
   `run()` either inside a gesture or caught by the guard? Is `navigator.userActivation.isActive`
   the right signal (note `window.open` consumes activation; does anything consume it before
   `run()` within the same keypress)?
2. `openUploadedOriginal` in src/web/SourceLink.tsx — a behaviour-preserving move of SourceLink's
   click handler? Any difference for the existing button?
3. `originalOf` — right for owner vs visitor, and the Metadata page's use of it (owner =
   `hasShelfRow` for the origin line, `true` minus the fixture for the bar's Dock).
4. Removing `original` from Plain's aliases — anything else (tests, evals, help corpus, docs) that
   relied on it?
5. The tests in tests/command-bar-metadata-rows.test.tsx and tests/metadata-origin.test.tsx — would
   each fail if the thing it guards broke?

You may fix what you find inside this change (sandbox is workspace-write): edit files, run
`npx vitest run <files>` and `npm run typecheck`. Do not commit, do not run git commands that
change state. Report each finding as F1.. with severity, what you changed for it (or why you
left it), and end with a one-line verdict.
