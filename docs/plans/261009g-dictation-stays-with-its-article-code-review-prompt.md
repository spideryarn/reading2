# GPT Sol: code review of 261009g

Spideryarn repo (cwd, a git worktree). Review the uncommitted change: `git diff HEAD`, plus the
untracked files from `git status` (three new tests under `tests/`, the plan and its review under
`docs/plans/261009g-*`).

Read the plan first: `docs/plans/261009g-dictation-stays-with-its-article-and-the-button-says-its-tricks.md`,
including the section on your own earlier plan review, which says what was taken and what declined.

You may **fix what you find inside this change** (edit files in this worktree). Do not commit, do not
run any git command that changes state, do not touch `.env.local`, infra or any database. Anything
wider than this change: report it, do not fix it.

Check especially:

1. Every keeper name (`keepDictation(...)` across `src/web`) against the plan's table: does each
   carry everything its words are about, and can any of them change under a live dictation in a
   way a reader would call the same box (so their words get refused with `[mic-moved]`)? Look at
   ChatPanel's `Conversation` (keyed by `open.id`), the new-conversation composer (`kind`), the
   ChatDialog draft (`draftTarget`), CommandBar (`article?.slug`, and whether it is ever undefined
   while open on an article), AnnotateDialog (`route`).
2. `DictationButton`'s new `Tooltip`: the ref/aria-describedby merge with the existing sr-only
   description, the `enabled` condition, the double-press window (the card must not open or steal
   the click during `again`), and `done="save"` in AnnotateDialog's button and strip.
3. Whether the tests would have caught the bug (each was seen red before the fix, per the plan),
   and whether any assertion is vacuous.
4. The doc edits: `docs/project/dictation.md`, `docs/project/tooltips.md`,
   `src/web/help/pages/modes/chat.md` — anything false against the code.

Gates you can run: `npm run typecheck`, and `npx vitest run <files>` for the touched tests
(`tests/dictation-*.test.ts*`, `tests/chat-*.test.tsx`, `tests/profile-*.test.tsx`,
`tests/the-enter-key-really-sends.test.tsx`, `tests/annotate-*.test.tsx`, `tests/command-bar-*.test.tsx`).

Write findings as F1..Fn (P0/P1/P2), file:line, what you changed (if anything) and why. End with a
one-line verdict.
