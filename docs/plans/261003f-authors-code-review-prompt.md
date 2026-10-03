You are reviewing a small change in the Spideryarn repo, and you may fix what you find.

Read the plan first: docs/plans/261003f-authors-outside-links-to-find-more-about-each.md (it
includes your own earlier plan review's findings, folded in). Then the diff:

    git show 179b01117 -- src tests

Files: src/web/AuthorNames.tsx (new `authorSearchLinks`, `AuthorSearchLinks`, the card made
`interactive`), src/web/Metadata.tsx (the Authors section), tests/masthead-authors.test.tsx.
Context: src/web/Tooltip.tsx (`interactive`), docs/project/tooltips.md § "A card the pointer can
enter", tests/tooltip-interactive.test.tsx.

Evidence already gathered: `npx vitest run tests/masthead-authors.test.tsx
tests/tooltip-interactive.test.tsx` passes (26 tests); removing the `interactive` prop turns the new
dialog test red; `npm run typecheck` is clean. A browser check (desktop, phone width, touch
emulated) is running separately.

Look for correctness bugs: the quote stripping and the affiliation cut (code points vs UTF-16,
trailing punctuation, an affiliation with no spaces), whether an interactive card around a Link
trigger changes what a click, a tap or Escape does on the masthead name, whether the card's links
are legible and keyboard-reachable, whether the Metadata links are inline (visible without hover),
and whether any claim in the plan or the comments is false. Also: does the change break any other
test that renders AuthorNames or the masthead (grep tests/ for them and run those)?

Fix anything real inside these files, keeping the surrounding style (comment density, naming). Run
`npm run typecheck` and the affected test files after fixing. Report: numbered findings with
severity (P0-P3), file:line, what you changed, and anything wider you did not change.
