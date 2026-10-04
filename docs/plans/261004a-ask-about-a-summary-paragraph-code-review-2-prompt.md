# Code review, round two: 261004a — the fixes made after round one

Read-only. Change no file. Discovery is closed; this is a narrow check of fixes.

**Candidate.** Commit `14a7e2ff2` (`git show 14a7e2ff2 -- src tests`); its parent `99a1290e4` is
what round one reviewed. Round one is
`docs/plans/261004a-ask-about-a-summary-paragraph-code-review-sol.md`.

Four changes in it are **unreviewed code**:

1. `src/web/chat-handoff.ts` § `askAboutSummaryParagraph` — round one's own CR-1 and CR-2 fixes
   (escape first, then cut; drop a trailing high surrogate). Written by the reviewer, read by me,
   checked by nobody else.
2. `src/web/chat-handoff.ts` § `askAboutBlock` — CR-3, fixed by me the same way, with a test in
   `tests/chat-handoff.test.ts` seen red.
3. `src/web/ChatPanel.tsx` — in the effect that focuses the composer for a new conversation, one
   line: `if (el) el.scrollTop = el.scrollHeight;`. A browser check found the box left scrolled to
   the top of a handed-over quote, the caret out of sight. Asserted in
   `tests/summary-ask-in-chat.test.tsx` by mocking `scrollHeight`, seen red. Read the whole effect
   and the height `useLayoutEffect` below it: does the order of the two hold (layout effect sets
   the height, then this effect scrolls), and can this line do harm on any other path that bumps
   `focusNonce` (an empty new chat, Remember, Tutorial, Explore)?
4. `src/web/styles/summary.css` § `.simple-ask` — rest opacity 0.45 to 0.7.

Run: `npx vitest run tests/chat-handoff.test.ts tests/summary-ask-in-chat.test.tsx`.

For each of the four: correct, or not, with file and line. Use P0–P3 as in round one and IDs
`R2-1…`. End with a one-line verdict: land, or what blocks it.
