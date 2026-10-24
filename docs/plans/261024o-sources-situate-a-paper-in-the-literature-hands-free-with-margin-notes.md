# Situate: where a piece sits in the literature, hands-free, in Investigate and the margin

Report `spya-w95xmq` (#689), Greg (admin: `feedback-reporter.ts` exit 0), 2026-10-23 23:05 UTC, a
suggestion, filed from `/read/arxiv-2308-08708-spya-xax6v4?mode=chat&sources=investigate`. Session
`fbw95xmq-sources-situate`. Written 2026-10-24.

> I think the value that people keep asking for from Spideryarn is to situate an article relative to
> everything else in the literature, both before and especially after. So in terms of what it cites,
> maybe what it should have cited but didn't, whether what it cited says what they think it says,
> and especially whether there's something new since then that might change how we think about the
> article. […] I think the interesting part is, is there anything we can provide in terms of the UI
> that improves on just a chat? So one answer would be lots and lots. of annotations, whether it's
> underlines or in marginalia mode […] If there's a citation that doesn't say what it, you know, is
> purported to say, or if there's something new that would undermine a claim that's being made, like
> those are the kinds of things that will be gold in a margin annotation. […] I can imagine doing a
> crapload of web searches for each article and for the claims, and then feeding all of that in. […]
> And then doing a deeper dive on anything that seems worthy of a deeper dive. […] ultimately, I want
> to get to the point where there are fewer sources submodes […] For now, I would just encourage you
> to experiment. It's fine to create more submodes. It's fine to try creating a universal submode.
> It's fine to add annotations types to marginalia mode. I'd say proceed autonomously. I prefer you
> didn't ask questions. Try and get to a fun, interesting version one, and then we can always pare
> it back.
>
> — Greg, 2026-10-23 (spya-w95xmq, abridged; the whole of it is in the
> report's note, linked here once it is written)

## The evidence this rests on

- **Research**: [261024a](../research/261024a-situating-a-paper-in-the-literature-how-researchers-read-and-check.md)
  (how researchers situate a paper, citation accuracy, what changes the picture after publication,
  questions by paper type and age, and the tools that put the literature into the reading view).
  The points this plan takes from it:
  - **Selectivity is the feature.** CiteSee left 89% of citations unmarked, and its highlighted 8%
    drew 37% of opens; readers were "initially overwhelmed" by five kinds of mark. So: few notes,
    capped, the strongest first, and a list view for the rest.
  - **CiteRead is the precedent**: later papers' words, in the margin, at the sentence they concern;
    readers understood and remembered more than with a plain list of citing papers.
  - **Nothing found is the normal answer** (contrasting citations are under 1%; replications are
    rare). So the panel says what was searched, and never says "all clear".
  - **Every note shows its source and is worded as an observation**, not a verdict (generative
    search engines: 51.5% of statements fully supported by their citations, Liu 2023).
  - **Questions differ by kind and age**: an empirical paper's claims want replications; a theory
    or position piece's want counter-arguments; an old paper wants what has been said since, a new
    one where it sits now.
- **Spike**: [261024b](../investigations/261024b-situate-spike-searches-into-one-read-cost-and-quality.md),
  Greg's shape run end to end on three production articles (read-only), with the script in
  `scripts/spikes/261024b-situate-spike.ts`. On the article he filed from (Butlin, Long et al.,
  *Consciousness in AI*, 2023; 38,000 words): one planning call wrote 17 searches, 17 Exa searches
  returned 76 pages (144,000 characters of extracts), OpenAlex gave the 40 most-cited of 196 citing
  works, and **one Sonnet 5.5 read of all of it beside the whole article** wrote 12 findings, every
  quote and source id checking out: the 2025 *Nature* adversarial collaboration against global
  workspace theory, beside the passage on ignition; the 2023 letter calling IIT pseudoscience (four
  of this report's authors among the signatories), beside the passage that sets IIT aside; Seth's
  *BBS* critique of the neural-replacement argument, beside the footnote that leans on it; the
  authors' own 2025 *TiCS* update. **$0.52 and 63 seconds in all**, of which the read was $0.36.
  Haiku 5.5 on the same evidence cost an eighth as much but lost 3 of 11 quotes and called a later
  letter something the piece "omits"; Sonnet is the provisional reader.

## What we build (reshaped after GPT Sol's plan review, § Review)

**A new owner-only step, `situate`, whose result is a dossier at the top of Sources › Investigate
and a new kind of Marginalia note.** One press, then everything is automatic: plan the searches, run
them, read them all at once beside the whole article, check every claim in code, and anchor what was
found to the passages it concerns. **No new chip**: Investigate becomes the one place in Sources
for "where does this piece sit", which is the direction of Greg's *"fewer submodes … one kind of
universal interface that has different sort of subtypes of entries"*. **Behind the experimental
switch** (both the dossier and the margin kind): it is the dearest press in Sources, and Greg
called it an experiment; he turns it out of the switch when he likes it.

```
 ┌ Bibliography │ Not cited │ Links │ Reception │ Claims │ Investigate ┐  (i)
 │ WHERE THIS PIECE SITS                                       experimental │
 │ A review from 2023: what has happened since                              │
 │ The report became a reference point … The live disputes are …  (overview)│
 │                                                                          │
 │ Challenged · 3                                                           │
 │   "Ignition is a step-function, so whether …"                   ↗ jump   │
 │   The 2025 Nature adversarial collaboration (n=256) found little …       │
 │   Nature ▸ what it says · PMC ▸                         💬 Ask in chat   │
 │ Since · 4  …   Citation? · 1  …   Not cited? · 1  …   Reception · 1  …   │
 │ ▸ What was searched: 16 searches (15 ran), 76 pages, 40 later papers     │
 │ Search again · 24 Oct                                                    │
 │ ──────────────────────────────────────────────────────────────────────── │
 │ [ your question … ]                       (Investigate, as it is today)  │
 │ Suggested for this piece:  Do the Cogitate results weaken …?  …          │
 │ Your questions … · Suggested questions … · About its claims … · works …  │
```

In Marginalia, one shut line per block, like every other mode's items, showing its strongest
finding:

```
  … Ignition is a step-function, so whether a     │ ▸ CHALLENGED The 2025 Nature adversarial
  given representation is broadcast, and,         │   collaboration found little ignition…
  therefore, conscious …                          │
                    (pressed:)                    │   The 2025 Nature adversarial collaboration
                                                  │   (n=256) found little ignition at …
                                                  │   Nature · PMC            From the web
```

### The step: `situate` (`src/situate.ts`)

Stored in a new jsonb column `article_revisions.situate` (an additive migration),
`REVISION_CARRY_POLICY.situate = "carry"` (a re-extraction keeps the paid result and its
`sourceHash` marks it stale), owner only: **not** in `PUBLIC_PROJECTIONS`, Sources' visitor
`POLICY` or the public DTO, and in the owner-only profile-carrier exception. `oncePerJob`.

1. **Plan** (capable tier, one call, `situate-plan`). Inputs, **all fenced as untrusted**: the
   title, the headings, the opening ~12,000 characters, the 20 works Bibliography rates as leaned on
   most, and today's date. **Not the reader's profile** (Sol S4: a profile word must never become a
   search query). Out, strict JSON schema: `kind` (`empirical`, `theory`, `review`, `position`,
   `news`, `other`), `year`, `angle` (`since` / `now`), and 12–16 `queries`, each `{ q, for,
   group: "piece" | "claim" | "citation" | "missing" }`. The mix is the research's: a quarter on the
   piece, half on its claims, the rest on load-bearing citations and omissions, weighted by kind and
   angle.
2. **Validate the queries in code** before anything leaves (Sol S3): 8–16 kept, each 3–200
   characters, no URL, no email address (stripped as `related-work.ts` strips them), no control
   characters, duplicates dropped. Fewer than 8 valid fails the run before any search is bought.
3. **Search**. Each query is one forced Exa search, `searchWebRequest`'s body (the `search_web`
   subagent's), under its own job name `situate-search` for the ledger, eight at a time. **Each
   query records its outcome** (Sol S2): `failed` (the request failed), `no-search` (no
   provider-proven search, `whereSearchCountCameFrom`), `empty` (a search ran, nothing accepted) or
   `found` (pages). **Fewer than half `found`-or-`empty` fails the run**, and so does a run with no
   `found` in the `claim` group: a run that read nothing must not look like a run that found
   nothing. A run where the searches ran and found nothing is stored honestly, with no read call.
4. **Later works that cite it** (free): a private `situateCiters` that reuses
   `citation-index.ts`'s target identity confirmation, limiter and text parser, asking OpenAlex for
   the 40 most-cited citing works **with abstracts**. Not the shared `Citer` type or its cache (Sol
   S6). Skipped, and said so, when the article has no confirmed identity.
5. **Read** (capable tier, one call, `situate`). The fenced article behind a cache breakpoint; then
   the evidence, fenced: every extract clipped to 2,500 characters (`S1…`), every citing work's
   abstract (`C1…`), and **the cited works' own abstract sentences** from the stored
   `citation_blurbs` (`A1…`, each naming the work and the paragraphs that cite it); then the
   instructions, with the reader's `profileSection` (ranking and the questions only). Strict JSON
   schema, `plainWords`, `paperwork`. No tools. Out: `overview` (2–3 sentences), up to 14
   `findings`, and 5 `questions`. A finding is `{ kind, block, quote, note, strength, sources: [{
   id, quote }] }`, kinds `challenged`, `supported`, `since`, `citation`, `missing`, `reception`.
6. **Check, in code** (Sol S1). Kept only if:
   - its block exists and its `quote` (4+ words) is in that block, matched by the house quote
     matcher, **storing the article's own characters**;
   - every source names an id this run gathered, and its `quote` (6+ words) is found in **that
     source's own text** (the extract, the abstract), storing the source's characters; a finding
     with no surviving source is dropped;
   - a **`citation`** finding rests on at least one `A` source whose work is cited in that very
     block (`citedAt`): "this citation does not say that" only on the cited work's own words;
     later work revising a cited work is `since`, and the prompt says so;
   - at most 2 per block, 14 in all, strongest first. Each drop is counted by reason.
   Its stored sources carry **the search's URL and title, never the model's**.
7. **The id** of a finding is a hash of its kind, block and first source URL, so a re-run that
   finds the same thing keeps the id (Sol S8), and a chat started from it still finds it.

Stored: `{ slug, version: "situate/1", generator, sourceHash, profileHash, generatedAt, elapsedMs,
kind, year, angle, overview, findings[], questions[], searched: { queries: [{ q, for, group,
outcome, pages }], pages, citers, citersSkipped? }, counts }`. `stale` on the article's
`sourceHash`, `outdated` on `version` and `generator`, and a changed profile is the profile
carrier's usual verdict.

**What it costs**: $0.36–0.52 an article in the spike, the read most of it. **The allowance is
taken inside the step, before any paid call** (Sol S5), so every way of starting it — the press, a
command-bar re-run, Metadata, `/api/jobs/:id/retry` — passes it: `SITUATE_RATE_POLICY`, per owner 4
an hour and 12 a day, concurrency 1, a lease covering the whole step (6 minutes), and a global fuse
of 100 a day (about $50 at worst, in line with the other fuses).

**Privacy** (Sol S4): the press says what is sent — *searches written from passages of this piece
go through OpenRouter to Exa, a web search engine, and its title or DOI to OpenAlex* — and
`PrivacyPage.tsx`, `privacy.md`, `LAST_UPDATED` and their tests say the same. Today the page says
cited-work web search is never sent article text, which this would make false.

### The dossier, at the top of Investigate

- **Before it has run**: a heading, *Where this piece sits*, one sentence of what it does, the
  button *Search the literature*, and the disclosure line. The press starts the step; the job
  shows in the jobs tray and the section shows it is working.
- **Done**: the head line (*A review from 2023: what has happened since* / *A preprint from 2026:
  where it sits now*), the overview, then the findings **grouped by kind**, in the order a reader
  most needs them: Challenged, Citation?, Since, Not cited?, Reception, Supported. Each: the quoted
  passage (a jump), the note, each source as a link with *what it says* (the checked quote) one
  press away, and *Ask in chat*.
- ***Ask in chat* on a finding** sends a lens question (`askInSources`), so the chat is an
  Investigate chat: listed under *Your questions*, with its gist, and its way back is Investigate,
  which is where the finding now lives (Sol S8, met by S12's move). A finding whose chat exists
  shows the open-conversation mark instead (`threadForOrigin`). That chat, with its own web search,
  is **the deeper dive** Greg described: agentic, on the reader's press, about one finding.
- **The five questions** appear as *Suggested for this piece*, above the generic five, each a press
  like them.
- **Folded at the foot**: what was searched (each query, its group and outcome), the counts, and
  the sentence that nothing found is not the same as nothing there. *Search again*.
- Arriving at Investigate still reopens the newest chat (261021b); nothing here changes that.

### Marginalia: a `literature` kind

**Shut, one line per block** (Sol S7; the rule for every other mode's items): the stamp of its
strongest finding (*Challenged*, *Supported*, *Since*, *Citation?*, *Not cited?*, *Reception*) and
the note's opening, or a count (*2 from the literature*). Opened: each finding's note in the model's
face, its sources as links, and a quiet *From the web*. Its card (`tips.ts`) says what the kind is,
that a model wrote it from a web search, and when. A press on the stamp opens Investigate with the
finding in view. Placed only while its stored quote is still in its block. Owner only, behind the
switch. Nothing runs when the column opens: the notes arrive when the step has run, through a read
half and `useStepFinished`, like every other mode's items.

## Stages

1. **The step, server side** — types, migration, `src/situate.ts`, the job and model
   registrations, the allowance, the route that starts it, the owner read, export, reset-role,
   and every total table the compiler names. Tests, red first: the query validator, the
   per-query outcomes and both failure rules, the source-quote and citation checks, the stable id,
   the allowance inside the step, the owner-only read, and an end-to-end with a stubbed gateway.
2. **The dossier and the privacy page** — `useSituate` (read half and press), the section in
   `InvestigatePanel`, the experimental gate, the privacy page and doc, `sources.md`, the help page.
3. **The margin** — the `literature` kind, its component and card, `marginalia.md`.
4. **A real run and a browser look**, locally on two articles; the investigation updated with the
   numbers, the support of each source checked by hand; the note for the report.

Each stage: gates green, GPT Sol on the code, commit, push to `dev`.

## Passed over, and why

- **A seventh sub-mode, Situate** — this plan's first version. Sol S12: it adds new URL state, a
  visitor fallback, activation cases and alias ownership, and pulls against Greg's "fewer
  submodes", while Investigate can hold the dossier above its questions for none of that.
- **Findings as more suggested questions in Investigate**, with no stored artefact: that is the
  "just a chat" Greg asked us to improve on, and the margin needs stored, anchored findings.
- **An automatic dive** (Greg's second pass: search again on what stood out, then re-read). Sol S3
  and S11: a query the model writes *after* reading web pages, run automatically, is a delayed
  search tool steered by whatever those pages said; and a failure in it would lose the paid first
  pass. The deeper dive is *Ask in chat* on a finding, which is Chat with its own search, on the
  reader's press. A safe automatic version is in § Deferred.
- **Haiku for the read**: an eighth of the price, and worse in the ways that matter on one paired
  run (quotes that did not check, a temporal error). Sonnet is the provisional choice; a proper
  paired comparison is in § Deferred (Sol S14).
- **The reader's profile in the planner**: its words could become search queries (Sol S4). It
  shapes the reading and the questions instead.
- **Semantic Scholar's citation contexts** (CiteRead's data): no key, no commercial-use approval.
- **Crossref retraction checks for every reference**: deterministic and free, the one firm flag the
  research justifies; Bibliography's cascade is where it belongs. Deferred.
- **Underlines in the prose**: the margin is where Greg leans; a second view of the same findings
  can follow if the margin earns it.
- **Running on import, or when Marginalia opens**: $0.36–0.52 an article, paid whether or not
  anyone wants it. One press, then hands-free.

## Deferred

- A safe automatic dive: bank the checked first pass, derive the dive's queries in code from
  checked titles (never the model's free text), merge only the selected findings by id.
- Fold Reception and Claims into this dossier once Greg has used it (his "fewer submodes").
- Retraction and correction checks through Crossref, for the piece and every cited work.
- A paired Haiku/Sonnet comparison across articles, scored on source support and timing.
- The dossier for visitors on a public article.
- Marks in the prose for the findings.

## Review

GPT Sol on the first version, read-only, 2026-10-24:
[261024o-plan-review-sol.md](261024o-plan-review-sol.md) (prompt
[261024o-plan-review-prompt.md](261024o-plan-review-prompt.md)), verdict **reshape**, no P0s.

| | Finding | Done |
|---|---|---|
| S1 P1 | a source id existing is not the source supporting the note; `citation` from a later review | a checked quote from each source's own text; `citation` only on the cited work's own abstract words in that block |
| S2 P1 | "half succeeded" cannot tell a search that ran from one that did not | an outcome per query, provider-proven; a claims group that found something |
| S3 P1 | an automatic `diveQuery` is a delayed search tool; planner inputs not fenced | no automatic dive; inputs fenced; queries validated in code |
| S4 P1 | profile words could be sent as queries; the privacy page would be false | profile out of the planner; the disclosure and the privacy page updated |
| S5 P1 | a limiter at the route misses re-runs and retries; the fuse too high | the allowance inside the step, `oncePerJob`, concurrency and lease, a 100-a-day fuse |
| S6 P1 | `citation-index.ts` has no abstracts | a private `situateCiters` reusing its identity check and limiter |
| S7 P1 | open notes, two per block, break Marginalia's rule | one shut line per block |
| S8 P1 | a chat from a finding could not lead back to it; ids not stable | the finding lives in Investigate, where its lens chat leads; ids hashed from content |
| S9 P1 | the stored shape incomplete; carry, public and profile handling unstated | the full shape above; `carry`; not public; profile carrier |
| S10 P1 | `literature` already belongs to Sources in the command bar | no new chip, so no new aliases |
| S11 P1 | a failed dive would lose the paid first pass | no dive in v1 |
| S12 P2 | a seventh chip is not needed for the value | taken: the dossier is in Investigate |
| S13 P2 | the second breakpoint's saving was asserted, not measured | one breakpoint after the article, as the spike measured; no dive |
| S14 P2 | Sonnet and the ordinary cost overclaimed | Sonnet provisional; cost quoted as measured, $0.36–0.52 |
