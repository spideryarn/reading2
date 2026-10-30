# Front and back matter

Up: [reading-view-overview.md](reading-view-overview.md)

The apparatus around a piece: the title block, the authors and their affiliations, the abstract,
keywords, the piece's own table of contents, publication details, acknowledgements, funding,
declarations, and the reference list. Spideryarn finds it at import and **folds it to a one-line
stub** in the reading view, so the page starts with the article and the reader can still open any
of it in place.

> In this article, there's a whole bunch of stuff at the top that's not very
> interesting/substantive (e.g a table about the authors & affiliations, acknowledgements,
> abstract, etc etc). Probably we do still want to include it, but somehow we want to: Mark it up
> as being less interesting · And default-collapse it […] Or *perhaps* we just skip them
> altogether […]? That seems a bit toooo extreme, since sometimes there's useful stuff in there.
>
> — Greg, 2026-10-17 (`spya-ftsqsn`)

> I'm leaning towards default-collapsed for the Abstract too, but visible in Structure so that the
> reader can see that there is an Abstract and easily get to it if they want to.
>
> — Greg, 2026-10-17 (`spya-vskdap`)

## What the reader sees

- **A stub per stretch**: one faint line, in the interface face, with a chevron, a label made from
  what is in it (*Abstract*; *Authors and affiliations*; *Title and authors* when the title is in
  it; *Acknowledgements, funding and declarations*; *References*; a front summary by its own label,
  *Executive summary* or *Key points*), a count, and an ⓘ saying what it is and that nothing is removed.
  Pressing it opens the stretch in place; a fold chevron in its first row's gutter shuts it again.
- **Shut on every arrival**, and not remembered. A jump into a stretch (a search hit, a Structure
  row, a comment, a pasted `?at=`) opens it. The reading position never names a block inside a
  shut stretch, so a reload does not open one.
- **Structure keeps its rows**, faint and with the same ⓘ, numbered as before; pressing one opens
  every stretch within it and goes there. A row is faint when stretches cover it, one or several
  back to back (*Title and Abstract* is two); a row that only partly overlaps one is not.
- **Stubs back to back sit as a compact list**, normal paragraph space only before the first and
  after the last (fold.ts writes the tight sides; prose.css owns the size).
- **It does not count towards how much you have read.** The masthead's read-so-far pie and the
  quiz's share leave every folded stretch out, read or not, so an unopened stub never holds a reader
  back from *finished* (`readSoFarWords` in [`src/web/read-filter.ts`](../../src/web/read-filter.ts);
  [261025j](../plans/261025j-how-much-of-the-article-you-have-read-at-the-top.md)). The chats' rough
  phrase still counts it, because the server has no fold rule.
- **Nothing is taken out of the article.** Search, exports, chat and every model still read every
  block. Leaving the paperwork out of what automatic modes *say* is the prompts' job
  ([`src/paperwork.ts`](../../src/paperwork.ts), plans 261003c and 261003d); taking it out of what
  they *read* is not built (queue `qi-2byhh6nc`).
- **The author's own summaries at the front fold too**: an *Executive summary*, *Key points*,
  *Highlights*, *Significance* or *Author summary*, each its own stub, named by its label. Summary
  and Structure do that job, and one press opens it.

  > B
  >
  > — Greg, 2026-10-25 (`spya-p6gmn7`), answering [q-r8kumx](../user-feedback/questions/q-r8kumx.md):
  > fold them like the abstract, a row in Structure, the stub saying which kind.

  The same label in the body (a *Key points* after the introduction) is the article's own and stays.
- **Not matter, and never folded:** appendices, glossaries, footnotes and endnotes, a standfirst, a
  section called *Summary* or *TL;DR*, an essay's own opening or closing.

## Where it comes from

A step, `matter`, after `blocks`, run as a free successor job when a publication's blocks changed
(not in `DEFAULT_INGEST_STEPS`, so a pasted URL opens no later than before). It stores
`article_revisions.matter`: stretches of block ids, each with closed `kinds`.

- **Two methods, merged, then held by code.** A free rule over exact authored labels
  ([`src/matter-labels.ts`](../../src/matter-labels.ts)), and one Haiku call over the article's
  opening, its headings and its close ([`src/matter.ts`](../../src/matter.ts)). The model finds
  unlabelled title blocks and author lists; the rule finds long reference lists and contents. Their
  union keeps the finer of their boundaries, so an abstract is always its own stretch.
- **A contents list needs no label.** The rule also takes a run of three or more short lines in
  the opening that each name and link to the same one of the article's own later headings (`linkedContentsRuns`,
  plan
  [261024h](../plans/261024h-an-unlabelled-contents-list-folds-like-a-labelled-one.md)): a page's
  *Table of contents* heading can be lost at extraction (Readability dropped
  `<h1 class="toc-header">`, report `spya-jk0xw5`) or never be there. The link is the evidence: a
  line must name the heading that its own anchor targets, and a run under *Key points*, *Highlights*,
  *Significance*, *Executive summary* or *Author summary* is never contents even when it links
  onward (at the front, it folds as a summary instead).
- **A front summary is the label rule's alone** (`summaryAt` in src/matter.ts, plan
  [261025f](../plans/261025f-an-executive-summary-and-the-other-front-summaries-fold-like-the-abstract.md)).
  Its prose is prose, so the label, where it sits and how far it runs are its whole evidence, and
  every doubt shows it: the label in the opening window, no heading of the article's own before it
  at its level or above, at most 300 words of the article's own prose before it; it runs to the
  end of its heading's section (or the next heading, under a paragraph label), to its last item
  when it is a list, and stops at any other label, an inline *Citation:* or *Funding:* line, or a
  bare *Introduction*; a sub-heading inside it that is neither a structured summary's part
  (*Question*, *Findings*) nor a question over bullets (PLOS Medicine's), or over 1,500 words, and
  it does not fold at all. The model is not told the kind and its request did not change: its schema leaves
  `summary` out, and an answer claiming one is refused. In the union a summary keeps its blocks
  whatever the model called them, and two summaries never join.
- **A rule change that leaves older admitted folds sound keeps older values readable.** The step's version
  (`MATTER_PROMPT_VERSION`) decides when it runs again; `MATTER_READABLE_VERSIONS` decides what a
  read still folds, so a new source does not take every stored fold away until each article is
  re-read ([`src/matter-current.ts`](../../src/matter-current.ts)).
- **The checks are the design, not the prompt.** Whatever either method says, a stretch is kept
  only if every block passes evidence for its kind on its full stored text (a contents entry names
  one of the article's own headings or carries a page number; a reference looks like one; an
  abstract is at most 350 words), it sits where its kind belongs (contents and the abstract in the
  opening, a reference list at the back), and the folds together leave at least half of the
  article's non-reference words showing. A check that fails drops that stretch, never the
  article. The model's answer is a stranger's text acted on: it can name only ids it was shown, in
  a closed schema, and nothing it writes is drawn.
- **Fails towards showing.** A failed call stores the label rule's stretches alone. A stored value
  is used only when it was computed from exactly the blocks on screen (`matterInputHash`, including
  the in-page anchor targets interpreted from the stored markup, checked on every read); otherwise,
  and for every article imported before this existed, the reading view uses the older byline rule
  ([`src/web/front-matter.ts`](../../src/web/front-matter.ts), plan 261007d) as one *Authors* stretch.
- **Visitors** (the public page) get the same folds, under the same rule, since 2026-10-18:
  `PublicArticle.matter` carries each stretch's two ids and kinds and nothing else of the stored
  document ([security-map.md](security-map.md) § `PublicArticle` gained `matter`; plan
  [261018l](../plans/261018l-visitors-on-a-shared-link-get-the-front-and-back-matter-folds.md)).

## The evidence, and where to change it

[261018b](../investigations/261018b-front-and-back-matter-eval.md) measured it on 52 articles in
three sets, two held out: no prose folded, 67–96% of matter found, about $0.0013 an article. **A
change to a check or the prompt is re-run on all three sets** with `scripts/matter-eval.ts` before
it lands; the gold labels' guide is in that investigation's folder. Since 261025f the gold marks
a front summary as matter (`summary`), and the corpus has only two, both executive summaries; the
investigation's addendum says what else was checked by hand. The reasoning, the plan review
and what building changed are in
[261018a](../plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md).

The fold itself is the fold store's ([`src/web/fold.ts`](../../src/web/fold.ts)), beside heading
folds and the masthead's echo; the stretches are read in one place,
[`src/web/matter-view.ts`](../../src/web/matter-view.ts).
