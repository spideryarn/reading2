# Review findings

## P0

None.

## P1

None.

## P2

None.

## P3

### Chain-era commentary contradicts the finished table contract

- File: [tests/authenticated-api-route-contract.test.ts:2219](/home/greg/code/spideryarn2/.claude/worktrees/g-close-transition/tests/authenticated-api-route-contract.test.ts:2219), with another stale reference at [line 1526](/home/greg/code/spideryarn2/.claude/worktrees/g-close-transition/tests/authenticated-api-route-contract.test.ts:1526).
- Concrete failure: the comment says route order is not asserted and reordering is equivalent, but [line 1854](/home/greg/code/spideryarn2/.claude/worktrees/g-close-transition/tests/authenticated-api-route-contract.test.ts:1854) now pins all 82 rows in historical order because the overlap check is finite rather than proof. A maintainer following the stale explanation could remove the order oracle or “tidy” the table; an unprobed overlap would then dispatch to the wrong first-match handler. Line 1526 likewise says the extractor still accepts both chain and table forms, although chain guards are now refused.
- Fix: describe the finished state: every route is a table row, historical order is pinned separately, and current corpus-disjointness is not permission to reorder. Make the chain-reader discussion explicitly historical or remove it.

## Verification and limitations

- Independently extracted the 33 guards from `6bc0c60a`: all 33 current prefix rows match their original method, matcher, and order. The remaining 49-row suffix is unchanged.
- Confirmed the admin gate at [src/routes.ts:8904](/home/greg/code/spideryarn2/.claude/worktrees/g-close-transition/src/routes.ts:8904), the sole table dispatch at [line 8930](/home/greg/code/spideryarn2/.claude/worktrees/g-close-transition/src/routes.ts:8930), and the terminal 404 at [line 8950](/home/greg/code/spideryarn2/.claude/worktrees/g-close-transition/src/routes.ts:8950).
- Re-ran all four body-purity comparisons: each reported `the move is a move`.
- Scope analysis found no moved handler resolving an old dispatcher-local name through a same-named module binding.
- Contract and artefact-cache suites: 340/340 passed.
- Typecheck: all four projects passed via `node scripts/typecheck.ts`. The npm wrapper itself could not open tsx’s IPC pipe in the sandbox.
- The two lifetime suites could not run because the sandbox cannot connect to local Postgres (`EPERM 127.0.0.1:54362`). Static inspection found their gates route-specific and their failure assertions read response state captured at settlement.