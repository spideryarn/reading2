# Tidying what Readability kept — a model pass over the blocks, not the gaps

**Status: a spike, with numbers, and a recommendation.** Nothing in the pipeline has changed. Stage 2
is [content-extraction.md](../project/content-extraction.md); the sibling plan that asked the
opposite question is
[readability-repair-pass.md](readability-repair-pass.md).

> We had talked in the past about having some kind of LLM post-processing stage (after running
> Mozilla Readability) for HTML imports. For example, it might have caught & fixed the issue where
> Paul Graham's essays all use `<br>` instead of `<p>`. And it might notice junk that doesn't need to
> be included, or fix other minor issues in the Readability/import that require intelligence. …
> Probably lots of before/after examples? But a general guidance not to change the actual text in any
> substantive way, and err on the side of caution/no-action.
>
> — Greg, 2026-08-30

## The short answer

**No, it was not implemented** — the earlier spike measured a *different* arm, found most of its
value belonged to free deterministic code, and stopped there.

Re-asked, the answer is different, because the question is different. The failure Greg describes is
real and it is on the shelf right now; the `<br>` example is not the case; and a model pass at
**a fifth of a cent per article** does the job with no false positive on article prose across twenty
committed pages.

Three findings, in the order they change what to do:

1. **The `<br>` premise is wrong, and its conclusion is right.** Readability's own `_replaceBrs`
   reflows `<br><br>` runs into paragraphs. Paul Graham's *How to Do Great Work* has **zero `<p>` in
   the source** and comes out with **266**. That page is nevertheless broken, in a way nothing in
   this repo was looking at: it arrives as 328 blocks of which **87 hold six characters or fewer** —
   `[1]`…`[29]`, a bare `[`, a bare `25`. 87 of them are `gistable: true`, so the table of contents,
   the summaries and the granularity-zoom tree all treat them as content.
2. **Nothing in the pipeline has ever looked at what Readability *kept*.** Every instrument here
   measures absence — `droppedChars`, the ratio, kept-over-present per tag. Four of the five fixtures
   added for this spike score **perfectly** on all of them while being visibly wrong to a reader.
3. **A model does the judgement well, cheaply, and safely — but only the half that needs judgement.**
   The certain junk is free; the model's marker recall is *worse* than a four-line regex and varies
   run to run. What it is good at is the part no rule can do.

## What is actually broken, measured

[`evals/extraction/probe.mts`](../../evals/extraction/probe.mts) is new: it runs stage 2 and the
**real stage-3 splitter** over a page and reports what a reader would get. Two counts, split where
certainty is:

- **markers** — a gistable block with no letter in it anywhere. `[1]`, `¶`, `▲`, `[`, `25`, `{6}`.
  Not a passage, no judgement needed.
- **tiny** — six characters or fewer, has a letter, is not a heading. `http`, `[edit]`, `{v}`.
  Suspicious, not certain.

**The split exists because the first version did not have it and was wrong.** One number called
`h2:"Code"`, `h3:"Text"`, `h2:"Syntax"` and `dt:"Normal"` defects; they are a real heading and a real
definition term. An instrument that scores Tufte CSS's own section headings as junk would have argued
for a fix that damages pages.

Across the twenty committed fixtures:

| fixture | markers | tiny | longest block | ratio | what the reader gets |
|---|---:|---:|---:|---:|---|
| **pg-greatwork** | **87** | 0 | 635 | **1.000** | 27% of the blocks are punctuation |
| **rfc9110** | **127** | 20 | 6,796 | 0.945 | `¶` permalinks and `▲` back-links as blocks |
| **whatwg-parsing** | 4 | 192 | 16,655 | 0.981 | the spec's own inline table of contents, 140 list items |
| **mdn-cache-control** | 0 | 31 | 533 | 0.665 | `http` / `html` code-fence labels, 30 of them |
| **wikipedia-transformer** | 0 | 19 | 1,874 | 0.731 | nineteen `[edit]` links |
| **mactutor-turing** | 18 | 15 | 990 | 0.858 | `1931`, `in`, `'s` — mid-sentence fragments |
| **acx-footnotes** | 18 | 0 | 1,041 | 0.986 | footnote numbers split from their footnotes |
| **whitman-leaves** | 0 | 0 | **67,890** | **1.000** | several poems as one node |
| **hacker-howto** | 0 | 0 | **14,572** | 0.955 | 21 Q&A pairs as one node |
| **shakespeare-hamlet** | 0 | 0 | 1,539 | 0.945 | **correct** — 52 verse lines, the control |

Note the ratios. **`pg-greatwork` and `whitman-leaves` both score 1.000 and drop nothing**, and both
are broken. The existing corpus runner cannot see either failure, and neither can the structure
check, because no *tag* went missing — the tags are all there, wrapped around the wrong amount of
text or around nothing.

### Why this matters more here than in most reading apps

The same reason the sibling plan gives, from the other side. The table of contents and the
granularity-zoom tree are one structure
([granularity-zoom.md](../project/granularity-zoom.md#the-tree)). An article that arrives as 87
blocks of punctuation gets a table of contents of punctuation; an article that arrives as one
67,890-character node has nowhere to hang a scroll position, a note or a zoom level. The feature the
app exists for degrades, and every existing check says the page is fine.

## The arm, and what the schema guarantees

[`evals/extraction/tidy.mts`](../../evals/extraction/tidy.mts). The model is shown every gistable
block as `id, tag, chars, first 140 characters` and returns **a list of ids to drop, and a reason
category, and nothing else.**

That answers Greg's "don't change the actual text in any substantive way" **structurally rather than
by asking**: there is no field in the schema a character of prose could travel through. An id the
model invents fails a lookup instead of becoming an operation, and dropping cannot reorder, so the
sibling plan's worry — a source-grounded `insert-after` that moves a qualification away from the
claim it limits while every word passes the provenance check — cannot arise at all.

On the prompt Greg asked about: it is in `tidy.mts` and it is **not** built from before/after
examples. It is two lists of one-line cases — *commonly not the article* (stranded markers, edit and
permalink affordances, code-fence chrome, page artefacts, surviving site furniture, detached credits,
leftover navigation) and, longer, *things that ARE the article and are often mistaken for those*
(short section headings, definition-list terms, one-line asides, verse and dialogue, table cells and
captions, the footnotes themselves as opposed to their markers, epigraphs and datelines). Plus the
asymmetry stated outright: *a wrongly kept fragment is a line of clutter, a wrongly dropped block
takes part of the piece away from the reader and nothing will tell them; they are not equally bad; if
you are not sure, keep it.* The second list is doing most of the work — it is what the controls test,
and the controls pass.

## What three models did, over twenty pages

**The free rule is computed first and the model is scored against the residual**, because the sibling
plan's central finding was that measuring against stock reported an arm as four times more useful
than it was.

| | GPT-5.6 Luna | GPT-5.6 Terra | Claude Sonnet 5 |
|---|---|---|---|
| cost, full corpus | **$0.07** | $0.94 | $0.96 |
| slowest page | 27 s | 42 s | 72 s |
| marker recall | 87/87, 118/127, 8/8 — but **2/18** on MacTutor | **77/127** on rfc9110 | 87/87 |
| the ToC on rfc9110 | **missed it** (1 block) | **found it** (307 blocks) | ran out of tokens |
| false positives on prose | 1 in 3 runs (below) | 0 | 1 (PG's acknowledgements) |

**Luna at a fifth of a cent per page is the recommendation**, with one change to the design that the
table above forces: **do not ask the model about markers at all.** Its recall on them is erratic —
2 of 18 on MacTutor, 0 of 2 on the MkDocs page — while a four-line regex gets 100% of them for
nothing. Filter them out deterministically, then ask the model about what is left. Terra's better
marker recall is not worth paying for; Terra's better recall on *inline tables of contents* might be,
and that is the one place the two genuinely differ.

**Terra found something Luna missed and it is the largest single win in the run**: RFC 9110's own
table of contents, 307 list items, which Luna scored as one block. On WHATWG both found it (146 vs
158). So the disagreement is not "Terra is better", it is "on the two largest pages in the corpus,
one of them sees the inline ToC and the other sometimes does not" — and both pages are ~2,500 rows,
which is where a long list starts costing recall.

**Sonnet's rfc9110 run failed with `finish_reason: "length"`.** That is worth stating because the
guard for it was written on purpose: a truncated JSON answer parses as *fewer* drops, which reads as
a cautious model. Without the check, Sonnet would have been scored as the most conservative arm on
the page it actually could not finish.

### What it drops, read rather than scored

There is no gold for "is this really furniture", so `beyondTheRule` is **printed, never totalled** —
the [`gainedText`](../../evals/extraction/corpus.mts) lesson, applied before the same mistake could
be made a fourth time. Read across the corpus, Luna's picks are:

| fixture | what it named | verdict on reading |
|---|---|---|
| whatwg-parsing | 146 — the spec's inline ToC, prev/next links, "Living Standard — Last Updated" | correct |
| mdn-cache-control | 30 — every `http` / `html` code-fence label | correct; kept `h2:"Syntax"`, `dt:"Age"`, `h4:"no-cache"` |
| gutenberg-pride | 24 — twenty repeats of `[Copyright 1894 by George Allen.]`, page markers | correct, except one plate caption |
| mactutor-turing | 23 — the "Additional Resources" external-links rail | correct |
| wikipedia-transformer | 18–19 — `[edit]`, all of them and nothing else | correct |
| gwern-scaling | 6 — "Backlinks", "Similar Links", "Bibliography" and their labels | correct |
| arxiv-abs | 4 — the metadata table and submission history | correct |
| whitman-leaves | the Gutenberg `*** START/END ***` sentinels; once, the 8,331-char ToC | correct |
| hacker-howto | 1 — `Copyright © 2001 Eric S. Raymond` | correct |
| tufte-css | 1 — `Dave Liepmann`, the byline | arguable |
| acx, cornell, constitution, **shakespeare-hamlet** | **nothing** | correct |

**The Shakespeare control is the one to look at.** Fifty-two blocks averaging 170 characters, every
one a line of verse, and the model touched none of them. A "drop short blocks" rule would have
destroyed that page, which is exactly why it is now a committed fixture.

### The one false positive, and why the alarm nearly missed it

On the second of three Luna runs over `pg-greatwork` it named a **177-character** block: the body of
footnote 15, which begins with a stray `]` because the splitter cut its marker off. Real article
prose, named for deletion.

The alarm did not fire. `PROSE_CHARS` was 200, chosen by feel, and the block was twenty-three
characters short of it. It was caught only because `beyondTheRule` is *printed* — which is an
argument for printing, not for a better threshold. The threshold is now 100, and 100 is not
better-justified than 200 was; **no character count separates a footnote body from a code-fence
label**, exactly as the sibling plan found that no percentage separates a dropped comment thread from
dropped normative text.

Rate: **one false positive in three runs on one of twenty pages**, and it was recoverable prose in a
footnote rather than body text. That is the number a decision rests on and it is from a small sample.

### And the variance is real

Three Luna runs on `pg-greatwork`: 87/87 markers with 0 extra, then 86/87 with the footnote,
then 87/87 with 0. `whitman-leaves` dropped three blocks once and two the next time. The sibling plan
asks for at least three uncached repetitions per fixture for exactly this reason; **this spike has
three on one fixture and one on the rest**, which is enough to establish that variance exists and not
enough to bound it.

## What a model cannot fix here, and it is half the problem

Everything above is about *removal*. The other two new fixtures are about *shape*, and the drop-mask
schema cannot touch them:

- `whitman-leaves` — 67,890 characters in one block, because the verse is in `<pre>`.
- `hacker-howto` — 14,572 characters in one block, because the FAQ is a layout `<table>`.

Splitting those needs an operation that *creates* boundaries, which is a different and much more
dangerous schema than a drop mask, and it is **stage 3's job, not stage 2's**
([architecture.md § Stage ownership](../project/architecture.md#stage-ownership)). A `<pre>` of verse
and a `<pre>` of ABNF grammar must not be split the same way, and RFC 9110's 133 `<pre>` blocks are
the counter-example sitting in the same corpus. Nothing here recommends a model for it; the point is
that **the tidy pass is not the whole of what Greg asked for**, and the half it does not cover is
the half `whitman.html` and `hacker_howto.html` were captured to keep visible.

## The five fixtures added

Listed with their licences and what each is for in
[`evals/extraction/fixtures/README.md`](../../evals/extraction/fixtures/README.md). Two notes that
belong here:

**`mkdocs_tabs.html` fills the gap that README named as the most valuable thing that could be
added** — content hidden by external CSS only, no `[hidden]`, no inline `display:none`, no
`aria-hidden`, sitting inside the article container. It arrived as tabbed alternative content rather
than the nav drawer the README imagined: Readability admits every panel, so C and C++ examples run
together with no boundary and two tab labels arrive glued into one block reading `CC++`.

**`hacker_howto.html` answered HTTP 408 with a 110-byte body on the first capture.** Committed, it
would have been a fixture with no article in it, and the runner would have reported a page rather
than a failure. Captures are now checked for their own article text before hashing.

## Recommendation

1. **The free marker rule, in stage 3, deterministically.** No model, no money, no latency, no
   variance. It is the single largest win on the corpus (87 blocks on the PG essay alone) and it does
   not need this plan's permission — it needs
   [block-ids.md](../project/block-ids.md)'s owner to decide whether a letterless block should ever
   have been minted as a gistable block in the first place. **That question is upstream of everything
   else here.**
2. **Then the model, on the residual only.** Luna, ids-only, ~$0.002 and 20 seconds per article,
   cached on the content hash like the other expensive stages
   ([architecture.md](../project/architecture.md#conventions)). It is not on a reader's critical path,
   so it does not need streaming.
3. **Not yet as an automatic drop.** One false positive in three runs is a small sample, and the
   thing it deleted was article prose. The honest first shipping form is the same one the sibling
   plan reached for detection: **record the model's verdict beside the block rather than acting on
   it**, and look at a hundred articles' worth before anything is removed for real.
4. **Do not pay for Terra or Sonnet** on this task. Thirteen times the price for one genuine
   difference (the inline ToC on 2,500-row pages), which chunking the list would probably also fix.

## What would falsify this

- A hundred ordinary articles, not chosen for being hard, with zero prose false positives. This
  corpus is enriched for difficulty and says nothing about the base rate — the sibling plan's point,
  and it binds here identically.
- The marker rule turning out to remove something on a page type absent from these twenty. Verse,
  drama and definition lists are covered; numbered-line code listings and interlinear translations
  are not.
- Block-id stability across two runs, which nothing here measured and which is the thing that
  silently orphans notes.

## See also

- [readability-repair-pass.md](readability-repair-pass.md) — the same question from the other side,
  and the source of every methodological rule this file follows
- [content-extraction.md](../project/content-extraction.md) — the stage this would sit after
- [block-ids.md](../project/block-ids.md) — whose contract decides recommendation 1
- [silent-success.md](../reusable/silent-success.md) — a 110-byte fixture, a truncated JSON answer,
  and a results file that shrank without a word: three instances in one afternoon
