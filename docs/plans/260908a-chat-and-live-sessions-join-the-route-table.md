# Chat and live sessions join the route table

The sixth slice of the `AUTH_ROUTES` migration, and the largest: **twelve guards**, the whole
contiguous block that is now the bottom of `serveAuthenticatedApi`'s `if` chain.

The umbrella plan is
[260907b-split-the-authenticated-api-dispatch-by-domain.md](260907b-split-the-authenticated-api-dispatch-by-domain.md);
the slice before this one is
[260907e-referee-joins-the-route-table-and-the-stream-lifetime-test-that-has-to-come-first.md](260907e-referee-joins-the-route-table-and-the-stream-lifetime-test-that-has-to-come-first.md),
which is where the method, the capture/normalise script and the two corrections this plan inherits
were written down. **Read that one first if you have read neither** — this doc says what is
different about chat, not what the recipe is.

> **Status: plan written, not built.** Nothing in `src/routes.ts` has been touched. Awaiting the
> plan-stage review before any code, because the block contains routes the security map names.

## Claimed

**Claimed by 260907e (session `split-routes-one-slice`), 2026-09-08 01:40.** `spideryarn2-4c` — the
session running 260907b, which took `searches` — was messaged before this doc was written, for the reason
260907e § *A second session did this same slice tonight* gives. `origin/dev` was at
`fd7aa74d` when the claim went out and nothing had landed since 01:23.

## The slice

`src/routes.ts:8407`–`:8528`, in the order the chain has them:

| # | Guard | Line | Matcher | Notes |
|---|---|---|---|---|
| 1 | `chat` GET | 8407 | `/api/chat/:slug` | **two returns** — the `?summary=1` early exit |
| 2 | `chat` POST | 8428 | `/api/chat/:slug` | **the one streaming route in the block** |
| 3 | `chatCancel` POST | 8445 | `/api/chat/:slug/:id/cancel` | |
| 4 | `chatLiveTool` POST | 8450 | `/api/chat/:slug/live-tool` | overlaps `oneThread`'s shape |
| 5 | `chatLive` POST | 8463 | `/api/chat/:slug/:id/live` | |
| 6 | `liveSessionConnected` POST | 8468 | `/api/live/:sessionId/connected` | `part`, not `slugPart` |
| 7 | `liveSessionUsage` POST | 8472 | `/api/live/:sessionId/usage` | `part`, not `slugPart` |
| 8 | `liveSessionClose` POST | 8482 | `/api/live/:sessionId/close` | `part`, not `slugPart` |
| 9 | `chatSpoken` POST | 8486 | `/api/chat/:slug/:id/spoken` | |
| 10 | `chatStop` POST | 8503 | `/api/chat/:slug/:id/stop` | |
| 11 | `oneThread` PATCH | 8509 | `/api/chat/:slug/:id` | |
| 12 | `oneThread` DELETE | 8517 | `/api/chat/:slug/:id` | **holds `inTurnOrder`** |

The guard above the block is `one` DELETE at `:8401`, matching `/^\/api\/comments\/…\/…$/`. Nothing above the block matches an `/api/chat/` or
`/api/live/` path, and nothing needs to: **the table is dispatched at `:8553`, immediately below
guard 12**, so a contiguous bottom-up move puts each of the twelve in exactly the position it
already occupies. That is the whole ordering argument, and it is by construction rather than by
audit — the reason the queue is consumed bottom-up.

**One overlap inside the block, and it is already documented.** `/api/chat/:slug/live-tool` matches
both `chatLiveTool` (guard 4) and `oneThread` (guards 11 and 12), because `live-tool` matches
`[\w.%-]+`. The methods differ — POST against PATCH/DELETE — so no path is accepted twice for one
method, which `tests/authenticated-api-route-contract.test.ts:2332` asserts by name. Moving the
block contiguously preserves their relative order for free; this is the chat analogue of the
`/api/uploads` interleave the table's header comment warns must not be tidied away.

## Where the gate lives after this change: exactly where it lives now

[security-map.md](../project/security-map.md) line 87 names two defences in this file: `slugPart()`
for every capture that becomes a directory name, and **the one `requireUser` call**. Neither moves.

- **`requireUser` is untouched.** All twelve guards are inside `serveAuthenticatedApi`, which is
  reached only after the gate; the table is dispatched from inside the same function. The count of
  `requireUser` call sites in `src/routes.ts` stays at one, and Stage 3 asserts it rather than
  asserting it in prose.
- **`slugPart` moves with the bodies, verbatim.** Guards 1–5 and 9–12 call `slugPart(<matcher>, 1)`
  on the article slug; the normaliser rewrites the matcher identifier to `captures` and nothing
  else, so a `slugPart` that became a `part` is a body-diff failure, not something to be spotted.
- **Guards 6–8 use `part`, not `slugPart`, and that is correct.** A live-session id is matched in a
  Map and never becomes a directory name. The move must not "fix" this into `slugPart`; the body
  diff is what stops it.
- **`src/public/routes.ts` is not touched.** It is dispatched before `requireUser` and this slice
  never reaches that seam.

## What is different about chat: one stream, one lock, and a guard with two returns

The referee slice's caution was three streams and two locks. This block is narrower than its size
suggests:

- **Exactly one guard streams** — `chat` POST, which calls `streamChat` and writes its own headers.
  Every other guard answers through `send`. So `dispatchAuthRoute`'s `await` is load-bearing for
  guard 2 in the way it was for referee's three, and for the same reason: a closure that launched
  the call and resolved would end the request mid-stream.
- **Exactly one guard holds a lock across the response** — `oneThread` DELETE, `:8525`:
  ``threads: await inTurnOrder(`${slug}/${id}`, () => chatStore.remove(slug, id))``. This is the gap
  Sol found at 23:40 on 2026-09-07, and Stage 1 is about it.
- **`chat` GET has two returns**, the `?summary=1` early exit and the final one. Every other guard in
  the block has exactly one. Under the rail this slice adds (below) that guard is **refused
  automatic comparison and read by hand**, which is the point of the rail rather than a nuisance.

`streamChat`'s own internals — the `streaming` set, its writes going through `inTurnOrder` — are
inside a function this move does not open.

## Stage 1 — the oracle for thread DELETE, and what it must *not* claim

**The migration risk is not the lock.** Decomposing it is the whole of this stage's design, because
getting it wrong here has a documented precedent: `tests/turn-order.test.ts` says in its own header
that an earlier attempt to test the routes' *use* of the lock **passed with the lock removed**, and
calls that worse than no test at all.

Two different mutations, and only one of them is this migration's:

| Mutation | What it does to the response | Caught by |
|---|---|---|
| `await inTurnOrder(…)` → `inTurnOrder(…)` | `threads` becomes a Promise, so the body serialises as `{"threads":{}}` | **the Stage 1 oracle** — a response-shape assertion |
| `await inTurnOrder(k, f)` → `await f()` | nothing; identical body, lock silently gone | **the body diff**, because the tokens differ — and by nothing else, deliberately |

So the oracle is a **plain server-side DELETE test**: create a thread through `chatStore` as the test
owner, `DELETE /api/chat/:slug/:threadId` through `handleApi`, and assert that the reply's `threads`
is an array that no longer contains the id, and that `chatStore.load` agrees. It is red under the
first mutation and green under the second, and **the plan says so in advance** so that a later reader
cannot mistake it for a lock test that happens to be weak.

It reuses the harness that already exists: `tests/routes.test.ts:215` `call()` for the fake
request/response pair, and `tests/chat-route.test.ts`'s `scratchArticleInPg` fixture and `afterEach`
cleanup. New file or an addition to `tests/chat-route.test.ts` — the second, unless the fixture
fights.

**Watched to fail before it is believed**: both mutations applied to `src/routes.ts` in turn, the
suite run each time, and the outcome written into this doc — red for the first, green for the
second, which is the result the table above predicts.

**Chat POST needs no second oracle.** `tests/chat-route.test.ts:114` awaits `handleApi` and then
requires frames and stored rows, so a dropped `await` there is already red. Checked, not assumed.

## Stage 2 — the move

The recipe is 260907e § *Stage 2 — the move*, with the script at
`scratchpad/e4f7-capture-referee.mjs` re-pointed at these twelve guards, plus one addition.

**The addition: the return-count rail.** Sol corrected both sessions' model of the `return;` hazard
on 2026-09-07 — a *retained* early return is harmless, because `dispatchAuthRoute` returns `true`
after the handler either way; **the dangerous transformation is *removing* a return**, so later
statements in the same handler execute. The normaliser's `.replace(/return;\s*$/, "")` silently
tolerates that shape. So the script must **refuse automatic comparison** for any guard whose own
function scope holds a return other than exactly one final argumentless `return;`, nested function
returns excluded — the same principle as *more than one is a fact to fail on, not one to resolve by
picking*.

That rail fires on **`chat` GET and nothing else in this block**. That guard's move is then argued in
this doc by hand: both returns retained, the `?summary=1` branch still exiting before the second
`send`, and the two `send` calls in the same order.

Everything else is the referee recipe unchanged: merge `origin/dev` before starting, capture
"before", move the twelve as one contiguous block in chain order **prepended above the search rows**,
capture "after", diff the normalised bodies, and land nothing until the diff is empty but for the
hand-argued guard.

**If a bug turns up during the move, it is noted here and fixed in a separate commit afterwards.**
The move stays reviewable as a move.

## Stage 3 — the checks that already exist, run rather than extended

`EXPECTED_AUTH_ROUTES` in `tests/authenticated-api-route-contract.test.ts:350` is a hand-typed
literal of all 81 routes and is **source-agnostic** — it does not record whether a route came from
the chain or the table. So the expectation is that this slice changes **not one row of it**, and a
row that has to change is a signal that the move was not a move. `assertHandlersAwaited`,
`assertDispatchableRoutes` and the no-two-guards-accept-the-same-method-and-path check cover the
twelve new rows automatically.

Also in this stage: re-run `tests/routes.test.ts`, `tests/owner-isolation.test.ts` and
`tests/public-dto.test.ts` — the three the security map calls the specification — and say for each
why it still tests what it tested.

**Straight after any merge that touches `src/routes.ts`, run the contract test immediately** rather
than trusting a clean merge. On 2026-09-07 a clean merge left the table with 29 rows where 21
belonged and flagged only comment wording.

## What this slice is not doing

- **No file extraction.** Out of scope in 260907b and marked *Greg's call*; it is also the only thing
  that would make `src/routes.ts` shorter, which is the open question this migration keeps raising
  and does not answer. 260907e § *What the fifth sweep will measure* has the numbers.
- **No standing static check for un-awaited promises inside row handlers.** The gap is real and
  named in 260907e; the cheap shape is known. Not during a migration.
- **No router framework, no route-table DSL, no decorator layer.**
- **No splitting chat into two slices** unless the review says the twelve are too many to move at
  once — see the question below.

## Questions for the plan review

1. **Is the Stage 1 decomposition right** — that the migration's lifetime risk for thread DELETE is
   a response-shape defect the oracle catches, and that lock *removal* is the body diff's job and
   should be explicitly out of the oracle's claim?
2. **Twelve in one slice, or two of six?** Splitting costs the contiguity argument nothing (any
   bottom suffix works) but doubles the ceremony. Chat and the three `/api/live/` guards are a
   natural seam.
3. **Does the return-count rail fire where it should**, and is a hand-argued `chat` GET an adequate
   substitute for an automatic comparison?
4. **Is anything in this block reachable before `requireUser`** — i.e. does any of these twelve paths
   also match something in `src/public/routes.ts`?
