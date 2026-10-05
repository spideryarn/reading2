# Mirror stops its model call when the referee leaves

Status: **built, 2026-10-05.** One stage.

## What this is for

Referee mode's Mirror reads the referee's own comments and remarks on them. It is a paid model
call, streamed. If the referee closed the tab part-way through, the call carried on to the end —
and Mirror stores nothing, so the finished answer went nowhere. It was paid for and unseen.

The fifth sweep found this while counting what each of the ten streaming routes does when the
reader leaves, and asked Greg whether there should be one rule
([261003f § For Greg 4](261003f-fifth-codebase-sweep-umbrella.md#for-greg)). The recommendation was
the narrowest step: stop Mirror, change nothing else. Greg, 2026-10-04:

> Q-paid-streams ok, i don't have a strong view on this

## What was checked first

That Mirror really saves nothing. `runMirror` in `src/routes.ts` makes three reads (the article,
the comments, the criteria) and no write; `mirrorStream` in `src/referee-mirror.ts` has no store
import at all — it logs, and it yields. The only durable trace of a run is the cost ledger's row,
which the gateway writes whatever the route does.

And that the client already asks for this: `src/web/useMirror.ts` aborts its `fetch` when the
panel goes, so the server's `close` event does fire.

## The change

`mirrorStream` has always taken a `signal`. Before the stream's `[DONE]`, a referee's abort is
classified as `abandoned` and logged at `info`; an empty or incomplete answer throws `READER_LEFT`
rather than blaming the model for half a JSON object. An already received `[DONE]` takes precedence
over a later abort, so a complete answer can still be parsed; the closed socket receives no frames.
The route simply never passed a signal. So:

- `runMirror` hands `sse(res).gone` to `mirrorStream` as `signal`.
- Its catch no longer files a failure with Sentry for a referee who left. Without this, stopping
  the call would have turned every closed tab into an issue. (First built as `!gone.aborted`,
  `streamAskedTerm`'s rule; narrowed in review — see below.)
- The census in `sse()`'s comment moves `runMirror` to the row that stops.

The six streams that run on all have save paths: `answer` uses `commentStore.patch` through
`settle`; `streamTermLookup` saves through `makeLookUpTerm` in `src/term-lookup.ts`;
`streamCitationInvestigation` saves through `makeInvestigateCitation` in
`src/citation-investigate.ts`; `runRefereeCriterion`, `runRefereeClaims`, and meaning `search`
each call their store's `finish`. These are successful-answer paths, not a guarantee: a failed
validation or save, or a deleted or superseded row, can leave no answer kept.

**The simpler option passed over:** none simpler exists; this is one argument. The larger options
— "always stop" and "finish only what will be saved" — are in the umbrella, and Greg chose neither.

## The cost of a stopped call

The gateway (`openRouterStream` in `src/ai-call.ts`) records an abort-caused throw or a clean end
with an aborted signal as `outcome: "aborted"`; an independent throw remains `"error"` even if the
signal is also aborted. Usage is normally last, but the meter reads every usage-bearing chunk and
keeps any price already received. Only an abort before priced usage leaves `cost_source: "none"`
with a null amount, meaning "not told", not zero — the case exercised below. Cancellation does not
prove that OpenRouter charged nothing; when no price arrived the code cannot establish the final
bill. This accounting is shared with the streams that already stop.

## The test

`tests/referee-mirror-route.test.ts` § *a referee who leaves while the model is answering*. Real
route, real stores, real `mirrorStream` and gateway; `captureFailure` is a reporting spy and `fetch`
is the transport stub, which sends one piece of an answer and holds the body open until the
request's own signal aborts. It asserts the signal
handed to `fetch` is aborted once the response closes, that no failure was filed, and that the
ledger holds one `referee-mirror` row marked `aborted` with no price.

Seen red before the fix: `the referee left and the paid call ran on: expected false to be true`.

## Review

GPT Sol, code review: see the review file beside this one. The reviewer added a pre-response
abort case and an independent-provider-failure/disconnect race case to the same test file, and
corrected the cost and save-path wording above. Its sandbox could not reach Postgres, so it ran
nothing; both cases were run afterwards, outside it.

The race case was red — `captureFailure` expected, 0 calls — and is the one finding that changed
the code: `if (!gone.aborted)` hid a provider failure that happened to land just before the referee
left. The catch now asks the error rather than the signal (`isRefereeLeft` in
`src/referee-mirror.ts`), so only Mirror's own reader-left error is kept out of Sentry.
`streamAskedTerm` has the same weaker check and was left alone: outside this change.
