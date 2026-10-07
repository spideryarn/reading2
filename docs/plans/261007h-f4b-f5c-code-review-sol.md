# Review of 143fdb199: F4b + F5c

Independent findings, recorded before fixes (2026-10-07). No commits will be made.

- **C1 — P1, fixed: the new signed-out document bar did not clear the notch.**
  `DocumentPage.tsx` replaces the old `3.5rem + --safe-top` allowance with a
  57px bar whose row starts at y=0 and a fixed `pt-10`. With a 59px top inset,
  the wordmark and links sit in the unsafe area. The floor-height calculation
  and 80px anchor offset also omit the inset. Help's contents already uses
  `3.5rem + --safe-top`, so the shell must agree with it. Fix inside the new
  document shell, without changing the signed-in shell or other bar callers.
  The fix adds scoped bar padding, subtracts that inset from floor height,
  and adds it to the clearance of all anchor IDs. That includes Changelog's
  `details[id]`, not just Help and Privacy's sections. The initial regression
  failed against the candidate; the Changelog regression also failed against
  the first, section-only correction before the final correction.
- **C2 — P1, fixed: the reveal's negative percentage margin could eliminate its trigger area.**
  `reveal-once.ts` uses `rootMargin: "0px 0px -8% 0px"`. The percentage is
  relative to viewport **width**, including for the bottom margin
  ([Intersection Observer specification](https://www.w3.org/TR/intersection-observer/#intersectionobserver-rootmargin)).
  At 4000×240 it removes 320px from a 240px viewport. A section armed below
  the window can stay hidden throughout scrolling. The fake observer in the
  new tests ignores constructor options and therefore cannot catch it.
  The fix uses the actual viewport as the trigger, without a negative margin.
  The fake now captures options; a 4000×240 regression failed against the
  candidate before the fix and passes with the full viewport.
- **C3 — P2, wider/pre-existing: App's loading deadline is not a known-session gate.**
  `useSession.ts` ends loading after eight seconds while `known` stays false;
  `App.tsx` branches on `loading` and `user`, so a reader whose signed-in
  session arrives later can briefly receive the stranger's shell. This
  predates this candidate. Report only; do not change the auth policy here.
  The new shell's comment claiming App waits until the session is known needs
  narrowing to what App actually guarantees. That comment is corrected; the
  wider auth policy is unchanged.
- **C4 — P3, fixed: the reveal comment gave a false example of late section mounting.**
  `PublicShowcase` renders its `.site-reveal` section immediately; the fetch
  adds list entries inside that existing section. The mutation observer still
  supports late sections, but that is not what this caller currently needs.
  Corrected the comment rather than claim the fetch mounts a section.

The requested five suites passed independently before fixes: 5 files, 67 tests.
Their original route walk covered direct mounts, not client-side moves or the
initial loading state. Added checks now cover those paths, the nonzero-inset
source/markup contract, actual Changelog anchor targets, sections above the
window, nested late sections, cleanup and restart, partial startup failure,
and the print/reduced-motion CSS overrides. The nested-late fixture is built
detached so a direct-addition record cannot stand in for nested traversal.

Final targeted verification passed: **7 files, 105 tests**, comprising all five
requested suites plus doc links and Tailwind utility compilation (83 tests in
the five requested suites). **All four typecheck projects passed**, with 3391
source files covered, through `node --import tsx scripts/typecheck.ts`. Scoped
Biome lint passed on the five touched TypeScript files; the scoped whitespace
check passed. Full `npm test` was attempted and refused before collecting
tests: the sandbox cannot reach Docker/local Postgres. `npm run typecheck`
itself was attempted but `tsx` cannot create its IPC socket here, so the
successful check used the same script without that wrapper.
Browser review through the prescribed Sonnet wrapper could not complete:
its API connection retried until the 30-second timeout, with no verdict.
The layout assertions are source/markup contracts, not real browser geometry.

`top < innerHeight` is safe for sections above the window: it leaves them
visible on restoration rather than hiding previously passed content. The
`display: contents` wrapper is appropriate: `.site` owns custom properties,
a background, and descendant margin resets; only the bar is inside it, and
the background deliberately has no box. `SITE_NAV_ROUTES` and signed-in corner
Feedback are unchanged; the existing corner suite passes.

Cleanup disconnects both observers and clears waiting attributes. A queued old
intersection can only reveal, not re-hide; new client-side pages start a new
watch. Runtime reduced motion and print immediately override waiting opacity,
transform and transition through CSS. Back/forward cache freezes rather than
unmounts the page, so the observer remains with its one-way state; actual
browser cache restoration was not exercised here. The mutation observer
ignores attribute and text mutations and scans only added element subtrees,
not the whole long page after each mutation. No further established lifecycle
blocker was found.

The changed claims in `marketing-pages.md` and `website-text.md` match the
implementation; neither needed an edit. No newly false reader-facing Help
claim was found. Help's anchor comment now points to the shell's inset handling.

Independent root-cause and follow-up fix review confirmed the two defects and
the final corrections. The lessons are recorded in
[the shell postmortem](../postmortems/261007h-a-shell-substitution-kept-the-links-and-lost-their-geometry.md)
and [the observer-double postmortem](../postmortems/261007i-an-observer-double-discarded-the-options-that-controlled-visibility.md).

No commits made. Other builders' uncommitted files were left untouched.

VERDICT: ready with these fixes

Files changed:

- `src/web/DocumentPage.tsx`
- `src/web/reveal-once.ts`
- `src/web/styles/site.css`
- `src/web/help/HelpPage.tsx` (comment only)
- `tests/reveal-once.test.ts`
- `tests/home-link-only-without-the-corner-logo.test.tsx`
- `docs/plans/261007h-f4b-f5c-code-review-sol.md`
- `docs/postmortems/261007h-a-shell-substitution-kept-the-links-and-lost-their-geometry.md`
- `docs/postmortems/261007i-an-observer-double-discarded-the-options-that-controlled-visibility.md`
