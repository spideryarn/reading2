# Shelf topics

Parent: [reading-view-overview.md](reading-view-overview.md), beside [library.md](library.md).

A row of **topics** above the shelf, each with a count. Choose one and the shelf narrows to the
articles in it; choose a second and it narrows to articles in both. **Since 2026-10-03 a model names
the topics**, as the subjects a reader would file under, broad to fine: *Neuroscience*, and inside it
*Vision*, and inside that *Retinotopy*. Broad ones come first, and choosing one brings its finer
topics forward. New articles are sorted in by themselves. **The tree is worked out for shelves of
up to 150 works**; a larger shelf is the queued next stage.
[§ Topics a model names](#topics-a-model-names-broad-to-fine) is how.

Before that the topics were phrases the articles literally use, found by a program and, from
2026-09-29, scored by a model. **That phrase row is still what a reader sees when there is no model
answer**: no key, a shelf under eight works or over 150 that never had a tree, or the minute before
a shelf's first topics land. It
costs nothing and the same shelf always gives the same phrases.
[§ Two steps](#two-steps-and-only-the-first-is-stored) is how that works.

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

## Topics a model names, broad to fine

> I look at the topics and they don't seem like high-level concepts that I would use to group and
> organize my articles myself if I was coming up with them. […] there's others like "principles" and
> "writers" that seem a bit generic/arbitrary.
>
> — Greg, 2026-09-30

> if I'm a neuroscience expert and I have a thousand neuroscience papers, and then a few others that
> are on a mix of topics like Buddhism and carpentry, for example, then, you know, I want
> neuroscience, Buddhism and carpentry as high-level categories, but then I also want a whole bunch,
> a crap load of fine-grained topic pills, you know, within those. […] the key thing is new papers
> and articles need to be included automatically. That shouldn't be something that the user has to
> do.
>
> — Greg, 2026-10-03

A phrase pill has to be a word the articles use, and no article about predictive coding says
"neuroscience", so the umbrella was never on offer. Now GPT-6 Luna reads each work's **title and
one-sentence summary** (the abstract, for a paper with no summary yet) and the reader's profile,
never the text, and writes the labels. The reasoning, Greg's full words, the eval and the cost are
in plan [261003f](../plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md).

**Two jobs.**

- **A re-think** builds the whole tree. One call asks for the shelf's broad subjects: the separate
  fields a librarian would make top-level sections, as many as the shelf really has, where a field
  most of the shelf belongs to is still one topic. Then every topic with twelve works or more is
  asked about again by itself for the finer topics inside it, and those again, to three levels. How
  many at each level follows how many works are there (about √n, between 3 and 20). It is due when
  there is no tree yet; when the prompt version, the model or the reader's profile changes; when
  the shelf has grown or shrunk by a quarter (and at least five works) since the last one; or when
  the works that fit no topic have grown by five and a tenth of the shelf since then.
  **Only up to 150 works** ([§ below](#the-150-work-cap)).
- **Filing** puts works that arrived since the last re-think into the existing tree: one small call,
  shown only the topic names. This is what makes a new article appear under its topics without
  anybody doing anything, and without paying for a re-think. A work that fits nothing is recorded as
  seen, and counts towards the next re-think. Until an article is sorted it is missing under a
  chosen topic, so the row says *Sorting N new articles into topics…* (`sorting` in the response).

**Each pill carries how broad it is, 0 to 1**: 0 for a broad subject, 0.5 inside one, 0.75 inside
that. It is the level, not the size: *Buddhism* with seven articles is as broad as *Neuroscience*
with 160. The row arrives broad first, then by how many articles.

**A name already taken.** A finer *Consciousness* inside *Neuroscience* is not made when a broader
topic is already called *Consciousness*: two pills of one name at different levels cannot be told
apart, and choosing the two existing pills together already narrows to those articles. When two
subjects each have a finer topic of one name (*Methods* inside *Neuroscience* and inside *AI*), both
are kept, the second with its parent's key in front of its own.

### The 150-work cap

A re-think is attempted only on a shelf of up to 150 distinct works (`MAX_WORKS` in
`src/shelf-topic-sets.ts`). Above it, a level would have to be named from a sample of its works, and
a subject with a handful of articles among a thousand would not be in the sample, so it would never
get a name: Greg's *Buddhism and carpentry* case, failing silently. And the dozens of calls it takes
could outlast the claim and the function. So a larger shelf keeps the tree it has, with new works
still filed into it, or the phrase row if it never had one. Naming from every chunk of the shelf,
and a re-think that can stop and resume, are queued; the sample-and-file path exists in
`model-topics.ts`, is unit-tested, and is not reached by the product.

**How a request runs** (`src/shelf-topic-sets.ts`):

- **One stored tree per reader**, over active and archived articles together (`shelf_topic_sets`):
  the topics, each article's topics, when it was last re-thought and last filed. Memberships are cut
  to the articles in view when it is read, so one tree serves the shelf with and without *Include
  archived*, and a topic with nothing in view is left out.
- **Exact copies are one work**: the model sees one line per work and every copy gets its topics.
  The free phrase reader supplies that exact-copy hash first, over active and archived together;
  no paid naming or filing starts while one is still missing. During that preparation, `pending`
  can count an archived article even in the active view, because the one stored tree spans both.
- **The answer goes first.** The route answers from the stored tree (or the phrase row, when there
  is none yet) with `refreshing: true`, then does whatever is due before its handler returns, so the
  spend lands against the reader: job `shelf-topics`, [ai-gateway.md](ai-gateway.md). The client
  asks again every 10 s for up to three minutes, so the result appears without a reload.
- **One piece of work at a time, decided under the claim.** One statement claims it with a
  ten-minute lease. What is due was decided from a read made before the claim, so under it the
  shelf, the row and the profile are read again and the decision made again; the write lands only if
  the claim is still ours. A failure counts and pushes the next attempt out (2, 8, 32, 128 minutes,
  then six hours); the stored tree keeps being used. A call for one subject's finer topics is tried
  twice, and if it fails twice the whole re-think fails: a tree stored with a branch missing would
  look complete. Then the per-reader allowance, 12 an hour and 40 a day, and a global fuse of 3,000
  a day.
- **Arrivals during a re-think are filed in the same handler**, after its write, rather than waiting
  for the browser to ask again. That drain takes a second claim and re-reads the row and shelf under
  it, so a request that slipped between the two claims cannot make it file old topic ids into a new
  tree.
- **Below eight works a stored tree is not shown**: the row behaves as it always has.
- **What is due is decided from counts of works, never from a hash of the prompt.** A re-think is
  shown the previous labels so it keeps the ones that still fit, and a hash over that would make
  every answer stale the moment it landed.
- **Cost**, measured 2026-10-03: a re-think was $0.005 for 96 articles and $0.016 for 150 (57 and 104
  seconds), so $0.00006 to $0.00012 an article; filing is about $0.00005 an article. With the cap a
  re-think is at most about two cents.
- **What bounds a hostile title.** It can steer a label or a membership on the shelf of the one
  reader who saved it, and no further: the call has no tools; the answer is a strict schema; a work
  or a topic is named only by an id the prompt showed; a label is one line of at most 40 characters
  with control characters removed and its key is `[a-z0-9 ]` only; it is drawn as text; nothing of
  the shelf is logged; the row is owner-scoped.

The reader's titles, summaries and profile going to OpenAI via OpenRouter is on [/privacy](privacy.md).

## Two steps, and only the first is stored

**This is the phrase row: the fallback since 2026-10-03.**

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

**Before the first answer**, the row's place holds the spinner and *"Loading topics…"*. When the
number of article rows makes topics possible, it also holds the collapsed row's approximate shape
in faint outline pills, wrapping like the real row, so the cards usually land near where they will
stay. Exact copies count as one work only on the server, and the real labels and number of topics
are not known yet, so this reserve can still be taller or shorter (Greg's report a4xsg3, 2026-09-30;
plan [260930j](../plans/260930j-shelf-topics-loading-spinner.md)). A failed request is an answer, and
draws nothing rather than spinning for ever.

## The model's judgement

**History since 2026-10-03: this scoring call is no longer made.** Scores already stored still shape
the phrase row a reader sees until their first tree lands. Removing the scoring code and its table is
queued. What follows describes it as it ran.

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

**Then the topics inside a chosen one move up beside it** (`withinChosenFirst`, same file), for
topics a model named as a broad-to-fine tree. Hiding zeros is not enough for Greg's *"filter down
within those at sort of increasing levels of granularity"* (2026-10-03): the list arrives broad
first, so with *Neuroscience* chosen, another broad subject that shares one article with it still
sits ahead of *Vision*. So the topics **directly** inside a chosen one are gathered just after the
last chosen pill that is not itself inside a chosen one, broad first; nothing else moves, and a topic
two levels down waits until its parent is chosen. **A pill never moves when it is pressed**: a pill
chosen from that group stays in it. With nothing chosen, and for phrase topics, the order is
untouched. It runs after the zeros go and before the first twelve.

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

The word **Topics** at the head of the row has a card saying how they are picked and ordered —
Greg, `spya-tw6zxw`, 2026-09-29 — and the sort row above it has no visible *Sort* label (the legend
is still read to a screen reader). [261001j](../plans/261001j-five-small-feedback-tooltips-and-labels.md) § 3.

- **Pills**, the default: the first twelve topics in the server's rank order, plus any chosen one
  further down, in its own place — never re-sorted by count, so nothing moves when you press one.
  **"All N topics"** expands the same row to every pill; it is shown only when there are more than
  twelve.
- **More detail** (`?topicsView=detail`): every topic, in rank order, one compact row each — a colour
  swatch, the chip, a bar for its live count (relative to the largest count shown, so the bars line
  up in one column and compare at a glance, with a card saying so), and the three articles that use
  it most, as links. The row said *"7 of 38 on the shelf"* until 2026-10-01; Greg: *"if we have the
  bar we can remove the "N of M on the shelf""* (`spya-f28vqj`), and the chip's card still gives
  both denominators. The chip in a row **is** the pill (`TermChip`): the same toggle, the same
  `aria-pressed`, the same tooltip. The toggle between the views stays in one place, so focus stays
  on it. Chosen over cards and two-line rows from screenshots, plan
  [260928d](../plans/260928d-shelf-topics-diversity-coverage-and-detail-view.md) § Stage 2.
- **A topic a model named** (it carries a `granularity`) differs in four small ways, and a phrase
  topic in none. Its label is in the model's face ([fonts.md](fonts.md)), on the pill, in the card
  and in the paper card. A **finer** one (`granularity > 0`) has a faint `›` before its label —
  a mark rather than a smaller or paler pill, so the height, the hue dot and the label's ink stay as
  they are in both themes — and its card says *"Inside Neuroscience"*, the label of its `within`.
  In More detail a finer row's chip is also indented, a step per level (`topicDepth`). Its members
  have no phrase count, so the card and the row name them in the order sent (newest first) and
  **nothing says *"used N times"***. And the card on the word **Topics** says a model named them,
  broad subjects first, new articles sorted in automatically.
- **Each article link in a row has the paper card** on hover and focus — title, authors and site,
  the gist (or the abstract, for a paper not yet AI-processed), when it was added and last opened,
  its length (or its not-yet-processed status), any archive and sharing state, and up to six topics
  it is in, each with its hue, then *+N more*. Greg: *"add rich tooltips … to the paper-links that
  are matched for each faceted-text-search-pill"* (`spya-f28vqj`). The topics are over every topic
  the server chose, not only those drawn, so a card does not change as the view narrows. The card
  itself is reusable and knows nothing about the topics view that supplied them —
  [tooltips.md § Where the code is](tooltips.md#where-the-code-is), plan
  [261002f](../plans/261002f-paper-card-on-topic-article-links.md).

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
shelf — and is **dropped, with `replace`, once a settled answer arrives: nothing pending and no
model refresh under way** (`refreshing`). Not before: while articles are still being read, or the
model is choosing, a topic can be absent from one answer and present in the next. A refresh that
never lands does not hold the key for ever: when the ask-again loop gives up, the key is dropped.

## Your own tags, in the row above

The reader's own tags ([library.md § Your own tags](library.md#your-own-tags)) are a **second row
above this one**, not chips mixed into it. Everything this doc says about colour, More detail, the
paper card and "picked by a program" is about phrases chosen *for* the reader; a tag is the reader's
own word, and mixing them would have tags shift every topic's hue (GPT Sol's plan review of 261003d,
finding 4).

What the two rows share is the narrowing. `tagFacets` in
[`shelf-narrow.ts`](../../src/web/shelf-narrow.ts) shapes each tag like a topic, so the same
`topicMembers` → `withTopics` → `topicCountsForVisible` serve both: **one AND across every chip in
either row, and one count formula**, so a chosen tag's number is the shelf's number exactly as a
topic's is. Tags come from the entries already loaded, so there is no request, no pending state, and
no eight-work minimum.

`?tags=<tag>,<tag>` (push), its own key. **Unlike `?topics=`, it is never rewritten by the page**: a
chosen tag no article in scope carries narrows nothing and draws no chip, but stays in the URL, so a
tag edit in flight or an archive still loading cannot eat the reader's filter.

## Where the code is

| What | Where |
|---|---|
| extracting candidates; the English check; `EXTRACTOR_VERSION` | [`src/shelf-terms/extract.ts`](../../src/shelf-terms/extract.ts) |
| choosing topics; `shelfTermMetrics` (coverage, overlap, redundancy — the one definition) | [`src/shelf-terms/choose.ts`](../../src/shelf-terms/choose.ts) |
| the model's prompt, the input hash, the strict parser, the one call; `SHELF_TOPICS_PROMPT_VERSION` | [`src/shelf-terms/model-scores.ts`](../../src/shelf-terms/model-scores.ts) |
| stored scores applied, the claim, the refresh after the answer, the allowance | [`src/shelf-topics.ts`](../../src/shelf-topics.ts) |
| the model-named tree: both prompts, the strict parsers, `rethink`, `fileWorks`, `granularityOf`; `TOPIC_SET_PROMPT_VERSION` | [`src/shelf-terms/model-topics.ts`](../../src/shelf-terms/model-topics.ts) |
| what a request does with the tree: the answer, what is due, the claim, the work after the answer | [`src/shelf-topic-sets.ts`](../../src/shelf-topic-sets.ts) |
| storage, the owner-scoped set, the bounded fill; the `shelf_topic_sets` row and its claim (and the older `shelf_topic_scores`) | [`src/store/pg-shelf-terms.ts`](../../src/store/pg-shelf-terms.ts) |
| `GET /api/library/terms` (`?archived=1` for active + archived), `private, no-store` | [`src/routes.ts`](../../src/routes.ts); the shape is `LibraryTermsResponse` in [`src/types.ts`](../../src/types.ts) |
| the fetch, the ask-again loop, which URL keys apply | [`src/web/useShelfTerms.ts`](../../src/web/useShelfTerms.ts) |
| the narrowing and the count formula, pure | [`src/web/shelf-narrow.ts`](../../src/web/shelf-narrow.ts) |
| the row: the two views, "All N topics", the More-detail toggle and `?topicsView` | [`src/web/ShelfTerms.tsx`](../../src/web/ShelfTerms.tsx) |
| one topic's chip and its tooltip, shared by both views; `topArticles` (one per title) | [`src/web/ShelfTermChip.tsx`](../../src/web/ShelfTermChip.tsx) |
| the More-detail rows: swatch, chip, count bar, links with the paper card | [`src/web/ShelfTermsDetail.tsx`](../../src/web/ShelfTermsDetail.tsx) |
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

- No embeddings, no clustering library (the colours' clustering is thirty lines of our own). The
  pipeline tried in [investigation 261003b](../investigations/261003b-shelf-topics-as-concepts-not-phrases.md)
  filed articles worse than the model does.
- No *Redo topics* button: the tree is re-thought by itself. Queued.
- **No tree for a shelf over 150 works** that does not already have one, and no re-think of one
  that does: [§ The 150-work cap](#the-150-work-cap). Queued.
- The "fits no topic" trigger compares totals, so as many unplaced works deleted as newly unplaced
  ones leaves it unfired; the size trigger still fires in time.
- No editing of topics — hide, rename or pin. Zotero-style "hide this automatic tag" is the obvious v2.
- The generic-word list is hand-written, so weak topics such as *window* and *message* survive.
- Near-synonyms (*neural nets* / *neural networks*) can both appear, and near-copies of one article
  that differ by a few words are separate works (exact-hash grouping only).
- English only; other-language articles are skipped and counted.
- The public shelf (`/read/public`) gets nothing.
