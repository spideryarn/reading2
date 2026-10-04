- **F17 — P1 — established — closed.** [ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/web/ChatPanel.tsx:1552) offers no pending Hint button, so no press is held or lost on navigation. Withholding it until settlement causes no wrong behaviour found; only the intended brief delay.

- **F18 — P2 — established and reasoned — fixed.** [eval write-up](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/docs/investigations/261004c-recall-hint-and-question-link-eval.md:12) overstated both conclusions. Run 2 improved from 1,547 to 1,393 body words despite retaining six over-limit replies, and at least `partial` and `justTellMe` still state their answers. The six long cases also differed between runs. Red-first: [recall-hint-eval-report.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/tests/recall-hint-eval-report.test.ts:45).

- **F19 — P3 — established — fixed.** [remember-mode.md](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/docs/project/remember-mode.md:499) claimed the bare `Hint:` marker was immediately hidden, but `splitHint` requires some hint text. The mode doc and plan now describe the possible marker flash. Red-first: [recall-hint-eval-report.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/tests/recall-hint-eval-report.test.ts:74).

F16’s revised documentation accurately describes the text fence and identical-hint limitation. The migration journal and snapshot chain are correct and otherwise identical to their predecessor. The three prompt sentences fit the existing prompt and prompting guide. The Help sentence matches the UI.

Validation: 161 focused tests passed; touched-file lint passed; all four TypeScript projects passed, covering 3,005 files.

Files changed:

- `docs/investigations/261004c-recall-hint-and-question-link-eval.md`
- `docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md`
- `docs/project/remember-mode.md`
- `tests/recall-hint-eval-report.test.ts`

VERDICT: approve after my fixes