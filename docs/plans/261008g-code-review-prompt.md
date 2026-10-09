Code review for docs/plans/261008g-the-way-back-chip-moves-the-position-and-leaves-the-modes-alone.md
(Spideryarn repo). You may edit files to fix what you find, inside this change's scope.

Read the plan first, then your own plan review (docs/plans/261008g-plan-review-sol.md) — the plan was
revised to answer F1–F4; check each was actually answered in code.

The change: `git diff HEAD` in this worktree (uncommitted). Files: src/web/jump-history.ts (v3 stamp
with `earlier`, depth removed, `armReturn`/`ArmedWrite`), src/web/router.ts (push wrapper and
`stampFor`, `useJumpStamp` removed), src/web/keynav.ts (`beginReturn`), src/web/reader/useReadingPosition.ts
(`returnToOrigin`), src/web/ReturnChip.tsx (`onReturn` prop), src/web/reader/Reader.tsx
(`returnFromJump`: step a covering band aside, focus hand-off), Help page jumping-around.md and the
regenerated corpus, docs/project/url-state.md, and tests: tests/return-chip.test.tsx,
tests/jump-history.test.ts, tests/spine-jump-origin.test.ts,
tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx.

Look especially for:
- the nuqs handshake: does the return arm reliably get claimed by the `setAt` push (pathname, `from`,
  target incl. null for top)? What if nuqs coalesces it with another queued key, or the reader scrolls
  (spy replace) between arm and flush, or a jump is armed in between? Can an unclaimed return arm leave
  the chip hidden (`isJumpArmed`) or write a wrong stamp?
- `synced.current` after a return, and the restore effect / reflow re-anchor interplay; arrival
  anchor (`arrivalAnchor`) after a top-aligned return — should it be cleared?
- `setAt` same-value push (origin already in ?at=) — does nuqs push at all? If not, the arm stays and
  the stamp is never advanced. Verify against node_modules/nuqs.
- the focus hand-off in Reader.tsx `returnFromJump`, and whether `bandStepsAside` is right there.
- compatibility of readStamp with v2/legacy and older bundles reading v3.
- stale comments or docs still describing depth or history.go.
- tests that pass for the wrong reason.

Run: `npx vitest run tests/return-chip.test.tsx tests/jump-history.test.ts tests/spine-jump-origin.test.ts tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx` and `npm run typecheck`.

Write numbered findings (severity, file:line, what you changed if anything) and end with
VERDICT: <ship | ship after fixes made | do not ship>.
