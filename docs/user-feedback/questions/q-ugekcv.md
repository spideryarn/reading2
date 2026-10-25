---
id: q-ugekcv
report: none
status: open
asked: 2026-10-25
title: Should Sketch's labels be in the AI font, if that cuts more labels short in existing pictures?
refs: docs/plans/261025k-fonts-and-css-code-quality.md § 3 · src/sketch-scene.ts § SKETCH_LABEL_VOICE
---
The words inside the shapes of a Sketch picture are written by the model, but they are drawn in the app's own font (Geist), not the AI font (iA Writer Quattro) your rule asks for. Quattro is about 13% wider on average, so the same box holds fewer letters. Should we switch the labels to Quattro anyway?

A. Keep Geist in the pictures. Nothing changes, and the labels stay the one place model text is not in the AI font.
B. Switch to Quattro (recommended). The labels then follow the rule like every other piece of model text. The cost falls on pictures already drawn: in production's 170 stored sketches, labels cut short with "…" would go from 49 to 174 (of 4,636), and pictures with at least one cut label from 27 to 68. New pictures would adapt, because the model is told which labels do not fit and resizes its boxes. Old ones keep the cuts until they are redrawn. A shape's card still shows its full text.
C. Switch to Quattro and redraw the stored sketches, so the old pictures adapt too. That costs one sketch-step model call for each of the 170 stored sketches, and it changes pictures readers have already seen.

Pick A if a cut label is worse than the wrong font. Pick B if the rule matters more and a few cut labels in old pictures are acceptable. Pick C if you want both, and the redraw cost is fine.

Details

You asked on 25 October for Sketch's label measurement to follow the font the labels are actually drawn in. The code decides where to break each label by counting characters at a fixed width per character, tuned to Geist. That is why the labels could not take the AI font: switching the font without the number would let labels spill out of their shapes.

Now the font and the width come from one setting, so they cannot be changed separately, and a test measures each font's real width from its font file. That setting is still Geist, so nothing looks different yet. Switching is a one-word change.

Why the server has to know the width. The pipeline checks, when the model draws a picture, how many labels do not fit, and asks the model to fix them. That check runs on the server, so it has to use the same number the browser draws with. It cannot be measured in the browser.

The numbers come from a read-only pass over production's stored sketches on 25 October, running the real fit check at both widths.
