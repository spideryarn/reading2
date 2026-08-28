# Second review: a fifth vocabulary source, and the eval that had to be re-run

You reviewed this change on 2026-08-27 and returned **not ready** with nine findings
(`docs/plans/dictation-vocabulary-review-sol.md`). All nine were fixed. Your closing ask was to
"rerun a production-equivalent, randomised evaluation before using the negative result to license
large lists". That rerun has happened, and since then Greg asked for one more source. Please review
the delta, adversarially. Read-only.

## What changed since your review

1. **All nine of your findings were addressed.** The fence now strips angle brackets from every
   term; the eval calls `transcribeWith` — the app's own request, system prompt, schema and provider
   flags — instead of its own weaker copy; the profile is sliced to 400 characters against
   `MAX_PROFILE_CHARS` of 1,500; the invented-terms floor dropped from six characters to three; the
   run interleaves conditions instead of blocking them; a `+names(10)` condition replaced a dud
   control; three sentences that contradicted the results table were rewritten. There is a table of
   all nine in `docs/plans/dictation-vocabulary.md` § What the review changed.

2. **A fifth source: `ShelfState.purpose`** — the "why you're reading this one" box on the Metadata
   page. `purposeTerms` in `src/transcribe.ts`, one `shelfStore.read`, sliced to 300 characters,
   ranked second (ahead of the reader's global profile, behind the site terms).

3. **A tenth clip and an eleventh condition** to measure it. `purpose-box` in
   `evals/dictation/utterances.json` says four terms that exist nowhere in `data/`; the `+purpose`
   condition is the only one that supplies them.

4. **The results section is rewritten** from a real five-run, ten-clip, eleven-condition run:
   550 calls, $0.154, `evals/dictation/results-vocabulary-sources.json`.

5. **The composition moved out of `src/transcribe.ts` into `src/vocabulary-sources.ts`**, because
   Greg asked for it to be reusable for dictation boxes elsewhere. `SOURCES` is a map of named
   sources; `RECIPES` says which sources each place asks for, in order; `Where` and `parseWhere`
   moved with them and are re-exported from `transcribe.ts` so no caller changed. `SourceName` is
   derived from the source map's keys, so a recipe naming a source that does not exist is a compile
   error rather than a silently dropped source.

## Read these

- `docs/plans/dictation-vocabulary.md` — the plan, with the new § The fifth source arrived after
  the rest was measured, § The whole thing on one page, and the rewritten § Results.
- `src/vocabulary-sources.ts` — new. `purposeTerms`, `MAX_PURPOSE_IN_VOCABULARY`, `SOURCES`,
  `RECIPES`, `vocabularyFor`, `Where`, `parseWhere`.
- `src/transcribe.ts` — now only the model call; what it re-exports is at the top.
- `src/vocabulary.ts` — unchanged since your review except a two-character word floor.
- `tests/transcribe.test.ts` — the three new tests and the `shelfStore` mock.
- `evals/dictation/bench-vocabulary-sources.ts` — `PURPOSE` and the `+purpose` condition.
- `evals/dictation/utterances.json` — the `purpose-box` clip and its `why`.
- `evals/dictation/results-vocabulary-sources.json` — every vocabulary and every transcript.
- `evals/dictation/README.md`, `docs/project/dictation.md`.

## What I most want you to attack

1. **Is the `purpose-box` clip a fair test or a rigged one?** Its four hard terms were chosen
   because nothing in `data/` contains them, and the box's text was written to contain them. That is
   circular in an obvious way. Does the design still support the claim it is used for — that the box
   supplies terms no other source could? Two of its four terms are never transcribed correctly by
   any condition (`Vervaeke`, and `relevance realisation` which the model spells with a `z`), which
   the plan reports. Does reporting them honestly rescue the clip, or is a clip where only one term
   moves too thin to carry a source?

2. **The ranking.** `purpose` above `profile`, and 300 characters against the profile's 400. Both
   numbers are arguments rather than measurements — the eval never had a vocabulary near the 2,000
   cap, so the priority order was never exercised. Is that stated plainly enough, and is the
   reasoning ("the purpose is short and its jargon is at the front, the profile is a paragraph")
   sound or post-hoc?

3. **The new store read.** `shelfStore.read(slug)` on the dictation request path, inside the same
   `Promise.all` as the other three. Unlike the article read there is no deadline and no cache on
   it. Should there be? What happens under the Postgres adapter when the shelf row does not exist?

4. **The numbers in the rewritten § Results.** Check each claim against
   `results-vocabulary-sources.json`. Specifically: is "every step is larger than the noise floor"
   true given a *single* replicate pair measuring 0.1 WER / 0.6 recall points, and is one replicate
   pair enough to make that claim at all? Is claim 7 (the wrong vocabulary) now consistent with the
   table, having been wrong last time? Is anything quoted more precisely than 550 calls justify?

5. **Prompt injection, again.** The purpose box is the reader's own text, so it is less hostile than
   an article's title — but it is a place a reader could paste something. Does anything about a
   fifth source change the fence's story?

6. **The reusability refactor.** Is `SOURCES`/`RECIPES` actually the right seam, or is it
   indirection for its own sake given there are two places and five sources? Does moving `Where` and
   `parseWhere` and re-exporting them from `transcribe.ts` leave a trap — a caller importing from
   the wrong file, a circular import, a mock in a test that now covers the wrong module? Is the
   `satisfies` / `keyof` trick sound, and does anything still let a source's failure pass silently?

7. **Anything the five-run table now says that the three-run one did not.** In particular `whole
   library (256)` scoring *better* than the correct 60-term list, and `production (vocabularyFor)`
   sitting mid-table. Are either of those a bug rather than a finding?

## Rules

Be concrete. Quote file and line. If a finding is a guess, say so. If the answer to any of the six
is "this is fine", say so plainly rather than inventing a concern. Number your findings and end
with a verdict: **ready** / **ready with changes** / **not ready**.

Write repo-relative links, not absolute paths, and no `:line` suffix inside the link target —
`tests/doc-links.test.ts` rejects those and this file is committed.
