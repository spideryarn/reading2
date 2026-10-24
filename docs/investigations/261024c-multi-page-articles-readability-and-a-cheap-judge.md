# Multi-page articles: what Readability does with them, and whether a cheap model can tell

Report **spya-qkyukr** (#676, Greg, 2026-10-23). The plan this informs is
[261024p](../plans/261024p-a-multi-page-article-imports-from-its-first-page.md); the code measured is
[`src/multi-page.ts`](../../src/multi-page.ts) and the runner is
[`evals/multi-page/run.ts`](../../evals/multi-page/run.ts).

> I think what I'd like you to do is to try and find some examples of pages that are multi-page, so
> articles that are multi-page. … and then figure out a way that we could do a Haiku scan that
> automatically notices that Readability is not working well, automatically does its own thing,
> whatever. And I think so long as it costs only, you know, I mean, ideally less than a cent, but a
> few cents would be fine, I'd conceivably be willing to just do this for every single HTML article
>
> — Greg, 2026-10-23

## What was asked

1. What does today's import do with a piece split across pages?
2. Can a cheap model, shown page 1's extracted text and its links, say whether the piece continues
   and which links carry the rest — without following links it should not?
3. At what cost and latency, if it runs on every web import?

## The corpus

32 real pages, fetched on 2026-10-24 with a browser user-agent, page 1 of each committed gzipped
under [`evals/multi-page/corpus/`](../../evals/multi-page/corpus/) with the collecting run's notes in
each `meta.json`. Gold is in [`evals/multi-page/gold.json`](../../evals/multi-page/gold.json):

- **9 `multi`** — must be followed: superdark (a landing abstract and three chapters), Tom's
  Hardware (a review in five numbered pages), a WordPress split review in seventeen `/N/` pages,
  four essay or report microsites in chapters (gradual-disempowerment.ai, intelligence-curse.ai,
  thecompendium.ai, situational-awareness.ai), aisafety.dance, and a GOV.UK guide in nine parts.
- **15 `single`** — must not be: blog posts with *Next post* and `rel=next` to a different post
  (Joel on Software, Slate Star Codex), a Sphinx HOWTO whose `<link rel=next>` is the next HOWTO,
  news with *Read next*, Wikipedia, gwern's in-page contents, Paul Graham's footnotes, a series index
  of separate posts (Cold Takes), blog index pagination, Hacker News listings and a thread, a very
  long single report.
- **8 `either`** — borderlines a reader could want either way, reported and not scored: chapters of
  online books (Rust, Pro Git, Eloquent JavaScript, Dive into Python, a wikibook), a book-length
  career guide, a two-part Wait But Why essay published as two posts, and one post of a numbered
  blog series.

Four sites refused the fetch outright (TechPowerUp, Phoronix, The Atlantic, Stack Overflow) and are
not in it. Every page in it is server-rendered; none needed JavaScript.

**What it does not cover**: forum threads paginated with `?page=2`, sites that need JavaScript to
show the text, and pages whose next pages are linked only from the second page on (a chain).

## 1. What import does today

superdark's front page comes in as **2,246 characters**: the abstract. The three chapters are
119,960, 121,793 and 22,441 characters through the same `readArticle`. Nothing refuses it — 2,246
clears the 500-character floor — so the shelf shows a complete-looking article of a hundredth of the
piece.

Mozilla's Readability has no multi-page support: its issue
[#12](https://github.com/mozilla/readability/issues/12) is open, and the original Arc90 code's
`findNextPageLink` was not carried into Mozilla's rewrite. It treats `pagination` and `pager`
classes as unlikely content and strips them.

**Gluing the pages into one document does not rescue it.** The four bodies concatenated into one
document and given to `readArticle` came back at 119,978 characters: chapter I alone, because
Readability picks one best container. Each page has to be extracted alone and the results joined.

**Deterministic signals would not have been enough.** Of the 9 `multi` cases, 2 carry any
`rel=next` (Tom's Hardware's `<link>`, superdark's one `<a>`); of the 15 `single`, 4 carry one
pointing at a *different* piece (Sphinx, WordPress, Hacker News's *More*). The rest of the
positives are chapter lists, *Continue*, *Next Section* and bare `/2/` links.

## 2. The judge

One call per page. It is shown the page's address and title, the first 1,200 and last 600
characters of Readability's text and its length, and the page's links **to other pages of the same
host**, deduplicated, each under an id of ours with its wording, any `rel=next/prev`, whether
Readability kept it in the text, and its nearest landmark (`nav.chapters`). It answers
`{continues, pages: [ids], reason}`; code maps the ids back, and an unknown id refuses the answer.

### Round 1: the first prompt (two runs per case)

[`results/2026-10-24-v1`](../../evals/multi-page/results/2026-10-24-v1/report.md). 46 of 48 scored
decisions right, one timeout (at the then 15 s limit, on superdark itself), and **one false follow:
the Cold Takes series index, on one of its two runs, followed all 13 posts of the series.** Run six
times ([`v1-flip`](../../evals/multi-page/results/2026-10-24-v1-flip/report.md)) it followed on 2 of
6.

### The fix

Two sentences: a page that introduces or lists a series of a blog's posts is not continued *"even
when it links every post of it: on a blog or magazine that publishes many pieces, its posts are
separate pieces"*; and *"Say it continues only when you are confident. When in doubt, it does not:
the reader still gets this page."* Six runs each on the borderlines and the microsites
([`v2-flip`](../../evals/multi-page/results/2026-10-24-v2-flip/report.md)): the series index 0 of 6,
situational-awareness, superdark, aisafety.dance and intelligence-curse 6 of 6; thecompendium.ai —
a 1,600-character landing page — 5 of 6.

### Round 2: the final prompt, three models, three runs per case

[`results/2026-10-24-v2`](../../evals/multi-page/results/2026-10-24-v2/report.md).

| model | decisions right | false follows | missed | errors | median cost | max cost | median call | p95 call |
|---|---|---|---|---|---|---|---|---|
| **Haiku 5.5** (production route, effort `low`) | **72 / 72** | 0 | 0 | 0 | $0.0005 | $0.0017 | 2.1 s | 7.9 s |
| GPT-6 Luna (job `eval`) | 72 / 72 | 0 | 0 | 0 | $0.0002 | $0.0013 | 3.4 s | — |
| DeepSeek v4.1 Flash (job `eval`) | 66 / 72 | 2 | 3 | 2 | $0.0009 | $0.0027 | 6.3 s | — |

**Which pages it picks, Haiku**: every gold page on every run for superdark (3/3), Tom's Hardware
(4/4), the seventeen-page review (16/16), gradual-disempowerment (7/7) and intelligence-curse (6/6).
Its extras are real parts the gold did not list: GOV.UK's other eight parts, situational-awareness's
later chapters, aisafety.dance's conclusion. thecompendium.ai got 2 or 3 of the 3 sections its
landing page links. The **borderlines** came out consistently: the career guide and the two-part
Wait But Why essay followed 3 of 3; every book chapter and the series post 0 of 3.

Input was a median 3,200 tokens and at most 16,700 (Wikipedia, whose 250-link cap was reached).
The slowest call was 33.6 s, on that page, under four concurrent calls; hence a 30 s limit rather
than 15.

**Readability is the larger latency on a big page, not the call.** `readArticle` alone took 5.0 s
on Wikipedia's 1 MB, 3.1 s on Slate Star Codex's 1.3 MB, 6.4 s on Tom's Hardware's 2.1 MB and 0.1 s
on superdark; harvesting the links another 1.0–1.4 s on the big three. Stage 2 runs it anyway, so
running it a second time in stage 1 to judge doubles that on large pages — the plan's reason to
make stage 1's pass a single plain Readability parse.

## What was decided

- **Haiku 5.5, as Greg named**, on every fetched web page with links to its own site. Luna was as
  accurate and cheaper, but this route is Anthropic-only, its median latency was higher, and Haiku
  is already well inside the budget: a hundredth of a cent at the median.
- **No question to the reader.** Greg's own reason, and nothing here argued against it.
- **Follow only page 1's links** for now; a chain is a known gap (thecompendium.ai).

## What was ruled out

- `rel=next` and URL patterns alone (above).
- Concatenating the pages before Readability (above).
- DeepSeek: two false follows (the series index and Wikipedia) and three misses.

## Re-running it

```
npx tsx evals/multi-page/run.ts --runs=3 --models=haiku,luna,deepseek --out=output/multi-page-eval/<name>
```

It records every call in the ledger under an `eval` scope. Round 2 cost $0.18 for 288 calls.
