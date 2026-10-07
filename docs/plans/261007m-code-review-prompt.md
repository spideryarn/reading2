# Code review: 261007m, five design-consistency follow-ups

You are the code reviewer AND fixer for five commits in this worktree (Spideryarn repo):
bd7a7056a (S1), 1cf3d283c (S2), 13a22e307 (S4), 157cf5bd3 (S3), 4f85b5d01 (S5), on base 9b939b442.
Diff: `git diff 9b939b442..4f85b5d01`. Changed paths: `git diff --name-only 9b939b442..4f85b5d01`.
Read the plan first: docs/plans/261007m-design-consistency-follow-ups-five-queued-items.md (its sections
S1–S5, the plan review response, and the browser baseline findings). Your plan review is
docs/plans/261007m-plan-review-sol.md. The changed files are where to start, not a limit on scope.

Attack independently: correctness in every state, width (1440, iPad 768 portrait = 288px band, 390), theme
(dark must be unchanged by S4), pointer type (coarse), and other callers of anything shared (.prof-mic,
.chat-live-btn, .chat-composer, AskInChatButton, Button, BandWaiting, .gloss-btn). S5: does
`display: contents` on .chat-voice change anything in Chat (focus order, a11y, the `:has()` rules, order
properties, narrow-window.css rules)? Does `flex: 1 1 0` in Learn behave when Live's status / dictation strip
are present? Do the tests prove what they claim (were they red before)? Run the test files yourself:
tests/learn-start-over-line.test.tsx tests/glossary-and-citations-ask-in-chat.test.tsx
tests/elevation-shadows-soften-in-light.test.ts tests/diagram-pager-shape.test.ts tests/voice-row.test.tsx
tests/learn-panel.test.tsx tests/chat-live-handoff.test.tsx (these need no network).

FIX what is inside these five items, narrowly, red-first where a test can show it. REPORT, do not fix,
anything wider. Do not invent quotes from Greg; do not edit docs other than the 261007m plan. Do not commit.

Severity: P0 breaks readers or data; P1 wrong behaviour a reader would hit; P2 worth fixing; P3 nit.
IDs C1, C2, ... with file/line, what you changed (if anything), and a final verdict line:
READY, READY WITH THESE FIXES, or NOT READY.

My own suspicions (worth less; spend most of the run elsewhere): Citations' Ask in chat already wrapped to its
own line at 288 and 390 at 24px; at sm it is wider — acceptable? The .chat-live-btn padding change in Chat.
