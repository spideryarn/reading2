# PROCEED-WITH-CHANGES

The root cause is convincing. The proposed direction is good, but the plan needs several corrections before implementation.

## 1. Use a domain error, not threaded state

Define an `EmbeddingFailure` in [src/embeddings.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/embeddings.ts:137), with a reason such as:

- `account-no-endpoints`
- `upstream`

Let it propagate unchanged through `article-vectors.ts`. The route can map the reason to reader copy and a registered code. `article-vectors.ts` should not interpret embedding error strings.

This is simpler because modules communicate through one error contract; nothing is manually threaded or copied between layers.

The typed boundary must cover every known embedding failure:

- `ProviderRefused`
- network and abort errors
- malformed provider responses
- dimension mismatches
- total embedding timeouts

Today network errors are rethrown untouched at [embeddings.ts:162](/Users/greg/Dropbox/dev/experim/spideryarn2/src/embeddings.ts:162), so `isProviderFailure` does not recognise them. Prefix matching is therefore already incomplete.

Keep generic PCA and ranking errors generic. Only code inside the embedding boundary should construct `EmbeddingFailure`; do not wrap all of `projectArticle` or `similarBlocks`.

There is also an important Force bug the plan understates: [the `similar` route catches every exception](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:3649), so a ranking bug is currently reported as an embedding outage. Force also calls `embedAll` directly through `similar.ts`, bypassing `article-vectors.ts`. Both routes need the same typed-error handling.

The other matching-on-message instance worth fixing is the Readability refusal: [pipeline.ts:828](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:828) matches prose thrown by [extract.ts:285](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:285). That should become a typed extraction refusal. Parsing stable bracketed reader codes in `messages.ts` is intentional persistence compatibility, not the same bug. Nor is converting OpenRouter’s unstructured body into `ProviderRefused.kind` at the provider boundary.

## 2. The retry problem is not currently user-visible

Neither embedding failure is stored as an ingest job. [failureKindOf](/Users/greg/Dropbox/dev/experim/spideryarn2/src/job-failure.ts:108) and ingest retry controls therefore never see `[emb1]` or `[emb2]`.

Repository-wide searches found no occurrence in database code, jobs, comments, fixtures, or persisted data. The diagram hooks hold failures only in React state.

There is also no Retry interface for either mode:

- Projection displays the server error, then appends more prose after its bracketed code at [DiagramPanel.tsx:1005](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1005). That makes the code no longer terminal and therefore unparsable.
- Force ignores the server’s `[emb1]` response and displays separate code-less copy at [DiagramPanel.tsx:1019](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1019).

So the plan’s suggestion that users are being offered an impossible retry is not real today.

Registration still matters. Unregistered messages are treated as unauthored by [monitoring-scrub.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/monitoring-scrub.ts:36), so Sentry withholds the useful diagnosis.

I would:

- Register the already-shipped `emb1` and `emb2` as legacy/current codes rather than rename them merely for tidiness.
- Add a properly named new code for account refusal, such as `[ai-embedding-account]`, of kind `ours`.
- Move all three sentences into `messages.ts`.
- Make both modes display the server-owned sentence, with the code last.

No database migration is needed. If the existing codes are renamed, retain legacy aliases in `kindOfMessage`; do not rewrite stored rows that apparently do not exist.

## 3. Build a secret-gated deployed self-test

An owner-authenticated endpoint is not presently callable by `deploy.ts`: the deploy script has no owner bearer token. That makes the plan incomplete.

I would build a purpose-specific endpoint protected by a deployment smoke secret. It should execute inside the deployed function using that deployment’s `OPENROUTER_API_KEY`. A failure must return non-2xx, and `deploy.ts` must record it as a gate failure and exit non-zero.

I would not use:

- Public `/api/health`: even with in-memory caching, serverless cold starts and multiple instances leave a money-spending endpoint attackable.
- Boot-time probing: serverless “boot” happens repeatedly.
- Sentry after reader traffic: this incident shows that is too late.
- A schedule alone: useful later for policy drift, but not a deployment gate.

A cached result exposed on health could be safe if only a secret-authenticated probe produces it, but it adds state without improving the deploy gate.

### The free OpenRouter check

There is an official key-scoped endpoint: [`GET /api/v1/models/user`](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails). OpenRouter says it applies the caller’s provider preferences, privacy settings, and guardrails.

Confidence is high for the text-model roster. Confidence is not high enough for Voyage embeddings: OpenRouter documents a separate [embedding-model catalog](https://openrouter.ai/docs/api/api-reference/embeddings/list-all-embeddings-models), but does not say that catalog is user-filtered. The generic [models catalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) and [per-model endpoints route](https://openrouter.ai/docs/api/api-reference/endpoints/list-all-endpoints-for-a-model) likewise do not promise caller-policy filtering.

Before trusting `/models/user` for Voyage, compare its output using the two known accounts. If the restricted account still lists Voyage, it cannot be the green deploy gate.

Even when filtered correctly, model availability does not prove that the exact route constraints—ZDR, provider order, parameter requirements, fallback policy—will accept a real request. I would use `/models/user` as a free diagnostic and make actual minimal calls the definitive check.

Probe each distinct deployed model/routing policy, not merely embeddings. The current roster is roughly four models but at least five distinct request paths/policies. With tiny prompts and capped output, total cost should remain comfortably below $0.001 per deployment; the observed Voyage call was only $0.00000084.

To prevent another silent green:

- Assert the exact non-empty expected roster and every individual result.
- Disable fallback to a different model.
- Include a deployment/build identifier and validate it.
- Emit one safe log entry and require `deploy.ts` to find it.
- Never include provider bodies.
- Before fixing the production account, run the new probe against it and preserve the expected red result. Then require the same probe to turn green after the operational correction.

## Additional findings

`MAX_INFLIGHT` is not a provider failure. It is local admission control at [article-vectors.ts:266](/Users/greg/Dropbox/dev/experim/spideryarn2/src/article-vectors.ts:266). Give it a separate typed capacity error, log it as local saturation, and return 503. Its reader-facing kind can still be `retry`.

The production `raw: {...}` output matters beyond redeployment. It proves the running deployment predates the HEAD protection that removed provider bodies. That old branch could log provider-returned article fragments, so it is a privacy risk even though this particular 404 body contained none. Verify the deployed commit through its build stamp and treat serving current code as a separate deploy requirement.

No files were changed.