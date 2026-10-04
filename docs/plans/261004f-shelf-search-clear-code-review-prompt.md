Review the code built from a plan you reviewed, and FIX what you find inside this stage's scope
(you have workspace-write). Report anything wider for me to decide rather than changing it.

Plan (with your plan-review findings and how each was taken, at the end):
docs/plans/261004f-shelf-search-clear-cross-that-can-be-seen.md
Scoped diff: docs/plans/261004f-shelf-search-clear-code-review.diff
Files: src/web/Library.tsx (`SearchBox`), src/web/styles/close.css, tests/shelf-search-clear.test.tsx,
docs/project/library.md.

Check in particular:
1. Does the cascade now give a 32px box / 18px glyph / 40px coarse target, with nothing in the
   utilities layer undoing it? Is `tw:right-1.5` + `tw:pr-11` right so text never runs under the cross
   or its finger target?
2. The pointerdown/click finger rule: any activation path that gets it wrong (keyboard, pen, mouse,
   iOS finger whose click says mouse, a stale flag)? Is the stale-flag case the plan names worth a fix?
3. Escape: correct, and no regression to Enter's blur?
4. tests/shelf-search-clear.test.tsx: can any test go green on a broken state? Is the 350ms wait
   sound against the 200ms debounce, and is any test timing-flaky on a loaded machine? Does the CSS
   string check actually bind the class on the input to the rule?
5. Does tests/close-cross.test.ts still mean what it says now that `.close-x` has a non-modal user?
6. Comments and docs: anything false, or any sentence attributed to Greg that he did not write? The
   only words of his are: "Little cross button to clear the search on the logged in homepage shelf."

Do not attribute any new sentence to Greg. After any fix run:
npx vitest run tests/shelf-search-clear.test.tsx tests/shelf-search-focus.test.tsx tests/close-cross.test.ts tests/what-the-enter-key-promises.test.tsx
and npm run typecheck.

End with numbered findings ranked P0-P3, what you changed, and a verdict line:
`VERDICT: ship` / `VERDICT: ship after the fixes I made` / `VERDICT: do not ship`.
