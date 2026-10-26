# Sources becomes three chips, on a cost ladder, with experiments beside it

Written 2026-10-25. Acts on Greg's answer to [q-vg2b69](../user-feedback/questions/q-vg2b69.md)
(report `spya-w95xmq`), about the proposals in
[261025c](261025c-sources-proposals-what-it-shows-first-and-fewer-sub-modes.md), whose evidence is
the six-article trial [261025a](../investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md).
The mode is [sources.md](../project/sources.md).

> I'm not totally sure what's best or that I fully understand the proposal. Here's what I'd suggest:
> if there's something we can do for free, great, let's do that proactively. If there's something
> that's going to cost money, only do that when we open the sources mode. If it's going to cost a
> lot of money, like per citation or something, then maybe we only do that when the user requests
> something for that citation rather than proactively.
>
> I mean ideally a mode would only cost a few cents. Given this is an important mode, you know, if
> it costs $0.30, okay, but then that should be upon user request. Do an eval to see if we can get
> away with using Haiku more heavily, with maybe Opus for anything that we think requires
> intelligence. And you know, yeah, be proactive if you think things can be unified into one
> submode. Great, let's do that.
>
> I think take screenshots, ask sub agents to take on the personas of UI/UX experts or product
> managers or researchers or naive users to look for things that might be confusing or where we can
> improve them, if you think that's worth doing. And if in doubt, I think it's cheap to create new
> experimental submodes that I can play around with, that each showcase left field ideas, some of
> which might have the seed of something really good. So I'd encourage that proceed autonomously,
> and I'd rather play than discuss.
>
> — Greg, 2026-10-25 (answer to q-vg2b69)

## What this does, in one paragraph

For the owner, Sources goes from six chips to three — **Where it sits**, **Bibliography**,
**Links** — and *Where it sits* is the default. It opens on two free lists (what came after the
piece, what it leans on) with *Search the literature* (the dossier, out of the experimental switch)
as one press; once pressed, the dossier is what it shows first. Reception, Claims, Not cited and
Investigate stop being chips and become four tools reached from inside *Where it sits*, at the
addresses they have now. Two identity fixes make the free lists right on the trial's hard cases. An
eval decides how much of the dossier Haiku can do. Behind the experimental switch, two free
left-field sub-modes for Greg to play with. Persona reviews of screenshots at the end, and their
fixes. **Visitors keep the band they have today** (this iteration; Sol's F3).

## The cost ladder, as built

| Rung | What | When it runs |
|---|---|---|
| Free | Bibliography (made on import; *Where it sits* arms it if missing, as the Bibliography chip does), Links, *After it* (OpenAlex citers), *Before it* (Bibliography's most relied-on works) | On opening Sources, no press |
| Free, but sends the article's opening | Not cited | Still on its own press: the reason is [privacy](../project/privacy.md#crossref-datacite-and-openalex-are-sent-a-doi) (a referee's confidential upload), not cost |
| A few cents | Claims' list; Reception's search ($0.05–0.07) | Each on its own button inside its tool, no longer on a chip press |
| About $0.30 at standard power, about $0.52 under high-powered AI (Stage 3, from the eval; $0.26–0.48, mean $0.33, in the trial before it) | *Search the literature* (the dossier): Sonnet plans, Haiku shortlists, Sonnet writes; Opus plans and writes under high-powered AI | Only on its press; allowance four an hour, twelve a day per reader, 100 a day across everyone (`SITUATE_RATE_POLICY`). Never on open, never on import |
| Per item | A finding's *Ask in chat*, a claim's check, a cited work's chat | Only when the reader asks about that item |

Greg's "cheap paid work may run when Sources opens": nothing paid needs to. If the eval brings the
whole dossier to a few cents, running it on open is a follow-up for Greg to try, not something this
plan switches on.

## Decisions taken without asking (Greg: "proceed autonomously")

1. **B+**, as recommended in 261025c: lists first until you ask; after that, the dossier first.
2. **Identity rule 1, twin records** (Sol's F9): two OpenAlex records with the same whole title, at
   least two of the same authors (all of them when the piece has fewer than two) and publication
   years within one are one work. The confirmed work becomes one or more OpenAlex ids, carried through
   `confirmedWorkOf`, `citersOf`, `situateCiters` and the cache, and asked with OpenAlex's union
   filter `cites:W1|W2`, so the count and the rows are OpenAlex's own for the union, not a sum.
   Any other pair of passing records stays `none`.
3. **Identity rule 2, the piece's own editions** (Sol's F10): grouped, never hidden. *Other editions
   of this piece* needs real evidence — a title that is a version of the piece's (case, punctuation,
   subtitle, a reprint marker), or an identifier relationship — plus the shared authors. A
   same-author work without that evidence (the Spanish translation, the anthology) goes under *By
   the same authors*, a neutral label, still on screen.
4. **The fixes that need no decision** (261025c): a *Since* finding keeps only sources dated after
   the piece (a finding left with none is dropped, counted); a note that names a work none of its
   sources is, by a title or an author-year mention in code's reach, is cut at that sentence or
   dropped. Prompt version `situate/2`.
5. **The dossier leaves the experimental switch** for every owner, accepting today's Sonnet cost
   (above) before the eval reports (Sol's F14). It is the heart of *Where it sits*. With it goes the
   promotion checklist (F7): the *Experimental* badge and Investigate's copy, the experimental
   registry entry, `sources.md`, `/privacy` (its dossier paragraph and `LAST_UPDATED`, and its
   OpenAlex timing, which says *when Reception is opened* and becomes *when Sources is opened*, in the
   same commit that first fetches citers on open), the pinned privacy tests, and a test of an owner
   with the switch off.
6. **Reception's chip is retired, not its search** (F5). Reception stays a tool with its own Search
   and stale-rerun buttons, its Metadata and command-bar reruns, and its stored rows. A chip press
   no longer reaches it, and the tools row does not arm it. Separately, the dossier gains one
   code-written query in a reserved planner slot — the piece's title in quotes with its first
   author's surname, the shape that found the trial's two real replies — run through the same
   `validateQueries` checks as the planner's (F8), with a hostile-title test.
7. **The parser default becomes `where`** for the owner (F1), and `liftLegacySources` writes an
   explicit `sources=bibliography` for the addresses that meant Bibliography (`?mode=citations`).
   A bare `?mode=sources` or `?mode=peer-review` meant "the mode's default" and now gets the new
   default; that is the intended change. Visitors keep Bibliography as theirs
   (`visitorSourcesView` maps `where` to it).
8. **Where it sits arms Bibliography** (F4) and mounts its hook, since *Before it* is drawn from it.
9. **The dossier's finding focus, the margin's *Open in Sources* and the job's destination move to
   `where`** (F6). A finding's chat carries the finding's id in its origin, so its way back opens
   *Where it sits* on that finding — which is also queue item `qi-mmtsxdhg` (a finding's chat found
   by its id, not its question). Investigate's own questions keep their origin and way back.
10. **After it starts unfiltered** (F15): the citers, most cited first, as today. Where OpenAlex has
   a top keyword for the work and more than about a thousand citers, a labelled second view, *About
   "extended mind"*, sits beside *Most cited*: a reader's switch, not an automatic filter.

## The simpler option taken over the plan's folds

261025c put Reception, Claims, Not cited and Investigate *folded inside* the dossier's page. That
means rendering four panels (one of them 3,384 lines) without their own surfaces, a rewrite of
each. **Instead they stay the panels they are, at the same `?sources=` addresses, and leave the chip
row**: *Where it sits* ends with a row of four plain links, *Tools: Pages about it · Check a claim ·
Close to it, not cited · Ask your own question*, and each of those views carries a *← Where it sits*
link. One exhaustive `chipOf(view)` maps the four tools to `where`, and the chip row's checked state,
`.on` and `useRevealChosen` read it, so exactly one radio is checked for every legal address (F2).
`SOURCES_VIEWS` (addresses) and the chip list become two named lists. If Greg likes the direction,
real folds are a later polish.

```
 ┌ Where it sits │ Bibliography 17 │ Links 4 ┐
 │ A paper from 1998: what has been said since
 │ [ Search the literature · about 45 s ]  …what leaves, and what it costs
 │ After it — 5,849 papers cite it              Most cited | About "extended mind"
 │   Whatever next? · 2013 · cited 4,210  …  ▸ more
 │ Before it — the works it leans on most
 │   Kirsh & Maglio 1994 · Putnam 1975 · Burge 1979 …
 │ Tools: Pages about it · Check a claim · Close to it, not cited · Ask your own question
```

## Stages

Each is committed, pushed to `dev` and leaves Sources working.

### Stage 1 — the lists and the checks made right (server)

Twin records (decision 2) in `src/citation-index.ts`, `src/store/pg-citation-index.ts` and
`src/situate-citers.ts`, with the *Extended Mind* pair as the test; editions (decision 3) in
`src/related-work.ts` and `NotCitedPanel`; the two dossier checks (decision 4) in
`src/situate.ts` § `checkFindings`; the code-written query (decision 6) with its hostile-title test;
`situate/2`. Red tests first, each from the trial's real records. No visible change to the chips.

### Stage 2 — three chips and the free lists (client, with the route behind *After it*)

Decisions 5, 7, 8, 9 and 10, and the tools row. `WhereItSitsPanel`: the head line (the piece's
year, read for *since* or *now*), the dossier when it exists (`SituateDossier`, moved from
Investigate), else the button, then *After it* and *Before it* (order by the year when there is
one; side by side otherwise), then the tools row. *After it* reads the existing
`/api/citers/:slug`, widened with the work's top keyword and, when asked, the keyword view.
Command-bar aliases (`where it sits`, `situate`, `search the literature`), the help page,
`sources.md`, the old-address table, the privacy page. Tests: one checked radio for every legal
`?sources=`; bare Sources, `?mode=citations`, `?mode=peer-review`, Back/Forward and a last-view
restore; an owner with the switch off sees the dossier button; a visitor's band unchanged; a
finding's *Open in Sources* and its chat's way back land on *Where it sits*.

### Stage 3 — the eval, and adopting it (in its own worktree, from now)

Folds in `qi-9bc5xnwn`. Six trial articles. Reader arms on one fixed evidence set each: Sonnet
(today), Haiku, each also on deterministically compressed evidence (shorter extracts, duplicates
out, a token cap: the read's cost is mostly evidence length), Haiku triage then Sonnet writing, and
Opus only if triage helps or budget allows. The planners Haiku and Sonnet compared end to end:
each one's queries run, their evidence's recall of known targets measured (*Rock is Strong*, Adams &
Aizawa), and both evidence sets read by one reader. Scored per finding by a blind Opus judge for
source entailment (a veto), kind and date, directness and novelty, and per dossier for coverage of
what a careful reader would expect (261025a); `checkFindings` counts as diagnostics (F11, F16, F17).
Budget about $10–15, hard stop $25. Written up under `docs/investigations/`. Adoption, if any,
needs a per-phase model and generator stamp (today one power and one `generator` cover both calls,
and `isOutdated` compares one), so it is its own small change after the write-up.

**Result (2026-10-25)**: [261025h eval](../investigations/261025h-situate-eval-haiku-sonnet-opus.md),
$8.96 metered. The planner stays Sonnet (Haiku found 20 of 26 known works against 26, to save two
cents). Haiku alone fails as the reader (half the findings, coverage 2.4 against 3.67). **Adopted:
Haiku shortlists the evidence, then the capable model writes** — Sonnet at standard power (arm C,
about $0.30 an article, unsupported findings 2 against 8 and 3, kind errors 10 against 16–17), and
Opus under [high-powered AI](../project/high-powered-ai.md) (arm D, about $0.52, unsupported 1,
kind errors 1, judged second only to a full Opus read at 80% of its cost). Why not Opus for
everyone: it is $0.52 against Greg's "$0.30 okay", and 60–90 s against 20–40 s while a reader
watches; the setting puts it one switch away, and the debrief says so. The triage is a third call
with its own task (`situate-triage`, pinned to Haiku, thinking budgeted), and the stamp records it.
Two findings changed Stage 1: the *Since* date check catches only 1–2 errors a run (most sources
are undated web pages), and the unsourced-name check was noisy on real output, so it is recorded
as a count and cuts nothing. The OpenRouter key used locally hit its monthly limit at the end of
the run (production's key is a different one).

**Built (2026-10-26)**, with no paid call (the local key was still over its limit), so the first
real triage will be production's. `src/situate.ts` § `generateSituate` makes three calls: the plan,
then `situate-triage` (Haiku 5.5 pinned in `PINNED_MODEL` at both powers; the eval's prompt as
`situate-triage/1`; adaptive thinking at effort `medium` with 12,000 tokens of room), then the read,
shown only the shortlist under the sources' own ids. `checkFindings` still checks against all the
evidence. The dossier records each call's model in `phases`; `isOutdated` compares all three, and
the step's stamp and the metadata page's `isCurrent` arm both ask `phasesOutdated`, the part a
one-model stamp cannot carry. **A `situate/2` dossier from before the triage has no `phases` and
stays current**: its read prompt and checks are today's, and re-running it would buy an economy, not
a fix. `PROMPT_VERSION` did not move, because the read's prompt did not. A triage naming no source
it was shown fails the run with `jb-situate-shortlist` rather than storing an empty dossier.

### Stage 4 — experiments, behind the switch

Two sub-modes, reached from *Where it sits*'s tools row only with the experimental switch on, both
free, both reading the stored dossier, neither storing anything the reader types (F12):

- **Guess first** — before the findings show, the dossier's passages with their kinds hidden: *what
  do you think critics said about this?* — a pause to predict in your head, then *Reveal*. Nothing
  typed, nothing stored.
- **Evidence first** (Sol's suggestion, in place of *Hostile referee*, F13) — each finding as the
  article's passage beside the source's checked quote, the AI's note hidden: decide for yourself
  whether it supports, challenges or updates the passage, then reveal the model's reading. The
  reader does the central step; the model is the second opinion.

Dropped: *Hostile referee* (Referee's ground, not Sources', and not literature-grounded: F13);
*Lineage* (it redraws Stage 2's lists and overclaims influence: F18), unless the screenshots show
the two lists want a timeline.

### Stage 5 — screenshots and personas

A Sonnet browser agent shoots *Where it sits* on the trial articles (before and after a dossier,
the tools, the experiments, a phone width). Four persona subagents read the shots — a UI/UX
designer, a product manager, a research scientist, a first-time reader — and list what confuses or
could be better. Fixes that are clear are made; the rest are listed for Greg.

### Stage 6 — bookkeeping

The question file answered with Greg's words; the report's note updated; the queue items
(`qi-mbh8appj`, `qi-9bc5xnwn`, `qi-mmtsxdhg`) closed or rewritten; docs and `/help` current.

## What is left out, and why

- **Real folds** of the four tools into one page — the simpler links above first.
- **A visitor's *Where it sits*** — it needs a public projection of the citers; later (F3).
- **The dossier on open** — "$0.30 … should be upon user request".
- **`withoutAddresses` eating `AGENTS.md`** — a defence (S3); loosening it is not this job's call.
- **An automatic second, agentic pass** — still `qi-kqqst6vy`, for the reasons recorded there.
- **Semantic Scholar's citing sentences** — Greg decided against it (bibliography.md).

## Review

GPT Sol reviewed the first draft (d386e7340):
[261025h-sources-plan-review-sol.md](261025h-sources-plan-review-sol.md). 13 P1s, five P2s, no P0. All taken, as
above, by finding: F1 decision 7; F2 `chipOf`; F3 visitors unchanged; F4 decision 8; F5 decision 6
(the chip retired, not the search); F6 decision 9; F7 the promotion checklist in decision 5; F8
the reserved, validated query; F9 union ids; F10 the strict *Other editions* and the neutral *By the
same authors*; F11, F16, F17 the eval's redesign in Stage 3; F12 *Guess first* stores nothing; F13
*Hostile referee* dropped for Sol's *Evidence first*; F14 the measured range and the accepted cost;
F15 *After it* unfiltered with a labelled keyword view; F18 *Lineage* dropped. Stages renumbered:
the eval moved to run now, and the chips and the lists became one client stage.

Stage 1's code went to Sol three times. Round 1
([261025h-stage1-review-sol.md](261025h-stage1-review-sol.md)) found S1-F1 … F6: the twin rule
letting a stranger's record in on one agreeing author, the Since check trusting a model's year,
editions inferred from a DOI prefix, operators slipping through the code-written query, the topic
list fetched on every open, and its provenance unlogged. Round 2
([261025h-stage1-review2-sol.md](261025h-stage1-review2-sol.md)) closed four and found two the
fixes introduced: S1-F7, surname-first bylines refused by the one-to-one author match, and S1-F8,
bracketed operators still getting through while title colons were mangled. Both were fixed, and a
narrow check ([261025h-stage1-review3-sol.md](261025h-stage1-review3-sol.md)) confirmed them.
