Review a short plan before it is built. Read-only: report findings, change nothing.

The plan: docs/plans/261003l-citation-marks-break-the-line-because-a-chat-chip-class-shares-their-name.md

The evidence, all in this worktree:
- src/web/styles/mode-band.css, the `.cite` rule near line 650 (the chat/quiz block chips).
- src/web/styles/annotations.css, `mark.cite` near line 243.
- src/web/annotate.ts near line 490 (how a mark gets its classes), and `MarkKind` at line 110.
- src/web/Cited.tsx near line 630 (the span that wears the chip class).
- src/web/styles/quiz.css near line 305.
- tests/prose-marks-stay-inline-in-chrome.test.ts, written first; it currently fails with
  "mark.cite is not an inline: expected 'inline-flex' to be 'inline'". Run it if you like:
  npx vitest run tests/prose-marks-stay-inline-in-chrome.test.ts

Questions, in order of weight:
1. Is the diagnosis right, and is it the whole cause of a cited clause sitting on lines of its own?
   Is there any other rule that reaches a prose mark by a bare class?
2. Is renaming the chip class to `cite-chips` the right fix, against the one-token `span.cite`?
   Does anything else select the chip by `.cite` that the plan does not list (grep src, tests, docs,
   evals, scripts; the chip span also takes `ctx.className`)?
3. Does the proposed static guard (no reader-sheet selector names a MarkKind class on anything but
   a `mark`) have false positives today, or an obvious hole?
4. Does the Chrome test check the conclusion, or a weaker question?

Answer with findings ranked P0 to P2, each with the file and line it rests on, then one line:
VERDICT: build as planned | build with changes | do not build.
