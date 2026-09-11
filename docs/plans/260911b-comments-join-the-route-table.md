# Comments join the route table

The seventh slice of the `AUTH_ROUTES` migration: **six guards**, the whole Comments block, which
was the bottom of `serveAuthenticatedApi`'s `if` chain once chat moved.

The umbrella plan is
[260907b-split-the-authenticated-api-dispatch-by-domain.md](260907b-split-the-authenticated-api-dispatch-by-domain.md).
The recipe is [260907e](260907e-referee-joins-the-route-table-and-the-stream-lifetime-test-that-has-to-come-first.md)'s
and the slice before this one is
[260908a-chat-and-live-sessions-join-the-route-table.md](260908a-chat-and-live-sessions-join-the-route-table.md);
**read that one first** — this doc says only what is different about Comments. Commissioned as
cluster G's first stage of
[260908f-prioritised-spideryarn-codebase-improvements.md](260908f-prioritised-spideryarn-codebase-improvements.md)
§ G, dispatched by the Overseer on 2026-09-11 after Greg moved product work above the dashboard.

> **Status, 2026-09-11: built.** Oracle written and watched red first, six guards moved, contract
> updated. GPT Sol's review of the built code is § *The review*.

## Claimed, and the count re-measured

`/api/comments` was unclaimed: no plan named it after 260908a § *Closed*, no worktree or live
session held it (`ListAgents`, `git worktree list`), and `src/routes.ts` on `dev` at `607b57a0` still
had all six guards in the chain.

**The count the brief carried was stale by one guard.** 260908f § G says *37 of 81 moved, 44
remaining*. The contract test's own control says 82 (`EXPECTED_GUARD_COUNT`), and the chain has 45
guards against the table's 37. The difference is `DELETE /api/shelf/:slug`, which joined the
existing `shelfEntry` matcher's `PATCH` on 2026-09-06 (commit `a239fd83`, the permanent delete).
So the inventory is **82 guards, not 81 URLs** — after this slice **43 moved, 39 remaining**.

## The slice

In the order the chain had them, immediately above the table's dispatch:

| # | Guard | Matcher | Notes |
|---|---|---|---|
| 1 | `comments` GET | `/api/comments/:slug` | runs the sweep |
| 2 | `comments` POST | `/api/comments/:slug` | free create |
| 3 | `commentAnswer` POST | `/api/comments/:slug/:id/answer` | **the one that streams**, and holds `answering` |
| 4 | `commentMark` PATCH | `/api/comments/:slug/:id/mark` | |
| 5 | `one` PATCH | `/api/comments/:slug/:id` | |
| 6 | `one` DELETE | `/api/comments/:slug/:id` | |

The guard above the block is `projection` POST; nothing between it and the dispatch matched a
comments path. **Contiguous and at the bottom**, so prepending the six above the chat rows puts each
in the position it already had — the ordering argument is by construction, as for every slice.

No overlap inside the block: `ONE_COMMENT_PATTERN` cannot match `…/answer` or `…/mark`, which have
three segments after `/api/comments/`.

**Where the gate lives: exactly where it did.** `requireUser` is untouched and still called once
(Stage 3 of 260907e asserts it by AST). `slugPart` moves with the bodies for the slug, `part` for the
comment id — the id is matched against rows, never joined into a path — and the body diff is what
stops a `part` becoming a `slugPart` or the reverse. `src/public/routes.ts` is not touched; its
namespace is the literal `/api/public`, which no comments path satisfies.

## Stage 1 — the oracle for `POST /api/comments/:slug/:id/answer`

260908a § *The queue after this slice* named this route's gap: SSE plus the `answering` registry, and
the only server-side coverage a 409 **before** the stream starts, which a launched stream passes.

`tests/comment-answer-stream-lifetime.test.ts`, four cases, written against the guard **still in the
chain**. `explainStream` is stubbed with a generator that yields one `delta`, signals that it has
been reached, and blocks on a gate the case releases — one gate per call, handed out in order,
because one case holds two streams at once. It is 260907e's referee harness with that one change.

**The oracle that would not work, and why the fix is the same as referee's.** A mid-stream `GET`
seeing the row `pending` cannot fail: `sweepPending` spares a row on **either** the `keep` set the
route builds from `answering` **or** the row's lease, which `beginAnswer` stamps
`COMMENT_ANSWER_LEASE_MS` into the future. So every registry case ages the lease in SQL (an hour
into the past) before asking, and then `pending` has one explanation left.

| Case | What it asserts |
|---|---|
| holds the request open | while the stream is held, the request has not settled and the response has not ended; after release, a `done` frame, the terminal row written, then settled |
| still holds the registry, however old the lease | lease aged mid-stream, the `GET` sweep still reports `pending` |
| releases the registry by the time it answers | after the answer, the row put back to `pending` with a dead lease is swept to `error` |
| a second attempt keeps the registry after the first finishes | first held, lease aged, a retry reclaims the row and is held too; the first finishes; lease aged again; still `pending` |

The last case is the brief's *"hold the stream while a second attempt reaches the `answering`
registry"*. It is why `beganAnswering` counts rather than flags.

### Stage 1, as built — the mutations, watched

Green unmutated: **4 passed of 4**. Each mutation applied to `src/routes.ts` alone, the file run,
reverted, and `git diff --stat HEAD -- src/routes.ts` empty afterwards.

| Mutation | Result |
|---|---|
| **M1, the subject**: the guard's `await withSpendAttribution(…)` → `void withSpendAttribution(…)` | **4 failed of 4.** The subject case: *"the request settled before the stream was entered"* — a launched stream resolves the request before the stream has even begun, which the handshake names rather than timing out on. The other three are collateral: the orphaned streams take the next cases' gates and run against rows their `beforeEach` deleted (`404 missing`). |
| M2: `release()` deleted from `answer`'s `finally` | **1 failed of 4**: *"the key was never released, so the sweep spared it: expected 'pending' to be 'error'"* |
| M3: `release()` called straight after `beganAnswering`, before the stream | **2 failed of 4**: both registry-held cases, *"expected 'error' to be 'pending'"* |
| M4: `beganAnswering` a flag (`(get ?? 0) + 1` → `1`) | **1 failed of 4**: *"the first attempt's release took the second's protection: expected 'error' to be 'pending'"* |

M2–M4 are not the migration's risk — nothing in the move touches `answer` or `beganAnswering` — but
an oracle for a registry never watched failing on the registry is the file 260907e's header warns
about. **The file needs the registry entries a new Postgres suite needs**: a `private-postgres` lane
in `TEST_LANES` and a `STORE_MIGRATION` verdict marked `evidence: "static-only"`, for 260908a
§ F4's reasons. It avoids the reserved `**Blind to.**` marker for the same reason.

## Stage 2 — the move

The recipe is 260908a's, with its verifier. The verifier for this slice is
[260911b-verify-move.mjs.txt](260911b-verify-move.mjs.txt), a copy of
[260908a-verify-move.mjs.txt](260908a-verify-move.mjs.txt) with the guard list changed and **two
things tightened**, each watched failing:

1. **The matcher rename is targeted.** The parent renames `\b<matcher>\b` everywhere in a body. Here
   that is a blind spot: the matcher `comments` is also the key in `{ comments: … }`, so a generator
   that corrupted the key to `captures` normalises the same on both sides. The rename now touches
   only `slugPart(<m>,` and `part(<m>,`, the only two ways these bodies use their matcher. **Watched**:
   a scratch copy of the moved file with `{ comments: await sweepOrphaned(slug) }` made
   `{ captures: … }` — this verifier prints `*** BODY DIFFERS *** comments GET` and exits 1; the
   parent's rename, run on the same two files, prints *the move is a move*.
2. **Body boundaries are cross-checked.** `blockAt` counts raw braces, comments and strings included
   (Sol, 260908a stage 2/3 review, left for whoever took comments). Two of these bodies carry braces
   in comments. Each body is now also cut from a copy with comments and string contents blanked, and
   the two cuts must agree. **Watched**: a `}` added to the `one` DELETE row's comment → *"one DELETE:
   the raw and blanked cuts disagree (39 vs 233)"*.

The rows were generated by a script that cut the guards' lines, dropped each final `return;`, applied
the same targeted rename, and wrote the rows — the six bodies verbatim, comments included, in chain
order. `COMMENTS_PATTERN` and `ONE_COMMENT_PATTERN` join `CHAT_PATTERN` as module constants because
they have two rows each; `answer` and `mark` are written into their rows.

### Stage 2, as built — the purity evidence

The before capture is reproducible from `HEAD` (`cmp` identical). The rail refuses none of the six —
each ends in one argumentless `return;`; `commentMark` and `one` PATCH exit early by `throw`, which is
not a return.

```
identical             comments GET             92 chars
identical             comments POST            90 chars
identical             commentAnswer POST       196 chars
identical             commentMark PATCH        389 chars
identical             one PATCH                312 chars
identical             one DELETE               129 chars

the move is a move
```

**Comments outside handler bodies**, which the verifier does not cover and a person read:

- The two matcher comments — *Answering is its own sub-path…* and *The referee's own placement,
  changed…* — moved above their rows. **One word changed, deliberately**: the second said *"two more
  fields on the `PATCH` above"*, true of the declarations, where `one` was declared first; in the
  table the `one` PATCH row is **below** the mark row, so it now says *below*.
- The chain's *"matchers used to be declared here"* comment now lists comments, and no longer says
  `commentMark` is the last matcher declared. It says **`exportBundle` is**, and that declaration
  order is not dispatch order: the last *guard* is `projection`. (The first draft of this edit said
  `projection` was the last matcher declared; it is declared before `source`, `asset` and
  `exportBundle`. Caught by grepping before committing.)
- The table's header comment and the dispatch-site comment name comments among the moved domains;
  the header's *"the next slice up goes above the search rows"* — already stale since chat — now says
  *above the comments rows*.

**Mutation 5, the acceptance test for the move**: `await` → `void` in the **moved** row's closure.
`tests/comment-answer-stream-lifetime.test.ts` **4 failed of 4**, the subject case with the same
message as M1; `tests/authenticated-api-route-contract.test.ts`, `assertHandlersAwaited` included,
**323 passed of 323**. The syntax tripwire does not see a launched stream, measured again on a third
domain. Reverted; the verifier diffs clean afterwards.

## Stage 3 — the contract test, red first

With the six moved and the test untouched: **2 failed, 321 passed** — exactly *answers the moved
domains from the table* and *keeps the table in the chain's order*, the two F1 of 260908a named.
`EXPECTED_AUTH_ROUTES` needed no edit, which is the evidence no route's identity changed.

Hand edits:

1. both pair-key lists gain the six, prepended above chat in chain order;
2. `/api/comments` joins `moved` — enforced for real since 260907b's `pathish` fix;
3. **the control is repointed** from `/api/comments` to `/api/projection`, the chain's last guard now
   and the bottom of the next slice. It fails the moment that domain moves, which is its handoff.

Green: **323 of 323**. The focused set — the oracle, the contract, `routes`, `owner-isolation`,
`public-dto` (the three the security map calls the specification: nothing in them reads a guard's
position, only method and path through `handleApi`), `comment-referee-mark`, `comment-sweep`,
`store-migration-registry`, `fixture-ids`, `referee-stream-lifetime`, `chat-thread-delete-route` —
**11 files, 609 tests, green**.

## Where the file stands

| | Lines | Complexity of `serveAuthenticatedApi` |
|---|---|---|
| before this slice | 8,778 | 127 |
| after it | **8,813** | **110** |

Thirty-five lines longer and seventeen points simpler — the trade every slice has made. Not an
acceptance metric (260908f § G).

## What this slice is not doing

- **No other G slice.** The paid single-flight block (`sketch` … `projection`) is next and needs its
  own oracle with the `return` → `void` mutation, per 260908f § G.
- No handler rewrites, no router dependency, no file extraction.

## The review

[260911b-code-review-sol.md](260911b-code-review-sol.md), GPT Sol (high, `workspace-write`),
2026-09-11, against the uncommitted slice on `607b57a0`; prompt
[260911b-code-review-prompt.md](260911b-code-review-prompt.md). The run log confirms a nested
`gpt-5.6-sol` exec rather than a self-review. **Verdict: approve — no P0, P1 or P2.**

Sol re-ran the verifier (fresh captures byte-identical to the recorded ones), the contract test
(323/323), typecheck and lint, and answered the finding I asked it to try hardest on: after the lease
is aged `sweepPending` has no protection left but `answering`; the second stream reaching its gate is
itself the proof that `beginAnswer` reclaimed the row rather than answering 409; and sequential gate
creation and consumption cannot hand an unmutated stream the wrong gate. It judged M1's handshake
failure better evidence than a later `settled` assertion, since it names the defect directly.

Two P3s, fixed by Sol and checked here:

- the contract test's header still said *81 guards*, listed only the first three moved domains and
  called the chain *twenty-one `if`s*; now 82, the bottom 43 named, and no chain count;
- the verifier's inherited prose said *these twelve*; now *these six*.

**What its sandbox could not do**: connect to local Postgres, so it did not re-run the lifetime suite
or the registry suite's subprocess case. Both were run here, outside the sandbox: § *Stage 3* and
§ *The gate*.

## The gate

`npm run typecheck` on the final tree: clean. `npm test`, full suite through `scripts/tmux-job.ts`
at load ~4: **1,082 files passed, 6 failed, 1 skipped** (23,629 tests passed, 5 failed). **None of
the six is this slice's**, and each was classified rather than assumed:

- `cold-start-lazy-imports`, `pdf-bundle-trace` — *has a build to inspect*: a fresh worktree has no
  `api-dist/`. Known and documented for new worktrees.
- `fleet-composed-access`, `fleet-decisions-route`, `fleet-reports-route` — re-run alone, all three
  stop at *"no built client at tools/fleet/web/dist — run `npm run build:fleet` first"*. Same class.
- `overseer-diagnose` § *F40: a checkout whose job list cannot be built…* — re-run alone, still red.
  It is a temp-directory test of `tools/overseer`'s diagnose text and imports nothing this slice
  touches; it belongs to the Overseer work in flight on `dev`.

Every suite that drives a route this slice moved is in the focused set in § *Stage 3*, green.
