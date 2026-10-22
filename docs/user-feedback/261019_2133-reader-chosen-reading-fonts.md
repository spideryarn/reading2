---
reports: spya-jxwfah
ending: shipped
comment: The AI's words now use a face that reads more easily as paragraphs, iA Writer Quattro, in place of the strict monospace. There is no font setting; one face per kind of text, for everyone.
---
# Choose the face the article is read in → a nicer face for the model's words

Report `spya-jxwfah` (#653, SPIDERYARN-READING2-MJ), 2026-10-19 21:33 UTC, a reader
(`feedback-reporter.ts` exit 1, no addenda when re-read before this note), in Skim on
`review-of-the-evidence-of-sentience-in-cephalopo-spya-fd0ger`. Queue item `qi-84z94bhp`.

> Please can the fonts for the different categories of text be user-definable. I want to be able to
> use other fonts for reading, not just eg times new roman.

**Awaiting Greg.** Nothing built. The faces are Greg's deliberate design, one per voice, always
([fonts.md](../project/fonts.md)), so a reader's override is his call under his 2026-10-19 rule
(`spya-x4zujq`). Opus and GPT Sol both reviewed it. The recommendation is a per-device Reading face
setting for the author's voice only: today's serif, Literata, or Atkinson Hyperlegible Next. The
model's and the reader's faces stay fixed. What they see is Source Serif, served correctly in
production, not a failed load. Plan
[261020v](../plans/261020v-reader-chosen-reading-fonts.md); question
[q-s0suam](questions/q-s0suam.md).

## Shipped, 2026-10-21

Greg answered q-s0suam on 2026-10-20 (reply `spya-tpq6t9`): no reader setting, and a nicer face for
the monospace instead, reading the report as a dislike of it:

> I think really what he's saying, if we read beneath the lines, he didn't like the monospace font
> we're using. So why don't we try finding a nicer one, and don't give the user the ability to
> switch it? Because my hunch is that does add complexity that we don't need.

Built in [261021f](../plans/261021f-nicer-ai-face-and-no-reader-font-setting.md), queue item
`qi-38kzx6pz`: the model's face (`--font-ai`) is iA Writer Quattro, IBM Plex Mono's letters on four
widths instead of one, for every reader; code in a model's answer stays on one width in iA Writer
Mono. Chosen over Plex, iA Writer Duo and Recursive from screenshots in Skim and Summary. Both
self-hosted, OFL. GPT Sol reviewed the plan and the code. The author's serif is unchanged. Re-read
with `feedback-reporter.ts` before this note: exit 1, a reader. The same reply also added a line to
[ask-me-questions.md](../reusable/ask-me-questions.md): each option says roughly how big it is to
build.
