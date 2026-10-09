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

A sixth rule in `prepareLatexml`, under the three rules every rewrite in that module already
follows: only at arXiv's or ar5iv's `/html/`, only beneath `article.ltx_document`, and the page is
left as it was when an id a link points at would go.

1. **The marker goes.** An element with the class `ltx_ERROR` whose whole text is one control
   sequence (`\name`, letters and `@`, an optional `*`) and which has no element children is
   removed. It is LaTeXML's report, not the author's text, wherever it stands.
2. **An argument that is one bare name goes with it.** If the marker's next element sibling, with
   nothing but whitespace between them, is a `p.ltx_p` whose whole text is a single
   whitespace-free token of at most 64 characters, with no element children, that paragraph goes
   too. That is `hohRose` and `Biblio_paper_brillouin`, and nothing an author writes as prose: a
   sentence has a space in it. A one-word paragraph of real prose right after an undefined macro is
   the cost, and it was not seen in the sample.
3. **A citation key after a citation macro goes.** If the macro's name contains `cite` (any case)
   and the text straight after the marker starts with a key (`[\w:\-/+]+`, with `.` or `,` allowed
   only between key characters, so `a,b` and `smith.2005` are taken but the sentence's own full
   stop is not), that key is removed. That is all 104 of `\ucite`. The reader loses a citation
   marker they could not have used; the paper's bibliography is still there.
4. **A paragraph left with nothing in it goes**, unless a link points into it: the
   `\keypart` paragraph, and Greg's once its two halves are gone. Readability would probably drop
   it anyway; this does not leave it to chance.

`LatexmlStats` gets `undefinedMacros` (markers removed) beside the other counts.

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

In `tests/latexml.test.ts`, a new `describe` with fixtures cut verbatim from three of the papers
(Greg's preamble, a `\ucite` sentence, a `\bmsection` funding paragraph):

- Greg's preamble: the marker and `hohRose` are gone, the title stays, and through `runExtract` and
  `splitIntoBlocks` no block holds `\hohsettheme` or `hohRose`.
- `\ucite`: the sentence reads `…ordered phases. A broad range…`.
- `\bmsection`: the marker goes and `Funding We acknowledge…` stays, word for word.
- Negative twins: the same markup at a non-arXiv address is untouched; an `ltx_ERROR` holding
  anything other than one control sequence stays; a two-word paragraph after a marker stays; a key
  after a non-citation macro (`\sep`) stays; a paragraph a link points into stays.

## Docs

[content-extraction.md § A LaTeXML page](../project/content-extraction.md#a-latexml-page-arxivs-html)
gets a row in its table, and § The one thing this pipeline deletes a line naming this as a second
deletion by a producer's class name, under a different licence: what goes is the converter's own
error report and the argument it orphaned, never the author's sentences. The module header of
`src/latexml.ts` says the same where it now says nothing here deletes an author's words.
