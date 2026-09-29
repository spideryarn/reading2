# Bring your own AI: readers paying for their own model calls

Feedback report SPIDERYARN-READING2-5J (`spya-ddpn5x`), from Greg (admin, so trusted input).

> It would be amazing to be able to use my OpenAI subscription, if I've already got whatever it is,
> ChatGPT Pro, and then it would use that and I'd get a discounted price. Let's not implement it
> yet. Just do some research and put together a plan. Let's consider how complex it is, and then
> we'll go from there. But don't actually start implementing.
>
> — Greg, 2026-09-29

**Status: plan only, nothing built. Parked, waiting for Greg's decision.** The research behind it,
with sources, is
[260929a-paying-for-model-calls-with-the-reader-s-own-ai-subscription.md](../research/260929a-paying-for-model-calls-with-the-reader-s-own-ai-subscription.md).

## What this is for

Some readers already pay for AI themselves. If they could pay for their own Spideryarn model calls,
we would not be carrying that cost, so we could sell them a cheaper plan or a larger quota. Model
spend is the only reason the quota exists
([billing.md § The quota](../project/billing.md#the-quota-and-the-one-thing-it-has-to-survive)).

## What the research found, in one table

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

## How complex each one is here

### B. Connect your OpenRouter account: medium-large, roughly 7–10 days of agent work, reviews included

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

### A. Sign in with ChatGPT, plan usage: large, weeks, and blocked on OpenAI saying yes

Everything B needs, plus:

- **A third request format.** OpenAI's Responses API, with its own streaming events, its own usage
  shape, and its own rules: streaming is mandatory, and there is no `max_output_tokens` and no
  `temperature`.
- **A second vendor outside OpenRouter.** Calls go direct to `api.openai.com`. That turns the one
  gateway and its one sanctioned exception into two exceptions, with a new declared seam in
  [`src/spend-declarations.ts`](../../src/spend-declarations.ts), its own metering, and its own
  cost computation. The calls cost *us* nothing, but they still need rows.
- **OpenAI models only.** The pipeline's capable tier is Claude Sonnet 5, and that is most of an
  article's cost. To move a stage onto the reader's plan, each prompt has to be re-run and judged on
  a GPT model under [prompting-guide.md](../project/prompting-guide.md)'s measurement rules. Some
  stages may come out worse. Transcription, embeddings, image generation and live conversation are
  not offered through this route, so they stay on us.
- **Token refresh.** We would keep refresh tokens for background jobs, and treat them with the same
  care as a password.
- **Running out mid-job.** The reader's allowance can end partway through a stream. It is shared
  with their own Codex use, so it can end for reasons that have nothing to do with us.

If only the cheap OpenAI-model jobs moved (quick tasks, PDF reading), the discount would be too
small to price. If the pipeline moved, it becomes a model migration as well as a billing feature.

### C, D, E

D is forbidden. E is a different product. C is route A's plumbing without its benefit, and it
asks readers to hand us a key that their provider tells them not to hand over.

## Recommendation

1. **Now, and free: Greg sends OpenAI's interest form**
   (<https://openai.com/form/sign-in-with-chatgpt-interest/>), describing Spideryarn as a paid,
   hosted reading app. This is the only way to learn whether route A is ever open to us. It speaks
   for the company, so it is Greg's to send, not an agent's.
2. **Build nothing yet.** The readership is small. Only Greg has asked for this, and he already has
   an admin exemption from the quota. Route B would be a medium-large, security-sensitive piece of work
   that saves a reader money only through a plan we would have to invent, and it gives no ChatGPT
   users anything they asked for.
3. **Build B only if readers ask for a cheaper plan or a larger quota.** It is not a stepping stone
   to A. The two share a way of choosing whose key pays for a call, and a column recording who paid,
   but none of A's token refresh, request format, metering or move to GPT models. If OpenAI lets us
   in, decide A on its own merits then.

**The simpler option passed over** is a pasted OpenRouter key instead of OAuth. It saves perhaps
half a day and costs the reader a copy-paste of a secret, so OAuth is the better trade.

## Open questions for Greg

- Send the OpenAI interest form? (Recommended: yes.)
- Is a cheaper "bring your own AI" plan something you would want to sell even if it cannot use a
  ChatGPT plan, that is, readers paying their own OpenRouter bill? If not, park B until A opens.
- If B is built: when a subscriber on the cheaper plan disconnects their key, their paid features
  stop until they reconnect or change plan. That follows from § 6 (no silent fallback). Is that
  acceptable, or should we move them back to an ordinary plan automatically?

## Review notes

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
