# The deployed key was never asked to do anything

**Found 2026-08-28**, by Greg opening Drift on www.spideryarn.com and being told:

> Could not place this article's paragraphs: the embedding model could not be reached. Everything
> else on the page is unaffected. `[emb2]`

Not one word of that was true. Nothing was unreachable, nothing had failed, and the feature had
never worked in production for a single reader on a single day.

Production's `OPENROUTER_API_KEY` is a **different OpenRouter account** from the one in
`.env.local`, and that account's privacy/data-policy guardrails leave no endpoint at all for
`voyageai/voyage-4`. OpenRouter answers 404 in about a third of a second, every time:

```
"msg":"the embedding provider failed"
"message":"embeddings voyageai/voyage-4: OpenRouter has no endpoint this account may use.
  key in use: sk-or-v1-225…"
```

Three days of logs in the window, three different articles, one failure mode, no exceptions. It hit
Force (`[emb1]`) the same way, for the same reason.

## The part worth the write-up

The bug is somebody pasting one of two keys into a dashboard field. That is not interesting. Three
things about it are:

1. **The comment predicting it was already in the file.** [`src/embeddings.ts`](../../src/embeddings.ts)
   has carried this since the feature was built:

   > Both Voyage models 404 on the key exported in Greg's shell and answer 200 on the key in
   > `.env.local` — two different accounts, one of which has not opted in to whatever Voyage's
   > endpoints require.

   It cost an hour on a laptop, was written up carefully, and then **the losing key was the one that
   got deployed.** Knowing the hazard, in prose, next to the code, prevented nothing.
2. **Every check passed, and all of them were honest.** `GET /api/health` reports
   `OPENROUTER_API_KEY` as set — it is. `scripts/deploy.ts` checks the build stamp, the store, the
   TLS decision, that a request body survives the platform, that the auth gate holds, that the app
   role has its grants. Not one of them asks the deployed key to *make a call*. The variable being
   present is a fact about configuration that was **declared**; whether the account behind it may
   use the model is a fact about configuration that **works**, and nothing in this repo has ever
   asked the second question. Sibling of
   [health-check-green-while-uploads-dead.md](health-check-green-while-uploads-dead.md), which is
   the same gap one env var along.
3. **The message sent everybody to the wrong place.** "Could not be reached" describes a network
   and invites another go; the server log said "the embedding provider failed", which points at
   OpenRouter's status page. The one thing neither said is the true one: *a person has to change a
   setting here.* [copy.md](../project/copy.md) names this as the expensive mistake — telling
   someone to retry when retrying cannot work — and the code that made it was in `src/routes.ts`,
   which is exactly the file where a sentence escapes that document's rules.

## Why the classification failed

The route did have a guard. `isProviderFailure` in `src/article-vectors.ts`:

```ts
return message.startsWith("embeddings ") || message.startsWith("busy:");
```

A GPT Sol review had asked for it on 2026-08-27, for a good reason — without it, a bug in the
principal-components arithmetic would be reported as an upstream outage. But it classifies by
**wording**, and a classification that depends on wording is only as good as the wording:

- The account refusal and a genuine outage produced the same verdict, because both messages began
  with `"embeddings "`. The distinction the reader needed was one the string could not carry.
- A `fetch` that never connected threw a bare `TypeError`, matched neither prefix, and reached the
  catch-all as an unexplained 500 — **the ordinary provider failure was the one that did not read as
  one.**
- `"busy:"` is this app's own admission control (`MAX_INFLIGHT`), and matching it here filed our
  back pressure as somebody else's fault.
- The sibling route (`similar`, Force) caught *everything* and blamed the provider, having never
  received the fix its twin got twenty lines away.

## The fix

**Immediate:** production has to use an account that may reach the model — see the plan. That is a
dashboard field and it is not a code change.

**Long term, and landed 2026-08-28:**

- `EmbeddingFailure` in [`src/embeddings.ts`](../../src/embeddings.ts) carries a `reason` —
  `config`, `provider` or `busy` — as a value rather than a prefix, thrown by every failure inside
  the embedding boundary, `fetch` rejections included. `isProviderFailure` is gone.
- **And a `status`, because the first version of that fix made the same mistake again.** Every
  refusal except the guardrail 404 came out as `provider`, which the route reported as a blip — so
  an invalid key and exhausted credit were answered with "try again". Caught by the second GPT Sol
  review, which found it by *running* the statuses rather than reading the claim. A refusal now
  defers to `providerHttpFailure`, the function that has mapped a status to the right kind since
  long before any of this.
- Three sentences in [`src/messages.ts`](../../src/messages.ts), registered in `CODE_KINDS`, one per
  reason. `config` is kind `ours`, so nothing offers a retry that cannot work, and — because
  `monitoring-scrub.ts` reads the same table to decide whether a sentence is provably ours —
  Sentry can now repeat the one message that says what is wrong.
- Both routes go through one `embeddingHttpError`, so they cannot disagree again.

**Still open, and it is the one that matters:** a probe that runs *inside the deployment*, using the
deployment's own key, making one real embedding call, wired into `npm run deploy` as a gate. It
needs a shared secret Greg has to provision, so it is written up rather than built —
[embedding-endpoints-refused.md § the probe](../plans/embedding-endpoints-refused.md).

## What would have caught the class

Not a better comment, and not a better message. **A check that spends a hundredth of a cent per
deploy asking the deployed credential to do the thing it exists to do.** The general form:

> Every secret this app holds is a claim about what it can do. A deployment that never exercises
> one has not checked it — it has read it.

The same sentence describes what went wrong twice in the fixing of it: the classification was
*read* and believed, both times, and both times somebody who ran it found it wrong. A claim about
behaviour is worth what its last execution is worth.

And, for the classification half: **an error's `message` is for a person, and a `field` is for a
program.** Any place in this repo still deciding what to do by matching on prose is the same bug
waiting. Sol names one that remains — `pipeline.ts` matching the Readability refusal thrown by
`extract.ts` — and it should become a typed refusal for the same reason.
