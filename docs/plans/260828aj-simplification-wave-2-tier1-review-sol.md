Verdict: one medium test-gate defect, plus three low-risk evidence/documentation issues. I found no unintended reader-facing behaviour change in the built Tier 1 code.

## Findings

1. **Medium — the `.env.local` gate is readily defeatable.**  
   [`envOffence`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/paid-cli-ledger.test.ts:473) accepts any matching call anywhere in `main`, without proving it is reachable or runs before spending:

   ```ts
   async function main() {
     await spend();
     loadEnvLocal(); // too late, but passes
   }
   ```

   `if (false) loadEnvLocal()` and a call after `return` also pass. Destructuring can evade the shadow check. The eight real CLIs currently call it in time, including [`pdf-read.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:1325), so this is a false guarantee rather than a present leak. The simple enforceable rule is a direct `loadEnvLocal()` expression before the first other executable statement in `main`.

2. **Low — three refused-write tests overclaim what they prove.**  
   The DELETE tests begin with empty lists, so they cannot prove the row does not “look deleted” ([comments](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/refused-writes-are-reported.test.tsx:216), [search](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/refused-writes-are-reported.test.tsx:302)). The implementations remove rows optimistically and do not restore them on refusal ([comments](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useComments.ts:585), [search](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useSearch.ts:462)); they now report the failure, which is the real guarantee. Likewise, recolouring intentionally remains optimistic after failure ([useSearch.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useSearch.ts:410)). Rename those tests or seed rows and assert the intended state explicitly.

3. **Low — Vercel’s variables are not unconditionally exposed.**  
   The code is correct when the system variables are available, but the comment’s “with no configuration” is too broad. Vercel documents an “Automatically expose System Environment Variables” project setting, although newer projects enable it by default. It confirms that `VERCEL_URL` is the deployment host and `VERCEL_PROJECT_PRODUCTION_URL` remains the production host even in previews. [Vercel documentation](https://vercel.com/docs/environment-variables/system-environment-variables). This project’s pulled environment contains `VERCEL_URL`, so the current project appears covered.

4. **Low — `fetchOk` has seven call sites, not six, and one exact duplicate remains.**  
   [`writeThread`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/effects.ts:280) is precisely `apiFetch` followed by the same non-2xx check, with every non-2xx treated as failure. It could use `fetchOk` without changing behaviour.

## The eight answers

1. **`stripFence`: pure dedup.** I found no differing input. The two old forms are equivalent because the initial `trim()` removes trailing whitespace; if the closing fence matches, one version consumes preceding whitespace in the regex while the other removes it with the final `trim()`. I additionally compared 960,800 short generated strings and over 3.3 million Unicode-containing cases without disagreement.

2. **`readJsonOrNull`: safe, with one wording correction.** `JSON.parse` does throw internally; the exception is caught and discarded. The sound invariant is “it never escapes or reaches a logger,” not “the error is never built.” [`api.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:100) and [`store/import.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:155) are correctly excluded because corrupt and absent have different meanings there.

3. **`pgReady`: parameterisation preserved all 32 probes.** I found no mismapped table, column, grant, pool size, or retained pool. `information_schema.columns` can produce the right skip with the wrong “migrate” diagnosis for a restricted role. That is low risk for the local/admin test role, but `pg_catalog.pg_attribute` would distinguish physical absence from privilege. Connection use has not increased: every migrated file already opened its own pool. The helper centralises probes; it does not create one shared pool. Concurrent Vitest sessions can still saturate Postgres.

4. **`fetchOk`: no included status changed from an answer into an error.** Six converted sites already threw on non-2xx; the shelf rebuild newly reports its previously ignored refusal, intentionally. Streaming, ordinary-status, and foreign-fetch exclusions are sound. `writeThread` is the one missed pure dedup.

5. **`ownOrigins`: security direction is safe, content direction is not free.** A false positive strips an attribute rather than permitting a request. It can still remove something the reader wanted—for example, an article deliberately linking to Spideryarn’s public production API while viewed on preview. Under the stated rule that article content may not address any of your API hosts, that is intended policy, including production URLs on preview.

6. **The AST rule can be defeated** by late, unreachable, or destructuring-shadowed calls. This is the weakest claimed evidence.

7. **Deleting the stale `JobStore` was right.** The implemented, owner-scoped contract superseded it, and keeping two incompatible interfaces would be worse than deletion. The struck historical decision and explanation in [`260826m-simplification-audit.md`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260826m-simplification-audit.md:535) is the right record.

8. **Weakest claim:** the `.env.local` detector’s “what `main` actually runs” claim. Second weakest is the refused-write suite’s visual-state wording. The deleted untracked scratch files are also inherently unreconstructable from Git, though that has little product risk.

Targeted verification passed: 5 files, 81 tests. I made no edits.