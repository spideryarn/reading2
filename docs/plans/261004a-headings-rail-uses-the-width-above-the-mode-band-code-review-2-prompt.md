A short second code review, read-only, in the Spideryarn repo (this worktree). Do not edit files.

After your first code review of 261004a, the browser check found one more thing and I changed one
number. Review that delta: `git show HEAD -- src/web/styles/crumbs.css` (the `.crumbs li` rule,
`flex: 0 100 auto` to `flex: 0 100000 auto`, and its comment), with the evidence in
docs/plans/261004a-headings-rail-uses-the-width-above-the-mode-band.md § What the browser showed
afterwards.

Questions:
1. Is the explanation right (flex-shrink is weighted by base size times factor, so at 100:1 the last
   crumb still took about 1% of the shortfall), and is a very large factor a sound way to give the
   ancestors all of the shrinking until they are frozen at their minimum? Any browser, Safari above
   all, where a factor of 100000 misbehaves, overflows a fixed-point limit, or leaves a sub-pixel
   overflow that draws an ellipsis anyway?
2. Does it change the narrow three-line rules in the same file (§ a narrow window), where the
   current crumb is absolutely positioned and `li:nth-last-child(2)` has `flex-grow: 1`?
3. Does any test or doc still say "a hundred times" and now state something false?
   (`grep -rn "hundred times" src docs tests`.)
4. Anything in the plan's new section or in
   docs/user-feedback/261003_1912-headings-rail-uses-the-width-above-the-mode-band.md that the
   evidence does not support?

Findings as P0/P1/P2 with file:line, then one line: `VERDICT: approve`, `VERDICT: approve with
changes` (list them; I will make them), or `VERDICT: rework`.
