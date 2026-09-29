# Shelf topics, round three: vague words, related neighbours, dead pills, and archived at the top

**Status:** planned, 2026-09-29. Follows [260928d](260928d-shelf-topics-diversity-coverage-and-detail-view.md)
and [260928a](260928a-shelf-facet-terms.md); the feature is [shelf-terms.md](../project/shelf-terms.md).
Three reports from Greg against production build cba650a3, all *suggestion*.

## What Greg said

SPIDERYARN-READING2-4T, 2026-09-29 01:17Z, on `/?topicsView=detail`:

> The new faceted-text-pills on the Homepage Shelf for filtering articles are working better.
>
> But I noticed that it listed "neural networks" and "neural activity" as the first two. That's not
> necessarily bad - they are distinct. And I think I'd already requested that you look at the
> correlation in which articles the terms pick out and avoid (near-consecutive) terms that match too
> many overlapping articles. I suppose we could also have a bias against overlapping words?
>
> The other thing I noticed is that it suggested words like "following" and "entered", which seem
> pretty vague and as a user I can't imagine wanting to filter by them. I was going to say something
> like "they're too common" - but that said, other common words (like "rat") might be good for
> picking out animal neuroscience articles. Are we using something like TF/IDF (or maybe there's a
> better algorithm now) to require that words that are common in English need to be
> frequently-occurring in order to count? Or even a measure of "concreteness" (preferable), or even
> preferring proper nouns or noun phrases adjectives or something like that? Dunno, maybe that's too
> crude.
>
> Minor tweaks might be sufficient - it's not working terribly as things stand.
>
> — Greg, 2026-09-29

SPIDERYARN-READING2-4Y, 01:34Z, on `/?topics=neural+network,language+model`:

> On the Homepage Shelf, if I pick one of the faceted-search-topic-pills, it should hide (or shunt to
> the right) any topic-pills that match 0 of the filtered articles on the shelf, i.e. so it's easier
> to pick a topic-pill and then immediately see which other topic-pills will help filter further
> (and not be distracted by topic pills that will lead to empty results).
>
> — Greg, 2026-09-29

SPIDERYARN-READING2-4V, 01:27Z, on `/?archived=1&topics=neural+network`:

> On the Homepage Shelf, we have a "Show/hide archived" toggle at the very bottom.
>
> I think it would be better if it was a (default-hide-archived) toggle at the top (like for
> "Unread"), so that it's easy to show some/all (so we can use the faceted-search-topic-pills and/or
> sort to look through the Archived articles easily too).
>
> — Greg, 2026-09-29

## Stage 1 — which words become topics (server, `src/shelf-terms/`)

**Vague words.** Today a single word is kept if it is not on a hand-written generic list and passes a
shape test (not *-ly*, not *-ed*). That is why *following* survives (*-ing* is not tested), and
*entered* should not have — **reproduce it first** with a failing test; the likeliest route is a
phrase whose head passes, or a label taken from a different surface form than the key.

**The fix Greg prefers is concreteness**, and it is exactly the right signal: *rat* is concrete
(~4.9 of 5 in the Brysbaert norms), *following* and *process* are abstract (~2). So:

- Ship a **static concreteness list** as a data file (no model call, no dependency), chosen by
  licence — the research below decides which list, or falls back to an English word-frequency list
  if no concreteness list can be shipped commercially.
- **A single-word topic must be concrete enough** (rating ≥ a threshold, about 3.0 — tuned on the
  local shelf and stated), **or be absent from the list** (proper nouns, technical terms like
  *irreducibility* are rarely in it and must not be punished for that), **or be rare in English**
  if a frequency list is used as well.
- **Phrases** keep today's rule: their last word passes the shape test. A phrase whose every word is
  abstract (*following year*) is dropped.
- Quality is multiplied by a gentle concreteness factor so, among survivors, concrete words rank a
  little higher.

**Related neighbours.** *neural networks* then *neural activity* came first and second. They are
distinct topics, but a reader scanning the row wants the next chip to be about something else. So:
**a candidate sharing a word stem with any already-chosen topic has its gain multiplied by 0.5**
(Greg's "bias against overlapping words"), and one sharing a word with the **previous** chip is not
allowed to come next if any other candidate adds at least as many new articles. It can still be
chosen later. Measured with the report: the first 12, how many adjacent pairs share a stem (target
0), and coverage@5/8/12 before and after (must not fall materially).

## Stage 2 — the row and the archive (client, `src/web/`)

**4Y — dead pills.** An unselected topic whose live count is 0 is **hidden**, in both the pill row
and the detail view — not greyed as today. Hidden rather than shunted: the row is for choosing the
next filter, and a chip that leads to nothing is noise. A **selected** topic always stays, even at 0,
so it can be removed. "All N topics" counts only the pills it would show.

**4V — archived at the top.** The "Show archived" button at the foot of the shelf goes. In its place,
an **Archived** chip beside **Unread** in `ShelfControls`, off by default (`?archived=1` as today):
when on, archived articles join **the same list** — sorted with everything else, filtered by search,
Unread and topics, counted in "n of m" — each marked *Archived* on its card and row, with its
restore action. When off, they are not on the shelf, as now. One list rather than a second section
at the foot is what makes sort and topics work across them, which is what Greg asked for.

## Stages, gates

1. Selection — red tests first (*following*, *entered*, *rat* kept, adjacent shared stems), the list
   and its licence file, report before/after. Sol code review.
2. UI — red tests first (zero pills hidden when a topic is chosen, a chosen zero pill kept; archived
   chip merges archived into the list, sort and topics apply, restore works; bottom button gone).
   Sol code review. Browser check at desktop and phone widths with screenshots.

Stages 1 and 2 touch disjoint files and are built in parallel.

## Feedback notes

`docs/user-feedback/260929_0117-…`, `…_0127-…`, `…_0134-…`, each with Greg's words, its Sentry id and
its ending.

## Reviews

*(recorded as they land)*
- **GPT Sol, plan** —
  [260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle-plan-review-sol.md](260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle-plan-review-sol.md)
  (prompt: [260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle-plan-review-prompt.md](260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle-plan-review-prompt.md)).
  *Revise before build.* Decisions, which supersede the stage text above where they differ:
  - **R1 — no extractor version bump: the vague-word rule runs in the chooser**, over the stored
    candidates, so no reader's cache refills. The extractor is unchanged.
  - **R6 — "entered" cannot survive as a single word** (`nounishShape` rejects it); it most likely
    came in as the first word of a phrase. So the rule applies to phrases too: a phrase is dropped
    when none of its words passes the single-word test below.
  - **The lists, chosen by licence** (a Sonnet research agent, 2026-09-29): the Brysbaert 40k
    concreteness norms carry **no licence** and are not shipped. Shipped instead: **Glasgow Norms**
    concreteness (Scott et al. 2019, 5,553 words, **CC BY 4.0**) and the set of **common** English
    words from **SUBTLEX-US** (Brysbaert & New 2009; redistribution "for any purpose" with credit,
    per Brysbaert's written permission recorded in `rspeer/wordfreq`'s NOTICE.md). Norvig's lists are
    ruled out (LDC); `wordfreq` is sunset. **The single-word rule:** keep it if Glasgow rates it
    concrete (threshold tuned on the local shelf, stated); if Glasgow does not know it, keep it only if
    SUBTLEX says it is not common. So *rat* stays (concrete), *following* and *process* go (common and
    abstract, or common and unrated), *irreducibility* stays (rare), proper nouns stay (rare).
  - **R7 — adjacency only**, no global 0.5 penalty: a candidate sharing a stem with the previous chip
    does not come next if another adds at least as many new articles. Gate: no loss beyond one
    physical article at @5/@8/@12, adjacency measured on the final list after `admit`.
  - **R2–R5** go into Stage 2 as written: the Archived chip renders whenever the active request has
    settled (an all-archived reader must reach it) and empty states come from the combined scope;
    `loadArchived` moves with the button; a merged row carries an explicit archived flag, shows
    Restore instead of Archive, and mutations reconcile in both arrays; rows combine before TanStack
    sorts, so the fixture sink and the row cap still work; zero pills are removed **before** taking
    the first 12. Offline, topics stay unavailable (the terms route is not cached) — the accepted
    limit.

## Measurements (Stage 1)

**Decision** (coordinator, 2026-09-29, on the numbers below): a vague single word is **held to a
higher density, not dropped** — Greg's first idea, `vagueDensityPer1000: 2` — and **phrases are
never judged vague**; they keep only the extractor's shape test on their head.

**The rule, as built.** A single word is *vague* unless SUBTLEX-US says it is **not common**
(Zipf < 4.0), or the Glasgow Norms rate it **≥ 4.5** on their 1–7 scale — looked up as the word,
its plural, then *-s/-es/-ed/-d/-ing/-ing→e* lemmas, first hit decides. A vague word counts for an
article only at `max(4, 2 per 1,000 words)` prose uses, against `max(2, 0.3 per 1,000)` for every
other candidate: *following* used heavily in one article still names it; used in passing across
many, it names none. Adjacency (R7) as § Reviews.

Local shelf, owner `f4d08b58…`, 37 eligible articles (32 works), K = 30, rank order —
`npm run shelf-terms:report -- --owner <uuid>`, section *Vague words and adjacency*. Articles
covered, of 37:

| variant | @5 | @8 | @12 | all 30 | adjacent shared-stem pairs, first 12 |
|---|---|---|---|---|---|
| before (both rules off) | 16 | 26 | 35 | 37 | 0 |
| adjacency only | 16 | 26 | 35 | 37 | 0 |
| vague words dropped outright, ≥ 4.5 | 17 | 25 | 33 | 37 | 0 |
| density D = 1.0 | 16 | 25 | 33 | 37 | 0 |
| **density D = 2.0, ≥ 4.5 (the default)** | **17** | **25** | **33** | **37** | **0** |
| density D = 3.0 | 17 | 25 | 33 | 37 | 0 |
| D = 2, concreteness ≥ 4.0 | 16 | 25 | 33 | 37 | 0 |
| D = 2, concreteness ≥ 5.0 | 16 | 25 | 33 | 37 | 0 |

- **The gate holds.** @5 gains one; @8 loses one net (three articles out — one only in *parent*,
  vague, two in *shape*, which the new path no longer reaches — and two in); @12 loses two, both
  covered before only by *mistake*, vague.
- **D = 2 and D = 3 choose exactly the 30 that dropping does**, so the decision costs nothing here.
  D = 1 keeps *Turing machine* and brings in *mind*, *essay*, *cells* for *boy*, *features*, *door*,
  *quantity*.
- **Left the chosen 30 as vague:** parent, learning, mistake, July, memory, breaking, solve, dreams,
  technology, forget. Also left, displaced: Turing machine (absorbed by *machine*), shape, board,
  computational irreducibility, language models, rats, scientists, mutual, children. Joined:
  machine, message, principle, club, mechanical, white, error, father, water, cycle, mother, neural
  activity, contemporary, model, window, boy, features, door, quantity.
- **First 12, before:** ball lightning, conscious experience, Wagan Watson, Turing machine,
  mechanism, parent, learning, shape, board, mistake, writers, computational irreducibility.
  **After:** ball lightning, conscious experience, Wagan Watson, machine, mechanism, message,
  principle, kids, neural networks, club, writers, mechanical.
- **memory, learning, following, parent, mistake: none is in the 30 at any D.** *memory* still has
  members — 6 / 5 / 4 articles at D = 1 / 2 / 3, against 8 — but the greedy fills the 30 first.
  *following* would count in 3 / 0 / 0 articles, *parent* 2 / 1 / 0, *mistake* 1 / 1 / 1,
  *learning* 2 / 1 / 1. On a shelf where one of them is used heavily, it can come back; that is the
  point of the density rule over dropping.
- **Adjacency never fires on this shelf** — 0 pairs with the rule off as well — so the local shelf
  cannot show it; the unit test built from Greg's *neural networks* → *neural activity* is the
  evidence, and production is where it will be seen.
- **Taking phrases out of the vague test changed nothing in this shelf's 30.** The seven phrases it
  had caught — *equal partners*, *moving forward*, *natural language*, *personal communication*,
  *Philip Bay*, *power station*, *Stolen Generations* — are candidates again but none reaches the
  30. It was removed because what it caught included real topics (proper nouns made of common
  words; *station*, unrated; *natural* 3.6 and *language* 3.4) and Greg's examples were single
  words. Density would not have rescued them: at D = 1 only *Stolen Generations* keeps its articles.

Two departures from § Reviews, both measured:

- **Rarity rescues a rated word too.** The review's rule let a Glasgow rating decide alone. Then
  *entered* (by its lemma *enter*, 4.11) and *neural* (4.14) sit 0.03 apart, and any threshold that
  catches the first catches the second. Checking frequency first removes that knife-edge. The cost:
  rare abstract words pass (*principle*, *error*, *quantity*, *contemporary* joined the 30).
- **4.5, not ~3.0 or 4.0.** 4.0 lets *entered* and *breaking* (*break* 4.39) through; 5.0 also
  catches *signals* (4.89). Common-but-abstract topical words are vague at any threshold that
  catches *following* — **memory (2.85), learning (3.53), technology (unrated)** — and the density
  rule, not the threshold, is what gives them a way back.
- *entered*, the reported word, **cannot be a single-word topic** (`nounishShape` rejects it, R6);
  as the first word of a phrase it is now left alone like every phrase. The report did not
  reproduce the phrase Greg saw.

**Why concreteness and frequency, not part-of-speech tagging:** no tagger dependency, and plan
260928a measured that `compromise` did worse on this shelf than the shape rules. The word lists are
generated modules, `src/shelf-terms/data/` (concreteness.ts 36 KB, 4,682 words; common-words.ts
31 KB, 4,380 words), built by `scripts/build-word-lists.ts`; licences in its `ATTRIBUTION.md`.
