# Review: Fuller written for someone who has not read the piece — the code, and what is being pushed

Repo: this worktree, branch `worktree-fbrntjxu-fuller-summary-for-new-reader`. TypeScript, ESM. A
reading app. Summary writes plain-words paragraphs about an article at two lengths, Brief and
Fuller, one model call each. You reviewed the plan for this earlier today
(`docs/plans/261005h-fuller-summary-plan-review-sol.md`); this is the code built from it.

## The candidate, in two parts

**Part 1, about to be pushed to `dev`.** Everything in `git diff origin/dev` plus the untracked
files `git status` shows. No source of the app changes: `src/simple-summary.ts` and its tests are
`origin/dev`'s bytes in this tree. It is:

- `docs/plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md`
- `docs/research/261005c-what-makes-a-longer-summary-followable-by-someone-who-has-not-read-the-piece.md`
- `evals/simple/new-reader.ts` and `evals/simple/new-reader-judges.md`
- `docs/user-feedback/261005_0742-fuller-summary-written-for-someone-who-has-not-read-the-piece.md`,
  the line added to `docs/user-feedback/awaiting-approval.md`, and
  `src/feedback-endings.generated.ts` (written by `scripts/feedback-endings.ts`, not by hand)

**Part 2, held back, NOT being pushed.** The prompt change itself, as a diff against the tree:
`docs/plans/261005h-fuller-summary-code-review.diff` (`src/simple-summary.ts`,
`tests/simple-summary.test.ts`, `tests/simple-two-levels.test.ts`). It stays an unpushed commit in
this worktree until it has been measured.

## Why it is split

The eval could not run. The box's OpenRouter key has spent its monthly limit, so every paid model
call answers 403; only the owner can raise it. The standing rule here is that a prompt change is
measured before it ships, so the docs, the eval script and the judges' briefs go to `dev` and the
prompt does not. The report ends "awaiting Greg". Do not propose another key or another route to a
model.

## What you can and cannot run, and what you may change

Read-only (`--sandbox review`): change nothing, report everything. You can run
`npx vitest run tests/doc-links.test.ts` and a script that needs no database. No network.

## Attack it

Independently, before my questions. Statements to test:

1. Part 1 is safe to push on its own: nothing in it imports, links to or depends on anything
   that exists only in Part 2. In particular the plan and the note describe `simple-prompt/10`,
   `NOT_READ` and `AFTER_PROFILE.fuller` as *not on dev*; find any sentence a reader of `dev`
   would take to mean the prompt has changed.
2. `evals/simple/new-reader.ts`: read it as code. A judge file that is partial, duplicated,
   malformed or answers a different key must throw and not score. A missing arm must not be
   averaged as a zero. The two PASSES/FAILS lines must compute exactly what the plan's checks 1
   and 2 say, and a FAILS must be reachable. `table`'s wrong-prompt guard must be able to fire.
   The shuffle and the side coin: is the balance printed enough to catch a broken coin?
3. `evals/simple/new-reader-judges.md`: a judge following a brief to the letter produces a file
   `score` accepts, and a brief does not leak which prompt wrote what or what is hoped for. Is
   any brief leading?
4. The plan's "To pick it up once the key has room" steps would actually work for somebody who
   has only the worktree and that section. Step 4's description of the two-bullet arm: is it
   exact enough to rebuild?
5. Part 2, the prompt, read in place with the whole of `simpleSystem("fuller")` around it: every
   plan-review finding (F1, F2, F4, F5, F6) is in the bytes as agreed; nothing new contradicts
   another rule in the prompt; "the length below" is below it; Brief's bytes are untouched; the
   three new assertions in `tests/simple-two-levels.test.ts` can each fail.
6. The feedback note and the awaiting-approval line follow `docs/project/feedback-reports.md`
   § Three ways a report ends and § The note, and say nothing that is not true.

For each finding give an ID, a severity (P0 to P3), established or reasoned, (a) the concrete
scenario or the contract contradicted, and (b) the smallest change that closes it, as exact
replacement text. Say which part it is in.

## Verdict

End with one line: `VERDICT: push Part 1 as it is`, `VERDICT: push Part 1 with the changes above`
or `VERDICT: do not push`, and the two findings you would fix first.
