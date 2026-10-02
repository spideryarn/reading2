Code review of commit ae5cd7569 in this worktree (`git show ae5cd7569`), built from docs/plans/261002e-sharing-mark-tooltip-separates-state-from-action.md after your plan review (docs/plans/261002e-sharing-mark-tooltip-plan-review-sol.md, all five findings taken — see the plan's Reviews section).

You may FIX what you find inside this change (edit the files directly), and report anything wider for me to decide. Do not commit, do not push, do not touch git state.

Check especially:
1. Every sentence the cards now say — SHARING_MARK_HOW_PRIVATE, SHARING_MARK_HOW_PUBLIC, SHARING_MARK_ON_ARCHIVED, SHARING_MARK_PRESS_*, the ArchiveMark what/how/press strings in src/web/Masthead.tsx, the BlockGutter visitor strings — is TRUE against the code. In particular: does "Stopping sharing ... takes it off the public list" hold; does an archived shared article's link really keep working for a stranger; "Archiving ... can be undone"; "Putting it back lists it publicly again" (is a put-back shared article listed again with no other condition?).
2. SharingMark's `archived` prop: wiring from Masthead (`archive?.at`), unknown handling, and whether the card updates after a press of the Archive button on the same page (both marks share the controller?).
3. The `press` CSS in src/web/styles/dock.css: specificity vs `.tip-soon p`, and dark mode.
4. `notesBy` wiring: any other renderer of TableView/BlockGutter missed; tests that would stay green if wrong.
5. Tests: does each new test fail when the thing it guards is broken?

Then run: npm run typecheck, and npx vitest run tests/masthead-sharing-mark.test.tsx tests/masthead-archive-mark.test.tsx tests/block-gutter.test.tsx tests/public-network-trace.test.tsx.

Report findings as a numbered list with severity P0-P3, file:line, and what you changed (if anything). Say explicitly if nothing was found.
