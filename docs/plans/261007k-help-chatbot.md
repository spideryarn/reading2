# 261007k — Ask about Spideryarn: a chatbot on the Help pages

Up: [plans.md](../project/plans.md)

Part 2 of 3 of Greg's report `spya-ucftjt` (Sentry SPIDERYARN-READING2-E9), filed 2026-10-06 22:08
UTC. Overseer queue item `qi-e6ksaejb`, session `fbucftjt-help-chatbot-signed-out`. Part 1 (the Help
as Markdown pages, [261007e](261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md))
is on `dev`; part 3 (the guide, `qi-gjvvvc6n`, plan 261007j in `worktree-fbtddvg2-guide-agent`) is
being built in parallel and is the superset of this one.

**Status: built on `dev` for signed-in readers (stages 1–3, GPT Sol's code review: ship, four fixes made by the reviewer — [review](261007k-help-chatbot-code-review-sol.md)); the signed-out door awaits Greg (question q-vvhb55, queue qi-dk83dfn8). Earlier: GPT Sol's plan review said *build with changes*, F1–F10 accepted (§ After the plan review, which overrides the design where they differ).**

## What Greg asked for

> For a lot of extra points, I think it would be great if the help page had some kind of LLM chatbot
> that would be free, I think, to use because it would be, you know, it'd have a prompt that says,
> look, your only job is to answer questions about how Spideryarn works. And so maybe it can do that
> based on the help page alone. My hunch is that you might want to give it, I don't know, could it
> have access to the Spideryarn codebase via web search or curl or something like that? Presumably,
> yeah, presumably it could read the raw .md. files in docs project. […] you can ask it stuff like,
> This is what I'm trying to achieve, or I'm stuck, or What does this do? or Why is this parting
> that color? or whatever. What does this symbol mean? And it would be able to do a pretty good job
> of answering it. But if anything else, it would kind of know, like, Hang on, yeah, that's not what
> I'm here for. […] the help page agent really, it can work for non-logged-in users, and it's
> available for non-logged-in users, which is one of the reasons why you have to make sure that it
> can't be abused in other ways. Probably the help page agent uses a much dumber model, so it's
> cheaper, and the help page agent can only answer questions about Spideryarn functionality
>
> — Greg, 2026-10-06, `spya-ucftjt`

## The one thing that is not ours to decide: signed out

Every request a stranger can make today is a **read** in `/api/public/`, dispatched before the gate
([security-map.md](../project/security-map.md#where-the-defences-physically-live): *"the one
namespace with no gate in front of it — read-methods only"*), plus the Stripe webhook, which is
signed. A signed-out chatbot is the first **anonymous request that spends our money**. Building it
means editing the dispatch in front of `requireUser` in `src/routes.ts`, a listed defence, and
giving the allowance table (`rate_limit_events`, keyed on `owner_id` with a foreign key to a real
user) a way to count somebody who has no id. So, per the brief: **v1 is built for signed-in readers,
behind the gate, and the signed-out door is written up below for Greg** (§ For Greg) and asked as a
question in `docs/user-feedback/questions/`.

Everything v1 builds is what the signed-out door would also need — the corpus, the prompt, the
model, the stream, the allowance with a global fuse, the box on the page — so the decision Greg
makes is only about the door.

## What a reader gets (v1)

```
 /help/spine                                             signed in
 ┌──────────────┬─────────────────────────────────────────────────┐
 │ Contents     │ The spine                                       │
 │ [search…]    │ …                                               │
 │              │                                                 │
 │ Ask about    │                                                 │
 │ Spideryarn   │                                                 │
 │ ┌──────────┐ │                                                 │
 │ │What does │ │                                                 │
 │ │the orange│ │                                                 │
 │ │dotted…   │ │                                                 │
 │ └──────────┘ │                                                 │
 │  answer, streamed, with links to /help/… pages                 │
 └──────────────┴─────────────────────────────────────────────────┘
 signed out: the same place says "Sign in to ask a question about Spideryarn."
```

- A box on every Help page, beside the contents and search: *Ask about Spideryarn*. A question,
  an answer streamed in the model's face ([fonts.md](../project/fonts.md)), and a follow-up box: a
  short conversation, held in the page, gone when you leave. Nothing is stored.
- **It answers from the Help pages and nothing else**, and links the page it got the answer from
  (`/help/spine`). A question that is not about using Spideryarn gets one polite sentence saying
  that is not what it is for, and where the Help is.
- **Free**: no article slot, nothing on the reader's allowance of articles. Bounded by its own
  allowance (below).

## The design

1. **The corpus is the Help pages, as one generated file.** `scripts/build-help-corpus.ts` reads every
   `src/web/help/pages/**/*.md` in the order `help-pages.ts` lists them, strips front matter to the
   title and summary, and writes `src/help-corpus.generated.json` (anchor, title, body). A test
   rebuilds it and fails on any difference, as `tests/command-pick-catalogue.test.ts` does for the
   bar's list — the server never reads `src/web/` at run time, and the Help changing without the
   chatbot hearing is a red test, not a stale answer. About 95 kB, ~24k tokens.
   **Not `docs/project/`**: it is 5.5 MB (~1.4M tokens) and written for us, not readers — it names
   every defence and how it was nearly broken. Reading it would need retrieval and a judgement on
   what a stranger may be told. Deferred with its own queue entry (§ Deferred).
2. **The prompt** (`src/help-chat.ts`, per [prompting-guide.md](../project/prompting-guide.md)):
   system = the rule (answer only how to use Spideryarn; from these pages only; say plainly when
   the pages do not say; link `/help/<anchor>`; anything else → one sentence declining) + the corpus,
   as stable bytes first so the provider's prefix cache holds it. Then the conversation.
3. **The request**: `POST /api/help-chat`, signed in, `article: "none"` (no slug: nothing to
   attribute to an article, like `/api/command-pick`). Body: `{ messages: [{role, text}] }`, parsed
   exactly: at most 12 turns, alternating, ending with the reader's; each at most 1,000 characters,
   2,000 for the model's; unknown keys refused. The history is the caller's own — a reader who forges
   the model's half harms only their own answer.
4. **The model**: a cheap one, `HELP_CHAT_MODEL`, chosen by a small eval (§ Stage 3) from
   `QUICK_MODEL_OPENROUTER` (Luna) and one cheaper. No tools, no web search, reasoning off or low,
   an output ceiling (~800 tokens). A new gateway job `help-chat`, registered wherever
   `command-suggest` is (`AiJob`, `AI_JOB_WIRE`, the job policy in `ai-call.ts`, `NON_TASK_MODELS`,
   `cost-categories.ts`, the privacy page) so its spend lands in the ledger and on `/admin/costs`
   with no article.
5. **Streamed**, on the shared plumbing (`runStream`, `readAnswerStream`), per the rule. The reader
   leaving aborts the call.
6. **The allowance**: a `help-chat` `RateBucket` on the existing `rate_limit_events` machinery —
   per reader 30 an hour, 100 a day, one at a time, and a **global fuse** across everybody a day
   (sized from the eval's measured cost; first guess 3,000 questions ≈ a few dollars). An additive
   migration widens the bucket CHECK. Taken after every free refusal, before the call. This is the
   piece a signed-out door would rest on, so it is built now rather than later.
7. **The answer on screen** is the model's text: rendered as paragraphs and lists with no HTML, and
   a link drawn only when its target is a `/help/…` path this site has (anything else is shown as
   text). The model's output is untrusted ([security-map.md](../project/security-map.md)).
8. **Logged**: the outcome, timings, turn count, model. Never the question or the answer
   ([logging.md](../project/logging.md)).

### Simpler options passed over

- **No model at all**: the Help already has search. It cannot answer "I'm stuck" or "why is this
  orange", which is what Greg asked for.
- **No allowance, like the command pick**: the pick costs $0.0002 and can only answer with our own
  row keys; this answers in free text from a 24k-token prompt, which makes it a free LLM for anybody
  with an account if the refusal fails. The machinery exists; the global fuse is also exactly what
  the signed-out version needs.
- **Storing the conversations**: nothing here is the reader's work worth keeping, and not storing it
  is the privacy answer a signed-out version wants too.
- **Folding it into the guide (part 3)**: the guide lives in an article, signed in, on the article's
  model. When part 3 lands, its queued follow-up `qi-7cgxpdda` (*carry the Help pages in its
  prompt*) can import this plan's corpus file rather than build another.


## After the plan review (overrides the design above where they differ)

[GPT Sol's review](261007k-help-chatbot-plan-review-sol.md), *build with changes*; all ten accepted.

- **F1 — one question per request, no history.** The body is `{ question }`, at most 1,000
  characters. Caller-written model turns are few-shot material for turning it into a general
  assistant, so v1 is single-turn; the page shows the last question and answer, and a new question
  replaces them. Follow-ups (server-signed transcript) are deferred.
- **F2 — the cache is measured, not assumed, and the fuse is sized cold.** Stage 3 records the
  chosen model's cache mechanism and routing policy (per [prompt-caching.md](../project/prompt-caching.md)),
  and measures cold, write and read calls (`cached_tokens`, upstream, cost). The global fuse is sized
  from the **cold** cost: about 24k input tokens at Luna's $0.20/M is ~$0.005 a question, so
  1,500 a day is ~$7.50 at worst.
- **F3 — the corpus is generated by a Vitest test**, as the command-pick catalogue is (the Help
  modules use Vite `?raw` imports), in `HELP_GROUPS` order, metadata through `helpEntry`, mode
  sentences from the mode catalogue, `{{…}}` tokens expanded, and each page's canonical URL from
  `helpHref` (questions live at `/help/questions#faq-…`).
- **F4 — the answer renders through `Cited`'s untrusted-output walk** with a Help-only link
  resolver that accepts exactly the canonical `helpHref` values; never `Cited`'s web links, never
  `renderHelpMarkdown`. Nothing in `src/urls.ts` widened.
- **F5 — the route joins the contracts**: a row in `EXPECTED_AUTH_ROUTES`, `sse(res)` with its
  disconnect signal passed to `runStream`, an entry in the disconnect-policy inventory, and a
  lifetime test (the handler stays awaited; closing the response aborts the call).
- **F6 — the registrations, named**: `NonTaskAiJob`, `AI_JOB_WIRE`, `AI_JOB_ROUTE`,
  `CHAT_REASONING`, `NON_TASK_MODELS`, `JOB_DISPOSITION`, `cost-categories.ts`, and `plainWords(…)`
  in the prompt; `DISPLAY_NAME` and the privacy page if the model id is new.
- **F7 — deadlines named**: total 45 s, stall 20 s, lease = total + 30 s.
- **F8 — v1 changes a file holding a defence, not the defence**: the row goes in `AUTH_ROUTES`,
  after `requireUser`; the pre-gate dispatch, `requireUser` and `slugPart` are untouched.
- **F9 — option B/C for Greg corrected** (below): not "like the Stripe webhook" (that one is signed);
  Vercel WAF as the first layer; the IP from `x-real-ip` / `x-vercel-forwarded-for`; a keyed hash; a
  sibling table rather than a nullable owner; a separate, smaller anonymous fuse so a stranger
  cannot empty signed-in readers' share; same-origin and JSON content-type checks; Turnstile's
  token is single-use, so C needs a server-minted session.
- **F10 — placement**: in the sidebar on a content page; under the search on `/help` itself.

## Stages

1. **Server**: the corpus generator, the generated file and its freshness test; `src/help-chat.ts`
   (parse, prompt, call); the job registered; the route; the bucket and its migration. Tests: the
   parse refusals, the route's 401 signed out, the allowance refusal answering 429/503 before any
   call, the corpus test watched red, the job tables. Commit.
2. **Client**: the box on the Help pages, the stream, the link rule, the signed-out line; the help
   page doc ([help-page.md](../project/help-page.md)) and privacy page/doc updated; a browser pass in
   a Sonnet subagent. Commit.
3. **Eval** (`docs/investigations/`): ~15 questions — on-topic (from the pages), on-topic but not in
   the pages, off-topic, and a few attempts to make it a general assistant — against two cheap
   models; read the answers; measure cost per question with the cache warm. Pick the model, size the
   fuse, tune the prompt. Commit.
4. GPT Sol code review, fixes, full suite, push to `dev`, bookkeeping.

## For Greg: the signed-out door

**What the decision is for.** v1 answers signed-in readers only. Greg asked for it to work signed
out too, and that needs an anonymous request that spends money, which nothing on the site does
today. Measured in stage 3 ([investigation 261007a](../investigations/261007a-help-chat-model-and-refusals.md)): a question costs about **$0.007 cold** and **$0.0006 when the cache is warm**, which it was on every question after the first, whoever asked; answers start in about a second. Every off-topic and jailbreak question in the eval was declined.

**A. Leave it signed in.** Strangers see "Sign in to ask". No defence changes. Costs: the people
most likely to need Help before signing up — someone deciding whether to try it — cannot ask.

**B. An anonymous door, bounded by its own fuse (recommended).**

```
 stranger ──POST /api/help-chat/public──►  Vercel WAF rate limit on this exact path (per IP, per minute)
                                     │  same routing position as the Stripe webhook — but nothing
                                     │  signs this request, so these checks are all it has:
                                     │  same-origin Origin / Fetch-Metadata, JSON content type, v1's caps
                                     │  per-address allowance: a keyed hash of x-real-ip, in its own table
                                     │  an ANONYMOUS daily fuse, smaller than and separate from readers'
                                     ▼
                                   the v1 call: cheap model, Help pages only, one question, nothing stored
```

What it edits: the dispatch in front of `requireUser` in `src/routes.ts` (one exact path added) and a
new table for anonymous allowances (the existing one requires a real user, and should go on
requiring it). The address is hashed with a server secret and never stored raw; it is still
pseudonymous personal data, so the privacy page gains a line. A WAF rule is set in Vercel's
dashboard (Greg's). What it costs: the anonymous fuse's figure on a bad day, after which strangers
are told the chatbot is resting until tomorrow — signed-in readers keep theirs. Per-address limits
are weak against somebody with many addresses and unfair to a shared office network; the fuse is
what bounds the bill. What it gives: Greg's request as asked.

**C. B plus a bot check (Cloudflare Turnstile).** Stops casual scripts from emptying the anonymous
fuse. Costs more than it looks: a Turnstile token is single-use and lasts five minutes, so "check
once, then ask freely" needs a short-lived session we mint and sign; plus a third-party script on
the Help page, its privacy line, a key in Vercel's environment, and a widget a reader has to pass.

Pick B if strangers being told "resting" on a bad day is acceptable; C if the fuse being emptied by a script
would be a real loss; A if this should wait until there are more readers to ask.

## Deferred

- The signed-out door — the question above.
- Reading `docs/project/` — a queue entry.
