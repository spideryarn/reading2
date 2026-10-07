## Findings

- **C1 — P1 — established — fixed.** F2 was not fully closed: `text-base` is `1rem`, which can compute below iOS’s 16px zoom threshold when the reader uses a smaller root font. Both fields now use `max(1rem, 16px)` while retaining the previous touch line-height. Tests failed first, then passed. Changed [PageContents.tsx](/var/tmp/spideryarn-worktrees/fbeb-contents-above-the-page-when-narrow/src/web/PageContents.tsx:534), [HelpPage.tsx](/var/tmp/spideryarn-worktrees/fbeb-contents-above-the-page-when-narrow/src/web/help/HelpPage.tsx:389), [page-contents-narrow.test.tsx](/var/tmp/spideryarn-worktrees/fbeb-contents-above-the-page-when-narrow/tests/page-contents-narrow.test.tsx:218), [help-page.test.tsx](/var/tmp/spideryarn-worktrees/fbeb-contents-above-the-page-when-narrow/tests/help-page.test.tsx:285), and `tests/touch-controls.test.ts`.

- **C2 — P3 — established — reporting.** The plan says “From 1024px up nothing changes,” but touch screens at those widths intentionally receive a larger search field, and moving the nav changes desktop tab order. [Plan wording](/var/tmp/spideryarn-worktrees/fbeb-contents-above-the-page-when-narrow/docs/plans/261007c-contents-list-and-search-above-the-page-on-a-narrow-window.md:33). No files changed.

- **C3 — P3 — established — reporting.** After C1, the plan and authoritative narrow-window doc still name `tw:any-pointer-coarse:text-base`; the implementation now correctly uses the stronger `max(1rem, 16px)` utility. [Plan](/var/tmp/spideryarn-worktrees/fbeb-contents-above-the-page-when-narrow/docs/plans/261007c-contents-list-and-search-above-the-page-on-a-narrow-window.md:71), [narrow-windows.md](/var/tmp/spideryarn-worktrees/fbeb-contents-above-the-page-when-narrow/docs/project/narrow-windows.md:278). I did not edit the rule doc without its required wording approval. The other three requested project docs match the code.

F1, F3, F4, and F5 are closed: searching removes the disclosure, list-entry queries exclude *Contents*, both placements are asserted by neighbours, and `useId` produces distinct resolved IDREFs.

Responsive classes resolve correctly: below `lg` the nav is in flow and the list has no constrained height, so `overflow-y-auto` creates no practical scroll box; from `lg` it returns to the former fixed flex layout. Fine-pointer desktop sizing is unchanged. The compiled coarse-pointer rule follows `lg:text-xs`.

Checks:

- Requested suite: 7 files, 164 tests passed.
- Tailwind utility resolution: 4 tests passed.
- Typecheck: all 3,357 source files covered and passed via the underlying script. The npm wrapper itself hit the sandbox’s `tsx` IPC restriction.
- Scoped lint: no new errors; two existing complexity advisories.
- Full `npm test`: blocked because local Postgres was unavailable.
- No commit made.

VERDICT: ship with the fixes made