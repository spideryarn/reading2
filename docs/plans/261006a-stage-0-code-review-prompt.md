# Code review: stage 0 of 261006a, an unknown stored thread kind refuses

Read-only review. Do not change any file (other work is being edited in this tree while you read).

**Candidate:** commit 1f3beaedaa2217ed93773668f8499eb0b7e332c8 in
/var/tmp/spideryarn-worktrees/learn-rename. `git show 1f3beaeda --stat` lists the paths; the code is
`src/types.ts` (§ `storedThreadKind`, `UnknownStoredThreadKind`), `src/store/pg-chat.ts`
(§ `threadsFor`), `src/store/export.ts`, a comment in `src/chat.ts`, and
`tests/unknown-stored-thread-kind.test.ts` with its line in `tests/store-migration-registry.ts`.
Read past these as needed; the list does not limit scope.

**What it is for.** The plan is
docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md (§ After the plan review,
stage 0), answering your finding PR-1 in docs/plans/261006a-plan-review-sol.md. A later deploy
rewrites `chat_threads.kind` `'remember'` to `'learn'`. This commit is meant to be live in
production before that migration, so that code which does not know `learn` fails loudly instead of
answering a Recall thread under Chat's prompt.

**Independent pass first.** Does this commit actually close PR-1 for every path where code that
predates the rename reads a kind (retry, edit, a new turn, live/realtime conversation, the hint
route, admin views, export, the export bundle, any raw SQL or drizzle select of `kind` that
bypasses `threadsFor`)? Does the throw surface as an ordinary failure everywhere, or is there a
caller that catches and substitutes something (a default, an empty list) so the mislabel or a
second single-kind thread can still be written? Does failing every chat read for an article with
one unknown row do any lasting harm (a pending answer swept, a draft lost, a job marked failed for
good)? Is the test honest: would it stay green if the fix were reverted in one of the two places?
You have no network, so you cannot run the Postgres test; my raw output is below.

```
npx vitest run tests/unknown-stored-thread-kind.test.ts  ->  Test Files 1 passed (1), Tests 3 passed (3)
npm run typecheck  ->  all 3245 source files are covered by some project, 4 projects clean
before the fix (the implementer's run): 3 failed (3) — "storedThreadKind is not a function",
"expected { returned: [ 'chat' ] } to not have property returned",
"promise resolved instead of rejecting"
```

**Severity scale (by consequence):** P0 data loss, exploitable security, incorrect charging, or
the service broadly unusable. P1 user-visible wrong behaviour, or an authoritative contract
violated. P2 design or maintainability risk with no wrong behaviour today. P3 prose or comment
defect. ID every finding (S0-1 …), say established or suspected, name file and symbol, and say
what to do. End with a verdict.

**Accepted already:** during the deploy window, chat on an article that has a Learn thread fails
outright for a few minutes on the old code.

## My suspicions (mine, worth less)

1. `markHintOpened` in pg-chat.ts compares the raw column with `"remember"`; other raw reads of
   `kind` may exist in src/store/pg-admin.ts or src/routes.ts.
2. `threadsFor` is now exported only for the test.
