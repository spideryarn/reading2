# An unlabelled contents list folds like a labelled one

Report `spya-jk0xw5` (Greg, admin, 2026-10-23), on
`/read/2025-11-02-what-if-you-dont-need-mcp-spya-ssvya4`:

> This is an example where the article includes a table of contents that we don't need. And so I
> feel like our import process should involve an LLM check that says, hang on, you know, either
> ignore it completely or perhaps just sort of default collapse it.

## What is already there, and why it missed

The `matter` step ([front-and-back-matter.md](../project/front-and-back-matter.md)) already folds a
piece's own table of contents at import: a free label rule (`src/matter-labels.ts`) and one Haiku
call (`src/matter.ts`), held by evidence checks. A contents list is one of its kinds, and the evidence
check already accepts a list **with no label** when most of its entries name the article's own
headings (`contentsExplained`, `unlabelled`). So the fold, the stub, Structure's faint row and the
checks all exist. What failed is that **no source proposed the stretch**:

- **The label went missing at stage 2.** The page prints `<h1 class="toc-header">Table of
  contents</h1>` above a `<div class="toc">` list. Readability's unlikely-candidate pattern contains
  `header`, which matches `toc-header`, so the label heading is removed and the list arrives as
  thirteen bare `li` blocks after the header figure. Reproduced locally from the live page: blocks 3–15
  are the entries, each exactly one of the article's own `h2`/`h3` headings; the label rule returns
  nothing.
- **The label rule needs a label**, by design: it starts only at an exact *Contents* label.
- **The model did not propose it** (the model is mainly there for unlabelled title and author blocks).


## The change

A new free source in the label rule: **a linked contents run** (`linkedContentsRuns`,
`src/matter-labels.ts`). In the opening (the same placement rule a *Contents* label uses: inside
the opening window or the first quarter of the article), a run of short text blocks (at most
`CONTENTS_MAX_ENTRY_WORDS`), empty blocks allowed between, **each linking to one of the article's
own headings that comes after it**, together naming at least **three** distinct headings. It is
proposed as a `contents` range and held by the same `holdStretches` as everything else, so the
unlabelled evidence test (most entries' text names a heading), the range cap and the
half-the-article-showing floor still apply. Blocks already rewrites in-page links to block ids, so
the test is a lookup.

**The link is the evidence, not the words.** The first draft matched entry text against later
headings. The plan review (Sol, below) showed that folds a *Key points* list whose three bullets
happen to repeat the section headings, which [front-and-back-matter.md](../project/front-and-back-matter.md)
says is never folded. A list of in-page links to the sections that follow is navigation; Hugo,
WordPress and MediaWiki all generate that shape, and this page's list is one.

**An entry is not a label.** A linked list opening *Abstract, Introduction, Methods* would have had
its first line read as an abstract label taking the second; blocks inside a linked run are skipped by
the label loop (review finding 2).

**The step's version moves to `matter/3`, and `matter/2` stays readable.** Without a bump, *Read
this again* finds the matter step's stamp unchanged and skips it, so this article would never get the
fold. A bump alone would make every stored value read as outdated, and every article imported since
2026-10-18 would lose its folds until re-read. This change only *adds* a source of candidates, so a
`matter/2` value is still sound: `MATTER_READABLE_VERSIONS` (src/matter-current.ts) lets a read fold
it while the step's stamp and `matterSettled` ask for `matter/3`.

**Fold, not drop.** Greg on 2026-10-17 (`spya-ftsqsn`): skipping front matter altogether *"seems a
bit toooo extreme, since sometimes there's useful stuff in there"*. The fold is the existing
machinery: shut on arrival, one stub (*Contents*), nothing removed from search, chat or exports.

**No model.** Greg suggested an LLM check; the rule is free, deterministic and stronger evidence
than a model's say-so, and the model already in the step missed this one. If a case turns up that
only a model can see (a contents list with no links that paraphrases its headings), that is a prompt
change, measured on the three sets.

## Simpler options passed over

- **Keep the label through Readability** (exempt headings whose text is a contents label from the
  unlikely-candidate removal). Narrower: it fixes pages whose label was stripped, not pages that
  never had one, and it touches stage 2, which every article passes through. The run rule covers
  both and stays inside the matter step.
- **Text matching alone** (the first draft): simpler, but folds a *Key points* list (above).
- **A prompt line telling Haiku about unlabelled lists.** Costs an eval re-run in paid calls and is
  less reliable than a link to the article's own heading.

## Review

Plan review: [-plan-review-sol.md](261024h-an-unlabelled-contents-list-folds-like-a-labelled-one-plan-review-sol.md).
Taken: finding 1 (links, not text), 2 (an entry is not a label), 3 (negatives that satisfy the old
predicate: *Key points*, an *Abstract*-first list). Not taken: finding 2's second half, giving a
linked run precedence over the **model** in `combineMatter` (the model sees text, not links, and
would have to call a linked "Abstract" line an abstract; not seen, and a precedence change is wider
than this report). Finding 4's relaxations (roman page numbers, *Chapter 1* prefixes in
`entryText`) are moot for a link-based run and are left for a labelled-contents miss that needs them.

Code review: [-code-review-sol.md](261024h-an-unlabelled-contents-list-folds-like-a-labelled-one-code-review-sol.md),
over [the diff it was given](261024h-an-unlabelled-contents-list-folds-like-a-labelled-one-code-review.diff).
Sol fixed four things in place, each checked and kept:

1. **The freshness hash now covers link targets** (`MATTER_HASH_VERSION` `m2`, `inPageHrefs` in
   src/matter-current.ts), since the rule reads them: a re-extraction that drops the links must make
   the stored value stale. `matter/2` values keep their `m1` hash check, so they still fold.
2. **Only `<a>` links count**, not an SVG `<image href="#…">`, which a hostile page could have used.
3. **Each entry names the heading its own link targets** (`contentsEntryMatchesHeading`), not
   text and target checked apart (lines naming A, B, C linking to D, E, F).
4. **A linked list under *Key points*, *Highlights*, *Significance*, *Executive summary* or
   *Author summary* is never folded.**

Not changed, for a wider decision: an anchor wrapping a block-level entry
(`<a href="#x"><p>One</p></a>`) loses its link at stage 3, so such a list is missed (and the link
is gone from the reading view too).

## Evidence

- Unit tests on the reported article's block shape (title, dateline, figure, thirteen linked entries,
  then prose and the sections): red before, green after; negatives — a *Key points* list of bare
  lines that repeat later headings, two linked lines, a run broken by an unlinked line, links back to
  earlier headings, a run past the opening — and an *Abstract*-first linked list kept as one
  contents stretch. The two guards (later heading; entry is not a label) were each removed in turn
  and a test went red.
- The real page, fetched 2026-10-24 and run through `readArticle`, `splitIntoBlocks` and
  `matterByLabels` locally: one *Contents* stretch over the thirteen entries, nothing else.
- The three-set eval (`scripts/matter-eval.ts`, the 261018b corpus, cached answers, free) before and
  after: prose folded **0 / 0** on every method and set, both times; every other number unchanged.
  None of the 52 articles has an unlabelled linked contents list, so this shows the rule adds no
  folds elsewhere, not that it finds more.

## Not in scope

- This article's header picture folded with its dateline: queued as `qi-jpj7mmhv` by `fbgapqbt`.
- Articles already imported get the fold when re-read (*Read this again*); no backfill (a
  production write).
