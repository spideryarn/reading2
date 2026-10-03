---
reports: spya-xjuxde, spya-qcgyb0
ending: shipped
---
# Marginalia's faces say whose words they are, and an opened FAQ question is read whole

Two reports from Greg about Marginalia, both checked as his with `feedback-reporter.ts` (exit 0), so
both built. Overseer queue item qi-bm8fpvy4.

**spya-xjuxde** (Sentry SPIDERYARN-READING2-9A), 2026-10-01, sent from Summary with the margin open
on `melnikoff-bargh-2018-mythical-number-2-0-spya-bucuzj`:

> Make sure the font in the marginalia mode reflects whether it's AI-generated or user-generated or
> author-generated.
>
> see fonts.md

**spya-qcgyb0**, 2026-10-02:

> In Marginalia mode, we're including FAQs, and they're default-collapsed. That's fine on both
> counts. But when I click to expand, it shows the FAQ answer, but the FAQ question is still
> truncated.

## What we did

- **9A was mostly done before this session started**: 261002b voiced Marginalia behind the
  Experimental switch, and 261002f (`9b4b7a933`) gave the faces to everyone and voiced the shut
  lines. One element was still in the app's face: the passage a reader's chat question was asked
  from. It is the article's words, so it is now in the author's.
- **An opened line wraps.** With one FAQ question (or one citation, headline or comment) the shut
  line *is* the item and the open half does not repeat it, so opening now lets it wrap.

Plan: [261003b](../plans/261003b-marginalia-an-opened-line-wraps-and-a-question-s-passage-is-the-author-s.md).
