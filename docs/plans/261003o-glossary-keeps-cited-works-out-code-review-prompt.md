# Code review: the glossary keeps cited works out (261003o)

You reviewed the plan for this; now review what was built. You may fix what you find inside this
change's scope (the files in the diff). Report anything wider instead of fixing it. Do not run git
commands that change history or the index, and do not commit.

The report being answered, from the product's owner:

> It looks as though there is at least one glossary item in this article that's actually a paper,
> Saha et al. I don't think the glossary should include citations. That's what citations are for.

Read:

- The plan, with what was done about your plan review:
  `docs/plans/261003o-glossary-keeps-cited-works-out-citations-are-not-terms.md`
- The scoped diff of commit `07f366fa3`:
  `docs/plans/261003o-glossary-keeps-cited-works-out-code-review.diff`
- The code as it stands: `src/glossary.ts` (`SYSTEM`, `citesByEtAl`, `toEntries`,
  `PROMPT_VERSION`), `tests/glossary.test.ts` (the test "drops an entry that is a citation, and an
  alias that is one"), `evals/glossary-citations.ts`.
- The evidence: `docs/plans/261003o-glossary-keeps-cited-works-out-eval-report.txt` (the eval's own
  `report` output over every arm) and the raw lists under `evals/results/glossary-citations/`.
- The write-up and its conclusion:
  `docs/investigations/261003g-glossary-citation-entries-before-and-after-the-rule.md`.
- The docs: `docs/project/glossary.md` § A cited work is not a term, and the note
  `docs/user-feedback/261003_1913-glossary-lists-a-cited-paper.md`.

Questions, most important first:

1. **Check the conclusion, not only the code.** Recount the investigation's tables against the eval
   report and the raw JSON: entries, people, the named citation entries and aliases per arm, Arago's
   rate. Is any number wrong, and does the short answer claim more than the runs support? The
   shipped arm is `v3-*`; `after*` and `v2-*` are wordings that were dropped. Say if the write-up
   explains away anything inconvenient (the two short lists, the authors not checked against the
   text).
2. **The prompt text.** Does the new rule in WHAT DOES NOT, the worked example under FOR EXAMPLE and
   the alias rule say one consistent thing, in plain words (`docs/project/prompting-guide.md`)? Do
   they contradict any existing line of `SYSTEM`, in particular "people, organisations, places,
   works and events named without introduction" and "People and works named without introduction
   still earn entries of their own"? Does anything in the prompt still quote the eval paper?
3. **The guard.** `citesByEtAl` and its two uses in `toEntries`. Any input that throws, any real
   term it removes, any "et al." form it misses that it should catch ("et al.,", "et. al.",
   "et al" with a non-breaking space)? Does dropping an entry in `toEntries` interact badly with
   `dedupe`, `inheritIds`, the empty-result error in `buildGlossary`, or the `added` count?
4. **The version bump.** Anything that pins `glossary/8`, any fixture or test that should have
   moved, any cache key or stamp the bump should or should not reach (`src/pipeline.ts`).
5. **The test.** Would it fail if the guard were removed from the alias path only, or from the name
   path only?
6. **The docs and the note.** Any claim in them that the code or the numbers do not support.

Give findings as a numbered list, each with a severity (P0 blocks, P1 should fix before pushing,
P2 worth considering), the file and line, and whether you fixed it. Then list the files you
changed. End with one line: `VERDICT: push`, `VERDICT: push after the P1 fixes I made`, or
`VERDICT: do not push`.
