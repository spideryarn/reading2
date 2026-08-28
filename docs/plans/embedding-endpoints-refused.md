# Drift and Trail are dead in production, and the message says the wrong thing

**Status:** **fixed, and verified in production 2026-08-28.** The code half is built and reviewed
twice; the key was replaced and the site redeployed. The deploy-time probe is the one thing still
open, and it is the one that would have caught this.

`POST /api/projection/constitution` answers **200** at `dpl_3WV6SMuAqWrSXNG1uVefUkmD3Two`: 276
blocks embedded, `voyageai/voyage-4`, 25,507 tokens, $0.00153, about three seconds. Drift and Trail
draw dots and Force draws its dotted links, checked on the live site after a full reload so it is
not stale client state, with no bracketed code anywhere. Three days of 502s, then a 200.

Greg, 2026-08-28:

> When I tried to look at Drift and Trail (i.e. embedding-based diagrams) on spideryarn.com, I get
> an error … Could not place this article's paragraphs: the embedding model could not be reached.
> Everything else on the page is unaffected. [emb2]

Everything embedding-shaped in production has been failing since the feature shipped. It is not an
outage, it has never once worked in production, and the sentence the reader is shown says something
that is not true.

## What is actually happening

Production's `OPENROUTER_API_KEY` belongs to a **different OpenRouter account** from the one in
`.env.local`, and that account's privacy/data-policy guardrails leave **no endpoint at all** for
`voyageai/voyage-4`. OpenRouter answers 404.

From the production runtime log (`POST /api/projection/noema-mythology-of-conscious-ai`,
2026-08-28T08:48:20Z, and the same line on 2026-08-27 for `constitution` and `fowler-phrenology`):

```
"msg":"the embedding provider failed"
"message":"embeddings voyageai/voyage-4: OpenRouter has no endpoint this account may use.
  key in use: sk-or-v1-225…
  raw: {"error":{"message":"No endpoints available matching your guardrail restrictions and
  data policy. Configure: https://openrouter.ai/settings/privacy","code":404}}"
```

- **Production key:** `sk-or-v1-225…` (Vercel, `OPENROUTER_API_KEY`, Production) — 404s on Voyage.
- **Local key:** `sk-or-v1-735…` (`.env.local`) — answers 200. Verified 2026-08-28 with a live
  one-passage call: 1024 dimensions, $0.00000084.

Every failure in the last three days of logs is this one; there is no other embedding failure in
the window, and the failure is 264–1087ms, so nothing is timing out.

**This is the exact accident [`src/embeddings.ts`](../../src/embeddings.ts) already documents**, in
the comment beside the `no-endpoints` branch:

> Both Voyage models 404 on the key exported in Greg's shell and answer 200 on the key in
> `.env.local` — two different accounts, one of which has not opted in to whatever Voyage's
> endpoints require.

The comment was written when it cost an hour on a laptop. Then **the losing key was the one that
got deployed**, and nothing anywhere noticed, because nothing in the deploy pipeline ever asks the
production key to do anything.

It hits **Force too** (`similar`, `[emb1]`) — same model, same account, same 404. Chat, explain,
search and the pipeline are unaffected: they route to Anthropic upstreams, which that account does
allow.

## The operational fix, which nobody but Greg can do

Greg chose to fix the production key rather than repoint production at the working one
(2026-08-28), so the billing split stays. Four steps.

**1. The key on Vercel is not the key you made for it.** This is the whole fix, and it took a
read-only walk through the OpenRouter dashboard to see, because nothing on the server side could:

| where | key | state |
|---|---|---|
| production logs (`key in use:`) | `sk-or-v1-225…` | 404s on Voyage, every request |
| `.env.local` | `sk-or-v1-735…` | works; has billed `voyage-4` |
| OpenRouter, "Spideryarn 2 prod 260826" | `sk-or-v1-031…` | **never used, $0.000**, created 2 days ago |
| OpenRouter, "Greg Spideryarn experim" | `sk-or-v1-735…` | the working one |
| OpenRouter, "ARC" | `sk-or-v1-d2f…` | last used 11 months ago |

`greg@gregdetre.com` holds exactly three keys and **`sk-or-v1-225…` is not one of them.** A key
named for production was created two days ago, `OPENROUTER_API_KEY` was set on Vercel two days ago,
and the key has never been called. So the value that reached Vercel came from somewhere else — a
different OpenRouter login. It is a live key (it authenticates; the failure is a routing 404, not a
401), and that other account has a restriction this one does not.

**The fix was therefore to put a key from `greg@gregdetre.com` on Vercel**, not to change any
setting — done 2026-08-28. That account has every restrictive toggle off, its single guardrail has nothing configured
at all, and it has already paid for `voyage-4` embeddings — $0.05 of them, including the calls that
verified this diagnosis. OpenRouter shows a key's secret only once at creation, so the existing
prod key's value was unrecoverable and a fresh one was made.

**What "tested" meant before it was set**, because a key that authenticates is not a key that
works — that is the whole lesson of this document. Every job's *real model* with its *real
`provider` block* from `AI_JOB_ROUTE`, not a bare call: embeddings/`voyage-4` 200, chat/`sonnet-5`
with `order+require_parameters` 200, dictation/`gemini-3.1-flash-lite` with `zdr+require_parameters`
200, PDF/`gpt-5.6-luna` with `require_parameters+allow_fallbacks:false` 200. Then the app's own
`embedAll` on a real article: 34 paragraphs, 1024 dimensions, $0.000247. And after setting it, the
value was **pulled back from Vercel and compared** rather than trusted — 73 characters, identical.
(`vercel env pull` overwrites `.env.local` by default, which holds the *other* key; pull somewhere
else.)

**What the account looked like**, so nobody re-checks it: ZDR off for all five scopes (Non-frontier,
Anthropic, OpenAI, Google, SpaceXAI); all four data-training toggles off; Allowed Providers and
Ignored Providers both empty; one workspace, no organisation; one guardrail — "Workspace Guardrail",
active, applying to all three keys — with Budget, Model & Provider Access, Prompt Injection and
Sensitive Info Detection all *not configured*. All three keys show identical eligibility (494
available / 2 partial / 17 unavailable) and none carries a per-key override. There is nothing here
to turn off.

**2. If you keep the other account instead, the setting to change is Zero Data Retention —
specifically the "Non-frontier" scope.** Not needed if you follow step 1, but this is *why* that
key fails, and it is proven three ways rather than guessed:

- **The routing experiment.** Asking the *working* key to route under each restriction in turn, one
  request each: `zdr: true` is the only one that turns Voyage's 200 into a 404 —
  `data_collection: "deny"`, `require_parameters` and `allow_fallbacks: false` all still answer 200.
  The same `zdr: true` on `anthropic/claude-sonnet-4.5` answers 200. That is the production symptom
  exactly: embeddings dead, chat and the whole pipeline fine.

  ```
  voyageai/voyage-4                     plain=200   zdr=404
  openai/text-embedding-3-small         plain=200   zdr=200
  openai/text-embedding-3-large         plain=200   zdr=200
  anthropic/claude-sonnet-4.5 (chat)    plain=200   zdr=200
  ```

  The 404 under `zdr` even says so in words the account-level one does not:
  *"No endpoints found matching your data policy (Zero data retention)"*.

- **OpenRouter's own list.** `GET https://openrouter.ai/api/v1/endpoints/zdr` is the authoritative
  set of ZDR-compliant endpoints — 806 of them. **No Voyage entry appears anywhere in it**, while
  both OpenAI embedding models and Anthropic do. `voyageai/voyage-4` has exactly one endpoint
  ("VoyageAI by MongoDB"), so there is nothing to fall back to and a ZDR guardrail leaves zero.

- **The docs.** ZDR is not one switch. From
  [`guides/features/zdr.mdx`](https://github.com/OpenRouterTeam/docs/blob/main/guides/features/zdr.mdx):
  five scopes — Anthropic, OpenAI, Google, SpaceXAI, and **Non-frontier**, which *"removes all other
  non-ZDR endpoints"* — and *"in your privacy settings, each model group has its own toggle"*.
  Voyage is Non-frontier.

So on whichever login owns `sk-or-v1-225…`, the change would be **the Non-frontier ZDR toggle
alone**, at <https://openrouter.ai/settings/privacy>. The other four scopes keep their guarantee.

The dashboard confirms the mechanism from the other side: OpenRouter's own model page for
`voyageai/voyage-4` carries a warning triangle on its single provider reading **"Logs: this provider
may retain prompts, but does not use them for training."** Retention without training is precisely
the combination that fails ZDR and passes `data_collection: "deny"` — which is exactly what the two
experiments above found, arrived at independently.

**And it does not weaken the one that matters most.** Dictation — the reader's voice — sends
`zdr: true` in the *request* (`AI_JOB_ROUTE` in [`src/ai-call.ts`](../../src/ai-call.ts)), so its
guarantee is enforced per call and survives any account setting. That is what lets the copy beside
the microphone keep saying what it says. Relaxing the account-level Non-frontier scope changes
routing only for jobs that do not ask for ZDR themselves, which in practice means embeddings.

**If the privacy page already shows Non-frontier off**, the restriction is coming from a
**guardrail** attached to that key rather than from the account —
[`guides/features/guardrails.mdx`](https://github.com/OpenRouterTeam/docs/blob/main/guides/features/guardrails.mdx)
puts ZDR per model group inside a guardrail too, guardrails can be assigned to a single API key, and
*"stricter rules always win when multiple guardrails apply."* Same fix, different page
(openrouter.ai/workspaces). Check its **provider allowlist** while you are there: Voyage has one
provider, so any allowlist omitting it kills the model outright with no data policy involved.

**3. Check it, with the production key, before believing it.** A settings page saying the right
thing is not the same as an endpoint answering:

```bash
KEY='sk-or-v1-225…'     # the production one, off the Vercel dashboard
curl -s -o /dev/null -w '%{http_code}\n' https://openrouter.ai/api/v1/embeddings \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"model":"voyageai/voyage-4","input":["hello"],"input_type":"document"}'
```

`200` is fixed. `404` is still refused, whatever the page says. It costs about a millionth of a
dollar to ask.

**4. Redeploy, and this one is not optional.** The running deployment predates the commit that
stopped putting the provider's response body into the thrown message — production's logs still carry
`raw: {…}`. On this 404 the body held nothing sensitive, but the request that produces it is *the
article's own paragraphs*, and an upstream that echoes a request back would put article prose in a
log that [logging.md](../project/logging.md) forbids it from reaching. So that is a privacy fix
sitting undeployed, independent of the key. ⟨Sol⟩

### The other option, if ZDR everywhere is a commitment rather than a default

Turning the Non-frontier scope off is the recommended fix, because the two environments differing
is what caused this and the local one already runs without it. But ZDR is not all-or-nothing for
this feature, and the alternative is real: **`openai/text-embedding-3-small` answers 200 under
`zdr: true`.** So the app could keep ZDR everywhere and change model instead.

The eval already says the quality cost is nil —
[embedding-retrieval-2026-08-26.md](../../evals/results/embedding-retrieval-2026-08-26.md) found the
two *statistically tied on every measure under both judges*, and the tie-break that chose Voyage was
**billing**. That tie-break is still true, and measured again on 2026-08-28:

```
voyageai/voyage-4              cost 5.4e-07   is_byok: false
openai/text-embedding-3-small  cost 0         is_byok: true   (upstream 1.8e-07)
```

`is_byok: true` means it bills to Greg's own OpenAI account rather than to OpenRouter credits, which
is exactly what [`src/embeddings.ts`](../../src/embeddings.ts) says the choice turned on. Switching
also means **1536 dimensions rather than 1024**, so `RECIPE` in
[`src/article-vectors.ts`](../../src/article-vectors.ts) changes and every cached vector is
correctly missed rather than silently reused — the cache key was built for exactly this.

So: a real second option, no quality cost, at the price of a billing dependency the eval
deliberately avoided. **It is a decision about data policy, not a bug fix, and it is Greg's.**

## What was wrong in the code, regardless of which key wins — and is now fixed

All three of these landed on 2026-08-28, after a GPT Sol review of this plan
([…-sol.md](embedding-endpoints-refused-sol.md)) corrected it in several places. The first two are
built; the third is written up below and **not built**.

### 1. ✅ A permanent misconfiguration was reported as a transient outage

`no-endpoints` is a **setting**. It cannot succeed on a retry, ever, and both ends say otherwise:

- The reader gets *"the embedding model could not be reached"* — which describes a network, and
  invites another go.
- The server logs *"the embedding provider failed"* — which sends whoever is debugging to
  OpenRouter's status page for a fault that is in a settings screen.

[copy.md](../project/copy.md) already names this as the expensive mistake: *"telling someone to try
again when retrying cannot possibly work, so they do it, four or five times, and conclude the app
is broken rather than that it needs topping up."* This failure is `ours`, not `retry`.

`ProviderRefused.kind === "no-endpoints"` already carries the classification — `embeddings.ts`
throws it away and replaces it with prose, and `isProviderFailure` in
[`article-vectors.ts`](../../src/article-vectors.ts) recovers a *category* from a string prefix.

**Built:** `EmbeddingFailure` in [`src/embeddings.ts`](../../src/embeddings.ts) carries a `reason`
— `config`, `provider` or `busy` — and `isProviderFailure` is gone. Every throw inside the
embedding boundary is typed, which fixed a gap the prefix left and Sol found: **a `fetch` that
never connected threw a bare `TypeError`**, matched no prefix, and reached the catch-all as an
unexplained 500 — so the ordinary provider failure was the one that did not read as one. Both
routes now go through one `embeddingHttpError`, so the `similar` route can no longer blame the
provider for a bug in our own ranking, which it had been doing since its twin was fixed without it.

### 2. ✅ `[emb1]` and `[emb2]` were not registered, so the app guessed about them

Both were hand-rolled strings in [`src/routes.ts`](../../src/routes.ts) rather than in
[`src/messages.ts`](../../src/messages.ts), and neither was in `CODE_KINDS`. So `kindOfMessage`
returned `null`, and `worthRetrying` treats an unknown code as **retryable** — the safe direction
for a blip and the wrong one here.

Sol checked whether that actually reached a reader and the honest answer is **not much**: neither
failure is stored as a job, so `failureKindOf` never sees these codes, and neither picture offers a
Retry button. The real cost was elsewhere and worse — `monitoring-scrub.ts` reads the same table to
decide whether a sentence is provably ours and may go to Sentry, so **the one message that said
what was wrong is the one monitoring withheld.**

**Built:** `PLACING_NOT_CONFIGURED`, `PLACING_UNREACHABLE` and `PLACING_BUSY` in `messages.ts`, one
per reason, registered as `[ai-embed-account]` (kind `ours`), `[ai-embed-down]` and
`[ai-embed-busy]` (both `retry`), picked by a total map so a fourth reason cannot compile without a
sentence. `emb1` and `emb2` are gone rather than kept as aliases — Sol advised keeping them, and the
reason for overruling that is narrow: it also established that nothing persists them, and grep
agrees. Nothing can read a code that nothing stored.

`src/web/DiagramPanel.tsx` changed too: both strips put the consequence first and the server's
sentence last, so the bracketed code ends what the reader sees instead of having *"The picture below
is the Tree instead."* appended after it. Force stopped ignoring the server's answer altogether.

### 3. ⬜ Nothing in the deploy pipeline asks the production key to do anything

[`scripts/deploy.ts`](../../scripts/deploy.ts) checks a great deal — the build stamp, the store, the
TLS decision, that a request body survives the platform, that the auth gate holds, that the app role
has its grants. It does not check that the key production runs on can make **one** model call.

`vercel-health.ts` reports that `OPENROUTER_API_KEY` is *set*, with a `breaks` clause claiming that
without it "every model call in the app fails". Set is not usable, and this is the case that proves
it: the variable is present, spelt right, and the answer is 404.

**And the check has to run inside the deployment.** A probe added to `deploy.ts` would run on
Greg's laptop with `.env.local` loaded — it would exercise the key that works and pass, for exactly
the deployment that is broken. The value that has to cross the seam is the *deployed function's*
environment.

**This is the one that matters and it is not built.** It needs a shared secret that only Greg can
put on the Vercel project, so building it half-way would leave a gate that skips itself — which is
the shape of thing this whole document is about. The design, after Sol's review:

- **A purpose-built route on the deployed server**, not `/api/health`. Health is unauthenticated,
  and an endpoint that spends money on demand is an open wallet; caching does not fix it, because a
  serverless cold start is a fresh cache and there are many instances. Sol was firm on this and is
  right.
- **Protected by a deploy secret**, not by owner auth: `scripts/deploy.ts` holds no owner bearer
  token, so an owner-authenticated route is one `deploy.ts` cannot call. A new env var — say
  `DEPLOY_PROBE_SECRET` — set on the Vercel project and in `.env.local`. **Greg has to provision
  it.**
- **It makes one real, minimal call per distinct routing policy**, not one for the roster: model
  availability is not proof that this app's actual `provider` block (ZDR, `require_parameters`,
  `allow_fallbacks`) will be accepted. `AI_JOB_ROUTE` has six rows and about five distinct policies.
  With tiny inputs that is comfortably under $0.001 per deploy — the observed Voyage call was
  $0.00000084.
- **`deploy.ts` records a failure as a gate failure and exits non-zero.** It asserts the exact
  expected set, every individual result, and the build stamp on the answer, so a probe that quietly
  measured a different deployment cannot go green.
- **Run it against the broken account first, and keep the red.** A probe whose failure nobody has
  seen is not evidence — and right now there is a production account that genuinely fails, which is
  a test fixture that will not exist once the key is fixed. Do this before fixing the key, not
  after.

**A free version does not exist, and I checked rather than assuming.** Sol suggested
`GET /api/v1/models/user`, which OpenRouter documents as filtered by the caller's provider
preferences, privacy settings and guardrails. It returns 384 models for the key that *works*, and
**not one of them is a Voyage model** — embedding models are not in that catalogue at all. So a
gate built on it would report the working key as unable to embed: a false alarm that says nothing
true. The per-model `/endpoints` route does list Voyage, but nothing documents it as honouring the
caller's guardrails and it exposes no data-policy field, so it cannot be trusted either without the
blocked key to test against. **Only a real call is evidence.**

## What would have caught it

A check that spends a hundredth of a cent per deploy, run by the deployment rather than about it.
Every check that exists today passes over this deployment, and all of them are honest — they are
just all about configuration that was *declared* rather than configuration that *works*.
[silent-success.md](../reusable/silent-success.md), and the same shape as
`docs/postmortems/` entries where a name comparison stood in for an operation.

## What the second review caught, and it was the same bug again

The built code went back to GPT Sol
([…-code-review-sol.md](embedding-endpoints-refused-code-review-sol.md)), which is the review this
repo weights higher, and it earned that weighting. **`CHANGES REQUIRED`**, and the first finding was
the fix reintroducing the fault it was written to remove:

> `embeddings.ts:273` classifies every refusal except the exact `no-endpoints` body as `provider`.
> I directly checked 400, 401, 402, 403, ordinary 404, and 413: all became retryable `provider`
> failures.

An invalid key, exhausted credit, a 403 and a payload too big are every bit as permanent as the
guardrail 404, and all four were being answered with *"waiting a few seconds and trying again
usually works"*. One layer up, one week later, the same mistake. Note **how** Sol found it: by
running the statuses, not by reading the claim.

The fix is not a fourth reason. `providerHttpFailure` in `messages.ts` has mapped a status to the
right kind and the right sentence since long before this feature existed — 402 is `ours`, 403 and
413 are `blocked`, 429 and 5xx are `retry` — so `EmbeddingFailure` carries the provider's `status`
and `placingFailed` defers to it. One line, no new vocabulary. What is lost is the mention of
*placing passages*, and it is not lost to the reader: the client says which picture failed before
showing the server's sentence.

Three more, all taken:

- **`{"data":[null]}` still escaped untyped.** `readVectors` checked that `data` was an array and
  then asserted every member was `{ index, embedding }`, so a null member reached `d.index` and
  threw `Cannot read properties of null`. The claim that the boundary was wholly typed was false,
  and Sol found it by testing the claim rather than believing it.
- **A caller's cancellation would have been filed as the provider failing.** True but unreachable —
  no caller has ever passed a signal. Rather than preserve a distinction nobody uses, the
  caller-signal contract is **gone**: `embedAll` no longer takes one, and `embedBatch`'s parameter
  is named `deadline`, because ours is the only kind that can arrive. A contract nobody uses that
  makes every abort ambiguous is worth less than no contract.
- **Two sentences claimed causes their reasons could not guarantee.** `PLACING_NOT_CONFIGURED` said
  the account was not allowed when `config` also covers a missing key; `PLACING_UNREACHABLE` said
  "could not be reached" when it also covers a 200 carrying nonsense. Both reworded.

And `config` answers **500**, not 502: a 502 claims to be a healthy gateway whose upstream let it
down, and the upstream did nothing wrong.

**One thing Sol got wrong, and it is worth recording because the argument will be made again.** It
reported that `tests/client-imports.test.ts` permits type-only imports from non-shared modules, so
`EmbeddingReason` could move back beside `EmbeddingFailure`. It read the tree during a window in
which somebody had relaxed that rule — and it was reverted the same afternoon, with this very change
cited as the evidence for reverting it: the guard fired, the type moved into `types.ts`, and that was
the better outcome. The rule is not only about the browser bundle; it is that **shared modules stay
leaves**.

## How the fix was checked

Not by reading it, and twice — once for each round. The new tests in `tests/embeddings.test.ts`
were **run against the old code and watched go red** before being kept: two the first time, three
more after the second review (the two old lines put back, exactly those tests failing, then
restored). `tests/embedding-route-failures.test.ts` pins the seam neither file covered — an
`EmbeddingFailure` in, a status and a reader's sentence out — including a tripwire that both routes
go through the one mapping, because the last time they each decided for themselves they disagreed
for a fortnight. Then production's failure was reproduced locally: `fetch` stubbed with the guardrail 404,
`projectArticle` called on a real article, and the result read all the way through to the sentence a
reader would see —

```
typed: true  reason: config
kind: ours | code kind: ours | offers retry: false
reader sees: This app is not set up to use the model that reads passages for what they are
             about — its account is not allowed to. … [ai-embed-account]
log gets   : embeddings voyageai/voyage-4: OpenRouter has no endpoint this account may use.
```

And the working path was run for real against a local article: 34 blocks embedded, k=3, 34 points,
1.5 seconds. The code was never the problem, which is the point — nothing about it needed to change
for Drift to work, and nothing about it would have told anybody why it didn't.

## Links

- [`src/embeddings.ts`](../../src/embeddings.ts) — `EmbeddingFailure`, and the `no-endpoints` branch
  with the comment that predicted all of this.
- [`src/article-vectors.ts`](../../src/article-vectors.ts) — where `isProviderFailure` used to be,
  and why a string match was the wrong mechanism.
- [`src/routes.ts`](../../src/routes.ts) — `embeddingHttpError`, one for both pictures.
- [the postmortem](../postmortems/the-deployed-key-was-never-asked-to-do-anything.md) — the class of
  bug, rather than this instance of it.
- [copy.md](../project/copy.md) — the four kinds, and why `ours` mislabelled as `retry` is the
  expensive one.
- [embedding-scatter-diagrams.md](embedding-scatter-diagrams.md) — what Drift and Trail are.
