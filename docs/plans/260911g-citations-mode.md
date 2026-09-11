# Citations — every work the piece cites, linked, and ranked the way Glossary is

A new mode in the band between the spine and the prose. It answers *what does this piece lean on,
and where do I find it* — the works the article cites, whether through a bibliography, footnotes, or
a name in running text, each with a link out.

Asked for by an admin through the Feedback button, 2026-09-11 21:12 UTC
([SPIDERYARN-READING2-2Y](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2Y), report
`spya-xz7ajs`, on `temporal-context-reinstatement-spya-dhqkf9`; Overseer queue `qi-p636nm8c`):

> Add a Citations mode that looks at citations and looks at the bibliography and references and
> provides, you know, a link to all of them. And you can either order them by when they appear in the
> text, or how relevant they are, or how influential, or a prioritized score. (the default, with
> threshold bar, kinda like Glossary etc) It will need web search(es)

An admin's request is built without debating whether; simplest-first decides how
([feedback-reports.md § Who sent it](../project/feedback-reports.md),
[vision.md § Simpler first](../project/vision.md#simpler-first)). This run is unattended, so the
decisions and assumptions are written here rather than asked in chat.

## What v1 is

```
  CITATIONS MODE — same spine, same article, the band is the works it cites

 ┌─────────────┬──────────────────────────┬─────────────────────────┐
 │  ▇▇▇▇▇▇▇▇   │ order [prioritised]      │ … as Tulving showed in  │
 │  ▇▇▇▇▇      │  first cited  relevance  │   his 1983 monograph,   │
 │  ▇▇▇        │  influence               │   episodic memory is …  │
 │  ▇▇▇▇▇▇▇    ├──────────────────────────┤                         │
 │  ▇▇         │ threshold 0·30 · 7 of 31 │                         │
 │  ▇▇▇▇       │ ──────●────────────      │                         │
 │             │ 24 citations are hidden  │                         │
 │             │ by this threshold. …     │                         │
 │             ├──────────────────────────┤                         │
 │             │ Elements of Episodic     │                         │
 │             │ Memory ↗ Tulving · 1983  │                         │
 │             │ the idea the piece tests │                         │
 │             │ rel·90 inf·95  from the  │                         │
 │             │ article · oup.com        │                         │
 │             │                          │                         │
 │             │ A distributed represen-  │                         │
 │             │ tation of temporal …     │                         │
 │             │ ↗ search Scholar         │                         │
 │             │ rel·70 inf·60  [Find it] │  ← stage 3              │
 └─────────────┴──────────────────────────┴─────────────────────────┘
```

- **One model pass over the article**, stored once, like Quotes, Ideas and Timeline — a pipeline step
  `citations` in `STEP_ORDER`, not in `DEFAULT_INGEST_STEPS`, started by pressing the mode
  (`useAutoRun`). Messages wire, `articleWithIds`, the capable model.
- **Per work**: a short title, authors and year as the article gives them, one plain sentence on
  *what the piece uses it for*, the blocks that cite it, the block holding its bibliography entry if
  there is one, and two model scores, `relevance` and `influence`, 0–1.
- **The link comes from the article whenever the article has one**, and code finds it, not the model
  — see [§ The one safety property](#the-one-safety-property). Where the article has none, the row
  links to a **Google Scholar search** for the title and authors, labelled as a search, not a source.
- **Four orders**: *prioritised* (the default), *first cited*, *relevance*, *influence* — with the
  number sorted by on every row, an unscored entry last, and the threshold bar and its
  *"N citations are hidden"* line from [`threshold.ts`](../../src/web/threshold.ts), exactly as the
  Glossary does it ([glossary.md § The scores](../project/glossary.md#the-scores-and-the-condition-attached-to-keeping-them)).
- **Pressing a row selects it** (`?cite=<id>`) and its citing passages are marked in the prose and
  on the spine through the `Found` currency, like an idea's occurrences; the row's link opens the
  work in a new tab through the existing external-link machinery.
- **Behind the experimental switch** — a new mode on an unmeasured prompt. Owner-only for v1: a
  visitor gets the explanatory band, not the list.
- **Stage 3, on demand, per entry: *Find it on the web*** — one web search through the gateway that
  returns the work's own page (publisher, DOI, arXiv, author PDF), stored against the entry so the
  second reader and the second visit pay nothing. This is where "it will need web search(es)" lands.

## The one safety property

**Every link the row presents as the work's own address was in the article.** The model never writes
a URL.

A remembered URL is the timeline's invisible wrong date again: `doi.org/10.1037/0033-295X.108.3.624`
looks exactly as right as a real one, and a reader who clicks it lands on somebody else's paper.
`articleWithIds` sends block *text*, so the model cannot see the article's hrefs anyway. So code
derives the link, in this order, and records which rule gave it:

1. **The first external `href` in the entry's bibliography block** (`refBlock`) — a bibliography entry
   is almost always one block and one work.
2. **An anchor in a citing block whose text the model quoted** (`linkText`, verbatim, optional) — the
   blog-post case, where the citation *is* a hyperlink: *"as [Kahneman argued](…)"*. Code finds the
   `<a>` with that text in the cited blocks and takes its `href`; no match, no link.
3. **A DOI or arXiv id in the bibliography block's text**, by regex → `https://doi.org/…` /
   `https://arxiv.org/abs/…`.
4. **Otherwise a Scholar search URL** built from the title and first author — shown as *search*,
   never as the work's address.

`linkFrom: "article" | "doi" | "search" | "web"` is on the entry and drawn on the row, the same
rule as the glossary's provenance label: the reader can always tell a link the article gave from one
we went looking for. Block ids the model names are validated against the article
(`validateOccurrences`' shape: an unknown id is dropped and counted, never stored).

## Scores, and the prioritised order

- `relevance` — how much *this piece's* argument leans on the work. The model's reading of the
  article, which it can do.
- `influence` — how influential the work is in its field. **The model's memory**, which is weaker,
  and the band says so in its foot line. Real citation counts are deferred (below).
- **Prioritised = `relevance × influence` against the bar, in first-cited order** — the glossary's
  shape exactly (product gates, first use orders, `canPrioritise` decides whether the control is
  worth drawing). The product is chosen for consistency with the mode it copies and because it is
  explainable in one line; its known cost is that a central but obscure work (0.9 × 0.2) sits under
  the default bar. Dragging left shows it, and the *hidden* line says it is there.
- **First cited** = the earliest citing block in document order; a work that is only in the
  bibliography and never cited in the running text sorts by its bibliography block.
- The prompt requires both scores; missing or rejected ones are counted, like
  `GlossaryScoreDrops`.

## Long bibliographies

A Wikipedia article can cite two hundred things. v1 caps the list (`MAX_CITATIONS`, starting at 80)
and the prompt says: *if there are more, keep the ones the piece leans on most*. The output budget
comes from `budgetFor`, and a truncated answer fails the way every other stage's does
(`truncationFailure`). Chunking and *Find more* are deferred — see below. The foot of the band says
when the cap was hit.

## Stages

1. **The artefact and the stage** (server) — `Citation` types, `ArtifactKind` `citations`, the step
   and every total the compiler asks for ([new-mode.md § The artefact](../project/new-mode.md#the-artefact-if-the-mode-shows-one)),
   the migration (a column on `article_revisions`, the step-name CHECK), `src/citations.ts` (prompt,
   parse, validate, link derivation, `PROMPT_VERSION`), the GET route, the export put-chain.
   Tests: the link derivation (each of the four rules, and a model-supplied URL ignored), id
   validation drops, score drops, the truncation path, and a store round trip.
   *Done when* `POST /api/jobs {steps:["citations"]}` on a local article writes a list and
   `GET /api/citations/:slug` returns it.
2. **The mode** (client) — `MODES` and every client total
   ([new-mode.md § The client](../project/new-mode.md#the-client)), `useCitations` on
   `useOrderedRead`/`useStepJob`/`useAutoRun`, `CitationsPanel` in `ModeSurface`, the four orders and
   the bar, `?cite=` and `?gate=`/`?sort=` in `params.ts`, the passage producer, the card's two
   sentences, `BEHIND_THE_SWITCH` and experimental-features.md, `docs/project/citations.md` under
   reading-view-overview.md. *Done when* the suite and typecheck are green and a browser run shows
   the list, the orders, the bar and a link opening in a new tab.
3. **Find it on the web** — `POST /api/citations/:slug/:id/find`: one chat-wire call with
   `openrouter:web_search` (a small `max_results`, a short prompt, an abort deadline — a searching
   prompt is a cost control, [ai-gateway.md](../project/ai-gateway.md)), answering JSON
   `{ found, url, title }`. **The URL must be one of the search results' own annotation URLs**, or it
   is not stored — the same rule as the safety property, one step out: the model picks among pages
   the search returned, it does not type one. Stored per `(article, entry id)` in its own table like
   [`pg-lookups.ts`](../../src/store/pg-lookups.ts), read back onto the entry; `linkFrom: "web"`.
   Not streamed: the answer is a link, not prose to start reading, so there is nothing to read early.
4. **Bookkeeping** — the note in `docs/user-feedback/`, `overseer-queue.ts done`, push.

Each stage ends green and committed, with a GPT Sol review (the code review write-capable, per the
house workflow).

## What is deliberately not built — deferred, not forgotten

- **Real influence** — citation counts from OpenAlex or Semantic Scholar (free, keyless APIs). It
  would turn `influence` from memory into evidence, and it is a new outbound dependency with its own
  failure modes; worth it once the mode has been used.
- **Batch web search** for every unlinked entry at generation time. A searching call is priced by
  searches, not by results, and one probe ran 36 searches for four results; thirty references would
  be real money nobody asked to spend. Per-entry and on demand is the glossary's argument
  ([glossary.md § Checking a term on the web](../project/glossary.md#checking-a-term-on-the-web)).
- **Find more / chunking** for bibliographies over the cap.
- **Visitors** (public-readable). A column on the revision makes it a projection away, and
  [new-mode.md](../project/new-mode.md) lists the four places that projection touches.
- **Marking the citation in the prose** as its own underline/hover (like glossary terms). v1 marks
  the citing *passages* of the selected entry, which is existing machinery.
- **Relevance from the reader's profile.** Relevance here means relevance to the piece.

## The simpler option passed over

**No model call at all**: parse the article's own bibliography block by block and link each. It is
free and deterministic, and it fails on the case the reader was looking at — most web articles have
no bibliography, only works named in running text and hyperlinks — and it cannot score relevance or
influence, which are two of the four orders asked for. The model pass is the smallest thing that
does all four; the links stay deterministic, which is the half that can be wrong in a way a reader
cannot see.

## Progress

- 2026-09-11 — plan written; review pending.
