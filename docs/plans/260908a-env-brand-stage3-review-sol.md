## Verdict

**P1 — should not land as written.** The current production type is sound, but both new syntactic guards admit simple false greens. That undermines Stage 3’s central claim that the seam is durably closed.

No P0s.

## Findings

1. **P1 — “reaches `typeof EXPECTED`” does not prove derivation.**

   The alias walk in [tests/env-names-are-inventoried.test.ts:611](tests/env-names-are-inventoried.test.ts:611) proves only that some reachable branch mentions `EXPECTED`.

   I changed the alias in a disposable copy to:

   ```ts
   type ReportedEnvName =
     string | ExpectedRow["name"] | Extract<ExpectedRow, { or: string }>["or"];
   ```

   That makes `value("NEW_ONE")` compile, while:

   - the full typecheck passed;
   - all eight inventory tests passed;
   - the checksum pin remained green because `value` itself was unchanged.

   `string & {}` or `string | (never & ExpectedRow)` give equivalent false greens. The walk is also scope-insensitive because it collects every same-named type alias into one map.

   The declaration count and parameter annotation are useful: they rule out overloads/second entries and tie the function to the named alias. The alias-reach fact is necessary to reject a wholly hand-written union, but it is not sufficient for the claim its assertion makes. This needs exact semantic equality with the union derived from `EXPECTED`, or a deliberately exact fail-closed AST shape—not arbitrary reachability.

2. **P1 — the locator requires a `satisfies` wrapper but never checks what is being satisfied.**

   [expectedArrayLiteral():508](tests/env-names-are-inventoried.test.ts:508) inspects `init.expression` and the `as const` annotation, but never inspects the `TSSatisfiesExpression`’s type annotation.

   In a disposable copy I changed the target to:

   ```ts
   satisfies readonly (Expected & Record<string, unknown>)[]
   ```

   and misspelled `where` as `wher`. The node typecheck and all eight inventory tests passed. The wrappers were both present, but the excess-property protection supplied by `satisfies readonly Expected[]` was gone.

   Requiring this one canonical spelling is defensibly narrow. The problem is looseness: the gate must validate the target is exactly `readonly Expected[]` if that is the guarantee its comments and error message claim.

3. **P2 — the `SPIDERYARN_OWNER_ID` correction describes the public path backwards.**

   [src/vercel-health.ts:404](src/vercel-health.ts:404) and [the plan:503](docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md:503) say public read is the path with no request box, causing a fallthrough to `environmentOwnerId()`.

   Current code explicitly wraps public read in `runInRequest()` at [src/vercel.ts:345](src/vercel.ts:345). It therefore has an **empty box**, and `currentOwnerId()` throws at [src/owner.ts:241](src/owner.ts:241) without consulting `environmentOwnerId()` or `SPIDERYARN_OWNER_ID`. “No box” describes the pre-2026-09-02 bug recorded immediately above that call.

   The consumer list is not exhaustive either: direct calls also exist in `evals/deepen/run.ts`, `evals/debate/run.ts`, `evals/illustrated/run.ts`, and `evals/cost/interactions.ts`, with many more commands reaching it through `withLedger`. Also, ownerless CLI work only refuses when `NODE_ENV === "production"` or `VERCEL` is set; otherwise it uses `DEV_OWNER_ID`.

   Relatedly, [environmentOwnerId()’s own comment](src/owner.ts:256) still claims its sole purpose is the deleted legacy-jobs case. The new correction leaves the tree internally contradictory.

4. **P2 — the Vercel move is correct, but the “one request decided it” argument is too broad.**

   A single production response establishes that this particular function deployment did not receive `VITE_VERCEL_ENV`; it does not by itself establish a platform-wide rule or prove the deployed client bundle contained the right value.

   Fortunately, Vercel documents the general answer directly: framework-prefixed system variables are exposed only during the build, not at runtime. Its Vite documentation separately names `VITE_VERCEL_ENV` as a build-time variable. [Vercel limits](https://vercel.com/docs/limits), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

   Therefore the move to the platform/build-metadata allowlist is right. The prose should cite that platform contract and treat the health fetch as corroboration. Proving this exact client artifact would require inspecting the built asset or a resulting Sentry event, but that is not necessary to justify the inventory door.

5. **P2 — “on `dev`” and “what actually landed” are not currently true.**

   [The plan status](docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md:3) says Stage 3 is on `dev`, but it is uncommitted in branch `worktree-env-names-literal`; `origin/dev` is at `51e186f4`. This becomes a simple post-landing correction, but it is false in the reviewed diff.

## Answers to the remaining attacks

- **The current brand genuinely constrains callers.** `Expected & { name: ReportedEnvName }` narrows `string & ReportedEnvName` to `ReportedEnvName`; it does not let `string` back through. `or`, `names`, both loops, and `names.map(value)` remain narrowed. There is no current widened call path. Strictly speaking it is a literal union, not a nominal TypeScript “brand”.

- **The `with` guarantee is real.** I changed it to `with: "NOT_A_ROW"` and got TS2322 at the assignment to `ROWS`: the preserved literal `"NOT_A_ROW"` is not assignable to `ReportedEnvName`. It is specifically `ROWS`’s `with?: ReportedEnvName` intersection—not `checkEnv` and not `satisfies readonly Expected[]`—that catches it.

- **The postmortem’s stated limit is accurate and is the right limit.** Membership could not have caught 260827b because `SUPABASE_SERVICE_ROLE_KEY` remained present throughout; the stale fact was its consequence. “Inventories names, not consequences” should remain.

- **Independent clean-state checks passed:** full typecheck; 75 tests across the two environment gates and doc-links. Those green checks do not negate the two reproduced false greens above.