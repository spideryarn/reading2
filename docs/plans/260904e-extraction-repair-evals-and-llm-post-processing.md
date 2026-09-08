# Repairing what ingestion does to an article — the corpus, the ruler, and the free wins

**Status: stages A and B are done. C is under way — rewritten 2026-09-06 into C0–C5 after review by
Fable and GPT Sol and a re-measurement that found one of its six items already fixed and two of them
misdescribed. On `dev`: C0.1 the order-gate fix, C0.2 the shape corpus, C1a the capability floor,
C4a the narrow delete class, C5 the ArchWiki callout adapter. C1 is deferred until a long-wall
fixture exists — C1a took its argument away, and its own § says so. **Left: C2, C3, C4b — and a
review by Fable on 2026-09-07 argues none of the three is the right next thing**, recommending stage
D instead (it improves the reading view, arc, Summaries, Outline, Structure and reading time
together, where C2/C3 improve one page shape) and dropping C4b, whose cost this plan overstated: the
`Block` representation it was said to need **already exists**, as `treatment`/`role`, and § D says so
in its own first line. **Astra was then asked and disagreed with Fable**, ranking a bounded recovery
stage first; a census broke the tie (41 data tables in the corpus, 34 kept, **7 lost**, 4 of them a
reader's evidence) and Astra's ranking was adopted. **C4b is dropped, stage D deferred with all six
visibility commitments intact, and C3 is next — diagnosed 2026-09-08 and much smaller than it was
scoped as: the tables are deleted *before* candidate scoring, so there is no reinsertion problem and
C2's rationale mostly goes with it.** **C3 is built and not yet landed**, at `f61df365` on the worktree branch: `src/protect.ts`, the
table oracle that is what remains of C2, the PLOS gold corrected, and four data tables plus a
correction notice recovered. Three Sol reviews so far — the plan, the code, and a narrow re-check of
the P0 fixes — and **each one found a reader-reachable defect the one before had not**: a shared
class token that truncated an article, a broad table rule that recovered a Wikipedia navigation
sidebar and reported it as evidence, an ancestor guard that declined to rescue tables Readability
then deleted, and now a prose-retention floor tuned to one fixture that lets a page of short
paragraphs vanish, plus rule B deleting prose on a path the fallback never reaches. Those last three
are in hand. **The pattern is the finding**: every defect here has been the *guard*, not the
feature. Scope narrowed after review.** The model repair pass Greg asked for is
**not** in this plan — GPT Sol's review found its operation layer not yet designable, and it moves to
its own plan with the preconditions named in
[What this plan deliberately does not build](#what-this-plan-deliberately-does-not-build-the-model-repair-pass).
What is here is the measurement and everything deterministic, all of which ships.
Stage 2 is [content-extraction.md](../project/content-extraction.md).
This is the third pass at a question two earlier spikes answered "not yet":
[260827ab-readability-repair-pass.md](260827ab-readability-repair-pass.md) (what Readability threw
away) and [260830at-readability-tidy-pass.md](260830at-readability-tidy-pass.md) (what it kept).
Both are prerequisites for reading this one; every methodological rule here is theirs.

> use Sonnet to trawl through many HTML articles from various sources, looking for examples that get
> somehow mangled by Readability+sanitisation … Then use those to build up a set of evals that start
> with the original HTML, then pass it through our HTML ingestion flow, then run an LLM
> post-processing step to fix things … and try and improve the scores. … it may be that there's
> deterministic scripts we can run pre-Readability and/or post-Readability as well as the LLM
> post-processing, although that feels a bit riskier to me.
>
> — Greg, 2026-09-04

## Why this one is different from the two that stopped

Both earlier spikes stopped in the same place, and said so in their own final sections: **there is no
gold, so no arm can be scored — only argued about.** 260830at's most useful sentence is the one
where it admits its control was inert: the trivial "delete every short block" policy scored
246/246 markers on a corpus assembled to defeat it.

Two things changed today.

**First, Greg answered the policy question that was blocking the gold.** It had sat open in both
plans as "does Spideryarn want acknowledgements and front matter on the shelf?" — a product decision
no model can infer and no annotator can guess:

> We want to replace the document's own ToC with our hierarchy-generation (which should be informed
> by the author's headings but use its own judgment). For most of those other examples you suggested
> (e.g. acknowledgments, colophons, etc etc), I think we probably want to include them, but mark
> those blocks with metadata somehow as "not very interesting" and then display them in the text
> default-collapsed and/or at the bottom, and perhaps get de-emphasised in the
> Hierarchy/Structure/Outline/Summary output/display. That way they're included, but the main
> article is front-and-centre.
>
> — Greg, 2026-09-04

That is not a tie-breaker on an existing question. **It dissolves the question**, and with it most of
the risk that stopped the last two plans. See [The reframe](#the-reframe-nothing-is-deleted) below —
it is the single most important idea in this file.

**And the field he is describing already exists.** `Block.treatment?: "supplement"` is "not very
interesting" — the axis the whole policy is already stated on — and `Block.role` is the label the UI
shows. Both are migrated (`drizzle/0027_block_roles.sql`), both are in `hashBlocks` so reclassifying
invalidates the cached artefacts, and [`src/block-policy.ts`](../../src/block-policy.ts) already
answers the five downstream questions by name: searchable (yes), evidence for automatic model stages
(body only), embeddable (body only), a navigable outline row (body only), on the reading-time clock
(body only). `supplement.ts` § `TITLES` already names all five roles; the Hierarchy already gives a
supplement run one depth-one node with no gist; the arc already numbers "3 / 7" rather than "3 / 9".
Only `"footnote"` is ever assigned today. Found by Fable, **verified here by reading the code** — the
five predicates, the migration, the `TITLES` map and the trailing-run constraint are all where it
says. So what looked like the largest stage in this plan is mostly a matter of assigning roles that
already have somewhere to go.

**Second, the trawl found damage nobody was looking for**, including one bug with a single root cause
that corrupts every code-bearing article we have ever ingested. See
[What the trawl found](#what-the-trawl-found).

## The reframe: nothing is deleted

Every design in the two prior plans is a **keep-or-drop** decision, and both plans identify the same
worst case: a wrongly dropped block takes part of the piece away from the reader, and **nothing will
ever tell them**. 260830at ranked its verbs by whether they generate text; Fable's advice on this
plan argues that is the wrong axis and the right one is *how visible the failure is*, which makes
`exclude` — the verb that generates nothing — the most dangerous one available.

Greg's answer removes the need for it. The pipeline stops choosing between *keep* and *drop* and
starts assigning **prominence**, and nothing is ever discarded:

| | the existing field | what the reader gets |
|---|---|---|
| the argument | `treatment` absent — `isBody` is true | the reading view, the outline, the summaries — as now |
| the apparatus | `treatment: "supplement"`, `role` saying which | present, addressable, searchable, **folded in place** under the author's own heading; no gist, no outline row, off the reading-time clock |
| not the document | site chrome that leaked in: `[edit]`, `toggle caption` ×24, `View Article` ×26, a nav breadcrumb, an `<iframe>` tag rendered as prose | not rendered by default, **but stored, and inspectable** |

`role` widens by three to cover Greg's examples — `frontmatter` (a standfirst, a publisher's own
summary), `bio`, `licence` — and colophons and imprints go under the existing `credit`. Three lines
in `TITLES`, one additive migration. **Not** a new `peripheral` boolean, which would be a synonym for
`treatment: "supplement"` under another name, and not a 0–1 salience, which cannot be a heading in
the UI and has no gold (what is the gold for 0.6?).

**The first draft of this section claimed the reframe made a model pass safe to ship, and that was
wrong.** GPT Sol's review checked what `treatment: "supplement"` actually does and the claim does not
survive it: [`src/block-policy.ts`](../../src/block-policy.ts) excludes a supplement from automatic
summaries, from hierarchy evidence, from embeddings and from the reading-time clock. So a wrongly
marked section leaves the reader able to expand the prose **while every generated account of the
article goes on omitting its central argument** — which is exactly the invisible failure the reframe
was supposed to eliminate. Storage recoverability is not practical visibility, and the sentence
"classification needs no such number to be safe" is deleted rather than softened.

What follows from that is not "abandon the reframe" — the reframe is still the right data model, and
Greg's instinct to include-and-demote rather than drop is still better than either prior plan's
answer. What follows is that **the visibility has to be built before the model may drive it**, and
Greg's call, 2026-09-04, is to build it:

> Ship it, and build the visibility to earn it

So these are commitments, not aspirations, and each is a test in [stage D](#d-the-apparatus-in-the-product):

- a **visible placeholder at every folded run**, including chrome with no authored heading
- **honest counts** — *"Acknowledgments · 3 paragraphs"*, and the number is checked
- an **always-reachable reveal**, so a reader who suspects something is missing can find out
- **search discloses and reveals hidden matches** rather than silently not matching
- a **persistent per-block restore**, which is a stored reclassification and not an expand/collapse
- an **audit view** of what was classified and why

Until those exist, a classification changes what the summaries say with no way for anyone to notice.
That is why the model pass is [deferred to its own plan](#what-this-plan-deliberately-does-not-build-the-model-repair-pass)
rather than built here.

**Fold in place; do not move anything to the end.** Greg offered "default-collapsed and/or at the
bottom" and the second half has to be declined. Array order in `blocks.json` *is* document order,
every tree node covers a contiguous range, and the client draws the tree as a `rowSpan` table that
cannot draw a range whose blocks are not adjacent on screen. A display-only reorder breaks the spine,
saved reading position, keyboard next/previous, the fisheye, Quotes and search-hit context. What Greg
wants is delivered without any of that by folding the run where it stands: one chrome row at the
run's own position, labelled with the author's heading verbatim where there is one, with an honest
count — *"Acknowledgments · 3 paragraphs"* — opening to the prose exactly as written.

**The simpler option passed over:** keep the drop mask and just be careful. Rejected because the
carefulness has to be evidenced, and the evidence needed is a false-positive rate on ordinary
articles that neither prior plan could obtain — 260830at's own interval was 1%–29%, which it
correctly called useless for deciding anything. Classification needs no such number to be safe,
because its failure mode is recoverable.

**The cost of the reframe, stated rather than hidden:** three prominence values is a schema, and
schemas are hard to change once artefacts carry them. It also moves work downstream — the reading
view, the hierarchy and the summaries each have to learn what `peripheral` means, which is stage E
and is the largest piece of user-visible work in this plan.

## What the trawl found

76 URLs attempted across news, magazines, Substack/Ghost/Medium/WordPress/Blogger/Bear/Hugo,
PMC/PLOS/bioRxiv/ar5iv/arXiv, ReadTheDocs/GitBook/Docusaurus/GitHub, Wikipedia in five languages
including two RTL, GOV.UK/EUR-Lex, Hacker News, Discourse, and hand-written personal sites.
**52 completed**, 2 correctly refused, 22 failed to fetch. Every claim below carries a quoted string
from a saved artefact; the full table is in the run's findings file and the shortlisted raw HTML is
kept for promotion to fixtures.

Ranked by what it costs a reader, not by frequency:

**1. Every code block's `text` is corrupted, on every article, since always.**
[`src/blocks.ts`](../../src/blocks.ts) § `extractText` ends `.replace(/\s+/g, " ")` with no `<pre>`
branch — while `classify`, sixteen lines below it, knows perfectly well that `PRE` is `kind: "code"`.
Confirmed by reading the code, not inferred. Python's `itertools` recipes arrive as one unbroken
line; so does RFC 8259's ABNF. The block's `html` field is intact, so **the rendered page is probably
fine and the damage is to `text`** — which is what word counts, search, every AI prompt, and
`exactKey`'s block-id hash all read. One deterministic fix, one obvious failing test.

**2. Silent success on pages that are not articles.** Medium (twice), PMC and beehiiv all return
HTTP 200 carrying a bot-check or an app shell, and Readability confidently extracts it. PMC's
"article" is a Google reCAPTCHA challenge; Medium's is
`<p>PAGE NOT FOUND</p><h2><span>404</span></h2><h2>Out of nothing, something.</h2>`, titled
"Medium". Nothing anywhere signals a problem. This is the shape
[silent-success.md](../reusable/silent-success.md) is about, arriving in production input.

**3. Furniture kept — the most frequent category, ~20 of 52.** From a stray `"Site search"` block to
**43% of a PLOS Biology article's blocks being reference-list buttons** (`'View Article'` ×26,
`'Google Scholar'` ×26, `'PubMed/NCBI'` ×23, all `gistable: true`) to an Arabic Wikipedia article
whose **block 1 is a maintenance banner** — a reader opens the piece to a warning box rather than the
topic.

**4. Whole data tables lost.** Wikipedia's *List of countries by GDP (nominal)* loses the sortable
GDP table entirely — the point of the page. Zero figures survive anywhere in the blocks.

**5. Segmentation failures at both ends.** One Blogger index glues **20 distinct posts into one
72,007-character block**; a Hacker News thread becomes one 23,038-character block. At the other end,
`[edit]` stubs, `↵`, `↑`, bare `"optional"` ×6, `"Note"`/`"Tip"` admonition labels detached from
their bodies, and 181 empty `<p>` on one French Wikipedia page.

**6. Bylines and dates mangled by our own handling**, not the publisher's:
`byline: "By \n \n Natalie Wolchover\n \n \nDecember 17, 2024"` (Quanta — whitespace not collapsed,
date glued on); `"Visual Journalism teamBBC News"` (byline and site name concatenated with no
separator); NPR's byline present in the source JSON-LD and absent from the output entirely.

**7. Non-Latin and RTL are entirely unrepresented in the current corpus** — zero of the 21 committed
fixtures. Arabic and Hebrew Wikipedia both surface a block-level `dir`/`lang` gap: the document-level
attribute survives, nothing per-block does.

Eleven pages were **clean** — Al Jazeera, Aeon, GOV.UK, GitHub, GitBook, Noema and others — which is
the evidence that the instrument is not simply finding problems everywhere.

## What is being built

**Scope narrowed after review.** Sol called the first draft "three plans wearing a trenchcoat" and it
was right; Greg's call, 2026-09-04, was *"Foundation + deterministic wins"*. So this plan builds the
measurement and everything deterministic — all of which ships and all of which a reader can see — and
the model repair pass becomes
[its own plan](#what-this-plan-deliberately-does-not-build-the-model-repair-pass) with the
architecture the review says it needs.

| | | |
|---|---|---|
| **A corpus** | the 21 committed fixtures plus ~12 from the trawl, filling the gaps the trawl named: government/legal, non-Latin and RTL, journal furniture, bot-wall, the code-whitespace bug in isolation | plus a **holdout that is genuinely unseen** — see below |
| **A gold, in layers** | per-fixture assertion manifests; a hand-adjudicated DOM-node gold on ~25 pages; synthetic corruptions where the answer is true by construction | *not* a hand-labelled gold on 100 pages, which is what stopped this work twice |
| **A scorer** | a scorecard, not a scalar, that has been **watched going down** against every known-broken state before anything is measured with it | |
| **Deterministic recognisers** | markup-based only, each with **both** a positive and an adversarial negative fixture | |
| **The apparatus, end to end** | the roles, the markup recognisers that assign them, the fold, and the six visibility commitments that make a wrong call discoverable | |

**The holdout cannot be drawn from the trawl.** Its 52 pages have already been read, and their
failures are what the recognisers and fixtures were designed against; hashing a split proves
integrity, not blindness. So the holdout comes from **WCXB's ordinary articles**, selected before
anyone looks at extraction results, with a named custodian and no per-page feedback until thresholds
are frozen. This was Sol's finding and it is the difference between a holdout and a second dev set.

### The rule this plan runs on

From Fable, and it reconciles Greg's wariness with the prior evidence:

> **Rule on markup, model on meaning.** Every rule that failed in the two spikes was about *content
> shape* — length, character class, "no letter", "looks like a nav". Every rule that worked was about
> *markup the author wrote* — `aria-hidden="true"`, `class="footnote-anchor"`, `data-callout`,
> `<br><br>`.

So Greg's instinct that deterministic scripts are riskier is **correct about one class and wrong
about the other**, and the plan is allowed to add recognisers freely while a shape rule needs a
negative fixture before it may exist at all. Concretely: no rule may ship without a fixture where the
same visible text is genuine content and the rule declines to fire. 260830at's ≤6-character marker
rule fails that test today — it deletes `1–0`, a bare date and a numeric table cell — and is not in
this plan.

## Stages

Four, each ending green and committable, each shipping something a reader gets. The plan doc is
updated at the end of every one.

### A — Fix the ruler, and the proven bugs

The trawl's findings that survived review, each with its failing test written and watched red first.
**Three claims in the first draft of this stage were wrong and are corrected here**, all reproduced
by Sol running code rather than reading it:

- **The `<pre>` fix is real, and cheaper than claimed.** `text` is corrupted; but the reading view
  renders `block.html` ([`TableView.tsx`](../../src/web/TableView.tsx) line 1185) so **nothing a
  reader sees is affected**, and `exactKey` normalises whitespace before hashing
  ([`src/blocks.ts`](../../src/blocks.ts) line 591) so **zero block ids churn**. Verified here too.
  What it does affect is every text-based consumer: search, article prompts, evidence, export.
  It also changes `hashBlocks`, so derived artefacts go stale even though ids carry — that needs an
  explicit invalidation/backfill decision, which an id-churn counter alone would have missed.
- **Table row separators are not a free fix and are out of this stage.** A 2×2 table already
  produces `"A B C D"`, so cells *are* separated; what is missing is row structure. Choosing tabs or
  newlines changes prompts, source hashes and text-to-DOM offsets, so it needs a contract and tests
  of its own. It also collides with the provenance invariant — a synthesised separator is a character
  with no source text node — so that invariant has to be stated over normalised source tokens rather
  than literal characters before this can be done at all.
- **The BBC byline is not a missing separator.** `byline` and `siteName` are already stored
  separately and already rendered with ` · `, so `"Visual Journalism teamBBC News"` is more likely
  one malformed Readability byline assembled from adjacent source nodes. Guessing the word boundary
  can corrupt a real name. Collapsing internal whitespace *is* simple and is in scope; the rest is
  an investigation, not a fix.
- **Empty blocks are already handled** — whitespace-only blocks are `gistable: false` today. The real
  and narrower bug is a paragraph containing only U+200B, which is still `gistable: true`.

Plus **source-id provenance**, with the honesty the first draft lacked: 260827ab measured retention
at 92.7%, 99.8% and **40.9%**, and quoting that as "92–99%" was misleading. So this stage reports
measured coverage per fixture and ships a documented fallback for the low-coverage case, rather than
assuming provenance is available. And an **id-churn counter**, which later stages depend on.

Done when: those bugs are fixed and pinned, provenance coverage is *measured and written down*, the
cache-invalidation consequence is decided, `npm test` and `npm run typecheck` green.

#### What landed, 2026-09-05 — **A is done**

`npm run typecheck` green. `npm test`, re-run after the review fixes below,
is **2 failed / 11,869 passed of 11,907**, and neither is this work: `client-imports`
(`src/web/useStepJob.ts → ../pipeline.js`) and `store-migration-registry`
(`tests/feedback-dictation-vocabulary.test.tsx`), both already red on `origin/dev` and both committed
by other work. **That is a red trunk, not a flake, and somebody should fix them.** The earlier run
had three more, all of which pass alone and were this box under load.

A note on how that was established, because it nearly was not: `npm test` backgrounded through a pipe
reported **exit 0 with a zero-byte log, twice**, and the real answer — exit 1 — came only from a
tmux run writing to a file with an explicit `EXIT=` marker appended. A green from the first form is
worth nothing. [silent-success.md](../reusable/silent-success.md).

Everything below was measured on the committed corpus,
which grew from 21 to 35 fixtures under this work as stage B landed its nine and then five more;
every figure says which cut it is over. The instruments are `evals/extraction/provenance.mts` and
`evals/extraction/block-census.mts` (both new, both committed) and four throwaway scripts whose
numbers are quoted here rather than kept — the census exists because one of those four was thrown
away with the only record of how its denominator was counted, and nobody could reproduce it.

**1. `<pre>` text fidelity — fixed, and it cost one decision that was then taken back.**
[`codeText`](../../src/blocks.ts) is a `<pre>`-only branch of `extractText`; every other block takes
the old path unchanged. It reads a `<br>` and a highlighter's per-line `<div>` as the line breaks
they are, because those carry no newline in the text at all.

Over the 21 fixtures that had a pre-change baseline — **11,656 blocks**, counted along the shipping
route (`runExtract` → `runBlocks`) by [`evals/extraction/block-census.mts --cut pre-0904`](../../evals/extraction/block-census.mts)
— **545 code blocks changed and 0 non-code blocks changed**, with 0 differences in block count, tag,
kind or `gistable`. That is the "byte-identical elsewhere" claim, run rather than argued.

> **That denominator said 11,614 until 2026-09-05, and the correction is worth keeping.** A block
> count is a property of the corpus *and* of where you cut into stage 2, and neither the doc nor the
> throwaway script said which. 11,614 is these same 21 fixtures split from `article.content` — the
> route [probe.mts](../../evals/extraction/probe.mts) takes on purpose — which misses the `<h1>` and
> `.meta` line `debugPage` wraps round the article, and stage 3 splits *that*. GPT Sol, re-counting,
> got 11,518 and 11,558: the same two routes over `CORPUS`'s 20, one fixture short of the cut. The
> census script is committed so the next disagreement is a re-run rather than an argument; the 545
> and the zeros are unchanged by any of it, and were re-derived the same day. RFC 9110's request examples were one line
each and are now four; man(2)'s header was `"open(2) System Calls Manual open(2)"` and now has its
columns; all 400 of Whitman's poems, which Project Gutenberg sets in `<pre>`, have their lines back.

> **"Preserves code layout" is too broad, and the limits are named in `codeText` rather than left to
> be found.** The fix is rooted at the `<pre>` itself and reaches nothing outside it. A `<pre>` inside
> a `<blockquote>` never gets there at all — the blockquote is terminal, so quoted code still takes
> the prose branch and loses its line breaks and its indentation together. A `<pre>` containing a
> `<table>` gets one cell per line, no row structure, and the text after the table glued to the last
> cell, because nothing inserts a break *after* an element. Both are pinned as expectations in
> `tests/block-text-fidelity.test.ts`, so whoever fixes either has to change a test rather than
> nothing. Fixing them properly means a recursive, layout-aware walk in place of a flat separator
> insertion; that is a different piece of work. GPT Sol, 2026-09-05.

**Ids do not churn: 0 re-mints attributable, across all 35 fixtures.** Measured with two arms —
control (previous text == this text) and change (previous text == the pre-change text) — because the
splitter re-mints 218 ids of its own accord on this corpus, and one number would have been read as
this change's fault. Both arms give 218. `exactKey` normalises whitespace before hashing, so the key
is computed from the collapsed form either way.

The compatibility that rests on is now tested properly, which it was not: see **6** below.

> **What those 218 are is not an ambiguous folded bucket, and this paragraph said it was.** GPT Sol
> caught it, and re-investigating it found something worse than a wrong explanation.
>
> They are the corpus's **text-less, source-less blocks** — 122 `<p>`, 59 `<hr>`, 30 `<li>`, 7
> `<figure>` — every one with no written text and no `src` anywhere in its html, so `exactKey`,
> `foldedKey` and `legacyKey` all return `null` ([`src/blocks.ts`](../../src/blocks.ts) § `exactKey`)
> and `bucketBy` drops the block from **both** sides of the match. They re-mint on *every* run over
> byte-identical input. 218 of the corpus's 302 text-less blocks; the other 84 have a `src` and carry
> fine. The 7 figures were checked by looking rather than guessed at — they are literally
> `<figure id="…">\n  \n</figure>` after sanitising, with no `img` left inside.
>
> **It is pre-existing and unconditional** — `84ce16bf`, 2026-08-24, the commit that introduced
> carry-over at all — and it is not benign:
>
> - `hashBlocks` includes the block id ([`src/source-hash.ts`](../../src/source-hash.ts), both
>   branches), so **17 of the 35 fixtures flip their blocks fingerprint on a re-extraction that
>   changed not one word**, taking `assets`, article vectors, `projection`, `similar`, saved searches
>   and `labels` stale with them.
> - `reasonsNotToPublish` compares that fingerprint against hierarchy's `input_hash`, so the same 17
>   are the articles the refusal above actually bites on.
> - **And the one nobody expected.** `blocksMatchTheirHtml` ([`src/pipeline.ts`](../../src/pipeline.ts))
>   re-derives the blocks and compares the stamped html byte-for-byte. Under Postgres,
>   `extracted_html` carries none of our ids, so the empties cannot reuse and cannot carry — they
>   mint, the html differs, and **the `blocks` step never reports itself done**. Measured over the
>   corpus: Postgres arm 18 done / 17 not; filesystem arm 34 / 1. On the filesystem `extracted ===
>   stamped`, so the empties reuse their ids off the document and the guard passes — which is why the
>   idempotence measurement quoted in [block-ids.md](../project/block-ids.md) came back clean. **It
>   measured the arm where the bug is invisible.** Production is Postgres.
>
> **Nothing a reader owns is damaged**, and that is why it has gone unnoticed: a comment or a
> bookmark needs a text selection, and these blocks have no text to select; `assertIdsCarried` needs
> only *one* id to survive, so it never fires. block-ids.md half-knows this already — *"The one
> casualty is an `<hr>`, which has neither text nor a `src` to match on and which nobody
> annotates"* — but frames it as one block on one article rather than as unconditional churn on half
> the corpus.
>
> **Taken, on its own, as stage A2 — 2026-09-05, and it needed one more clause than the
> recommendation below has.** The failing test was watched red first
> ([`tests/empty-blocks-keep-their-ids.test.ts`](../../tests/empty-blocks-keep-their-ids.test.ts));
> every one of its 13 assertions has since been watched red against the code state it guards. Every
> number reproduced: **218 re-mints → 0**, **17 of 35 fingerprint flips → 0**, **Postgres freshness 18
> done/17 not → 35/0**. **Rollout churn on real stored data: 0** — five stored filesystem articles
> (349 blocks) and 77 local Postgres revisions (16,607 blocks) re-split against their own stored
> blocks under both codebases; no stored id changed position or owner, 7 re-mints and 5 fingerprint
> flips disappeared, and the one article still churning (`revistes-ub-30977`) churns identically
> before and after, because its stored blocks were written by an older splitter.
>
> **The recommendation below, taken literally, is wrong — and two rounds of GPT Sol review caught it
> before it landed.** `` `e:${tag}` `` for any block with no text and no `src` makes an inline-SVG
> `<figure>` interchangeable with the next one: reordering two diagrams put the circle's id on the
> rectangle, `minted: 0` and the fingerprint unchanged. Reproduced, then fixed. What shipped is
> narrower in three ways, each of them measured rather than argued:
>
> - the key is given **only to a block with nothing in it at all** — no text, no `src`, no child
>   element — and it carries the block's **attributes and inner text**, because `<hr
>   class="section-break">` is not a plain `<hr>` and `<p>&#160;</p>` is not `<p></p>`;
> - the attribute list is **JSON**, not `name=value` joined, for the injectivity reason `keyOf`
>   already gives;
> - and an `e:` bucket is **refused outright when the two sides hold different numbers of unclaimed
>   ids**, so inserting a rule re-mints them all rather than sliding each id onto its neighbour. I
>   argued against that and was wrong: the refusal costs no fingerprint, because an article that
>   gained or lost a block has a different fingerprint anyway. It catches a *net* count change and no
>   more, and both that limit and the part-stamped-document case that the first version of the count
>   got wrong are pinned as tests.
>
> One limitation is accepted with its blast radius written down: `id` is left out of the key (the
> stored side has ours, having overwritten the author's), so two empty blocks differing only in an
> author-written id trade ids on a reorder. Refusing instead was **measured** — 33 blocks on 3 of the
> 35 fixtures if every named empty block is refused, 29 on 2 if only the ones that could actually
> trade are — i.e. it keeps this bug for a tenth of the corpus, and was declined on that. All the numbers above are with all of it in. The write-up, the class the mistake belongs to,
> and the lessons from the review are in
> [260905a](../postmortems/260905a-empty-blocks-remint-their-ids-on-every-extraction.md).
>
> One claim in the paragraph below is also **wrong and is corrected there**: "nothing can be anchored
> to them" — a chat is anchored by `{ blockId }` alone, and every block has a chat button. Nobody has
> started one about a horizontal rule; that is luck, not a guarantee.
>
> **Recommended fix, not taken in the review round, because id assignment is not something to change
> in one.** Give such a block the pass-one key `` `e:${tag}` `` instead of `null` — one line at the
> `src` fallback in `exactKey`. Pass one already consumes duplicates in document order, which is the
> right semantics and the same rule that keeps every repeated `<li>Yes</li>`'s id today. Measured on
> a scratch copy: **218 re-mints → 0, and the Postgres freshness arm 17-not-done → 0**. The
> catastrophic outcome — a rollout that re-mints across every stored article — does not arise, because
> previous and candidate blocks are keyed by the same new function and pair up; that is what the 0 is.
> What it concedes is positional matching for blocks where position is the only signal, which costs
> nothing when nothing can be anchored to them. Ranked against three alternatives: **not** an ordinal
> inside the key (that is the sequential-id failure block-ids.md § *Why random and not sequential*
> exists to refuse, and it buys nothing option 1 does not); **not** a structural digest of the html
> (needs `spya-` ids normalised out first, and getting that wrong re-mints every empty block on
> rollout); and neighbour anchoring is the most faithful and by far the most machinery, for blocks
> nothing anchors to. Second, separately and after it: stop emitting the invisible ones at all — the
> 159 empty `p`/`li`/`figure`, not the `<hr>`s, which are a rule the reader can see. That one costs a
> **one-time** fingerprint flip on every stored article containing one, so it needs a deliberate
> re-run rather than being discovered.
>
> **A free side finding.** The single filesystem-arm failure is `mkdocs-tabs`, and it is a different
> bug: re-splitting stage 3's own output loses every block's `context: {type:"callout"}`, because
> `scrubReserved(doc, CONTEXT_ATTRS)` strips the transport before serialising. On the filesystem a
> stage-3 re-run therefore drops callout context silently. Worth its own ticket. **Confirmed with a
> number and deliberately not fixed in A2** — `mkdocs-tabs` has 8 context-bearing blocks on a first
> run, 8 on a Postgres-shaped re-split (stage 2's html still carries the attribute) and **0** on a
> filesystem-shaped one. It is the one remaining filesystem-arm failure after A2, and it is recorded
> in [260905a § What else this turned up](../postmortems/260905a-empty-blocks-remint-their-ids-on-every-extraction.md).

> **A decision was taken here and then retracted, and both halves are worth keeping.**
>
> The first version of `codeText` **deleted blank lines**, on this argument: `articleWithIds` and
> `articleText` ([`src/article-prompt.ts`](../../src/article-prompt.ts)) join blocks with `"\n\n"`,
> so a code block carrying a blank line splits itself in two inside every prompt we send, the second
> half arrives with no `[i] spya-…:` prefix, and Ideas, Quiz and Sketch — which cite block ids as
> evidence — would hang it on the block that follows. Nothing raises.
>
> **That argument does not survive, and GPT Sol checked it rather than arguing with it (2026-09-05).**
> Nothing in production parses those prompts by splitting on `"\n\n"`; and Ideas and Quiz, the two
> stages that cite an id *as evidence*, validate that the text they quote occurs in the block they
> cite — so the misattribution described is rejected there. What the deletion cost was real and
> measured: **223 of 674** corpus code blocks have an internal blank line, and **153 of Whitman's 400
> poem blocks** lost their stanza breaks. A stanza break is meaning. Python layout, diff context and
> preformatted prose were damaged the same way.
>
> **So blank lines are kept.** The residual risk is Sketch, which validates the cited id alone: a
> model could in principle attribute the second half of a split block to the following id. That is
> recorded in `codeText` rather than designed around, because the fix for it — if it ever shows up in
> a Sketch — is one change to the framing in `articleWithIds`, and not a second mutilation of the
> canonical text that four consumers read. **The lesson is the shape of the mistake**: a prompt-side
> worry was paid for out of the extracted text, which is the artefact everything else depends on.
>
> Keeping them needed one thing the deleting version did not: **the inserted line break has to be
> idempotent.** `codeText` puts a separator in front of every block-level element, because a
> highlighter that wraps each line in its own `<div>` leaves no newline in the text at all — and
> markup indented as `<div>a</div>\n<div>b</div>`, or nesting a per-line `<div>` inside a wrapper
> `<div>`, would then fabricate a blank line the page never showed. A run of break signals now counts
> as **as many breaks as it has real newlines, and at least one**. Pinned in
> `tests/block-text-fidelity.test.ts`.

**The `hashBlocks` consequence, worked out rather than waved at.** Two things change at once for a
code-bearing article: the text, and the *canonical form*. `hashBlocks` routes any block whose text
holds a tab or newline to the framed `spya-blocks/3` branch, and its own comment said "ordinary
extraction cannot reach it — `extractText` collapses whitespace". That is now false and the comment
says so. Nothing had to change in the function, which is the argument for having written that guard
at all: it was defended as insurance against a second importer, and what arrived was a change to the
first one.

Nothing goes stale until an article is **re-extracted** — `text` is a stored column, never recomputed
on read — so there is no backfill to run and no migration. What re-runs when one is:

| | on a fingerprint mismatch |
|---|---|
| glossary, tweets, arc, quotes, ideas, sketch, quiz, timeline, and `illustrated` behind sketch | the step re-runs — **paid model calls** |
| `assets` | re-fetches every image |
| article vectors, `similar`, `projection` | in-memory cache miss, re-embeds — ~$0.0015 and 4.5s on a 360-block article |
| saved searches, referee criteria, referee claims, the metadata page's ticks | **reported stale, nothing regenerates** — correct as is |

**And one refusal, which was the only sharp edge, and is now closed.** `reasonsNotToPublish`
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)) refuses to publish when hierarchy's
`input_hash` disagrees with the current blocks hash, and `hierarchy` has **no `stamp`**, so it does
not re-run on its own. A normal `force: ["extract"]` or `force: ["blocks"]` drags it along via
`cascadeForce`; a job of `{ steps: ["blocks"] }` does not, because `cascadeForce` only names steps
**already in the job**. On a code-bearing article that job would run, succeed, and leave the article
unpublishable until somebody worked out that the fix was to re-run a step they had never named.

This plan first called that a hand-built job. GPT Sol checked and it is not: `POST /api/jobs` takes
any subset of `STEP_ORDER`, so **`{ steps: ["blocks"] }` is production-reachable through the jobs
API** by anybody with a session — no first-party UI path issues one, which is why nothing had hit it.
[`unrunnableStepPlan`](../../src/jobs.ts) now refuses that combination in `enqueue`, with a 400 that
names the missing step, **rather than quietly adding a `hierarchy` run** — that would spend the
slowest model call in the pipeline (228s measured) on behalf of a caller who did not ask for it, and
make the job that ran different from the job that was requested. The pure rule and its wiring are
asserted separately in `tests/jobs.test.ts`, the second because a guard nothing calls is the shape of
half the bugs in this repo.

The three pinned literal hashes (`21189fa4eb0bceca` in `tests/source-hash-roles.test.ts` and
`tests/supplement.test.ts`, and `example/labels.json`) are safe and were checked rather than assumed:
`example/blocks.json` holds only `p` and `figure`, and no corpus article's `blocks.json` contains a
`pre`. `tests/fixture-corpus.test.ts` would go red the day one is regenerated without its
`labels.json`, which is the right behaviour and is the guard for the refusal above.

**2. Zero-width-only blocks — fixed, narrowly.** Sol's premise held: `<p>   </p>` was already
`gistable: false`, because `extractText` collapses and trims. `<p>&#8203;</p>` was not, because a
zero-width space is not `\s`. [`isBlank`](../../src/blocks.ts) now ignores the invisible family —
soft hyphen, U+200B–U+200F, U+2060–U+2064, U+FEFF — and nothing else: a block whose text is `€`, `→`
or `1–0` is a block a reader can see, and a "has no letter or number" rule is the shape this repo has
already been wrong with twice. **Zero blocks on 35 fixtures changed**, so this is exercised by its
tests alone and by nothing on the corpus — *not exercised*, not *no regressions*.

**Sol is right that it still renders a blank row.** `gistable: false` only adds an `opaque` class in
[`TableView.tsx`](../../src/web/TableView.tsx); the row is still drawn. The block also still exists,
which is correct — deleting it would take a block id out of the sequence. Making the row disappear is
a rendering decision, deliberately not taken here, and pinned as an expectation so that whoever takes
it changes a test rather than nothing.

**3. Byline whitespace — fixed. The BBC half is answered, and the plan was wrong about it.**
[`tidyMetaText`](../../src/extract.ts) collapses internal whitespace where the `Meta` is built, not
inside `readArticle` — an instrument asking what Readability said should get what Readability said.
Five fixtures change, all of them improvements:

| | before | after |
|---|---|---|
| quanta-year-physics | `"By \n        \n            Natalie Wolchover\n        \n            \nDecember 17, 2024"` | `"By Natalie Wolchover December 17, 2024"` |
| hacker-howto | `"Eric Steven Raymond\n    Thyrsus Enterprises\n    <esr@thyrsus.com>"` | `"Eric Steven Raymond Thyrsus Enterprises <esr@thyrsus.com>"` |
| ar5iv-attention | `"Affiliation: Google Brain\n\nEmail: noam@google.com"` | `"Affiliation: Google Brain Email: noam@google.com"` |
| npr-ozy-style-feature | `"by \n  Bec Roldan"` | `"by Bec Roldan"` |
| plos-biology | `"Leonard P. Freedman   ,"` | `"Leonard P. Freedman ,"` |

> **`"Visual Journalism teamBBC News"` is one Readability byline, not our byline glued to our
> siteName** — so the fix the trawl implied would have been a fix to the wrong thing. Established by
> probing live BBC articles, since the trawl's own page is not committed and could not be located.
> BBC sets a contributor's **name and their role in adjacent spans with no whitespace between them**,
> inside `Byline-styles__ContributorsContainerStyled`; that container's `textContent` reads
> `"James GallagherHealth and science correspondent"` on a page serving right now. Meanwhile BBC
> hands us `siteName: "BBC News"` **separately and correctly**, and a team-authored BBC piece today
> simply gets `byline: "BBC News"` — a different string. Across 50 current BBC articles not one byline
> was run together (the one flagged was `"Phil McNulty"`, a false positive on the case-change test,
> which is the whole argument against a case-change rule). **So no separator is inserted anywhere.**
> If this is worth fixing it is a markup recogniser in stage 2 — *rule on markup* — and it belongs to
> stage C.
>
> **Not reproduced:** the exact `"Visual Journalism teamBBC News"` string. The trawl's raw HTML for it
> is not in the repo and searching did not find the page. The mechanism above is measured; that
> specific string is inferred from it.

**And the collapse itself was wrong for half the world's scripts.** `/\s+/gu → " "` is right for a
script that separates its words with spaces and wrong for one that does not: a Japanese publisher who
sets a contributor's name and their role on two source lines hands Readability a newline between two
ideographs, and flattening it yields `"田中太郎 記者"` — a word gap the page never showed anybody, in
a name. `tidyMetaText` now follows the **CSS Text 3 segment-break rule**, which is what a browser does
with the same bytes: a line break between two CJK characters collapses to nothing, a break with Latin
on either side keeps its space, and a space the publisher actually typed stays a space. Han,
Hiragana, Katakana, Hangul, CJK punctuation and the fullwidth forms — not "everything non-Latin". RTL
text and bidi controls are deliberately untouched, because Arabic and Hebrew space their words; Sol
checked that half in the same review and it was already right. Tested in
`tests/extract-byline.test.ts`.

The function's scope is now stated where it lives, too: **it is for a single-line metadata field and
nothing else.** It flattens every line break it finds, which is what a library card wants and what
prose never does — and the generic name was an invitation to reach for it from the wrong place.

**4. Source-id provenance — built, and the coverage is better than 260827ab's floor because there is
a fallback.** `readArticleWithProvenance` stamps every source element, hands Readability the identity
`serializer`, and keeps the stamped source alive by giving Readability a re-parsed copy of it —
Readability mutates what it is given, so the source could not otherwise be looked up in.
`sourceRefOf` resolves a node to `direct`, `descendant`, `ancestor` or `none`, and the *how* is
always reported.

**Stamping is inert on all 35 fixtures** — and *inert* now means what the word says. The check takes
the stamped run's **serialised HTML**, removes the one attribute the instrument adds
(`withoutSourceRefs`), and compares it byte-for-byte against what the shipping `readArticle` returns
for the same bytes. 0 mismatches over the whole corpus. That has to be checked because Readability
weights `class` and `id` when it scores a node.

> **It said `yes` for a week without meaning it.** The first version compared whitespace-normalised
> `textContent`, which cannot see a wrapper element, an attribute, a reordering or a space — and GPT
> Sol demonstrated that by prepending `"\n\n"` to the extracted HTML in the implementation and
> watching both the column and `tests/extract-provenance.test.ts` pass anyway. The test named itself
> "byte-identical" while doing nothing of the kind, which is
> [silent-success.md](../reusable/silent-success.md) inside the gate written to prevent it. Both the
> column and the test have now been watched go red against that exact mutation, and the test runs on
> a `<table>`/`<font>` page as well as a well-behaved one, so the rebuild path is covered too.
>
> **The second gate had the same disease.** "The stamped source survived the parse" compared the
> source document with itself — two numbers read off one object, written by one loop, true whatever
> happened. `readArticleWithProvenance` now returns `sourceHtml`, the bytes taken at the moment
> Readability is handed its *copy*, and both the eval and the test compare the document against that.
> Watched red against the mutation it exists for: delete the re-parse and give Readability the stamped
> document itself.

Over 35 fixtures and 83,091 output elements: **98.7% direct, 100.0% mapped, 2 unmapped.** Per-fixture
(`npx tsx evals/extraction/provenance.mts`), the rows that matter:

| fixture | output els | direct | mapped | distinct ids | worst fan-out |
|---|---:|---:|---:|---:|---:|
| **pg-greatwork** | 404 | **42.6%** | 100.0% | **172** | **217** |
| pmc-article | 5 | 40.0% | 100.0% | 2 | 3 |
| medium-about | 16 | 62.5% | 100.0% | 10 | 4 |
| blogger-bldgblog | 923 | 71.6% | 100.0% | 661 | 29 |
| npr-ozy-style-feature | 700 | 91.9% | 100.0% | 643 | 3 |
| python-docs-itertools | 4,726 | 100.0% | 100.0% | 4,725 | 2 |
| rfc9110 | 13,652 | 98.9% | 100.0% | 13,504 | 2 |
| distill-momentum | 18,629 | 99.8% | 100.0% | 18,596 | 3 |

260827ab's **40.9%** on Paul Graham reproduces at **42.6%** on our capture, which is the honest
corroboration. **The last two columns are why `mapped` is not the headline.** A 100% mapped rate
would have been read as 100% provenance; on pg-greatwork 217 of 404 output nodes resolve to *one*
source element, and the 404 nodes hold only 172 distinct ids between them. There the fallback is
answering "somewhere inside this", and the text matcher is the better instrument — run both and
report where they disagree, exactly as 260827ab said. Everywhere else the fan-out is 2 or 3, i.e. a
generated wrapper and the element it wraps, which is the benign case.

Two narrowings, both Sol's and both right. **`mapped` is a bound, not a provenance figure** — read it
as "located within", never as "came from", and read `distinct` and `fanout` beside it or don't quote
it. And **"every source element" means every element `querySelectorAll("*")` reaches**: a
`<template>`'s content lives in its own fragment and is not stamped. Left that way — Readability does
not lift `<template>` content into an article — but the claim is narrowed in `stampSourceIds` rather
than left for somebody to discover.

**One caveat that is not fixed, recorded so the numbers are not over-read.** These rows are measured
on Readability's live DOM, and what stage 2 stores is that DOM *serialised and re-parsed*. Nine
fixtures change element structure across that round trip; Sol measured pg-greatwork's `404 / 172
direct = 42.6%` becoming `401 / 169 = 42.1%` after a storage-equivalent reparse. The instrument is
answering "what did Readability drop?", which is the question it was built for; an instrument about
*stored* HTML would have to reparse first.

The attribute is registered in [`src/reserved.ts`](../../src/reserved.ts) as `sourceRef`, scrubbed
before stamping like every other member of that namespace, and **no shipping code path calls any of
this**: `runExtract` → `readArticle`, which does not stamp.

**5. The id-churn counter** — `idChurn(before, after)` in [`src/blocks.ts`](../../src/blocks.ts),
returning `before`/`after`/`carried`/`reminted`/`lost` rather than a ratio, because `carried` alone
means nothing without a denominator. It is instrumentation, not a guard: `IdsNotCarried` already
refuses a run that kept none, and this only counts, so stage D can report churn without a threshold
in it. It is what proved the `<pre>` change costs nothing.

**6. The compatibility test that tested nothing.** "Does not churn a code block's id across a
re-extraction" ran the new extraction **twice** — which is a much easier question than the one the
change actually has to survive, and it never supplied a legacy previous block whose text had been
whitespace-collapsed. Sol proved the hole: with the whitespace normalisation removed from `exactKey`
and `legacyKey` in a temporary copy, that test stayed green while a constructed legacy case re-minted
both its ids. `tests/block-text-fidelity.test.ts` now carries a real old-to-new fixture — the same
blocks, the same `html`, and a `text` flattened the way the pre-change `extractText` flattened it —
with **repeated** code, because a lone block would still carry on the folded key and so cannot tell a
working compatibility path from a broken one. Watched red against Sol's exact mutation.

**Not done, and deliberately:** table row separators (out of scope, and named above as needing a
contract of its own); anything that makes the blank zero-width row disappear from the reading view;
any migration or database write.

### B — The corpus, the golds, and a scorer that has been seen to fail

~12 new fixtures from the trawl shortlist, hashed and committed with licences, chosen against the
gaps the trawl named — government/legal, non-Latin and RTL, journal furniture, bot-wall, and the
code-whitespace bug in isolation — rather than for topic variety.

An **assertion manifest** per fixture: `mustContain`, `mustNotContain`, structure floors, exact
byline, no-giant-block, and the **negative controls the last plan was missing** — a scoreline, a
numeric table cell, an equation on its own line, a symbol-only scene break, a genuinely short
article, an author's dated update. A **synthetic corruption bank**, reported as scorer conformance
and never as extraction quality. The **WCXB holdout**, selected before results are inspected.

The scorer is a scorecard: required-content recall and exclusion precision reported separately,
per-tag structural fidelity, provenance and order as hard gates, metadata exactness, and a blinded
better/same/worse recorded as a label rather than printed and lost.
**The last of those is retracted** — the label was not blinded, it was derived from the card it was
meant to audit, and it is gone; see *The review, and what it retracts* below.

Two checks before it may be trusted, both aimed at the class that has now been wrong three times —
*a number that rewards recovery, read as a number that rewards quality*:

- **The polarity pair.** One mutation restores 1,000 characters of known article body; another adds
  1,000 characters of known navigation. The first must improve the score and the second must worsen
  it. A recovery-only measure fails this immediately.
- **The exposure count.** If an arm's precondition occurs on zero fixtures, its result is "not
  exercised", never "zero regressions" — which is exactly what made 260827ab's first fourteen-page
  accordion answer meaningless.

Plus mutation testing: disable each metric in turn and confirm some corruption goes green. A metric
whose removal reddens nothing is not load-bearing and gets deleted.

Done when: every known-broken state has been **watched scoring badly**, and the holdout is locked
with a custodian. Note honestly that the states depending on operations that do not exist yet cannot
be tested here, and say which those are rather than claiming the set is complete.

#### What landed — **B shipped after nine reviews, with three defects recorded rather than fixed**

**Read this before the rest of § B, because nine reviews are not nine clean bills of health.** Every
one of the nine returned **FIX FIRST**. Eight found a badly degraded extraction that scored well; the
ninth found the opposite, a correct extraction the order gate condemns. What shipped is the state
after the eighth was fixed, with the ninth's finding **recorded as a limit**, on Greg's decision.

**What shipped, verified on 2026-09-06:** the fifteen manifests and the thirteen arms; the four
metrics plus `articleRecall` and `regionPrecision`; the two hard gates with the text-run alignment;
the corpus runner gating on four claims and exiting non-zero; the corruption bank; the WCXB holdout
selection. Five extraction suites **197/197**, `npm test` **12,426 passed / 0 failed**, typecheck over
**1,313 files**, the corpus run **exit 0** with every degenerate arm losing on every fixture it is
exercised on.

**What did not ship, and is written up below rather than hidden:**

1. **The order gate condemns two correct shapes** — partial flattening, and a container repeating a
   phrase its child says. No fixture produces either, which is why all fifteen are green. *This is the
   one defect whose direction is a false red, and stage C should suspect it before its own extractor.*
2. **4,162 characters of genuine article text on `pg-greatwork` earn no recall credit**, so
   `articleRecall` is a bounded lower measure and not exact cross-extractor recall.
3. **The shape corpus does not exist.** The fifteen fixtures cannot exercise most of what the gates
   do; every blocker from the fourth review on needed a hand-built page, and those were written by
   whoever was fixing the bug. It is an early stage C precondition, not coverage this stage has.

The nine rounds are recorded below in order, each with what it retracted, because the retractions are
the part worth reading: the same class of error — *a number that is true about a set too small to
support the claim made from it* — recurs in almost every one.

#### What landed, 2026-09-05 — **B was called done, GPT Sol took it apart, and it was rebuilt**

The scorer, the manifests, the corruption bank and the holdout selection are in `evals/extraction/`;
the tests that make any of it quotable are `tests/extraction-scorer.test.ts`,
`tests/extraction-manifests.test.ts`, `tests/extraction-visible-text.test.ts` and
`tests/extraction-wcxb.test.ts`. `npm run typecheck` green.

**The polarity pair was built first and watched failing twice**, which is the only reason the rest is
allowed to mean anything.

1. **A recovery-only card.** With `exclusionPrecision` and `bodyPurity` taken out of `score()`, the
   harness failed with *"no metric fell when navigation was added — the card is RECOVERY-ONLY, which
   is the failure this whole stage exists to prevent."* That is the three historic bugs, reproduced
   inside the new instrument before it had an opinion.
2. **`blockCleanliness` written the obvious way.** `1 - offending / totalBlocks` **rose** when thirty
   navigation items were glued into the article: the denominator grew and the numerator did not. The
   pair named it by metric. It is a fixed budget now, not a ratio.

There is a third, and it is the one worth carrying forward: **the first attempt at watching (2) fail
passed, because the polarity page had no offending block to dilute.** Zero over anything is zero, so
the metric was flat in both directions and the check sailed through. A check that passes because its
input cannot defeat it is 260830at's 246/246 one level up — in the apparatus rather than the corpus.

**What changed the design, beyond what § B asked for:**

- **`bodyPurity` cannot exist on a page off the web**, and pretending otherwise was the temptation.
  There is no denominator for "what fraction of this output is the article" unless somebody has
  written the article down. So the scorer has two tiers — `gold` (a synthetic corruption, the
  hand-built control page, a WCXB record) and `manifest` (named strings, and nothing else) — and
  every metric carries an `exercised` count. **This is also why mutation testing has to run on both
  tiers**: run on the gold tier alone it called `exclusionPrecision` and `blockCleanliness`
  passengers, because `bodyPurity` catches everything they catch. Deleting them on that basis would
  have removed the corpus's entire defence against furniture on every real page.
- **"Drop the second half" is not a body-only mutation.** On `plos-biology` and `quanta` the
  furniture is at the *end*, so truncating improves `exclusionPrecision`; on `gutenberg-pride` the
  second half contains a block over `maxBlockChars`. All three reported a metric moving the wrong way
  for reasons that had nothing to do with the scorer. The harness now *chooses* a contiguous run that
  contains a `mustContain` needle and no `mustNotContain` needle, and says so when no such run exists.
- **The corruption bank needs a page built for it.** Run against `negative_controls.html`, five of the
  twelve came back NOT NOTICED — four had nothing to damage (no `<h3>`, no `<pre>`, no `<img>`) and one
  had nothing watching (that manifest sets `noPunctuationOnlyBlocks: false` *on purpose*, because a
  scene break is punctuation-only article content). "Nothing to damage" and "nothing watching" are
  opposite findings that look identical in a table. `conformance-page.mts` is now shared by the runner
  and the test, and the test asserts every metric is exercised and every corruption is non-inert on it
  before asserting anything else.

##### The review, and what it retracts

GPT Sol's review of the above returned **FIX FIRST**, and its first sentence is the finding:

> The central question has a decisive answer: **yes, this scorecard can be fooled while badly
> damaging an article.**

He built a `needle-collage` arm against `aaronson`: return the manifest's three `mustContain` strings
and nothing else. **182 characters against the shipped 32,918 — 0.55% of the article retained — every
exercised metric 1.00, both gates green, `assertionsPassed: true`, and the runner wrote `acceptable`
into the manifest.** Reproduced here before anything was changed. Duplicating a paragraph on the
conformance page was equally invisible.

Five claims § B made are hereby retracted, in the order it made them.

1. **"a blinded better/same/worse recorded as a label" — retracted; the labels are deleted.** They
   were not blinded. `labelFor` computed them from the very card they were meant to audit, which is
   circular, and `--record` then wrote the word `acceptable` into twelve manifests where it has since
   been removed. The manifest tier knows whether the strings somebody wrote down are still there; it
   does not know whether an article survived, and it now says only the first. What `--record` stores
   is an `ArmFinding` — assertions held or not, gates passed or not, which metrics fell against the
   shipped arm, and how many characters of article came back — and none of those four can be misread
   as "this extraction is fine". **The floor-masking exception went with it**, and Sol's finding 8 is
   why: it was written for a case that by the 2026-09-05 run no longer reproduced (`wiki-gdp-table`'s
   shipped exclusion is 0.67, not 0.00) and it was still there. Accumulating exceptions to a label
   that cannot be made sound is worse than not having the label.
2. **"provenance and order as hard gates" — they were neither hard nor, on two thirds of the corpus,
   true.** `gatesFor` ignored every block under 60 characters, so the navigation corruption's 393
   characters of invented text across 30 short blocks passed attribution untouched. Source order took
   each block's position with its own `source.indexOf`, so a duplicated paragraph got the same
   position twice, was non-decreasing, and passed. And **attribution was already failing on 8 of the
   12 shipped extractions** — over element-boundary whitespace, not damage — which a `labelFor` that
   ignored the gates entirely reported as `acceptable`, and which meant the gate could not have
   noticed further damage either.
3. **The manifest floors flattered the pipeline.** `ar5iv-attention` declared 7 tables and 110 math
   nodes where the source has 9 and 142 and the shipped output has exactly 7 and 116, so structure
   scored 1.00 with two substantive results tables missing. `shakespeare-hamlet` required 12,000
   gistable characters from a source that has about 9,400 — impossible to satisfy, on any arm.
   `wiki-gdp-table` called `"United States"` a `numeric-cell`; it is neither numeric nor
   table-specific, and it passes through a narrative paragraph while the GDP table is destroyed. And
   `CONFORMANCE_GOLD` claimed `whole-document` while omitting the headings, the table, the code and
   the figure caption, so the clean page's `bodyPurity` was 0.931 and **deleting the omitted material
   improved it**.
4. **"every known-broken state has been watched scoring badly" — three of the controls could not go
   red.** The test named *"REFUSES a recovery-only card"* never called `polarityPair` with the
   recovery-only scorer; it checked that the remaining metrics were flat and stopped, so
   `polarityPair` could have stopped refusing and the test would have stayed green. The
   "1,000 characters of navigation" is **393 characters of text**, and the assertion reached a
   thousand by measuring the markup while every metric measures text. And the pair passes as soon as
   *some* metric moves each way, so metadata — never perturbed by anything in the harness — and both
   gates had no individual polarity proof anywhere.
5. **The `WCEB` naming claim was unsupported.** Fetched on 2026-09-05, the repository README, its
   BibTeX key and the Zenodo record title all say **WCXB** and the string `WCEB` appears in none of
   them. Two of the three artefacts the note named are checked and false; the third is inside the
   uncommitted archive and nobody here can open it. The claim is dropped rather than narrowed to the
   one artefact that cannot be inspected. Cite the DOI.

Two smaller ones, both real. `parseManifest` accepted `mustContian`, `maxBlockChar` and a needle field
`negativeContorl` in silence, each leaving a manifest that looks like an assertion and tests nothing;
unknown keys are refused recursively now and floors must be finite non-negative whole numbers. And the
tag-strip that replaced JSDOM in the manifest integrity check was **corpus-compatible rather than
parser-correct**: Sol found it leaking attribute values through `<p title="x > y">`, mishandling
`&trade;`, semicolonless entities, CDATA, `<textarea>` and `</script >`. Rebuilt as a small scanner in
[`visible-text.mts`](../../evals/extraction/visible-text.mts) with a JSDOM reference implementation and
an adversarial table in `tests/extraction-visible-text.test.ts`; the **27 cases the regex chain got
wrong** are pinned there so they cannot come back, and one of them made it throw a `RangeError` rather
than answer. 20 ms a fixture; the JSDOM version took 44 seconds and timed out.

##### What the repair is

- **The two adversaries are arms now.** `needle-collage` and `duplicate-paragraph` join the five
  degenerate arms, and the test that makes each arm lose is **per fixture** rather than
  "somewhere" — which is what Sol's finding demanded, because the collage passed the old form by
  losing a structural floor on the one page of three that declared any. Both were watched going from
  passing to failing.
- **The gates are about identity rather than text.** ~~And they are decisive.~~ **That word is
  retracted** — see *The second review* below: the gates are decisive about **invention, reordering
  and duplication**, and they are silent about *selection*, because an arm that returns genuine
  stamped elements of the page has perfect provenance whatever it chose to return. Every arm is a DOM
  transform of one **stamped** source document (`readArticleWithProvenance`, which stage A shipped),
  so each returns its output twice: the HTML every metric reads, and the same HTML with
  `data-spya-src` still on it. Attribution asks whether each output node that carries text resolves to
  a source element at all — a fabricated node resolves to nothing, which is the collage — and whether
  a directly stamped node still says **what that source element said**, which is prose rewritten in
  place. Order asks whether those nodes arrive in source order and whether any source element says the
  same thing twice. The text form survives for candidates with no stamps, and says so in capitals when
  it is what you are reading.

  **The unit took three tries and each wrong answer was found by measurement, not by thought.** Judged
  over *every* element, four correct extractions failed, because a container's `textContent` is the
  union of its children's and Readability moves children between containers. Judging **leaves** — an
  element with no element children — stopped that and opened the opposite hole: on
  `shakespeare-hamlet` **not one leaf carries forty characters**, since every speech is an `<li>` holding its prose beside a `<strong>` speaker and a
  `<span>` line number — the play belonged to no leaf and was judged by nothing. The unit is an
  element's **own text** now, which nothing can move into it and which every word of the article
  belongs to exactly once. Likewise the order rule was *strictly* increasing until `gutenberg-pride`
  showed that **splitting is not duplicating**: Readability breaks that page's title `<i>` around its
  `<br>`s into two nodes that both inherit source id `s145`, saying two different halves of what it
  said. Non-decreasing, plus "no source element may say the same thing twice", tells the two apart —
  and both halves are asserted, so neither can be fixed by breaking the other.

- **The strong gates were then attacked on a real page, and the attacks are tests.** A collage of
  **real stamped elements** rather than fabricated ones (provenance spotless; caught here by the
  structural floors and `minArticleChars` — but that collage kept only needles on a *small* page, and
  on `aaronson` the same shape defeated both, which is *The second review* below); prose
  **rewritten in place** inside a node that kept its identity, which is what a model repair pass does
  and which no text measure here can see; two stamped nodes **swapped**; and one **said twice** beside
  one the extractor **split**. All five are in `tests/extraction-scorer.test.ts` § *the provenance
  gates, attacked on a real page*. Building them is what found the leaves-only hole above: the swap
  and the rewrite were **no-ops on `shakespeare-hamlet`** because the probe could find no leaf to act
  on, and an arm that changes nothing looks exactly like an arm nothing caught.
- **Scoring "this is not an article" could not wait, and did not.** A manifest may now say
  `notAnArticle`, a candidate carries `refused`, and `medium-about` and `pmc-article` — committed
  with no manifest at all because the assertion was unsayable — are scored. Both **fail today**, in
  those words: *"this page is not an article and the extractor did not refuse it — it returned 185
  characters as though they were one"*. Deciding what production does about a bot wall is still
  stage C's and still Greg's; scoring it is done.
- **A corruption that invents short text** (`invent-short-text`: thirty nonsense labels of about
  thirteen characters) joins the bank, and it is the witness for the attribution gate. Watched red
  by putting the 60-character floor back.
- **The controls are executable.** `polarityPair` takes the scorer as a parameter, the recovery-only
  test hands it the recovery-only card and asserts the refusal by its words, and it was watched red
  by making `polarityPair` stop refusing. Every metric has its own named two-sided witness and no
  corruption in the bank may move any metric **up**; both gates have their own named witness. The
  nav payload's three numbers — 393 characters of label, 422 space-separated, 1,211 bytes of markup —
  are assertions rather than a sentence, and the 1,370 the fixtures README quotes belongs to the real
  page Sol reproduced against, not to our reconstruction of it.

##### Where it stands

**Fifteen fixtures carry manifests** — the twelve, plus `medium-about` and `pmc-article`, which had
none because the assertion was unsayable, plus `pg-greatwork`, added by the third review because a
generated-node-heavy page was the gap the corpus had. All thirteen corruptions are noticed, each by a route the
bank claims. All six metrics are load-bearing **on the metric routes**, each with a named witness, and
each now has its own two-sided witness rather than riding on a neighbour's; both gates have theirs.
~~All seven degenerate arms lose on a named metric or gate **on every fixture they are exercised
on**, with one recorded exemption.~~ **Retracted:** the assertion ran over three fixtures of
fourteen, and over the other eleven it was false. See *The second review* for what replaced it —
eight arms — twelve as of the fourth review — enforced over six fixtures in the fast test and over all
fifteen by the run, which
exits non-zero.

**How many shipped extractions pass both gates is not written here. It is read from the run** —
`evals/results/extraction-score.json`, printed by `tests/extraction-manifests.test.ts` §
*"says how many shipped extractions pass each gate"*.

~~Both gates pass on fourteen of the fifteen shipped extractions, and the fifteenth abstains on one
of them — `pmc-article`, which has nothing for the order gate to put in order.~~
~~Both gates pass on all fifteen.~~ ~~All fourteen.~~ **All three of those were written by hand, and
all three were wrong by the time somebody read them.** The committed run has `pmc-article`'s source
order **green at exposure 4**, and all fifteen passing. The number moved with every change to what
the order gate counts — the container rule, the text-run walk, the subtree retry — and a sentence in
this file went stale each time; I stated one of the wrong versions to Greg myself.

**The lesson is the general one and it is why the sentence above is a pointer rather than a number: a
hand-maintained tally of a computed fact failed here three times.** The number belongs in the run.

What is worth keeping from the old paragraph is the distinction it drew, which § B originally lost: a
gate that is already **false** on the page you are testing tells you nothing about the arm you are
testing, and neither does one that **never ran**. Both are reported and they are not the same. The
gates were false on 8 of 12 before the rewrite, over element-boundary whitespace and note
canonicalisation; every false red of that kind is gone and the collage still fails.

**Eleven of the fifteen manifests fail on the shipped arm; four pass** (`shakespeare-hamlet`,
`python-docs-itertools`, `negative-controls`, `pg-greatwork`). Every one of the eleven names something a reader has
lost, and correcting the floors from source truth turned up damage nobody had seen:

- **`quanta-year-physics` loses a whole section** — "Astronomical Discoveries", heading and body, with
  "Next article" standing in its place. The heading *count* is unchanged, which is why no floor could
  ever have caught it and why the corrected manifest names the section by its text.
- **`constitution` loses the Acknowledgements section**, `mdn-cache-control` the header-summary table
  (Header type / Forbidden request header / CORS-safelisted response header), `gutenberg-pride` three
  Hugh Thomson plates out of 164 on a page where every image is an illustration.
- **`wiki-gdp-table` scores 0.33 on recall**, because the manifest now asks for two actual numeric
  cells from the GDP table instead of `"United States"`, which occurs four times in ordinary prose and
  was satisfied while the table it was written for was destroyed.
- **`aaronson` fails now and passed before**, because nothing had been written down about what it
  keeps: the WordPress trackback line and the blog's standing comment policy both arrive as article
  prose. It cost the fixture its rising polarity half — the declared furniture contaminates every
  thousand-character run — and the fixture could not establish the falling half anyway, having no
  `<nav>`, `<header>` or `<footer>`.
- **`ar5iv-attention` fails on 9 tables and 142 math nodes**, which is what the source has; the floors
  said 7 and 110, which is what the pipeline produces, and the two missing tables are Table 1 (per-layer
  complexity) and Table 2 (BLEU and training cost).

**8 of 14 fixtures move the card in both directions and 6 cannot**, each printing
`POLARITY NOT ESTABLISHED` with its reason: two are the bot-wall pages, which have no article to take
away and put back; `arxiv-abs` and `plos-biology` still have no thousand-character run that is known
body and nothing else; `shakespeare-hamlet` still has no furniture to admit; and `aaronson` has
changed which half it fails, for the reason above.

Four floors GPT Sol's finding pointed at were re-derived and their **numbers kept**, because a raw
source count would have been wrong (`mdn`'s was tightened from `atLeast` to `exactly`, so an arm that
admits the in-page ToC now fails too): `mdn`'s `h2 ≥ 7` (the other two source headings are the in-page ToC this
fixture exists to punish, and "Help improve MDN"), `constitution`'s `h3 ≥ 24` (the other nine are
footer-nav columns), `wiki-gdp`'s `table ≥ 3` (four of the eight are navboxes and one is the map
wrapper), and `python-docs`'s `pre 29` / `table 3`. Each manifest's `note` now records the count
element by element, so the next person can check the reasoning rather than the number.

**The holdout: WCXB is real, and one of the claims about it was wrong.**
DOI `10.5281/zenodo.19316874`, CC-BY-4.0 confirmed in both the Zenodo metadata and the repo's own
LICENSE, 2,008 pages counted by hand, gzipped HTML per record, 84,289,810 bytes downloaded. Three
corrections: the schema is **nested under `ground_truth`**, not flat; Readability's dev F1 is **0.675,
not 0.674**; and **the `WCEB` claim was wrong and is withdrawn** — fetched 2026-09-05, the repo
README, its BibTeX key and the Zenodo record title all say WCXB and `WCEB` appears in none of them,
so the name is dropped rather than tied to the one artefact (`metadata.json`, inside the uncommitted
archive) that nobody here can open. Cite the DOI. Only about half of it is labelled `article`, its
ground truth was **drafted by Claude and then human-reviewed** (so a correlated blind spot with our
own pipeline is possible), and its baseline table is one author's self-report with raw per-page
results shipped for one system only.

**0.675 does not reconcile with 260827ab's 0.825 and does not need to**: they are different
quantities over different pages — text retention on three hand-picked fixtures versus boilerplate-
removal F1 over 1,497 mixed pages. Quoting one as a check on the other would be this plan's own
error in a new costume.

The selection is made and recorded: **200 pages, seed `spideryarn-260904e-stageB`, from the `test`
split**, articles only, in `evals/results/wcxb-holdout-selection.json`. The overlap
filters found nothing to remove, and the reason matters — counted per split, **every one of the nine
overlapping hosts and the one exact URL match is in `dev` and none is in `test`**. Nothing has been
scored against it, which is the point: selection is stage B, scoring comes after thresholds are
frozen. `selectHoldout` **verifies** the split rather than labelling it — `readSplit` stamps each record
with the directory it came out of and the selector refuses anything that disagrees — and `selectedOn` is
an argument rather than a clock reading, so the committed selection is reproducible on a day that is not
the day it was made. Both of those were Sol's, and `tests/extraction-wcxb.test.ts` is the test file the
dataset did not have. **The 84 MB archive is not committed**; the selection is.

**Two lines of the committed selection have drifted** and cannot be regenerated without the archive:
its `dataset` block still carries `"alsoKnownAs": "WCEB"`, which the code no longer emits, and its
`custodian` string still reads as though the ceremony were the mechanism. The chosen 200 — seed,
split, ids, rank order, `selectedOn` — are unchanged, and `tests/extraction-wcxb.test.ts` pins both
stale strings by name so any *other* drift goes red. Regenerate the file the next time somebody has
the archive; do not hand-edit it into agreement.

**And its gold is plain text**, so it scores **text selection only** — nothing about tables,
headings, code or order. That sentence travels with any number quoted from it.

##### The second review, and what it retracts

The repair above went back to GPT Sol the same afternoon and came back **FIX FIRST** again, with the
same shape of finding: an arm that scores clean while destroying an article. This time it was built
out of nothing but genuine page.

On `aaronson` he assembled the three required passages trimmed to their exact source text, five real
figures, two real comment-thread blockquotes for the structural floor, and then **padding made of
later comment paragraphs** until it cleared `minArticleChars: 30000`:

- genuine post text retained: **178 characters, 0.542%**
- output: **30,052 characters, almost entirely the comment thread**
- every exercised metric **1.00**, both gates **passed** (91 nodes each), every assertion **held**,
  `detects(shipped, arm)` **false**

Nothing was wrong with the gates. **Provenance proves that text came from somewhere on the page, and
this page is 5,560 words of post under 52,776 words of comment thread.** Every length measure counted
gistable characters of *output*, so anything lying around on the page could fill one. All six of his
reproductions were re-run against the unrepaired tree before anything was changed, and all six passed
exactly as reported.

Run from the other direction, the same hole measures as a **deletion budget**: an informed deleter
that keeps every `mustContain` needle and every structural element, has perfect provenance and
perfect order, and simply removes prose longest-first.

| fixture | removable unseen | of | share | what stopped it in the end |
|---|---|---|---|---|
| `mdn-cache-control` | 1,981 | 19,083 | **10.4%** | `minArticleChars` |
| `plos-biology` | 2,051 | 27,719 | **7.4%** | `minArticleChars` |
| `aaronson` | 2,300 | 32,820 | **7.0%** | `minArticleChars` |
| `python-docs-itertools` | 0 | 38,330 | 0.0% | `structureFidelity` — `pre` 26 against 29 |
| `shakespeare-hamlet` | 0 | 8,833 | 0.0% | `structureFidelity` — `li` 44 against exactly 45 |
| `quanta-year-physics` | 0 | 8,353 | 0.0% | `minArticleChars`, on the first paragraph |
| `negative-controls` | 0 | 4,507 | 0.0% | `minArticleChars`, on the first paragraph |

On three of the seven pages it could run on, **nothing but the length floor stood between a clean
card and silent deletion** — and the padding arm shows that length floor could be filled with
whatever the page had lying about. The two findings compose: delete the article, pad with the
comments, pass everything. The pages that held were held by a structural floor or by a length floor
that happened to sit close to what the extraction returns, which is luck rather than instrument.

**Five statements § B made are retracted, and each is struck through above where it was made.**

1. **"The gates are decisive."** ~~They are decisive about invention, reordering and duplication.~~
   **Narrowed again, 2026-09-06, GPT Sol's seventh review**: about **invention**, about **reordering
   of any text run the output carries**, and about **duplication by a directly stamped node**.
   Duplication by a node Readability *generated* is deliberately not checked — a correct
   `pg-greatwork` extraction emits 28 generated nodes whose own text is `"["` — and until the seventh
   review the text of a generated *wrapper* was outside the order rule altogether, so reordering it
   was unobserved rather than allowed. They
   are silent about **selection** — which parts of the page an arm chose to return — because an arm
   made of genuine stamped elements has perfect provenance whatever it chose. Selection is what the
   article region measures.
2. **"A real stamped collage is caught by structure and `minArticleChars`."** True of the collage in
   the test, which keeps only needles on a small page and so fails its structure floor. False of the
   same shape on `aaronson`, where the arm satisfied both by taking real figures and real blockquotes
   from the comment thread.
3. **"Rewritten prose inside a stamped node is generally caught."** Only rewriting that invents
   words. `coverOf` looked for each run *anywhere* in the source element and never advanced a
   source-side cursor, so swapping the two halves of one 459-character paragraph passed everything.
4. **"Every degenerate arm loses on every exercised fixture."** The assertion ran over three fixtures
   of fourteen. Over all fourteen it was false: `drop-every-short-block` removed **1,072 leaf
   elements and 1,393 gistable characters** from `ar5iv-attention` with no metric and no gate moving,
   and `aaronson`'s `first-20-percent` and short-block arms were flat too.
5. **"Both gates pass on all fourteen shipped extractions."** Thirteen pass both; `pmc-article`'s
   order gate abstains for want of a second stamped node. And `ArmFinding.gatesPassed` was documented
   as *"both hard gates passed"* while `findingFor` discarded the abstentions, so it would have
   recorded `true` for a page where only one gate had been asked.

##### What the second repair is

- **A manifest says which part of the page is the article.** `articleRegion` — `within` selectors,
  optional `except` selectors, and a required `why`, matched against the *prepared* source document.
  Twelve of the fourteen have one; the two bot-wall pages must not, and the parser refuses both
  mistakes. The reasoning was already written in prose in several manifest `note`s from the DOM walks
  of that morning; this promotes it to a field the code reads.
- **Both length measures count the region, by stamp.** `articleChars` is now *"characters of the
  declared article region this output gave back"*, and it **abstains** — `—`, never a number, never a
  silent fall back to the old measure — where the region or the provenance is missing. An unresolvable
  `minArticleChars` is recorded as a **failure**, because an assertion that could not be checked is
  not an assertion that held. **Every floor was re-derived against the new measure**; copying the old
  numbers across is exactly the mistake the ar5iv floors made. Each manifest's `note` now records
  three measured numbers — the region's own characters, the whole source body's, and what the shipped
  extraction returns of the region — so the region can be argued with.
- **`articleRecall` is a metric**, with an exposure count like the others: what fraction of the
  region's own text came back. It is what the informed deleter now runs into on the **first**
  paragraph, on every fixture with a region, and it is the measure stage C needs to compare
  Readability against a second extractor at all.
- **`coverOf` advances a source-side cursor**, so a cover is a subsequence *in order* rather than a
  bag of runs found anywhere. Removal is untouched by that, because a removal does not reorder
  anything, and all twelve article fixtures still pass both gates — each judging **more** nodes than
  before, not fewer.

  **And one of the four cases this file keeps citing turns out not to be exercised, which is worth
  writing down rather than repeating.** Asked directly, on 2026-09-05: of the four correct
  extractions the strict form used to fail, only `gutenberg-pride`'s split title is live in the
  strong form today — `s145` really does arrive as two output nodes, *"by Jane Austen,"* and
  *"George Saintsbury … Hugh Thomson"*, and both are green. On `ar5iv-attention`, `arxiv-abs`,
  `wiki-gdp-table` and `gutenberg-pride` alike, **zero** directly stamped nodes survive *only*
  because the cover is a subsequence, and `From: Llion Jones [` is not in the shipped arXiv output at
  all. The reason is the unit: the strong form compares an element's **own** text against its own
  source element's, and a removed inline child's words were never part of either. So the subsequence
  property is load-bearing for the *weak* whole-page form — where a block is several elements' text
  joined — and for nodes Readability generated, and not for the strong form on these four pages. The
  cursor could not have broken what it was not being asked.
- **Two output nodes sharing one stamp have to walk forward through that element's own text**, which
  is what catches right-before-left under a single id while still allowing the split.
- **Anything with a character in it is judged.** `HAS_CONTENT` was *"a letter or a digit"*, so a
  fabricated `<p>☠☠☠</p>` passed attribution — on the one page whose whole point is that `❦` is real
  article content. Decided deliberately and measured rather than argued: across all twelve article
  fixtures both gates stay green and each judges **more** nodes than before (`ar5iv-attention`
  1,187 → 1,528, `python-docs-itertools` 2,539 → 3,985).
- **`needle-collage` hands over its output for provenance inspection**, and its answer is *nowhere*.
  The comment claiming the attribution gate caught it was false — the arm supplied no `stampedHtml`,
  so the weak text form ran and found the copied strings, and `aaronson`, `arxiv-abs` and
  `constitution` all read `ok/ok` on it. It fails attribution on every fixture now, and a test says so.
- **`ArmFinding` records each gate separately**, plus `articleChars`, `gistableChars` and
  `articleRecall`. One boolean could not honestly summarise two questions when either may abstain.
- **The fourteen-fixture claim is enforced by the thing that has fourteen fixtures.** `HARMLESS_HERE`
  moved into `arms.mts` so the fast test and the corpus run share it; the run checks every exercised
  pair and **exits non-zero**. Its first enforcing run listed eight flat pairs. Seven were the two
  bot-wall pages, where there is no article for an arm to damage and the one exercised metric is
  already on its floor — so the claim is narrowed once, in the runner, to *fixtures with an article*,
  rather than by writing seven near-identical exemptions. The eighth is real and is now an argued
  exemption: **`first-20-percent` on `aaronson` comes out ahead**, because Readability returns the
  post followed by the trackback line and the comment policy, so the first fifth is still the whole
  post — `articleChars` is 26,642 for both arms, identical, and the 811 characters it drops are the
  two strings the manifest names in `mustNotContain`, so exclusion *rises* from 0.33 to 0.67.

Every one of those was watched red before it was watched green, and by name: the source cursor
against the half-swapped paragraph, the per-id cursor against right-before-left, `HAS_CONTENT`
against `☠☠☠`, the region measure against the three tests that prove `articleRecall`, and
`needle-collage`'s provenance against the attribution assertion. Each was broken again afterwards to
confirm the test that guards it fails, and put back.

##### Where the second repair leaves it

**The deletion budget is 0.0% on every fixture with an article region**, down from 7.0% and 10.4% on
two of the three measured: the informed deleter's *first* paragraph is caught by `articleRecall`. The
one exception is `arxiv-abs`, where 350 characters go unseen — and they are arXivLabs blurbs and
submission history, outside the declared region, so removing them is the extractor doing better
rather than worse. **Measured on the fourteen committed fixtures and nowhere else**; it is a budget
for this corpus, not a bound on the ruler.

**Re-measured after the third repair, on all fifteen: still 0.0%**, and `arxiv-abs`'s 350 characters
are gone too — the deleter now finds nothing on that page it can take unseen. `pg-greatwork` is 0.0%
from its first paragraph as well, which it could not have been before, since two thirds of its
article lived in nodes the numerator did not count.

**Two budgets, and they are different numbers.** The 0.0% above is the *comparison* budget — an
arm scored against the shipped one, which is what `detects` and the `--record` findings do, and where
one deleted paragraph moves `articleRecall` and is caught. The *assertion* budget is looser, because
`minArticleChars` is an absolute floor with slack in it: an arm could delete **2.3% to 16.2%** of the
region, depending on the fixture, and still satisfy every declared assertion. `ar5iv-attention` is
the loose end at 16.2%, and deliberately — its floor is set below the paper-minus-bibliography, since
dropping a reference list is a defensible extraction. Anyone quoting `assertionsPassed` on its own is
quoting the looser of the two.

Attacked from a third direction and not broken: an arm that credits itself for the article by putting
region stamps on invented text. `articleReturned` runs the same cover the gate runs and pays nothing
for a node its source element does not support, so the number does not depend on somebody having read
the gate first. It changes no measured figure on any of the twelve — every node of every shipped
extraction is covered — which is what makes it a change to what an adversary can do rather than to
what the corpus says.

Five of GPT Sol's six reproductions now fail, by name: the padding collage on `articleRecall` and
`minArticleChars` (0.022 and 0.0056 recall for his two versions); the tightened one likewise; the
half-swapped paragraph on **attribution**, which reports *"says these words but not here"* rather
than *"did not say"*, because a cover is a subsequence in order and the two reds must not be
confused; right-before-left under one stamp on **sourceOrder**; and `<p>☠☠☠</p>` on **attribution**.
The sixth — a table cell moved to the next row — still passes, and is on the honest-limits list below
rather than being built for.

**All twelve degenerate arms lose on every fixture with an article that they are exercised on**, over
all fifteen, with **two** argued exemptions. `region-padded-collage` is exercised on exactly two
fixtures, and the exposure count is the point: only `aaronson` (606,316 characters off the post) and
`python-docs-itertools` (37,270, Sphinx's sidebar rendered twice) have enough material off the
article to fill their own length floor.

##### The third review, and the measure that was recommended and rejected

The second repair went back to GPT Sol and came back **FIX FIRST** a third time, with the same shape
of finding a third time: a badly degraded extraction that scores well. Three of them, all reproduced
here against the unrepaired tree before anything was changed.

1. **Deleting the nodes Readability generated was invisible.** `articleReturned` credited only
   *directly* stamped nodes, and text that is not in the numerator cannot be taken out of it. On
   `pg-greatwork` — paulgraham.com's 55,000-character essay in one `<td>`, 599 `<br>`s, no `<p>` in
   the source at all — Readability builds every paragraph itself, and removing all 216 of the leaves
   it built deleted **53,784 of the 66,449 gistable characters**, 81% of the output, leaving
   `articleChars` at **6,330** and `articleRecall` at **0.1153**: unchanged to the digit, both gates
   green, `detects` nothing.

   And note what 0.1153 says about the metric before any attack: on that page a **correct**
   extraction scored 0.115. It was not measuring the article, it was measuring how much of it
   Readability had to build.

2. **Addition without deletion was not scored at all.** The complete `aaronson` post plus **595
   genuine, ordered, stamped comment paragraphs** — 231,371 characters against a correct 32,820 —
   every assertion holding, both gates passing over 936 nodes, `articleRecall` unchanged, `detects`
   silent. § B said the article/output pair covered this; that pair was printed beside the row and
   read by nothing.

3. **Short-run forgiveness composed.** `coverOf` forgave any unmatched run shorter than `minRun`
   that occurs somewhere in the source, with no total. An adversary that consults the cover itself —
   emit *n* correct characters, try a short displaced run, keep it only if the cover still forgives
   it — got **24.5% of the attacked text displaced** on `negative-controls` with every metric 1.00,
   `articleRecall` 1.00, both gates green, every assertion held and `detects` nothing.

   Worth recording, because the first three attempts to reproduce this **failed**: a fixed 8/7 or
   16/7 rhythm is caught, and only an oracle-guided one gets through. A hand-built adversary that
   does not consult the instrument is weaker than the instrument's own worst case, which is a general
   lesson about how these reproductions should be built.

###### The recommended fix was measured and is wrong

The brief proposed replacing the stamp accounting with text: take the declared region's gistable text
as one ordered string, take the output's as another, walk both forward with a single cursor, and
report an order-aware recall and precision. It closes all three findings by construction and it has
no per-join forgiveness to compose, so it was worth building. **It was prototyped and run against the
shipped — that is, correct — extraction of all twelve region-bearing fixtures before being adopted,
and it fails.**

| fixture | region recall of a CORRECT extraction, by anchor floor 8 / 16 / 24 / 40 |
|---|---|
| `plos-biology` | **0.007 / 0.010 / 0.035 / 0.111** |
| `quanta-year-physics` | 0.024 / 0.217 / **0.916** / 0.916 |
| `shakespeare-hamlet` | 0.168 / **0.981** / 0.981 / 0.981 |
| `arxiv-abs` | 0.031 / **0.973** / 0.973 / 0.973 |
| `gutenberg-pride` | 1.000 / 1.000 / 1.000 / 1.000 |

Two things are wrong and only one of them is tuning.

- **The single forward cursor assumes the output is in the region's order, and on a correct
  extraction it is not.** `plos-biology` is the proof: the region begins *"Abstract Low
  reproducibility rates…"*, the output begins *"Loading metrics Open Access Perspective…"*, and at
  output character 1,018 the extraction emits the DOI-and-published-date block, which lives at region
  character 18,270 while the cursor stood at 14,925. Readability hoists journal front matter. One
  cursor reads that as a total loss — everything it skipped is written off and there is no way back —
  so a correct extraction scores **0.035**. Review 3 said it had found no prepared-document movement
  problem inside a region; there is one, and it is fatal to a measure with one cursor. **The stamps
  do not have this problem at all**: a moved block still carries its id, so it is still credited.
- **The anchor floor is a free parameter and the answer swings two orders of magnitude on it.**
  0.024 to 0.916 on `quanta` between 8 and 24. A number that moves like that with a constant nobody
  can derive is a heuristic, not a measure. (The cost is fine — 87 ms for `gutenberg-pride`'s 589,148
  characters; the slow one is `plos-biology` at 588 ms, and it is slow precisely *because* it cannot
  anchor and degrades to a single-character walk over 23,154 steps.)

So the recommendation is not adopted, and the reason is written here rather than in a commit message.
The alternative keeps the stamps — which are exact, and order-free for the recall question — and
fixes the three specific holes instead.

###### What the third repair is

- **A node Readability generated is credited against its nearest stamped ancestor's own text.**
  What Readability generates is mostly `<p>`s built out of text nodes the ancestor already held, so
  the generated node's own text is a slice of the ancestor's own text — which is what the existing
  cover already asks, exactly, with no new machinery. Measured 2026-09-05: **91.4%** of
  `pg-greatwork`'s generated characters and **99.6%** of `gutenberg-pride`'s are covered that way; the
  remainder is credited nothing, so the under-count is bounded and stated rather than unbounded and
  hidden. `pg-greatwork`'s shipped card goes from **0.1153 to 0.9237** (it read 0.9242 until the
  fourth review's interval union stopped counting 27 characters of genuine overlap twice). `descendant`-resolved nodes —
  a container Readability built *around* stamped children — are still worth nothing, because the
  descendant's text is not the container's.
- **`regionPrecision` is a metric and an assertion**: the credited region characters over every
  own-text character the output carried. It is what falls when an arm adds without deleting, it is in
  compatible units with `articleRecall`, and `detects` reads it.

  It was a metric only for about an hour, and that was a real gap — `detects` saw every padded arm
  and `assertionsPassed` saw none of them, so a ten-times-padded output still satisfied every
  declared assertion. **One corpus-wide constant, `MIN_REGION_PRECISION = 0.50`**, not fifteen
  per-manifest floors: Greg's point, and the reason is the failure mode rather than the arithmetic —
  a per-page floor can be tuned until that page passes and a single number cannot. The band it sits
  in is empty and was measured on the day: the worst **correct** extraction is `arxiv-abs` at
  **0.6401** (it keeps arXiv's "View PDF | HTML" furniture, which its manifest already forbids) and
  everything else is 0.92 or better; the worst padded arm that would otherwise pass is `raw-body` on
  `arxiv-abs` at **0.2464**, and `aaronson`'s three padding arms are at 0.0925–0.0974. Watched red
  both ways: at 0 the padded card passes everything again, at 0.7 `arxiv-abs` fails. **No fixture
  needs an exception.**

  **What it is not**, corrected by the fourth review: a semantic *"most of this output is the
  article"* backstop, and explicitly **not** a separator between good and padded output. Across the
  padding-shaped arms there are **21 exercised region-precision rows, 17 clearing and 4 failing** —
  `region-padding-only` on `gutenberg-pride` clears at 0.9971 — because those pages have almost
  nothing off the article to bury it in. They are caught by `detects`, which is the relative question
  and the sharper one. And **0.6401 is the worst shipped *baseline*, not the worst correct
  extraction**: `arxiv-abs` already fails its manifest for the furniture it keeps. And the PASS→FAIL flip could not be
  watched on a real fixture at all: **no fixture whose shipped extraction passes has enough
  off-article material to cross the floor** (`python-docs-itertools` has 1,295 characters outside its
  region against 29,949 inside; `pg-greatwork` has none), so the test uses `aaronson` with its two
  furniture needles and its block cap lifted. That is a fact about the corpus and it is written into
  the test rather than glossed.
- **`coverOf` has a total forgiveness budget, and reports what it actually covered.** Two separate
  fixes for two separate halves. The budget is one join's worth (`minRun - 1`), and the whole-page
  fallback gets its own measured 48 because `ar5iv-attention`'s MathML blocks need 37. The credit is
  `cover.covered`, never the node's length, so a displacement inside the budget is not paid for
  either. Measured: the fourteen shipped extractions forgive **zero characters over zero joins** in
  the strong form, so neither change costs the corpus anything — they change what an adversary can do.
- **Three arms and a permanent test.** `drop-generated-nodes` (finding 1), `region-padding-only`
  (finding 2, exercised on six fixtures, and it inserts only into a *gap* in the stamp order so that
  the demonstration is about padding rather than about the order gate), and the oracle-guided
  displacement as a test in `tests/extraction-scorer.test.ts`. All three were watched going from
  passing to failing.
- **`pg-greatwork` is the fifteenth scorable fixture.** Sol had to declare a region by hand to run
  his reproduction; a generated-node-heavy page was the gap the corpus had. Its manifest carries a
  `p: { atLeast: 200 }` floor derived from the source — 595 `<br>` in **235 runs**, so the author
  wrote about 236 paragraphs and the source has no `<p>` — because `restore-everything` on that page
  otherwise loses nothing while handing the reader 55,000 characters in one undifferentiated `<font>`.
  That is the corpus saying a manifest was thin, and the answer was to thicken it rather than write a
  third `HARMLESS_HERE` entry. `p` joins `MANIFEST_TAGS` for that one page, and the exception is
  stated there.
- **No region may credit what its own manifest forbids**, checked over the corpus and gated. It found
  the three Sol named by hand — `ar5iv-attention`'s Google licence (`#p1`, 148 characters),
  `aaronson`'s WordPress trackback line (`p.postmetadata`, 211), `plos-biology`'s 26 repeats of
  *"View Article | PubMed/NCBI"* (`ul.reflinks`, 877) — and nothing else. Each region has an `except`
  now, and each floor was re-derived **by the rule its note already stated** rather than to make
  anything pass: `plos-biology` goes 23,000 → 22,100, which is still "the region less 5%".
- **The stale-exemption check is scoped to the fixtures the invocation selected**, so
  `--fixture aaronson` no longer fails over an `arxiv-abs` exemption. An exemption belonging to a
  *selected* fixture still fails when it goes unexercised or stops being harmless.
- **The committed result is validated rather than trusted.** `evals/results/extraction-score.json`
  was 125 rows from an eight-arm run in a two-revision-old schema. It is regenerated, and
  `tests/extraction-manifests.test.ts` now checks that it covers the current fixture × arm matrix,
  carries the current metric names and each gate separately, and covers the whole corruption bank.

###### What an adversary can still do, measured

The oracle-guided adversary was re-run **knowing the new rule**, which is the honest version of the
question. It is bounded to one join per node: **36 to 63 characters over nine nodes, 1.6% to 2.7% of
the output**, down from 445–728 and 16.5%–24.5%. Every one of those is still caught, by
`regionPrecision`. So the residual limit is *up to seven displaced characters per stamped node, at a
cost*, rather than *unbounded displacement for free*.

Each of the four changes was broken again afterwards and the guarding test watched going red: the
budget against the composed displacement, the `covered` credit against a single forgiven fragment
(which needed a test of its own — with the budget in place, breaking the credit alone left every
other test in this file green), the ancestor credit against `pg-greatwork`, and `regionPrecision`
against `region-padding-only`.

##### The fourth review, and the hole the third repair opened

GPT Sol's fourth review returned **FIX FIRST**, and the finding is the previous repair's own doing.

**Crediting a generated node against its stamped ancestor closed the deletion hole and opened a
crediting one.** Several output nodes resolve to the same ancestor, and `articleReturned` added each
one's `cover.covered` into that ancestor's total, capped only at the ancestor's length. It never
asked *which part* of the ancestor each cover had matched. So on `pg-greatwork`, 197 copies of one
genuine generated paragraph — its stamped ancestor kept, so every copy still resolves to it:

- **410 distinct characters, 0.75% of the 54,900-character region**
- `articleRecall` **0.9881**, `regionPrecision` **0.9817**, `requiredRecall`, structure and
  cleanliness **1.00**
- attribution **passed** over 200 nodes, source order **passed**
- and the card's own basis line said **"1 of 108 stamped region elements came back"**

The cap stopped the score exceeding 1.00. It did nothing about the same 277 characters being counted
197 times. **"A bounded under-count" is retracted a second time**: overlapping matches produce a
severe *over*-count, and the 91.4%/99.6% ancestor-match rates describe individual nodes rather than
the total.

**The fix is the source-interval union**, which is Sol's and which is also the salvageable half of
the text-cursor design he agreed to reject: `coverOf` returns the source intervals it matched, and
the credit for a source id is the **union** of them. Saying a paragraph 197 times is worth what
saying it once is worth. `articleRecall` **0.9881 → 0.0110**. Across the fifteen fixtures the only
shipped number that moves is `pg-greatwork`'s, 50,738 → **50,711**, and that 27-character drop is
real overlap in a correct extraction that was being counted twice.

**And the number the diagnostic printed disagreed with the number the metric reported by two orders
of magnitude, with nothing comparing them.** That is the more general finding, and Greg's:
`articleReturned` now computes the ceiling its own basis implies — the total own text of the elements
it says came back — and **throws** if the credit exceeds it, because that is an instrument bug rather
than a bad arm. The basis line carries both numbers now. A test asks the same question of the corpus.

**There is deliberately no duplicate *gate* for generated nodes**, and it is measured rather than
argued. Across the whole corpus exactly one repeated `(ancestor, own text)` pair exists on a correct
extraction: `pg-greatwork`'s footnote markers, **28 generated nodes whose own text is `"["`**. A rule
saying "a generated node may not say the same thing twice" would fail a correct extraction 28 times,
which is the false red this file has been burned by before. The true statement is that repeated text
is worth no more than the text, and the union is what enforces it.

Three smaller ones, all real.

- **`forbiddenInsideRegion` was not general.** It joined each element's own text on a NUL, so a
  forbidden string straddling two inline elements was invisible: `<span>Bad</span><span>Stuff</span>`
  with `mustNotContain: "BadStuff"` came back clean while `exclusionPrecision` scored 0 on it. The
  comment claiming `articleReturned` could not pay for such text was wrong — it credits both halves,
  one per element. It reads the region's combined visible text now, and the cross-boundary case is a
  test on a synthetic page, because **the fifteen committed manifests are clean under both versions**
  and a check that only ever sees clean input has never been shown to work.
- **Three counting corrections.** `score.mts` said ten arms and `arms.mts` and `evals/README.md` said
  eight degenerate; the truth is **thirteen arms, twelve of them degenerate**, counting the two this
  round added. The artefact test checked
  for missing pairs but not strangers or duplicates, checked the metric schema on five rows of many,
  and checked missing corruption names but not stale ones; it is two-sided on all four now.
- **The padding claim was wrong in its numbers.** Not "eight of twelve clear the floor": across the
  padding-shaped arms there are **21 exercised region-precision rows, 17 clearing and 4 failing**.
  The narrower claim holds — nothing lies between 0.2464 and 0.6401, and the next value up is 0.6456.
  And **`arxiv-abs` at 0.6401 is the worst shipped baseline, not the worst correct extraction**: that
  page already fails its manifest for the furniture it retains. So 0.50 is a semantic *"most of this
  output is the article"* backstop, and explicitly **not** a separator between good and padded output.

**Two of the new tests were load-flaky**, which is the same class this file fixed once already: they
did their work inside the `it` bodies — six `readArticleWithProvenance` runs in one, a 483 KB page
and 595 DOM insertions in the other — and **timed out at 30,000 ms under a full `npm test`** while
passing in 123 s when the file was run alone. Everything expensive is hoisted to describe scope now,
the margins reuse cards the enclosing block already built, and the PASS→FAIL flip moved from
`aaronson` with `region-padding-only` (4.8 s) to `arxiv-abs` with `raw-body` (399 ms), which shows
the same one-failure flip on a 43 KB page the file already loads.

**Attacked from a fifth direction and broken — by me, and fixed the same hour.** The order rules
judged only *directly* stamped nodes, so on a page where Readability builds most of the output there
was almost nothing left for them to look at. Reversing **188 generated nodes** on `pg-greatwork`:
`articleRecall` **0.9237, identical to the shipped card**, `regionPrecision` 0.9237, `requiredRecall`
and structure 1.00, **both gates green**, every assertion held, `detects` **nothing** — and the reader
holding Paul Graham's essay with its paragraphs backwards. Every character genuine, every character
returned exactly once, so no measure of *how much* text came back could ever see it.

`provenanceForm` walks generated nodes forward through their ancestor's own text now, and **the rule
has to tell a reordering from a repeat** or it fails a correct page: `pg-greatwork` emits 28
generated nodes whose own text is `"["`, all matching the same character of their ancestor. So a node
is out of order when it covers ground *before* the furthest point reached **and that ground is new**;
the markers cover ground already covered, which makes them repeats — worth nothing, which the
interval union already says — and not reorderings. The arm fails `sourceOrder` over **324** judged
nodes against 108 before, all fifteen shipped extractions still pass both gates, and
`reverse-generated-nodes` is the thirteenth arm. `assertionsPassed` stays true on it, which is the
design rather than a gap: a reordering is a gate, not a declared assertion.

**Attacked from a fourth direction and not broken: the denominator.** `articleRecall` divides by the
region's own text as `regionTextById` records it, which keeps only elements that carry a stamp, while
the forbidden-text check now reads `regionVisibleText`, which keeps every character in the same
subtree. If the preparation ever left a region element unstamped, the denominator would under-count
and every recall on the corpus would be quietly optimistic. Measured 2026-09-05 across all thirteen
region-bearing fixtures: **the two readings agree to the character, 0.00% apart on every one** —
`gutenberg-pride` 589,148 against 589,148, `pg-greatwork` 54,900 against 54,900.

**Two things this round's own checks caught, neither of them Sol's.** The new arm sized its repeats
on *whitespace-collapsed* length while `articleReturned` counts *whitespace-removed*, so it came out
15% short of the region and stopped being an attack on the crediting; and the test asserting its
shape said *"returns more characters than the shipped extraction"*, which is the wrong property —
an arm can repeat a paragraph fifty times and still be shorter than the page. It asserts the real one
now: the output is more than twenty times the article it actually returned.

Sol confirmed as sound, and these are not re-litigated: the short-run budget, the three region
`except` fixes, `--fixture aaronson` exiting 0, the eleven deliberate manifest failures, and the
rejection of the text-cursor design — *"correct for a single irreversible document-order cursor;
PLOS's legitimate hoisting makes that design unsound, and the anchor-floor swing confirms it is not
repairable by tuning"*.

##### The fifth review, and the reversal one level up again

GPT Sol's fifth review returned **FIX FIRST**, one blocker and four smaller ones.

**The blocker is the fourth round's reversal finding, one level up.** Closing reordering *within* an
ancestor left it open *between* ancestors: `generatedSpans` is kept per source id, so the first
generated node under **every** id starts from zero regardless of where earlier ids appeared. Sol
built twelve stamped sections of about 1,600 characters and emitted them in reverse as generated
`<p>` children of their original stamped wrappers — **the wrappers carry no own text**, so the
order rule skipped them entirely, and the per-ancestor rule saw each section's paragraphs in their
own correct internal order:

- **19,410 of 19,410 article characters credited**
- `requiredRecall`, `articleRecall`, `regionPrecision`, `structureFidelity` all **1.00**
- both gates **green** over 12 nodes, every assertion passed, no failures
- and the whole article backwards

**The fix is one line of rule and three rejected coordinates.** The order gate now checks **every
directly stamped element that holds text anywhere below it**, not only the ones carrying text of
their own; the reversed wrappers are stamped and hold text, so reversing them is a decreasing stamp.

**Four coordinates were measured and three rejected, which is what makes the fourth trustworthy.**
Each was run against the shipped — that is, correct — extraction of all fifteen fixtures, counting
how many carriers it called out of order:

| coordinate | false reds on a correct extraction |
|---|---|
| the resolved element's **stamp**, then the interval | **184** on `pg-greatwork`, 34 on `gutenberg-pride` |
| the resolved element's **block offset** among the region's elements | **184** on `pg-greatwork`, 34 on `gutenberg-pride` |
| the covered text's **true global position** in the document's visible text | **295** on `pg-greatwork`, **934** on `gutenberg-pride` |
| **the subtree test**, which is what shipped | **0**, on every one of the fifteen |

The first two fail for one reason: a node Readability *generated* resolves to an **ancestor**, and any
direct descendant of that ancestor which preceded it has a higher stamp — on `pg-greatwork` the
footnote link `s61` lives inside the essay `s44`, so every generated paragraph after it reads as a
reordering. Skipping containers moves the first violation rather than removing it. The third fails
harder and for a different reason: `querySelectorAll("*")` visits a parent **before** children whose
text precedes the parent's own, so an element walk is not a text walk and no amount of exact
position-mapping repairs a traversal in the wrong order. The fourth costs nothing in coverage — the
rule now judges **2,964 container nodes it used to skip** (`gutenberg-pride` +851,
`ar5iv-attention` +762, `python-docs-itertools` +619).

It does not contradict `ownTextOf`'s standing warning that a stamped container can end up saying more
than its source element said. That is about a container's **text**, and nothing here compares a
container's text — only its **stamp**.

**The permanent check is a synthetic page rather than an arm, and that is a finding about the
corpus.** The shape needs several stamped wrappers holding no own text whose paragraphs Readability
generated; `pg-greatwork`, the only generated-node-heavy fixture, puts its whole essay under **one**
such wrapper, so reversing wrappers there reverses nothing. No committed fixture gives a clean
cross-id transform. `reverse-generated-nodes` still covers the within-ancestor case on a real page.

Four smaller ones, all real.

- **The runner reported a successful measurement of nothing.** `--fixture definitely-not-a-fixture`
  exited **0** and announced *"All 0 fixtures move the card in both directions"*, every degenerate
  pair satisfactory. The argument was read and never validated. That is this repository's signature
  failure arriving inside the instrument built to detect it — 260830at's marker rule scored 246/246
  on a corpus containing none of the content it would have deleted, and 260827ab reported "zero
  regressions across fourteen pages" for an arm no page could exercise. All three are true sentences
  about an empty set. An unknown fixture name throws now, and a manifest whose bytes are missing
  fails the run rather than being stepped over.
- **The denominator invariant was tested over 6 of 13 fixtures.** Sol measured all thirteen
  independently and every stamped denominator exactly equals its visible reading — 589,148/589,148
  for `gutenberg-pride`, 54,900/54,900 for `pg-greatwork` — so the invariant is true and it was the
  *test* that was narrow. The runner checks all of them now and exits non-zero; the fast test keeps
  its six as the quick signal.
- **"Schema on every row" was not enforced.** The artefact test filtered to rows that already had
  `metrics` and then validated those, so deleting `metrics` or `gates` from an exercised row left it
  green — the survivors still numbered more than the ten it asked for. It reads every row the run
  marked exercised now, and a row of neither known shape is itself a failure.
- **The stamped-page cache could return another document.** Keyed on URL + byte length + first 256
  characters; Sol supplied two same-length documents with the same URL and prefix and got the first
  one's tail back. The corpus's unique URLs hide it, which is what makes it worth removing. It keys
  on the whole input now, as `regionTextById` has since round 3 — *a fingerprint that can collide is
  a silently wrong answer, which is the one thing this file is about.*

And two stale comments, both of which had outlived the code by a day: that generated nodes receive no
recall credit, and that order is judged on direct stamps only.

##### The sixth review, and the coordinate that was right all along

GPT Sol's sixth review returned **FIX FIRST** with three blockers, and the first two have one fix.

**A stamp preorder cannot see mixed content.** `ownTextOf` concatenates an element's direct text
nodes and throws away where they sit among its children, so Sol moved a container's own text in
front of its child — the article went from *"Alpha, Middle, Omega"* to *"Middle, Alpha, Omega"* —
and every metric read **1.00**, both gates passed over four nodes, every assertion held and `detects`
found nothing. The stamps were unchanged and `ownTextOf(s2)` was unchanged. The position was simply
not in the representation.

**And the container rule could false-red a correct extraction.** Hoisting a first child out of its
wrapper while leaving the wrapper round the second — the reader sees *"Alpha, Beta"* either way —
reported *"source element s2 arrives after s3 — a reordering"*. Sol could not induce it from stock
Readability over fifteen crafted structural families, but it is a provenance-preserving transform and
**stage C is exactly where such restructuring gets introduced**; a hard gate used to accept stage C
must not outlaw it by accident.

**The fix is the coordinate I measured and rejected in round five, paired with the traversal it
should have had.** Sol's correction is exact: that experiment established that
`querySelectorAll("*")` is not text order, **not** that global text position is invalid. Walking
`childNodes` on both sides — emitting each text run where a reader meets it, and mapping it to where
its source element's own text sits in the prepared document — measures **zero** false reds on all
fifteen, turns the mixed-content reversal red, and leaves the hoist green. The table now reads:

| coordinate | false reds on a correct extraction |
|---|---|
| the resolved element's **stamp**, then the interval | **184** on `pg-greatwork`, 34 on `gutenberg-pride` |
| the resolved element's **block offset** among the region's elements | **184** on `pg-greatwork`, 34 on `gutenberg-pride` |
| global text position, walked with **`querySelectorAll("*")`** | **295** on `pg-greatwork`, **934** on `gutenberg-pride` |
| global text position, walked over **`childNodes`** — this one | **0**, on every one of the fifteen |

It **replaces** three rules rather than joining them: the direct-stamp comparison, the fourth round's
per-ancestor generated walk, and the fifth round's container widening are all gone, and the gate
judges more than any of them did — `gutenberg-pride` 4,463 text runs against 4,391 stamped elements,
`wiki-gdp-table` 1,042 against 736, `shakespeare-hamlet` 334 against 230.

One detail cost 33 false reds on its own and is worth writing down: **a cover interval must be
clipped to the text run it belongs to**, not given whole to whichever run it started in. A `<p>`
whose own text is split around an inline child covers it in one interval, and attributing all of it
to the first run pushes the cursor past the child before the child is reached — a two-character
error, on `<p>See note <a>1</a> above.</p>`.

**The third blocker is the empty-selection failure, and I had reported it fixed.** `--fixture
man-open` exited **0** announcing *"All 0 fixtures move the card in both directions"*: validation
accepted any name in `SCORABLE_FIXTURES`, most of which have no manifest, and the loop then skipped
the missing manifest with a silent `continue`. **That is the second time this class has been declared
closed here and was not**, which is why the code now carries three sentences about it rather than a
line. The selectable set is the manifest-bearing fixtures, computed once; a missing argument is
refused; a manifest that goes absent mid-run fails the run; and `MANIFESTS_EXPECTED` pins the count,
so a corpus cannot shrink by accident and take the regenerated artefact quietly with it.

Four more in the same pass, all Sol's:

- **The exposure sweep I claimed to have done was incomplete.** On the gold+manifest conformance card
  `requiredRecall` reported **19 exposures for 17 distinct passages** and `exclusionPrecision` **32
  for 30** — two `mustContain` needles duplicate gold body passages, two exclusions duplicate gold
  chrome. I swept the exposure fields last round and said they were all counted once; they were not,
  and the sweep missed the only tier where both sources are present at the same time. Both
  concatenations are de-duplicated now, and the claim is narrowed to what was actually checked.
- **`pmc-article`'s gate flip was an artefact**, and I reported it as a result. See the retraction
  above.
- **The artefact schema check trusted `exercised` before validating it** — removing `exercised`,
  `metrics` and `gates` from one row left it inside the matrix while escaping schema validation, the
  remaining 115 clearing the `>100` floor. The flag is checked first, on every row.
- **The test named "judges the wrappers" asserted only `>= 12`** on a page that already contributes
  48 generated-node observations, so it passed without counting a single wrapper. The order gate
  counts text runs now, so the number is exact and is asserted as one.

##### The seventh review, and the last redesign of the order gate

GPT Sol's seventh review returned **FIX FIRST** with one trunk blocker, and it is the same shape as
the fifth and sixth: a class of output text that the order rule never looked at.

**`sourceRefOf` calls a generated wrapper containing a stamped child a `descendant`**, and such a
node's own text counted for attribution while being excluded from ordering outright. Both directions
followed. A real reordering passed — `<div><i>child first</i>loose text second</div>` extracted as
`<p>loose text second<i>child first</i></p>` produced cards **identical** to the correct one:
attribution passed at exposure 3, order passed at exposure 2, every assertion held, `detects` empty.
And a correct restructuring was condemned — with the wrapper's runs skipped, a final direct `Alpha`
resolved greedily to the *first* identical `Alpha`, behind the already-consumed `Yankee`, and
character 0 was reported after character 91.

**This was not synthetic exposure**, which is the part that matters: the shipped corpus holds **31
descendant own-text carriers, 4,747 characters across six fixtures**, 14 of them and 4,162 characters
on `pg-greatwork`. So the *"zero false reds on all fifteen"* that justified the previous rule was
measured over a set that excluded exactly the runs the blocker is about. A measurement is only as
wide as what it looked at, and that one was narrower than it sounded.

**The fix is a different kind of fix from the last three, and that is the point.** Rather than a
fifth coordinate, the gate now asks the question once and globally: **is there a monotone assignment
of the output's text runs to source text?** Greedy earliest-admissible, in output order, each run
matched to the earliest position at or after the cursor that its **owner** could supply — its own
source element's own text, which a run may straddle because a child between two pieces can have been
removed; or the whole page, for a wrapper whose loose text belongs to no stamped element. Assigning
that loose text to the wrapper's first stamped child would be wrong: that child did not own it.

It subsumes what the four coordinates were each half-answering. `pg-greatwork`'s 28 `"["` markers
take 28 **distinct** occurrences rather than being forgiven as repeats; a retained second occurrence
maps to the second occurrence; and an output for which no monotone assignment exists is rejected.
Measured: **zero** out of order on all fifteen, both of Sol's cases correct, and the
`See note <a>1</a> above.` case correct in both directions.

**The cost, since a naive assignment would be quadratic.** One `indexOf` per run plus two binary
searches — linear in the output's runs, logarithmic in one element's pieces. `gutenberg-pride`'s
4,465 runs in **1.6 s**, `python-docs-itertools`'s 4,148 in 0.7 s, the fifteen in about seven
seconds. The first version scanned an element's own text character by character to find the cursor
and cost **1,959 ms on `pg-greatwork` alone**, whose one `<span>` holds 54,900 characters.

**The clipping is gone with the mechanism it belonged to**, and its reasoning is kept where the field
used to be (`CoveredRun`). Sol confirmed it mathematically sound and load-bearing *for the coordinate
it served*; the alignment does not map element covers onto text nodes at all, so there is nothing to
clip. The worked `See note <a>1</a> above.` case is a focused permanent test in both directions
anyway, because the shape is what breaks an order rule whichever mechanism is underneath.

**Claims corrected.** *"One coordinate, shared by every carrier"* was false while descendants were
skipped and is rewritten. § B's *"the gates are decisive about invention, reordering and
duplication"* is narrowed again: about invention, about reordering of **any** text run the output
carries, and about duplication **by a directly stamped node** — generated duplication is deliberately
unchecked for the measured reason, and descendant reordering was unobserved rather than allowed. The
gate's own success line said *"none said twice"* and now says what it checks. `MANIFESTS_EXPECTED`
was a minimum (`<`) and is an exact pin (`!==`); what neither closes is a manifest *replaced* by
another without the count changing, which the artefact's fixture-by-fixture matrix catches.

**And a test-count discrepancy worth naming.** Sol reported 192 tests over the five
`extraction-*.test.ts` suites where I had reported 172. Both were right: I had been running four of
them plus `tests/no-raw-nul-bytes.test.ts`, and had never included `extraction-inventory.test.ts` —
170 + 22 = 192, 170 + 2 = 172. The five suites are the set from here on; they now read **195**, the
three added being the ones above.

##### The eighth review — a fail-open, and the judgement it forced

One blocker, the narrowest yet, and it matters because of its *shape* rather than its size.

For a generated node resolving as `ancestor`, the order walk restricted the run to the ancestor's own
text. A node Readability builds by **flattening a subtree** carries the ancestor's own text *and* its
children's, so no element owns that combination: `placeRun` returned neither a span nor `behind`, and
the caller **dropped the run in silence** — on the reasoning that attribution had already rejected it.
Attribution deliberately judges a generated node against the whole page, so it had passed it.

GPT Sol's case: `<div s1>A <i s2>X</i> B</div>` flattened to `<div s1><p>A X B</p></div>`. The `<p>`
resolves to ancestor `s1`, whose own text is only `AB`; its `AXB` run vanished from the alignment; and
moving the whole `<div>` after a later paragraph produced a card **identical** to the correct one —
every metric the same, attribution green at exposure 3, order green at exposure 2, `assertionsPassed`
true. The omitted run was exactly the reordered content.

**"Assume another check caught it" is the shape of every hole this gate has had**, and it is the
reason the fix is not just a retry.

**Fail open into a tighter set, not closed** — and the reasoning matters more than the choice.
Failing closed would condemn the flattening, which is a *correct* extraction. Measured first: this
branch is taken **zero times across all fifteen** shipped extractions, so the corpus can neither find
the bug nor price the fix, and the choice had to be made by reasoning about the shape. The retry is
the ancestor's **subtree** — where a flattened node's text provably came from, one contiguous stretch
of the page, and strictly tighter than the page fallback that `descendant` runs get.

**And no branch drops a run in silence any more.** A run that neither the owner, nor its subtree, nor
the page can supply is now *named* by the order gate, even though attribution reports the same text
as invented. Two reds for one fault is the price, paid deliberately: a redundant red is cheaper than
a silent skip, and this file has now been wrong four times in exactly that way.

**A cost mistake worth recording, because it killed the run.** The first version stored each stamped
element's subtree *text*. `gutenberg-pride` has 3,542 stamped elements inside a 589,000-character
page, and a slice apiece is quadratic in the nesting: the corpus run reached the sixth fixture and
died — *"FATAL ERROR: Ineffective mark-compacts near heap limit"* at 4 GB, exit **134**. It stores
`[from, to)` bounds now and cuts the string in the branch that needs it, which is taken zero times.

**Sol cleared the two things this round was uncertain about**, independently, and they are not
re-litigated: the `descendant` whole-page fallback is sound for observable text order — passing
establishes the runs form part of a monotone page-text subsequence, and repeated phrases make
occurrence identity unknowable without creating an observable non-monotone sequence — and greedy
earliest-admissible is *correct* for these candidate spans, since taking the earliest placement
minimises the cursor and later occurrences cannot finish earlier, including across an owner's ordered
pieces.

**The gate tally is read from the run now, not written down.** How many shipped extractions pass both
gates moved three times in two days and left a stale sentence in this file each time. Nothing states
it: `tests/extraction-manifests.test.ts` § *"says how many shipped extractions pass each gate"* prints
the tally from `evals/results/extraction-score.json` and fails only on the thing that is always
wrong — a gate that is neither passed nor honestly abstaining.

##### The follow-on this stage most needs: a shape corpus

**The fifteen fixtures are the right instrument for the metrics and the wrong one for the gates, and
no amount of adding real articles fixes that.** Recall, precision, exclusion and structure are claims
about real pages, and real pages are what tests them. The gates are claims about **DOM shapes**, and
to sample for a shape you have to be able to characterise it — which you can only do once you already
know to look for it.

The evidence for that is this stage's own history, and it should be read before anyone trusts a green
card:

- **Every blocker from the fourth review onwards needed a synthetic page**, because no committed
  fixture had the shape: the cross-id section reversal, the mixed-content reversal, the hoisted
  wrapper, the flattened subtree.
- **The `ancestor`-cannot-supply branch fires zero times across all fifteen.** The corpus could
  neither find that bug nor price its fix; the choice between failing open and failing closed had to
  be made by reasoning about the shape, and the measurement's only contribution was to prove the
  corpus was silent.
- Two of the twelve degenerate arms are exercised on **one fixture each**.
- **The hand-built cases were written by whoever was fixing the bug they describe**, including all of
  mine. They demonstrate that a fix works. They do not sample the space. **GPT Sol's cases are the
  only ones written by somebody trying to break it**, which is why six reviews found six things.

So the follow-on is a **shape corpus**: small hand-built pages, one structural shape each, named for
the shape rather than for the bug that produced it — *mixed content*, *a wrapper whose child was
hoisted*, *an ancestor whose inline child was removed*, *a repeated phrase*, *a generated node under a
stamped wrapper*, *a flattened subtree*. `negative_controls.html` and the conformance page are its
first two members and nobody has called it a category yet; the synthetic cases now scattered through
`tests/extraction-scorer.test.ts` are the next six, and they should be pages in a directory rather
than string literals in a test, so an arm can run against them and the runner can report exposure over
them the way it does over the fifteen.

Naming them for the shape rather than the bug is the whole point: a page called
*"reordering-inside-a-generated-wrapper"* invites the next person to ask what other shapes there are,
and a test called *"GPT Sol's seventh review"* does not.

##### Stage C preconditions, from GPT Sol's fifth review

Not notes — conditions on how stage C may use this instrument.

- **`articleRecall` is a bounded lower measure, not exact cross-extractor recall.** GPT Sol's ninth
  review clears deferring the 4,162 descendant characters as defensible — 0.9237 is not meaningless,
  **50,711 of 54,900 credited**, and the 48,000 floor keeps **2,711 characters of useful margin** —
  **with a constraint stage C must honour**: a wrapper-shape change can move the number without
  changing a word the reader sees, and a regression confined to those 4,162 characters is invisible
  to it. So it may compare an arm against a baseline; it may not be quoted as one extractor's recall
  against another's.
- **The shape corpus is an early stage C precondition, not coverage stage B already has.** Sol's
  wording, accepted: the unbuilt corpus is not independently a trunk blocker and its framing is
  honest, but a general claim drawn from a gate green needs it **first**. See *The follow-on this
  stage most needs* above.
- **`regionPrecision` is to be used relatively, never as a quality separator.** The 0.50 floor is a
  semantic *"most of this output is the article"* backstop and 17 of 21 exercised padding rows clear
  it. Stage C compares an arm against the shipped card; it must not read 0.50 as a line between good
  and padded output.
- **`assertionsPassed` excludes the gates, so stage C's acceptance path must consume the gates
  separately, always.** A reordering is a gate and not a declared assertion — the twelve-section
  reversal above passes every assertion by design. Any acceptance rule that reads `assertionsPassed`
  alone is blind to reordering, duplication and invention.
- **Table-row semantics limits any stage C conclusion about a table-bearing page.** The ruler is
  text and order; it cannot see a datum moved into the wrong row. A stage C claim about such a page
  needs a containment-aware check or manual evaluation, and may not rest on this card alone.

##### Two decisions, Greg 2026-09-05

**The holdout custodian ceremony is dropped, in favour of a separate subagent as the isolation.** A
line in a JSON file saying *"nobody opens a page before the thresholds are frozen"* is a promise, and
the thing it is meant to prevent — reading a page that scored badly, deciding it was mislabelled and
dropping it — is invisible when it happens. So the holdout runs **in its own agent**, which reports
aggregate pass/fail plus catastrophic per-article regressions and nothing else; the agent tuning
stage C never receives per-page output. **The honest limit, stated rather than glossed: the
orchestrator sits between them**, so this is structural for the agents and a discipline for the human.
It is a better arrangement than a custodian's name in a file, and it is not a guarantee.

**Claude-assisted gold is not disqualifying, and it cannot be the sole acceptance oracle.** WCXB's
ground truth was drafted by Claude and human-reviewed; a future Claude repair pass scored against it
shares a possible blind spot with it. Sol's judgement, accepted: keep it **aggregate-only**, combine
it with independently human-adjudicated examples, and have a **non-Claude review inspect a blinded
sample of the disagreements** — the cases where our output and the dataset's gold differ — rather
than trusting either side's account of them.

##### What is still not scoreable, and why

- **A wrongly folded run.** `treatment: "supplement"` and the fold are stage D. Nothing here can
  score "the acknowledgements were folded and the argument was folded with them", because there is no
  fold and no `role` to be wrong about. Unchanged.
- **Text `prepareDocument` itself invents.** The gates are scored against the *prepared* document,
  because that is what the arms are transforms of and because scoring against the raw bytes read the
  note canonicalisation as 37 blocks of invented text on `ar5iv-attention` alone. So they ask what
  extraction did to the document stage 2 was handed, not what the preparation did to the page.
  `tests/extract-provenance.test.ts` is what watches that half.
- **Invented text inside a node Readability generated.** The strong attribution gate compares a
  *directly stamped* node's own text against its own source element's, which is exact. A node
  Readability built itself has no element of its own — 216 of them on `pg-greatwork` resolve only to
  an ancestor — so those are judged against the whole page instead, which catches wholly invented
  prose and not a word swapped inside a sentence. ~~And `articleReturned` credits them nothing, which
  under-counts in the safe direction because the floors come from a measured run.~~ **The second
  sentence is retracted** — see *The third review* below. A floor cannot catch the deletion of text
  its numerator never counted, and on `pg-greatwork` removing every generated node deleted 81% of the
  output while `articleRecall` did not move by a digit. Those nodes are credited against their
  ancestor's own text now; only the *attribution* half of this limit stands.
- **Up to seven characters of displaced text per stamped node, if that exact string is elsewhere in
  that element.** ~~Up to twenty-three characters per join.~~ **"Per join" is retracted, because it
  was per join and had no total**, and GPT Sol composed it: 24.5% of `negative-controls` displaced,
  every metric 1.00, both gates green, nothing detected. A cover may now forgive **one join's worth
  in total** — measured 2026-09-05, the fourteen shipped extractions forgive **zero characters over
  zero joins** in this form, so the bound is headroom nothing uses rather than a tolerance the corpus
  lives inside. The whole-page fallback, which is what judges a *block* and a generated node, keeps a
  larger budget of 48 characters because `ar5iv-attention`'s MathML blocks genuinely need 37. And a
  forgiven character is no longer *paid for*: `articleReturned` credits what the cover covered, so
  even a displacement inside the budget costs `regionPrecision`.
- **A `div`-based navigation rail.** The `article-plus-rail` arm only fires on pages with a real
  `<nav>`, `<header>` or `<footer>` element, so the commonest modern rail is invisible to it until
  stage C has a recogniser. Unchanged, and still the honest gap it was.
- **Whether an arm improved an article.** Deliberately. Nothing here says so any more, and the
  previous answer was worth less than nothing.
- **TWO SHAPES THE ORDER GATE CONDEMNED THAT ARE CORRECT — FIXED 2026-09-06, as stage C0.** Read
  this one first, because **its direction was the opposite of every other defect in this stage**:
  nine reviews found badly degraded extractions scoring well, and this was a *correct* extraction
  scoring badly. What you do when you meet one is therefore the opposite too — a red of this shape is
  a reason to suspect the ruler, not the extractor.

  GPT Sol's ninth review reproduced both.

  **§ B said "no fixture produces either shape". That was wrong, and finding out was the most useful
  thing this fix did.** One did, in the run rather than in a shipped extraction: `pmc-article`'s bot
  wall contains *"Click `<a>`here`</a>` if you are not automatically redirected after 5 seconds"*,
  and the `drop-every-short-block` arm removes the `<a>` — which is partial flattening, Sol's first
  shape, produced by an arm rather than by hand. Its card then read *"could not be placed in the
  source at all … attribution should have reported the same text as invented"* **while the attribution
  gate printed beside it passed**. The message contradicted the card next to it and nobody noticed,
  because `pmc-article` declares no article region, so it is exempt from the must-lose rule and the
  false red cost nothing visible. The corpus run before the fix and after it differ by exactly that
  one line of 268 — verified independently against `origin/dev` in a detached worktree, not taken on
  report.

  So the claim to carry forward is the narrower one the code now makes: this branch fires zero times
  across the fifteen **shipped** extractions, and not zero across the run.

  - **Partial flattening.** Source `<div s1>A <i s2>X</i> B <button s3>navigation</button> C</div>`
    extracted as `<div s1><p>A X B C</p></div>` — every retained character in order, one child
    correctly dropped. Attribution passed. `sourceOrder` **failed** with *"could not be placed in the
    source at all"*, because `AXBC` is neither the ancestor's own text `ABC` nor an exact substring
    of the subtree `AXBnavigationC`.
  - **Repeated text.** Source `<div s1><i s2>Alpha</i>Alpha</div>` extracted cleanly as
    `<div s1><p>Alpha</p>Alpha</div>` was rejected: the generated paragraph was placed at the *later*
    occurrence in `s1`'s own text rather than the earlier subtree occurrence, and the remaining direct
    run then read as reordered — *"the only place source element s1 has it is behind character 10"*.

  **What was done.** The subtree was the correct *spatial* tightness and that part stands, unchanged
  and now tested on its own. What it could not be is an **exact-match fallback applied after owner
  matching**, and it is neither of those things now: an `ancestor` run is placed inside its
  ancestor's subtree as a **cover** — `coverOf`, the same in-order, run-floored subsequence
  attribution is built on, so a legitimately dropped child costs one join and a *rearranged* child
  still fails — and that placement is a **candidate beside** the owner's rather than a fallback
  behind it. Both shapes are permanent cases in `tests/extraction-scorer.test.ts`, watched red first,
  each asserting the run is actually **in** the alignment rather than merely that the gate is green,
  and each with its moved variant asserted red.

  **The greedy rule was restated rather than reused.** "Earliest admissible" was written for exact
  spans, where a placement's length is fixed and earliest start *is* earliest end. Under a
  subsequence placement they come apart, and the quantity the exchange argument is about is the
  **end** — the cursor is the only thing a placement hands to the runs after it, and feasibility is
  monotone in the cursor. Candidates are compared by end. What is **not** proven optimal is the cover
  `coverOf` finds *within* one stretch: it anchors earliest and then takes the longest run at each
  step, which need not be the cover that ends soonest. Only a subtree holding the same phrase twice
  at chunk granularity could be placed later than necessary by that, and `scorecard.mts` says so at
  the walk, because the next false red of this family will start there.

  **Still true, and it is the reason C0's second half exists:** no *shipped* extraction takes this
  branch, so the corpus prices almost none of this. Five of the six cases that exercise it are
  hand-built; `pmc-article` above is the one real-page witness the gates have for the shape, and it
  arrived by accident rather than by sampling. § *The gates are tested by shapes nobody sampled for*
  below is dented by that and not closed.

  **One mutation of this branch was not caught by anything — CLOSED 2026-09-06, as C0.2.** Dropping
  the placement floor from 8 to 1 — which turns the cover into a bare character subsequence — left
  all 66 cases green, while the six other mutations tried were each caught.

  **The shape that distinguishes them is a generated node borrowing another container's phrase,
  where the ancestor's own subtree happens to spell that phrase letter by letter.** Attribution
  cannot see it, because the words are genuinely on the page, so the subtree boundary is the only
  thing between the output and a green. At floor 8 the subtree cannot cover the phrase in runs of
  eight and the order gate reddens; at floor 1 the cover is a bare character subsequence, and 342
  characters of ordinary prose about lanterns and ledgers do spell `theclerkandhismargins` in order
  — so the boundary evaporates and the same borrowing passes. **The floor is what makes the subtree
  a boundary rather than an alphabet**, and that sentence was not previously written down anywhere.

  It is `borrowed-phrase-spelled-out-by-the-subtree` in
  [shapes.mts](../../evals/extraction/shapes.mts), asserted on both sides through a
  `withPlacementFloor` mutation seam, with a further assertion that the two cards actually differ —
  a mutation that changes nothing has pinned nothing.

  **Where the boundary actually is, swept rather than guessed.** Run at every floor from 1 to 12
  on 2026-09-06: green at 1 and 2, red at 3 and above. So the case rejects a floor of **1 or 2**,
  and the genuinely unpinned interval is **3 through 8** — GPT Sol's third finding, against a first
  draft that claimed only "not 1". All three of those floors are pinned by the case, so the sweep
  cannot go stale.

  **What would pin the exact value, and is not built.** Sol's suggestion: a borrowed phrase
  coverable in separated seven-character runs but not eight-character ones — red at 8, green at 7 —
  paired with a legitimate flattening whose retained runs are exactly eight characters, green at 8
  and red at 9. That is both sides of the boundary rather than one. The natural-prose case above is
  kept either way, because it is the one a reader can believe.

  **A neighbouring hole, found while fixing this and deliberately left — CONFIRMED INDEPENDENTLY
  2026-09-06, still open, and now pinned.** `owners` is populated only from text nodes, so an
  ancestor with *no own text* — `<div s1><p s2>…</p></div>` — has no `Ownership` at all, takes
  `placeRun`'s ownerless branch, and a generated node under it may be placed anywhere on the page.

  Re-measured by a second agent that did not write the fix, on a page built for it. Two pages that
  differ **by two words of own text on one wrapper and nothing else**, given the same borrowing:

  | the wrapper | attribution | sourceOrder |
  |---|---|---|
  | `<div s1>Preamble preamble<p s2>…</p></div>` | ok (2) | **FAIL** (2) — *"the subtree of source element s1"* |
  | `<div s1><p s2>…</p></div>` | ok (2) | ok (2) |

  The second card is **identical to the card for a correct extraction of the same page** — same
  verdicts, same exposure counts — which is the shape of every defect in this stage. The mechanism
  is confirmed as described: the run takes `placeRun`'s ownerless, page-wide branch and the subtree
  narrowing that follows can only *narrow* a placement, never reject one, so a page-wide match found
  before the subtree survives it.

  Both are permanent cases now — `borrowing-under-a-text-bearing-wrapper` (red) and
  `borrowing-under-a-text-free-wrapper` (green, marked `hole`) — and `ProvenanceTally.ownerlessStamped`
  counts the branch across any run, so the number moving is visible rather than inferred.

  **And the branch is NOT hypothetical on real pages, which nobody had measured.** Counted
  2026-09-06 over the shipped extraction of all fifteen fixtures — the line
  [score.mts](../../evals/extraction/score.mts) now prints — **9 runs on 5 of the 15** take it:
  `medium-about` 4, `quanta-year-physics` 2, `wiki-gdp-table` 1, `plos-biology` 1, `pmc-article` 1.
  Independently reproduced by GPT Sol to the same five fixtures and the same nine runs, who also
  makes the precision worth keeping: it is a count of **runs**, not of nodes or wrappers, and
  *"the gate says nothing about them"* overstates it — their **global monotone order is still
  checked**; what is absent is any claim about which container they belong in. On the shipped
  extractions they happen to belong where they landed, and *happen to* is the problem. The earlier
  framing of this as a hand-built shape's problem is retracted.

  **Now 4 runs on 3, and the two that went are the walls.** C1a refuses `medium-about` and
  `pmc-article`, which carried 5 of the 9 between them, so the branch is live on `wiki-gdp-table`,
  `plos-biology` and `quanta-year-physics` — see § C1a's *what landed*. The reading above is kept
  with its date because it is what the corpus said before the floor existed; the number to quote is
  the one the run prints.

  **What the fix would cost, measured before anyone decides.** Sol's smallest change is to give
  every stamped visible element an empty `Ownership` when `sourceOwnership` first visits it; an
  ownerless ancestor then behaves like an owner that cannot supply the run, and only its subtree
  fallback is left. He ran it in memory against all five exposed fixtures: **all five stay
  `ok/ok`, and the nine runs move from `page` to `subtreeOnly`.** It would turn
  `borrowing-under-a-text-free-wrapper` red on purpose and take the declared holes from three to
  two. The residual risk is a future Readability restructuring that puts genuinely acceptable text
  under a preserved wrapper whose original subtree did not contain it — a false red, of exactly the
  family this bullet is about. **None of the current nine is that.**
  **Whether to close it is Greg's call, not the corpus's.** Tightening the ownerless branch to the
  subtree is a few lines and a behaviour change with false-red risk of exactly the kind this bullet
  is about; closing it will turn `borrowing-under-a-text-free-wrapper` red, which is deliberate —
  the case exists so the fix is a decision somebody took rather than a behaviour that drifted.

- **The gates are tested by shapes nobody sampled for. NARROWED 2026-09-06 by C0.2, and not closed.**
  See *The follow-on this stage most needs* above: the fifteen fixtures cannot exercise most of what
  the gates do, every blocker from the fourth review on needed a hand-built page, and the hand-built
  pages were written by whoever was fixing the bug.

  What changed: the shapes are a named, reported matrix now
  ([shapes.mts](../../evals/extraction/shapes.mts)), each pinning its resolution path and exposure
  counts, written by an agent that did not write the fix they test. What has **not** changed is the
  sampling: fifteen shapes chosen by two reviewers and one adversary are still fifteen shapes chosen
  by three parties, not a sample of what browsers and Readability actually produce. The honest limit
  stands, one notch narrower.
- **Table-row semantics, and structural relationships generally.** GPT Sol moved the last cell of one
  row to the start of the next: global leaf order unchanged, every leaf still resolving to its own
  source element, row widths `3, 5, 4, 4, 4` instead of the intended shape, and the datum now
  belonging to the wrong row. Nothing here sees it, and nothing here should — a ruler made of text
  and order is the wrong instrument for a claim about containment, and building a third gate over
  each stamped node's ancestor path to catch one corruption would be a lot of apparatus for a
  question stage C is better placed to ask. Recorded as a limit rather than fixed.
- **Padding, by `articleRecall` alone.** It is a *recall* measure: an arm that returns the whole page
  scores 1.00 on it, which `raw-body` does on every fixture. ~~What catches padding is the pair the
  run prints side by side — region characters against output characters.~~ **Retracted**: that pair
  was printed and nothing read it, and `detects` never saw it. GPT Sol added 595 genuine ordered
  stamped comment paragraphs to the whole of `aaronson` — 231,371 characters against a correct
  32,820 — and every assertion held, both gates passed, `articleRecall` did not move and `detects`
  reported nothing. **`regionPrecision` is a metric now**, `region-padding-only` is an arm, and
  addition without deletion is scored rather than described.
- **An `articleRegion` is a judgement.** A region drawn generously flatters the pipeline exactly as
  the ar5iv floors did. Each one carries a required `why`, each manifest `note` records the region's
  characters against the whole source body's, and the region is measurably smaller than the page on
  every fixture — `aaronson`'s is 9.3% of its body, `arxiv-abs`'s 24.6%. That is a discipline, not a
  proof, and the next person should argue with the selectors rather than trust them. **One class of
  bad judgement is now mechanical rather than a discipline**: a region may not credit a string the
  same manifest's `mustNotContain` forbids, and the run exits non-zero when one does. It found all
  three GPT Sol named by hand and nothing else.
- **A region that is generous in a way no needle names.** The check above is the *general form of a
  specific bug* and not a general one: it can only see furniture somebody has already written down.
  A region that swallows a section nobody thought to forbid is still invisible, and the only thing
  against it is the `why` and the next person reading it.

### C — Deterministic recognisers

**Rewritten 2026-09-06, after review by Fable and GPT Sol and a re-measurement of the trawl's
faults.** What follows replaces a single stage that had six things in it. Both reviewers independently
reached the same verdict — *this is not one stage* — and Sol raised six P1s against it and no P0. The
original text is in git history; what changed and why is recorded here, because the changes are the
useful part.

#### What re-measuring the trawl changed

The fault list dates from before stages A and B landed, and prioritising off it would have been taking
a stale survey as current fact. Measured against the shipping pipeline on 2026-09-06:

- **Code-block whitespace is fixed and is dropped from this stage.** [`src/blocks.ts`](../../src/blocks.ts)
  § `codeText` has the `PRE` branch; `python-docs-itertools` carries 652 newlines across its 29 code
  blocks. Stage A did what it said.
- **PLOS furniture is confirmed**: 75 of 178 blocks are reference-list controls — 42.1%, all
  `gistable: true`.
- **The GDP table is confirmed and worse than described**: zero table-shaped blocks and zero GDP
  figures anywhere in 79 blocks.
- **No bot-wall detection exists in production at all.** `notAnArticle` lives only in the eval
  harness, where it asserts that production fails.
- **`[edit]` stubs appear in no *manifested* fixture** — only in unscored ones. A recogniser for them
  would ship unmeasured, which is why C4 pairs each recogniser with a fixture that scores it.

#### Three corrections to the plan's own account

1. **The Wikipedia mechanism was misdescribed.** This plan said Readability *prunes* the data table
   and proposed a "protect" pre-pass. Instrumented by Fable: both wikitables have `<caption>` and
   `<th>`, so `_markDataTables` would mark them and `_cleanConditionally` would keep them — **they
   never reach `_prepArticle`.** The loss is in `_grabArticle`'s candidate and sibling selection,
   because a table whose every cell is a wikilink has the link density of a nav. **A protect pre-pass
   would therefore do nothing.** The fix is a provenance-based re-attach using stage A's stamping:
   an author-marked structure inside the declared region and inside the extracted extent, missing
   from the output, goes back at its source position. That honours *rule on markup, model on meaning*
   exactly — it is Readability's *shape* rule being overridden by the author's *markup* — and its
   adversarial negative is a navbox, which also has `<th>`. **This is one agent's instrumentation and
   is to be independently confirmed before C3 is built on it.**
2. **Admonition labels are mostly done already.** [`src/callouts.ts`](../../src/callouts.ts) stamps
   `[class~="admonition"]` and `[class~="theme-admonition"]` onto the container *and every block
   inside it*, so a detached "Note" is a stamped `p.admonition-title` beside a stamped body. The work
   is a **stage-3 join by stamp**, not the "Note"/"Tip" word list this plan described — which would
   have been a content-shape rule, and would have failed this plan's own rule.
3. **Paul Graham's footnotes are not another selector in `canonicaliseNotes`.** Sol P2-C07: the
   markers are deterministic markup, but the note *bodies* are flat runs separated by `<br><br>`, not
   bounded elements. That is segmentation, range creation, retargeting and stable-id preservation.
   It gets its own stage, and it is not near the front.

#### The stages

Each ends green, ships on its own, and is measured by the ruler stage B built — subject to that
ruler's five recorded preconditions, which are conditions on **how stage C may use it**, not notes.

- **C0 — the instrument, before it is trusted.** Two pieces, and this comes first because Sol
  (P1-C02) and Fable independently said so: the first recogniser to unwrap a container while dropping
  a child will trip the order gate's known false red and cost a day being suspected as an extraction
  fault.
  1. Fix the partial-flattening and repeated-phrase false reds — subtree-local monotone placement,
     earliest across valid placements, rather than the exact-match fallback. Recorded in § B's
     retraction list as a known defect.
  2. **The shape corpus, as an executable case matrix** rather than pages in a directory: Sol's
     P1-C01 unit is `source shape × candidate transformation × expected gate outcome × expected
     resolution path`. Each shape pins **the provenance branch and the exposure count**, not just
     pass/fail — *"a green result reached by abstention is not evidence"*, which is exactly how this
     harness has failed before. Make the `ancestor`-cannot-supply branch, which fires zero times
     across all fifteen fixtures, actually fire. Sol named ten missing shapes; they are the backlog.
     **No combinatorial grammar first** — both reviewers rejected it: Readability's transformations
     are non-local and most generated DOM would not resemble anything a browser ever saw. A bounded
     pairwise generator over *wrap, hoist, flatten, split, duplicate, reorder, remove, invent* comes
     after the explicit corpus is green.

  **The adversary rule, from Fable, and it is free.** § B's own diagnosis was that the hand-built
  cases were written by whoever was fixing the bug, so they demonstrate a fix rather than sample a
  space. Therefore: **the adversarial negative fixture for a recogniser is written by a different
  agent than the one writing the recogniser.** This is the actual fix for the problem the shape
  corpus was invented to solve, and it costs nothing.

  ##### What landed, 2026-09-06 — **C0.2 is done, and it was built under the adversary rule**

  Written by an agent that did not write C0.1, briefed to try to break the instrument rather than
  confirm it. [`evals/extraction/shapes.mts`](../../evals/extraction/shapes.mts) holds **16 named
  source shapes and 39 named candidates**; `tests/extraction-shapes.test.ts` is the gate,
  `npx tsx evals/extraction/shapes.mts` is the report, and
  [score.mts](../../evals/extraction/score.mts) prints a summary section beside the fifteen
  fixtures. Every case is named for **the shape** — `partial-flattening-with-one-child-dropped`,
  not "the ninth review".

  **The part that is not pass/fail.** Every card now carries a `ProvenanceTally`: which form
  answered, every text-carrying output node by how its stamp resolved
  (`direct`/`ancestor`/`descendant`/`none`), and **every text run by the branch that placed it** —
  `owner`, `subtreeEarlier`, `subtreeOnly`, `page`, `behind`, `behindSubtree`, `unplaceable`. A case
  pins all of them, omitted meaning zero, and `provenanceForm` throws if the census and the gate's
  own exposure count disagree. So a green reached by the gate quietly judging nothing is not
  available: doing nothing is a number the case would have missed. The corpus reaches **all seven
  placement branches and all four resolutions**; the fifteen shipped extractions reach **two** —
  `owner` 14,066 runs and `page` 64, and nothing else, measured 2026-09-06 and printed by the run.

  **The `ancestor`-cannot-supply branch fires.** `subtreeOnly` is zero across all fifteen shipped
  extractions and fires twice here — `partial-flattening-with-one-child-dropped` and
  `wholly-flattened-subtree`, which is the pair a fix that worked only for whole subtrees would
  split.

  **The placement floor is pinned, by one shape.** See the retraction list's floor bullet above:
  `borrowed-phrase-spelled-out-by-the-subtree` is red at the shipped floor of 8 and **green at 1**,
  and the case asserts both cards through a `withPlacementFloor` mutation seam plus a check that the
  two differ at all. Swept at every floor from 1 to 12: green at 1 and 2, red at 3 and above, so the
  case rejects **1 and 2** and the genuinely unpinned interval is **3 through 8** — nothing anybody
  has written separates those. The three floors either side of the boundary are pinned by the case,
  so the sweep cannot go stale.

  **Three cases pin a hole rather than a check**, asserting what the instrument does rather than
  what it should, so closing any one turns the corpus red on purpose:
  `borrowing-under-a-text-free-wrapper` (the ownerless ancestor, confirmed independently — see the
  retraction list), and `a-cell-moved-across-a-row-boundary` plus
  `a-stamped-inline-moved-across-a-list-item-boundary` — the containment blind spot C2 exists for,
  written twice on purpose, because an oracle built for `<tr>`/`<td>` would leave the list exactly
  where it is.

  **Migration, not addition.** The synthetic pages in `tests/extraction-scorer.test.ts` are defined
  once in the corpus now and referenced by name; that file keeps all 66 cases and all 237
  assertions, 38 lines shorter.

  **What it costs, measured rather than asserted.** The whole 39-case matrix takes **2.0–3.0 s** in
  an already-warm process (three runs, 2026-09-06), and it runs once at the end of a corpus run.
  Wall clock on the run itself is **not** a usable comparison on this box — the before run took
  3m 54s at low load and the after run 6m 22s at load average 24, with a review and a test gate
  alongside — so the in-process figure is the honest one. Nothing here stores subtree text: the
  pages are five elements each, and `sourceOwnership` still keeps bounds and cuts strings on demand.

  **One number worth knowing, unrelated to this stage.** Peak resident memory on a full corpus run
  is **3.6 GB**, against the 4 GB heap failure this plan records from the version that stored
  subtree text. The shape section runs last, after that peak, and standalone it peaks at 450 MB — so
  the 3.6 GB is the fifteen fixtures', not the corpus's. The headroom is thinner than the fix
  narrative implies.

- **C1 — the bot wall. REPRIORITISED 2026-09-06, after C1a landed and took its argument away.**
  It was *the biggest reader-visible win per hour*, on Fable's reasoning that **a published wall
  consumes a paying reader's slot** where a failed ingest is free
  ([billing.md](../project/billing.md)). **C1a now refuses both walls in the corpus**, so that
  premise no longer holds and the priority that rested on it does not either. Measured rather than
  assumed, on the merged tree:

  | fixture | wall markup | the floor refuses it | chars |
  |---|---|---|---|
  | `pmc-article` | yes | **yes** | 130 |
  | `medium-about` | no | **yes** | 185 |
  | `acx` | *matches a phrase* | no | 133,669 |

  **So a markup registry would change no publish/refuse outcome on any page we have** — only the
  reason code and the reader's sentence, which is real but is not what "biggest win per hour" was
  about. Its actual remaining value is a class we cannot demonstrate: **a wall long enough to clear
  the floor**. There is no such fixture, and until there is, C1's counterfactual — *disabled it
  publishes, enabled it refuses* — cannot be run on anything. Building a recogniser whose effect
  nothing can witness is the shape this plan exists to refuse (§ P2-C08, the exposure ladder).

  **So C1 does not ship until a long-wall fixture does**, and it moves behind C4 and C5. Getting
  the fixture is a stage-1 errand — fetch a few known-walled addresses and keep what comes back —
  and it costs far less than the recogniser.

  **The corpus turns out to hold the adversary already, and for free.** `acx.html` — a real 133,669
  character Astral Codex Ten essay — contains the phrase *"just a moment"* twice, in ordinary prose.
  Any recogniser keyed on visible challenge wording false-positives on it. That is the plan's
  *"never on visible text"* rule with a real page behind it rather than an argument, found while
  measuring the above, and it is the negative control C1 should be built against when it is built.

  **Decided behaviour — a typed hard refusal.** Refuse the extraction; publish no article; run no
  downstream AI stage; keep the fetched bytes for diagnosis; mark it non-retryable *for those bytes*;
  tell the reader the fetched page was an access or error page. Both reviewers rejected the
  alternatives, for the same reasons: **publish-with-warning** still creates a CAPTCHA article and
  lets downstream stages run on it, and there is nothing to read; **retry the same fetcher** reuses
  the already-fetched bytes and cannot help — a real JS challenge blocks every header set, so an
  alternative fetcher is a stage-1 project, named here and not built.

  Most of the machinery exists: `PAGE_HAS_NO_ARTICLE` in [`src/messages.ts`](../../src/messages.ts) is
  already `kind: "blocked"` and already says the right thing, and
  [`src/pipeline.ts`](../../src/pipeline.ts) already maps a typed refusal onto it. **The detector is a
  registry of conclusive typed markup**, not a confidence score — the challenge document's own markup,
  or a provider-specific machine-readable error state tied to its host. The discriminated reason
  (`challenge_document | provider_error_document`) must map into **both** the production failure state
  **and** `Candidate.refused`, or the harness's `notAnArticle` support is silently bypassed.

  **Never on visible "404" text, missing metadata, `noindex`, character class, or a
  reCAPTCHA script alone** — every WordPress comment form loads `recaptcha/api.js`. (Shortness *is*
  now a signal, but a separate one, and not part of this registry: see C1a below.)

  **The registry's first entry, measured 2026-09-06 rather than imagined.** `pmc_article.html`
  declares `<base href="https://www.google.com/recaptcha/challengepage/">` and
  `<link rel="canonical" href="https://www.google.com/recaptcha/challengepage">` — the page's own
  declared identity is Google's interstitial, not the host it was fetched from. Across all 20 fixtures
  carrying a canonical, **nineteen point at their own host and only the challenge page points
  elsewhere**, and it is the only fixture with a `<base>` at all. So the corpus supplies this
  recogniser's negative control for free. **Key on the challenge endpoint, not on the host mismatch**:
  a cross-host canonical is legitimate and common — a syndicated repost canonicalising to the original
  is exactly that shape — so "canonical host ≠ fetch host" is a shape rule wearing markup clothing,
  while "the page says it is `google.com/recaptcha/challengepage`" is the page telling us what it is.

- **C1a — the capability floor, and it ships before the registry.** *Decided by Fable 2026-09-06,
  with the question delegated to it by Greg; it overrides both GPT Sol's "never refuse on shortness"
  and my own settlement in Sol's favour.* The reasoning is worth keeping because it dissolves the
  objection rather than trading against it:

  > **The rule guards classifiers.** "Rule on markup, model on meaning" exists because every failed
  > shape rule *decided what a piece of text was* — junk, marker, nav — and a wrong decision silently
  > removed content from a real article. This rule decides nothing about the content. It says: *the
  > whole page has too little text for this product to build anything from*, and that sentence is true
  > of a genuine 300-character page too. So the negative fixture the plan demands is not impossible —
  > it is the wrong test.
  >
  > — Fable, 2026-09-06

  And **the number is Readability's, not ours**: below `DEFAULT_CHAR_THRESHOLD` (500) Readability has
  already concluded the parse *failed*, and returns something only because `_attempts` hands back the
  longest failure. Today we take that failure and publish it as an article titled "Medium". The floor
  is us **stopping overriding the library's own verdict**.

  **Measured across all 36 fixtures** (Readability's own `textContent`, whitespace-collapsed;
  independently re-run and confirmed to the character): the two walls are **130** (`pmc_article`) and
  **185** (`medium_about`); the shortest genuine page is `arxiv_abs` at **1,798**, then `mkdocs_tabs`
  at 3,901. **Nothing lies between 185 and 1,798.** A floor at 500 has 2.7× headroom above the tallest
  wall and 3.6× below the shortest real page. Do not tune it to the corpus — it is the library's
  number, and the corpus only shows it is safe.

  Its own error type beside `ReadabilityRefused` in [`src/extract.ts`](../../src/extract.ts), its own
  `kind: "blocked"` message, **and the character count in the sentence**, which says *usually* and
  never asserts the page is an error page — the rule does not know that. Tests replace the impossible
  negative with a floor pinned from **above**: a synthetic ~700-character real page must pass through
  untouched, so nobody later "tightens" this to 1,000.

  **The slot is genuinely free, verified in the code rather than assumed** — this is the premise the
  whole priority rests on. [`src/store/pg-session.ts`](../../src/store/pg-session.ts) § the settlement
  in the ending transaction: `ending.status === "done"` charges, **every other ending releases**. A
  refusal thrown from stage 2 ends the job `error`, so it releases, and no billing code needs to
  change. What costs the reader a slot is the *current* behaviour of publishing the wall.

  **Where it must live, or the eval proves nothing.** The detector goes inside `readArticle` **and**
  `readArticleWithProvenance` — a function both call — because the harness's `shippedOf` calls
  `readArticleWithProvenance` directly and never goes through `runExtract`. Put it in `runExtract`'s
  catch or in `pipeline.ts` and production passes while `Candidate.refused` stays permanently false and
  `notAnArticle` silently proves nothing. This is Sol P1-C03's warning arriving as a concrete seam.

  ##### What landed, 2026-09-06 — **C1a is done, and the seam it was warned about was the real work**

  `MIN_ARTICLE_CHARS`, `visibleLength`, `capabilityFloor` and `TooLittleTextToRead` in
  [`src/extract.ts`](../../src/extract.ts); `pageHadTooLittleText` and `[jb-too-little-text]` in
  [`src/messages.ts`](../../src/messages.ts); the `instanceof` arm beside `ReadabilityRefused` in
  [`src/pipeline.ts`](../../src/pipeline.ts); `Candidate.refused` in
  [`arms.mts`](../../evals/extraction/arms.mts); the ladder in
  `tests/extract-capability-floor.test.ts` and one case in `tests/job-failure.test.ts`.

  **It measures the article we would publish, with the library's formula — and the first draft of
  this paragraph claimed more than that.** `_getInnerText(articleContent, true)` — trimmed, runs of
  whitespace collapsed — is what Readability compares against `DEFAULT_CHAR_THRESHOLD`, and
  `visibleLength` computes it the same way, so on any real page the floor fires exactly on the
  fallback branch that hands back the longest failed attempt. But the library takes its reading
  *before* `_postProcessContent`, which drops empty `DIV`/`SECTION` wrappers and with them their
  whitespace: **GPT Sol built the boundary case** — measured at exactly 500 and accepted by
  Readability, 499 by the time we see it, refused. Within a character or two of the threshold we can
  refuse a parse the library kept, and that is left as it is rather than fixed, because *is there
  enough text in the article we would publish* is the question this floor is for and the
  post-processed document is that article. Reading the library's private verdict instead means
  subclassing it to catch `_attempts`. `article.length` would have been worse than either: it is the
  raw `textContent.length`, 2,321 against 1,798 of visible text on `arxiv_abs`.

  **The witness the floor cost, and where it went.** `drop-every-short-block` on `pmc-article` was
  the corpus's only **real-page** case of partial flattening — Sol's ninth review of stage B, and the
  one case in `tests/extraction-scorer.test.ts` not hand-built by whoever was fixing the bug. With
  the shipped extraction empty it became an assertion about `""`, silently. Rather than retire it, one
  test holds the floor open through `withoutTheCapabilityFloor` (`arms.mts`), which has no other
  caller and which the runner never touches: *can the scorer see this* is a different question from
  *should we publish this*, and only the second is the floor's. The corpus report is byte-identical
  either way, checked by running it again after the seam existed.

  **Red before green, on the tree rather than in argument.** The committed tree exported to a temp
  directory, the new tests copied in: **18 of 19 fail there and all 19 pass here** — the one that
  passes either way is the control, a real 749-character page going through untouched. The pipeline
  case fails there with *"expected that to fail, and it did not"*: the silent success itself,
  printed.

  **The gates.** `npm test` 768 files / 13,926 tests green, `npm run typecheck` and `npm run check`
  clean, `npx tsx evals/extraction/score.mts` exit 0.

  **The corpus, every changed line accounted for.** `score.mts` at HEAD reproduced the C1a baseline
  byte-for-byte; after the change **nine lines move and all nine are the two walls or a total over
  them**. Both shipped rows go FAIL → PASS with `exclusionPrecision` 0.00 → 1.00 and the three
  `notAnArticle` bullets gone; `raw-body` and `restore-everything` keep their numbers and gain
  `worse: exclusionPrecision`, because the baseline they are compared against moved up; and
  `first-20-percent` and `drop-every-short-block` become NOT EXERCISED on those pages, since an
  empty shipped extraction gives them nothing to transform.

  **The one consequence worth knowing about, and it is C0.2's instrument.** Refusing these two pages
  takes them out of the placement totals: `owner` 14,066 → 14,062, `page` 64 → 57, and the ownerless
  count **9 runs over five fixtures → 4 over three** (`medium-about` 4 and `pmc-article` 1 were the
  pair that went). The ownerless-ancestor branch is still live on `wiki-gdp-table`, `plos-biology`
  and `quanta-year-physics`, and `tests/extraction-shapes.test.ts` pins it on a synthetic shape
  rather than on the corpus, so nothing is unpinned — but C0.2's *"live on five real pages"* is now
  three, and the number above is where that is written down.

  **What it does not do, named rather than implied.** The floor is prospective. Stage 2 does not
  re-run when its artefact is already there, so an article published from a short page before today
  keeps its revision and its spent slot, and a job that skips extraction settles `done` without ever
  consulting the rule; a *forced* re-extraction refuses and leaves the reader on the revision they
  had. Nothing audits or refunds the slots already spent. Retrospective would mean invalidating
  extractions against a policy version — a schema-shaped change, not this one. GPT Sol's finding 5.

  **Three breakages the brief did not mention.** `evals/extraction/block-census.mts` catches
  `ReadabilityRefused` around `runExtract` and rethrows everything else, so a census over `--cut all`
  would have died on the first wall; it catches both now.
  `tests/acquire-extract-blocks-end-to-end.test.ts` carried a 310-character synthetic page through
  the whole pipeline and four of its cases went red — **the floor meeting a genuinely short real page
  inside our own suite**, which is the case the rule is honest about firing on; the page is six
  paragraphs now and says why. And `tidy.mts` would have **paid a model** to tidy the blocks of a
  page production refuses, which is the one of the three that costs money; it skips them and says so.

  **What the cross-family review changed, and it found the claim above wrong.** GPT Sol, on the built
  diff, ran three mutations past the first version of the tests and all three stayed green: a floor of
  600, a decision of `chars < 200`, and a reader's sentence with `185` hardcoded into it. The cases
  were pinning the *shape* of the rule and not its number. They pin 499 and 500 either side now, read
  `DEFAULT_CHAR_THRESHOLD` off the dependency rather than repeating it, and assert two different
  counts in two sentences; all four mutations — those three and removing the floor from the
  provenance path — now go red, and the last one goes red six ways. Sol also found the
  `_postProcessContent` gap recorded above, three instruments reporting refused pages as live output
  (`provenance.mts` counted them among its live fixtures, `probe.mts` reported Medium as eleven blocks
  of working extraction, and `tidy.mts` is the money one), the prospective boundary, and that
  *"185 characters of text in all"* reads as the whole page when it is the extracted candidate —
  Medium's shell has 249 characters visible and 185 extracted. One finding was rejected: that the
  corpus is 35 fixtures rather than 36. `ALL_FIXTURES` has 35 and `SCORABLE_FIXTURES` has 36, the
  extra being the synthetic `negative-controls` page, and the measurement was over the 36.

- **C2 — the containment oracle.** Sol's precondition five says the ruler is text and order and
  cannot see a datum moved into the wrong row, so this must exist **before** C3, not alongside it:
  caption identity, row count and order, cells per row, normalised cell text at its row/cell
  coordinates, no duplicate rescued table, placement against neighbouring blocks. A re-attached
  subtree is verbatim by construction, so the check is cheap.

- **C3 — recover what Readability dropped from the article region.** Generalised past Wikipedia,
  which is Fable's scope correction and the right one: the GDP table is the *symptom*, and the *class*
  is author-marked structure lost from inside the declared region. § B's retraction list already
  records ar5iv losing two results tables and PLOS losing three sections including a dated
  **Correction notice** — which is on this plan's own never-fold list and is currently deleted
  outright. Those are the audience's material. Three fixtures: `wiki-gdp-table`, `ar5iv-attention`,
  `plos-biology`.

  **The largest piece and the largest risk**, per Sol: finding the data tables among the navigation
  and layout ones is only the start; reinsertion must preserve sanitisation, source order and block
  ids, and must not leave both Readability's fragment and the rescued original.

- **C4 — publisher furniture: recognise and record, do not delete. Settled by Greg, 2026-09-06**, so
  this is no longer an interim position waiting on stage D. Both reviewers proposed a two-tier split —
  fold the author's apparatus, *delete* the publisher's chrome and show a count — and it was put to
  Greg against the alternative of keeping everything. He kept everything:

  > I care mostly about what the reader sees. And a bit of junk in the structure that's getting
  > ignored seems a low price to pay for making things inspectable and undoable.
  >
  > — Greg, 2026-09-06

  **The load-bearing words are "getting ignored", and they are a requirement rather than an
  assumption.** Storing a block is not the same as every feature ignoring it, and today the 75 PLOS
  reference buttons are `gistable: true` — which is the opposite of ignored. So C4's deliverable is
  *classification that everything downstream actually honours*: out of summaries, out of the outline
  and the arc, out of the automatic AI stages — and, per `isBodyEvidence`, still reachable by chat and
  search, because *"who funded this?"* is a question about the apparatus. The cost Greg accepted is
  the residue in the structure, not a licence for the junk to keep being read.

  **The bar this sets for stage D**: inspectable and *undoable*. A reclassification the reader can
  reverse, stored rather than transient — which is [the reframe](#the-reframe-nothing-is-deleted)'s
  existing commitment, now confirmed rather than traded away.

  **A licence to delete — offered, argued against, and then spent for one narrow class.** *Greg
  delegated the call to Fable, which overrode me. What follows is the reasoning as it moved, because
  the correction is the useful part; the decision is at the end.* Greg added, the same day:

  > But if the agent is very very sure it's junk, maybe it's fine to delete it altogether.
  >
  > — Greg, 2026-09-06

  There *is* a class where that certainty is real, and it is exactly the class this plan already
  trusts: **markup the publisher authored to label its own furniture.** `.mw-editsection` is
  definitionally the edit link MediaWiki generates; `a.headerlink` is Sphinx's own anchor. Reading
  that is not a judgement about whether text looks like junk, it is reading the publisher's label —
  *rule on markup, model on meaning*, precisely. Deletion there is defensible.

  **It is still not what C4 does, for three reasons worth the paragraph:**

  1. **It buys almost nothing.** If a block is marked and genuinely ignored, the reader sees the same
     page either way. The only difference between marking and deleting is whether it can be undone —
     which is the thing Greg said he was buying.
  2. **The errors are asymmetric.** A wrong mark is visible and reversible; a wrong delete is
     invisible and needs a re-extraction to recover. And this project has been confidently wrong about
     "obviously junk" before: 260830at's ≤6-character marker rule deletes `1–0`, a bare date and a
     numeric table cell, which is why it is not in this plan.
  3. **Mark-then-delete is a one-way door taken in the easy direction.** Going from marked to deleted
     later is a policy change over data we already have. Going from deleted to restored is not.

  **Reason 1 was wrong, and Fable said why.** "Marking and deleting look identical to the reader"
  assumed marking is *available*, and for this class it is not: **the mark model is block-granular.**
  `[edit]` is an inline `<span>` inside an `<h2>`; Sphinx's `¶` is an `<a>` inside a heading. There is
  nothing to mark — the heading is either *"History[edit]"* or *"History"*. And PLOS's `ul.reflinks`
  is 26 lists interleaved one per reference, so marking them puts 26 fold placeholders *between the
  citations*, which is a worse reading view than leaving them alone. **For this class the honest
  options were always delete or leave; "mark" was never on the menu**, so reason 1 argued from a third
  option that does not exist.

  Reasons 2 and 3 survive, and are why the class stays narrow — but they are weaker than I put them:
  stage 1 keeps the fetched bytes as their own artefact precisely so extraction can be re-run without
  re-fetching, and ids survive re-extraction by contract. So "a wrong delete needs a re-extraction" is
  **the designed undo path, not a catastrophe**. What would be a catastrophe is a delete that takes an
  author's sentence with it, and that is what the guard below makes structurally impossible.

  **THE CLASS THAT MAY BE DELETED**, in `prepareDocument`, before Readability and before ids are
  minted:

  > **Platform-generated controls beside content, recognised by the platform's own selector, that
  > contain no block-level descendants.**

  MediaWiki `.mw-editsection` and `.mw-empty-elt`; Sphinx `a.headerlink`; PLOS `ul.reflinks`;
  caption toggles and skip-links where the platform names them. **The guard is markup, not shape**:
  the matched element must contain no `p, ul, ol, table, blockquote, h1–h6, pre, figure` — and for
  `ul.reflinks`, every `li` must hold exactly one `<a>` and nothing else. **If the guard fails the
  recogniser declines and falls through to marking.** It can never delete something with a paragraph
  in it.

  **What stays marked: anything that says something.** `.ambox` — the Arabic Wikipedia maintenance
  banner — is a publisher's *statement about the piece* and a reader may want it; likewise `.navbox`,
  sidebars, related-links. The adversary this plan already names, a navbox-classed real table, is
  exactly why `.navbox` is not in the class.

  **Inspectability at zero downstream cost**: record what was removed as counts per selector in the
  extraction's `meta` — `removed: { ".mw-editsection": 14, "ul.reflinks": 26 }` — which is the audit
  line stage D shows. This is the point Fable made that decides the shape: **marking's real cost is
  not storage, it is that every consumer must learn the new class** the way they all had to learn
  `supplement` — block policy, tree invariants, search, export, the client. Deleting `[edit]` costs
  nobody anything.

  Everything else in C4 still only marks: [the reframe](#the-reframe-nothing-is-deleted) promises
  leaked chrome is *stored and inspectable*, `Block` has no representation for classified hidden
  furniture yet, and **nothing else disappears until stage D's visibility exists.**

  **Publisher-authored wrappers only. Visible labels such as "View Article" are not sufficient
  selectors.** For a markup rule the adversary is *the same markup where it is content*: a
  `.mw-editsection`-classed `<div>` wrapping a paragraph, a `ul.reflinks` whose `li` holds citation
  text as well as a link, a `<footer>` inside a blockquote quoting a webpage, a misused
  `role="doc-endnotes"` — **and per C0's adversary rule a different agent writes them.**

  Two tests that are easy to leave out and are the ones that matter: `plos-biology` must keep at least
  two full citation strings, proving the references themselves survived while their controls went; and
  **the removals must be declared to the order and provenance gates as allowed exclusions**, or C0's
  instrument goes red for the correct reason and somebody spends a day on it — Sol P1-C02 arriving as
  a practical consequence.

  ##### What landed, 2026-09-06 — **C4a, the delete class, is done. The marking half is not.**

  [`src/furniture.ts`](../../src/furniture.ts) § `removePlatformFurniture`, called first in
  `prepareDocument` ([src/extract.ts](../../src/extract.ts)), with
  [`tests/extract-furniture.test.ts`](../../tests/extract-furniture.test.ts) as the gate. Four
  entries and nothing else: `span.mw-editsection`, `.mw-empty-elt`, `a.headerlink`, `ul.reflinks`.
  `Block` gained no field and no consumer learned anything, which is the whole of why this half could
  ship on its own.

  **Caption toggles and skip-links were not built.** No scored fixture contains one, and a recogniser
  nobody can measure is a recogniser nobody can tell is wrong — this stage's own rule.

  ###### The guard C4 specified is a floor, not a proof, and eleven author-text deletions got past it

  `el.querySelector(BLOCK_DESCENDANTS)` asks about **descendants**. It therefore says nothing about
  the matched element's own tag or its own direct text, and `td`, `th`, `li` and `dd` cannot be added
  to the list — a data table is rows of cells and a list is items, so declining anything containing
  one would decline `ul.reflinks` and every `<tr>` outright. Two holes were found by walking the
  corpus, one by us, and **eight by two GPT Sol reviews**, each reproduced through jsdom and
  Readability. Every one is a named test, watched red and then green.

  | The shape | What the guard then said | The narrowing |
  |---|---|---|
  | `<p class="mw-editsection">author prose</p>`, `<tr class="mw-editsection"><td>19,373,586</td></tr>` | no block descendants — delete | selector is `span.mw-editsection` |
  | `<p>The <span class="mw-editsection">author's own analysis</span> matters.</p>` | it is a span — delete | `isSectionEditControl`: a `div.mw-heading` parent that holds a heading, **and an `action=edit` link inside** |
  | `<span class="mw-editsection"><a href="/donate">Support this article</a></span>` in a heading wrapper | right place — delete | the same `action=edit` condition |
  | `<tr class="mw-empty-elt"><td>China</td>…` — **a real one is in `wiki_gdp_table.html`** | delete, out of the one table this plan exists to rescue | `isEmptyOfWords`: the class name read literally |
  | `<img class="mw-empty-elt" alt="a chart">`, `<span class="mw-empty-elt" role="img" aria-label="…">` | `textContent` is blank — delete | `matches` as well as `querySelector`, for media and for an accessible name |
  | `<span class="mw-empty-elt" title="Correction details">`, `… aria-labelledby="diagram-label">` | still blank — delete | `title`, `aria-labelledby` and `aria-describedby` join that list; no corpus instance has one |
  | `<p>See <a class="headerlink" href="#methods">the methods and their caveats</a>.</p>` | a fragment anchor — delete | the anchor must hang off a heading or a `<dt>` |
  | `<h2 id="overview">Overview — see <a class="headerlink" href="#methods">methods</a></h2>` | in a heading — delete | the fragment must **name the host or something it is inside**; 29 of 32 name the host, Sphinx's other 3 name the section |
  | `<ul class="reflinks"><li><a>Smith J (2020), the whole title</a></li></ul>` | one bare link per item — delete | `isControlStripBesideContent`: the parent `<li>` must still say something once the strip is out |
  | `<li><span class="label">1.</span><ul class="reflinks"><li><a>Smith J, the complete title</a>…` | an ordinal counts as "beside content" — delete | every anchor must carry `target`; all 75 PLOS control links do, a citation would not |
  | `<ul class="reflinks">Smith J (2019)…<li><a>View Article</a></li></ul>` | `Element.children` cannot see text nodes — delete | the list's own loose text is checked as well as its items' |

  **The shape of the second round is the lesson.** Restricting `.mw-editsection` to a `<span>` and
  `a.headerlink` to a heading proved *where* an element sits and said nothing about *what it is for*
  — so an edit span used mid-sentence and a cross-reference inside a heading both still went. The
  narrowings that hold ask the second question: a link into the edit form, a fragment that names its
  own heading, a button that opens elsewhere.

  **Not one of these narrowings changes a single count on the corpus** — the same 47, 56, 26, 39, 30,
  1, 24, 8 and 26 removals before and after, and the same output characters to the byte.

  **What is claimed, and what is not.** No shape anybody has constructed gets an author's words past
  these guards, and every one that did is pinned. Deletion is *not* claimed to be structurally
  impossible, and `ul.reflinks` is the entry where it cannot be: in markup, a *View Article* button
  and a citation whose every word is inside its link are the same thing. Three conditions bound it —
  beside a citation that still says something, one bare link per item, every link opening elsewhere —
  and the module says plainly that they bound it rather than close it.

  ###### The exposure ladder

  source candidates → accepted → removed → survivors → blocks → assertion. Every candidate in the
  corpus passes, so accepted equals removed throughout: `span.mw-editsection` 47 + 56,
  `.mw-empty-elt` 26 + 39 + 30 + 1, `a.headerlink` 24 + 8, `ul.reflinks` 26. The counterfactual both
  ways, against a checkout of HEAD: recogniser **off**, 19 `[edit]` strings, 23 Sphinx pilcrows and
  26 *View Article* / 23 *PubMed/NCBI* / 26 *Google Scholar* reach the reader; **on**, all zero. Six
  of thirty-five fixtures change a block and twenty-nine do not; `acx.html`, the 133,669-character
  free adversary, is byte-identical.

  **The gates needed no exclusions declared, and that was checked rather than assumed.** Sol P1-C02
  was right about the risk and wrong about this shape: `prepareDocument` runs *before*
  `stampSourceIds`, so a removed control is absent from the stamped source and from Readability's
  output alike, and the order and provenance gates have nothing to notice. The corpus run confirms
  it — run census `owner` 14,062 → 13,964 with every other branch at its previous number, no gate
  flips, `wiki-gdp-table`'s rows byte-identical, and `python-docs-itertools` still `PASS`.
  `plos-biology` *gains*: exclusionPrecision 0.33 → 0.67, regionPrecision 0.94 → 0.98, and its
  `View Article` / `PubMed/NCBI` complaints leave the report. It also **stops being polarity-blind**
  — 7/15 fixtures could not exercise the pair, now 6/15, because with the strips gone its reference
  list is finally a thousand-character run of body and nothing else.

  ###### The thing nobody was looking for: `.mw-editsection` was costing 28 of a Wikipedia article's 47 headings

  Ablated one selector at a time on `wiki_transformer.html`. Removing `.mw-editsection` alone takes
  the article from **h2 1, h3 12, h4 6** to **h2 10, h3 25, h4 12** — 19 headings to 47, exactly the
  number of edit links on the page. Removing `.mw-empty-elt` alone changes nothing at all (−15
  characters, no structural difference), on this page or on `wiki-gdp-table`, whose scorecard is
  byte-identical either way.

  The mechanism is Readability's, not ours: Parsoid puts the edit link in the heading's own
  `div.mw-heading` wrapper, and a wrapper of one heading plus one link scores as navigation. **So
  every MediaWiki article in the library has been arriving with three-quarters of its section
  headings missing**, and the hierarchy and the ToC have been built on what was left. That is much
  the larger effect here — the `[edit]` strings themselves were 19 blocks.

  ###### The regression that came with it, and why it is not in the shipped version

  Readability wraps the whitespace an emptied wrapper leaves, so the first version of this turned
  `wiki_transformer.html` from 1 empty block into **95**. Sol found it and was right about why it
  mattered: `gistable: false` is not invisible, `src/web/TableView.tsx` draws one row per block
  whatever the block holds, and 94 blank rows at the prose row floor is about 3,700 pixels of nothing
  to scroll past.

  `hoistEmptiedHeadingWrapper` is the answer, and it deletes nothing: when a `div.mw-heading` is left
  holding only its heading, the heading takes the wrapper's place. With it, `wiki_transformer` is 1
  empty block again, 367 blocks against a 358 baseline, and all 47 headings still come back.

  **The fix needed a fix, and Sol found that too.** `replaceWith` throws away everything the wrapper
  had, so `<div class="mw-heading admonition" id="topic" lang="ar" dir="rtl">` became a bare `<h2>` —
  losing its fragment target, its language, its direction, and (Sol ran the callout pass and
  confirmed it) its classification as a callout, because `canonicaliseCallouts` runs after this and
  knows a box by its container's classes. So the hoist is narrow five ways: only `div.mw-heading`,
  only when the wrapper's **one and only attribute is `class`** and every class on it is one of
  MediaWiki's own, only when one element child is left and it is a heading, only when the wrapper
  carries no words of its own. All 103 wrappers in the corpus carry `class` and nothing else.

  ###### Re-extracting an article already in the library churns some ids

  `exactKey` matches on text, and `History[edit]` is not `History`. Measured with `idChurn` over the
  real before-and-after: `wikipedia-transformer` 28 reminted / 19 lost of 358, `wiki_ar_ai` 55 / 3 of
  557, `plos-biology` 1 / 76 of 178. Read those two columns rather than their sum: the reminted are
  the recovered headings, which did not exist to be annotated, and the lost are the `[edit]`
  paragraphs and the 75 PLOS reference-list controls § C4 counted — the furniture, leaving.
  **Sphinx and MkDocs churn nothing**: `¶` folds to nothing, so `foldedKey`'s second pass carries
  every id, 152/152 and 53/53. `acx` and `wiki-gdp-table` are untouched. Nobody is affected until an
  article is re-extracted, which is always an explicit act.

  **Decided 2026-09-07: we do not re-extract the shelf.** Greg was offered four routes — measure what
  reader data is anchored to the blocks that would be lost and re-extract the safe majority; re-extract
  everything now; leave it; or build a per-article button — and chose to leave it. So new extractions
  are correct from C4a onwards, articles already on readers' shelves keep the structure they were
  imported with, and **an existing MediaWiki article's outline stays wrong until its reader
  re-imports it**. That is the cost of the decision, stated rather than buried: the reader who added a
  Wikipedia page last week still has 2 headings of 56. Do not open this again without a new reason —
  a reader complaint, or a re-extraction that becomes necessary for some other purpose and can carry
  the fix along for free.

  ###### The audit line is a log line, and that is a deferral rather than the design

  C4 asks for the counts in the extraction's `meta`. `Meta` is persisted as **columns** on
  `article_revisions` (`metaColumns` in [src/store/artifacts-pg.ts](../../src/store/artifacts-pg.ts),
  `metaFrom` in [src/store/pg.ts](../../src/store/pg.ts)), so that is a migration, two mapping
  functions and the export round-trip for a field whose only reader — stage D's audit line — is not
  built. So the counts ride on `ExtractResult` and reach the log, and **the honest statement of the
  consequence is Sol's: there is no historical audit until an article is re-extracted.** Stage D is
  where that trade stops being premature, and it should land the column then rather than discover
  the gap.

- **C5 — the admonition join**, ArchWiki adapter first, per correction 2 above.

  ##### What landed, 2026-09-07 — **the adapter shipped and the join did not, on the measurement**

  One line of selector in [`src/callouts.ts`](../../src/callouts.ts) —
  `[class~="archwiki-template-box"]`, with its own `CalloutShape` — plus its exposure ladder in
  [tests/callouts.test.ts](../../tests/callouts.test.ts), written red-first: six cases in, all six
  red, then the selector. **Only one of them is really a negative** — Sol counted, and it is
  `acx.html`; the other three of the "adversarial" four are positive recognition tests with a
  splitting or de-duplication assertion attached. And C0's rule is that a *different agent* writes
  the negative, which one agent cannot satisfy by ordering its own work however carefully. **A real
  adversarial set for this recogniser is still owed**, and its author must not be whoever wrote
  `CONTAINER_SELECTOR`. The test file says so where somebody will read it.

  **The ladder, on `archwiki_install.html`:** 13 source candidates → 13 accepted (7 note, 5 tip, 1
  warning; 0 skipped) → 109 stamps in the DOM → 78 surviving Readability → **17 affected blocks in 9
  contexts** → 9 of the 13 boxes reach a block that carries a context. Every rung is asserted, the
  two middle ones because Sol pointed out that without them a green could be reached with the
  endpoints intact and the mechanism gutted.

  The counterfactual is in the suite rather than in a scratch file: the same page with the class
  token misspelt, extracted and split, is **identical for all 221 blocks on tag, kind, level, words,
  gistable, note and text**, and all 221 ids carry. **It is not identical on `html`**, and the first
  draft of this section said it was. Sol compared the fields the test was not comparing and found
  four: `wrapLooseRuns` pulls the whitespace between `<strong>Note</strong>` and its sibling `<ul>`
  into the paragraph it builds. **Four block HTML strings differ and they do not all differ the same
  way** — the second draft said they did, and Sol measured it: three are `<p>` label blocks gaining
  `" \n"`, and the fourth is an `<li>` whose nested label paragraph gains only `"\n"`. It renders the
  same,
  moves no id and is not in `hashBlocks` — but an overclaim is the one thing a counterfactual may not
  have, so the four are now asserted by name.

  **`score.mts` is byte-identical, all 273 lines — and that is the whole of what it can say.**
  `archwiki-install` is in `EXTRA_FIXTURES` with no manifest, and `score.mts` scores the 15
  manifest-bearing fixtures only, so the fixture this stage is about cannot appear in that report in
  either direction. Nor would a manifest help: the card has no column for a context. The zero is the
  *"nothing else changed"* half of the counterfactual and is worth having; the positive half lives in
  the test above, and any future recogniser measured only by `score.mts` should be read with that in
  mind.

  **Three numbers that were wrong before this and are corrected in place:**

  1. `fixtures/README.md` said the page has *twelve `Note`/`Tip` boxes whose label sits before a
     sibling `<ul>`*. The twelve was **incomplete, not wrong** — 7 + 5, with the one `-warning` left
     out of the population, and Sol was right to make me soften that. The shape claim *was* wrong:
     the detached label is **4 of the 13**, the other nine carrying it inline, so the row was written
     for a shape that is under a third of the page it names.
  2. `tests/callouts.test.ts`'s header said **not one extraction fixture produces a callout block**.
     `mkdocs_tabs` produces 8, in 2 contexts, and had been doing so since before this stage began.
  3. `theme-admonition` was in `CONTAINER_SELECTOR` and had no branch in `shapeOf`, so a Docusaurus
     box fell through to `"aside"` — the one shape `isNavigation` runs on. A declared admonition that
     is mostly a link was being *skipped*, which that guard's own note says must never happen.
     Reproduced, fixed, and provably corpus-inert: no fixture carries the class.

  **The join has exposure and every way of building it today is forbidden by a rule this repo already
  paid for.** After the adapter the corpus holds **5** detached labels — `Note`, `Note`, `Tip` on
  ArchWiki and `Readable anchor links`, `Example` on MkDocs, the last two pre-dating this stage. Two
  are already `gistable: false`, and by an accident worth knowing: `BOILERPLATE_LABEL` in
  [`src/blocks.ts`](../../src/blocks.ts) matches `notes?`, so *"Note"* is excluded by a word list
  written for reference-section headings while *"Tip"* and *"Example"* are structural, embeddable,
  searchable and on the clock. Then the four candidate joins:

  - **Merge the label's text into the next block.** Churns that block's id, produces an `<li>` whose
    text begins "Note", and on MkDocs destroys a real distinction — `Readable anchor links` is a box
    *heading*, not the front of a sentence. One transformation, two different right answers.
  - **A `Block` field** saying *this is the box's label*. Correct, and the C5 brief rules it out by
    name. **It is not stage D's** — this line said it was, and the passage twenty lines below
    correctly says the plan's text does not put callout labels under stage D. Sol found the two
    sitting in one section (P1-03). The later statement is the true one: an unassigned scope call.
  - **A `Note`/`Tip` word list.** Correction 2 forbids it, and ArchWiki is precisely the page that
    proves why.
  - **`gistable: false` when a block is the short first block of a multi-block context.** This is the
    join by stamp, and it is the exact line `describeBlock` carries a paragraph of postmortem about:
    a context deciding policy, through a field `hashBlocks` cannot see. Half a day, GPT Sol, already
    paid for once.

  **Sol found the fifth option, and it is a real one.** Not a text merge and not a word list: a
  **label-specific provenance stamp** at stage 2 — `p.admonition-title` where MkDocs marks it, and,
  for ArchWiki, the paragraph `wrapLooseRuns` creates *only when the leading `<strong>` forms a
  label-only run before block content*. That reads publisher markup and position, never the word, and
  the emphasis case already in the suite (`<strong>Never</strong> run…`, one inline block) is its
  negative. Stage 3 then persists the label/body relationship as a context role or a label block id,
  and — Sol's condition, and it is the one that matters — **anything that changes policy from it goes
  into the fingerprint**, or it is the `gistable` bug again wearing a new name.

  **That is the right design and it is not this stage's to land.** It needs a `Block` representation
  and a `hashBlocks` change, and the C5 brief withheld exactly that: *not a `Block` field, not a new
  downstream concept*. Sol is right that the plan's own text does not put callout labels under stage
  D — I asserted that and it is unsupported — so this is a **scope call for Greg** rather than a
  settled deferral. **The recommendation is to take it, as its own small stage, with the fingerprint
  change in the same commit.** Until then the honest statement of where C5 stopped is: the adapter
  landed, the grouping fact is carried by `context.id`, and the label is still an ordinary block —
  one word of it, `Tip`, in the gist column of two real pages.

  **One correction to my own account of the instruments:** I wrote that `tests/callouts.test.ts` is
  the only place a context is measured at all. It is the only *extraction* instrument — no eval
  reports `Block.context` — but `tests/store-block-roles-pg.test.ts` measures synthetic contexts
  through the Postgres round-trip. Sol, and the narrower claim is the true one.

  ##### The adversarial pass, by a second agent — and the two things it changed

  The section above says a real adversarial set was still owed and that its author must not be
  whoever wrote `CONTAINER_SELECTOR`. A different agent ran it: **15 attacks, twelve mutations of
  `src/callouts.ts` each applied and reverted, every new test killed by at least one of them.**

  **The recogniser is sound.** `~=` is genuine token matching, not substring — `not-archwiki-template-box`,
  `archwiki-template-boxed` and `archwiki-template-box-note` alone all correctly fail to match.
  Nesting in all three directions yields one container and one context id. And the scoping is right
  for the right reason, checked against ArchWiki's live `MediaWiki:Common.css` rather than guessed:
  the wiki gives each kind of box its own class, and **`archwiki-template-message` — the maintenance
  banner an editor writes *about* the article, which would be genuinely wrong to set as the author
  speaking — does not carry the `-box` token**. The recogniser is scoped by intent, not merely by
  position, which is the second rule the C4a review produced.

  **1. `acx.html` proves less than this plan has been claiming, and the corpus already held the
  proof it needed.** Three places said acx was the standing negative for a callout recogniser.
  Measured — by the adversary and then again independently, because the first check I wrote was
  itself wrong — **acx contains zero elements leading with a `<strong>` label**. It says "Note" ten
  times, all mid-sentence. So it kills a rule matching the word *anywhere*, and says nothing at all
  about a rule matching a **leading `<strong>Note</strong>`**, which is the shortcut ArchWiki's own
  markup invites and therefore the rule anybody would actually write. Proved by mutation: a
  leading-label recogniser leaves both acx tests green.

  The negative that bites was in the corpus the whole time. **`rfc9110.html` has 32 paragraphs
  written exactly as ArchWiki writes a box** — `<aside><p><strong>Note:</strong> …` — and
  `mdn_cache.html` has 3, none carrying any callout class. The new test takes rfc9110's real bytes,
  renames `<aside>`→`<div>` so the markup is gone and all 32 labels remain, and asserts silence. It
  is the only test the leading-label mutation reddens. `src/callouts.ts` and
  `content-extraction.md` now name rfc9110 rather than acx. **The general lesson is worth more than
  the instance: a corpus can hold the negative you need and still not be the negative you cited**,
  and nobody notices while the recogniser is honest.

  **2. A pre-existing defect in `wrapLooseRuns`, found beside the new entry and fixed here.** A
  callout container that is *itself* a `<p>` had a `<p>` built inside it — legal to build in a DOM,
  impossible to parse back. Stage 2 serialises, stage 3 reparses, the parser closes the outer
  paragraph at the inner one, and **one paragraph reaches the reader as three blocks: the real one
  flanked by an empty block on each side**, the first carrying the callout's context. The suite
  already forbade this shape — *"does not sweep a list into a paragraph of its own making"* asserts
  no block is empty — and the assertion had never been pointed at a `<p>` container.

  ArchWiki cannot reach it: its stylesheet says `div.archwiki-template-box` and all 13 fixture boxes
  are `div`s. What reaches it is `[class~="pullquote"]` and `[class~="callout"]`, both of which a CMS
  routinely writes on a `<p>`, and **both in `CONTAINER_SELECTOR` since 2026-08-31**. The fix is one
  line — a container that cannot hold a paragraph is already the block, and `canonicaliseCallouts`
  has stamped it before this runs, so building nothing loses no stamp. The adversary left it as
  `it.fails` plus a test measuring the two empty blocks and did not fix it, which was the right call
  for an adversary; the fix turned the first green and the second red, and the second is gone. The
  guard was mutated away afterwards and the test watched go red.

  This is the same class as C4a's `hoistEmptiedHeadingWrapper` — a recogniser that leaves an empty
  wrapper behind, and a reading view that draws one row per block whatever the block holds. Twice in
  two stages, which is worth someone noticing.

  ##### The second Sol review — one P0, and it was in the fix rather than the feature

  The adapter had already had a Sol round (7 findings, all acted on). The **adversarial pass and the
  fix it produced** had not, so they got their own. Six findings, all six acted on, none overruled.

  **P0-01, and it is the one worth reading.** The first version of the `wrapLooseRuns` guard read
  `container.tagName === "P" || PHRASING.has(container.tagName)`. `PHRASING` answers *may this
  element join a phrasing run* — a question about a container's **children** — and the guard needed
  to ask whether a container may **hold a paragraph**. Different question, overlapping answers, and
  the gap is real: `<summary>`, `<legend>`, `<pre>` and every heading take phrasing content only, are
  absent from `PHRASING`, and can all carry a class, so `CONTAINER_SELECTOR`'s attribute arms reach
  them. Reproduced through the real pipeline before believing it: **`<summary class="callout">` and
  `<legend class="callout">` came back as `p` blocks with reminted ids**, and `<h2>`/`<pre>` reached
  stored block HTML as `<h2><p>…</p></h2>`. Reminted ids are the one contract
  ([block-ids.md](../../docs/project/block-ids.md)), so this was a P0 and not a tidiness note.

  Fixed with `CANNOT_HOLD_A_PARAGRAPH`, a set of its own rather than a reuse — Sol's second point,
  and the better half of the finding: coupling the two meant that adding a tag to the
  run-membership list would silently change which containers get rewritten. Four tests, one per tag,
  each watched red first and the guard then mutated back to the rejected version to watch them red
  again.

  **A test of mine that proved nothing, caught in passing.** The first draft compared block ids
  between two independent extractions. A first extraction mints ids at random, so those differ
  whatever the code does — the assertion could only ever have failed. It now extracts the plain page,
  passes those blocks as `previous`, and asks the question a reader actually lives with: *does adding
  the class remint an id that already existed?*

  **P1-01 — the new negative is better and still not sufficient**, and the test file now says which
  rule escapes it. rfc9110's labels sit in a `<p>` inside an `<aside>`; ArchWiki's sit directly in
  the `<div>`. So a rule keying on *an unclassed `<div>` whose direct first child is the label* takes
  ArchWiki's 13 and none of rfc9110's 32 or mdn_cache's 3. Measured across all 39 fixtures: **no page
  carries that shape unclassed**, so unlike the rfc9110 case there is no real page to point at and
  the negative for it is synthetic and labelled as such. The general form is worth keeping: **each
  negative rules out one rule, not the idea of keying on words.** The class is the argument; the
  negatives are only evidence.

  **P1-02, P1-03, P1-04 — three claims of mine that were not true**, all corrected in place: the
  four differing blocks do not all differ the same way (three `<p>`s gain `" \n"`, an `<li>`'s nested
  paragraph gains `"\n"`); this section asserted a `Block` field "is stage D's" twenty lines above
  correctly saying the plan does not put callout labels there; and the acx heading correction counted
  `h1` on one side and not the other — it is **139 → 19 in the `h2`–`h6` domain**, or 141 → 20 across
  all six, and the two must not be mixed. **P2-01**: the `<p>` regression asserted no empty blocks
  and the block count, so it would have passed just as happily had the fix stopped stamping the
  container altogether; it now asserts the context and the carried id.

  **One honest limitation, measured:** box 3 of the 13 survives to a block and gets no context,
  because it sits inside an `<li>` that stage 3 emits as a single block and `contextFor` resolves by
  `closest`, which reads a block's ancestors and never what is inside it. A callout nested in a list
  item is invisible to this mechanism. Boxes 4, 5 and 12 are dropped by Readability outright and
  **the stamp rescues none of them** — the answer to the open question in the brief, and not the one
  anybody guessed.

#### What is left, ranked — two reviews, and the census that decided it (2026-09-08)

With C0, C1a, C4a and C5 on `dev`, what remains is C2, C3 and C4b. Fable and then **GPT Astra** were
asked which of them is worth building, and **they disagreed**, so the tie was broken by measuring
rather than by preferring a reviewer.

- **Fable:** stage D is the real successor — it improves the reading view, arc, Summaries, Outline,
  Structure and reading time *together*, where C2/C3 improve one page shape. Drop C4b, defer C2 with
  C3 until somebody counts what C3 would recover.
- **Astra:** the opposite. **One bounded recovery stage, then leave extraction.** C3 first, narrowed
  to the data tables that are demonstrably lost; C2 only as its prerequisite and with no independent
  programme; stage D deferred *and* narrowed; C4b dropped.

**Nobody had done the count both reviews were asking for, so it was done.** Across all 35 fixtures,
classifying a table as data by the publisher's own markup — a `<th>`, or three rows and two columns,
excluding anything inside a declared `.navbox`/`.infobox`/`.ambox`/sidebar — the corpus holds **41
data tables, keeps 34, and loses 7**:

| fixture | lost | what it is |
|---|---|---|
| `wiki_gdp_table` | **2** | a **223-row** table and a 15-row table. The article is *List of countries by GDP*; **274 `<tr>` in, 1 out.** The tables are the article |
| `ar5iv` | **2** | *Table 1: Maximum path lengths…* (6 rows) and *Table 2: …better BLEU scores…* (12 rows) — the Attention paper's results |
| `hn_dropbox`, `mdn_cache`, `pg_greatwork` | 1 each | arguable: an HN comment tree and two layout-ish tables, none of them a reader's evidence |

**Four of the seven are real, and two of those are the worst kind of loss this plan can produce**:
`ar5iv` **keeps all four `Table N:` captions while dropping two of the tables**, so the reader is
told a table is there and shown nothing. That is worse than dropping both, because it looks
complete. It is also the exact failure the gates cannot see — nothing is invented and source order
is preserved, so `attribution` and `sourceOrder` both pass.

**Decision: Astra's ranking, on the strength of the census.** Four tables across two fixtures sounds
narrow and the fixture count understates it — "a Wikipedia list article" and "a paper with a results
table" are two of the commonest shapes a reader brings. Against that, stage D moves nothing a reader
has lost; it re-presents things they already have. **Losing the evidence outranks re-arranging it.**

**And Astra corrected Fable's *reasoning* on C4b, not only its conclusion.** Both say drop it, but
Greg's *"a bit of junk in the structure that's getting ignored"* line supports inspectable
classification rather than prohibiting it — and "getting ignored" is not automatically true, because
`src/block-policy.ts` currently includes untreated blocks in automatic evidence. **So C4b is dropped
on opportunity cost, not because Greg ruled it out.** The distinction matters if it is ever revisited.

**On stage D, when it comes: keep all six visibility commitments.** Fable proposed trimming the
stored per-block restore and the audit view, on the grounds they were promised to earn a
*model*-driven classification and D's is deterministic. Astra called that quiet erosion and gave the
reason that settles it: **a deterministic false positive excludes the same evidence from generated
accounts as a model's would.** The audit can be a modest list of blocks, classification and matched
rule; it does not have to be a dashboard. Astra also found a dependency that kills the "mostly
assignment" estimate — restoring an interior block of a trailing supplement collapses one supplement
group into zero, stranding it and returning the whole article as body, and a leading-run does not fix
that shape.

#### The diagnosis, 2026-09-08 — **C3 is not the reinsertion problem it was scoped as**

Before designing a repair, a spike was sent to find the *mechanism*. The answer changes the stage
completely, and it is two mechanisms rather than one.

##### A — the four tables die for saying they have headers

They are removed at [`Readability.js:1119-1128`], the `unlikelyCandidates` branch of `_grabArticle`'s
node-prep walk, **before candidate scoring begins**. The regex is

    /-ad-|ai2html|banner|…|footer|gdpr|header|legends|menu|…/i

— and it is matched as an **unanchored substring** against `className + " " + id`. So:

| the table's own class | the substring that kills it |
|---|---|
| `wikitable sortable sticky-header-multi static-row-numbers` | sticky-**header**-multi |
| `ltx_tabular ltx_centering ltx_guessed_headers ltx_align_middle` | ltx_guessed_**header**s |

`okMaybeItsACandidate` (`/and|article|body|column|content|main|shadow/i`) rescues neither. **A data
table is deleted for declaring the most table-like thing a table can say**, and LaTeXML adds
`ltx_guessed_headers` exactly when it inferred header cells — so ar5iv marks its most table-like
tables with the token Readability reads as furniture. The two ar5iv tables that survive differ by
precisely that one class token.

**Counterfactual, run twice — by the spike and again independently, changing nothing but that
substring inside class attributes:**

| fixture | tables | `<tr>` |
|---|---|---|
| `ar5iv` | 7 → **9** | 42 → **60** |
| `wiki_gdp_table` | 1 → **3** | 1 → ~~239~~ **238** |

**239 was wrong and is struck above; the number is 238** — 223 rows from the GDP table, 14
from the regional one whose fifteenth source row is deleted by our own furniture pass, 1 from the
map-legend grid. Reconciled per table by GPT Sol, 2026-09-08, which is how a document total stops
hiding a discrepancy — and re-attributed below, because Sol blamed Readability for a row of ours.

**And the navboxes stay out** — wiki goes to 3 tables, not 8. They die on a different branch
(`UNLIKELY_ROLES`, for `role="navigation"` on their wrapper) and **link density plays no part in it**,
which was this plan's assumption and was wrong. So the fix cannot resurrect them; that is measured,
not argued.

**Three consequences for the stage, and they are large:**

1. **There is no reinsertion problem.** The tables are deleted before the candidate is chosen, so they
   are neither inside nor outside it. A pre-Readability signal is enough, and *"reinsertion must
   preserve sanitisation, source order and block ids, and must not leave both Readability's fragment
   and the rescued original"* — the reason C3 was called the largest and riskiest item — **does not
   arise**. Landing is correct for free: ar5iv's sequence becomes `figcaption: Table 1…` /
   `table: Layer Type…` / `h2: 5 Training`.
2. **C2's rationale mostly goes with it.** The containment oracle was specified to verify a
   *re-attached subtree*. Nothing is re-attached. What remains worth checking is much smaller and is
   scoped in the stage below.
3. **`_markDataTables` never runs on them.** It lives in `_prepArticle`, called at line 1512 — 385
   lines after they are gone — so the `rows >= 10` rule that should have protected a 223-row table is
   never reached.

##### B — the PLOS correction notice dies somewhere else entirely

Different stage, different predicate, different fix. `_cleanConditionally(articleContent, "div")`
removes `div.amendment-citation` on *"Low weight and a little linky"* — `weight=0`,
`linkDensity=0.291`, over the `0.2` bar — where the density comes from the citation printing its DOI
as its own link text. Then, iterating backwards, the same pass reaches the **now-empty parent**
`div.amendment amendment-correction` and removes it for *"No useful content"*, taking
`<h2>Correction</h2>` with it.

So a reader of that paper is never told it was corrected: `"Correction"`, `"10 Apr 2018"` and the
correction's own DOI appear nowhere in a 26,991-character output. It is on this plan's **never-fold
list** and it is not being folded — it is being deleted, and **both hard gates pass it**, because
nothing is invented and source order holds.

**A class-weight nudge does not fix it**, which is the useful negative result: adding `content` to the
citation div rescues the inner div, and the *parent* then fails the same linkiness check at 0.276 and
the notice still goes. The deletion just moves up one level.

##### What the spike also found, and what it will not vouch for

- **Wiki's one "surviving" table is not a table** — it is the map-legend swatch grid inside a
  `<figcaption>`. **Zero** content tables survive that page, not one.
- Only **6 of ~77** lost tables across the corpus die on line 1127. Fixing it fixes these four and
  does **not** make "tables survive" true generally, and the stage below must not claim otherwise.
- Unverified by the spike and therefore not to be relied on: the *ancestor*-level form of the
  predictive rule (the self-level form had no exceptions across the corpus), the corpus-wide effect of
  `linkDensityModifier`, and the code paths of the other 71 losses.

**Deferred out of stage C, deliberately:**

- **`dir`/`lang`.** Sol P1-C06 shows it is a data-contract change, not a recogniser: correctness needs
  the *inherited* value resolved at block creation, and `hashBlocks` in
  [`source-hash.ts`](../../src/source-hash.ts) fingerprints identity, text, role and treatment — not
  direction or language, so a re-extraction can leave stored output looking current with stale
  metadata. Fable's cheaper answer reaches the reader sooner and is what we do first: `dir="auto"` on
  the prose container and `lang` on the article root is a client change of about twenty minutes that
  handles mixed-direction text with no schema field at all. The schema version waits for a reader who
  needs it.
- **Paul Graham's footnotes**, per correction 3.
- **Furniture *marking***, to stage D, per C4 — and this line said "furniture deletion" until
  2026-09-06, which is now the wrong half. C4a shipped the delete class; what waits for stage D is
  the `Block` representation for classified furniture and every consumer learning it. See § C4's
  *What landed*.

#### C3, rewritten 2026-09-08 — **tell Readability it is content, in Readability's own vocabulary**

The diagnosis above removed the reinsertion problem, so what is left is a **pre-Readability stamp**
and the check that the recovered structure is intact.

**This section was rewritten twice on the same day**, and the second time is the useful one. The
first draft proposed a broad rule and one shared class token; GPT Sol reviewed it before anything was
built and returned **three P0s, all reproduced rather than reasoned to**, one of which showed the
rule recovering navigation furniture and calling it evidence. The verdict was *"do not build C3 as
written — build less, not none"*, and it is followed. What the first draft said, and why it was
wrong, is kept below rather than deleted, because two of the three mistakes are ones this plan has
made before under other names.

##### The mechanism, and the boundary the review put on it

Both losses are Readability declining to believe an element is content, and Readability has **two of
its own escape hatches** for exactly that:

| the branch that deletes | what rescues it | which loss |
|---|---|---|
| `unlikelyCandidates` in the node-prep walk (line 1119) | `okMaybeItsACandidate` matching the same string | the four tables |
| `_cleanConditionally`'s *"Low weight and a little linky"* (`weight < 25 && linkDensity > 0.2`) | `_getClassWeight` ≥ 25, i.e. a `positive` class token | the PLOS correction |

`okMaybeItsACandidate` is `/and|article|body|column|content|main|shadow/i` and `positive` is
`/article|body|content|entry|…/i`. **Both contain `content`, and the first draft used that to do
both jobs with one token. That was a P0.** A `positive` token does not only defeat a deletion — it
adds 25 to the element's class weight, and tables are scored as candidate ancestors because their
`<td>`s are in `elementsToScore` (Readability.js:1230, 2142). Sol constructed a qualifying table with
prose either side and measured it:

| token on the table | result |
|---|---|
| `spya-keep-column` | 1,568 chars — the table is a table, both prose regions survive |
| `spya-keep-content` | 1,368 chars — **both prose regions gone**, the table promoted to top candidate and rewritten as a `<div>` |

**No fixture in the corpus has that score topology**, which is why the corpus run looked clean. This
is the exact shape of failure C0 was built to catch and the corpus could not: *a green result reached
because the case is absent.*

**So: one token per job.** Rule A uses `spya-keep-column` — in `okMaybeItsACandidate`, deliberately
**not** in `positive`, so it defeats the deletion and changes no score. Rule B uses a `positive`
token, because weight is the whole of its mechanism. Each is pinned by an end-to-end case that
asserts its intended effect **and** its candidate-scoring boundary.

**It is not a trick played on the library.** Adding a class token that says *content* is the sentence
Readability reads the class attribute in order to hear; we answer the question it asks. The token
never reaches the reader — `keepClasses` defaults to `false`, so it is stripped from the output with
every other class. The lockfile pins Readability 0.6.0, so a bump that moved either regex would turn
the end-to-end cases red rather than degrade quietly. ⟨Sol, agreeing, 2026-09-08.⟩

**It adds no forgery surface.** A hostile page can already write `class="content"` on its own junk
for the identical effect — that is Readability's behaviour, not something this introduces — so a page
pre-placing our token buys nothing it did not have. Recorded rather than guarded, and the
reserved-namespace scrub (`src/reserved.ts`) is deliberately **not** extended to it.

##### Rule A — and the false positive that shrank it

**What the first draft proposed:** stamp any `<table>` that (1) trips `unlikelyCandidates` on its own
`class + " " + id` without matching `okMaybeItsACandidate`, and (2) is a data table by a mirror of
Readability's `_markDataTables`. The argument was that this is an *ordering* bug — `_markDataTables`
is called at line 1512, 385 lines after the table is gone — so the fix runs Readability's own
judgement at the point the other branch needed it.

**Both halves were wrong, and the second half is why.**

`wiki_ar_ai` gained a table under that rule and the first draft reported it as a recovery nobody had
counted. It is `<table class="sidebar sidebar-collapse nomobile nowraplinks hlist">` — 61 links,
*"Part of a series on Artificial intelligence"*, and a taxonomy of topic links. **It is navigation.**
It matched because `sidebar` is itself in `unlikelyCandidates`, and it passed the data-table mirror
because a navigation sidebar has header cells. And `wiki_transformer` — reported in the first draft
as an honest partial failure, a stamp that fired and bought nothing — is **the same sidebar shape**,
saved only by the `role="navigation"` its Arabic twin happens to lack. Two of the first draft's three
"interesting" results were one bug wearing two hats.

**The lesson is one this plan has already written down once**, in C4's second round: *restricting an
element by where it sits proves nothing about what it is for.* A data-table heuristic is not entitled
to overrule the publisher's explicit `sidebar` declaration — `_markDataTables` exists to decide
whether a table wants accessibility treatment, not to adjudicate furniture, and asking it to do the
second is asking a question it was never written to answer.

**The rule as built, per Sol's P0-02 and P1-01:**

> Stamp a `<table>` when **`header` is the *sole* reason it matches `unlikelyCandidates`** — neutralise
> the substring `header` in `class + " " + id` and no other unlikely term remains — **and** it carries
> a non-empty `<caption>` or a `<th>`.

No mirror, and no numerical tail. All four target tables have a caption or header cells, so the
`rows >= 10 || columns > 4 || rows × columns > 10` arithmetic is never needed — and Sol showed the
mirror was not one anyway: Readability adds `rowspan` found on each `<tr>`, counts descendant `<td>`
only, and parses `colspan` with `parseInt`, three divergences that agree on all 192 corpus tables and
disagree on two constructed ones. Calling the library's private `_markDataTables` was considered and
rejected: it swaps a copied heuristic for an underscored runtime API **and still classifies the
Arabic sidebar as data**, so it buys fidelity to the wrong oracle.

**Measured across all 35 fixtures** (`data/scratch/C3-spike-corpus.mts`, throwaway; the durable
version is the corpus test):

| fixture | tables stamped | tables out | `<tr>` out |
|---|---|---|---|
| `wiki_gdp_table` | 2 | 1 → **3** | 1 → **238** |
| `ar5iv` | 2 | 7 → **9** | 42 → **60** |
| `wiki_ar_ai`, `wiki_transformer` | **0** — the sidebars, declined | unchanged | unchanged |
| every other fixture | **0** | unchanged | unchanged |

**Four tables recovered, not five**, and the corpus loses roughly 77. The stage does **not** make
"tables survive" true generally and must not be quoted as though it did.

**The 238 is right and the diagnosis's 239 was wrong**, reconciled by Sol per table: the GDP table
contributes **223** rows, the regional table **14**, the map-legend swatch grid **1**. The stage
records the per-table counts, not only the document total — a total is the number that hid the
discrepancy for a day.

**Sol attributed the missing fifteenth row to Readability, and that is wrong.** The row is
`<tr class="mw-empty-elt">` — the only one in the fixture — and **our own C4a furniture pass deletes
it** before Readability sees the page (`src/furniture.ts` § `ENTRIES`). Found by the agent building
the oracle, which needed the snapshot point to be exact and so could not accept a nearly-right causal
story. The count is unchanged and the cause is ours, which matters because the oracle's declared
normalisation is written against the post-`prepareDocument` DOM: at that snapshot the source table
has fourteen rows too, and a normalisation excusing a row nothing drops would be excusing nothing.

**The navboxes stay out**, as measured: wiki reaches 3 tables, not 8. They carry no unlikely token of
their own and die on their wrapper's `role="navigation"`, which no stamp on a table can reach.

##### Rule B — the correction notice, and only the topology that was measured

`div.amendment-citation` goes on *"Low weight and a little linky"* (`weight=0`, `linkDensity=0.291`,
bar `0.2`) — the density coming from the citation printing its own DOI as link text — and the emptied
parent `div.amendment amendment-correction` then goes on *"No useful content"*, taking
`<h2>Correction</h2>` with it.

The diagnosis said a class-weight nudge *"does not fix it"*. That is **half right**: the spike had
stamped only the inner citation, the parent then failed the same check at 0.276, and the notice still
went. **Stamping both** puts the parent at weight 25, where the bar is `linkDensity > 0.5`, and 0.276
clears it. Confirmed three ways by Sol: parent alone recovers nothing, child alone recovers nothing,
**both** take `plos_biology` from 28,004 to 28,352 characters (the figures were 28,112 → 28,460 from
an older spike, the same delta of 348 against a drifted baseline) with `"Correction"`, `"10 Apr 2018"` and
the DOI all back.

**What it recognises is the measured topology and nothing else**: an outer
`div.amendment.amendment-correction` together with its `div.amendment-citation` child. **No
registry.** The first draft proposed adding `correction`, `erratum` and `retraction` — three tokens
attested nowhere in the corpus — and defended the width by asymmetry: a wrong match only *keeps* a
block, which Greg has already priced at *"a bit of junk in the structure that's getting ignored"*.

**That argument is false, and Sol falsified it rather than disputing it.** A constructed
`div.correction` given positive weight became the preferred candidate and dropped neighbouring
genuine paragraphs. **Candidate selection is global**, so a wrong positive stamp can delete an
author's prose somewhere else on the page. Greg's licence was about junk *surviving*; it was never a
licence for a rescue that costs a paragraph. Another publisher's correction notice gets added when
somebody has a fixture for its actual topology, positive and adversarial.

##### What survives of C2 — a table oracle, and what the review made it check

Sol's precondition five stands: the ruler is text and order and **cannot see a datum moved into the
wrong row**, so a claim about a table-bearing page needs an oracle. Nothing is re-attached any more,
so it no longer verifies a rescued subtree — it verifies that the table Readability now keeps is the
table the source had.

The first draft specified matching by caption text and first-row signature, and comparing row count,
cells per row and normalised cell text at coordinates. **Both halves were too weak**, and both
corrections come with a case that defeats the original:

- **Match by provenance id, not by caption.** `stampSourceIds`/`sourceRefOf` (src/extract.ts) already
  carry exact source identity, and caption matching is fuzzy where it is not simply absent — the
  ar5iv tables have **no `<caption>`**, their labels are sibling `<figcaption>`s.
- **Compare a semantic cell projection, not coordinate text**: tag name (`th` vs `td`), normalised
  visible text, `rowSpan` and `colSpan`. Coordinate text alone passes while `<th>`s become `<td>`s,
  spans vanish, or links disappear with their text intact — and this is concrete, not theoretical:
  the recovered ar5iv Table 2 carries one `rowspan` and four `colspan`s, and stripping them would
  pass the first draft's oracle unchanged. Mutation cases that delete a span and that convert a `th`
  to a `td` must make the oracle fail.
- **Name the source snapshot point and the allowed normalisation.** Two legitimate differences exist
  in the GDP fixture alone: the regional table is 15 source rows against 14 output rows because the
  last source row is empty, and one cell's source `textContent` includes inline stylesheet text that
  `_prepArticle` removes. So: compare against the post-`prepareDocument` DOM, strip non-visible nodes
  before reading text, and allow a wholly empty row to disappear — each written down as a permitted
  difference rather than absorbed by a loose comparison.

##### What landed, 2026-09-08 — and the three places the plan above was wrong

[`src/protect.ts`](../../src/protect.ts), run **last** in `prepareDocument`, with
`kept: KeptStructure` threaded to `ExtractResult` beside `removed` and an audit line in
`src/pipeline.ts` that prints rule names and integers and is silent on the 32 fixtures that stamp
nothing. `tests/extract-protect.test.ts` drives everything through `runExtract` and
`splitIntoBlocks`.

**The measurement beat the plan three times, and the plan is corrected rather than defended:**

1. **The PLOS character counts were 28,112 → 28,460 and are 28,004 → 28,352.** The *delta* is 348
   either way, so the rule's effect was right and the baseline had drifted under it — which is what a
   number quoted from a stale run looks like when it is nearly right.
2. **"Five fixtures are stamped" was wrong arithmetic on a right conclusion.** Three fixtures stamp;
   the other two of the five are the bot walls, which stamp nothing and refuse. Thirty
   zero-stamp fixtures either way.
3. **The ar5iv landing sequence was overstated.** The plan claimed `figcaption` / `table` / `h2: 5
   Training` as a contiguous run. The first two are adjacent and always were, inside the `<figure>`;
   the `<h2>` is not adjacent and is not even a sibling — three paragraphs of § 4's own prose sit
   between them, where the author put them, and the heading opens the next `<section>`. The test
   asserts the true document order, `FIGURE, P, P, P, H2`.

**The evidence that is worth more than any of ours: a floor written by somebody else went green.**
`plos-biology.manifest.json` sets `structure.h2.atLeast: 12` and its note names the three article
sections that are gone, the 2018 correction notice first. The shipped extraction returned **11**.
With rule B it returns **12**, and the one gained is `"Correction"`. That assertion was written on
2026-09-05 for a different purpose by somebody with no stake in this stage, which is exactly what
makes it evidence rather than agreement.

**One collateral repair, root-caused rather than patched.** Recovering the notice broke two cases in
`tests/extraction-scorer.test.ts`. `region-padding-only`'s precondition needs 2,000 characters of
off-region paddable prose; `plos-biology` had **2,030**, a thirty-character margin, and was the only
fixture in the fast block that could run the arm. The recovered citation paragraph is **203** of
those characters, so moving it into the output left 1,827 and the arm stopped being exercised at all.
`mdn-cache-control` joins `SMALL_FIXTURES` with 6,971 paddable characters — three and a half times
the bar, and not sitting on a boundary anything can nudge. `plos-biology` stays for the seven arms it
still exercises.

**And an open question the stage did not settle, recorded rather than quietly absorbed.**
`plos-biology`'s `articleRegion` is `div#artText`, which does **not** contain the amendment div — so
recovering the notice takes `regionPrecision` from 0.9807 to **0.9727**. The extraction is more
correct and the instrument scores it lower. That is the ruler contradicting itself: the same
manifest's note calls the notice one of three *missing article sections*, so its prose and its region
disagree, and the region is the shortcut while the prose is the reasoning. Widening it moves numbers
this plan has published (the region's 23,330 characters and the 22,100 floor), so it is not being
changed in passing. It was the first question in the stage-end review, and it is answered below: **the gold was wrong.**

##### The fallback — a rescue that loses the author's prose is not a rescue

GPT Sol's review of the built stage refused the adversary's absolution. Its argument, adopted: an
identical table without `header` triggering the same Readability failure explains the mechanism but
does not absolve the pass, because **rule A is the action that turns a real header-named page from
*prose, missing table* into *flattened table, missing prose*** — the same failure class for which the
positive token was rejected at twelve rows.

So `readArticle` runs stage 2 a **second time with rule A off** whenever rule A stamped a table, and
ships the control arm if the treatment lost prose. The control keeps rule B running — a
`ProtectOptions` parameter rather than the test-only module seam — so a rolled-back page still gets
its correction notice. `kept` then says `a-table-called-header-rolled-back` **in place of**
`a-table-called-header`, and the existing audit line carries it with no change, because it iterates
whatever keys are there.

**The obvious criterion is a length comparison and it is wrong**, which is the part worth keeping:
in the case that caused all this the bad arm was the *longer* one — 3,726 characters of flattened
rows against 801 characters and four paragraphs. Length scores the disaster as an improvement. What
is compared instead is **containment**: every paragraph-level run in the control must appear
somewhere in the treatment's text. `proseRetention` returns three numbers and no text, so a caller
logging its result cannot log the article — [logging.md](../project/logging.md)'s rule made true by
the signature rather than by remembering.

**And the obvious floor is wrong too, which is the finding.** Written with Readability's own
25-character scoring threshold, the criterion **fires on a real corpus fixture**: `wiki_gdp_table`'s
treatment loses one control run — *"From Wikipedia, the free encyclopedia"*, 37 characters, written
as `<div id="siteSub" class="noprint">` and rewritten by Readability as a `<p>`, dropped because
`_cleanConditionally`'s arithmetic moves with the article's total score and the article had just got
237 rows longer. At 25 the fallback would have withdrawn that page's four recovered data tables **over
one line of site chrome the publisher had already marked as not for print.**

The floor is **100** characters for that reason, and the reason is in the constant's own comment. At
100: `wiki_gdp_table` compares 24 runs and loses none, `ar5iv` compares 111 and loses none, the
24-and-40-row synthetic loses all four. **What it gives up is named in the same place**: a page whose
prose is all short has little above the floor, so a catastrophe there is invisible to this check. The
trade runs this way because a check that fires on chrome costs a reader four tables on a page that
was fine.

**Cost, measured**: `wiki_gdp_table` 4.6s against 1.7s for a single arm, `ar5iv` 3.3s against 1.4s,
`plos_biology` unchanged because rule B does not trigger it. Two fixtures in thirty-five pay it, in a
batch stage nobody is waiting on. **The fallback fires on no corpus fixture**, and the three stamped
fixtures come out byte-identical to before it existed.

**One divergence, named rather than left to be discovered.** `readArticleWithProvenance` does not run
the fallback, so on a page that rolled back the eval instrument would report the extraction we did
*not* ship. It fires on nothing today, and it is exactly the class of defect this stage exists to
kill — an instrument measuring something other than what a reader gets. Recorded in that function's
own `kept` doc and put to the reviewer as the narrow check of this fix.

##### The rest of the second review, fixed and measured

- **The ancestor guard was worse than reported.** `_hasAncestorTag` inspects four ancestor levels and
  line 1121 passes no depth, so **one `<div>` between a layout cell and a data table is already
  enough**: measured before the fix, the table was declined *and deleted* — `kept: {}`, zero tables.
  The guard now walks four levels; the shallow and beyond-depth cases are both pinned. Swept all 35
  fixtures for a table where the two guards disagree: **none**, so no corpus number moves.
- **The exposure ladder's first rung disagreed with the shipped rule.** `sourceCandidates` still used
  the substitution the adversary had disproved, and said *sole* where the real rule said *not sole*
  on `headerelated`. It now tests each live unlikely alternative except `header` against the original
  string — still derived from the library rather than from our copy, so the two cannot drift into
  agreeing wrongly — with `headerelated`, `headerss`, `headeremark` and `headereplies` all requiring
  zero, beside a header-sole positive control.
- **Rule B narrowed to `:scope > div.amendment-citation`.** PLOS writes it as a direct child,
  measured. The test that had required a citation buried in an unrelated `<aside>` to *qualify* — a
  deferral wearing a contract — now requires it to be **declined**, with a direct-child control
  beside it, and the comment names what would widen it again: a real publisher fixture with a wrapped
  citation, with treatment and control both measured.
- **Regex parity compares flags as well as source.** Said plainly in the report: this assertion
  **cannot be red today**, because both are `i`. It is a tripwire for a future bump, not a fix for a
  live defect, and calling it a fix would be the overstatement this section keeps catching.
- **A false claim removed**: an element cannot qualify for both rules, because rule A selects
  `<table>` and rule B selects `<div>`.
- **A fixture lead recorded and not built for**: a detached `table#header` holding `<th>` cells beside
  a separate data table would be stamped as an incomplete header shell. Sol found the construction
  and reproduced no reader failure from it.

**Red before green, checked by reverting.** All four source fixes were reverted at once and the file
run: **5 failed, 30 passed**, and the five were exactly the new and changed cases — the `headerelated`
rung, the four-level mirror, the row sweep (`expected +0 to be 4`, so the prose really was gone), the
nested-notice count, and the buried-citation flip. The measurement probes were written before the
source changes, so the pre-fix numbers here are measurements rather than reconstructions.

##### The narrow re-check — the fallback's own guard had the bug in it, twice

Under [engineering-manager.md](../reusable/engineering-manager.md), discovery closes after two rounds
but *"an established P0 whose final fix was not in the round-two snapshot still gets a narrowly
scoped check of that fix."* P0-01's fix was written after round two, so it got one. **The verdict was
not ready to land**, and both findings were reproduced rather than argued.

**The floor was tuned to a fixture, and that is the honest description of it.** `PROSE_RUN_FLOOR = 100`
was chosen because 25 fired on `wiki_gdp_table`'s *"From Wikipedia, the free encyclopedia"*. Sol built
a header-named 24-row table beside **eight distinct authored paragraphs of 99 characters each**: the
control returns all eight, the treatment returns none of them and 1,781 characters of table, and
`proseRetention` reports `{ runs: 0, lost: 0, retained: true }` — **so nothing rolls back and the
reader loses the page.** Short news paragraphs, Q&A answers, list prose, poetry and concise technical
documentation all live below 100. The floor was a statement about nothing; the exclusion has to be a
statement about what the markup says, and the publisher already made it — `#siteSub` carries
`class="noprint"`. Back to 25, with the chrome excluded semantically.

**And rule B deletes prose on a path the fallback cannot reach.** The second arm runs only when rule
A stamped, so `rescued === 0` returns immediately. Sol reproduced it on the exact accepted topology —
`div.amendment.amendment-correction` with a direct `div.amendment-citation`, **no qualifying table
anywhere**, four authored paragraphs beside it: the stamped notice won candidacy and every paragraph
went, 675 characters against 1,031 with protection off, and `kept` said the notice was recovered.
**This is the plan-stage positive-token failure, still reader-reachable after the selector was
narrowed** — the same defect, at its third address.

**The declared divergence was not dead after all.** `readArticleWithProvenance` skips the fallback,
and this was recorded as harmless because no corpus page rolls back. Sol ran it against the
fallback's **own committed construction**: `readArticle` returned four prose markers and
`a-table-called-header-rolled-back`, the provenance arm returned zero markers and
`a-table-called-header`, 1,323 characters against 3,805. So the eval harness's *"shipped"* arm
already inspects an extraction we discard. It closes in this stage.

**What Sol confirmed as sound**, and it matters that the list is not empty: the four-level ancestor
mirror, including the off-by-one (depths 0–3 are parent levels 1–4, and it returns false before
level 5); the exposure oracle's independence, deriving its alternatives from the live library while
the shipped rule uses the pinned copy; `:scope > div.amendment-citation` against the measured PLOS
topology; and the gold widening — with a correction to the argument for it. **The two-arm measurement
alone does not disprove gerrymandering**, because a region drawn around treatment-only output would
score the same favourable direction. What makes it sufficient is the *combination*: the two arms, the
pre-existing annotation that counted *Correction* among the article's twelve `<h2>` before this stage
existed, the single-root selector, and the region-size tripwire that went red. Recorded because the
weaker version of that argument is the one this stage nearly shipped.

###### What closing them took, and the one place Sol was wrong

**No corpus fixture moves.** The three that stamp are byte-identical to before any of this, verified
independently of the agent that made the fixes — and the census is now a *stricter* one: dropping the
floor from 100 to 25 took `wiki_gdp_table` from 24 prose runs under scrutiny to **58**, and it still
loses none.

- **The floor is 25 and the chrome is excluded by markup.** `notForPrintText` reads the flattened text
  of `.noprint` elements off the **pre-Readability** document — Readability strips the class that says
  so — and a run contained in one of those is not the author's. **`.noprint` only**: `no-print`,
  `hidden-print` and `d-print-none` were considered and left out for the same reason `erratum` was
  left out of rule B. An unmeasured token here is a rollback that should fire and does not.
- **Both rules are under the control now.** `controlOptionsFor(kept)` switches off exactly the rules
  that fired, so a page where only rule A stamped still gets its correction notice in the control arm.
  Where both fired and prose was lost, **both are withdrawn** — the coarse answer, taken deliberately:
  separating A's fault from B's costs a third and fourth Readability run for a shape no fixture has,
  and it costs a rescue rather than a paragraph.
- **The provenance divergence closed by construction rather than by a test.** `readArticle` and
  `readArticleWithProvenance` are now one shared generic over two arms, so there is no second copy of
  the decision to drift; the byte-equivalence test is there as well, on both a rule-A and a rule-B
  rollback page.

**And Sol's rule-B reproduction did not reproduce.** Its construction used `<section>` wrappers; the
loss needs `<article>`. **There are two reasons and the first account gave only one**: `<div>` is
worth +5 in `_initializeNode` where `<article>` has no case at all, *and* `section` is itself in
`DEFAULT_TAGS_TO_SCORE` (Readability.js:128), so a `<section>` wrapper is scored and feeds its parent.
Both verified directly; the second was Fable's, checking a sentence this plan had stated as though it
were complete. The defect is real and was found by
sweeping for the shape that does it — 520 characters and no prose against 1,508 with protection off —
but **the reviewer's own repro was wrong**, which is the fourth time in this stage that checking a
report beat believing it.

Cost of the second arm, measured on a loaded box so read the ratios: `wiki_gdp_table` 6.0s against
1.9s, `ar5iv` 2.8s against 1.5s, `plos_biology` 1.5s against 0.7s. Three fixtures in thirty-five, in
a batch stage nobody is waiting on.

###### The pattern across three reviews — as first written, and as Fable corrected it

**The first version of this section said every defect had been in a guard rather than in the feature,
and that the recogniser had been right since the first measurement. That is false**, and Fable said
why: the `headerelated` substitution was *in the recogniser*. `headerIsTheSoleUnlikelyTerm` is the
predicate that decides what rule A recognises, *"neutralise `header` and re-test"* was its definition
of **sole**, and it was wrong in a way that cost a whole page. Kept here rather than quietly
rewritten, because a comforting story about one's own code is worth recording as a thing one reached
for.

**"The defect rate is falling" does not survive either.** Round one: 3 P0. Round two: 4 P0. Round
three: 2 P0 and a P1 — on a review deliberately narrowed to a single fix. **Fewer findings from a
narrower scope is what narrowing does, not convergence.**

What genuinely converges is **where the findings sit**: the recogniser recovering navigation
furniture → a guard missing a case → a guard's *threshold* being wrong. That is a weaker claim than
the one first written here and it is the true one.

**And the two rules are not the same kind of thing, which the first version blurred.** Rule A removes
an *accidental penalty*: its effect is the page Readability would have produced had the publisher not
written `header`, and its failure mode — a 24-row table beside thin prose — is Readability's ordinary
behaviour on `wikitable sortable`, which ships on every Wikipedia table page today. It enlarges an
exposed set; it does not create a hazard class. **Rule B is an affirmative `+25`**, and the plan had
already rejected a registry because a positive token displaced prose — then Sol showed the *accepted*
two-token topology doing the same. So **rule B is safe only under the fallback**, and what keeps it
acceptable is exposure rather than design: two PLOS class names, on a platform whose body is tens of
thousands of characters and never lets a notice win.

###### The residual class, and the rule that stops this stage reopening

Textual containment has an unbounded false-negative surface by construction, and Sol accepted its
general shape in round three — *"acceptable only if the invariant is explicitly 'words retained
somewhere'"*, which `proseRetention` now says outright. The known instances:

- prose runs under the 25-character floor — poetry, dialogue — beside a rescued table;
- article prose that happens to sit inside a `.noprint` container, which the exclusion then makes
  invisible (the guard uses bare `.noprint`, wider than the `#siteSub.noprint` Sol proposed);
- prose the control keeps in a container outside `PROSE_RUN_TAGS`;
- a paragraph duplicated in a footnote or a table, whose main occurrence can go while the identical
  string elsewhere keeps the check happy.

**The stopping rule, written down so the next reviewer does not restart the loop: a further
constructed instance of this class is not a P0 and does not reopen the stage. A real page that loses
prose does.** ⟨Fable, arbitrating under
[engineering-manager.md](../reusable/engineering-manager.md)'s *settle it through Fable or Greg*
clause, 2026-09-08.⟩

**Why the fallback stays**, against the honest case for dropping it and shipping the recogniser bare:
nothing would ever show it was needed. The loss it guards against is **silent to the reader** — a page
of table rows instead of an article — and there is no control arm in production, so the
`…-rolled-back` key in the audit line is the only production instrument for this class at all. And
its errors are asymmetric: a false rollback costs a rescue, which is the status quo; a missed loss
costs prose, which is the bare feature. **Every fallback bug is therefore bounded by "the bare
feature", so dropping it cannot be safer than keeping it.**

##### The gold was wrong, and the test that says so is the one that could have gone the other way

`plos-biology.manifest.json`'s `articleRegion.within` was `["div#artText"]`, and the amendment div
sits outside it — so recovering the correction notice counted as text from outside the article and
took `regionPrecision` from 0.9807 to **0.9727**. The extraction got more correct and the instrument
scored it lower.

The manifest's own prose had said otherwise since 2026-09-05: all twelve source `<h2>` are article,
*Correction* listed first, three article sections gone with the notice named among them, and
`structure.h2.atLeast: 12` set on that basis. **Its prose and its region disagreed**, and the region
was a DOM shortcut — `div#artText` is what PLOS puts the *body* in, not the article.

`within` gains `.article-content > div.amendment.amendment-correction`, which matches exactly one
element in the prepared source and in the raw bytes, whose class list is PLOS's own. Reproduced
independently of Sol, every figure agreeing: region 23,330 → **23,521** characters, credited 22,659 →
**22,850**, `articleRecall` 0.97124 → 0.97147, `regionPrecision` 0.97270 → **0.98090**, and
`minArticleChars` 22,100 → **22,300** by the manifest's own recorded policy of *the region less 5%,
rounded down to 100*.

**Widening a region so your own extraction scores better is gerrymandering**, and this one has the
suspicious shape in full: the correction root holds 191 characters in 5 stamped elements and the
extraction returns all 191, so recall inside the root is 1.000 and the widening **costs nothing**. A
costless widening is exactly what a rigged one looks like. So the defence is not the argument, it is
this measurement — both regions against both arms, the second arm being the extraction as it shipped
until 2026-09-08:

| | protect OFF | protect ON |
|---|---:|---:|
| corrected region, `articleRecall` | **0.96335** | 0.97147 |
| corrected region, `regionPrecision` | 0.98074 | **0.98090** |
| current region, `regionPrecision` | 0.98074 | 0.97270 |

**The corrected region punishes the extraction that drops the notice.** The old region was the only
one under which recovering it made the score worse. A gerrymandered region rewards its author's arm
and is indifferent to the other; this one ranks the two arms in the order the manifest's prose
already said they should be ranked, and it was chosen from the source rather than from the output.

**The tripwire fired, which is the other half of the evidence.** `tests/extraction-scorer.test.ts`
pins `REGION_CHARS["plos-biology"]`, with a comment saying a widened region must go red rather than
pass quietly. It went red. The pin moved to 23,521 with the reason written beside it.

**And a clause that has quietly stopped doing anything**: `except: ["ul.reflinks"]` matches **zero**
elements in the prepared source and 26 in the raw bytes, because C4a's furniture pass now removes
them before the region is resolved. It is harmless and it is left alone, but its `why` describes work
it no longer does — recorded here rather than tidied, because the next person to read that `why` will
otherwise believe it.

##### The adversarial pass, by a different agent — three defects, and one of them lost the article

C0's adversary rule, applied: the agent that attacked `src/protect.ts` did not write it and was
briefed to break it rather than confirm it. It found three defects, all **red before the fix and
green after**, each verified by mutating the source back and reading the failure message — and the
other seven adversarial cases stayed green under the same mutation, which is what makes each one
about its own defect rather than about the pass being off.

**1. The neutralisation could be defeated by an overlapping term, and the cost was the whole page.**
The first fix replaced `header` with a space and re-tested, arguing that a space cannot be part of
any unlikely term so nothing could be *glued* into existence. True, and the wrong question. **The
danger was destruction, not creation.** `header` ends in `r`, and `related`, `remark`, `replies` and
`rss` all begin with one, so `headerelated`, `headerss`, `headeremark` and `headereplies` each
contain a *second, genuine* unlikely term sharing that letter — and removing `header` removed it
too: `"headerelated".replace(/header/gi, " ")` is `" elated"`, which matches nothing.

Measured through `runExtract` on a page carrying `<table class="headerelated">`: the pass stamped it,
Readability kept it, it won candidacy, and the output was **3,726 characters of flattened rows with
all four paragraphs of prose deleted**, against 801 characters and four paragraphs with the pass off.
Not junk kept — **the article lost.**

The substitution is gone. `UNLIKELY_EXCEPT_HEADER` is `unlikelyCandidates` with its one `header`
alternative removed, derived from the pinned copy and asked of the **original** string, so the join
hazard is impossible rather than argued about. Verified independently: the literal `|header|` occurs
exactly once in the source, `headerelated` and `headerss` now decline, and both real tables and the
Arabic sidebar are unchanged.

**2. `kept` overstated what rule B stamped.** `querySelector` reaches through a nested
`div.amendment.amendment-correction`, so an outer notice and an inner one can resolve to the *same*
citation element, and `notice += 2` per outer counted that element once per notice that found it. A
document with two inner notices under one outer reported **6 for 5 elements actually stamped** — in
the one field whose own docstring says the unit is elements stamped. Now a `Set` of what was actually
stamped, so the unit is true by construction rather than by arithmetic that happens to agree.

**3. Rule A counted rescues that rescued nothing.** Line 1119 carries `!_hasAncestorTag(node, "table")`
and `!…(node, "code")`, so a table nested inside either is never reached by the deletion rule A exists
to defeat. The pass stamped one anyway and reported it. The stamp was harmless — `KEEP_COLUMN` moves
no score — but **the number was not**, and a count that reports work nobody did is the exact shape of
the failure this stage is about. Readability's two ancestor guards are now mirrored.

##### The claim the adversary corrected, and it is the honest one

The header comment's two-token table read `spya-keep-column` ⇒ *the table is a table, both prose
regions survive*, against `spya-keep-content` losing them. **That was a reading of one page with
twelve body rows.** At twenty-four rows the weightless token produces the identical catastrophic
card — table flattened to a `<div>`, every paragraph gone. **A weightless token does not make a
rescue safe**: a rescued table is a table that gets *scored*, and thin prose beside it loses.

The mitigating half was checked rather than assumed. The same page with `class="wikitable sortable"`
— a string Readability never disliked, nothing stamped — loses the same four paragraphs at the same
row count, to the character. **So this is Readability's arithmetic and not ours**, and rule A is
faithful in the only sense available to it: it hands the page the extraction it would have had if the
publisher had not written `header`, bad outcomes included. Both readings are in the comment now, and
a swept test pins 12, 24 and 40 rows with its own control.

##### What the adversary could not do, said plainly

- **`headerelated` has no known real-world instance.** The defect and its consequence are measured;
  the likelihood is not. A sharp edge with no known page on it.
- **The seam has a hole nothing pins.** `withProtectionDisabled` restores in a `finally` after
  `await fn()`, so a callback returning a **non-promise thenable that never settles** leaves the pass
  disabled permanently — reproduced in a scratch script, deliberately not written as a test, because
  reproducing it inside the suite would disable the pass for every test after it and there is no
  exported way to force the flag back. Nothing in the repo passes a thenable, and the comment claims
  only that a *throwing* case is safe, which it is.
- **Rule B's citation lookup is wider than its measured topology** — `querySelector` finds a citation
  anywhere beneath the notice, where PLOS writes it as a direct child. Left wide and pinned: no
  construction made the width cost anything, and `:scope >` would decline any publisher who wraps the
  citation once more. If a page is ever found where it costs prose, that pinned test is the one that
  flips.
- **No rule-B shape was found that costs a paragraph**, in three serious attempts. That is a failure
  to break it, not evidence it cannot be broken.
- **One sentence is narrower than it reads.** *"The token never reaches the reader"* holds, but
  `readArticleWithProvenance` snapshots the prepared DOM into `sourceHtml`, so the tokens do reach
  the eval harness's provenance artefact. No eval instrument reads class names, so nothing measures
  differently — grepped, not assumed.

###### What the oracle turned out to need — built 2026-09-08, and it corrected its own brief

[`evals/extraction/table-oracle.mts`](../../evals/extraction/table-oracle.mts) and
`tests/table-oracle.test.ts` (20 tests). Matching is by provenance id through `sourceRefOf`, and an
output table is accepted **only when the id resolves to a `<table>` in the source** — a `descendant`
resolution that lands on a `<tbody>` is reported *untraceable* rather than quietly matched, which is
the abstention-shaped green C0 exists to refuse.

**The four-field projection this section specified cannot detect one of the mutations it demands.**
Delete a link and leave its text, and tag, normalised text, `rowSpan` and `colSpan` are all
unchanged. So the projection carries a **fifth** field, the resolved hrefs in the cell, and the test
asserts that mutation produces `cell-links-differ` and **no** `cell-text-differs` — the second half
being what proves the fifth field is doing the work rather than riding along.

**Cell text never leaves the module.** A text difference reports character counts and an eight-hex
digest, which is enough to show two cells swapped — each new digest is the other's old one, and the
test asserts exactly that — and not enough to reconstruct an author's prose.

**The normalisations are data, not judgement**, exported as `NORMALISATIONS` with a test asserting
the list is exactly three, so a fourth is a deliberate act rather than a loosened comparison:
`empty-row-may-vanish`, `non-visible-nodes-stripped`, `whitespace-collapsed` (no case folding).
Hidden-but-present nodes are deliberately **not** normalised — there are zero inside the corpus's 192
source tables, and widening an oracle for a case nobody has is how an instrument stops being able to
fail.

**Corpus reading, 2026-09-08**, with C3's recovery in: `wiki-gdp-table` 3 of 3 traced tables agree,
`ar5iv` 9 of 9 agree. Across 19 table-bearing fixtures, 118 traced, 65 agree, 53 differ, 74 source
tables absent from the output, 0 untraceable. **The 53 are almost all `hn-dropbox` comment tables and
one `blogger-bldgblog` sidebar cell Readability empties** — real losses, reported rather than
absorbed, and the number to watch is that it did not come out as zero.

##### How it is proved — the ladder, the counterfactual, and the adversary

Per § *How every recogniser is proved*, each rule carries an **exposure ladder** (source candidates →
elements stamped → survivors after Readability → blocks affected → the assertion that changes), a
**counterfactual** through a mutation seam so the positive fixture is red without the pass and green
with it, and an **adversarial negative written by a different agent** (C0's adversary rule).

Three things the review adds to that, each closing a hole it found:

1. **A candidate-scoring boundary case for every token.** Rule A's must assert that the table stays a
   `<table>` and that prose on both sides survives — the case that caught P0-01, and the corpus
   cannot supply it.
2. **Both Wikipedia sidebars are standing negatives**: `wiki_ar_ai` and `wiki_transformer` assert
   **zero stamps and byte-identical output**. They are the fixtures that caught the broad rule.
3. **The corpus residual test runs both arms.** The first draft's spike did not — for a zero-stamp
   fixture it assigned the treatment result from the control and compared three counts, which is a
   check that cannot fail, in a stage whose subject is checks that cannot fail. Sol replayed the real
   `prepareDocument` sequence with the pass inserted and compared whole article objects: **all 30
   zero-stamp fixtures byte-identical** — 30, not the 31 the first draft claimed, because five
   fixtures are stamped, not four. The durable test executes both arms, compares `extractedHtml`
   bytes, and asserts the typed refusal separately for `medium_about` and `pmc_article` rather than
   letting an exception become a `-1`.

Done when: both rules ship in `src/protect.ts`, wired into `prepareDocument` and proved through the
real pipeline rather than by calling the pass directly; the recovered tables are asserted through the
oracle with per-table row counts; the corpus residual is byte-compared on both arms; and
`docs/project/content-extraction.md` records the mechanism, the four tables, and what the stage does
**not** fix.

#### The one place the reviewers disagreed — decided, not left open

**Superseded 2026-09-06. This section recorded the disagreement as settled in Sol's favour and left
it as a product call for Greg; Greg delegated the call to Fable, and Fable reversed it.** The decision
and its reasoning are in **C1a** above, and the short version is that both Sol and I had mis-classed
the rule: a *capability floor* decides nothing about any piece of content, so the negative fixture the
plan demands is not impossible but irrelevant. The claim recorded here — that Medium's 404 page must
reach the shelf and spend a slot — is no longer the accepted cost of anything, because C1a refuses it.

Kept rather than deleted, because **the mistake is the useful part**: the plan's own rule was applied
to something it was not written about, and the argument that unblocked it was to ask what the rule was
*for*. The next reader meeting an apparently-forbidden rule should ask that before accepting the
prohibition. Also kept because the numbers here were wrong and are worth correcting: the Medium
fixture's visible text is **185** characters, not 281, and the PMC wall's is **130**.

#### How every recogniser is proved — Sol P2-C08, adopted

Positive and negative fixtures are necessary and not sufficient. Each recogniser carries an **exposure
ladder** — source candidates → accepted matches → DOM mutations and stamps → survivors after
Readability → affected blocks → changed assertion — and a **counterfactual**: disabled, the positive
fixture fails; enabled, it passes; against the adversarial negative it does not fire and the output is
unchanged but for explicitly allowed normalisation.

This is aimed at the failures this repo actually has, all of which look identical to success from
outside: the selector never matches; it matches but Readability discards the repaired node; the stamp
exists but never reaches the blocks; the new refusal never becomes `Candidate.refused`; `dir`/`lang`
works only when explicit on the leaf; table text survives under the wrong row; a furniture rule takes
neighbouring genuine content with it; **and the recogniser runs in its unit test but was never wired
into `prepareDocument`.**

#### How this stage may use the ruler — the five preconditions, operationalised

Sol's check of stage C against § B's preconditions found one violated as written and two not
operationalised, so they are written into the acceptance rule here rather than left as prose:

- `articleRecall` and `regionPrecision` are quoted **baseline-relative only** — an arm against the
  shipped card, never one extractor's recall against another's, and 0.50 is a gross-padding backstop
  and not a quality line.
- **Acceptance reads each gate and its non-null exposure explicitly.** "The corpus shows the residual"
  could otherwise be implemented on `assertionsPassed`, which excludes the gates by design and is
  therefore blind to reordering, duplication and invention.
- **A claim about a table-bearing page needs C2's oracle** or a recorded manual evaluation. This was
  the violated one: it is why C2 precedes C3.

Done when: every recogniser has its pair, its exposure ladder and its counterfactual; the corpus shows
the residual each leaves; and the bot-wall behaviour is implemented as the typed refusal above.
**That residual is the denominator** any future model arm is measured against — never stock
Readability, which 260827ab measured as a 79% overstatement.
### D — The apparatus, in the product

The mechanism exists and the consumers are already wired; this is assignment, one generalisation, and
the visibility Greg committed to.

1. Widen `Block.role` by `frontmatter | bio | licence`; three lines in `supplement.ts` § `TITLES`;
   one additive migration widening the CHECK constraint.
2. A **stage-2 markup recogniser** beside `canonicaliseNotes` and `canonicaliseCallouts`, stamping
   through `reserved.ts`. DPUB-ARIA `role="doc-acknowledgments" | doc-colophon | doc-credits |
   doc-bibliography | doc-endnotes | doc-appendix | doc-toc` maps one-to-one, plus `<footer>` inside
   the article and Gutenberg's sentinels — each with its adversarial negative, per stage C's rule.
3. A **stage-3 heading recogniser**: a heading matching a closed list — *Acknowledgments*,
   *References*, *Notes*, *About the author*, *Licence* — marks the run to the next heading of
   equal-or-shallower level. A text rule, so it ships with its negative control: *"Notes on method"*
   must not match.
4. `splitBlocks` learns a **leading** run as well as a trailing one. Today it takes only the maximal
   run ending at the last block, and everything else falls back with `stranded` non-zero — front
   matter is a leading run, so without this it strands and the acknowledgements get gisted into the
   argument. At most two depth-one nodes. **A mid-body run still falls back**, and since a recogniser
   can produce one, the fallback must be reported rather than silently changing policy without
   producing the promised fold.
5. **The fold, and the six visibility commitments** from
   [the reframe](#the-reframe-nothing-is-deleted). One chrome row per run at its own position, the
   author's heading verbatim as the label, an honest checked count, opening to the prose as written.
   Default-collapsed is *derived* from `treatment`; the reader's open/close is a separate transient
   set, per summaries.md's rule that "too deep to show" and "I closed this" never share a variable.
   The restore is a **stored reclassification**, not an expand — that distinction is the whole point
   of the commitment.
6. Where `articleWithIds` renders a supplement block on a **request path**, prefix its role —
   `[acknowledgment]`. `isBodyEvidence` already draws this line correctly: automatic stages exclude
   the apparatus, chat and search include it, because *"who funded this?"* is a question about the
   acknowledgements.

**What must never be folded, whatever assigns it:** the author's dated updates, corrections and
errata — the Aaronson case, and the class the last plan's model got wrong on real pages; abstracts
and standfirsts the author wrote; epigraphs and dedications; anything already inside the author's own
`<details>`; and any heading. A keep-list and a test, not a `role`.

**One contradiction to settle here rather than discover later**, found by Sol: a role heading both
identifies the run and supplies the fold label, yet "any heading" is on the never-fold list. Decide
explicitly whether the heading stays body evidence, joins the supplement, or serves as a visible
boundary outside the folded run — and write it down.

Done when: a reader sees the piece front-and-centre and the apparatus present but quiet, **and** a
reader who suspects something is missing can find it — checked in a real browser, with the six
commitments each asserted, not just observed.

## Typo fixing — declined, with the deterministic half kept

Greg asked for it explicitly:

> It should also be allowed to add metadata to blocks … It should also be allowed to make small
> changes (e.g. fix typos, niggles). And anything else low-risk/that we can trust the model to get
> right, and that we can test with evals
>
> — Greg, 2026-09-04

The concern, in a sentence each. Changing a word re-mints the block's id, which on a **re-extraction**
silently orphans every note and highlight anchored there — that is data loss with no error, and it is
why both prior plans ruled out rewriting. And correcting an author's published prose is an editorial
act we cannot check: for a web article there is no independent witness, which is the exact problem
the PDF stage spends its whole design budget on and it *has* a text layer.

**But most of what Greg is pointing at is not the author's typos — it is our own damage.**
`"Visual Journalism teamBBC News"`, `"By \n \n Natalie Wolchover\n \n \nDecember 17, 2024"`, `"CC++"`
from two glued tab labels, a heading with a zero-width space baked in: the author typed none of
those. So the plan takes the product tweak that removes most of the engineering — **repair our
damage, deterministically; leave the author's words alone.**

Concretely, the carve-out is **transport damage**, not typos: mojibake (`â€™` → `’`), doubled spaces,
soft hyphens, zero-width characters, double-decoded entities. Not the author's words but what the
wire did to them; a deterministic table, identical every run; and `normalize` already keys the same
before and after, so **ids carry**. That belongs in stage 3's normalisation, not in the repair
schema.

Author-facing text edits are declined, and Fable's product argument is stronger than the id one:
**Quotes** copies lines worth keeping, and a corrected quote is a misquote with our name on it;
**Referee mode** would show a reviewer a manuscript that was not submitted; **search** for the
misspelt term fails on our copy; and for older texts spelling *is* the text — Whitman and Shakespeare
are both fixtures. Greg's own condition was "that we can test with evals", and that condition cannot
be met here: the gold for a typo fix is what the author intended, which is the one gold that does not
exist. If typos bother readers, the feature is **flag, don't fix** — a hover `[sic]` — and it is not
this pass. Recorded as Greg's call to overrule; the id-churn counter lands in stage A either way, so
the question can be reopened against a number rather than a worry.

## What this plan deliberately does not build — the model repair pass

Greg asked for it and it is coming; it is not in this plan because the review showed it is not yet
designable, and building it anyway is how the last two plans got their conclusions overturned.

Sol's finding, reproduced in its detail and accepted: **the operation layer has no coherent execution
model.** There are two graphs — `blockId` from the provisional split, `sourceId` from the original
DOM — and the plan never defined the mapping between them, which source stamping does not supply
(40.9% on Paul Graham). Worse, the operations invalidate each other: `split(A)` retires a handle that
`retag(A)` later in the same valid response still names, and `merge(A, B)` does the same to
`relateNote(…, B)`. "All or nothing" is a rule about syntactic validity and says nothing about
ordering, dependencies, overlapping targets or identity after mutation. Ten mutually reinforcing
*valid* wrong operations still commit; one harmless invalid one discards nine good repairs.

So the follow-on plan starts from these preconditions, not from a prompt:

1. **One named mutation substrate** — original DOM, Readability DOM, or a persistent intermediate —
   with stable operation targets on it, canonical ordering or disjointness, preflight conflict
   detection, and a rule for Readability's own generated wrapper nodes that carry no source id.
2. **An id-and-reference migration**, or the simpler safe v1: **refuse structural operations on any
   article that is already published or carries reader annotations.** `retag`, `split` and `merge`
   can invalidate comments, saved positions, quote and search anchors, and tree ranges; counting the
   churn is not controlling it.
3. **The six visibility commitments shipped and asserted**, from stage D. Until a wrong
   classification is discoverable, the model must not drive one.
4. **Prompt injection**, which nothing in either prior plan considered. The model is handed an
   untrusted source graph, and a page can carry instructions that elicit perfectly schema-valid
   destructive operations. Provenance guards against invented characters, not against malicious
   classification.
5. **Production failure behaviour** — timeout, provider error, refusal, malformed output, cost,
   latency, retries, cache. The safe outcome is publishing the deterministic result with the model
   pass skipped, and that has to be built rather than assumed.
6. **Per-class hard gates**, because "beat do-nothing on average" permits a model to fix several
   small defects while catastrophically hiding one section.

The design work already done — where the pass would run, the operation vocabulary, and why free
placement and text rewriting are refused at any price — is kept in the scratch notes for that plan
rather than deleted, because the reasoning survives even though the schema does not.

### Greg's two-tier proposal, 2026-09-06 — recorded for that plan, with what would have to be true

> Perhaps we allow the first-pass post-processing agent to make any suggestions it likes (perhaps
> with a confidence threshold), and then if needed call a smarter second-pass agent to double-check
> and approve anything destructive/risky. e.g. GPT Luna for the first pass, and Anthropic Sonnet for
> double-checking the subset of risky bits.
>
> — Greg, 2026-09-06

**The shape is right, and one part of it is better than it looks.** Routing by *risk* rather than
reviewing everything uniformly matches the asymmetry this whole plan is built on — an additive mark is
cheap and reversible, a deletion is not — and it puts the expensive model only where the cost of being
wrong is high. And **cross-family is the load-bearing detail**: Luna and Sonnet are different families,
so the check is worth something. Sonnet checking Sonnet would be near-worthless, for the reason
[engineering-manager.md](../reusable/engineering-manager.md) already states — *agents reasoning from
the same source reach the same wrong answer confidently*. Nine cross-family reviews built stage B, and
every one found something; that is the same mechanism, applied per-article instead of per-stage.

**It is a strong answer to precondition 4, which had none.** A page can carry instructions that elicit
perfectly schema-valid destructive operations, and provenance guards against invented characters, not
against malicious classification. A second model **shown the proposed destructive diff and not the
page's prose** cannot read the injected instruction that produced it. That is a real defence and
nothing else on the list supplies one.

**What it does not address, and this is why it does not unblock the pass.** The blocker is
precondition 1: there is no coherent execution model — two graphs with no defined mapping, and
operations that invalidate each other's handles. A second reviewing agent reviews operations that may
already be incoherent, and approves them one at a time while the *interaction* between them is what
commits the damage. Ten mutually reinforcing valid-but-wrong operations still pass a per-operation
review. So this is an architecture for the pass, not a way to skip the substrate work.

**Three conditions on building it:**

1. **"Risky" must be decided structurally, never by a model.** Deletion, `split`, `merge` and `retag`
   are risky by their type; adding metadata is not. If the router is itself a model call, the problem
   has moved rather than gone. This is the same guard C4 uses — *contains no block-level descendants*
   is mechanical and testable, and a confidence score is not.
2. **A confidence threshold is not evidence until it is calibrated**, and calibrating it is a
   measurement nobody has made. A model's self-reported 0.9 means nothing until we know the empirical
   error rate at 0.9 — and this project's history is precisely of numbers that felt like evidence and
   were not. Ship it with the threshold at *accept nothing destructive without review* and let the
   measurement earn any loosening.
3. **Measure whether tier two is load-bearing, because it is cheap to find out and we now have the
   ruler.** A two-tier arm is just another arm. If the second pass approves 99% of what the first
   proposes, it is theatre with a bill attached; if it rejects a fifth, it is the most valuable
   component in the design. **Nobody has measured this, and it is an afternoon.** That measurement
   should come before the architecture is committed to, not after.

## The biggest risk, and the check

Both reviewers named the same one independently, which is why it leads:

> The score goes up because the repair learned the corpus, not the web.

The trawl finds damage; the damage becomes fixtures; the prompt is tuned on the fixtures; the number
climbs; and the quantity that decides whether to ship — the chance an *ordinary* article loses
something — is still unmeasured, which is exactly where both prior plans ended and nobody acted.

Narrowing the scope does **not** retire this risk — it moves it. The recognisers in stage C are being
written against the same 52 pages, so a recogniser corpus can overfit exactly as a prompt can, and
the "adversarial negative fixture per recogniser" rule is what stands between this plan and the same
mistake in deterministic clothing.

The check is three things, all in place before stage C writes its first recogniser: the **holdout**,
drawn from WCXB rather than from the trawl and never quoted without the development number beside it;
a **do-nothing arm** that stage C must beat on that holdout; and the **residual as denominator**,
where every claimed improvement names the fixture that would fail without it — and if nobody can name
the fixture, the arm never ran.

Second, and this one is now the sharper of the two because the model pass is deferred: **a
deterministic recogniser is not automatically safe.** DPUB roles and `<footer>` occur inside
publisher chrome and inside genuine nested content; "exact, inert, free" is the same unsupported
confidence that hurt both prior plans, and it is the sentence to distrust in this one.

## Open, and deliberately not settled here

- **Is Readability still the right extractor?** Greg's call, 2026-09-04: *"let's get our evals in
  place first, and then we can see if they help or not."* So the harness is built extractor-agnostic
  and a second extractor is a candidate arm, not a dependency.

  The benchmark claims were checked rather than quoted, and **two of them were wrong**:

  - **`dom-smoothie` does not exist on npm.** The name resolves to `dom-smoothie-js`, a Rust crate
    behind a NAPI native binding with 6 weekly downloads — not the pure-JS drop-in the earlier notes
    implied. **The real candidate is [`defuddle`](https://www.npmjs.com/package/defuddle)**: MIT,
    pure JS, works with jsdom, ~564k weekly downloads, and its docs describe exactly the code-block
    standardisation this plan needs — *"line numbers and syntax highlighting are removed, but the
    language is retained and added as a data attribute and class"*, which is the deterministic answer
    to MDN's thirty stray `http` labels.
  - **The trafilatura figures in circulation are from 2022.** Current (2026-08-04, v2.2.0, 990 docs):
    trafilatura 0.924, readability-lxml 0.826. And `readability-lxml` is **not** a port of
    `@mozilla/readability` — it is an independent arc90-lineage cousin, so that number is indicative
    of the family, not a measurement of our code.

  **WCXB is real** and better than expected: CC-BY-4.0, 2,008 pages, ships the raw gzipped HTML
  rather than URLs, 84 MB from Zenodo. It is the "at least 100 ordinary articles" both prior plans
  asked for and neither could afford, times twenty. Two cautions before leaning on it: it is
  single-author, recent and not peer-reviewed, its author's own tool tops its leaderboard, and its
  gold is **plain text**, so it can score text selection and cannot score the structural fidelity
  that is our actual problem. Its own dev-set figure for Mozilla Readability is **F1 0.674**, which
  does not reconcile with the 0.825 quoted in
  [260827ab](260827ab-readability-repair-pass.md#and-the-external-number); different subsets are the
  likely explanation and **neither number should be quoted until someone reconciles them.**
- **Author-facing text edits**, per [Typo fixing](#typo-fixing-declined-with-the-deterministic-half-kept).
- **Index pages and JS-only platforms.** Discourse is unreachable by a plain GET and Readability
  correctly returns `null`; a Blogger index yields one arbitrary post of twenty with no signal. Both
  are stage-1 architecture questions, not stage-2 repairs, and are out of scope here.

## See also

- [260904e-extraction-repair-evals-sol-reviews.md](260904e-extraction-repair-evals-sol-reviews.md)
  — the nine reviews of stage B, whole. Every one returned FIX FIRST, and § B records what came of
  each finding but not how it was reproduced, which is the part that cannot be regenerated
- [260827ab-readability-repair-pass.md](260827ab-readability-repair-pass.md) — what Readability threw
  away, and the eight times its instrument was confidently wrong
- [260830at-readability-tidy-pass.md](260830at-readability-tidy-pass.md) — what it kept, and the
  control that could not discriminate
- [content-extraction.md](../project/content-extraction.md) — the stage this sits inside
- [block-ids.md](../project/block-ids.md) — the contract that decides the operation vocabulary
- [silent-success.md](../reusable/silent-success.md) — why four of the trawl's pages looked fine
