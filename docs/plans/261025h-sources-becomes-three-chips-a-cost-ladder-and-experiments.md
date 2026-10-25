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

Sources goes from six chips to three — **Where it sits**, **Bibliography**, **Links** — for every
reader. *Where it sits* is the default and opens on two free lists (what came after the piece, what
it leans on), with *Search the literature* (the dossier, out of the experimental switch) as one
press; once pressed, the dossier is what it shows first. Reception, Claims, Not cited and
Investigate stop being chips and become four tools reached from inside *Where it sits*. Two identity
fixes make the free lists right on the trial's hard cases. An eval decides how much of the dossier
Haiku can do. Behind the experimental switch, three left-field sub-modes for Greg to play with.
Persona reviews of screenshots at the end, and their fixes.

## The cost ladder, as built

| Rung | What | When it runs |
|---|---|---|
| Free | Bibliography (made on import, as now), Links, *After it* (OpenAlex citers, topic-filtered for a classic), *Before it* (Bibliography's most relied-on works) | On opening Sources, no press |
| Free, but sends the article's opening | Not cited | Still on its own press: the reason is [privacy](../project/privacy.md#crossref-datacite-and-openalex-are-sent-a-doi) (a referee's confidential upload), not cost |
| A few cents | Claims' list | On its own press, as now |
| ~$0.10–0.40 | *Search the literature* (the dossier) | Only on its press. Never on open, never on import |
| Per item | A finding's *Ask in chat*, a claim's check, a cited work's chat | Only when the reader asks about that item |

Greg's "cheap paid work may run when Sources opens": nothing paid needs to. Reception's search
($0.05–0.07) was the candidate, and it is folded into the dossier rather than run on open (Stage 3).
If the eval brings the whole dossier to a few cents, running it on open is a follow-up for Greg to
try, not something this plan switches on.

## Decisions taken without asking (Greg: "proceed autonomously")

1. **B+**, as recommended in 261025c: lists first until you ask; after that, the dossier first.
2. **Identity rule 1, twin records**: two OpenAlex records with the same whole title, at least two of
   the same authors (all of them when the piece has fewer than two) and publication years within one
   are one work; their citers are taken together, deduplicated by id, and the count is the sum less
   the overlap we can see. Any other pair of passing records stays `none`, as now.
3. **Identity rule 2, the piece's own editions**: grouped under *Other editions of this piece* in Not
   cited, not hidden (q-vg2b69's recommended 2A). A row is an edition when it shares the piece's
   authors (two, or the only one) and either its title is a version of the piece's or it is a book or
   book chapter whose title is not (an anthology that reprints it). A false positive is a real paper
   moved into a group that is still on screen, which is the cheap error.
4. **The fixes that need no decision** (261025c): a *Since* finding keeps only sources dated after
   the piece (a finding left with none is dropped, counted); a note that names a work none of its
   sources is, by a title or an author-year mention in code's reach, is cut at that sentence or
   dropped. Prompt version `situate/2`.
5. **The dossier leaves the experimental switch**, because it is the heart of *Where it sits* and a
   three-chip Sources without it would be lists alone. It keeps its allowance (four an hour, twelve a
   day per reader, `SITUATE_RATE_POLICY`) and stays a press. This is the one decision here that
   changes what every owner can spend; it is named in the debrief.
6. **Reception's search becomes a code-written query in the dossier**: the piece's title in quotes,
   with the first author's surname, built by code from metadata (never model text, so S3's defence is
   not needed for it). That is the query shape that found the trial's two real replies (Zvi
   Mowshowitz's *Rock is Strong*; the Substack critique). Reception's own press is retired; its stored
   rows stay readable.

## The simpler option taken over the plan's folds

261025c put Reception, Claims, Not cited and Investigate *folded inside* the dossier's page. That
means rendering four panels (one of them 3,384 lines) without their own surfaces, a rewrite of
each. **Instead they stay the panels they are, at the same `?sources=` addresses, and leave the chip
row**: *Where it sits* ends with a row of four plain links, *Tools: Pages about it · Check a claim ·
Close to it, not cited · Ask your own question*, and each of those views carries a *← Where it sits*
link and keeps *Where it sits* lit in the chip row. Every old address keeps working with no
translation, the visitor band changes least, and the reader sees three chips. If Greg likes the
direction, real folds are a later polish.

```
 ┌ Where it sits │ Bibliography 17 │ Links 4 ┐
 │ A paper from 1998: what has been said since
 │ [ Search the literature · about 45 s ]  …what leaves, and what it costs
 │ After it — 556 papers cite it and mention "extended mind"
 │   Minds: extended or scaffolded? · 2010 · cited 621  …  ▸ all
 │ Before it — the works it leans on most
 │   Kirsh & Maglio 1994 · Putnam 1975 · Burge 1979 …
 │ Tools: Pages about it · Check a claim · Close to it, not cited · Ask your own question
```

## Stages

Each is committed, pushed to `dev` and leaves Sources working.

### Stage 1 — the lists made right (server, identity)

Twin records (decision 2) in `src/citation-index.ts` § `titleMatchOf` / `citersOf`, with the
*Extended Mind* pair as the test; editions (decision 3) in `src/related-work.ts` and `NotCitedPanel`;
the two dossier checks (decision 4) in `src/situate.ts` § `checkFindings`, `situate/2`. Red tests
first, each from the trial's real records.

### Stage 2 — the free lists (server + hook)

*After it*: the citers, and for a piece with more than about a thousand, OpenAlex's own top keyword
for the work as a filter (`261025a-topic-citers.py` is the spike), one extra request, cached with the
citers. *Before it*: Bibliography's top works by `relevance`, no request. A route (or a widening of
`/api/citers`) and a hook. Which list leads: the publication year when there is one (older than two
years: *After it* first), side by side otherwise.

### Stage 3 — three chips (client)

`SOURCES_VIEWS` gains `where`; the chip row draws `where | bibliography | links`, with `where` lit
for `reception`, `claims`, `not-cited` and `investigate`. A new `WhereItSitsPanel`: the head line,
the dossier when it exists (moved from Investigate; `SituateDossier` unchanged), else the button,
then the two lists, then the tools row. The default sub-mode becomes `where` for the owner; the
visitor keeps Bibliography as default and gets *Where it sits* only with stored Reception or Claims
rows (as now). `activationForSources('where')` arms nothing. Reception's chip press no longer arms
its paid search (decision 6); the code-written query joins the dossier's. Command-bar aliases,
help page, `sources.md`, old-address table, privacy page wording for the dossier leaving the switch.

### Stage 4 — the eval (in parallel with 1–3, its own worktree)

Folds in `qi-9bc5xnwn`. The six trial articles, one fixed set of search evidence each (bought once),
and the read run several ways on the same evidence:

- **A** Sonnet reads (today)
- **B** Haiku reads
- **C** Haiku triages the evidence to a shortlist, Sonnet writes the findings from the shortlist
- **D** Haiku triages, Opus writes
- and the planner on Haiku against Sonnet, scored on the queries it writes

Scored in code (kept/dropped by `checkFindings`, *Since* violations, unsourced names, cost, time from
the ledger) and by a blind judge (an Opus subagent, the arm labels hidden) on usefulness against the
trial's "what a careful reader would expect". Budget about $10; stop at $30. Written up under
`docs/investigations/`; the winner adopted in `src/models.ts` / `src/situate.ts` in this stage or the
next, with `PROMPT_VERSION` bumped if the prompt changes.

### Stage 5 — experiments, behind the switch

Three sub-modes under *Where it sits*, shown only with the experimental switch on, each a small
panel using data Sources already has, so each is cheap and none is a new spend path unless named:

- **Predict, then reveal** — before the dossier shows, the reader writes what they expect critics
  said, then sees the findings beside their guess. Free (it reads the stored dossier). The vision's
  "augment, not replace": a guess first makes the reveal stick.
- **Lineage** — one timeline: the works it leans on, the piece, the topic-matched citers, by year.
  Free (Stage 2's lists).
- **Hostile referee** — one Haiku call on press (about a cent): the three strongest objections an
  expert would raise, each anchored to a passage (quote-checked in code), each with *Ask in chat* to
  test it against the literature. Its own allowance.

The final choice may change after the persona reviews; any one that turns out costly is dropped.

### Stage 6 — screenshots and personas

A Sonnet browser agent shoots *Where it sits* on the trial articles (before and after a dossier,
the tools, the experiments, a phone width). Four persona subagents read the shots — a UI/UX
designer, a product manager, a research scientist, a first-time reader — and list what confuses or
could be better. Fixes that are clear are made; the rest are listed for Greg.

### Stage 7 — bookkeeping

The question file answered with Greg's words; the report's note updated; the queue items
(`qi-mbh8appj`, `qi-9bc5xnwn`) closed or rewritten; docs and `/help` current.

## What is left out, and why

- **Real folds** of the four tools into one page — the simpler links above first.
- **The dossier on open** — "$0.30 … should be upon user request".
- **`withoutAddresses` eating `AGENTS.md`** — a defence (S3); loosening it is not this job's call.
- **An automatic second, agentic pass** — still `qi-kqqst6vy`, for the reasons recorded there.
- **Semantic Scholar's citing sentences** — Greg decided against it (bibliography.md).

## Review

(Filled in after GPT Sol's plan review.)
