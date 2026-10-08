# GPT Sol code review: 261008i, text roles in a mode band

You are reviewing AND FIXING, in this worktree. Scope: the commit `1406562e0` (diff it against its
parent: `git show 1406562e0` / `git diff 1406562e0~1 1406562e0`). The plan it builds is
`docs/plans/261008i-text-styles-for-the-recurring-lines-in-a-mode-band.md`; the plan review it
absorbed is `docs/plans/261008i-plan-review-sol.md`.

**First, write your findings to `docs/plans/261008i-code-review-findings.md`** before you fix
anything: ID (F1…), severity (P0 ships broken / P1 must fix / P2 should fix / P3 nit), file:line,
evidence, the fix. Then fix what is inside this stage, narrowly; for a behaviour change, make the
test red first. Report — do not fix — anything wider you notice. Do not commit, stash, reset,
restore or checkout; I commit. Do not touch files outside those in the diff unless a fix needs it.

What the change is: six size tokens (`--type-item/-quote/-body/-meta/-count/-label`) in
`src/web/styles/tokens.css`, band lines in ten modes moved onto them, a "Text roles" section on
`/design` (`src/web/DesignPage.tsx`, `src/web/styles/design-page.css`), docs in
`docs/project/typography.md` § Text roles in a band and `docs/project/mode.md`, and
`tests/type-roles.test.ts` (parses CSS through jsdom's CSSOM; registry of selector → role; Quiz's
question as a named exception).

Please check:
1. **Each registry row's job**: open the component that renders the class and confirm the line does
   that job (item / quote / body / meta / count / label as the plan defines them). Flag misfits.
2. **The cascade**: does any moved rule lose to a later or more specific rule, a `@media` block, an
   inline style, or a Tailwind class on the element, so the token is declared but not what draws?
   Is `.faq-quote` beating `.gloss-part-text` robust? The `.gloss-count` split (Quiz reuses the
   class for status sentences)?
3. **The test**: would it go red for the failures it claims to catch? Try it: break one registry row
   (e.g. set `.skim-place` back to a literal), and add a later overriding rule for one selector in
   another sheet; confirm red each time, then undo your sabotage by editing back. Is the jsdom
   parse guard sound, or could a rule be dropped silently? Run `npx vitest run tests/type-roles.test.ts tests/voices-css.test.ts`.
4. **/design**: does the matrix claim anything false (a role × voice combination marked as used
   that the app does not draw, or the reverse)? Accessibility of the "—" cells?
5. **Docs**: accurate against the code; short; no restating what the test file already says at
   length.

Screenshots were taken before and after (all ten modes, four viewports); the measured computed
sizes moved as intended (e.g. `.skim-place` 14.08→14.72px, `.cite-title` 15.36→14.72px,
`.gloss-gloss` 14.24→13.6px, `.dbt-group-head` 11.52→12.32px) and nothing visibly broke. You
cannot run the browser; do not try.

End your final message with `VERDICT: approve`, `VERDICT: approve with changes` (you fixed things),
or `VERDICT: rework`, and a list of files you changed.

My own suspicions, last: the test's "no later rule for the exact selector" may miss a rule that
targets the same element by a different selector (e.g. `.gloss-term .gloss-name`); the
`readerSheets()` set may not include every sheet the band loads; `.srch-hit-quote` getting
`--type-item` may fight `.srch-hit-btn`'s own size.
