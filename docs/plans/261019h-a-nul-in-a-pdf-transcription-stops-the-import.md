# A NUL in a PDF transcription stops the import

Report `spya-u5azdm` (#615, SPIDERYARN-READING2-K7; error issue SPIDERYARN-READING2-K6), from Greg,
2026-10-19, queue item `qi-hbttzcrs`. Job `spya-k0ytd8`, upload
`conscious-artificial-intelligence-and-biological-naturalism.pdf` (109 pages, 8 MB):

> This import failed. … Failed at step: extract · Failure kind: bug · Error: Extracting the article
> did not finish, and it stopped on a defect in this app rather than on anything you did. …
> [jb-step-bug]

## What happened

Reproduced from the original PDF (read from the `sources` bucket, read-only) and from production's
logs and checkpoints, also read-only:

```
 pdf.js text, pages 51, 72, 78:  "UðπτÞ \u0002 Uðπ0Þ ¼ ΔU ¼ kBT \u0003 ΔF"   ← maths font with no
                                                                            usable ToUnicode map
 the model, asked to transcribe those pages, wrote a U+0000 (JSON "\u0000") into a record
 parseRecords strips NOISE (noncharacters, default-ignorables) — not C0 controls — so it stayed
 10:11:15  keepChunk → checkpoints.value (jsonb) → 22P05, logged at warn and swallowed (by design:
           a failed checkpoint costs a re-read, not the step)
 10:11:26  writeArtefacts → article_revisions.extracted_html (text) → 22021 → [db-failed] → bug
```

The evidence: production holds 37 `pdf-chunk` checkpoints for the article covering pages 1–109
except **49–51, 70–72 and 76–78** — the three chunks around the three pages whose pdf.js text
carries control characters. Vercel's log has the `22P05` warning from `keepChunk` for this slug at
10:11:15. Postgres refuses U+0000 in `text` (22021) and in `jsonb` (22P05), and accepts every other
C0 control.

**The failure message was right.** Kind `bug` and `[jb-step-bug]` ("a defect in this app … trying
again will not help until it is [fixed]") is what happened: the PDF is fine, and our code wrote a
character Postgres cannot store. Retrying would have paid for the three chunks again and failed the
same way. Nothing to change there; a test pins it stays `bug` rather than becoming a reader-facing
sentence about their file.

## The fix: clean foreign text where it enters, once per entrance

There are exactly two places text from outside our code enters the PDF path:

1. **The model's transcription**, in `parseRecords` (src/pdf-read.ts). Its own comment already
   calls it *"the boundary where a stranger's model output becomes our data"*, and it already
   strips `NOISE`. C0 controls other than tab, LF and CR join `NOISE`: none is ever on a printed
   page, and NUL is one Postgres will not store. They are stripped and counted with the rest, so
   they land in the existing `stripped` figure. Everything downstream — the checkpoint, the
   rendered HTML, the blocks, the front-matter and authors passes (which choose record ids and copy
   the records' text) — sees clean records, and the checkpoint now succeeds too.
2. **pdf.js's text layer**, in src/pdf.ts. Three functions read `item.str` (`pass0`,
   `firstPagesText`, `frontPagesWithStamps`). pass0's text is the scoring baseline, and the
   quality notes quote it into `meta.quality` (`text[]`), so a PDF whose text layer itself held a
   NUL would fail the same way. One helper, `itemText(item)`, strips the same class, and all three
   read through it.

The class lives once, exported from src/pdf.ts, and `NOISE` is built from it.

**Cached chunks** come back through `validateChunkReading`, not `parseRecords`. That is fine: a
checkpoint cannot hold a NUL (jsonb refused this one), and the other controls Postgres accepts.

### The simpler and the wider options passed over

- **Strip NUL only.** Smaller, and it fixes this job. But `\u0002` and friends are just as
  meaningless on a page, they reach the reader as invisible junk in the prose, and HTML treats them
  as parse errors. One class costs nothing more.
- **A backstop in the store** (`writeArtefacts` scrubbing every string). It would also cover the
  HTML path and every model call, but it silently rewrites whatever any step hands it, one field
  type at a time (`text`, `text[]`, `jsonb`), at the layer that is supposed to store what it is
  given. Greg asked for the fix at the source. Not done; named here in case a NUL turns up
  somewhere else.
- **Treat 22021/22P05 as their own failure kind.** It is a bug in our code every time, which is what
  `bug` already says.

## What GPT Sol's plan review changed

[The review](261019h-a-nul-in-a-pdf-transcription-stops-the-import-plan-review-sol.md) approved with
changes. All four findings were right, and all four are built:

1. **Spaces, not nothing.** Deleting a control joins the words either side (`alpha\u0002beta` →
   `alphabeta`), and the scorer then counts that as a miss. src/html.ts § `normaliseText` already
   turns controls into spaces for the same reason.
2. **The PDF metadata step's own model answer is a third entrance.** `parseAnswer` in
   src/paper-metadata.ts writes title, authors and abstract into `Meta`. Cleaned in `oneLine`,
   which every one of those strings passes.
3. **A replayed checkpoint never passes `parseRecords`.** So the transcription is cleaned in
   `validateChunkReading` (src/pdf-integrity.ts) instead, which every reading passes (fresh,
   recovered or cached) before it is scored or kept. `NOISE` is as it was.
4. **Crossref and DataCite strings are a fourth.** `plainRegistryText` (src/bibliographic.ts)
   cleans their prose after it decodes entities, since `&#1;` decodes to one; `normaliseDoi`
   cleans the registry's DOI before trusting its shape too. The DOI was added in code review:
   `DOI_SHAPE` admits any non-whitespace suffix character, including NUL. A failure there was
   caught and read as "registry unavailable", so it would not have failed an import, but it would
   have quietly lost the record.

The class and the list of entrances live once, in **src/control-characters.ts**
(`CONTROL_CHARACTERS`, `controlsAsSpaces`). So "exactly two places" above is wrong: there are four,
and that file names them.

## Stages

One stage. Red test first (`tests/pdf-read.test.ts`, the `honestReader` stub with a NUL and a
`\u0002` sabotaged into a record, asserted clean and counted; and `parseRecords` on a JSON body
with `\u0000`), then the fix, then a pass0 unit check on `itemText`. Gates: `npm test`,
`npm run typecheck`. GPT Sol on this plan before building, and on the diff before pushing.

Added while building, because it is why no test saw this: **`checkpointJson`
(src/store/checkpoints.ts) refuses a U+0000**, as jsonb does. Both stores and the memory fake
share it, and the fake's header promised it *"refuses what the real store refuses"*, which it did
not. Tested against the live store (`tests/store-checkpoints.test.ts`), red without the check. The
class and the countermeasures are in
[261019c](../postmortems/261019c-foreign-text-cleaned-for-the-noise-we-had-seen-not-for-what-the-database-can-hold.md).

## Re-running job `spya-k0ytd8`

Safe once this is deployed: the 37 good chunks are cached (40 in all), so a retry pays only for the three that
failed (≈ 9 pages) plus the front-matter and authors passes. It is a production write, so it is left
for Greg (or the Overseer after the deploy) — not done here.
