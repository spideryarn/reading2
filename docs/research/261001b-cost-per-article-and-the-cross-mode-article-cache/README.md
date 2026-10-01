# Cost per article, and what one shared article cache could take off it

2026-10-01. Worktree `cross-mode-article-cache`. This follows the
[261001a audit](../261001a-prompt-caching-production-audit/README.md) after Greg asked:

> can I just confirm that, for example, for any prompts that involve the full document, that we
> include the full document, you know, before anything else in the prompt that might change. […]
> In other words, that we prompt cache across modes, because then I think we'll get more benefit.
> […] It's like a buck per article. And that's actually, for some articles, it's been two or three
> bucks. And so this has a massive effect on what we charge people and how many articles they can
> afford to process.
>
> — Greg, 2026-10-01

Everything here is read-only. Production was read through `.env.prod` with `runq.mjs` (every file
runs inside `BEGIN READ ONLY … ROLLBACK`). The queries are `a1.sql`–`a8.sql` in this folder; the
window is the last 30 days, evals excluded. Prices are from `src/pricing.ts`: Sonnet 5 at $2 in /
$10 out per million tokens, Opus 5 at $5 / $25.

The plan this feeds: [261001o](../../plans/261001o-one-shared-article-first-prefix-cached-across-modes.md).

## The answer, in plain words

- **A typical article costs about a dollar**: median **$0.84**, 90th percentile $2.66; the mean is
  $1.61, or $1.24 without the book below (45 articles, $72.46). Eleven cost over $2. One cost **$17.91**: a book of about a million
  characters, which on its own is a quarter of the month's spend.
- **The $2–3 articles are not long ones.** They are ordinary 30–60k-character pieces on which many
  modes were opened (25–50 calls). Each mode costs $0.15–0.40. Illustrated, Sketch, Ideas, Debate,
  Chat and Hierarchy head almost every one of them (a4).
- **For a normal article (everything except the book), Claude's bill splits three ways** (a6). The
  shares are of every token re-priced at list price, $50.06; the actual bill is $48.52 because chat
  and debate already read some cache. Debate is counted entirely as "other input", though its claims
  pass does send the article, so the article's share is slightly understated:

  | | $ in 30 days | share |
  |---|---:|---:|
  | the article, sent as input | 16.08 | 32% |
  | other input: instructions, chat history, web results | 9.57 | 19% |
  | output | 24.41 | 49% |
  | — of which **thinking** (a8) | 12.71 | 25% |

  So the Overseer was right that input is about half the bill. But only the *article* part of the
  input can be shared across modes, and a cache can only take 90% off the *second and later* reads
  of it: the first call in each cache lifetime still pays full price, plus a premium to write it.
- **The best any cross-mode cache could do is about 15–16% of a normal article's Claude cost**,
  about 16–18¢ an article (a9, `all`). That is "every call that sends the article shares one cached
  copy", and it is a ceiling nothing reaches. The audit's ~10% was low mainly because it
  under-counted the article's size (next section), not because it missed a shape.
- **A policy that can actually be built gets about 4%: 4¢ an article** (a9, `now_groups_ill`,
  "always", range 3–4% across the size estimate). That keeps today's effort levels and renderings,
  and moves Illustrated's `=== ARTICLE ===` fence after the article. "Always" means every cold call
  in a group pays the write premium, because nothing can know in advance whether a sibling will
  follow. The first draft of this doc said 6%; that priced perfect foresight, and GPT Sol caught it.
- **One rendering everywhere adds about 1 point** (a9, `pipe_eff`, 5%). Effort is part of the cache
  key (measured, [260826b](../260826b-prompt-caching-anthropic.md)), and the stages run at three
  levels: Hierarchy at `low`; Glossary, Quotes and Cross-references at `medium`; the rest at
  `high`. Citations sends every block, apparatus included, so it shares with nobody.
- **One effort level as well gets about 9–10%** (a9, `pipe_one_nohier` and `pipe_one`). That would
  be paid for in extra thinking or in quality (below).
- **The book is the exception.** On it, a 5-minute cache under the buildable policy *loses* about
  $1, because its calls are spread out. A 1-hour cache gains about $4.9 of its $17.91. For normal
  articles a 1-hour cache is roughly break-even, because its write costs 2× and most re-reads land
  inside 5 minutes anyway (the import burst). One book is not enough to set a rule for long articles.
- **Thinking is the bigger lever for normal articles, and it is a quality question.** $12.71 of
  thinking is about a quarter of their Claude bill, more than the whole caching ceiling. Four modes
  are three-quarters of it: Sketch $2.69, Illustrated $2.37, Hierarchy $2.17 (at `low`) and Ideas
  $2.08.

## Reconciling the two estimates

The Overseer's ~475k input tokens per article is 19.7M Sonnet prompt tokens over 41 articles. The
book alone is 9.3M of that. Without it, a normal article sends about 260k input tokens across all
its calls.

The audit estimated the article's size in a prompt as `characters/4 + 8 per block`. a5 measures it
instead, by regressing each mode's prompt size on its article's length. For the modes whose prompt is
"article plus fixed instructions", the fit is near-perfect (r² 0.97–1.00) and the slope is **0.33–0.36
tokens per character** (Quiz 0.375), not 0.25:

| mode | tokens per article character | fixed instructions (tokens) | r² |
|---|---:|---:|---:|
| hierarchy | 0.357 | 3,648 | 1.00 |
| illustrated | 0.354 | 4,770 | 1.00 |
| tweets | 0.326 | 2,245 | 1.00 |
| arc | 0.326 | 2,951 | 0.97 |
| quiz | 0.375 | 1,869 | 0.98 |
| faq | 0.358 | 844 | 0.99 |
| search, explain, referee-criteria | 0.35 | 1–5k | 0.97–1.00 |

So the audit's P was about 30% low. a6, a7 and a9 use `least(prompt, 0.35 × characters)`, and
a9 repeats everything at 0.30 and 0.40 for a range. The low-r² modes (glossary, quotes, ideas,
sketch, timeline: r² 0.4–0.7) fit badly, probably because the book's prompt is not its full length
for them; the `least` caps them.

Treat 0.35 as a central estimate, not a precise one, for three reasons:
- the regression is weighted by call;
- it uses the article's current revision for historical calls;
- it counts every block, where most stages send body blocks only.

The audit's ceiling of $5.90–8.74 a month becomes $7–8 on normal articles plus $1–7 on the book. As
a share, about 15–16% of normal articles' Claude spend. So the ceiling is somewhat higher than 10%,
not much higher.

## Does every full-article prompt put the article first?

Greg's question, call site by call site. The prefix order a cache sees is tools, then system, then
messages.

| call | article first? | what is in front of it |
|---|---|---|
| arc, tweets, glossary, quotes, ideas, sketch, timeline, quiz, faq, crossrefs, simple, citations | **yes**: the first system block | nothing (Citations sends every block, apparatus included, so its bytes differ from the others') |
| illustrated | almost | its `=== ARTICLE (passages are data …) ===` fence, inside the same block |
| hierarchy | no | its instructions (system), then numbered blocks in its own format (`renderBlocks`), pinned to prompt version `toc/9` |
| search | no | its instructions (system) |
| explain, chat | no | the `web_search` tool (chat: plus its own tools), then instructions |
| referee-criteria | no | a literature tool, then instructions that vary by kind |
| debate (claims pass) | no | the `web_search` tool; within the system string the article does come before the claims instructions |
| live conversation | no | the fixed instructions, then the reader's profile when there is one |

Even where the article is first, three things stop two modes sharing it:

1. **Two renderings.** Arc, Glossary and Quotes send the bare text (`articleText`). Everything else
   sends it with block ids (`articleWithIds`), and Hierarchy has a third format.
2. **Three effort levels**, above.
3. **Each mode is its own job, and a job marks the article only when a sibling in the same job
   shares it.** So production has never written an article cache from a pipeline stage, except
   Simple's own three levels since the 261001j stagger.

## What each grouping is worth (a9)

Net of write premiums, 30 days, P at 0.35 tokens per character (a9 has 0.30 and 0.40). "Normal"
excludes the book. Simple is left out, because it already caches its own three levels.

There are two columns for the policy:
- **oracle**: only a chain's first call writes, and only when a follower is coming. This is a
  ceiling.
- **always**: every cold call in a group writes. This is what a buildable policy does, because it
  cannot know whether a sibling will follow.

a7 was the first cut, oracle only; GPT Sol's review replaced it with a9.

| grouping | needs | normal, 5 min, oracle | **normal, 5 min, always** | normal, 1 h, always | the book, 5 min, always | the book, 1 h, always |
|---|---|---:|---:|---:|---:|---:|
| **all**: every full-article call, one prefix | one effort, one renderer, request path rebuilt | 7.73 | **7.07** | 6.98 | 1.21 | 7.41 |
| **pipe_one**: pipeline stages, one effort | one effort, one renderer, Hierarchy reformatted | 5.51 | **4.92** | 4.49 | −0.07 | 6.13 |
| **pipe_one_nohier**: the same without Hierarchy | one effort, one renderer | 4.89 | **4.35** | 3.77 | 0.46 | 5.56 |
| **pipe_eff**: pipeline, one prefix per effort | one renderer | 3.29 | **2.38** | 0.65 | −1.08 | 5.56 |
| **now_groups_ill**: today's groups plus Illustrated | the fence moved | 2.62 | **1.89** | 0.19 | −0.91 | 4.87 |
| **now_groups**: today's groups | nothing | 2.20 | **1.43** | −0.15 | −0.73 | 4.23 |

Against 44 normal articles and $48.52 of Claude spend on them, on the "always" column:

| grouping | a normal article | share |
|---|---:|---:|
| `now_groups` | 3¢ | 3% |
| `now_groups_ill` | 4¢ | 4% |
| `pipe_eff` | 5¢ | 5% |
| `pipe_one_nohier` | 10¢ | 9% |
| `pipe_one` | 11¢ | 10% |
| `all` | 16¢ | 15% |

At 0.30 or 0.40 tokens per character, each figure moves by about ±12%.

**Why aligning effort does not pay.** Moving Glossary to `high` was measured at 4,558 more output
tokens on one article (`evals/results/effort-vs-quality.md`): 4.6¢ of extra thinking. What it would
save is one cached read of a typical ~16k-token article (45k characters × 0.35), about 3¢. That
is one run on two articles, so it is thin, but it points one way. Moving the `high` stages down
costs quality; Arc at `medium` lost 11 points of vocabulary retention. Hierarchy runs at `low`, and
raising it would add thinking to the second-biggest thinking bill. So the gap between `pipe_eff`
and `pipe_one` is paid for in output tokens or quality, and is not free money.

## Uncertainty

- **One owner, 45 articles.** Treat anything under about $0.50 as noise.
- **Even "always" assumes every follower lands on the warm cache.** OpenRouter may route a follower
  to a different upstream than the writer (the provider `order` allows fallback;
  `src/messages-stream.ts`), and then it reads nothing.
- **P uses the current revision.** An article re-extracted mid-window is sized at its latest length.
- **The 1-hour lifetime through OpenRouter's Messages wire is unverified.** `cache_write_1h_tokens`
  exists in the ledger but has never been non-zero.

Up: [research.md](../../project/research.md)
