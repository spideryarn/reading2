# An arXiv title keeps the space its line break stood for

*Status as of 2026-10-24: built on `dev` — evidence: `latexmlTitleText` (src/latexml.ts), `asDrawn`
(src/extract.ts), tests/latexml-title-text.test.ts. Revised after GPT Sol's plan review
([plan-review-sol](261024b-an-arxiv-title-keeps-the-space-its-line-break-stood-for-plan-review-sol.md)),
and widened by the sweep: § After the plan review.*

Report `spya-whpceg` (#693), from Greg, filed 2026-10-23 23:27 UTC on
`arxiv-2308-08708-spya-xax6v4`:

> I want to be able to ask the guide chat or similar to update the title and potentially other
> metadata. I think this should be something they can support, perhaps by adding special tool(s).

and a minute later, addendum `spya-rpuerj`:

> Actually, on second thoughts, maybe this isn't worth doing because every tool uses up context and
> creates complexity. Maybe we just need to slightly improve the import process so that we get the
> titles right.

So: no chat tool. The job is the import's titles.

## What production holds, and why

The article in the report is shelved as `1Indicator Properties`; the paper is *Consciousness in
Artificial Intelligence: Insights from the Science of Consciousness*. That is report `spya-mx3wz0`,
already fixed by [261017a](261017a-an-arxiv-paper-with-no-title-takes-its-title-from-its-own-opening.md)
and deployed from 2026-10-18 00:40 UTC (`914965ed`). Every one of the article's thirteen revisions in
production (read-only, `article_revisions`) was made on 2026-10-17, **before that deploy**, so the
fix has never run on it. Re-run locally today on `dev`, the same page gets:

- title *Consciousness in Artificial Intelligence: Insights from the Science of Consciousness*
- all 19 authors, year 2023, journal arXiv, DOI `10.48550/arxiv.2308.08708` (the registry agreed)

Production had no authors, year or DOI for it either. So this paper needs only a re-extract, which
is a production write and Greg's to make (or a rename).

## The one title fault still live

Every arXiv article in production, current revision, read 2026-10-24: eighteen. Bar the one above,
one more is wrong:

| slug | stored | the paper's |
|---|---|---|
| `arxiv-2602-11988-spya-sudvzx` | `Evaluating AGENTS.md:Are Repository-Level …` | `Evaluating AGENTS.md: Are Repository-Level …` |

Reproduced locally today on `dev` by ingesting `https://arxiv.org/html/2602.11988`. The cause is
LaTeXML's: the author wrote a line break in `\title` (`\\`), and the page's
`h1.ltx_title_document` keeps it as a newline and a `<br class="ltx_break">`, but LaTeXML's
`<title>` is the same text with the break deleted and nothing put in its place. Readability takes
`<title>`, and the tidiers leave it.

**The class: a LaTeXML `<title>` flattened from a title with a line break in it, which loses the
word gap the break stood for.** Any arXiv paper whose `\title` has a `\\` between two words, which is
a common way to set a title and subtitle.

(`LOCAL SUPPORT LEARNING`, a PDF, is how its title page prints it; case is the tidier's call and was
decided in 261005g/261005j. Not this.)

## The decision

*As first planned; § After the plan review is what was built.*

`latexmlTitleText(doc)` in src/latexml.ts: the text of the document's `.ltx_title_document` (the
same lookup as `untitledLatexmlMarkup`), with each `<br>` read as a space, footnote marks
(`.ltx_note`) left out, and whitespace collapsed. Read in `readArticle` on the page as it arrived.

`runExtract` uses it **only when it equals Readability's title once all whitespace is removed from
both.** So the only thing it can ever change is where the spaces fall; a title with maths, a
footnote LaTeXML copied into `<title>`, or anything else that differs keeps today's behaviour. That
makes the source gate unnecessary: an upload already chooses its own title, and this can only
re-space it.

Untitled papers (261017a) are untouched: they have no `.ltx_title_document` to read.

### Options passed over

- **Take the `h1` outright, whenever present.** Model-free and usually right, but the `h1` can hold a
  `\thanks` footnote's text, maths as MathML with its annotation, and LaTeXML error markup, each of
  which `<title>` has handled for years. The equality guard is what makes this a one-way safe change.
- **A rule on the string: insert a space after `:` before a capital.** Fixes this paper and breaks
  `Re:Invent`, `C:Drive`, URLs and every title where the glued words were not after a colon.
- **Ask the model tidier to re-space.** A paid call to guess what the page already says.
- **A chat tool to edit metadata** — withdrawn by Greg in the addendum.

## After the plan review

GPT Sol, 2026-10-24, *proceed with changes*. Taken:

- **P2, the guard was broader than the fault.** "Equal once all whitespace is removed" lets `AB C`
  become `A BC`. Now the heading is read twice, each `br.ltx_break` (and the whitespace round it)
  as one space and as nothing, and `<title>` must be one of those two readings exactly. Only
  `br.ltx_break`, not any `<br>`.
- **P3**: footnotes removed before breaks are read (a break inside a `\thanks` is dropped with it);
  two or more document roots or titles refuse; consecutive breaks are one space. Tests for each.
- **P3, Readability's title, not `<title>`, is what gets replaced**, and a title Readability took
  from elsewhere (`og:title`) is left alone. Tested.

**Then the sweep widened it.** 25 arXiv HTML papers (the ten in production and fifteen well-known
ones) run through `runExtract` found a third paper with a break in its title, 2305.10601, whose
`<title>` is right — *Tree of Thoughts: Deliberate Problem Solving with Large Language Models* —
but which Readability shelves as *Deliberate Problem Solving …*. Readability looks for a heading
whose text is exactly the title, finds none (the heading's has a newline at the break), so takes
`Tree of Thoughts:` for a site's name and cuts it. Same break, second symptom. So the condition is
now: `<title>` equals the heading read either way, **and** Readability's title is `<title>` or its
exact suffix after `: `. That keeps Sol's point (a title Readability chose from outside `<title>`
stands, unless it is exactly that suffix; § After the code review) while undoing the colon cut
Readability made to the page's own title. Comparing to Readability's title alone could not see
this case. The rule also
requires the measured `br.ltx_break`; an ordinary matching title and heading are not evidence of
this fault.

## Measured

`runExtract`, no model seams, 2026-10-24, on arxiv.org/html/ for 2602.11988, 2308.08708, 2607.22753,
2605.20355, 2608.13566, 2609.01481, 1706.03762, 1109.1875, 2609.16247, 2402.13659, 2603.13294,
2310.06825, 2201.11903, 2303.08774, 2005.14165, 2106.09685, 2203.02155, 2401.04088, 2305.10601,
2312.00752, 2307.09288, 2210.03629, 2302.13971, 2404.14219, 2112.10752. Changed: AGENTS.md (space
back), 2203.02155 (*instructions with*), 2305.10601 (*Tree of Thoughts:* back). Every other title
unchanged. (2308.08708 is 261017a's, as before.)

## After the code review

GPT Sol, 2026-10-24, *approve after fixes*
([code-review-sol](261024b-an-arxiv-title-keeps-the-space-its-line-break-stood-for-code-review-sol.md)).
It fixed, and tests now cover:

- **"A part of `<title>`" was too loose**: an empty or one-word Readability title matched. Now
  Readability's title must be the whole `<title>` or exactly its part after `: `, which is the cut
  Readability makes.
- **The match needs a real `br.ltx_break`, exactly one document root and one document title**, so a
  heading that merely agrees with `<title>` is not this fault.
- **`document.title`, which Readability reads**, rather than `head > title`.
- **No sentinel character**: the title is untrusted and could contain it. Breaks are kept apart as
  nodes while the heading is read.

One of its fixes was taken back out: refusing the repair whenever the page has a title in `<meta>`
or JSON-LD, by copying Readability's list of metadata keys. That list would drift from the
dependency, and it would switch the repair off without a word if arXiv ever added JSON-LD. Without
it, the only extra case is a metadata title that is exactly the part after the colon of a `<title>`
the heading confirms, and that gives way to the whole title, which the page states twice. A test
pins that as chosen.

## Stages

1. Failing test: the real head and title block of 2602.11988, trimmed, as a fixture; `runExtract`
   must give `Evaluating AGENTS.md: Are …`. Unit tests for `latexmlTitleText` (a `<br>`, a footnote
   mark, maths that makes the guard refuse, no title). Red first.
2. The function and the wiring.
3. Docs: content-extraction.md's table of LaTeXML title cases; the report's note.

The production article `arxiv-2602-11988-spya-sudvzx` is not rewritten (no production writes); it
gets the space on its next extract.

## References

- src/latexml.ts (`untitledLatexmlMarkup`), src/extract.ts (`readArticle`, `runExtract`)
- [261017a](261017a-an-arxiv-paper-with-no-title-takes-its-title-from-its-own-opening.md),
  [the note for spya-mx3wz0](../user-feedback/261017_1314-an-arxiv-title-that-is-a-numbered-part-of-the-paper.md), 261005g/261005j (title tidying)
