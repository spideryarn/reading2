# Formatted answers in chat

**Built and then rebuilt, 2026-08-31.** Two asks in one day, and the second one reversed the first
one's central decision, so both are here.

> Can the Chat display formatted Markdown? If not, update it so that it can.
>
> — Greg, 2026-08-31

> Don't use a hand-rolled parser, use a proper library.
>
> — Greg, 2026-08-31, on reading the review of the first version

It could not, and the gap was sharper than "we never got round to it": the prompt in
[`src/converse.ts`](../../src/converse.ts) has said *"Short bullet lists only when the answer really
is a list"* since chat was built, so the model was being **asked** for a shape the panel could not
draw. A list arrived as one paragraph, and the only thing keeping its items on separate lines was a
`white-space: pre-wrap` in the stylesheet whose comment apologised for itself:

> Collapsed to spaces those items run together on one line as "- one - two - three", which reads as
> a formatting bug in the model rather than in us.

Code: [`src/web/Cited.tsx`](../../src/web/Cited.tsx) (the parse and the whole drawing),
[`src/web/citations.ts`](../../src/web/citations.ts) (what no parser can do),
[`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx) § `Answer`,
[`src/web/styles.css`](../../src/web/styles.css) § the shapes a model writes.
Tests: [`tests/chat-markdown-render.test.tsx`](../../tests/chat-markdown-render.test.tsx).
Sits on top of [chat-mode.md](chat-mode.md) (the citation contract) and
[chat-web-links.md](chat-web-links.md) (the link rules), and interprets neither differently.

## The parser we wrote, and why it lasted a day

The first version hand-rolled the block parsing, on the argument — written down at the time, and
wrong — that *"every Markdown library returns HTML, and HTML from a model is what
[security.md](../project/security.md) exists to prevent."* `react-markdown` renders React elements
with no `dangerouslySetInnerHTML`; `remark` hands over an AST. Security never decided this.

GPT Sol read that version and found **seven defects, six of them text the model wrote that never
reached the reader** — [chat-markdown-review-sol.md](chat-markdown-review-sol.md), worth reading
whole:

| What went wrong | |
|---|---|
| `# Learn C#` rendered as "Learn C" | a closing run of hashes was matched without requiring a space before it |
| ` ```js ` closed a ` ```ts ` block and deleted the `js` | the closer reused the opener's pattern |
| `café_naïve_été` lost both underscores | `\w` is ASCII, so `é` looked like a word boundary |
| `**this is *italic* too**` printed all six asterisks | the bold pattern refused any `*` in its contents |
| ``[run `npm test`](https://…)`` came apart into five pieces | code spans were lifted out before links were looked for |
| a streaming URL was linked inside a quote or a heading | `partial` was passed as "finished" for both |
| 8,000 blank lines took 665ms; 6,000 nested quotes threw `RangeError` | a quadratic rescan, and unbounded recursion |

Every one was fixed, each with a test that went red first. **Finding seven of them in one pass is
the argument**, and Greg took it: four would not have existed behind a tested tokenizer, and the
eighth thing the review said is the one that settles it — *"the exact classes mature parsers exist
to handle."*

## The library, and why this one

Chosen by a research pass against [third-party-library-selection.md](../reusable/third-party-library-selection.md),
whose first criterion is a long-lasting community with a lot of pretraining data behind it. Every
claim below was then re-checked here, against the real package, before anything was written.

```
npm install mdast-util-from-markdown   # + @types/mdast, dev
```

**`mdast-util-from-markdown` is the tokenizer `remark-parse` itself is built on.** It returns an
mdast tree and **stops** — no `hast`, no `remark-rehype`, nothing that could produce HTML.
[`Cited.tsx`](../../src/web/Cited.tsx) walks that tree into React elements.

**Why not `react-markdown`**, which is the obvious choice and an excellent library. Its `components`
prop overrides *elements* — `p`, `li`, `a` — and there is no `text` component
([remarkjs/react-markdown#609](https://github.com/remarkjs/react-markdown/issues/609), closed by the
maintainers as needing no change). Our hardest requirement is per-**text-node**: a bare
`spya-k3m9qt` inside ordinary prose has to become a React component. Doing that through
`react-markdown` means a remark plugin inventing a custom node type, `data.hName`/`data.hProperties`
to smuggle it through `remark-rehype` as a fake element, and then mapping that fake element back —
a documented pattern, and a hast round trip this app has no other use for, for the one feature the
whole thing exists to serve. Going to mdast directly is the same idea with the middle removed.

**`remark-gfm` is deliberately not installed.** The one thing it offers that we would otherwise want
is bare-URL autolinking, and that is the one thing we cannot let a library own (see below). The rest
is tables, footnotes and strikethrough, and this panel does not want tables.

`marked` and `markdown-it` output HTML strings, which would mean `dangerouslySetInnerHTML` plus a
sanitiser plus re-parsing the sanitised HTML to put the citation chips back. Not close.

### Measured here, not taken on trust

- `# Learn C#` → heading text `Learn C#`. A closing fence carrying an info string does not close.
  An unclosed fence at the end of the input becomes a code block, which is CommonMark's own rule
  ("if the end of the containing block is reached and no closing code fence has been found") and
  therefore exactly the streaming behaviour we had to hand-write and defend.
- `**[The paper](https://…)**` → `strong > link`. `*see [source](https://…) now*` → `emphasis`
  containing the link. **That second one is review finding 3**, the one a block-level fix would not
  have reached and the hand-rolled inline layer structurally could not do.
- `2 * 3 * 4`, `some_variable_name`, `café_naïve_été`, `#hashtag`, `**Bold start** of a sentence` —
  all correct, for free.
- 6,000 nested `>` markers parse in 149ms with no `RangeError`. **The parser's depth is not the
  renderer's** — see the second review below, which is where that sentence first appeared as a false
  one.
- A 4KB answer parses in **~1.5ms**. That is the per-token cost, and the per-*answer* cost is the
  sum of them — see *Still open*, because the first draft of this section quoted the 1.5ms as though
  it were the whole bill.

## What is still ours, and why

The library owns structure and the marks that have syntax. Three things it cannot own, and all three
stayed in `citations.ts` untouched:

1. **A block id has no syntax.** A bare `spya-k3m9qt` is a citation if this article has that id and
   nothing otherwise, so it is matched on shape inside `text` nodes by `splitCitations`, checked
   against the article, deduped. This is why `react-markdown` lost.
2. **Bare URLs stay ours, because of the server.** `webLinks` in [`src/urls.ts`](../../src/urls.ts)
   is the single matcher, shared with the counters in
   [`src/converse.ts`](../../src/converse.ts) that record how many ids an answer cited and how many
   it invented. Letting the parser decide what a bare URL is would give the two sides two answers.

   **But sharing one matcher turned out not to be enough**, and that is the second review's finding
   2. Once the client parsed and the server did not, the two disagreed about a titled link, a code
   span with a newline in it, a fenced block, and an id inside emphasis at the end of a URL — and
   there is no fifth patch that closes the class. So the server parses too:
   [`src/citable.ts`](../../src/citable.ts) is now the **one definition** of where in an answer a
   citation can appear, used by both counters and by the client's `unknownIds`, and `webLinks` is
   applied inside it to exactly the text the renderer applies it to.
3. **A link is checked before it is drawn.** The parser hands back whatever string sat between the
   brackets, so an ordinary-looking label over a `javascript:` URL, or over an address with
   credentials in it, arrives as an ordinary `link` node. `isWebUrl` and `hasCredentials` — the same
   two refusals `webLinks` makes about a bare address — are applied in `drawLink`, and a refused
   link is drawn as the characters the model typed. `hasCredentials` was exported from `urls.ts` for
   exactly this: two kinds of link, one answer. The concrete shapes are in the tests.

And one thing that is nobody's rule but ours: **anything the walk does not draw is rendered as the
characters the model wrote**, sliced out of the source by the node's own position — `sourceOf`. Raw
HTML, images, reference links and their definitions, and whatever CommonMark grows next.

That was written as "it cannot lose text", and the second review showed it could: a node's position
covers the node, and the blank line **between** two nodes belongs to neither, so two reference
definitions in a row ran together as `[a]: https://a.example[b]: https://b.example`. `between` now
takes that gap from the source as well. What the claim means, accurately: **no construct we decline
to draw loses its own characters, or the ones separating it from its neighbour.** Escapes and
entities are still interpreted, and `splitCitations` still drops an unknown id from a run that also
holds a known one — those are policies, stated elsewhere, not accidents.

**Nothing becomes markup at any stage.** No `dangerouslySetInnerHTML` anywhere; an `html` node is
drawn as its own characters; an `image` is too, because an `<img src>` built from model output is a
request to an address a hostile page chose.

## What changed for the reader

**It is CommonMark now**, which is also what the model expects, because it is what every other
renderer does. That is a bigger statement than a list of differences and it is the honest one: the
first draft of this section said "three behaviours reversed" and the reviewer found more. The ones
worth knowing:

- **Lazy continuation is back.** `- one` / `- two` / `And that is the argument.` is one list — the
  closing sentence joins the last bullet. The hand-rolled parser refused this on purpose.
- **A bold pair may cross a soft line break.** `a **b` / `c** d` is bold. `splitEmphasis` refused it,
  on the reasoning that a stray `**` would otherwise reach three sentences down.
- **Emphasis crosses a link**, which it could not before.
- **A paragraph's leading spaces are gone.** CommonMark strips up to three, and the hand-rolled
  version kept them because `pre-wrap` shows them. A deleted test protected this.
- **Four spaces is an indented code block.** `    - indented prose` was a list and is now code.
- Setext headings (`===` under a line), backslash escapes and HTML entities are all read now, and
  none of them were before.

Only the first three are things a model does often enough to notice.

## What must *not* be interpreted

Almost every answer has no Markdown in it at all, so a rule that reads a `-` starting a sentence as
a bullet damages far more replies than it improves. `chat-markdown-render.test.tsx` keeps every one
of these — the last two were defects, and are free now:

- `**Bold start** of a sentence.` is a paragraph, not a bullet.
- `2 * 3 * 4` is arithmetic; `some_variable_name` and `café_naïve_été` keep their underscores.
- `#hashtag` is not a heading; an unpartnered `**` stays literal.
- A table stays a paragraph with its pipes showing. Deliberate: `remark-gfm` is not installed, and a
  model writing a table into this panel has already misjudged the panel.

## Two things left alone on purpose

- **The prompt.** `FORMAT` still says plain prose paragraphs, short lists only when the answer really
  is a list, no headings. Nothing needed relaxing: the point was to draw what the prompt already
  permits, not to invite a reading companion to answer in bullet points.
  [vision.md § Anti-goals](../project/vision.md#anti-goals).
- **The summary panel's structure.** `CitedText` is the flat entry point: it reads the marks and
  refuses the blocks, because a summary sits inside a `<p>` that is already `pre-wrap` and is dense
  enough that a stray `#` becoming a heading would be worse than a stray `#`.

  **A non-paragraph block in a summary is drawn as its source characters**, and that is the one
  decision in this file to not get clever about. Flattening a list to its items' text would delete
  the `- ` from every line — silently deleting what the model wrote, which is the failure this whole
  area keeps having. Showing the marker is what the panel did before any of this existed.

  Its **inline** marks are another matter and they changed: `` `code` `` and `*italic*` are read by
  the shared path now, so summaries get them as well as bold. Right, for the reason bold was shared
  in the first place — these are things a model does whatever you tell it, and a summary printing
  its own asterisks looks like an app that cannot read its own output. Blocks are structure and are
  chat's; inline marks are tics and belong to both.

## A trap worth knowing before you name a CSS class

The classes are `fmt-list`, `fmt-h`, `fmt-quote`, `fmt-rule`, `fmt-pre`, `fmt-code` — not the obvious
`md-` prefix. [`tests/doc-links.test.ts`](../../tests/doc-links.test.ts) scans every source file for
bare references to a document and checks the file exists, and a class name that begins with a dot and
those two letters *is* one as far as its pattern is concerned. The first run reported seventeen
broken links to a document that could never exist.

## The second review

The rewrite went back to GPT Sol —
[chat-markdown-library-review-sol.md](chat-markdown-library-review-sol.md), and it is the more
useful of the two reviews because it is about the seams rather than the parsing. *"The library
choice is right. The direct mdast-to-React walk is also reasonable. The wrong part is keeping the
server on a raw-text approximation after the client became AST-aware."*

| What it found | What was done |
|---|---|
| **Deep nesting crashes the *render walk*** at ~2,400 levels, even though the parser is fine. The hand-rolled version had a depth cap; deleting the parser deleted the cap | `MAX_DEPTH` in `Cited.tsx`, matched in `citable.ts`, and past it a node is drawn as its own characters |
| **Client and server still disagreed** about four inputs, because only one side parsed | `citableText` — the server parses now. Nine shapes are pinned end to end, screen against log |
| **Two source-drawn blocks in a row lost the blank line between them** | `between` takes the gap from the source |
| Leading whitespace and four-space indents changed | Recorded above; both are CommonMark and neither is worth fighting |
| **Streaming is cumulatively quadratic** — a linear parse repeated per token | Recorded below with the numbers; it is not a regression, and the doc's "1.5ms" sentence was misleading and is fixed |
| `lastText` **over-suppressed**: an answer ending in a code block left a finished URL unlinked | The tail only counts if it really ends the answer |
| `sourceOf` returned `""` when a position was missing | Falls back to the node's own `value` |

Its security pass found no path by which model output becomes markup or reaches an attribute we do
not intend: every link the parser can emit reaches `drawLink`, `linkReference` and `definition`
never become anchors, images never become requests, and the only model-controlled attributes are a
validated `href` and a numeric `start`.

## Still open

- **Not checked in a browser against a real streaming answer.** The rendering was checked in Chrome
  at the real 288px band width, against answers on a throwaway page
  ([`preview-chat-markdown.html`](../../preview-chat-markdown.html)) that exercise every block — but
  not the moment a half-written list item is on screen. The parser has tests for the fence; the
  *look* of a list growing an item at a time is unobserved.
- **Streaming is cumulatively quadratic, and always was.** The whole answer is re-parsed on every
  token, so a linear parse repeated over *n* tokens is O(n²) across the answer: the reviewer measured
  ~2.3s of cumulative parsing for a 4KB answer and ~7.6s for 8KB, spread over the seconds the answer
  takes to arrive. The final parse alone is ~1.5ms, which is the number this doc used to quote as
  though it were the bill. **Not a regression** — the hand-rolled version re-parsed per token too —
  and not obviously worth fixing, since the fix is a throttle and a throttle is visible jank. But it
  is the first thing to look at if streaming ever feels heavy.
- **The library has its own nesting cliff.** `- ` repeated is one nested list per marker, and
  `mdast-util-from-markdown` is superlinear in depth: 1,000 markers take 0.9s, 3,000 take 8.6s,
  measured here. A separate adversarial shape — thousands of one-item lists over 64KB — was 1.4s in
  the research pass. All of it needs a model to write a line no model writes. Recorded because "a
  library has no cliffs" would be the wrong lesson to take from this whole episode.
- **`pre-wrap` on model paragraphs.** It now does one job: preserving the single newlines a model
  puts *inside* a paragraph, which Markdown would collapse. If models hard-wrap their prose at 80
  columns, that reads ragged in a 288px band. Not changed, because it is a documented decision and
  fixture text cannot settle what real answers do.
