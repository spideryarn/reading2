## Verdict

**P1 — should not land.** Both original holes remain exploitable. No P0s.

## Findings

1. **P1 — the sentinel tests one sample, not the required property.**

   In [src/vercel-health.ts:550](src/vercel-health.ts:550), I changed:

   ```ts
   type ExpectedRow =
     | (typeof EXPECTED)[number]
     | { name: "NEW_ONE"; or: "NEW_TWO" };
   ```

   Results:

   - every `ReportedEnvName` union member still syntactically reaches `typeof EXPECTED`;
   - `"SPIDERYARN_NOT_A_REPORTED_NAME"` remains excluded;
   - `"NEW_ONE"` and `"NEW_TWO"` are admitted;
   - all eight inventory tests pass;
   - all four TypeScript projects accept it.

   Thus the requested widening inside `ExpectedRow` defeats both checks simultaneously. The compiler assertion must ask the property—semantic subset/equality against the name union derived directly from `(typeof EXPECTED)[number]`—rather than test one arbitrary literal.

2. **P1 — checking the name `Expected` still does not check what it means.**

   The locator at [tests/env-names-are-inventoried.test.ts:526](tests/env-names-are-inventoried.test.ts:526) accepts the exact spelling while trusting the declaration behind it.

   I added an index signature to `interface Expected`:

   ```ts
   [key: string]: unknown;
   ```

   and changed `where` to `wher`. The initializer remained exactly:

   ```ts
   satisfies readonly Expected[]
   ```

   All eight inventory tests and all TypeScript projects passed. Excess-property protection was gone.

   Of the suggested cases:

   - `Expected[]` is correctly refused: it drops the readonly guarantee and permits mutation.
   - A widened interface named `Expected` is the real accepted hole.
   - A type argument is refused, and the current non-generic interface would reject it independently.
   - Equivalent spellings such as `ReadonlyArray<Expected>` may be deliberately refused by this canonical, fail-closed design.

3. **P2 — Vercel does document the runtime boundary.**

   The current prose says the documentation does not settle this, but Vercel’s limits page explicitly says framework-prefixed system variables are available during build and not runtime. Its Vite page describes `VITE_VERCEL_ENV` specifically as available during the build process. [Vercel limits](https://vercel.com/docs/limits), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

   The narrow deployment-specific argument does carry the door by itself, but the stronger platform contract exists and should replace the now-false “documentation does not say” passages.

4. **P3 — `environmentOwnerId()`’s comment miscounts the direct eval callers.**

   [src/owner.ts:262](src/owner.ts:262) says “the four eval runners,” while the corrected list in `vercel-health.ts` names five eval files: cost/run, cost/interactions, debate, deepen, and illustrated. The substantive description—readerless work, `withLedger` as the common route, and production-only refusal—is correct.

P2-5’s landing-state wording is acceptable. Clean-state targeted tests also passed: 22/22 across inventory and doc-links.