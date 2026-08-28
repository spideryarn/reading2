# Review: Drift and Trail are dead in production (embedding endpoints refused)

You are reviewing a **diagnosis and a proposed fix**, before anything is built. Read-only. The
repository is `spideryarn2`; read `CLAUDE.md` first for the house rules, then
`docs/plans/embedding-endpoints-refused.md`, which is the plan under review.

## The facts, established before you were asked

- Production `POST /api/projection/:slug` has been answering 502 for at least three days. Every
  occurrence in the log window is the same failure: OpenRouter answers **404 "No endpoints
  available matching your guardrail restrictions and data policy"** for `voyageai/voyage-4`.
- Production's `OPENROUTER_API_KEY` (`sk-or-v1-225…`) is a **different OpenRouter account** from
  the one in `.env.local` (`sk-or-v1-735…`). The local key answers 200 — verified with a live call
  on 2026-08-28 (1024 dims, $0.00000084). The production account's privacy/data-policy guardrails
  leave no endpoint for Voyage.
- So the feature has never worked in production, and the same 404 hits Force (`[emb1]`) as well as
  Drift and Trail (`[emb2]`). Chat, explain, search and the seven pipeline stages are fine — they
  route to Anthropic upstreams, which that account permits.
- `src/embeddings.ts` already has a comment describing this exact two-account trap, written when it
  cost an hour on a laptop. The losing key then got deployed and nothing noticed.

The operational fix (repoint the Vercel env var, or open the guardrail on that account) is Greg's
and is not what we want your opinion on, except where it bears on the code.

## The files that matter

- `src/embeddings.ts` — `embedBatch`, the `no-endpoints` branch, `embedAll`, the timeouts.
- `src/ai-call.ts` — `ProviderRefused` (it already carries `kind: "no-endpoints" | null`),
  `openRouterJson`, `AI_JOB_ROUTE`.
- `src/article-vectors.ts` — `isProviderFailure`, which recovers a category by matching the string
  prefixes `"embeddings "` and `"busy:"`.
- `src/routes.ts` around lines 3660–3725 — the `similar` and `projection` routes, and the
  hand-rolled `[emb1]` / `[emb2]` sentences.
- `src/messages.ts` — `CODE_KINDS`, `kindOfMessage`, `canRetry`, `worthRetrying`, and the four
  kinds (`retry`, `ours`, `bug`, `blocked`).
- `src/web/useProjection.ts`, `src/web/DiagramPanel.tsx` — how the reader sees the failure.
- `scripts/deploy.ts` (§ 6 Verify) and `src/vercel-health.ts` — every check that exists today, all
  of which pass over this broken deployment.
- `docs/project/copy.md` — the rules the reader-facing sentences follow.

## The three code changes proposed, and what we want from you

**1. Stop calling a permanent misconfiguration an outage.** Carry
`ProviderRefused.kind === "no-endpoints"` through as a *value* rather than flattening it into
prose, so the route can pick a sentence of kind `ours` with its own bracketed code, and the server
log can say "this account may not use this model" rather than "the embedding provider failed".

- Is threading a classification through `embeddings.ts` → `article-vectors.ts` → the route the
  right shape here, or is there a simpler one that does not braid two modules together? (CLAUDE.md
  has just grown a "prefer simple over easy" rule; apply it.)
- `isProviderFailure` matching string prefixes is load-bearing today — a non-provider error must
  reach the catch-all so a bug in the PCA arithmetic is not reported as an outage. Does replacing
  prefix-matching with a typed error risk losing that distinction anywhere?
- What else in this repo classifies a failure by matching on a message? Same bug, same fix.

**2. Register the codes.** `[emb1]` and `[emb2]` are inline in `routes.ts`, absent from
`CODE_KINDS`, and break the `ai-` / `db-` / `mic-` / `up-` / `auth-` prefix convention.
`kindOfMessage` returns `null` for both, and `worthRetrying` treats unknown as retryable.

- Does anything today actually act on that — an interface offering a Retry that cannot work, a
  stored job whose `failureKindOf` falls back to the code — or is the harm confined to the wording?
  Check `src/job-failure.ts` and the ingest queue before answering.
- Renaming a code changes how already-stored messages are read (`copy.md` says so). Do `emb1` and
  `emb2` appear in anything persisted — jobs, comments, the database? If so, what is the safe
  migration, and does the answer change the naming?

**3. A deploy-time probe that runs inside the deployment.** Nothing in the pipeline ever asks the
production key to make a call. A probe in `deploy.ts` would run on Greg's laptop against
`.env.local` — the key that works — and pass for exactly the deployment that is broken. So the
proposal is an owner-authenticated self-test route on the deployed server that makes one minimal
embedding call and reports pass/fail, called by `deploy.ts` as a post-deploy check.

- Is that the right shape? Consider the alternatives and say which you would build: a field on
  `/api/health` (it is unauthenticated, so a money-spending probe there is an open wallet — but is
  a *cached* result, or a probe behind the deploy-smoke secret, different?); a check that runs at
  boot; a scheduled probe; doing nothing and relying on Sentry once a reader hits it.
- **Is there a free, key-scoped way to ask OpenRouter which endpoints an account may use?** If
  `GET /api/v1/models` or a per-model endpoints route reflects the caller's guardrails, the probe
  costs nothing and can check every model this app depends on rather than one. If it does not
  reflect them, say so — a probe that passes on a key that cannot actually call the model would be
  worse than no probe. Do not guess: say what you know and how confident you are.
- Only `embeddings` is broken today, but the same class covers every model this app routes to
  (`AI_JOB_ROUTE`, `src/models.ts`). Should the probe cover one model or the whole roster, and what
  does that cost per deploy?
- What makes this probe fail *loudly* rather than becoming another green line? The repo's standing
  worry is a check that has never been seen to fail — see `docs/reusable/silent-success.md`.

## Also

- Anything in the plan that is **wrong**, not merely incomplete. We would rather hear "your root
  cause is right but your second finding is not real" than get a longer list.
- Is there a fourth thing here worth fixing that the plan misses? In particular: the deployed error
  message still contains `raw: {…}` with the provider's body in it, while `src/embeddings.ts` at
  HEAD no longer does — so production is running older code. Does that matter beyond "redeploy"?
- The `MAX_INFLIGHT` refusal throws `"busy: too many articles are being read for the model at
  once"`, which `isProviderFailure` counts as the *provider's* fault. Is that right?
