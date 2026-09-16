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
gives them, one plain sentence on *what the piece uses it for*, and a quiet line: relevance and influence as two small bars (the numbers in their tooltip, as in the glossary),
where the link came from, and **first cited**, a jump to the passage
([`BlockRef`](../../src/web/BlockRef.tsx)). A work the article names only in its bibliography says
*only in the references* and jumps there.

## The one safety property

**Every address a row presents as the work's own was in the article, and code found it.** The model
never writes a URL we keep: a DOI or arXiv id in the reference's text or hrefs, else one of the
article's own anchors whose text is the title or the mention, else — and on every ambiguity — a
**Google Scholar search**. `linkFor` in [`src/citations.ts`](../../src/citations.ts) is the order;
the plan says why a link to the wrong work is worse than a search.

The row always says which. An address shows its host and its rule (*doi.org · DOI in the article*); a
search is drawn as a search — the title is not a link, and the one link says *search Scholar*.
`sourceOf` in [`CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx) is total over `linkFrom`.

## The orders, and the bar

Four, under the glossary's order buttons ([glossary.md](glossary.md)):

- **prioritised**, the default — `(2 × relevance + influence) / 3` against the threshold bar, in
  first-cited order. A work missing a score survives every position of the bar
  ([`threshold.ts`](../../src/web/threshold.ts)), and the line under it says how many are hidden. The
  bar starts at **0.25**, lowered from 0.40 on 2026-09-15 so most works come in by default — 92% on
  average on the local runs
  ([260915d](../plans/260915d-prioritised-by-default-in-search-and-lower-default-thresholds-everywhere.md)).
  Falls back to first cited
  when no position of the bar would hide anything.
- **first cited** — the artefact's own order.
- **relevance**, **influence** — descending, a work missing that score last.

Only the two raw scores are drawn on a row, never the combination — the glossary's rule. The foot
says `influence` is the model's memory, not a citation count, and, **only when the model reported
it**, that the list was capped at 80.

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
It draws the title with its link, authors · year, `why`, and *cited in N paragraphs*. The provenance
is the panel's own `sourceOf`, so a `search` row is drawn here as a search exactly as it is there:
two surfaces disagreeing about whether an address is the work's own would teach a reader something
false. Not in the card, each deliberately: the score bars (the card says meaning, the band says
numbers), *Find it* (billed, and a surface that opens on a hover is the wrong place for it), and a
foot button into the mode (it needs `?cite=`).

**A finger gets the card on the first tap.** `mark.cite` is in `tapSelector` and in
`NOT_A_BLOCK_SELECTION` — both, and the pair is the point: the second alone would take the tap away
and give nothing back, leaving a dead hole in the paragraph wherever a work is cited. There is no
second-tap commit, because the card's action is the link it carries.

**Owner-only by construction.** The list is read in `OwnedReader`, so a visitor has no works, hence
no marks and no card section — § Who sees it, satisfied without a check.

## Find it on the web

A row whose article gave no link offers **Find it** beside its Scholar search — owner-only, one row
at a time, a few seconds. **It explains itself in a `ControlTip` rather than a `title`** since
2026-09-16, asked for through the Feedback button (SPIDERYARN-READING2-3K): *"make it clearer what
that does (e.g. rich tooltip) and the effect of running it"*. The card is bounded by what the code
checks rather than by what the sentence wants to say — no call count, no fixed price, and not *its
own page*, since `namesTitle` / `pageNamesTitle` accept a result whose title **or excerpt** carries
the work's title. What it adds over the `title` it replaced is the effect: it costs money, a press
that finds nothing stores nothing, and the Scholar fallback stays either way.
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

## Chat can read it

Chat — typed, a passage question, and Live — can read the stored list through the
`article_citations` tool, to answer a question about a work the piece leans on or to aim a web search
at the right paper. It reads the list and never makes one: no list is an ordinary answer, a stale one
shows no rows, and a capped one is counted as *the stored list*, never the article's total. The
experimental switch governs this mode's screen, not the reader's own derived data, so the tool is not
behind it. [chat-tools.md](chat-tools.md) has the tool.

## Who sees it

Owner-only, and behind the [experimental switch](experimental-features.md). A visitor gets the
explanatory band — the public projection its rows' URLs would pass through is not built.

## Deferred

Selecting a work to mark every passage that cites it (`?cite=`), and with it the *In Citations* foot
button on the hover card and the threshold reveal it would need; marking every occurrence of a
mention in its block rather than only an unambiguous one; joining the citation section to the *link*
and *note* cards, so a work cited by a hyperlink or a footnote marker gets it too; *Find more* past
the cap; real influence from a citation database; searching every unlinked row at once; a visitor's
list. Each is in one of the two plans' lists of what is deliberately not built, with the reason.

## The code

[`src/citations.ts`](../../src/citations.ts) (the stage) ·
[`useCitations.ts`](../../src/web/useCitations.ts) (`useCitationsRead` is the half `OwnedReader`
mounts) ·
[`CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx) ·
[`CitationsMode.tsx`](../../src/web/modes/citations/CitationsMode.tsx) ·
[`citations.css`](../../src/web/styles/citations.css) ·
[`annotate.ts`](../../src/web/annotate.ts) § `citeMarks` (the prose marks) ·
[`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx) § `CiteCard` (the card).

---

Up: [reading-view-overview.md](reading-view-overview.md)
