# An arXiv HTML paper's title block, tidied at import

Up: [plans.md](../project/plans.md)

Report `spya-xg4jyr` (#505, Sentry `SPIDERYARN-READING2-FG`, filed 2026-10-09 01:16 UTC), Overseer
queue item **qi-tfx8kg3j**. An administrator's report (`feedback-reporter.ts` exit 0), so trusted
input, built simplest version first. Filed from
`/read/arxiv-1706-03762-spya-wyt7j0?mode=structure…`, *Attention Is All You Need*, imported from
`arxiv.org/html/1706.03762` at 00:51 the same night.

> The author import for this paper is still pretty messy. You can read it from production, maybe
> take screenshots and you'll see what I mean. I thought we were fixing this as part of the import
> process with a small model that would tidy it up?
>
> — Greg, 2026-10-09

## Prior work

Checked 2026-10-09: `docs/plans/`, `docs/user-feedback/`, `git log origin/dev`, `gjd-remote ls`,
the queue. Nothing else carries this id. What this stands on:

- **[260929d](260929d-authors-and-affiliations-at-import-shown-and-linked.md)** and
  **[261001l](261001l-pdf-stacked-bylines.md)**: the small model Greg remembers. It exists, and it
  runs **only on a PDF**: `src/pdf-authors.ts` reads names and affiliations off the transcribed
  front page, and code holds them to the page's own characters.
- **[261005l](261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md)**:
  an arXiv link now imports the paper's **HTML** rendering where there is one, not the PDF. So
  since 2026-10-05 an arXiv paper takes a path the model is not on.
- **[261007d](261007d-front-matter-folded-by-default-and-arxiv-html-authors.md)**: the masthead
  gets the names off LaTeXML's markup (`latexmlAuthorNames`, names only, all or nothing), and the
  byline rows fold away by default when every one of them looks like a byline. Its stage 2 measured
  reading affiliations by rule (wrong on 7 of 19 pages, silently) and read none.
- The leftover worktree `fbayettj-arxiv-import` is 261005l's, merged; nothing in it is unlanded
  for this.

## What production shows (read-only, and screenshots of the visitor view)

The same paper is on production twice, which makes the comparison exact:

| | imported | masthead | the rows under it |
|---|---|---|---|
| `arxiv-1706-spya-rb3kej` | 2026-10-05, **from the PDF** | 8 names, each with its affiliation | one clean row per author: `Noam Shazeer∗ Google Brain noam@google.com` |
| `arxiv-1706-03762-spya-wyt7j0` (the report) | 2026-10-09, **from the HTML** | 8 names, no affiliations | the licence line, then **one 194-word paragraph** |

That paragraph, as stored:

> Ashish Vaswani ††thanks: Equal contribution. Listing order is random. Jakob proposed … Noam
> Shazeer11footnotemark: 1 Affiliation: Google Brain Email: noam@google.com Niki
> Parmar11footnotemark: 1 Affiliation: Google Research Email: nikip@google.com … Illia
> Polosukhin11footnotemark: 1 ††thanks: Work performed while at Google Research. Email: …

Three separate faults, the first two at stage 2 and the third in the reading view:

1. **LaTeXML's hover-only notes are drawn inline.** On arXiv each author's affiliation and email,
   and each `\thanks` footnote, sit in a pop-up that CSS hides; `ltx_note_type` (`thanks:`,
   `footnotemark:`), `ltx_contact_name` (`Affiliation:`, `Email:`) and the note's repeated mark are
   labels for that pop-up. Readability drops the classes, so every label and every pop-up becomes
   text in one line.
2. **Readability deletes an author's details from the prose.** It looks for a byline element by
   class or id (`/byline|author|…/`), takes the first one whose text is under 100 characters, uses
   its text as `byline` and **removes the element**. `ltx_creator ltx_role_author` and `ltx_author_notes` both
   match. Here it took Ashish Vaswani's notes (his affiliation and email are missing from the
   prose); on `arxiv-2609-01481-spya-jytq2h` it took the whole first creator (*Haoyang Yan* is not
   in the prose at all); on `2608-13566v1` it was the byline the masthead showed
   (`Timur Galimzyanov Affiliation: …`). `latexmlAuthorNames` fixed the masthead and left the
   deletion in place. This is the class of
   [260928a](../postmortems/260928a-a-library-field-that-holds-one-value-for-a-list-keeps-one.md):
   a library's metadata heuristic, read for its value and not for what it does to get it.
3. **Nothing folds.** 261007d's rule starts at block 0 and wants every row to look like a byline.
   Block 0 is the licence line (*Provided proper attribution is provided, Google hereby grants…*),
   which does not, so there is no run. Even without it, the 194-word paragraph reads as prose.

## What to build

### Stage 1. The title block becomes one row per author, before Readability

A sixth shape in `prepareLatexml` (`src/latexml.ts`), under its three rules (a supported LaTeXML
source address, an exact measured shape or the page untouched, ids kept). Revised after GPT Sol's
plan review (§ The plan review); the first draft rebuilt the rows as text and dropped every mark.

**One parser, all or nothing.** `readTitleBlock` reads `div.ltx_authors` into rows: each creator's
name nodes, its contacts, and its notes. `latexmlAuthorNames` becomes that parser's names, so the
masthead and the rewrite cannot disagree about what the block is. On top of today's gate it
checks everything the rewrite consumes: an `ltx_author_notes` holds one `ltx_author_notes_content`
holding only `ltx_contact` elements; a note is a worded `\thanks` (`ltx_role_thanks`) or a
`\footnotemark` (`ltx_role_footnotemark`) whose only content is its mark, label and number; and
**a `\footnotemark` must resolve** (below). Anything else and the block is left exactly as it was.

**What it writes**, built on a copy and swapped in only once checked:

```
<div id="(the block's own, if any)">
  <p>Ashish Vaswani<sup>1</sup><br>Google Brain<br>avaswani@google.com</p>
  <p>Noam Shazeer<sup>1</sup><br>Google Brain<br>noam@google.com</p>
  …
  <p>Aidan N. Gomez<sup>1,2</sup><br>University of Toronto<br>aidan@cs.toronto.edu</p>
  …
  <p><sup>1</sup> Equal contribution. Listing order is random. Jakob proposed …</p>
  <p><sup>2</sup> Work performed while at Google Brain.</p>
  <p><sup>3</sup> Work performed while at Google Research.</p>
</div>
```

- **The page's nodes are moved, not retyped**, so an ORCID link, a working `mailto:`, a formula or
  an id inside a name, a contact or a note survives as it was. What is left behind is LaTeXML's
  pop-up furniture: the `thanks:`/`footnotemark:` labels (`ltx_note_type`), the
  `Affiliation:`/`Email:` labels (`ltx_contact_name`), each note's marks and repeated number, the
  separators between creators, and the wrapper spans. An empty `mailto:` link is unwrapped to its
  text.
- **Marks are kept, and made consistent** (Sol's P1: a `\footnotemark` is how a second author
  shares a note, as *These authors contributed equally* does on 2610.08392). LaTeX numbers the
  `\thanks` notes of the title in order, and `\footnotemark[N]` repeats the Nth. LaTeXML prints the
  first as `†` and the repeat as `1`, which is the mess. So the notes are numbered in the order they
  appear in the block, each name carries the numbers of the notes it holds or repeats, and each
  worded note is written once, after the author rows, under its number, as a PDF prints it at the
  foot of the first page. **A `\footnotemark` whose Nth note is not in the block** (a `\thanks` on
  the title counts towards N, and then the mapping is not proved) **refuses the whole rewrite.**
- **Two checks before the swap, either of which refuses**: every word of the block, less the
  furniture above, is in the new markup exactly as often (a multiset of letter-and-digit runs,
  leaving out the numbers this adds); and every id or name inside the block that a link in the page
  points at is still in it (rule 3).
- **One line when nobody has details.** A block whose creators carry no contacts and no notes
  (2610.08790: eight bare names) becomes one `<p>` of the names, comma-separated, rather than eight
  rows.
- **No `author` class survives**, so Readability has nothing in the block to take as a byline and
  remove. Readability takes the first element whose class or id looks byline-shaped and whose text
  is under 100 characters, records its text and **deletes it**: on this paper that was Ashish
  Vaswani's notes (his affiliation and email are missing from the prose), on a shorter creator it
  is the whole creator (*Haoyang Yan* is missing from `arxiv-2609-01481-spya-jytq2h`).
- **The masthead reads the names before the rewrite.** `metaAuthors` keeps its place and reads the
  `<meta>` tags as it does today; the title block's names, its fallback, are read before
  `prepareDocument` and handed to it (Sol's P2: moving the whole of `metaAuthors` earlier would let
  a `<meta>` inside furniture that `prepareDocument` deletes become authoritative).
- `LatexmlStats` counts it (`titleBlocks`).

**Measured before it lands**: the 10 author fixtures already in `tests/fixtures/latexml/` (cut
from real pages), this paper, and the two production HTML imports above, through
`readArticle` before and after: how many get the rewrite, and the first rows of each, read in full.
Any author's word missing after that was there before is a bug, not a price.

**Built 2026-10-09, and measured.** Red first: `tests/latexml-title-block.test.ts` (31 tests), on
the eleven real-page fixtures (this paper's title block added, emails replaced), with an
end-to-end `runExtract` → `splitIntoBlocks` test that was red on the fused paragraph. Nine of the
eleven fixtures are rewritten; 2610.08392 refuses (its `\footnotemark` is 2 and the block has one
note: not proved) and 2610.08781 refuses (institutions marked up as creators). Every rewritten
fixture keeps every word.

Twenty live pages, fetched 2026-10-09 (the three production HTML imports and 17 from this week's
`cs.CL`, `q-bio.NC`, `stat.ML` and `math.PR` listings), through `runExtract`, the rows above the
abstract read in full (in the scratch directory):

| | pages |
|---|---|
| rewritten into rows | 16 |
| refused, left as before | 4: several people in one `personname` (2610.10548, .10690, .10849, .11142) |
| a word missing after | 0 (the code refuses on it; none refused for it) |

What the rows look like: this paper is the table in § What to build, exactly; 2610.10761 is five
rows with `1 Equal contribution.` and `2 This work was performed while at Harvard University.`
under them; 2608.13566 is twelve rows of name and institution, its first author back.

**Two things the measurement showed that are not this change:**

- a block of bare names becomes one `<p>`, and on two pages (2610.10592, .10642) Readability then
  leaves that short line out of the article, as it left the `ltx_authors` block out before. The
  masthead has the names; nothing that was in the prose is lost;
- `\hohsettheme`, `\workshoptitle` and `\DeclareSortingNamekeyTemplate…` above the authors on
  three pages: TeX macros LaTeXML did not expand, printed as text. Already so; not queued.

*The simpler option passed over*: strip the labels (`thanks:`, `Affiliation:`) and leave one
paragraph. It is half the code, and leaves a 194-word paragraph of eight people fused, and the
first author deleted. *The other one passed over*: rewrite the `\thanks` notes into the footnote
machinery (`src/notes.ts`'s canonical shape), so the contribution statement becomes footnote 1 at
the end, as the PDF prints it. It is the right home and is also what LaTeXML's **body** footnotes
need (they are drawn mid-sentence today: block 30 of this paper reads *"…extremely small gradients
1 1 1 To illustrate why the dot products get large…"*). That is a second pipeline's contract,
measured over a different set of shapes, and a bigger change than this report; it is deferred with
a queue entry, and this stage's numbered notes under the author rows are what it would move.

### Stage 2. The fold — nothing built, and why

After stage 1 the reported paper's rows are: the licence line, eight author rows, the three
numbered notes, then *Abstract*. 261007d's rule still folds nothing, for two reasons either of
which is enough (Sol's P2): block 0 is the licence, and the 120-word contribution note reads as
prose, which the rule refuses by design. Widening the rule to step over a leading non-byline row is a rule
about hiding the article's own text, measured against 49 articles; doing it for one paper is the
wrong trade. What the reader gets instead is eight tidy rows, the same as the PDF import gave.
Named in the note; the long-term answer is 261007d's deferred "front matter marked at import"
(`role`), for which LaTeXML is the one source where the marking would be structural rather than
guessed.

### Not built: a model reading affiliations on the HTML path — a question for Greg

Greg's question has a direct answer: the small model is on the PDF path only, and arXiv imports
stopped taking that path on 2026-10-05. **The mess in the prose needs no model**: it is a layout
fault in markup that says exactly what each piece is, and a model rewriting the displayed byline
would be text we could not check. What a model would add is **affiliations on the masthead names**
(the tooltip), which the rule could not read reliably (261007d: wrong on 7 of 19). That is a new
call on every arXiv HTML import, in a stage that has no model call today. It is the obvious next
step and it is Greg's to choose; asked as a question file, with the recommendation to do it by
reusing `pdf-authors.ts`'s reader and its check against the page.

### Existing articles

New imports only. The reported article changes only when re-extracted, which is a write to
production; shown on a local import of the same URL, and Greg is asked before his row is touched.
The other HTML imports stay as they are: the pass over old articles (`qi-tjb2xjmj`) is the one Greg
declined on 2026-10-07 (*"i'm more focused on newer articles"*).

## Stages

1. The rewrite and its tests, red first, on fixtures cut from real pages (this paper's title block
   added), with an end-to-end `runExtract` → `splitIntoBlocks` test; the names read before
   `prepareDocument`; the measurement; a local import of `arxiv.org/html/1706.03762`,
   screenshotted.
2. Docs (`content-extraction.md`, the latexml header), a postmortem for the Readability deletion,
   GPT Sol's code review, the gates, push, the note, the question, the queue.

GPT Sol reviews this plan before stage 1 and the code before the push.

## The plan review

GPT Sol, read-only, 2026-10-09 ([the review](261009d-arxiv-title-block-plan-review-sol.md)),
verdict *revise before build*. No P0. Each finding checked against the code and the fixtures.

| | Sev | Finding | Outcome |
|---|---|---|---|
| 1 | P1 | Dropping every `\footnotemark` loses who shares a note (2610.08785, 2610.08392) | Accepted: notes numbered, marks kept and made consistent, an unresolved mark refuses |
| 2 | P1 | Names parsing is not a gate for what else is rebuilt; text rebuilding loses links and ids | Accepted: one parser validates every consumed node; nodes moved; a word check and rule 3 before the swap |
| 3 | P2 | Moving all of `metaAuthors` earlier is broader than needed | Accepted: only the title block's names are read early |
| 4 | P2 | Readability removes the first short byline-shaped element, not always "the first author" | Accepted: diagnosis reworded |
| 5 | P2 | The fold has two blockers, not one | Accepted: both named |
| 6 | P2 | An end-to-end stage-3 test and a stats count | Accepted |

Sol also agreed the model call is not what fixes the prose (§ Not built).

## The code review

GPT Sol, write-capable, 2026-10-09
([the review](261009d-arxiv-title-block-code-review-sol.md)), verdict *ready to push*. No P0. It
fixed each of these itself, red first, and the author read the diff:

| | Sev | Finding | Fix |
|---|---|---|---|
| 1 | P1 | A `\thanks` on the title is `.ltx_pubnote` in LaTeXML, which the count of earlier notes missed, so a later `\footnotemark` could point at the wrong note | counted; a refusing and a resolving test |
| 2 | P1 | The word check excused any words inside a contact label or a note label | the labels must be exactly the measured ones (`Affiliation:`, `Email:` …), the marks and number the measured shape, or the block is refused |
| 3 | P1 | A moved element with its own author-ish class (`author-email`) would still be taken and deleted by Readability | the rewrite refuses if anything in its output is a Readability byline candidate |
| 4 | P2 | A block element inside a contact or note cannot sit in a `<p>`; an image-only contact was dropped | refused; kept |
| 5 | P2 | Two comments still counted four rewrites | corrected |

The twenty-page measurement after its fixes: unchanged, 16 of 20.

## Ledger

- 2026-10-09: prior-work check; production read-only (both imports of the paper, the stored rows);
  visitor-view screenshots by a Sonnet subagent; plan written.
- 2026-10-09: GPT Sol's plan review, *revise before build*; stage 1 revised (§ The plan review).
- 2026-10-09: built red first; measured on 20 live pages; a local import of 1706.03762v7
  screenshotted by a Sonnet subagent (`261009d-shot-1-desktop.png`, `-2-desktop-authors`,
  `-3-phone`): one row per author, the three notes numbered, no labels.
- 2026-10-09: GPT Sol's code review, *ready to push*, five fixes of its own (§ The code review);
  the gates; queue entries `qi-d7g2qmze` (body footnotes) and `qi-yhkw2ej6` (Readability's
  deletion elsewhere); question `q-qjbb9a` to Greg.
