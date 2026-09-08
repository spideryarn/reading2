# Stage 2 and 3 code review: the twelve chat and live-session guards have moved

Your third look at this slice. You reviewed the plan (`260908a-plan-review-sol.md`, F1–F3) and
Stage 1 (`260908a-stage1-review-sol.md`, F4–F8). **All eight findings were accepted and acted on**;
this is the code they asked for.

**Weight this review higher than the other two.** A plan-stage review cannot find a handler that
answers from the wrong position, and a Stage 1 review was looking at a test. This one is looking at
the move.

## The candidate

**Durable, committed.** Worktree
`/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table`, branch
`worktree-worktree-chat-route-table`.

- **Commit `b4bd19c8`** — Stages 2 and 3, plus the fixes for F4–F8. `git show b4bd19c8`.
- **Commit `ccd3ac8c`** — Stage 1, which you already reviewed. Context, not candidate.
- A merge of `origin/dev` sits on top of `b4bd19c8`. It touched none of the files below except
  `tests/store-migration-registry.ts` (one unrelated line); the contract and registry tests were run
  immediately after it and are green at 339.

Changed paths in `b4bd19c8`:

- `src/routes.ts` — the move itself
- `tests/authenticated-api-route-contract.test.ts` — the two pair-key lists and the `moved` prefixes
- `tests/store-migration-registry.ts` — the F4 registry entry and the F6 lane comment
- `tests/chat-thread-delete-route.test.ts` — F4's marker rename, F7's removed assertion
- `docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md` — Stages 2 and 3 as built
- `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md` — F5's rewrite
- `docs/plans/260908a-verify-move.mjs.txt` — the verifier, committed because F3 asked for it

Reading order — not a scope limit: `git show b4bd19c8 -- src/routes.ts`, then the verifier, then the
plan's *Stage 2, as built* and *Stage 3, as built*.

## The evidence, so you can attack the evidence and not only the code

- **The verifier** reports eleven normalised bodies identical and one refused: `chat` GET, two
  returns. The plan section quotes its output.
- **`chat` GET's second exit** is covered by a watched mutation instead of an argument, which is what
  your F2 required. Deleting the early return makes
  `tests/the-query-string-does-not-decide-the-route.test.ts` fail on
  `expected {…} to not have property "messages"`. Restored; green.
- **Stage 3 was red first** on exactly the two expectations your F1 named and no others: 324 of 326,
  with `EXPECTED_AUTH_ROUTES` untouched. Green at 326 after both lists took the twelve keys.
- **The `moved` prefix list cannot fail in this tree** — the leftover filter is the blind version
  260907b found, and their fix is unpushed. So it was probed locally with the filter un-blinded:
  green with `/api/chat` and `/api/live`, and **red with `/api/comments`** (six guards found), which
  is the control that makes the green mean something. Both probes reverted.
- **Test runs, all in this worktree:** contract 326/326; the three specification files plus the
  chat/live route files, 11 files and 269 tests green; registry 13/13; post-merge 339/339. Typecheck
  clean. Biome clean but for the pre-existing complexity infos.

## What to attack

1. **Is it a move?** The claim is that each of the twelve now answers from the position it had.
   Attack the contiguity argument, the prepend-above-search placement, and whether the twelve were
   really the chain's last twelve rather than merely twelve adjacent ones.
2. **The handler signatures.** Each row destructures only what its body uses — `{ request: { res } }`,
   `{ request: { req, res } }`, and `{ request: { res, query } }` for `chat` GET. Is `query` reaching
   that handler the same `query` the chain gave it, and is any of the twelve now missing something it
   used to close over?
3. **The two new constants.** `CHAT_PATTERN` and `ONE_THREAD_PATTERN` exist because two rows each
   name them; the other eight matchers are inline. Are they the right two, are the inline eight
   correct, and is `ONE_THREAD_PATTERN` genuinely identical to the `oneThread` matcher it replaced?
4. **The comments that moved.** Two blocks moved from the chain into the table and one was rewritten
   because dispatch order splits the pair it described. Does the rewritten one now say something
   false? Three other comments were corrected for staleness — are they right now?
5. **Anything the verifier structurally cannot see.** It found a real corruption in the first attempt
   only because a person read the output: a global `\bchat\b` rewrote English inside comments, and
   the normaliser strips comments before diffing. **What else is in that blind spot?** This is the
   question I most want an answer to.
6. **The contract lists.** Twelve keys in a sorted set and twelve in an order-sensitive list. Are
   they the same twelve, in the right order in the second, and does the order recorded there match
   the order the chain actually had?
7. **`chatLive` and the prefix lists.** `/api/chat/:slug/:threadId/live` is a `/api/chat` path whose
   last segment reads like the other namespace. Is it filed correctly everywhere it appears?

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by which file the defect is in. **Refuse only on an established P0 or
P1** — direct evidence with no unresolved material inference. Give every finding a stable ID
starting at **F9**; `F1`–`F8` are taken, so reuse one only for the same finding.

You cannot reach Postgres, so the route tests are not runnable by you. Database-free files are: say
so if you run one, and say so if you do not.

## End with a verdict

One of: **land it**, **land it with these changes**, **this is not a pure move**, or **stop and
reconsider**.

---

## My own suspicions, worth less than yours — spend most of the run above

- The comment corruption in the first attempt is the thing that frightens me, because the mechanism
  that was supposed to prove purity is blind to it by construction and I caught it by eye. I would
  like to know what else lives in that blind spot, and whether the answer is a cheap check.
- `chat` GET is the only row with `query` in its destructuring. If the chain's `query` and the
  table's `query` are not the same object for some reason I have not thought of, that route is the
  one it would show up on — and it is also the route with a five-day-unreachable-branch postmortem
  behind it.
- I moved the live-session accounting comment verbatim but rewrote the ticket comment. A rewritten
  comment is an edit inside a commit that claims to be a move, and I would rather be told that was
  the wrong call than have it pass unremarked.
