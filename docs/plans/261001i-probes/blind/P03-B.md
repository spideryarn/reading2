# Probe P03, round before: email the reader when their PDF import finishes

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context): pointed to `ingest-queue.md` and `email.md` via the architecture entry; helped.
- `docs/project/email.md`: very helpful; says anything new that sends mail goes through `src/email.ts`, never throws, production-only, `afterResponse`. It says "today only notices to us", so reader-facing mail is not covered.
- `src/email.ts` (header and body): `sendEmail`, `Email`, `SendResult`; its header says plain text only until the first reader-facing mail.
- `docs/project/ingest-queue.md` (first 60 lines plus the upload section grep): long historical blockquotes; helped less, mostly orientation on `advanceJob` and `endJob`.
- `docs/project/copy.md` (head): rules for reader-facing words; messages live in `src/messages.ts`.
- `docs/project/privacy.md` (grep): the policy lists what we do with a reader's email; a reader-facing mail needs a line here.

## 2. Code files you would edit
- `src/jobs.ts` (a hook after a successful `done` ending; `noteEnded` or the final-step branch near `endJob`, around lines 1717 and 2750-2840)
- `src/email.ts` (possibly a reader-facing message builder; or a new small module beside `src/arrivals.ts`)
- `src/messages.ts` (subject and body wording, per copy.md)
- `src/web/PrivacyPage.tsx` and `docs/project/privacy.md` (disclose emailing the reader)
- `docs/project/email.md` (update "today only notices to us")
- a new test file under `tests/` (injected `EmailDeps`, like the arrivals tests)
- Possibly a `Job` field or reader opt-out column (migration in `src/db/schema.ts`) if opt-in is wanted. I would ask Greg first.

## 3. Existing helpers/components/functions you would reuse
- `src/email.ts` § `sendEmail`, `Email`, `SendResult`, `EmailDeps` (test seam), `oneLine`
- `src/after-response.ts` § `afterResponse` (keeps the invocation alive for the send)
- `src/store/admin-accounts.ts` § `accountEmail(ownerId)` (looks up an address from the Auth Admin API when no request is signed in; a job outlives its request)
- `src/arrivals.ts` § `arrivalMessage` / `announceArrival` (pattern to copy for message and ledger)
- `src/jobs.ts` § `noteEnded`, `endJob`; `job.ownerId`, `job.slug`
- `src/uploads.ts` / `src/fetch.ts` § `uploadedDocumentKind`, to decide the job is a PDF (job has `upload`)
- New helper needed: a reader-facing mail builder (link to the article, plain text). I found none; `sendEmail` has no reader-facing variant.

## 4. Rules/policies I would follow
- Send through `src/email.ts` only, never a second provider (email.md).
- Send after the job is committed and never let it fail the job (email.md: best-effort, never throws).
- Don't log the recipient or body (email.md, logging.md); use `src/log.ts`.
- Only production sends; tests must not hit Resend (email.md, `tests/setup/provider-guard.ts`).
- Write the failing test first; run `npm test`, `npm run typecheck`, lint on touched files (CLAUDE.md).
- Reader-visible wording follows copy.md; messages in `src/messages.ts`.
- Privacy page and `privacy.md` must say we email the reader (privacy.md).
- Edit docs per owner-parent rules; the email.md line is signposting-level.
- Cross-family review (GPT Sol) of the plan and the code before commit; work in a worktree; push to `dev`.
- No cost tracking needed (no AI call). A migration, if any, is additive; read the `Target:` line.
- Ask Greg: opt-in or opt-out? Email on failure too? Is this mail a product-direction call (vision.md: augment reading)?

## 5. Where I got lost
- No doc says how a job learns its owner's email: `Job` has `ownerId` only. I found `accountEmail` by grepping "email" in `src/store`; I had to infer it fits.
- I expected `ingest-queue.md` to have a "what happens when a job finishes" section; it is mostly history and it is hard to find the single place a success is committed (several `endJob` call sites, plus the final-step commit path I did not fully trace).
- `email.md` says "two notices" and "plain text only"; nothing on reader-facing mail conventions, unsubscribe, or consent.
- No doc on whether PDF jobs are distinguishable at completion; I guessed via `upload`.
- Did not trace the exact success path in `jobs.ts` (large file); unsure whether `noteEnded` runs for a successful last step.

## 6. Confidence
6/10
