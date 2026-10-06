---
reports: spya-a0wpv4, spya-vj7wv0
ending: shipped
---

# A comment in the margin was said twice, and the gutter's chat button wore a comment's icon

Two suggestions from Greg (admin; `feedback-reporter.ts` exit 0 on each production row), both on
`2608-13566v1-spya-yurten`, `?mode=citations&margin=1&diagram=illustrated&at=spya-es0zf6`. Queue
item `qi-zgk3bfxt`.

`spya-vj7wv0`, 2026-10-06 14:37 UTC, Sentry SPIDERYARN-READING2-DZ:

> In the vertical gutter next to blocks, change the comment icon to a chat icon (because that's really what it is)

`spya-a0wpv4`, 2026-10-06 14:38 UTC, Sentry SPIDERYARN-READING2-E0, with a screenshot (an opened
*Comment* line in the Marginalia column, its words printed again underneath):

> No need to repeat this bookmark-comment - see screenshot
>
> https://www.spideryarn.com/read/2608-13566v1-spya-yurten?mode=citations&margin=1&diagram=illustrated&at=spya-es0zf6

**Shipped**, both, in
[261006i](../plans/261006i-a-lone-comment-in-the-margin-says-its-words-once-and-the-gutter-s-chat-button-wears-chat-s-two-bubbles.md).

- **The comment.** A lone comment's line in the margin is the comment's own words, and it wraps to
  show all of them once it is pressed, so the open half no longer prints them again. It is the
  comment's half of the bug `spya-f6dpj5` fixed for a question
  ([note](261004_1700-a-question-in-the-margin-says-its-title-twice.md)). The tests are in
  `tests/marginalia-shut-notes.test.tsx`, seen red first.
- **The icon.** The gutter's chat button now wears Chat's own two bubbles. So does every other
  place that drew a chat as one bubble (the card the button opens, and the marks in Glossary,
  Citations, Debate and the plain-words version that open a chat), because one bubble is the glyph
  the Comments button wears. That is wider than the report's words; the plan says why, and what
  the narrower option was. The rule is now written in
  [icons.md § A chat is two bubbles](../project/icons.md#a-chat-is-two-bubbles).

Nothing was deferred.
