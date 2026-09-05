# The "?" answer opens plainly, and reaches for an analogy where one helps

**[SPIDERYARN-READING2-1S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1S)** · suggestion ·
reported 2026-09-05 08:33 UTC · **shipped**

## What Greg said

> When I click the question-mark-comment in vertical gutter, it should explain in easy-to-understand
> language, starting with brief summary, and drawing on pedagogical techniques, e.g. worked example,
> analogy, etc

## What shipped

A `helpSection()` in [`converse.ts`](../../src/converse.ts), added to the final user message on a
help turn only. It asks for one or two plain sentences on what the passage is doing, then the thing
the reader was missing, then **one** analogy or small worked example where it beats another
restatement — and it says to send them back into the paragraph rather than stand in for it, which is
[vision.md](../project/vision.md)'s whole point.

Three things it deliberately is not:

- **Not a mode.** "Drawing on pedagogical techniques" could be a whole explain-band. It is a string.
- **Not a new vocabulary.** [`explain.ts`](../../src/explain.ts) already holds a pedagogical prompt
  written for this exact reader, so this borrows its principles instead of inventing a second set.
- **Not a summary of the article.** Greg asked for a brief summary; the system prompt says not to
  summarise the piece. Both are satisfied by orienting to *this passage*, which is what he was stuck
  on.

It sits **below** the `cache_control` breakpoint, so nothing above it moves and the article cache is
untouched — asserted byte-for-byte rather than assumed.

## The line it does not cross

[1X](260905_1001-a-comment-asking-for-evidence-did-not-search.md) arrived while this was being built,
about the model not searching the web. This wording pulls the other way — *open plainly*, *use an
analogy*, *do not summarise* all lean towards answering from the article alone. So `helpSection()`
says **nothing** about where an answer comes from, leaving that rule where the system prompt owns it.
A second, weaker copy of it firing only on help turns is how the first one stops meaning anything.

**Plan:** [260905c-gutter-comment-chip-explanation-metadata-and-prompt.md](../plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md)
