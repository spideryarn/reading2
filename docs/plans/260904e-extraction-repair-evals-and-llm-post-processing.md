# Repairing what ingestion does to an article — the corpus, the ruler, and the free wins

**Status: stage A in progress; scope narrowed after review.** The model repair pass Greg asked for is
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
> **Recommended fix, not taken here, because id assignment is not something to change in a review
> round.** Give such a block the pass-one key `` `e:${tag}` `` instead of `null` — one line at the
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
> stage-3 re-run therefore drops callout context silently. Worth its own ticket.

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

### C — Deterministic recognisers

Markup-based, and **each with both a positive and an adversarial negative fixture** — "exact, inert,
free" is the same unsupported confidence that hurt both prior plans, and `<footer>` and the DPUB
roles do occur inside publisher chrome and inside real nested content.

The bot-wall / not-an-article detector, which converts the worst rows of the trawl from silent to
loud — and which needs a **decided production behaviour**, not just a signal: reject the ingest,
retry another fetcher, or publish with a warning. A false rejection of a genuinely short article has
its own reader-visible cost, so this is a product choice with a default, not a threshold.

Then the `[edit]` / permalink / affordance recognisers; admonition labels re-attached to their
bodies; the Paul Graham bracket-footnote shape; Wikipedia data tables protected from Readability's
own pruning; and block-level `dir`/`lang`, which the trawl found missing on Arabic and Hebrew and
which no earlier stage was going to fix.

Done when: every recogniser has both fixtures, the corpus shows the residual it leaves, and the
bot-wall behaviour is chosen and implemented. **This residual is the denominator** any future model
arm is measured against — never stock Readability, which 260827ab measured as a 79% overstatement.

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

- [260827ab-readability-repair-pass.md](260827ab-readability-repair-pass.md) — what Readability threw
  away, and the eight times its instrument was confidently wrong
- [260830at-readability-tidy-pass.md](260830at-readability-tidy-pass.md) — what it kept, and the
  control that could not discriminate
- [content-extraction.md](../project/content-extraction.md) — the stage this sits inside
- [block-ids.md](../project/block-ids.md) — the contract that decides the operation vocabulary
- [silent-success.md](../reusable/silent-success.md) — why four of the trawl's pages looked fine
