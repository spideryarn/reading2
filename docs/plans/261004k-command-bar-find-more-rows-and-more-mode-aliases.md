# Command bar: Find more as a command, and more aliases for the modes

Reports: spya-rbxrgc (SPIDERYARN-READING2-CM) and spya-uzkmn3 (SPIDERYARN-READING2-CN), Overseer
queue qi-d5ndf8y4. Both from an admin (Greg), so trusted input; `feedback-reporter.ts` exited 0 on
each production row.

> There are lots of cases where we have a sort of find more button, for example in the glossary
> mode. Let's make that be part of the command bar as well.
>
> — Greg, 2026-10-04 (spya-rbxrgc, from `?mode=glossary`)

> In the command bar, add more aliases. So, for example, structure mode could have aliases for
> hierarchy, table of contents, TOC, headings, etc.
>
> — Greg, 2026-10-04 (spya-uzkmn3, from `?mode=structure`)

## What exists

- **Aliases** are `MODE_CATALOG[mode].aliases` in `src/mode-catalog.ts`, two to seven a mode, under a
  docblock that says *deliberately sparse*. Structure already answers to `hierarchy`, `toc` and
  `contents`; it does not answer to `table of contents` or `headings`, because the matcher
  (`src/web/command-match.ts` § `TIERS`) asks whether an **alias contains the query**, never the
  reverse, so `contents` does not catch `table of contents`. `tests/mode-catalog.test.ts` holds
  four rules: unique across modes, never another mode's label, stored canonical, and not repeated
  inside one mode.
- **Find more exists in exactly two bands**: Glossary (`GlossaryPanel.tsx` § `MoreRow`,
  `owner.more(owner.profiled)`) and Quotes (`QuotesPanel.tsx` § `findMore`,
  `owner.regenerate(owner.profiled)`). Both are a forced run that the server **appends** to an
  current or explicitly compatible older list (`existingFor` in `src/glossary.ts` and
  `src/quotes.ts`). A survey of every other
  band (2026-10-04) found no other button that adds to a list: Ideas, Timeline, FAQ, Citations,
  Debate, Skim, Summary, Thread, Quiz, Illustrated and Referee › Claims each have only a forced
  **rewrite**, and those are already in the bar as the *‹name› › Run again* rows
  (`src/web/rerun-commands.ts`, plan 261002c).
- ***Glossary › Run again* is nearly Find more but not the same press.** It posts the forced run
  with the reader's current profile and lands on Metadata. The band's button posts with **the list's
  own recorded profile setting**, so that a plain list is added to rather than rewritten, holds the
  list while the run is out (`rewrite-hold.ts`), and shows progress in the band.
- **The bar already asks a band to do something**: *Look up “X” in this article* leaves a term in a
  one-shot, in-memory hand-off (`src/web/glossary-ask-handoff.ts`), opens Glossary with the plain
  mode setter (never the Dock's press, which arms generate-on-open), and the band takes the term
  once and makes the one call. Slug, nonce, session epoch and a 10 s ceiling guard it.

## What we'll build

### Stage 1 — more aliases (spya-uzkmn3)

Widen every mode's `aliases` from two-to-four to roughly six-to-ten natural words and phrases, e.g.
Structure gains `table of contents`, `headings`, `headers`, `sections`, `chapters`; Summary `tldr`,
`gist`, `overview`, `synopsis`, `abstract`, `key points`; Glossary `vocabulary`, `jargon`,
`dictionary`, `key terms`; FAQ `q&a`, `questions and answers`; Remember `memorise`, `memorize`,
`study`, `test me`; and so on for all seventeen. The four rules in the test stay, and so does the
rule that an alias names a destination. The docblock's "deliberately sparse: two to four" is
replaced with Greg's sentence and what still limits a word: it must be unique, must not be another
row's label (mode, sub-mode, page or action), must not start with a verb the argument parser owns
(`find`, `search`, `jump`, `tag`, `look up`, …; `tests/command-match-arguments.test.ts` has the
collision matrix), and must not make the wrong mode rank first for a word that is plainly another's.

Tests, red first: each of Greg's four words opens Structure first (`hierarchy`, `table of contents`,
`toc`, `headings`); a sample of the new phrases per mode ranks its mode first; existing ranking
tests stay green (plain `glossary` still the mode, `share`, `find …`).

Not in this stage: aliases for pages, actions and sub-mode rows. Nothing was asked about those by
name; a sentence that names nothing already has *Press Enter to ask what you meant* (261003k).

### Stage 2 — *Glossary › Find more* and *Quotes › Find more* (spya-rbxrgc)

1. **The hand-off becomes a band press, not only a glossary ask.** A sibling of
   `glossary-ask-handoff.ts` (or that file generalised, if it comes out smaller), same guards:
   `{ slug, mode: "glossary" | "quotes", press: "find-more", nonce, epoch, at }`, in memory only.
2. **Two action rows**, `Glossary › Find more` and `Quotes › Find more`, `generates: true`,
   `typedOnly`, `opensOnly: false`. Offered where the reading view hands the bar an executor for the
   owner — not to a visitor, not on the Metadata page (no band there; *Run again* is that page's
   row), and Quotes' only where the Dock draws Quotes. Words: `find more <name>`, `more <name>`,
   `<name> find more`, `add more <name>`, `find more`, for each name the mode answers to (label and
   catalog aliases, as `rerunNames` does). Typed `find more` shows both rows ahead of the
   *Find “more” in this article* argument row; plain `glossary` still puts the mode first.
3. **Enter** leaves the hand-off and opens the band with the **plain** mode setter. Nothing is
   posted by the bar.
4. **The band takes it once its read has settled** and presses its own button — the same function
   the button calls, with the list's own profile — **only if Find more is what the band is offering
   at that moment**: Glossary `ready`, a list, not `rewrites`, no job, not `waiting`; Quotes `ready`,
   a list, not stale, not outdated, under `MAX_QUOTES_TOTAL`, no job. Otherwise the hand-off is
   **taken and dropped**, so it cannot fire seconds later when a state changes: the reader is on the
   band, which already shows what it offers instead (*Find the terms*, *Write a new list* with its
   sentence, the running job, the cap line). A command never rewrites a list and never starts a
   first run; those stay a press the reader makes on the page. StrictMode-safe as the ask is (timer,
   atomic take).
5. **One POST per press**, pinned by a test, as for the ask.

Tests, red first: row presence (owner on reading view; absent for visitor and on Metadata); ranking
for `find more`, `find more terms`, `more quotes`; the hand-off's one-shot, slug, epoch and stale
rules; each band presses once when eligible and posts `{ force: true, useProfile: <list's own> }`;
each band drops it when ineligible (rewrite, no list, running, at the cap) and posts nothing; the
interface-model catalogue (`command-pick`) still serialises and treats the rows as needing a fresh
press. Then mutate: remove the eligibility check and see a test go red.

### Docs, in the stages that change them

`reading-view-overview.md` § The command bar (a paragraph for Find more; the alias sentence),
`glossary.md` and `quotes.md` where they describe Find more, the `/help` page's command bar part,
and the `mode-catalog.ts` docblock.

## Changes after GPT Sol's plan review

[261004k-command-bar-find-more-plan-review-sol.md](261004k-command-bar-find-more-plan-review-sol.md),
verdict *build with the changes above*. Every finding was checked against the code and accepted.
**Where this section and the stages above disagree, this section wins.**

| ID | Sev | Finding | Taken |
|---|---|---|---|
| F1 | P1 | Eligibility left out `starting` and `failed`; `useStepJob.start` has no in-flight latch, so the command could post beside *Starting…* or past a *Retry* | One predicate per band, *a fresh Find more is offered now*, used by the band's own control **and** by the hand-off. Tests for starting, a retryable failure, a failed POST and a non-retryable failure |
| F2 | P1 | Glossary's `rewrites` falls back to `stale or outdated` when the server's verdict is absent, which misses a changed profile | The command requires `panelRun === "append"`; an absent verdict is ineligible. Test: absent verdict, profiled list, profile changed |
| F3 | P1 | A row offered when it cannot do what it says breaks the bar's rule (*no row, never a row that fails*) | **The row is drawn only when the reading view's own read says an append is on offer**: Glossary `ready`, a list, `panelRun === "append"`; Quotes `ready`, a list, not stale, not outdated, under the cap. Reader already holds both reads (`owner.glossary`, `owner.quotes`). The band still rechecks the transient state (F1) and drops the press if a run started in between. This replaces the question for Greg below: there is no longer a case where the command opens a band and does nothing by design |
| F4 | P1 | The picker's catalogue is built from a synthetic owner with no executor, so the new rows would be missing from it and a sentence could never pick them | Give the synthetic owner the capability; assert both ids are in the `owner-article` slice |
| F5 | P2 | `find more …` aliases collide with the `find` argument verb, against the collision matrix | Declared exceptions in the matrix, by id, and a test that the rows come before *Find “more …” in this article*. The parser is not weakened |
| F6 | P2 | "No immediate POST" does not prove the hand-off was consumed | For each dropped state, move the mounted band to eligible inside the window and assert still no POST; both consumers mounted under `StrictMode` |
| F7 | P2 | Sampling aliases is too weak for a hundred new words | A generated test: **every** alias ranks its own mode first; every label prefix that identifies one label ranks it first; an explicit table for the ambiguous prefixes. The label rule reads "not another row's label unless both open the same place" (`sketch`, `recall`) |
| F8 | P2 | New aliases also multiply through the *Run again* phrases, and the picker's option wording is a measured thing | Add Find-more and new-alias sentences to `evals/command-pick/phrases.ts`, regenerate the catalogue, and re-run the production arm only; results into the investigation doc |
| F9 | P3 | Three facts in *What exists* were wrong: Structure already has seven aliases, the test has four rules, and Glossary also appends to compatible older versions | Corrected here |

## The simpler options passed over

- **Only add `find more <name>` as words on the existing *Run again* rows.** No new seam, but it is
  the wrong press: current profile rather than the list's, so on a plain list with a profile it
  *rewrites* under a row that said "more", and it lands on Metadata rather than the band.
- **The bar posts the forced run itself and then opens the band.** The bar would need each list's
  profile setting and state, which only the band's hook has read; a second place deciding
  append-or-rewrite.
- **A URL parameter** (`?mode=glossary&more=1`): a link that spends when opened. Refused before
  (261002c, 261003f).

## Deferred, with its own queue entry

- **Aliases for pages, actions and sub-mode rows** (queue entry added before the note says
  shipped).

## Question for Greg (withdrawn after F3)

**When Find more is not what the band offers** — no list yet, or the list would be rewritten — the
command opens the band and presses nothing, and the band shows its own button. The alternative is
for the command to make the first run, or the rewrite, itself. We built the cautious one: a row
called *Find more* that replaced your list would be doing something its name does not say.
Recommendation: keep it; say if you would rather it started the first run when there is no list.

## Done looks like

`npm test`, `npm run typecheck`, lint on touched files green; GPT Sol on this plan and on the code;
a browser check at desktop, iPad and phone widths (typed `headings` and `table of contents`;
`find more terms` pressing Glossary's button once, progress in the band; the same for Quotes); docs
and Help updated; the feedback note with `reports: spya-rbxrgc, spya-uzkmn3`.

## Progress

- 2026-10-04: prior-work check (nothing built; this session holds the claim), survey of the bands,
  plan written.
- **Stage 1 landed** (2ca8bf35c): six to twelve nicknames a mode; a generated test types every one
  into the whole list the bar holds (`tests/command-match-mode-aliases.test.ts`). Left out on
  purpose, with the reason beside each mode: `questions and answers` (would take Chat's
  `question`), `abstract`, `concepts`, `figure`, `test me`, `highlights`, `discussion`.
- **Stage 2 landed** (037bcdc54): `src/web/find-more.ts` (words and the predicates),
  `find-more-handoff.ts`, `useFindMoreHandOff.ts`; the capability is one optional field on the
  reading view's executor. `define find more` went into the `define` verb's `except` list.
- **GPT Sol's code review** ([the review](261004k-command-bar-find-more-code-review-sol.md)),
  verdict *do not land* on F11. **F10** (P1, fixed by Sol): before the first job poll "no job" means
  "not known"; `loaded` now gates the predicate and the bands' buttons. **F11** (P1, fixed in
  b01b5a2ef): after the first poll the snapshot could still be stale; the hand-off is ready only
  after a job list whose request started after the press (`jobEngine.afterFreshList`). **F12** (P3):
  the count in the docs. Sol's narrow check of the F11 fix is
  [here](261004k-command-bar-find-more-f11-check-sol.md).
- **Still open, accepted**: a run that starts elsewhere in the one round trip between that fresh
  list and the band's POST can double up, because the server does not dedupe a forced run across
  profiles. The band's own button has the same window.
- **Browser check** (Playwright, 1280, 820 and 390 px; shots `261004k-shot-*.png`): the nicknames,
  the two rows and their order, one `POST /api/jobs` per press, absent on Metadata and in the empty
  list. Not checked in the browser: a visitor (tests cover it), and that the list grew.
- **F8, the picker re-measured**
  ([261004e](../investigations/261004e-command-pick-re-measured-after-more-nicknames-and-find-more-rows.md)):
  177 of the same 192 sentences right against 181 the day before; Find more 10 of 10; nothing that
  generates picked at 0.95 or above, so the threshold stays. $0.07. Two things it found are not
  built: the request is 44% bigger, nearly all of it the *Run again* and *Find more* phrase
  permutations the model does not need; and a sentence that opens with `find` never reaches the
  model (`find more good quotes for me` is read as a search).
- **Deferred**: qi-ca3kxyg9, nicknames for the rows that are not modes, and who owns `source` and
  `annotations`.
