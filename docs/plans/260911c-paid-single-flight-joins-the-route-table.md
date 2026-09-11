# The paid single-flight block joins the route table, and link-summary gets its oracle

The eighth slice of the `AUTH_ROUTES` migration: **six guards**, `sketch` down to the two routes
that pay for embeddings, `similar` and `projection`. They were the bottom of
`serveAuthenticatedApi`'s `if` chain once Comments moved. Also here: the oracle the article slice
will need for `GET /api/link-summary`. It is written and watched red now, and the article guards
are **not** moved (§ *Why the article slice does not move here*).

The umbrella plan is
[260907b-split-the-authenticated-api-dispatch-by-domain.md](260907b-split-the-authenticated-api-dispatch-by-domain.md).
The recipe is [260908a](260908a-chat-and-live-sessions-join-the-route-table.md)'s, and the slice
before this one is [260911b-comments-join-the-route-table.md](260911b-comments-join-the-route-table.md).
**Read 260911b first.** This doc says only what is different here. Commissioned as cluster G's
second stage of
[260908f-prioritised-spideryarn-codebase-improvements.md](260908f-prioritised-spideryarn-codebase-improvements.md)
§ G, dispatched by the Overseer on 2026-09-11 (queue item `qi-fgft5jr5`).

> **Status, 2026-09-11: built.** Both oracles written and watched red first, six guards moved,
> contract and artefact-cache tests updated. GPT Sol's review is § *The review*.

## Claimed, and the count re-measured

No plan or live worktree named `sketch` … `projection` or link-summary after 260911b. `src/routes.ts`
on `dev` at `e7eea740` still had all six guards at the bottom of the chain. The contract test's
`EXPECTED_GUARD_COUNT` is 82, with 43 in the table and 39 guards left in the chain (enumerated from
the chain's `if (<matcher> && req.method …)` lines). **After this slice, 49 are moved and 33 remain.**

## The slice

In the order the chain had them, immediately above the table's dispatch:

| # | Guard | Matcher | Notes |
|---|---|---|---|
| 1 | `sketch` GET | `/api/sketch/:slug` | `withProfileChanged` |
| 2 | `illustrated` GET | `/api/illustrated/:slug` | `withProfileChanged` |
| 3 | `illustratedPlate` GET | `/api/illustrated/:slug/:hash.(jpeg\|png)` | serves bytes; `part` on the hash and extension |
| 4 | `arc` GET | `/api/arc/:slug` | |
| 5 | `similar` POST | `/api/similar/:slug` | **pays**, and `return`s `withSpendAttribution(…)` |
| 6 | `projection` POST | `/api/projection/:slug` | **pays**, and `return`s `withSpendAttribution(…)` |

The guard above the block is `quizMark` POST. Nothing between it and the dispatch matched any of
these paths. **The block is contiguous and at the bottom**, so prepending the six above the comments
rows puts each one where it already was. As in every slice, the ordering argument holds by
construction.

**The gate stays where it was.** `requireUser` is untouched. `slugPart` moves with the bodies for
each slug, and so does `part`, for the plate's hash and extension. Those two are only ever compared,
never joined into a path. The body diff is what stops a `part` becoming a `slugPart`.

## Stage 1a — the oracle for `similar` and `projection`

260908a § *The queue after this slice* and 260908f § G named this gap. Neither guard awaits. Each
**returns** the spending from an inner block, so the mutation that can see a launched promise is
`return` → `void`. A mutation that only drops an `await` sees nothing here, because there is no
`await` to drop. 260908f also says to "preserve the `INFLIGHT` lock through settlement". Here that
means the request must stay open until the single-flight promise has settled, and not merely until
it has started.

`tests/paid-single-flight-lifetime.test.ts` has four cases, two per route, written against the guards
**still in the chain**. `embedAll` is stubbed with a queue of behaviours, handed out in order: a gate
that signals it has been reached and holds until the case releases it, or a failure to throw. A
call that finds nothing queued throws, so a second embedding nobody expected fails loudly.
`similarBlocks` and `projectArticle` are wrapped in counting pass-throughs. The real functions run,
`INFLIGHT` included. The counter lets a case wait until the second reader has actually reached the
single-flight map, rather than guessing with a timer.

| Case | What it asserts |
|---|---|
| holds the request open …, and a second reader joins the one being paid for | first held: not settled, not ended. Second reader reaches the map and is not answered while the first pays. On release both are 200 with byte-identical bodies, after **one** embedding |
| a provider failure reaches the reader as the route's own answer | `EmbeddingFailure("provider")` → 502 through `serveApi`'s catch, the response ended |

The failure case covers the half of the lifetime a success cannot show. A launched promise's
rejection lands nowhere, and the request has already been answered, or never is.

### Stage 1a, as built — the mutations, watched

Green unmutated: **4 passed of 4**. Each mutation below was applied alone, the file run, and the
source restored. The runner checked that the restored bytes were identical.

| Mutation | Result |
|---|---|
| **M1s, the subject**: `similar`'s `return withSpendAttribution(` → `void …` (chain) | **3 failed of 4.** The subject: *"the request settled before the embedding was entered — launched rather than returned? 404"*. In the chain a launched guard falls through to the terminal 404. The failure case: *expected 404 to be 502*. Collateral: projection's held case, because similar's orphaned embedding took its gate |
| **M1p**: the same in `projection` (chain) | **2 failed of 4**, both projection's, with the same two messages |
| M2s: `if (flying) return flying;` deleted from `similarBlocks` | **4 failed of 4.** The subject: *"the second reader was answered before the first embedding finished"*. The second reader bought its own embedding, found no gate and 500'd. The rest is collateral |
| M2p: the same line deleted from `projectArticle` alone | **4 passed — predicted, and it is a finding.** Projection has two single-flight maps. `articleVectors` (src/article-vectors.ts) has its own `INFLIGHT`, so the second reader still joins the *embedding*. Only the 290 ms of arithmetic is duplicated, and no money is. |
| M2p + M3: that line deleted from **both** `projectArticle` and `articleVectors` | **2 failed of 4**, both projection's: *"the second reader was answered before the first embedding finished"* |

M2 and M3 are not the migration's risk, because nothing in the move touches `src/similar.ts`,
`src/projection.ts` or `src/article-vectors.ts`. They are here so the case's single-flight claim has
been seen failing on the single-flight. M2p is recorded because it is the case a later reader would
otherwise take for a weak oracle.

## Stage 1b — the oracle for `GET /api/link-summary`, ahead of its slice

`tests/link-summary-stream-lifetime.test.ts` has two cases, written against the guard in the chain.
260908f requires that **the claim be the real one**: `linkSummaryStore.claim`, `fill` and the
reader's allowance all run against the local database lane. Only the model (`openRouterStream`) and
the one preview it reads are stubbed. The preview is stubbed for a reason that matters.
`tests/link-preview-cache.test.ts` empties the ownerless `link_previews` table between its cases,
and the private lane runs files in parallel against one database. A seeded preview row would race
that file.

The stubbed stream sends a first sentence, signals, holds, then ends the way a complete response
does: `[DONE]` seen and a `stop` reason. `classifyEnd` requires both before a summary may be stored.

| Case | What it asserts |
|---|---|
| holds the request open until the summary is written | held: not settled, not ended. Released: the terminal frames are exactly `["ready"]` |
| a second hover while the first is streaming is told pending by the claim, and buys nothing | the second request settles with `["pending"]` while the first is still held. After release the first ends with `ready`, a third hover is `ready` from the stored row, and **one** model call was made across all three |

### Stage 1b, as built — the mutations, watched

Green unmutated: **2 passed of 2**.

| Mutation | Result |
|---|---|
| **L1, the subject**: the guard's `await streamLinkSummary(…)` → `void …` | **2 failed of 2**, *"the request settled before the model was reached — launched rather than awaited?"* with nothing written. The guard's own `return;` then exits with no response at all |
| L2: `if (claim.kind === "pending") return yield …` deleted from `linkSummaryStream` | **1 failed of 2**: *"a hover that should have waited or read the row called the model: expected 2 to be 1"* |

**L2 is the reason the case counts model calls instead of trusting the frame.** Under L2 the second
hover still ends with `pending`. It goes on to call the model, the stub has no gate for it and
throws, and the route's own failure path frames that as `pending`. An assertion on the frame alone
would pass with the claim gone.

### Why the article slice does not move here

The brief named "paid single-flight **and** article/link-summary slices". The article guards
(`article`, the two link routes, `visibility`, `source`, `asset`, `exportBundle`, `metadata`,
`tweets`) are **not at the bottom of the chain**. The four glossary guards and the six from `ideas`
to `quizMark` are below them. The design that landed takes the chain bottom-up, because only a
bottom suffix keeps every route at the position it already had (the table's header comment, and
GPT Sol's stage 3a review, P2-STAGE3B-ORDER). Moving the article block now would be a reordering.
It would be safe only by the disjointness argument, which is "a corpus check over a hand audit, not
a proof". So this stage writes the article slice's oracle, which is the part that must come first,
and leaves the move for when the ten guards below it have gone. Those ten belong to the later
"close the transition" stage, which this brief says not to start. **The question for Greg is in
§ *Open*.**

## Stage 2 — the move

The verifier is [260911c-verify-move.mjs.txt](260911c-verify-move.mjs.txt), a copy of
[260911b's](260911b-verify-move.mjs.txt) with the guard list changed and **one thing changed**:
the wording of a refusal. `similar` and `projection` are the first guards this verifier refuses
for *carrying a value*. The parent quoted everything from `return` to the next `;`, which for these
two runs through a whole comment, so the accounted-for reason would have been a paragraph of prose.
The reason is now `return <callee>(…)`, and it is still compared exactly.

The rows were generated by a script that cut the six guards (checked contiguous: the region after
`quizMark`'s closing brace held the six and nothing else) and the six matcher declarations
(contiguous between `debate` and `source`). It dropped each trailing argumentless `return;`,
applied the targeted `slugPart(<m>,`/`part(<m>,` rename, and prepended the rows in chain order.
Every pattern is used by one row, so every one is a regex literal in its row, and no constant was
added. The targeted rename matters here as it did for `comments`: `found.sketch` and
`found.illustrated` name the matcher's word as a property, and a global rename would have corrupted
both without the body diff seeing it.

### Stage 2, as built — the purity evidence

The before capture is reproducible from `HEAD`.

```
identical             sketch GET               187 chars
identical             illustrated GET          202 chars
identical             illustratedPlate GET     85 chars
identical             arc GET                  53 chars
identical             similar POST             278 chars
  ↳ rail refuses: the return carries a value: `return withSpendAttribution(…)` — needs the evidence named in the plan
identical             projection POST          266 chars
  ↳ rail refuses: the return carries a value: `return withSpendAttribution(…)` — needs the evidence named in the plan

the move is a move
```

**The two refusals are accounted for by behaviour, not by argument.** This is mutation 5, the
acceptance test for the move: `return` → `void` in the **moved** rows.

| Mutation | `paid-single-flight-lifetime` | contract test |
|---|---|---|
| M5s: `similar` row | **3 failed of 4**. The subject: *"settled before the embedding was entered — launched rather than returned? 0"*, meaning nothing was written. The failure case: *"nothing answered the reader"*. Vitest also reported the launched promise's 502 as an unhandled rejection | **323 passed** |
| M5p: `projection` row | **2 failed of 4**, the same two messages | **323 passed** |

The syntax tripwire (`assertHandlersAwaited`) still does not see a launched promise inside a row.
That has now been measured on a fourth domain.

**Comments outside handler bodies** are not covered by the verifier, so a person read them. Each
was moved above its row, and the three whose positional words the move falsified were edited:

- *sketch*: "GET only, like the four reads around it" became "… like the artefact reads still in the
  chain below". The declarations it sat among are no longer around it.
- *arc*: "Read only, like the ideas above" became "like the ideas GET in the chain below". The same
  comment's "unlike the two above" is still true (`sketch` and `illustrated` rows), so it was kept.
- *similar*: "what the `tweets` note above refuses to do" became "the `tweets` note in
  `serveAuthenticatedApi`".
- Two comments in the chain named `illustratedPlate`, an identifier that no longer exists. These
  were the `asset` matcher's "for `illustratedPlate`'s reason above" and the `asset` guard's "the
  same shape `illustratedPlate` uses below". Both now name the illustrated-plate row in
  `AUTH_ROUTES`.
- The table header, the dispatch-site comment and the chain's "matchers used to be declared here"
  note now include this slice. The last *guard* is `quizMark`, so the next slice up is
  `ideas` … `quizMark`.

In-body comments move verbatim. Two positional phrases inside the bodies are still true in the
table: `similar`'s "`projection` twenty lines below", and `illustrated`'s "like `sketch` above".

## Stage 3 — the checks, red first

With the six moved and no test touched: **3 failed**. The failures were the contract test's two
expectations F1 of 260908a named (*answers the moved domains from the table*, *keeps the table in
the chain's order*), and
`tests/cacheable-covers-artefact-routes.test.ts` § *resolves every artefact kind to a route*, naming
exactly `arc`, `illustrated` and `sketch`. That third red was predicted in 260907b § [TEXT]: the
source reader finds a route through `const <binding> = <pattern>.exec(path)`, and a moved route has
no such `const`. `EXPECTED_AUTH_ROUTES` needed no edit, which is the evidence that no route's
identity changed.

Hand edits:

1. The contract test: both pair-key lists gain the six, prepended above comments in chain order.
   `/api/sketch`, `/api/illustrated`, `/api/arc`, `/api/similar` and `/api/projection` join
   `moved`. None of them is a prefix of a remaining chain path: `/api/arc` is not in
   `/api/article`. **The control is repointed** from `/api/projection` to `/api/quiz` (`quiz` GET
   and `quizMark`, the bottom of the next slice). Two comments about `armTerminates` descending
   into `similar`/`projection` now say they were guards.
2. `cacheable-covers-artefact-routes`: a route is now found in either form. It can be the chain's
   `const` plus its `if`, or a table row whose `method: "GET"` and `pattern:` sit on consecutive
   lines. The method is part of the match, so a `POST` row for the same pattern is not counted as a
   read. The row is its own dispatch. A new case refuses a kind found in both forms. **Watched**:
   the `arc` row's method changed to `PUT` → *"an artefact kind changed sides … expected [ 'arc',
   … ]"*, and 20 tests where there were 21, so the partition names the lost kind rather than
   shrinking.

Green: the contract test **323 of 323**, the artefact-cache test **21 of 21**. The focused set was
the paid oracle (the link-summary one did not exist yet; it was run on its own, § *Stage 1b*), the contract, `routes`, `owner-isolation`, `public-dto` (the three the security map
calls the specification), `cacheable-covers-artefact-routes`, `embedding-route-failures` (its
file-wide `throw embeddingHttpError(` count is still 2), `illustrated-route`, `illustrated-plate`,
`store-migration-registry`, `fixture-ids`, `similar`, `projection`, `comment-answer-stream-lifetime`
and `arc-freshness`. **15 files, 677 tests, green**, counted against the 15 paths passed.

## Where the file stands

| | Lines | Complexity of `serveAuthenticatedApi` |
|---|---|---|
| before this slice | 8,813 | 110 (260911b, same file) |
| after it | **8,844** | **98** |

Thirty-one lines longer and twelve points simpler. That is not an acceptance metric (260908f § G).

## What this slice is not doing

- **Not moving the article block**, for the ordering reason above, and not moving the ten guards
  below it, which belong to the "close the transition" stage.
- No handler rewrites, no router dependency, no file extraction.

## Open

- **Greg's call: how the article/link-summary move gets scheduled.** The move needs the four glossary
  guards and the six `ideas` … `quizMark` guards to go first. They are covered on the existing
  recipe, but `lookup` and `askTerm` have streamed since 2026-09-10, after Sol's 09-08 coverage
  survey, so they need the same check. Either the next G stage takes them, then the article block
  with its oracle already written, or the article block moves out of order on the disjointness
  argument. The design's rule is bottom-up.

## The review

[260911c-code-review-sol.md](260911c-code-review-sol.md), GPT Sol (high, `workspace-write`),
2026-09-11, against the uncommitted slice; prompt
[260911c-code-review-prompt.md](260911c-code-review-prompt.md). The run log confirms a nested
`gpt-5.6-sol` exec. **Verdict: approve with one P2 fixed; no code blocker.** Sol re-ran the verifier
(byte-identical captures, a pure move) and recounted 49 rows and 33 guards against the 82. It
confirmed that the positional comment edits, `/api/quiz` as the control and the deferred article
move are right, and that the paid oracle's poll is sound under run-to-completion: nothing in
`similarBlocks` or `projectArticle` awaits before the map is consulted.

- **P2, fixed by Sol, checked here.** The finding I asked it to try hardest on was real. The route
  frames a *thrown* `linkSummaryStore.claim` as `pending` too, so the second hover's `pending` frame
  and one model call could both pass without Postgres ever answering `pending`. Sol wrapped the real
  claim in a pass-through that records the kind it returned. The case now requires exactly
  `claimed`, then `pending`, and no third claim for the stored read. Re-run here after the fix:
  green **2 of 2**. L1 is still **2 failed of 2** at the handshake, and L2 still **1 failed of 2**
  on the model-call count. Under L2 the claim sequence passes, because the claim really did say
  `pending`. It is the count that catches the dropped exit, as designed.
- **P3, fixed here.** This doc's focused-set paragraph named a sixteenth file (the link-summary
  oracle, which did not exist at that run) against "15 files". Corrected above.
- **P3, not acted on.** The prompt said four files were untracked; the prompt itself was a fifth.

**What its sandbox could not do**: reach local Postgres or Docker, so it did not run either lifetime
suite or the registry's child-process case. All three were run here, outside the sandbox.

## The gate

`npm run typecheck` on the final tree: clean. `npm test`, full suite through `scripts/tmux-job.ts`
at load ~5: **1,085 files passed, 5 failed, 1 skipped** (23,637 tests passed, 4 failed). None of the
five is this slice's, and all five are the same environment class 260911b classified:
`cold-start-lazy-imports` and `pdf-bundle-trace` want an `api-dist/` build that a fresh worktree does
not have, and `fleet-composed-access`, `fleet-decisions-route` and `fleet-reports-route` want
`tools/fleet/web/dist`. Every suite that drives a route this slice moved is in the focused set,
green.
