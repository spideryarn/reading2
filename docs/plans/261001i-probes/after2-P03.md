# P03 (after2): email the reader when their PDF import finishes

## 1. Docs opened, in order
1. `CLAUDE.md` (AGENTS.md) - signpost; pointed at architecture entry and `email.md` via the list.
2. `docs/project/email.md` - very helpful: `src/email.ts` is the machinery, never throws, prod-only, no recipient/body in logs, `afterResponse`, and "where a reader's address comes from" (`accountEmail(ownerId)` for a job).
3. `docs/project/ingest-queue.md` - helpful: names where a job succeeds/ends (`src/jobs.ts` `noteEnded`, `pgStoreSession`).
(Then code only: `src/email.ts`, `src/after-response.ts`, `src/arrivals.ts`, `src/jobs.ts`, `src/uploads.ts`.)

## 2. Code files you would edit
- `src/jobs.ts` (hook after a finished upload job, next to `noteEnded` call sites ~L1518 and ~L2796)
- new `src/job-finished-mail.ts` (message builder + send, modelled on `src/arrivals.ts`)
- new `tests/job-finished-mail.test.ts` (modelled on `tests/note-arrival.test.ts`, `tests/email.test.ts`)
- `docs/project/email.md` (add the third mail kind), `docs/project/privacy.md` and the /privacy page text (reader's address now used for mail to them)
- maybe a preference/opt-out column plus migration if the reader may switch it off (not decided)

## 3. Existing helpers/components/functions to reuse
- `src/email.ts` § `sendEmail`, `SendResult`, `oneLine`, `FROM`
- `src/store/admin-accounts.ts` § `accountEmail` (job runs outside a signed-in request)
- `src/after-response.ts` § `afterResponse` (if the ending happens in a request; a job walk may not be inside `withAfterResponseTasks`, so check)
- `src/jobs.ts` § `noteEnded`, `Job.upload`, `Job.title`, `Job.status`
- `src/arrivals.ts` § `arrivalMessage`/`announceArrival` as the shape to copy
- `src/log.ts` § `log`, `errorFields`
No new send helper needed; one new message-builder yes.

## 4. Rules/policies to follow
- Send through `src/email.ts`, not a second provider/way (`email.md`).
- Send only after the job ending is committed; a send must never fail the job (`email.md`).
- Never log recipient or body; label only (`email.md`, CLAUDE.md logging rule, `logging.md`).
- Plain text only so far; subject must not contain reader-typed text (`oneLine`, `email.md`).
- Reader-facing wording rules (`copy.md`); link to the article; do not include article prose.
- Privacy: new use of the reader's address needs `privacy.md`/page update.
- Test first (red before green), `npm test`, `npm run typecheck`, lint on touched files, GPT Sol plan + code review, plan doc under `docs/plans/` via `scripts/plan-name.ts`, work in a worktree, commit by name, push to `dev`.
- Simplest first: ask Greg whether an opt-out is wanted, or mail only PDF (upload) jobs for now.
- Env names must be inventoried if I add one (`tests/env-names-are-inventoried.test.ts`).

## 5. Where you got lost
- Which code path ends a job: two (`commit` in `pgStoreSession` vs `endJob`); `noteEnded` is the common one but runs in the job-walking invocation, probably outside `withAfterResponseTasks`. Not documented in `email.md`.
- Whether a notification-preference/opt-out exists: did not find one quickly; `reader-profile.md` not opened in depth.
- No doc names how to distinguish a PDF import from a URL one (found `Job.upload` by grep).
- Did not verify the Resend-in-prod behaviour of a long-running job on Vercel.

## 6. Confidence
6/10
