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

**Decision** (coordinator, 2026-09-29): a vague single word is **held to a higher density, not
dropped** — Greg's first idea, `vagueDensityPer1000: 2` — and **phrases are never judged vague**;
they keep only the extractor's shape test on their head. After GPT Sol's stage-1 review (S1-1: the
SUBTLEX permission covers `wordfreq`, not our processing of the original file), **vague is decided
by the Glasgow Norms alone** (CC BY 4.0); nothing from SUBTLEX ships.

**The rule, as built.** A single word is *vague* when the Glasgow Norms rate it — or the first of
its lookup forms they know: the word, its plural, then *-s/-es/-ed/-d/-ing→e/-ing* lemmas — below
**4.5** concreteness on their 1–7 scale. A word the norms do not rate is not vague: they are 4,682
mostly everyday words, so absence is no evidence (*irreducibility*, *Wagan*, but also *parent*,
*technology*, *July*). A vague word counts for an article only at `max(4, 2 per 1,000 words)` prose
uses, against `max(2, 0.3 per 1,000)` for every other candidate. Adjacency (R7) as § Reviews.

**Familiarity, measured and not adopted.** The same data rates familiarity, so "vague = abstract
**and** familiar" would let a rare abstract word keep the ordinary rule (*neural*: concreteness
4.1, familiarity 3.9). At familiarity ≥ 4.5 and ≥ 5.0 it chose exactly the same 30 as concreteness
alone; at ≥ 5.5, @5 and @12 each fell by one. No gain on this shelf, so the default is
concreteness alone; `familiarityMin` stays as an option (default null) so the report can re-measure
on Greg's production shelf.

Local shelf, owner `f4d08b58…`, 37 eligible articles (32 works), K = 30, rank order —
`npm run shelf-terms:report -- --owner <uuid>`, section *Vague words and adjacency*. Articles
covered, of 37:

| variant | @5 | @8 | @12 | all 30 | adjacent shared-stem pairs, first 12 |
|---|---|---|---|---|---|
| before (both rules off) | 16 | 26 | 35 | 37 | 0 |
| adjacency only | 16 | 26 | 35 | 37 | 0 |
| **Glasgow < 4.5, D = 2 (the default)** | **17** | **28** | **34** | **36** | **0** |
| vague words dropped outright | 17 | 28 | 34 | 36 | 0 |
| concreteness < 4.0 | 16 | 28 | 34 | 36 | 0 |
| concreteness < 5.0 | 17 | 28 | 34 | 36 | 0 |
| + familiarity ≥ 4.5 / ≥ 5.0 | 17 | 28 | 34 | 36 | 0 |
| + familiarity ≥ 5.5 | 16 | 28 | 33 | 36 | 0 |

- **The gate holds.** @5 +1, @8 +2, @12 −1, all 30 −1 — and the one article lost, *todo* (234
  words), was covered only by *mistake*, which is vague. (At @8 two articles covered before only
  by *learning*, vague, are lost too, and the new path covers four others.)
- **First 12, before:** ball lightning, conscious experience, Wagan Watson, Turing machine,
  mechanism, parent, learning, shape, board, mistake, writers, computational irreducibility.
  **After:** ball lightning, conscious experience, Wagan Watson, machine, mechanism, parent, AI,
  shape, principle, writers, window, startups.
- **In the 30: *parent* (6th, 4 articles). Not: *memory*, *learning*, *following*, *mistake*.**
  *parent* is back because the norms do not rate it; *memory* (2.9), *learning* (3.5), *mistake*
  (3.4) are vague and none is used heavily enough in enough articles to reach the 30; *following*
  was never in this shelf's 30.
- **Left the 30 as vague:** learning, mistake, memory, breaking, dreams, forget. Also left,
  displaced: Turing machine (absorbed by *machine*), computational irreducibility, July, language
  models, rats, children. Joined: machine, principle, window, cycle, water, neural nets, training,
  commercial, mother, potential, behavior, white.
- **Against the SUBTLEX version** (common = Zipf ≥ 4.0; 17 / 25 / 33 / 37): Glasgow alone covers
  more in the first 8 and 12, and keeps *parent*, *technology* and *solve* — unrated everyday words
  the SUBTLEX rule held back — while losing *todo* from the 30.
- **Adjacency never fires on this shelf** — 0 pairs with the rule off as well — so the unit test
  built from Greg's *neural networks* → *neural activity* is the evidence, and production is where
  it will be seen.
- **Phrases.** Before the decision, a phrase with no passing word was dropped; it caught *equal
  partners*, *moving forward*, *natural language*, *personal communication*, *Philip Bay*, *power
  station*, *Stolen Generations* — real topics among them — and removing the rule changed nothing
  in this shelf's 30.
- **4.5.** 4.0 lets *entered* (by *enter*, 4.1) and *breaking* (*break*, 4.4) through; 5.0 also
  catches *signals* (4.9). *entered* cannot be a single-word topic anyway (`nounishShape` rejects
  it, R6), and the phrase Greg saw it in was not reproduced.

**Why concreteness, not part-of-speech tagging:** no tagger dependency, and plan 260928a measured
that `compromise` did worse on this shelf than the shape rules. The list is one generated module,
`src/shelf-terms/data/glasgow-norms.ts` (46 KB, 4,682 words, concreteness and familiarity), built by
`scripts/build-word-lists.ts` and inlined in the API bundle — nothing reads a word list from disk at
run time; licence and what was not shipped in its `ATTRIBUTION.md`.
- **GPT Sol, stage 1 code, round 1** —
  [260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle-stage1-review-sol.md](260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle-stage1-review-sol.md).
  Fixed S1-2 (`staring` looked up as *star*), S1-3 (`admit` could undo the neighbour rule), S1-4
  (attribution). **S1-1: the SUBTLEX-US permission covers `wordfreq`, not us** — so SUBTLEX was
  withdrawn and the rule rebuilt on the Glasgow Norms alone (39915055); it measured *better* on the
  local shelf (@8 28 of 37, against 25 with SUBTLEX). **Round 2**, scoped to that fix —
  [260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle-stage1-round2-sol.md](260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle-stage1-round2-sol.md):
  S1-1 closed, no findings.
- **GPT Sol, stage 2 code** —
  [260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle-stage2-review-sol.md](260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle-stage2-review-sol.md).
  Fixed S2-1 (a late shelf or archive response could resurrect, duplicate or hide a just-archived
  row), S2-2 (Undo and Put back depended on a follow-up read), S2-3 (a stale error after retry),
  S2-4 (an unexplained empty detail view). No unresolved finding.

## Browser check

Sonnet subagent, Playwright, 2026-09-29 ~03:40 UTC, the local 38-article shelf, 1280 and 390 wide:
all nine checks passed — the Archived chip beside Unread and no section at the foot
([top](260929a-shots/01-desktop-shelf-top.png)); archived articles interleaved in the one list by
the sort, marked *Archived*, with Put back ([title sort](260929a-shots/02-desktop-archived-on-title-sort.png));
Put back and Archive leave the card in place, with Undo
([undo](260929a-shots/24-after-rearchive-with-undo.png)) — the data was left as found; zero-match
pills gone after a pick, in both views ([detail](260929a-shots/28-more-detail-topic-picked.png));
`/?archived=1` shows "Loading archived…" briefly and never an empty-shelf message; no horizontal
scroll at 390px ([phone menu](260929a-shots/12-mobile-kebab-menu-open.png)); no console errors;
`/api/library/terms` 200. First 12 locally: *ball lightning, conscious experience, Wagan Watson,
machine, mechanism, parent, AI, shape, principle, writers, window, startups* — no *following* or
*process*. Not exercised: a chosen pill whose count has fallen to 0 (covered by a unit test).

## What is left

- **Some plain words remain** (*window, shape, parent*, and after picking *ball lightning*: *red,
  July, water, white*). Glasgow does not rate every word, and concrete ones like *red* pass by design.
  Greg called it "minor tweaks"; this is that, not a full cure.
- **Near-copies of one article still count as separate works** (*Wagan Watson*, *ball lightning*) —
  the v2 named in 260928a.
- **The neighbour rule never fired on the local shelf**; its evidence is a unit test until Greg's
  shelf shows it.
- **"(n active + m archived)"** appears only when something narrows the list, as the count line
  always has.
