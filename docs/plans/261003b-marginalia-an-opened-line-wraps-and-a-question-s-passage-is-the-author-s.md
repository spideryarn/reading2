# Marginalia: an opened line wraps, and a question's passage is the author's

Overseer queue `qi-bm8fpvy4`, session `fb9a-marginalia-typeface-by-voice`. Two of Greg's reports,
both admin (`feedback-reporter.ts` exit 0):

> Make sure the font in the marginalia mode reflects whether it's AI-generated or user-generated or
> author-generated.
>
> see fonts.md
>
> — Greg, 2026-10-01 (SPIDERYARN-READING2-9A, `spya-xjuxde`)

> In Marginalia mode, we're including FAQs, and they're default-collapsed. That's fine on both
> counts. But when I click to expand, it shows the FAQ answer, but the FAQ question is still
> truncated.
>
> — Greg, 2026-10-02 (`spya-qcgyb0`)

## Prior work: most of 9A had already landed

9A was filed against build `6bdf24dc`, before the faces left the Experimental switch. Since then:

- [261002b](261002b-a-nicer-ai-typeface-and-the-voices-trawl.md) (`dab30ed19`) voiced Marginalia's
  head question, idea stamp, arc and path, behind the switch.
- [261002f](261002f-the-three-faces-for-everyone-and-every-surface-voiced.md) (`9b4b7a933`) took
  the faces out from behind the switch for everyone and gave the shut lines a computed voice
  (`lineVoice`), the FAQ quote the author's face, the comment body the reader's, Debate's
  `applies` / a citation's why / a comment's answer the model's.

A read of `MarginaliaColumn.tsx` on `origin/dev` against [fonts.md](../project/fonts.md)'s rule
found **one** element left out: the passage a reader's chat question was asked from
(`asked.quote`), drawn both as the shut line (one item) and as an opened row's head. It is the
article's words — the same text `.chat-dialog-quote` already draws in the author's face — and it was
in the app's. Everything else either has its voice or is deliberately UI by fonts.md (a cited work's
title, Debate's third-party page quote, our stamps and counts).

`gjd-remote ls`: no other session on Marginalia's faces; `fbayajv6-marginalia-relations-timeline`
is asleep and on other ground.

## What changes

1. **`entryVoice`** beside `entryLine` in `MarginaliaColumn.tsx`: a question with a passage is
   `author`, a comment with a body is `reader`, our stand-ins ("About this paragraph", "AI answer")
   are `ui`. The opened question row wraps its quoted passage in `voiceClass("author")`, leaving
   "Question" and the curly quotes' surrounding sentence ours.
2. **An opened shut line wraps** (`.marg-shut[data-open] .marg-shut-label`: `white-space: normal`,
   `overflow: visible`). With one item the line *is* the FAQ question (or the citation's title, the
   Debate headline, the comment) and the open half deliberately does not repeat it, so the open
   state left it cut. Fixing it in the one shared label fixes every kind at once.

**The simpler option passed over** for (2): repeating the question as `.marg-open-head` in the open
half when there is one item. It would show the words twice — cut above, whole below — and need the
same change in three components. Letting the line wrap is one rule.

## Tests

`tests/marginalia-shut-notes.test.tsx`: the opened-label rule exists and the open line still holds
the question; a question's passage carries `voice-author` shut and open; a question with no passage
stays `voice-ui`. Both new behaviour tests were red before the change.

## Deferred

Nothing for 9A. Debate's third-party quotes stay UI until fonts.md's "Undecided" line is decided.
