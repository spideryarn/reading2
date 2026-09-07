Do not build the draft as written. The ordered closure table itself is defensible—and I prefer it to fourteen `Promise<boolean>` dispatchers—but Stage 1 does not yet prove what it claims, and the staging inventory contains material errors.

Greg’s newer explicit request supersedes the old “Tier 3 / refused” decision, so I would not abandon the work altogether.

## Findings

- **P1-ORACLE-LIVE — The all-path proof is incomplete.** The frozen AST manifest can establish selection equivalence for every path string, but only if the live implementation is reduced to the same manifest and the production dispatcher demonstrably uses exactly those fields: unchanged `path`, strict method equality, exact predicate or identical regex source/flags, and raw captures. The draft specifies extraction from the frozen original but not the equivalent live-table comparison. The finite corpus cannot fill that gap.

  The proof also assumes—and should assert—that all guards are top-level, every handled arm terminates, matcher bindings are not reassigned or shadowed, and method mismatch continues. Those facts are true today.

- **P1-HANDLER-IDENTITY — The handler-swap mutation is erased by the proposed instrumentation.** Replacing each body with an observation generated from its guard identity means swapped bodies still report their original guard identities. An `id` beside an inline closure has the same weakness. Either define independent handler provenance/body comparison, or remove that mutation and state honestly that the harness proves selection and captures, not that the right semantic body remains attached.

- **P1-ORDER-CONTRACT — “Original guard order” and domain grouping conflict.** `shelfOpen` is declared with library at [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:6626) but handled after models, feedback, and reader at [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:7184). Jobs/uploads are likewise interleaved. Conversely, reader GET and PATCH are already consecutive; the original plan’s claimed reader interleave was false. Either preserve global order or explicitly permit permutations after proving every reordered same-method predicate pair disjoint.

- **P1-LIFETIME-CONTROL — The highest-risk async regression is untested.** `[LIFETIME]` is correct: the collector surrounds awaited `serveApi` at [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:6258), which awaits authenticated dispatch at [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:6401). But body replacement erases whether real closures forward their promises. Add a deferred-handler test proving dispatch remains pending until the selected handler settles; watch removal of the dispatcher `await` go red. `similar` and `projection` deserve explicit coverage because their unusual returns are at [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:7477) and [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:7515).

- **P1-DECODE-CONTROL — `[DECODE]` is right but Stage 1 cannot protect it.** I reproduced without Postgres:

  - malformed JSON plus `PUT /api/article/%/visibility` → 400, body parsing wins;
  - the same malformed inputs with `PATCH /api/library/%` → 500 `URI malformed`, slug decoding wins.

  Add those two cases and mutate the order. Moving bodies into closures is exactly when this observable distinction could change.

- **P1-SOURCE-INVENTORY — Stage 2 inventories the wrong problem.** There are five relevant source readers, not four. Only `cacheable-covers-artefact-routes` silently shrinks its universe via `.filter(...)` at [cacheable-covers-artefact-routes.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/cacheable-covers-artefact-routes.test.ts:132). `referee-scan-route`, `owner-isolation`, and `source-store` already have loud presence controls; the latter two inspect `sendSource`, not dispatch syntax. The omitted fifth reader is [embedding-route-failures.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/embedding-route-failures.test.ts:103). Stage 2 should classify all five and say how each survives Stage 3, ideally consuming the new registry/manifest rather than adding more greps.

- **P2-SHAPE-OVERRIDE — The reading of 260906h is not fair.** It explicitly rejected a per-route table; it did not reserve “table” for declarative shared behavior. A closure registry is still a table driving selection. Present this as an intentional override justified by Greg’s request and by one centralized handled/miss protocol. The public dispatcher’s `false` warning concerns a security-boundary fallthrough, so it is not exactly the same risk, though fourteen boolean protocols remain unattractive.

- **P2-STATIC-CONTRACT — Specify the table’s actual type.** Static handlers cannot close over per-request `user`, `req`, `res`, `query`, or match arrays. Use a discriminated exact/regex entry type, pass a request context and raw `RegExpExecArray`, perform no decoding in dispatch, and require `await handler(...)` followed by unconditional return. Registration construction must be side-effect-free.

- **P2-STATE-STAGING — The lock rationale names the wrong domains.** Relevant registries are comments `answering`, chat `streaming` and `turnOrder`, search `searching`, referee `refereeing`, and claims `pullingClaims`: six, not four. None makes an in-file table conversion materially harder because the existing helpers continue using the same module state; they matter during a later file split. Reassess after one easy domain and one streaming/stateful domain, not merely after two easy transcriptions.

- **P2-HTTP-SCOPE — The 404 claim needs qualification.** After authentication and authorization, method mismatch reaches the sent 404 at [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:8178), with no 405 or `Allow`. A non-admin request under `/api/admin[/…]` gets 403 first, and an anonymous request gets 401. Public routes and the Stripe webhook have separate 405 behavior.

- **P2-ISOLATION-SCOPE — Constraint 9 overstates its test.** `owner-isolation` examines `serveApi` with the authenticated handoff removed; it does not inspect `serveAuthenticatedApi`, nor module-scope registration evaluation. Preserve the existing guard, but add the separate invariant that building the static registry invokes no handler or imported service.

- **P3-METRIC — “27 conditionals” is imprecise.** It is exactly 27 nested `if` statements; there are also seven conditional expressions. This does not affect the routing conclusions.

## Verified claims

The central inventory is correct: 67 endpoint matchers—51 unflagged regexes and 16 exact predicates—and 81 guards. Every guard is exactly `matcher && req.method === "<literal>"`, and every arm terminates.

The universal overlap claim is also correct. The only intersections between distinct matchers are:

- `/api/library/search`: GET search versus PATCH shelf entry.
- `/api/chat/:slug/live-tool`: POST live tool versus PATCH/DELETE thread.

The same-method `jobAction`/`jobAdvance` shapes are disjoint because `cancel|retry` cannot equal `advance`. Therefore swapping the library guards is behaviorally equivalent and useless as a mutation control.

`[URL]`, `[DECODE]`, `[LIFETIME]`, `[RETURN]`, and `[REGEX]` are substantively correct. `[GATE]` needs the nuance that all matchers are currently computed before the admin refusal; only route selection happens afterwards.

## Recommendation

Keep the static ordered closure table, but revise Stage 1 to:

1. Materialize a generated frozen baseline manifest rather than depending indefinitely on `git show`.
2. Extract the live table into the same normalized representation.
3. Compare matcher, method, captures, identity, and permissible ordering bidirectionally.
4. Test the generic dispatcher with synthetic same-method overlaps and a deferred handler.
5. Add the two decode-order cases.
6. Remove the impossible body-swap mutation unless handler provenance is independently defined.

A corrected Stage 1 is a defensible successful stopping point, though it would not itself complete Greg’s refactoring request. For Stage 3, one-domain-per-commit remains sensible; reassess after one simple and one genuinely awkward domain.

I ran the offline `public-dispatch` suite: 28/28 passed. No database-backed result is asserted, and I do not need additional Postgres output for this review.

One workspace warning: while I was reviewing, another process committed a rewritten plan as `c916e1b5` and left `tests/cacheable-covers-artefact-routes.test.ts` modified. Neither I nor my review agents changed files. The rewritten plan accepts several corrections above, but its unordered hand-written route set loses route order/identity and still needs review before being treated as green.