Findings, most severe first:

- P2 — [Library.tsx](/var/tmp/spideryarn-worktrees/fbzh5f23-shelf-add-vs-search/src/web/Library.tsx:1332): the 24px **Add it** button missed the repository’s 40px coarse-pointer target rule. Fixed with `tap-target`; the behavior test now pins it.
- P3 — [shelf-search-offers-a-pasted-link.test.tsx](/var/tmp/spideryarn-worktrees/fbzh5f23-shelf-add-vs-search/tests/shelf-search-offers-a-pasted-link.test.tsx:105): every render and input change waited 350ms unnecessarily, slowing the test and increasing timer dependence. Fixed; only Enter/Escape retain the wait needed to observe the debounced URL state. Also fixed its lint errors.
- P3 — [Library.tsx](/var/tmp/spideryarn-worktrees/fbzh5f23-shelf-add-vs-search/src/web/Library.tsx:1323): comments claimed no shelf content could match an address, which full-text search cannot guarantee. Fixed the production and test comments.

Verified:

- `linkToAdd` uses `slugFromUrl`; both entry points use `navigate(addHref(...))`. [AddPage.tsx](/var/tmp/spideryarn-worktrees/fbzh5f23-shelf-add-vs-search/src/web/AddPage.tsx:877) returns before queueing when validation fails, so an invalid false positive cannot spend allowance.
- Tailwind emits `width: min(24rem, calc(100% - 2rem))`. The 320/390/768/1280 captures show the intended widths and no overflow.
- Add input wrapping, focus ring, label/id, decorative icon, jobs, upload status, and external `BatchPanel` remain sound.
- Requested tests: 28 passed. Tailwind compilation tests: 4 passed.
- `npm run typecheck` was blocked before TypeScript by the sandbox denying `tsx`’s Unix socket. The equivalent `node --import tsx scripts/typecheck.ts` completed successfully: all four projects passed and all 3,694 source files were covered.

SHIP AFTER MY FIXES