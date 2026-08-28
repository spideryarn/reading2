# Review request: building the dictation vocabulary programmatically

You are reviewing a change to **Spideryarn**, a reading app. Read-only. Please be adversarial: I
would rather hear that the experiment is invalid than that the code is tidy.

## What the change is

Dictation happens in two passes. The browser's `SpeechRecognition` gives live words while the reader
talks; the recording then goes to `google/gemini-3.1-flash-lite` through OpenRouter's
chat-completions endpoint, with a `<vocabulary>` block of terms in the user message, and that
transcript **replaces** the live one. The vocabulary is the whole reason the second pass exists — an
earlier measurement put word errors at 0% with the article's glossary in the prompt and 3.6–7.3%
without, all of them proper nouns.

Until 2026-08-27 the vocabulary had one source: the article's glossary (in an article) or the
reader's profile prose (on the profile page). This change makes it four sources, adds a term
extractor, and adds an eval to decide between them.

## Read these

**The plan** (start here — it has the results table, the research and the rejected options):

- `docs/plans/dictation-vocabulary.md`
- its predecessor, for context: `docs/plans/dictation-two-pass.md`
- the feature's home: `docs/project/dictation.md`

**The code:**

- `src/vocabulary.ts` — new. `SITE_TERMS`, `properNouns`, `proseOf`, `fit`. Pure
  functions of text, no store, no model.
- `src/transcribe.ts` — `vocabularyFor`, `profileTerms`, `glossaryTerms`,
  `articleTerms` and the `NAMES` cache are the changed part. The rest of the file is unchanged from
  the previous review.

**The tests:**

- `tests/vocabulary.test.ts` — new.
- `tests/transcribe.test.ts` — the `describe("the vocabulary")` block.

**The measurement** — please give this at least as much attention as the code:

- `evals/dictation/bench-vocabulary-sources.ts` — the
  harness.
- `evals/dictation/utterances.json` — the nine clips' text, the
  hard terms scored, and the reasoning for the two control clips.
- `evals/dictation/results-vocabulary-sources.json`
  — every vocabulary sent and every transcript returned, for all conditions and runs.
- `evals/dictation/README.md` — what the clips can and cannot settle.

## What I most want you to attack

1. **The experiment.** Nine synthetic `say` clips, three voices, real articles. Does the design
   support the conclusion ("all four sources, ~40 names, no cap trouble")? The `+names(40) again`
   row is deliberately an exact duplicate of the row above it, so the gap between them is the noise
   floor — is that gap large enough to retire any of the differences the plan draws conclusions
   from? Is three runs enough? Is anything in the scoring (`wer`, `has`, `invented`) measuring
   something other than what it claims — for instance, does the diacritic/punctuation normalisation
   make a term "recalled" that a reader would call misspelled?
2. **The `invented` column is zero everywhere.** That is the load-bearing negative result: it is
   what licenses a 331-term list not being harmful. There is a self-check that makes the detector
   fire on a planted transcript before the run starts. Is the detector still too weak — does its
   `term.length < 6` skip, or its whole-word matching, mean a real insertion would go uncounted?
3. **The proper-noun extractor.** `properNouns` decides a word is a name if it appears capitalised
   mid-sentence twice, or once with >60% of its occurrences capitalised. What does that get wrong on
   real prose — dialogue, lists, German nouns, all-caps headings inside body text, an article in
   another language, an article that is mostly a table? What happens on an empty or one-word
   article? Is the `NOT_NAMES` set a slippery slope back to a stopword list?
4. **The request-path cost.** `articleTerms` now calls `loadArticle(slug)`, which ships every block
   (up to 350 KB here, unbounded in principle) on the first dictation per article per process, to
   produce ~25 terms. It is cached in a 32-entry `Map` keyed by `${currentOwnerId()}:${slug}`, with
   a `"cli"` bucket when there is no request. Is the owner key right, is the cache a leak of any
   kind, is the eviction (delete the first key) defensible, and is the read worth what it buys?
5. **Prompt injection.** Terms now come from more untrusted places: an article's own prose supplies
   the proper nouns, and the article may be any web page. They are deduplicated, capped at 2,000
   characters, fenced in `<vocabulary>` in the **user** message, and the system prompt says the block
   is data. Is there a shape of article text that gets something dangerous into that block, or that
   makes the fence escapable?
6. **What the plan claims and what it measured.** Any place where the prose asserts something the
   evidence does not support, or where a number is quoted more precisely than the run justifies.

## Rules

Be concrete. Quote file and line. If a finding is a guess, say so. If the answer to any of the six
is "this is fine", say that plainly rather than inventing a concern. Number your findings and end
with a verdict: **ready** / **ready with changes** / **not ready**.

Write repo-relative links, not absolute paths, and no `:line` suffix inside the link target —
`tests/doc-links.test.ts` rejects those and the review file is committed.
