# Citations missed in the text, filled by code

Feedback `spya-ez2vus` (Greg, admin, 2026-10-26), on LeCun's *A Path Towards Autonomous Machine
Intelligence* (`10356-a-path-towards-autonomous-mach-spya-jwqnrf`):

> Why didn't it notice the citation for Levine 2021 in this paragraph? I feel like citations often
> seem to miss stuff.
>
> — Greg, 2026-10-26

Up: [bibliography.md](../project/bibliography.md). The measurement is
[261027a-how-often-citations-are-missed](../investigations/261027a-how-often-citations-are-missed.md).

## What happened to Levine 2021

Read from production, read-only, on 2026-10-27.

- The paragraph is `spya-g9ssef` (the report's `at=` is the heading above it, `spya-g2afnv`). It
  cites three works: *(Craik, 1943)*, *(Bryson and Ho, 1969)* and *(see for example (Levine,
  2021))*. Craik and Bryson have rows. Levine has none, anywhere in the list.
- The article is a PDF with **author–year** citations. Its reference list is **not among the
  blocks** (stage 2 does not render a PDF's bibliography), and `citation-reference-list.ts` reads a
  **numbered** list only, so the model saw no reference list at all.
- The model (`claude-sonnet-5-5`, `citations/6`, 2026-10-26 21:45) returned **23 works and
  `capped: false`**. A census of the body's author–year citations finds about **99 distinct works**
  (the investigation has the careful count). So the model stopped at about a quarter of the list and
  said it had not.
- Nothing in code could tell. `coverageOf`, the step's coverage witness, counts notes and
  `role: "reference"` blocks reached — both zero on this article — so a 23-of-99 return logged
  exactly like a complete one.

**So no stage dropped Levine. The model never named it, and the in-text mention was never parsed by
anything but the model.** The class is the one
[silent-success.md](../reusable/silent-success.md) names: a step whose only witness of completeness
is the thing being witnessed.

## The fix

### 1. Parse author–year citations in code (`src/citation-author-year.ts`)

A pure, conservative reader of the forms a reader would recognise as a citation:

- **parenthetical**, inside a bracket pair: `(Craik, 1943)`, `(Bryson and Ho, 1969)`,
  `(see for example (Levine, 2021))`, `(Hafner et al., 2018, 2020)`, `(Chua et al., 2018; Yu et al.,
  2020)`, `(van den Oord et al., 2017)`, `(LeCun et al., 1998a)`;
- **narrative**: `Hafner et al. (2018)`, `Becker and Hinton (1992)`.

Each hit is `{ start, end, surnames, etAl, year }`, `start`/`end` being the exact characters of the
one citation (`Levine, 2021`), so a place built from it is the article's own text by construction.
A first word that is a month, `In`, `Figure`, `Table`, `Section`, `Since` and the like is not a
surname. Only `text`, `quote` and `caption` blocks outside a note and outside `role: "reference"` are
read: a mention is a place in the main text.

### 2. Fill the gap with a row from the text

In `buildBibliography`, after the cap: every distinct `(first surname, year)` the parser found that
**no row covers** becomes a row of its own. *Covers* means a row's verified mention overlaps the hit,
or the row's first author's surname and its year match (folded: case, diacritics, a particle such as
`van den`). The row is:

- `title`: the citation as a label, `Levine (2021)`, `Bryson and Ho (1969)` — the shape the prompt
  already asks the model to write when the article gives no title;
- `authors`: `Levine`, `Bryson, Ho`, `Hafner et al.`; `year`: `2021`;
- `mentions`: the first `MAX_MENTIONS` hits, quoted exactly; `citedAt` from every hit, as today;
- **no `why`, no `relevance`, no `influence`**; `linkFrom: "search"`, a Scholar search, as any row
  without an identifier;
- `listedBy: "text"` — the one new field, so the row and the card can say *found in the text; not
  described* rather than leave a blank, and so a later model pass can tell its own rows from code's.

`why` becomes optional on `CitedWork`, so the compiler finds every reader of it. **The cap does not
apply to these rows**: it exists to bound the model's answer, and these cost no tokens. `capped`
stays the model's own word, so the *more than 80* sentence is still drawn only from it; a list it
filled reads in full.

**In the band** the row draws as any row with no scores already does (`priorityOf` is undefined, so
it survives every position of the bar and sorts after scored rows in the prioritised orders). **In
the prose** it is marked like every other work, which is what the report was about: the paragraph
Greg was reading would have shown *(Levine, 2021)* marked, with its card and a Scholar search.

### 3. A witness that would have seen it

`Coverage` gains `authorYear` (distinct works the parser found) and `authorYearFilled` (rows code
added). The step's log line carries both, so a model return of 23 against a body of 99 is visible
in one line even before the fill.

### Version

`PROMPT_VERSION` goes to `citations/7`: the same input now yields a different list, so a stored list
is honestly `outdated` (silent, as for every artefact). Nothing re-runs by itself.

## What this does not fix, and what waits for the model budget

- **Numbered citations.** A numbered PDF's list is already read, and a work cited as `[12]` with no
  row could be filled from entry 12 the same way. Whether to is decided by the investigation's
  numbers for the numbered articles; if they show misses, it is a stage of this plan, else a queue
  item.
- **Rows with no `why` or scores.** The better end state is that the model describes every work. That
  is a prompt change — hand the model the parser's list as a checklist, and split a long article
  into sections so one call does not tire — and it needs before/after runs on the same articles.
  The box's OpenRouter key is over its limit until 2026-11-01, so it is a queue item, with the
  investigation's articles as its fixed set.
- **An author–year PDF reference list** is still not read. The parser finds what the body cites; the
  entries would give titles. Also queued.
- **Existing lists** change only when made again (Metadata redo), which needs the model too. Greg's
  article included.

## The simpler option passed over

**Only the prompt**: tell the model to list every work and not stop early. It is the cheapest change
and the one the model already ignored — `citations/6` already says *"If the article cites more than
80 works, keep the 80 it leans on most and set capped: true"*, and the model returned 23 with
`capped: false`. It also cannot be measured until 1 November, and an unmeasured prompt change is not
a fix ([prompting-guide.md](../project/prompting-guide.md)). Code that reads the citations is
deterministic, testable now, and is the witness either way.

**A count only** (stage 3 without stage 2) was the other: it would make the miss visible in a log no
reader sees, and Greg would still not find Levine.

## Stages

1. Parser, with tests from the LeCun paragraphs (red first). Coverage fields.
2. The fill in `buildBibliography`, `listedBy`, optional `why`; the band and the card say *found in
   the text*. Tests: the Levine paragraph through `buildBibliography` with a model answer that has
   Craik and Bryson only.
3. Docs: bibliography.md, the investigation, the postmortem, the feedback note.

## GPT Sol's plan review, and what changed

The review (2026-10-27, `gpt-5.6-sol`, read-only) found real holes. What was built differs from the
sections above as follows:

1. **A mention that spans several citations covers only its own.** A model row for Chua whose
   mention is `(Chua et al., 2018; Yu et al., 2020)` does not stand for Yu. A row covers a
   citation by its first author's surname and base year, by its own entry naming them, or by a
   verified mention that overlaps the citation and holds no other. The model's own author words
   are kept for this (`Draft.said`), because the article guard drops `Yann LeCun`.
2. **Proof, not inference.** Production's log line for the run has every drop counter at zero, so
   the model returned 23 works and no stage dropped Levine (§ What happened, now evidenced in the
   investigation). The same line exposed a second fault: a bogus 9-entry "numbered reference list"
   that was really the appendix's Table 1. `referenceListFrom` now refuses a run in which fewer
   than half the entries carry a year.
3. **Code's rows have a ceiling of their own**, `MAX_TEXT_ROWS` = 200, and the rest are counted
   (`textOverCap`). When a capped list also has code's rows, the capped note says so
   (`cappedNote`).
4. **`why` is optional, and every reader was made to say so.** The suggested discriminated union
   was passed over: `CitedWork` feeds `Omit<>`-derived types (`PublicCitedWork`, `ShownWork`) that
   a union would collapse. Making the field optional made the compiler list every reader, and each
   now handles the absence. The chat tool and the lookup and investigate contexts write
   `WHY_NOT_DESCRIBED`, and the band and the card draw the why only when it exists.
5. **Ids cross between code's row and the model's** (`authorYearAlias`), when the surname and year
   are unique on both sides. A stored model row whose author the guard removed is found by its
   verified mention.
6. **The fill runs after the "nothing anchored" guard**, so a broken model answer still fails.
7. **`citedAt` keeps today's cap of three mentions.** The plan's "from every hit" was wrong.
8. **The prioritised order interleaves code's rows** rather than putting them last. A row with no
   priority already survives every position of the bar, and code's rows follow the same existing
   rule. Whether they should sort last instead is a product question for Greg
   ([q-knkbsk](../user-feedback/questions/q-knkbsk.md)). Sources › *Not cited* matches code's rows by first
   author and year.

Two false-positive classes came out of running the parser over every local article, and each has a
test: reference-entry lines the extraction did not mark, and a title followed by its year
(`Voyelles (1871)`). § Rows from the text in [bibliography.md](../project/bibliography.md) has the
rules.

## Result

On LeCun's stored list, code adds 78 rows and fills 79 of the 82 hand-counted misses, with no
false fills. The three it leaves are left by design. On the other nineteen local articles it adds
between 0 and 136 rows, and a spot check found no false ones.
[Investigation 261027a](../investigations/261027a-how-often-citations-are-missed.md) has the
tables, and lists what waits for model calls.
