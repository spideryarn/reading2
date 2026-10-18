# A poem quoted in a PDF keeps its line breaks

Report `spya-dktkem` (SPIDERYARN-READING2-JK, queue item `qi-mcfq9v47`), from Greg, 2026-10-17, at
block `spya-ht3hns` of *The Order of Time* (a PDF):

> Have we somehow lost or messed up the line breaks for these quotes?

## What is wrong

Confirmed. The block after `spya-ht3hns` is Saadi's poem, stored as

```
<blockquote id="spya-gcv4be">All of the sons of Adam are part of one single body,\nThey are of the same essence.\nWhen time afflicts us with pain\n…</blockquote>
```

The PDF reader (src/pdf-read.ts) did keep the lines — the model writes a `\n` between them — but
`renderHtml` puts the text into the tag as it is, and HTML collapses a newline to a space. So every
poem in the book reads as one run-on paragraph. 22 of the book's 29 block quotes carry newlines;
nothing in the prose has ever honoured them (no `white-space` rule on the prose, no `<br>`).

**Nothing was lost; it was never shown.** Not a regression, and not in the stored text either:
`text` collapses whitespace on purpose (src/blocks.ts `extractText`).

## Why "just show the newlines" is wrong

The model writes `\n` for two different things, often in the same book:

```
verse (the author's lines)              prose (the page's lines)
All of the sons of Adam are part of     I have had the unheard-of good fortune of experiencing a global vision of my being—
one single body,                        not of a particular moment, but of my existence "as a whole." I was able to compare its
They are of the same essence.           finite nature in space, against which no one protests, with its finite nature in time,
When time afflicts us with pain         which is instead the source of so much outrage.
```

Honouring every newline — `white-space: pre-line` on the prose's blockquotes, the one-line fix —
would break the right-hand quote mid-sentence at the printed page width, which is worse than today.
(It would also reach web articles, whose blockquotes carry newlines that are only markup
indentation.)

## The fix

In `renderHtml`, for a **`quote`** record only: decide whether its line breaks are the author's,
and if so write each one as `<br>\n`. Otherwise leave the text exactly as it is now.

**The test is the typesetter's own: could the next word have fitted on this line?** A line broken
by the column ends because the next word would not fit; a line of verse ends with room to spare.

- width = the **second**-longest line, so one outlier (a URL, two lines the model joined) cannot
  widen the column and make every ordinary wrap look free — and **never under 45 characters**: a
  printed text column is wider than that, and without the floor a poem of uniformly short lines
  (Horace, in this book) looks exactly like a narrow column;
- a break is *free* when `line + space + next word ≤ 0.85 × width`; blank lines are not breaks;
- the quote is verse when it has **at least three lines** and at least half its breaks are free;
- a quote containing TeX delimiters (`\(`, `\[`) is never verse: a `<br>` inside a formula would
  break it, and a formula is not a poem.

**`<br>\n`, not `<br>`.** A `<br>` has no text node, and the browser anchors comments, selections
and cross-references to `block.html`'s concatenated text nodes (src/web/annotate.ts). A bare `<br>`
would turn `body,\nThey` into `body,They` there, so a passage selected across a line would stop
matching its block, and an existing anchor across one would stop drawing (Sol, plan review F1).
Keeping the newline after the `<br>` leaves that text byte-for-byte as it was.

**A miss is today's behaviour; a false positive is a new break mid-sentence**, so the rule is tuned
to miss. Dialogue set a turn to a line would be drawn as lines, which is how it was printed.

**Measured on Greg's own PDFs in production** (read-only, 2026-10-18; 23 articles, every
`blockquote` carrying a newline — 39): 24 called verse, all of them verse, including the Saadi poem
and the book's Horace odes; the 15 called prose include all the wrapped prose, and the misses are
two-line quotes (a Dylan lyric, two lines of *Henry IV*), the three-line Anaximander fragment, and a
speech set one sentence per line. Those misses render as they do today.

**Ids and caches do not move.** `extractText` treats `<br>` as a word boundary and collapses
whitespace, so a block's `text` is identical either way, and `text` is what ids are matched on and
`hashBlocks` hashes. Pinned in a test that carries ids from the old blocks and compares hashes.
Exported HTML does change, as it should.

**Page turns are unchanged.** A quote continued onto the next page is still joined with a space. A
newline there was considered and dropped: seam hyphen repair (`mendSeamHyphens`) runs first, so a
newline could land after a word that was mended across a wrapped line (Sol, F3). A poem split by a
page loses that one line.

## What this does not do, and the simpler option passed over

- **`white-space: pre-line` on blockquotes** — passed over, for the reason above.
- **Telling the model** to keep only the author's line breaks — a prompt change, which re-prices
  every chunk of every future PDF (the cache key hashes the prompt) and fixes no existing article.
  The deterministic test needs neither, and works on the cached reads.
- **Paragraphs.** The same `\n` appears in 437 of these articles' `<p>`s — addresses, author lists,
  and the *Dhammapada*, whose verses the model typed as paragraphs. The test is not good enough
  there: wrapped prose whose lines the model partly joined has lines of very different lengths, and
  reads as verse (prototype: dozens of false positives in one arXiv paper). Queued separately,
  not fixed here.
- **Quotes mode** shows a quote's words from the block's `text`, which is collapsed by design; a
  poem chosen as a quote still reads as one line there. Not what the report was about.
- **Existing articles are not re-extracted.** Forward-only, as with
  [content-extraction.md](../project/content-extraction.md)'s earlier extraction fixes. The fix
  reaches an article when it is next extracted — a reader's Refresh on the article re-renders it,
  and the paid-for chunk reads replay from checkpoints rather than being bought again
  ([architecture.md](../project/architecture.md), § the stage commands resume). We do not run that
  on production ourselves.

## Stages

1. Failing test: `renderHtml` on the Saadi quote gives `<br>`s; on the wrapped-prose quote, none.
   Plus: TeX quote untouched, an outlier line, two lines, text nodes, ids and hash unchanged.
2. Implement in src/pdf-read.ts beside `renderHtml`.
3. GPT Sol code review, gates, push to `dev`.

## Review

Plan: GPT Sol, APPROVE WITH CHANGES —
[261018d-…-plan-review-sol.md](261018d-a-poem-quoted-in-a-pdf-keeps-its-line-breaks-plan-review-sol.md).
F1 (`<br>\n`), F2 (second-longest width, three lines, honest wording about false positives), F3
(keep the space at a page turn) and F4 (a real id/hash test) all taken. F5 needed nothing.
