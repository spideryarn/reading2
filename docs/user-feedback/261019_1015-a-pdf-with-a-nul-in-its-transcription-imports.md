---
reports: spya-u5azdm
ending: shipped
comment: The model wrote an invisible NUL while reading three pages of maths, and the database stores none. Such characters now become spaces where text comes in. Once deployed, retry the job; it pays only for those three chunks again.
---
# A PDF with a NUL in its transcription imports

`spya-u5azdm` (#615, problem, SPIDERYARN-READING2-K7; error issue SPIDERYARN-READING2-K6), from Greg
(admin; `feedback-reporter.ts` exit 0 on the production row). Filed 2026-10-19 10:15 UTC from
`/add/upload/68fd18f8-…`, build c9854a23. Queue item `qi-hbttzcrs`. Addenda: none.

> This import failed.
>
> Job: spya-k0ytd8 · Article: conscious-artificial-intelligence-and-biological-spya-drhjjm ·
> File: conscious-artificial-intelligence-and-biological-naturalism.pdf · Failed at step: extract ·
> Failure kind: bug · Error: Extracting the article did not finish, and it stopped on a defect in
> this app rather than on anything you did. … [jb-step-bug]

**Ending: shipped**, on `dev`, not deployed. Plan, evidence and both GPT Sol reviews:
[261019h](../plans/261019h-a-nul-in-a-pdf-transcription-stops-the-import.md). Postmortem:
[261019c](../postmortems/261019c-foreign-text-cleaned-for-the-noise-we-had-seen-not-for-what-the-database-can-hold.md).

## What we found

The original PDF was read from storage, and production's logs and checkpoints were read too. All of
it was read-only.

- Three pages (51, 72, 78) are set in a maths font with no usable ToUnicode map, and pdf.js reads
  their minus signs as control characters (U+0002, U+0003).
- The model, transcribing those pages, wrote a U+0000 (NUL). Postgres stores no NUL, so the chunk's
  checkpoint was refused first (22P05, logged and swallowed by design). Eleven seconds later the
  whole article was refused at `extracted_html` (22021).
- Production holds 37 of the 40 chunk checkpoints this article needed. The three it lacks cover
  pages 49–51, 70–72 and 76–78.
- **The failure message was right.** It said *bug*, and it was ours: the PDF is fine. A retry would
  have failed the same way.

## What we did

- Control characters (C0 other than tab, newline and CR, plus DEL) now become spaces where foreign
  text comes in. There are four places, all named in `src/control-characters.ts`:
  - pdf.js's text;
  - every transcription, fresh or replayed from a checkpoint;
  - the paper-metadata model's answer;
  - Crossref and DataCite strings.
- `checkpointJson` refuses a NUL, as Postgres's jsonb does. The tests' in-memory checkpoint store
  now refuses what production refuses, and that gap is why no test had seen this.
- Tests went red first: the model answer with a NUL, the stage end to end, and the checkpoint
  store.
- Checked on the real file: pdf.js's text for this PDF now carries no control characters.

## The job itself

Not re-run: that is a production write, and the fix is not deployed. Once it is, **Retry on job
`spya-k0ytd8` is safe and cheap**. The 37 good chunks are cached, so it pays only for the three that
failed (about nine pages), plus the front-matter and authors passes.
