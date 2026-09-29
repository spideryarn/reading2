# Readers paying with their own ChatGPT plan

Feedback report SPIDERYARN-READING2-5J (`spya-ddpn5x`), from Greg (admin, so trusted input).

> It would be amazing to be able to use my OpenAI subscription, if I've already got whatever it is,
> ChatGPT Pro, and then it would use that and I'd get a discounted price. Let's not implement it
> yet. Just do some research and put together a plan. Let's consider how complex it is, and then
> we'll go from there. But don't actually start implementing.
>
> — Greg, 2026-09-29

**Status: plan only, nothing built. This is the second version, written the same day after Greg
answered the first. It is waiting on two things:**
1. OpenAI letting Spideryarn into "Sign in with ChatGPT" plan usage. Greg has not yet decided
   whether to apply.
2. Greg deciding whether the complexity described below is worth it.

The research, with sources, is
[260929a-paying-for-model-calls-with-the-reader-s-own-ai-subscription.md](../research/260929a-paying-for-model-calls-with-the-reader-s-own-ai-subscription.md).
Its second section covers the ChatGPT route in detail.

## What this is for

Some readers already pay for ChatGPT Plus or Pro. If that plan paid for their Spideryarn model
calls, we could sell them Spideryarn at a quarter of the price. That would be a real reason for a
ChatGPT user to choose us, and it costs us less per reader.

## What Greg decided

Relayed by the Overseer, 2026-09-29, verbatim:

> - What do you mean "will you send the form?"
> - Yeah, I think that's the idea. Maybe it would be 1/4 of the price if they use their own ChatGPT
>   subscription.
> - If someone on ChatGPT Pro subscription removes their key, they effectively drop back to the Free
>   version (with the analogous rules as for someone who was paying us directly after they cancel
>   their subscription).
> _ Also, we might have to think about what to do for models that we use that aren't covered by the
>   OpenAI subscription (e.g. Sonnet, or other OpenRouter functionality or live voice). For
>   something like Sonnet, let's swap for the nearest equivalent (e.g. perhaps Terra if there's a
>   recent version, or perhaps the latest Luna with Pro reasoning, or maybe Sol with low reasoning,
>   something like that - use web research especially Artificial Analysis data/rankings).
> - Actually, thinking this through, if something relatively expensive like Live (realtime) Voice
>   isn't covered by the subscription, then we need to make sure we are charging them enough to
>   cover that. I don't know if 1/4 of the full price would be enough, but let's go for that. And
>   make sure to note this as partial explanation on the Pricing page.
> - And of course you'll need to run spikes and/or do Sonnet web research to understand error
>   situations, e.g. if someone runs out of credit, and provide understandable actionable error
>   messages, e.g. telling them when it'll renew and where to see the Usage data on the ChatGPT
>   site, etc)
> - I'm a little worried this will introduce a lot of complexity. If you think you can build this
>   with confidence without it making things really complicated, say so. But for now, just do the
>   research and write a detailed plan, update docs etc accordingly.

**On "the form":** OpenAI's documentation covers plan usage only for open-source and locally hosted
apps. A paid, hosted app has to apply through
<https://openai.com/form/sign-in-with-chatgpt-interest/>, and we have no access until OpenAI says
yes. Nothing in this plan can be tried against a real ChatGPT account before then. The Overseer has
explained this to Greg. **Applying is Greg's call**, because it speaks for the company.

## The answer to Greg's last question, first

**No. I cannot build this with confidence without it becoming really complicated.** The size of
the work is set by OpenAI's rules and by our billing model, not by any one piece of code. There are
four reasons:

1. **Every Claude call gets an OpenAI twin.**
   - The pipeline and chat run on Claude. ChatGPT plan usage accepts only OpenAI's Responses API
     and OpenAI models, and it refuses `max_output_tokens` and `temperature`.
   - The code change can be kept in one place: an adapter at the two places where every call is
     already assembled (`streamMessage` in `messages-stream.ts`, and `outgoing` in `ai-call.ts`).
     We do not need to edit fifteen callers.
   - But every stage then runs on two model families. Every later prompt change must be measured
     on both. Web search, citations and the Claude-specific habits in our prompts need their own
     adapter work.
2. **A second vendor, with its own tokens, outside the one gateway.** Each reader has a 1-hour
   access token and a 30-day refresh token, which must be refreshed one at a time and stored like a
   password. Calls go straight to OpenAI, so this is a second sanctioned exception beside live
   conversation, with its own metering. And OpenAI does not tell us when a reader disconnects.
3. **Billing gains a new dimension.** Today a dearer plan always means more articles (a test
   enforces it). A ChatGPT plan is the same number of articles for less money, *on condition of* a
   live connection. So tiers, checkout, the Portal and admission all have to learn "who pays for the
   models" as well as "how many articles".
4. **Much of it cannot be tested until OpenAI lets us in**, and the rules are a "preview" that may
   change. We would be building against documents written for a different kind of app.

A rough size is **30–45 agent-days, or 6–9 weeks**, broken down at the end. It is not dangerous,
but it would be the largest single piece of plumbing in the app, and every future prompt or model
change would have to cover two model families.

**My recommendation:** apply to OpenAI, since it costs nothing. Before building, run the one
experiment we can run now, the model-swap eval in § 4. It tells us whether GPT-6.1 Sol is good
enough at our stages, which is the question most likely to kill the idea. It costs roughly $10–20
through OpenRouter and needs Greg's go-ahead. If OpenAI says yes and the eval passes, build it in
the stages below, with the cuts under [Making it less complicated](#making-it-less-complicated). The
biggest of those cuts is leaving live voice off the cheaper tiers.

## The design

```
reader ──"Continue with ChatGPT"──▶ auth.openai.com ──code──▶ /api/chatgpt/callback
                                                              │ tokens (1 h access, 30 d refresh)
                                                              ▼
                                        chatgpt_connections (encrypted), one row per owner
                                                              │
every model call ── a reader's request or job? ── their tier is a ChatGPT tier? ── yes ─▶ Responses wire,
                    (CLI / eval → our key)                                                api.openai.com,
                                                                                          their token
                                                                  └── no ──▶ OpenRouter, our key (as today)
   calls the plan cannot make (dictation, embeddings, images, PDF figures) ─▶ our key; live voice not offered
```

### 1. Whose credential pays for a call

This is the same seam that the first version's route B needed, and GPT Sol's review of that version
applies unchanged (see [Appendix: review of the first version](#appendix-review-of-the-first-version)):

- The owner is not known when a request makes its call, and `streamMessage` is synchronous. So the
  credential has to be loaded into a context before the call is made: after sign-in for a request,
  and when a job starts for a job.
- The selector decides by kind of call as well as by owner. CLI and eval runs always use our key.
- A new ledger column records who paid (`us` or `chatgpt_plan`). Reports must not count the
  reader's usage as our spend. `is_byok` is not reused for this.

### 2. Connecting a ChatGPT account

- **"Continue with ChatGPT"** on `/profile` and on the pricing page. OpenAI's UI guidelines fix
  that wording (`/siwc/ui-ux-guidelines`).
- **The flow.** We would use OAuth with PKCE, `state` and `nonce`, bound to the signed-in owner,
  with the scopes in the research doc. We would verify the ID token against OpenAI's JWKS and store
  `sub`. **The flow for a hosted app is not documented.** The public documents describe a loopback
  redirect for local apps. So this step is written against what the interest form grants.
- **Storing tokens.** One row per owner, encrypted, with a versioned server secret. Refresh when
  `earliest_refresh_at` allows. Take a row lock on every refresh so two jobs cannot refresh at once
  (`refresh_token_reused` would disconnect the reader). Always keep the newest refresh token. Never
  log a token and never send one to the browser.
- **Disconnecting.** From our side it is a revoke plus deleting the row. From OpenAI's side we are
  never told, so we find out on the next failed call or refresh (`subscription_sharing_invalid_user`,
  or a refresh error).
- **After a disconnect, the reader drops back to Free the way a cancellation does**, as Greg
  decided. Today a cancelled subscription keeps its plan until the end of the period it has paid
  for, and then becomes Free
  ([billing.md § How Stripe says a subscription is ending](../project/billing.md#how-stripe-says-a-subscription-is-ending)).
  The analogy:
  1. We set their Stripe subscription to cancel at the period end, so they are not charged again.
  2. **Until then the plan is *paused*, not Free.** Everything already made stays readable, but no
     new model call is made, because there is nothing to pay for it. The ingest quota is the plan's,
     as a cancelled plan's is.
  3. At the period end they are an ordinary Free reader, and like any Free reader their calls are
     paid by us.
  4. Reconnecting before the period end un-pauses the plan and removes the cancellation.

  **Why paused and not Free at once:** a Free reader's chat, explain and mode calls are paid by us,
  with no per-reader cap. "Free at once" would let a reader who has hit their ChatGPT limit
  disconnect, chat on our money across all of this month's articles, and reconnect. The paused
  state closes that, and it matches what a cancelled subscription already does.
- **Not every 401 is a disconnect.** OpenAI's advice on `subscription_sharing_invalid_user` is to
  keep the request id, diagnose the problem, and ask the reader to sign in again only after a
  revocation is confirmed or a refresh fails for good. So we treat it as disconnected only after
  one refresh attempt fails terminally.

### 3. The Responses wire

- **A new wire value and one new seam**, beside `messages-stream.ts` and `ai-call.ts`. It speaks `POST /v1/responses`
  with `stream: true`, `store: false`, `input` as an array, and instructions in `instructions`.
  - It never sends the rejected fields.
  - It sets a fixed `reasoning.effort` for each job, because there is no adaptive thinking (the
    same loss [ai-gateway.md § Why the stages were not translated](../project/ai-gateway.md#why-the-stages-were-not-translated)
    refused to take on OpenRouter).
  - **Only `response.completed` counts as success.** `response.failed`, `response.incomplete`, or a
    stream that simply stops are all failures, not endings
    ([ai-gateway.md § stream-end](../project/ai-gateway.md#stream-end)).
- **Declared, and it writes rows.** It goes in [`src/spend-declarations.ts`](../../src/spend-declarations.ts)
  as a second sanctioned exception to "everything through OpenRouter". Its rows carry token counts
  and `paid_by = 'chatgpt_plan'`, and cost *us* nothing. `tests/no-undeclared-spend.test.ts` is
  extended to cover it.
- **One adapter at each of the two assembly points**, not a change in each of the fifteen callers:
  - Anthropic Messages → Responses at `streamMessage`;
  - chat/completions → Responses at `outgoing`.

  Each adapter maps the request, and maps the stream back into the shape callers already use.
  Per-job exceptions are added only where the eval shows a prompt needs one: `cache_control`
  breakpoints, prefills, `stop_reason === "refusal"`, JSON habits, and web search with its citation
  shapes, which is OpenRouter-specific today.

### 4. Which model does which job for a ChatGPT reader

From the Artificial Analysis leaderboard, fetched 2026-09-29 (research doc § nearest model):

| job | today | for a ChatGPT-plan reader | why |
|---|---|---|---|
| pipeline stages (hierarchy, labels, glossary, ideas, quotes, timeline, quiz, sketch, …) | Claude Sonnet 5, adaptive thinking | **GPT-6.1 Sol, medium effort** | index 48, against 47 for Sonnet 5.5 at high effort; same token price; about 5 s to first token, which a background job does not mind |
| explain, chat, quiz marking | Claude Sonnet 5 | **GPT-6.1 Sol, low effort** | index 42 with 1.8 s to first token; Greg's "Sol with low reasoning" is what the data supports |
| quick jobs, quiz verdict, shelf topics | GPT-5.6 Luna / GPT-6 Luna | GPT-6 Luna, same effort | already OpenAI |
| PDF reading | GPT-5.6 Luna, inline file input | **moves, if a spike confirms it** | OpenAI excludes the Files *upload* API but accepts inline files where the model does, and our reader already sends the PDF inline |
| web search in chat, explain, citations, the referee | OpenRouter's web tool | moves, with adapter work | allowed "subject to model and account policy"; its tool and citation shapes differ |

**Terra and "Luna with Pro reasoning" are not recommended.** GPT-5.6 Terra is the newest Terra, and
it is slower and scores lower than Sol. The Pro-only models are not on Plus. If Sol is missing from
a reader's `/v1/models` list, use GPT-6 Sol at high effort (index 43).

**The eval that has to come first.** Run each pipeline stage, and chat, on GPT-6.1 Sol through
OpenRouter (`openai/gpt-6.1-sol`, the same model at the same price), against Sonnet on the eval
corpus. Judge the outputs blind ([prompting-guide.md](../project/prompting-guide.md)). This needs no
OpenAI access, and it is the cheapest way to find out whether the idea survives. Separately,
Claude Sonnet 5.5 came out on 2026-09-28 at the same price. That deserves its own look.

### 5. What stays on us

The plan cannot make these calls, so we keep paying for them:

| | why it stays on us | our cost |
|---|---|---|
| live voice | the Realtime API is not an allowed route | ~$0.08–$0.13 a minute with transcription, plus ~$0.06 to open a session; **~$1.60–$2.60 for a full 20-minute session** |
| dictation | transcription is excluded | $0.006–$0.017 a minute |
| embeddings | not an allowed route | ~$0.001 an article |
| illustrated diagrams | image generation is excluded | a few cents an image, unmeasured |
| finding figures in a PDF | a Google model, `google/gemini-3-flash-preview` | small, unmeasured on its own |

**Recommendation: leave live voice off the ChatGPT tiers in v1.** The first version of this plan
proposed a monthly allowance of 10 minutes, checked when a session starts. GPT Sol's review showed
it cannot be enforced honestly today, for three reasons:
- **A check at the start is not a cap.** It admits a session that can then run for twenty minutes.
  Two tabs starting at once can each be admitted.
- **The only meter is the browser's own report.** It can lose the last turn, and `src/live.ts` says
  in so many words not to use it for an allowance until it has a durable outbox.
- **Nothing on our server can end a session.**

An enforceable allowance would need all three fixed: a whole session reserved up front, with
starts serialised; a durable outbox for the meter; and a server-side ceiling. That is a separate
project. Leaving live voice off the ChatGPT tiers, with the pricing page saying so, is simpler and
honest. A reader who wants it can take a full-price plan.

### 6. Errors a reader can act on

We never show OpenAI's own error text. The free spike showed why: a bad token gets back *"Incorrect
API key provided … find your API key at platform.openai.com"*, which means nothing to someone who
signed in with ChatGPT.

| what happened | what we say (proposal, for [copy.md](../project/copy.md)) | what we do |
|---|---|---|
| usage limit reached (`…usage_limit_exceeded`, before or during a stream) | "Your ChatGPT plan's usage limit for Spideryarn has been reached, so we stopped. You can see when it resets, and change any limit you've set for Spideryarn, in ChatGPT → Settings → Usage. Everything finished so far is saved." [Manage usage] [Retry] | the job fails and its slot is released |
| usage could not be checked (`…usage_unavailable`) or ChatGPT unavailable (`…user_unavailable`, 503, other 5xx, a dropped connection) | "ChatGPT isn't answering just now. We'll try again in a moment." | keep the tokens; retry with a bounded backoff; then fail as above |
| not eligible (`…user_not_eligible`) | "This ChatGPT account can't be used to pay here. It needs a Plus or Pro plan, and some work accounts are excluded." | offer the full-price plans |
| token refused (`…invalid_user`, 401) | nothing yet | refresh once; only a terminal refresh error or a confirmed revocation counts as a disconnect |
| disconnected (terminal refresh error: `invalid_grant`, `refresh_token_expired`, …) | "Spideryarn is no longer connected to your ChatGPT account, so your plan is paused. Reconnect to carry on." [Continue with ChatGPT] | paused, then cancelled at period end (§ 2) |
| something we sent was refused (`…unsupported_capability`, `…route_not_supported`, a scope error) | our ordinary "something went wrong on our side" | logged as our bug, with `error.param` and OpenAI's request id |
| the stream ended without `response.completed` | treated as a failure, like a dropped connection | — |

**Greg asked for "when it'll renew". We cannot say, and OpenAI tells us not to guess.** Its docs
say not to infer a reset time from a limit error, because the limit may be one the reader set for
our app alone rather than their plan's. No documented field or endpoint gives the time. So the
message sends the reader to ChatGPT → Settings → Usage, which shows the time exactly. If the API we
are admitted to turns out to carry a reset time, we show it. The exact URL of that settings page is
not verified, so the link waits for access.

**What "retry" means, precisely.** A stage that has finished keeps its result, and some multi-call
stages (the hierarchy) keep checkpoints within themselves. But the call that was in flight when the
limit hit is lost and runs again. Retrying a failed ingest reserves a fresh slot
([billing.md § Which requests spend a slot](../project/billing.md#which-requests-spend-a-slot-and-why-the-wall-is-at-the-routes)).
The failed attempt gave its slot back, so this costs the reader nothing, unless their month's
allowance has run out in the meantime. The copy must not promise more than that.

### 7. Billing

The ChatGPT tiers do not fit today's tier model, and that is most of this stage:

- **A dearer tier must allow more articles.** `tests/billing-tiers.test.ts` ("charges more for
  more") enforces it, and `src/billing/tiers.ts` deliberately offers no switch between tiers with
  the same allowance. "Reader with ChatGPT" is the same 20 articles as Reader for less money. So
  tiers need a new **payer** dimension (we pay, or the reader's ChatGPT plan pays), with the
  ordering rules applying within each payer family. It also needs a Portal configuration that does
  not offer switches across families.
- **Prices.** The test requires multiples of 50 minor units. There is no 5× test, though the seeded
  prices happen to keep that ratio. A quarter of today's prices is $2.50 / £2 / €2.25 and $12.50 /
  £10 / €11.25. **The euro amounts round up to €2.50 and €11.50**, and the rest pass as they are.
- **The tier row gains a condition: it requires a live ChatGPT connection.** Checkout refuses the
  tier without one. Admission treats a paused plan (§ 2) as making no model calls. Entitlement
  today comes from Stripe's status and price alone (`src/store/pg-billing.ts`), so the paused state
  is new.
- **Disconnecting** sets the Stripe subscription to cancel at the period end, and reconnecting
  clears that (§ 2).

### 8. The pricing page (proposed wording)

> **Already pay for ChatGPT Plus or Pro?** Connect it, and Spideryarn costs a quarter as much. Your
> ChatGPT plan pays for the AI that reads, summarises and answers questions about your articles. It
> counts towards your ChatGPT usage like any other app you connect. Live voice conversation isn't
> included, because ChatGPT plans can't pay for it and it costs us more than a quarter-price plan
> brings in. A few smaller things, such as dictation and illustrated diagrams, are still on us.
> That's why the price is a quarter and not zero.
> [Continue with ChatGPT]

**And `/privacy`** must say that we store a token for the reader's ChatGPT account, used only to
make these calls. It must say that their article text then goes to OpenAI under their own ChatGPT
account's terms, not under our OpenRouter account's settings. Wording on that page goes to Greg.

## Does a quarter of the price cover what stays on us?

Net per month, after VAT (prices include it) and Stripe's fees: 1.5% + 20p for a UK card, plus
3.5% for Managed Payments
([billing.md § Managed Payments](../project/billing.md#managed-payments-and-what-it-is-worth)).
GPT Sol checked this and found it correct.

| tier | price | what we keep (UK buyer) |
|---|---|---|
| Reader with ChatGPT | £2 | £2 − £0.33 VAT − £0.30 fees ≈ **£1.37 (~$1.85)** |
| Researcher with ChatGPT | £10 | £10 − £1.67 VAT − £0.70 fees ≈ **£7.63 (~$10.30)** |

What a heavy reader could cost us on the calls the plan cannot make:

| usage in a month | our cost |
|---|---|
| 20 articles ingested (embeddings, PDF figures) | a few cents |
| 60 minutes of dictation | $0.36–$1.00 |
| a handful of illustrated diagrams | a few cents each |
| **one full 20-minute live conversation** | **$1.60–$2.60** |
| ten minutes of live voice | $0.83–$1.33 |

**Without live voice, a quarter covers it.** What stays on us is cents to about a dollar a month
for a heavy dictation user. That is inside the £1.37 we keep on Reader, with more room on
Researcher. PDF reading would add ~$0.05 a PDF if the spike in § 4 shows it cannot move.

**With live voice, it does not.** A single full conversation costs more than everything we keep
from a Reader-with-ChatGPT month. Even ten minutes, which the first version of this plan proposed as
an allowance, uses most of it. That is why § 5 leaves live voice off these tiers.

Two things to know:
- **This is not new exposure.** Full-price readers have no live-voice cap today either. At £8 we
  keep about £6.07 (~$8.20), so three to five full conversations a month use up a full-price
  Reader subscription too. That is worth a look on its own.
- **The live-voice figures are estimates.** The local ledger has no realtime sessions, and
  production was not queried.

## Making it less complicated

Each of these takes a real part out of the work, and the plan above already assumes the first
three:

1. **Only calls the plan can make move to it**, and the rest stay on us (§ 5).
2. **No live voice on the ChatGPT tiers.** This removes the allowance, the durable outbox and the
   server-side cap.
3. **Adapters at the two assembly points**, not changes in every caller.
4. **One model family member, GPT-6.1 Sol, at two efforts.** No per-reader model lists and no
   fallback models: if Sol is missing, the reader is told their plan can't be used.
5. **ChatGPT only from subscription onwards.** No Portal switches between payer families. A reader
   cancels one plan and subscribes to the other.

Even with all five, three things remain: every stage on two model families, a second vendor's
tokens, and a billing model that learns who pays. None of the cuts removes those.

## Stages, and what each needs before it can start

| stage | what | can start before OpenAI access? | size (agent-days) |
|---|---|---|---|
| 0 | Greg applies through the interest form | — | — |
| 1 | the eval: every stage and chat on GPT-6.1 Sol via OpenRouter, judged blind against Sonnet | **yes**, ~$10–20, needs Greg's OK | 3–5 |
| 2 | credential context, payer selector, `paid_by` column | yes, but pointless unless 3 follows | 3–4 |
| 3 | connecting: OAuth, token storage, serialised refresh, revoke, the paused state | **no** (needs a client id; the hosted flow is undocumented) | 4–6 |
| 4 | the Responses wire: declared, metered, `response.completed` as the only success | partly: built against the docs, but not run | 3–5 |
| 5 | the two adapters, plus the per-job exceptions the eval asks for, and web search and citations | partly: the prompts can be tried on OpenRouter's `openai/gpt-6.1-sol` | 5–8 |
| 6 | billing: the payer dimension, tier invariants, checkout gating, Portal, cancel at period end, admission for the paused state | yes | 4–6 |
| 7 | error copy, "Using ChatGPT plan" labels, `/profile`, pricing page, `/privacy` | the words yes; the codes only after access | 3–4 |
| 8 | reviews, the browser check, and a real Plus account end to end | no | 4–6 |

**About 30–45 agent-days, or 6–9 weeks**, once OpenAI says yes and stage 1 passes. GPT Sol's view:
the old 26-day floor was optimistic. The code for the stages is smaller than first thought, but the
billing and error handling are larger.

### What cannot be known or tested until OpenAI lets us in

- Whether a hosted server may call on a reader's behalf in a background job, while they are away.
  The pipeline depends on this. If the answer is no, only chat could move, and a quarter price
  would not be affordable.
- The OAuth flow for a hosted app: confidential client, redirect URLs, and whether dynamic
  registration applies.
- Which models a real Plus token's `/v1/models` returns, and whether GPT-6.1 Sol is among them.
- The real error bodies, before and during a stream, and whether any of them carries a reset time.
- Whether usage comes back in the stream, in which case our rows can carry token counts.
- Whether file (PDF) input works through this route.
- Any developer terms on charging readers who use this route. None are published.

## Open questions for Greg

1. Apply to OpenAI through the interest form?
2. Run the stage-1 eval (~$10–20 on OpenRouter) before deciding whether to build?
3. Prices: $2.50 / £2 / €2.50 and $12.50 / £10 / €11.50? That is a quarter, with the euro amounts
   rounded up to the nearest 50 cents.
4. Live voice left off the ChatGPT tiers? (Recommended. The alternative is an enforceable
   allowance, which is its own project.)
5. After a disconnect, the plan is paused until the period ends, then Free (§ 2). Is that the
   reading of "analogous to cancelling" you meant? The alternative is "Free at once", which opens a
   way to chat on our money.
6. A reader at their ChatGPT limit has their paid features paused until it resets, with no fallback
   to our key. Accept?

## Appendix: the options from the first version

### What the research found, in one table

| route | allowed? | available to us now? | does the reader's existing subscription pay? | fits our gateway? |
|---|---|---|---|---|
| **A. Sign in with ChatGPT, plan usage** | yes, it is OpenAI's own programme | **no**: a paid hosted app must apply through an interest form | **yes**, from their plan's Codex/Work allowance | no: a new request format, direct to OpenAI, OpenAI models only |
| **B. Connect your OpenRouter account** (OAuth) | yes | **yes** | no: they pay from OpenRouter credits at list price | mostly: same models and same wires, but the key has to reach every call before it is sent |
| C. Pasted OpenAI / Anthropic / Gemini API key | unclear: OpenAI's key-safety guidance may treat sharing a key as against its terms | yes | no: this is API billing, not a subscription | no: a direct wire for each vendor |
| D. Claude Pro/Max or Google AI Pro subscription | **forbidden**, according to 2026 news reports of enforcement by both (vendors' own pages not read) | — | — | — |
| E. Build it as an app inside ChatGPT (Apps SDK) | yes | yes | yes | no: it would be a different product with no reading view of our own |

**So what Greg asked for exactly (A) is real, but we do not have access to it and would have to apply. It would also only cover
the part of the app that runs on OpenAI models.** The one route that is open and fits the app (B)
gives the reader no discount on the models. Their saving would come only from our cheaper plan.


### Route B, kept as the fallback: connect your OpenRouter account

Route B needs no OpenAI access, but it gives the reader no discount on the models. It shares § 1
(whose credential pays) with the ChatGPT route. Its full design, as reviewed:

#### Its size: medium-large, roughly 7–10 days of agent work, reviews included

The first draft of this section said 3–5 days. GPT Sol's review showed that was built on a wrong
premise (review finding 1, below), and the size went up.

```
reader ──"Connect OpenRouter"──▶ openrouter.ai/auth ──code──▶ /api/byo/callback
                                                              │ swap code for key
                                                              ▼
                                            owner_ai_keys (encrypted), one row per owner
                                                              │
every model call ── what kind of call? ── a reader's request or job, on the BYO plan ─▶ their key, or refuse
                                       ├─ a reader's call, not on the BYO plan ────────▶ OPENROUTER_API_KEY (as today)
                                       └─ CLI / eval / tool ─────────────────────────────▶ OPENROUTER_API_KEY
```

1. **Connecting.** Two routes: start, which makes the PKCE challenge, and callback, which swaps the
   code for a key. Plus a "Connected / Disconnect" row on `/profile`. That is not the whole of it:
   - The callback must be bound to the signed-in owner, with a one-time, expiring `state`.
   - The PKCE verifier must be stored safely until the swap.
   - A replay, or a reader who switches accounts partway through, must not attach a key to the wrong
     owner.
   - Disconnecting must require the reader to be signed in.
2. **Storing the key.** A new table with one row per owner and the key encrypted at rest.
   - The encryption key is a new server secret with a version on it, so that it can be rotated. It
     goes on Vercel and in the box's env file.
   - The key is never returned to the browser and never logged. Adding its field name to
     [`src/log-redaction.ts`](../../src/log-redaction.ts) is not enough on its own, because the
     redactor says itself that it cannot catch a secret inside a message or a URL.
   - A key is the reader's money, so this lands on [security-map.md](../project/security-map.md) and
     gets a security review.
   - A stolen Spideryarn session could drain the reader's OpenRouter credits, and our global
     OpenRouter cap does not protect *their* account. So we need either a per-owner rate limit or a
     spending limit set on the key itself. Whether OpenRouter lets us set one when the key is created
     is not verified yet.
3. **Choosing the key before each call.** This is the hard part. It is harder than the first draft
   said, for two reasons:
   - A request's spend scope does **not** know its owner when the call is made. The collector opens
     before sign-in is checked, and `ownerFor` in [`src/ai-spend.ts`](../../src/ai-spend.ts) finds
     the owner only when it writes the ledger row, *after* the call ([`src/routes.ts`](../../src/routes.ts)
     around `collectSpend(() => serveApi…)`).
   - `streamMessage` in [`src/messages-stream.ts`](../../src/messages-stream.ts) is synchronous and
     builds its client at once, so it cannot stop to decrypt a key from the database.

   So the key has to be loaded *before* the call and carried alongside it, in a credential context
   set once sign-in has passed and once a job has loaded its owner. The alternative is to make
   `streamMessage` asynchronous and change every one of its callers. Embeddings, transcription and
   PDF reading also each fetch the key themselves, and about ten files read
   `process.env.OPENROUTER_API_KEY` directly. All of them move onto one selector, and a test like
   `tests/no-undeclared-spend.test.ts` must fail if any file reads the variable again. That test
   matters because a missed call site shows no symptom: it simply goes on being paid by us.
   - **The selector decides by kind of call as well as by owner.** CLI and eval runs carry an owner
     too, which comes from the environment (`src/cli-ledger.ts`). Choosing by owner alone would
     charge Greg's own stored key for eval work.
   - **Background jobs are fine.** A job stores its owner, and so does the `labels` successor
     (`src/store/pg-successor.ts`), so it is a reader's call like any other and is not work that
     belongs to nobody.
   - **Shared caches are fine.** Sol checked, and nothing generated by a model is cached across
     owners. Checkpoints belong to one article, and link summaries are keyed by owner. The only
     thing shared between readers is raw source bytes, and no model call produces those.
4. **The ledger.** `ai_calls` needs a new column saying who paid: us or the reader. Without it
   `npm run cost` and the per-owner reports would count readers' money as ours.
   - Do **not** reuse `is_byok` for this. It means that OpenRouter used an upstream provider key,
     which is a different fact.
   - Keep `credits_used_nanos` meaning what OpenRouter deducted, even when the credits were the
     reader's.
   - `--reconcile` needs no change. It already fingerprints `OPENROUTER_API_KEY` and leaves out rows
     made with any other key. The first draft said otherwise, and it was wrong.
5. **Failures the reader must be able to read.** These are: out of credits (402), key revoked
   (401), rate limited (429), and their account's privacy settings removing a model (the
   "no endpoints" 404; see
   [ai-gateway.md § A key is not access](../project/ai-gateway.md#a-key-is-not-access-and-the-difference-is-invisible-until-a-reader-finds-it)).
   That last one can hit any model, not only embeddings. So when a reader connects, we should run a
   small check on each wire (Messages, chat, embeddings, images, transcription) and tell them plainly
   which features their account will not run. Each failure needs a plain sentence under
   [copy.md](../project/copy.md) that says *your* OpenRouter account, not ours.
6. **No silent fallback.** On the cheaper plan, when the reader's key is missing, revoked or empty,
   **every** call their plan says they pay for is refused. It does not fall back to our key. This
   covers chat, explain, search and every mode, not only new ingests. The quota counts ingests only,
   and there is deliberately no per-reader cap on the rest
   ([ai-gateway.md § What stops a reader spending our money](../project/ai-gateway.md#what-stops-a-reader-spending-our-money-and-what-does-not)),
   so a fallback would be an open tap on our account.
7. **Who pays for what.** Before the plan's price and quota are chosen, list every call and who pays
   for it, with an estimate of what stays on us.
   - Live conversation must stay on us: it goes straight to OpenAI.
   - Dictation *can* use the reader's key, since it goes through OpenRouter. Keeping it on us would
     be a pricing choice, not a technical necessity.
8. **Price and Stripe.** This is more than "one row and three prices":
   - Add a tier row, and a Stripe price that carries all three currencies
     ([billing.md § Adding a tier](../project/billing.md#adding-a-tier-or-a-currency)).
   - Checkout today sells any active tier to anyone. It would have to refuse the cheaper plan to a
     reader with no connected key.
   - The pricing page and the Stripe Portal rank plans by quota and let readers switch between them,
     so they would need to learn about the new plan too.
   - What happens when a subscriber on it disconnects, or revokes the key at OpenRouter, is a
     product decision, and the webhook and admission code must both enforce it.
9. **Privacy.** [`/privacy`](../project/privacy.md) currently says nothing about storing a reader's
   AI key. It also says provider behaviour is governed by "our account with OpenRouter", which would
   no longer be true for these readers. Wording on that page goes to Greg.

This route needs no model change, no new request format and no new vendor. What it does need is a
new way for one argument (the key) to reach every call before the call is made. It also needs a new
secret, a new table and a new column, and changes to checkout, the pricing page, and the privacy
page.

## Appendix: review of the first version

GPT Sol (`--sandbox review`, read-only), 2026-09-29. **Verdict: rework.** This plan is the reworked
version. What changed:

1. **The size of B.** It went from 3–5 days to 7–10, because the owner is not known when a request
   makes its call, and `streamMessage` is synchronous. Checked against `src/routes.ts` and
   `src/messages-stream.ts`: true.
2. **Fallback.** The first draft's diagram fell back to our key while its text forbade that. Now it
   refuses, for every call the cheaper plan says the reader pays for.
3. **The selector decides by kind of call as well as owner.** Otherwise CLI and eval runs would
   spend Greg's stored key. The `labels` successor does have an owner. The first draft said it did
   not, and that was wrong.
4. **Reconcile.** It already leaves out calls made with any other key (`scripts/ai-cost.ts`,
   fingerprint), so it needs no change. `is_byok` must not be reused as "the reader paid".
5. **Security.** Binding the callback to the signed-in owner, `state`, key rotation, the limits of
   log redaction, and a cap on how fast a stolen session can drain a reader's credits. All added.
6. **Stripe.** One price that carries three currencies, checkout refusing the plan to a reader with
   no key, and the pricing page and Portal. All added.
7. **Privacy and guardrails.** A check on each wire when the reader connects, and the `/privacy`
   wording. Both added.
8. **Who pays for what.** Must be listed call by call. Dictation could go on the reader's key.
9. **No cross-owner cache.** Sol confirmed there is none. No change needed.
10. **The research was worded too strongly** in three places: "cannot have it", "pasted key
    allowed", and "forbidden", which rests on secondary sources. All softened. "Build B before A"
    was withdrawn as a reason.

Sol kept the recommendation: wait, and send the interest form.

## Appendix: review of the second version

GPT Sol (`--sandbox review`, read-only), 2026-09-29, on the second version. **Verdict: rework.**
The sections above are the reworked version. Each finding was checked against the code or OpenAI's
page before it was accepted:

1. **The 10-minute live-voice allowance neither covered the cost nor could be enforced.** A check
   at the start admits a 20-minute session, and concurrent starts overshoot. The browser meter
   carries a warning in `src/live.ts` not to use it for an allowance. The live numbers were also
   low, because they left out transcription and the opening cost. Confirmed. → Live voice is off the
   ChatGPT tiers (§ 5), and the numbers are corrected.
2. **"Disconnect → Free at once" reopened the fallback the plan forbids**, because Free readers'
   calls are paid by us. It also contradicted the existing rule that a cancellation keeps its plan
   to the period end. → A paused state until the period end, then Free (§ 2).
3. **The tier test was misdescribed.** It requires multiples of 50 minor units, not whole units,
   and has no 5× check. It does require a dearer tier to allow more articles, which a ChatGPT tier
   breaks. Confirmed in `tests/billing-tiers.test.ts`. → A payer dimension, new prices, and a
   bigger stage 6 (§ 7).
4. **The error copy promised a five-hour reset, which OpenAI says not to infer.** It also treated
   `invalid_user` as an instant disconnect, and left out several failure shapes. "Carry on from
   where it stopped" was too strong. OpenAI's reset-time advice was confirmed on its page. → § 6
   rewritten.
5. **Not fifteen callers but two adapters**, and the Responses API is not a "fifth wire". There are
   fifteen callers, not sixteen. The estimate moves from 26–41 to 30–45 days, because billing and
   errors grow while the stage code shrinks.
6. **PDF reading can probably move.** Inline files are allowed, and only the upload API is
   excluded. Web search can move with adapter work. → § 4 and the cost table.

Sol found the VAT and Stripe arithmetic correct, and found no other large recurring cost that the
plan missed.
