# Review, second pass: finish what the lock stopped

Your first pass is `docs/plans/261005b-brief-slightly-longer-review-sol.md`, and its prompt is
`docs/plans/261005b-brief-slightly-longer-review-prompt.md`: read both first. You said the review
was incomplete because the shared lock blocked every command. That was my instruction's fault:
other sessions' full suites hold that lock for half an hour at a time.

**This time, do not use the lock for reading.** Reading files, `git status`, `git diff HEAD`,
`grep`, `sha256sum`, `node -e` over JSON files, and
`npx tsx evals/simple/length-bands.ts table|score brief|score|score sentence` (they read result
files only and call nothing) all run directly, with no `flock`. Only `npx vitest run …` goes
through `flock /var/tmp/spideryarn-heavy.lock`; if it has not started after ten minutes, stop
waiting and say so. I am running those three test files and the typecheck myself.

Your three findings (F11 to F13) and your edits to the three docs and the source comment are
accepted as they stand. Number new findings from F14.

## What is decided, and what is still yours to check

Greg's decision is that Brief gets slightly longer; the brief I was handed says to pick the
smallest increase not judged worse and to say plainly when the judge does not favour it. So
"leave it at 80" is recorded as your recommendation and goes to Greg in my report; it is not a
reason to withhold the rest of the review. What I still need:

1. **Every number in the docs against the files.** Run `score brief` and `table`. Check the
   words table, the means and ranges (97, 103, 110), every tally (prefer, pad, bent, coverage,
   omit, the two size groups, the book's four pairs), the 11/11 side balance in
   `key-brief.json`, the three-paragraph counts (0 of 11, 2 of 12, 1 of 12) and the longest
   sentences (19, 20, 21 words) from the `brief` arrays in the result files.
2. **Provenance.** For each `high-none-brief100a|b` file, does `systemsSha256` equal
   `sha256(JSON.stringify(SIMPLE_SYSTEMS_BY_BAND[band]))` for the prompts now in the tree? You
   cannot import the TypeScript without `tsx`; `npx tsx -e` or a small script is fine, unlocked.
   Do the `brief90` files differ from the tree, as they should? Do the `len0` files' recorded
   `version`, `model` and the new files' agree on the model?
3. **The code statements** from the first prompt (§ The code statements to test), 1 to 4.
4. **The judge.** Read `judge-brief-instructions.md` and a sample of `judge-brief.md` against
   `pairs-brief.md`. Do the instructions leak which side is new, or lean the judge? Does the
   parser in `score` read any verdict wrongly (spot-check five pairs by hand against the table)?
5. Anything in the docs that still says more than the evidence does, after your own edits.

## What you may change

As before: you may edit this worktree, narrowly, inside this change. Do not commit, and use no
git command that changes the tree. Do not attribute any sentence to Greg other than "maybe Brief
could be ever so slightly longer but not much". List every file you changed.

## Your answer

A verdict on the code and the evidence (not on the product decision, which you have given):
sound, sound after fixes, or not sound. Then findings from F14 with severity and evidence, and a
line for each of the five checks above saying whether you completed it.
