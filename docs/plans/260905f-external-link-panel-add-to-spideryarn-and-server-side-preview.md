# The external link panel: add it to your shelf, and say what is on the other side

**Status:** all three stages built, 2026-09-05. Three stages, each landable on its own.

- **Stage 1 — Add to Spideryarn:** built, commit `3a282b83`.
- **Stage 2 — the server fetches the destination:** built. `GET /api/link-preview`,
  `link_previews` (the first ownerless table in this schema), `rate_limit_events`,
  [`src/link-previews.ts`](../../src/link-previews.ts), and a third source in
  `link-facts.ts`. What it turned out to be is written up in
  [links.md § What our own server can reach](../project/links.md#what-our-own-server-can-reach);
  the doc claim this stage was required to correct is corrected in
  [260827a-link-previews.md](../research/260827a-link-previews.md).
- **Stage 3 — the Luna summary:** built. `GET /api/link-summary` (a stream),
  [`src/link-summary.ts`](../../src/link-summary.ts), `link_summaries`,
  `link_previews.excerpt`, a second limiter bucket with a day and a global fuse, and a fourth
  section on the card. What it turned out to be is written up in
  [links.md § And what it has to do with the piece in your hands](../project/links.md#and-what-it-has-to-do-with-the-piece-in-your-hands),
  with the measured price and latency and a verbatim sample; § Measured, below, has the rest.

The built code went back to GPT Sol twice —
[260905f-code-review-sol.md](260905f-code-review-sol.md) for stage 2, five P1s and no P0, and
[260905f-stage3-code-review-sol.md](260905f-stage3-code-review-sol.md) for stage 3, four P1s and
seven P2s and no P0. Every finding in both was accepted. Those two reviews are the ones worth
reading if you are about to touch this: most of their findings are traps the plan could not have
caught, because they did not exist until the code did — and stage 3's includes the one it could
not catch about itself, which is that the fencing made the *database* right and left the *screen*
wrong.

**Reviewed by GPT Sol before any code was written** —
[260905f-plan-review-sol.md](260905f-plan-review-sol.md), seven P1s and no P0. **Every finding was
accepted**, and the plan below is the revised version; each change says which finding it came from,
and the two places where the review overturned a decision rather than sharpening one are marked in
the text (P1-6, streaming; P1-1, the route's identity). The review also confirmed four load-bearing
claims this plan was built on from subagent reports — `add(url)` works from the reading view, the
`shelf` map is never invalidated, no existing task is on the quick tier, and `fetchDocument` plus
`readWebPage`'s envelope covers the SSRF surface — and corrected two facts, noted where they appear.

Hovering an external hyperlink in the prose already draws a card
([links.md](../project/links.md)). Everything on it today is read off the href, plus two lookups that
can only answer for a minority of links — an article already on this shelf (measured hit rate **1 in
67**) and Wikipedia (**1 link in 62** on this corpus). For the philpapers/arXiv/nature majority the
card is three lines and two of them the reader could have guessed.

This job builds the fourth source that [260827a-link-previews.md](../research/260827a-link-previews.md)
scoped and deferred — **our own server fetching the page once and caching it for everybody** — and
puts a way onto the shelf beside it.

> When I click on an external hyperlink, how can we make the experience really great? Here are some
> ideas. It should show an Add to Spideryarn button, which would kick off ingestion of that article
> to my shelf. When I click the button to open that external hyperlink it should open in a new tab.
> And ideally when it shows the panel about that external link, it would be really great if that
> immediately showed a loading spinner while it kicks off a fetch + then quick summary and/or quotes
> with a cheap model like GPT Luna that shows inline in the panel when it has loaded, and gets stored
> for future reference.
>
> — Greg, 2026-09-05

**"Open in a new tab" is already done** and is not part of this job —
[links.md § Every link that leaves the app opens a new tab](../project/links.md#every-link-that-leaves-the-app-opens-a-new-tab),
2026-09-04. Written at ingress as `target="_blank" rel="noopener noreferrer"`, with the touch rule
that the first tap reveals the card and the second opens the link. Verified before planning.

## The three product calls, and how they were settled

Fable gave product input and GPT Sol reviews the engineering. Greg settled the two that were his.

### The model call stays, but the summary is *relative to what you are reading*

Fable pushed back on the model call outright — the vision doc's *"augments rather than replaces"*,
and the argument that once we have fetched the page the destination's **own** opening paragraph and
word count are free, honest, and a door rather than a wall. That is a good argument and it is not
what we are doing. Greg, 2026-09-05:

> Perhaps run Mozilla Readability first before passing to GPT Luna, and ask for brief output (e.g.
> just a paragraph or two) with low/medium reasoning, and perhaps also feed it (a summary of?) the
> current article (indicating that this is what the reader is currently reading) with a slight
> request for the summary to be relative to this one, with the user-profile-prompt + article-prompt
> as background.

That answers Fable's objection rather than overruling it. A generic gist of a linked paper *is* a
wall — it lets the reader feel they have absorbed the link without following it. A line saying **how
this destination stands to the piece in your hands** is not available anywhere else, and it points
back into the text the reader is actually in. It is the same instinct as Fable's own alternative
("why is this linked here?"), made automatic instead of hidden behind a button.

**The consequence is the cache design, and it is the single most important structural fact in this
plan.** A summary that depends on the current article and the reader's profile is *not* URL-keyed, so
the "one fetch per URL for everybody" privacy win cannot cover it. Hence **two caches, not one**:

| | Keyed by | Shared with | Why |
|---|---|---|---|
| the fetch + Readability extraction | `requestTarget(url)` alone *(this cell said `urlKey` in the draft, and § Two identities two paragraphs down overrules it — corrected here on 2026-09-05 when it was built, because a table is what people read)* | **everybody** | this is the expensive, rate-limited, third-party-facing half, and sharing it is what stops the destination learning which reader hovered what |
| the Luna summary | `(owner, article, urlKey)` | nobody | it is about *this reader reading this piece*, so a global row would be both wrong and a disclosure |

The second is close to `glossaryLookups`' shape (`src/db/schema.ts` § `glossaryLookups`) — a
reader-triggered model answer cached per article. *An earlier draft of this line said "exactly", and
that was wrong: its primary key is `(articleId, entryId)` and `ownerId` is a column beside it, not
part of the key. Corrected from GPT Sol's review, finding P1-3.* The first is the **first URL-keyed,
ownerless table in this schema**, and `schema.ts`'s comment above `checkpoints` is the argument it
has to answer: a global row adds cross-reader sharing "which nobody asked for and which would need
its own argument about what a cache hit tells a stranger". The argument is written down in
[links.md § Fetched once, for everybody](../project/links.md#fetched-once-for-everybody)
and it is that the sharing *is* the privacy feature here — but it is a *limited accepted disclosure*
rather than none at all, and § Where the sharing stops below says what we accept and what we close.

**Two identities, not one.** `urlKey` is deliberately lossy — it folds `http`/`https`, `www.`, and
tracking parameters — which is right for *"is this the article on my shelf?"* and wrong for *"what
did we ask the network for?"*. `readWebPage` already builds an exact request identity from scheme,
host, port, path and query, ignoring only the fragment (`src/chat-tools.ts`). So:

- the **fetch cache and the single-flight claim** are keyed on that exact target, and
- **`urlKey` is used only for reader-facing equivalence** — shelf membership, and the Add button.

After a redirect, record the requested target → final target as an alias, or infinitely many
redirecting URLs go on producing independent misses. GPT Sol, P1-2.

### The fetch fires on the open card

Greg's call. The same rule Wikipedia already follows: **320ms of pointer rest**, so a pointer crossing
the prose on its way to the scrollbar sends nothing at all. Cost is bounded by *distinct URLs* (62 in
the noema essay), not by hovers, because both caches absorb everything after the first.

Rejected, again and for the reasons already written down: a button the reader must press (*"a preview
you must ask for is a preview nobody sees"*), and prefetching every link at ingest
([research doc](../research/260827a-link-previews.md) § Rejected).

### Add to Spideryarn queues in place; the card shows progress

Greg, 2026-09-05, overruling the obvious answer:

> I don't want to open in a new tab, because that's disruptive when I've added Spideryarn to my
> Homepage on iPad, because then it opens on top. Card shows progress is fine for now — eventually
> we'll want a richer per-article-queue progress bar for this and other per-article jobs.

Fable's recommendation had been to navigate to `/add/<url>` in a new tab, on the grounds that it is
not a new code path and inherits the progress list, the quota notice, Stop and dedupe for free. The
iPad standalone case kills it — the same case that produced the new-tab rule for outbound links in
the first place, pointing the other way. **What we keep from Fable's reasoning is the wiring**:
`useJobs().add(url)` is the *same* `POST /api/jobs {url}`, so the slot admission, the dedupe and the
402 all come along regardless of who presses it.

**The trap:** the card is torn down when the pointer leaves *and* by a `MutationObserver` when the
prose re-renders (`ProseHoverCard.tsx`). So progress must be **read** from the tab-level `jobEngine`
singleton, never **held** in the card. Re-hovering the link shows the job wherever it has got to. This
is why the eventual per-article queue Greg names is the right long-term home and this is explicitly a
way-station.

## Stages

Each ends with the tree green and safe to deploy.

### Stage 1 — Add to Spideryarn

No new tables, no new route, no model call. The whole stage is the card foot and one cache
invalidation.

- A third `prose-card-open` button in `ExternalBody`'s foot (`src/web/ProseHoverCard.tsx`), beside
  *open in a new tab* and *read it here*. The idiom already exists — `TermCard`'s "in the glossary"
  and `NoteCard`'s "go to the note" are both `<button type="button" className="prose-card-open">`.
  *An earlier draft said three controls would not fit and the foot must gain `flex-wrap`. Both halves
  were wrong: **Add and "read it here" are mutually exclusive** — Add shows only when the URL is not
  on the shelf and "read it here" only when it is — so there are never three, and `.prose-card-foot`
  needs no change. GPT Sol, P2-4.*
- Behind the same owner gate as the existing lookups — the `lookUpLinks` prop / `WithLinkFacts` /
  `NO_LINK_FACTS` seam, and `src/web/reader-capability.ts`. **A visitor on a public shelf never sees
  it**, because they have no shelf to add to.
- Hidden when the URL is already on the shelf (the card already says *on your shelf* and offers *read
  it here*) and for a self-link.
- `useJobs().add(href)`. A 402 renders `QuotaNotice`, which already handles the three quota codes —
  not a generic failure string. **One press spends a metered ingest slot**, and a free-tier reader has
  three for life, so the button is a genuinely new low-friction front door onto a metered action.
- Progress read from the job engine by job id, drawn in the card as a line. Job progress **is**
  durable across a card teardown once the job is in the engine — the review confirmed that — but three
  things around it are not, and all three are handled at tab level rather than in component state
  (GPT Sol, P2-1): the **POST is not in the engine until `add()` resolves**, so a re-hover in that gap
  offers a second enabled button; **`lastFailure()` is subscriber-local and non-durable**, so a
  refusal held only in the card dies with it; and **a completion callback mounted after the job
  finished never replays that completion**, so the shelf invalidation below must read terminal job
  state from the engine rather than trust a callback that happened to be mounted at the right moment.
- **Invalidate `link-facts.ts`'s module-level `shelf` map when a job completes.** It is fetched once
  per page load and never refreshed, so without this the card goes on claiming the page is not on the
  shelf until a reload. This is the loop that makes the feature compound: every add makes the next
  hover richer, and the measured 1-in-67 shelf hit rate is exactly what it grows.

**Done looks like:** press it on a real article in a real browser, watch the job run to completion
without leaving the reading view, re-hover the link and see *read it here*.

### Stage 2 — the server fetches the destination, once, for everybody

Still no model call. This stage is worth landing alone because the card gets materially better from
the fetch alone — a real title, the author's own opening, and a word count.

- **`GET /api/link-preview?slug=<article>&url=<destination>`**, in the authenticated route table.
  *Not* under `/api/public/`, which is dispatched before the gate and sets no owner: an
  unauthenticated fetch endpoint is an open proxy and an open wallet.

  **Article-scoped, not URL-only, and this is the single most important change the review made.**
  Authentication alone means any signed-in account can call the route directly with any URL at all —
  the `WithLinkFacts` seam hides the card from a visitor but *is not route authorization*. So the
  route: takes the slug, **verifies the caller owns that article**, and **verifies the requested URL
  actually appears in that article's extracted links** before it fetches anything or spends anything.
  That turns an arbitrary-URL fetch endpoint into one that can only ever fetch things an author
  already published in a piece this reader owns, which closes most of the probing surface in one
  move — and it supplies the article context stage 3 needs anyway. GPT Sol, P1-1.

  *Consequence, accepted:* a hyperlink in a **chat answer** ([links.md § The links chat writes](../project/links.md#the-links-chat-writes))
  is not in the article's extracted links, so it gets the free card only. Widening to chat links means
  proving membership against the thread instead, and that is a follow-up rather than v1.

- **Single-flight, or "fetch once" is not true.** Two simultaneous cold hovers both miss, both fetch
  and both spend; a unique row prevents duplicate *storage*, never duplicate *traffic*. A claim with a
  lease expiry per exact fetch target, and per contextual-summary key in stage 3 — only the winner
  consumes rate allowance, everyone else waits briefly or gets a pending state. The repo's
  transactional advisory-lock pattern in feedback admission is the precedent. GPT Sol, P1-4.
- **Reuse `fetchDocument`.** [links.md](../project/links.md) is emphatic: *"Do not write new
  fetch-safety plumbing for this."* `readWebPage` in `src/chat-tools.ts` is the worked example —
  scheme allowlist, `isBlockedAddress` against resolved addresses re-checked per redirect hop, the
  pinned agent against DNS rebinding, the byte cap, one attempt. Take its URL-length and query-length
  refusals too: a GET's URL is a channel, and here the URL comes from an author's HTML, which is
  untrusted party #1.
- Extraction is a `querySelector` chain over `og:` / `twitter:` / `<title>` / `<meta name=description>`
  on the jsdom we already own, plus Readability for the first paragraph and the word count. **Take no
  metadata library** — the research doc weighed all four; their value is a fetch layer we are
  deliberately bypassing.
- New table `link_previews`, keyed by the **exact request target** (above, not `urlKey`). Stores
  title, site name, description, first paragraph, word count, the redirect alias, and **the failure
  class** when there was one.
- **Negative caching matters as much as positive, and needs an expiry.** A failure must leave the free
  card exactly as it was — no *"couldn't reach it"* noise — and must not be retried on every hover.
  But *"cache the failure"* with no expiry lets one transient timeout or 429 poison a global row for
  ever, and lets a successful preview go stale for ever. So store an **outcome class and an
  `expiresAt`**: short for transient failures, long for a stable 404 or an unsupported type, a refresh
  horizon for successes, and respect `Retry-After` where the response carries one. GPT Sol, P2-2.
- **A per-reader inbound limiter on cache misses.** There is no rate-limit helper in this codebase
  (the only inbound limiters are the ingest quota and `src/dictation-limits.ts`), and this is the
  first endpoint where a reader's pointer causes an outbound request. The cache absorbs the steady
  state; the limiter is for the pathological one.

  *"Per-reader on misses"* is not yet a bound, so: **keyed solely on the authenticated owner id** —
  never on article or URL, which an attacker varies freely — atomic across instances, and cache hits
  bypass it entirely. Starting policy, **Sol's numbers and explicitly guesses rather than measured**,
  to be tuned from telemetry against the largest acceptable daily loss: fetch fills 120/owner/hour at
  concurrency 4; Luna fills 30/owner/hour and 100/owner/day at concurrency 2; plus a **global daily
  Luna fuse** around 1,000 fills or a money ceiling. The article-membership check above is what stops
  query-string variation being an unlimited source of misses. GPT Sol, P1-5.
- Rendered as one more `prose-card-part` under the free card, from a third source in
  `link-facts.ts` — module-level cache, answer derived during render, `LOOKUP_TIMEOUT_MS`, failures
  cached as nothing. Copy the existing two rather than inventing a third shape.
- **Never log the URL.** `hostOf(url)`, status, bytes, ms — `readWebPage`'s line. A hovered URL is
  arguably more sensitive than one the reader typed: they just moved a mouse while reading.

#### Measured before building, 2026-09-05

Ten real destinations from this corpus, through `fetchDocument` called exactly as `readWebPage`
calls it. Three results, and the third was not predicted by anything.

**philpapers fails, and so does science.org.** `FetchFailure { code: "forbidden", status: 403 }`,
confirmed by `curl` with the same user-agent to carry `server: cloudflare` and **`cf-mitigated:
challenge`**. links.md predicted this from the *client* side and it is now confirmed from a server —
the corpus's commonest destination is behind a bot challenge and no amount of plumbing gets past it.
That is a negative-cache row and a line in the docs, not a reason to stop.

**8 of 10 give something genuinely worth showing** — a real title plus a description or a first
paragraph. arXiv, plato.stanford, nature, anthropic, paulgraham, wikipedia, noema, gwern. Two notes:
plato.stanford, paulgraham and gwern carry no `og:` tags at all, so the `<title>` /
`<meta name=description>` / Readability fallback chain is load-bearing rather than a nicety; and
noema's Readability first paragraph is a byline artefact ("Credits"), so **the first paragraph needs
a sanity check before it goes on a card**, and its `og:description` is the right answer there.

**`fetchDocument`'s `maxBytes` is all-or-nothing, and this contradicts the research doc.**
[260827a-link-previews.md](../research/260827a-link-previews.md) § *The thing worth knowing before
building (4)* says a preview route is `readWebPage`'s call *"with a smaller `maxBytes` — OG tags live
near the top of `<head>`, and jsdom parses truncated HTML fine"*. **That is false of this fetch
layer**: over the cap it throws `code: "too-large"` before returning anything, so there is no partial
head to parse. Measured: at 64KB only 2 of the 8 successes survive, at 256KB only 4 — and nature,
anthropic and gwern are all 260–300KB, sitting just over that line, which makes 256KB fragile rather
than thrifty. **Use 1MB (1,048,576)**, the smallest tested cap that loses nothing; Wikipedia's
917,843 bytes is the largest in the sample.

Fixing that doc's claim is part of this stage. A doc that says "build it this way" and is wrong about
the mechanism is the trap [260903b-facts-that-were-wrong.md](../research/260903b-facts-that-were-wrong.md)
is about. **Deliberately not doing:** changing `fetchDocument` to return truncated text instead of
throwing. That is a real change to a shared safety-critical file to save a few hundred KB per URL
fetched once ever, and the cap already covers the corpus.

### Stage 3 — the Luna summary, relative to the piece in your hands

- A new `AiJob` / `Task` on the **quick** tier. This is the first job ever put on
  `QUICK_MODEL_OPENROUTER` (`openai/gpt-5.6-luna`) through `TASK_TIER` — every existing task is
  capable-tier — so `models.ts`'s two caveats are unmeasured territory and get measured here: Luna
  reasons by default with a documented 1,024-token floor, and it advertises `max_completion_tokens`
  rather than `max_tokens`. The quick tier is OpenRouter-only by construction, so this is on the chat
  wire.
- Adding a paying job is a checklist, not a call: the `AiJob`/`Task` member, a row in `AI_JOB_ROUTE`,
  a row in `AI_JOB_WIRE`, an entry in `src/spend-declarations.ts`. `tests/ai-call.test.ts` and
  `tests/no-undeclared-spend.test.ts` fail until it is done, which is the point of them.
- **The prompt is the feature.** Readability's text of the destination, plus what the reader is
  currently reading, plus `resolveProfile(slug)` — the same joined profile string six other callers
  use, carrying the reader's own "about me" and "why I am reading this piece". The instruction asks
  for a paragraph or two, *relative to the current article*.
- **The destination's prose is untrusted input and must be fenced as such.** `readWebPage` already
  treats fetched text this way and stage 3 gets the equivalent: explicit untrusted-content
  delimiters, a system instruction saying the destination text is data and not instructions, and
  **no tools and no follow-up fetching available to the summariser**. A stranger's page is party #1
  in [security-map.md](../project/security-map.md) and this feeds it straight to a model. GPT Sol,
  P2-3.
- **Explicit input and output bounds.** A 1MB download ceiling is not a prompt-token ceiling. Cap the
  destination text, the article context and the profile in characters before they reach the prompt,
  and set `max_completion_tokens` — which is the spelling Luna advertises, not `max_tokens`. GPT Sol,
  P1-5.
- **Cache key**, and the naive one is wrong. `(owner, article, url)` never changes when the article is
  re-extracted or the reader edits their profile, so a personalised summary would be stale for ever.
  Key or validate on: destination-content hash, current-article/source hash, **profile hash** — and
  `hashProfile` in [`src/profile.ts`](../../src/profile.ts) already exists for exactly this, with a
  defined value for "no profile" — and a prompt/model version. GPT Sol, P1-3.
- Precedent for a model call in a request handler with a reader waiting: `src/explain.ts`, the
  declared exception to architecture.md's "LLM calls happen in the pipeline".

**It streams, and the plan was wrong to say otherwise.** This section previously argued for a
non-streaming v1 — the answer is short, the card's design is that late sections arrive underneath,
and a card that closes on pointer-out is a poor home for a token stream — and offered it to the
review as a deliberate deviation from AGENTS.md's *stream any model call a person is waiting on*.
**The review took the offer and the argument does not survive it.** `explain.ts`, which this plan
cites as its own precedent, is *itself implemented as a stream*, with its batch interface merely
draining the same generator — so streaming here is the existing shape rather than extra machinery,
and the deviation was buying nothing. The teardown objection is answered by the thing stage 3 needs
regardless: accumulated partial text held in the **tab-level** preview store, so a card torn down
mid-stream and re-hovered picks up what has arrived rather than starting again. Give it its own
deadline, separate from the existing 8s `LOOKUP_TIMEOUT_MS`. GPT Sol, P1-6, accepted in full.

#### Measured while building, 2026-09-05

Nothing here had been measured on the quick tier before, so these are the first numbers this
repository has about it. Real calls against the noema essay's own links, `openai/gpt-5.6-luna`
through OpenRouter (Azure upstream).

**$0.00015 a call** — 2,008 prompt tokens and 87 completion, `cost: 0.0001451` off the wire. Nearly
the whole prompt comes back as `cached_tokens` after the first call of a session, because these
models cache a repeated prefix automatically and the system prompt is the bulk of it. First visible
token 0.9–2.1s; the whole answer 2.0–4.7s; a cache hit ~90ms with one `ready` frame and no stream.

**The 1,024-token reasoning floor did not show up**, and `models.ts` had warned about it as the thing
that would bite first. `completion_tokens_details.reasoning_tokens` came back **0** on every call at
`reasoning: { effort: "low" }`. So the ceiling is not the constraint it was expected to be — but it
is still sized clear of the floor, because "we did not see it on this upstream this week" is not the
same as "it is not there", and a truncated summary would be *cached for a fortnight*.
`max_completion_tokens` is sent, and `require_parameters` on the route is what stops an upstream
quietly ignoring it.

**The failure that actually happens is an upstream 429.** Two of six exploratory calls came back
`{"error":{"code":429,"message":"openai/gpt-5.6-luna is temporarily rate-limited upstream"}}` —
*inside* a 200 stream, as data, which is exactly the case `chunk.error` exists for. That is what
decided the route's failure frame: it ends the stream with `pending` rather than `unavailable` or
nothing, because a busy minute upstream is a fact about this moment and not about this link, and the
other two spellings would silence that link for the rest of the session.

**Three real answers, verbatim**, so the question *does it actually read as relative* can be judged
rather than asserted — [links.md](../project/links.md#and-what-it-has-to-do-with-the-piece-in-your-hands)
carries the first of them and the profile comparison.

#### What the build changed about the plan

- **The destination's text had to be stored**, and the plan did not say so. Stage 2 keeps a title, a
  description, a first paragraph and a word count — not Readability's text — so a summariser working
  from the cached row had nothing of the page to read, and Greg's spec is *run Readability first*.
  The alternatives were summarising from a CMS blurb, or fetching every destination a second time at
  summary time, which would undo the one thing the ownerless cache exists for. So
  `link_previews.excerpt` holds a capped 8,000 characters and is the only column in that table no
  card ever shows. **Rows written before that column existed have no summary** until they expire and
  are fetched again — a degradation rather than a refetch on the summary path.
- **The owner is in the summary's primary key**, where the plan pointed at `glossaryLookups` and Sol
  corrected the "exactly" to note that its key is `(articleId, entryId)`. Redundant today, because an
  article has one owner; kept because this row is written *from the reader's profile* and the day
  `articles` stops being one row per owner an article-keyed row starts serving one reader's
  personalised summary to another. One uuid in an index against a cross-reader leak later.
- **The fence needed defending from inside.** The plan asked for untrusted-content delimiters and got
  them, and a page that writes our own end-marker in its own text closes the fence early — the one
  injection move that turns on our formatting rather than on the model's judgement. Every run of
  three or more `=` in the destination is rewritten before it reaches the prompt.
- **A summary is not offered for an article already on the reader's shelf**, which falls out of the
  client skipping the *fetch* for those, and is a simplification rather than a decision. It is the
  case where "how does it stand to this one" would be most interesting. The repair is to summarise
  from our own stored extraction; noted in links.md as a follow-up.

## Where the sharing stops

Worth stating before it is built, because a global cache is the one genuinely new thing in this
schema. `link_previews` holds **what a page says about itself**, keyed by a URL an author published.
It holds nothing about who asked. The summary, which *is* about a reader, is in the other table and
is never shared.

**"The asker already knows the URL" does not dispose of it, though, and an earlier draft of this
section stopped there.** Three real disclosures survive, and each gets a specific answer rather than
the general argument (GPT Sol, P1-7):

- **Cache timing tells you whether some prior reader caused a fetch**, and returning a `fetchedAt`
  would say when. So the route **never returns cache timestamps**.
- **An ownerless row outlives the article that introduced it**, which is precisely the property the
  comment above `checkpoints` protects by keeping that table article-scoped. So ownerless rows get a
  **defined retention**, rather than living for ever by default.
- **A query-bearing URL can carry a capability-like secret** — a signed link, a token in a query
  string — and storing it plus the fetched content in an ownerless table is the worst place for one.
  So **credential-bearing URLs are refused**, not cached.

What remains after those three is an **accepted limited disclosure**, recorded here as accepted
rather than argued away. The article-ownership and link-membership checks in stage 2 do most of the
work: a caller can only ever cause a fetch of a URL an author published in a piece that caller owns,
which removes arbitrary probing as a way to ask the cache questions.

## What is deliberately not in scope

- ~~Streaming the summary~~ — overturned by the review and built as a stream (above).
- Wikipedia's thumbnail, and a word count for Wikipedia articles — both named and skipped in links.md.
- Ingest-time prefetch of every link — rejected in the research doc, and the URL-keyed cache delivers
  the benefit people reach for prefetch to get, lazily.
- The richer per-article job queue Greg names. Stage 1's in-card progress is explicitly a way-station.
- Quotes. Greg said "summary and/or quotes"; a paragraph or two relative to the current article is
  the "and/or" resolved, and pulled quotes can follow if the summary proves itself.

## The simpler option passed over

**Fetch only, no model at all** — Fable's recommendation, and the cheapest thing that would still be
a real improvement: title, site, the author's own opening, word count. It is passed over because the
destination's own words answer *"what is this?"* and not *"why is it here?"*, and the second is the
question a reader hovering a citation mid-paragraph actually has. **Stage 2 is that simpler option**,
landed on its own and kept working on its own, so if stage 3 disappoints there is a good feature
underneath it rather than a half-built one.
