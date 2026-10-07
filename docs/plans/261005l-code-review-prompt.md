# Code review: Remember becomes Learn, and Explore also covers critiques

You are the cross-family reviewer of finished code, and you **fix what you find inside this work**,
narrowly and red-first (a failing test before the fix where a test is possible). Anything wider
that you notice, report and do not fix. Do not run any git command that changes history or the
index; leave your edits in the working tree and I will read them as a diff and commit them.

## The candidate

Four commits on this worktree's branch, on top of `origin/dev` at `53bc831f5`:

- `8fcf05982` the eval gains a critic reader and a `critique` judge label
- `7c6029641` stage 1: the mode is called Learn wherever a reader sees its name
- `616606382` stage 2: Explore also covers what may be wrong with the piece
- `88b9fe4d2` the evergreen docs

`git diff 53bc831f5..88b9fe4d2 --stat` lists every changed path. (`evals/results/` holds untracked
eval output from this work; it is evidence, not candidate code.)

The plan, with Greg's words (the requirement) at the top and the plan review's ledger at the
bottom: `docs/plans/261005l-remember-becomes-learn-and-explore-covers-critiques.md`. The plan
review itself: `docs/plans/261005l-plan-review-sol.md`.

Start with `src/title-text.ts`, `src/mode-catalog.ts`, `src/web/command-match.ts`,
`src/web/ChatPanel.tsx`, `src/web/sub-modes.ts`, `src/converse.ts` § `EXPLORE_SYSTEM`,
`src/web/help/help-modes.tsx`, `evals/remember-explore.ts`, `docs/project/remember-mode.md`. That
does not limit scope.

## What to attack, independently, before reading my suspicions

1. **The rule was "words change, identifiers do not".** Find any place a reader or a model still
   meets the old name as the mode's name: rendered strings, `aria-label`, `title=`, error
   sentences, prompts, tool descriptions, generated catalogues, the Help page, the Features and
   Landing pages. And the reverse: any identifier, URL word, stored value or test id that was
   changed and should not have been.
2. **Behaviour.** Does anything now match, route, filter or persist differently because a label
   changed? Things keyed on a label rather than an id; the command bar's ranking for `learn`,
   `remember`, `remember quiz`, `learn quiz`, `recall`, `quiz`; `CHAT_FROM_LABEL`; the visitor's
   sentence; the tab title; anything that compares against the string "Remember".
3. **`FORMER_PARENT_NAMES`** in `command-match.ts`: is it right, minimal, and does the generated
   `src/command-pick-catalogue.generated.json` match what the code now gives (the model-facing
   command picker reads it)?
4. **`EXPLORE_SYSTEM`.** Read the whole prompt as the model would. Does TESTING THE PIECE
   contradict any other section, including the interpolated ones (`CITING_IDS`, `QUOTATION_IDS`,
   `CLAIM_ORIGINS`, FORMAT, LENGTH, NO VERDICTS, `plainWords`, `PROFILE_RULES`)? Is each of the
   plan review's PR-4 and PR-5 actually carried by the words? Is anything in it an instruction a
   model will over-apply (fault-finding every turn, hedging every objection, refusing to state a
   problem)? Fix wording where you are confident; report where it is a judgment.
5. **The tests.** Are the new assertions in `tests/explore-kind.test.ts`,
   `tests/remember-panel.test.tsx` and `tests/command-bar-sub-modes.test.tsx` able to fail for the
   right reason, or do they assert a heading and nothing behind it?
6. **The eval** (`evals/remember-explore.ts`): the `critic` reader, the `critique` label, the
   `unlabelled` fallback in `parseLabels`, the score table's new column. Can the instrument
   measure C1–C6 as the plan states them? Does `--rescore` of the 2026-10-03 label files still
   work?
7. **The docs**: does any edited sentence under `docs/project/` now say something false (for
   instance "Learn thread" where the stored kind `remember`, which is Recall's thread, is meant;
   or a history sentence rewritten into the present)? Was any quotation of Greg's altered
   (`git diff 53bc831f5..88b9fe4d2 -- docs/project AGENTS.md`, lines starting `>`)? Fix these.

Run what you can that needs nothing outside the tree, at least:
`npx vitest run tests/explore-kind.test.ts tests/command-bar-sub-modes.test.tsx tests/remember-panel.test.tsx tests/command-match.test.ts tests/command-pick-catalogue.test.ts tests/doc-links.test.ts`
and `npm run typecheck`. You have no network and no Postgres; say what you could not run.

## Known and not yours to fix

- The two Features-page screenshots (`src/web/assets/remember.png`, `quiz.png`) still show the old
  headings. Reshooting them is blocked on the shared local database being behind `dev`'s newest
  migration; it is tracked in the plan.
- The identifier rename is deferred on purpose (plan § The simpler option passed over).
- `src/web/changelog-pending.json` names Remember in two unreleased entries; it is replaced whole by
  the deploy's `prepare` step and is not edited here.

## Severity and verdict

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Every finding gets a stable ID (`CR-1`, …), its evidence, whether it is **established** or
**reasoned**, and whether you **fixed** it (name the files) or are **reporting** it. End with a list
of every file you changed and one line: `VERDICT: ship` or `VERDICT: ship with the fixes above` or
`VERDICT: do not ship`. Refuse only on an established P0 or P1 you could not fix.

## My own suspicions, last, and worth less

- The catalogue description for the mode got long.
- "at most three, in one or two plain paragraphs" against FORMAT's "No lists" may still read as a
  contradiction to a model.
- The docs subagent's "Learn" in places that are really about Recall's thread.
