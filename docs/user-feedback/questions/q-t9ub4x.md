---
id: q-t9ub4x
report: spya-xurkmf
status: open
asked: 2026-10-29
title: Your words are now in Kalam, a pen hand, instead of the comic Shantell Sans. Keep it, or one of the runners-up?
refs: SPIDERYARN-READING2-PV · docs/user-feedback/261028_2327-the-readers-words-in-kalam-not-shantell.md · docs/plans/261029e-explanations-borrow-glossary-controls-full-width-and-a-calmer-reader-face.md § 1 · docs/mockups/m-nypk6z.md · docs/project/fonts.md
---
Which face should the words you type be in? The comparison is mockup m-nypk6z: the same sentences of yours in all four.

A. Kalam (on dev now). A pen hand that leans slightly. It still looks written by a person and stays distinctive, without Shantell's cartoon roundness. Gives up: no true italic (the browser slants it), and only regular and bold.
B. Delius. Rounded and upright, the calmest of the marker-pen family Shantell is in. Gives up: it barely looks handwritten, so your words sit closer to the app's own text.
C. Klee One. A neat pencil hand, very easy to read. Gives up: it is so quiet that at a glance it looks almost like the app's own font.
D. Go back to Shantell Sans.

Recommended: A. It is the only one that keeps what you liked ("looks like a script ... distinctive") and loses the Comic Sans feel.

Details

What you said, 2026-10-28 (spya-xurkmf), reading the Consciousness in AI paper: the font for words the reader wrote "looks like a script, which is probably a good thing, and it's distinctive. But it's just a tiny bit sort of, I don't know, Comic Sans and irritating. Can you find another font that's sort of in the same family, but just a little bit less over the top?"

Background. Since 25 October everything you type (chat messages, notes, comments, search boxes, your profile) is in its own face, so it is never mistaken for the article's words or the AI's. That face was Shantell Sans.

What I did. I set nine free fonts side by side on your own typed words, at the sizes the app uses, between a line of AI text and a line of article text. Four were dropped at once: Playpen Sans and Mali are as comic as Shantell; Caveat and Edu are real joined-up scripts and hard to read at 14 to 15 pixels. Handlee is cramped. That left the three above. Kalam is now on dev, everywhere the reader's words appear, and reaches production with the next deploy.

The picture is on the mockups page after that deploy too (mockups are files that ship with the app). Until then it is in the repo at docs/mockups/m-nypk6z-1.png.

What would decide it: whether you want your words to look clearly handwritten (A), or calmer and closer to ordinary text (B or C). Any of them is a one-line change.
