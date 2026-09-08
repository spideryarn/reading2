# Review the built code, not the plan

You reviewed the plan for this change a few hours ago and returned "build it with changes"
(`docs/plans/260908e-plan-review-sol.md`). This is the second review, of what was actually built.
**Weight it as the more important one**: a plan-stage review cannot see what the code does.

Be adversarial. I want the case against this, not encouragement.

## What changed

Branch `worktree-fb2f-dock-always-visible-landscape`. The scoped diff is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/968beaba-352a-489f-a202-5e1c87403920/scratchpad/fb2f-code.diff`,
or `git diff origin/dev...HEAD -- src/web/styles/narrow-window.css tests/`.

Three rules in `src/web/styles/narrow-window.css` § a small device keyed on a bare `.mode-band` and
now key on `:where(.reader.band-covers) .mode-band`. One new test file. No TypeScript changed.

## Your own findings, and what was done with them

All four were acted on. Check the actions, not my description of them:

1. **Specificity.** You said `.dock:focus-within` is (0,2,0), not (0,3,0), so the plain spelling
   raised the guard to (0,4,0) and the transition rule to (0,5,0). Both now use
   `:where(.reader.band-covers) .mode-band`. **Verify the numbers are actually preserved now**, in
   all three rules, and that the comments state them correctly — the comments are the thing I got
   wrong last time and they are load-bearing in this file.
2. **`:focus-within` dropped.** Confirm it is gone from all three rules.
3. **The `overscroll-behavior` claim** was corrected to "several" and names the four scrollers you
   found without it (`.gloss-list`, `.srch-saved`, `.srch-hits`, `.quotes-list`). Check I named them
   correctly and that the weakened claim still carries the safety argument.
4. **The install hint** was NOT changed to your `--install-hint-transform` design. It keeps copying
   one of the guard's arms, and the mismatch you identified is written down in a comment and in the
   plan's § What was left alone as deferred work. Is deferring it defensible, or does the change I
   *did* make leave it in a worse state than it was in before?

## The test

`tests/the-dock-hides-in-a-mode-beside-the-article.test.ts` is a static gate over the stylesheet —
it proves the rules are written, not that they apply. I know that and it says so. What I want from
you:

- Its `bandMentions()` regex is `/[^{};]*\.mode-band[^{};]*/g` over the comment-stripped § a small
  device block. **Find what it misses.** A rule it would not see; a way to satisfy it while
  reintroducing the bug; a false positive that would fail a correct future change (you already found
  one of those — the parenthesis count — and it is gone).
- The block is sliced by brace-balancing from a hardcoded `@media` string. What happens when that
  string changes, and is failing loudly the behaviour you get?
- Is asserting the exact selector text `":where(.reader.band-covers) .mode-band"` too brittle, or is
  brittleness the point in a file where the spelling *is* the fix?

## The questions that matter most

1. **Is there a state where the dock is now unreachable?** This is the one thing that would make
   this change worse than the bug. The safety argument is: where `.band-covers` is false the article
   is beside the band, the document scrolls, and scrolling up returns the dock. Measured in headless
   Chrome at 844×390 — search, glossary, outline, chat, summary all take the dock from 350 to 390 on
   scrolling down and back to 350 on scrolling up; at 390×844 it stays at 804 throughout. Find the
   configuration those five modes do not represent.
2. **Does anything else in the codebase read `.mode-band` to mean "the band owns the screen"?** A
   fourth rule with the same proxy bug, in another sheet or in JS, is exactly what I would miss.
   `shell.css` § the bar that leaves while you read is the top bar's equivalent and was deliberately
   not touched — is that right, or does it have the same defect?
3. **Is `.reader.band-covers` written early enough?** It comes from `App.tsx`'s `fit.modeW === 0`
   on the same render the band mounts. If there is a frame where the band exists and the class does
   not, the dock would flicker away and back on every mode open.
4. Anything else you would not ship.

State a verdict: land it, land it with changes (name them), or do not land it.
