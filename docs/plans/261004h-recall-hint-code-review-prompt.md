# Code review (and fix): Recall's question links its passage, and a Hint button

You may edit files in this worktree. **Fix what you find inside this stage, narrowly, with a test
that was red first. Report, do not fix, anything wider you notice.** Do not commit. Do not run git
commands that discard work. Do not touch `CLAUDE.md`, `AGENTS.md`, `docs/reusable/` or anything in
`docs/project/security-map.md` § Where the defences physically live.

## The candidate

Commit `35ca72d7f` in this worktree, one commit on top of `8548c0d4a`. See it with
`git show --stat 35ca72d7f` and `git diff 8548c0d4a 35ca72d7f -- <path>`. Nothing is uncommitted
apart from what you change. Start with, but do not stop at:

- the plan: `docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md`
  (its § Round 2 overrides the text above it), and your own two plan reviews beside it
  (`261004h-recall-hint-plan-review-sol.md`, `…-review-2-sol.md`); keep F1 to F11 as ids for the
  same findings and number new ones from F12
- `src/recall-hint.ts`, `src/converse.ts` § `REMEMBER_SYSTEM`
- `src/store/pg-chat.ts` § `markHintOpened` and the retry path, `src/routes.ts` § `hintOpened` and
  its `AUTH_ROUTES` entry, `src/db/schema.ts`, `drizzle/20261004141451_chat_message_hint_opened_at.sql`
- `src/web/ChatPanel.tsx` § `Turn`, `src/web/chat/{model,reduce,project,controller,effects}.ts`,
  `src/web/useChat.ts`, `src/web/styles/chat-actions.css`
- `src/live.ts`, `src/live-gpt.ts`, `src/reader-notes.ts`, `src/store/export.ts`
- `evals/remember-recall.ts`, `evals/remember-recall-checks.ts`
- the tests: `tests/recall-hint*.test.*`, `tests/chat-hint-opened-route.test.ts`,
  `tests/remember-recall-checks.test.ts`, `tests/remember-prompt.test.ts`, `tests/event-times.test.ts`
- docs: `docs/project/remember-mode.md`, `docs/project/sql.md`, `src/web/help/help-modes.tsx`

## What to do

Make your own independent pass first: correctness, security of the new route (owner scoping,
what it can be made to write, what it logs), the retry and edit races, the client state machine
(a press while a write is out, a failed write, recovery, leaving and returning), accessibility of
the button, the prompt text against the rest of `REMEMBER_SYSTEM` and against
`docs/project/prompting-guide.md`, and whether each doc sentence is true of the code. Run the unit
test files that need nothing outside the tree (`npx vitest run tests/recall-hint.test.ts
tests/recall-hint-panel.test.tsx tests/recall-hint-reduce.test.ts tests/remember-prompt.test.ts
tests/remember-recall-checks.test.ts`). You have no network and no Postgres: the Postgres-backed
files were run by the implementer and passed (event-times, chat-hint-opened-route, store-chat-pg,
store-export-thread-kind, remember-route, db-schema, helpers-seed-reader-state: 12 files, 305
tests), so treat anything you conclude about them as *reasoned*, and say which assertions you could
not run.

Known and not a finding: the migration is not yet applied to the shared local database, because a
peer's unlanded migration holds the same journal index and `db:migrate` refuses until it lands; the
snapshot fork will be repaired after merging. The eval is being run separately.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The implementer made the hint closable again (a toggle), and shows the button only once the
  answer has stopped being pending. Are both right?
- A failed write is silent and retried only after a remount.
- `ENDS_WITH_QUESTION` in `src/recall-hint.ts`: markdown emphasis after the `?`, a link, a
  full-width question mark.
- The 409/400/404 split in the route.

## Output

For each finding: a stable id, a severity, *established* or *reasoned*, file and line, and either
"fixed" with the test that was red first, or "reported". Severity: **P0** data loss, exploitable
security, incorrect charging, service unusable; **P1** user-visible wrong behaviour or an
authoritative contract violated; **P2** design or maintainability risk; **P3** prose.

End with a list of every file you changed, then exactly one line: `VERDICT: approve`,
`VERDICT: approve after my fixes`, or `VERDICT: rework`.
