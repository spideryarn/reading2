# Code review: fence the article's fields in three citation prompts (plan 261004i)

You are reviewing one small commit, the HEAD of this worktree. See it with `git show HEAD`.

Read first:

- `docs/plans/261004i-fence-the-dig-deeper-and-quick-check-prompts-article-fields.md` (the plan)
- `docs/plans/261004h-fence-the-paper-passages-work-fields-and-stop-echoing-reader-values-in-errors.md`
  (the change this finishes)
- `docs/project/security-map.md` and `docs/project/prompting-guide.md`
- `src/untrusted-fence.ts`

The claim to check: in `investigatePart` (`src/citation-investigate.ts`), `lookupPrompt` and
`findPrompt` (`src/citation-find.ts`), no text that came from an article, an uploaded paper or a
search result is written outside an `untrusted()` region, and our own sentences are not inside one.

Please check, and say what you found for each:

1. **Is anything untrusted still outside a fence** in those three functions, or in anything they
   call (`paperSection`, `findingsPart`, `profileSection`)? Trace where each interpolated value
   comes from. `context.linkFrom` is interpolated into a fenced line; is it a closed set?
2. **Can a field leave its fence?** `escapeUntrusted` breaks runs of `<<<` and `>>>`. Is there any
   other way out, for example a field that contains a whole fake fence?
3. **Is the test honest?** `tests/citation-prompt-fences.test.ts` cuts fenced regions out with a
   regex and asserts no hostile string is left. Could it pass while a field leaks? Is its control
   enough?
4. **The versions.** `CITATION_INVESTIGATE_VERSION` is left at `/8` on purpose, because `/8` is not
   on `origin/main` (check: `git show origin/main:src/citation-investigate-context.ts | grep VERSION`).
   `CITATION_LOOKUP_VERSION` goes `/6` to `/7`. Is either wrong? Does anything else cache on the
   text of these prompts and now go stale or fail to go stale (`lookupContextHash`,
   `investigateContextHash`, the source-guess run, any eval fixture)?
5. **Did the prompt lose anything the model needs?** The system prompts say "the details below",
   "those given above", "what the article uses it for (given below)". Do those still point at
   something? Does the quick check still clearly get told to use the DOI or arXiv id?
6. **The conclusion in the plan's "Not measured" section**: is it fair to ship this without a
   live-model eval, and is the risk it names the right one?
7. Docs: is `docs/project/citations.md` now true?

You may fix what you find inside this scope (these files, their tests, the plan and citations.md),
and report anything wider for me to decide. Do not bump `CITATION_INVESTIGATE_VERSION` past `/8`.
Do not attribute any sentence to Greg that is not already quoted in the plan. Do not commit.

Run `npx vitest run tests/citation-prompt-fences.test.ts tests/citation-find.test.ts tests/citation-investigate.test.ts tests/citation-paper-passages.test.ts tests/citation-investigate-context.test.ts`
and `npm run typecheck` after any edit.

End with a verdict line, `VERDICT: approve` or `VERDICT: changes needed`, and a list of findings
with a severity (P0 to P3) each, saying which you fixed.
