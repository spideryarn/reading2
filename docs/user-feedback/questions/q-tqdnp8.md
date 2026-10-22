---
id: q-tqdnp8
report: none
status: answered
asked: 2026-10-21
title: Dictation Retry in Chrome adds the words beside the rough ones instead of replacing them. May I fix it?
acted: spya-pnmrkw
refs: qi-qxkryezr · found by GPT Sol during fbwc4vku · decisions file item 87
---
In Chrome, if a dictation's transcription fails and you press Retry, the finished transcript is put in next to the rough live words instead of replacing them, so you get the sentence twice. This happens in every box with a microphone.

A. Yes: fix it, so Retry replaces the rough words, as a successful first try already does. Small change, with a test.
B. Leave it for now.

Recommendation: A. It is a plain bug.

## Greg's answer, 2026-10-22 (in the Feedback dialog, reply `spya-pnmrkw`)

> I don't quite follow, but if you're sure that this is going to be better, ideally if you can test it, that would be great. But if you're sure this is going to be better, then do it. ...

Acted on 2026-10-22: A, tested. The bug was not quite as described. In Chrome, a failed transcription with rough words already in the box offered no Try again at all, only the audio to save, because a retry would have put the sentence in twice. Now the box remembers the failed attempt's rough words, Try again is offered, and its transcript replaces them, as a first try's does. If the reader has since corrected those words by hand, they are kept, and the transcript goes in beside them. Checked with a test that failed first, and in real Chromium on the Help page ("the rough words" became exactly "The real words."). GPT Sol reviewed it and tightened two edges. docs/project/dictation.md, failure mode 6; review in docs/plans/261022g-dictation-retry-replaces-rough-words-code-review-sol.md.
