# Foreign text cleaned for the noise we had seen, not for what the database can hold

Report `spya-u5azdm` (Greg, 2026-10-19), job `spya-k0ytd8`, Sentry SPIDERYARN-READING2-K6. The plan
and the evidence are in
[261019h](../plans/261019h-a-nul-in-a-pdf-transcription-stops-the-import.md).

## What happened

A 109-page PDF has three pages set in a maths font with no usable ToUnicode map. pdf.js reads its
minus signs as U+0002 and U+0003. The model, transcribing those pages, wrote a U+0000. `parseRecords`
cleaned the model's text of noncharacters and default-ignorables, but not of control characters, so
the NUL went through. Postgres stores no NUL, in `jsonb` (22P05) or in `text` (22021):

```
10:11:15  keepChunk → checkpoints (jsonb)           22P05 → warn, swallowed (by design)
10:11:26  writeArtefacts → extracted_html (text)    22021 → [db-failed] → job failed, kind bug
```

Three minutes of transcription were thrown away, and a retry would have paid for the three failed
chunks again and failed the same way.

## The root cause

`NOISE` in src/pdf-read.ts was written on 2026-08-26 (`f68a6016f`, *Read a PDF with a model, and
refuse to write half an article*) from **what had been observed**: U+FFFE where the model joined a
URL across a line, zero-width spaces. That is a list of the noise we had seen. The rule that
actually bounds what may pass is set by the destination, and it was never written down at the
boundary: **Postgres will not store U+0000.** Nothing about the transcription forbids a NUL, since
JSON allows `\u0000` and the model has no reason to avoid it.

The reason no test could see it is the second half. `tests/helpers/memory-checkpoints.ts` says in
its header that *"it refuses what the real store refuses"*, through the shared `checkpointJson`.
But `checkpointJson` checked only that the value serialised, and jsonb refuses more than that. So
the one stage test that could have written a NUL into a checkpoint would have passed against the
fake.

## The class

**Foreign text cleaned for the noise we had seen, not for what the sink can hold.** A cleaner at a
trust boundary that is a list of observed junk will let through the first junk nobody has observed
yet. If it is built from the destination's contract, it will not. Close cousin: **a faithful fake
that is faithful to the checks we wrote, not to the store**. The fake copied our validation rather
than Postgres's.

## The fix

- **Shipped:** C0 controls other than tab, LF and CR, and DEL, become spaces where foreign text
  comes in. There are four places, and src/control-characters.ts, which holds the class, names
  them:
  - pdf.js's text runs, through `itemText`;
  - every transcription, fresh or replayed, in `validateChunkReading`;
  - the paper-metadata model's answer;
  - Crossref and DataCite prose and DOI strings.

  `checkpointJson` now refuses a NUL, with a sentence that says so. Both stores and the fake share
  it, so the fake refuses what jsonb refuses.
- **Right for the long term:** the same. The entry seams are the right place. A scrub in the
  store would hide the next bad producer instead of naming it.

## What would have caught it, ranked by ease against value

1. **`checkpointJson` refuses U+0000** (done). It is one regex, and every stage test that writes a
   checkpoint now meets Postgres's rule without a database.
2. **When a best-effort write fails with a `bug`-kind code, say so at `error`, not `warn`**
   (not done). A checkpoint refused for a reason that is not transient predicts that the commit
   will be refused too. Here the warning came eleven seconds before the failure, and nobody reads
   `warn`. Cheap, but it touches how `keepChunk` and its siblings log. Worth doing when the next of
   them is touched.
3. **A fixture PDF with a font that has no ToUnicode map**, run through the stage with a stub
   reader that echoes control characters (not done). It would pin the pdf.js half end to end. Today
   the unit tests on `itemText` and `frontPageRecord` do that more cheaply.
4. **Scrub every string in `writeArtefacts`.** Rejected. It covers producers we have not thought
   of, but it silently rewrites what a step hands the store. The next bad producer would never be
   found.
