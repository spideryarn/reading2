# Sources › Situate: the piece in the literature, hands-free, with notes in the margin

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
> [note](../user-feedback/261023_2305-sources-situate-the-piece-in-the-literature.md))

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
  quote and source checking out: the 2025 *Nature* adversarial collaboration against global
  workspace theory, beside the passage on ignition; the 2023 letter calling IIT pseudoscience (four
  of this report's authors among the signatories), beside the passage that sets IIT aside; Seth's
  *BBS* critique of the neural-replacement argument, beside the footnote that leans on it; the
  authors' own 2025 *TiCS* update. **$0.52 and 63 seconds in all**, of which the read was $0.36.
  Haiku 5.5 on the same evidence cost an eighth as much but lost 3 of 11 quotes and called a later
  letter something the piece "omits"; Sonnet stays the reader.

## What we build

**A seventh Sources sub-mode, Situate, and a new kind of Marginalia note fed by it.** One press,
then everything is automatic: plan the searches, run them, read them all at once, dig deeper into
what stood out, and anchor what was found to the passages it concerns.

```
 ┌ Bibliography │ Not cited │ Links │ Reception │ Claims │ Investigate │ Situate ┐  (i)
 │ A review from 2023: what has happened since                                  │
 │ The report became a reference point … The live disputes are …   (overview)   │
 │                                                                              │
 │ Challenged · 3                                                               │
 │   "Ignition is a step-function, so whether …"                       ↗ jump   │
 │   The 2025 Nature adversarial collaboration (n=256) found little ignition…   │
 │   Nature · PMC                                           💬 Ask in chat      │
 │ Since · 4  …   Citation? · 1 …   Not cited? · 1 …   Reception · 1 …          │
 │                                                                              │
 │ Questions to ask next                                                        │
 │   Do the Cogitate results weaken the GWT indicators enough to …?   💬        │
 │ ▸ What was searched: 17 searches, 76 pages, 40 later papers citing it        │
 │ Search again · made 24 Oct                                                   │
```

And in Marginalia, beside the passage, open (not shut), like the model's own notes:

```
  … Ignition is a step-function, so whether a     │ CHALLENGED  The 2025 Nature
  given representation is broadcast, and,         │ adversarial collaboration found
  therefore, conscious …                          │ little ignition at stimulus offset…
                                                  │ Nature · PMC      From the web
```

### The step: `situate`

One job, five phases, on the server (`src/situate.ts`), stored in a new jsonb column
`article_revisions.situate` (an additive migration), owner only, with its own prompt version,
`sourceHash` and profile hash so it goes stale like any other step.

1. **Plan** (capable tier, one call). From the title, the headings, the opening ~12,000 characters,
   the 20 works Bibliography rates as leaned on most (when there is one), today's date and the
   reader's profile: the piece's **kind** (`empirical`, `theory`, `review`, `position`, `news`,
   `other`), **year**, **angle** (`since` if older than about two years, else `now`), and 16
   **queries**, each with what it is for and the words of the passage it is about. The mix is the
   research's: a quarter on the piece itself, half on its main claims, the rest on its
   load-bearing citations and on what it may have missed, weighted by kind and angle and by why the
   reader says they are reading.
2. **Search**. Each query is one forced Exa search on the quick tier — `searchWebRequest`, the
   `search_web` subagent's request, so nothing new is learned about OpenRouter's search — keeping
   the search's own extracts (`collectSearchEvidence`), eight at a time, under its own job name for
   the ledger. **And OpenAlex's most-cited citing works** with their abstracts, free, when the
   article has a DOI or an arXiv id, through the lookup [`citation-index.ts`](../../src/citation-index.ts)
   already does (its identity checks included). A search that fails is skipped; fewer than half
   succeeding fails the run, so a run that read nothing cannot look like a run that found nothing.
3. **Read** (capable tier, one call). The whole article behind a cache breakpoint, then every
   extract (each clipped to 2,500 characters, numbered `S1…`) and every citing work (`C1…`) behind a
   second breakpoint, all fenced as untrusted, then the instructions. Out come: an **overview** (2–3
   sentences), up to 14 **findings**, and 5 **questions** for this reader to ask next. A finding is
   `{ kind, block, quote, note, sources, strength, dive, diveQuery }`, kinds `challenged`,
   `supported`, `since`, `citation`, `missing`, `reception`. No tools on the call.
4. **Dive** — Greg's second pass. For up to 3 findings the reader marked `dive` (important, thin
   evidence), run its `diveQuery` (one search each), then **one more read call** that reuses both
   cached prefixes and is handed the new extracts and the first pass's findings, and answers with
   the revised list: each finding kept, sharpened (with the new sources) or dropped. With the
   prefix cached this costs a fraction of the first read. Not an agent loop: bounded, one round,
   and the real open-ended deeper dive is the *Ask in chat* on every finding, which is Chat with its
   own web search.
5. **Check, in code.** A finding is kept only if its block exists, its quote is in that block
   character for character (`quote-in-block.ts`), and every source it names is one this run's
   searches or OpenAlex returned; its sources are stored as **the search's URL and title, never
   the model's**. At most 14 kept, and at most 2 per block. Dropped findings are counted, as
   Marginalia's notes are.

Stored: `{ version, generatedAt, kind, year, angle, overview, findings[], questions[], searched: {
queries[], pages, citers, failedSearches }, dropped }`. A finding carries a stable id so a chat
started from it can say where it came from.

**What it costs.** About $0.25 for an ordinary article and $0.55 for a 38,000-word paper (the
spike; the dive adds a few cents). Bounded by a `RatePolicy` at the route that starts it — 6 an
hour and 20 a day per owner, and a global fuse of 400 a day — because it is the dearest press in
Sources, dearer than Reception.

### Sources › Situate (the panel)

- **The chip arms nothing.** The panel has a button, *Search the literature*, with one line under it
  saying what is sent: searches made from the piece's text go to a web search engine, and its title
  or DOI to OpenAlex. Not cited set this rule (its review's F1): a referee may have uploaded a
  confidential manuscript, and a chip press is too easy to make by accident for that. After the
  press it runs as a job (the jobs tray, like every step), the panel showing its phase.
- **The finished panel**: the head line (*A review from 2023: what has happened since* / *A
  preprint from 2026: where it sits now*), the overview, then the findings **grouped by kind** in
  the order a reader most needs them — Challenged, Citation?, Since, Not cited?, Reception,
  Supported — each with the quoted passage (a jump), the note, its sources as links, and *Ask in
  chat*. Then the questions, each a press into an Investigate chat (`askInSources`, the same lens
  origin Investigate's suggested questions use). Then, folded, what was searched: the queries and
  the counts, and the sentence that nothing found is not the same as nothing there.
- ***Ask in chat* on a finding** starts a chat anchored to its passage with the finding as the
  question, through Investigate's sender, so it is listed under *Your questions* and its way back
  is Investigate. A new origin for it would be cleaner and is deferred (§ Deferred).
- **Search again** re-runs, through the same rate policy.
- **Owner only.** Not in the visitor's chip row; a shared `?sources=situate` draws Bibliography, as
  Not cited and Investigate do (`visitorSourcesView`).
- **The name**: *Situate*, Greg's own verb. Command-bar aliases: *situate*, *literature*, *since
  publication*, *what has changed since*, *newer work*. The collision test decides the rest.

### Marginalia: a `literature` note

**One new kind, `literature`, open by default** — notes the reader did not know to look for are the
whole point, and there are at most 14. Beside its block, after the model's own notes: a small-caps
stamp for the finding's kind (*Challenged*, *Supported*, *Since*, *Citation?*, *Not cited?*,
*Reception*), the note in the model's face, its sources as small links, and a quiet *From the web*
label. Its card (`tips.ts`) says what the kind means, that a model wrote it from a web search, and
when. Pressing the stamp opens Sources › Situate at that finding. Owner only, as the relation words
are. **Placed only while the quote is still in its block** (the FAQ rule), so a stale list cannot
sit beside prose that no longer says it. Nothing is run by opening the column: the notes appear once
Situate has been run, through the read half and `useStepFinished`, as every other mode's items do.

## Stages

1. **The step, server side.** Types, migration, `src/situate.ts` (plan, search, read, dive, check),
   job and model registration, the route that starts it behind the rate policy, the read, export,
   reset-role and every table that lists steps (the compiler and `mode.md § The artefact` lead).
   Tests: the checker (red first), a stubbed end-to-end with a fake gateway (search failures, the
   half-failed rule, the dive revising), and the route's refusals.
2. **The panel.** The chip, `SituatePanel`, `useSituate` (read half and press), activation and
   params, the command-bar aliases, the help page, `sources.md`. Tests on the panel and the
   visitor's `?sources=situate`.
3. **The margin.** The `literature` kind in `notes.ts`, its component and card, the read half in the
   column; `marginalia.md`. Tests in `marginalia-notes.test.ts` and the card test.
4. **A real run and a browser look**, locally on two articles; the investigation updated with the
   numbers; the note for the report.

Each stage: gates green, GPT Sol on the code, commit, push to `dev`.

## Passed over, and why

- **The simpler option: put the findings in Investigate**, as more suggested questions. It keeps
  the sub-mode count down, which Greg wants eventually, but a launcher of chats is exactly the
  "just a chat" he asked us to improve on, and the margin is where he leans. The structured list and
  the margin need a stored artefact, so a new sub-mode with its own step is the smaller honest
  shape. Folding Reception and Claims into Situate is the paring-back he anticipates, after he has
  used it (§ Deferred).
- **Haiku for the read**: an eighth of the price, and worse in the ways that matter (quotes that did
  not check, a temporal error). Measured in the spike.
- **An agent loop for the deeper dive** (the model with `search_web` until it is satisfied):
  unbounded cost and time inside a job, and Chat already is that agent. One bounded second round,
  plus *Ask in chat* on every finding.
- **Semantic Scholar's citation contexts** (the sentences in later papers that cite this one,
  CiteRead's data): the best single source for *what has been said since*, but we have no key and
  no commercial-use approval (`registry-keys.ts`). OpenAlex's citing works with abstracts stand in.
- **Crossref's retraction data for every reference**: deterministic and free, the one firm flag the
  research justifies, but it is a lookup per cited work and Bibliography's cascade is where it
  belongs. Deferred, named below.
- **Underlines in the prose**: Greg named them as one option. The margin is the one he leans to, and
  the prose already carries several kinds of mark; a second view of the same 14 findings can follow
  if the margin earns it.
- **Running it on import, or when Marginalia opens**: hands-free in the strictest sense, but at
  $0.25–0.55 an article, paid for every article whether or not anyone wants it situated. One press,
  then hands-free.

## Deferred

- Fold Reception and Claims into Situate, once Greg has used it (his "fewer submodes").
- Retraction and correction checks for the piece and every cited work, through Crossref.
- Situate for visitors on a public article (the artefact in the public payload, under the four
  conditions in `security-map.md`).
- A chat origin of its own for *Ask in chat* on a finding, so its way back is Situate.
- Marks in the prose for the findings.
- Semantic Scholar citation contexts, if a key and approval arrive.

## Review

(GPT Sol's plan review, and what was done with each finding, go here.)
