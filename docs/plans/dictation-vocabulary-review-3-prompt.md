# Third review: the seven fixes, and a table that says something different

You have reviewed this twice and returned **not ready** both times. Both verdicts were right, and
your second review's first finding was a bug nobody else had found. All seven findings from that
review are addressed and the benchmark has been re-run with the corrected conditions. Please be
adversarial again. Read-only.

## What changed since your second review

| your finding | what was done |
|---|---|
| 1. Both prose boxes truncated at 80 characters | `phrases()` in `src/vocabulary.ts` cuts a reader's prose at sentence ends and commas before it reaches `fit`. Both test files now use fixtures deliberately longer than 80 characters; the regression test goes red against the old code. The harness applies the same function. |
| 2. The profile was never one step | A `site+glossary` condition. |
| 3. Neither big-list arm tested size | `+names(40) + irrelevant` holds the correct vocabulary byte-for-byte and appends terms from a **pinned** list of articles no clip mentions; `wrong article` is now made entirely of those. |
| 4. One replicate pair used as a threshold | Reported as one realised contrast; nothing is licensed by it alone. |
| 5. No deadline on the store reads | Every source is bounded at 1.5s in `vocabularyFor`. |
| 6. `+purpose` was not production-with-a-purpose | The box goes only to its own clip; the arm carries the title and byline. |
| 7. The results file was not auditable | It now carries the provider's own summed cost, the pinned irrelevant-article list, and a SHA-256 fingerprint of each file that decided what the run measured. |

The new table says materially different things from the old one: the purpose row is now 0.0% WER
and 190/190, the wrong-article row is now **worse than no vocabulary at all**, size is measured as
size and costs nothing, and the profile moved the wrong way.

## Read these

- `docs/plans/dictation-vocabulary.md` — § Results is entirely rewritten; § What the review changed
  has a second table for your last review.
- `src/vocabulary.ts` — `phrases`, `fit`, `MAX_TERM`.
- `src/vocabulary-sources.ts` — `within`, `SOURCE_DEADLINE_MS`, `SOURCES`, `RECIPES`, `slice`.
- `src/transcribe.ts` — `Transcription.usd` is new.
- `tests/vocabulary.test.ts`, `tests/transcribe.test.ts`.
- `evals/dictation/bench-vocabulary-sources.ts`, `evals/dictation/utterances.json`,
  `evals/dictation/results-vocabulary-sources.json`, `evals/dictation/README.md`.

## What I most want you to attack

1. **Check every number and every claim in § Results against the results file**, as you did last
   time. In particular: is the wrong-article arm now genuinely disjoint from every clip, or does it
   still share terms with one? Is "size costs nothing" now actually supported, given
   `+names(40) + irrelevant` is capped at 2,000 characters and so may be dropping the tail of the
   irrelevant terms? Does the noise floor (0.4 WER / 1.1 recall points, larger than last round)
   retire any gap the section still draws a conclusion from?
2. **`phrases()`.** Is it right? What does it do to a profile with no punctuation, with URLs, with
   an em-dash list, with CJK text, with a single 400-character sentence? Does splitting on commas
   break a term that contains one? Is the `(?<=[.!?;:])` lookbehind safe for the runtimes this ships
   on? And is there any *other* place where `MAX_TERM` still silently eats an input of the wrong
   shape?
3. **The deadline.** `within()` races every source against 1.5 seconds. Is 1.5 right given the whole
   round trip is ~2s? Does the loser leaking (it keeps running) cause anything — an unhandled
   rejection, a cache write after the response, a timer holding a process open? Is `unref` doing
   what I think on Vercel's runtime?
4. **The profile finding.** § Results claim 5 says the profile is untested rather than disproved,
   and open question 2 says it stays in the recipe on the strength of the mechanism the purpose row
   demonstrates. Is that intellectually honest, or is it keeping a source because I like it? What
   would the cheapest honest test be?
5. **The purpose row is now perfect** — 0.0% WER, 190/190. A perfect score is usually a bug. Is it?
6. **Anything in the two review tables in the plan that misstates what you actually said.**

## Rules

Be concrete. Quote file and line. If a finding is a guess, say so. If the answer to any of the six
is "this is fine", say so plainly rather than inventing a concern. Number your findings and end
with a verdict: **ready** / **ready with changes** / **not ready**.

Write repo-relative links, not absolute paths, and no `:line` suffix inside the link target —
`tests/doc-links.test.ts` rejects those and this file is committed.
