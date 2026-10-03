# Citations: influence is unknown unless the model is confident, and Dig deeper fills it in

Up: [plans.md](../project/plans.md) · the mode: [citations.md](../project/citations.md) · follows
[261003j](261003j-citations-say-only-what-the-bibliography-supports.md), which asked the question

Each Citations row has an *influence* bar: how well known the cited work is in its own field. It
comes from the model's memory, not from the article, and it feeds the default *prioritised* order.
261003j asked Greg whether to keep it ([Q-influence]). His answer, 2026-10-03:

> Q-influence Hmmm, I'm torn. Maybe if the model is confident (e.g. because it's well-known), but if
> in doubt default to Unknown. And if we do a deeper dive on a Citation, try and populate it then.
>
> — Greg, 2026-10-03

## What is there today

- The list prompt (`SYSTEM` in `src/citations.ts`, `citations/5`) **requires** `influence` on every
  row and says: *"0.1: obscure, or you do not know it. When you do not know the work, say so with a
  low number rather than guessing high."* So "I do not know this work" and "this work is obscure"
  are the same number, and both pull the row down the *prioritised* order.
- `influence` is already optional on a stored row (`CitedWork.influence?: number`), for a score the
  model left out or wrote out of range. A row without it draws no influence bar at all, says nothing
  about why, and **survives every position of the threshold bar** (`priorityOf` returns nothing, and
  `threshold.ts` always shows an unscored item).
- *Dig deeper* searches the web for the work, runs a quick check, reads the paper when it can, and
  streams an answer. Nothing in it says anything about influence.

## What changes

### Stage 1 — the list: a number only when confident, otherwise unknown

1. **The prompt.** `influence` becomes *a number, or null*. A number only when the model actually
   knows the work and is confident of its standing, for example because it is well known; null
   whenever it is in doubt. A low number now means *I know this work and it is minor*, never *I do
   not know it*. The wording follows [prompting-guide.md](../project/prompting-guide.md); the field
   stays required in the schema and becomes nullable (`anyOf: number | null`), which is the shape
   both providers' strict subsets accept. `PROMPT_VERSION` goes to `citations/6`.
2. **Reading it.** null is stored as an absent `influence`, exactly the shape an unscored row
   already has, so no stored type changes. A new counter on the step's log line,
   `influenceUnknown`, is separate from `influenceAbsent` (the model left the field out) and
   `influenceRejected` (out of range). When two drafts of one work fold together, a known influence
   beats an unknown one (`maxOf` already does this).
3. **The row says Unknown plainly.** Where a row has relevance but no influence, the quiet line
   draws the relevance bar and then the words *influence unknown*, with a tooltip saying the model
   was not confident it knows the work, and that *Dig deeper* will look. Not a bar at zero, and not
   silence. The hover card draws no scores today and still draws none.
4. **The prioritised order.** It is the first-cited order with the rows under the threshold bar
   taken out; a score never moves a row, it only hides one. Today a row missing either score
   survives every position of the bar. That was written for the rare unscored row; with unknown now
   common it would stop the bar hiding anything. So: **a row with unknown influence is thresholded
   on its relevance alone** (`priorityOf` returns `relevance`), and a row with both keeps
   `(2 × relevance + influence) / 3`. A row with no relevance still always survives.
   **What this assumes, said plainly** (GPT Sol, F8): scoring on relevance alone is the same
   arithmetic as assuming the work is exactly as influential as it is relevant. So at relevance 0.30
   an unknown row clears the default 0.25 bar while a row known to be minor (influence 0.10) scores
   0.23 and does not. That is the intended direction, not knowing is not evidence against a work,
   but it is not neutral. The alternative Sol offered, thresholding every row on relevance alone,
   is simpler and changes the default order for every list; it is a product change nobody asked
   for, so it is **[Q-bar-on-relevance]** below rather than built.
5. **The influence order.** Known influence first, descending; then the unknown rows, **by
   relevance, descending**; first-cited order breaks ties. (Today the unscored rows trail in
   first-cited order.)
6. **The words around it.** The band's (i), the threshold bar's `title`, chat's `article_citations`
   tool (which prints *influence not scored* today for a missing score: it should say *unknown*), the two
   help pages, and citations.md.
7. **Old lists.** A list made by `citations/5` keeps its numbers until it is made again from the
   Metadata page. Nothing is hidden and nothing re-runs by itself, as with every prompt bump here.

**Store when it happened:** the list already carries when it was made (the artefact's own stamp),
and nothing new is stored in this stage.

**Measured before and after**, with `evals/citations-influence.ts` (new), which calls production's
own list function, never a copy of the prompt:

- *Before*, free: over the stored `citations/5` lists, the spread of influence numbers, and how many
  rows sit at or below 0.15, which is where "I do not know it" was told to go.
- *Before*, paid: the old prompt run again on three local articles, twice. The second run is the
  control: how much two runs of one prompt disagree about a row.
- *After*, paid: the new prompt on the same three, twice. Counted: how many rows say unknown; of the
  rows that got a number, how many are the same works that got a high number before.
- *Are the confident ones actually well known?* Every row given a number is listed with its title,
  authors and year, and read by hand; a sample is checked on the web by a Sonnet subagent (does the
  work exist, and is it widely cited) so the check is not my own memory agreeing with the model's.
- Budget: a few dollars. The write-up goes in `docs/investigations/`.

### Stage 2 — Dig deeper fills influence in, from what it finds on the web

One press of *Dig deeper* already runs a forced web search for the work. **One small JSON call**
(`citation-influence`, on `DIG_DEEPER_MODEL` like every other call in the press whose output the
reader reads, no tools, a strict schema through `withChatJsonSchema` with every field required and
nullable) is shown the work's title, authors and year and the search's own pages
(`findings.sources`), numbered and fenced as evidence, and asked for:

- `influence`: a number 0–1 on the same rubric as the list's, **only from what one page says about
  this work's standing** (a citation count with enough context to read it, "seminal", "widely
  cited", an award, a standard textbook), or null when no page says, or when a bare count has no
  context;
- `source`: the number of the one page it rests on;
- `quote`: the words on that page it rests on.

**Where it sits** (F3, F4): after the press's final `prepare()`, using `prepared.context` (the
fresh title and authors, and the fingerprint the answer is saved under), and **alongside the
paper's passages call, both settled before the stream starts**. So it never outlives the press's
allowance, there is nothing to cancel when the stream fails, and when the paper was read it adds no
waiting. It has its own short deadline and is best-effort: a failure, a refusal or a timeout stores
no influence and never fails the press. The progress line names the step.

**Code decides what is kept**, as everywhere else in this mode:

- the source is chosen by index among this press's own search results; its URL and title are
  copied by code, never written by the model;
- **the page must be a page about this work, not merely one that mentions it** (F1): its title
  names the work by the quick check's stricter rule (`resultIsTheWork` in `citation-lookup.ts`:
  the result's title begins with the work's, no "Comment on …"), so an untitled result or a review
  that lists many works cannot be the source. This is deliberately narrow;
- the quote is found in that page's extract by the strict `"spaced"` pass, at least a few words and
  bounded in length (`verifyQuote`'s rules), and what is stored and shown is the extract's own
  slice;
- the number is finite and within 0–1.

**What that does not prove**, written here and on the row: a page about the work can still quote a
figure that belongs to something else on it. Code checks the page and the words, not what the words
are about. So the row calls it *an AI estimate from web evidence* and shows the quoted words, so
the reader can judge. The test suite carries Sol's counter-example ("Target Work … Other Work has
8,000 citations" on a page not about the target) as a negative.

**Stored** on the press's own row in `citation_investigations`, as new nullable columns: the
number, the quote, the source's URL, the source's title, and `influence_version` (F7), a small
stamp of this call's prompt and checking rules, so a later correction can drop old scores without
hiding the streamed answers beside them. CHECKs: number, quote, URL and version are all null or all
present (the title follows the URL but is copied, F5); the number is within 0–1. The row's `at` is
when the press finished, so *when it happened* is stored. An additive migration; rows from before
it are all null and drawn as before.

**One read path** (F6): a shared, browser-safe `effectiveInfluence(work)` returns the value and
where it came from: the web one when the row has a kept, current *Dig deeper* answer whose
influence carries the current version, else the list's own, else unknown. The bar, the threshold,
the influence order, whether that order is offered at all, and the owner's chat tool all read it.
The list's own `influence` is never overwritten, so a visitor, who never has a *Dig deeper*
answer, sees the list's value. The web value replaces the model's memory on that row, known or
unknown, because it has a source and the memory has none. It lives and dies with the kept answer.

**Shown.** The bar, and beside it *from the web*, with a tooltip: *an AI estimate from web
evidence*, the host, the quoted words and the day.

`CITATION_INVESTIGATE_VERSION` is **not** bumped: the streamed answer's prompt does not change, and
bumping would hide every kept answer. An answer kept before this has no influence, and *Dig deeper
again* gets one.

The lease and `INVESTIGATE_PRESS_BUDGET_USD` are re-derived for the extra call (its deadline joins
the lease; its worst case joins the budget's arithmetic, and the global fuse is recomputed if the
budget moves). The SSE event validation and the three exports cover the new fields.

**A probe before it is called done**: on about eight local works, some famous and some obscure,
run the search and this call and count how often a usable, checked statement of standing comes
back, and why the rest were refused. If it is nearly never, that is a finding for Greg, and the
write-up says so. It goes in the same `docs/investigations/` note as stage 1's numbers.

## Passed over

- **Simpler: drop influence** (261003j's option C). Greg's answer keeps it.
- **Simpler: keep one number and only reword the prompt** ("be honest, go low"). That is what
  `citations/5` already says, and it is the thing that makes unknown and obscure look alike.
- **Simpler for stage 2: let the streamed answer mention influence in prose.** It would not be
  stored as a number, could not feed the order, and would have no checked source.
- **Larger: a real citation count.** Crossref returns `is-referenced-by-count` for a DOI, and the
  shared lookup already calls Crossref. It is a fact with a source, which is better than any model's
  reading. Passed over for now because it covers only rows with a DOI, a raw count needs a
  per-field scale to become a 0–1 bar, and Greg asked for the deeper dive to fill it in. It stays on
  citations.md's deferred list as the better long-term source, and stage 2's stored shape (a number
  plus where it came from) fits it. **[Q-crossref-count]** below.
- **Larger: an `unknown` discriminated union on the stored row.** An absent `influence` already
  means "no number", every reader of the field already handles it, and the export and the public
  DTO would both change shape for no gain.

## Questions for Greg (none blocks the build)

**[Q-crossref-count]** Should a row with a DOI show the registry's real citation count (for example
*cited 4,512 times, Crossref*) instead of, or beside, a 0–1 bar? It is free, sourced, and needs no
press. Recommend yes, as a follow-up, shown as the count itself rather than squeezed onto a bar.

**[Q-bar-on-relevance]** Should the threshold bar use relevance alone for every row, leaving
influence as its own order and its own bar on the row? Then no row's place under the bar depends on
a number from memory, and unknown needs no special case. It would change which rows the default view
hides on every list. Not built; as built, only an unknown row is judged on relevance alone.

## Stages

1. The list prompt, the reader, the row, the orders, the words, the before/after measurement and
   its write-up. GPT Sol code review. Commit.
2. The `citation-influence` call, its checks, the migration, the store, the row, the export, the
   docs and help. GPT Sol code review. Sonnet browser check of both stages. Commit, push.

## Review log

### GPT Sol's plan review

[The review](261003m-citations-influence-plan-review-sol.md): *build after fixes*, nine findings.

| | finding | what was done |
|---|---|---|
| F1 (P1) | title-anywhere plus quote-anywhere does not show whose standing the quote is about | the source must be a page about the work (`resultIsTheWork`'s rule); the remaining limit is stated on the row and here; Sol's counter-example is a test |
| F2 | `findQuote` defaults to the forgiving pass | the strict pass, bounded, a 0–1 CHECK, `withChatJsonSchema`, all fields required-nullable |
| F3 | a call started straight after the search could judge a stale row under a fresh fingerprint | it runs after the final `prepare()`, on `prepared.context` |
| F4 | a parallel call could outlive the allowance | it settles before the stream starts, beside the passages call |
| F5 | a search result need not have a title | moot for a kept source (F1 needs a title), and the title is copied by code and left out of the presence CHECK |
| F6 | the web value needs one read path, and chat and the order menu read the list's field | `effectiveInfluence`, used by all of them; the list's field is never overwritten |
| F7 | no version on the new assessment | `influence_version` |
| F8 | relevance-alone quietly assumes influence equals relevance | kept, as the brief asks, and said plainly in stage 1 item 4; the simpler alternative is [Q-bar-on-relevance] |
| F9 | two descriptions of today's code were wrong | corrected |

Also taken: the stage-2 probe, the list's rubric reused in the new prompt, and the label *an AI
estimate from web evidence*.
