# The reading view

Everything the reader sees in the browser. The page has **three regions**: the **spine** (where you
are in the article), the **prose** (what you are reading), and between them a **band** belonging to
whichever mode is on. The first two are permanent; the band is the surface glossary, summaries,
ideas, search, diagram and chat take turns in.

**Two of the ten modes open no band at all**, and the default is one of them. `plain` is the article
by itself — no band, and no gist columns either — and it is what a bare `/read/<slug>` shows since
2026-08-31; `hierarchy` is the granularity columns beside the prose, which is what the default used
to be. So *a mode is open* and *a band is open* are separate questions
([plain-mode-and-the-way-out.md](../plans/plain-mode-and-the-way-out.md)).

The feature the app is *for* is **[granularity zoom](granularity-zoom.md)**: the article at any level
of compression, down the page for position and across for detail. Read that first.

## True across the whole view

- **Text is addressed by block id, never by pixel offset or CSS selector** — scroll position, deep
  links, marks, citations, search hits. **[block-ids.md](block-ids.md)** has the format and the one
  way to get range checks silently wrong.
- **View state lives in the URL** — not `useState`, not `localStorage`. See
  [url-state.md](url-state.md).
- **Stream any model call a person is waiting on**; the plumbing is shared, so a streaming endpoint
  is a generator and a route. [comments.md § streaming](comments.md#streaming) has the two
  invariants a stream needs and a single response does not.
- **Never substitute generated text for the prose,** and render model output as text, not HTML.
- **One payload, no network on zoom** — meta, blocks and tree arrive together.

## The docs

### The layout

- **[web-client.md](web-client.md)** — where the client code lives, how the middle became a slot,
  what Tailwind and shadcn may touch, dark mode, and the full list of constraints.

### The article itself

- **[granularity-zoom.md](granularity-zoom.md)** — **the core feature.** The tree, the node shape,
  the tabular view, the spine, the arc, columns that will not fit, and what would make the idea fail.
- **[column-context.md](column-context.md)** — why a coarse column is 80% blank mid-article, and the
  centred fisheye that fixed it.

### The modes in the band

- **[glossary.md](glossary.md)** — the terms this piece uses, defined from the piece and underlined
  wherever it uses them. Open it for the two bugs from the previous version it is shaped around.
- **[summaries.md](summaries.md)** — the article at whichever length you ask for, the named ladder
  wired to every level of the tree, and the panel that follows the reader down the page.
- **[ideas.md](ideas.md)** — the propositions the piece needs you to hold, sibling to the glossary:
  a term is a word you look up, an idea is a claim you hold. The first stage that lets the model
  name block ids.
- **[search.md](search.md)** — one box, two matchers, hits marked in the prose, and the shape of a
  search painted into the spine. Long; open it for the confidence unit or the colours.
- **[diagram.md](diagram.md)** — the article's shape as a picture: three of them, what each can and
  cannot promise, the five that were cut, and why nothing was installed to draw them.

### Marking a passage, and asking about one

- **[comments.md](comments.md)** — select a sentence and it is yours: a bookmark, a note on it if
  you want one, and an answer from the model only if you tick the box. **Saving costs nothing.**
  Open it for the anchoring, the four store operations and why there are four, and the streaming.
- **[chat-tools.md](chat-tools.md)** — the six tools chat can reach for and the filter they passed:
  *does it send the reader somewhere they could not otherwise get to?* Chat itself is in the plans:
  [chat-mode.md](../plans/chat-mode.md), [chat-as-gateway.md](../plans/chat-as-gateway.md).
- **[review-mode.md](review-mode.md)** — the other direction: the reader says what they took from the
  piece and the model shows them where it comes apart. Four stances, a prompt rewritten after a
  cross-family review said not to ship the first one, and the one mode that cannot be used to avoid
  reading.

### Hovering and moving around

- **[links.md](links.md)** — hover one of the article's own hyperlinks and a card says where it
  goes; also the measurement showing Readability-in-the-browser is a wall, not a decision.
- **[tooltips.md](tooltips.md)** — the library choice, and why there are two implementations: the
  glossary card's triggers are injected HTML with no React element to wrap.
- **[keyboard.md](keyboard.md)** — ↑ / ↓ take the step, ← / → choose the stride, and the pointer's
  column decides how big a step is.
- **[touch.md](touch.md)** — reading on an iPad: a swipe over a gist column steps, the prose keeps
  momentum scrolling. Open it for why not `scroll-snap`.
- **[url-state.md](url-state.md)** — every parameter, which push history and which replace, and why
  position is a *section* rather than an offset.

### Getting in and out

- **[library.md](library.md)** — the shelf: `/read/<slug>`, what a card says, what you can do to
  one, and three sorting rules that look right in a browser and are wrong.
- **[page-titles.md](page-titles.md)** — what the browser tab says. One rule — *what is different
  about this tab goes first* — and why assigning `document.title` announces nothing.
- **[reader-profile.md](reader-profile.md)** — two boxes and one string telling the model who is
  reading, where it rides in a prompt, and the microphone that looked broken twice and was not.
- **[experimental-features.md](experimental-features.md)** — the switch on the same page for
  features that are not finished. Off by default, nothing behind it yet, and the rule that hiding a
  feature never breaks a link to it.
- **[dictation.md](dictation.md)** — talking into a text box: why it transcribes twice, the one
  microphone a page is allowed, and the three lines that give any box a button.
- **[copy.md](copy.md)** — the words a reader sees when something fails, why they all live in one
  file, and the bracketed code at the end of every message.

## Where the code is

Under [`src/web/`](../../src/web): [`main.tsx`](../../src/web/main.tsx) →
[`App.tsx`](../../src/web/App.tsx) → [`TableView.tsx`](../../src/web/TableView.tsx), with
[`layout.ts`](../../src/web/layout.ts) deciding what fits, [`tree.ts`](../../src/web/tree.ts) turning
the tree into table geometry, and [`scroll.ts`](../../src/web/scroll.ts) owning every jump. Reader-facing
strings: [`src/messages.ts`](../../src/messages.ts).
[web-client.md § Where the code is](web-client.md#where-the-code-is) has the full table.

---

Up: [AGENTS.md](../../AGENTS.md)
