# Review: the Anubis bot-check entry also recognises the older page

Repo: this worktree, branch `worktree-bot-check-walls` off `dev`. TypeScript, ESM, vitest. You
reviewed the plan for this (F1 to F3, `docs/plans/261006f-other-bot-check-walls-plan-review-sol.md`);
this is the code built from it. New finding IDs start at **F4**.

## The candidate

Committed: commit `61b440abd`, one commit.

    git show --stat 61b440abd
    git diff 61b440abd^..61b440abd -- . ':(exclude)evals/results/extraction-score.json' ':(exclude)evals/results/bot-walls-261006/results.json'

Start with (this does not limit scope): `src/challenge-page.ts`,
`tests/extract-challenge-page.test.ts`, `evals/extraction/corpus.mts`,
`evals/extraction/fixtures/winehq-anubis.manifest.json`, `tests/extract-protect.test.ts`,
`tests/extraction-visible-text.test.ts`, then the docs: `docs/project/content-extraction.md`,
`evals/extraction/fixtures/README.md`,
`docs/postmortems/261006j-a-recogniser-fitted-to-one-sample-of-a-versioned-page.md`,
`docs/investigations/261006c-which-bot-check-walls-clear-the-floor-through-our-fetcher.md`
(with its rows, `evals/results/bot-walls-261006/results.json`), and the plan
`docs/plans/261006f-other-bot-check-walls-that-clear-the-floor.md` (its "What landed").

`evals/results/extraction-score.json` gained 13 rows for the new fixture (claimed: 501 lines
added, none removed, no other row changed). Check that claim, not the rows.

## You may fix what you find

You have write access to this worktree. **Fix what is inside this stage, narrowly and red-first**
(a failing test seen red, then the fix). **Report, do not fix, anything wider** you notice. Do not
commit; I read your diff as a proposal. Never attribute words to Greg that are not already in the
repo verbatim. Do not weaken an existing test to make something pass.

Run `npx vitest run tests/extract-challenge-page.test.ts` yourself: it needs nothing outside the
tree. I ran it with `tests/extract-capability-floor.test.ts`,
`tests/extraction-visible-text.test.ts`, `tests/extract-protect.test.ts`,
`tests/doc-links.test.ts`, `tests/extraction-manifests.test.ts` and
`tests/extraction-wcxb.test.ts`: 266 passed. `npm run typecheck` is green at this commit.

## What I want

An independent attack first. Then say whether each of these statements is **accurate**:

1. A document reaches a `ChallengePage` refusal only if its parsed source DOM has either the
   first shape (as before) or a real `script#anubis_version[type=application/json]` holding a
   non-empty JSON string together with a real `<script type="module">` whose `src` attribute has a
   path ending `/.within.website/x/cmd/anubis/static/js/main.mjs`; and every such document is
   refused on `readArticle`, `readArticleWithProvenance` and `runExtract`, with or without an
   address.
2. The tests would go red if either half of the second shape were dropped, if the path were
   matched by containment, if the `src` were resolved against the document, or if the first shape
   stopped matching.
3. The rewritten HAL counterfactual still proves what the original proved (the refusal is the
   recogniser's and not the floor's), and no earlier assertion was weakened.
4. The docs changed say what the code does; the postmortem's and the investigation's facts
   (counts, commits, dates, numbers) agree with `results.json` and the tree.

## Severity and IDs

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1 (direct evidence, no unresolved inference). Say for
each finding whether it is established or reasoned. End with a one-line verdict: *land it* /
*fix first*, and list every file you changed.

## My own suspicions (already mine; spend most of the run elsewhere)

- This widens a hard refusal on a reader's path. The sentence I would least like to be wrong
  about: *"no real article carries both elements as real script elements."* A page served
  *through* Anubis after the check is passed is the upstream's own page and should carry neither;
  I have not proved that from Anubis's source, which is not in the tree.
- The `<base>` test is weak (the builder said so): it passes under the made-up base too.
