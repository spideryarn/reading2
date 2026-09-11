# Close the route transition: the last 33 guards join the table

The last stage of the `AUTH_ROUTES` migration. **33 guards** were left in
`serveAuthenticatedApi`'s `if` chain after 260911c. This stage moves all of them, bottom-up, in four
contiguous slices, one reviewed commit each. Then it makes the contract test require an empty chain
and deletes the chain reader nothing needs any more.

The umbrella plan is
[260907b-split-the-authenticated-api-dispatch-by-domain.md](260907b-split-the-authenticated-api-dispatch-by-domain.md).
The recipe is [260908a](260908a-chat-and-live-sessions-join-the-route-table.md)'s, and the two slices
before this one are [260911b](260911b-comments-join-the-route-table.md) and
[260911c](260911c-paid-single-flight-joins-the-route-table.md). **Read 260911b first.** This doc
says only what is different here. Commissioned as cluster G's third stage, "close the transition",
of [260908f-prioritised-spideryarn-codebase-improvements.md](260908f-prioritised-spideryarn-codebase-improvements.md)
§ G, dispatched by the Overseer on 2026-09-11 (queue item `qi-ybjeyfpq`).

> **Status, 2026-09-11: in progress.**

## Claimed, and the count re-measured

No plan or live worktree named any of the 33 after 260911c. `src/routes.ts` at `6bc0c60a` (dev,
merged by `worktree:setup`) has 49 rows in `AUTH_ROUTES` and **33 guards** in the chain, from
`adminUsers` to `quizMark`, against the contract test's `EXPECTED_GUARD_COUNT` of 82. No route has
arrived since 260911c. The verifier's `before` capture found all 33 and the rail refused none: each
ends in exactly one argumentless `return;`.

## The order: bottom-up, which is not the order the brief listed

The brief listed the glossary guards first, then `ideas` … `quizMark`, then the article block. It
also said "bottom-up, as the design says", and the two disagree. In the chain the six from `ideas`
to `quizMark` sit **below** the four glossary guards:

```
  … article block (9) …   tweets
  glossary GET, glossary DELETE, lookup POST, askTerm POST
  ideas, quotes, timeline, quiz, debate GET, quizMark POST      ← bottom of the chain
  [table dispatch]
  404
```

Only a bottom suffix keeps every route at the position it already had (the table's header comment,
and Sol's stage 3a review, P2-STAGE3B-ORDER), so the design wins: **`ideas` … `quizMark` first**,
then glossary, then the article block, then the fourteen at the top. The lifetime checks the brief
asked for before the glossary move are written before any move, so the order changes nothing about
what is proved.

| Slice | Guards | Streams or pays | Lifetime oracle |
|---|---|---|---|
| 1 `ideas` … `quizMark` | 6 | `quizMark` (SSE, paid) | `tests/quiz-mark-stream-lifetime.test.ts`, new |
| 2 glossary | 4 | `lookup`, `askTerm` (SSE, paid, both since 2026-09-10) | `tests/glossary-stream-lifetime.test.ts`, new |
| 3 article block | 9 | `linkSummaryRoute` (SSE, paid) | `tests/link-summary-stream-lifetime.test.ts`, 260911c |
| 4 the top | 14 | `transcribeRoute` (paid) | § *Slice 4* |

## Stage 1 — the oracles, red first against the chain

Two new files, both written against the guards **still in the chain**, both driving `handleApi` by
method and path and reading nothing of the route's source, so the moves must need no edit to them.
The harness is 260911c's link-summary oracle: a gated stub generator, a request started and not
waited for, and a handshake that fails fast, with *"the request settled before the stream was
entered — launched rather than awaited?"*, if the request answers before the stub is reached. Both
are in the `private-postgres` lane with a `static-only` `STORE_MIGRATION` verdict, as 260911b's was.

- `tests/quiz-mark-stream-lifetime.test.ts` stubs `markAnswerStream` over a quiz seeded with the
  real `buildQuiz`. One case holds the request open, then ends with `["done"]`. The other fails
  mid-answer, and the `error` frame is written and the response ended **before** the request
  settles.
- `tests/glossary-stream-lifetime.test.ts` stubs `explainStream`, handing out gates by the term the
  stream was asked about, so an orphaned stream from one route's mutation cannot take the other
  route's gate. The G1 and G2 runs show that working. The same two cases for each route. The lookup's
  success case also reads the answer back from `glossary_lookups`, because `done` is promised only
  after the save.

Each failure case checks the response's state **at the moment the request settled**, recorded by
`begin()`, not afterwards. A response ended just after settling cannot pass.

Green unmutated: quiz **2 of 2**, glossary **4 of 4**. Each mutation was applied alone to
`src/routes.ts`, the file run, and the source restored. `git diff --stat HEAD -- src/routes.ts` was
empty afterwards.

| Mutation | Result | Subject message |
|---|---|---|
| **Q1**: `quizMark` guard `await withSpendAttribution(` → `void …` | **2 failed of 2** | *the request settled before the stream was entered — launched rather than awaited?* (nothing written) |
| Q2: `frame("error", …)` deleted from `markOneAnswer`'s catch | **1 failed of 2** | *expected [] to deeply equal [ 'error' ]* |
| **G1**: `lookup` guard, the same | **2 failed of 4**, both lookup's; asked-term green | the handshake message |
| **G2**: `askTerm` guard, the same | **2 failed of 4**, both asked-term's; lookup green | the handshake message |
| G3: `frame("error", …)` deleted from `streamTermLookup`'s catch | **1 failed of 4** | *expected [] to deeply equal [ 'error' ]* |
| G4: `res.end()` deleted from `streamAskedTerm`'s finally | **2 failed of 4** | *the response was still open when the request settled* |

Under Q1 and one G1 run vitest also reported an unhandled rejection. That was the launched stream
failing after `afterAll` had removed the article, which is the "lands nowhere" the oracle is about.

`GET /api/link-summary` already has its oracle from 260911c. `POST /api/transcribe` is paid but does
not stream: its body is `send(res, 200, await transcribeDictation(req, res))`.
`tests/request-spend.test.ts` already drives it through `handleApi` and asserts the ledger row is
written before the request finishes. Its evidence is in § *Slice 4*.

## The moves

The verifier is [260911d-verify-move.mjs.txt](260911d-verify-move.mjs.txt), 260911c's with three
changes stated in its header: all 33 guards listed by slice, exact (`path:`) rows, and the
`= <matcher>;` destructure the two admin bodies use added to the targeted rename.

The rows were generated by a script that, for each slice, cut the guards (each with the comment
block directly above it) and their matcher declarations (each with its comment), dropped each
trailing `return;`, applied the targeted rename, and prepended the rows in chain order. A matcher
two rows share became a module constant beside `ONE_COMMENT_PATTERN`: `GLOSSARY_PATTERN`,
`SHELF_ENTRY_PATTERN` and `READER_PATH`.

**Review, changed mid-stage by the Overseer.** The brief asked for a findings-only Sol review per
commit. Part-way through slice 1 the Overseer changed that, because the ChatGPT subscription that pays
for Sol was at 85% of its weekly window: **one** findings-only Sol review at the end, over the
combined diff, with Fable to arbitrate any P1 that cannot be settled here. Each slice is still
committed and pushed as it lands, so the review reads commits that are already on `dev`, and
anything it finds is fixed in a follow-up commit.

### Slice 1 — `ideas` … `quizMark`

Six guards, the bottom of the chain, each matcher used once, so each pattern is a literal in its
row. Verifier: all six `identical`, *the move is a move*.

**Red first**: with the six moved and no test touched, **2 failed of 344**. They were the contract
test's *answers the moved domains from the table* and *keeps the table in the chain's order*, the
two expectations every slice edits. `tests/cacheable-covers-artefact-routes.test.ts` stayed green:
since 260911c it reads a `GET` row as a route, and the five artefact kinds here resolve through it.
Edits: both pair-key lists gain the six, the five prefixes join `moved`, and the control moves from
`/api/quiz` to `/api/glossary`.

**Mutation 5**, `await` → `void` in the **moved** `quizMark` row: the quiz oracle **2 failed of 2**
at the handshake, and the contract test **323 passed**. The syntax tripwire still cannot see a
launched promise inside a row; that is now measured on a fifth domain. The verifier diffed clean
after the revert.

Comments outside bodies: the arc row's *"like the ideas GET in the chain below"* now says *"the ideas
row above"*. The table header, the dispatch-site comment and the chain's *"matchers used to be declared
here"* note were updated. The last names `askTerm` as the chain's last guard. The quiz declaration's
*"`mark` below"* is still true in the table.

Focused set: the contract test, `cacheable-covers-artefact-routes`, the quiz oracle,
`quiz-mark-route`, `routes`, `owner-isolation`, `public-dto`, `store-migration-registry`,
`fixture-ids` and `arc-freshness`. **10 files, 599 tests, green.** `npm run typecheck`: exit 0.

### Slice 2 — the glossary

Four guards. `glossary` GET and DELETE share a matcher, which is now `GLOSSARY_PATTERN`, with its
declaration comment above it. Verifier: all four `identical`.

**Red first: 4 failed.** The contract test's two slice expectations, and two in
`cacheable-covers-artefact-routes`: *resolves every artefact kind …* naming exactly `glossary`, with
*finds the artefact routes that are already cached* as its consequence. That test's table reader
matched a row by its spelled-out pattern, and the glossary GET row says `pattern: GLOSSARY_PATTERN`.
It is the loud failure 260907b constraint 8 built the test to give, and the first time a *shared*
artefact matcher has moved. **The fix**: a row may also name the top-level `const` that holds the
pattern. **Watched**: the glossary GET row's method changed to `PUT` → *"an artefact kind changed
sides"*, then restored.

Comments outside bodies: the constant's *"same reasoning as the thread's"* named a declaration that
sat just above it in the chain, and now says *"the tweet thread's route"*. The lookup row's *"the
rule above"* now names `GLOSSARY_PATTERN`. The ask row's *"`lookup` above"* is still true. The
contract control moves from `/api/glossary` to `/api/article`.

**Mutation 5**, `await` → `void` in each moved row, one at a time. `lookup`: glossary oracle **2
failed of 4**, both lookup's. `askTerm`: **2 failed of 4**, both asked-term's, with the contract
test green beside it (**325 passed** of the 327 run together). The verifier diffed clean after the
reverts.

Focused set: the contract test, `cacheable-covers-artefact-routes`, the glossary oracle,
`glossary-asked-term-stream-route`, `glossary-lookup-stream-route`, `glossary-delete-then-rebuild`,
`glossary-lookup-refusals`, `route-profile-concurrency`, `routes`, `owner-isolation` and
`public-dto`. **11 files, 606 tests, green.** Typecheck: exit 0.
