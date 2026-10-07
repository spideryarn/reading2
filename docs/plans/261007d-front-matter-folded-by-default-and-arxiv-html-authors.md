# Front matter folded by default, and authors read off an arXiv HTML page

Up: [plans.md](../project/plans.md)

Report `spya-duh4w3` (suggestion, filed 2026-10-06T22:16Z), Overseer queue item **qi-e5cj927m**.
The row was proven an administrator's by `scripts/feedback-reporter.ts` (exit 0), so it is trusted
input and is built, simplest version first. Filed from
`/read/2608-13566v1-spya-yurten?summary=fuller…`, an arXiv HTML import.

> A lot of articles start with a list of authors and maybe acknowledgements and a bunch of other
> stuff that's not super interesting. I wonder if there's a way that we can identify them as such
> and default collapse them so that you kind of jump straight into the article itself when you
> first open it. And more generally, I feel like often the author names and affiliations and
> whatnot are not really imported that well. … I think you'll often see that, you know, the line
> breaks aren't right, the affiliations aren't quite right. I mean, maybe we even have a special
> affiliations tooltip type because that would be clean. I don't know, maybe that's overkill. …
> in an ideal world, you'd be able to see all the papers by a given author. … That might be
> overkill, and actually it's probably out of scope for now. Maybe it's a separate task. I think
> what's most important, though, is just the author inputs and tidying up the presentation so that
> you can see the article because they're default collapsed.
>
> — Greg, 2026-10-06 (the whole of it is in the feedback note)

## Prior work

Checked 2026-10-07: `docs/plans/`, `docs/user-feedback/`, `git log origin/dev`, `gjd-remote ls`,
the Overseer's queue. The only session carrying the id is this one. What is already built, and
this plan stands on:

- **[260929d](260929d-authors-and-affiliations-at-import-shown-and-linked.md)**: `meta.authors`
  (`{name, affiliations[]}`), filled from `citation_author` tags on a web page and from a checked
  model call on a PDF. The masthead draws each name with **a tooltip of its affiliations** and a
  link to a shelf search. So the "affiliations tooltip" Greg wonders about exists, wherever
  `authors` is filled. Its § Not in this plan names the step this plan takes: *"hide the byline
  and affiliation records in the reading view … since the masthead now says the same thing
  better."*
- **[261001l](261001l-pdf-stacked-bylines.md)**: stacked PDF bylines.
- **[261002e](261002e-collapsible-headings-and-fold-all.md)**: the fold store, `src/web/fold.ts`. A
  hidden row keeps its `tr` and loses its cells, so everything that measures rows keeps working.
- **[261007b](261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md)**, landed
  hours ago from the same page: the leading `h1` that repeats the masthead's title (and the old
  wrapper's `· ~N min read` line) is hidden through that store, as "the echo".
- **[261003c](261003c-summary-and-structure-skip-the-front-matter.md)**: the prompts already treat
  this material as paperwork. It deferred "the deterministic strip", which this is the display
  half of.

## What production looks like (read-only, 2026-10-07)

All 49 articles' current revisions, first 14 blocks each (the dump holds readers' text and stayed
in a scratch directory). What sits between the title and the article itself:

- **Byline material in about 28 of 49**, and it is drawn badly in every import version:
  - names, institutions and emails fused into one paragraph with no separators (the reported
    article's block 2 is 1,236 characters of names, a repeated `Affiliation:` label and a
    `Correspondence` line; `arxiv-1811`, `2607-22753v1`, `2406-01506v1` likewise);
  - footnote markers glued to names: `Layfield1,2*`, `Chrysikou#1`, `Singha,1`, `Ben-Kish¹†`,
    `XChristopher Baldassano` (an ORCID glyph read as `X`);
  - one author per block, stacked: the Attention paper is eight such paragraphs.
- **Affiliation lines** as their own block in about 12 PDFs; **correspondence and email** lines in
  about 9; journal furniture before the title in 3 old PDFs.
- **An "Abstract" heading in about 28**, at any level from `h1` to `h6`. A few papers have the
  abstract as a bare paragraph instead.
- **Acknowledgements at the start: none.** They are at the end. Two near-misses (a funding and
  competing-interests footnote column that a PDF put after the first paragraph; one thank-you line
  opening an essay).
- **Keywords come after the abstract** (11), and received/accepted dates appear once, mid-body.
- **No block is labelled.** `role` is null on all 10,717 blocks except 95 footnotes. Nothing stored
  says which blocks were the byline: the PDF front-matter pass leaves no record on the revision.
- **`meta.authors` is filled on 9 of 49** (1 of 19 web, 8 of 25 PDFs). The three arXiv HTML imports
  are the worst: `authors` null, and `byline` is the first author's name fused with
  `Affiliation: …` (the reported article's masthead reads that).

So the two halves of the report are the same blocks seen twice. They are ugly in the prose, and
where `authors` is filled the masthead already says them cleanly.

## What to build

### Stage 1. The reading view folds the front matter away, with one control to show it

A pure function, `frontMatter(article, echo)` in a new `src/web/front-matter.ts`, returns the ids
of one contiguous run of leading blocks. The prose table hides those rows by default. Nothing is
removed from the data: models, exports, search and the other bands see every block, exactly as
with the echo.

**The rule, v1** (rewritten after the plan review; the first draft, "everything between the title
and the Abstract heading", is in § The plan review with what was wrong with it).

Block 0 must be an `h1`, and is never in the run. The run is the blocks that follow it (after the
echo's second row, when the old wrapper's line is there), **each of which passes all three tests,
stopping at the first that fails one**:

1. **Positive evidence that it is byline material**, any one of:
   - an email address;
   - an author's full name, matched as a whole phrase with its capitals, from `meta.authors` or
     from `meta.byline` split on `;`. Never a lone surname: Long, Young, Field and Li are words;
   - an institution word (University, Department, Institute, College, School, Laboratory, Centre
     or Center, Hospital, and the like; a closed list in the file);
   - a lead phrase: `Correspondence`, `Corresponding author`, `E-mail:`, `equal contribution`,
     `contributed equally`, `ORCID`.
2. **It does not read as prose.** Two measures, and it must pass both:
   - of its words (leaving out `of and for the in at`, emails and numbers), at most about 30%
     start with a lower-case letter. An affiliation is mostly capitalised and a sentence is not.
     This is what stops a standfirst such as *"Researchers at Stanford University developed a
     cheaper method…"*;
   - at most `max(2, 4%)` of its words are sentence words from a closed, lower-case-only list
     (`is are was were we that this which have has been it our you not can will …`). Lower-case
     only because Will and Can are given names, and `I` is not on it because it is an initial.

   A block that opens with a lead phrase and is under 40 words is excused the first measure:
   *"These authors contributed equally to this work"* is all lower case.
3. **Its shape:** at most 300 words; and **a heading is in the run only if it is an author's name
   or a known label** (`Authors`, `Affiliations`, `ARTICLE INFO`, `Correspondence`). Any other
   heading ends the run: *"Why Medical School Costs So Much"* has an institution word and is
   capitalised throughout.

The whole run is at most 15 blocks and 600 words; over either, there is no run. No run, and the
article is drawn as today. The thresholds are starting values: the measurement below may move
them, and the plan then says what moved and why.

**What this gives up, named:**

- **It stops early, in the safe direction.** A block of bare names with no email or institution,
  on an article whose `meta` names nobody, is not evidence, so nothing folds. A long
  `Corresponding author … All authors approve the paper. Competing interests …` block reads as
  prose and ends the run with itself still showing.
- **A dedication fused into the authors' address paragraph is hidden with it** (the plan
  review's F2: arXiv 1605.02595 ends its address block *"In memory of our teacher…"*). Accepted:
  it is one paragraph, the control is one press away, and no rule that reads text can split it.
- **Not folded in v1:** keywords (they follow the abstract), mid-body furniture (dates, DOI,
  funding footnotes), tables of contents, a front matter with no title `h1` at block 0 (4 old
  PDFs), a web essay's date line. Each is in § Deferred.

**How the rows are hidden.** Through the fold store, as a third kind beside folds and the echo:

- the store is told the run with the article (`setFoldArticle`);
- **shut on arrival**, for every article, on every load (not persisted, like folds). **When it
  resets:** a different article, or the same article with a different run (a re-extraction, or
  `meta` changing what counts as a name), is shut again; the same run stays as the reader left
  it, whatever else changes, a rename included (F10);
- unlike the echo it **can be opened**: by its control, and by `revealBlock`, so a jump to one of
  its blocks (a search hit, a Structure row, a comment, `?at=`) opens the whole run and lands on
  the block. Opening is all-or-nothing. **Opening also unfolds every real fold that covers the
  run** (F5: after a rename block 0's heading is an ordinary foldable heading and can be folded
  over the whole article; a control that then did nothing would read as broken);
- **a heading inside the run is never foldable**, open or shut, and *Fold all* does not count it
  (F5, F10: this is what removes the question of a fold made inside an open run);
- `isFolded` is true for its rows while shut, as for any hidden row.

**Sections that start inside the run** (F3; the first draft said `isFoldedAway` true, and that
was wrong). Three consumers ask about a section by its first block: the reading position,
Structure's focus, and the arrow keys. The Structure prompt invites a node that spans the byline
*and* the abstract, so a section can start on a hidden row and still be on screen. Required
behaviour, and the tests are written against this, not against a predicate's name:

- a section wholly inside the shut run is stepped over by the arrow keys and is never named as
  where the reader is;
- a section that starts in the shut run and continues past it is reachable: the arrow keys land
  on its first visible row **without opening the run**, and while the reader is in its visible
  part it is the one named in `?at=` and focused in Structure.

The likely shape, for the builder to confirm or replace: a run row answers `isFoldedAway` false,
like the echo, so the two measuring consumers see a zero-height start at the top of the section's
own first visible row and are right without change, and a wholly hidden section loses the tie to
the next one, as a folded one does; `step` in `keynav.ts` asks the store where a start *lands*
(the first row at or after it that the run does not hide) and skips a section whose landing is
the next section's start.

**Marginalia** (F4, and it is a bug today for an ordinary fold too): `useMarginLayout` measures
every margin note, including those inside a hidden cell, and each zero-height one still pushes
the next down by its 8px gap. Relations writes an item on every paperwork paragraph, so a shut
run would push the abstract's first note down. The layout leaves out notes on rows the store
hides, and lays out again when the store changes. Red first, on a real fold.

**The control.** On the masthead's facts line, beside *Fold all*: a text button, *Show authors and
details* / *Hide authors and details*, with a `ControlTip` saying what is behind it (*"The N lines
under the title: authors, affiliations, contact details."*). Absent when there
is no run. The masthead is where the authors are already drawn, and it is directly above where
the run sits.

*The simpler option passed over:* a synthetic row in the table at the place of the run (*"6 lines
hidden · Show"*). It reads well, but the table has no rows that are not blocks, and everything
that walks rows would have to learn about one. *The other one passed over:* marking the blocks at
import (`role: "front-matter"`), which is the right long-term home and lets models skip them too,
but needs a schema value, a backfill of production and a decision about fingerprints. Deferred,
and the display rule is one function to delete when it arrives.

**Reader state on a hidden block.** A comment or highlight anchored in the run would not be seen
until the run is opened. Counted in production before landing (read-only); if any exist, a jump
from the comment list still opens the run, and that is accepted and written down.

**Measured before it lands.** The function is run, read-only, over the current revision of every
production article, and over the local fixtures. Reported here: how many articles get a run, its
length, and **every hidden block read in full by a person** (in the scratch directory, not in
git; F2: the first draft said its first 80 characters, which would have missed a dedication at
the end of a paragraph), looking for one thing: a block of the article's own prose hidden. Any
such block changes the rule, not the count. Counted too: comments, highlights and margin items
anchored in a run. Forty-nine articles cannot prove a rule for every future import, which is why
the rule needs positive evidence per block and fails towards showing.

**Built 2026-10-07, and what the building changed.**

- **`?at=` names such a section by its first visible block** (the "likely shape" above was wrong
  for the reading position, and the builder found it red). The spy wrote the section's hidden
  first block; a reload, or turning a phone, restores `?at=` through `scrollToBlock`, which opens
  the run, so the front matter opened under a reader who was in the abstract. The spy now writes
  `visibleFrom(id)`, the first block after the run. A pasted link that names a run block still
  opens the run.
- **One store question, `visibleFrom(id)`**, in place of a predicate about sections (Sol's F3
  said a range-aware predicate was required; it was not). `steppableStarts` in `keynav.ts` maps
  each start through it and merges two that land on the same row, which is how a section wholly
  inside the run is stepped over.
- **The control goes by what is on screen**: `frontOpen` is false while a real fold covers the
  run, so a press always shows something.
- **A run never ends on a heading**: a trailing `Authors` label is not folded away from lines
  still showing under it.
- **What moved in the rule, each on the measurement:**
  - names are taken from `meta.byline` split on `; , &` and ` and `, with footnote marks off each
    piece, not on `;` alone. Eight production papers open with exactly the PDF's own byline line
    (`Taylor Webb1,*, Keith J. Holyoak1 , and Hongjing Lu1,2`) and nothing else to go on; this
    took 14 articles with a run to 22. A piece of one word is dropped, so `Hasson, Uri` gives
    nothing;
  - one lower-case letter glued after a name counts as a mark when a mark follows it (`Singha,1`);
  - `Departments` joins the institution words;
  - the lead-phrase allowance is 20 words, not 40. At 40 a 33-word block folded that ran a
    corresponding author's address into *"All authors approve the paper. Competing interest
    statement…"* and the keywords, which this plan says stays showing;
  - "opens with a lead phrase" means within its first three words (this plan's own example,
    *"These authors contributed equally"*, does not open with one).

**The measurement** (read-only, all 49 current revisions; every hidden block read in full by the
builder; the text stayed in the scratch directory):

| | |
|---|---|
| articles with a run | 22 of 49 |
| run length | 1 to 8 blocks, median 2; 45 blocks hidden in all |
| hidden blocks that are the article's own prose | **0** |
| comments and chat threads anchored in a run | 0 |
| model-made items naming a run block | Relations 1, arc 3, and Structure rows on most |

By article: the reported one hides its 133-word fused author paragraph and lands on the
`Abstract` heading; the Attention paper hides all eight stacked author blocks; the web essays
hide nothing (one hides a single name line). **Left showing, and why:** two PDFs whose `meta`
names nobody; one arXiv page whose authors are fused with a funding disclaimer (197 words, reads
as prose); three PDFs whose block 0 is not an `h1`; two whose credits are not byline-shaped; one
long contact block. All are the safe direction. The five local fixtures get no run, so no
existing test changed its meaning.

**Known, not fixed:** a Title Case *paragraph* with an institution word directly under the title
(*"How Harvard University Lost Its Way"* as a `p`, not a heading) would fold. None in
production; no cheap test separates it from an affiliation line.

Red first on the store (25), the arrow keys, the reading position, marginalia on an ordinary fold
(Sol's F4 measured: 16px for two hidden notes) and the table. 92 mutants; nine survived the first
pass, eight got a test, one is equivalent.

### Stage 2. The arXiv HTML author reader takes two more shapes (names only)

**The first draft of this stage was already built, and the prior-work check missed it.** It
proposed a reader of LaTeXML's author markup. `latexmlAuthorNames` (`src/latexml.ts`) has been
that reader since 2026-10-05
([261005l](261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md),
stage 2), names only, all or nothing. Run today on the reported page it returns all twelve names;
the stored byline (`Timur Galimzyanov Affiliation: …`) is from the import, which predates it or
ran beside it. So a re-import already fixes that masthead, and what is left is smaller.

**Measured, 2026-10-07**: 19 live `arxiv.org/html` pages (the three in production and 16 from this
week's listings), fetched once, hand-labelled, kept in a scratch directory.

| | pages |
|---|---|
| existing reader gives the right names | 6 |
| existing reader gives `null` (byline left as Readability's) | 13, one of them a page with no author block |
| existing reader gives a wrong list | 0 |

Of the 13, five really do hold several people in one `personname` and one has no author block;
refusing is right. The rest are refused for reasons that are not about the names: a `", "`
separator between creators where the reader allows only `""` and `"and"`, and a footnote
(`.ltx_note`) set beside the personname instead of inside it. One (`2610.08750`) is not yet
explained.

**So v1:** the reader accepts three more shapes, each a closed widening seen on a real page, and
nothing else changes:

- `","` between creators, beside `""` and `"and"` (`2610.08790`);
- a `\thanks` footnote (`span.ltx_note.ltx_role_thanks`) set beside the personname instead of
  inside it (four pages). It hides nobody: a creator still holds exactly one personname and no
  words of its own;
- a name that is the text of a link to that person's own ORCID record (`2610.08750`, the page
  unexplained when this was written). The link must be the whole name, its address an ORCID id
  and nothing else, and its words still pass every one-name check. This one rests on a single
  page; taking it out is one branch and one helper.

**Result, built 2026-10-07**, the same 19 pages against the hand-labelled names:

| | before | after |
|---|---|---|
| right | 6 | 12 |
| `null` | 13 | 7 |
| wrong | 0 | 0 |

The seven still refused: five with several people in one `personname`, one with no author block,
and `2610.08781`, where institutions and icon links (*Code*, *Dataset*) are marked up as creators
beside names carrying `<math>`. A test pins each of its nine creators refusing alone: seven on
the `<math>`, two on the link. Red first from fixtures cut from the real pages (emails replaced);
ten mutants of the new code, all killed.

**Affiliations are not read, and this is measured, not assumed.** A rule of one affiliation per
`ltx_role_affiliation` contact gave the right affiliations on 5 of 19 pages and wrong ones on 7
without any sign of it: one institution split across three contacts, an email or a disclaimer
inside a contact, a shared block attached to the last author only, the real affiliation in a
thanks note. The markup does not say which is which. An arXiv HTML paper therefore has names with
no tooltip of affiliations; the affiliations are in the folded run, one press away.

**New imports only.** Existing articles keep their stored byline until re-extracted. That is a
write to readers' data and is not this run's to make; it joins the queued rebuild (below).

### Stage 3. The record

`reading-view-overview.md` (a line), `content-extraction.md` (the arXiv reader), `/help` if it
describes folding, the feedback note and its bookkeeping, queue entries for each deferred half.

## Deferred, each with a queue entry before the note says shipped

- **Authors as first-class objects**, with a page of an author's papers. Greg: *"probably out of
  scope for now. Maybe it's a separate task."* Noted, not built. Today a name links to a shelf
  search by string (260929d).
- **Re-extracting the articles already imported**, so old PDFs and web pages get `authors` and a
  clean byline. A production write; joins `qi-tjb2xjmj` (the rebuild 261007b queued) rather than
  becoming a second entry for the same sweep.
- **Front matter marked at import** (`role`), so models and exports skip it too and the display
  rule is deleted. With it: keywords, mid-body furniture, a front matter with no title heading.
- **Visitors do not get `authors`** (260929d § Not in this plan; `src/public/dto.ts` is a listed
  defence). Unchanged here; a visitor gets the fold and the byline string.

## Stages

1. `front-matter.ts` and its tests, red first; the store's third kind; the control; the
   production and fixture measurement; mutation check; browser pass (Sonnet, Playwright) with
   screenshots before and after.
2. The two extra shapes in `latexmlAuthorNames`, tests from trimmed fixtures of fetched pages,
   the 19-page sample again.
3. Docs, GPT Sol's code review, the gates, push, the note, the queue.

GPT Sol reviews this plan before Stage 1 and the code before the push.

## The plan review

GPT Sol, read-only, 2026-10-07
([the review](261007d-front-matter-folded-by-default-plan-review-sol.md)), verdict *revise before
build*. No P0. Every finding was checked against the code; Opus arbitrated F9 and the replacement
rule.

| | Sev | Finding | Outcome |
|---|---|---|---|
| F1 | P1 | "Title to Abstract" hides real prose: PNAS's *Significance*, JAMA's *Key Points*; and a legacy web import's `h1` is ours, so it is no evidence of a paper | Accepted. The interval is gone: every block needs its own evidence and must not read as prose |
| F2 | P1 | Reading the first 80 characters of each hidden block cannot see a dedication at the end of one | Accepted: read in full. The fused dedication itself is an accepted miss, named above |
| F3 | P1 | `isFoldedAway` true is wrong for a section that starts in the run and continues into the abstract | Accepted: behaviour specified by section, above |
| F4 | P1 | Margin notes in hidden cells still take 8px each in the layout | Accepted, and fixed for ordinary folds too |
| F5 | P1 | The control is a no-op under a real fold; folds made on run headings | Accepted: opening unfolds what covers the run; run headings are never foldable |
| F6 | P1 | Stage 2 was already built (261005l) | Accepted; found independently by the spike. Stage 2 rewritten |
| F7 | P1 | The proposed gate and "drop `sup`" were weaker than the existing reader's | Moot: the existing reader's gates are kept as they are |
| F8 | P1 | LaTeXML affiliation contacts are not clean enough to store | Accepted, and measured (wrong on 7 of 19): affiliations are not read |
| F9 | P1 | Where the masthead has no trustworthy author list, folding hides the only correct copy; fold only with `meta.authors`, or ship a re-extraction | **Overruled, after Opus arbitrated.** See below |
| F10 | P2 | The third state has no transition rules | Accepted: stated above |

**F9, overruled, and what it costs.** Sol's facts are right: on 40 of 49 production articles the
masthead has no structured author list, and on the reported article it shows the first of twelve
authors with `Affiliation: …` glued on. Folding the byline rows there hides the correct list
behind one press. It is folded anyway because Greg asked for exactly this default (*"default
collapse them so that you kind of jump straight into the article itself"*), because requiring
`meta.authors` would leave the feature doing nothing on four articles in five including the one
he filed from, and because the re-extraction that fixes those mastheads is a write to readers'
data this run may not make (`qi-tjb2xjmj`). **Until that runs, such an article has a thin or
wrong masthead and its full author rows one press away.** It is one condition in
`front-matter.ts` to change, and it is Greg's to overturn.

**The first rule, kept for the record.** Block 0 an `h1`; the run ended just before an `Abstract`
heading found within 16 blocks; caps of 15 blocks and 600 words; a second, evidence-based rule
for papers with no such heading "only if the measurement supports it". The second rule became the
only rule, tightened by Opus's three constructed false positives (a standfirst naming a
university; a heading using *School* as a noun; a surname that is a word).

## Questions, decisions, assumptions

- **Decided here, for Greg to overturn:** the control is in the masthead and says *Show authors
  and details*; the fold is not remembered between visits; a jump into the run opens it.
- **Decided against the reviewer, for Greg to overturn:** the byline rows fold even where the
  masthead has no author list or a wrong byline (§ The plan review, F9).
- Acknowledgements are in the report's words and not in the data's front matter; nothing is built
  for them at the start of an article. The end of an article is a different request.

## Ledger

- 2026-10-07: prior-work check; production sampled read-only by a Sonnet subagent; plan written.
- 2026-10-07: a Sonnet spike over 19 live arXiv HTML pages found the stage-2 reader already
  exists (261005l); stage 2 rewritten to the two shapes it refuses for no good reason, and
  affiliations dropped on the measurement.
- 2026-10-07: GPT Sol's plan review, *revise before build*; Opus arbitrated F9 and the
  replacement rule; stage 1 rewritten around per-block evidence.
- 2026-10-07: stage 2 built by an Opus subagent: three shapes, 6 to 12 of 19 pages right, none
  wrong. It narrowed the brief's "any `.ltx_note` sibling" to the `\thanks` note the four pages
  actually carry, and traced `2610.08750` to an ORCID-linked name.
- 2026-10-07: stage 1 built by an Opus subagent; § Built, and what the building changed.
