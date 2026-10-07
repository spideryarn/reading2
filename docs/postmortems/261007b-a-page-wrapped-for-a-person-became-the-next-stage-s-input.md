# A page wrapped for a person became the next stage's input, so its chrome became content

Up: [postmortems.md](../project/postmortems.md)

Greg, 2026-10-06, report `spya-t6cdve`, on an arXiv paper:

> Why does this article seem to show the title twice on the page?

It was every article, and had been for six weeks. The fix and the evidence are in
[261007b](../plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md).

## What happened

The reading view's masthead draws the article's title, byline, site and a reading time from the
article's metadata. Directly under it, the prose began with the title again as an `<h1>`, and on a
web article a line such as `· ~26 min read` under that. In production on 2026-10-07 all 22 web
articles with blocks started that way, and 22 of 27 PDFs started with an `<h1>` equal to the title.

## The real cause

Stage 2 never wrote "the article". `debugPage` in [`src/extract.ts`](../../src/extract.ts) wrote a
whole HTML page **for a person to open and check an extraction by eye**: a stylesheet, and a header
of our own with the title as an `<h1>` and a `.meta` line of byline, site and a reading time
worked out from a character count. That was the right thing to write on the day there was one
stage and a human looking at its output.

Stage 3 arrived and took that page as its input. `splitIntoBlocks` reads the page's `<body>`, all
of it. Nothing in the page said which part was the author's and which was ours, so our header
became blocks 0 and 1, with stable ids, covered by the tree, read by every model prompt as the
author's words, and drawn by the reading view.

The masthead then drew the same facts from metadata, and from that commit the page said them
twice. The two reading times never agreed, because they are two different sums.

**A PDF is the same symptom from a different cause.** `src/pdf-read.ts` writes no header. A PDF's
leading `<h1>` is the paper's own title as transcribed, and the masthead's title is built from
those same records. So for a PDF the doubling is the masthead repeating the author, not the
splitter reading our chrome. The first draft of the plan said both paths wrote a header; GPT Sol's
plan review read the code and corrected it.

## The class

**A page wrapped for one reader became another stage's input, so its chrome became content.**

An artefact carries the assumptions of whoever it was made for. A debug page assumes a person, who
can see that a grey line under the title is furniture. A program handed the same bytes cannot, and
there was no boundary in the bytes to tell it. The mistake is not the header; it is that a second
consumer was attached to an artefact without asking what in it was meant only for the first.

It is the family of
[260929b](260929b-outside-titles-stored-with-their-markup.md) (a value right for one sink and
wrong for the next), one level up: there a string, here a document.

Other members, looked for on 2026-10-07:

- **The header also hid an empty extraction.** A page that extracted to no prose still produced
  two blocks, both ours, so it passed `assertSomethingWasProduced` in `src/blocks.ts`, whose whole
  purpose is to refuse an article with nothing in it. With the header gone such a page yields no
  blocks and is refused. Nobody had seen this; it was found by removing the header.
- **The models read our header as the author's.** Every whole-piece prompt was shown the title as
  a heading and `~N min read` as a paragraph. `src/web/marginalia/notes.ts` already carried a
  word-count rule written to step round "the `~23 min read` under a title" (2026-10-01): the
  symptom was met and worked around once without anyone asking where the line came from.
- **The page's `<head><title>`** is the same kind of thing and is harmless, because the splitter
  reads only the body.

## Which commit

`cd7fc5720` (2026-08-24, *Initial commit: extraction prototype and project docs*) wrote the header,
correctly, for a human. `8babeb993` (2026-08-25, *The L0 column becomes the arc, and the article
moves to the masthead*) drew the title a second time. Neither is wrong alone. No commit attached
stage 3 to the page with the header in mind, which is the point.

It went unreported for six weeks, and was probably made obvious by `261006c` (2026-10-06), which
lined the masthead's title up with the prose column, so the two copies now sit one under the other.

## The fix shipped, and the one that is right

- **Shipped, the root for new articles:** `debugPage` writes the article and nothing else into
  the body. The title stays in `<head><title>`.
- **Shipped, for the articles that already have the header:** the reading view does not draw the
  leading blocks that only repeat the masthead (`src/web/masthead-echo.ts`, through the fold
  store). The blocks are still in the data.
- **Right for the long term, not done:** rebuild the existing articles so the header is gone from
  their blocks, their trees and what the models read, and then delete the wrapper half of
  `mastheadEcho`. It is paid model work on every web article and a write to production, so it is
  a queue entry for Greg to schedule, not something an unattended run does.

## What would have caught the class, ranked by ease against value

1. **Say in the artefact's own writer who reads it.** `debugPage`'s comment now says that
   everything in the body is the author's words to every later stage, and not to put chrome there.
   One comment at the one place the mistake can be made again. Done.
2. **A test that a fresh extraction's first block is the article's own.**
   `tests/extract-sanitize.test.ts` now asserts that the page body has no heading of ours and that
   `splitIntoBlocks` of it starts with the article's first paragraph. Done.
3. **When a second consumer is attached to an existing artefact, read the artefact as that
   consumer.** A habit, not a check: open one real output and ask of each part whether the new
   reader should see it. It would have taken a minute on 2026-08-24. It belongs to
   [architecture.md § Stage ownership](../project/architecture.md#stage-ownership), where stages
   are told to talk through artefacts; proposed there, not edited by this run, because the wording
   of an entry-point doc is Greg's.
4. **Ask where a symptom comes from before stepping round it.** The marginalia rule of 2026-10-01
   met this line and added a word floor. Costs nothing, and would have found this five days
   earlier.
5. A schema for the extracted page (a marked `<article>` the splitter reads, everything outside it
   ignored): rejected for now. It is the structural answer, and with the header gone there is
   nothing outside the article left to ignore. Worth doing the day a second thing is added to that
   page.
