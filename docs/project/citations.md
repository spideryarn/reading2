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
gives them, more than two authors shortened to *First et al.*, one plain sentence on *what the piece uses it for*, and a quiet line: relevance and influence as two small bars (the numbers in their tooltip, as in the glossary),
where the link came from, and **first cited**, a jump to the passage
([`BlockRef`](../../src/web/BlockRef.tsx)). A work the article names only in its bibliography says
*only in the references* and jumps there. § [Which citation, and whose
entry](#which-citation-and-whose-entry) is what the by-line and *first cited* show since
2026-09-30.

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

`why` is written **from the article**, and nothing that makes the list reads the cited work. So the
row labels `why` *what the article uses it for*, and every row and hover card carries one quiet line
saying what we have read. Usually that is nothing: *We have not read this work, only the article that
cites it.* After *Look it up* it names what was read, which is only ever a search engine's extract
of a matching page, and never the work itself. `readNoteOf` in
[`CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx) is the one source of that line for both
surfaces, total over `linkFrom` and the lookup's state. The design and its two plan reviews are
[260929g](../plans/260929g-check-a-cited-paper-supports-the-claim.md).

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

**Shown**: the by-line's tooltip holds the authors as given and the entry, labelled as the entry in
the article's own reference list, which we have not looked up; the prose hover card shows the entry
in full, since a card is what a finger gets. `entry` is owner-only: `publicCitedWork` does not name
it, and widening that projection is a change to a defence, left for Greg.

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
It draws the title with its link, authors · year, `why`, and *cited in N paragraphs* — or *only in
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

**Since 2026-09-30 there is no *Look it up* button: it is the first step of *Investigate*'s one
press** (§ [Investigate](#investigate-a-closer-look-at-one-work-on-demand)), asked for through the
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
already had rather than fetching the paper; reading the paper itself is the plan's proposed later
stage.

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

## Investigate: a closer look at one work, on demand

Asked for through the Feedback button on 2026-09-30 (SPIDERYARN-READING2-5Q), following 5G:

> That would still be ideal, but it's probably too expensive to do for every single paper. Perhaps
> instead, in a citation-item in Citations mode, provide an "Investigate" button that triggers this
> deeper dive, i.e. don't do it automatically for every single paper every time we run Citations
> mode.

Every owner row has **Investigate**, the one button since 2026-09-30
([260930d](../plans/260930d-citations-one-button-look-it-up-and-investigate-merged.md)). A press
first runs *Look it up*'s quick check — unless the row already has a current reading that checked
out — so code, not the model, decides which search result is the work, and the row's link and
checked quote land first. A provider failure there stops the press before the larger call is paid
for; finding nothing does not, and the reading goes on unconfirmed. The row and the article are
then read again, and the reading is written from that. The quick check can land while the reading
fails, and the row says so. One allowance covers both calls: one at a time, 8 an hour and 20 a day
per reader, 55 a day across everyone. Then, as before, one streamed answer, written
from a few web searches and kept on the row: *does it back the claim*, *how else it bears on this
article*, and *for you* when the reader has written a profile or *why you're reading this one*.
Nothing runs for every row. The design, its two plan reviews, the probe and the code reviews are
[260930a](../plans/260930a-citations-investigate-one-work-on-demand.md); this says what is built.

**It never quotes a source, and code makes sure of that before a word is sent.** Verbatim evidence
belongs to *Look it up*, the one path whose quotes code has found in an extract. Investigate
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

**The prompt forbids quotation marks outright** since 2026-09-30. Allowing them round the article's
words and the work's title led the model to quote its own phrases, the paper's terms and result
titles too, and four of five real calls were stopped by the guard; with none allowed, seven of
seven finished (260930d). The guard still lets through a span it finds in the article or a checked
quote, so a harmless lapse does not stop an answer.

**Kept, private, and hidden when out of date.** One row per work in `citation_investigations`,
replaced by a second press. It is attached to an owner row only while its fingerprint matches.
The fingerprint covers everything sent: the article, the work's fields and link, `why` and the
citing passages, the reader's profile, *Look it up*'s match, the prompt version and the model. It
never reaches a visitor, and it is in all three exports. A failed *Investigate again* leaves the
earlier answer in place, and the row says so.

**Bounded** by its own allowance bucket, `citation-investigate`: one at a time, 8 an hour and 20 a
day per reader, and 55 a day across everyone. These numbers come from the probe: $0.12 a press on
average and $0.15 at worst, budgeted at $0.30, plus the quick check's ~3¢ since the two were merged
and a 3,000-token answer ceiling — 55 × about $0.345 is about $19, under a $20-a-day ceiling. Exa is pinned, with 8
results of at most 8,000 characters each ([`citation-investigate.ts`](../../src/citation-investigate.ts)).
It is the `citation-investigate` job on the gateway.

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
[`pg-cited-in-spideryarn.ts`](../../src/store/pg-cited-in-spideryarn.ts), whose `where` is *mine or
public*, readable and not archived, with the owner taken from the request rather than passed in. Of
a stranger's public article it matches only what its public page already publishes — the extracted
title and byline, never the owner's rename, and the source address only as `publicSourceUrl` passes
it, never the address it was requested from.

**Matching**, strongest first ([`cited-in-spideryarn.ts`](../../src/cited-in-spideryarn.ts)): the
work's DOI or arXiv id is the one the article's address *is* (a `doi.org` or `arxiv.org` path, parsed
by host); the same request target (`sameTarget`); or the same extracted title by the identity
normaliser `keysOf` uses — four words not contradicted by the first author, or three with the author
agreeing. The reader's own copy wins over a public one.

It does not change *what we have read*: a copy here is not a reading of the work, so the row still
says we have not read it. It is attached in the owner's `GET /api/citations` only — not in
`loadCitations`, which chat, *Look it up* and *Investigate* also call — and never stored.

## Chat can read it

Chat — typed, a passage question, and Live — can read the stored list through the
`article_citations` tool, to answer a question about a work the piece leans on or to aim a web search
at the right paper. It reads the list and never makes one: no list is an ordinary answer, a stale one
shows no rows, and a capped one is counted as *the stored list*, never the article's total. The
experimental switch governs this mode's screen, not the reader's own derived data, so the tool is not
behind it. [chat-tools.md](chat-tools.md) has the tool.

## Making it again

From the Metadata page: *Re-run AI processing* has a Citations row, since 2026-09-29, and it is the
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
the cap; real influence from a citation database; searching every unlinked row at once; marks in the prose for a visitor; *Investigate* from the hover card, on every row at once, or reading the paper itself; *In your library* on the hover card, for a visitor, for an archived article, or used as the text *Look it up* reads; an author–year PDF bibliography's entries; a DOI or arXiv id in a PDF's entry used as the row's link; the entry for a visitor; a bibliographic lookup such as OpenAlex (a new outside service, Greg's decision). Each is in one of the plans' lists of what is deliberately not built, with the reason.

## The code

[`src/citations.ts`](../../src/citations.ts) (the stage) ·
[`citation-reference-list.ts`](../../src/citation-reference-list.ts) (a PDF's numbered list) ·
[`useCitations.ts`](../../src/web/useCitations.ts) (`useCitationsRead` is the half `OwnedReader`
mounts) ·
[`CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx) ·
[`CitationInvestigation.tsx`](../../src/web/CitationInvestigation.tsx) (Investigate's row) ·
[`cited-in-spideryarn.ts`](../../src/cited-in-spideryarn.ts) and
[`pg-cited-in-spideryarn.ts`](../../src/store/pg-cited-in-spideryarn.ts) (already an article here) ·
[`CitationsMode.tsx`](../../src/web/modes/citations/CitationsMode.tsx) ·
[`citations.css`](../../src/web/styles/citations.css) ·
[`annotate.ts`](../../src/web/annotate.ts) § `citeMarks` (the prose marks) ·
[`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx) § `CiteCard` (the card).

---

Up: [reading-view-overview.md](reading-view-overview.md)
