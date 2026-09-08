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

> **Status, 2026-09-08 02:30: built.** Plan reviewed, Stage 1 written and reviewed, Stage 2 moved
> the twelve, Stage 3 updated the contract. The status line below each stage is the current one; this
> line said *plan written, not built* until the work was done, which GPT Sol flagged as stale
> (260908a stage 1 review § F8).

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

The recipe is 260907e § *Stage 2 — the move*, with the capture/normalise script — now kept beside
that doc as [260907e-capture-referee.mjs.txt](260907e-capture-referee.mjs.txt) rather than in a
scratchpad — re-pointed at these twelve guards, plus one addition.

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

> **This section's heading was wrong and the plan review caught it — F1, below.** Three expectations
> in the contract test must be edited by hand, and the original text said the stage would run them
> rather than extend them. The corrected account follows.

**`EXPECTED_AUTH_ROUTES` at `:350` does not change**, and that part was right: it is a hand-typed
literal of all 81 routes and is **source-agnostic** — it does not record whether a route came from
the chain or the table. A row of it that has to change is a signal that the move was not a move.

**Three other expectations do change, and all three are hand-edited:**

1. **`answers the moved domains from the table` (`:1888`)** — the sorted set of table pair keys.
   Add the twelve.
2. **`keeps the table in the chain's order, newest domain first` (`:1959`)** — the same twelve keys
   again, but **order-sensitive**, prepended above the search rows in the order the chain has them.
   This is the one that records that the slice was taken contiguously; nothing else does.
3. **The `moved` prefix list (`:1931`)** — add **both** `/api/chat` and `/api/live`, once the
   leftover filter's fix has landed (see the landmine section below), and not before every guard
   under both prefixes has moved.

`assertHandlersAwaited`, `assertDispatchableRoutes` and the no-two-guards-accept-the-same-method-and-path
check do cover the twelve new rows automatically, and those are the ones the stage runs rather than
extends.

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

## Three of the four review questions, answered before the review came back

Two by measurement and one by exhaustion, while the plan review was running. They are left in the
question list above as they were asked, so the review is not steered; this is what I found.

**Q4 — nothing in this block is reachable before `requireUser`, and that is exhaustive rather than
inferred.** `src/public/routes.ts:183` gates the whole public namespace on
`path === "/api/public" || path.startsWith("/api/public/")`. No `/api/chat/…` or `/api/live/…` path
satisfies either clause, so the public dispatch cannot reach one. This is the argument by literal
prefix that 260907e § *the genuinely cheap one* says is available when a namespace is literal, and it
is available here.

**Q3, first half — the rail fires on `chat` GET and on nothing else in this block.** Measured with
[260908a-count-returns.mjs.txt](260908a-count-returns.mjs.txt), kept beside this doc, which cuts each guard's body out of the chain, blanks comments
and string bodies, and counts `return` tokens at the guard's own function scope (returns inside
nested arrows excluded by tracking the depths at which a `=>` opened a block):

```
chat GET                     returns=2  *** RAIL FIRES ***
chat POST                    returns=1  comparable
chatCancel POST              returns=1  comparable
chatLiveTool POST            returns=1  comparable
chatLive POST                returns=1  comparable
liveSessionConnected POST    returns=1  comparable
liveSessionUsage POST        returns=1  comparable
liveSessionClose POST        returns=1  comparable
chatSpoken POST              returns=1  comparable
chatStop POST                returns=1  comparable
oneThread PATCH              returns=1  comparable
oneThread DELETE             returns=1  comparable
```

Every one of the eleven has a single argumentless `return;` as its last statement. So the rail is not
a formality that will fire on half the block and get argued away twelve times: it fires **once**, on
the one guard that has a second exit, which is what a rail is supposed to look like.

## Stage 3 grew a landmine, and the session that laid it said so

**The leftover check in the contract test has been vacuous for every regex route**, found and
measured by 260907b (session `spideryarn2-4c`) at 01:45 on 2026-09-08 while this plan was in review.
Verified here independently before it was written down.

`tests/authenticated-api-route-contract.test.ts:1934` filters chain guards with
`moved.some((p) => describeMatch(g.match).includes(p))`, and `describeMatch` renders a regex as
`` `regex /${m.source}/${m.flags}` `` — with `source`'s escapes intact. So a chat route renders as
`regex /^\/api\/chat\/([\w.%-]+)$/`, in which the substring `/api/chat` **does not occur**: every
separator is `\/`. The filter can only ever catch a *literal* route left behind in the chain, which
is why it looked healthy — billing, jobs and uploads have literal rows. **Referee and search are
entirely regex, so this assertion verified nothing for either of the last two slices** while reading
in review as though it had. Their probe: adding `/api/chat` to `moved` with all nine `/api/chat`
guards still in the chain left the suite **green at 326**.

Their fix, landing on `dev` shortly, is a `pathish(match)` helper dropping the backslashes — the
result is only ever searched for a prefix, so `\w` becoming `w` is harmless.

**What it means for this slice, and it is not one thing:**

- The exact `toEqual` list at `:1897` is the check that actually bites, and it is not vacuous: it
  compares the *complete* set of table pair keys. Stage 3 adds twelve entries to it.
- The `moved` prefix list at `:1931` will be enforced for real once their fix lands. This slice spans
  **two** prefixes — `/api/chat` (nine guards) and `/api/live` (three). **`chatLive` is
  `/api/chat/:slug/:threadId/live` and belongs to the first**, so a prefix list that sorts by the
  word "live" mis-sorts it.
- **If this slice is split into two, neither prefix goes into `moved` until the last guard under it
  has moved.** Adding `/api/chat` while any of the nine is still in the chain will now fail loudly —
  correct, but it will read as the move having broken something when it means the move is
  incomplete.
- They also added a **control** beside it, because the assertion passes both when there is nothing to
  find and when it *cannot* find anything: it requires the filter to find at least one `/api/chat`
  guard still in the chain. **That control fails the moment this slice lands, deliberately** — it is
  addressed to whoever moves chat, and Stage 3 repoints it at the next unmigrated regex domain,
  which is `/api/comments`.

This is [silent-success.md](../reusable/silent-success.md) in its purest form: a check that agreed
with the code because it shared an assumption with it, green for two whole slices.

**The reproducible part is the loop, not either session.** Neither of tonight's two real findings was
anybody's hunch. 260907b asked Sol the sharper *"once, not per domain"* question because 260907e had
challenged a settled-sounding claim of theirs; 260907b went to read the `moved` list because 260907e
had asked which prefixes chat spans, and noticed the escaping on the way. Written down as *one agent
had good instincts*, that teaches nothing. Written down as *ask a peer to check the claim you are
about to hand a reviewer*, it generalises — which is the form the next sweep can actually use.

## The queue after this slice, and the fact about it nobody had stated

`comments` (6 guards) is next, and 260907b — the session that took `searches`, stopping after its
leftover-filter fix lands — made the observation that turns a per-slice discovery into a fact about
the queue:

> two slices in a row that need [a red-first oracle] is worth knowing when you plan the queue rather
> than discovering per slice
>
> — 260907b, 2026-09-08

Sol found **four** domains that would not redden on a dropped `await`. One was inside this slice.
**Three are still ahead of us**, and they are not evenly spread through the queue — they are
clustered in the next three slices:

| Slice | The gap | Today's only coverage |
|---|---|---|
| `chat` (this one) | `DELETE /api/chat/:slug/:threadId` holds `inTurnOrder` | none server-side |
| `comments` | `POST /api/comments/:slug/:id/answer` — SSE plus the `answering` registry | a pre-stream 409 at `tests/routes.test.ts:1400` |
| `sketch/…/similar/projection` | paid single-flight in `INFLIGHT`, linked by `return withSpendAttribution(…)` rather than `await`, so the mutation is `return` → `void` | — |
| `article` and friends | `GET /api/link-summary` — SSE plus a database single-flight claim | — |

So the right expectation for the next three slices is **one Stage 1 oracle each**, not "the referee
slice paid for the instrument once". The thing that was paid once is the *method*; the oracles are
per-gap, and the gaps were there before the migration started. That is worth restating because it is
the one place where "once, not per domain" is easy to over-read.

**The script the rail runs on is kept beside this doc as
[260908a-count-returns.mjs.txt](260908a-count-returns.mjs.txt)** rather than in a scratchpad, because
a scratch path is unreadable tomorrow and gone on the next machine — the same reason
[review-prompt-template.md](../reusable/review-prompt-template.md) refuses one as evidence. Copy it
out, change the `GUARDS` list, run it against `src/routes.ts`. What it deliberately excludes is
returns inside nested arrow functions, which belong to those functions and not to the guard.

## The plan review, and the three things it changed

`docs/plans/260908a-plan-review-sol.md`, GPT Sol, high effort, 2026-09-08 01:41–01:53, against
commit `0a493cf9`. Verdict: **build it with these changes.** Every finding was checked against the
tree here before being accepted; all three hold.

**F1 — P1, accepted. Stage 3 was described as running checks it must in fact edit.**
Verified: there are **two** exact lists of table pair keys, not one. `:1888` is a sorted set; `:1959`
is order-sensitive and is the only record that the slice was taken as a contiguous suffix. The
original § *Stage 3* is corrected above, with all three hand-edits enumerated. This was the finding
worth the review on its own: the stage would have been built believing it had no contract edits, and
then made them under time pressure at the end while calling them incidental.

**F2 — P2, accepted, and the fix is better than the plan's.**
The rail refuses automatic comparison for `chat` GET, and the plan proposed to substitute a hand
argument. Sol's objection: **a hand argument written before the move cannot establish anything about
the body after it.** Worse, deleting the early return is exactly the third mutation asked for in
question 3 — neither the DELETE oracle nor the automatic comparison would see it, because `chat` GET
is the one guard excluded from the comparison.

There is already a behavioural catcher, and it is a better answer than either:
**`tests/the-query-string-does-not-decide-the-route.test.ts:181`** asserts *both* branches of the
`?summary=1` split — the summary reply must have `turns` and must **not** have `messages`. Verified
here. Delete the early return and both `send` calls execute; the second overwrites the first in the
test's fake response, so the summary assertion sees a full transcript and goes red. (In production
the same deletion throws `ERR_HTTP_HEADERS_SENT`, which is its own bug.)

**So Stage 2 runs that test with the early return deleted, watches it go red, and puts it back** —
the mutation watched rather than the argument written. The hand inspection stays, as a supplement
and not as the evidence.

**F3 — P2, accepted; already fixed while the review was running, which is worth being exact about.**
Sol found the named purity verifier absent from the tree — `scratchpad/e4f7-capture-referee.mjs` was
a session path, and a session path is not evidence. It was committed as
[260907e-capture-referee.mjs.txt](260907e-capture-referee.mjs.txt) at 01:50, about three minutes
before the review landed, for the same reason Sol gives. **That is a coincidence, not a fix in
response**, and the finding stands on its own: two slices of this migration cited evidence nobody
else could re-run.

The half of F3 that was *not* already fixed is the part that matters: Sol asks for a verifier **whose
new return rail can be reviewed**, and the rail currently lives in a separate measurement script.
Stage 2 therefore lands **one** script that captures, normalises, applies the rail and diffs, kept
beside this doc, rather than two that have to be run in the right order by someone who knows to.

**Answers to the six questions, all confirming:** ordering correct and no path changes handler;
`live-tool` separated by method, contiguity immaterial but preserved anyway; Stage 1's decomposition
and its predicted red/green both correct, with the third mutation identified as F2's; the rail fires
on exactly `chat` GET; the security account correct, including that guards 6–8 are right to use
`part` because a session id is an owner-scoped lookup value never joined into a storage path; and
**keep all twelve together** — a six/six split cuts through the interleaved chat/live sequence,
doubles the ceremony and removes no distinct risk.

On the file getting longer, asked directly and answered directly:

> The file-size increase is not grounds to stop: this migration reduces dispatcher complexity and
> converges on one routing mechanism; file extraction is a separate decision.
>
> — GPT Sol, 2026-09-08

## Stage 1, as built — and what the mutation actually showed

`tests/chat-thread-delete-route.test.ts`, two cases, registered in the `private-postgres` lane of
`TEST_LANES` (a new test file defaults to `unit`, whose `DATABASE_URL` is poisoned on purpose, so an
unregistered Postgres suite fails on `ECONNREFUSED 127.0.0.1:1` and looks like a broken database).

**Green unmutated: 2 passed of 2.**

**Mutation 1 — the subject — 2 failed of 2**, and the second failure is worth more than the first:

- *answers with the remaining conversations* — `threads was not an array — a promise was not awaited:
  expected false to be true`. The predicted `{"threads":{}}`.
- *really removed it, and not only in the reply* — `expected [ 'spya-j827m6', 'spya-dmkgcy' ] to
  deeply equal [ 'spya-dmkgcy' ]`. **Both conversations were still in the store when the next request
  looked.** So the file does not merely detect a Promise where an array belongs; it demonstrates the
  defect the plan described — the reply had already gone out saying the thread was deleted while the
  deletion had not happened. The prediction was for the first assertion only; the second is better
  evidence and was not designed for.

**The box died during this stage, and the discriminator mattered.** A triage agent killed every
vitest process on the machine at load average 391 with swap full, and reported any run in flight
void. This run was not in flight: it had written its `EXIT=1` line, the vitest summary and two named
assertion failures whose text matches the predicted semantics exactly. A killed run writes no `EXIT=`
line at all — which is the property `scripts/tmux-job.ts` exists to give, and it is the difference
between a result and a silence. `src/routes.ts` was reverted immediately and verified byte-identical
to `HEAD` before anything else was done.

**Mutation 2 — the control — 2 passed of 2, as predicted before it was run.** The lock deleted, the
`await` kept, and every assertion in the file still holds. So the plan's table is not a claim any
more:

| Mutation | Predicted | Observed |
|---|---|---|
| `await inTurnOrder(…)` → `inTurnOrder(…)` | red | **2 failed of 2** |
| `inTurnOrder(k, f)` → `f()` | green | **2 passed of 2** |

Both halves matter. A file that only demonstrated the red would leave the reader free to believe it
also covers the lock — which is precisely the belief that produced the earlier test
`tests/turn-order.test.ts` warns about, the one that passed with the lock removed. Demonstrating the
green is what makes the disclaimer in this file's header a measurement rather than a modesty.

## Stage 2, as built — and the corruption the body diff could not have caught

The twelve moved as one contiguous block, verified contiguous by the script before anything was cut:
each guard's end offset is the next one's start, so *"the chain's last twelve"* is a measurement
rather than a reading. `CHAT_PATTERN` and `ONE_THREAD_PATTERN` are new module-scope constants,
because those matchers have two rows each; the other eight are written into their single rows, which
is the rule the constants' own comment states.

**The verifier says the move is a move.** Eleven bodies identical, one refused and accounted for:

```
refused, accounted    chat GET                 2 returns in the guard's own scope
identical             chat POST                163 chars
identical             chatCancel POST          127 chars
identical             chatLiveTool POST        175 chars
identical             chatLive POST            130 chars
identical             liveSessionConnected POST 55 chars
identical             liveSessionUsage POST    72 chars
identical             liveSessionClose POST    72 chars
identical             chatSpoken POST          212 chars
identical             chatStop POST            125 chars
identical             oneThread PATCH          258 chars
identical             oneThread DELETE         162 chars

the move is a move
```

### The bug in the first attempt, which is the useful part of this stage

The generator renamed the matcher identifier to `captures` with a global `\bchat\b`. It rewrote
**English**:

- *"The reading view needs one thing from chat"* became *"one thing from captures"*.
- The citation `docs/plans/260826ab-chat-as-gateway.md` became `260826ab-captures-as-gateway.md` — a
  link to a file that does not exist.

**The body diff cannot catch this**, and that is the point worth keeping. The normaliser strips
comments before comparing, precisely so that re-indenting or re-wrapping a comment is not reported
as a code change — so a comment silently rewritten is invisible to the very check whose job is to
prove the move was a move. It was caught by reading the generated rows before applying them, which is
not a mechanism.

The generator was fixed — match on a copy with comments and string contents blanked, then splice at
those offsets in the original, so the rename touches identifiers and never prose.

> **This paragraph used to end by saying anyone repeating the recipe inherits that fix, through the
> committed verifier. That was false**, and the review below caught it (F9): the verifier does not
> generate code, and the generator that had the fix was a scratchpad script. The claim is now true by
> a better route — **the verifier compares comments**, so the next generator does not have to be
> careful. See § *The Stage 2/3 review* for the check watched failing on this exact corruption.

### `chat` GET: the mutation, not the argument

The rail refused it, so the plan review (F2) required a watched mutation instead of the hand argument
the plan originally proposed. The early `return;` was deleted from the moved handler and
`tests/the-query-string-does-not-decide-the-route.test.ts` run:

```
× reaches the summaries branch when it carries ?summary=1
AssertionError: expected { id: 'spya-cue56u', …(5) } to not have property "messages"
1 failed | 2 passed (3)
```

Both `send` calls execute, the second overwrites the first, and the summary reply arrives carrying
the full transcript. The return was restored and the file is green. **The other exit is therefore
covered by a test rather than by a paragraph**, which is what F2 asked for and is better than what
the plan proposed.

### Comments that moved with their routes

Two blocks in the chain explained routes rather than the chain, and went to the table with them: the
live-session accounting comment (*"they are NOT under `/api/chat/`"*), and the live-conversation
ticket comment. The second needed rewriting rather than relocating, because **chain dispatch order
splits the pair it describes** — the ticket is now four rows above `spoken`, with the three
`/api/live/` rows between. The rewritten comment says so, and says why the table must not be sorted
into subject order to fix it.

Three comments elsewhere were stale and are corrected: the chain's *"`liveSessionClose` is now the
last matcher this chain declares"* (it is `commentMark` now, and comments are the next slice), and
the table's two *"twenty-five guards"* counts. The first of those two now **refuses to carry a
count at all** — it changes once per slice, and `EXPECTED_AUTH_ROUTES` is the inventory.

## Stage 3, as built — red first, and one check that could not fail

**Red first.** With the twelve moved and nothing else touched, the contract test failed **exactly the
two expectations Sol's F1 named, and only those**: *answers the moved domains from the table* and
*keeps the table in the chain's order*. **324 passed of 326** — so `EXPECTED_AUTH_ROUTES`, the
81-route inventory, needed no edit, which is the evidence that the move changed no route's identity.

Both lists took the same twelve pair keys, generated rather than typed. Green at **326 of 326**.

**The `moved` prefix list is inert in this tree, and saying so is the point.** `/api/chat` and
`/api/live` are added, but the filter beside them is the blind version — 260907b's `pathish` fix is
committed on their branch and not yet pushed. So that line cannot fail here yet, and a green run is
not evidence the move is complete.

**So it was checked, with a control.** The filter was temporarily un-blinded locally (the same
backslash-stripping idea as their fix) and the contract test run:

- with `/api/chat` and `/api/live` in `moved`: **326 passed** — no chat or live guard is left in the
  chain.
- with `/api/comments` added, a domain still entirely in the chain: **red**, *"a moved route is still
  a guard in the chain as well as a row in the table"*, six guards found.

The second run is what makes the first mean anything. Both probes were reverted; **this tree ships
the filter exactly as `dev` has it**, because the fix is 260907b's to land and duplicating it is how
the referee slice got built twice.

## The Stage 1 review, and the P1 it caught in a file I had just committed

`docs/plans/260908a-stage1-review-sol.md`, against commit `ccd3ac8c`. Verdict: **stage is sound with
these changes.** Five findings, all accepted, all verified here first.

**F4 — P1. The committed stage broke a repository test, and Sol ran it rather than reasoning to it.**
`tests/chat-thread-delete-route.test.ts` carried a line-anchored `**Blind to.**`, which is reserved
vocabulary: `tests/store-migration-registry.test.ts` requires every file containing it to appear in
`STORE_CONVERSIONS`. Reproduced here — and running the **whole** file rather than Sol's filtered case
found a **second** failure it had not reached: *leaves no file that the import graph can reach and
nothing accounts for*, because the new test reaches a condemned module through `scratchArticleInPg`
and had no verdict in `STORE_MIGRATION`.

Both fixed honestly rather than quietly:

- the marker is renamed to `**Outside this oracle.**`, outside the vocabulary. Sol's own advice was
  *"do not add a historically false `STORE_CONVERSIONS` entry"*, and it is right: this file is not a
  conversion, it was written five days after the filesystem store was deleted.
- a `STORE_MIGRATION` entry says exactly that, and is marked **`evidence: "static-only"`**. That
  field was not in the first attempt, and a third assertion caught it — the default is `"dynamic"`,
  which claims the instrumented witness watched the file run, and that witness is a dated measurement
  from 2026-09-03. A file that did not exist cannot have been watched. **13 of 13 green** afterwards.

**F5 — P2. The general argument I put in the umbrella plan was wrong in three ways.** It said the
public dispatch is the one thing before `requireUser` (it is not — the Stripe webhook's exact-path
branch at `src/routes.ts:6381` also runs there), that a *different* literal prefix implies a
*disjoint* one (it does not — `/api/public/foo` is a different literal prefix inside the public
namespace), and it therefore listed an incomplete set of ways it could stop being true. Rewritten in
260907b as the narrow claim: **two** pre-auth claims, named and cited, with the four ways they could
change. The wrong version is kept above the right one, because it is the version anybody would write.

**F6 — P3, accepted.** The lane comment said nothing goes near Storage. `scratchArticleInPg` reaches
it through `loadArticleIntoPg` → `storeRawSource`. Corrected, with a note that it was copied from the
neighbouring entry without checking — which is how it got there.

**F7 — P3, accepted.** `expect(article.copied).toContain("blocks")` was cargo, copied from the
sibling file; thread deletion reads no block. Removed.

**F8 — P3, accepted.** The plan's status line still said *plan written, not built*. Refreshed.

**One thing in the review I am recording rather than acting on.** Sol notes the second oracle case is
timing-sensitive under mutation 1 — the background deletion *could* finish before the second `it`
reads, so the first assertion is the reliable one. That is right, and it does not weaken the stage:
the first case is the oracle, and the second observed red is a bonus rather than the mechanism. It is
worth knowing that a future flake there would mean the race resolved the other way, not that the
route regressed.

## Where the file stands

| | Lines | Complexity of `serveAuthenticatedApi` |
|---|---|---|
| before this slice | 8,575 | 153 |
| after it | **8,651** | **125** |

Seventy-six lines longer and twenty-eight points simpler, which is the trade this migration has been
making all along and the reason § *What the fifth sweep will measure* exists in 260907e. Biome's
ceiling is 25, so the function is still five times over it; `:2349` at 77 and `:2591` at 36 are
untouched by this migration and will survive it.

## The Stage 2/3 review, and the claim in this doc that was false

`docs/plans/260908a-stage23-review-sol.md`, against `b4bd19c8`. **No P0 and no P1** — Sol re-ran the
verifier against the git blobs itself and confirmed the twelve are a pure move, the two constants are
byte-equivalent to the matchers they replaced, both pair-key lists hold the same twelve in the right
order, `chatLive` is filed under `/api/chat` everywhere, and `query` reaching `chat` GET is the same
`URLSearchParams` instance `serveApi` built. Four findings, all accepted.

**F9 — P2. This doc claimed a fix that was not in the artefact.** § *Stage 2, as built* said anyone
repeating the recipe "inherits the fixed version" through the committed verifier. **False.** The
verifier only captures, normalises and diffs; the *generator* is what had the comment bug, and the
generator was a scratchpad script that no longer exists. So the sentence described a safeguard nobody
could inherit — which is a worse defect than the bug it was describing, because it reads as closed.

Fixed by making the claim true in the better direction: **the verifier now compares comments**, so a
future generator does not have to be careful. `commentsIn` collects each body's comment text,
whitespace-collapsed and **without** the matcher rename applied — a comment that said `chat` before
the move must still say `chat` after it, because the rename is a code edit with no business in prose.
An intended rewrite is declared in `EXPECTED_COMMENT_EDITS` (empty for this slice) and anything
undeclared fails.

**And it was watched failing on the real thing.** The original corruption was reproduced into a
scratch copy of the finished `routes.ts` — the two phrases the bug actually produced, code untouched
— and the verifier run against it:

```
identical             chat GET                 202 chars
*** COMMENT CHANGED *** chat GET — 1 before, 1 after
  before: … one thing from chat: … docs/plans/260826ab-chat-as-gateway.md § summaries. */
  after : … one thing from captures: … docs/plans/260826ab-captures-as-gateway.md § summaries. */
1 problem(s)   exit=1
```

**The body still reports `identical`.** That line is the whole demonstration: this is a defect the
body diff cannot see and the comment check can.

The edge of the instrument, stated so the next reader does not infer a wider one: comments *outside*
handler bodies — the ones above a row, including the two live-session blocks this slice moved — are
still read by a person in the diff.

**F10 — P2. A refusal was skipping the body comparison, not just narrowing it.** `chat` GET reached
`continue` before its bodies were compared, so *any* change anywhere in that handler would have
printed `refused, accounted`. The rail was answering a question about returns and was being read as
answering the question about the whole body — the same shape of mistake as a check that agrees with
the code because it shares an assumption with it.

Now every guard's body is compared first and the rail is an **additional** demand on top. The
expected-refusal map also matches the rail's own words rather than only the key, so an explanation
written for *two* returns cannot silently cover three. `chat` GET's bodies are identical, so the
strengthened version is green — which is the point: the fix costs nothing and the old version was
green for the wrong reason.

Sol also names a reusable blind spot I am recording rather than fixing: `blockAt` counts raw braces,
including inside comments and strings. It does not mis-extract these twelve — checked — but a
scanner-based boundary would be safer for whoever takes `comments`.

**F11 — P3. My rewritten comment made two false claims about where things are.** It said the ticket
and `spoken` "were declared next to each other in the chain" and that the move separated them. Both
halves wrong: the three accounting guards sat between them in the chain too. The accounting comment's
"the two above" was also wrong, since `spoken` is below it. Both now name routes rather than
positions, and the ticket comment records what it used to say. **I asserted this without checking,
in a commit whose whole subject is that assertions about moved code must be checked.**

**F12 — P3. `git diff --check` failed** on a whitespace-only line and a misindented comment left by
the script that inserted the twelve keys. Fixed.
