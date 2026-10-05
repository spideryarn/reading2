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

`mirrorStream` has always taken a `signal` and handled a referee's abort properly — it classifies
the ending as `abandoned`, logs it at `info`, and throws `READER_LEFT` rather than blaming the
model for half a JSON object. The route simply never passed one. So:

- `runMirror` hands `sse(res).gone` to `mirrorStream` as `signal`.
- Its catch no longer files a failure with Sentry when `gone` has aborted — the rule
  `streamAskedTerm` already keeps. Without this, stopping the call would have turned every closed
  tab into an issue.
- The census in `sse()`'s comment moves `runMirror` to the row that stops.

Nothing else changes. The six streams that run on all store their answer.

**The simpler option passed over:** none simpler exists; this is one argument. The larger options
— "always stop" and "finish only what will be saved" — are in the umbrella, and Greg chose neither.

## The cost of a stopped call

The gateway (`openRouterStream` in `src/ai-call.ts`) already records a call whose signal aborted
with `outcome: "aborted"`. A provider sends its usage figures last, so a stopped call has no price:
the row says `cost_source: "none"` with a null amount, which is "not told", not zero. OpenRouter
may still bill for the tokens generated before the stop; that amount is not on our row. This is the
same for the three streams that already stop, and is not new here.

## The test

`tests/referee-mirror-route.test.ts` § *a referee who leaves while the model is answering*. Real
route, real stores, real `mirrorStream` and gateway; only `fetch` is a stub, which sends one piece
of an answer and holds the body open until the request's own signal aborts. It asserts the signal
handed to `fetch` is aborted once the response closes, that no failure was filed, and that the
ledger holds one `referee-mirror` row marked `aborted` with no price.

Seen red before the fix: `the referee left and the paid call ran on: expected false to be true`.

## Review

GPT Sol, code review with fixes: see the review file beside this one.
