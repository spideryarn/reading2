# A TeX macro LaTeXML could not expand leaves the page

Report `spya-nhhd0x` (Greg, an admin, 2026-10-09 02:04 UTC). Note:
[docs/user-feedback/](../user-feedback/) (written at the end).

> This article seems to have a little bit of import junk at the top. Not that fussed about fixing
> this particular article. I'd just like to improve our import process going forward.
>
> ```
> \hohsettheme
>
> hohRose
> ```
>
> — Greg, 2026-10-09

The article is `arxiv-2609-01481v1-spya-sjatfv`, imported from `arxiv.org/html/2609.01481v1`. It is
not being re-extracted in production: the fix applies going forward, as Greg asked.

## Why it happened

**The path is the HTML one, Readability's**
([content-extraction.md § A LaTeXML page](../project/content-extraction.md#a-latexml-page-arxivs-html)),
not the PDF transcriber. arXiv's HTML rendering is made by LaTeXML, and when LaTeXML meets a macro
it has no definition for, it does not drop it. It writes the macro's name into the page as text,
inside a marker of its own, and goes on to treat the macro's arguments as ordinary text:

```html
<article class="ltx_document ltx_authors_1line" lang="en">
<div id="p1" class="ltx_para ltx_noindent"><span id="p1.1" class="ltx_ERROR undefined">\hohsettheme</span>
<p id="p1.2" class="ltx_p">hohRose</p>
</div>
<h1 class="ltx_title ltx_title_document">Harness-of-Harness: …</h1>
```

The paper's preamble said `\hohsettheme{hohRose}`, a colour theme from its own style file. Nothing
in [`src/latexml.ts`](../../src/latexml.ts) knows the `ltx_ERROR` class, so the marker and its
argument went to the reader as two blocks of prose. arXiv shows the same thing in red on its own
page; it is LaTeXML's error report, not the author's text.

**The class: a converter's error report shipped as the document's words.** The source was
translated by a tool that failed on part of it, and the tool's notice of that failure is text in
the output.

## How common it is

Measured on 2026-10-09 by fetching `arxiv.org/html/<id>` for 90 papers from today's new
listings in cs.AI, cs.CL, math.PR, physics.optics, q-bio.NC and econ.TH. 79 were LaTeXML pages,
and **9 of the 79 (11%) carry `ltx_ERROR` markers**, 135 in all, every one `ltx_ERROR undefined`
holding a single `\name`:

| paper | macro | where | what follows the marker |
|---|---|---|---|
| 2609.01481v1 (Greg's) | `\hohsettheme` | before the title | `<p>hohRose</p>`: junk |
| 2610.03827, 2610.10833 | `\workshoptitle` | before the title | `<p>Linguistic Principles for Foundation Models (LP4FM)</p>`: real, if peripheral |
| 2610.10724 | `\DeclareSortingNamekeyTemplate`, `\keypart` ×4 | before the title | nothing: a paragraph of markers only |
| 2610.10738, 2610.10918 | `\metadata`, `\pdfinterwordspaceon` | before the title | `[VS]Work done while interning at …`, `[Correspondence]` and emails: real |
| 2610.10541 | `\copyrightclause`, `\conference`, `\cormark`, `\cortext` | before the title | the licence and workshop text, `[1]Corresponding author.`: real |
| 2610.10541 | `\sep` ×3 | the keywords | `Semantic table interpretation \sepcolumn type annotation…`: real words, glued |
| 2610.10541 | `\captionof` | a table caption | `tableThe 39 FinalFormats…`: real, with `table` glued on |
| 2610.10732, 2610.11413 | `\bmsection` ×10 | the back matter | `<p>Funding We acknowledge…</p>`, `Acknowledgment…`, `Disclosures…`: real |
| 2610.11413 | `\bibliographyfullrefs` | the end | `<p>Biblio_paper_brillouin</p>`: junk (a .bib file name) |
| 2610.11126 | `\ucite` ×104 | mid-sentence, the whole body | `…ordered phases\ucitedagottoComplexityStronglyCorrelated2005. A broad range…`: junk, a citation key glued to the prose |

So the marker is always junk, and what follows it is usually the author's real words and
sometimes junk. The fix has to tell those apart, and it can only do that where the shape says so.

## The change

A seventh rewrite in `prepareLatexml` (`removeUndefinedMacro`, src/latexml.ts), under the three
rules every rewrite in that module already follows: only at arXiv's or ar5iv's `/html/`, only
beneath `article.ltx_document`, and the page is left as it was when an id a link points at would go.
Revised after GPT Sol's plan review ([its answer](261009f-latex-undefined-macros-plan-review-sol.md)),
which found the first draft's argument rules could delete an author's words.

1. **The report goes.** A `span.ltx_ERROR.undefined` whose whole text is one control sequence and
   which has no element children is removed, wherever it stands in the visible page: prose,
   headings, captions, table cells. Not inside `math`, `svg`, `code`, `pre` and the other tags the
   maths pass skips, where the next pass reads text as TeX or source. Where taking it out would
   join two words (`CC BY 4.0.\conferenceWorkshop`), a space stands in its place; `\sep`,
   elsarticle's and CEUR's keyword separator, becomes `; `.
2. **An argument that is a name from the source goes with it.** If the report's next element
   sibling, with only whitespace between, is a `p.ltx_p` with no element children whose whole text
   is one token of at most 64 characters with an **underscore, or a lower-case letter straight
   before a capital**, that paragraph goes too: `hohRose`, `Biblio_paper_brillouin`. An ordinary
   word (`Funding`, `Acknowledgments`), a sentence and an acronym (`LP4FM`) have neither, and stay.
   The cost is a one-word paragraph of camel-cased prose, a product name such as `PyTorch`, straight
   after an undefined macro: not seen in the sample.
3. **A citation key after a citation macro goes.** If the macro's name contains `cite` and the text
   straight after the report starts with a key (`[\w:\-/+]+`, `.` or `,` only between key
   characters, so the sentence's own full stop stays) that has **a digit, an underscore or a
   capital inside it**, the key goes. That is all 104 of `\ucite`, including the two keys with no
   year. `\excite electrons` and `\citeauthor Smith` keep their words. The reader loses a citation
   marker they could not have used; the bibliography is still there.

Sol's other point taken: the first draft also deleted a `div.ltx_para` left empty. Stage 3 emits
nothing for an empty `div`, so that rule bought nothing and put a link target at risk; it is gone.
Sol's suggested alternative to rules 2 and 3, an allowlist of exactly the macros seen
(`\hohsettheme`, `\bibliographyfullrefs`, `\ucite`), was declined: it would fix these three
papers and no others, and the next paper's theme macro has another name. The shape test on the
argument is the discriminator instead, and its negative cases are pinned.

`LatexmlStats` gets `undefinedMacros` (reports removed) beside the other counts.

### The result, through the real stage 2 and stage 3

The ten pages with reports (the nine from the sample and Greg's), blocks before and after, by a
scratch script calling `runExtract` and `splitIntoBlocks`:

| paper | blocks | what changed |
|---|---|---|
| 2609.01481v1 | 332 → 330 | `\hohsettheme` and `hohRose` gone |
| 2610.03827, 2610.10833 | −1 each | `\workshoptitle` gone |
| 2610.10541 | 227 → 225 | `\copyrightclause` and `\captionof` gone; `CC BY 4.0). Workshop on…` with a space; `\cormark[1] \cortext[1]Corresponding author.` reads `[1] [1]Corresponding author.`; the keywords read `Semantic table interpretation; column type annotation; …` |
| 2610.10724 | 68 → 67 | the block of five `\keypart`-style reports gone |
| 2610.10732, 2610.11413 | −5, −7 | each `\bmsection` gone, the funding, acknowledgment and disclosure paragraphs word for word; `\bibliographyfullrefs` and `Biblio_paper_brillouin` gone |
| 2610.11126 | 228 → 228 | no `\ucite` and no key left: `…complex ordered phases. A broad range…` |
| 2610.10738, 2610.10918 | unchanged | their reports were in front matter Readability already left out |

No backslash is left in any of the ten except real TeX inside maths.

### What it deliberately does not do

- **It does not delete the real words that follow a marker.** Funding statements, the workshop
  title, the correspondence line, the licence and the keywords stay. Pre-title paragraphs are
  front matter, and since [261007d](261007d-front-matter-folded-by-default-and-arxiv-html-authors.md)
  front matter is folded by default, so they cost a reader little.
- **It does not take off an optional argument**: `[VS]`, `[1]`, `[Correspondence]` stay glued to
  the text after them. `[Correspondence]` says something; `[1]` does not; nothing in the markup
  tells them apart.
- **It does not unglue `\captionof{table}{…}`**: `tableThe 39 …` stays. A one-paper shape.
- **It does not touch** `[email=…, orcid=…]` paragraphs (2610.10541), which is a document class's
  `\author[…]` options read as text. No `ltx_ERROR` marks it, so it is a different shape, and the
  author block is folded.
- **It does not touch the PDF path**, which is a model transcribing pages and never sees TeX.

### The simpler option passed over

Removing only the marker (step 1) would have been one selector and no judgement. It was not
enough for the report: Greg would still have seen `hohRose` at the top of the page, and the
`\ucite` paper would still carry 104 keys glued into its sentences. Steps 2 and 3 are each one
exact shape, measured, and the rest is named above rather than guessed at.

## Tests, red first

In `tests/latexml.test.ts` § *fix 8*, with fixtures cut verbatim from three papers (Greg's preamble,
a `\ucite` paragraph, a `\bmsection` funding paragraph), each seen red before the code:

- Greg's preamble: the report and `hohRose` gone, the title kept; and through `runExtract` and
  `splitIntoBlocks`, no block holds either. That end-to-end test was **green before the fix** at
  first, because the synthetic page lacked arXiv's `ltx_page_main` wrappers and Readability then
  picked the section alone and dropped the preamble anyway. With the wrappers it is red, as the
  real page is.
- `\ucite`: the four sentences read cleanly; a key with no year goes too.
- `\bmsection`: `Funding This project…` stays word for word.
- `\conference` leaves a space; `\sep` is a semicolon; a report in a heading, a caption and a
  table cell goes.
- Left alone: another address; outside `article.ltx_document`; an `ltx_ERROR` holding more than
  one control sequence, without `undefined`, or not a `span`; a report inside `math`, `code` or
  `svg` (that test seen red with the guard taken out); `LP4FM`, `Funding`, `None.`,
  `Acknowledgments` after a report; `\excite electrons`, `\citeauthor Smith`; a report or argument
  a link points at; and the paragraph round them, which keeps its id.

## Docs

[content-extraction.md § A LaTeXML page](../project/content-extraction.md#a-latexml-page-arxivs-html)
has a row in its table, and § The one thing this pipeline deletes names this as a deletion by a
producer's class name. The module header of `src/latexml.ts` names the one exception to *nothing
here deletes an author's words*: an argument that is a name from the source.

## Code review

GPT Sol's code review ([its answer](261009f-latex-undefined-macros-code-review-sol.md)) found and
fixed three bugs, each red-first in `tests/latexml.test.ts`, all one class: the text repair after a
removal looked only at the marker's DOM siblings, not at the rendered text either side of it. A
marker at the edge of an `<em>` joined two words; a citation key removed after a source space left
`structure ;` (three of them in 2610.11126, which the survey above had not checked for); `\sep`
inside a wrapper left `alpha ; beta`. One helper now reads the inline run on each side and stops at
a block. Write-up:
[postmortems/261009f](../postmortems/261009f-dom-siblings-are-not-rendered-text-boundaries.md).
Re-run on four of the ten pages afterwards: no report, key or stray space before punctuation left.
