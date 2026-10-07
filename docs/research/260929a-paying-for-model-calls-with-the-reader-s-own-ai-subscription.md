# Paying for model calls with the reader's own AI subscription

The question is whether a reader who already pays for ChatGPT Plus or Pro, or has an OpenAI,
Anthropic or OpenRouter account, can have Spideryarn's model calls billed there rather than to us,
in return for a cheaper Spideryarn price. Greg asked it on 2026-09-29, in Feedback report
SPIDERYARN-READING2-5J (`spya-ddpn5x`):

> It would be amazing to be able to use my OpenAI subscription, if I've already got whatever it is,
> ChatGPT Pro, and then it would use that and I'd get a discounted price. Let's not implement it
> yet. Just do some research and put together a plan. Let's consider how complex it is, and then
> we'll go from there. But don't actually start implementing.
>
> — Greg, 2026-09-29

The plan built on this is [260929g-bring-your-own-ai-subscription.md](../plans/260929g-bring-your-own-ai-subscription.md).
It says what to do. This doc says what the options are and why most of them are ruled out.

**All sources were fetched on 2026-09-29.** The field moved several times in 2026, so re-check any of
this before building. Confidence is marked on each fact. *Primary* means the vendor's own page, read
by this session. *Secondary* means a news report or blog, or a search snippet of a page that refused
to load.

## The short answer

- **Using a ChatGPT plan to pay for Spideryarn's calls now officially exists, but we do not have
  access.** OpenAI's "Sign in with ChatGPT" has a *ChatGPT plan usage* mode. In that mode a reader
  authorises an app, and the app's requests count against the reader's plan. Its docs cover
  open-source and locally hosted apps only. A paid, hosted app like ours has to fill in an interest
  form and wait to be let in.
- **Even with access, it would only pay for OpenAI models.** It would also go through a request
  format and a vendor that our gateway does not use. The expensive part of Spideryarn is the
  article pipeline, and that runs on Claude.
- **Claude and Gemini subscriptions cannot be used this way, as far as the sources show.** 2026
  news reports say Anthropic and Google both forbid third-party apps from using subscription logins,
  and both have enforced it. We did not read either vendor's own statement.
- **What we could build today is "connect your OpenRouter account".** The reader pays for their own
  calls, at OpenRouter's normal list price. Nothing about the models changes, but it is not a
  discount on the model price. The reader's saving would come only from a cheaper Spideryarn tier.

## Where our money goes, which decides what could be discounted

Every paid call goes through OpenRouter, apart from live conversation, which goes straight to
OpenAI. [ai-gateway.md](../project/ai-gateway.md) has the details. Which model does which job is in
[`src/models.ts`](../../src/models.ts), as at 2026-09-29:

| work | model | what it costs |
|---|---|---|
| the pipeline stages, explain, chat, quiz marking (`capable` tier) | `anthropic/claude-sonnet-5`, Messages wire | most of the bill |
| quick jobs, reading PDFs | `openai/gpt-5.6-luna` | small |
| shelf topics | `openai/gpt-6-luna` | small |
| embeddings | `voyageai/voyage-4` | tiny |
| dictation | `openai/gpt-transcribe` | small |
| finding PDF figures | `google/gemini-3-flash-preview` | small |
| live conversation | OpenAI Realtime, direct | per minute |

An ingest costs $0.03–$0.39. An article with every mode generated costs $0.35–$1.55
([cost-per-article-2026-09-03.md](../../evals/results/cost-per-article-2026-09-03.md)). The plans
cost $10 for 20 ingests and $50 for 150, and the quota exists to cap *our* model spend
([billing.md § What we sell](../project/billing.md#what-we-sell-and-the-one-promise)). So a
"discount" means one thing: if the reader pays for the models, we can charge less, raise the quota,
or both.

## The routes

### 1. Sign in with ChatGPT, "ChatGPT plan usage": exists, but gated for an app like ours

What it is (primary, <https://developers.openai.com/siwc>):

> Let users sign in with ChatGPT and use their ChatGPT plan for eligible AI requests in your app.

It has two parts. **Identity** gives the app a name, an email and a picture, and nothing to do with
billing. It went into beta with commercial partners on 2026-07-29 (secondary,
<https://linkloot.io/blog/openai-sign-in-with-chatgpt-partner-apps>). **Plan usage** was announced
at OpenAI DevDay, whose write-ups are dated 2026-09-29, the day of this research (secondary,
<https://every.to/vibe-check/vibe-check-openai-devday-2026>). Its launch partners are mostly coding
agents (OpenCode, Amp, Warp, Devin, Kilo Code), plus Notion and Vercel (secondary, search snippets
of <https://thenewstack.io/sign-in-with-chatgpt/>).

**Who may use it.** Primary, <https://developers.openai.com/siwc/token-sharing-open-source>:

> These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you're
> interested in offering it in a paid or remotely hosted app, complete the interest form.

Spideryarn is paid and remotely hosted. So the route for us is
<https://openai.com/form/sign-in-with-chatgpt-interest/>, and no timeline has been published.
Filling in that form speaks for the company, so it is Greg's to send.

**What a call looks like.** Primary,
<https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference> and
`…/preview-limitations`:

- It uses `POST https://api.openai.com/v1/responses` with the reader's OAuth access token. That is
  OpenAI's **Responses** API, which is a different request shape from both of the shapes our gateway
  speaks. The call **goes straight to OpenAI, not through OpenRouter**.
- The models available are whatever `GET /v1/models` returns for that reader, which means OpenAI
  models only.
- Every request must set `store: false` and `stream: true`. The request may not include
  `temperature`, `top_p`, `max_output_tokens`, `metadata`, `background` or `conversation`, among
  others.
- These are not supported: "Audio/video input, the Files upload API, and the transcription API",
  image generation, file search, and hosted MCP. Embeddings are not mentioned.
- The app must refresh the OAuth token itself.
- The reader's allowance can run out halfway through a stream, and the API then says so with
  `subscription_sharing_usage_limit_exceeded` or `subscription_sharing_usage_unavailable`.

**What the reader gets.** Secondary, from search snippets of
<https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites>,
which refused to load. Requests "count toward the ChatGPT Work and Codex usage included in your
plan". The reader can set a weekly limit for each app, and "You don't need to create or share an
OpenAI API key." So this is the one route where the reader's existing subscription really does
pay. But it draws on the same allowance they use for Codex.

**What it would cost us to support.** It is a third request shape. It is a second vendor outside
OpenRouter, which the gateway doc calls an exception. Anything that runs on Claude would have to be
redone on a GPT model and re-evaluated for these readers. Transcription and live conversation would
stay on us. See the plan for the size.

**Do not build on Codex tokens.** Tools such as OpenClaw reuse the Codex CLI's login by imitating
its requests to an undocumented endpoint. A blog calls this "not clearly sanctioned" (secondary,
<https://manifest.build/blog/chatgpt-plus-tokens-third-party-harnesses/>). OpenAI's terms forbid
sharing account credentials and extracting output "automatically or programmatically" (secondary,
from snippets of <https://openai.com/policies/row-terms-of-use/>, which returned 403). A hosted
server holding readers' Codex tokens would be the least defensible version of this idea.

### 2. Apps in ChatGPT (Apps SDK): a different product, not a way to pay

An app built with the Apps SDK runs *inside* ChatGPT. ChatGPT's own model does the reasoning on the
reader's plan, and our server would only provide tools and panels. Developers have been able to
submit apps since about December 2025 (secondary,
<https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/>). Charging for anything there
is limited. External checkout is "the recommended and generally available approach", and approval
is currently limited to physical goods (secondary, snippets of
<https://developers.openai.com/apps-sdk/build/monetization>). This route would mean giving up our
own reading view, so it is ruled out.

### 3. The reader pastes their own OpenAI API key: doubtful, and no subscription money

This session found no OpenAI term that forbids it outright. But the GPT Sol review reads OpenAI's
key-safety guidance as saying that sharing an API key is against OpenAI's terms. That page returned
403 here, so this is unresolved: treat it as not allowed until someone reads the page. The guidance
also tells people to be wary of third-party tools that ask for a key (secondary, snippets of
<https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety>). **An OpenAI API
key is billed separately from ChatGPT Plus or Pro.** So it does not answer Greg's question, which
is about the subscription he already pays for. Using it would also mean a direct OpenAI wire for
OpenAI models only, with the same problems as route 1.

### 4. Claude Pro or Max: forbidden, according to news reports

Anthropic's docs, updated 2026-02-19, say OAuth tokens from Free, Pro and Max accounts may not be
used in any other product, tool or service (secondary,
<https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/>).
Anthropic started blocking this on 2026-01-09. On 2026-05-13 it partly relented: subscribers got a
separate monthly credit pool for programmatic use of their own tools, billed at API rates (secondary,
<https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch>).
Reports say that pool still does not let a hosted third-party app use subscription credentials
(secondary,
<https://www.techtimes.com/articles/317625/20260602/anthropic-ends-subscription-subsidy-agents-june-15-credit-pool-replaces-flat-rate-access.htm>).
There is no "Sign in with Claude" for billing. **A pasted Anthropic API key is the supported way
in**, but it
bills at API rates, and it is a direct-to-Anthropic wire that
[ai-gateway.md § The calls allowed round the outside](../project/ai-gateway.md#the-calls-allowed-round-the-outside-and-the-test-that-keeps-them-declared)
allows for one eval and nothing else.

### 5. Google AI Pro or Ultra: forbidden, according to news reports

No official route exists. Google suspended accounts that proxied the Gemini CLI login in February
2026 (secondary, <https://syntackle.com/blog/google-gemini-ai-subscription-with-opencode/>; Google's
own statement not found). A Gemini API key is the normal alternative
(<https://ai.google.dev/gemini-api/docs/billing>).

### 6. Connect your OpenRouter account (OAuth PKCE): open now, fits the gateway, no discount on the models

Primary, <https://openrouter.ai/docs/guides/overview/auth/oauth>. We send the reader to OpenRouter
with a callback URL and a PKCE challenge. We swap the code that comes back at
`POST /api/v1/auth/keys` and receive **a user-controlled API key**. The app needs no registration
and no client secret. It is built for third-party apps, and OpenRouter lists them at
<https://openrouter.ai/works-with-openrouter>.

- **Who pays.** Calls on that key spend the reader's OpenRouter credits. This is inferred from how
  OpenRouter keys work, since the OAuth page does not say it. OpenRouter charges its usual list
  price, so **the reader's model cost is what ours is today**.
- **Limits.** OpenRouter keys can carry a credit limit per day, week or month, and a call over the
  limit is refused (secondary, snippet of
  <https://openrouter.ai/docs/api_reference/authentication>). Whether our code can set that limit
  when the key is created was **not verified**. The parameter reference returned 404.
- **It fits what we already have.** The request shape, the models and the prices are all unchanged.
  Only the key on the request changes. The chat gateway already accepts a key override (`apiKey` in
  [`src/ai-call.ts`](../../src/ai-call.ts)). The Messages gateway and about ten call sites read
  `process.env.OPENROUTER_API_KEY` directly.
- **A catch we already know about.** An OpenRouter key opens the door, but the account behind it
  decides which models it may use. If a reader has turned on ZDR (Zero Data Retention) on their
  OpenRouter account, **embeddings will fail** with a message that looks like a mistyped model id.
  [ai-gateway.md § A key is not access](../project/ai-gateway.md#a-key-is-not-access-and-the-difference-is-invisible-until-a-reader-finds-it)
  has the full account. That section will be about readers' accounts rather than ours.

### 7. OpenRouter BYOK, on the reader's own account

OpenRouter lets an account add its own provider keys, for OpenAI, Anthropic and others. Calls then
bill at the provider's price plus a 5% fee, and the fee is waived on the first $25,000 a month
(primary, <https://openrouter.ai/docs/guides/overview/auth/byok>). A reader who connected their
OpenRouter account (route 6) and had their own Anthropic key inside it could therefore pay
Anthropic's own price. **Whether a key issued through OAuth picks up the account's BYOK keys is not
verified.** It would take a probe with a real account. This is still API billing, not a
subscription.

## What other apps do

Bring-your-own-key is the normal pattern. Self-hosted tools such as LibreChat and Open WebUI keep
keys on the server (<https://docs.openwebui.com/features/authentication-access/api-keys/>).
Browser-only tools such as TypingMind keep them in the browser (inferred). Local-first apps use
OpenRouter's OAuth. We found no hosted, paid, closed-source reading app that bills a reader's
ChatGPT plan, and the partner lists above are exactly the companies that have been let in.

## Not verified, and worth checking before building

- Whether a paid hosted app will be admitted to ChatGPT plan usage, and when. Only the interest
  form can answer this.
- The full text of OpenAI's help article and terms. Both returned 403, so every quote from them here
  is a search snippet.
- Whether our code can set a spending limit on an OpenRouter OAuth key.
- Whether OpenRouter OAuth keys use the account's BYOK keys.
- The Anthropic credit-pool rules, taken only from news reports.

## Second round, 2026-09-29: the ChatGPT route in detail

Greg answered the first plan the same day (quoted in full in
[260929g](../plans/260929g-bring-your-own-ai-subscription.md#what-greg-decided)). He wants the
ChatGPT route planned in detail, on the assumption that OpenAI lets us in. This section is the
research that plan rests on. All of it was fetched on 2026-09-29.

The OpenAI docs were read by a Sonnet subagent through a tool that summarises each page, so the
quoted strings are close to OpenAI's words but may not be exact. Re-read the raw pages before
writing code against them.

### How connecting works (primary, `developers.openai.com/siwc/token-sharing-open-source/*`)

- **Signing in.** The documented flow is for a *public* client: OAuth 2.0 with OIDC and PKCE
  (S256), a loopback redirect `http://127.0.0.1:{port}/callback`, and no client secret.
  - Scopes: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`.
  - Resource: `https://api.openai.com/v1`.
  - The first sign-in registers a client dynamically, with `client_id=dynamic_agent_client`, and
    gets back an issued `oaiapp_…` id. A persistent `ext_agent_host_id` is required.

  The *identity-only* website flow does support confidential clients with registered callback URLs
  (`/siwc/website`). A hosted app like ours would need that kind of client with the token-sharing
  scopes. **That combination is not documented**, and is presumably what the interest form leads
  to.
- **Tokens** (`/token-reference`, `/profiles-and-sessions`).
  - An access token lasts 1 hour.
  - A refresh token lasts 30 days, and each refresh replaces it with a fresh 30 days.
  - The token response carries `earliest_refresh_at`.
  - We must always store the newest refresh token and never refresh twice at once, because
    reusing an old one fails with `refresh_token_reused`.
  - Revoking is a POST to the discovery document's `revocation_endpoint`.
  - The user is identified by `sub`.
- **OpenAI does not tell us when a reader disconnects the app.** We find out only when a call or a
  refresh fails (`/profiles-and-sessions`). And signing out of our app does not disconnect it on
  ChatGPT's side (secondary, Help Center snippet).
- **Eligible plans: Plus and Pro** (`/siwc/quickstart`). Business and Enterprise are not mentioned.
  `subscription_sharing_user_not_eligible` covers the rest.

### What a call may contain (`/models-and-inference`, `/preview-limitations`)

- **Only `POST /v1/responses` is allowed.** The model list comes from `GET /v1/models`, filtered to
  `visibility == "list"`, and the docs' example slug is `gpt-6.1-sol`.
- Every request must set `store: false` and `stream: true`, and `input` must be an array.
  Instructions go in `instructions` or developer messages, because the `system` role is not
  accepted.
- **Rejected fields:** `max_output_tokens`, `temperature`, `top_p`, `metadata`, `background`,
  `conversation`, `prompt`, `prompt_cache_retention`, `truncation`, `user`, `safety_identifier`,
  `moderation`, `max_tool_calls`, `top_logprobs`, `multi_agent`. And `previous_response_id` cannot
  be used over HTTP.
- **Unsupported:** audio and video input, the Files API, transcription, image generation, file
  search, Code Interpreter, and hosted connectors. Realtime and embeddings are not mentioned, but
  only `/v1/responses` is an allowed route, so they are out.
- **Whether a server may call on the reader's behalf in a background job, while they are not
  there, is not documented.** The docs cover open-source and locally hosted apps. The self-hosted
  VM page moves a credential file to a remote machine, and says that "host-specific usage
  attribution and revocation … for transferred sessions are not yet available".

### Errors (`/errors-and-recovery`)

| code | HTTP | what the docs say to do |
|---|---|---|
| `subscription_sharing_usage_limit_exceeded` | 429, or `response.failed` mid-stream | pause requests on the plan; link to ChatGPT Settings → Usage |
| `subscription_sharing_usage_unavailable` | 503, or mid-stream | usage could not be checked; back off |
| `subscription_sharing_user_not_eligible` | 403 | explain; do not retry |
| `subscription_sharing_invalid_user` | 401 | ask the reader to sign in again |
| `subscription_sharing_unsupported_capability` | 400 | remove what `error.param` names |
| `subscription_sharing_route_not_supported` | 403 | use `/v1/responses` |
| refresh: `invalid_grant`, `refresh_token_expired`, `refresh_token_invalidated`, `refresh_token_reused`, … | ? | clear the tokens and sign in again |

A failure before the stream starts may come back as `{"detail": "…"}` rather than a standard error
object.

**No reset time is documented, in an error or anywhere else.** No endpoint returns the reader's
remaining allowance. Codex's own app-server can read it (`account/rateLimits/read`, with
`resetsAt`, `usedPercent` and `windowDurationMins`, as measured on the box on 2026-09-09 against our
own login), but the SIWC docs do not offer that method. "For ChatGPT Plus users, the five-hour usage
limit is shared across all apps where they use their ChatGPT plan" (`/profiles-and-sessions`). A
reader can also set a weekly cap for each app in ChatGPT Settings → Usage (secondary). The exact URL
of that settings page was not verified.

**Spike, free, 2026-09-29.** `POST https://api.openai.com/v1/responses` and `GET /v1/models`, sent
with a made-up bearer token, both return HTTP 401 with
`{"error":{"code":"invalid_api_key","message":"Incorrect API key provided: … You can find your API key at https://platform.openai.com/account/api-keys."}}`.
That is the ordinary API-key error, and its advice is wrong for a ChatGPT reader, who has no API
key. **OpenAI's error text must never be passed through to a reader.** Map it to our own sentence.
What a real, expired ChatGPT token returns can only be seen once we have a client id.

### The nearest OpenAI model to Claude Sonnet (Artificial Analysis leaderboard, primary)

<https://artificialanalysis.ai/leaderboards/models>, fetched 2026-09-29. Prices are per million
tokens from OpenRouter's public model list (`GET https://openrouter.ai/api/v1/models`), read the
same day.

| model, effort | AA Intelligence Index | first token (s) | tokens/s | $ in / out |
|---|---|---|---|---|
| Claude Sonnet 5.5, high | 47 | 16 | 89 | 2 / 10 |
| Claude Sonnet 5.5, medium | 41 | 1.3 | 89 | 2 / 10 |
| **GPT-6.1 Sol, medium** | **48** | 5.3 | 62 | 2 / 10 |
| **GPT-6.1 Sol, low** | **42** | 1.8 | 74 | 2 / 10 |
| GPT-6 Sol, high | 43 | 15 | 66 | 2 / 10 |
| GPT-5.6 Terra, max | 42 | 139 | 98 | 2 / 12 |
| GPT-6 Luna, max | 37 | 97 | 148 | 0.10 / 0.50 |

- **Terra is not competitive.** The newest is GPT-5.6 Terra, and at max effort it is slower than
  Sol and scores lower.
- **There is no "Luna Pro".** The Pro-only reasoning models (GPT-6 Astra, GPT-5.6 Sol Pro) are not
  on Plus, so they cannot be the default.
- **GPT-6.1 Sol is on Plus and Pro** (primary, <https://learn.chatgpt.com/docs/models>). Whether it
  appears in a SIWC token's `/v1/models` list is not verified.
- AA's index measures general reasoning. It does not measure JSON structuring or faithfulness over
  a 5k–60k-token article, and AA's long-context benchmark (AA-LCR) was not obtained. So the swap
  needs our own eval.
- **Claude Sonnet 5 is deprecated** on AA in favour of Claude Sonnet 5.5, released 2026-09-28 at the
  same price (<https://artificialanalysis.ai/articles/claude-sonnet-5-5>). The two scores sit on
  different index versions and must not be compared. This is worth its own look, separately from
  this work.

### Prices of what would stay on us

- **Live voice.** `gpt-realtime-2.1` costs $32 per million audio tokens in and $64 out (from
  [`src/pricing.ts`](../../src/pricing.ts)). At about 600 tokens a minute for the reader's speech
  and 1,200 for the model's, that is about $0.02 a minute listening and $0.08 a minute speaking.
  Opening a session costs about $0.06 of article text, and about a tenth of that on each turn after
  ([260831g](../plans/260831g-live-conversation.md)). Published measurements put typical sessions
  at $0.06–$0.11 a minute (secondary,
  <https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4000-measured-sessions>).
  `gpt-live-transcribe` adds $0.017 a minute. The local ledger has no realtime sessions to measure
  against, so these are estimates.
- **Dictation, embeddings, images and PDF figures.** Small. See the plan's cost table.
