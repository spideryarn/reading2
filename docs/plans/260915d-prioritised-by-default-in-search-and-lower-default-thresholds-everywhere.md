# Prioritised by default in Search, and lower default thresholds everywhere

Two admin reports from Greg on 2026-09-12, one subject: the prioritised order and the bar under it.

> Make prioritized the default submode for search.
>
> — Greg, 2026-09-12 (SPIDERYARN-READING2-3S)

> We have a few different modes that involve a prioritized submode with a kind of thresholding.
> Let's set the threshold lower, i.e. more permissive, so that for all of these different modes,
> most of the entries are coming in by default.
>
> — Greg, 2026-09-12 (SPIDERYARN-READING2-3Z)

Both URLs he was standing on carry bars he had dragged down by hand — `gate=0.00&bar=0.30` on one,
`gate=0.00&bar=0.00` on the other. The defaults were hiding more than he wanted to lose.

## Which modes these are, found from the shared machinery

Every bar goes through [`src/web/threshold.ts`](../../src/web/threshold.ts) (`applyThreshold`).
Its callers, and the one caller that is not a prioritised mode:

| Mode | Order param, default | Bar param | Starting position | Where |
|---|---|---|---|---|
| Glossary | `?sort=`, `prioritised` | `?gate=` | `PRIORITY_GATE = 0.30` (`difficulty × centrality`) | GlossaryPanel.tsx |
| Quotes | `?rank=`, `document` | `?bar=` | `QUOTE_BAR_DEFAULT = 0.80` (`max(importance, striking)`) | QuotesPanel.tsx |
| Search | `?order=`, `document` | `?conf=` | `PRIORITY_CONF = 50` (0–100 confidence) | search-hits.ts |
| Citations | `?citeby=`, `prioritised` | `?citebar=` | `CITATION_BAR_DEFAULT = 0.40` (`(2r + i) / 3`) | CitationsPanel.tsx |
| ~~Debate~~ | — | `?name=` | `DEBATE_LEVEL_DEFAULT = "quoted"` | debate-levels.ts |

**Debate is left alone.** Its header says in so many words that it *"is **not** Prioritised, and it
is not a score"* — it is a categorical bar on whether a page is about this article at all, and its
default was re-measured to hide exactly one row, the known false positive about a different
document. Lowering it would put that decoy back, which is a correctness question and not a
permissiveness one. Greg's sentence is about modes with *a prioritized submode*; Debate has none.

**There is no one place the four defaults live, and this plan does not make one.** Each is in a
different unit over a different composite, and threshold.ts deliberately leaves the number with the
panel (*"the track … the unit … Those genuinely differ, and unifying them would be the
over-abstraction"*). A shared table of four unrelated numbers would couple four files for the sake of
this one edit. Four one-line changes, each beside the argument for its own number.

## The measurement

Local database only — this box has no production credentials (both `.env.local` files point at
`127.0.0.1:54362`). The corpus is small but real: articles readers imported, copied down. For each
mode, the share of each article's entries a given bar leaves on screen (unscored entries always
survive, as `survivesThreshold` says), then the mean, median and minimum across articles.

**Measured on the revision a reader sees** — `articles.current_revision_id`, the join the store's
own reads use. The first draft of this plan took `DISTINCT ON (slug)` with no `ORDER BY`, which
picks an arbitrary revision per article; GPT Sol caught it, and the remeasurement moved the quotes
number from 0.65 to 0.60 (the current quote sets are longer, 77 quotes against 44, with a lower
tail).

**Glossary** — 13 glossaries, 169 terms, `difficulty × centrality`:

| gate | mean | median | min |
|---|---|---|---|
| 0.05 | 0.99 | 1.00 | 0.86 |
| 0.08 | 0.90 | 1.00 | 0.57 |
| **0.10** | **0.87** | **1.00** | **0.57** |
| 0.12 | 0.82 | 0.81 | 0.57 |
| 0.15 | 0.71 | 0.65 | 0.43 |
| 0.20 | 0.57 | 0.50 | 0.25 |
| 0.30 (today) | 0.34 | 0.29 | 0.05 |

**Quotes** — 4 articles, 77 quotes, `max(importance, striking)`, **with the panel's snap
modelled**: the bar goes to the nearest score the list actually has, ties downward (`snapToStop`),
before anything is hidden — so these are what a reader sees, not a literal `score >= bar`:

| bar | mean | median | min |
|---|---|---|---|
| 0.50 | 0.92 | 1.00 | 0.69 |
| **0.60** | **0.85** | **0.95** | **0.48** |
| 0.65 | 0.76 | 0.86 | 0.31 |
| 0.75 | 0.71 | 0.76 | 0.31 |
| 0.80 (today) | 0.56 | 0.52 | 0.27 |

**Citations** — 4 articles, 192 works, `(2 × relevance + influence) / 3`:

| citebar | mean | median | min |
|---|---|---|---|
| 0.20 | 0.99 | 1.00 | 0.95 |
| **0.25** | **0.92** | **0.90** | **0.88** |
| 0.30 | 0.84 | 0.83 | 0.69 |
| 0.35 | 0.60 | 0.61 | 0.45 |
| 0.40 (today) | 0.46 | 0.48 | 0.25 |

**Search** — 8 finished meaning-search runs, 60 hits, confidence 0–100: every bar from 10 to 40
shows all of them; 50 (today) shows a mean of 0.98, min 0.83. The search prompt already tells the
model to leave weak matches out, so the model's own bar does most of the work here.

The script is `node q.mjs "<sql>"` against the local database; the four queries are in the
session's evidence and are reproduced in § Evidence below.

## The decision

**"Most" means roughly 85–90% of a typical article's list on screen**, with the weakest tail still
held back — so the bar is still a bar and its foot line still has something to say. Not 100%: a bar
that hides nothing by default opens every panel on *"Nothing is hidden by this threshold"*, which
is the state quotes.md § The first real run records as the thing that moved the quotes number up.

| Constant | Today | New | Shows (mean / median) |
|---|---|---|---|
| `PRIORITY_GATE` | 0.30 | **0.10** | 0.87 / 1.00 |
| `QUOTE_BAR_DEFAULT` | 0.80 | **0.60** | 0.85 / 0.95 |
| `CITATION_BAR_DEFAULT` | 0.40 | **0.25** | 0.92 / 0.90 |
| `PRIORITY_CONF` | 50 | **30** | 1.00 / 1.00 — outside the band, on purpose (below) |

Each stays **absolute**, not "top 85%", for the reason all four headers already give: when the
scores run hot or cold, an absolute bar degenerates to hiding nothing, where a relative one would
invent a ranking the data does not have.

**Search is deliberately outside the 85–90% band**, and says so rather than listing 1.00 as if it
met it. It is the one mode whose prioritised order is *becoming* the default, and the risk
search.md names — results kept from a reader who has just typed a question — is worst exactly
there; and the model has already pruned weak matches before any bar sees them. So 30 is chosen so
that a hit the model rated *worth a look* is not hidden by default (the hover card's wording,
search.md § What the number means), and on the local data that hides nothing. Fable's framing,
2026-09-15. Glossary's 0.10 is about
`0.35 × 0.3`, the product of two scores the model called meaningfully above the floor.

## The search default

`orderParam.withDefault("document")` → `"prioritised"`. Prioritised sorts exactly as *by place*
does and hides what falls under `?conf=`, so with the bar at 30 the list a reader opens on is, in
practice, the place-ordered list they had — plus a slider and a foot line.

- **Words mode is unaffected in substance.** Every literal match has a null confidence, which
  always survives; the slider is only drawn in meaning mode (`matcher === "meaning" && order ===
  "prioritised"`, SearchPanel.tsx). The words list stays exactly as it was.
- **Explicit `?order=` links keep working; links without one change meaning, and that is
  accepted.** `?order=document` still parses and still means *by place, nothing hidden*. But nuqs
  clears a default from the URL, so every link written while `document` was the default carries
  no `?order=` at all, and those now open prioritised — which is the change Greg asked for.
- **The sharp case is a dormant `?conf=`** (GPT Sol). A reader who chose prioritised, dragged the
  bar to 80, then went back to *by place* left `?conf=80` in the URL with no `?order=`; today that
  filters nothing (`results` applies the bar only in prioritised). After this change the same URL
  filters at 80. **Accepted, not migrated**: it needs a reader to have done all three things and
  then shared or bookmarked the result, the bar and its foot line are on screen saying what they
  hide, and a migration would need a way to tell an old URL from a new one that the URL does not
  carry. Pinned by a test so it is a decision rather than a surprise.
- **The bar reaches the prose, not only the list** (GPT Sol). `SearchMode` publishes the filtered
  results as the passage set, and `Reader` derives the phrase washes, paragraph strength, colour
  segments and spine-rail lanes from it (Reader.tsx), and drops an open hit the set no longer has.
  So by default every meaning hit under 30 now leaves the article as well as the list. That is the
  design search.md § Prioritised argues for (*the bar declutters the page*), and on the local data
  it hides nothing; a test pins that an absent `?order=` filters what is published.
- **search.md § Prioritised currently argues the opposite** (*"Not the default … a reader who has
  not asked for a filter should not have results kept from them"*). That paragraph gets Greg's words
  and the reversal, rather than being quietly deleted — the same treatment it gave the
  reference-list argument before it. The concern it names is what the lower bar answers: at 30,
  by default, nothing a reader typed a question for is kept from them on the local data.

## The quote stroke, which is tied to the bar on purpose

`QUOTE_HEAVY_AT = QUOTE_BAR_DEFAULT` — the heavy stroke in the prose starts where the bar rests.

**The stroke keeps 0.80 as a number of its own.** The reason is what the reader sees *at rest*
(Fable's argument, which is better than the first draft's "88% heavy is too many"): tied, every
quote visible by default would be heavy, so the stroke's coarse split would be idle in exactly the
state most readers ever look at, and only start working once somebody dragged the bar down.
Decoupled, the 0.60–0.80 band draws light beside the heavy ones without anyone touching anything,
so thickness means something on first open. The fade (`quoteAlpha`) already carries the continuous
signal; the tier's one job is a visible split.

**What the two controls still agree on** is order, not position: raising the bar removes *scored*
light quotes before scored heavy ones, because both read `priorityOf`. Unscored quotes stay light
and survive every bar (`survivesThreshold`), and the bar snaps to real scores, so there may be no
stop at 0.80 at all — the first draft's *"raise the bar to 0.80 and what survives is exactly the
heavy strokes"* was false on both counts (GPT Sol, Fable). *"At the bar's resting position every
quote on the page is heavy"* goes from the `QUOTE_HEAVY_AT` header, quotes.md § The stroke and
`quote-marks.test.ts`, whose comment says the two must never part company.

Note also that the default **rank** for quotes stays `document`, on Greg's explicit instruction when
he asked for the mode (params.ts § `rankParam`). 3Z is about the bar, not the order; only Search's
order changes.

## Stages

One stage: four constants, one parser default, the stroke decoupled, tests, docs.

1. **Tests first, red.** Exact boundaries rather than "most, not all" (which search at 30 and a
   snapped quote bar can both contradict — GPT Sol):
   - `url-state.test.ts`: `orderParam.defaultValue` is `"prioritised"`, and the test's name stops
     saying the default is the article's own order.
   - Per mode, a score just above the new default survives it and one just below does not
     (`applyThreshold` with the panel's own `priorityOf`); `QUOTE_HEAVY_AT` is `0.8` and a quote at
     `0.7` clears the default bar while drawing light.
   - **SearchMode, rendered**: with no `?order=` in the URL, a meaning search with hits at
     confidence 20 and 60 publishes only the 60 one as passages (what `Reader` draws in the prose);
     with `?find=` and `match=words`, every literal hit is published; a URL with `?conf=80` and no
     `?order=` filters at 80 (the accepted dormant-`conf` case).
   Watch each fail before the change.
2. **The change.** The four constants, their header comments (the new number and the measurement
   that set it), `orderParam`'s default and header, `QUOTE_HEAVY_AT = 0.8` with its comment.
3. **Existing tests that assumed the old numbers** — `quotes-panel.test.ts` § the constants (the
   snap example at 0.80), `quote-marks.test.ts` § how heavily each quote is drawn (its comment),
   and whatever `glossary.test.ts` / `citations-panel.test.tsx` fixtures sat between the old and
   new bars. Each is fixed by moving the fixture, not by loosening the assertion.
4. **Docs.** search.md § Prioritised (the reversal, Greg's words) and the URL table; glossary.md's
   `0.30`; quotes.md (the `0.80` bullet, § The stroke, § The first real run, § What is still open);
   citations.md's `0.40`; url-state.md's `order` row. And the stale **"three thresholds"** copy,
   which has been wrong since Citations arrived: threshold.ts and threshold.test.ts headers,
   glossary.md, SearchPanel.tsx — four callers, and Debate's categorical bar beside them.
5. **Gates.** `npm run typecheck`, scoped vitest on the touched suites, then the full suite once
   through `scripts/tmux-job.ts`. GPT Sol code review, workspace-write.

## The simpler option passed over

**Lower only the numbers and leave the stroke alias.** One fewer edit, but it quietly turns the
prose stroke into near-uniform heavy on every article — a visible regression in a different feature
that nobody asked for. Decoupling is one line.

## What would make this wrong

- **The local corpus is not the production one.** 13 glossaries and four quote sets is a small
  sample; if production scores run lower, 0.10 could still hide more than "most". The slider remains
  the feedback loop, and a follow-up measurement on production (Greg has the credentials) would
  settle it.
- **The means hide a floor.** At the new defaults one local glossary still loses 43% of its terms
  (min 0.57) and one quote list 52% (min 0.48). Both are articles whose scores run low across the
  board; an absolute bar is the right shape for the other twelve, and the slider is one drag.
- **Search at 30 hides nothing locally**, so the slider opens on *"Nothing is hidden"* in most
  searches. That is honest and cheap; the alternative, 40, is no different on this data.

## Evidence

The four queries, run with the scratchpad script `q.mjs` (a `pg` client on
`postgresql://postgres:postgres@127.0.0.1:54362/postgres`). The three artefact queries all begin
with the join through the article's current-revision pointer; this is the glossary one:

```sql
with d as (select a.slug, r.glossary x
           from spideryarn.articles a
           join spideryarn.article_revisions r on r.id = a.current_revision_id
           where r.glossary is not null),
items as (select d.slug,
                 (e->>'difficulty')::float * (e->>'centrality')::float s
          from d, jsonb_array_elements(d.x->'entries') e),
t as (select unnest(array[0.05,0.08,0.1,0.12,0.15,0.2,0.25,0.3]) th),
g as (select slug, th, avg(case when s is null or s >= th then 1.0 else 0 end) share
      from items, t group by slug, th)
select th, round(avg(share),2) mean,
       round(percentile_cont(0.5) within group (order by share)::numeric,2) med,
       round(min(share),2) mn
from g group by th order by th;
```

For Citations the same query uses `r.citations`, `x->'citations'`, and
`(2 * relevance + influence) / 3`; the arithmetic yields null unless both scores exist, matching
`CitationsPanel.priorityOf` and the shared unscored-survival rule.

Quotes needs one additional step because the panel snaps the nominal bar to the nearest score in
each article, with ties downward. This is the query that produced the Quotes table:

```sql
with d as (select a.slug, r.quotes x
           from spideryarn.articles a
           join spideryarn.article_revisions r on r.id = a.current_revision_id
           where r.quotes is not null),
items as (select d.slug,
                 greatest((q->>'importance')::float, (q->>'striking')::float) s
          from d, jsonb_array_elements(d.x->'quotes') q),
t as (select unnest(array[0.5,0.6,0.65,0.75,0.8]) th),
snapped as (
  select l.slug, t.th,
         (select i.s from items i
          where i.slug = l.slug and i.s is not null
          order by abs(i.s - t.th), i.s
          limit 1) bar
  from (select distinct slug from items) l cross join t
),
g as (select i.slug, s.th,
             avg(case when i.s is null or i.s >= s.bar then 1.0 else 0 end) share
      from items i join snapped s on s.slug = i.slug
      group by i.slug, s.th)
select th, round(avg(share),2) mean,
       round(percentile_cont(0.5) within group (order by share)::numeric,2) med,
       round(min(share),2) mn
from g group by th order by th;
```

Search is stored outside article revisions, so its run id and article id are the grouping key:

```sql
with items as (
  select article_id, id, (h->>'confidence')::float s
  from spideryarn.search_runs, jsonb_array_elements(hits) h
  where status = 'done'
),
t as (select unnest(array[10,20,30,40,50]) th),
g as (select article_id, id, th,
             avg(case when s is null or s >= th then 1.0 else 0 end) share
      from items, t group by article_id, id, th)
select th, round(avg(share),2) mean,
       round(percentile_cont(0.5) within group (order by share)::numeric,2) med,
       round(min(share),2) mn
from g group by th order by th;
```

## Progress

- [x] Plan reviewed by GPT Sol — `-plan-review-sol.md`: revise (remeasure on current revisions,
  accept and test the dormant `?conf=`); both done. Fable arbitrated the stroke and "most".
- [x] Tests red — `prioritised-defaults.test.ts` 6 of 6 on the old values;
  `search-opens-prioritised.test.tsx` 2 of 4 (`60,20` for `60`; 2 for 0), preconditions green.
- [x] Change made, tests green — 22 scoped files; typecheck exit 0. Three existing tests pinned the
  old values (citations pin, glossary "nearly" fixture, a doc link) and were moved, not loosened.
- [x] Docs
- [x] Code reviewed by GPT Sol — `-code-review-sol.md`: approve after fixes, no behavioural defect;
  its fixes were evidence and stale copy. One of them reversed a "respectively" in
  `quotes-panel.test.ts`, corrected by hand.
- [ ] Full suite
- [ ] On `dev`, feedback note written
