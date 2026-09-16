# Code review, stage 1: `GET /api/feedback` — the reader's own earlier reports

Candidate: commit `8f864ca0` in this worktree. `git show --stat 8f864ca0` lists the files; the
code is in `src/types.ts` (`EarlierFeedback`, `EarlierFeedbackPage`, `EARLIER_FEEDBACK_LIMIT`),
`src/store/contracts.ts` (`FeedbackStore.listMine`), `src/store/pg-feedback.ts` (`listMine`),
`src/routes.ts` (`FEEDBACK_PATH`, the new GET row next to the POST), and three test files. The plan
is `docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md` (§ Server, § Stages 1),
and your own plan review is beside it. Start with the diff; it does not limit scope.

**Another agent (me) is editing stage 2 files at the same time**: `src/web/FeedbackDialog.tsx`,
`src/web/styles/feedback.css`, `src/messages.ts`, `tests/feedback-dialog.test.tsx`,
`docs/project/feedback.md`. Do not touch those, and ignore their uncommitted state.

## What to do

You may edit files. **Fix what is inside this stage** — narrowly, red-first where a test can show
it — and **report, do not fix**, anything wider. Write your findings to the answer file first
(the harness does that from your final message), with what you changed for each.

Attack:

1. Owner scoping: can this read ever return another owner's rows, or run without an owner set?
2. The route: headers before the await, field picking, the contract test's rules (shared
   matcher constant, ordered guard list), anything about how GET on a path that also takes POST
   reaches the dispatcher (body reading, CSRF/origin checks that apply to POST only, etc.).
3. The store query: ordering, `more`, the index, `kind` cast, Date handling.
4. The tests: would each go red if the thing it names broke? (I mutated the owner predicate out and
   the store test went red.)

## Evidence I ran (you cannot reach Postgres)

```
npx vitest run tests/feedback-route.test.ts tests/authenticated-api-route-contract.test.ts tests/feedback-store.test.ts
      Tests  386 passed (386)
```
Before the implementation the same run had 3 + 3 + 4 failures (the new tests). `npm run typecheck`
exited 0. You can run `tests/feedback-route.test.ts` and `tests/authenticated-api-route-contract.test.ts`
yourself; the store test needs Postgres and will skip.

## Severity and format

P0 data loss / exploitable security; P1 user-visible wrong behaviour or contract violated; P2 design
risk; P3 prose. IDs continue from the plan review: start at F7. For each: severity, established or
reasoned, file:line, fixed-or-reported. End with `VERDICT: approve` or `VERDICT: refuse` (refuse only
on an established P0/P1 still open).
