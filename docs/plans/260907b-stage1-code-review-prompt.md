# Review the built code for stages 1 and 1b

**Begin your answer with the line `NONCE: ROUTE-CONTRACT-1B` and nothing before it.** A previous
review in this job was read out of order because a killed run wrote a stale answer to the path a
newer run was using; the nonce is how I tell your answer from a leftover. If you did not receive a
nonce instruction, say so — you are reading a different prompt than I sent.

You reviewed this job's plan already. This is the **built code** review, and it outranks the plan
review — a plan-stage review cannot see what an implementation actually did.

## What to read

Working tree `/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain`, branch
`worktree-api-dispatch-by-domain`.

- **The code**: `tests/authenticated-api-route-contract.test.ts` (1,483 lines, 304 cases, green,
  unit lane, no database). Commits `31cfcbcc` (stage 1) then `ee920a86` (stage 1b).
- **The plan**: `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md`.
- **Your plan review**: `...-review-sol.md` beside it. Stage 1b exists to close your
  **P1-DECODE-CONTROL**, **P1-ORDER-CONTRACT** and **P1-SOURCE-INVENTORY**.
- `src/routes.ts` is unchanged by both stages — `git diff HEAD -- src/routes.ts` is empty. Confirm.

## What the stages claim

**Stage 1.** A hand-authored `EXPECTED_AUTH_ROUTES` (67 rows, declaration order, no binding names
pinned); a walk over `serveAuthenticatedApi`'s statement list using `tests/helpers/ts-ast.ts` that
recognises four statement shapes and **throws at module scope on anything else**; bidirectional set
equality on matchers and on method/matcher pairs, with 67/81 asserted separately and labelled
canaries; and a **negative-only** execution matrix — every (witness, method) the contract refuses,
requiring the exact terminal 404 and no `Allow`. `GET /api/models` is the only positive control.

Five mutations were watched red: delete an arm, add an arm, change a matcher's character class,
change a guard's method, and rewrite a guard into a form the parser does not recognise (which
*refused*, reporting `an if whose left conjunct is not a binding at line 8157`, rather than
skipping). The body-swap mutation was **removed** on your P1-HANDLER-IDENTITY.

**Stage 1b.** A `collisionsIn(guards, corpus)` disjointness check over contract witnesses plus named
`OVERLAP_PROBES`, with five tests; the two decode-order cases you reproduced, plus a mutation of the
order watched red; and a five-reader classification in the plan's constraint 8.

## What I want from you

1. **Is the negative-only matrix actually safe?** The implementer added an asymmetry: the contract
   chooses which pairs to ask about, but *the parsed source decides whether a request is sent* — so a
   guard the contract does not know about fails the case without sending anything. It reports that
   without this, mutation 4 would have fired a live `PUT /api/ideas/w1` at a real handler. Verify
   that no path through this file can send a request the source would actually handle.

2. **Does the module-scope throw defeat its own purpose?** The parser throws on unrecognised syntax
   *at import time*, which makes the whole file fail to collect. Is "1 file failed, no tests ran" a
   loud enough failure here, or has a refusal been turned into something that reads like an
   infrastructure error?

3. **Is the disjointness check worth its 60 lines, or is it theatre?** The implementer's own verdict:
   the three named-family tests earn their place (they would catch a narrowed character class that
   every other test in the file would miss); the general corpus check is thinner, because its corpus
   comes from the contract's own witnesses and its control has to be synthetic, so the plumbing
   between the real guard list and the collision finder is exercised only by the passing empty case.
   I want your independent judgement, not agreement.

4. **The bidirectional comparison is set-based, so it does not assert order.** You flagged that the
   hand-written set "loses route order/identity". Stage 1b's answer is to assert *disjointness* —
   the property that makes order irrelevant — rather than order itself, on the grounds that pinning
   order would pin an implementation detail. Is that the right answer, or does something still need
   the order asserted?

5. **Anything in the 1,483 lines that is wrong, over-claimed, or asserts something it cannot
   support.** Especially: comments claiming a check proves more than it does; a test that would pass
   for the wrong reason; and whether the four recognised statement shapes actually cover all 67
   matchers and 81 guards, or whether something is being silently classified.

6. **Given all of this, is stage 1 a defensible stopping point** — or does stopping here leave
   something in a worse state than not having started?

## Ground rules

- **Do not modify any file.** Read and reason only.
- Run the file — it needs nothing outside the tree: `npx vitest run
  tests/authenticated-api-route-contract.test.ts`. A finding you reproduced outranks one you reasoned
  to. Anything needing Postgres is mine to run.
- Severity and an ID on every finding: **P0** security/correctness, **P1** a real bug, **P2** a
  judgement call, **P3** a nit.
- A short review is a valid outcome. Do not manufacture findings.
