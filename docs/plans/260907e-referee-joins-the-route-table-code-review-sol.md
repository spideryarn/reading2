Verdict: the route move itself is behavior-preserving. I found no runtime difference in the eight handlers, matchers, capture handling, dispatch order, or stream lifetimes. Two follow-up defects remain in the new safeguards/documentation.

### Findings

- **P1 — the `requireUser` assertion can silently stop checking its ordering claim.** The test counts every identifier-shaped `requireUser()` call in the module, rather than the imported binding inside `serveApi`, and locates the handoff using `source.indexOf(...)` ([authenticated-api-route-contract.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/tests/authenticated-api-route-contract.test.ts:1947)). If the exact text `serveAuthenticatedApi(user` disappears through formatting or renaming, `indexOf` returns `-1`; `slice(0, -1)` then makes the “handoff” effectively EOF, and the ordering assertion passes. It also does not establish the test title’s “inside `serveApi`” claim. Locate both calls as AST nodes inside `serveApi`, assert exactly one of each, and compare their positions there. Current production code is correct—one gate at `routes.ts:6404`, immediately above the handoff at `:6411`—so this is a defective security rail, not a behavior regression in this move.

- **P2 — several comments now state the pre-move arrangement, including the comment that directs the next move.** The table documentation still says it contains thirteen guards and that the next slice belongs above jobs ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/src/routes.ts:6647)); it now contains twenty-one and the next slice belongs above referee. It also still says fourteen shared matchers remain in the chain ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/src/routes.ts:6601)). The contract header omits referee and overstates `assertHandlersAwaited` as sufficient to prevent a stream outliving its request ([contract header](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/tests/authenticated-api-route-contract.test.ts:36), [await assertion](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/tests/authenticated-api-route-contract.test.ts:1115)). The lifetime test still says referee is next and “still in the chain” ([referee-stream-lifetime.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/tests/referee-stream-lifetime.test.ts:8)). These should be corrected because the ordering comment is operational guidance, not historical decoration.

### Behavior-preservation checks

- All five regexes are character-for-character identical.
- The eight rows are prepended above jobs in their original guard order.
- Every slug capture still uses `slugPart(captures, 1)`; only criterion IDs retain `part(captures, 2)`.
- `EXPECTED_AUTH_ROUTES` hashes identically before and after Stage 2.
- All thirteen exported names are identical.
- The scan test’s new regex currently cuts exactly the scan handler: it contains the ownership read before `scanArticleSource`, excludes `withSpendAttribution`, and does not spill into claims or mirror.
- I found no remaining source reader that expects these referee guards to remain in the chain.
- The namespace comment and the scan/mirror row-specific rationales are appropriately placed.

The normalizer is supporting evidence, not sufficient proof by itself. Its implementation and captures were not retained, so “whitespace collapsed” cannot be audited for token awareness; a naïve collapse could erase behavior-changing whitespace inside strings or at an ASI-sensitive newline. Ignoring ordinary comments is acceptable for the narrow runtime verdict, but not for documentation integrity—as the stale comments above demonstrate. Direct inspection of the raw diff nevertheless confirms the permitted substitutions only.

Mutation 4 is correctly interpreted: it proves `assertHandlersAwaited` checks the dispatcher’s `await`, not whether a closure launches and abandons its own promise. The red lifetime test therefore justifies a separate behavioral lifetime oracle, though not necessarily that exact implementation as the only possible one.

Typechecking passed across all 1,533 source files. I could not independently rerun the focused tests because this sandbox is forbidden from connecting to local Postgres (`EPERM 127.0.0.1:54362`); the harness failed before collection rather than reporting a partial green.