# Code review round 2 (write-capable, narrow): 261002b, the Help page

Repo: the current working directory (Spideryarn worktree). Round 1 is
docs/plans/261002b-help-page-code-review-sol.md. Review ONLY these, which no second pass has seen:

1. Commit `575fd4176`, file src/web/help/HelpPage.tsx — round 1's own C1 fix: same-tab fragment
   clicks are prevented, `pushState`d and arrived at once. Check: Back/Forward still arrive (does a
   Back between two same-document entries that differ only in fragment fire `hashchange`, `popstate`
   or both in Chrome? verify the code handles whichever fires, without double-arriving); a click on a
   `#` link in the search results while a query is present; middle-click / Cmd-click untouched; the
   router (src/web/router.ts) — does any `popstate` listener re-render or scroll to top on these
   entries?
2. Commit `9b60c6141` — `flash.ts § scrollToAndFlash` now keeps the target aligned for 2s after the
   scroll (fonts `loadingdone`, `fonts.ready`, ResizeObserver), cancelled by the reader's wheel/key/
   touch/pointer. Check: listeners and observers always removed (every exit path, unmount, a second
   reveal while the first is settling); it cannot fight a reader who scrolls by dragging the
   scrollbar (is that pointerdown seen on window?) or by keyboard; Metadata's reveal
   (PageContents.tsx) is not harmed; jsdom guards (no ResizeObserver, no document.fonts).
3. Docs: docs/postmortems/261002b-a-scroll-aimed-before-the-fonts-arrive-lands-where-the-text-was.md
   — anything false about the code?

Fix what is wrong inside these, red-first where a test can show it; do not commit; report anything
wider. Run `npx vitest run tests/help-page.test.tsx tests/block-flash.test.ts
tests/metadata-contents-reveal.test.tsx tests/dock-help-link.test.tsx` and `npm run typecheck`
(if it fails on a tsx pipe EPERM, use `node --import tsx scripts/typecheck.ts`).
Severity P0–P3, IDs D1…, file:line, FIXED or REPORTING. End with files changed, raw test counts, a
one-line verdict.
