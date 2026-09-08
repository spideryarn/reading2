# Referee joins the route table — and the stream-lifetime test that has to come first

Status as of 2026-09-07 19:30: **reviewed and revised; building.**
[GPT Sol's review](260907e-referee-joins-the-route-table-review-sol.md)
([prompt](260907e-referee-joins-the-route-table-review-prompt.md)) returned **no P0 and six P1s**,
verdict *"revise before implementation"*. The headline finding is that **the lock oracle in my first
draft was invalid** — it would have passed whether or not the lock was held. I checked that against
the code and Sol is right; § *What Sol found, and what I checked* records each finding, what I
verified, and what changed. Everything below is the revised plan.

This is the next slice of the work
[260907b](260907b-split-the-authenticated-api-dispatch-by-domain.md) landed and deliberately stopped:
the eight **referee** guards move out of the `if` chain in `serveAuthenticatedApi` and into
`AUTH_ROUTES`. That plan named this slice, named its prerequisite, and named the one test that has to
move with it. Almost nothing here is my invention; the value I am adding is doing it, and doing the
prerequisite properly rather than on a syntactic check.

## Brief

> Start splitting `src/routes.ts`. Three consecutive codebase sweeps have named this as Tier 3 and
> watched it get worse; the fourth wrote *"Recorded not to defer to it a fourth time believing it is
> happening. It is not happening."* Make it happen, one bounded slice.
>
> — Greg (via the session brief), 2026-09-07

The brief also said: *"Following a shape the codebase has just adopted is worth more than inventing a
better one."* That sentence decided this plan, and it is worth being explicit about how — see
§ *The one instruction in the brief I am not following, and why*.

## What changed between the brief and this plan

The brief was written against measurements that a sibling session has since invalidated, which is
exactly what it warned would happen. Re-measured on this worktree at `eedae885`:

| The brief said | State at 19:05 on 2026-09-07 |
|---|---|
| `src/routes.ts` is 8,180 lines | **8,482.** It grew 302 lines *during* the split, because the table is added above the chain before the chain shrinks. |
| `src/web/App.tsx` → 407 lines, ten mode controllers, "read what it did before you design anything" | **Not landed.** `App.tsx` is 6,282 lines on `dev` and `src/web/modes/` holds one directory. The precedent it was offered as is still unpushed in `.claude/worktrees/a1-a3-reader-composition`. |
| "a sibling session **may** be adding a static check that the allowlist and the route classes agree" | It did more than that. `worktree-api-dispatch-by-domain` **landed**, with seven stages and a 2,400-line contract test. |
| No route table — `260902e` records one was deliberately not adopted | **Reversed, deliberately and with review.** Greg named a route table as the shape; Sol endorsed it over per-domain functions. |

So the shape question the brief told me to leave closed is closed the other way, and the file to
follow is `src/routes.ts` itself rather than `App.tsx`.

## The slice, and the four I rejected

The chain's domains are contiguous (260907b § *The domains are already contiguous*). The table is
dispatched from **exactly one place**, at the bottom of the chain immediately above the terminal 404,
and that position is load-bearing: a guard moved into the table is evaluated where the table is
consulted, not where it used to sit. So a slice is a **pure move only if it is the contiguous block
immediately above the table call**. Anything else reorders the moved guards against everything
between them and the dispatch point.

At `eedae885` the chain's last eight guards are:

| Line | Guard | Matcher |
|---|---|---|
| 8319 | `criteria` GET | `/^\/api\/referee\/criteria\/([\w.%-]+)$/` |
| 8331 | `criteria` POST | *(same)* |
| 8342 | `oneCriterion` PATCH | `/^\/api\/referee\/criteria\/([\w.%-]+)\/([\w.%-]+)$/` |
| 8361 | `oneCriterion` DELETE | *(same)* |
| 8366 | `refereeClaims` GET | `/^\/api\/referee\/claims\/([\w.%-]+)$/` |
| 8382 | `refereeClaims` POST | *(same)* |
| 8400 | `refereeScan` GET | `/^\/api\/referee\/scan\/([\w.%-]+)$/` |
| 8427 | `refereeMirror` POST | `/^\/api\/referee\/mirror\/([\w.%-]+)$/` |
| 8460 | *the table* | — |

**Verified rather than assumed:** all five matchers are declared at `:7469`–`:7486` and used by
these eight guards and nothing else (`grep` for each name above `:7400`). The declarations move with
the block; none is left behind holding a dangling reference. That is what makes this a clean cut
rather than a cut with a tail.

The alternatives, and why not:

- **`searches` (4 guards), immediately above referee.** Not adjacent to the table — referee's eight
  sit between. Moving it alone reorders it against all eight. Rejected on the pure-move rule, not on
  size.
- **A cheap non-streaming domain further up** — `glossary/lookup/askTerm` (4), or
  `ideas/quotes/timeline/quiz/debate/quizMark` (6). These look like the tempting ones: no streams, no
  locks, a genuinely trivial move. Two things, one of which I had wrong. First, they sit *hundreds of
  lines* above the dispatch point, so moving them reorders them against every guard in between —
  probably harmless, since 260907b asserts no two guards accept the same method and path, but
  "harmless because a test says the property holds today" is a behaviour change wearing a pure move's
  clothes. Second, **the quiz block is not non-streaming**: `quizMark` POST writes its own headers
  and ends the response (Sol; checked at `:7914`). Rejected — but see § *The one recommendation I am
  not taking*, because Sol makes a real case that `glossary` specifically can be proved safe
  exhaustively, and I am declining it on a different ground than this one.
- **Move the table call upward instead**, so a middle domain becomes adjacent. This gives the whole
  table its turn at the higher position, so billing would answer from a position it has never had —
  260907b's comment at the dispatch site says exactly this. Rejected.
- **A second table call.** Same defect, and it is the one thing the existing comment forbids by
  name. Rejected.

So the slice is **referee, eight guards**, and it is the only slice that is a pure move today. This
is not a coincidence: the design deliberately makes the queue a single file, consumed bottom-up. The
cost of that is that you cannot pick the easy one — and that cost falls on this slice, because
referee is where the streaming starts.

## The one instruction in the brief I am not following, and why

The brief says: *"No router framework, no route table DSL, no decorator layer — `260902e` records
that a route table was deliberately **not** adopted on a previous pass and calls that a real
decision."*

That decision has since been revisited by Greg himself, who named a route table as the shape for
`serveAuthenticatedApi`; GPT Sol reviewed the plan and endorsed the ordered closure table over the
alternative of per-domain functions; and seven stages of it are on `dev` with a contract test. The
brief was written before that landed.

I am therefore **adding rows to an existing table rather than building one**, which I read as
obeying the brief's actual intent — do not invent new machinery — while following its stronger and
more specific instruction to adopt the shape the codebase has just adopted. If Greg disagrees, the
cheap correction is to stop after Stage 1, which is valuable on its own and adds no rows at all.

## Where the gate lives after this change: exactly where it lives now

The brief flags `src/routes.ts` as on the defence list, and warns that *"the one `requireUser` call"*
is load-bearing — a split ending with two call sites has broken the property even if every route is
still guarded.

**This slice does not go near it.** Measured, not assumed:

- `requireUser` is called **once**, at `:6404`, and `grep -n requireUser src/routes.ts` returns that
  one call plus the import and six comments about it.
- Both the referee guards and the `dispatchAuthRoute` call are **inside** `serveAuthenticatedApi`,
  which is reached only with a `VerifiedUser` — the type only `requireUser` can make, re-checked at
  runtime by `assertVerifiedUser` as the function's first statement.
- Moving a guard from one part of that function's body into a table consulted from another part of
  the same function's body does not move the gate, does not add a call site, and does not change what
  is required to reach either.

After this change the count is still **one**. I will assert that rather than claim it: Stage 2 adds a
source-reader case to the contract test pinning `requireUser` to a single call site, so the next
slice up cannot quietly make it two.

`slugPart` is the other named defence — every capture that becomes a directory name. All five
referee routes take a slug, and every one of them calls `slugPart(…, 1)` today. The moved handlers
call `slugPart(captures, 1)` on the raw `RegExpExecArray`, which is the same function on the same
capture; `dispatchAuthRoute` deliberately does no decoding of its own, precisely so this stays true.
Nothing here weakens it, and the contract test already pins the decode order per route.

## Why this slice is not the cheap kind: three streams and two locks

Billing, jobs and uploads were JSON in, JSON out. Referee is not:

| Guard | Streams? | Holds a live-run lock? |
|---|---|---|
| `criteria` POST → `runRefereeCriterion` | **Yes**, `sse(res)` | **Yes** — `refereeing`, added at `:4149`, deleted in a `finally` at `:4177` |
| `refereeClaims` POST → `runRefereeClaims` | **Yes** | **Yes** — `pullingClaims`, `:4284`/`:4315` |
| `refereeMirror` POST → `runMirror` | **Yes** | No |
| the other five | No | No |

`refereeing` is not merely bookkeeping: `criteria` GET reports a row as still running by consulting
it (`sweepCriteria`), and `refereeClaims` GET passes `pullingClaims.has(slug)` into its sweep. So the
lock's lifetime is **observable through a second route** — which is what makes the prerequisite test
possible to write without exporting anything private.

**The hazard, stated precisely.** In the chain the guard is `await withSpendAttribution(…)` then
`return`, and `serveAuthenticatedApi` is awaited by `serveApi`, so the request does not settle until
the stream is finished, the store `finish` has run and the lock is released. `dispatchAuthRoute` also
awaits its handler, so the property survives a *correct* move. It does not survive a move that drops
the `await` or the arrow-body `return` — and **that mistake typechecks**, because a handler returning
`Promise<void>` and one returning `void` after launching a promise are both assignable to a body the
compiler is happy with.

260907b's `assertHandlersAwaited` is a **syntax tripwire, not behavioural proof**: it would still
pass if a moved closure launched its stream without returning it, swallowed an error, or released its
lock early. That is [silent-success.md](../reusable/silent-success.md) exactly — a claim about shape
standing in for a claim about lifetime. Sol required a real integration test before referee moves,
and 260907b records a note against itself that `jobAdvance`, a lease-owning handler, was already
moved on the syntactic check alone.

So Stage 1 is that test, and it is written against the **still-chain-based** route, so that it is
green before the move for the right reason and its staying green afterwards means something.

## What Sol found, and what I checked

Six P1s. I verified each against the code rather than taking it on trust; all six stand, and two of
them were errors of fact in my draft rather than differences of judgement.

1. **The lock oracle was invalid — the most valuable finding in the review.** I claimed a mid-stream
   `GET` reporting `pending` proves `refereeing` still holds the key. It does not.
   `sweepPending` (`src/store/pg-referee-criteria.ts:384`) has **two** guards, and its own comment
   says each alone is a bug: `keep` — the live set, from `liveCriteria(slug)` — *and* an age cutoff
   of `CRITERION_ORPHAN_GRACE_MS = 150_000` (`src/routes.ts:4003`). A row begun moments ago is
   younger than the cutoff, so it is protected **by the age check alone**, with or without the lock.
   My planned mutation — deleting `refereeing.delete(key)` — would not have turned the test red.
   That is precisely [silent-success.md](../reusable/silent-success.md): an oracle that agrees with
   the code because it shares an assumption with it. **Fixed** by advancing the clock past the grace
   before the mid-stream GET, so `pending` can only mean the live set protected the row, and by
   proving release with a *stale* row the sweep must collect.
2. **The settlement check needed a handshake.** Starting `handleApi` and racing it against a
   resolved sentinel can pass before dispatch has even reached the handler — it would report
   "unsettled" for a request that never got started. **Fixed:** the generator signals when it is
   reached and blocked, and settlement is only inspected after that checkpoint, via an explicit
   `settled` boolean rather than a race.
3. **My "rejection propagation" case was not one.** `runRefereeCriterion` catches a generator failure
   and converts it to an `error` row (`src/routes.ts:4155`) — I had read that code and still
   described the case wrongly. It proves conversion and cleanup, not propagation to `serveApi`'s
   error path. **Fixed:** propagation is provoked by rejecting `refereeCriteriaStore.begin`, which is
   outside that `catch`.
4. **Criteria does not stand in for claims and mirror.** Three closures can independently forget to
   return their promise, and claims has its own lock, key, store method and sweep
   (`src/store/pg-referee-claims.ts:275`). Covering one and moving three would be the same
   shape-for-lifetime substitution I criticise `assertHandlersAwaited` for. **Fixed:** all three get
   coverage.
5. **"Pure move" was asserted, not demonstrated.** **Fixed:** Stage 2 captures the normalised handler
   bodies before and after and diffs them mechanically — see there.
6. **The `requireUser` assertion should be AST-based**, not a comment-stripped text count. **Fixed**,
   and strengthened: it also asserts the call sits inside `serveApi` above the handoff.

Sol also corrected a **factual error in my rejected-alternatives list**: I offered
`ideas/quotes/timeline/quiz/debate/quizMark` as a cheap *non-streaming* block. `quizMark` POST calls
`markOneAnswer`, which writes its own headers and ends the response — it streams. Checked at
`:7914`; the guard's own comment says so. Corrected below.

### The one recommendation I am not taking, and why

Sol's **P2**: referee is *"safe, yes; uniquely necessary, no"*, and `glossary/lookup/askTerm` is
*"the easier defensible slice"* — non-streaming, and provably disjoint from every intervening route
by its literal `/api/glossary/` namespace rather than by the finite corpus the contract test checks.
That is a fair criticism of my "only possible slice" claim, which was too strong: referee is the only
slice that preserves **textual dispatch order**, not the only one that preserves behaviour.

I am staying with referee anyway, and the reason is not that glossary is unsafe:

- **It would weaken the invariant the landed design rests on.** The dispatch-site comment says the
  table's position "leaves each of them where it already was and **reorders nothing** — the property
  that makes each increment a rearrangement rather than a behaviour change." Today that property is
  global and checkable at a glance: the table is the chain's suffix. Move glossary and it becomes
  "reorders nothing *that matters*, per an argument recorded in a plan doc" — weaker, and something
  every future reviewer has to re-derive rather than see. Sol's own answer to Q8 is that following
  the landed shape is right; this is that same principle one level down.
- **It jumps the queue and leaves the blocker in place.** Referee is the head of the queue precisely
  *because* it is where the cheap part ends. Taking the easy slice instead leaves referee as the
  permanent next-slice, which is how this file got deferred three times.
- **The prerequisite is worth having on its own.** Three streaming routes currently have no coverage
  of their stream's lifetime or their lock's release. That gap is real whether or not a guard ever
  moves.

Recorded as a genuine fork, so a later reader can disagree with it cheaply: if Greg would rather have
had the easy slice, glossary is still there, and this plan's § *The next slice* names it.

## Stages

Each stage ends with `npm test` on the affected files, `npm run typecheck`, `npm run check`, and a
GPT Sol review. Stage 1 is committed before Stage 2 begins.

### Stage 1 — the lifetime tests, against the routes as they are today

New file `tests/referee-stream-lifetime.test.ts` (not `-criteria-`: it covers three routes). Harness
copied from `tests/referee-criteria-routes.test.ts` — `handleApi(req, res, acceptAny)`,
`AUTHED_HEADERS`, `scratchArticleInPg` with `ownerId: TEST_OWNER` — but with a response object that
really accepts `writeHead`/`write`/`on`, because these *do* stream.

The shared instrument: the underlying stream is stubbed with an async generator that yields one
`result`, **signals that it has been reached**, and then blocks on a promise the test resolves.

**The handshake, which is what makes the settlement claim mean anything** (Sol's finding 2). Nothing
is inspected until the generator's "reached and blocked" signal has fired. `handleApi`'s promise is
tagged with `.then(() => { settled = true })` at the moment it is created, and the assertion reads
`settled` after the checkpoint — no race against a sentinel, no timer.

**While held**, for each of the three routes:

1. `settled === false`;
2. the response has **not** ended.

**And for the two that hold a lock**, the oracle Sol's finding 1 requires — the clock is advanced
past the grace (`CRITERION_ORPHAN_GRACE_MS`, and the claims equivalent) with fake timers before a
second, ordinary `GET` is issued. Now `pending` cannot be explained by the row's age, so it means the
live set protected it, and deleting `refereeing.delete(key)` makes it fail.

**Then release**, and require in order: the terminal frame, the store `finish`, the response ended,
the lock released — proved by planting a **stale** `pending` row under the same key and requiring the
next `GET` to sweep it, which it can only do once the key has left the live set — and **only then**
`settled === true`.

Per route:

- **criteria POST** (`runCriterionStream`, lock `refereeing`) — the full sequence above.
- **claims POST** (lock `pullingClaims`, its own sweep in `src/store/pg-referee-claims.ts`) — the
  full sequence, written against *its* store rather than by analogy with criteria.
- **mirror POST** (streams, no lock) — lifetime and end-order only: blocked ⇒ unsettled and not
  ended; released ⇒ ended, then settled.

**Plus a real propagation case** (Sol's finding 3): `refereeCriteriaStore.begin` is made to reject —
it is outside `runRefereeCriterion`'s `catch` — and the request must stay pending until the rejection
and then answer through the outer error path, rather than hanging or answering 200.

**How I will know these tests can fail.** Four mutations, each run and watched, with the output
pasted into this doc. A test never seen red is not evidence:

| Mutation | Must break |
|---|---|
| drop the `await` in the chain guard | settlement (`settled` true while blocked) |
| delete `refereeing.delete(key)` in the `finally` | the aged-GET lock check |
| move the lock deletion *above* the blocked work | the aged-GET lock check |
| in Stage 2, `void withSpendAttribution(…)` in the moved closure | settlement — this is the exact launch-and-resolve defect the move risks, and it is why the test exists |

The fourth is only runnable once Stage 2 exists; it is the acceptance test for the move itself. All
four are reverted immediately and none is committed.

#### Stage 1, as built — and the three mutations, watched

`tests/referee-stream-lifetime.test.ts`, 8 cases, green against the routes **still in the chain**;
`tests/store-migration-registry.ts` gains the lane and the registry entry a new Postgres suite needs.
Nine files / 589 tests green together, `npm run typecheck` clean.

The mutations were run one at a time against the unmoved routes, and each failed on its own
assertion and no other:

| Mutation | Result |
|---|---|
| `await` → `void` in the criteria guard | **red**, 2 cases: *"the request answered while the stream was still running: expected true to be false"*, and the propagation case, which an un-awaited rejection cannot reach |
| `refereeing.delete(key)` deleted from the `finally` | **red**, 1 case: *"the key was never released, so the sweep spared it: expected 'pending' to be 'error'"* |
| the release moved above the blocked work | **red**, 1 case: *"an aged row survived only if the lock is held: expected 'error' to be 'pending'"* |

The middle row is the one that justifies the review: **that is the mutation my first oracle stayed
green under.** `git diff HEAD -- src/routes.ts` was empty afterwards, so nothing leaked into the
commit.

Two things I got wrong while building it, both caught by the suite rather than by reading:

- backdating **every** row of the article violated `referee_criteria_attempt_both`, because `finish`
  clears the attempt pair and my update stamped a time onto a row with no attempt id. Aging only
  `pending` rows is both the fix and what the cases actually mean.
- proving release via `refereeCriteriaStore.begin(…, sameId)` made the case depend on
  `withCriterion`'s reset policy — it returned the row still `done`. The row is now put back to
  `pending` directly, so the case is about the lock and nothing else.

### Stage 2 — the move

Eight rows appended to `AUTH_ROUTES`, **prepended above the jobs rows in the chain's order**, so the
table's internal order still mirrors the order these guards had. Five matchers promoted to named
module-scope constants beside `UPLOAD_PATTERN`, since entries are static and built once.

Handler bodies go across **byte-for-byte**, including their comments, with only the mechanical
substitution the table's shape requires: `slugPart(criteria, 1)` → `slugPart(captures, 1)`, and
`{ req, res }` taken from `context.request`. Nothing is renamed, reordered, reformatted or improved.
If I find a bug while moving, it is noted here and fixed in a **separate** commit afterwards, so the
move stays reviewable as a move.

**The evidence that it *is* a move** (Sol's finding 5 — "asserted, not yet demonstrated"). Byte-for-
byte with a list of permitted substitutions is a claim, and the previous slice produced a comparison
artefact rather than a claim. I do the same:

- the eight handler bodies are extracted and **normalised** — the permitted substitutions applied,
  whitespace collapsed — **before** the move and again after, and diffed. The diff is empty or the
  move is not pure. Both captures and the diff go in the commit message.
- `EXPECTED_AUTH_ROUTES` in the contract test is shown unchanged **except** for the eight appended
  rows, so the test is not edited into agreeing with the arrangement it is supposed to bless — the
  specific failure Sol names.
- the module's exported names are listed before and after and compared; the lists must be identical.

Two comments must change, and they are the only prose edits in this stage:
- the dispatch-site comment, which currently says the table holds "jobs, uploads and billing" and
  that they "were its last thirteen guards";
- `:7491`, which says `refereeScan` "is now the last matcher this chain declares".

Leaving either would be a doc lying about the code, which is the failure mode 260907b's own § *What
the mis-read review cost* is about.

**One test moves with it, loudly and by design.** `tests/referee-scan-route.test.ts:342` extracts the
scan handler with `/if \(refereeScan && req\.method === "GET"\) \{[\s\S]*?\n {4}\}/` — the closing
brace pinned at four spaces, the guard's indentation *inside the chain*. After the move that arm does
not exist, the regex returns `""`, and its presence control
(`expect(whole, "the route is not in src/routes.ts under that name").not.toBe("")`) fires. That is
the safety net working, not a defect. The regex is re-pointed at the table row in the same commit,
and its three assertions — `shelfStore.read(slug)` before `scanArticleSource(slug)`, and no
`withSpendAttribution` — are kept exactly, because they are an owner-isolation control, not a
formatting detail.

#### Stage 2, as built — and the purity evidence

`src/routes.ts` 8,482 → 8,540 lines. **The file got longer, and that is expected**: 260907b says so
plainly — the payoff is an enumerable dispatch contract and fewer simultaneous editors in one region,
not a smaller file. `serveAuthenticatedApi`'s chain lost 122 lines; the table gained more, because a
row carries a `kind`, a `method` and a `pattern` where a guard carried an `if`.

**The purity evidence, mechanical rather than asserted:**

- the eight handler bodies, normalised (the permitted substitutions applied, comments and whitespace
  collapsed) and captured from the chain **before** the move and from the table rows **after** it:
  `diff` is **empty**. 150, 180, 333, 137, 179, 121, 138 and 114 characters, unchanged on both sides.
- exported names before and after: **identical**, 13 of them.
- `EXPECTED_AUTH_ROUTES` — the 81 `(method, match)` pairs — **not touched**. The contract test's own
  header says that is the whole evidence the move was behaviour-preserving, and that a domain which
  cannot move without editing it is a finding about the move rather than a line to edit.

**Three tests went red, all three by design, and none of them is the contract:**

| Test | Why, and what was done |
|---|---|
| `referee-scan-route` § *whose manuscript this is* | Predicted by 260907b to the line. It cut the handler with the closing brace **pinned at four spaces** — the guard's indentation inside the chain — so a two-space table row returns `""` and its presence control fires. Re-anchored on the row's `pattern:`, since a row has no binding name. Its three assertions are unchanged. |
| contract § *answers the moved domains from the table* | The list of which domains have moved. Its own comment: *"Editing it is what a stage does; `EXPECTED_AUTH_ROUTES` is what a stage may not touch."* Eight rows added, and `/api/referee` added to the moved-prefix check that proves no moved route is also still a guard. |
| contract § *keeps the table in the chain's order* | Same eight rows, **prepended**, which is what that case exists to enforce. |

**Mutation 4, the acceptance test for the move itself:** `await` → `void` in the *moved* criteria
closure. `tests/referee-stream-lifetime.test.ts` goes **red** — *"the request answered while the
stream was still running"* — while `tests/authenticated-api-route-contract.test.ts`, including
`assertHandlersAwaited`, stays **green**. That is the syntax tripwire failing to see a real
launch-and-resolve, measured rather than argued, and it is the reason Stage 1 had to exist before
Stage 2. Reverted; the normalised bodies diff clean again afterwards.

Ten files / 587 tests green together, `npm run typecheck` clean.

### Stage 3 — the contract test earns the property the security map relies on

One case added to `tests/authenticated-api-route-contract.test.ts`: `requireUser` is called **exactly
once** in `src/routes.ts`, and that call is inside `serveApi`, above its `serveAuthenticatedApi`
handoff.

**AST, not text** (Sol's finding 6). The file mentions `requireUser` in an import and six comments; a
regex count would have to strip comments and would misfire the first time somebody wrote the word in
a new one. The contract test already has a parser — this counts `CallExpression`s whose callee binds
to the named import, and checks the enclosing function. Comments and the import then cannot fool it
in either direction.

This is cheap, and it is the guard against the specific way this refactor goes wrong three slices
from now, when nobody remembers that "the one call" was a property rather than a coincidence.

#### Stage 3, as built

No new dependency: `tests/helpers/ts-ast.ts` already provides `parseSource`/`walkAst`, and the
contract test already imports from it — so this is the machinery that was here rather than a second
way to do the same thing. The case counts `CallExpression`s whose callee is the `requireUser`
identifier (comments are not nodes, so the six that mention it cannot fool it in either direction)
and asserts the one call sits above the `serveAuthenticatedApi` handoff, since a single call that had
drifted *below* it would satisfy a count and guard nothing.

**Mutation 6**, watched: a second `await requireUser(req, verify)` added under a dead condition.
Red — *"expected 2 to be 1"*, quoting the security map. Reverted.

### The Stage 1 review, and the gap it found

[GPT Sol's review of the built Stage 1](260907e-referee-joins-the-route-table-stage1-review-sol.md)
([prompt](260907e-referee-joins-the-route-table-stage1-review-prompt.md)): **no P0, one P1, three
P2s.** All four are fixed, and the P1 is the interesting one.

- **P1 — the claims lock's *release* was untested.** Deleting `pullingClaims.delete(slug)` left both
  claims cases green: one asks its question mid-stream and the other only about lifetime, so neither
  looks after the request has answered. Criteria had that case; claims did not, and claims is a
  separate lock, key, sweep and store method rather than an instance of criteria. **This is the same
  class as the original oracle bug** — a lock whose release nothing watches — found twice in one
  night, in two different places, which is what makes it worth naming rather than just fixing. Now
  covered, and **mutation 5** confirms it: deleting the claims release turns exactly that new case
  red and nothing else.
- **P2 — the claims grace was not pinned.** The tripwire asserted only
  `CRITERION_ORPHAN_GRACE_MS < 10 min`. `CLAIMS_ORPHAN_GRACE_MS` is derived from a *different*
  timeout, so if it grew past ten minutes the claims lock cases would quietly start passing for the
  age reason again. Both constants are asserted now.
- **P2 — a one-microtask hole in `settled`.** Fulfilling a promise queues its continuations rather
  than running them, so a request finishing in the same job as the gate could read `settled === false`
  for a tick. Sol confirmed the actual mutation is still caught — each route does awaited database
  work before the generator — but the hole is closed with a single `await Promise.resolve()` after
  the checkpoint.
- **P2 — an early failure became a 60-second timeout.** If a route stops matching, the checkpoint
  never fires and the case times out reporting nothing useful. `reachedOrSettled` now races the
  request against the checkpoint and names what happened instead.

Sol also **confirmed three things I had asserted**: the criteria and claims lock oracles are now
causally valid with no third guard available; `importOriginal` does not suppress module-scope side
effects; and the registry's `mechanisms: ["fixture-loader"]` is right, because `withSpendAttribution`
only overlays context and the ledger row comes from gateway calls the stubs bypass. And it confirmed
**point 8** — that nothing in the file is coupled to the guards' current form, so Stage 2 should need
no edit to it. Stage 2 then needed none, which is the useful kind of agreement.

It could not run the suite itself (`EPERM` reaching the local Postgres port), so every green above is
mine, from this box.

## Why the three specification tests still test what they tested

`security-map.md` names these as the specification, and the brief asks me to be able to say why each
survives:

- **`tests/routes.test.ts`** drives requests through `handleApi` and asserts status codes and bodies.
  It never mentions the `if` chain, so it cannot tell a chain guard from a table row — it asks only
  what the endpoint answers. It stays green because the answers are unchanged, and it is the check
  that the move was pure.
- **`tests/owner-isolation.test.ts`** asserts that ownership is decided before data is read. The
  moved handlers keep their `slugPart` and their store calls in the same order, and `setRequestOwner`
  runs at the top of `serveAuthenticatedApi`, above both the chain and the dispatch call. The
  `AsyncLocalStorage` context is therefore identical inside a table handler and inside a chain guard.
- **`tests/public-dto.test.ts`** is about what the public namespace may return. Untouched: nothing
  here goes near `src/public/routes.ts`, and the public dispatcher still runs before `requireUser`,
  read-methods only, no owner set. I am not changing that ordering or looking at it.

## What the fifth sweep will measure, and why it will draw the wrong conclusion

**`src/routes.ts` is bigger than when the split started, and that is expected rather than a failure —
but nothing yet says so where a sweep will look.** Measured on `dev`:

| When | Lines | What had just landed |
|---|---|---|
| 2026-09-06 21:38 | 8,180 | the fourth sweep's number, before any table |
| 2026-09-07 09:00 | 8,385 | stage 3a — the table itself, plus billing |
| 2026-09-07 10:37 | 8,472 | stage 3b — jobs and uploads |
| 2026-09-07 19:49 | 8,538 | stage 2 here — referee's eight |
| 2026-09-08 01:23 | 8,575 | stage 5 — search |

Four slices in, the file has grown by about **395 lines**, roughly 7–12 per guard moved: a table row
costs more lines than the `if` arm it replaces. With 56 guards left, expect another 400–650.

**Lines were never the metric this work moves.** Biome's cognitive complexity on
`serveAuthenticatedApi` is what collapses: **244 → 234 → 183 → 164 → 153** (verified independently
here at 01:23 — `src/routes.ts:7401`, complexity 153, against a ceiling of 25). That is the number to
quote.

The reason the file cannot shrink is written into 260907b as a scope line: **moving domains into
separate files is explicitly out of scope, and marked "Greg's call"**. So a sweep that measures
`src/routes.ts` by `wc -l` will find it worse every week while the work is going well. If the file's
size is the thing that matters, the extraction is a separate decision that has not been taken — and
it is the one that would actually pay. Worth putting to Greg rather than inferring.

Two other functions in this file exceed the ceiling and are untouched by the migration, so they will
survive it: `:2349` at complexity 77 and `:2591` at 36.

## The next slice, so the fifth sweep inherits a queue

> **Claimed, 2026-09-07 21:30.** `searches` is **taken by 260907b** (`worktree-api-dispatch-by-domain`),
> which asked before starting. 260907e is on an 8-hour wait and would have held the slice idle until
> 05:17; handing it to the session that is awake is worth more than keeping the queue tidy. **The next
> unclaimed slice is `chat`**, and whoever takes it should re-measure rather than trust this line —
> that is how `searches` came to be claimed in the first place.

**`searches` — four guards, `:8271`–`:8318`**, immediately above referee, and adjacent to the table
once referee is gone.

- It holds the `searching` lock (`:3800`), so it is a streaming slice too — but the Stage 1 test is
  the pattern, and the second one is cheap.
- Watch for `oneRun` DELETE at `:8313`, which is the last guard of the block: check whether it shares
  a matcher with a guard *above* `searches` before cutting.

Then **`chat` and live sessions — eleven guards, the largest block in the chain**, and the point at
which "one slice a night" starts being worth questioning.

The queue after that, bottom-up: `comments` (6), `sketch/illustrated/arc/similar/projection` (6),
`ideas/quotes/timeline/quiz/debate/quizMark` (6), `glossary/lookup/askTerm` (4), `article` and
friends (9), `reader/shelfOpen` (3), `models/transcribe/feedback` (3), `library/shelf` (4) — and
**the admin gate last, or never.** It is a gate rather than a route, `security-map.md` names it, and
it should not be moved as part of a mechanical sweep.

**One standing gap, agreed with 260907b on 2026-09-07 — a queue line, not a stage.** No new
per-domain lifetime oracle is needed for a migration: Sol ruled it is once, not per domain, and the
decomposition holds. Lifetime risk lives in exactly two places, and both are covered — inside the
handler body, where the normalised body diff catches `await` → `void` (they are different tokens and
none of the normaliser's four transforms touches them), and in the dispatcher's await, which is
shared machinery the referee slice already tested. The referee oracle is not a migration artefact:
it tests a pre-existing lifetime property nothing tested, and was worth writing whether or not
referee ever moved. The migration was the occasion, not the reason.

What is left over is real. **The body diff proves a move and then evaporates** — it is a one-off
script, not a standing test. `assertHandlersAwaited` cannot close it: it calls
`findFunction(statements, TABLE_DISPATCHER)` and walks only `dispatchAuthRoute`'s own body, so it is
blind by construction to a `void` inside a row's handler closure. That is not a defect in the check;
it answers a different question. But it means a moved domain has **no standing guard** against a
future dropped `await` in a row handler, and referee has one only incidentally.

The cheap shape, if someone takes it deliberately: **a static assertion that no promise-returning
call inside any `AUTH_ROUTES` handler body is left un-awaited** — the same AST machinery the contract
reader already has, and no database. Do not build it during a migration.

### The ruling was narrowed at 23:40, and `chat` needs an oracle after all

260907b put the sharper question to Sol — is *"once, not per domain"* **safe**, or was `searches`
merely lucky? The ruling holds only as an argument about a **verified verbatim** move, and search's
runtime coverage is **incidental and does not generalise**. Asked which domains would redden on a
dropped `await`, Sol found four that would not. **One is inside the `chat` slice.**

**`DELETE /api/chat/:slug/:threadId` holds a lock and has no server-side test.** Verified here on
2026-09-07: `src/routes.ts:8449` is
``threads: await inTurnOrder(`${slug}/${id}`, () => chatStore.remove(slug, id))``. Drop that `await`
and the response reports the thread deleted while the deletion is still in flight. Nothing catches
it — `tests/turn-order.test.ts` states in its own header that it does not check the routes use the
lock, and says why (a test that tried **passed with the lock removed**, which is worse than no test);
`tests/chat-delete-live-turn.test.ts` and `tests/api-fetch-offline.test.ts` are `jsdom` client tests
with a stubbed `fetch`; the only other hit is the static contract reader. **So the `chat` slice opens
with a red-first server-side oracle for thread DELETE, before the guards move.** Chat POST does
*not* need one: `tests/chat-route.test.ts` awaits `handleApi` and requires frames plus stored rows.

Three more gaps, for whoever takes those slices: `POST /api/comments/:slug/:id/answer` (SSE plus the
`answering` registry; the only HTTP test is a pre-stream 409 at `routes.test.ts:1400`),
`similar`/`projection` (paid single-flight in `INFLIGHT`, linked by `return withSpendAttribution(…)`
rather than an `await`, so the equivalent mutation is `return` → `void`), and
`GET /api/link-summary` (SSE plus a database single-flight claim).

### The `return;` model in this doc was wrong

Both sessions had it backwards, and Sol corrected it. A **retained** early return in a table handler
does not fall through — `dispatchAuthRoute` returns `true` after the handler either way. **The
dangerous transformation is the opposite one: *removing* a return, so later statements in the same
handler execute.** The normaliser should therefore **refuse automatic comparison** whenever a guard's
own function scope holds any return other than exactly one final argumentless `return;` (nested
function returns excluded) — the same principle as "more than one is a fact to fail on".

That rail fires on **chat GET**, which has two returns where every other chat guard has one. That is
the point: it forces the one case that needs a human to look at it, rather than passing twelve.

Two corrections to carry forward, both from Sol:

- **`quizMark` streams.** It calls `markOneAnswer`, which writes its own headers and ends the
  response (`:7914`). So the `ideas/quotes/timeline/quiz/debate/quizMark` block is *not* the cheap
  non-streaming one it looks like, and whoever takes it needs the Stage 1 instrument. My first draft
  had this wrong.
- **`glossary/lookup/askTerm` is the genuinely cheap one**, and it is cheap for a reason worth
  writing down: its `/api/glossary/` namespace is literal, so disjointness from every intervening
  route can be argued **exhaustively** rather than inferred from the contract test's finite corpus.
  If a future session wants a slice out of queue order, that is the one with a real argument
  available — at the cost of the suffix invariant discussed above, which is a trade to make
  deliberately and record, not to slip past.

## The simpler option I passed over

**Stopping at Stage 1.** The lifetime test is valuable whether or not a single guard ever moves: it
covers a streaming route that today has no coverage of its stream's lifetime or its lock's release,
and it closes the gap 260907b wrote down against itself.

I am not stopping there because the brief asked for a slice to *move*, and because a test written to
enable a move and then not used to make one is how this file got deferred three times. But if the Sol
review finds Stage 2 unsafe, Stage 1 alone is a defensible finish, and the queue above is the
handover either way.

The other simpler option — **take a cheap non-streaming domain and accept the reorder** — is rejected
in § *The slice, and the four I rejected*. It would have been a faster night and a weaker claim.

## The code review, and the rail that could have stopped holding

[GPT Sol's review of the whole built change](260907e-referee-joins-the-route-table-code-review-sol.md)
([prompt](260907e-referee-joins-the-route-table-code-review-prompt.md)):

> **the route move itself is behavior-preserving.** I found no runtime difference in the eight
> handlers, matchers, capture handling, dispatch order, or stream lifetimes.

Checked item by item on its side: all five regexes character-for-character identical; the eight rows
prepended above jobs in guard order; every slug capture still `slugPart(captures, 1)` with `part`
only for criterion ids; `EXPECTED_AUTH_ROUTES` hashing identically; thirteen exported names
unchanged; the scan test's new regex cutting exactly the scan handler; and **no remaining source
reader that expects these guards in the chain**.

Two findings, both fixed:

- **P1 — my `requireUser` rail could silently stop checking.** It located the handoff with
  `source.indexOf("serveAuthenticatedApi(user")`. If that text is ever reformatted or the parameter
  renamed, `indexOf` returns `-1`, `slice(0, -1)` makes the "handoff" the end of the file, and the
  ordering assertion passes while checking nothing. I wrote a security rail with a silent-success
  hole in it, in the same change where I wrote about silent success twice. Now both the gate and the
  handoff are found as **call nodes inside the `serveApi` declaration**, the test refuses rather than
  skips if `serveApi` stops being a function declaration, and the "inside `serveApi`" half of its own
  title is actually asserted. **Mutation 7** proves the fix on exactly Sol's scenario: the gate folded
  into a reformatted multi-line handoff — which the old version would have passed — now fails with
  *"expected 6413 to be less than 6412"*.
- **P2 — comments describing the pre-move arrangement**, and one of them is *operational*: the table
  docstring said thirteen guards and told the next slice to go above the jobs rows. It now says
  twenty-one and points above referee. Also corrected: the "fourteen shared matchers" count, which
  was already stale before tonight and is now **removed rather than re-numbered**, because a count
  that decays once per commit is a comment that will be wrong more often than right; the contract
  test's header, which omitted referee and described `assertHandlersAwaited` as preventing a stream
  from outliving its request — it does not, and mutation 4 measured that, so the header now says so;
  and this file's own preamble, which still called referee "next".

Sol's one methodological caution is fair and worth carrying: **the normaliser is supporting evidence,
not proof.** It collapses whitespace without token awareness, so it could in principle erase a
difference inside a string literal or at an ASI-sensitive newline. It read the raw diff and confirmed
only the permitted substitutions — that, not the empty diff, is the load-bearing check.

## A second session did this same slice tonight

While this was being built, `worktree-api-dispatch-by-domain` — the session whose plan handed me this
queue — came back to referee and wrote **`tests/streaming-route-request-lifetime.test.ts`**, which is
the same instrument as `tests/referee-stream-lifetime.test.ts` for the same route, from the same Sol
finding. It landed on `dev` at "Stage 4a" while my stages 2 and 3 were in review.

Two people built the prerequisite; nobody built it twice by accident of ignorance — 260907b named it
publicly and we both read it. **Their test passes unchanged against the moved routes** (verified
here, 13 files / 616 tests green together), which is itself corroboration: two independently written
lifetime oracles agree that the move preserved the lifetime.

**Resolved, 2026-09-07 21:30 — by them, which is the right way round.** 260907b merged `dev`, found
the end states matched to the row, and **removed `tests/streaming-route-request-lifetime.test.ts`** in
favour of this one, on the grounds that it covers all three streaming routes rather than criteria
alone and asserts lock *release* as well as holding. So the reference above is to a file that no
longer exists on `dev`; it is kept here because deleting it would hide the episode, which is the part
worth remembering.

The judgement was deliberately left open above rather than made unilaterally, because folding two
files into one is a change to somebody else's committed work and a conflict is a proposal before it
is an edit. The owner making the call from their side is exactly the resolution that rule is for.

Two things their merge turned up that outlive this slice:

- **The merge was clean and the file was wrong.** Both sessions had added the same eight rows in
  places whose text did not collide, so git took *both* — 29 rows where there should be 21, every
  referee route declared twice — and marked only five hunks of comment wording as conflicts. The
  contract test caught it seven ways. **After any merge that touches `src/routes.ts`, run
  `tests/authenticated-api-route-contract.test.ts` immediately rather than trusting a clean merge.**
- **A "pick the match" extractor hides a mutation.** Their first AST rewrite of the scan-route
  extractor kept whichever matching row came *last*, so with the block duplicated it inspected copy
  two while the mutation sat in copy one, and went green. It now refuses more than one match
  (`tests/referee-scan-route.test.ts:393`). "More than one" is a fact to fail on, not one to resolve
  by picking — [silent-success.md](../reusable/silent-success.md).

The duplication itself is a coordination failure worth its own line in the next sweep, not a defect
in either file. Neither of us announced before starting, and both of us had read the same public
queue. The fix is one message: 260907b asked before taking the next slice, and that cost nothing.

## The baseline, so a later red is attributable

Measured on this worktree at `eedae885`, **before any change**, with
`npm test -- --reporter=dot` on the six files this work touches or is judged by:

> `tests/routes.test.ts`, `tests/owner-isolation.test.ts`, `tests/public-dto.test.ts`,
> `tests/authenticated-api-route-contract.test.ts`, `tests/referee-scan-route.test.ts`,
> `tests/referee-criteria-routes.test.ts`
>
> **6 files passed, 562 tests passed, 44.15 s, EXIT=0.**

So any red in these files after tonight is mine, not the box's. `doc-links` was red on `dev` from
another session's in-flight plan doc when this started and is not mine; the full suite is 21 minutes
and is run once at the end, and a red batch is re-run file-by-file before it is believed, because
this box goes red from contention.

## Open questions, and the assumptions I am proceeding on

No one is awake to ask, so these are decisions with their reasoning attached rather than questions.

1. **Is adding to the table the right reading of a brief that says "no route table"?** I have assumed
   yes — see § *The one instruction in the brief I am not following*. This is the one thing in this
   plan I would most like a human to overrule cheaply, and Stage 1 is where that is cheap.
2. **Does the `refereeing` lock need to be observable to a test at all, or is the GET-sweep route
   enough?** Assumed enough. Exporting the `Set` for a test would be a second way to answer a
   question the existing route already answers, and the route is the way a reader observes it.
3. **Three worktrees carried unmerged `routes.ts` edits when 260907b was written**
   (`delete-article-permanently`, `critiques-mode`, `a1-a3`). Any of them may conflict here. A
   conflict is a proposal to show Greg, not an edit I resolve unilaterally —
   [git-resolve-merge-conflicts.md](../reusable/git-resolve-merge-conflicts.md). If one lands on
   referee specifically, I stop and record it rather than merging over it.
4. **`npm test` is 21 minutes and this box goes red from contention.** I run the affected files
   individually per stage and the full suite once, at the end; a red batch is re-run file-by-file
   before it is believed.
