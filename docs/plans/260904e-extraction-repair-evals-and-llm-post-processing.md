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
