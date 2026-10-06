# An exact inventory check silently narrows its universe

Found in the code review of [261006h](../plans/261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md).
Introduced by `a7813247055b3aa899e91aeb03fded8a3b3b59d8`, in the new inventory assertion
in `tests/api-fetch-offline.test.ts`. No production mismatch was found.

The test promised equality between wrapped routes and the offline exclusion pattern, but filtered
out route declarations it could not recognise before comparing names. A new wrapped GET with a
different slug regex disappeared from its universe. In the other direction, checking the offline
pattern against known names never examined an extra alternative with no corresponding route.
Both regression fixtures passed the old guard; tests expecting their rejection went red first.
A read-only subagent independently confirmed this cause.

The class is **an exact inventory check silently narrows its universe before comparing it**.
The problem is the unchecked derivation, rather than either current production list.

## Countermeasures, ranked by ease against value

1. **Account independently for every helper call and check the entire offline expression.** Applied
   narrowly in this review: the existing shared AST walker counts actual calls, excluding comments;
   each call must fall in a recognised GET entry, and unmatched calls fail the total check. A
   comment cannot compensate for a missed real call elsewhere. The regexp's complete
   shape and alternatives are checked, allowing alternative reordering. Three negative fixtures pin
   the guard itself. Small change, immediate protection.
2. **Share a parsed route inventory.** The longer-term design is the checked `AUTH_ROUTES` inventory
   already in `tests/authenticated-api-route-contract.test.ts`, reused by all consumers. That would
   remove the lexical scanner's formatting restrictions. Broader than this seven-read stage.
3. **Generate routes and cache rules from one registry.** Rejected here: handlers have different
   surrounding behaviour, and restructuring them to repair a test adds unnecessary production risk.

The adjacent `tests/cacheable-covers-artefact-routes.test.ts` discusses the same shrinking-universe
problem. Its wider scanner refactor remains outside this review.

Up: [postmortems.md](../project/postmortems.md).
