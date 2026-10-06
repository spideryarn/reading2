# Code review: 261006k

Review commit `c05cde802` (the scoped diff is `docs/plans/261006k-code-review.diff`; `git show
c05cde802` is the same). The plan is
`docs/plans/261006k-text-size-adjust-for-a-landscape-phone-and-a-quick-review-of-fonts-and-sizes.md`,
and your plan review is `docs/plans/261006k-plan-review-sol.md`.

You may fix what you find **inside this stage's files** (`src/web/tailwind.css`,
`tests/preflight-substitute.test.ts`, `docs/project/controls.md`, `docs/project/phone-and-touch.md`,
the plan, `docs/user-feedback/261006_1416-…md`, `docs/user-feedback/awaiting-approval.md`). Report
anything wider rather than changing it. Do not commit, do not push, do not touch any other file.

Write your findings FIRST to `docs/plans/261006k-code-review-findings.md` (numbered F1, F2, …, each
with what you did about it), before making any fix.

Check in particular:

1. Does the rule reach the shipped stylesheet, in a layer where it takes effect? (`npm run build`,
   then look in `dist/assets/*.css`.)
2. Are the three new tests real? Try to make each pass while the thing it guards is broken
   (rename the selector to `html.foo`, move the rule out of `@layer base`, set `auto`, delete a
   DECLINED_HTML entry). Are the DECLINED_HTML reasons true of this codebase?
3. Were your six plan findings actually applied, in the plan, the comment in tailwind.css, the docs
   and the note? Is any number or claim still wrong?
4. Is the question in `awaiting-approval.md` and the plan's § Questions for Greg plain enough for
   someone who has not read the code to answer?
5. `npx vitest run tests/preflight-substitute.test.ts tests/doc-links.test.ts` and
   `npm run typecheck`. (A full `npm test` is already running separately; do not start another.)

End your answer with `VERDICT: approve` or `VERDICT: changes needed`, and list every file you
changed.
