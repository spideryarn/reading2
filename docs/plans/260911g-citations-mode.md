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
- 2026-09-11 — **stage 1 committed and pushed, `85631f9b`.** Full suite: 1089 of 1097 files green;
  the reds were `cold-start-lazy-imports`, `pdf-bundle-trace` and three fleet files (no build in a
  fresh worktree), knip (the migration not yet committed — green after), and `doc-links` (an anchor in
  this plan — fixed).

- 2026-09-12 — **stage 2 built** (the mode, owner-only, behind the switch). Two departures from
  this plan, both right: the URL keys are `?citeby=` / `?citebar=`, because `Reader` reads `?gate=`
  in every mode and a shared key would carry a citations bar into the Glossary; and the row draws
  relevance and influence as `ScoreBars`, not `rel·NN inf·NN`, because Greg asked on 2026-08-31 for
  bars with the numbers in a tooltip in the Glossary *"and so on"*. The step's budget went from a
  guessed 240 s to 360 s from the six measured runs (17–154 s; a full 80-work answer is ~225 s).
  A browser check (Playwright, local, as the owner) passed all eight points — the button only with
  the switch on, 20 of 80 shown at the 0.40 bar on spider silk, the four orders, 55 DOI / 11 article
  / 14 search links with search rows' titles not linked, a DOI opening in a new tab, the first-cited
  jump landing, the capped sentence only where capped, no horizontal scroll at 400px — and opening
  the mode started no job. What it found a reader would trip on, and what was done:
  - *the foot ran into the last row* — a rule above it;
  - *"Find them again" was the largest control in the band* and the one that costs money — removed
    from the ordinary foot, kept in the stale and outdated banners, as Greg did in Glossary and Quotes;
  - *a title that is only a citation* ("Thompson et al 2020", then "Thompson et al · 2020") — left:
    a prompt tweak, not worth a bump on its own;
  - *"first cited p263u9" is a bare block id* — left: it is the house block-link form;
  - *the bar filters only prioritised* — left: the Glossary's rule.

- 2026-09-12 — **stage 3 built: Find it on the web.** `POST /api/citations/:slug/:id/find`, job
  `citations-find`, chat wire, Exa, `max_total_results: 5`, a one-search prompt, a 60 s deadline;
  kept only when the model's pick is one of the call's own result URLs and that result names the
  work; the stored url and title are the result's. Table `citation_finds` (two additive migrations,
  the owner foreign key by hand), read back onto `search` rows only, in both exports. Only a
  `search` row can be looked up (409 otherwise); a no-match is not stored. One real call, spider
  silk, Knight & Vollrath 1999: 5.8 s, **1 billed search**, $0.0216, kept
  `doi.org/10.1098/rspb.1999.0667`; `web_searches: 1` on the ledger row. Fourteen tests went red when
  the rules were broken on purpose.

  **Observed, not chased: the ledger says `upstream: "OpenAI"`** for that call's
  `anthropic/claude-sonnet-5`, under `order: ["anthropic"], require_parameters: true`. It is not new:
  every local `debate` row (11) and `referee-candidates` row (9) says the same, and those are the
  other two jobs that search with Exa, while every non-Exa chat-wire Claude row says `Anthropic`. So
  it follows the Exa engine rather than this route — how OpenRouter reports or routes an Exa-backed
  call — and belongs to [ai-gateway.md](../project/ai-gateway.md), not to this mode. Named for the
  owed code review.

- 2026-09-12 — **stage 3's full suite found four reds its focused run did not**: the new
  `SPIDERYARN_CITATIONS_FIND_MODEL` was in no environment door (`env-names-are-inventoried`,
  `env-reads-are-literal`) — removed, `citations-find` has no override, like `citations`; and the new
  table was missing from `db-schema-drift`'s pinned list and count and from `store-shelf-pg`'s
  every-foreign-key seed. All four green after; the other reds were the fresh-worktree five.

### Owed reviews (GPT Sol held until 2026-09-15 01:23Z; the window reset early, 2026-09-12)

One combined findings-only review over all four commits, 2026-09-12 (queue `qi-jggq8dkw`):
prompt [260911g-citations-mode-code-review-prompt.md](260911g-citations-mode-code-review-prompt.md),
answer [260911g-citations-mode-code-review-sol.md](260911g-citations-mode-code-review-sol.md)
(`gpt-5.6-sol`, high, `--sandbox review`, on the subscription — not a fallback self-review), the
tests it was handed [260911g-citations-mode-owed-review-test-results.txt](260911g-citations-mode-owed-review-test-results.txt)
(10 files, 551 tests, green against the local database). Verdict *do not ship*, on F11–F14.

| Stage | Commits | Status |
|---|---|---|
| 1 — artefact, step, route | `85631f9b` | reviewed twice — F13 fixed, F15 open (P2) |
| 2 — the mode (client) | `abde65f7` | reviewed twice — F14 fixed (`ba7b6f48`), F17 fixed |
| 3 — Find it on the web | `1e54a7f8`, `8d523739` | reviewed twice — F11 fixed, F12 for Greg, F16 open (P2) |

The first review's fixes are one commit on `dev`, **`f391929b`** — F11, F13, and the
`models.test.ts` red below. The second review is
[§ Second code review](#second-code-review).

### Code-review ledger — GPT Sol, 2026-09-12 (findings-only; IDs continue the plan review's)

| ID | Sev (Sol → ours) | Finding | Outcome |
|---|---|---|---|
| F11 | P0 → P0 | the paid POST has no admission control; a no-match stores nothing, so one row can be pressed for ever | **Fixed.** Checked: true, and the route's *"there is none to reuse"* was stale — `fetchAllowanceStore` has spent money for `link-summary-fill` since 2026-09-05. New `citation-find` bucket (migration `20260912091147_citation_find_rate_bucket`, widening the CHECK), `FIND_RATE_POLICY` 2 at once / 20 an hour / 60 a day / 600 global a day, taken after the 404 and 409, `finish` in `finally`, 429 / 429 / 503 in three sentences. Red first: five tests in `tests/citation-find.test.ts`. The numbers are guesses, like `SUMMARY_RATE_POLICY`'s |
| F12 | P1 → **for Greg** | a review page passes as the work's own page: `pageNamesTitle` accepts a result whose title approximately names the work, or whose excerpt carries the title as a run | **Not fixed — a product trade-off.** The finding is true (Sol's harness keeps `blog.example/review` titled *"Scaling Laws … — a review"* when the model picks it; the prompt forbids that pick, code does not). Sol's fix — accept only `doi.org` / `arxiv.org` results — gives up the publisher pages, author copies and PDFs the prompt asks for and the plan's F4 (Sol's own) accepted. What the reader sees today is honest about provenance: *found on the web · host*. The choice between them is below, under *For Greg* |
| F13 | P1 → P1 | the 80-work cap ran before the two dedupe passes, so duplicates could crowd distinct works out and the foot claim *"these are the 80"* over fewer | **Fixed.** Confirmed with Sol's case (80 copies + one distinct → one row, `capped: true`). The cut moved from `toDrafts` to `keepLeanedOnMost`, after both folds. Red first: `tests/citations.test.ts` § the cap. The copy change Sol proposed is not needed once the count is of works |
| F14 | P1 → P2 | a find is not fenced to the snapshot it searched: a re-run landing mid-find leaves a `citation_finds` row for a row that is now a DOI, and the client overwrites that DOI with the web page until reload | **Client half fixed, `ba7b6f48`** (2026-09-12, queue `qi-jd6xwmme`): `find` patches only a row that is still `search`. Red first: `tests/citations-find-late-reply.test.tsx` holds the find's reply, lands the re-run through `onFinished`, and saw `web` where `doi` belonged; its sibling keeps a still-searched row patched. **Server half left as it is, and the second review agrees:** `attachFinds` upgrades only `search` rows, and a search → DOI → search round trip does not keep one id, because the dedupe key goes `work:…` → `doi:…` → `work:…`, so a stale find does not come back on its own |
| F15 | P2 → P2 | link-producing HTML is not in the freshness fingerprint, so an href-only edit leaves an old link marked fresh | **Open, P2.** Already recorded as a gap in the source; the fix is a hash over each block's external URL attributes in `sourceHash` |
| F16 | P2 → P2 | `citation_finds.owner_id` is not tied to the article's owner; reads join on article only | **Open, P2, latent.** There is no ownership transfer; `glossary_lookups` has the same shape. If one is ever built, a composite FK to `articles(id, owner_id)` or an explicit move of the finds in the same transaction |

**A red on `dev` the review did not name, fixed with it:** `tests/models.test.ts` (*"has an
override variable decided for every task"*) failed on `dev` alone since `8d523739`, reported by the
Overseer. That commit quieted `env-names-are-inventoried` by setting `citations-find`'s override to
`null`, but every chat-wire task must have one (`REQUEST_PATH_TASKS` is derived from `TASK_WIRE`;
`debate` has one on the same grounds). `SPIDERYARN_CITATIONS_FIND_MODEL` is restored, allowlisted in
the inventory's group of comparison-run names, and given its row in
[setup-dev.md](../project/setup-dev.md). Stage 3's full-suite note above missed it because the
suite's reds were read as the fresh-worktree set.

**Wider, noticed and not fixed here:** the glossary's `ask` route's header in `src/routes.ts`
still says *"No rate limit, and there is none to reuse"*, and that it and its sibling `lookup` both
drive paid calls unbounded. The second half of that sentence has been false since 2026-09-05; the
same bucket-and-policy shape would bound both. Outside this mode, so left for whoever owns them.

### Second code review

GPT Sol, 2026-09-12, write-capable. Asked for by Greg, 2026-09-12 10:30Z: *"Get GPT Sol review for Citations mode if possible."* Over
the whole mode as it stands on `dev` — the six commits `85631f9b` … `ba7b6f48` and the four
migrations — with the question put as a conclusion: *is it safe to sit on `dev` behind the
experimental switch and ride the next deploy?* Prompt
[260911g-citations-mode-code-review-2-prompt.md](260911g-citations-mode-code-review-2-prompt.md),
answer [260911g-citations-mode-code-review-2-sol.md](260911g-citations-mode-code-review-2-sol.md)
(`gpt-5.6-sol`, high, `--sandbox workspace-write`, on the subscription), the tests it was handed
[260911g-citations-mode-code-review-2-test-results.txt](260911g-citations-mode-code-review-2-test-results.txt)
(14 files, 595 tests, green against the local database at `ba7b6f48`).

**Verdict: safe after the fixes applied here** — *"the deciding point is that F11 is genuinely
closed: no Citations paid call can begin without an atomic, bounded per-owner and global
allowance."* It also checked the four migrations for a populated production database: a nullable
column, new tables, and two CHECKs widened to strict supersets of their old values, applied in one
transaction; the owner FK lands while `citation_finds` is empty.

| ID | Sev | Finding | Outcome |
|---|---|---|---|
| F17 | P3 | the *Find it* tooltip and the mode card promised *"one web search"*; the bound is one call, and the provider may search several times inside it (the plan's F1) | **Fixed.** Sol reworded both to *"one search-backed model call"*, red first; we kept the finding and replaced the words with plain ones a reader can follow — *"Searches the web for this work …"*, no count promised — and made its test refuse both the count and *"model call"*. Two internal notes with the same claim (`src/store/index.ts`, setup-dev.md) corrected with it |
| F11 | — | re-checked | Fixed correctly: every paid call takes the allowance before `callOnce`; the `finally` releases the lease after a provider error, the 60 s abort and a client disconnect; bucket name agrees in code, CHECK, snapshot and tests |
| F12 | — | re-checked | Still true, and **does not change the verdict**: the URL is always one of the call's own annotations, never model-written, and the host is on the row. Stays Greg's, default unchanged |
| F13 | — | re-checked | Fixed correctly |
| F14 | — | re-checked | Fixed sufficiently (client, `ba7b6f48`); a conditional server write would be tidying, not safety |
| F15 | — | re-checked | Rightly open at P2 — not a migration, ownership, spend or deploy blocker |
| F16 | — | re-checked | Rightly latent at P2 — every read and write finds the article through the signed-in owner; no production ownership transfer exists |

**Wider, reported not fixed:** the glossary's `ask` and `lookup` routes still have no spend limit —
already known (above), outside this mode, and not made worse by this deploy.

### For Greg — F12, what counts as a work's own page

*Find it* runs one web search for a work the article gave no link for, and keeps a result if the
model picked it **and** code sees the result's title (or opening text) naming the work. A review
or a reading-list page whose title repeats the work's title passes that check if the model picks
it, though the prompt tells it not to. The row would then say *found on the web · blog.example*
and link to the review.

- **Keep it as it is.** Publisher pages, author copies and PDFs all stay findable. A wrong pick is
  possible, shown with its host, and needs the model to disobey the prompt.
- **Only DOI and arXiv results** (Sol's fix). Nothing but a work's canonical address is ever kept,
  and far fewer works are found — most books, reports and blog-published work have neither.
- **In between:** drop the opening-text match and keep the title match, so a page that only quotes
  the title in its text is refused. Narrows the hole without closing it.

Recommendation: keep it for v1 — it is behind the experimental switch and owner-only, and the host
is on the row — and revisit with real finds in the ledger.
