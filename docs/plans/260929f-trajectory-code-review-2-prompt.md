# GPT Sol code review 2 — 260929f, the changes after your first review

Your first review is docs/plans/260929f-trajectory-code-review-sol.md; your fixes from it are in
the working tree. After it, a browser check (Sonnet, Playwright) found three cosmetic problems and
one real one, and these were changed. Review only these, fix what is wrong inside them, and report:

1. **The FAQ passage that is the stop's own quote** — src/web/stop-card.ts (`CardPassage.here`,
   `questionsAt`'s `same`, `squash`, `SAME_PASSAGE_MIN`), the `quote` passed from
   src/web/modes/trajectory/TrajectoryMode.tsx, and `StopQuestions` in src/web/TrajectoryPanel.tsx,
   which now says *"This stop's passage, below"* instead of repeating it. You said in the plan review
   that block equality is not enough; this matches on the words (same block, and one normalised
   quote equal to or containing the other, the shorter at least 40 characters). Is that sound, and
   is 40 a reasonable floor? Tests: tests/stop-card.test.ts ("marks a FAQ passage as the stop's
   own…"), tests/trajectory-panel.test.tsx (the question test).
2. **A shorter FAQ tooltip** with its own width (`.traj-ask-tip`).
3. **Chips** (`.traj-chip` in src/web/styles/trajectory.css): line height 1.3 with `min-height`
   and centred, because a wrapped idea name sat 33px between lines.
4. **The sparkline** is 6px a stop, 40–72px, and its button has less padding, so Most's depth
   buttons fit on the arrows' row at 1280.

See the whole change with `git diff HEAD -- <file>`. Do not run git commands that change the index
or history, do not touch the database, and do not start servers. Run `npx vitest run
tests/trajectory-panel.test.tsx tests/stop-card.test.ts tests/route-spark.test.ts` and
`npm run typecheck` after any edit. Numbered findings (F1…), severity, file and line, and what you
changed. End with a verdict.
