---
id: q-x0y2gh
report: none
status: answered
asked: 2026-10-21
title: Chat answers have only a small gap between paragraphs. Widen it?
refs: fby4yhnp (offered, not done) · decisions file item 89
acted: spya-rrbbk8
---
In chat answers the gap between paragraphs is about 9.6px, on every screen size, which makes longer answers read as one block.

A. Yes: widen it to match the spacing between paragraphs in the article itself. A small style change.
B. Leave it as it is.

Recommendation: A.

## Greg's answer, 2026-10-21 18:43 UTC (in the Feedback dialog, reply `spya-rrbbk8`)

> Take screenshots, follow best practices, use your judgment. And if it's, you know, a clear cut yes, then make a minimal update, you know, to something, whether it's docs or CSS, core rules or templates or whatever, so that, you know, everything's better going forwards by default without requiring decisions and judgment and complexity.

Acted on 2026-10-22: yes. On dev, in docs/plans/261022e-phone-tap-bar-at-40px-and-a-wider-gap-between-paragraphs-of-model-answers.md. The gap between paragraphs in a chat answer is now one em: 15.4px, where it was 9.6px, at 390px and at 1280px. One em is the usual default for body text. It is a single token, `--answer-gap` in tokens.css, so a new place that shows a model's answer takes it rather than picking its own number. docs/project/typography.md § Vertical rhythm says so. The same token now spaces the AI's answer to a comment (0.7rem before) and Help's Ask answer (0.5rem before). Everything that draws a conversation through Chat, such as Learn and Sources' threads, gets it too. The space after an answer, before its sources and buttons, is unchanged. Left alone: Summary already uses 0.9rem, and Quiz's reply already leaves a full blank line.
