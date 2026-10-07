# Plan review: a small model tidies an imported title

You are reviewing a plan before it is built. Read-only: change no files.

Read, in this order:

- `docs/plans/261005j-a-small-model-tidies-an-imported-title.md` — the plan.
- `docs/plans/261005g-tidy-an-imported-title-and-keep-the-original.md` — what is already built (the
  rule, `title_original`, the undo).
- `src/title-tidy-model.ts` — the prompt, the schema, the check and the fallback, already drafted so
  the measurement could call production's own function. `src/title-tidy.ts` is the rule.
- `evals/title-tidy/run.ts` and `evals/title-tidy/wild-titles.json` — the measurement.
- The three seams: `src/extract.ts` § `runExtract` around `tidiedTitle(`, `src/pdf-read.ts` §
  `runPdfExtract` around `tidiedTitle(`, and the `metadata` step in `src/pipeline.ts` with
  `paperMeta` in `src/paper-metadata.ts`.
- `src/paper-metadata.ts` is the module this one copies; `src/ai-call.ts` § `AI_JOB_ROUTE` and
  `CHAT_REASONING` have the new `title-tidy` rows beside `paper-metadata`'s.
- `src/source-hash.ts` § `articleFingerprint`, for the claim that the title cannot change after
  extract.

The owner's two answers are quoted at the top of the plan. He asked for a piggyback on an existing
import call "ideally", a separate cheap call only if none fits, the tidy kept light, and the rule
kept as the fallback.

Please answer:

1. Is the "nothing sound to ride on" table right? Check each row against the code. Is there an
   import-time model call I have missed that sees the title before it is first stored?
2. `isLightEdit`: can an answer pass it and still be a bad title (think of a cut at one end that
   leaves a third of the letters, NFKC, digits, a title that is mostly a site's name)? Can a good
   answer fail it often enough to matter? Is a third the right floor, or should the floor go?
3. The prompt, `TITLE_TIDY_SYSTEM`: the title is a stranger's text. Is the fencing sound? Is any
   instruction likely to make a title worse often (read it against real titles: a sentence-case
   paper title, a title with a subtitle after a dash, an author's name after a dash, a series
   name, a title in German or French)?
4. The fallback: is there any failure of the call that would reach the caller as a throw and fail
   the import, where today's rule cannot fail? Is 8 seconds a sane deadline inside `extract` and
   inside the `metadata` step, given their own deadlines (src/jobs.ts)?
5. Trade-off 2 in the plan (a re-extraction can change the title and mark modes stale). Is leaving
   it out of v1 defensible, or is there a cheap, sound way to hold the title steady that I have
   missed?
6. Privacy and routing: the title of an uploaded document goes to DeepSeek on the zero-retention
   route `paper-metadata` uses. Anything wrong with copying that row?
7. Anything else that would be a bug, a silent failure, or needless complexity. Name the simpler
   design if you see one.

Give findings as a numbered list, each with a severity (P0 to P3), the evidence (file and line),
and what you would change. Say plainly if a section is fine. End with a one-line verdict.
