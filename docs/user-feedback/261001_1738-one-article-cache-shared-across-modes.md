---
reports: none
ending: shipped
---
# One article cache shared across modes: measured per article, options to Greg

Not from a reader, so there is no Sentry id. The Overseer dispatched it from Greg on 2026-10-01,
after he read the [261001l](../plans/261001l-prompt-caching-across-every-call.md) sweep: is the full
article first in every prompt, so that modes share one cached copy? He said:

> this has a massive effect on what we charge people and how many articles they can afford to
> process.
>
> — Greg, 2026-10-01

The time in the file name is when this session wrote the note.

**Ending: Shipped, 2026-10-01, on `dev` as `1d96f5722`.** Greg answered the recommendation:

> A yes, might as well. and make sure this is written up (e.g. in docs/research ). use your
> judgment on how to proceed
>
> — Greg, 2026-10-01

So the effort-vs-quality eval was run
([plan 261001p](../plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md),
[research 261001c](../investigations/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md)).
Eight full-length articles, two draws per arm, two blind judges, about $26 of API spend.

- **Sketch: `high` → `low`.** Neither judge saw a loss. Each call is 58% cheaper and four times
  faster, about 6¢ (5.5%) off a normal article.
- **Illustrated: stays `high`.** Both judges found `low` clearly worse, and `medium` was a split
  call that the rule keeps at `high`.
- **Ideas: stays `high`.** Below `high` it wrote malformed JSON in 10 of 16 draws.
- **Hierarchy: stays `low`.** With thinking off, 5 of 16 trees failed outright.

The caching plumbing (option B) is not built, as recommended; it can be raised again on its own.

Everything below is the original note, kept. The plan it pointed to is
[261001o](../plans/261001o-one-shared-article-first-prefix-cached-across-modes.md) and the
measurement is
[research 261001b](../investigations/261001b-cost-per-article-and-the-cross-mode-article-cache/README.md).

What was found, in plain words:

- **A typical article costs about a dollar.** The median is $0.84 and the 90th percentile $2.66.
  The $2–3 articles are ordinary-length ones with many modes opened. One book cost $17.91.
- **The article is first in twelve of the pipeline modes' prompts.** It is not first in
  Illustrated, Hierarchy, the request-path calls (chat, search, explain, referee, debate) or Live
  conversation.
- **Being first is not enough.** The modes still cannot share, for three reasons:
  - they run at three effort levels, and effort is part of the cache key;
  - there are four renderings of the article;
  - each mode is its own job, and nothing tells one job that another has warmed the cache.
- **A perfect shared cache would save about 15–16% of a normal article's Claude cost.** What can
  be built without changing any mode's output is about 4% (4¢ an article), once every cold call
  pays its cache write. The first draft said 6%; GPT Sol's review caught the assumption.
- **Thinking is about a quarter of the bill**, more than the whole caching ceiling. Most of it comes
  from Sketch, Illustrated, Hierarchy and Ideas.

The recommendation, for Greg, is in the plan:
1. first, an effort-vs-quality eval of the four big thinkers;
2. not the caching plumbing for now: it is worth about 4% and needs a new table and cross-job
   coordination;
3. never one effort level for every mode;
4. a one-hour cache later, when there are more long articles to judge it by.
