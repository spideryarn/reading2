You are doing the code review for plan docs/plans/261002a-horizontal-scrollbar-wider-band-on-wide-windows-archive-button-on-the-masthead.md in the Spideryarn repo (current directory, a git worktree). Read the plan, including its section on your own earlier plan review (docs/plans/261002a-plan-review-sol.md) and what was taken/declined.

The code is on this branch: `git diff origin/dev...HEAD` (saved as docs/plans/261002a-code-review.diff for src/ and tests/). A browser check passed (numbers in the second commit's message: `git log -2`).

You may FIX what you find inside this change's scope: edit files, add or adjust tests. Do not commit, do not run git commands that change history or the index (no add/commit/stash/reset/checkout/restore). Do not touch files unrelated to this change. Run `npm run typecheck` and the specific vitest files you touch (`npx vitest run <file>`); do NOT run the full `npm test`.

Look especially at:
1. src/web/reader/measure.ts (pageWidth, the rAF-coalesced ResizeObserver) and shell.css `html { scrollbar-gutter: stable }` — any page this harms (marketing pages, the shelf, dialogs that lock scroll, iOS, print)? Is `--page-w` correct with the safe-area insets (Reader.tsx writes windowWidth, which already has horizontalInset subtracted; the bars used to subtract --safe-left/--safe-right from 100vw)?
2. src/web/layout.ts spareBeyondTheMeasure / bandWidth, and the tests in tests/layout.test.ts — correctness, and that the sweep really pins "unchanged below the crossover".
3. The archive flow: src/web/useArchive.ts (the new onAnswer effect), Masthead.tsx ArchiveMark, ArticlePage.tsx archivedTo/archivedAt layering, Metadata.tsx passing onArchived. Can a stale or wrong value be reported (e.g. Metadata's provenance arriving after a masthead press, or the fixture)? Does changing `article` identity on every answer cause needless Reader geometry rebuilds (it should be a no-op when the answer equals the payload)? Visitor leak paths for archivedAt?
4. Any test that cannot fail.

Write your answer as: a numbered list of findings (P0–P3) with evidence, and for each, whether you fixed it (name the files) or left it for me and why. End with a one-line verdict.
