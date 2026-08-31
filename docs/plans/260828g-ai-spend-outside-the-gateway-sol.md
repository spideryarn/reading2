This is the right next work, but the plan has four stale or missing premises to fix before building.

1. **Declared bypass: record the calls, but do not expose `recordExternalCall()`.**

Your truth principle is right: an unpriced row is honest; silence is not. But a completion-only function can be forgotten, misses throws, and mints the identifier after the request.

Use one eval-only lifecycle wrapper:

```ts
withDeclaredExternalCall(id, { job, model }, async ({ observe }) => {
  // unchanged raw transport
})
```

It should:

- call `beginSpend` before the network attempt;
- call `recordSpend` exactly once in `finally`;
- record errors without usage as unpriced;
- expose provider-specific observers such as `observe.anthropic(message)` and `observe.openRouter(json)`;
- leave the sole `AiCallRow` construction in [ai-spend.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:650).

The declaration ID should map to fixed provider, wire, allowed source file, and reason. Prevent ordinary use by placing the wrapper under `evals/`, forbidding imports outside the exact declared files, and never exporting the raw begin/finish pair as the bypass API.

Also handle retries. Bare Anthropic clients retry twice by default. Either set `maxRetries: 0`, as the production seam does, or use SDK middleware to record each HTTP attempt. One logical SDK operation can otherwise hide three billable attempts.

Candidate (c)’s objection is factually wrong: the Anthropic SDK supports both custom `fetch` and per-attempt middleware without patching it. [Official SDK `ClientOptions`](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/client.ts).

2. **The scan is useful, but make it a capability scan, not a hostname regex.**

Use the TypeScript AST over every tracked JS/TS file, rather than four hard-coded directories. Match:

- value, dynamic and `require` imports of provider SDKs;
- provider client construction and `.messages.create/stream`, completions, embeddings and transcription calls;
- AI credential and base-URL environment reads;
- known AI hostnames and endpoint paths;
- subprocesses invoking `curl`, Python or another executable with AI credentials/endpoints;
- imports of the declared-bypass module.

Check `package.json` scripts too. Require every exemption to identify one exact file and declaration ID, and mutation-test every matcher.

It will still lose to computed properties, generic factories, a new unknown SDK, encoded URLs, untracked scratch files, or a credential handed to a subprocess. A lint rule has the same limit; it is just a better scan.

Add runtime teeth as the second layer: every approved raw transport receives a guarded `fetch`/SDK middleware which requires both an open spend collector and an active declaration ID. OS-level egress controls are stronger, but disproportionate here. Static capability scan plus guarded transport is the sensible boundary.

3. **The Anthropic side is priceable; it is just not automatically reconcilable.**

The plan’s claim that the price table was deleted is stale. [pricing.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pricing.ts:149) still contains `ANTHROPIC_PRICES`, and [priceAnthropicCall()](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pricing.ts:289) prices direct SDK usage. Anthropic’s current published rates confirm Sonnet 5 at $2/$10 and Haiku 4.5 at $1/$5 per million input/output tokens. [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).

The blocker is the row shape: [ai-spend.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:684) maps `costNanos` to `creditsUsedNanos`, explicitly meaning OpenRouter credits. A computed direct-Anthropic estimate cannot honestly go there. Add provider/account, cost source, estimated cost, and price version—or restore an equivalent neutral representation.

Automated Anthropic reconciliation is genuinely unavailable to an individual account, but the Console still has Usage and Cost pages. Therefore acceptable completeness is:

- every call recorded;
- direct calls priced from the versioned table;
- headline labels them “computed, Anthropic not reconciled”;
- periodic manual comparison with the Console;
- automate later if the account becomes an organization.

[Anthropic explicitly says](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) the Admin API is unavailable to individual accounts and that equivalent data is visible in Console. Unpriced and unreconciled is not an acceptable final state; computed and explicitly unreconciled is.

4. **Store every eval row, but exclude evals from the primary headline.**

“You can never un-lose a row” is right for storage. It is wrong as the default reporting total: the number Greg will use for product pricing should not jump because somebody ran forty PDFs.

Print:

```text
Product spend:  $P
Eval spend:     $E
All recorded:   $P + $E
```

Put unpriced/reconciliation status beside each pocket. Make a combined headline opt-in, not the number labelled simply `Total`.

5. **Inventory corrections.**

- The embedding judge is missing from A–C. It is incidental raw transport, not one of the two transport experiments. Route it through a seam, or C has three declarations rather than two.
- `embedAll` uses the `embeddings` wire, not the chat wire; [models.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:485) makes that explicit.
- The judge is priceable now. Its default Sonnet model is already in the table.
- The bake-off’s dated `claude-haiku-4-5-20251001` spelling is not in that table; add an explicit alias with a test rather than munging model names.
- `rescue` has no truthful current `AiJob`. Do not record it as `pdf` or `chat` for convenience; add an eval job or another honest classification.
- The Mistral OCR arm is not a third account: it spends through the bake-off’s OpenRouter helper, so moving that helper captures it.

6. **Yes, this is the right next piece.**

Phase 6 or 7 would turn today’s known-short, ambiguously combined figure into a more authoritative-looking wrong number. Close coverage, cost provenance, and product/eval reporting first. Full automated Anthropic reconciliation can remain deferred, provided the report says exactly what is computed and what has not been checked against the account.

No files changed.