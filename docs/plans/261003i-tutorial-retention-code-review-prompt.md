# Code review: Tutorial leans to retention, a softer blurb, a link after a quotation paints the quoted words

You are the stage's code reviewer, and you may **fix what you find**. You are in the worktree
`.claude/worktrees/fb-tutorial-2610`, branch `worktree-fb-tutorial-2610`.

## The candidate

One commit: `b34ad2d3c` on base `428054781`. `git show --stat b34ad2d3c` lists the changed paths;
`git diff 428054781 b34ad2d3c -- <path>` shows each. The tree is clean at that commit, so anything
you change is your diff.

Start with these; the list does not limit your scope:

- `src/web/citations.ts` (`quotesBefore`), `src/web/Cited.tsx` (`cited`), `src/web/BlockRef.tsx`
- `src/web/flash.ts` (`FlashTarget.quotes`, `JumpAim`, `quoteRanges`, `paintQuotes`, `stop`,
  `flashBlock`), `src/web/keynav.ts` (`beginJump`), `src/web/reader/useReadingPosition.ts`,
  `src/web/reader/Reader.tsx` (`bandJump`), `src/web/styles/prose.css` (`::highlight(quote-flash)`)
- `tests/quote-flash.test.tsx`, `tests/begin-jump-flash.test.ts`
- `src/converse.ts` (`TUTORIAL_SYSTEM`, `readItFor`, `lengthLine`), `src/web/ChatPanel.tsx`
  (`TutorialInvitation`, the placeholder), `src/web/help/help-modes.tsx`, `tests/tutorial-kind.test.ts`
- `evals/remember-tutorial.ts`
- `docs/plans/261003i-tutorial-leans-to-retention-a-softer-blurb-quote-links-that-show-the-quote.md`
  (the plan, and what your plan review changed), `docs/investigations/261003c-tutorial-prompt-leans-to-retention.md`,
  `docs/project/remember-mode.md` (two new sections)

## What to do

1. An independent pass first: find what is wrong with this change. Bugs a reader can reach,
   contracts broken (docs/project/block-ids.md, docs/project/security-map.md,
   docs/project/prompt-caching.md, docs/project/prompting-guide.md), tests that would stay green
   with the code broken, claims in the docs or comments that the code or the result files do not
   support.
2. **Run tests yourself** where they need nothing outside the tree:
   `npx vitest run tests/quote-flash.test.tsx tests/begin-jump-flash.test.ts tests/block-flash.test.ts tests/block-ref.test.ts tests/citations.test.ts tests/chat-markdown-render.test.tsx tests/tutorial-kind.test.ts`.
   You have no network and no Postgres; do not try tests that need them. I have run
   `npm run typecheck` (clean) and those files (green); the full suite is running separately.
3. **Mutate**: break `quotesBefore`'s sentence-break rule, `quoteRanges`' footnote skip, and the
   `marks.length === 0` precedence in `flashBlock`, one at a time, and say whether a test goes red.
   Restore each.
4. **Check the investigation against its evidence**: the eight files
   `evals/results/remember-tutorial.261003i-*.md`. Its table of cheap screens is summed from their
   "Counts" sections; check the sums. The blind labels themselves are not in the tree (they were in
   a scratch directory), so say so if you think that is a defect.
5. **Fix** what is inside this stage, narrowly, with a red test first where it is a bug. **Report,
   do not fix**, anything wider. Do not commit; leave your changes in the working tree.

Grade every finding and give each an id (`CR-1`, …):

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

For each: what is wrong, the evidence (file and line, or the test output), whether you fixed it and
how, or what you would do. End with `VERDICT: land` / `VERDICT: land with the fixes above` /
`VERDICT: do not land`, and which findings it depends on.

## My own suspicions — already mine, worth less; spend most of the run elsewhere

- `quoteRanges` uses `findQuote`'s forgiving pass on text rebuilt from text nodes. The forgiving
  pass deletes whitespace; are the returned offsets always in the original string's space?
- `ChatPanel.tsx`, `QuizPanel.tsx` and `ChatDialog.tsx` still type `onJump` as `(id) => void` and
  pass the function through by reference, so the quotes arrive at runtime with nothing in the types
  holding it. Is there a path from a `Cited` chip to `flashBlock` on which the second argument is
  dropped today?
- A jump to a block already under the reading line flashes without scrolling; in a tall paragraph
  the painted words may be off screen.
- `::highlight(quote-flash)` reads a custom property; I have not confirmed in a browser that it
  resolves there (a browser check is running separately).
- The prompt: does `THEIR OWN VIEW IS THE EXCEPTION` or `WHEN THEY GO EXPLORING` contradict anything
  else in `TUTORIAL_SYSTEM`?
- The investigation says the pointer to Chat is unreliable (2 of 4 new-prompt runs). I left that.
