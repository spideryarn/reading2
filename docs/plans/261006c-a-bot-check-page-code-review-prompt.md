# Review: stage 2 refuses an Anubis bot-check page by its own markup

Repo: this worktree, branch `worktree-qi-ptvjnvdm-bot-check-page` off `dev`. TypeScript, ESM,
vitest. You reviewed the plan for this (F1 to F3,
`docs/plans/261006c-a-bot-check-page-plan-review-sol.md`); this is the code built from it. New
finding IDs start at **F4**.

## The candidate

Committed: commit `677404435`, one commit.

    git show --stat 677404435
    git diff 677404435^..677404435 -- . ':(exclude)evals/results/extraction-score.json'

Start with (this does not limit scope): `src/challenge-page.ts`, `src/extract.ts`,
`src/pipeline.ts`, `src/messages.ts`, `evals/extraction/arms.mts`,
`tests/extract-challenge-page.test.ts`, `tests/job-failure.test.ts`, then the docs:
`docs/project/content-extraction.md` § "The three ways this stage refuses",
`docs/postmortems/261006c-a-size-floor-stood-in-for-a-recogniser-of-kind.md`, and the plan
`docs/plans/261006c-a-bot-check-page-is-refused-by-its-own-markup.md` (its "What landed").

`evals/results/extraction-score.json` was re-recorded in full (a test wants a row per fixture and
arm); most of its diff is a month of drift in older rows. Read it as a reviewer of that claim, not
line by line.

## You may fix what you find

You have write access to this worktree. **Fix what is inside this stage, narrowly and red-first**
(a failing test seen red, then the fix). **Report, do not fix, anything wider** you notice. Do not
commit; I read your diff as a proposal. Never attribute words to Greg that are not already in the
repo verbatim. Do not weaken an existing test to make something pass.

Run `npx vitest run tests/extract-challenge-page.test.ts` and
`npx vitest run tests/extract-capability-floor.test.ts` yourself: they need nothing outside the
tree. `tests/job-failure.test.ts` needs local services you cannot reach; I ran it (two new cases,
green, and red with the recogniser stubbed off). `npm run typecheck` is green at this commit.

## What I want

An independent attack first. Then say whether each of these statements is **accurate**:

1. A document reaches a `ChallengePage` refusal only if its parsed source DOM has a real
   `script#anubis_challenge[type=application/json]` whose JSON has a `rules` object and a
   `challenge` object; and every such document is refused on `readArticle`,
   `readArticleWithProvenance`, `runExtract` and the pipeline's `extract` step, for both origins.
2. No refusal consumer in `src`, `tests`, `evals` or `scripts` is left that would throw, mis-type or
   mis-report on a `ChallengePage`.
3. The tests would go red if the precedence (challenge over floor, challenge over
   `ReadabilityRefused`) or the floor-suspension exemption were removed.
4. The docs changed say what the code does, and the postmortem's facts (commits, dates, numbers)
   are true.

## Severity and IDs

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1; mark the rest *reasoned*. For each finding say
*fixed here* (with the file) or *reported*. End with `VERDICT: land it` or `VERDICT: not yet`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- This adds a hard refusal on a reader's path. The sentence I would least like to be wrong about:
  *no genuine article a reader would want carries that element.* An Anubis-protected site serves the
  real page untouched once the check passes, so I believe so; attack it.
- `getElementById` returns the first element with that id. A page with an earlier non-script
  element of the same id and a later real script is then not recognised. I think that is the safe
  direction and not worth code.
- The two reader sentences against `docs/project/copy.md`.
