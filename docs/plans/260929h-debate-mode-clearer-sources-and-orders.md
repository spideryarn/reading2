# Debate mode: say what each source is, and let the reader order the list

Status: **stages 1–2 built and reviewed; see § After, in a browser and § The code review.** Report SPIDERYARN-READING2-5P (spya-w7t24d), from Greg's
own account, 2026-09-29.

## What Greg asked

> In Debate mode, make it clearer what the paper title/authors being referenced is. (You can see it
> with a tooltip on the (i) button, but we want that to be more prominent somehow. Perhaps show
> default-truncated with a button to expand?
>
> And add some UI to filter at the top of Debate mode (take inspiration from Glossary), e.g.
> chronological order; positivity, relevance, and a prioritised mode (default) with thresholding.
> Use your judgment.
>
> And more generally, there's something about the way the information is presented for the various
> papers in Debate mode that is confusing. Take screenshots, and/or as other agents (prompted to
> pretend to be different personas or a product manager) to look for ways to make the presentation
> clearer & more useful."
>
> — Greg, 2026-09-29 (SPIDERYARN-READING2-5P)

## What is on screen today, and what is in the data

**Screenshots** of production, read-only, 2026-09-29, 1440×900 and 390×844:
[1 top](260929h-shot-before-1-top.png) · [2 scrolled](260929h-shot-before-2-scrolled.png) ·
[3 the ⓘ card](260929h-shot-before-3-info-card.png) · [4 phone](260929h-shot-before-4-phone.png) ·
[5 constitution](260929h-shot-before-5-constitution.png).

Per row, top to bottom: the **site** (`nature.com`, orange, the loudest thing), a pill **ON WHAT IT
CLAIMS**, the page's **title in small grey, often cut short**, three to eight lines of the page's
quotation, **ANSWERING** and the article's own claim with a block id, and last the **AI
interpretation** box with `relation`, `lean` and a paragraph. A row is 370–450px tall, so about one
and a half fit on a screen. About 180px of preamble (on a phone, 300) comes before the first row. The
header says *5 pages* over six rows, because two rows share a page.

**The data** behind the reported article (`pnas-202123432-spya-rekvg9`, read off its public
payload): no row about this piece, six rows about what it claims. Each row holds `url`, the search
engine's `title` (optional), `sourceQuote`, `relation`, `lean`, `applies`, `limits?`, and the claim.
Three of the six titles are **cut short by the search engine itself** (*"Memory Sources Associated
with REM and NREM Dream Reports ..."*), one has none (`arxiv.org/pdf/1809.10635`), and **no row has
authors, a date or a relevance judgment** — those are not in the artefact at all. So "chronological"
and "relevance" need the search step to keep something it does not keep now.

## What the persona and product-manager pass said

Three Opus subagents, briefed with the screenshots, the data and a first draft of this plan: a
second-year PhD student, a sceptical senior memory researcher, and a product manager. They agreed
on more than they disagreed:

1. **A row does not say what the source is.** The site leads, the title is grey and clipped, and
   there is no author or year. *All three.*
2. **The row is in the wrong order and too tall.** Four to six lines of a stranger's words come
   before the reader learns which claim they bear on, and the verdict comes last. *All three.*
3. **Group the rows under the claim they answer**, claims in article order — the PM's and the
   researcher's first choice of default, the student's most-used order. It removes the repeated
   *Answering* blocks and the look of duplicates, and shows at a glance which claims have been
   tested and which are bare. The PM's point on why this does not break the panel's rule against
   headings: that rule refused grouping by *the model's* reading of a stranger's page, and a claim
   heading is **the article's own words, located in its block**.
4. **The *ON WHAT IT CLAIMS* pill says nothing** when every row is one. *PM, student.*
5. **Mark each dated source before or after this piece**, so evidence the piece rests on is not
   read as a response to it. *All three.*
6. **The ⓘ card is mislabelled** (*"Show the passage this row cites"*, but it is the source's
   details), and it is the only place some of this lives. *PM, student.*
7. **The preamble is a wall**, and *"no ranking"* becomes false the moment there is an order bar.
8. **On thresholds** they split. The researcher refuses a default that hides rows on an unchecked
   model score, wants no decimals on screen (*"coarse bands … labelled AI-judged relevance"*), and
   wants every hidden row counted in place. The PM prefers a fold to a slider at five to eight rows.
   The student calls *prioritised* and *relevance* side by side indistinguishable.

Not taken, and why, is under § Deliberately not in this.

## The shape

### A row leads with the work

```
 ┌──────────────────────────────────────────────┐
 │ Hippocampo-cortical coupling mediates memory │  ← title, full ink, links out, 2 lines max
 │ consolidation during sleep ↗                 │
 │ Maingret, Girardeau et al. · 2016 · nature.com│ ← authors · year · site (when known)
 │ AI  corroborates · 👍 Supportive               │  ← the AI's reading, one fenced line
 │ “Reinforcing the endogenous coordination     │  ← quotation, 3 lines max
 │  between hippocampal sharp wave-ripples, …”  │
 │ more ▾                                       │
 └──────────────────────────────────────────────┘
   more ▸ the full title and every author, the full quotation, the AI's paragraph
          (`applies`) and `limits`, the full address, and the sentence saying what the
          quotation was checked against, and the "Read it on nature.com ↗" link.
```

- **The title is the headline**, clamped to two lines, and it is the outbound link. The site moves
  to the small line under it and stays readable text. It is still the authority signal a reader can
  judge for themselves; it just stops standing in for what the work is.
- **`more` is Greg's *"default-truncated with a button to expand"*.** It is a disclosure on the row
  (a real button, `aria-expanded`), so it works by tap and keyboard, and **it replaces the ⓘ hover
  card**, whose contents it holds. One way to see a source's detail, not two.
- **No title** → the headline is the address without its scheme, and the site is not repeated.
- **The AI line moves up**, from a box at the bottom to one line under the byline, still labelled
  *AI*. It is what the reader decides with (Greg's *"see at a glance where the critiques vs praise
  are"*), so it cannot be last. `relation` and `lean` stay two words, not merged: they are two
  answers, and *"qualifies · Could not tell"* is an honest pair rather than a contradiction —
  `LEAN_APPEARANCE`'s argument. The paragraph goes behind `more`.
- **The *ON WHAT IT CLAIMS* pill goes.** The claim a row answers is the group heading in *by claim*,
  and one clamped line above the quotation in every other order (*"On: “…” ↩"*). **The
  identification chip stays** on rows about this piece — it has evidence behind it and a tooltip.

### Which title, whose authors, what date (stage 2)

The search stage asks the model, per row, for what the page itself says about the work, and a
coarse relevance judgment. **The first three are checked against the page's own extract**, the way
every quotation already is, and each is dropped on its own — never the row — when it is not there:

| field | kept when | stored as |
|---|---|---|
| `workTitle` | found in the extract by the spaced matcher | the extract's characters |
| `authors` | each name found in the extract; kept if at least one is | the extract's spellings, at most 12 |
| `publishedYear` | a four-digit year that is in the extract (never the URL alone) — F1 | a number |
| `bears` | one of `directly` · `partly` · `loosely` | the word — a model judgment, labelled as one |

`workTitle` is drawn only where the engine's `title` is missing or cut short (ends in `...`/`…`);
otherwise the engine's stays, because it is the wire's and not the model's.

**`bears` is a word, not a number** — the researcher's *"coarse bands, no 0.73"*, and the same
choice the identification bar made (`debate-levels.ts`): the reader sees three named stops, never a
score. It sits on the AI line (*"AI · bears directly · corroborates · 👍 Supportive"*), inside the
fence, and nothing verifies it.

`PROMPT_VERSION` → `debate/3`. Existing debates become *outdated*, which since 260929c draws no
banner and starts no run, so **the bump spends nothing**; a reader gets the new fields by re-running
from Metadata. Old rows lack the fields and every control below copes.

### The order bar, as Glossary has it

Glossary's `SortBar` shape at the top of the list, under its own URL key `?debateby=` (`citeby`'s
reason: a shared key carries one mode's order into another). Labels are Glossary's register, short
and lower-case:

| order | what it does | needs |
|---|---|---|
| **prioritised** | rows about this piece first, then `directly`, `partly`, `loosely`; a three-stop bar hides below a stop, claim rows only, default `loosely` so nothing is hidden until the reader moves it (`?bears=`; F5, F7) | `bears` |
| **by claim** | rows about this piece as the first group, then one group per claim in article order, headed by the claim's own words and its jump | nothing new |
| **date** | oldest first; a marker at the article's own date where it has one (*"← this piece, 2022"*); undated rows last, under a line saying so | `published` |
| **stance** | critical, could not tell, neither, supportive — critical first, because *interrogate* is what this mode is for | nothing new |

- **Prioritised is the default, as Greg asked — when it can be.** Where no row carries `bears` (every
  debate from before `debate/3`), prioritised and date are not offered and the default falls back to
  *by claim*: Glossary's rule that an order is offered only when the data behind it exists. An
  unknown `?debateby=` parses to the default.
- **The threshold is Glossary's, in Debate's categorical form.** Three named stops like the
  identification bar, never a number; the count on screen (`4 of 6`); and **`hiddenNote` in every
  state**, so a hidden row is always counted where the list is — the researcher's condition for
  accepting a default that hides anything. Shown only in *prioritised*.
- **Two sliders.** The identification bar (`?name=`) stays as it is, and it appears only when there
  are rows about this piece — none on any public article today. On an article with both, both show,
  one labelled *identification* and one *relevance*. Accepted rather than engineered away; see
  § Open for review.
- **No *as found* and no separate *relevance*.** Search order means nothing to a reader (PM), and
  *relevance* would be *prioritised* with nothing hidden, which the bar already gives by moving it
  to the left (student).
- **`DEBATE_NO_RANKING` becomes a sentence per order**, one line, saying what the order is and, for
  *prioritised*, that relevance is the AI's judgment.

### Smaller fixes the pass found

- **The preamble shrinks to one line**, *"Searched on 29 September 2026."* plus the order's sentence.
  The negative result (*"The search kept no page that responds to this piece by name…"*) moves to be
  the body of the empty *about this piece* group in *by claim*, and to the foot otherwise — it is
  still said, as `leadNote` insists, but not in front of the rows it is not about.
- **The header count says what it counts**: *"6 sources from 5 pages"* when they differ, *"6
  sources"* when they do not.
- **The block id beside a claim** stays (it is `BlockRef`, the jump), unchanged.

## Stages

1. **The row, and the orders that need no new data.** Title-led row with `more` replacing the ⓘ
   card; the AI line moved up; the pill gone; the claim line; `?debateby=` with *by claim* and
   *stance*, *by claim* the effective default; per-order sentence; one-line preamble; header count.
   Client only, and a visitor gets all of it.
2. **The search keeps what the page says about the work.** Prompt, parser and verification for
   `workTitle`, `authors`, `published`, `bears`; `debate/3`; the byline; *prioritised* (default) with
   its bar, and *date* with its marker. Measured with `npm run eval:debate` on two local articles,
   old prompt twice and new once: kept rows must not fall outside the old prompt's own spread, and
   the fill and verification rates of the four fields are reported.
   **As landed: `bears` only on the search side** — § What that decided. The client half is built
   in full.
3. **Docs, the note, after-screenshots** of the same five views, and the visitor half written up.

Done means: a row's source is identifiable without hovering, three or more rows fit on a phone
screen in *by claim*, and every order that is offered changes the list.

## Deliberately not in this

- **The public DTO.** `src/public/dto.ts` is a listed defence (security-map.md § Where the defences
  physically live) and this run is unattended, so the stage-2 fields **do not cross to a visitor** —
  the allowlist's default-absent behaviour. A visitor keeps stage 1 in full and is offered *by
  claim* and *stance*. Crossing them means `PublicDebateRowBase` in src/public-types.ts, the
  explicit `publicDebateRowBase` projection, the `carriesRefused` scan over every new string
  (authors is an array), and the security tests in `tests/public-dto.test.ts`; left for Greg.
- **Study type, species, method, peer-reviewed or not** (researcher). Valuable, and each is a model
  judgment about a stranger's page that nothing here can check. Not in v1.
- **Tagging each claim as the paper's own result or background it cites** (researcher). A real
  finding — both *corroborates* rows on the reported article confirm background — but it is a change
  to what pass B asks for, and deserves its own plan.
- **Merging rows that share a page** (PM). *by claim* already puts each under its own claim, where
  two rows about one page is two answers; revisit if flat orders still look duplicated.
- **A tally line in the header** (*"3 corroborate · 2 qualify"*, student). A count of model
  judgments at the top of the panel is the *"62% negative"* verdict the panel header refuses.
- **Authors from a bibliographic lookup** (OpenAlex, Crossref by DOI): a second network dependency,
  useless for blogs. The page's own words first.
- **A standing note that a search cannot show a claim is uncontested** (researcher). Worth a line of
  copy; it goes to `messages.ts` if the review agrees, not as a design change.

## After the plan review (GPT Sol, round 1, 2026-09-29)

No P0. Eleven P1s and five P2s; what changed, by finding:

- **F7 — the two sliders own disjoint rows.** The identification bar (`?name=`) filters rows about
  this piece, as now; the relevance bar (`?bears=`) filters **claim rows only**. Each has its own
  `ThresholdResult`, its own `N of M` and `hiddenNote`, and the list is their concatenation, so no
  row can be double-hidden and neither count changes meaning. This also settles § Open's two-slider
  question: two sliders only on an article that has both kinds of row, each about its own kind.
- **F5 — nothing is hidden by default.** `bears` is a new, unevaluated model judgment, so the
  relevance bar's default is **`loosely`** — prioritised *orders* by it and hides nothing until the
  reader moves the bar. Tightening the default waits for a labelled evaluation. The prompt change
  stays one change (one version bump, one eval) rather than two; the reviewer's split was about the
  default hiding rows, which this answers.
- **F1 — a year, not a date.** Stored as `publishedYear` (a number), accepted only when that year
  is in the page's **extract** — never the URL alone. Same-year rows keep search order, and the
  *this piece* marker does not claim before or after within the article's own year.
- **F2 — occurrence is not role.** Title, authors and year are found in the extract, which proves
  they are on the page, not that they are *this* page's byline. So they are labelled for what they
  are: the byline line is drawn as the AI's reading of the page (the `more` disclosure says *"Title,
  authors and year as the AI read them off the page; each was found in its extract"*). Authors are
  filtered **name by name**, and the list is dropped if none is found. Negative fixtures: an extract
  that cites another paper's title, its authors and its year.
- **F3 — the fields must be read, not only typed.** `readShared` in src/debate.ts builds rows field
  by field, so one tested reader of the new fields is called from it, with a positive and a
  rejection control each. The panel's row type becomes the owner's row *or* the public one, read
  through accessors, rather than pretending the public type carries owner-only fields.
- **F4 — the measurement.** Both old-prompt runs are captured before the prompt is edited, with the
  prompt hash; the run report is extended to count, per field, *omitted / offered / kept / refused*;
  and a small hand label of title, authors, year and `bears` on the kept rows is part of stage 2's
  evidence. Kept rows within the old spread is necessary, not sufficient.
- **F6 — one `effectiveDebateOrder`**, Glossary's `effectiveSort`: a known order that is not
  available on these rows (a visitor, an old artefact) resolves to *by claim*, and the bar shows the
  order actually drawn. Rows with no `bears` or no year are kept, at an explicit stable position
  (last, in search order), under a line that says so. `?bears=` applies only while prioritised is
  in effect.
- **F8 — the band is handed what it needs.** Article order comes from the blocks, and the marker
  from `Meta.publishedAt`; both go from `Reader` into both bands. Neither is in the artefact.
- **F9 — the claim's identity is `(blockId, claimQuote)`.** Rows about this piece are the first
  group. Two quotes in one block are two groups, in first-seen order; rows sharing a URL stay
  separate rows.
- **F10 — every existing truth, kept.** `leadNote`'s two empty sentences per search and
  `sharedLeadNote` for a visitor; a group emptied by a bar never gets a search-empty sentence;
  `keptNote` on stored counts; `sourcesNote` on the final visible rows of each search; visitors'
  `withheldLines` unchanged; each `hiddenNote` from its own result; the header from the final list.
  What moves is only *where* the lead sentence sits, not what it says or when.
- **F11 — stance sorts on `readStoredLean`**, keeps search order within a stance, says it is the
  AI's reading, and is tested on a legacy `valence` row.
- **F12 — `more` holds the witness too**: `articleReferenceQuote` and `DEBATE_EXTRACTS_ONLY` go in
  the disclosure. A button with `aria-expanded` and `aria-controls` and a title-specific name.
- **F13 — the header says *"6 excerpts from 5 pages"*** when they differ.
- **F14 — an order is offered only when it would change the list**, not only when the field exists.
- **F15 — the deferred DTO note is corrected** below: `PublicDebateRowBase`, `publicDebateRowBase`,
  the `carriesRefused` scan (authors is an array) and the security tests.
- **F16 — `DEBATE_NO_RANKING`** is replaced by the per-order sentences, with the stale comments and
  the panel test updated. The prompt's own "no ranking by prominence" line is true of the search and
  stays.

## The measurement, as it runs

**Before (old prompt `debate/2`, commit 47de0acd, before any edit to src/debate.ts)**, 2026-09-29,
`npm run eval:debate -- run`, runs in `output/debate-runs/` (gitignored):

| article | run | about this piece | about its claims | searches | cost |
|---|---|---|---|---|---|
| cargocult-spya-rz663q | 1 (`21-48-55`) | 0 | 6 | 10 | $0.2285 |
| cargocult-spya-rz663q | 2 (`21-50-44`) | 0 | 6 | 13 | $0.2514 |
| the-mythology-of-conscious-ai | 1 (`21-53-17`) | 0 | 6 | 10 | $0.2265 |
| the-mythology-of-conscious-ai | 2 (`21-54-23`) | 1 | 5 | 11 | $0.2203 |

The old prompt against itself: six rows kept in every run (0+6, 0+6; 0+6, 1+5). The caps are twelve
per pass (`MAX_DIRECT_ROWS`, `MAX_CLAIM_ROWS`), so six is the model's own choice, not a ceiling.

**After (`debate/3` as first built: title, authors, year and `bears`)**, one run per article:

| article | run | reported → kept (claims) | about this piece | title kept | authors kept | year kept | `bears` kept |
|---|---|---|---|---|---|---|---|
| cargocult | `22-09-23` | 6 → 5 | 0 of 0 | 0 of 6 offered | 0 of 1 | 0 of 1 | 6 of 6 |
| mythology | `22-11-29` | 4 → 4 | 0 of 1 | 1 of 5 | 1 of 3 | 1 of 3 | 5 of 5 |

For comparison, the baseline's claims pass, from a free replay of its journals: 7 → 6, 7 → 6
(cargocult) and 7 → 6, 6 → 5 (mythology).

**Two findings, and the first one kills most of the plan's stage 2.**

1. **The title, authors and year are almost never in the extract, so they almost never verify.**
   The extract the search hands back is a *passage from the middle of the page* — the part that
   matched the query — not its head. The model copied the right title every time (it matches the
   engine's own title), and it is refused because the title is not in the passage. On cargocult
   0 of 6 titles verified; the one author and one year offered were refused. The check is doing
   its job: there is nothing on our side of the wire that says who wrote a page or when.
2. **Asking for them cost rows.** The claims pass reported 6 and 4 rows against a baseline of 7, 7,
   7, 6, and kept 5 and 4 against 6, 6, 6, 5 — both below the old prompt's own spread, which is the
   line this plan set. One run each, so not proof; a `bears`-only variant was measured to separate
   the two asks.

**`bears` only (the prompt without title, authors and year)**, two runs per article:

| article | run | kept (claims) | `bears` offered → kept |
|---|---|---|---|
| cargocult | 1 | 6 | 11 → 11 |
| cargocult | 2 | 4 | 5 → 5 |
| mythology | 1 | 4 | 7 → 7 |
| mythology | 2 | 6 | 9 → 9 |

So the row count swings 4–6 on the same prompt, and the full version's 5 and 4 sit inside that: **the
fall was not the fields' doing**, or not provably. `bears` came back on every row the model reported,
in the vocabulary, every time. Cost of all ten runs: about $2.35.

**How `bears` spreads**, from a free replay of the `bears`-only journals: stored claim rows were
3 `directly` + 3 `partly` (cargocult) and 4 + 2 (mythology), and **never `loosely`** — the prompt
already tells the model to leave a page on the same topic that answers nothing out. So the bar's one
move that changes anything is *hide the `partly` rows*, and on a debate where every row is `directly`
it is not drawn at all (the browser check's re-run of mythology came back four `directly`).

### What that decided

- **The search stops being asked for title, authors and year.** They verify on one row in eleven,
  and a check that almost never passes is a prompt instruction that buys nothing. **`bears` stays**,
  and is the whole of `debate/3`. The *prioritised* order and its relevance bar light up on a
  re-run.
- **The fields stay on the row type, and the client stays ready for them** — the byline
  (`authors · year · site`), the `workTitle` rule, the *date* order and its *this piece* marker are
  built and tested, and dormant: no stored row carries the fields, so none of them draws.
- **Authors and year need a bibliographic source, which is Greg's call** — § Deferred: authors and
  year from a lookup.

## After, in a browser

Local dev server on `86272935`, signed in as the owner, 2026-09-29, on
`the-mythology-of-conscious-ai-spya-rn5m0q`:
[1 by claim](260929h-shot-after-1-claim.png) · [2 `more` open](260929h-shot-after-2-more.png) ·
[3 stance](260929h-shot-after-3-stance.png) ·
[4 prioritised, after a re-run](260929h-shot-after-4-prioritised.png) ·
[5 by claim, new data](260929h-shot-after-5-bar-moved.png) · [6 phone](260929h-shot-after-6-phone.png).

Against § Stages' *done means*:

- **A row's source is identifiable without hovering** — yes: the title leads every row, the site is
  under it.
- **Three or more rows on a phone screen** — **not met: about two and a half** (two whole rows and
  the top of a third; a row is ~190–215px at 390px wide, against 370–450 before). Better than one and
  a half, and short of the target.
- **Every order offered changes the list** — yes, and C2–C4 below tightened it.
- The re-run through Metadata worked and wrote `debate/3`; *prioritised* became the default. All four
  rows came back `directly`, so the relevance bar correctly did not draw — which also means **the
  bar has not been seen moved in a browser**; its behaviour is covered by the panel tests only.
- Keyboard: Tab reaches `more`, Enter opens it, focus stays, `aria-expanded` flips.

## The code review (GPT Sol, round 1, 2026-09-29)

Write-capable, on `86272935`. Eight fixed by the reviewer, red-first, and read and re-gated by me
(typecheck exit 0; 27 files, 795 tests; `eval:debate check` 23 of 23):

- **C1 (P1)** the relevance bar's *N of M* counted unjudged rows as clearing it; now *"1 of 3
  judged"*, unjudged rows still always shown.
- **C2 (P1)** the offered and effective orders were computed from every direct row, including ones
  the identification bar had hidden, so an order could be offered whose only difference was off
  screen. Both now use the rows the bar left. This reverses stage 1's *"buttons do not come and go
  while you drag the other bar"*: correctness over stability.
- **C3 (P1)** `?debateby=claim&bears=directly` could resolve to *prioritised* and hide a row, because
  two orders shared a signature. The signature now includes the threshold and the unjudged section.
- **C4 (P2)** the date order's signature now includes its marker and undated section.
- **C5 (P1)** with every claim row hidden by the relevance bar, the lead still said *"What follows
  takes up what it argues."* It now says it only when a claim row follows.
- **C6–C8 (P1/P2)** the eval's bears report: malformed rows in the denominator, a partial journal
  presented as a whole run, and an arithmetic warning suppressed.

Reported, not fixed, and left as they are:

- **C9 (P2)** the dormant byline's line in `more` says the authors and year are *the AI's reading of
  the page*. A lookup would make that false. **Whoever builds § Deferred must carry provenance on the
  fields and change that copy** — it is the one line the lookup cannot reuse as is.
- **C10 (P3)** both prompts say *"No ranking by prominence is applied to what you return, and the
  reader is told so."* The reader is now told what each order does rather than that. Changing it is a
  prompt change with its own measurement; the clause is harmless to the model, so it waits for the
  next `debate/` bump.

## Deferred: authors and year from a lookup

Greg asked for the authors by name. The page's own text, as the search returns it, does not carry
them. What would:

- **By identifier, where the address has one.** `nature.com/articles/nn.4304` is DOI
  `10.1038/nn.4304`; `arxiv.org/pdf/1809.10635` is an arXiv id; `doi.org/…` is itself. Crossref or
  OpenAlex answers a DOI with authors and year, exactly; arXiv's API answers an id. On the reported
  article that is two or three of the five pages.
- **By title, for the rest.** OpenAlex's search on the engine's title, kept only on an exact title
  match. Papers mostly; blogs never.

What it costs: a new outside service (free, rate-limited, no key for OpenAlex), a network call per
row at search time, a cache, and a rule for what counts as a match. That is the "third exception to
prefer boring" question vision.md asks to be weighed, so it is written up here rather than built.
Everything on the client side is already in place for it.

## Settled after the review

- **Two sliders**: disjoint rows, F7 above.
- **The default is *prioritised*** where `bears` exists, as Greg asked, and *by claim* otherwise.
  The researcher would make *by claim* the default outright; with the relevance bar hiding nothing
  by default (F5), *prioritised* costs a reader nothing that *by claim* would have shown.
- **The ⓘ card goes into `more`**: it loses the instant hover preview, and gains keyboard and touch
  parity and removes the portalled-dialog Tab-order defect (F12).
