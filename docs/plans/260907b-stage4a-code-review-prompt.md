# Review the built code for stage 4a — the request-lifetime oracle

**Begin your answer with the line `NONCE: LIFETIME-ORACLE-4A` and nothing before it.** A killed run
earlier in this job wrote a stale answer to the path a newer run was using, and I acted on it. If you
did not receive a nonce instruction, you are reading a different prompt than I sent — say so.

Built-code review, and it outranks the plan review. **Not pushed** — I am sequencing that on your
verdict.

## What to read

Working tree `/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain`.

- **The change**: `git show 2c1e03bf`. New file `tests/streaming-route-request-lifetime.test.ts`,
  plus two additive entries in `tests/store-migration-registry.ts` and the plan doc.
- **Your own two findings that required this**: `docs/plans/260907b-stage3a-code-review-sol-0923.md`
  § P2-LIFETIME-BEHAVIOUR, and `docs/plans/260907b-stage3b-code-review-sol-1042.md`
  § P2-LIFETIME-BEHAVIOUR (which named criteria POST as the instance and gave five steps).
- **The plan**: `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md`. Read
  § *Fable settles the end-state, and corrects the price* — question 3 below is about it.
- Subject under test: `runRefereeCriterion` at `src/routes.ts:4140`, the `refereeing` registry at
  `:3970`, its add/delete at `:4149`/`:4177`, the criteria POST guard at `:8331`, and
  `CRITERION_ORPHAN_GRACE_MS` at `:4003`.

## What was built, and what it deliberately did not do

Your five steps, against `POST /api/referee/criteria/:slug` **while it is still an `if` in the
chain**. **No guard moved. `src/routes.ts` is byte-identical.** `EXPECTED_AUTH_ROUTES` still hashes
`c36bdcbaacfe6197f035c27c9271f9ed`. That is deliberate: your P2-ORDER-ORACLE said an oracle written
in the same commit as the arrangement it approves is a regression pin, so this one predates the move.

The implementer hit something the brief did not anticipate. `sweepPending` spares any row younger
than `CRITERION_ORPHAN_GRACE_MS` (150 s), so a test that merely issues the GET **passes even with the
lock deleted outright** — the row is spared for being young and the assertion never touches the lock.
So while the stream is paused the test backdates `attempt_started_at` past the grace window, leaving
the lock as the only thing between that row and the sweep; then restores and backdates the row
identically *after* the request resolves, where the same GET buries it with `CRITERION_SWEPT`. One
arrangement, two opposite answers, the only difference being whether the request is in flight.

Pausing is a deferred pair of gates in a mocked `runCriterionStream`, never a timer.

## What I most want checked

1. **Does step 3 prove what it claims, or something weaker?** The backdating arrangement is the load-
   bearing part and it is doing something subtle. Is "the sweep left the row `pending`" genuinely
   equivalent to "`refereeing` is still held", or is there a third reason a backdated row survives a
   sweep that would make this pass for the wrong reason? Also check the converse half — that burying
   the row after resolution really does witness *lock removal* and not merely that the request ended.
   The implementer also reports that `referee_criteria_attempt_both` refuses a start time without an
   `attempt_id`, so the helper preserves the row's existing attempt mid-flight; check that preserving
   it cannot break `finish`'s fence and silently end the run with no `done` frame.

2. **Mutation 3's aim.** The implementer argues `runRefereeCriterion` catches the stream's own
   rejection *on purpose* — past `sse(res)` a model failure must become a stored `error` and a `done`
   frame, not an HTTP error — so the only rejection the arm can propagate is one raised **before** the
   headers, and the case spies `refereeCriteriaStore.begin` to reject after a turn of the event loop.
   Is that the right target for your deferred-handler check, and does it actually exercise
   propagation through the dispatcher rather than through the chain's own `try`?

3. **The question that changes the rest of the job — is your finding satisfied once, or per domain?**
   I had been costing this as a lifetime test *per streaming domain*. Fable argued that is wrong: no
   guard opens a stream or touches a lock (every one is `readBody` → `withSpendAttribution(() =>
   runX(…, res))` → `return`); the stream and lock live in the helper; the move does not touch the
   helper; so a verbatim move of a three-line caller cannot change what a callee does, and the only
   move-specific risks are a non-verbatim body (caught by diff) and a dispatcher that fails to await
   (caught once, by the deferred-handler case). **Do you agree your P2-LIFETIME-BEHAVIOUR is
   discharged for chat, searches and claims by this one test plus the dispatcher case — or is there a
   per-domain risk that reasoning misses?** I will act on your answer, so please be concrete about
   which remaining domain, if any, needs its own.

4. **Anything wrong in the test itself.** Especially: whether it can pass while the subject has
   stopped happening (a `done` frame never required, a stream that silently ended), whether the
   mocked `runCriterionStream` still exercises the real lock/finally path, and whether either case
   could flake under load.

## Ground rules

- **Do not modify any file.** Read and reason only.
- **You cannot run this test** — it needs Postgres and your sandbox has no network, not even
  loopback. Do not report on it as though you had. My raw results, which you may rely on:
  - `npx vitest run tests/streaming-route-request-lifetime.test.ts` → `Test Files 1 passed`,
    `Tests 2 passed (2)`.
  - Mutation 1 (`refereeing.delete(key)` inserted immediately after `.add(key)`), which **I applied
    and reverted myself rather than taking the implementer's word**:
    `AssertionError: the sweep spares a run this process is still on: expected 'error' to be 'pending'`,
    `Test Files 1 failed`, `Tests 1 failed | 1 passed (2)`. Reverted by editing the text back;
    `git diff -- src/routes.ts` is empty and the file is green again.
  - Implementer's mutation 2 (arm's `await` dropped): 2 failed — *expected 'resolved' to be
    'pending'* and *expected +0 to be 500*. Mutation 3 (rejection swallowed): 1 failed — *expected +0
    to be 500*, no response written.
  - `npm run check` EXIT=0, 806 files passed / 1 skipped, 15,060 tests, all seven hard gates clean.
- **You can run** `npx vitest run tests/authenticated-api-route-contract.test.ts` — unit lane, no
  database. It should be 325 passed.
- Severity and an ID on every finding: **P0** security/correctness, **P1** a real bug, **P2**
  judgement, **P3** nit.
- If it is sound, say so and spend the effort on questions 1 and 3.
