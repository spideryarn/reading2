**Verdict: ship with changes.**

1. Pressing a result does not ring its phrase unless the criterion is already ticked. [CriteriaPanel.tsx:252](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/CriteriaPanel.tsx:252) excludes unticked criteria from `found`, but [CriteriaPanel.tsx:1151](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/CriteriaPanel.tsx:1151) leaves every result clickable. The click sets `openKey`, then the absence check at line 281 clears it; there is never a mark to ring. Make pressing a result activate its criterion before opening it, or temporarily include that result in `found`. Test the default-off path without ticking first.

2. A valence sign can erase a comment’s ✳ marker. [styles.css:1923](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/styles.css:1923) and [styles.css:2205](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/styles.css:2205) both own `::after` at equal specificity; the later direction rule wins when a comment and valence hit end together. Give the direction sign its own generated element/pseudo-element or add an overlap treatment that visibly preserves both carriers.

3. The stripe cap can remove every valence colour while retaining its sign. [annotate.ts:440](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/annotate.ts:440) concatenates every identity token before every valence token and only then slices to six. Six single-ended criteria over a phrase starve a diverging result completely, producing categorical stripes followed by `+`/`−`; the displayed colour and sign then describe different facts. When both kinds exist, reserve at least one lane for each before deterministically filling the remaining lanes.

4. The prose carrier is deliberately absent from the accessibility tree. [styles.css:2198](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/styles.css:2198) uses empty alternative text. The panel is not a substitute for a co-located carrier when a screen-reader user encounters the marked prose directly. Keep generated content, but use semantic alternatives such as `content: "−" / "counts against"` and corresponding text for the other states. That avoids the unexplained “stray minus” without making the judgement silent.

5. `mixed` only notices co-terminating directions. [annotate.ts:467](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/annotate.ts:467) derives the sign from `ending`, not all valence marks covering that run. For an against range `[0,10]` overlapped by a for range `[0,5]`, the first segment draws both colours but ends with `+`, hiding the simultaneous against direction in greyscale. When any valence ends, derive the sign from all valence marks covering that rendered segment. The key at [CriteriaPanel.tsx:464](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/CriteriaPanel.tsx:464) should also explain `·` and `±`, not only `−` and `+`.

6. The remaining identity colour recreates the original ambiguity. [CriteriaPanel.tsx:869](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/CriteriaPanel.tsx:869) gives the tick an identity hue, and the adjacent button is merely labelled “Colour”. For a diverging criterion, changing that colour does not recolour its phrase marks; it affects only the paragraph bar and rail. The comment at line 874 still falsely says the tick and mark are “the same thing.” Make the tick neutral or ramp-shaped, and label the categorical control explicitly as the bar/rail colour.

7. The visible default-off copy is false for new runs. [CriteriaPanel.tsx:315](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/CriteriaPanel.tsx:315) automatically ticks a newly run criterion, while [CriteriaPanel.tsx:439](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/CriteriaPanel.tsx:439) says nothing is marked until the reader ticks it. Prefer: “A criterion marks its passages while its tick is on. New runs turn it on automatically.”

8. The sanitizer policy changed without advancing its version. [sanitize-policy.ts:55](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/sanitize-policy.ts:55) still says version 4, although its own comment requires a bump for every stricter policy. Advance it to 5 and add a sanitization test for forged `class="hit" data-dir="for"`. The actual `FORBID_ATTR` addition is otherwise the right defence, and I found no other newly generated annotation attribute needing reservation.

9. A core source-of-truth comment still asserts the reversed rule. [referee-criteria.ts:205](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/referee-criteria.ts:205) says valence is “never painted into the prose stripe” and lives in a nonexistent block-gutter treatment. The two changed project docs are otherwise aligned with the new rule. Correct this docstring before landing.

10. Omitting `refscale` from the URL-state table is not justified by earlier omissions. [url-state.md:27](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/docs/project/url-state.md:27) presents an exhaustive parameter table and later says “Those are all.” Existing omissions of `runs` and `crits` are documentation bugs, not precedent. Make the approved rule-doc edit and add `runs`, `crits`, and `refscale` together.

11. `Mark` still accepts wrong states. [annotate.ts:155](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/annotate.ts:155) permits, for example, a `kind: "cmt"` mark with `hue: "garbage"`, `dir: "for"`, and `slot: 1.5`. It prevents only the explicitly named null pairing. Discriminate the valence arm on `kind: "hit"` and use a constrained token/validated palette-slot type, or stop claiming invalid slots and non-hit valence marks are unrepresentable.

12. The reversed tests are meaningful, but important mutations remain green. The current tests exercise `resolveCriterion → Found → hitMarks → annotateHtml`, so they are more than a restatement. However, the suite does not catch:

   - swapping the `for` and `against` CSS glyphs;
   - removing `data-dir` from `FORBID_ATTR`;
   - identity-token starvation at six stripes;
   - partially overlapping opposite directions;
   - pressing an unticked result;
   - the comment-marker/valence-sign collision.

   Add those cases, with at least one computed-style/browser assertion for generated content.

I found no defect in the `refscale` synchronization between its independent hooks, remaining display reads of `config.scale`, the other `Found` producers, `blockHues`/spine slot use, or consumers of the newly derived `rgb(var(...))` tokens.

I attempted the targeted tests, but this review environment is read-only and Vitest failed before collection when Vite tried to write `node_modules/.vite-temp`; the verdict therefore uses the supplied test evidence plus static inspection.
