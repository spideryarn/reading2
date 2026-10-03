# Citations — every work the piece cites, with a link out

A mode in the band between the spine and the prose. It answers *what does this piece lean on, and
where do I find it*: the works the article cites — through a bibliography, footnotes, or a name in
running text — each with a link. Asked for through the Feedback button on 2026-09-11
(SPIDERYARN-READING2-2Y):

> Add a Citations mode that looks at citations and looks at the bibliography and references and
> provides, you know, a link to all of them. And you can either order them by when they appear in the
> text, or how relevant they are, or how influential, or a prioritized score. (the default, with
> threshold bar, kinda like Glossary etc)

The design, the review that reshaped it and the real runs are
[260911g-citations-mode.md](../plans/260911g-citations-mode.md). This page says what is built.

## A row

The title — a link out, opening a new tab ([links.md](links.md)) — then authors · year as the article
gives them, more than two authors shortened to *First et al.*, and a quiet line: relevance and influence as two small bars (the numbers in their tooltip, as in the glossary),
where the link came from, and **first cited**, a jump to the passage
([`BlockRef`](../../src/web/BlockRef.tsx)). A work the article names only in its bibliography says
*only in the references* and jumps there. § [Which citation, and whose
entry](#which-citation-and-whose-entry) is what the by-line and *first cited* show since
2026-09-30.

**New lists ask for influence as a number only when the model is confident it knows the work;
otherwise the row says *influence unknown*.** Influence is the model's memory of the work, not anything in the article, and
until `citations/6` the prompt told it to give a low number for a work it did not know, so "I do not
know this" and "this is obscure" were the same number. Asked whether to keep the score at all
([261003j](../plans/261003j-citations-say-only-what-the-bibliography-supports.md)), Greg,
2026-10-03:

> Q-influence Hmmm, I'm torn. Maybe if the model is confident (e.g. because it's well-known), but if
> in doubt default to Unknown. And if we do a deeper dive on a Citation, try and populate it then.
>
> — Greg, 2026-10-03

So since `citations/6` the prompt asks for a number or `null`, the schema makes the field required
and nullable ([prompting-guide.md](prompting-guide.md) § What the model writes back), and a low
number means *known, and minor*. A `null` is stored as no `influence` at all, the shape an unscored
row already had, and counted on the step's log line as `influenceUnknown`, apart from
`influenceAbsent` (the field left out) and `influenceRejected` (not a number in 0–1). Two drafts of
one work fold to the known number. On the row, a work with a relevance and no influence draws the
relevance bar and then the words *influence unknown*, with a card saying no usable score was saved;
never a bar at zero. Storage does not distinguish an explicit unknown from a missing or rejected
score, so the card explains the new prompt's rule without claiming why this particular score is
absent. It opens on hover, focus or tap. A row with neither score says nothing, as before, and the
hover card in the prose draws no scores at all.

**A list made by `citations/5` or earlier keeps its numbers**, low ones for unknown works included,
until it is made again from the Metadata page (§ [Making it again](#making-it-again)). Nothing re-runs
by itself.

**A bar marked *from the web* is the second half of Greg's answer**: *Dig deeper* looked for the
work's standing on the pages its web search returned, and kept a number (§ [Dig
deeper](#dig-deeper-a-closer-look-at-one-work-on-demand), *It looks for the work's influence*). The words open a
card, on hover, focus or tap, saying it is *an AI estimate from web evidence*, the site, the day,
and the page's own words. The owner's card on *influence unknown* says Dig deeper looks for it; a
visitor's does not, because a visitor has no Dig deeper and never sees what it found.

**Every reader of a row's influence goes through one function**, `effectiveInfluence` in
[`citation-effective-influence.ts`](../../src/citation-effective-influence.ts): the web number when
the row has a kept, current *Dig deeper* answer whose influence carries the current
`INFLUENCE_VERSION`, else the list's own, else unknown. The bar, the threshold, the influence order,
whether that order is offered, and chat's `article_citations` tool all read it. The web number
replaces the model's memory on that row, higher or lower, because it has a source and the memory
has none. **The list's own `influence` is never overwritten**, so a visitor's row, which is built
from the list alone, keeps the list's value.

**No by-line that only repeats the title.** When the article gives a work only as an author–year
label, the label is the title, and `Bartlett (1932)` over `Bartlett · 1932` said it twice
(SPIDERYARN-READING2-7W). `byLineRepeatsTitle` folds only the known presentation differences —
brackets, the middle dot, `&`, `et al.` — and the line is left off; never when the registry filled a
field, whose *from Crossref* mark must stay. Its hover card, with the reference-list entry, then
opens from the title, the link itself on a linked title, with reveal-then-commit on touch —
[261001m](../plans/261001m-citations-duplicate-by-line-and-a-flash-you-can-see.md). On that link the
card is also its focus description; the repeated author–year heading stays visible in the card but
is hidden from assistive technology, so the title and entry are each spoken once.

**The registry's record** (since 2026-10-01,
[261001a](../plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md)
stage 5): at the end of the step, each row whose link is a DOI or arXiv address — at most 80 — is
looked up at Crossref or DataCite through the shared, cached lookup
([`bibliographic.ts`](../../src/bibliographic.ts)), and the record is kept on the row only when
`registryIdentifiesCitation` confirms it. Usually the titles agree. When the article gives only an
author–year label, its own reference entry must also contain the registry title; author and year
alone are inconclusive, because two works can share both. A disagreement is kept as a *conflict*,
and the row says the article's identifier points to a different title. The by-line stays as the article gives it; where
the article gives no authors or no year, the registry's are drawn, marked *from Crossref* / *from
DataCite*. A visitor's row carries a found record, never a conflict. Outside the stamp and the
prompt, and the step never fails for it ([`citation-registry.ts`](../../src/citation-registry.ts)).

## The one safety property

**Every address a row presents as the work's own was in the article, and code found it.** The model
never writes a URL we keep: a DOI or arXiv id in the reference's text or hrefs, else one of the
article's own anchors whose text is the title or the mention, else — and on every ambiguity — a
**Google Scholar search**. `linkFor` in [`src/citations.ts`](../../src/citations.ts) is the order;
the plan says why a link to the wrong work is worse than a search.

The row always says which. An address shows its host and its rule (*doi.org · DOI in the article*); a
search is drawn as a search — the title is not a link, and the one link says *search Scholar*.
`sourceOf` in [`CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx) is total over `linkFrom`.

## What we have read of the work, said on every row

Asked for through the Feedback button on 2026-09-29 (SPIDERYARN-READING2-5G):

> be really careful to be clear about whether you could get the actual paper, so that we can be sure
> you're not hallucinating

Nothing that makes the list reads the cited work, so every row and hover card carries one quiet line
saying what we have read. Usually that is nothing: *We have not read this work, only the article that
cites it.* After *Look it up* it names what was read, which is only ever a search engine's extract
of a matching page, and never the work itself. Once *Dig deeper* has read the paper itself
(§ [Dig deeper](#dig-deeper-a-closer-look-at-one-work-on-demand)), the line says that instead,
with the host, the length and the day. `readNoteOf` in
[`CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx) is the one source of that line for both
surfaces, total over `linkFrom` and the lookup's state. The design and its two plan reviews are
[260929g](../plans/260929g-check-a-cited-paper-supports-the-claim.md).

## Nothing about the work beyond the article's bibliography

Asked for through the Feedback button on 2026-10-03 (`spya-zmdb7y`):

> we don't want to mislead the reader into thinking that that's what the paper actually says when
> actually there's no new information beyond what's in the text. So instead, I think citations mode
> should perhaps err on the side of saying, you know, nothing about a paper beyond what's available
> in the bibliography … better to say less and allow the user to ask for more
>
> — Greg, 2026-10-03

The model writes one sentence a work, `why`: *what the article uses it for*. It is written from the
citing paragraph and can only restate it. Until 2026-10-03 every row, hover card and Marginalia note
drew it; measured on 194 stored rows that was 2,143 words of paraphrase, about 11 a row
([the investigation](../investigations/261003d-what-a-citations-row-says-and-where-it-came-from.md)).

**Now `why` is drawn only beside something that was checked against it** (`showsWhy` in
[`CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx)): in the band, once the row has a
quick-check verdict or a *Dig deeper* answer; on the hover card, once it has the verdict, since the
card draws no *Dig deeper* answer. There it is the claim under test, still labelled *what the article
uses it for* — the verdict reads *supports what the article uses it for*, which says nothing without
it. Marginalia's opened note never draws it, and shows the article's own reference entry instead. A
visitor has neither a verdict nor an answer, so never sees it.

**Authors and a year the article never gives are dropped**, by code, when the list is made
(`locateInArticle` in [`src/citations.ts`](../../src/citations.ts)). The prompt asks for both *as the
article gives them*; one stored row in 194 had an author from the model's memory instead (*The
Bitter Lesson · Sutton*, in an essay that never names Sutton). Every word of the authors must be a
word of the article's text or its PDF reference list, and a bare four-digit year must be in it
somewhere; a suffix or date phrase must occur together. Otherwise that field goes and the row stays;
`authorsUnfound` and `yearUnfound` on the step's
log line count them. It asks only whether the article says the name at all, not whether it says it
of this work, which code cannot know. A name the model corrected (the article's *Dojolonga*) goes
too. A row with a DOI can still get its authors from the registry, marked *from Crossref*. A list
made before 2026-10-03 keeps what it has until it is made again.

`why` is still written and stored: the quick check, the paper's passages and the *Dig deeper* answer
are all aimed by it, and chat's `article_citations` tool returns it as *used for*. The plan, with
what was passed over, is
[261003j](../plans/261003j-citations-say-only-what-the-bibliography-supports.md).

## Which citation, and whose entry

Asked for through the Feedback button on 2026-09-30, from a PDF of a numbered-citation review
(SPIDERYARN-READING2-6J, then 6K):

> it would be more helpful to highlight specifically within the block where the citation is,
> because sometimes there are multiple citations in a block, and somehow citations mode doesn't
> make it obvious which citation corresponds to, you know, which footnote.

> I wonder if there's a way to include the author names as well somehow, even if in somewhat
> truncated form, and also the date. And/or, you know, provide a tooltip with extra metadata like
> journal/conference/etc.

[260930i](../plans/260930i-citations-mark-the-exact-citation-and-read-the-pdf-reference-list.md)
is the design and GPT Sol's review that reshaped it; this says what is built.

**First cited names the words, and lands on them.** The link is the words the article cites the
work with — *first cited “TV episodes [8]”* — the verified mention in the `firstCited` block,
shortened keeping its marker end (`citingWordsOf`). The jump passes `citePassageKey(work.id)`, the
second key shape `passageMarks` ([`rows.ts`](../../src/web/rows.ts)) reads: it finds the
`mark.cite` fragments whose `data-cite` names the work, so the centring scroll and the arrival
flash land on the phrase rather than the paragraph. Found at render time by `citeMarks`, never by
the stored offset ([block-ids.md](block-ids.md)). A work reached only through a footnote marker, or
a visitor, who has no marks, keeps the old behaviour — the block id, or a wash of the whole
paragraph. The key names a work, not an occurrence: two cites of one work in one paragraph flash
together, accepted.
**That flash is longer and stronger than a paragraph's** — 2.4 s, a stronger wash, and a pulse
near the start, since on a few words the paragraph's 1.2 s was too faint to spot
(SPIDERYARN-READING2-7X): `CITE_FLASH_MS` in [`flash.ts`](../../src/web/flash.ts) and
`--cite-flash-ms` in `tokens.css`, held equal by `tests/block-flash.test.ts`.

**A PDF's reference list is read from its text layer.** Stage 2 does not render a PDF's
bibliography (`RENDERED` in [`pdf.ts`](../../src/pdf.ts)), so before this the stage saw `[8]` and
nothing to say what it was, and the model described the cite instead of naming the work (*"Study on
recall of TV episodes"*). Now the `citations` step reads the stored PDF with `pass0`, strips running
headers, and [`citation-reference-list.ts`](../../src/citation-reference-list.ts) splits the text
under the bibliography heading **at the list's own numbers**. The model sees the list after the
article, one `[n] entry` a line, and names each work's entry **by number**. Code keeps it only if:

- the list has that number, and the work's verified mentions cite it (`[8]`, `[7,8]`, `[6–9]`) —
  entry 9 for a work cited as `[8]` is the pairing slip, and it would carry the neighbour's authors;
- the model's title is in the entry — else the entry is dropped as disagreeing.

Then every author name must be a word of the entry, or the authors go, and the year must be one of
its years, stored as the entry's token (`2017a`). The entry text shown is the list's, split by code,
never a string the model copied. A numbered list only: an author–year PDF bibliography gets no list
yet. No list, a scan or an unreadable document never fails the step; the step's log line says which
(`referenceList`, `referenceListEntries`, `entries`, and the drops `entryUnfound`,
`entryMismatch`, `entryDisagrees`).

**An HTML bibliography's entry is its block's text**, when the block is `role: "reference"` and no
other work claims it — a shared footnote would show one work its neighbour's venue.

**A PDF entry's DOI or arXiv id is the row's link** ([261001a](../plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md)
stage 4). The entry code split is the article's own text, so it joins rule 1 of `linkFor` as a
bibliography block does: exactly one DOI, or no DOI and exactly one arXiv id, gives `doi.org` or
`arxiv.org/abs` with the same `doi` / `arxiv` `linkFrom`. `entryIdentifiers` reads the entry
conservatively from the entry before dehyphenation: a DOI or arXiv id spanning a line-end hyphen,
a DOI ending in `-`, `/` or `_` before whitespace,
one followed without punctuation by another DOI-shaped run, one ending in a full stop before a
lowercase-or-digit run (`j.cell. 2020.01.001`), or an arXiv id followed by a digit might have been
cut, so the row keeps its search. Code never joins two runs into an address. The entry shown to the
reader is still dehyphenated, and the link is read from the whole entry, not the stored 400-character
cut. **A row whose search becomes a DOI keeps its
id** on the re-run — its old `workKey` is tried when its new `doi:` key finds nothing, only while no
other row in either list has that `workKey`. If the new identifier key and metadata key point to two
different old rows (a pair of works swapped their DOIs, for example), neither old id is used. Thus a
clear upgrade keeps its *Look it up*, find and investigation, while an ambiguous one cannot transfer
them to another work.

**Shown**: the by-line's tooltip holds the authors as given and the entry, labelled as the entry in
the article's own reference list, copied from the article and not from the work; the prose hover card shows the entry
in full, since a card is what a finger gets. **A visitor gets the entry only when it is its own
bibliography block's text**, every character of which is already on their page. An entry read from
a PDF's text layer stays owner-only: it can carry a publisher's one-page "Downloaded by …" stamp
that the furniture filter missed ([261001b](../plans/261001b-public-article-visitors-see-debate-threads-relevance-citation-entry-and-cross-references.md)).

## The orders, and the bar

Five, under the glossary's order buttons ([glossary.md](glossary.md)):

- **prioritised**, the default — `(2 × relevance + influence) / 3` against the threshold bar, in
  first-cited order: a score never moves a row, it only hides one. **A work whose influence is
  unknown is judged on its relevance alone** (`priorityOf`), since 2026-10-03; before that it
  survived every position of the bar, which was written for a rare unscored row and would stop the
  bar hiding anything now that unknown is common. That is the same arithmetic as assuming the work
  is exactly as influential as it is relevant, so it is not neutral: at relevance 0.30 an unknown
  work clears the default bar, and one known to be minor (influence 0.10) scores 0.23 and does not.
  Not knowing a work is not evidence against it. Whether the bar should use relevance alone for
  every row is an open question in
  [261003m](../plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md).
  A work with no relevance still survives every position of the bar
  ([`threshold.ts`](../../src/web/threshold.ts)), and the line under it says how many are hidden. The
  bar starts at **0.25**, lowered from 0.40 on 2026-09-15 so most works come in by default — 92% on
  average on the local runs
  ([260915d](../plans/260915d-prioritised-by-default-in-search-and-lower-default-thresholds-everywhere.md)).
  Falls back to first cited
  when no position of the bar would hide anything.
- **first cited** — the artefact's own order.
- **relevance** — descending, a work with no relevance last. Offered only when some work has a
  relevance; a saved `?citeby=relevance` falls back to first cited otherwise (GPT Sol's F14: until
  2026-10-03 it reordered the rows while no button was pressed).
- **influence** — known influence first, descending; then the works whose influence is unknown, by
  relevance, descending, with no relevance last. First-cited order breaks ties. Offered only when
  some work has an influence; a saved `?citeby=influence` falls back to first cited otherwise.

**The influence in every one of these is the effective one** (§ [A row](#a-row)): a number *Dig
deeper* read from the web counts in the threshold's `(2 × relevance + influence) / 3` and in the
influence order exactly as the list's own would, and one press can make the influence order
available on a list that had none.

- **date** — publication year, oldest first, as Debate's date order is; same year in first-cited
  order, undated last. The year is the one the row draws (`workByLine`: the article's, the
  registry's only where the article gives none), read as its first four-digit year, so `2017a` is
  2017 and `n.d.` is undated. Offered only when some work has a year, and `?citeby=date` on a list
  with none draws first cited. Asked for by Greg, 2026-10-01 (`spya-xpxmjn`):

  > In Citations mode, add a `sort` option for publication-date.

  No newest-first: one direction until somebody asks
  ([261002j](../plans/261002j-citations-sort-by-publication-year.md)).

Only the two raw scores are drawn on a row, never the combination — the glossary's rule. An **(i)**
in the band's top-right corner (`BandAbout`, shared by every mode) says `influence` is the model's
memory, not a citation count, and what *influence unknown* means, and, **only when the model reported it**, that the list was capped at
80; it also carries the work count and provenance. The two notes were a foot pinned under the list
until Greg, 2026-09-30 (`spya-nca765`), then briefly lived in the order row; the count was in that
row too, shown only outside *prioritised*, whose threshold row already says "n of m"
([261001l](../plans/261001l-compact-quotes-and-citations-band-tops-and-click-a-diagram-to-enlarge.md)).

**The URL keys are `?citeby=` and `?citebar=`, not the glossary's `sort` and `gate`.** Every
parameter survives a mode switch, and `Reader` reads `?gate=` in every mode to reveal a glossary
term from the prose, so a shared key would carry a citations bar into the Glossary as its threshold.
[url-state.md](url-state.md) has the rows.

## Marked in the prose, in every mode

Since 2026-09-16 every work is drawn where the article cites it, whether or not the band has ever
been opened — asked for through the Feedback button (SPIDERYARN-READING2-3M):

> And (just as we do with quotes and glossary), once generated, we should always visually indicate
> Citations somehow in the main text (with tooltip/clickable, that pops up a panel for the citation
> with various useful information & actions.

[260916b](../plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md) is the
design and the reasoning; this says what is built.

**What is marked** is each work's verified places — its `mentions` (at most 3) and its `reference`.
Those carry the *article's own characters*, sliced out of the block by `verifyPlace`, which is what
makes this a re-find rather than a search and what it has in common with a quote and nothing else the
model returns. A work's other citing paragraphs (`citedAt`) are **not** marked: past three mentions
we know only which paragraph, and marking a whole paragraph to mean *something in here cites
something* is the vague version of the question. The card closes that in words — *cited in 7
paragraphs*.

**Every work, not only those above the bar.** This departs from quotes, where the bar doubles as the
density control, and follows the glossary. `?citebar=` is reachable only inside Citations mode while
the marks are visible from every mode, so barring them would change a paragraph's appearance from a
control the reader cannot see.

**`citeMarks` in [`annotate.ts`](../../src/web/annotate.ts) is the fifth `MarkKind`**, and two things
about it are not obvious:

- **A place that cannot be re-found draws nothing** — not the whole block. That is why it is not
  built on `resolveOne` like every other passage source: `resolveOne` falls back to the whole block,
  which is right for a passage whose model-supplied locator may have drifted and catastrophic for a
  citation.
- **It takes the *only* occurrence, not the first**, through
  `quoteFinderWithMultiplicity`, the bulk counterpart to
  [`findOnlyQuote`](../../src/quote-match.ts). The quotes argument does not transfer: `verifyPlace`'s
  relocation branch establishes uniqueness across blocks, not within the one it settles on. So a work
  cited twice in identical words in one paragraph draws nothing there, which is the safe direction.

**The channel is `text-decoration`**, which nothing else uses — comments and terms draw a
`border-bottom`, quotes a `box-shadow`, hits a `background` — so a citation and a glossary term over
one phrase each keep their own line. The words themselves never change colour: that is `mark.cmt`'s
rule, and it is why the mention is not drawn in the link colour, which would also have made it look
like one of the article's own hyperlinks. `/design` has three specimens, including both overlaps.

**Pointing at one opens the work**, in the card the glossary and the links already share
([`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx)) — a fourth section, not a second card.
It draws the title with its link, authors · year, the entry, and *cited in N paragraphs* — or *only in
the references* for a bibliography-only work. The provenance
is the panel's own `sourceOf`, so a `search` row is drawn here as a search exactly as it is there:
two surfaces disagreeing about whether an address is the work's own would teach a reader something
false. Not in the card, each deliberately: the score bars (the card says meaning, the band says
numbers), *Look it up* (billed, and a surface that opens on a hover is the wrong place for it), and a
foot button into the mode (it needs `?cite=`).

**A finger gets the card on the first tap.** `mark.cite` is in `tapSelector` and in
`NOT_A_BLOCK_SELECTION` — both, and the pair is the point: the second alone would take the tap away
and give nothing back, leaving a dead hole in the paragraph wherever a work is cited. A bare
citation has no second-tap commit, because the card's action is the link it carries. If the cited
words are also the author's internal or outbound link, that link keeps its established second-tap
jump or open.

**The marks are owner-only by construction.** The list they are drawn from is read in `OwnedReader`,
so a visitor — who since 2026-09-29 sees the stored list in the band — has no marks in the prose and
no card section.

## Look it up on the web

**Since 2026-09-30 there is no *Look it up* button: it is a step of *Dig deeper*'s one press**
(*Investigate* until 2026-10-01; § [Dig deeper](#dig-deeper-a-closer-look-at-one-work-on-demand)),
asked for through the
Feedback button (SPIDERYARN-READING2-75):

> In Citations mode, can we amalgamate "Look it up" and "Investigate" buttons to get the best of
> both worlds?

Everything below still describes that step — the call, its identity rule, its checked quotes, its
store — and `POST …/find` still answers it on its own for a tab opened before the change. Where this
section says *Look it up*, read *the quick check*.

Every owner row offered **Look it up** — owner-only, one row at a time, a few seconds. It was *Find
it*, offered only on a row with no link, until 2026-09-29, when it also began reading what it
finds (§ [It reads the search extract](#it-reads-the-search-extract-never-the-work)). **It explains itself in a `ControlTip` rather than a `title`** since
2026-09-16, asked for through the Feedback button (SPIDERYARN-READING2-3K): *"make it clearer what
that does (e.g. rich tooltip) and the effect of running it"*. The card is bounded by what the code
checks rather than by what the sentence wants to say — no call count, no fixed price, and not *its
own page*, since `namesTitle` / `pageNamesTitle` accept a result whose title **or excerpt** carries
the work's title. What it adds over the `title` it replaced is the effect: it costs money, a press
that finds nothing stores nothing and leaves the Scholar search where it was.
[tooltips.md](tooltips.md) is why a `title` was not a small version of this — it does not exist at
all on a touch device, which is the device the report came from. `POST /api/citations/:slug/:id/find` makes one chat-wire call with
`openrouter:web_search` (Exa, `max_total_results: 5`) and a short prompt asking for one search for
this one work and a JSON answer naming which result, if any, is its own page
([`src/citation-find.ts`](../../src/citation-find.ts)). JSON, not streamed: the answer is a link.

**What is kept is decided by code, and the model is only a pointer into the result set** — the
plan's [§ Stage 3](../plans/260911g-citations-mode.md#stage-3-find-it-on-the-web) and review
finding F4:

- the URL must be an exact key among the call's own `url_citation` annotations — a URL the model
  typed is refused however right it looks;
- what is stored is the **annotation's** URL and title, never the model's;
- the result must name the work: its title matches (`namesTitle`), or its excerpt carries the
  title's words as a run (`pageNamesTitle` in [`src/citations.ts`](../../src/citations.ts)).

Anything else stores nothing, the row says no page was clearly the work's own, and the Scholar
search stays. A kept page is a row in `citation_finds`, keyed `(article, entry id)` like the
glossary's lookups and attached at read time by `loadCitations` (`attachFinds`), so it survives the
list being found again. It is drawn as `linkFrom: "web"`, *found on the web*, with the host — and
only a `search` row is ever upgraded, so a link the article gave always wins.

**It is one call, not one search.** Nothing in the request bounds how many searches the provider
runs, and searches are what is billed ([ai-gateway.md § The four things that fail
silently](ai-gateway.md#the-four-things-that-fail-silently)). The bounds are the prompt, the small
result cap and a 60-second deadline; the count is the alarm — `webSearches` on the ledger row, and
`searches` / `searchesFrom` on the `citation find` log line.

**And the presses are bounded**, since each one is billed and a no-match stores nothing to stop the
same row being pressed again: the `citation-find` bucket of the shared per-owner allowance
(`FIND_RATE_POLICY` — two at once, twenty an hour, sixty a day, and a global daily fuse), taken
after the checks that refuse for free. The numbers are guesses, written as such. Added by the owed
code review, GPT Sol F11.

### It reads the search extract, never the work

Since 2026-09-29 (SPIDERYARN-READING2-5G) the same single call also judges the kept result's
**search extract** — the text Exa returns with each result, up to `MAX_EVIDENCE_EXCERPT`, typically
the abstract — against what the article uses the work for (`why` and the first citing paragraph):
*supports*, *partly*, or *the extract doesn't show it, though the full work might*. There is no
*does not support*: an extract is not the work. Greg's clarification set the scope — *"I was
basically thinking of ways to tweak that prompt/UI"* — so this rides on the retrieval Citations
already had rather than fetching the paper. Reading the paper itself came later, in what is now
*Dig deeper* (plan 261001a).

What code decides ([`src/citation-lookup.ts`](../../src/citation-lookup.ts)):

- **the result matches this work** before anything is judged (a match, not proof it is the work) — a row the article linked by DOI or arXiv
  keeps a judgement only if the result's URL carries that id, or its extract carries the DOI and its
  title names the work; any other row needs its title to name the work plus the first author's
  surname or the year. *Names the work* is anchored at the start: the result's title begins with the
  work's (a leading `[arXiv id]` dropped), followed by nothing or by short site parts such as
  "| Proceedings B | The Royal Society", never a notice ("- Retraction", "- Review") — so
  "Correction to: …" and "Comment on …" are refused. Stricter than `pageNamesTitle`, which still
  only chooses a link;
- **every quote shown is the extract's own slice**, found by `findQuote`'s strict `"spaced"` pass,
  at least six words; *supports* or *partly* without one becomes *doesn't show*, and *what the work
  does* without its own quote is dropped;
- **a known limit**: a search title the engine cut short (ending "…") is matched on its opening
  words, the first author and the year, so a different paper by the same author, in the same year,
  with the same opening words, could be taken for the work. The reader is only ever told it is *a
  page matching it*. Accepted, with the reasoning, in the plan's review log;
- **a stale reading is never shown**: it is stored with a fingerprint of everything sent, recomputed
  when the list is read, and attached only on a match.

What it says to the reader: the provenance line (§ [What we have read of the
work](#what-we-have-read-of-the-work-said-on-every-row)) names the extract, its size and host; the
verdict is labelled *the AI's reading of that extract*, the quotes *from the search extract*. **The
residual risk** is Debate's: a hostile page can steer the AI's reading while every quote shown is
genuinely in its extract. That is why the verdict is labelled as a reading and never as a fact.

On a row the article linked, the page found is used only for its extract: the row's `url` and
`linkFrom` never change. The reading lives in `lookup_*` columns on `citation_finds`, is attached as a
separate private `lookup` field by `attachLookups`, and never reaches a visitor.

**The search itself is shared.** `findWorkPage`, the call and its verdict without the route, the
allowance or the store, has a second caller: an uploaded paper's guessed web address
([ingest-queue.md § A guessed web address](ingest-queue.md#a-guessed-web-address-looked-for-once)),
which brings its own job id and allowance and judges the page more strictly than `pageNamesTitle`.

<a id="investigate-a-closer-look-at-one-work-on-demand"></a>

## Dig deeper: a closer look at one work, on demand

Asked for through the Feedback button on 2026-09-30 (SPIDERYARN-READING2-5Q), following 5G:

> That would still be ideal, but it's probably too expensive to do for every single paper. Perhaps
> instead, in a citation-item in Citations mode, provide an "Investigate" button that triggers this
> deeper dive, i.e. don't do it automatically for every single paper every time we run Citations
> mode.

Every owner row has **Dig deeper** — *Dig deeper again* once it has an answer, and the kept answer's
footer reads *Researched <date> · Dig deeper again*. It was **Investigate** until 2026-10-01, when
it became the same action as the glossary's and a comment's: always a web search, and always the
bigger model ([glossary.md § Digging deeper into a term](glossary.md#digging-deeper-into-a-term) has
Greg's words and the shared half). The code and the route keep the old name
(`makeInvestigateCitation`, `POST /api/citations/:slug/:id/investigate`). One press, in order:

1. **The forced web search** — `searchFirst` from [`src/dig-deeper.ts`](../../src/dig-deeper.ts),
   aimed with the work's title, authors, year and its own link when the article gave one, and the
   first citing passage that has any text, clipped (`CONTEXT_CHARS` in `src/dig-deeper.ts`)
   (*Searching the web…*). Its pages, and any matching passages from
   the reader's other articles, go after the cache breakpoint in `investigatePart`. A search that
   fails stops the press before anything else is spent, and the row keeps what it had.
2. ***Look it up*'s quick check** — unless the row already has a current reading that checked out —
   so code, not the model, decides which search result is the work, and the row's link and checked
   quote land first ([260930d](../plans/260930d-citations-one-button-look-it-up-and-investigate-merged.md)).
   A provider failure there stops the press before the larger call is paid for; finding nothing
   does not, and the reading goes on unconfirmed.
3. **The paper itself**, when it can be read (below).
4. **One streamed answer**, from the row and the article read again, kept on the row: *does it back
   the claim*, *how else it bears on this article*, and *for you* when the reader has written a
   profile or *why you're reading this one*. The quick check can land while this fails, and the row
   says so.

**Every call whose output the reader reads is on `DIG_DEEPER_MODEL`** — the quick check's verdict,
the paper's passages and the answer — whatever the article's
[High-powered AI](high-powered-ai.md) switch says, and whatever `SPIDERYARN_CITATIONS_FIND_MODEL` or
`SPIDERYARN_CITATION_INVESTIGATE_MODEL` is set to. Only the search step is on the quick tier, and it
writes nothing the reader reads. Nothing runs for every row. The design, its two plan reviews, the
probe and the code reviews are
[260930a](../plans/260930a-citations-investigate-one-work-on-demand.md); the move to Dig deeper is
[261001p](../plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md) stage 2; this says
what is built.

**It never quotes a source, and code makes sure of that before a word is sent.** Verbatim evidence
belongs to *Look it up*, the one path whose quotes code has found in an extract. Dig deeper
paraphrases and names the host. The server holds back anything in quotation marks (`"`, `“`, `‘`, and the marks other languages quote with, such as `«…»` and `„…“`)
or on a `>` line until code finds it in the article, the work's title or reference, or *Look it up*'s
verified quotes. Anything else stops the answer, nothing is kept, and the reader's screen is
cleared ([`investigate-quote-guard.ts`](../../src/investigate-quote-guard.ts)).

**What was read is said by code, from what the search returned**: how many results came back with
an extract, their hosts, and the longest extract in words. It does not say "we did not read the
paper": the probe found an extract that was most of a PDF. It says *we did not fetch any page
ourselves; an extract may be an abstract or part of a paper's text*. Then one identity line, in
one of three forms: a result is *the page an earlier quick check matched to the work*; an earlier
quick check *matched a page this search did not return an extract from*; or *we could not confirm
that any result is this work itself* — and the prompt forbids describing a look-alike as the work.
"Earlier" is deliberate: the match may come from this press's quick check or a previous one
(260930d, the C-2 ruling).

**It reads the paper itself, when it can, and says what it did.** Greg, on 5G and 5Q:

> Oh, Citations definitely needs to read the paper! Especially the References/Bibliography section.
> Otherwise it's useless!
>
> — Greg, 2026-10-01

Between the quick check and the answer, a press reads the cited paper through
[`paper-evidence.ts`](../../src/paper-evidence.ts) (plan
[261001a](../plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md),
stages 2 and 3): the row's own DOI or arXiv link, else the page the quick check matched. Only a PDF's
text layer counts as the paper, and code must confirm it is this work — the title at the top of page
one, then an identifier or the first author. A title restored only from repeated page furniture also
needs its author's by-line immediately after it, so an issue header cannot confirm the wrong PDF; an
author–year label needs the article's own reference entry to corroborate the registry title. A
registry title that disagrees with the article's is an identity conflict, so a registry-known
mistyped DOI is refused before its paper is fetched. The row then says,
from stored columns, one of six things — *we read the paper itself: a PDF from arxiv.org, 11,200
words; the AI was shown 4,900 of them…*, or why it could not — and the day it did so. It is a dated
snapshot: nothing re-fetches the paper on read, so the row never claims the remote paper is
unchanged. An answer from before this has no paper columns and is drawn exactly as before.

**The paper's words reach the reader only as passages code found.** When the paper was read, one
small JSON call (`citation-paper-passages`, the quick check's model, no tools, the chunks fenced as
evidence with a reminder after) offers up to three `{ chunk, quote, bears }`. Code keeps one only if
`verifyPassage` finds it in the one chunk it names, and stores that chunk's characters and page,
never the model's spelling ([`citation-paper-passages.ts`](../../src/citation-paper-passages.ts)).
They are shown under *the paper's own words, found by code in the text we read*, each with its page
and its bearing labelled as the AI's reading. None surviving says *the AI found no passage it could
point to in what it was shown*, never *the paper does not support*; a failed call does not fail the
press and says the pick failed. The streamed answer is sent the chunks and these passages to
paraphrase, told which state the paper is in, and still may not quote: the guard's allowed texts are
unchanged, because a quote presented as the paper's could otherwise be the article's words (GPT
Sol's plan review, P-1).

**It looks for the work's influence, on the pages its own search returned.** Since 2026-10-03 (plan
[261003m](../plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md),
stage 2). After the press's last re-read of the row, and beside the paper read, one small JSON call
(`citation-influence`, on `DIG_DEEPER_MODEL`, no tools, a strict schema whose three fields are each
a value or null) is shown the work's title, authors and year and the forced search's pages,
numbered and fenced as data. It answers a number on the list's own 0–1 rubric, the number of the
one page it rests on, and the words on that page; or three nulls when no page says, or when the
only evidence is a bare citation count with nothing to read it by. It is told never to answer from
memory. Code keeps the number only when all of this holds
([`citation-influence.ts`](../../src/citation-influence.ts) § `keepInfluence`):

- the page is one of those shown, and its address and title are copied from the search result,
  never from the model;
- **the page is about this work, not one that merely mentions it**: its title names the work by
  the quick check's title rule (`resultIsTheWork` with no identifier anchor: the title begins with
  the work's; "Comment on …", "… - Review" and an untitled result are refused);
- the words are found in that page's own extract by the strict pass (`verifyQuote`: at least six
  words, at most 400 characters), and what is kept is the extract's slice;
- the number is finite and within 0–1.

No call is made when no page shown has a title naming the work, since nothing it answered could be
kept. The call has its own 20-second deadline, is settled before the answer starts so it cannot
outlive the press's allowance, and is best-effort: a refusal, the deadline, an unreadable answer or
a failed check stores no influence and never fails the press. The press's log line says
`influenceKept`, and `influenceWhy` when not.

**What that does not prove.** A page about the work can still carry a figure that belongs to
something else on it. Code checks the page and the words, not what the words are about. So the row
calls it *an AI estimate from web evidence* and shows the quoted words, for the reader to judge.

It is stored on the press's own row, in five nullable columns: `influence`, `influence_quote`,
`influence_source_url`, `influence_source_title` and `influence_version`. Two CHECKs: the number,
quote, address and version are all null or all present (the title may be null beside them), and the
number is within 0–1. When it happened is the row's own `at`. `influence_version` is
`INFLUENCE_VERSION`, the stamp of this call's prompt and checks: bumping it stops every older
number being read without hiding the answers beside them. **`CITATION_INVESTIGATE_VERSION` is not
bumped**, because the streamed answer's prompt did not change; an answer kept before this has no
influence, and *Dig deeper again* looks for one. The streamed answer is not told the number.

How often a press finds one is not yet measured: `evals/citations-influence-dig.ts` is the probe,
and the first results go in
[261003f](../investigations/261003f-citations-influence-unknown-unless-confident-before-and-after.md).

**The prompt forbids quotation marks outright** since 2026-09-30. Allowing them round the article's
words and the work's title led the model to quote its own phrases, the paper's terms and result
titles too, and four of five real calls were stopped by the guard; with none allowed, seven of
seven finished (260930d). The guard still lets through a span it finds in the article or a checked
quote, so a harmless lapse does not stop an answer.

**Kept, private, and hidden when out of date.** One row per work in `citation_investigations`,
replaced by a second press. It is attached to an owner row only while its fingerprint matches.
The fingerprint covers what can be rebuilt on read: the article, the work's fields and link, `why`
and the citing passages, the reader's profile, *Look it up*'s current match, the prompt and
paper-selection versions, and the model's generation. The search's findings and the paper's fetched
content are not in it — they are a dated snapshot of what was read (`investigateContextHash` in
[`src/citation-investigate-context.ts`](../../src/citation-investigate-context.ts)). The model is `DIG_DEEPER_MODEL` on both the write and the read, so an environment override cannot
make the two disagree and hide a kept answer. Dig deeper bumped `CITATION_INVESTIGATE_VERSION`, so an
answer kept by *Investigate* no longer attaches and its row offers *Dig deeper* afresh. It never
reaches a visitor, and it is in all three exports. A failed *Dig deeper again* leaves the earlier
answer in place, and the row says so.

**Bounded** by its own allowance bucket, `citation-investigate` — not the `dig-deeper` one the
glossary and comments share, so a press here is never charged twice and a dig running there does
not refuse this one. The figures are `INVESTIGATE_RATE_POLICY` in
[`citation-investigate.ts`](../../src/citation-investigate.ts): one at a time, a per-reader hourly
and daily count, and a global daily fuse sized so that fuse × `INVESTIGATE_PRESS_BUDGET_USD` (a
press's worst case, now on Opus with the search) stays under a $50-a-day ceiling — $20 until Greg
raised it on 2026-10-02, when it bought only about 25 presses a day for everyone. The comment on
that constant carries the arithmetic and says which figures are estimated and which measured. The
lease covers every deadline in a press — the forced search, the quick check, the registry and the
paper's 25 seconds, the passages call, the influence call, the answer — plus a margin. The answer's own optional Exa tool is pinned and bounded by
`INVESTIGATE_MAX_TOTAL_RESULTS` and `INVESTIGATE_MAX_CHARACTERS`
([`citation-investigate.ts`](../../src/citation-investigate.ts)) — separate from the forced
search's `DIG_MAX_RESULTS`. On the gateway a press can record up to five jobs: `dig-deeper-search`,
`citations-find` when the quick check runs, `citation-paper-passages` when the paper's passages are
picked, `citation-influence` when a page of the search is about the work, and
`citation-investigate` for the streamed answer.

## Already an article here

Asked for through the Feedback button on 2026-09-30 (SPIDERYARN-READING2-5R):

> In Citations mode, we should also do a check to see if any of the cited-items are already present
> as articles in Spideryarn (on the user's shelf or in public articles), and if so, provide a special
> link to them.

A row whose work is already an article the reader can open gets one more line under its title:
**In your library** or **On the public shelf**, a link to our page in the same tab, with the
article's title and how it matched in the tooltip. A title match also names the matched article on
the row, because the same words are not the same identity and that is the one to check.
The design and GPT Sol's review of it are
[260930b](../plans/260930b-citations-say-when-a-cited-work-is-already-in-spideryarn.md).

**Never another reader's private article, not even its existence.** The candidates are one query,
[`pg-cited-in-spideryarn.ts`](../../src/store/pg-cited-in-spideryarn.ts), whose `where` is *mine (archived
or not), or public and not archived*, readable, with the owner taken from the request rather than passed in. Of
a stranger's public article it matches only what its public page already publishes — the extracted
title and byline, never the owner's rename, and the source address only as `publicSourceUrl` passes
it, never the address it was requested from.

**Matching**, strongest first ([`cited-in-spideryarn.ts`](../../src/cited-in-spideryarn.ts)): the
work's DOI or arXiv id is the one the article's address *is* (a `doi.org` or `arxiv.org` path, parsed
by host); the same id as the one **we found** for the reader's own uploaded PDF; the same request
target (`sameTarget`); or the same extracted title by the identity normaliser `keysOf` uses — four
words not contradicted by the first author, or three with the author agreeing. The reader's own copy
wins over a public one, and their live copy over an archived one.

**Since 2026-10-01** ([261001i](../plans/261001i-already-in-spideryarn-on-the-hover-card-archived-and-uploaded.md)),
three things 260930b deferred:

- **The hover card in the prose** draws the same line, from the same component.
- **The reader's own archived articles** are matched too — archived is off the shelf, but the article
  still opens for its owner by link — and the line says **In your library · archived**, so nobody
  goes looking for it on the shelf. A stranger's archived article is still never a candidate.
- **An uploaded PDF** has no address, so it could only match by title. Now the reader's own upload
  also matches by the DOI or arXiv id we found for it (`upload_source_guesses`, a `canonical` row
  only — one built from an identifier checked against the PDF, never a page that merely looked
  like it). The tooltip says it is the id *we found*, not one the article gave. Only for the
  reader's own uploads: a stranger's shared upload shows its guess in the visitor's banner
  ([261002g](../plans/261002g-a-banner-on-every-public-readable-article.md)), but it is not used
  for matching here.

It does not change *what we have read*: a copy here is not a reading of the work, so the row still
says we have not read it. It is attached in the owner's `GET /api/citations` only — not in
`loadCitations`, which chat, *Look it up* and *Dig deeper* also call — and never stored.

## Chat can read it

Chat — typed, a passage question, and Live — can read the stored list through the
`article_citations` tool, to answer a question about a work the piece leans on or to aim a web search
at the right paper. It reads the list and never makes one: no list is an ordinary answer, a stale one
shows no rows, and a capped one is counted as *the stored list*, never the article's total. The
experimental switch governs this mode's screen, not the reader's own derived data, so the tool is not
behind it. [chat-tools.md](chat-tools.md) has the tool. Each row's influence is the effective one
(§ [A row](#a-row)): where *Dig deeper* found one on the web, the row gives that number and says it
is *an AI estimate from the web, from a page on* that host, and our words outside the fence say
what that means. The page's words and its address are not in the row. `loadCitations` attaches the
owner's kept answers, so the tool needed no wider read.

## Making it again

From the Metadata page: *AI processing* has a Citations row, since 2026-09-29, and it is the
only redo — the panel says nothing when its list was made by an older prompt
([260929c](../plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md)). A press is one
model call and no web search (that is *Look it up*, per row); the list is replaced only if the run
succeeds, and a work found again keeps its id, so a link *Look it up* stored stays with it. The row is
drawn with the experimental switch off too, as Timeline's and Debate's are. Why it is safe to offer
is in [`src/rerun-steps.ts`](../../src/rerun-steps.ts).

## Who sees it

Making the list, and *Look it up*, are owner-only, and behind the
[experimental switch](experimental-features.md). **Since 2026-09-29 a visitor to a public article
sees a stored list** in the band, from the page's own payload: each work's address re-judged by
`publicCitationUrl` (a refused one takes the link off the row, not the row), its dedupe `key` left
behind, and the owner's *Look it up* results kept private (SPIDERYARN-READING2-56,
[260929c](../plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md)).

## Deferred

Selecting a work to mark every passage that cites it (`?cite=`), and with it the *In Citations* foot
button on the hover card and the threshold reveal it would need; marking every occurrence of a
mention in its block rather than only an unambiguous one; joining the citation section to the *link*
and *note* cards, so a work cited by a hyperlink or a footnote marker gets it too; *Find more* past
the cap; a real citation count from a registry (*Dig deeper*'s influence is an AI estimate from a web page, not a count; Crossref's `is-referenced-by-count` for a row with a DOI is still deferred, [261003m](../plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md) § Passed over); searching every unlinked row at once; marks in the prose for a visitor; *Dig deeper* from the hover card, or on every row at once; an HTML page as the paper's full text; quoting the paper inside the streamed answer; *In your library* for a visitor, or used as the text *Look it up* reads; a stranger's public upload matched by our guess at its DOI; an author–year PDF bibliography's entries; a PDF list's entry for a visitor; OpenAlex (needs an account). Each is in one of the plans' lists of what is deliberately not built, with the reason.

## The code

[`src/citations.ts`](../../src/citations.ts) (the stage) ·
[`citation-reference-list.ts`](../../src/citation-reference-list.ts) (a PDF's numbered list) ·
[`useCitations.ts`](../../src/web/useCitations.ts) (`useCitationsRead` is the half `OwnedReader`
mounts) ·
[`CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx) ·
[`CitationInvestigation.tsx`](../../src/web/CitationInvestigation.tsx) (Dig deeper's row) ·
[`citation-influence.ts`](../../src/citation-influence.ts) (Dig deeper's influence call and what
code keeps of it) ·
[`citation-effective-influence.ts`](../../src/citation-effective-influence.ts) (the one read path) ·
[`cited-in-spideryarn.ts`](../../src/cited-in-spideryarn.ts) and
[`pg-cited-in-spideryarn.ts`](../../src/store/pg-cited-in-spideryarn.ts) (already an article here) ·
[`CitationsMode.tsx`](../../src/web/modes/citations/CitationsMode.tsx) ·
[`citations.css`](../../src/web/styles/citations.css) ·
[`annotate.ts`](../../src/web/annotate.ts) § `citeMarks` (the prose marks) ·
[`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx) § `CiteCard` (the card).

---

Up: [reading-view-overview.md](reading-view-overview.md)
