# Formatted answers in chat

**Built 2026-08-31.** Greg:

> Can the Chat display formatted Markdown? If not, update it so that it can.
>
> — Greg, 2026-08-31

It could not, and the gap was sharper than "we never got round to it": the prompt in
[`src/converse.ts`](../../src/converse.ts) has said *"Short bullet lists only when the answer really
is a list"* since chat was built, so the model was being **asked** for a shape the panel could not
draw. A list arrived as one paragraph, and the only thing keeping its items on separate lines was a
`white-space: pre-wrap` in the stylesheet whose comment apologised for itself:

> Collapsed to spaces those items run together on one line as "- one - two - three", which reads as
> a formatting bug in the model rather than in us.

Code: [`src/web/markdown.ts`](../../src/web/markdown.ts) (the blocks),
[`src/web/citations.ts`](../../src/web/citations.ts) (`splitInline`, `splitCode`, `splitItalic`),
[`src/web/Cited.tsx`](../../src/web/Cited.tsx) (`CitedMarkdown`, the drawing),
[`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx) § `Answer`,
[`src/web/styles.css`](../../src/web/styles.css) § the shapes a model writes.
Tests: [`tests/chat-markdown.test.ts`](../../tests/chat-markdown.test.ts),
[`tests/chat-markdown-render.test.tsx`](../../tests/chat-markdown-render.test.tsx).
Sits on top of [chat-mode.md](chat-mode.md) (the citation contract) and
[chat-web-links.md](chat-web-links.md) (the link rules), and interprets neither differently.

## No Markdown library — and the honest version of why

The first draft of this section said "every Markdown library returns HTML, and HTML from a model is
what [security.md](../project/security.md) exists to prevent". **That is false and a reviewer said
so**: `react-markdown` renders React elements with no `dangerouslySetInnerHTML`, and `remark` will
hand over an AST. Security does not decide this.

What decides it is that **the inline layer here is not Markdown**. A block id is matched by its
*shape* — a bare `spya-k3m9qt`, no syntax at all — and then checked against the article, deduped,
and drawn as a component with a hover card. A link prints the host it really goes to beside the
label, refuses a scheme, refuses credentials, and refuses to exist at all while its last characters
may still be arriving. Bold is paired across links and code spans. None of that is expressible in a
Markdown AST; it is a second pass over the text nodes either way. So a library would replace
`markdown.ts` — the block half — and leave the half where all the interesting rules are.

That is a real trade and **not obviously the one we made**: see *Still open*, because the reviewer
recommends the swap and the reasons are good ones.

What the split buys, either way, is that model output never becomes markup. `markdown.ts` returns
*data*; each block's text goes to `Cited.tsx`, which was already turning a paragraph into runs of
**string**; React escapes strings. `tests/chat-markdown-render.test.tsx` asserts it from the
outside: an answer containing `<script>alert(1)</script>` puts those characters on the page, in a
list item and in a code block as well as in a paragraph. The reviewer looked for a path where model
text becomes HTML or an arbitrary attribute and found none — the two attributes model syntax now
reaches are `<ol start>`, which is a number, and the heading element's own name, which is clamped
to `h4`–`h6`.

## What it reads

| Shape | Notes |
|---|---|
| `- ` `* ` `+ ` bullets, `1.` `1)` numbers | Nested by indentation. A numbered list keeps the number it starts at |
| `# ` … `###### ` headings | Drawn as `h4`–`h6`, never higher: the panel's own title is the `h2` above them |
| `> ` quotes | Parsed again inside, so a list in a quote is a list |
| ` ``` ` fenced code | **An unclosed fence is still a code block** — see below |
| `---` rules | Checked before bullets, because `- - -` is both |
| `` `code` `` spans | Split first, so what is inside reaches no other rule — but rejoined before emphasis, see below |
| `*italic*`, `_italic_` | The innermost pass, after bold has taken its markers |
| `**bold**`, links, `spya-` ids | Unchanged. citations.ts already had these |

It is **not** CommonMark and does not try to be: no tables, no reference links, no HTML blocks, no
setext headings, no lazy continuation. Anything unrecognised stays in a paragraph exactly as the
model wrote it, which is what the panel did with all of it before.

## The four rules that were bought with a bug

- **An unclosed fence is a code block.** Not tolerance of bad input — the streaming case. The
  opening fence arrives seconds before the closing one, and a reader watching an answer land should
  see code appearing in a code block rather than three backticks that become one later.
- **A nested list is decided by the item's *text* column, not by a tolerance.** The first version
  treated any marker within three columns of the list's own indent as a sibling, so `- outer` /
  `  - inner` came out as two items of one flat list. A marker at or past the column where the
  current item's text starts belongs to that item; one before it is the next item.
- **Emphasis is paired across code spans, not inside the gaps between them.** The first draft split
  code spans off at the top and ran the rest of the inline passes on each remaining piece, which is
  the obvious shape and is wrong: ``**a run with `code` in it**`` arrives as two text runs holding
  one `**` each, neither of them paired, so the run loses its bold *and* prints four asterisks. That
  is the same bug [chat-web-links.md](chat-web-links.md) fixed for links on 2026-08-27, six days
  later and in the same function. `splitInline` now returns one run list — prose, links and code
  together — and `emphasise` pairs markers over all of it.
- **A line in column zero ends a list.** CommonMark's lazy continuation, refused on purpose: a model
  that writes bullets and then a closing sentence means the sentence to be a paragraph, and swallowing
  it into the last bullet is the mistake a reader notices immediately.

## What the review found

GPT Sol read the first version on 2026-08-31 —
[chat-markdown-review-sol.md](chat-markdown-review-sol.md), and it is worth reading whole. **Seven
defects, six of them text the model wrote that never reached the reader** — the exact failure this
file already had two paragraphs warning about, shipped anyway. Every one is fixed and has a test
that was red first:

| What went wrong | Now |
|---|---|
| `# Learn C#` rendered as “Learn C” | A closing run of hashes must be preceded by whitespace |
| A closing fence could carry an info string, so ` ```js ` closed a block and deleted the `js` | A closer carries nothing but the fence |
| `café_naïve_été` italicised its middle word and ate both underscores — `\w` is ASCII | `\p{L}\p{N}`, the pattern [`src/term-match.ts`](../../src/term-match.ts) already used |
| `**this is *italic* too**` printed all six asterisks | A bold pair may contain a lone `*`, never `**` |
| `[run `` `npm test` ``](https://…)` came apart into five pieces | Links and code spans are matched over the same string; a link wins where they overlap |
| A streaming URL was linked inside a heading or a quote, where `partial` never reached | `partial` reaches the last text in the answer, wherever it sits |
| 8,000 blank lines took 665ms (quadratic, and re-run per token); 6,000 nested quotes threw `RangeError` | The gap is scanned once; depth is capped at 6 and the rest stays text |
| A paragraph's leading spaces were trimmed, which `pre-wrap` shows | Trailing whitespace only |

Two comments were false as well and are corrected above: the claim that every Markdown library
returns HTML, and the claim that summaries interpret bold alone.

## What must *not* be interpreted

Almost every answer has no Markdown in it at all, so a parser that reads a `-` at the start of a
sentence as a bullet damages far more replies than it improves. Most of `chat-markdown.test.ts` is
about the refusals, and each of these is one test:

- `**Bold start** of a sentence.` is a paragraph. The bullet rule requires whitespace after the
  marker, and the character after that first `*` is another `*`.
- `2 * 3 * 4` is arithmetic — no space may sit just inside an italic marker.
- `some_variable_name` keeps its underscores — `_` is a marker only at a word boundary.
- An unpartnered `**` stays literal, because `splitEmphasis` decided that already and matching half
  of one would quietly undo it.
- `#hashtag` is not a heading, and a paragraph's own single newlines survive (the `pre-wrap` above
  is now doing only that job, which is the one it should have had all along).

## Two things left alone on purpose

- **The prompt.** `FORMAT` still says plain prose paragraphs, short lists only when the answer really
  is a list, no headings. Nothing about it needed relaxing: the point of this work was to draw what
  the prompt already permits, not to invite a reading companion to start answering in bullet points.
  [vision.md § Anti-goals](../project/vision.md#anti-goals) is the reason to leave that alone.
- **The summary panel's *blocks*.** `CitedMarkdown` is opt-in exactly like `links`, and only chat
  passes it. The summary prompt asks for plain sentences and gets them, and a summary is dense
  enough that a stray `#` becoming a heading would be worse than a stray `#`.
  [summaries.md](../project/summaries.md).

  **Its inline marks are another matter, and they changed.** `` `code` `` and `*italic*` went into
  `CitedText`, which both panels share, so summaries now read them as well as bold. That was not
  deliberate — this file claimed otherwise until a reviewer checked — but it is right, and for the
  reason bold was shared in the first place: these are things a model does whatever you tell it, and
  a summary printing its own asterisks looks like an app that cannot read its own output. Blocks are
  structure and are chat's; inline marks are tics and belong to both.

## A trap worth knowing before you name a CSS class

The classes are `fmt-list`, `fmt-h`, `fmt-quote`, `fmt-rule`, `fmt-pre`, `fmt-code` — not the obvious
`md-` prefix. [`tests/doc-links.test.ts`](../../tests/doc-links.test.ts) scans every source file for
bare references to a document and checks the file exists, and a class name that begins with a dot and
those two letters *is* one as far as its pattern is concerned. The first run reported seventeen
broken links to a document that could never exist.

## Still open

- **The reviewer says use `remark`, and the argument is good.** GPT Sol, 2026-08-31
  ([chat-markdown-review-sol.md](chat-markdown-review-sol.md)): *"This parser already has silent
  loss, nesting, streaming and complexity bugs — the exact classes mature parsers exist to handle."*
  Seven were found, six of them text the model wrote that never reached the reader, and every one is
  fixed and tested below. But finding seven in one pass is itself the argument, and four of them
  (`# Learn C#`, the closing fence, the quadratic blank lines, the stack overflow) would simply not
  have existed behind a tested block tokenizer.

  What it would **not** fix is finding 3, the inline nesting — `*see [source](https://…) now*` still
  leaves literal stars — because that layer stays ours whichever way this goes. So the swap is:
  delete `markdown.ts`, add a dependency, keep `Cited.tsx` and every rule in it. Left for Greg,
  because adding to the stack is his call ([vision.md § Principles](../project/vision.md#principles)),
  not because it is a close-run thing technically.
- **Italic does not cross a link or a citation.** `*see [source](https://…) now*` prints its stars, where
  the bold equivalent does not. Bold got a pass across runs because `**[The paper](https://…)**` is a
  shape models write constantly; the italic one is rare enough that the second toggle has not earned
  itself. Recorded rather than hidden.
- **Not checked in a browser with a real streaming answer.** The rendering was checked in Chrome
  against answers pasted into a stored thread (see below), which exercises every block but not the
  moment an unclosed fence or a half-written list item is on screen. The parser has a test for the
  fence; the *look* of a list growing an item at a time is unobserved.
- **Tables.** Deliberately not read. If a model starts writing them the answer is probably wrong for
  this panel anyway, but the reader would see pipes, which is the failure mode this whole piece of
  work was about.
