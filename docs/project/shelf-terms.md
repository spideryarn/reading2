# Shelf topics

Parent: [reading-view-overview.md](reading-view-overview.md), beside [library.md](library.md).

A row of **topics** above the shelf — short phrases like *neural networks*, *consciousness*,
*Indigenous*, each with a count. Choose one and the shelf narrows to the articles that are about it;
choose a second and it narrows to articles about both. **A program proposes the topics and a model
judges them**: the program finds the phrases the articles actually use and counts which articles
each reaches; since 2026-09-29 GPT-6 Luna scores those candidates for this reader, and the program
chooses from the scores. With no model answer yet, the row is the program's alone — the same shelf
always gives the same topics, it costs nothing, and it takes milliseconds.
[§ The model's judgement](#the-models-judgement) is how the two fit.

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

## The model's judgement

> I'm still not that happy with the suggestions that are being generated. They're just not that
> meaningful/relevant (e.g. "food", "female", "bowl" has little to do with my real topics
> (computational neuroscience, consciousness, Buddhism, AI). […] I'd still rather this was
> free/very cheap.
>
> — Greg, 2026-09-29

**The program proposes, a model disposes.** Step 2 above still runs on every request. On top of it,
GPT-6 Luna is shown the shelf — each read article's title (the reader's rename wins) and its
one-sentence gist, and the reader's profile if they wrote one — and up to 80 of the program's
candidates, each with how many articles it reaches and three example titles, and scores each 0–3
against one anchored rubric. The scores go back into the **same** greedy as its quality
(`ChooseOptions.quality`), so coverage, the redundancy skips and the neighbour rule stay ours and the
model never invents a label. Chosen by an eval over nine shelves with blind judges — scores beat the
program's list 9–0, and beat asking the model for an order once every topic's member titles were
visible: plan [260929c](../plans/260929c-shelf-topics-chosen-by-a-model.md) § Stage 1.

- **Stored per owner and scope** (`active`, or `all` with `?archived=1`) in `shelf_topic_scores`,
  with a hash of exactly what the model was shown: the messages, the prompt version and the model.
- **A stored row is used whether or not it is current.** Its scored keys take their score and **a key
  it did not score is left out**, as in the eval — which is what keeps *food* and *bowl* out. If that
  leaves no topics (a row from a very different shelf), the program's list is used. `chosenBy` in the
  response says which.
- **What triggers a refresh**: the hash differing from the stored row's — an article added, removed,
  re-extracted, renamed, re-gisted, the profile edited — and only once nothing is `pending`, so the
  model sees complete candidates. Archiving or restoring moves the `active` scope's hash and not the
  `all` scope's. Search, sort, Unread and reading position never reach the server's input, so they
  never refresh anything.
- **The answer goes first.** The route sends the program's list (or the stored pick) with
  `refreshing: true`, then awaits the model before its handler returns, so the spend lands in the
  request's own collector against the reader — job `shelf-topics`,
  [ai-gateway.md](ai-gateway.md). The client asks again every 8 s, at most four times, and the
  model's pick appears without a reload.
- **One refresh at a time, and never a storm.** One statement claims the refresh for
  (owner, scope, input) with a 90-second lease; the write lands only if the claim is still ours. A
  failure — a refusal, a timeout, an answer with a score outside 0–3 — counts, and pushes the next
  attempt out (2, 8, 32, 128 minutes, then six hours); the stored row, if any, keeps being used.
  Then a per-owner allowance — 12 an hour, 40 a day — and a global fuse of 3,000 a day, from the
  rate limiter [link hover cards](links.md) already use.
- **Cost**: about $0.001 a refresh (≈2–5k tokens in, 1–2k out incl. reasoning, 6–20 s), paid when the
  shelf changes rather than when anybody loads it. **Not** the ingest quota
  ([billing.md](billing.md)): that counts articles, and this is reading-aid spend like a link card.
- **Fallback**: no key, no row yet, a failed call — the program's list, silently to the reader and
  loudly in the log (never with a title, gist, label or the profile in it).

The reader's titles, gists and profile going to OpenAI via OpenRouter is on
[/privacy](privacy.md).

## The count: one formula

```
visible = scope ∩ search ∩ Unread ∩ every chosen topic
a chip's count = |visible ∩ its articles|
```

So a chosen chip's count equals the number of articles shown, and the "n of m" line is the same
number. Counts are **physical articles**, never grouped works: six copies are six cards and a count
of six. The tooltip gives both denominators — *"2 match this view · 7 of 38 on the shelf"* — so a
chip reading 2 over a card saying 7 explains itself (GPT Sol, F11).

**One narrowing function over one list**, in the order scope → search → Unread → topics, and it runs
above the cards/table branch, so both views obey it with no second list (Sol, F6).

## A topic with nothing to show is not drawn

> On the Homepage Shelf, if I pick one of the faceted-search-topic-pills, it should hide (or shunt to
> the right) any topic-pills that match 0 of the filtered articles on the shelf, i.e. so it's easier
> to pick a topic-pill and then immediately see which other topic-pills will help filter further
> (and not be distracted by topic pills that will lead to empty results).
>
> — Greg, 2026-09-29

An unchosen topic whose live count is 0 is **hidden**, in the pill row and in More detail alike —
whatever made it zero: a chosen topic, the search box, Unread. **Hidden rather than shunted**: the
row is for choosing the next filter, and a chip that leads to an empty shelf is noise. A **chosen**
topic stays at zero, or it could not be removed. Until 2026-09-29 such a chip was greyed and
disabled in place, on the argument that a row reshuffling under the pointer is worse than a dead
chip; Greg's report weighed it the other way. The order is still the server's rank order — the
survivors keep their places relative to each other, and each keeps its colour.

**The zeros go first, then the first twelve** (`availableTopics` in
[`shelf-narrow.ts`](../../src/web/shelf-narrow.ts); GPT Sol R5 on plan
[260929a](../plans/260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle.md)):
taking twelve and then dropping zeros would leave the row short with live pills waiting beyond it.
*"All N topics"* counts the pills it would show, not every topic the server chose.

## Archived

> On the Homepage Shelf, we have a "Show/hide archived" toggle at the very bottom.
>
> I think it would be better if it was a (default-hide-archived) toggle at the top (like for
> "Unread"), so that it's easy to show some/all (so we can use the faceted-search-topic-pills and/or
> sort to look through the Archived articles easily too).
>
> — Greg, 2026-09-29

The switch is the **Include archived** chip beside **Unread**, off by default, and its state is in the URL as
`?archived=1`. When on, topics are chosen over active **and** archived articles, and the archived
articles **join the shelf's one list** — sorted with everything else, narrowed by search, Unread and
topics, counted in "n of m", each marked *Archived* and offering **Put back** where Archive would be
([library.md § Archive](library.md#archive-and-undo-is-the-confirmation)). One list rather than a
second section at the foot is what lets sort and topics work across both, which is what Greg asked
for. The count line names both halves — *"4 of 41 articles (3 active + 1 archived)"*. Passage search
covers the archived articles too since 2026-09-30, each passage marked
([library.md § Archive](library.md#archive-and-undo-is-the-confirmation); plan 260930d).

While the archive is loading or has failed, topics wait (the question includes the archive, and it
has not arrived) but the active rows stay painted. **Offline, topics are unavailable** — the terms
route is not cached — which is the accepted limit.

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

## Colour says which topics are related

> It strikes me that it would actually be great if they were coloured semantically somehow. […]
> Then you would naturally find that similar topics would get similar colours, and it would be
> easier to see which topics are related and which stand out.
>
> — Greg, 2026-09-29

**Topics that pick out the same articles get neighbouring hues**, and a topic that shares nothing
with the rest gets a hue of its own. It is worked out in the browser from the member lists the route
already sends, with no model and nothing stored
([`topic-colour.ts`](../../src/web/topic-colour.ts)):

1. Two topics are close when their article sets overlap: binary cosine, `|A∩B| / √(|A|·|B|)`.
2. Average-link clustering puts them in a line with related topics side by side. At each join the
   half holding the better server rank goes first, so the top topic is always at the red end.
3. The gap between neighbours grows with how far apart they were when joined, so a cluster packs
   into a few shades and unrelated topics spread across the arc. Then each topic takes the nearest
   of the 32 stops on the hue ring, red to violet at one lightness
   ([colour-scales.md § Hue ring](colour-scales.md#hue-ring)).

It is computed over **every topic the server chose, from their full member lists**, never the live
counts, so a colour does not move as you choose topics, search or hide zeros. It is the same on every
reload and changes when the topics or their articles do. The same colour is the dot on its pill and
the swatch and bar on its row. Why a dendrogram's order and not MDS, which was Greg's suggestion: plan
[260930b](../plans/260930b-shelf-topic-colours-by-relatedness.md).

**The colour is a supplementary cue, not the only carrier.** The label is always drawn and swatches
and bars are `aria-hidden`, so every topic works without its colour. But relatedness itself is carried
only by hue, and the ring is not colour-blind safe, so a reader who cannot see hue differences loses
that signal. Copies of one work count as separate articles here, as the counts do, so they can
strengthen an apparent overlap that the chooser treats as one work.

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
| the model's prompt, the input hash, the strict parser, the one call; `SHELF_TOPICS_PROMPT_VERSION` | [`src/shelf-terms/model-scores.ts`](../../src/shelf-terms/model-scores.ts) |
| stored scores applied, the claim, the refresh after the answer, the allowance | [`src/shelf-topics.ts`](../../src/shelf-topics.ts) |
| storage, the owner-scoped set, the bounded fill; the `shelf_topic_scores` row and its claim | [`src/store/pg-shelf-terms.ts`](../../src/store/pg-shelf-terms.ts) |
| `GET /api/library/terms` (`?archived=1` for active + archived), `private, no-store` | [`src/routes.ts`](../../src/routes.ts); the shape is `LibraryTermsResponse` in [`src/types.ts`](../../src/types.ts) |
| the fetch, the ask-again loop, which URL keys apply | [`src/web/useShelfTerms.ts`](../../src/web/useShelfTerms.ts) |
| the narrowing and the count formula, pure | [`src/web/shelf-narrow.ts`](../../src/web/shelf-narrow.ts) |
| the row: the two views, "All N topics", the More-detail toggle and `?topicsView` | [`src/web/ShelfTerms.tsx`](../../src/web/ShelfTerms.tsx) |
| one topic's chip and its tooltip, shared by both views; `topArticles` (one per title) | [`src/web/ShelfTermChip.tsx`](../../src/web/ShelfTermChip.tsx) |
| the More-detail rows: swatch, chip, count bar, links | [`src/web/ShelfTermsDetail.tsx`](../../src/web/ShelfTermsDetail.tsx) |
| a topic's colour from the articles it shares with the others | [`src/web/topic-colour.ts`](../../src/web/topic-colour.ts) |
| where it is wired into the page | [`src/web/Library.tsx`](../../src/web/Library.tsx) |

## Measuring a real shelf

`npm run shelf-terms:report -- --owner <uuid>` (add `--archived` for active + archived) computes
everything **in memory and writes nothing** — not even the candidate cache the route fills — and
prints the target database, the scope, coverage and overlap at K = 20, 30 and 40, the topic list and
the articles no topic covers. Greg's shelf is in production, which the box cannot read, so to measure
it Greg runs it with his owner uuid and the production `DATABASE_URL` in the shell (which wins over
`.env.local`), and reads the `Target:` line before the numbers.

## What v1 does not do

- No embeddings, no clustering library (the colours' clustering is thirty lines of our own); the
  one model call judges candidates and never writes one.
- No editing of topics — hide, rename or pin. Zotero-style "hide this automatic tag" is the obvious v2.
- The generic-word list is hand-written, so weak topics such as *window* and *message* survive.
- Near-synonyms (*neural nets* / *neural networks*) can both appear, and near-copies of one article
  that differ by a few words are separate works (exact-hash grouping only).
- English only; other-language articles are skipped and counted.
- The public shelf (`/read/public`) gets nothing.
