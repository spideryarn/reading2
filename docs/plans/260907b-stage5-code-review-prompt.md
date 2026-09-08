# Review the built code for stage 5 — search into the table

**Begin your answer with the line `NONCE: SEARCH-TABLE-5` and nothing before it.** A killed run
earlier in this job wrote a stale answer to the path a newer run was using, and I acted on it. If you
did not receive a nonce instruction, you are reading a different prompt than I sent — say so.

Built-code review, and it outranks the plan review. This is production code dispatching an
authenticated API, so a dispatch bug is an auth bug. **Not pushed** — I am sequencing that on your
verdict.

## What to read

Working tree `/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain`.

- **The change**: `git show 713d983c`.
- **Your stage 4a review** (`260907b-stage4a-code-review-sol-1957.md`) question 3 — the "once, not
  per domain" ruling this stage was built on. **Question 2 below is about that ruling.**
- **Your stage 4b review** (`260907b-stage4b-code-review-sol-2126.md`) question 5 — you gave the
  recipe for this slice; I want to know whether it was followed.
- **The plan**: `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md`, § *Stage 5*.

## What was built

Four search guards (`searches` GET/POST at the old `:8453`/`:8458`, `oneRun` PATCH/DELETE at
`:8469`/`:8489`) moved as a contiguous suffix, prepended above the eight referee rows in original
relative order. `AUTH_ROUTES` is now **25 entries**; **56 guards remain**. Two shared matchers,
`SEARCHES_PATTERN` and `ONE_RUN_PATTERN`. Biome on `serveAuthenticatedApi` 164 → 153.
`EXPECTED_AUTH_ROUTES` unchanged at `c36bdcbaacfe6197f035c27c9271f9ed`.

Your P2-ORDER-ORACLE discipline again: the four pair-keys went into § *keeps the table in the chain's
order* **with no source change**, went red with exactly those four rows at the head of a 21-vs-25
diff, and were not touched afterwards.

## What I most want checked

1. **Are the four bodies verbatim?** Verify against `713d983c^` yourself. The implementer's
   comparison normalised only the matcher binding to `captures` (both `slugPart(` and `part(` — 
   `oneRun` uses each), the trailing `return;`, and indentation; it did **not** strip comments, so
   prose was compared too. All four reported identical. `searches` POST streams and holds the
   `searching` lock (`:3902`/`:3929`), so I care most about anything that changed *when* a response
   is written or *when* that lock is released.

2. **Your "once, not per domain" ruling was right, but for a reason neither of us gave — does that
   change it?** This slice shipped no lifetime oracle on that ruling, and the brief recorded the
   expected cost: a lock-holding streaming handler with no runtime guard. **That turned out to be
   false.** Mutating the moved `searches` POST handler's `await` to `void` reddens
   `tests/routes.test.ts` § *POST /api/search/:slug is a stream too* — 5 cases, `expected +0 to be
   200` — with a 128-passed control on the unmutated tree. I reproduced that myself.

   So search had incidental request-lifetime coverage all along, written for its own sake. My
   question: **does that make the ruling safer than you stated, or merely lucky here?** Specifically —
   for the remaining domains (chat, threads, comments, glossary, quotes, timeline, quiz, arc,
   ideas, similar, projection, sketch, illustrated, live sessions), is there any that both holds a
   lock or streams **and** has no equivalent behavioural test that would redden on a dropped `await`?
   If there is, name it, because that is the slice that needs an oracle written before it moves and
   I would rather find it now than after it lands.

3. **The mid-body `return;` hazard.** A `return;` inside an arm meaning *fall through to the next
   guard* would change meaning in the table, while the normaliser strips only the trailing one — an
   **empty diff over a real behaviour change**. The implementer reports the slice's four `return;`
   are each their arm's last statement, and the only mid-body exit is `throw httpError(400, …)` in
   `oneRun` PATCH, propagating identically because `dispatchAuthRoute` puts no `try` around
   `await route.handler(...)`. Confirm, and say whether the normaliser should refuse a non-trailing
   `return;` outright rather than relying on a per-slice hand check.

4. **Anything wrong in the move** — order preservation across the 25 rows, the two shared-matcher
   `const`s, error propagation, dropping the trailing `return;`.

## Ground rules

- **Do not modify any file.** Read and reason only.
- You can run `npx vitest run tests/authenticated-api-route-contract.test.ts` — unit lane, no
  database; expect 326 passed. **You cannot run** `tests/routes.test.ts` or
  `tests/referee-stream-lifetime.test.ts` — they need Postgres and your sandbox has no network, not
  even loopback. Do not report on them as though you had. My raw results:
  - `npm run check` → **EXIT=0**, all seven hard gates green.
  - `tests/routes.test.ts` unmutated: **128 passed**. With `await` → `void` on the moved handler:
    **5 failed**, quoted above. Reverted by editing the text back; green again.
  - `tests/referee-stream-lifetime.test.ts` untouched and green.
- **A caution on evidence:** `npx vitest run` given a path that does not exist runs the other files
  and exits 0 without mentioning it. If you ask me for a test result, name the file exactly and I
  will report the `Test Files N passed` count alongside.
- Severity and an ID on every finding: **P0** security/correctness, **P1** a real bug, **P2**
  judgement, **P3** nit.
- If it is sound, say so and spend the effort on question 2.
