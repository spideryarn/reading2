# Review prompt: a Feedback button, and where a bug report goes

You are reviewing a **plan, before it is built**, for the `spideryarn2` repo. Read the plan at
`docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md` first, then the code it names.

Read-only. Do not edit anything.

## What the feature is

A `Feedback` button, top-right of the window. It opens a dialog with three questions (steps to
reproduce / what you expected / what you saw instead). The report goes to a new Postgres table
**and** is mirrored to Sentry. Signed-in readers only. Optional, default-off "send extra
diagnostics" carrying browser and app state.

Greg's original request and his answers to my questions are quoted verbatim at the top of the plan.

## The context you must read before judging anything

This repo has an unusually strict rule about what may leave the machine, because an `Error.message`
here has **four times** turned out to contain the reader's article:

- `src/monitoring-scrub.ts` — `safeEvent` rebuilds every error event from an allowlist; `sanitise`
  withholds any message not provably one of ours.
- `src/monitoring.ts` — the server half, its four rules, and its header.
- `src/web/monitoring.ts` — the browser half. Breadcrumbs are locked off three ways, Session Replay
  is refused on privacy grounds, `httpContext` is off.
- `docs/project/logging.md`, `docs/project/security.md`, `docs/plans/260826p-error-boundary.md`.
- `CLAUDE.md` — the project's working agreements. "Prefer boring", "prefer simple over easy",
  "simplest version first", "let the types catch it".

## What I verified empirically, so you can attack the conclusion rather than re-derive it

I ran `@sentry/core` 10.71.0 with this repo's exact `init` options and a fake transport, and printed
the envelope. Findings:

1. `beforeSend` runs only when `isErrorEvent(event)`, i.e. `event.type === undefined`.
   `captureFeedback` builds `type: "feedback"`. **So `safeEvent` never sees a feedback report.**
2. `dedupeIntegration.processEvent` returns early for any event with a `type`, so feedback is not
   deduped.
3. `tags` is a top-level field of `SendFeedbackParams`.
4. The isolation scope's `user` `{id, email}` is attached automatically.
5. `hint.attachments` become `{"type":"attachment"}` envelope items via `client.sendEvent`.
6. `@sentry/node-core/light` exports `captureFeedback`, and the envelope item type is `"feedback"`.

If you think any of these is wrong or that I have drawn the wrong conclusion from it, say so — that
is the most valuable thing you could find, because the whole design rests on #1.

## What I most want from you

Be adversarial and concrete. Prefer a small number of findings that would actually change the build
over a broad survey.

1. **The security argument.** The plan claims a feedback report is a legitimate, consented exception
   to the allowlist rule, and that the answer is to *build* the payload field by field rather than
   loosen `safeEvent`. Is that reasoning sound? Where could article prose or a provider's error body
   still reach Sentry or the log through a path the plan has not considered? Look especially at the
   diagnostics blob, at `httpError` messages (which are logged as `reason`), and at anything the
   client sends that the server then re-emits.

2. **Client-direct vs server-relay.** The plan routes browser → our API → Postgres → Sentry, and
   rejects calling `Sentry.captureFeedback()` from the browser. The four reasons are in the plan. Is
   the trade right? Am I missing a cost of the extra hop?

3. **The console decision.** Greg asked for "contents of web browser errors/logs/console". I refused
   to scrape `console.*`, because `src/web/lib/api.ts` `logFailure` prints 300 characters of a
   response body and `src/web/upload.ts` prints 400 characters of an upstream body — the two leaks
   `src/web/monitoring.ts` names as the reason breadcrumbs are off. Instead a ring buffer records
   structured fields at three named seams. **Is this the right call, or have I under-delivered on
   what Greg actually asked for?** Is there a safe way to give him more of what he wanted?

4. **The filesystem-store question (open, and I want your view).** `SPIDERYARN_STORE` unset means
   `files`. A feedback row has no home in `data/<slug>/`. The house pattern for a Postgres-only
   feature is `visibilityStore`'s 501 refusal — but that makes the button dead on a files-store
   laptop, which is the same failure mode I rejected browser-direct Sentry for. I provisionally
   chose a ~20-line files adapter appending to `data/feedback.jsonl`. Which is right, and what does
   `tests/store-parity.test.ts` demand of whichever I pick?

5. **`x-vercel-id` as the correlation key.** The plan reads it off responses in `apiFetch` and keeps
   a small ring buffer, as the answer to Greg's "anything that will help us correlate with our
   Vercel logs". Is that actually the right identifier? Is it reliably present and readable
   same-origin? Is there something better I have missed (the plan deliberately does not turn on
   tracing — `tracesSampleRate` is omitted rather than zeroed, for reasons in `src/monitoring.ts`)?

6. **Rate limiting.** There is none anywhere in this repo. This is the first authenticated write
   with no natural ceiling. The plan adds a per-owner hourly cap. Is that sufficient and is a
   `count` query the right mechanism here?

7. **Anything in the plan's staging that is out of order**, or any stage whose tests would pass
   without proving anything — this repo's `docs/reusable/silent-success.md` is about exactly that
   failure, and most of its recent bugs have been something reporting success while doing nothing.

8. **Anything I have got wrong about the existing code.** The plan cites specific files and
   patterns (`pg-reader.ts`, `createFree`, `AnnotateDialog.tsx`, `offline.ts`, `fitView`,
   `tests/routes.test.ts`'s `call()` helper, `tests/db-schema-drift.test.ts`'s exact table list).
   Check the ones that matter.

Finish with the two or three changes you would insist on before a line is written, in priority
order.
