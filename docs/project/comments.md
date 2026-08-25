# Comments — asking the model about a passage

Select a sentence in the verbatim column and the model explains it, researching the web first if it
needs to. The answer arrives in a floating dialog, and both the mark in the prose and the answer
survive a reload.

This is the first of the "reading assistant" features
[vision.md § Where this goes](vision.md#where-this-goes-after-granularity-zoom) lists — **ask in
place**: "a question about the paragraph under the cursor, answered from the surrounding context,
cited back to block ids".

## Intent

Greg, 2026-08-25:

> If I use the mouse to select some text in the VERBATIM-TEXT column, it should:
>
> - Create a persistent UI artifact in the doc for that selection, indicating that there is an
>   explanatory comment there
> - Add an element in the new rightmost column, initially showing a loading spinner
> - Call an LLM with a prompt to try and explain what that sentence means (given the whole text of
>   the article, and after doing some web research)
> - Fill in the rightmost column entry when we have a response from the LLM.

Three of the four decisions below were settled by him the same day; the fourth reversed the "new
rightmost column" in that brief.

### Decision: a dialog, not a column <a id="decision-a-dialog-not-a-column"></a>

Asked whether a fourth column would complicate the UI:

> Perhaps we shouldn't add it as a column of its own. I don't know. Will it complicate the UI
> substantially, do you think? Perhaps for now let's have them show up as a dialog box to avoid
> screwing up the existing UI, until we come up with a better plan.

It would have. A real column has to enter [`layout.ts`](../../src/web/layout.ts)'s shrink-then-drop
arithmetic ([granularity-zoom.md](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them)),
take `pin-right` off the prose, and thread through the `rowSpan` geometry in
[`TableView.tsx`](../../src/web/TableView.tsx) — and a comment belongs to a *span of a paragraph*,
not to a row, so a table cell is the wrong shape for it anyway. The dialog
([`CommentDialog.tsx`](../../src/web/CommentDialog.tsx)) touches none of that: **nothing in
`fitView` changed for this feature.**

The cost is that only one answer is visible at a time, and there is no way to see every comment on
the article at once. Marginal cards or a column remain the better long-term answer — this is
explicitly "until we come up with a better plan".

### Decision: the model decides whether to search <a id="decision-web-research"></a>

Asked how much web research the explain call should do:

> Only when the model asks for it, but encourage the model to ask for it unless it's very sure

Which is what OpenRouter's `engine: "native"` gives us, and the *only* thing that does. The plugin
engines (`exa`, `parallel`, `perplexity`, …) run a search on **every** request whether one is wanted
or not; `native` hands the model the provider's own search tool and lets it choose. The
encouragement is a paragraph of the system prompt in [`src/explain.ts`](../../src/explain.ts); the
choice stays with the model.

`usage.server_tool_use_details.web_search_requests` reports what it actually did, and the dialog
prints it — "3 web searches" or "no web search needed". A claim about research that nobody can check
is worth nothing.

### Decision: comments persist on disk <a id="decision-persistence"></a>

They survive reload, back/forward and a pasted link, in the `reader.json`-shaped slot
[architecture.md § Storage](architecture.md#storage) already reserves — as
`data/<slug>/comments.json`. Written under `data/` even when the article itself came from the
committed [`example/`](../../example/README.md) fixture: the fixture is shared, a reader's questions
are not, and `data/` is gitignored. `loadArticle` requires *both* `blocks.json` and `tree.json`
before it accepts a directory ([`src/api.ts`](../../src/api.ts)), so a lone `comments.json` cannot
make an empty `data/<slug>/` shadow the fixture.

## Anchoring <a id="anchoring"></a>

A comment is `blockId` + the exact `quote` + a `start` offset — and **in that order of authority**.
The block id is the spine ([block-ids.md](block-ids.md)); the quote is the anchor; the offset only
chooses between repeats of the same words inside the block.

That ordering is the whole design. An offset alone drifts the moment the paragraph changes, and
drifts *silently* — you get a mark over plausible, wrong words, which is the failure random block
ids exist to prevent. So [`resolveMark`](../../src/web/annotate.ts) re-finds the quote by text and
returns `null` when it is gone. A comment whose quote has vanished draws no mark at all; it is still
in the list and still openable. Losing the anchor is the safe failure, exactly as in
[block-ids.md § The cost we accepted](block-ids.md#the-cost-we-accepted).

### The offset space is the *rendered* text, not `block.text` <a id="offset-space"></a>

> [!WARNING]
> `block.text` is not the string the browser renders. `extractText` in
> [`src/blocks.ts`](../../src/blocks.ts) collapses whitespace **and inserts a space at every nested
> block boundary**, so a two-paragraph `<blockquote>` is one character longer in `block.text` than
> on screen. An offset taken against one and applied to the other lands somewhere plausible and is
> silently wrong.

The offset space used here is the concatenation of the **text nodes of `block.html`** — which is
what `Range.toString()` measures and what a `TreeWalker` over `SHOW_TEXT` produces. Both halves of
the feature use that one definition, and the *browser's own parser* computes it: no entity table, no
tag scanner, nothing of ours that could drift from what the DOM does.

That is also why [`tests/annotate.test.ts`](../../tests/annotate.test.ts) and
[`tests/selection.test.ts`](../../tests/selection.test.ts) carry a
`// @vitest-environment jsdom` line instead of using the node default in
[`vitest.config.ts`](../../vitest.config.ts). A hand-rolled tokenizer tested under node would pass
against itself and disagree with Chrome.

### One `<mark>` per text node <a id="one-mark-per-text-node"></a>

A selection may start inside an `<em>` and end outside it. One `<mark>` around the whole range would
be malformed (`<em>a<mark>b</em>c</mark>`) and the browser would quietly repair it into something
else, so a mark becomes one `<mark>` per text node it touches. The last run carries `data-mark-end`,
which is what the ✳ in [`styles.css`](../../src/web/styles.css) hangs off — a mark broken across
three runs still shows one marker. Overlapping comments share a single `<mark>` listing both ids
rather than nesting, because two underlines on the same words read as a rendering bug.

## Why this call is not a pipeline stage <a id="why-this-call-is-not-a-pipeline-stage"></a>

[architecture.md](architecture.md#server-and-client) says "LLM calls happen in the pipeline, not in
request handlers". This is the deliberate exception, and the reason is that its input does not exist
until the reader makes it: a selection cannot be precomputed, cached on a content hash, or run
ahead of time. Everything else about the stage discipline holds — the call is one transport-free
function ([`src/explain.ts`](../../src/explain.ts)), the routes are a thin wrapper
([`src/routes.ts`](../../src/routes.ts)), and the artefact is JSON on disk.

It is also the only place the project talks to **OpenRouter** rather than the Anthropic SDK the
pipeline uses, because `OPENROUTER_API_KEY` is the key this project has. The model defaults to
`anthropic/claude-sonnet-4.5` and is overridable with `SPIDERYARN_EXPLAIN_MODEL`.

## What the prompt asks for

The system prompt is in [`src/explain.ts`](../../src/explain.ts) and is written against
[vision.md § Principles](vision.md#principles) rather than against "explain this":

- Supply what the passage **assumes you know** — the term of art, the named person, the debate being
  alluded to, the earlier passage it answers. The reader can already see the words.
- Keep the author's own vocabulary, so the explanation and the prose are recognisably about the same
  thing (principle 2).
- **Do not summarise the article.** The reader is reading it. That is the anti-goal in
  [vision.md](vision.md#anti-goals), one sentence from the prose it would be replacing.
- Say when the article does not say, rather than picking a reading and sounding confident.

The whole article goes in the prompt every time — Greg asked for the answer to be given "the whole
text of the article", and a selection is usually ambiguous without it ("this move", "the same
objection"). At ~15k tokens for the test article that is a few cents a question.

The answer is rendered as **text**, never as HTML: there is no `dangerouslySetInnerHTML` on this
path and there should never be one. It is model output landing beside the author's prose, and it
must not be able to dress itself up as the article.

## Where the code is

| File | What it does |
|---|---|
| [`src/web/selection.ts`](../../src/web/selection.ts) | mouse selection → `{ blockId, quote, start }`, clamped to one block |
| [`src/web/annotate.ts`](../../src/web/annotate.ts) | re-find a quote, and draw the `<mark>` runs over it |
| [`src/web/useComments.ts`](../../src/web/useComments.ts) | fetch / ask / retry / delete, and the client-minted id |
| [`src/web/CommentDialog.tsx`](../../src/web/CommentDialog.tsx) | the panel: quote, spinner, answer, sources |
| [`src/explain.ts`](../../src/explain.ts) | the OpenRouter call and the system prompt |
| [`src/comments.ts`](../../src/comments.ts) | `data/<slug>/comments.json`, and the write serialisation |
| [`src/routes.ts`](../../src/routes.ts) | the four endpoints, mounted by [`vite.config.ts`](../../vite.config.ts) |
| [`src/env.ts`](../../src/env.ts) | `.env.local` → `process.env` |

```
GET    /api/comments/:slug        every stored comment
POST   /api/comments/:slug        { id?, blockId, quote, start } → the answered comment
DELETE /api/comments/:slug/:id
```

The POST **is** the answer — it returns the finished comment, so there is nothing to poll.

## Four things that fail silently here

1. **Concurrent writes.** Every create is a read-modify-write of the whole file, and selecting two
   passages in quick succession is the normal way to use this. Without the promise chain in
   [`src/comments.ts`](../../src/comments.ts) the second read starts before the first write lands
   and a comment vanishes — with *both* writes reporting success.
   [`tests/comments.test.ts`](../../tests/comments.test.ts) pins it, and the test genuinely fails
   when the chain is removed (7 of 8 comments lost). See
   [silent-success.md](../reusable/silent-success.md).
2. **A 200 with no completion.** OpenRouter answers `200` with an empty `content` when the model
   stops for its own reasons. `explain` throws on that rather than storing a blank comment that
   looks answered.
3. **The browser's own selection highlight** sits on top of the mark we just drew, so without
   `removeAllRanges()` after asking, the new artefact is invisible until the reader clicks
   elsewhere — and it looks exactly like a mark that was never drawn. The call is in
   [`App.tsx`](../../src/web/App.tsx) § `onSelect`.
4. **Retry, which shipped broken and was caught in the browser.** `retry` fired the POST from
   inside a `setComments` updater. An updater must be pure — React StrictMode invokes it twice — so
   one click sent *two* requests; and because `createComment` refused a client id that was already
   taken, each reply came back under a **new** id. Result: two model calls paid for, two orphan
   comments on disk, the original still marked `error`, and a dialog spinning forever on an id
   nothing would ever answer. Every individual piece reported success. The fix is two-layered — the
   updater is pure now, *and* `createComment` is idempotent on the id, so a duplicated POST resets
   the comment in place instead of appending. `tests/comments.test.ts` pins the server half.

The last of those is the shape [silent-success.md](../reusable/silent-success.md) describes almost
exactly: it was invisible to the unit tests (both halves passed in isolation), invisible in the
network tab (two 200s), and only visible as "the spinner never stops".

## When it says "Failed to fetch" <a id="failed-to-fetch"></a>

The dev server is not running. That is nearly always the whole story — an explain call is a normal
`fetch` to `/api/comments/<slug>`, and a bare `TypeError: Failed to fetch` means the request never
got a response at all.

It is the easiest failure to hit here, for a reason worth stating: **an explain call takes 11-25
seconds**, and `npm run dev` restarts whenever `vite.config.ts` changes. With several agents editing
this tree at once, that is a wide window for a request to be orphaned mid-flight. So
`describeFetchFailure` in [`useComments.ts`](../../src/web/useComments.ts) rewrites the browser's
message into one that names the cause, keeping the original in parentheses so it stays searchable:

> Couldn't reach the dev server — is `npm run dev` still running? (Failed to fetch)

Check the server the way [browser-testing.md](browser-testing.md) says to — don't take another
agent's word for it, or your own from ten minutes ago:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5273/api/article/<slug>
```

A comment whose POST never reached the server is **not** written to disk, so it disappears on
reload rather than leaving a permanent unanswered mark. Nothing to clean up.

## Deliberate limits

- **A selection under 8 characters is ignored.** Every one of these costs a model call, and a
  double-click that skidded should not fire one. `MIN_SELECTION_CHARS` in
  [`selection.ts`](../../src/web/selection.ts).
- **A selection spanning two blocks is clamped to the first.** A comment addresses one block —
  that is what makes it storable against the id spine — and silently doing the first paragraph beats
  appearing to ignore the drag.
- **A comment is stored `pending` before the model is called**, so a crash mid-answer leaves a
  visible unanswered question rather than a selection that evaporated. The dialog offers a retry.
- **No editing, no reply, no follow-up question.** Ask, read, delete. Anything more is a chatbot
  with the article in the context window, which is
  [an explicit anti-goal](vision.md#anti-goals).
- **Comments are per-article, not per-reader.** There is one reader.

## See also

- [vision.md](vision.md#where-this-goes-after-granularity-zoom) — where "ask in place" sits in the plan
- [block-ids.md](block-ids.md) — the spine, and why losing an anchor beats moving it
- [web-client.md](web-client.md) — the reading view this hangs off
- [url-state.md](url-state.md) — `?note=` joins the family; why it replaces rather than pushes
- [setup-dev.md](setup-dev.md) — `OPENROUTER_API_KEY`
