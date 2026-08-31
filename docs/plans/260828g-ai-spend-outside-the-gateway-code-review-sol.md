# NO-SHIP

The declared bypass idea is sound, and the judge may stay there. The implementation still has several paths that lose or misstate spend.

## Blockers

1. **The wrapper can spend without a persistent collector.**  
   [`withDeclaredExternalCall`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/declared-spend.ts:138) never verifies that a ledger sink exists. [`beginSpend`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:495) returns `null` outside a collector, then [`recordSpend`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:671) warns and discards the row. I reproduced a completed declared call with `unscopedCalls() === 1`. Require a collector with a persistent sink before invoking `fn`; merely checking `collectingSpend()` is insufficient because collectors may have no sink.

2. **Declarations grant blanket permission to files, not individual calls.**  
   [`declaredFiles.has(file)`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/no-undeclared-spend.test.ts:237) exempts every present and future capability in that file. Nothing verifies that an ID is used in its declared file, or exactly once. Another file can import `anthropicForDeclared`, reuse an existing ID, and evade every matcher.

   This is already stale: [`bench-vocabulary-sources.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/dictation/bench-vocabulary-sources.ts:296) now calls the real metered `transcribeWith`, but opens no ledger. Its declaration still passes because the file merely names the credential. It should use `withLedger`, then lose its declaration.

   The root `scratch-*` exemption also hides the exact [`scratch-tok2.mts`](/Users/greg/Dropbox/dev/experim/spideryarn2/scratch-tok2.mts:1) that originally proved the scan useful. Tests are wholly skipped too.

3. **Computed spend is still reported as zero in one live output path.**  
   [`withLedger`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/cli-ledger.ts:35) uses `totalSpend`, but [`totalSpend`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:919) ignores `computedCostNanos`. A 32,000-nano Anthropic record produced `{nanos:0, unpriced:1}`. The persistent report is right; the command that made the spend is wrong.

   Two related omissions:

   - An empty range returns before printing unmetered declarations at [`ai-cost.ts:302`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/ai-cost.ts:302). I reproduced that output.
   - The failed-call subtotal again omits computed spend at [`ai-cost.ts:341`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/ai-cost.ts:341).

4. **The Anthropic observer can underprice and corrupt provenance.**  
   Both observer methods are always available, and repeated calls overwrite rather than reject or add. I passed `observe.openRouter` twice under the Anthropic declaration and obtained one accepted row with:

   ```text
   provider_account=anthropic
   cost_source=provider
   credits=500000000
   ```

   The second observation silently replaced the first.

   The wrapper also discards `inference_geo`, tier, reasoning, server-tool use, and cache-TTL detail at [`declared-spend.ts:249`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/declared-spend.ts:249). Anthropic reports these fields, and US inference can cost 1.1×; a workspace-level US default can therefore understate a current direct call. [Anthropic’s usage schema](https://platform.claude.com/docs/en/api/typescript/messages), [data-residency pricing](https://platform.claude.com/docs/en/manage-claude/data-residency).

   Make the observer declaration-specific, callable exactly once, and require exactly one guarded fetch. When attempts exceed one, do not persist a trusted numeric amount known to understate the spend.

## Other findings

5. **The SQL constraint refuses no legitimate current row.**  
   A BYOK zero is correctly accepted. But it permits invalid rows:

   - `anthropic + provider`
   - `openrouter + computed`
   - computed cost without `price_version`
   - `price_version` on provider/none rows

   Add account/source and price-version checks. Also, `price_version` is currently only `model@effective-date`; it does not identify the rate values. Editing a price row in place gives two calculations the same version. Use an immutable row ID or rate hash.

   The checks are also absent from [`schema.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:1419) and both Drizzle snapshots. The filesystem reader neither enforces them nor backfills pre-0023 rows, despite the SQL migration proving that backfill is deterministic.

6. **The error outcome is recorded too early.**  
   `openRouterJson` records `ok` before [`rescue.mts`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/rescue.mts:130) discovers a 200-with-error. The bake-off similarly returns error JSON from inside the wrapper at [`bakeoff.mts:317`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/pdf/bakeoff/bakeoff.mts:317), so those rows also say `ok`. `rescue` should also `await withLedger`, not discard its promise at [`rescue.mts:270`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/rescue.mts:270).

7. **The hand-written stripper is not safe enough.**  
   Your narrow regex-literal argument is sound: valid regex literals must escape delimiter slashes, so not tracking them does not itself turn their contents into `//` comments. The broader claim is false:

   - Nested templates can desynchronise it. A valid `` `outer ${`https://example.com`}`; new Anthropic() `` loses the constructor.
   - `//` in JSX text can hide a later JSX expression on the same line.
   - Comments inside `${...}` remain and cause false positives.
   - Aliased/namespace SDK constructors, non-JS scripts, existing factories, and Unicode-escaped identifiers evade the matchers.

   Do not accept transitive-dependency risk. Add a parser as a direct dev dependency. I recommend `@babel/parser`: it directly supports TypeScript, JSX and TSX and has the longer-lived ecosystem. [Babel parser documentation](https://babeljs.io/docs/babel-parser). Parsing still needs the declaration-to-call-site checks above.

## Decisions

- **Judge as declared bypass:** correct for now. Preserving explicit model choice and adaptive thinking outweighs forcing it through the product seam.
- **Bake-off OpenRouter helper as bypass:** correct; its routing policy is part of what it measures.
- **`AI_JOB_ROUTE.eval.require_parameters`:** correct for rescue. It means “only providers supporting the parameters actually sent,” not “parameters are required.”
- **`allow_fallbacks: false`:** reasonable if you want no backup provider attempt, but the rationale is wrong. Provider fallback does not substitute another model, and without `order`/`only`, the initial provider is still load-balanced. [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).
- **`metered: false`:** yes, currently a loophole. Two reasons already say “another agent was editing” or “could use the seam today,” contrary to the field’s own “why the seam is wrong” rule. It greens CI, has no expiry, grants whole-file permission, and is not printed for empty reports. Do not call the implementation comprehensive while any remain.

Focused verification: 46/46 relevant tests passed despite these failures. All three TypeScript projects passed; the guard failed only on the unrelated untracked `rename-preview.tsx`. No files were changed.