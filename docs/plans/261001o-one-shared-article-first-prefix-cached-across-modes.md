# One article, cached once, read by every mode: what it is worth, and what to build

**Status as of 2026-10-01:** measured, planned, reviewed by GPT Sol (verdict *reframe*, folded in
below). **Nothing is built.** Every option either changes what a mode outputs (Greg's gate) or adds
machinery worth about 4% of an article. So the whole plan goes to Greg first, through the Overseer.

From the Overseer, quoting Greg after the [261001l](261001l-prompt-caching-across-every-call.md)
sweep:

> can I just confirm that, for example, for any prompts that involve the full document, that we
> include the full document, you know, before anything else in the prompt that might change. So in
> other words, if we're using the full document for both summary mode and quotes mode, say, that
> both of them start with the full document, perhaps wrapped in an XML tag or whatever to say that
> it's the document or article. And then the instructions come afterwards. In other words, that we
> prompt cache across modes, because then I think we'll get more benefit. […] It's like a buck per
> article. And that's actually, for some articles, it's been two or three bucks. And so this has a
> massive effect on what we charge people and how many articles they can afford to process.
>
> — Greg, 2026-10-01

And his condition: *"If you have questions or concerns ... let's discuss before going ahead."*

The numbers, the queries and the working are in
[research 261001b](../investigations/261001b-cost-per-article-and-the-cross-mode-article-cache/README.md).
This doc only cites them.

## What the measurement says

- **A typical article costs about a dollar.** The median is $0.84 and the 90th percentile $2.66.
  The $2–3 articles are ordinary-length pieces with many modes opened. One book-length article cost
  $17.91.
- **Half of Claude's bill is output, not input, and a quarter is thinking.** The article, sent as
  input, is about a third.
- **One perfectly shared article cache would take 15–16% off a normal article** (16–18¢). That is
  the ceiling. It needs every mode at one effort level, one rendering of the article, and the
  request-path prompts rebuilt.
- **What can actually be built, without changing what any mode writes, is about 4% (4¢).** The
  first draft of this plan said 6%. That assumed we could know in advance which calls would be
  followed by a sibling; GPT Sol caught it.
- **Thinking costs more than the whole caching ceiling.** It is about a quarter of a normal
  article's Claude bill, and four modes make three-quarters of it: Sketch, Illustrated, Hierarchy
  and Ideas.

So Greg's instinct is right in direction: input is big, and the article is not cached across modes.
But the size is smaller than hoped. The article is about a third of the input, and a cache can only
discount its second and later reads.

## Greg's question: is the article first?

For twelve of the pipeline modes, **yes**: the article is the first thing in the prompt and the
instructions come after. That covers the arc, tweets, glossary, quotes, ideas, sketch, timeline,
quiz, faq, cross-references, simple and citations. It is not true for:
- Illustrated: a fence line in front;
- Hierarchy: instructions first, and its own format;
- search: instructions first;
- explain, chat, debate and referee: a tool definition first, and the API always puts tools first;
- Live conversation: the instructions and the reader's profile first.

The table is in
[research § Does every full-article prompt put the article first?](../investigations/261001b-cost-per-article-and-the-cross-mode-article-cache/README.md).

**Being first is necessary but not enough.** Two modes share a cached article only if all four of
these hold:
- the article's bytes are identical, and today there are four renderings: bare text, text with
  block ids, Citations' every-block version, and Hierarchy's own;
- the thinking effort is the same, because effort is part of the cache key;
- the model is the same;
- the second call starts after the first has begun and within the cache's lifetime.

The fourth is the one that has never happened in production between modes, because each mode runs
as its own job and nothing tells one job that another has warmed the cache.

## The options

Each is a separate decision. Amounts are for normal articles at today's volume (44 articles in 30
days), on the buildable policy, from research a9. Each option includes the ones before it. **As a
share of an article's cost they do not shrink or grow with volume**, which is the frame Greg asked
for.

### A. Do nothing more on caching

- **Costs** nothing.
- **Gives up** about 4% of a normal article's Claude cost.

### B. Plumbing only: tell each mode when another has warmed the article (about 4%, 4¢ an article)

**What it does.** Before a mode sends the article, it checks a small shared record keyed by exactly
what would be cached: the model, the effort and the article's bytes. There are three cases:
- **the article is warm** (written in the last four minutes): mark it, and read it at a tenth of
  the price;
- **another mode is writing it right now**: wait for that mode's request to begin (3–7 seconds),
  then read it;
- **neither**: claim the record, mark the article, and write it at 1.25×.

This turns the import burst into one write and several reads. That burst is Glossary with Quotes,
and Tweets with Ideas, all fired together. It also turns a reader opening Quotes three minutes
after Glossary into a read.

```
today:     glossary ──full price──▶   quotes ──full price──▶          (no reads)
with B:    glossary ──claim, write 1.25×──▶  quotes waits ~5 s ──read 0.1×──▶
```

**What it changes for a reader.** Nothing they can see, except that a mode started in the same few
seconds as a sibling may begin up to about 7 seconds later. In the import burst nobody is watching.

**What it costs.**
- An additive table.
- An atomic claim, so two modes cannot both think they are first. It is a single
  `INSERT … ON CONFLICT … RETURNING` with an ownership token, so a stale claimant cannot overwrite a
  newer one.
- An asynchronous step in front of `streamMessage`, which is synchronous today
  (`src/messages-stream.ts`). The prepared request has to be split from opening the stream, so the
  check runs after the real model and effort are known and before the request goes out.
- An asynchronous record update off `MeteredCall.onStart`, which is a synchronous hook, with a
  completed call as the fallback.
- Tests, and a cold-marker eval of the import burst on the
  [`evals/simple/fanout-spike.ts`](../../evals/simple/fanout-spike.ts) template.
- About a day and a half of work.

**What it cannot promise.**
- **A warm record is a hint, not a guarantee.** OpenRouter may send a follower to a different
  upstream from the writer, because our provider `order` allows fallback, and then the follower
  reads nothing. The eval would show how often that happens; fixing it means a routing trade-off,
  which is out of scope.
- **Writes nobody reads.** Every cold call pays the 1.25× write whether or not a sibling follows.
  The 4% is net of that.

**It changes no output**, with one exception: Illustrated's `=== ARTICLE ===` fence moves from in
front of the article to after it. That is a prompt edit and would get a before/after eval. Without
it, B is worth about 3% rather than 4%.

**Why not the simpler versions.**
- **Mark everything and fire together**: measured in 261001j to cost *more* than doing nothing,
  because every call writes and none reads.
- **Post each import pair as one job**: declined in 261001l, because it makes Quotes wait for all of
  Glossary, and Ideas for all of Tweets, on every import.
- **Wait a fixed few seconds**: GPT Sol rejected this in 261001l, because there is no signal that
  the cache is readable. The record is that signal.

### C. One rendering of the article for most modes (about 5%, 5¢)

**What it does.** Arc, Glossary and Quotes switch from bare text to the block-id rendering most
other modes use, so that:
- Arc joins the big `high` group;
- Glossary and Quotes join Cross-references at `medium`.

Citations stays apart, because it deliberately sends the bibliography and notes too. Hierarchy also
stays apart: its format is pinned to prompt version `toc/9`, and changing it regenerates every tree.

**Costs.** It changes what three modes see, so it can change what they write. Those three were kept
bare on purpose, because a block id in the prompt invites one in prose that should have none. It
needs an eval on several articles per mode, read by a person.

**Gives** about 1 point over B.

### D. One effort level for every mode (about 9–10%, 10–11¢): not recommended

**What it does.** Every pipeline mode runs at the same thinking effort, so one cache serves them
all.

**Why not.** The extra saving is paid for in output or in quality:
- Glossary at `high` was measured to think 4,558 tokens more on one article. That is about 4.6¢,
  more than the ~3¢ the shared read would save.
- Arc at `medium` lost 11 points on vocabulary retention.
- Hierarchy runs at `low`, and raising it adds thinking to the second-biggest thinking bill.

The evidence is one run on two articles (`evals/results/effort-vs-quality.md`). That is thin, but it
all points the same way.

### E. A one-hour cache: not yet

**What is known.**
- For normal articles a one-hour cache is roughly break-even. Its write costs 2×, and most re-reads
  land within five minutes anyway.
- On the one book-length article it would have saved about $4.9 of $17.91, because a reader works
  through a long piece slowly.

**Why not yet.** One article is not enough to set a rule for "long articles", and length alone does
not show that the two or more later reads needed to repay a 2× write will come. Revisit when there
are several long articles in the data. Separately, a 10¢ check is needed that OpenRouter's Messages
wire honours `ttl: "1h"`, which has never appeared in our ledger.

### F. The bigger lever: thinking (not caching, and Greg's call)

**What it is.** Thinking is about a quarter of a normal article's Claude bill. Across 30 days:
- Sketch, $2.69;
- Illustrated, $2.37;
- Hierarchy, $2.17;
- Ideas, $2.08.

**What it would take.** An effort-vs-quality eval of those four, like
`evals/results/effort-vs-quality.md`, to find whether any can think less without getting worse.

**What it would give.** Halving their thinking would save about 9–10% of a normal article's Claude
cost, more than B and C together.

## Recommendation

1. **F.** It is the largest lever on a normal article's cost, and finding out costs only an eval.
   It is a quality decision, so it is Greg's.
2. **Not B for now.** About 4% of each article is real, but it needs a new table, an atomic
   cross-job claim, a refactor of the call seam, and a coordination hint that routing can still
   defeat. Build it if Greg wants every last few percent, or once F is done and the cheaper levers
   are spent.
3. **C only after B**, and only if B's eval shows the reads landing. It is a quality change for
   about 1 point.
4. **Not D.**
5. **E later**, on more long-article data.

## What happens on a yes to B

The stages, so they can be reviewed now:

1. **The record.**
   - **Migration**: an additive table `article_prefix_cache`, holding `prefix_key` (primary key),
     `article_id`, `state` (writing or warm), `owner_token`, `claimed_at` and `warm_at`.
   - **The key**: `prefix_key` is a sha256 over the model, the effort and the exact text of the
     article block, computed from the prepared request. It is never a stage name, so it cannot
     disagree with the bytes.
2. **The seam.**
   - **Where**: `streamMessage` is split into "prepare" (what `messagesWireBody()` resolves) and
     "open". An asynchronous wrapper runs between the two.
   - **Who uses it**: stages that have a compatible sibling, read from the existing
     `sharesArticleCache` tables but ignoring the job. A stage with no sibling at its effort and
     rendering, such as Arc today, is never marked.
   - **The claim**: one `INSERT … ON CONFLICT DO UPDATE … WHERE` the existing claim has expired or
     the existing warmth is stale, `RETURNING` who won. Then:
     - **the winner** marks and writes;
     - **a loser** re-reads the record, polls until it is warm or 20 seconds pass, then marks.
   - **When the request begins**: `onStart` triggers an asynchronous update to warm, guarded by
     `owner_token`. A completed call is the fallback, and every read refreshes `warm_at`.
3. **Tests.**
   - Two separate jobs on one article: the second waits for the first's start and is marked.
   - Two simultaneous claims: exactly one wins.
   - An expired claim does not hold anyone, and its stale owner cannot overwrite the new one.
   - A stage with no compatible sibling is not marked.
   - Each test must be seen to fail with its guard removed.
4. **The eval.** The import burst (Glossary, Quotes, Tweets, Ideas and Cross-references as five
   jobs) runs against the local stack, cold, with a unique marker line per run. It reports, before
   and after:
   - dollars per import;
   - cache reads per call, which is where any routing misses show up;
   - the extra wait.
5. **Sol** reviews the code and the eval output, then it is pushed to `dev`.

## Not doing, and why

- **Rebuilding the request-path prompts** (chat, explain, search, referee, debate) so the article
  comes first:
  - the API puts tools before everything else;
  - chat already caches within a conversation;
  - the gap between `all` and `pipe_one` (about 5 points) does not pay for re-plumbing those
    streaming endpoints.
- **Moving Hierarchy onto the shared rendering.** Its prompt version is pinned, and a change
  regenerates every tree. That one-off bill would eat years of the saving at today's volume.

## Review

GPT Sol, plan review, 2026-10-01, read-only:
[261001o-cross-mode-cache-plan-review-sol.md](261001o-cross-mode-cache-plan-review-sol.md). Verdict **reframe**, no P0. Every
finding was checked and taken:

- **F1, the 6% priced perfect foresight.** a9 re-runs the numbers with every cold call paying the
  write, and with Simple left out because it already caches itself. B is about 4%.
- **F2, Citations and Hierarchy were in the wrong groups.** Citations sends every block. a9 takes
  Citations out and adds a grouping without Hierarchy.
- **F3, the election and the seam.** The plan now specifies an atomic claim with an owner token, an
  asynchronous wrapper around a synchronous `streamMessage`, and the record as a hint that routing
  can defeat.
- **F4, the one-hour cache rested on one book**, and the wrong scenario's figure. It is now "not
  yet".
- **F5–F7, arithmetic and census.**
  - The mean was wrong: it is $1.61, or $1.24 without the book.
  - The split's shares are of list price.
  - Debate's article was uncounted.
  - Debate and Live had the wrong reasons in the census.
  - 0.35 is now a range.
- **F8, "more than B, C and E together".** It is now "B and C", with E deferred.

Up: [prompt-caching.md](../project/prompt-caching.md) · research:
[261001b](../investigations/261001b-cost-per-article-and-the-cross-mode-article-cache/README.md) · the
sweep before it: [261001l](261001l-prompt-caching-across-every-call.md)
