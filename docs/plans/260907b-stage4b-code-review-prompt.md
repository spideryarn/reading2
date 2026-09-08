# Review the built code for stage 4b — referee into the table

**Begin your answer with the line `NONCE: REFEREE-TABLE-4B` and nothing before it.** A killed run
earlier in this job wrote a stale answer to the path a newer run was using, and I acted on it. If you
did not receive a nonce instruction, you are reading a different prompt than I sent — say so.

Built-code review, and it outranks the plan review. This is production code dispatching an
authenticated API, so a dispatch bug is an auth bug. **Not pushed** — I am sequencing that on your
verdict.

## What to read

Working tree `/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain`.

- **The change**: `git show 9c1b5012`.
- **Your stage 3b review** (`docs/plans/260907b-stage3b-code-review-sol-1042.md`) — this stage
  implements your **P2-ORDER-ORACLE** properly, and moves the domain your
  **P2-LIFETIME-BEHAVIOUR** was about.
- **Your stage 4a review** (`docs/plans/260907b-stage4a-code-review-sol-1957.md`) — you said the
  post-move green of the unchanged lifetime case is what discharges the dispatcher half. Question 2
  asks whether it did.
- **The plan**: `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md`.

## What was built

Eight referee guards (`criteria` GET/POST, `oneCriterion` PATCH/DELETE, `refereeClaims` GET/POST,
`refereeScan` GET, `refereeMirror` POST) moved as one contiguous suffix, prepended above the nine
jobs/uploads rows in original relative order. `AUTH_ROUTES` is now 21 entries; **60 endpoint guards
remain** in the chain, plus the admin gate and the table call. Biome on `serveAuthenticatedApi`:
183 → 164. `EXPECTED_AUTH_ROUTES` is unchanged at `c36bdcbaacfe6197f035c27c9271f9ed`.

Three shared matchers became module-scope `const`s (`CRITERIA_PATTERN`, `ONE_CRITERION_PATTERN`,
`REFEREE_CLAIMS_PATTERN`), following the `JOBS_PATH` shape from 3b. `refereeScan` and `refereeMirror`
serve one row each and stay inline.

**Your P2-ORDER-ORACLE was implemented as red-first.** The eight pair-keys were added to § *keeps the
table in the chain's order* **with no source change**; the file went red with a diff of exactly those
eight rows at the head; the move then made it green, unedited.

## What I most want checked

1. **Are the eight bodies genuinely verbatim?** The implementer reports a mechanical re-split and a
   character-for-character comparison after normalising `slugPart(<binding>,` → `slugPart(captures,`
   and dropping each trailing `return;`. Verify against `9c1b5012^` yourself. Four of these eight
   stream; two hold locks (`refereeing`, `pullingClaims`). I care most about anything that changed
   *when* a response is written or *when* a lock is released.

2. **Is the dispatcher half of P2-LIFETIME-BEHAVIOUR actually discharged now?** Your stage 4a review
   set the condition: the unchanged case must pass through `dispatchAuthRoute` after the move. It is
   unchanged (`git diff` on that file is empty) and green. I also mutated the moved criteria closure's
   `await` to `void`: the contract test stayed **green at 325** while
   `tests/streaming-route-request-lifetime.test.ts` went **2 failed** — *the request is still in
   flight: expected 'resolved' to be 'pending'* and *the rejection reached serveApi's catch: expected
   +0 to be 500*. Does that satisfy what you asked for, or is something still uncovered?

3. **The rewritten source reader.** `tests/referee-scan-route.test.ts` extracted its arm by matching
   `if (refereeScan && req.method === "GET") {` up to a brace at four spaces. Both halves died here,
   so it now anchors on the row's `pattern:` line and ends at `\n    },`. A rewritten extractor is the
   classic shape that can silently match nothing for ever. I checked the presence control fires
   (perturbing the route's pattern gives *"the route is not in src/routes.ts under that pattern:
   expected '' not to be ''"*). But is the new regex **over**-broad in the other direction — could it
   capture more or less than the intended handler body, so that the assertions inside it (the
   ordering checks and the `withSpendAttribution` refusal) now inspect the wrong text?

4. **Anything wrong in the move.** Order preservation across the 21 rows, the shared-matcher
   `const`s, error propagation, and whether dropping each arm's trailing `return;` changed control
   flow anywhere.

5. **Search is the next slice** (`searches`, `oneRun`). Is there any prerequisite left that I have
   not seen — or is it now purely the 3b recipe plus a red-first order expectation?

## Ground rules

- **Do not modify any file.** Read and reason only.
- You can run `npx vitest run tests/authenticated-api-route-contract.test.ts` — unit lane, no
  database; expect 325 passed. **You cannot run** the lifetime test or `referee-scan-route` — they
  need Postgres and your sandbox has no network, not even loopback. Do not report on them as though
  you had; my raw results are above and below.
- Postgres is mine. `npm run check` results are being produced now and I will provide them; the
  previous stage was EXIT=0 with 812 files / 15,140 tests, all seven hard gates clean.
- Severity and an ID on every finding: **P0** security/correctness, **P1** a real bug, **P2**
  judgement, **P3** nit.
- If it is sound, say so and spend the effort on questions 1 and 3.
