---
id: q-s0suam
report: spya-jxwfah
status: answered
acted: spya-tpq6t9
asked: 2026-10-20
title: Should readers be able to choose the face the article is read in?
refs: SPIDERYARN-READING2-MJ · qi-84z94bhp · qi-38kzx6pz · docs/plans/261020v-reader-chosen-reading-fonts.md · docs/plans/261021f-nicer-ai-face-and-no-reader-font-setting.md · docs/user-feedback/261019_2133-reader-chosen-reading-fonts.md
---
A reader asked, on 19 October, to choose their own fonts for reading, "not just eg times new roman". Should the article's face be a reader's setting?

A. A Reading face setting on /profile, beside Brightness and Text size, for the author's words only: Serif (today's Source Serif, the default), Book serif (Literata), or Sans (Atkinson Hyperlegible Next, designed for low-vision readers). Kept on this device. The model's monospace and the reader's Arial do not change, so a summary still cannot be mistaken for the author's sentence. Costs about a session, mostly keeping the reader on their paragraph when the face changes and checking the layout in each face. (Recommended)

B. A choice for each of the voices: author, model, reader, and the app's own. More freedom, a bigger settings panel and more to test, and nobody has asked to change the model's face. To keep the voices apart the model's list would have to stay monospaced.

C. Let the reader type the name of any font on their device. Most freedom, but a misspelt or missing font fails silently and we cannot test faces we have never seen.

D. No. One face per voice for everyone, as you set it on 2 October. Costs nothing; a reader who finds the serif hard going has no way round it.

Greg, 2026-10-20 21:49 UTC (reply `spya-tpq6t9`):

> Can you make a minimal update that when presenting me with choices, it's helpful to have a bit
> more of a sense of trade-offs. So, for example, I can't tell how complicated this would be. If
> it's trivial, I'd be at least open to it.
>
> That said, I don't think this is the right move. I think really what he's saying, if we read
> beneath the lines, he didn't like the monospace font we're using. So why don't we try finding a
> nicer one, and don't give the user the ability to switch it? Because my hunch is that does add
> complexity that we don't need.

Built as
[261021f](../../plans/261021f-nicer-ai-face-and-no-reader-font-setting.md), on dev: no reader
setting. The model's words are now in iA Writer Quattro, IBM Plex Mono's letters on four widths
instead of one, so they still look typed but read as prose; code in a model's answer stays on one
width, in iA Writer Mono. Chosen from four faces compared side by side in Skim and Summary. And
[ask-me-questions.md](../../reusable/ask-me-questions.md) now asks each option to say roughly how
big it is to build.

Details

The report (spya-jxwfah, #653) is from a reader, not an admin, filed while they were in Skim. By your rule of 19 October, a reader's suggestion with any doubt in it comes to you before it is built. Nothing is built.

Why there is doubt: the faces are your decision. Each kind of words has its own face: the author's in a serif, a model's in a monospace, the reader's in Arial, the app's own in Geist. On 2 October you said they should be used "throughout and always going forwards", with no switch. Any of A to C partly reverses that.

What the reader sees is Source Serif, not Times New Roman. I checked production: the font file is served correctly. A serif simply looks like Times to most people, so this is a preference, not a loading bug. Their browser cannot override it for them either, because our own font rules win.

How A works: exactly like the Text size setting you asked for on 18 October, a value kept in this browser and applied before the page draws. A reader who keeps the default downloads nothing extra. It changes the author's face everywhere it appears (shelf titles and Metadata too), so the author's words look the same throughout. It would follow the reader to another device only if we stored it on their account, which is not proposed.

What makes A a session rather than an hour, from GPT Sol's review of the plan: changing the face rewraps the whole article, so the reader has to stay on the paragraph they were reading, including when the new font arrives a moment after the page; the column's width was tuned to today's serif and has to be checked in the new faces; and the Sans covers Latin scripts only, so a Greek or Russian article would fall back.

Not offered: "dyslexia fonts" such as OpenDyslexic, because the evidence that they help is weak. Also left out: "your device's own font", which on most systems is the interface face, not a reading one.

What would decide it: A if you are content for the author's face to be a reader's choice while the model's and the reader's stay fixed. D if one look for everyone matters more than this request. B or C only if readers keep asking for more than A gives.
