# Tidying what Readability kept — a model pass over the blocks, not the gaps

**Status: a spike, reviewed, and with a recommendation that the review changed.** Nothing in the
pipeline has changed. Stage 2 is [content-extraction.md](../project/content-extraction.md); the
sibling plan that asked the opposite question is
[260827ab-readability-repair-pass.md](260827ab-readability-repair-pass.md); GPT Sol's review is
[260830at-readability-tidy-pass-review-sol.md](260830at-readability-tidy-pass-review-sol.md) and
**[What the review overturned](#what-the-review-overturned)** is the section to read if you read only
one.

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
real and it is on the shelf right now, and the `<br>` example is not the case.

**The first draft of this file then said a model pass "does the job with no false positive on article
prose across twenty committed pages". That was wrong, and it was wrong for three compounding
reasons the review found:** the instruments were not running the real stage 2, the safety alarm was
printing 140 characters of a block while claiming to print it in full, and the control could not
discriminate. Corrected, the arm is still worth building and **is not ready to remove anything
automatically** — see [Recommendation](#recommendation).

Three findings, in the order they change what to do:

1. **The `<br>` premise is wrong, and its conclusion is right.** Readability's own `_replaceBrs`
   reflows `<br><br>` runs into paragraphs. Paul Graham's *How to Do Great Work* has **zero `<p>` in
   the source**; Readability emits **231**, and stage 3 makes **265 `<p>` blocks** of them. That page is nevertheless broken, in a way nothing in
   this repo was looking at: it arrives as 328 blocks of which **87 hold six characters or fewer** —
   `[1]`…`[29]`, a bare `[`, a bare `25`. 87 of them are `gistable: true`, so the table of contents,
   the summaries and the granularity-zoom tree all treat them as content.
2. **Nothing in the pipeline has ever looked at what Readability *kept*.** Every instrument here
   measures absence — `droppedChars`, the ratio, kept-over-present per tag. Two of the five fixtures
   added for this spike score **perfectly** on all of them while being visibly wrong to a reader.
3. **A model does the judgement well and cheaply, and not yet safely enough to act on.** The certain
   junk is free; the model's marker recall is *worse* than a four-line regex and varies run to run.
   What it is good at is the part no rule can do — and it still confuses an author's later update to
   a post with the post's footer.

## What is actually broken, measured

[`evals/extraction/probe.mts`](../../evals/extraction/probe.mts) is new: it runs stage 2 and the
**real stage-3 splitter** over a page and reports what a reader would get. Two counts, split where
certainty is:

- **markers** — a gistable block of six characters or fewer with no letter in it. `[1]`, `¶`, `▲`,
  `[`, `25`, `{6}`.
  (**The length bound was missing from one of the two copies of this rule**, and the recommendation
  inherited the unbounded one. Sol's counter-examples are decisive: with no bound it deletes a
  numeric table cell, a scoreline, `1–0`, `0-0`, a date, an equation like `1 + 1 = 2` and a
  symbol-only scene break. Bounded at six it still deletes `1–0` and a numeric cell. See
  [What the review overturned](#what-the-review-overturned).)
- **tiny** — six characters or fewer, has a letter, is not a heading. `http`, `[edit]`, `{v}`.
  Suspicious, not certain.

**The split exists because the first version did not have it and was wrong.** One number called
`h2:"Code"`, `h3:"Text"`, `h2:"Syntax"` and `dt:"Normal"` defects; they are a real heading and a real
definition term. An instrument that scores Tufte CSS's own section headings as junk would have argued
for a fix that damages pages.

Across the twenty-one committed fixtures:

| fixture | markers | tiny | longest block | ratio | what the reader gets |
|---|---:|---:|---:|---:|---|
| **pg-greatwork** | **87** | 0 | 635 | **1.000** | 27% of the blocks are punctuation |
| **rfc9110** | **127** | 20 | 6,796 | 0.945 | `¶` permalinks and `▲` back-links as blocks |
| **whatwg-parsing** | 4 | 192 | 16,655 | 0.981 | the spec's own inline table of contents, 140 list items |
| **mdn-cache-control** | 0 | 31 | 533 | 0.665 | `http` / `html` code-fence labels, 30 of them |
| **wikipedia-transformer** | 0 | 19 | 1,874 | 0.731 | nineteen `[edit]` links |
| **mactutor-turing** | 18 | 15 | 990 | 0.858 | `1931`, `in`, `'s` — mid-sentence fragments |
| ~~acx-footnotes~~ | ~~18~~ **0** | 0 | 1,041 | 0.986 | **a failure this file invented; see below** |
| **whitman-leaves** | 0 | 0 | **67,890** | **1.000** | several poems as one node |
| **hacker-howto** | 0 | 0 | **14,572** | 0.955 | 21 Q&A pairs as one node |
| **shakespeare-hamlet** | 0 | 0 | 1,539 | 0.945 | **correct** — 52 speeches and lines, the control |

**The `acx-footnotes` row was a measurement artefact and is the most instructive number here.** The
instruments did `unhide → Readability → split` and production stage 2 also calls
`canonicaliseNotes` *before* Readability ([`src/extract.ts`](../../src/extract.ts)). Without it that
page reports **118 blocks and 18 stranded footnote markers**; with it, **96 blocks and zero**. The
instrument was reporting a failure the real pipeline had already fixed, and no check computed from
its own rows could have caught it. Both instruments now call `readArticle`, the production transform
itself, so the two cannot drift again. Found by GPT Sol.

The rest of the table survives that fix unchanged, Paul Graham's row included — 87 markers with the
note step and 87 without.

Note the ratios. **`pg-greatwork` and `whitman-leaves` both score 1.000 and drop nothing**, and both
are broken. The existing corpus runner cannot see either failure, and neither can the structure
check, because no *tag* went missing — the tags are all there, wrapped around the wrong amount of
text or around nothing.

(An earlier draft generalised that into "four of the five new fixtures score perfectly on
`droppedChars`". That is false and the file's own probe output contradicts it: only `whitman-leaves`
is zero. MkDocs drops 156 characters, `hacker-howto` 1,031, `mactutor-turing` 1,539,
`shakespeare-hamlet` 208. **Two** fixtures make the point; four was a number nobody computed.)

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

## What three models did, and what that comparison is worth

| | GPT-5.6 Luna | GPT-5.6 Terra | Claude Sonnet 5 |
|---|---|---|---|
| fixtures completed | **21 of 21** | 14 of 15 | **9 of 15** |
| cost of that run | **$0.118** | $0.943 | $0.962 |
| per completed page | **$0.0056** | $0.067 | $0.107 |
| slowest completed page | 24.5 s | 42.0 s | 72 s |
| marker recall, whole run | **221/246 (90%)** | 89/139 (64%) | not comparable |
| the inline ToC on rfc9110 | missed it (1 block) | **found it (307)** | ran out of tokens |
| content deletions | 2 (Aaronson's own updates) | 0 seen | 1 (PG acknowledgements) |

**Every one of those numbers is one run per fixture, and the sibling plan asks for at least three.**
So the table separates *models* from *run-to-run variance* nowhere at all, and the RFC ToC row — the
single largest apparent difference — is exactly where that matters, because Luna found one block on
one run and 307 was Terra's single attempt.

Three corrections to the first draft, all from the review and all checked here:

- **Sonnet completed 9 of 15, not 14.** The first draft reported only the RFC failure and left five
  other absent fixtures unmentioned, so its cost-per-page and its "one false positive" both came off
  a denominator the table did not show. A results file that is six pages short looks exactly like a
  corpus that is six pages smaller, which is why the fixture count is now in the filename.
- **Terra's marker recall is worse than Luna's, not better** — 64% against 90%. The first draft said
  "Terra's better marker recall is not worth paying for", which had the direction backwards. What
  Terra is better at is finding a long inline table of contents on a 2,500-row page.
- **Luna is $0.0056 a page, not $0.002.** The earlier figure divided a smaller total by a larger page
  count.

**Sonnet's rfc9110 run failed with `finish_reason: "length"`**, and the guard for it was written on
purpose: a truncated JSON answer parses as *fewer* drops, which reads as a cautious model. Without
the check, Sonnet would have been scored as the most conservative arm on the page it could not
finish.

### And the arm that is recommended has not actually been run

The design conclusion below is *"free rule first, model on the residual"*. The accounting in
`tidy.mts` separates markers from `beyondTheRule` **after** the call — but `ask()` still sends every
row, markers included, and the prompt still lists marker examples. So what was measured is "model
sees everything, we credit it only for the residual", which is the right *scoring* and not the
proposed *system*. Removing the markers first changes the prompt, its length and its attention, and
that run has not been done. Sol's point, and it is fair.

### What it drops, read rather than scored

There is no gold for "is this really furniture", so `beyondTheRule` is **printed, never totalled** —
the [`gainedText`](../../evals/extraction/corpus.mts) lesson, applied before the same mistake could
be made a fourth time. Read across the corpus, Luna's picks are:

| fixture | what it named | verdict on reading |
|---|---|---|
| whatwg-parsing | 146 — the spec's inline ToC, prev/next links, "Living Standard — Last Updated" | correct |
| mdn-cache-control | 30 — every `http` / `html` code-fence label | correct; kept `h2:"Syntax"`, `dt:"Age"`, `h4:"no-cache"` |
| gutenberg-pride | 21 — twenty repeats of `[Copyright 1894 by George Allen.]`, page markers | correct; an earlier run also took the publisher's imprint and a plate caption |
| mactutor-turing | 23 — the "Additional Resources" external-links rail | correct |
| wikipedia-transformer | 18–19 — `[edit]`, all of them and nothing else | correct |
| gwern-scaling | 5 — "Backlinks", "Similar Links", "Bibliography" and their labels | correct |
| arxiv-abs | 4 — the metadata table and submission history | correct |
| whitman-leaves | the Gutenberg `*** START/END ***` sentinels; once, the 8,331-char ToC | correct |
| hacker-howto | 1 — `Copyright © 2001 Eric S. Raymond` | correct |
| tufte-css | 1 — `Dave Liepmann`, the byline | arguable |
| aaronson | 7 — the post footer and comment policy, **and two of the author's own updates** | see below |
| acx, acx-footnotes, cornell, constitution, mkdocs-tabs, **shakespeare-hamlet** | **nothing** | correct |

**The Shakespeare control was over-claimed and the correction matters.** The model did leave all 52
of its blocks alone, which is the right behaviour. But the blocks are mostly *speeches*, the longest
running to 1,539 characters, and **none of them is six characters or fewer** — so the page cannot
defeat a short-block rule, because such a rule never touches it. It is a control against a model
being careless, not against the crude baseline, and the first draft claimed the second. Reproduce it
with `npx tsx evals/extraction/tidy.mts --trivial --all`.

### The false positives, and there are more than one

The first draft of this section was called *"the one false positive"* and reported a rate of one in
three runs. Both halves were wrong, and the second instrument fix is why: `prose` claimed to print a
block "in full" and was printing the same 140-character snippet the model saw, so a reviewer was
judging a deletion from its first sentence.

With the full text stored, the twenty-one-fixture Luna run names **twelve blocks over 100
characters**. Read, they sort into three groups:

**Correct.** `man-open`'s 2,497-character "Pages that refer to this page" index; `arxiv-abs`'s
metadata table and submission history; `aaronson`'s WordPress "This entry was posted on…" footer and
its three comment-policy paragraphs. Furniture, all of it.

**Genuinely wrong, and a nameable class.** On Scott Aaronson's post, two blocks:

> *Update (Feb. 29): A YouTube video of this talk is now available…*
> *Another Update (March 8): YouTube video of a shorter (18-minute) version of this talk…*

Those are **the author's own later additions to the piece**, and they read like site chrome because
they begin with a parenthetical date. Nothing in the prompt's keep-list covers them. This is the
failure to design against, and it is worse than a stray footnote body: an update is often the most
current thing on the page.

**A policy question, not an error.** PG's *"Thanks to Trevor Blackwell, Daniel Gackle…"*
acknowledgements, and — in an earlier run — Gutenberg's publisher imprint
(*"Ruskin House. 156. Charing Cross Road. London George Allen."*) and its printer's colophon. The
sibling plan raised exactly this and nobody has answered it: **does Spideryarn want acknowledgements
and front matter on the shelf?** That is Greg's call and needs no model.

An earlier run also named the body of PG's footnote 15 — 177 characters beginning with a stray `]`,
because the splitter cut its marker off. Real prose. The alarm did not fire, because `PROSE_CHARS`
was 200 and the block was twenty-three characters short of it.

**So the honest count is at least four distinct content deletions across the runs, not one**, and
Sol's arithmetic on the rate stands: treating page-runs as independent — already a simplification
this evidence does not earn — two errors in twenty-two page-runs is a 95% exact interval of roughly
**1%–29%**. That interval is useless for deciding anything, which is the point. It does not estimate
the quantity that matters either: **the chance that an ordinary article loses genuine content**, for
which this corpus, enriched for difficulty, is the wrong sample entirely.

`PROSE_CHARS` is now 100. **That is not a fix and should not be read as one.** No character count
separates a footnote body from a code-fence label, and Aaronson's update at 220 characters and his
comment policy at 256 are indistinguishable by length. Length orders human review; it cannot gate
anything.

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

Changed by the review. The first version said "ship the free marker rule, then the model on the
residual, do not act automatically yet". The middle and the end survive; the beginning does not.

1. **Do *not* ship a generic letterless rule.** Bounded at six characters it still deletes a numeric
   table cell, a scoreline, `1–0`, a chess result, a bare date and a symbol-only scene break — and
   **the corpus contains no page with any of those**, so its 100% marker precision could not have
   failed. Build the negative controls first. Then prefer rules that name a *structure* rather than a
   character class: a link whose text is its own affordance, a block with a footnote role, a language
   label adjacent to a `<pre>`. Those are what the failures actually are.
2. **The prompt needs three additions**, all from real errors above: an author's later *Update (date)*
   to a post is the article; acknowledgements, captions, imprints and licence text are the article
   unless policy says otherwise; and a document's own table of contents is different from site
   navigation. A `needs-context` verdict alongside keep and drop would stop uncertainty being forced
   into one of the two.
3. **Then the model, on the actual residual**, which has not been run. Luna, ids-only, roughly half a
   cent and 25 seconds an article, cached on the content hash like the other expensive stages.
   Not on a reader's critical path, so no streaming.
4. **Detection only, for a long time.** Record the verdict beside the block; remove nothing. Two
   content deletions in twenty-two page-runs gives a 1%–29% interval, and the quantity that decides
   this — the chance an *ordinary* article loses something — has not been measured at all.
5. **Do not pay for Terra or Sonnet on this task**, but call that budgeting rather than a quality
   finding. One run each cannot separate a model from its own variance.

## What would falsify this

- A hundred ordinary articles, not chosen for being hard, with zero prose false positives. This
  corpus is enriched for difficulty and says nothing about the base rate — the sibling plan's point,
  and it binds here identically.
- The marker rule turning out to remove something on a page type absent from these twenty. Verse,
  drama and definition lists are covered; numbered-line code listings and interlinear translations
  are not.
- Block-id stability across two runs, which nothing here measured and which is the thing that
  silently orphans notes.
- A page with numeric-only or symbol-only content that is genuinely the article — a results table, a
  scoresheet, a chess game, an equation on its own line. The marker rule's precision is untested
  against every one of those.
- Labelled golds for the short blocks, so the trivial baseline can be scored rather than argued
  about. Without them `beyondTheRule` is the only evidence, and it is prose for a human to read.

## What the review overturned

[GPT Sol's review](260830at-readability-tidy-pass-review-sol.md), 2026-08-31. Its verdict was *"change the
recommendation"* and it was right. Every finding below was reproduced here before being accepted.

**Three defects in the instruments, all of which made the arm look better than it is:**

1. **They did not run the real stage 2.** `canonicaliseNotes` was missing, and `acx_footnotes.html`
   reported 18 stranded markers that production does not produce. Fixed by exporting `readArticle`
   from [`src/extract.ts`](../../src/extract.ts) and having both instruments call it.
2. **`probeHtml` caught every splitter exception and returned zero blocks, zero markers, zero tiny** —
   so a broken splitter scored as a flawless page. The `try`/`catch` is gone. I wrote that catch
   myself with a comment excusing it, which is the ordinary way this class of bug arrives.
3. **The `prose` alarm printed 140 characters while the doc comment said "in full".** Two of the
   deletions it was supposed to surface — Aaronson's own updates — were invisible behind that
   truncation. Full text is stored now.

**And the finding that does the most damage to the first draft:**

> **The control does not discriminate.** The claim was that `shakespeare_hamlet.html` and the short
> headings on Tufte, MDN and WHATWG stop a "drop every short block" policy from scoring well. Run it:
> at six characters the trivial policy scores **246/246 markers, zero prose alarms, zero invented
> ids**, and deletes 544 blocks of which 298 are not markers at all — 18 real headings among them.
> **Hamlet contributes zero blocks at that threshold**, so the control is entirely inert against the
> policy it exists to defeat.

That is the sibling plan's own central lesson — a corpus that cannot exercise the arm it exists to
judge — recurring in the file that quotes it. It does not make the headline finding wrong, and it
does mean **nothing here has yet shown that a model beats a crude rule**, because the only evidence
separating them is a printed list a person has to read.

Sol also found four stale numbers, all corrected in place: 266 paragraphs (it is 265), "four of five
fixtures score perfectly on droppedChars" (only one does), Luna's slowest page, and Terra's marker
recall being better than Luna's when it is worse.

**What it checked and found sound:** the Paul Graham failure itself, ratio 1.000 and zero dropped
characters and all; the ids-only schema preventing rewriting and reordering; the erratic marker
recall; the `finish_reason` guard; the two giant blocks in Whitman and the hacker FAQ; that a drop
mask cannot fix them; that splitting belongs to stage 3; and that not dropping automatically is
correct.

## See also

- [260827ab-readability-repair-pass.md](260827ab-readability-repair-pass.md) — the same question from the other side,
  and the source of every methodological rule this file follows
- [content-extraction.md](../project/content-extraction.md) — the stage this would sit after
- [block-ids.md](../project/block-ids.md) — whose contract decides recommendation 1
- [silent-success.md](../reusable/silent-success.md) — a 110-byte fixture, a truncated JSON answer,
  and a results file that shrank without a word: three instances in one afternoon
