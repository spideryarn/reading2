# Debate: the themes the sources share, and the key sources

Status: **built; plan reviewed by GPT Sol (build with changes, all P1s taken); code review pending.** Report SPIDERYARN-READING2-6M, from Greg's own
account, 2026-09-30.

## What Greg asked

> In Debate mode, I wonder if there's a way to somehow highlight key themes from other people and
> commentary and whatever, and key nodes, i.e. the critical papers that really responded or moved
> things forward or take a different view or whatever.
>
> (I might have already suggested this)
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-6M)

## Is it a repeat? Partly, and here is the line

He had not asked for this before. The nearest report is 5P
([260929h](260929h-debate-mode-clearer-sources-and-orders.md), shipped 2026-09-29), which asked for
clearer sources and for orders. What 5P built, and what it already covers:

- **by claim** groups the sources under the article's own sentence each one answers. That is a
  grouping by *the article's* claims, not by what *the sources* talk about.
- **stance** puts critical sources first, and each row's AI line says *disputes / qualifies /
  extends / corroborates*. That already marks "takes a different view" per row, but it does not
  pick any source out as one that matters more than the rest.
- **prioritised** and the relevance bar order by how directly a page bears on its claim. That is
  relevance, not importance.

**What is missing, and what this builds:** (1) the threads that *several sources* pick up, across
the claims they answer, and (2) a few sources picked out as the key ones, each with why. Nothing in
the data says either today.

## What the data looks like, which shapes the design

Read-only from production, 2026-09-30, every stored debate with three or more rows: **nine distinct
articles, 3–6 rows each, and none with a single reply to the piece itself** (group one is empty on
all nine; every row is about a claim). So a "theme" here is drawn from at most six sources, and
the searches, not this step, decide how many there are. That argues for:

- a **small** synthesis: at most four themes, and about one key source per three rows;
- **no new search.** A pass that went looking for "the landmark papers of this field" is the other
  way to read Greg's *key nodes*, and it is deferred below: it is a new paid search with its own
  verification problem, and the cheap half should show first whether this is useful at all.

## The design

### Server: a third call inside the `debate` step

After passes A and B have kept their rows, one more call — **no web search, no tools** — reads the
kept rows and answers two questions:

1. **Themes**: threads at least two *different works* come back to. A label (the sources' own key
   term) and one plain sentence. At most four.
2. **Key sources**: at most `min(3, max(1, floor(works / 3)))`, one per work, each with a role and
   one sentence:
   - `responds` — takes on the article or its claim directly (tests it, replicates it, answers it)
   - `advances` — moves the question on: new evidence, a method, a next step
   - `dissents` — takes a different view from the article's
   - `origin` — the original work the claim comes from. Not one of Greg's three: added after the
     first measured pass, where the model filed *"the original study behind the article's 67%
     figure"* under `responds`, which is false.

**Code checks what the prompt asks for**, in one place for both sides of the wire
([src/debate-synthesis.ts](../../src/debate-synthesis.ts) § `settleSynthesis`): every id must be a
kept row; a theme needs rows from **two different works**; a key source is one per work; roles are
a closed set; labels and sentences have length caps; theme ids are unique spideryarn ids; extras
past the caps are dropped. Each check drops one item. **A work** is a conservative identity: two
rows are one work when their addresses match once the obvious aliases are gone (`www.`, trailing
slash, query, arXiv `abs`/`pdf`/version) or their titles match once case, punctuation and a
trailing `| Site` are gone. It catches both copies the first pass grouped; a pair it misses is
still two pages.

**Stored on the debate artefact** as `synthesis`, a union with every state named:
`made` (either list may be empty, but only when the model offered nothing), `too-few` (fewer than
three rows — nothing asked), `failed` (asked; refused, cut off, unreadable, malformed, or nothing
it offered survived the checks). **Absent** means *searched before this existed*.
`readStoredSynthesis` runs the stored value back through the same `settleSynthesis` on the way out
of the database; a `made` without both lists reads as `failed`.

**Its failure does not fail the step** — the one exception to `src/debate.ts`'s rule that every
failure is total. That rule exists because a half-artefact from the *searches* says something
false (*"nobody replied"* over a pass that broke). Here the rows are complete and verified before
the call runs, and a failure is stored as `failed`, which the panel names. Throwing the rows away
would spend two web searches to protect a label. **Only the provider's refusal is degraded**: an
abort, a transport error, a missing key or a bug still throws and fails the step, as from a pass.

**Same job, same meter**: the call goes through `openRouterJson("debate", …)`, so its cost lands
on the `debate` step's ledger row with no new cost category, on the same capable model the passes
use (`modelFor("debate", power)`), so High-powered AI applies to it too.

**Prompt version** `debate/4`. `isStale` reads only `sourceHash`, so an older debate is not stale;
it simply has no `synthesis` until it is re-run from Metadata (plan 260929c: no older-prompt banner).

### Client: a *threads* box above the list, and a mark on the key rows

Owner only (below), and only when `synthesis.kind === "made"` and at least one list is non-empty.

```
 ┌ Threads across these sources · AI ─────────────────────────────┐
 │ [ Key sources · 2 ]                                             │
 │ [ meta-learning and compositionality · 2 ]  Two papers re-exa… │
 │ [ human vs. model data efficiency · 2 ]     Both sources agre… │
 └─────────────────────────────────────────────────────────────────┘
   Showing 2 excerpts on "meta-learning…" · show all
 ┌ row ─────────────────────────────────────────────────────────── ┐
 │ ★ Key source · takes a different view — It re-examines the …   │
 │ Fodor and Pylyshyn's Legacy – Still No Human-like …             │
```

- **Pressing a thread filters the list to its rows**; pressing it again, or *show all*, clears it.
  *Key sources* is the same kind of button over the key rows. One thread at a time.
- **It lives in the URL**, `?debatethread=<theme id>` or `?debatethread=key`, `replace` history, because
  url-state.md: nothing the reader can change lives in `useState`. Themes get an id from `mintId`
  when the answer is read, so the parameter names a theme rather than a position. An id that is
  not in this debate (after a re-run) parses and then matches nothing, and the panel treats it as
  no filter.
- **The filter runs after both bars**, as a third narrowing, and **every count follows it**: the
  head count, the *Showing …* line (in `headCount`'s words, excerpts and pages) and the foot's
  pages-behind-these-rows sentence, because the panel's rule is one result for every number. The
  foot's *kept N of M* sentence is about the search and does not move. An unpressed thread whose
  rows the bars have all hidden shows `0` and is disabled; a **pressed** one in that state says so
  in the open (*"The bars above are hiding every source on this thread · show all"*) and stays
  pressable.
- **A key row carries a line at its top**: `★ Key source · <role> — <why>`, labelled AI like the
  row's other reading. Role words: *takes it on*, *moves it forward*, *takes a different view*,
  *where the claim comes from*.
- **`failed` says so**, in one quiet line where the box would be: *"The AI could not pick out the
  threads these sources share this time. Every source it found is still listed below."* `too-few`
  and an older debate draw nothing, because there nothing was asked. (`failed` is also logged.)

### Visitors

**Not in this change.** The public DTO is a security defence (security-map.md § Where the defences
physically live) and builds a visitor's debate field by field, so `synthesis` does not cross. An
unattended run does not edit a defence. Widening it is one field and a re-check of ids at the
boundary; it is written up for Greg in the feedback note.

## Measured

`evals/debate/themes.ts` runs production's own `synthesiseDebate` over stored debates. Two passes
over the nine, 2026-09-30, on Sonnet 5, about ten seconds a call:

- **First prompt**: 8 of 9 answered. One ran out at a 2,000-token ceiling (`finish_reason:
  length`) — raised to the passes' 8,000. Two themes were one paper on two sites (arXiv and its
  project page; arXiv and the ACL Anthology) — the prompt now says two copies of one work are one
  work. One `responds` was really `origin` — the role was added. Three key sources on a six-row
  debate felt like half the list, not a pick — the cap went from rows/2 to rows/3.
- **Second prompt**: 9 of 9 answered. 13 themes across 8 debates; the one with none (two works,
  each on two sites) was right to have none. Every theme's rows span two different works by a
  read of the titles. Key sources: 13, one or two per debate. Read against their passages, 12 of
  13 roles are right; the thirteenth, a paper that *"restates the exact figure"* the article
  quotes, is filed `responds` and is more likely `origin`.

Cost: not separately metered by the eval (no spend collector open); the input is under 3,000
tokens and the answer a few hundred, so a cent or two on top of a debate's ~$0.25.

## The plan review

GPT Sol, read-only, 2026-09-30:
[prompt](260930j-debate-themes-plan-review-prompt.md) ·
[answer](260930j-debate-themes-plan-review-sol.md). **Build with changes**, no P0. Taken:

- **F1** a `failed` synthesis drew nothing, so *asked and failed* looked like *never asked* → the
  quiet line above.
- **F2** a malformed answer (`{}`, lists of the wrong type, everything dropped) was stored as an
  empty `made`, which reads as a finding → `failed`.
- **F3** "two works" was enforced only as two literal URLs → the work identity above, which also
  sets the key-source cap and its one-per-work rule.
- **F4** the stored reader re-checked row membership only → it now runs the same `settleSynthesis`.
- **F5** every non-abort error was swallowed as `failed` → only `ProviderRefused` is; `content` is
  checked to be a string.
- **F6** the foot's pages sentence and the *Showing* line did not follow the thread → they do.
- **F7** a pressed thread the bars empty now says so on screen, not in a tooltip.
- **F8** `?dbtthread=` → `?debatethread=`, beside `?debateby=`.

**Not taken — F9**, a simpler v1 with no filter (the box informational only). It would shed the
URL state and the counting rules, and it is a fair call on a 3–6 row list. Kept the filter because
Greg asked to *highlight* the key sources and themes, and pressing one to see only its sources is
how a list of six becomes two you can compare; the machinery is small and tested.

## In a browser

A Sonnet subagent, Playwright on the box, 2026-09-30, one real search on a local article
(`claudes-constitution-spya-cr8bzk`: 4 sources, 1 theme, 1 key source; 134 s, three calls,
$0.28): the box renders above the list, pressing a theme filters it and writes `?dbtthread=`
(renamed since), *show all* clears it, the filter survives a reload at both widths, the key row
carries its line, no overflow at 1280 or 390, and on a phone the first source is still on screen
below the box. Shots: [1280](260930j-shot-threads-1280.png) ·
[1280 pressed](260930j-shot-threads-pressed-1280.png) · [390](260930j-shot-threads-390.png) ·
[390 pressed](260930j-shot-threads-pressed-390.png). Taken before the review's changes; the only
visible differences since are the *Showing* line's wording and the failed line.

## Stages

1. **Server** — types, `src/debate-themes.ts`, `synthesiseDebate`, `debate/4`, theme ids, tests
   for `readSynthesisAnswer`, `readStoredSynthesis` and `keyCap`. *(Mostly spiked.)*
2. **Client** — `?debatethread=`, the threads box, the filter, the key line; tests for the pure
   filtering function; a browser check of a debate with a synthesis on it, at 1280 and 390.
3. **Docs** — reading-view-overview.md's Debate line; the feedback note.

## Simpler options passed over

- **No model at all**: badge rows from fields we already have (`disputes` + `bears: directly` →
  "takes a different view"). Cheap, but it repeats 5P's *stance* order and says nothing about
  themes, which is half of what Greg asked.
- **Fold it into pass B's prompt**, no third call. Pass B does not see pass A's rows, and it
  answers *before* verification drops rows, so a theme could point at a row that was then refused.
- **A separate pipeline step** (`debate-themes`) so an existing debate could gain themes without
  re-searching. Cleaner for old articles, but it means a new artefact column, a migration, a step
  in `STEP_ORDER`, Metadata's re-run rows and the reset lists — a lot of plumbing for a call that
  costs a cent inside a step that already costs 25. Worth doing if Greg wants themes on old debates
  without paying for a search.

## Deferred

- **A search for the field's landmark works** — the other reading of *key nodes*: papers that
  moved the question, whether or not this search's few pages mention them. A new paid search pass
  with its own verification problem (importance cannot be checked against an extract).
- **Visitors** see threads: one field across the public DTO, Greg's call.
- **Themes on an old debate without a re-search**: the separate step above.
- **Marks in the prose** for a theme's claims: Debate has no marks at all yet (260905f).
