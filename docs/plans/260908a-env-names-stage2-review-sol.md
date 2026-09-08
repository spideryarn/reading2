Stage 2 should not land as it stands. Two core derivations can fail open, and one environment name is pinned to a door using a fact contradicted by Vercel’s current documentation.

## Findings

1. **P1 — `EXPECTED` property spreads are silently ignored.**  
   [tests/env-names-are-inventoried.test.ts:367](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/tests/env-names-are-inventoried.test.ts:367)

   `rowFrom()` skips every property that is not an `ObjectProperty`. That includes `SpreadElement`, despite the surrounding text claiming unreadable shapes are refused. For example:

   ```ts
   const alternative = { or: "ANTHROPIC_API_KEY" };
   { name: "OPENROUTER_API_KEY", breaks: null, ...alternative }
   ```

   The runtime table contains the `or`; this parser returns only `OPENROUTER_API_KEY`. If the alternative is read outside `src/`, every assertion stays green: it never reaches either the orphan check or `READ_OUTSIDE_SRC`. The same hole can conceal a real two-door overlap. Reject every non-`ObjectProperty` in the row rather than continuing.

2. **P1 — door 2 is derived from a helper, not from the build that is claimed to enforce it.**  
   [tests/env-names-are-inventoried.test.ts:481](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/tests/env-names-are-inventoried.test.ts:481)  
   [vite.config.ts:394](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/vite.config.ts:394)

   Today `vite.config.ts` calls `missingClientEnv(process.env)`, so the derived set happens to be right. But nothing asserts that connection. Removing that call from `buildStart()` leaves this inventory and `tests/build-stamp.test.ts` green while builds no longer refuse either missing input. The worked-example assertion at line 603 would still claim “the build still refuses without it” because it only interrogates the now-dead helper. Pin the call site or exercise the Vercel build hook.

3. **P1 — `VITE_VERCEL_ENV` is classified and justified using a false platform claim.**  
   [tests/env-names-are-inventoried.test.ts:121](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/tests/env-names-are-inventoried.test.ts:121)  
   [src/vercel-health.ts:424](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/src/vercel-health.ts:424)  
   [vercel.json:3](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/vercel.json:3)

   The new test says Vercel does not provide `VITE_VERCEL_ENV` and a person must configure it. Vercel says framework-prefixed variables are added automatically for production and preview builds, explicitly lists `VITE_VERCEL_ENV`, and this project selects the `vite` preset. [Vercel framework environment variables](https://vercel.com/docs/environment-variables/framework-environment-variables), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

   Therefore the test is green over a factually wrong door decision inherited from `EXPECTED`. It is platform-provided build metadata, not ordinary operator configuration; `/api/health` also cannot establish what was compiled into the running bundle. It belongs in a platform/build-metadata allowlist group, not `EXPECTED`.

4. **P2 — `READ_OUTSIDE_SRC` does not actually require a reason.**  
   [tests/env-names-are-inventoried.test.ts:569](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/tests/env-names-are-inventoried.test.ts:569)

   The code checks only key membership. `{ ANTHROPIC_API_KEY: "" }` would satisfy all three assertions despite the header and plan promising a written reason. Unlike `ALLOWED`, no minimum nonblank check exists. None of the five mutations exercised this case.

5. **P2 — `SPIDERYARN_ORIGINS` fits the test’s own definition of `EXPECTED` better than its allowlist definition.**  
   [tests/env-names-are-inventoried.test.ts:198](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/tests/env-names-are-inventoried.test.ts:198)  
   [src/sanitize-policy.ts:347](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/src/sanitize-policy.ts:347)  
   [.env.example:231](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/.env.example:231)

   The justification confuses “health cannot determine whether it is required” with “an operator would not act on it.” A `breaks: null` row makes no requiredness judgment; it reports presence, exactly as the `EXPECTED` header describes. The operator is the party who knows whether additional domains are attached and can set the override, and omission weakens the server half of a security defence. I would put it in `EXPECTED` with `breaks: null`. Do not alter `ownOrigins()`.

   `VERCEL_PROJECT_PRODUCTION_URL`, by contrast, is correctly allowlisted: Vercel supplies it as system metadata and chooses the project’s production domain. [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

6. **P2 — the failure message incorrectly closes the Vite-built-in door forever.**  
   [tests/env-names-are-inventoried.test.ts:446](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/tests/env-names-are-inventoried.test.ts:446)

   It says there are two Vite constants “and there will not be a third.” Vite already defines five: `MODE`, `BASE_URL`, `PROD`, `DEV`, and `SSR`. If `src/` later reads `DEV`, the correct remedy is to add it to this door, but the guard explicitly tells an unfamiliar reader that this cannot be correct. [Vite built-in constants](https://vite.dev/guide/env-and-mode.html).

   Apart from that sentence, the failure presents the four questions clearly and does not default to `EXPECTED`.

7. **P3 — the landed narrative disagrees with itself about the justification audit.**  
   [tests/env-names-are-inventoried.test.ts:86](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/tests/env-names-are-inventoried.test.ts:86)  
   [plan:354](/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal/docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md:354)

   The test says two ported reasons failed re-checking; the plan enumerates three. The plan then says Sol had already corrected three cases, while the test and candidate identify four groups—the model-override group is omitted. This does not weaken the gate, but “what actually landed” is not an accurate record.

## Checks that held

The `EXPECTED_AND_BUILD_REQUIRED` intersection is genuinely two-directional: undeclared actual overlaps fail, and every declared name must remain in exactly `EXPECTED` plus build-required. The two Supabase names are the right declared overlap.

I reran both stage tests: 60/60 passed. That green result does not cover the parser-spread, dead-helper, or blank-`READ_OUTSIDE_SRC` cases above. Because findings 1–3 are P1s against the gate’s central claims, Stage 2 should not land unchanged.