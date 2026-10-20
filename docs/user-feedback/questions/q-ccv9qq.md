---
id: q-ccv9qq
report: spya-wc4vku
status: open
asked: 2026-10-20
title: Add a rule to controls.md that any box for more than a few words of the reader's writing gets a microphone?
refs: spya-wc4vku · SPIDERYARN-READING2-MQ · qi-syvf7st3 · qi-d44n9rhc (the five boxes) · docs/user-feedback/261019_2154-a-microphone-on-the-add-page-and-on-every-prose-box-by-default.md · docs/plans/261020r-dictation-on-the-add-page-boxes-and-a-microphone-by-default.md · docs/plans/261020a-add-page-asks-why-higher-and-about-you-says-when-it-is-ready-and-shows-import-progress.md · docs/project/controls.md · docs/project/dictation.md · tests/prose-boxes-have-a-microphone.test.ts
---
The add page's two boxes now have a microphone, and a test fails if anyone adds a new text box without one, unless they give a reason. One part is left for you: may I add one line to controls.md, the design rules page, saying so?

A. Add this row to controls.md's table of controls that look the same everywhere (recommended):
   "a control that... takes more than a few words of the reader's writing  |  the shared piece: a microphone (DictationButton and DictationStrip, through useDictationField; dictation.md, Adding it to a box)  |  the test: prose-boxes-have-a-microphone (every multi-line text box, or its component listed with the reason)"
   Costs one line. It puts the rule where someone designing a new box is told to look first.

B. The same row, plus "single-line boxes for a sentence count too, and the reviewer checks them". Wider, but no test can check it, because the code cannot tell a sentence box from a search box.

C. No change to controls.md. The rule stays only in dictation.md and the test, which already go live with this change. Simplest, but someone drawing a new box reads controls.md, not dictation.md.

Recommendation: A.

Details

What you asked, on 2026-10-19 from the page that shows while an article imports (report spya-wc4vku): "make sure there's a dictation button next to the Why are you reading this? input box. And indeed, we really want a dictate button next to pretty much all of our input boxes that are going to have more than a few words of text typed into them. Let's make a minimal tweak to our docs and/or design system to make this more likely going forwards."

What is built and on dev:
- "Why are you reading this?" and "About you" on the add page each have the microphone button and the strip under the box, like the boxes on your Profile page.
- The add page opens the article by itself when the import finishes. A microphone would be cut off by that, so while either box is listening or turning speech into words, the page waits: both "Open the article" buttons are greyed out, and the page does not leave by itself. Nothing saves your half-heard words before the real transcript arrives.
- A new test looks at every multi-line text box in the app. If a box has no microphone and is not on a short list with a reason, the test fails. The list today: the /design page's example, a read-only report box, four admin-only boxes, and five reading boxes that should get a microphone and have not yet: Skim's purpose box, Referee's new-criterion box, the box that scopes the Candidates search, rewriting a question in chat, and editing a comment's note. Those five are queued as their own job.
- dictation.md now says a box for more than a few words gets a microphone by default, and points at the test.

Why ask you: controls.md is a rules page, and rule wording goes to you before it is edited. Nothing in controls.md has changed.

What would decide it: whether you want the rule where people look when they design a control (A), wider than a test can check (B), or only where the dictation work is described (C).
