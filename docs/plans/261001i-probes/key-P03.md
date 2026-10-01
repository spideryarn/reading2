# Key — P03: email the reader when their PDF import finishes

The machinery exists (`src/email.ts`, built 260930i) but only for mail **to the admin**. This is the
**first reader-facing email**, reopening deferred decisions — format, privacy disclosure, opt-in or
default — which go to Greg before building.

## Docs it must read
- MUST `docs/project/email.md` § "Mail the server sends itself" (never throws, only production
  sends, nothing logged, `afterResponse`, best-effort) and § "The words: two templates of our own".
- MUST `docs/plans/260930i-email-admin-on-sign-up-and-plan-upgrade.md` § The design, § Deferred
  ("HTML templates…; any reader-facing email at all"), § "The simpler options passed over".
- MUST `docs/plans/261001b-sign-up-mail-retried-when-a-send-fails.md` — read the `SendResult`; a
  failed send is silent unless the caller checks it.
- MUST `docs/project/privacy.md` § "The admin's sign-up and upgrade notices carry the address" —
  each copy of an address is one more place an erasure must reach; /privacy must say so.
- MUST `docs/project/ingest-queue.md` § "Uploading a PDF" and § "The queue: it was p-queue, and now
  it is an index and a loop" (jobs advance on requests or the pump; there is no worker).
- USEFUL `docs/project/cron-scheduler.md` (no scheduler, so no outbox drain); `docs/project/copy.md`.

## Existing code it must reuse
- `src/email.ts` § `sendEmail`, § `oneLine`, `SendResult`/`SkipReason`. Trap: a second Resend
  client, the Resend SDK, or a raw `fetch` to `api.resend.com`.
- `src/after-response.ts` § `afterResponse`. Trap: an unawaited promise (Vercel freezes it), or
  awaiting Resend in front of the response.
- `src/store/admin-accounts.ts` § `accountEmail` — the address from `job.ownerId` via the Auth Admin
  API; the deployed server cannot read `auth.users`. Trap: a SQL read of `auth.users`.
- `src/billing/sync.ts` § `notifyUpgrade` — the template: pure message builder, send, lookup seam.
- `src/jobs.ts` § `endJob` / `noteEnded` — where a job's terminal ending is settled, fenced on the
  claim's attempt (`session.settleJob`), so it happens once.

## Code files it would edit
`src/jobs.ts` (hook after a `done` ending of an upload job), a new `src/<import-notice>.ts`,
maybe `src/email.ts`, `src/web/PrivacyPage.tsx`, `docs/project/email.md`, `docs/project/privacy.md`.

## Project rules that apply
- Ask Greg first: reader-facing mail, opt-in or default, the /privacy line (CLAUDE.md "Simplest
  version first", "Explain plainly"). Plan + GPT Sol plan and code reviews.
- Failing test first; tests never reach Resend (`tests/setup/provider-guard.ts`;
  `SPIDERYARN_EMAIL_SEND=1` is ignored under vitest).
- Log via `src/log.ts`, never the address (`docs/project/logging.md`). A new env name is read
  literally and inventoried (env-name tests, 260930i § The full suite). `src/auth.ts`: not edited.

## Traps
- A job may finish with no request in flight (pump, retry); `afterResponse` then runs inline, so
  the send must stay off the step path and never fail the job.
- Not exactly-once: a retried or re-run job must not mail twice — decide on the settled `done`
  transition, not on "artefact present" (260930i § 2, "at most once per change").
- `skipped` in production is a misconfiguration, not success (261001b). An address is reader text:
  through `oneLine`, never into a subject (email.md; 261001b).
