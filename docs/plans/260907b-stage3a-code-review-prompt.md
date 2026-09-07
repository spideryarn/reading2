# Review the built code for stage 3a — the first production change

**Begin your answer with the line `NONCE: BILLING-TABLE-3A` and nothing before it.** An earlier
review in this job was read out of order because a killed run wrote a stale answer to the path a
newer run was using. If you did not receive a nonce instruction, you are reading a different prompt
than I sent — say so.

This is the **built code** review and it outranks the plan review. This is also the first stage to
touch production code, and the code dispatches an authenticated API, so a dispatch bug here is an
auth bug.

**It is already pushed to `dev`** (`75267b22`, merged at `b35b14fd`). That was my process error — my
brief did not say "do not push" — so treat this as a review of landed code. `dev` is the trunk and
builds nothing; production is `main`. If you find something serious, say so plainly and I will fix
forward.

## What to read

Working tree `/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain`.

- **The change**: `git show 75267b22` — `src/routes.ts` +300/−95, and
  `tests/authenticated-api-route-contract.test.ts`.
- **The plan**: `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md`, especially
  § *The constraints anything here must respect* (numbered 1–9) and § *The shape*.
- **Your two earlier reviews** in the same directory: `...-review-sol.md` (the plan) and
  `260907b-stage1-code-review-sol-073600.md` (stage 1).

## What was built

Above `serveAuthenticatedApi`: `AuthRouteMethod` (closed five-verb union), `AuthRouteContext`
(`{ user, request }`), a discriminated `ExactAuthRoute | PatternAuthRoute` whose pattern arm hands
the handler a raw `RegExpExecArray`, `AUTH_ROUTES` (four billing rows, all literals),
`assertDispatchableRoutes(AUTH_ROUTES)` called once **at import**, and `dispatchAuthRoute` which
awaits the handler and returns unconditionally.

`serveAuthenticatedApi` lost four `const billing* = path === …` declarations and four guards, and
gained one statement at `:8363` — after every remaining guard, before the terminal 404, which is the
position billing already held. Indentation untouched.

**The claimed proof**: `EXPECTED_AUTH_ROUTES` is byte-identical across the refactor. I verified this
independently — the literal hashes `c36bdcbaacfe6197f035c27c9271f9ed` at both `4139ae7d` and `HEAD`.
The parser was taught the table shape and still refuses unrecognised syntax at module scope.

## What I want from you

1. **Is the dispatch placement genuinely order-preserving?** Billing was last in the chain, so
   "after every guard, before the 404" should be exact. Verify there is no path where the table is
   consulted earlier or later than the four guards were, including for admin paths, unmatched paths
   and unsupported methods.

2. **Does the gate ordering still hold?** Constraint 1: `assertVerifiedUser` → `setRequestOwner` →
   `setMonitoringUser` → admin predicate and refusal → *then* selection, with the admin gate firing
   even when nothing matches. Confirm the table did not get in front of it.

3. **Is `assertDispatchableRoutes` throwing at import the right trade?** A `/g` typo now fails the
   whole module — the server does not boot — rather than degrading one route. The implementer flags
   this deliberately. Right call for a programmer error, or too blunt for production?

4. **The two claims asserted in shape but not in behaviour.** No test watches a real SSE response
   complete through `dispatchAuthRoute`, and none watches a lock held across it. Billing has neither,
   so nothing here is wrong — but is `assertHandlersAwaited` (a syntactic check that a handler call
   is awaited) an acceptable stand-in until a streaming domain moves, or is it the substitution
   `silent-success.md` warns about?

5. **Stage 3b's real obstacle.** Billing was last, so position was free. The next domain is
   mid-chain, and the implementer names two options: several dispatch statements at the domains' old
   positions, or hoisting on the strength of the disjointness property. The second rests on your
   hand-read of the 67 patterns plus a corpus check — which is a licence that expires when a pattern
   is widened. **Which should stage 3b do, and what would make the hoisting option safe rather than
   merely true today?**

6. **Anything wrong in the 300 added lines** — especially the type, the awaiting, error propagation
   through `dispatchAuthRoute`, and whether `AuthRouteContext` leaks anything a handler should not
   have.

## Ground rules

- **Do not modify any file.** Read and reason only.
- You can run `npx vitest run tests/authenticated-api-route-contract.test.ts` — unit lane, no
  database. Anything needing Postgres is mine; I am running `npm run check` in parallel and will hand
  you output if you want it.
- Severity and an ID on every finding: **P0** security/correctness, **P1** a real bug, **P2**
  judgement, **P3** nit.
- Do not manufacture findings. If it is sound, say so and spend your effort on question 5.
