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
show the text, and pages whose next pages are linked only from the second page on (a chain). The
first and third are in the [held-out set](#round-3-pages-scored-the-gold-corrected-and-a-held-out-set)
below; JavaScript-only sites still are not.

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
Its extras were real parts the gold did not then list (GOV.UK's other eight parts,
situational-awareness's later chapters, aisafety.dance's conclusion), since added to the gold; the
scored page numbers are in [round 3](#round-3-pages-scored-the-gold-corrected-and-a-held-out-set).
thecompendium.ai got 2 or 3 of the 3 sections its landing page links. The **borderlines** came out
consistently: the career guide and the two-part
Wait But Why essay followed 3 of 3; every book chapter and the series post 0 of 3.

Input was a median 3,200 tokens and at most 16,700 (Wikipedia, whose 250-link cap was reached).
The slowest call was 33.6 s, on that page, under four concurrent calls; hence a 30 s limit rather
than 15.

**Readability is the larger latency on a big page, not the call.** `readArticle` alone took 5.0 s
on Wikipedia's 1 MB, 3.1 s on Slate Star Codex's 1.3 MB, 6.4 s on Tom's Hardware's 2.1 MB and 0.1 s
on superdark; harvesting the links another 1.0–1.4 s on the big three. Stage 2 runs it anyway, so
running it a second time in stage 1 to judge doubles that on large pages — the plan's reason to
make stage 1's pass a single plain Readability parse.

### Round 3: pages scored, the gold corrected, and a held-out set

GPT Sol's plan review ([261024p-plan-review-sol.md](../plans/261024p-plan-review-sol.md)) made two
points about the rounds above. **F8**: 72/72 scored only the follow-or-not decision, not whether
the right pages were picked, so it counts decisions, not complete imports. **F11**: the prompt was
fixed against this same corpus and then re-run on it, which shows stability, not that it works on
pages it has not seen.

**Pages are now scored.** `run.ts` reports, per model, over every run of a `multi` case (followed or
not): **recall** (gold pages picked / gold pages); **precision** (gold pages picked / pages picked,
on cases whose gold is `complete` only, since on an incomplete one an extra may be a real part
nobody listed); the share of runs that picked **every gold page**; the share that picked **exactly
the gold pages in gold order**; and whether picks come **in gold order**. `--rescore=<dir>` scores
an existing `results.json` again with no model call.

**Gold corrections**, each checked against what page 1 actually links:

- **aisafety-dance**: `/conclusion` added. Page 1's nav links "The Grand Cinematic Conclusion" as the
  guide's last part; the gold said `complete` and left it out (Sol's F8).
- **situational-awareness**: was 3 chapters and `complete: false`; page 1's menu links all eight (I to
  V), so now all eight and `complete: true`.
- **govuk-uc**: was 1 part and `complete: false`; its contents list links all nine further parts, so
  now nine and `complete: true`. `/universal-credit/print` (the whole guide on one page) is not a
  part, so picking it counts as an extra.
- **compendium**: unchanged and still incomplete: page 1 links three sections, and the rest are
  reached only by a chain of Next Section links.
- superdark, Tom's Hardware, the seventeen-page review, gradual-disempowerment and
  intelligence-curse were right as they were.

**Round 2, rescored** against the corrected gold
([`v2-rescored`](../../evals/multi-page/results/2026-10-24-v2-rescored/report.md)), 27 runs of the
9 `multi` cases per model:

| model | recall | precision (complete gold) | every gold page | exact, in order (complete gold) | picks in gold order |
|---|---|---|---|---|---|
| **Haiku 5.5** | 178/180 (99%) | 171/171 (100%) | 25/27 (93%) | 24/24 (100%) | 27/27 |
| GPT-6 Luna | 180/180 (100%) | 171/171 (100%) | 27/27 (100%) | 24/24 (100%) | 27/27 |
| DeepSeek v4.1 Flash | 161/180 (89%) | 156/157 (99%) | 23/27 (85%) | 21/24 (88%) | 24/24 |

Haiku's two short runs are both thecompendium.ai, leaving out `/summary` (2 of 3 runs): so on this
corpus **25 of 27 Haiku runs would import the whole piece**, not 27. Every other case was exact on
every run.

**The held-out set**: 13 pages that had not been seen, fetched 2026-10-24 with a browser user-agent
into [`evals/multi-page/holdout/`](../../evals/multi-page/holdout/), gold in
[`holdout-gold.json`](../../evals/multi-page/holdout-gold.json), each labelled by reading page 1
(its text and every link the judge is shown) before any model call on it, as each `meta.json`
says. 6 `multi`: a hardware review in eight `/page-N/` pages with a `?print` view (Guru3D); a
forum thread with `?p=2` (Arch Linux BBS); a chain, an essay landing page that links only the
essay's entry page and two teaser chapters (keepthefuturehuman.ai); a policy-document microsite
(narrowpath.co); a magazine article in five `?page=N` pages, Japanese, with a print view and a
"next article" link (President Online); and an explainer whose index calls itself one article
split into "three morsels and a FAQ" (explained.ai). 7 `single`: Siracusa's Yosemite review, once 25
pages and now served whole; a review whose `rel=next` "Next" is a different story (KitGuru); a long
article with an in-page contents list and an aside recommending another (Martin Fowler); a post on
the shared substack.com host; a post on github.io; a magazine news feature (The Diplomat); and an
MDN guide whose sidebar lists its API's other pages beside 140 reference links.

Medium (403), Real Python (403), Zeit (403) and AnandTech (a JavaScript challenge) refused; two
heise.de pages were paywalled previews and were left out. **No multi-page piece on a shared host**
(github.io, sites.google.com, Medium) was found within the time spent, so that F11 shape is covered
only by single pages.

Haiku, three runs each, the production route
([`2026-10-24-holdout`](../../evals/multi-page/results/2026-10-24-holdout/report.md)), $0.022:

| case | gold | followed | gold pages picked | what went wrong |
|---|---|---|---|---|
| guru3d-nzxt | multi, 7 pages | 3/3 | 7/7 every run, no `?print` | — |
| president-loan | multi, 4 pages | 3/3 | 4/4 every run, no print view | — |
| explained-gradient-boosting | multi, 4 pages | 3/3 | 4/4 every run, not the other article | — |
| narrowpath | multi, 6 pages | 2/3 | 6/6 when followed | one run kept the landing page alone |
| kfh-chain | multi, incomplete: `/essay/` | 2/3 | **0/1** on every run | followed the two teaser chapters instead |
| arch-forum-thread | multi, `?p=2` | **0/3** | 0/1 | read the thread as comments |
| 7 `single` cases | single | 0/21 | — | — |

Decisions **34/39**: no false follows (0/21), 5 misses. Pages over the 18 `multi` runs: recall 57/69
(83%), precision on complete gold 57/57 (100%), every gold page picked on 11/18 runs (61%), exact
in gold order 11/15 on complete gold, picks in gold order 11/11. Median call 3.1 s, max 9.3 s.

**The failures, with the model's reasons:**

- **arch-forum-thread, 3 of 3 not followed**: *"This is a forum discussion thread, and its rel=next
  link is just pagination of replies rather than a single piece of writing split across pages."*
  This is the prompt doing what it says (comments pages do not continue), and the gold is a
  judgement call: the thread is the piece here, not an article with comments under it, and a reader
  could reasonably want page 1 alone. **Whether a forum thread should be followed is a product
  question for Greg, not a prompt bug**; the gold says `multi` and the result is counted as a miss.
- **kfh-chain, wrong pages on 2 of 3 runs**: *"This is the front page of an essay split into
  chapters, and it links Chapter 4 and Chapter 8 as parts of the same work."* It picked the two
  chapters the landing page teases, not "Read the full essay online" (`/essay/`). Following that
  would import chapters 4 and 8 of 10 and call it the essay: the worst outcome here, a confident
  partial import. The third run did not follow (*"a promotional landing page … not confidently one
  piece split across pages"*). Following only page 1's links cannot get this essay right in any
  case; it needs the chain.
- **narrowpath, 1 of 3 not followed**: *"… which is ambiguous; the landing page itself is a
  standalone summary, so the reader gets this page as is."* The confidence sentence added after
  round 1 at work: a short landing page (1,900 characters) is the shape it is least sure of, as with
  thecompendium.ai in round 1's flip test.

**What this says**: on unseen pages the judge did not follow anything it should not have (0 of 21),
and when it followed a numbered or listed split it picked exactly the right pages, print views and
"next article" links left out. Its weak spots are the ones the corpus had already hinted at: short
landing pages are followed only most of the time, and a landing page that links teasers instead of
the parts can be followed to the wrong pages. Thirteen pages is small, and the forum result turns
on a gold label that is a product choice. The prompt was not changed for these failures.

## What was decided

- **Haiku 5.5, as Greg named**, on every fetched web page with links to its own site. Luna was as
  accurate and cheaper, but this route is Anthropic-only, its median latency was higher, and Haiku
  is already well inside the budget: a hundredth of a cent at the median.
- **No question to the reader.** Greg's own reason, and nothing here argued against it.
- **Follow only page 1's links** for now; a chain is a known gap (thecompendium.ai; and keepthefuturehuman.ai in the held-out set, where it
also leads the judge to the wrong pages).
- **Shipped with the held-out misses, not held for them.** On the held-out set the judge never
  followed a page it should not have (0 of 21), and every miss leaves the reader with page 1 —
  exactly today's import. The one case that does worse than today is keepthefuturehuman.ai on 2 of
  3 runs: two teaser chapters joined to a landing page. That shape (a landing page whose full text
  is one link further on) is the chain gap above, and closing it is a second call, not a prompt
  tweak tuned to one site after the fact.
- **A forum thread is not followed.** The prompt says comment pages and reply pagination do not
  continue a piece, and on the held-out Arch Linux thread the judge did as told. Spideryarn reads
  pieces of writing, and Readability drops readers' comments on every pass
  ([content-extraction.md § Readers' comments](../project/content-extraction.md#readers-comments-left-out-on-every-pass));
  a thread's later pages are the same material. Recorded as a choice, not asked.

## What was ruled out

- `rel=next` and URL patterns alone (above).
- Concatenating the pages before Readability (above).
- DeepSeek: two false follows (the series index and Wikipedia) and three misses.

## Re-running it

```
npx tsx evals/multi-page/run.ts --runs=3 --models=haiku,luna,deepseek --out=output/multi-page-eval/<name>
```

It records every call in the ledger under an `eval` scope. Round 2 cost $0.18 for 288 calls.

The held-out set, and a rescore of an earlier run against the gold as it now stands (no calls):

```
npx tsx evals/multi-page/run.ts --corpus=evals/multi-page/holdout --gold=evals/multi-page/holdout-gold.json --runs=3 --models=haiku --out=<dir>
npx tsx evals/multi-page/run.ts --rescore=evals/multi-page/results/2026-10-24-v2 --out=<dir>
```
