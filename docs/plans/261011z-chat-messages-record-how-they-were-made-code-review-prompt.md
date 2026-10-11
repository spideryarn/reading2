# Code review: 261011z, chat messages record how they were made

You are reviewing one stage of work in the Spideryarn repo (this worktree). Read
`CLAUDE.md` for the house rules, then the plan:
`docs/plans/261011z-chat-messages-record-how-they-were-made.md` (including its
"## Plan review" section, which records your earlier plan review's findings F1–F6
and how each was taken).

The change is exactly commit `adae047e8`, so review it with:

```
git show adae047e8 --stat
git diff 17e9c86c6 adae047e8 -- src tests drizzle docs/project
```

## What it does

A reader asked that each chat message record whether it was typed, dictated,
dictated-then-edited, or live voice, and above all which assistant answers came
from the live real-time voice model, so those can be reviewed. The stage adds a
nullable `chat_messages.modality` column with a CHECK that ties each value to
its role, and plumbs it through:
- the browser composer (`src/web/composer-modality.ts`, `ChatPanel.tsx`)
- `useChat.ts`
- the `/chat` route (`src/routes.ts` `streamChat`)
- `src/chat.ts` (`withTurn`, `withSpokenTurn`, `withRetry`, `withEdit`)
- the Postgres store (`src/store/pg-chat.ts`)
- the rollback export and restore

## Evidence

You have no database. The Postgres-backed tests were run for you; their raw
verbose output is in
`docs/plans/261011z-chat-messages-record-how-they-were-made-code-review-test-output.txt`
(98 tests pass). `npm run typecheck` is clean. The full `npm test` had 2 failing
files out of 1969, one of them `tests/worktree-remove.test.ts` (git tooling,
unrelated). You can run the non-database unit tests yourself:
`npx vitest run tests/composer-modality.test.ts`.

## What to look for

Concentrate on correctness:
- **A path that writes the wrong modality, or none, where the plan says one is
  owed.** In particular, check every place a `chat_messages` row is created or
  rewritten: retry, edit, spoken turns, the guide, the help thread, the command
  bar, import and restore, and any other writer you find by grepping for the
  table or `appendSpoken` / `begin`.
- **A path where a stored modality could be a lie.** For example, the browser
  claiming a value on a turn it doesn't own, a reply that keeps a stale
  modality, or a seeded draft recorded as typed.
- **The migration and CHECK agree with `src/types.ts` and `src/db/schema.ts`.**
- **The client provenance tracking in `ChatPanel.tsx`.** Check every way the
  box's text can change: dictation, typing, Escape, submit, a draft restored
  from `drafts`, a handed-over quote, and Live hand-off.
- **Tests that could pass while the feature is broken.** See
  `docs/reusable/silent-success.md`.

## How to answer

You may fix what you find **inside this stage**: edit the files directly, keep
fixes small, and add or adjust a test where one is missing. Do not commit. Do
not touch the production database, `.env.local`, `infra/`, or any file outside
this change's scope. Anything wider than this stage, or a judgement call, goes
in the report for me to decide.

Write your answer as:

1. **Verdict** on its own line: `VERDICT: SHIP`, `VERDICT: SHIP AFTER FIXES` (you
   fixed things), or `VERDICT: REWORK`.
2. **Findings**, numbered C1, C2, … Each one needs:
   - file:line
   - the concrete failure scenario
   - severity
   - what you changed, or why you left it
3. **Wider issues** you did not fix.
