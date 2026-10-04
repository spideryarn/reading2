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

- **Aliases** are `MODE_CATALOG[mode].aliases` in `src/mode-catalog.ts`, two to four a mode, under a
  docblock that says *deliberately sparse*. Structure already answers to `hierarchy`, `toc` and
  `contents`; it does not answer to `table of contents` or `headings`, because the matcher
  (`src/web/command-match.ts` § `TIERS`) asks whether an **alias contains the query**, never the
  reverse, so `contents` does not catch `table of contents`. `tests/mode-catalog.test.ts` holds
  three rules: unique across modes, never another mode's label, stored canonical.
- **Find more exists in exactly two bands**: Glossary (`GlossaryPanel.tsx` § `MoreRow`,
  `owner.more(owner.profiled)`) and Quotes (`QuotesPanel.tsx` § `findMore`,
  `owner.regenerate(owner.profiled)`). Both are a forced run that the server **appends** to an
  up-to-date list (`existingFor` in `src/glossary.ts` and `src/quotes.ts`). A survey of every other
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
`study`, `test me`; and so on for all seventeen. The three rules in the test stay, and so does the
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

## Question for Greg (not waited on)

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
