# A table parser relied on a separator the prompt never named

Report `spya-xn4597` (#660), Greg, 2026-10-19, on a reader's import of the LSE report *Review of the
Evidence of Sentience in Cephalopod Molluscs and Decapod Crustaceans* (109 pages, printed to PDF
from Firefox through macOS Quartz):

> The user Adrian just imported an article about sentience in animals, and a lot of the figures
> didn't seem to import.

The figures did import. The report's central graphic, a colour-coded grid of confidence levels
printed as four tables, reached the reader as two tables with every heading one column out of place
and two tables where each row was one cell of run-together text. This did reach a reader, and it
had been reaching readers since tables were first shown on 2026-10-01. The plan with the production
evidence is [261020h](../plans/261020h-pdf-table-cells-split-on-tabs-and-the-prompt-names-the-separator.md).

## What happened

The transcription model writes each table row as a `tabledata` record. At the time, `tableRows` in
`src/pdf-read.ts` split a record into cells on `|` and nothing else. On this report:

- **Tables 2 and 5** came back tab-separated: `Octopods (Octopoda)\tVH\tVH\t…`. No `|`, so each row
  was one cell.
- **Tables 1 and 3** used `|` but left out the blank top-left cell above the row labels, so every
  column heading sat over its left-hand neighbour's column.

Across production's stored PDF transcriptions (read only, 2026-10-19): 421 `tabledata` records in 9
articles. **44 records in 4 articles are tab-separated** (no record mixes tab and bar separators).
**318 records in 2 articles are separated by runs of spaces**, which nothing can split reliably
after the fact, because a space also sits inside a cell. So a third of the articles with tables had
them drawn wrongly, and the space-separated two cannot be repaired without re-reading the PDF.

## The root cause

Rule 7 of the transcription prompt asks for *"the cells as printed, reading across each row in
turn"*. It never says how to separate one cell from the next, or how to write an empty one. The
parser that consumes those records was written in `d77e138ee` (2026-10-01, *"A PDF's tables show
their cells, not just their caption"*, plan
[261001q](../plans/261001q-pdf-tables-and-composite-figures.md)), and it states the gap in its own
comment:

> The prompt does not name a separator, and on the eval corpus the model writes `a | b` unprompted

The commit chose not to touch the prompt on purpose — *"No prompt change, so no cached chunk goes
stale"* — which was a reasonable trade for shipping cells that day. But it turned an observed habit
of the model into the parser's input format, without ever telling the model. The habit held on the
eval corpus and on the one real table the test was built from; it did not hold on a third of
production.

## The class, named

**A consumer depends on an output convention its producer was never told: "the model usually does
X" treated as a contract.** A contract has two sides. Here only the reader side was written down,
in a comment, and the writer side was a habit that varies with the document, the chunk and the
model's mood. The two failures on this report, the missing separator and the missing empty corner
cell, are the same mistake twice: neither the separator nor the empty cell is named in the prompt,
so neither is reliably produced.

It is a cousin of [silent-success.md](../reusable/silent-success.md): the parser never fails, it
returns a valid one-cell row.

## Why nothing went red

- **The integrity check scores the record's text**, and the text was faithful: every cell's words
  were there, in order. Recall and precision were fine. Only the rendering lost the structure, and
  nothing scores the rendering.
- **The tests' fixtures were all `|`-separated**, because they were written from the one model
  output the author had (the JCO paper in `tests/pdf-tables.test.ts`) and from hand-made rows in the
  same shape. A test built from the producer's habit agrees with a parser built from the same habit.
- **The renderer cannot tell a one-cell row from a broken one.** A one-column table is legal, so
  `tableRows` returning `[["Octopods (Octopoda)\tVH\tVH…"]]` is not an error anywhere.
- **The eval corpus showed the habit, not its spread.** "Unprompted" was measured on a handful of
  papers, and nobody asked what the model writes on a print-to-PDF of a policy report.

## What would have caught it, ranked by ease against value

1. **Name the format in the prompt whenever code parses the model's text.** A few sentences in
   rule 7: one tab between cells, a newline between rows, an empty cell written as nothing between
   two tabs, the top-left corner included, and the tabs declared structure rather than copied text.
   A tab and not `|`, because a PDF prints no tab, so the separator can never be the author's own
   character (GPT Sol, plan review). This is the fix for the class, and the only one that reaches
   the space-separated case or the missing corner. Stage 2 of 261020h, measured before it landed,
   at the cost of one prompt-fingerprint change.
2. **Parse the variants defensively anyway.** Split on tabs whenever a line has one, keeping empty
   edge cells; split on `|` otherwise, for chunks read before the prompt named a separator.
   Stage 1 of 261020h, no model call. A rule that put back a missing corner cell by guessing from
   row widths was written and withdrawn: a short first row does not prove which cell is missing
   (GPT Sol). The prompt asks for the corner instead.
3. **Survey production's records before trusting a convention.** A query over the stored
   transcriptions, counting records with `|`, with tabs, and with neither, takes minutes and would
   have shown the 44 and the 318 on the day the parser shipped. Worth doing for any parser of model
   text, at the point of writing it.
4. **A check that counts one-cell rows in a table whose other rows have several cells**, logged per
   import. Cheap, and it would have flagged Tables 2 and 5 at once. Not built: with 1 and 2 in
   place it would fire only on a model that ignores the named separator, and the measurement in
   261020h is the evidence that it does not; a canary for that is worth building if it ever does.
5. Fixtures from a second model output, or a second model. Rejected as the main defence: it widens
   the habit you sample but still samples a habit; rule 1 replaces the habit with an instruction.

## The fix that is right for the long term

State the contract on both sides: the prompt names the format, and the parser accepts what the
prompt names plus the variants already seen in production. Both halves shipped together. Existing
articles change only when re-extracted, which is a production write and is not done here, and a
re-extraction re-reads every chunk under the new prompt, since the prompt's fingerprint is the
cache key.

**Not this class, recorded so nobody reads it as part of it:** the report's cover photograph was
also missing, for a separate reason. The Quartz print cut it into abutting image slices, so the
locator refused it as `assembly` (`src/pdf-figure-locate.ts`), and the composite route needs a
printed caption, which a cover has none of. Queued separately, as `qi-r6f9s4f9`.

## The thing I would tell myself

The comment that says *"the prompt does not name a separator"* was the bug, written down. If a parser
needs a comment explaining that its input format is a habit, the fix is one sentence in the prompt,
not the comment. A cache going stale is a cost you pay once; a convention nobody told the model is
a cost every reader pays until somebody looks.
