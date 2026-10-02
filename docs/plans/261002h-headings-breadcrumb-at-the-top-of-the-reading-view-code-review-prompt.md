You are GPT Sol doing the CODE review of commit 390b3566b in this worktree (Spideryarn): the headings breadcrumb. House rule: you may FIX what you find inside this change (edit files in the worktree; do not commit, do not push, no destructive git commands), and report anything wider for me to decide. Write your findings, and a list of every file you changed, as your answer.

Read first:
- the plan and its § Reviews: docs/plans/261002h-headings-breadcrumb-at-the-top-of-the-reading-view.md (your own plan review is .review/bc-plan-review-sol-1.md; I took P1-1, took P1-2 as a documented exception, and DECLINED P1-3 with a reason in src/web/HeadingsCrumbs.tsx — challenge that if you think the reason is wrong)
- the diff: .review/bc-code.diff (git diff HEAD~1 HEAD)

Evidence so far:
- npm run typecheck green; npm run build green (the CSS `content: "›" / ""` survives into dist).
- tests/headings-crumbs.test.ts (6) and tests/headings-crumbs-wiring.test.tsx (3) green; the jump test was mutation-checked (onClick unwired -> red).
- A browser check (Playwright, real dev server, seeded article with 9 parts): crumbs update on scroll, bar never slides away, tooltip card shows title+gist, click on the part crumb lands below the bar, Structure's "you are here" and the crumbs agree, phone width truncates to one line with no horizontal page scroll, covering band at phone width shows no bar, toggling the switch removes/restores the bar (prose moves 44px). One unconfirmed note: in one early run the bar was absent while the page opened at a restored scroll position — likely before the experimental setting had loaded.

Look especially for: anything that changes behaviour for readers with the switch OFF or for visitors; the layoutKey change (does adding `showBar` cause any unwanted re-anchor/scroll jump when the switch loads asynchronously after a restored `?at=` position? is that better or worse than not re-keying?); hook-order or render-cost issues in Reader.tsx (crumbsRoot memo deps, `geometry`); the CSS (flex-shrink truncation, narrow-window.css's `.controls > *` and `overflow: auto hidden`, the guard specificity); a11y (nav/ol/aria-current/tooltip); a test that would pass with the feature broken. Rank P0/P1/P2 with file:line.
