## Findings

- **F1 — WRONG, fixed** — A frozen/restored keepalive fetch could remain pending forever, blocking deletion, the create caller, and every queued write for that ID. Settled promises also remained in the registry indefinitely. Replays now have a 15-second active-page deadline, remove themselves on settlement, and preserve all overlapping same-ID attempts. Natural completion remains ordered before DELETE; timed-out requests use C2’s idempotent POST-before-DELETE reconciliation. [useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:302), [useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:313), [useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:485), [test](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/use-comments-create-waits-for-the-opening-read.test.ts:763).

- **F2 — CORRECT** — Closing before completion still removes the untouched row; recolouring or typing protects it; two successful presses claim one deletion; refusal keeps it; Remove highlight does not cause a second DELETE; and an outcome from the old article cannot touch a same-ID row in the next article. [CommentDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/CommentDialog.tsx:870), [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:3680), [useCopy.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useCopy.ts:154), [tests](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/selecting-applies-the-highlight.test.tsx:905).

Verification:

- Requested four suites: **72 tests passed**
- Typecheck: **passed**, all 2,978 source files covered
- `git diff --check`: passed
- Scoped lint: no errors; three complexity advisories
- No commit made

fixed