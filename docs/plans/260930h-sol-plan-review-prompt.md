You are reviewing a PLAN (not code yet) in the repo at the current directory. Read-only.

Read: docs/plans/260930h-tweets-band-fits-ipad-and-copy-buttons-become-icons.md (the plan), then
src/web/layout.ts (especially bandWidth, fitMode, bandCoversProse, MODE_PROSE_FLOOR, PROSE_MIN,
wideIdeal), tests/layout.test.ts § "a wide band", src/web/Tweets.tsx (CopyButton, ThreadCounts,
ThreadPosts), src/web/Tooltip.tsx, src/web/BackLink.tsx, src/web/ChatPanel.tsx § CopyAnswer,
docs/project/icons.md § Navigation, docs/project/touch.md.

The user's words (Greg, the product owner) are quoted in the plan. Check:
1. Is the arithmetic in the plan's tables right? Recompute each number from the formula and from
   the code as it stands.
2. Does the proposed wide-band formula have edge cases that break an invariant elsewhere
   (overflowing, bandCoversProse crossover, rem/root-font scaling at 9/12/20px roots, spine off,
   anything else reading modeW)? Is there anything else in the codebase that assumes the wide band
   equals clamp(avail - PROSE_MIN, ...) (e.g. CSS, other tests, SmallScreenHint)?
3. Is a share-of-room the right simple answer to "slightly wider in portrait, slightly narrower in
   landscape", or is there a simpler/better one? Is 0.42 reasonable?
4. The icon-only CopyButton: accessibility (name, live region, focus), touch on iPad with the
   uncontrolled Tooltip, whether keeping visible failure text is right, anything missing.
5. Anything the plan should defer or drop.

Write your findings, numbered, most severe first, each with a concrete fix, to your answer.
Say explicitly at the end: VERDICT: proceed / proceed with changes / rethink.
