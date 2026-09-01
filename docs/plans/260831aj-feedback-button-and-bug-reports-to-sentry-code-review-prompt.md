# Code review: the Feedback feature, stages 1–3 as built

Review the **built code**, not the plan. This is the second-pass review and it is weighted higher
than the plan review, because a plan-stage review reads prose and cannot find a handler that writes
one field and rejects the request.

Read-only. Do not edit anything.

## What to review

Three commits, in order:

```
a072827  A table for the bug the error tracker never hears about        (stage 1: table + store)
ba2ff5e  The report leaves by the one door, …                           (stages 2–3: route + Sentry mirror)
```

Scope the diff yourself with `git show a072827` and `git show ba2ff5e`. **Ignore everything else in
`git diff` — other agents are working in this tree concurrently** and their files (`src/types.ts`,
`src/referee-*`, `src/web/notes-view.ts`, `tests/referee-*`, `tests/stage-stamp-agreement.test.ts`,
`tests/page-*`, `tests/visitor-gaps.test.ts`, `src/web/citations.ts`) are not part of this work.

The files that ARE this work:

- `src/db/schema.ts` § the `feedback` table (already committed earlier by another session, in `fd584e4`)
- `drizzle/0039_feedback.sql`, `drizzle/0040_feedback_owner_fk.sql`
- `src/store/pg-feedback.ts`, `src/store/contracts.ts`, `src/store/index.ts`
- `src/routes.ts` § `POST /api/feedback` and its validator
- `src/feedback.ts`, `src/feedback-payload.ts`
- `tests/feedback-store.test.ts`, `tests/feedback-route.test.ts`, `tests/feedback-mirror.test.ts`

Background: `docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md` is the plan, and
`…-review-sol.md` is your own earlier review of it, whose findings were folded in.

## Context you must have

Read `src/monitoring.ts`, `src/monitoring-scrub.ts`, `docs/project/logging.md`,
`docs/project/sql.md` and `CLAUDE.md`. The governing rule in this repo is that an `Error.message`
has four times turned out to contain the reader's article, so nothing arbitrary may cross a boundary.

Two facts established empirically, which the code depends on:

1. `beforeSend` runs only for `event.type === undefined`, so `safeEvent` never sees a feedback event.
2. `prepareEvent` merges global + isolation + current scope data, so ambient extras, contexts, tags,
   breadcrumbs and an unreduced `user` reach the envelope unless BOTH the isolation scope and the
   current scope are replaced. `src/feedback.ts` does this with
   `withIsolationScope(new Scope(), …)` plus a second `new Scope()`.

I verified #2 by removing the fix and watching `tests/feedback-mirror.test.ts` fail on
`articleProse`. So the guard demonstrably works for the markers it tests.

## What I want from you

Be adversarial and concrete. A small number of findings that change the code beats a survey.

1. **Find a leak the tests do not cover.** The envelope test seeds a specific hostile scope. What
   else could carry reader prose, a provider error body, or PII to Sentry or to a log line on this
   path? Consider: `hint.attachments` contents; the diagnostics allowlist in `src/feedback-payload.ts`
   and whether the server truly rebuilds rather than passes through; `httpError` messages reaching
   `logRequest`'s `reason`; the `Unexpected field: …` message which interpolates a caller-supplied
   key name; anything in `src/store/pg-feedback.ts`'s log lines; and whether `sanitise`/`safeEvent`
   are correctly NOT relied on here.

2. **Attack the store's concurrency.** `submit` takes `pg_advisory_xact_lock(ns, hashtext(owner))`
   first, then checks idempotency, then counts a one-hour window over `(owner_id, created_at)`, then
   inserts. Is the ordering right? Is `hashtext` collision behaviour acceptable? Can two owners
   deadlock? Can the cap be evaded? Is the transaction isolation level assumed anywhere it should
   not be? Does anything here behave differently under Supabase's transaction pooler?

3. **Attack the route.** Body limits and the base64/decoded-size relationship; the magic-byte
   screenshot sniff (can a crafted file pass the sniff and still be something else?); the
   `created`/`duplicate`/`limited` → HTTP mapping; whether `duplicate` can leak another owner's
   report; whether any client-controlled value reaches Sentry or the database unvalidated; the
   `Retry-After` value; and whether 401/403/404 semantics match `docs/project/auth.md`.

4. **The dual-write semantics.** Only a newly created row is mirrored. Is `markMirrored` correct
   under failure? Can a row end up mirrored twice, or claimed as mirrored when it was not? Is
   `mirrored_at is null` a trustworthy query for "stranded"?

5. **Test quality.** Are these tests actually capable of failing for the right reason, or do any of
   them pass for an incidental reason? `docs/reusable/silent-success.md` is the house obsession here.
   The route test *anonymous gets 401* was green from the start because the gate runs before route
   matching — is it worth anything? Flag any test that would still pass with the feature broken.

6. **Anything the plan promised that the code does not do**, or does differently without saying so.

Finish with the changes you would insist on before this ships, in priority order, and say plainly
whether you would ship it.
