## Recommendation

Build a **hybrid: A for ordinary reads, plus narrow executable contracts for the genuinely dynamic mechanisms**. Do not revive the 1,754-line candidate, and do not close the item as not worth building.

The key boundary should be:

> Application configuration is read only through two literal AST forms. Everything else is refused unless it is one of a handful of individually checked mechanisms.

That gives a roughly **250–400-line change across 8–10 files**, most of it tests. It can make all nine P1 attacks fail without implementing general binding resolution or alias propagation.

One important limitation remains: this inventories names; it would not have caught the original upload incident, where the name was already in `EXPECTED` but its `breaks` consequence was wrong. The postmortem now says that correctly at [260827b-health-check-green-while-uploads-dead.md:346](../../docs/postmortems/260827b-health-check-green-while-uploads-dead.md:346).

### Source corrections

- **P2-1 — the supplied non-literal-read table is incomplete.** [sanitize-policy.ts:382](../../src/sanitize-policy.ts:382) aliases `(globalThis as …).process?.env`, then reads `SPIDERYARN_ORIGINS`, `VERCEL_PROJECT_PRODUCTION_URL`, and `VERCEL_URL` at lines 384–390. The first two are absent from both inventory doors. This is the real-tree instance behind F16.
- **P3-1 — `fetch.ts` has two `seen()` call sites, not three.** Both are on [fetch.ts:603](../../src/fetch.ts:603).
- **P3-2 — the suggested `SPIDERYARN_OWNER_ID` consequence is stale.** [vercel-health.ts:393](../../src/vercel-health.ts:393) talks about legacy jobs and “every request”; current authenticated requests deliberately ignore the environment owner, and queued jobs carry their owner themselves.

## 1. A, B, hybrid, or neither?

Hybrid, weighted strongly toward A.

| Route | Approximate cost | Structural protection |
|---|---:|---|
| A exactly as currently described | 160–220 lines, 5 files | Removes alias-resolution failures such as F17/F20, but leaves reporter F12/F18/F19, `env.ts` F13, and the omitted sanitiser path |
| B | 400–650 lines, probably 1–2 test files | Avoids changing production, but replaces one resolver with many bespoke site resolvers; only F17/F20 disappear inherently |
| Recommended hybrid | 250–400 lines, 8–10 files | All nine attacks have a direct red path, without general alias or scope analysis |
| Neither | 0 | Leaves the next name free to drift; the trawl has already demonstrated that this is not hypothetical |

For the ordinary cases:

- Make [jobs.ts:441](../../src/jobs.ts:441) and the three [hierarchy-deepen.ts](../../src/hierarchy-deepen.ts:1641) reads literal.
- Make `fetch.ts` pass literal values into its formatting helper, rather than letting the helper read the environment.
- In [supabase.ts:33](../../src/web/lib/supabase.ts:33), build a local object from two literal `import.meta.env.VITE_…` reads; `required(name)` can continue indexing that ordinary object.
- Keep `models.ts` computed, but make `MODEL_ENV_VAR` `as const satisfies Record<Task, string | null>` and compare its actual runtime values with the model-override allowance.
- Treat `vercel-health.ts`, `env.ts`, and `sanitize-policy.ts` as explicit mechanisms described below.

This is not production code contorted solely for a test. It makes a module’s configuration dependencies locally visible and greppable. The named constants can remain where tests and log messages need them; the functional tests already protect the important constant/read agreement.

## 2. `src/env.ts`

Do not restructure it so the environment never travels as a value. That file’s job is precisely to merge and forward a general environment:

- [env.ts:85](../../src/env.ts:85) snapshots every inherited value.
- [env.ts:336](../../src/env.ts:336) handles names originating in `.env.local`.
- [env.ts:287](../../src/env.ts:287) forwards almost the whole environment to Git.

Trying to literalise those operations would either be dishonest or reimplement `process.env`.

Instead:

1. Pull the two source-authored names out at the boundary.

   - Read `process.env.SPIDERYARN_ENV_PINNED` literally in `loadEnvLocal`, parse it, and pass the resulting set into `applyEnvFile`. `pinnedNames` should parse a string, not discover a fixed variable through an injected environment.
   - Snapshot `process.env.DATABASE_URL` separately at module load, then have `chooseTargetUrl` accept the inherited and current URL strings rather than two environment records.

2. Leave three exact whole-object acquisitions:

   - the `INHERITED` spread;
   - the environment passed to `applyEnvFile`;
   - the environment passed to `withoutGitVars`.

3. Check those three exact sites, not the whole file or whole functions.

4. Add a small `env.ts`-specific structural rule:

   - In `applyEnvFile`, `env` and `inherited` may be indexed only by the loop’s `name`; fixed dot properties, string keys, aliases, or calls such as `pinnedNames(env)` are refused.
   - In `withoutGitVars`, the argument may only be spread into the copy that has the four literal `GIT_*` names deleted.

That keeps the genuinely dynamic names outside the inventory—they originate in file text—while forcing every source-authored fixed name into the literal inventory. It directly closes F13 without attempting general data-flow analysis. This modest restructuring is worth roughly 30–60 changed lines including tests; a complete “environment stops travelling” rewrite is not.

For [sanitize-policy.ts:378](../../src/sanitize-policy.ts:378), use another narrow site contract. Its dual Node/browser access is legitimate. The contract should enumerate its three literal properties and refuse aliases or computed properties inside `ownOrigins`. Classify `VERCEL_PROJECT_PRODUCTION_URL` as platform-provided and `SPIDERYARN_ORIGINS` as the optional custom-domain override described in [.env.example:231](../../.env.example:231).

## 3. Where the refusal line should sit

Absolute semantic soundness is not achievable for arbitrary JavaScript. Code can manufacture `"process"` through concatenation, `eval`, `Function`, a proxy, or an imported module. A finite AST recogniser cannot prove the absence of every possible environment read.

A sound, practical repository syntax policy is achievable. Parse every source file—no text prefilter—and accept only:

1. `process.env.NAME`

   - both `process.env` and `.NAME` are non-computed;
   - `process` is the bare identifier;
   - `NAME` is an identifier.

2. `import.meta.env.NAME`

   - the meta-property is exactly `import.meta`;
   - both `.env` and `.NAME` are non-computed;
   - `NAME` is an identifier.

Nothing else belongs in the generic recogniser. In particular, refuse brackets, optionality on the roots, destructuring, aliases, template literals, `Reflect.get`, imported `node:process`, and whole-object use.

Count the literal member whenever it occurs, irrespective of whether it is on an assignment target. That deliberately over-inventories writes and makes F17 impossible; there is no read-versus-write classifier to get wrong.

The refusal pass should reject:

- every `process` identifier not occupying the exact accepted position;
- imports from `process` or `node:process`;
- every `import.meta.env` not ending in a literal non-computed property;
- explicit `globalThis.process` access outside its named mechanism.

This sends all the round-one spellings and both F16 attacks red. `new.target.env.NOT_AN_ENV` remains green, correctly, because it contains neither environment door.

The computed exceptions should not broaden those accepted forms:

- `MODEL_ENV_VAR` is checked from the real runtime record.
- The reporter should derive primary names from actual `EXPECTED.name`/`or` values, not parse its source. Require every `with` value to be in that primary set.
- Give the reporter accessor a branded `ReportedEnvName` accepted only from that derivation. Then `value("NEW_VARIABLE")` and `value(injectedExpected.name)` are type errors, closing F12/F19 without lexical analysis.
- Exact mechanism contracts cover `env.ts` and `sanitize-policy.ts`.

Against the control spec at [260907e-small-uncontested-postmortem-preventions-batch.md:692](../../docs/plans/260907e-small-uncontested-postmortem-preventions-batch.md:692):

- F10, F11, F16: refused at the syntactic boundary.
- F17: literal counted regardless of read/write position.
- F12, F18, F19: real `EXPECTED` data, subset invariant, and branded reporter argument.
- F13: fixed names extracted before the dynamic mechanism.
- F20: no alias-following exists.
- F21 remains correctly non-environmental.
- F22’s fixed point disappears entirely.

## 4. `import.meta.env`

It is the same naming problem but a different operational contract.

The syntax checker should treat both doors identically: a source-authored name must be literal and classified. But client names should not all be governed by server-runtime `EXPECTED`:

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are required build inputs. [build-stamp.ts:128](../../scripts/build-stamp.ts:128) already fails the build when they are absent. That is stronger and more truthful than `/api/health`.
- `VITE_SENTRY_DSN` and `VITE_VERCEL_ENV` are optional build-time client configuration. They may remain visible in health, but health cannot prove what the running bundle contains; [vercel-health.ts:474](../../src/vercel-health.ts:474) already admits this.
- `PROD` and `MODE` are Vite-provided constants, not environment-variable names, and belong in a deliberate built-in exclusion.

So use one source sweep but three destinations: server `EXPECTED`/allowances, required client-build inputs, and optional/built-in client names.

## 5. `SPIDERYARN_OWNER_ID`

Keep `breaks: null` for now.

[environmentOwnerId()](../../src/owner.ts:270) throws only when somebody actually asks for an environment owner. It is not a boot requirement. Inside an authenticated request, [currentOwnerId():237](../../src/owner.ts:237) returns the request owner and explicitly gives the environment no vote.

The direct `src/` consumer is the CLI spending ledger at [cli-ledger.ts:108](../../src/cli-ledger.ts:108); scripts and evals also use it. Ordinary queued jobs carry their owner and re-enter it explicitly. Therefore a legitimate authenticated, request-only deployment can serve correctly without this variable, while ownerless stage/CLI/eval operations would refuse.

The actual Vercel deployment has it configured, as recorded at [deployment.md:1107](../../docs/project/deployment.md:1107). Promote it only if the product contract becomes “every production deployment must support ownerless CLI/stage operations.” If promoted, the truthful consequence is about those operations—not legacy jobs or every request.

No files were changed.