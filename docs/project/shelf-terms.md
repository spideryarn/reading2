# Shelf topics

Parent: [reading-view-overview.md](reading-view-overview.md), beside [library.md](library.md).

A row of **topics** above the shelf — short phrases like *neural networks*, *consciousness*,
*Indigenous*, each with a count. Choose one and the shelf narrows to the articles that are about it;
choose a second and it narrows to articles about both. The topics are picked by a program, not a
model: the same shelf always gives the same topics, it costs nothing, and it takes milliseconds.

> Delegate to a new agent that does some simple keyword/clustering on the articles in my shelf so I
> can easily filter to different kinds of article. It should choose terms that somehow enable me to
> filter overlapping subsets (and ideally cover pretty much all of the articles in some form).
> Ideally this would use code/algorithms that can run without an LLM, so that it's fast and cheap
> and can be re-run repeatably […]
>
> — Greg, 2026-09-28

The design, the measurements and every decision are in the plan,
[260928a-shelf-facet-terms.md](../plans/260928a-shelf-facet-terms.md); the research behind it (the
algorithms, the libraries, other tools' interfaces, the dead ends) is
[260928a-shelf-facet-terms-algorithms-and-ui.md](../research/260928a-shelf-facet-terms-algorithms-and-ui.md).
This doc is what you need to work on it.

## Two steps, and only the first is stored

1. **Per article, once: candidate phrases.** The current revision's prose — no footnotes, code,
   tables, or anything under a back-matter heading such as *References* — is cut into 1–3-word
   phrases at stopwords and punctuation, and the top ~200 are kept with their counts. Stored in
   `revision_phrase_runs`, one row per `(revision, extractor_version)`, so it is recomputed only
   when the article gets a new revision or `EXTRACTOR_VERSION` goes up. English only: an article
   that fails the English check is stored as skipped, with no candidates.
2. **Per shelf, every time it is asked: choose the topics.** From the reader's own candidates, about
   30 phrases that together cover nearly every article while overlapping — a greedy cover that
   discounts, rather than removes, articles already covered. Exact copies of one text count as one
   work, so five copies cannot make a five-article topic. **No topics below eight distinct works**,
   and the row says so rather than disappearing.

The route fills missing candidates **within a time budget** and answers `pending` with how many are
still unread; the client shows what it has, says *"Reading N more articles…"*, and asks again. The
server always reads at least one article per request, so the loop cannot spin.

## The count: one formula

```
visible = scope ∩ search ∩ Unread ∩ every chosen topic
a chip's count = |visible ∩ its articles|
```

So a chosen chip's count equals the number of articles shown, and the "n of m" line is the same
number. Counts are **physical articles**, never grouped works: six copies are six cards and a count
of six. An unchosen chip at zero is greyed and disabled in place; a chosen one at zero stays
pressable, or it could not be removed. The tooltip gives both denominators — *"2 match this view ·
7 of 38 on the shelf"* — so a chip reading 2 over a card saying 7 explains itself (GPT Sol, F11).

**One narrowing function for both lists**, in the order scope → search → Unread → topics, and it runs
above the cards/table branch, so both views obey it with no second list (Sol, F6).

## Archived

The shelf's existing **Show archived** control is the switch, and its state is in the URL as
`?archived=1`. When on, topics are chosen over active **and** archived articles, and the archived list
is narrowed by the same function — search and Unread included. That is why the archived list now
stays visible during a search, where until 2026-09-28 it disappeared: the search did not look in it,
so it could only have been wrong. The count line names both halves — *"4 of 41 articles (3 active + 1
archived)"*. Passage search still covers active articles only. Reusing the existing control rather
than adding a second switch is an **assumption pending Greg** (plan § Assumptions pending Greg).

## Two views: pills, and More detail

> - the "All N topics" should show all the terms, without changing the nature of their display
> - then there should be a different way to show "More detail" or similar, that turns them into
>   per-row-with-extra-detail rather than pills-on-the-same-row
>
> — Greg, 2026-09-28

- **Pills**, the default: the first twelve topics in the server's rank order, plus any chosen one
  further down, in its own place — never re-sorted by count, so nothing moves when you press one.
  **"All N topics"** expands the same row to every pill; it is shown only when there are more than
  twelve.
- **More detail** (`?topicsView=detail`): every topic, in rank order, one compact row each — a colour
  swatch, the chip, a bar for its live count (relative to the largest count shown, so the bars line
  up in one column and compare at a glance), *"7 of 38 on the shelf"*, and the three articles that
  use it most, as links. The chip in a row **is** the pill (`TermChip`): the same toggle, the same
  `aria-pressed`, the same tooltip. The toggle between the views stays in one place, so focus stays
  on it. Chosen over cards and two-line rows from screenshots, plan
  [260928d](../plans/260928d-shelf-topics-diversity-coverage-and-detail-view.md) § Stage 2.

**Colour is decoration, keyed to rank**: a topic's colour is its position in the server's order
mapped onto the categorical palette ([colour-scales.md](colour-scales.md)) — the seven colour-blind-safe
hues first, the neutral grey skipped, repeating after fifteen. The same colour is the dot on its pill
and the swatch on its row. Stable across reloads; it changes when the shelf changes enough to re-rank
the topic. The label is always drawn, and swatches and bars are `aria-hidden`.

**Titles, not copies.** A row and a tooltip name articles **one per title** — the first slug of each —
so three copies of one piece are named once. Only the naming is deduplicated; every count stays
physical ([§ The count](#the-count-one-formula)).

## Touch

The shared `Tooltip` opens on hover and focus, not on a tap, and a chip cannot both toggle and hold a
card open on one tap (Sol, F5). So a tap toggles, and **More detail** writes into each row what the
tooltip would have said — the count, how many on the shelf use it, and the articles that use it most.
That is Greg's *"each filter-term gets its own row with extra metadata"*, and the phone's way to what a
mouse gets from hovering.

## The URL

`?topics=<key>,<key>` (push), `?archived=1` (push) and `?topicsView=detail` (push, absent means
pills) — [url-state.md](url-state.md). A key is the
lowercased, plural-folded phrase, so it survives a label changing surface form. A key in the URL that
is not among the topics is **never applied while they load** — so a stale link cannot flash an empty
shelf — and is **dropped, with `replace`, once an answer arrives with nothing pending**. Not before:
while articles are still being read, a topic can be absent from one answer and present in the next.

## Where the code is

| What | Where |
|---|---|
| extracting candidates; the English check; `EXTRACTOR_VERSION` | [`src/shelf-terms/extract.ts`](../../src/shelf-terms/extract.ts) |
| choosing topics; `shelfTermMetrics` (coverage, overlap, redundancy — the one definition) | [`src/shelf-terms/choose.ts`](../../src/shelf-terms/choose.ts) |
| storage, the owner-scoped set, the bounded fill | [`src/store/pg-shelf-terms.ts`](../../src/store/pg-shelf-terms.ts) |
| `GET /api/library/terms` (`?archived=1` for active + archived), `private, no-store` | [`src/routes.ts`](../../src/routes.ts); the shape is `LibraryTermsResponse` in [`src/types.ts`](../../src/types.ts) |
| the fetch, the ask-again loop, which URL keys apply | [`src/web/useShelfTerms.ts`](../../src/web/useShelfTerms.ts) |
| the narrowing and the count formula, pure | [`src/web/shelf-narrow.ts`](../../src/web/shelf-narrow.ts) |
| the row: the two views, "All N topics", the More-detail toggle and `?topicsView` | [`src/web/ShelfTerms.tsx`](../../src/web/ShelfTerms.tsx) |
| one topic's chip and its tooltip, shared by both views; `topArticles` (one per title) | [`src/web/ShelfTermChip.tsx`](../../src/web/ShelfTermChip.tsx) |
| the More-detail rows: swatch, chip, count bar, links | [`src/web/ShelfTermsDetail.tsx`](../../src/web/ShelfTermsDetail.tsx) |
| a topic's colour from its rank | [`src/web/topic-colour.ts`](../../src/web/topic-colour.ts) |
| where it is wired into the page | [`src/web/Library.tsx`](../../src/web/Library.tsx) |

## Measuring a real shelf

`npm run shelf-terms:report -- --owner <uuid>` (add `--archived` for active + archived) computes
everything **in memory and writes nothing** — not even the candidate cache the route fills — and
prints the target database, the scope, coverage and overlap at K = 20, 30 and 40, the topic list and
the articles no topic covers. Greg's shelf is in production, which the box cannot read, so to measure
it Greg runs it with his owner uuid and the production `DATABASE_URL` in the shell (which wins over
`.env.local`), and reads the `Target:` line before the numbers.

## What v1 does not do

- No LLM, no embeddings, no clustering library.
- No editing of topics — hide, rename or pin. Zotero-style "hide this automatic tag" is the obvious v2.
- The generic-word list is hand-written, so weak topics such as *window* and *message* survive.
- Near-synonyms (*neural nets* / *neural networks*) can both appear, and near-copies of one article
  that differ by a few words are separate works (exact-hash grouping only).
- English only; other-language articles are skipped and counted.
- The public shelf (`/read/public`) gets nothing.
