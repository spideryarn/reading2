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

**Revised after GPT Sol's plan review** ([review](260911g-citations-mode-review-sol.md), ledger at
the foot). The first draft let the model name citing blocks and took the first link in a
bibliography entry; both were wrong on real pages, and the review showed where.

## What v1 is

```
  CITATIONS MODE — same spine, same article, the band is the works it cites

 ┌─────────────┬──────────────────────────┬─────────────────────────┐
 │  ▇▇▇▇▇▇▇▇   │ order [prioritised]      │ … as Tulving showed in  │
 │  ▇▇▇▇▇      │  first cited  relevance  │   his 1983 monograph,   │
 │  ▇▇▇        │  influence               │   episodic memory is …  │
 │  ▇▇▇▇▇▇▇    ├──────────────────────────┤                         │
 │  ▇▇         │ threshold 0·50 · 7 of 31 │                         │
 │  ▇▇▇▇       │ ──────●────────────      │                         │
 │             │ 24 citations are hidden  │                         │
 │             │ by this threshold. …     │                         │
 │             ├──────────────────────────┤                         │
 │             │ Elements of Episodic     │                         │
 │             │ Memory ↗ Tulving · 1983  │                         │
 │             │ the idea the piece tests │                         │
 │             │ rel·90 inf·95 · doi.org  │                         │
 │             │ first cited ¶ k3m9qt     │  ← jumps to the passage │
 │             │                          │                         │
 │             │ A distributed represen-  │                         │
 │             │ tation of temporal …     │                         │
 │             │ ↗ search Scholar         │                         │
 │             │ rel·70 inf·60 [Find it]  │  ← stage 3              │
 └─────────────┴──────────────────────────┴─────────────────────────┘
```

- **One model pass over the article**, stored once, like Quotes, Ideas and Timeline — a pipeline step
  `citations` in `STEP_ORDER`, not in `DEFAULT_INGEST_STEPS`, started by pressing the mode
  (`useAutoRun`). Messages wire, `articleWithIds`, the capable model. It **replaces** on a re-run,
  inheriting ids (below); *Find more* is deferred.
- **Per work**: a short title, authors and year as the article gives them, one plain sentence on
  *what the piece uses it for*, where the article cites it, the block holding its bibliography entry
  if there is one, and two model scores, `relevance` and `influence`, 0–1.
- **The link comes from the article whenever the article has one**, and code finds it, not the model
  — [§ The one safety property](#the-one-safety-property). Where the article has none, the row
  links to a **Google Scholar search** for the title and first author, labelled as a search.
- **Four orders**: *prioritised* (the default), *first cited*, *relevance*, *influence* — the number
  sorted by on every row, an unscored entry last, and the threshold bar with its *"N citations are
  hidden"* line from [`threshold.ts`](../../src/web/threshold.ts), as the Glossary does it
  ([glossary.md § The scores](../project/glossary.md#the-scores-and-the-condition-attached-to-keeping-them)).
- **Each row says where it is first cited** and that is a jump to the passage (the existing block
  link), not a selection. No `?cite=`, no marks in the prose — deferred (Sol F7): it was an addition
  nobody asked for, and the budget goes on getting the links and occurrences right instead.
- **Behind the experimental switch** — a new mode on an unmeasured prompt. **Owner-only** for v1: a
  visitor gets the explanatory band, not the list.
- **Stage 3, on demand, per entry: *Find it on the web*** — one chat-wire call with web search,
  whose answer is kept only if it is one of the search's own results and its title matches the work
  ([§ Stage 3](#stage-3-find-it-on-the-web)). This is where "it will need web search(es)" lands.

## What the model returns, and what code does with it

The model sees `articleWithIds` — block ids and **plain text only** (no hrefs, no `noteId`). So it is
asked for what it can see, and code does the rest (Sol F2):

```
{ title, authors, year, why, relevance, influence,
  reference?: { block, quote },        // the bibliography / reference-list entry, if any
  mentions:   [{ block, quote }, …]    // ≤ 3: where the text cites it — "Tulving (1983)", "[12]"'s
}                                      //   note text, a hyperlinked phrase
```

- **Every `{block, quote}` is verified** with `findQuote` against that block's text; an unknown id or
  a quote not in the block is dropped and counted (`validateOccurrences`' shape, with the Quotes
  stage's verification). An entry with no verified reference and no verified mention is dropped.
- **Footnotes are expanded in code.** A mention or reference whose block is a note (`noteId`) also
  counts as cited at every body block carrying a `data-spya-note-ref` marker for that note
  ([`notes.ts`](../../src/notes.ts)). That is where Wikipedia's and gwern's citations actually live,
  and the model cannot see the marker topology.
- **First cited** = the earliest verified *body* block among the mentions and the expanded markers;
  a work cited only in the bibliography sorts by its bibliography block, after the rest.
- **Ids are minted by code** (`mintUniqueId`), and a re-run on the same article inherits an old id
  when the **dedupe key** matches — DOI or arXiv id, else the article-given URL, else normalised
  title + first author + year. The same key merges duplicate rows inside one run (a shorthand cite
  and its full reference). Stage 3's stored links are keyed on the entry id, so they survive a re-run
  (Sol F6; `idsByText` in [`quotes.ts`](../../src/quotes.ts) is the shape).

## The one safety property

**Every link the row presents as the work's own address was in the article.** The model never writes
a URL. A remembered URL is the timeline's invisible wrong date again: a DOI looks exactly as right
as a real one, and a reader who clicks it lands on somebody else's paper. So code derives the link,
in this order, and records which rule gave it (Sol F3 reordered it, and showed the first draft's
"first external href" returning an author's Wikipedia page instead of the paper):

1. **A DOI** in the reference block's text or hrefs → `https://doi.org/…`.
2. **An arXiv id** there → `https://arxiv.org/abs/…`.
3. **An external anchor in the reference block whose text matches the title** (normalised title
   words), and only if exactly one does.
4. **An external anchor in a mention block whose text is the mention's quote**, only if unique in the
   block and not a generic label (*here*, *this*, *link*, *paper*, *source*, one word).
5. **Otherwise a Scholar search URL** built from the title and first author — shown as *search*,
   never as the work's address.

Ambiguity falls through to search, because a link to the wrong work is worse than a search.
`linkFrom: "doi" | "arxiv" | "article" | "search" | "web"` is on the entry and drawn on the row — the
glossary's provenance rule: the reader can always tell a link the article gave from one we went
looking for.

## Scores, and the prioritised order

- `relevance` — how much *this piece's* argument leans on the work. The model's reading of the
  article.
- `influence` — how influential the work is in its field. **The model's memory**, which is weaker,
  and the band says so in its foot line. Real citation counts are deferred.
- **Prioritised = `(2 × relevance + influence) / 3` against the bar, in first-cited order.** Not the
  glossary's product (Sol F9): there both dimensions are necessary, and here influence is not — an
  obscure work the piece is built on is exactly what the list should keep. Weighted to relevance so
  a famous but passing reference does not ride its fame over the bar; not `max`, which would let it.
  Only the two raw numbers are drawn on a row, never the combination, as in the glossary. The default
  bar position is set from what stage 1's real runs produce, and written here with its evidence.
- The prompt requires both scores; missing or rejected ones are counted, like `GlossaryScoreDrops`.

## Long bibliographies

A Wikipedia article can cite hundreds of things (*Replication crisis*, locally: 831 note blocks).
v1 caps the list at `MAX_CITATIONS` = 80, and the prompt says *if there are more, keep the ones the
piece leans on most, and set `capped: true`*. The band's foot says so only when the model reported
it — *"This piece cites more than 80 works; these are the 80 we judged it leans on most"* — never
inferred from the list being 80 long, and never claiming the ranking as fact.

**Sol F5 said this does not give "a link to all of them", and it is overruled**, with Fable
arbitrating (2026-09-11): the brief is Greg's own *"build the simplest version that works end to end
and name the deferred rest"*, a stated and counted cap is that version, an 800-note Wikipedia page is
the edge rather than the corpus, and *Find more* is a follow-up on machinery Quotes and Glossary
already have. What Fable kept from F5 is the **coverage witness**: the stage logs how many
bibliography / note blocks the article has against how many works came back, so a silent
under-return on a 60-item bibliography shows up in a run rather than nowhere.

**The budget is explicit** (Sol F10): field caps (title ≤ 120 chars, `why` ≤ 160, `quote` ≤ 120, ≤ 3
mentions), an answer estimate of `base + entries × per-entry` tokens fed to `budgetFor`, and the
headroom checked on the longest local article (a Wikipedia page and a PDF-derived paper) in stage 1,
with the numbers written here. Footnote expansion in code is what keeps the per-entry figure small.

## Stages

1. **The artefact and the stage** (server) — `Citation`/`Citations` types, `ArtifactKind`
   `citations`, the step, and every total the compiler asks for
   ([new-mode.md § The artefact](../project/new-mode.md#the-artefact-if-the-mode-shows-one)):
   `SHAPE`, `STAMP_SOURCE`, `STEP_BUDGET_MS`, `STEPS`, `STEP_ORDER`, `TASK_TIER`, `TASK_WIRE`,
   `MODEL_ENV_VAR`, `STAGE_EFFORT`, `ARTICLE_RENDERER`, `REVISION_CARRY_POLICY`, `ArticleReader` and
   its adapter; the migration (a column on `article_revisions`, the step-name CHECK, which
   `tests/db-step-constraint.test.ts` checks); `src/citations.ts` (prompt, parse, verification,
   footnote expansion, dedupe and id inheritance, link derivation, `PROMPT_VERSION`); the GET route
   and `CACHEABLE`; the export put-chain. Tests: each link rule and its ambiguity fall-through
   (including the Wikipedia author-link case), a model-supplied URL ignored, quote-verification drops,
   footnote expansion, dedupe and id inheritance, score drops, truncation. A real run on two or three
   of the local test articles (below), with what it produced written here.
2. **The mode** (client) — `MODES` and every client total
   ([new-mode.md § The client](../project/new-mode.md#the-client)): `MODE_LABEL`,
   `OWNER_MODE_NOTE`, `MODE_CATALOG` (both card sentences, aliases, `experimental: true`), `MODES_UI`,
   `POLICY`, `BAND_SAYS`, `MODE_TARGET`, `SPENDS`, `DRAWS`, `modeBand()`, `MODE_CONTAINMENT` and its
   `WITNESS`, `selectPassages` (`NO_FOUND`, named a non-producer in
   `every-mode-says-which-passages-it-marks`), `GENERATES`, `visitor-gaps`, `page-title`'s `named`,
   `BEHIND_THE_SWITCH`, the stylesheet `MANIFEST` if it has one, `auto-run-targets.ts`. Then
   `useCitations` on `useOrderedRead`/`useStepJob`/`useAutoRun`, `CitationsPanel` in `ModeSurface`,
   the four orders and the bar, `?sort=`/`?gate=` in `params.ts`, experimental-features.md,
   `docs/project/citations.md` and its line under reading-view-overview.md. Done when the suite and
   typecheck are green and a browser run shows the list, the orders, the bar, a link opening in a new
   tab and a first-cited jump landing.
3. **Find it on the web** — below.
4. **Bookkeeping** — the note in `docs/user-feedback/`, `overseer-queue.ts done`, push.

Each stage ends green, committed and pushed. **Stage code reviews are owed, not run** — the ChatGPT
subscription Sol bills was at 93% of its week on 2026-09-11 and the Overseer held all code reviews
until its reset on 2026-09-15 01:23Z. Fable stands in mid-stage. The shas each owed review covers are
listed under [§ Progress](#progress).

### Stage 3: find it on the web

`POST /api/citations/:slug/:id/find` → JSON. **One chat-wire call, not one search** (Sol F1): the
server tool cannot bound the number of searches — a probe asking for 4 results ran 36 billed searches
([ai-gateway.md § The four things that fail silently](../project/ai-gateway.md#the-four-things-that-fail-silently)).
The honest controls are the ones that exist: a short prompt that asks for one search for this one
work and nothing else, `engine: "exa"` with a small `max_total_results`, an abort deadline, and
`webSearches` on the ledger row as the alarm, logged per call. It is on demand, per entry, by the
owner — never a batch.

**What is kept** (Sol F4): Exa, because the default engine can return zero annotations; every
annotation collected into an exact URL map (`collectCitations`, and `readSources` in
[`referee-candidates.ts`](../../src/referee-candidates.ts) is the precedent); the model picks one of
those URLs; **the stored url and title are the annotation's, never the model's**; and it is kept only
when the annotation's title or excerpt matches the work's title words. Anything else stores nothing
and the reader is told no page matched — the Scholar search stays. Stored per `(article, entry id)`
in its own table like [`pg-lookups.ts`](../../src/store/pg-lookups.ts), read back onto the entry as
`linkFrom: "web"`. Not streamed: the answer is a link, not prose to start reading.

## What is deliberately not built — deferred, not forgotten

- **Find more / chunking** for bibliographies over the cap (F5).
- **Selecting a row and marking its passages** in the prose and on the spine (`?cite=`, a `Found`
  producer) — Sol F7. v1 has the first-cited jump.
- **Real influence** — citation counts from OpenAlex or Semantic Scholar (free, keyless). Turns
  `influence` from memory into evidence; a new outbound dependency with its own failure modes.
- **Batch web search** for every unlinked entry at generation time — searches are billed, not
  results, and nothing bounds them.
- **Visitors** (public-readable) — a projection away, and new-mode.md lists the four places it touches.
- **Marking citations in the prose** as their own underline and hover card, like glossary terms.
- **Relevance from the reader's profile.**

## The simpler option passed over

**No model call at all**: parse the article's own bibliography block by block and link each. Free and
deterministic, and it fails on the case the reader was looking at — most web articles have no
bibliography, only works named in running text and hyperlinks — and it cannot score relevance or
influence, two of the four orders asked for. The model pass is the smallest thing that does all
four; the links and the locations stay deterministic, which is the half that can be wrong in a way a
reader cannot see.

## Test articles (local database)

| Slug | Shape |
|---|---|
| `spider-silk-spya-ge30uz` | Wikipedia; 132 notes, ~98 DOIs |
| `scaling-hypothesis` | gwern; bibliography + 41 notes, ~35 arXiv ids |
| `replication-crisis-spya-hrjamq` | Wikipedia, 831 notes — the cap |
| `antikythera-mechanism-spya-zhxrzm` | Wikipedia footnotes |
| `openai-huggingface` | blog post, inline links only |
| `source-spya-furjgs` | PDF-derived paper, DOIs and no links |

The reader's own article is not in the local database.

## Review ledger — GPT Sol on the plan, 2026-09-11 (one round, findings-only)

| ID | Sev | Finding | Outcome |
|---|---|---|---|
| F1 | P0 | "one web search" is not enforceable | Accepted: one *call*; Exa, small result cap, short prompt, deadline, `webSearches` alarm |
| F2 | P1 | citing blocks unrecoverable from plain text | Accepted: `{block, quote}` verified by `findQuote`; footnote markers expanded in code |
| F3 | P1 | first external href picks the wrong work | Accepted: DOI → arXiv → unique title-matching anchor → unique mention anchor → search |
| F4 | P1 | a found URL need not be the cited work | Accepted: Exa, annotation URL/title only, title match required, else nothing stored |
| F5 | P1 | the cap does not give "a link to all of them" | Overruled (Fable arbitrated): the brief authorises it; `capped` reported by the model, honest foot sentence, coverage witness logged |
| F6 | P1 | ids, dedupe and lookup survival unspecified | Accepted: code-minted ids, dedupe key, id inheritance, lookups keyed on id |
| F7 | P2 | passage navigation is unrequested scope | Accepted: first-cited jump only; selection and marks deferred |
| F8 | P2 | new-mode.md residue not named | Accepted: listed in stage 2 |
| F9 | P2 | the product hides a central obscure work | Accepted: `(2r + i) / 3` |
| F10 | P2 | no budget design | Accepted: field caps, explicit estimate, headroom measured in stage 1 |

## Progress

- 2026-09-11 — plan written (`1cd148ca`); Sol plan review, verdict no-ship as written; revised.
- 2026-09-11 — **stage 1 built** (server: types, step, migration `20260911220212_citations`, route,
  export, `tests/citations.test.ts`), not yet committed. Real runs through `scripts/stage.ts`, local
  database, `claude-sonnet-5` at `medium`, budget `400 + 80 × 350` = 28,400 answer + 40,000 headroom:

  | Article | prompt | works | capped | doi / arxiv / article / search | unquoted / relocated / unanchored | notes reached | out tokens |
  |---|---|---|---|---|---|---|---|
  | scaling-hypothesis | /1 | 57 | no | 0 / 12 / 17 / 28 | 25 / – / 21 | 9 of 34 | 11,034 |
  | scaling-hypothesis | /2 | 58 | no | 1 / 19 / 11 / 27 | 3 / 3 / 2 | 6 of 34 | 8,254 |
  | spider-silk | /1 | 80 | yes (100 returned) | 58 / 0 / 10 / 12 | 9 / – / 0 | 75 of 132 | 19,421 |
  | spider-silk | /2 | 80 | yes (87 returned) | 55 / 0 / 11 / 14 | 9 / 3 / 1 | 72 of 132 | 18,122 |
  | antikythera | /1 | 46 | no | 20 / 4 / 17 / 5 | 4 / – / 1 | 40 of 122 | 11,433 |
  | openai-huggingface | /1 | 8 | no | 0 / 0 / 1 / 7 | 3 / – / 0 | 0 of 1 | 2,045 |

  What the runs changed: `/1` → `/2` forbids `"..."` in a quote (the commonest failure); code now
  relocates a quote found verbatim in exactly one other block; past the cap the highest-relevance
  works are kept rather than the model's first 80; rule 4 needs the anchor to be most of the quote and
  refuses a Wikipedia page whose text does not name the title (it had linked works to *Toughness*,
  *Heron of Alexandria*, *Pappus of Alexandria*, *Atomic force microscopy*). Headroom: the worst
  output was 19,421 of 68,400. `replication-crisis` belongs to another owner locally and was not run,
  so the 800-note case is measured only by spider silk's 132.

  **Default bar for prioritised `(2r + i) / 3`: 0.40.** On the `/1` runs the median was 0.37 on both
  long articles (p75 0.40–0.43) and 0.48 on the blog; 0.40 shows about half of a long list (23 of 57,
  39 of 80) and 6 of 8 on the short one; 0.50 would show 9, 13 and 4.
