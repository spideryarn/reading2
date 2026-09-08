# Stage 1 code review: the DELETE oracle, before the chat guards move

You reviewed the plan for this slice about half an hour ago and returned *build it with these
changes* (`docs/plans/260908a-plan-review-sol.md`). This is the first stage built from it.

## The candidate

**Durable, committed.** Repo is the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table`, branch
`worktree-worktree-chat-route-table`.

- **Commit `ccd3ac8c`** — the whole stage. `git show ccd3ac8c` is the diff.
- Four paths, all of them in that commit:
  - `tests/chat-thread-delete-route.test.ts` (new — the oracle)
  - `tests/store-migration-registry.ts` (one lane entry plus its comment)
  - `docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md` (§ *Stage 1, as built*)
  - `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md` (§ *Every remaining slice
    is provably unreachable before `requireUser`* — a general argument moved into the umbrella plan)

**`src/routes.ts` is not in this commit and is byte-identical to `HEAD`.** No guard has moved yet.
That is deliberate: this stage exists so that a red after the move is attributable to the move.

Reading order — not a scope limit: the new test file, then `git show ccd3ac8c`, then the plan section.

Context you will want: `tests/turn-order.test.ts` (read its header — it is why this file is shaped as
it is), `src/routes.ts:8517` (the guard under test) and `:2136` (`inTurnOrder`), and
`tests/the-query-string-does-not-decide-the-route.test.ts` for the house style this file follows.

## What to attack

1. **Is the oracle actually red for the right reason, and green for the right reason?** Two mutations
   were run and both results are recorded in the file header and the plan:
   - `await inTurnOrder(…)` → `inTurnOrder(…)`: **2 failed of 2**.
   - `inTurnOrder(k, f)` → `f()`: **2 passed of 2**.
   The second is the control. Is the claim it licenses — *this file does not test the lock* — stated
   correctly, and is anything in the file's assertions accidentally load-bearing on the lock after
   all?
2. **Is there a way this file passes while the route is broken?** In particular: could the second
   case (*really removed it, and not only in the reply*) pass because of the first case's side
   effects, ordering between the two `it` blocks, or the `afterAll` cleanup? Could the seeding in
   `beforeAll` silently produce one thread instead of two and still leave the assertions meaningful?
3. **The lane.** `tests/chat-thread-delete-route.test.ts` was put in `private-postgres`. Is that
   right, or would `shared-services` do — and is there a way the file's exact-list assertions could
   be falsified by a neighbouring run in the lane it has been given?
4. **The fake `res`.** It has no `write`, `writeHead` or `on`. Is that the right shape for this
   route, and does its absence hide anything?
5. **The umbrella-plan section.** Is the general claim — that any namespace with a literal prefix
   other than `/api/public` is provably unreachable before `requireUser`, because
   `src/public/routes.ts:183` gates on `path === "/api/public" || path.startsWith("/api/public/")` —
   true as stated, and is the exception it names (*if a future namespace is added to the public
   dispatcher, or its claim stops being a literal prefix*) the complete set of ways it could stop
   being true?
6. **Anything the stage should have done and did not**, given that Stage 2 moves twelve guards next.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by which file the defect is in. **Refuse only on an established P0 or
P1** — direct evidence with no unresolved material inference. Give every finding a stable ID
(`F4`, `F5`, … — `F1`–`F3` are taken by the plan review, so do not reuse those numbers unless you
mean the same finding).

You have no network and cannot reach Postgres, so you cannot run this file. Say so rather than
implying a run. Everything else in the tree is readable.

## End with a verdict

One of: **stage is sound**, **stage is sound with these changes**, **this stage does not establish
what it claims**, or **stop and reconsider**.

---

## My own suspicions, worth less than yours — spend most of the run above

- The oracle turned out easier than the previous slice's stream-lifetime instrument, and I remain
  suspicious of that even though both mutations behaved as predicted.
- The second `it` depends on the first having deleted something. I think that is fine and is the
  point — the store's word after the route's word — but it is the kind of coupling that reads fine
  and later turns out to have been the reason a suite passed.
- I asserted `expect(article.copied).toContain("blocks")` by copying the sibling file. I have not
  checked that this file actually needs blocks; if it does not, that assertion is cargo.
