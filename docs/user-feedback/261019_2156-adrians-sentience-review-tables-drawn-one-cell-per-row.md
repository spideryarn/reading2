---
reports: spya-xn4597
ending: shipped
comment: The figures did import; the four colour grids came out as broken tables. The prompt now names the cell separator. The sliced cover photo is queued as qi-r6f9s4f9, waiting on you.
---
# Adrian's sentience review: the figures imported, the tables did not

Report spya-xn4597 (#660, `SPIDERYARN-READING2-MS`), 2026-10-19 21:56 UTC, kind suggestion, from an
admin (Greg; `feedback-reporter.ts` exit 0). Queue item qi-akgxffbb. No addenda (re-read 2026-10-20).

> The user Adrian just imported an article about sentience in animals, and a lot of the figures
> didn't seem to import. You have permission to read the production database to have a look and try
> and figure out why. You don't need to re-import that article, but ideally let's try and improve
> things so that going forwards it would have worked.

**Ending: shipped** on `dev`. Plan
[261020h](../plans/261020h-pdf-table-cells-split-on-tabs-and-the-prompt-names-the-separator.md),
with both GPT Sol reviews beside it; measurement
[261020b](../investigations/261020b-pdf-table-separator-named-in-the-prompt-measured.md); postmortem
[261020a](../postmortems/261020a-a-table-parser-relied-on-a-separator-the-prompt-never-named.md).

What was wrong, in plain words (production read only, never written): the article is the LSE's
109-page *Review of the Evidence of Sentience in Cephalopod Molluscs and Decapod Crustaceans*, printed
to PDF from Firefox. **All five of its figures imported and were served to Adrian.** What looked like
missing figures was the report's central graphic: the colour grid of confidence levels, printed as
four tables. Two came back with every row as one run-together cell, because the model separated
cells with tabs and we only split on `|`. The other two had each column heading one place to the
left. The prompt never said how to separate cells. Across production, 4 of the 9 PDFs with tables
were hit the same way, and 2 more had cells separated by spaces, which cannot be repaired afterwards.

Now the prompt asks for a tab between cells and the blank corner cell, and the parser splits on tabs.
Measured on seven real table pages, the old prompt's separator changed from call to call and broke a
table on 4 of 14 reads; the new one used tabs every time, on all 14.

Also found:

- **The cover photograph** was not recovered, and still would not be. The print cut it into two
  slices, which the figure finder refuses on purpose, and its fallback needs a printed caption.
  Queued as its own proposal, **qi-r6f9s4f9**, waiting on Greg's authorisation, together with the
  foreword portrait, which the transcription never recorded at all.
- The grids' colours are not kept: the letters VH/H/M/L and the caption's key carry the same
  information.

**This article is not re-imported**, as Greg asked. A re-extraction after the deploy would bring its
four grids back as aligned tables; it is a production write, and Adrian's comments and notes on the
article would need checking first.
