# Debate mode: say what each source is, and let the reader order the list

Status: **plan, before the plan review.** Report SPIDERYARN-READING2-5P (spya-w7t24d), from Greg's
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
| `published` | parses as `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, and its year is in the extract or the URL | the ISO string |
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
| **prioritised** | rows about this piece first, then `directly`, `partly`, `loosely`; a three-stop bar hides below a stop, default `partly` (`?bears=`) | `bears` |
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
3. **Docs, the note, after-screenshots** of the same five views, and the visitor half written up.

Done means: a row's source is identifiable without hovering, three or more rows fit on a phone
screen in *by claim*, and every order that is offered changes the list.

## Deliberately not in this

- **The public DTO.** `src/public/dto.ts` is a listed defence (security-map.md § Where the defences
  physically live) and this run is unattended, so the stage-2 fields **do not cross to a visitor** —
  the allowlist's default-absent behaviour. A visitor keeps stage 1 in full and is offered *by
  claim* and *stance*. Crossing them is four `opt(row, "…")` lines plus the `carriesRefused` list;
  left for Greg.
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

## Open for review

- Two sliders on an article with both kinds of row.
- *by claim* as the fallback default and *prioritised* as the default once `bears` exists — the
  researcher would make *by claim* the default outright. Greg asked for prioritised.
- Whether folding the ⓘ card into `more` loses anything a hover gave.
