---
id: q-dhnbhw
report: spya-ar65p3
status: answered
asked: 2026-10-06
title: Should the same kind of line be the same size in every mode?
refs: SPIDERYARN-READING2-DW · qi-f8h393sb · docs/plans/261006k-text-size-adjust-for-a-landscape-phone-and-a-quick-review-of-fonts-and-sizes.md § Questions for Greg · docs/user-feedback/261006_1416-fonts-differ-skim-too-big-and-a-quick-font-review.md · qi-t76rmqxr · docs/plans/261008i-text-styles-for-the-recurring-lines-in-a-mode-band.md
acted: spya-k99f8e
---
Background. Your report about Skim's text looking too big has shipped, as one rule that stops an iPhone held sideways enlarging the text in the band beside the article. You also asked for a quick review of fonts and sizes, and this is the question that review raised.

The sizes are not on a scale. There are about 65 different text sizes, and each mode chose its own: a row's main line is 14px in Skim, 15px in Glossary and 16.5px in Quiz.

A. Line up the kinds of line that recur across modes. Name five or six jobs (a row's main line, a word-for-word quote, a model's sentence, a small label, a count), give each one size, and move the modes onto it. In use: Quiz's question, Glossary's term and Skim's row become one size, somewhere between today's 14px and 16.5px, which is itself a choice to look at. Costs: about a session, some rows wrapping differently, and a check of every mode in a browser at three widths. Everything else keeps its odd size.

B. Design a full scale for everything, headings, tiny labels and one-off sizes included. Gives one answer for any new text. Costs: it has to be designed first, then every size in the app moved onto it; several sessions, and many small visible shifts. It is not yet defined well enough to build.

C. Leave it. Nothing is broken; a reader sees the drift only by comparing modes.

What would decide it: A if the modes looking like one product matters now. C if it does not yet. B only after A has shown which kinds of line are real.

Recommended: A.

Not asked: whether the model's monospaced type should be drawn slightly smaller. There is no evidence that it looks bigger.

## Greg's answer, 2026-10-08 (in the Feedback dialog, reply `spya-k99f8e`)

> Maybe this is part of the larger design system work that presumably there's only so many different kinds of fonts and sizes and displays and headings and whatever. It may be a few dozen, perhaps, but then new modes, new interface components would be mostly reusing one of those existing font types and sizes and whatever. That feels like it might lead to a cleaner design feel if things are, you know, using a more consistent design system. I don't think this is worth killing ourselves over, but perhaps we could make some steps towards it, taking lots of screenshots so that it doesn't, you know, disrupt things too much, because it looks okay right now. It just doesn't look as good as I think it could. Use your judgment. I think as much as anything, I'm trying to lay foundations so that development goes faster and is more likely to produce good results without too many rounds of iteration going forwards. And, you know, laying the foundations well for the current setup is a step towards that.

Settled as A. Six named sizes now cover the lines that recur in a mode band: a row's main line, verbatim source words, an explaining sentence, a small meta line, a count, and a group's small heading. Ten modes have been moved onto them, with before and after screenshots at four sizes, and most lines moved by under a pixel. Quiz's question stays larger on purpose. The sizes are on /design under Text roles, and typography.md tells the next mode to use them. Plan 261008i, session fbar65p3-type-sizes-across-modes.
