# NO-SHIP

The ordinary wrapper path is improved, but several spend-without-a-correct-row paths remain.

## Blockers

1. **Detached work outlives both guards.** `AsyncLocalStorage` survives into async resources created inside its callback.

   - [`declaredFetch`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/declared-spend.ts:92) only checks that an `ActiveCall` exists; it never closes it. I scheduled a stubbed fetch inside `fn`, let `fn` return, then awaited the detached work. Result: `fetches=1`, one already-finalized row with `cost_source=none, outcome=ok`.
   - [`persistingSpend()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:834) ignores `box.closed`. I started the wrapper from a callback retained after `collectSpend` returned. Result: `ran=true, rows=0, late=1`; the body ran, then [`recordSpend`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:689) discarded the row.

   Both `ActiveCall` and `SpendBox` need a live/closed check before spending.

2. **Declarations still grant blanket file permission.** [`isExempt()`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/no-undeclared-spend.test.ts:324) returns true for every finding in the file once any declared ID appears anywhere. Adding an unrelated raw provider fetch beside an existing declared call still passes. This is the original future-capability hole, narrowed but not closed.

   Two additional scan bypasses:

   - The scratch filter is unconditional at [`trackedSources()`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/no-undeclared-spend.test.ts:163). A tracked or committed `scratch-*.ts` is still filtered out. Your proposed untracked-only policy is defensible; this implementation does not implement it.
   - Tests discard all endpoint findings at [line 354](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/no-undeclared-spend.test.ts:354), so a real `fetch("https://openrouter.ai/…")` in a new test passes.
   - Named SDK imports are ignored at [line 240](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/no-undeclared-spend.test.ts:240). The installed Anthropic SDK exports `Anthropic` by name, so `import { Anthropic } …; new Anthropic()` is missed—and the old text matcher caught it. CommonJS has the same regression.

3. **`inference_geo` is not unknowable.** Anthropic returns it in `message.usage`; the installed SDK types it explicitly. The official documentation also says the response reports the actual geography and US inference costs 1.1× for supported models. [Anthropic data-residency documentation](https://platform.claude.com/docs/en/manage-claude/data-residency).

   The wrapper omits the field from [`ObservedAnthropicUsage`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/declared-spend.ts:113), hard-codes `null` at [line 328](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/declared-spend.ts:328), and prices without the multiplier. The direct Sonnet 5 judge can therefore still be undercounted by 10%.

4. **The filesystem “enforcement” deletes historical spend from reports.** [`looksLikeRow()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/ai-calls-fs.ts:91) rejects every pre-0023 row. Against the existing test ledger, the current reader returned 1,356 rows and marked 373 previously valid rows unreadable. This is not ambiguous: migration 0023 already proves the deterministic backfill—OpenRouter, then `provider` iff credits are non-null. Normalize old rows on read or migrate the JSONL.

5. **The retry row remains knowingly false.** Recording a row is correct; recording an apparently successful exact amount is not. The retry check happens after [`recordSpend()`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/declared-spend.ts:276), so the persisted row says `outcome: ok` and contains only one attempt’s amount before the wrapper rejects. If the body itself throws, multiple attempts are not reported at all.

   Persist the row, but mark it non-OK and either clear the trusted amount or store explicit attempt/lower-bound provenance. “Row versus no row” is a false choice.

## Other disputed points

- I agree that account/source cross-checks should not forbid future `openrouter + computed` or `anthropic + provider`.
- I disagree on `price_version`: the TypeScript shape permits computed cost with a null version, while Postgres accepts it. The filesystem and database contracts now differ; add the database constraint.
- A standard API `error` envelope is a failed model call even when HTTP returned 200. It should remain billable but have `outcome: error`; otherwise the failed-call report omits it.
- `reasoningTokens` is still hard-coded null even though current Anthropic usage includes `output_tokens_details`.

The guard-before-`beginSpend` ordering and attribution around the `finally` are correct on the normal awaited path. The blockers are the lifetimes and provenance around that path.

Focused Vitest could not start under the read-only sandbox because Vite tried to create `.vite-temp`; the two lifecycle probes ran directly with stubbed network calls. No files were changed.