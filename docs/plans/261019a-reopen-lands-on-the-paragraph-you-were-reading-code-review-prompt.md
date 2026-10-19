Code review of the uncommitted work in this worktree (repo root = current directory) for plan
docs/plans/261019a-reopen-lands-on-the-paragraph-you-were-reading.md — read the plan, your own plan
review beside it (…-review-sol.md), and the postmortem docs/postmortems/261019a-a-reopen-drifted-back-a-section-each-time.md.
See the change with `git diff HEAD` and `git status` (new files: tests/last-view-keeps-the-paragraph.test.tsx,
the postmortem). Files: src/web/scroll.ts (kept arrival: arriveAt, realignArrival, keepWatching,
restsOn, endCentredArrival, onScrollWhileAnchored's height rule), src/web/reader/useReadingPosition.ts
(arriveAt in the restore effect; notePlace / wrote / currentAt), src/web/reader/Reader.tsx (mode effect
uses endCentredArrival), src/web/last-view.ts (ReadingPlace, withReadingPlace, noteReadingPlace, the
saver in useLastView), src/web/position.ts (readingRow), tests.

Browser evidence already gathered (Playwright, fresh context, cache off, 3,051-block article): desktop
1280x900 — cold ?at= lands exactly 3/3, stored value is the paragraph at the line, bare reopen lands on
that paragraph 3/3 with no drift, wheel releases the hold, shelf click lands. Phone 390x844 initially
failed: (1) Reader's mode layout effect cleared the hold; (2) the font reflow fired a scroll event with
scrollY moved 1px in the same frame as the block moved, before RO/loadingdone, ending the hold. Fixed by
endCentredArrival and the "page height changed ⇒ realign, not release" rule; after that the phone cold
load held (block at the line through the swap, no wrong ?at= write).

Review for correctness: races (hold vs spy vs layoutKey re-anchor vs glide corrective frame vs nuqs
debounce), whether the kept hold can fight a reader (scrollbar drag, keyboard, a band opening, Back/
Forward, jumps, Skim centred arrivals), leaks of listeners/observers, StrictMode double effects, whether
the height rule can loop (realign → scroll → height differs → realign…), the notePlace guard
(currentAt / wrote) and saver scoping, hidden rows/echo/stretches, and test quality (would each test fail
without its fix?). You may FIX what you find directly in the files (keep the house style: comments that
explain why, matching density), run `npx vitest run <files>` and `npm run typecheck`. Do NOT commit, do
not touch git state, do not run anything against production. Report numbered findings (severity,
file:line, what you changed or why you didn't), anything wider for me to decide, and a verdict: LAND /
LAND AFTER FIXES (made) / DO NOT LAND.
