# Code review, and fix: 261006e stage 2 — `skim/10`, the cue sets the scene when its quote needs one

You are the reviewer-fixer. You may edit files in this worktree. **Fix what is inside this stage,
narrowly, each code fix with a test seen red first; report, do not fix, anything wider.** Do not
commit. **Do not change the wording of `SKIM_SYSTEM`**: it is the measured file (the results record
its hash), so a wording problem is a finding to report, not a fix. Stage 1's files
(`src/web/**`, `tests/skim-panel.test.tsx`, `tests/stop-card.test.ts`) were reviewed already and are
out of scope.

## The candidate

Two commits on this worktree's branch: `c943494a9` (round one: wording B and the paragraph arm C)
and the commit after it, `HEAD` (round two: wording B2 ships, arm C removed). Review the **net**
change: `git diff 35629c447 HEAD -- src/skim.ts src/types.ts tests/skim.test.ts scripts/eval docs/project/skim.md docs/project/investigations.md docs/investigations/261006b-skim-cue-situates-the-quote-eval.md docs/plans/261006e-skim-cue-situates-the-quote-and-term-chips-use-the-glossary-card.md`
and the result files `evals/results/skim-cue-2026-10-06-*` and
`evals/results/skim-coverage-2026-10-06T06-*`.

## What it is for

Greg's report, quoted in the plan: the Skim cue should situate its quote. The plan's Stage 2, its
"Sol's plan review" section (your F1, F5, F6, F7) and its Progress section say what was decided and
what the measurement found.

## Your independent pass first

1. **The code.** `PROMPT_VERSION`, `MAX_CUE_CHARS` 140 → 200 and everything derived from it (the
   answer token budget, the schema, `validateRoute`/`cueOf`), that arm C is wholly gone and the
   default input hash is byte-identical to before, that nothing else in the repo assumes 140 or
   `skim/9`, and that a stored `skim/9` route reads *outdated* and never *stale* because of this
   change. Run `npx vitest run tests/skim.test.ts tests/plain-words-coverage.test.ts tests/doc-links.test.ts`
   yourself. Tests that need Postgres are mine to run.
2. **The prompt, as a prompt.** Read § 3 of `SKIM_SYSTEM` against `docs/project/prompting-guide.md`
   and against the shared `plainWords("ask")` paragraph it sits beside. Does it contradict itself or
   another section? Could it be read to permit stating the finding?
3. **The conclusions. Read the investigation and the plan's Progress as a reviewer of the
   conclusions, not only of the code.** Recompute what you can from the judgment and key files with
   `scripts/eval/skim-cue-pairs.ts` or by hand: are the counts in the write-up the counts in the
   files? Are the keys balanced? Is any claim in `docs/project/skim.md`'s new paragraph stronger
   than the numbers?

Severity: **P0** wrong for readers or loses data; **P1** a real defect or a conclusion the evidence
does not support; **P2** worth fixing; **P3** note. Every finding gets an id (F1…), file and line,
whether you fixed it, and the test you saw red. End with `VERDICT: ready` or `VERDICT: not ready`.

## My own suspicions (already mine; spend most of the run elsewhere)

- The sentence I would least like to be wrong about: **"B2 gives the finding away no more often
  than the old cue, and misstates the context no more often, inside what two runs of the old prompt
  differ by."** It rests on one run of B2 and one judge per comparison, of the writer's own model
  family. Is the write-up honest about that, and does the ship decision survive it?
- Whether "ahead 15 to 8 on the dangling subset, not clearly outside the control" is said plainly
  enough everywhere it appears, given that subset is the thing Greg actually reported.
- Whether 200 characters is drawn acceptably wherever a cue is shown (the current row, and under
  the door in the prose).
