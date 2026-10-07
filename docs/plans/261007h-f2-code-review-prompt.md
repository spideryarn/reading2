# Code review: 261007h F2 (one part-switcher) and the F6 wording commit

**Candidates:** commits `40ea6ea43` (F2) and `36cd57218` (F6 wording) in worktree
`/var/tmp/spideryarn-worktrees/fbrgq3f6-design-consistency`. `git show <sha> --stat` lists every
path; start with `src/web/styles/mode-band.css` § the part-switcher, `src/web/useRevealChosen.ts`,
`src/web/OrderGroup.tsx`, `src/web/styles/referee.css`, `src/web/DiagramPanel.tsx`,
`src/web/SearchPanel.tsx`, `src/web/QuizPanel.tsx`. That list does not limit scope. F2 also carries
`.band-waiting-ghost` in mode-band.css (the F1 wait line's unseen footprint; your earlier review's
E1/H6) — check it, with `src/web/BandWaiting.tsx`. **Another builder may start on run buttons and
text boxes in this worktree while you work; uncommitted changes outside these commits are theirs —
ignore and do not touch them.**

**Spec:** `docs/plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md`
§ F2, § F6 (wording), § Judgement calls, and § "What GPT Sol's plan review changed" (R4–R7).
Greg: *"controls that do the same job should look the same in every mode, though use your
judgment"*; on wording, pick "call" and "this one", leave the verbs.

## What to do

You may write. **Fix what is inside these commits' scope**, narrowly and red-first, and **report,
do not fix**, anything wider. Do not commit. Findings to the answer file first, then fixes, then
update the answer with what you changed.

Independent pass:

1. Every switcher: roles, `aria-checked`/`aria-pressed`, tab order and the arrow-key contract
   (`tests/arrows-belong-to-the-article.test.tsx`) unchanged? The builder reports that in a real
   browser → scrolls an overflowing bar (a focused button inside an `overflow-x: auto` box) while
   the key still reaches the article — is that a defect for a reader, and is there a narrow fix?
2. `useRevealChosen`: extracted from OrderGroup — does OrderGroup behave identically (resize,
   font load, child change, a URL-restored choice)? Any loop, leak or layout thrash; works for
   `aria-checked` and `aria-pressed`.
3. Narrow layouts: on the ~288px iPad band Referee's fourth chip is clipped ("Candi…") behind a
   hidden scrollbar; the criterion kinds by 79px; Search by 27px. Is a clipped word enough of a
   cue, or does something need to change (smaller padding under a container width, a fade, letting
   Referee wrap)? Recommend; fix only if narrow and clearly better.
4. The neutral "on": raised fill vs band is 1.19:1 dark / 1.12:1 light; selection is carried by
   weight 600 and ink (14.2:1 vs 6.25:1 dark; 18.1:1 vs 3.19:1 light — note the unselected 3.19:1
   in light). Is the unselected text under a contrast bar it should meet?
5. CSS: rules really written once; old hooks carry no conflicting border/radius/fill; load order;
   Structure's Build/Try again keep their action look; Diagram's `.diag-kind-bar`; Learn's
   `margin-right: auto`; Skim's 36/44px.
6. Wording: every changed string reads naturally; anything left that is a not-made-yet line still
   saying "this piece" or "model pass"; the narrowed Citations F17 guard still guards what it was
   written for.
7. Tests: run `npx vitest run tests/part-switchers-share-one-bar.test.ts tests/order-group.test.tsx tests/arrows-belong-to-the-article.test.tsx tests/learn-submode-four-chips.test.ts tests/citations-panel.test.tsx tests/band-waiting.test.tsx`.

## Severity

P0 data loss / security / charging / broadly unusable · P1 user-visible wrong behaviour or a
contract violated · P2 design or maintainability risk · P3 prose. IDs `K1`, `K2`, …. Refuse only
on an established P0 or P1.

End with `VERDICT: ready` / `VERDICT: ready with these fixes` / `VERDICT: not ready`, and a list of
files you changed.
